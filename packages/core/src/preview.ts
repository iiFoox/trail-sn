/**
 * "E se eu mudar?": simula o que o ServiceNow vai rodar se um campo do registro mudar para um valor novo.
 * Lê as mesmas regras que a investigação lê (client scripts, UI policies, data lookups, BRs, regras de atribuição,
 * flows) e avalia as condições com o registro como ficaria, na ordem de execução:
 *   navegador (onChange, UI policies) → antes de gravar (BRs before em ordem, atribuição) → depois de gravar (BRs after)
 *   → em segundo plano (BRs async, flows).
 * Só leitura: nada é gravado. É uma previsão: trechos que não sabemos avaliar viram "pode rodar".
 */
import type { RestClient } from './client/RestClient';
import { writtenFields } from './conflicts';
import { evalExpr, scriptVerdict, type Env } from './scriptEval';
import { conditionFields, decodeFlowValues, evalCondition, isDynamicFlowValue, parseFieldValues, sameVal } from './util';
import type { Row } from './types';
import { resolveDisplay } from './display';

export type PreviewPhase = 'client' | 'before' | 'after' | 'async';
export type PreviewWill = 'yes' | 'maybe';

export interface PreviewWrite { field: string; value?: string }
export interface PreviewStep {
  phase: PreviewPhase;
  kind: 'client_script' | 'ui_policy' | 'data_lookup' | 'br_before' | 'br_after' | 'br_async' | 'assignment_rule' | 'flow';
  name: string;
  table: string;
  sysId?: string;
  order: number;
  will: PreviewWill;
  /** A regra só roda por causa desta mudança (reage ao campo ou a algo que ele causou). */
  reacts: boolean;
  writes: PreviewWrite[];
  /** Grava de novo o registro depois de salvo (current.update() numa BR after/async): começa outra gravação. */
  updatesAgain?: boolean;
  why: string;
}
export interface ChangePreview {
  table: string;
  sysId: string;
  field: string;
  from: string;
  to: string;
  steps: PreviewStep[];
  /** Como o registro ficaria (campos que a previsão sabe calcular). */
  result: Record<string, { from: string; to: string; by: string }>;
  /** Automações que talvez rodem (condição que não deu para avaliar): mostradas à parte, sem entrar no resultado. */
  uncertain: PreviewStep[];
  /** Regras que citam o campo mas não rodam com este valor (para o "por que não"). */
  skipped: { kind: PreviewStep['kind']; name: string; why: string }[];
  /** Rótulo de cada campo citado, como no formulário. */
  fieldLabels?: Record<string, string>;
  /** Texto de cada valor, por campo (choice ou nome do registro referenciado). */
  valueLabels?: Record<string, Record<string, string>>;
  /** Campos de referência citados e a tabela de cada um (os valores viram links). */
  refTables?: Record<string, string>;
  timing: { totalMs: number; calls: number };
}

type Q = (table: string, query: string, fields: string[], limit: number) => Promise<Row[]>;

export async function previewChange(client: RestClient, target: { table: string; sysId: string; field: string; value: string; language?: string; user?: { name?: string; sysId?: string } }): Promise<ChangePreview> {
  const started = Date.now();
  const calls0 = client.calls;
  const q: Q = async (t, query, fields, limit) => { try { return (await client.query({ table: t, query, fields, limit })).rows; } catch { return []; } };
  const { table, sysId, field, value } = target;

  const tables: string[] = [];
  let cur: string | undefined = table;
  for (let i = 0; cur && i < 10; i++) {
    tables.push(cur);
    cur = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1))[0]?.['super_class.name'] || undefined;
  }
  const inT = `IN${tables.join(',')}`;
  const [recRows, brs, cs, pols, lookups, rules, triggers] = await Promise.all([
    q(table, `sys_id=${sysId}`, [], 1),
    q('sys_script', `collection${inT}^active=true^action_update=true`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition'], 1000),
    q('sys_script_client', `table${inT}^active=true^type=onChange`, ['sys_id', 'name', 'field', 'table', 'script', 'ui_type'], 500),
    q('sys_ui_policy', `table${inT}^active=true`, ['sys_id', 'short_description', 'table', 'conditions', 'run_scripts', 'script_true', 'script_false', 'reverse_if_false', 'ui_type', 'order'], 300),
    q('dl_definition_rel_match', `source_table_field=${field}^dl_definition.active=true^dl_definition.source_table${inT}`, ['dl_definition', 'dl_definition.name', 'dl_definition.run_on_form_change', 'dl_definition.run_on_update'], 20),
    q('sysrule_assignment', `active=true^table${inT}`, ['sys_id', 'name', 'table', 'condition', 'group', 'user', 'order'], 100),
    q('sys_hub_trigger_instance_v2', `trigger_typeINrecord_update,record_create_or_update^flow.active=true^flow.sys_class_name=sys_hub_flow`, ['flow', 'flow.name', 'trigger_type', 'trigger_inputs'], 200),
  ]);
  const record: Record<string, string> = { ...(recRows[0] ?? {}), sys_id: sysId };
  const from = record[field] ?? '';

  // Estado que vai sendo construído: cada etapa vê o que as anteriores deixaram.
  const rec: Record<string, string> = { ...record, [field]: value };
  const changed = new Set<string>([field]);
  let mirror = '';
  // No incidente, incident_state acompanha state (o ServiceNow mantém os dois iguais); regras padrão leem incident_state.
  if (tables.includes('incident') && (field === 'state' || field === 'incident_state') && ('incident_state' in record || 'state' in record)) {
    const twin = field === 'state' ? 'incident_state' : 'state';
    rec[twin] = value; changed.add(twin); mirror = twin;
  }
  const by: Record<string, string> = { [field]: 'você' };
  const steps: PreviewStep[] = [];
  const skipped: ChangePreview['skipped'] = [];
  const env = (extra: Partial<Env> = {}): Env => ({ rec, old: record, changed, ...(target.user ? { user: target.user } : {}), ...extra });
  // Só entra o que tem efeito: uma gravação que muda o valor (ou calcula um valor na hora, numa regra que com certeza roda).
  // Regras que gravariam o mesmo valor que já está lá não mudam nada e ficam de fora. O que não dá para confirmar
  // (condição que não sabemos avaliar) vai para `uncertain`, separado.
  const uncertain: PreviewStep[] = [];
  const apply = (s: PreviewStep) => {
    const writes = s.writes.filter((w) => w.value === undefined ? s.will === 'yes' : !sameVal(rec[w.field] ?? '', w.value));
    const eff = { ...s, writes };
    if (s.kind !== 'flow' && !writes.length) return;
    if (s.will !== 'yes') { uncertain.push(eff); return; }
    steps.push(eff);
    for (const w of writes) {
      if (w.value !== undefined) { rec[w.field] = w.value; changed.add(w.field); }
      else changed.add(w.field);
      by[w.field] = s.name;
    }
  };
  const writesOfScript = (script: string | undefined, template: string | undefined, e: Env): { writes: PreviewWrite[]; unknown: boolean; anyReachable: boolean } => {
    const out: PreviewWrite[] = [];
    let unknown = false, anyReachable = false;
    const tpl = parseFieldValues(template);
    for (const [f, v] of Object.entries(tpl)) { out.push({ field: f, value: v }); anyReachable = true; }
    for (const f of writtenFields(script)) {
      if (f in tpl) continue;
      const v = scriptVerdict(script, f, e);
      if (!v || !v.writes || v.reachable === false) continue;
      anyReachable = true;
      if (!v.guardsTrue) unknown = true;
      const known = v.values.filter((x): x is string => x !== undefined);
      out.push(known.length === 1 && v.values.length === 1 ? { field: f, value: known[0] } : { field: f });
    }
    return { writes: out, unknown, anyReachable };
  };
  const cond = (encoded: string | undefined): boolean | undefined => evalCondition(encoded, rec, undefined, { set: changed, old: record });
  const reactsTo = (texts: (string | undefined)[], encoded?: string) =>
    conditionFields(encoded).some((f) => changed.has(f)) || /VALCHANGES|CHANGESTO|CHANGESFROM/.test(encoded ?? '') && [...changed].some((f) => (encoded ?? '').includes(f))
    || texts.some((t) => [...changed].some((f) => new RegExp(`current\\.${f}\\.changes|g_form\\.getValue\\(\\s*['"]${f}['"]|current\\.${f}\\b`).test(t ?? '')));

  // Data lookups: busca a linha da tabela do lookup que casa com os valores novos e diz o que ela grava.
  const lookupIds = [...new Set(lookups.map((d) => d.dl_definition ?? '').filter(Boolean))];
  const [lkMatch, lkSet] = lookupIds.length ? await Promise.all([
    q('dl_definition_rel_match', `dl_definitionIN${lookupIds.join(',')}`, ['dl_definition', 'source_table_field', 'matcher_table_field', 'exact_match'], 50),
    q('dl_definition_rel_set', `dl_definitionIN${lookupIds.join(',')}`, ['dl_definition', 'source_table_field', 'matcher_table_field', 'dl_definition.matcher_table'], 50),
  ]) : [[], []];
  const lookupWrites = async (id: string): Promise<{ writes: PreviewWrite[]; sure: boolean }> => {
    const sets = lkSet.filter((x) => x.dl_definition === id);
    const mt = sets[0]?.['dl_definition.matcher_table'];
    const match = lkMatch.filter((x) => x.dl_definition === id);
    if (!mt || !sets.length || !match.length || match.some((m) => !((m.source_table_field ?? '') in rec))) return { writes: sets.map((x) => ({ field: x.source_table_field ?? '' })), sure: false };
    const query = ['active=true', ...match.map((m) => `${m.matcher_table_field || m.source_table_field}=${rec[m.source_table_field ?? ''] ?? ''}`)].join('^');
    const row = (await q(mt, query, sets.map((x) => x.matcher_table_field || x.source_table_field || ''), 1))[0];
    if (!row) return { writes: [], sure: true };
    return { writes: sets.map((x) => ({ field: x.source_table_field ?? '', value: row[x.matcher_table_field || x.source_table_field || ''] ?? '' })), sure: true };
  };

  // ---------- navegador ----------
  const clientRound = (fields: string[]) => {
    for (const f of fields) {
      for (const c of cs.filter((x) => x.field === f && x.ui_type !== '1')) {
        const e = env({ newValue: rec[f] ?? '', oldValue: record[f] ?? '' });
        const w = writesOfScript(c.script, undefined, e);
        if (!w.anyReachable) { if (w.writes.length === 0 && writtenFields(c.script).length) skipped.push({ kind: 'client_script', name: c.name ?? '?', why: 'a condição do script não vale com este valor' }); continue; }
        apply({ phase: 'client', kind: 'client_script', name: c.name ?? '?', table: 'sys_script_client', ...(c.sys_id ? { sysId: c.sys_id } : {}), order: 0, will: w.unknown ? 'maybe' : 'yes', reacts: true, writes: w.writes, why: `roda no navegador quando "${f}" muda` });
      }
    }
  };
  clientRound([field]);
  // Um client script que muda outro campo dispara o onChange desse campo (um nível a mais).
  clientRound(steps.filter((s) => s.phase === 'client').flatMap((s) => s.writes.map((w) => w.field)).filter((f) => f !== field));

  for (const p of pols.filter((x) => x.ui_type !== '1')) {
    if (!conditionFields(p.conditions).some((f) => changed.has(f))) continue;
    const before = evalCondition(p.conditions, record);
    const now = cond(p.conditions);
    if (now === before && now !== undefined) continue; // a condição não muda: a política não reage
    const script = now === true ? p.script_true : now === false && p.reverse_if_false !== 'false' ? p.script_false : undefined;
    if (p.run_scripts !== 'true' || !script) continue;
    const w = writesOfScript(script, undefined, env());
    if (!w.writes.length) continue;
    apply({ phase: 'client', kind: 'ui_policy', name: p.short_description ?? '?', table: 'sys_ui_policy', ...(p.sys_id ? { sysId: p.sys_id } : {}), order: Number(p.order ?? 100), will: now === undefined || w.unknown ? 'maybe' : 'yes', reacts: true, writes: w.writes, why: now === false ? 'a condição deixa de valer e o script do "senão" roda' : 'a condição passa a valer e o script roda' });
  }
  for (const d of lookups) {
    const name = d['dl_definition.name'] || 'Data lookup';
    if (d['dl_definition.run_on_form_change'] !== 'true') continue;
    const w = await lookupWrites(d.dl_definition ?? '');
    const effective = w.writes.filter((x) => x.value === undefined || !sameVal(rec[x.field] ?? '', x.value));
    if (w.sure && !effective.length) continue;
    apply({ phase: 'client', kind: 'data_lookup', name, table: 'dl_definition', ...(d.dl_definition ? { sysId: d.dl_definition } : {}), order: 0, will: w.sure ? 'yes' : 'maybe', reacts: true, writes: effective, why: `"${field}" é entrada do lookup: recalcula no formulário` });
  }

  // ---------- servidor ----------
  const server = (when: 'before' | 'after' | 'async') => {
    const list = brs.filter((b) => (when === 'async' ? (b.when ?? '').startsWith('async') : b.when === when)).sort((a, b) => Number(a.order ?? 100) - Number(b.order ?? 100));
    for (const b of list) {
      const f = cond(b.filter_condition);
      const e = env();
      const c = b.condition?.trim() ? evalExpr(b.condition, e) : true;
      const name = b.name ?? '?';
      const touches = writtenFields(b.script, b.template).length > 0;
      const mentions = [...changed].some((x) => (b.script ?? '').includes(x) || (b.condition ?? '').includes(x) || (b.filter_condition ?? '').includes(x));
      if (f === false || c === false || c === '' || c === 0) { if (mentions && touches) skipped.push({ kind: `br_${when}` as PreviewStep['kind'], name, why: f === false ? 'o filtro da regra não vale com este valor' : 'a condição da regra não vale com este valor' }); continue; }
      if (!touches) continue;
      const w = writesOfScript(b.script, b.template, e);
      if (!w.anyReachable) { if (mentions) skipped.push({ kind: `br_${when}` as PreviewStep['kind'], name, why: 'o trecho que grava depende de uma condição que não vale' }); continue; }
      const reacts = reactsTo([b.script, b.condition], b.filter_condition);
      // Regra que roda em qualquer gravação e não depende do que mudou não é efeito desta mudança: fica de fora.
      if (!reacts) continue;
      const effective = w.writes;
      const maybe = f === undefined && !!b.filter_condition || c === undefined || w.unknown;
      apply({ phase: when, kind: `br_${when}` as PreviewStep['kind'], name, table: 'sys_script', ...(b.sys_id ? { sysId: b.sys_id } : {}), order: Number(b.order ?? 100), will: maybe ? 'maybe' : 'yes', reacts, writes: reacts ? w.writes : effective,
        ...(when !== 'before' && /\.update\(\s*\)/.test(b.script ?? '') ? { updatesAgain: true } : {}),
        why: `reage à mudança de ${[...changed].filter((x) => (b.script ?? '').includes(x) || (b.filter_condition ?? '').includes(x) || (b.condition ?? '').includes(x)).join(', ') || field}` });
    }
  };
  server('before');
  // Regras de atribuição: quando a condição passa a valer e o grupo/responsável está vazio.
  for (const r of rules.sort((a, b) => Number(a.order ?? 100) - Number(b.order ?? 100))) {
    if (!conditionFields(r.condition).some((f) => changed.has(f))) continue;
    if ((r.group && rec.assignment_group) || (r.user && rec.assigned_to)) continue;
    const ok = cond(r.condition);
    if (ok === false) { skipped.push({ kind: 'assignment_rule', name: r.name ?? '?', why: 'a condição da regra não vale com este valor' }); continue; }
    const writes: PreviewWrite[] = [...(r.group ? [{ field: 'assignment_group', value: r.group }] : []), ...(r.user ? [{ field: 'assigned_to', value: r.user }] : [])];
    apply({ phase: 'before', kind: 'assignment_rule', name: r.name ?? '?', table: 'sysrule_assignment', ...(r.sys_id ? { sysId: r.sys_id } : {}), order: Number(r.order ?? 100), will: ok ? 'yes' : 'maybe', reacts: true, writes, why: 'atribui quando a condição vale e o campo está vazio' });
  }
  for (const d of lookups) {
    if (d['dl_definition.run_on_update'] !== 'true') continue;
    const w = await lookupWrites(d.dl_definition ?? '');
    const effective = w.writes.filter((x) => x.value === undefined || !sameVal(rec[x.field] ?? '', x.value));
    if (w.sure && !effective.length) continue; // o formulário já recalculou: ao gravar não muda nada
    apply({ phase: 'before', kind: 'data_lookup', name: d['dl_definition.name'] || 'Data lookup', table: 'dl_definition', ...(d.dl_definition ? { sysId: d.dl_definition } : {}), order: 0, will: w.sure ? 'yes' : 'maybe', reacts: true, writes: effective, why: `"${field}" é entrada do lookup: recalcula ao gravar` });
  }
  server('after');
  server('async');

  // ---------- flows com gatilho "atualizado" nesta tabela ----------
  for (const t of triggers) {
    const inputs = (await decodeFlowValues(t.trigger_inputs)) ?? [];
    const pick = (n: string) => inputs.find((x) => x.name === n)?.value ?? '';
    if (!tables.includes(pick('table'))) continue;
    const c = pick('condition');
    const ok = c ? cond(c) : undefined;
    if (ok === false) continue;
    const reacts = !!c && conditionFields(c).some((f) => changed.has(f));
    // Só interessa o flow que passa a disparar por causa desta mudança; os que rodam em toda atualização não são efeito dela.
    if (!reacts || evalCondition(c, record) === true) continue; // já valia antes: não é efeito desta mudança
    const acts = t.flow ? await q('sys_hub_action_instance_v2', `flow=${t.flow}^ORDERBYorder`, ['order', 'values', 'action_type.name'], 50) : [];
    const writes: PreviewWrite[] = [];
    for (const a of acts) {
      const params = (await decodeFlowValues(a.values)) ?? [];
      const pick = (n: string) => params.find((x) => x.name === n)?.value ?? '';
      const tb = pick('table_name');
      if (tb && !tables.includes(tb)) continue;
      for (const [f, v] of Object.entries(parseFieldValues(pick('values') || pick('fields')))) writes.push(isDynamicFlowValue(v) ? { field: f } : { field: f, value: v });
    }
    apply({ phase: 'async', kind: 'flow', name: t['flow.name'] || 'Flow', table: 'sys_hub_flow', ...(t.flow ? { sysId: t.flow } : {}), order: 0, will: ok ? 'yes' : 'maybe', reacts, writes, why: 'o gatilho do flow passa a valer com este valor' });
  }

  const result: ChangePreview['result'] = {};
  for (const f of changed) if (f !== mirror) result[f] = { from: record[f] ?? '', to: f in rec && (by[f] === 'você' || steps.some((x) => x.writes.some((w) => w.field === f && w.value !== undefined))) ? rec[f] ?? '' : '\u0000calc', by: by[f] ?? '?' };
  // Nomes como no formulário: rótulo de cada campo citado e o texto de cada valor (choice ou registro referenciado).
  const wanted: Record<string, (string | undefined)[]> = { [field]: [from, value] };
  for (const [f, x] of Object.entries(result)) (wanted[f] ??= []).push(x.from, x.to);
  for (const st of [...steps, ...uncertain]) for (const w of st.writes) (wanted[w.field] ??= []).push(w.value);
  const names = await resolveDisplay(q, tables, wanted, target.language);
  const fieldLabels = names.fields, valueLabels = names.values, refTables = names.refs;
  return { table, sysId, field, from, to: value, steps, uncertain, result, skipped, fieldLabels, valueLabels, refTables, timing: { totalMs: Date.now() - started, calls: client.calls - calls0 } };
}
