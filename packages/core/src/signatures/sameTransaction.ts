import { fact } from '../scoring';
import { toMs } from '../util';
import { evidence, type ChangeContext, type Signature } from './context';
import type { Evidence } from '../types';

/**
 * Mudanças sem job nem evento: aconteceram na própria transação do usuário.
 *
 *  - Checkpoint novo no mesmo segundo do anterior: BR after ou cadeia BR → script include (C3).
 *  - Mesmo checkpoint da atualização do usuário: o formulário diz quem foi.
 *      valor enviado == gravado  -> ação direta do usuário (C2-FORM urgency)
 *      valor enviado != gravado  -> o servidor alterou ao salvar: BR before, data lookup, regra de atribuição (C2-FORM)
 *      sem transação de formulário -> só suspeitos estáticos, CANDIDATO (C2 via REST)
 *
 * Só roda quando as assinaturas de rastro nomeado não acharam nada.
 */
export const sameTransaction: Signature = (ctx) => {
  const prev = ctx.checkpoints[String(ctx.checkpoint - 1)];
  const chained = ctx.checkpoint > 1 && !!prev?.[0] && Math.abs(toMs(prev[0].sys_created_on ?? '') - toMs(ctx.at)) <= 2000;
  return chained ? chainedUpdate(ctx) : userTransaction(ctx);
};

function chainedUpdate(ctx: ChangeContext): Evidence[] {
  const out: Evidence[] = [];
  const base = () => [
    fact('new_checkpoint_same_second', 'sys_audit', `checkpoint ${ctx.checkpoint} gravado no mesmo segundo do ${ctx.checkpoint - 1}`),
    fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
    fact('references_table', 'sys_script', `BR da hierarquia de ${ctx.table}`),
  ];
  for (const b of ctx.meta.brField.filter((b) => b.when === 'after')) {
    out.push(evidence('br_after', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, base()));
  }
  for (const x of ctx.meta.brViaSi.filter((x) => x.br.when === 'after' || x.br.when === 'before')) {
    out.push(evidence('br_via_script_include', { name: `${x.br.name} → ${x.si.name}`, sysId: x.si.sys_id, table: 'sys_script_include' }, base()));
  }
  return out;
}

function userTransaction(ctx: ChangeContext): Evidence[] {
  const out: Evidence[] = [];
  const tx = ctx.traces.transactions;
  const userTx = tx.filter((t) => t.sys_created_by === ctx.user && (t.url ?? '').includes(ctx.sysId));
  const formTx = tx.filter((t) => t.type === 'form' && t.sys_created_by === ctx.user && (t.url ?? '').includes(`sys_uniqueValue=${ctx.sysId}`));

  let verdict: 'user' | 'server' | null = null;
  let formAt = '';
  for (const t of formTx) {
    const p = new URLSearchParams((t.url ?? '').split('?')[1] ?? '');
    const sent = p.get(`${ctx.table}.${ctx.field}`);
    if (sent === null) continue;
    verdict = sent === (ctx.audit.newvalue ?? '') ? 'user' : 'server';
    formAt = t.sys_created_on ?? '';
    break;
  }

  const befores = ctx.meta.brField.filter((b) => b.when === 'before');
  const brFacts = (b: { collection?: string }) => [
    fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
    fact('references_table', 'sys_script', `BR da tabela ${b.collection}`),
  ];

  if (verdict === 'user') {
    out.push(evidence('user_action', { name: ctx.user }, [
      fact('form_value_equals', 'syslog_transaction', 'o formulário enviou exatamente o novo valor'),
      fact('execution_in_window', 'syslog_transaction', `salvo às ${formAt}`),
      fact('user_matches', 'syslog_transaction', `por ${ctx.user}`),
    ]));
  } else if (verdict === 'server') {
    for (const b of befores) {
      out.push(evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, [
        fact('form_value_differs', 'syslog_transaction', 'o formulário enviou outro valor; o servidor alterou ao salvar'),
        fact('execution_in_window', 'syslog_transaction', `salvo às ${formAt}`),
        ...brFacts(b),
      ]));
    }
    if (!befores.length) {
      out.push(evidence('server_change', { name: 'BR before, data lookup ou regra de atribuição' }, [
        fact('form_value_differs', 'syslog_transaction', 'o formulário enviou outro valor; o servidor alterou ao salvar'),
        fact('execution_in_window', 'syslog_transaction', `salvo às ${formAt}`),
      ], ['nenhuma BR before ativa referencia o campo; verificar data lookups e regras de atribuição']));
    }
  } else {
    const gap = ['sem transação de formulário visível para comparar o valor enviado'];
    for (const b of befores) {
      out.push(evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, brFacts(b), gap));
    }
    const u = userTx[0];
    if (u) {
      out.push(evidence('user_action', { name: ctx.user }, [
        fact('execution_in_window', 'syslog_transaction', `${u.type} ${(u.url ?? '').split('?')[0]} às ${u.sys_created_on}`),
        fact('user_matches', 'syslog_transaction', `por ${ctx.user}`),
      ], gap));
    }
  }
  return out;
}
