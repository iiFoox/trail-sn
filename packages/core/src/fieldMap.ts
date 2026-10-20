/**
 * Mapa de automações do campo: tudo que está ativo e pode gravar este campo, na ordem em que o ServiceNow roda.
 * Não depende de um registro: é o desenho da instância. Cada item diz quando roda (condição) e o que grava.
 */
import type { RestClient } from './client/RestClient';
import { writtenFields } from './conflicts';
import { assignedLiterals, decodeFlowValues, humanQuery, parseFieldValues } from './util';
import type { Row } from './types';

export type MapLane = 'client' | 'before' | 'after' | 'async' | 'other';
export interface MapItem {
  lane: MapLane;
  kind: 'client_script' | 'ui_policy' | 'data_lookup' | 'br_before' | 'br_after' | 'br_async' | 'br_via_script_include' | 'assignment_rule' | 'ui_action' | 'flow' | 'scheduled_job' | 'import_set';
  name: string;
  table: string;
  sysId?: string;
  /** Tabela da hierarquia a que pertence (incident, task...). */
  on?: string;
  order: number;
  /** Quando roda, em texto curto (filtro, condição, campo do onChange, gatilho). */
  when: string;
  /** Valores que grava, quando são fixos. */
  values: string[];
}
export interface FieldMap { table: string; field: string; tables: string[]; items: MapItem[]; timing: { totalMs: number; calls: number } }

export async function fieldMap(client: RestClient, target: { table: string; field: string }): Promise<FieldMap> {
  const started = Date.now();
  const calls0 = client.calls;
  const q = async (t: string, query: string, fields: string[], limit: number): Promise<Row[]> => { try { return (await client.query({ table: t, query, fields, limit })).rows; } catch { return []; } };
  const { table, field } = target;
  const tables: string[] = [];
  let cur: string | undefined = table;
  for (let i = 0; cur && i < 10; i++) {
    tables.push(cur);
    cur = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1))[0]?.['super_class.name'] || undefined;
  }
  const inT = `IN${tables.join(',')}`;
  const isAssign = field === 'assignment_group' || field === 'assigned_to';
  const [brs, cs, pols, dls, rules, uas, sis, jobs, entries, triggers] = await Promise.all([
    q('sys_script', `collection${inT}^active=true`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition', 'action_insert', 'action_update'], 1000),
    q('sys_script_client', `table${inT}^active=true^scriptLIKE${field}`, ['sys_id', 'name', 'type', 'field', 'table', 'script', 'ui_type'], 200),
    q('sys_ui_policy', `table${inT}^active=true^run_scripts=true^script_trueLIKE${field}^ORscript_falseLIKE${field}`, ['sys_id', 'short_description', 'table', 'conditions', 'script_true', 'script_false', 'order'], 100),
    q('dl_definition_rel_set', `source_table_field=${field}^dl_definition.active=true^dl_definition.source_table${inT}`, ['dl_definition', 'dl_definition.name', 'dl_definition.source_table', 'dl_definition.run_on_form_change', 'dl_definition.run_on_update'], 50),
    isAssign ? q('sysrule_assignment', `active=true^table${inT}`, ['sys_id', 'name', 'table', 'condition', 'group', 'user', 'order'], 200) : Promise.resolve([] as Row[]),
    q('sys_ui_action', `table${inT}^active=true^scriptLIKE${field}`, ['sys_id', 'name', 'table', 'script', 'condition', 'order'], 200),
    q('sys_script_include', `active=true^scriptLIKE${field}`, ['sys_id', 'name', 'script'], 200),
    q('sysauto_script', `active=true^scriptLIKE${field}^scriptLIKE${table}`, ['sys_id', 'name', 'script', 'run_type', 'run_time', 'run_dayofweek'], 50),
    q('sys_transform_entry', `target_table${inT}^target_field=${field}^map.active=true`, ['map', 'map.name', 'source_field', 'use_source_script', 'target_table'], 50),
    q('sys_hub_trigger_instance_v2', `flow.active=true^flow.sys_class_name=sys_hub_flow^trigger_typeSTARTSWITHrecord`, ['flow', 'flow.name', 'trigger_type', 'trigger_inputs'], 200),
  ]);
  const items: MapItem[] = [];
  const writes = (script: string | undefined, template?: string) => writtenFields(script, template).includes(field);
  const lits = (script: string | undefined) => assignedLiterals(script, field) ?? [];
  const short = (s: string | undefined, n = 90) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  for (const c of cs) {
    if (!new RegExp(`setValue\\(\\s*['"]${field}['"]`).test(c.script ?? '')) continue;
    items.push({ lane: 'client', kind: 'client_script', name: c.name ?? '?', table: 'sys_script_client', ...(c.sys_id ? { sysId: c.sys_id } : {}), on: c.table ?? '', order: 0, when: c.type === 'onChange' ? `onChange de ${c.field}` : c.type ?? '', values: lits(c.script) });
  }
  for (const p of pols) {
    const both = [p.script_true, p.script_false].filter((x) => new RegExp(`setValue\\(\\s*['"]${field}['"]`).test(x ?? ''));
    if (!both.length) continue;
    items.push({ lane: 'client', kind: 'ui_policy', name: p.short_description ?? '?', table: 'sys_ui_policy', ...(p.sys_id ? { sysId: p.sys_id } : {}), on: p.table ?? '', order: Number(p.order ?? 100), when: short(humanQuery(p.conditions)) || 'sempre', values: both.flatMap((x) => lits(x)) });
  }
  for (const d of dls) {
    const base = { name: d['dl_definition.name'] || 'Data lookup', table: 'dl_definition', ...(d.dl_definition ? { sysId: d.dl_definition } : {}), on: d['dl_definition.source_table'] ?? '', order: 0, values: [] as string[] };
    if (d['dl_definition.run_on_form_change'] === 'true') items.push({ ...base, lane: 'client', kind: 'data_lookup', when: 'ao mudar uma entrada no formulário' });
    if (d['dl_definition.run_on_update'] === 'true') items.push({ ...base, lane: 'before', kind: 'data_lookup', when: 'ao gravar' });
  }
  const siWriters = sis.filter((x) => writes(x.script) || new RegExp(`setValue\\(\\s*['"]${field}['"]`).test(x.script ?? ''));
  for (const b of brs) {
    const lane: MapLane = (b.when ?? '').startsWith('async') ? 'async' : b.when === 'after' ? 'after' : b.when === 'before' ? 'before' : 'other';
    const ops = [b.action_insert === 'true' ? 'insert' : '', b.action_update === 'true' ? 'update' : ''].filter(Boolean).join('/');
    const when = [ops, short(humanQuery(b.filter_condition)), short(b.condition)].filter(Boolean).join(' · ') || 'sempre';
    if (writes(b.script, b.template)) {
      const tv = parseFieldValues(b.template)[field];
      items.push({ lane, kind: lane === 'async' ? 'br_async' : lane === 'after' ? 'br_after' : 'br_before', name: b.name ?? '?', table: 'sys_script', ...(b.sys_id ? { sysId: b.sys_id } : {}), on: b.collection ?? '', order: Number(b.order ?? 100), when, values: tv !== undefined ? [tv] : lits(b.script) });
      continue;
    }
    const si = siWriters.find((x) => x.name && (b.script ?? '').includes(x.name));
    if (si) items.push({ lane, kind: 'br_via_script_include', name: `${b.name} → ${si.name}`, table: 'sys_script_include', ...(si.sys_id ? { sysId: si.sys_id } : {}), on: b.collection ?? '', order: Number(b.order ?? 100), when, values: lits(si.script) });
  }
  for (const r of rules) {
    const v = field === 'assignment_group' ? r.group : r.user;
    if (!v) continue;
    items.push({ lane: 'before', kind: 'assignment_rule', name: r.name ?? '?', table: 'sysrule_assignment', ...(r.sys_id ? { sysId: r.sys_id } : {}), on: r.table ?? '', order: Number(r.order ?? 100), when: `${short(humanQuery(r.condition)) || 'sempre'} · com o campo vazio`, values: [v] });
  }
  for (const u of uas) {
    if (!writes(u.script)) continue;
    items.push({ lane: 'other', kind: 'ui_action', name: u.name ?? '?', table: 'sys_ui_action', ...(u.sys_id ? { sysId: u.sys_id } : {}), on: u.table ?? '', order: Number(u.order ?? 100), when: `botão${u.condition ? ` · ${short(u.condition)}` : ''}`, values: lits(u.script) });
  }
  for (const j of jobs) {
    if (!writes(j.script) && !new RegExp(`setValue\\(\\s*['"]${field}['"]`).test(j.script ?? '')) continue;
    items.push({ lane: 'other', kind: 'scheduled_job', name: j.name ?? '?', table: 'sysauto_script', ...(j.sys_id ? { sysId: j.sys_id } : {}), order: 0, when: `${j.run_type ?? ''}${j.run_time ? ` ${j.run_time.slice(11, 16)}` : ''}`.trim(), values: lits(j.script) });
  }
  const maps = new Map<string, Row>();
  for (const e of entries) if (e.map && !maps.has(e.map)) maps.set(e.map, e);
  for (const [id, e] of maps) items.push({ lane: 'other', kind: 'import_set', name: e['map.name'] || 'Transform map', table: 'sys_transform_map', sysId: id, on: e.target_table ?? '', order: 0, when: e.use_source_script === 'true' ? 'importação (valor calculado por script)' : `importação (de ${e.source_field ?? '?'})`, values: [] });
  // Flows com gatilho de registro nesta tabela cujos passos gravam o campo.
  for (const t of triggers) {
    const inputs = (await decodeFlowValues(t.trigger_inputs)) ?? [];
    const pick = (n: string) => inputs.find((x) => x.name === n)?.value ?? '';
    if (!tables.includes(pick('table'))) continue;
    const acts = t.flow ? await q('sys_hub_action_instance_v2', `flow=${t.flow}^ORDERBYorder`, ['order', 'values'], 50) : [];
    const vals: string[] = [];
    let hit = false;
    for (const a of acts) {
      const ps = (await decodeFlowValues(a.values)) ?? [];
      const w = parseFieldValues(ps.find((x) => x.name === 'values')?.value || ps.find((x) => x.name === 'fields')?.value);
      if (field in w) { hit = true; if (!w[field]!.includes('{{')) vals.push(w[field]!); }
    }
    if (hit) items.push({ lane: 'async', kind: 'flow', name: t['flow.name'] || 'Flow', table: 'sys_hub_flow', ...(t.flow ? { sysId: t.flow } : {}), on: pick('table'), order: 0, when: `${t.trigger_type ?? ''}${pick('condition') ? ` · ${short(humanQuery(pick('condition')))}` : ''}`, values: vals });
  }
  const laneOrder: Record<MapLane, number> = { client: 0, before: 1, after: 2, async: 3, other: 4 };
  items.sort((a, b) => laneOrder[a.lane] - laneOrder[b.lane] || a.order - b.order || a.name.localeCompare(b.name));
  return { table, field, tables, items, timing: { totalMs: Date.now() - started, calls: client.calls - calls0 } };
}
