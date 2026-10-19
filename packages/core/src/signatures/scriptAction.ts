import { fact } from '../scoring';
import { refsField } from '../util';
import { evidence, type Signature } from './context';

/** Evento do registro processado no mesmo segundo da mudança + script action ativa (C4). */
export const scriptAction: Signature = (ctx) => {
  const out = [];
  for (const sa of ctx.traces.scriptActions) {
    const ev = ctx.traces.events.find((e) => e.name === sa.event_name);
    if (!ev) continue;
    const facts = [
      fact('trace_names_artifact', 'sysevent', `evento "${sa.event_name}" processado às ${ev.processed}`),
    ];
    if (refsField(sa.script, ctx.field)) facts.push(fact('references_field', 'sysevent_script_action', `o script referencia "${ctx.field}"`));
    out.push(evidence('script_action', { name: sa.name ?? '?', sysId: sa.sys_id, table: 'sysevent_script_action' }, facts));
  }
  return out;
};
