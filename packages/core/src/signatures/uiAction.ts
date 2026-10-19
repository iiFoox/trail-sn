import { fact } from '../scoring';
import { refsField } from '../util';
import { evidence, type Signature } from './context';

/** UI action clicada: transação de formulário com sys_action=<sys_id> (C8). */
export const uiAction: Signature = (ctx) => {
  const out = [];
  for (const t of ctx.traces.transactions) {
    if (t.type !== 'form') continue;
    const m = (t.url ?? '').match(/sys_action=([0-9a-f]{32})/);
    if (!m) continue;
    const ua = ctx.traces.uiActions.find((u) => u.sys_id === m[1]);
    if (!ua) continue;
    const facts = [fact('trace_names_artifact', 'syslog_transaction', `sys_action=${m[1]} às ${t.sys_created_on}`)];
    if (refsField(ua.script, ctx.field)) facts.push(fact('references_field', 'sys_ui_action', `o script referencia "${ctx.field}"`));
    if (t.sys_created_by === ctx.user) facts.push(fact('user_matches', 'syslog_transaction', `clique de ${t.sys_created_by}`));
    out.push(evidence('ui_action', { name: ua.name ?? '?', sysId: ua.sys_id, table: 'sys_ui_action' }, facts));
  }
  return out;
};
