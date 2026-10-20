import { fact } from '../scoring';
import { refsField } from '../util';
import { scriptFacts } from './scriptFacts';
import { evidence, type Signature } from './context';

/**
 * BR assíncrona: syslog_transaction "JOB: ASYNC: <nome da BR>" (usuário system)
 * logo após a mudança. Confirmado na Fase 0 (C1).
 */
export const asyncBusinessRule: Signature = (ctx) => {
  const out = [];
  const seen = new Set<object>();
  for (const t of ctx.traces.transactions) {
    const url = t.url ?? '';
    if (!/^JOB: ASYNC: /.test(url)) continue;
    const name = url.replace(/^JOB: ASYNC: /, '').trim();
    const br = ctx.meta.businessRules.find((b) => (b.name ?? '').slice(0, 80) === name.slice(0, 80));
    if (!br) continue;
    const facts = [
      fact('trace_names_artifact', 'syslog_transaction', `job ASYNC "${name}" às ${t.sys_created_on}`),
      fact('references_table', 'sys_script', `BR da tabela ${br.collection}`),
    ];
    if (seen.has(br)) continue; // a mesma BR em várias transações: uma evidência só
    seen.add(br);
    if (refsField(br.script, ctx.field) || refsField(br.template, ctx.field)) {
      facts.push(fact('references_field', 'sys_script', `o script ou template referencia "${ctx.field}"`), ...scriptFacts(ctx, br.script, 'sys_script', { mode: 'trigger', template: br.template, condition: br.condition }));
    } else if (!ctx.meta.brViaSi.some((x) => x.br === br)) {
      // Rodou no instante, mas o código não cita o campo (nem chama um script que grave nele): não foi ela.
      facts.push(fact('not_referenced', 'sys_script', `o código da regra não cita "${ctx.field}"`));
    }
    out.push(evidence('br_async', { name: br.name ?? name, sysId: br.sys_id, table: 'sys_script' }, facts));
  }
  return out;
};
