import { fact } from '../scoring';
import { evidence, type Signature } from './context';

/** Flow Designer: contexto de flow com source_record = registro, ativo no instante (C6). */
export const flow: Signature = (ctx) =>
  ctx.traces.flows.map((f) =>
    evidence('flow', { name: f.name ?? '?', sysId: f.sys_id, table: 'sys_flow_context' }, [
      fact('trace_names_artifact', 'sys_flow_context', `contexto do flow no registro, estado ${f.state}`),
    ], ['o flow pode ter alterado outros campos; verificar a ação no contexto']),
  );

/** Workflow legado: wf_context com id = registro, ativo no instante. */
export const workflow: Signature = (ctx) =>
  ctx.traces.workflows.map((w) =>
    evidence('workflow', { name: w['workflow_version.name'] ?? w.name ?? '?', sysId: w.sys_id, table: 'wf_context' }, [
      fact('trace_names_artifact', 'wf_context', `contexto do workflow no registro, estado ${w.state}`),
    ]),
  );
