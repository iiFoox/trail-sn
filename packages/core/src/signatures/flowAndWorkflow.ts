import { isDynamicFlowValue, sameVal } from '../util';
import { fact } from '../scoring';
import { evidence, type Signature } from './context';

/**
 * Flow Designer: contexto de flow com source_record = registro, ativo no instante (C6).
 * Com os passos do flow carregados, aponta o passo que grava o campo (ou mostra que nenhum grava).
 */
export const flow: Signature = (ctx) =>
  ctx.traces.flows.map((f) => {
    const facts = [fact('trace_names_artifact', 'sys_flow_context', `contexto do flow no registro, estado ${f.state}`)];
    const gaps: string[] = [];
    const steps = (ctx.traces.flowSteps ?? []).filter((s) => s.flow === f.flow);
    const writers = steps.filter((s) => ctx.field in s.writes && (!s.table || ctx.meta.tables.includes(s.table)));
    let name = f.name ?? '?';
    if (writers.length) {
      const w = writers[0]!;
      const v = w.writes[ctx.field] ?? '';
      facts.push(fact('trace_identifies_mechanism', 'sys_hub_action_instance_v2', `${w.subflow ? `o subflow "${w.subflow}", passo ${w.order}` : `o passo ${w.order}`} (${w.action}) grava ${ctx.field} = ${v || 'vazio'}`));
      if (v && !isDynamicFlowValue(v)) facts.push(sameVal(v, ctx.audit.newvalue ?? '') ? fact('sets_same_value', 'sys_hub_action_instance_v2', `o passo grava exatamente "${v}"`) : fact('sets_other_value', 'sys_hub_action_instance_v2', `o passo grava "${v}", não "${ctx.audit.newvalue ?? ''}"`));
      name = w.subflow ? `${name} · subflow ${w.subflow} · passo ${w.order} (${w.action})` : `${name} · passo ${w.order} (${w.action})`;
    } else if (steps.length) {
      facts.push(fact('no_step_writes_field', 'sys_hub_action_instance_v2', `nenhum dos ${steps.length} passos do flow grava "${ctx.field}"`));
    } else gaps.push('os passos do flow não puderam ser lidos; verificar a ação no contexto');
    return evidence('flow', { name, sysId: f.sys_id, table: 'sys_flow_context' }, facts, gaps);
  });

/** Workflow legado: wf_context com id = registro, ativo no instante. */
export const workflow: Signature = (ctx) =>
  ctx.traces.workflows.map((w) =>
    evidence('workflow', { name: w['workflow_version.name'] ?? w.name ?? '?', sysId: w.sys_id, table: 'wf_context' }, [
      fact('trace_names_artifact', 'wf_context', `contexto do workflow no registro, estado ${w.state}`),
    ]),
  );
