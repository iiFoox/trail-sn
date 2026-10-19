import { fact } from '../scoring';
import { refsField } from '../util';
import { scriptFacts } from './scriptFacts';
import { evidence, type Signature } from './context';

/** Evento do registro processado no mesmo segundo da mudança + script action ativa (C4). */
export const scriptAction: Signature = (ctx) => {
  const out = [];
  for (const sa of ctx.traces.scriptActions) {
    const ev = ctx.traces.events.find((e) => e.name === sa.event_name);
    if (!ev) continue;
    // Script actions genéricas (métricas, "visto por") disparam em toda atualização: sem citar o campo, não nomeiam a causa.
    const cites = refsField(sa.script, ctx.field);
    const facts = cites
      ? [fact('trace_names_artifact', 'sysevent', `evento "${sa.event_name}" processado às ${ev.processed}`), fact('references_field', 'sysevent_script_action', `o script referencia "${ctx.field}"`), ...scriptFacts(ctx, sa.script, 'sysevent_script_action', { mode: 'trigger' })]
      : [fact('execution_in_window', 'sysevent', `evento "${sa.event_name}" processado às ${ev.processed}`)];
    out.push(evidence('script_action', { name: sa.name ?? '?', sysId: sa.sys_id, table: 'sysevent_script_action' }, facts, cites ? [] : ['o script não cita o campo; provavelmente roda em toda atualização']));
  }
  return out;
};
