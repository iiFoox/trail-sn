import { fact } from '../scoring';
import { refsField } from '../util';
import { evidence, type Signature } from './context';
import type { Row } from '../types';

/** Botões de salvar do próprio formulário (Save, Update, Submit...): são só o envio, quem decide o valor é a pessoa ou o servidor. */
export function isSaveButton(ua: Row | undefined): boolean {
  return !!ua && /^sysverb_/.test(ua.action_name ?? '');
}

/** UI action clicada: transação de formulário deste registro com sys_action=<sys_id> (C8). */
export const uiAction: Signature = (ctx) => {
  const out = [];
  for (const t of ctx.traces.transactions) {
    if (t.type !== 'form') continue;
    const url = t.url ?? '';
    if (!url.includes(ctx.sysId)) continue;
    const m = url.match(/sys_action=([0-9a-f]{32})/);
    if (!m) continue;
    const ua = ctx.traces.uiActions.find((u) => u.sys_id === m[1]);
    if (!ua || isSaveButton(ua)) continue;
    const cites = refsField(ua.script, ctx.field);
    const facts = cites
      ? [fact('trace_names_artifact', 'syslog_transaction', `sys_action=${m[1]} às ${t.sys_created_on}`), fact('references_field', 'sys_ui_action', `o script referencia "${ctx.field}"`)]
      : [fact('execution_in_window', 'syslog_transaction', `botão clicado às ${t.sys_created_on}`)];
    if (t.sys_created_by === ctx.user) facts.push(fact('user_matches', 'syslog_transaction', `clique de ${t.sys_created_by}`));
    out.push(evidence('ui_action', { name: ua.name ?? '?', sysId: ua.sys_id, table: 'sys_ui_action' }, facts,
      cites ? [] : ['o script do botão não cita o campo; o valor pode ter vindo do formulário']));
  }
  return out;
};
