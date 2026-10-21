/**
 * Flows do registro e da tabela, para a aba "Flows" do painel:
 * - o que RODOU neste registro (sys_flow_context com source_record = registro), com estado e horário;
 * - o que está CONFIGURADO para rodar nesta tabela (flows ativos com gatilho de registro na tabela ou nas tabelas-pai),
 *   com o gatilho em palavras, a condição e os campos que as ações "Update Record" gravam.
 * Só leitura, com o acesso de quem está logado: o que a instância negar fica marcado em `access`.
 */
import type { RestClient } from './client/RestClient';
import type { AccessState, Row } from './types';
import { decodeFlowValues, humanQuery, parseFieldValues } from './util';

export interface FlowRun {
  sysId: string;
  name: string;
  /** Estado da execução como a instância grava (complete, error, cancelled, in progress, waiting...). */
  state: string;
  at: string;
  updatedAt?: string;
  flowSysId?: string;
  subflow: boolean;
  /** sys_flow_context pai que chamou este subflow. */
  parentSysId?: string;
}

export interface FlowDefinition {
  sysId: string;
  name: string;
  /** record_create, record_update, record_create_or_update... */
  trigger: string;
  /** Tabela do gatilho (a do registro ou uma tabela-pai, ex.: task). */
  table: string;
  /** Condição do gatilho em palavras (vazia = toda vez). */
  condition: string;
  /** Campos que as ações do flow gravam (Update Record / Create Record), quando dá para ler. */
  writes: string[];
  scope?: string;
  /** Já rodou neste registro. */
  ranHere: boolean;
}

export interface RecordFlows {
  table: string;
  tables: string[];
  runs: FlowRun[];
  definitions: FlowDefinition[];
  access: { runs: AccessState; definitions: AccessState };
  timing: { totalMs: number; calls: number };
}

const SUBFLOW = 'sys_hub_sub_flow';

export async function recordFlows(client: RestClient, target: { table: string; sysId: string }, opts: { lang?: 'pt' | 'en' } = {}): Promise<RecordFlows> {
  const started = Date.now();
  const calls0 = client.calls;
  const access: RecordFlows['access'] = { runs: 'unknown', definitions: 'unknown' };
  const q = async (table: string, query: string, fields: string[], limit: number, tag?: keyof RecordFlows['access']): Promise<Row[]> => {
    try {
      const r = await client.query({ table, query, fields, limit });
      if (tag && (access[tag] === 'unknown' || access[tag] === 'empty')) access[tag] = r.access;
      return r.rows;
    } catch { return []; }
  };

  // Hierarquia da tabela: flows com gatilho em task também rodam em incident.
  const tables: string[] = [];
  let cur: string | undefined = target.table;
  for (let i = 0; cur && i < 10; i++) {
    tables.push(cur);
    cur = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1))[0]?.['super_class.name'] || undefined;
  }

  const [rootRuns, triggers] = await Promise.all([
    q('sys_flow_context', `source_record=${target.sysId}^ORDERBYDESCsys_created_on`,
      ['sys_id', 'name', 'state', 'flow', 'flow.sys_class_name', 'sys_created_on', 'sys_updated_on'], 100, 'runs'),
    q('sys_hub_trigger_instance_v2', 'flow.active=true^flow.sys_class_name=sys_hub_flow^trigger_typeSTARTSWITHrecord',
      ['flow', 'flow.name', 'flow.sys_scope.name', 'trigger_type', 'trigger_inputs'], 300, 'definitions'),
  ]);

  // Execuções de subflow apontam source_record para o contexto do flow pai.
  // Buscamos por lotes e limitamos a profundidade para manter poucas chamadas.
  const runRows = [...rootRuns];
  let parents = rootRuns;
  const seen = new Set(rootRuns.map((r) => r.sys_id).filter(Boolean));
  for (let depth = 0; depth < 3 && parents.length; depth++) {
    const parentIds = parents.map((r) => r.sys_id).filter((id): id is string => !!id);
    if (!parentIds.length) break;
    const children = await q('sys_flow_context', `source_recordIN${parentIds.join(',')}^ORDERBYsys_created_on`,
      ['sys_id', 'name', 'state', 'flow', 'flow.sys_class_name', 'source_record', 'sys_created_on', 'sys_updated_on'], 100);
    const fresh = children.filter((r) => r.sys_id && !seen.has(r.sys_id) && parentIds.includes(r.source_record ?? ''));
    for (const child of fresh) seen.add(child.sys_id!);
    runRows.push(...fresh);
    parents = fresh;
  }

  const childrenByParent = new Map<string, Row[]>();
  for (const row of runRows) {
    const parentId = row.source_record;
    if (parentId && seen.has(parentId) && parentId !== target.sysId) {
      const group = childrenByParent.get(parentId) ?? [];
      group.push(row);
      childrenByParent.set(parentId, group);
    }
  }
  const orderedRuns: Row[] = [];
  const appendRun = (row: Row, depth: number) => {
    orderedRuns.push(row);
    if (depth >= 3) return;
    for (const child of childrenByParent.get(row.sys_id ?? '') ?? []) appendRun(child, depth + 1);
  };
  for (const row of rootRuns) appendRun(row, 0);

  const ranFlows = new Set(rootRuns.map((r) => r.flow ?? '').filter(Boolean));
  const definitions: FlowDefinition[] = [];
  for (const t of triggers) {
    const inputs = (await decodeFlowValues(t.trigger_inputs)) ?? [];
    const pick = (n: string) => inputs.find((x) => x.name === n)?.value ?? '';
    const table = pick('table');
    if (!tables.includes(table)) continue;
    const writes = new Set<string>();
    if (t.flow) {
      const acts = await q('sys_hub_action_instance_v2', `flow=${t.flow}^ORDERBYorder`, ['order', 'values'], 50);
      for (const a of acts) {
        const ps = (await decodeFlowValues(a.values)) ?? [];
        for (const f of Object.keys(parseFieldValues(ps.find((x) => x.name === 'values')?.value || ps.find((x) => x.name === 'fields')?.value))) writes.add(f);
      }
    }
    definitions.push({
      sysId: t.flow ?? '',
      name: t['flow.name'] || 'Flow',
      trigger: t.trigger_type ?? '',
      table,
      condition: pick('condition') ? humanQuery(pick('condition'), opts.lang ?? 'pt') : '',
      writes: [...writes],
      ...(t['flow.sys_scope.name'] ? { scope: t['flow.sys_scope.name'] } : {}),
      ranHere: !!t.flow && ranFlows.has(t.flow),
    });
  }
  // Primeiro os que já rodaram aqui; depois por nome.
  definitions.sort((a, b) => Number(b.ranHere) - Number(a.ranHere) || a.name.localeCompare(b.name));

  return {
    table: target.table,
    tables,
    runs: orderedRuns.map((r): FlowRun => ({
      sysId: r.sys_id ?? '',
      name: r.name ?? '',
      state: r.state ?? '',
      at: r.sys_created_on ?? '',
      ...(r.sys_updated_on ? { updatedAt: r.sys_updated_on } : {}),
      ...(r.flow ? { flowSysId: r.flow } : {}),
      // A API nem sempre devolve flow.sys_class_name; a relação com um contexto pai identifica o subflow.
      subflow: r['flow.sys_class_name'] === SUBFLOW || (!!r.source_record && r.source_record !== target.sysId),
      ...(r.source_record && r.source_record !== target.sysId ? { parentSysId: r.source_record } : {}),
    })),
    definitions,
    access,
    timing: { totalMs: Date.now() - started, calls: client.calls - calls0 },
  };
}
