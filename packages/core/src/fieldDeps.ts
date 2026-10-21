/**
 * Mapa do campo, parte 2: "Quem depende" (raio de impacto) e "Simular um valor".
 *
 * "Quem grava" (`fieldMap`) responde o que pode MUDAR o campo. "Quem depende" responde o contrário: o que LÊ o campo ou
 * REAGE a ele — regras cuja condição usa o campo, scripts que leem o valor, client scripts do onChange, UI e data
 * policies condicionadas, flows, notificações, SLAs, regras de atribuição, data lookups que usam o campo como entrada,
 * botões que aparecem conforme o campo e (para "o registro", sys_id) as tabelas que apontam para esta.
 *
 * Não depende de um registro: é o desenho da instância. Só GET; cada fonte é opcional. Fonte negada ou lenta não vira
 * "nada depende": entra em `denied`/`slow` e o resultado diz quais tipos ficaram sem ver (`notSeen`).
 *
 * "Simular um valor" (`simulateValue`) reaproveita `previewChange` (o antigo "E se?") para os passos que GRAVAM campos e
 * junta os dependentes que reagem sem gravar (notificação enviada, SLA que começa, policy que esconde outro campo...).
 */
import type { RestClient } from './client/RestClient';
import { writtenFields } from './conflicts';
import { fieldMap, sharedQueries, tableHierarchy, type MapItem } from './fieldMap';
import { previewChange, type ChangePreview, type PreviewStep, type PreviewWrite } from './preview';
import { evalExpr, fieldsRead, type Env } from './scriptEval';
import { SharedClient, shared } from './sharedClient';
import type { AccessState, Row } from './types';
import { assignedLiterals, decodeFlowValues, escapeRegExp, evalCondition, humanQuery, parseFieldValues } from './util';
import { resolveDisplay } from './display';

// ---------------------------------------------------------------- tipos

/** Fase em que roda, na ordem do ServiceNow: navegador → antes de gravar → depois → segundo plano → outro. */
export type DepPhase = 'client' | 'before' | 'after' | 'async' | 'other';
export const DEP_PHASES: DepPhase[] = ['client', 'before', 'after', 'async', 'other'];

export type DepKind =
  | 'client_script' | 'ui_policy' | 'data_lookup'
  | 'br_before' | 'br_after' | 'br_async' | 'br_display' | 'br_via_script_include'
  | 'data_policy' | 'assignment_rule' | 'sla' | 'notification' | 'flow' | 'ui_action' | 'reference';

/** Como depende do campo. O texto em PT/EN sai de `describeDependent`. */
export type DepHowCode =
  | 'condition' // a condição (filtro) usa o campo
  | 'changes' // dispara quando o campo muda (VALCHANGES)
  | 'changes_to' // dispara quando o campo muda para um valor (CHANGESTO)
  | 'changes_from' // dispara quando o campo deixa de ser um valor (CHANGESFROM)
  | 'script_condition' // a condição em script lê o campo
  | 'script_reads' // o script lê o campo
  | 'script_changes' // o script testa se o campo mudou (current.x.changes())
  | 'onchange' // client script onChange do campo
  | 'form_reads' // script do formulário lê o campo (g_form.getValue)
  | 'dotwalk' // a condição usa um campo do registro apontado (campo.outro)
  | 'lookup_input' // o campo é entrada de um data lookup
  | 'flow_step' // um passo do flow usa o valor do campo
  | 'via_script_include' // a regra chama um script include que lê o campo
  | 'sla_start' | 'sla_pause' | 'sla_resume' | 'sla_stop' | 'sla_reset' | 'sla_cancel'
  | 'references'; // outra tabela tem uma referência para esta

export interface DepHow { code: DepHowCode; /** Valor (CHANGESTO), condição em texto, nome do script include, campo dot-walk. */ detail?: string }

export type SlaStage = 'start' | 'pause' | 'resume' | 'stop' | 'reset' | 'cancel';

/** O que o dependente faz (quando dá para saber pelo desenho). */
export type DepEffect =
  | { type: 'write'; field: string; value?: string }
  | { type: 'form'; field: string; aspect: 'read_only' | 'mandatory' | 'hidden'; sets?: boolean }
  | { type: 'notify' }
  | { type: 'sla'; stage: SlaStage }
  | { type: 'abort' }
  | { type: 'event'; name: string }
  | { type: 'show' }; // o botão aparece (UI action)

export interface Dependent {
  phase: DepPhase;
  kind: DepKind;
  name: string;
  /** Tabela do artefato (para o link) e sys_id. */
  table: string;
  sysId?: string;
  /** Tabela da hierarquia onde foi definido (incident, task...). */
  on?: string;
  order: number;
  /** Quando roda, em texto curto (operação, filtro, condição). */
  when: string;
  how: DepHow[];
  does: DepEffect[];
  /** Em quais operações roda (regras, notificações, flows). Ausente = não se aplica. */
  ops?: { insert?: boolean; update?: boolean; delete?: boolean };
  /** Condições cruas, para o "Simular um valor". */
  cond?: string;
  jsCond?: string;
  /** SLA: condição de cada etapa que cita o campo. */
  stages?: { stage: SlaStage; cond: string }[];
  /** UI policy: desfaz as ações quando a condição deixa de valer. */
  reverse?: boolean;
  /** Client script: tipo (onChange, onLoad, onSubmit) e campo do onChange. */
  scriptType?: string;
  trigger?: string;
}

export interface FieldDeps {
  table: string;
  field: string;
  tables: string[];
  dependents: Dependent[];
  /** Incluiu "tabelas que apontam para esta" (sempre para sys_id; para outro campo, só se pedido). */
  references: boolean;
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  /** Tipos de dependente que não deu para ver (fonte principal negada ou lenta). */
  notSeen: DepKind[];
  /** Tipos em que se vê QUEM depende, mas não O QUE faz (fonte secundária negada ou lenta). */
  effectsUnknown: DepKind[];
  fieldLabels?: Record<string, string>;
  timing: { totalMs: number; calls: number };
}

/** Fonte → tipos que ela mostra. `main`: sem ela o tipo some; `detail`: sem ela falta o "o que faz". */
export const DEP_SOURCES: Record<string, { main: DepKind[]; detail: DepKind[] }> = {
  sys_script: { main: ['br_before', 'br_after', 'br_async', 'br_display', 'br_via_script_include'], detail: [] },
  sys_script_include: { main: ['br_via_script_include'], detail: [] },
  sys_script_client: { main: ['client_script'], detail: [] },
  sys_ui_policy: { main: ['ui_policy'], detail: [] },
  sys_ui_policy_action: { main: [], detail: ['ui_policy'] },
  sys_data_policy2: { main: ['data_policy'], detail: [] },
  sys_data_policy_rule: { main: [], detail: ['data_policy'] },
  dl_definition_rel_match: { main: ['data_lookup'], detail: [] },
  dl_definition_rel_set: { main: [], detail: ['data_lookup'] },
  sys_ui_action: { main: ['ui_action'], detail: [] },
  sys_hub_trigger_instance_v2: { main: ['flow'], detail: [] },
  sys_hub_action_instance_v2: { main: [], detail: ['flow'] },
  sysevent_email_action: { main: ['notification'], detail: [] },
  contract_sla: { main: ['sla'], detail: [] },
  sysrule_assignment: { main: ['assignment_rule'], detail: [] },
  sys_dictionary: { main: ['reference'], detail: [] },
};

// ---------------------------------------------------------------- leitura de condições e scripts

const SLA_COLS: [SlaStage, string][] = [['start', 'start_condition'], ['pause', 'pause_condition'], ['resume', 'resume_condition'], ['stop', 'stop_condition'], ['reset', 'reset_condition'], ['cancel', 'cancel_condition']];

/** Como uma encoded query usa o campo: termos diretos, VALCHANGES/CHANGESTO/CHANGESFROM e dot-walk (campo.outro). */
export function conditionUses(cond: string | undefined, field: string): DepHow[] {
  if (!cond) return [];
  const out: DepHow[] = [];
  const f = escapeRegExp(field);
  for (const raw of cond.split('^')) {
    const t = raw.replace(/^(?:OR|NQ)(?=[a-z])/, '');
    if (!t || t === 'EQ' || t.startsWith('ORDERBY')) continue;
    const ch = t.match(new RegExp(`^${f}(VALCHANGES|CHANGESTO|CHANGESFROM)(.*)$`));
    if (ch) { out.push(ch[1] === 'VALCHANGES' ? { code: 'changes' } : { code: ch[1] === 'CHANGESTO' ? 'changes_to' : 'changes_from', detail: ch[2] ?? '' }); continue; }
    const dw = t.match(new RegExp(`^${f}\\.([a-z0-9_.]+?)(?=[A-Z=!<>]|$)`));
    if (dw) { out.push({ code: 'dotwalk', detail: `${field}.${dw[1]}` }); continue; }
    if (new RegExp(`^${f}(?![a-z0-9_.])`).test(t)) out.push({ code: 'condition' });
  }
  // Um "condition" por condição basta; os de mudança e dot-walk ficam todos.
  const seen = new Set<string>();
  return out.filter((h) => { const k = `${h.code}|${h.detail ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** O script do servidor lê o campo? Gravar (`current.x = ...`) não conta como leitura. */
export function serverReads(script: string | undefined, field: string, opts: { anyRecord?: boolean } = {}): { reads: boolean; changes: boolean } {
  if (!script) return { reads: false, changes: false };
  const f = escapeRegExp(field);
  // Script include recebe o registro como parâmetro (gr, record...): qualquer objeto vale, não só current.
  const obj = opts.anyRecord ? '[A-Za-z_$][\\w$]*' : '(?:current|previous)';
  const changes = new RegExp(`\\b${obj}\\.${f}\\.changes(?:To|From)?\\(`).test(script);
  const stripped = script.replace(new RegExp(`\\b${obj}\\.${f}\\s*=(?!=)`, 'g'), ' ');
  const reads = changes || fieldsRead(stripped).includes(field)
    || (!!opts.anyRecord && new RegExp(`\\b(?!this\\b)${obj}\\.${f}\\b(?!\\s*\\()`).test(stripped))
    || new RegExp(`\\.(?:getValue|getDisplayValue|getElement)\\(\\s*['"]${f}['"]`).test(stripped);
  return { reads, changes };
}

/** Script do formulário lê o campo (g_form.getValue('x') e afins)? */
export function formReads(script: string | undefined, field: string): boolean {
  if (!script) return false;
  return new RegExp(`g_form\\.(?:getValue|getReference|getDisplayValue|getBooleanValue|getIntValue|getDecimalValue|getDisplayBox|getElement)\\(\\s*['"]${escapeRegExp(field)}['"]`).test(script);
}

const FORM_CALL = /g_form\.(setReadOnly|setReadonly|setDisabled|setMandatory|setDisplay|setVisible)\(\s*(['"])([a-z0-9_.]+)\2\s*,\s*(true|false|1|0)?/g;

/** O que um script grava (campos, valor literal quando é um só), mexe no formulário, aborta ou dispara. */
export function scriptEffects(script: string | undefined, template?: string, opts: { except?: string } = {}): DepEffect[] {
  const out: DepEffect[] = [];
  const tpl = parseFieldValues(template);
  for (const f of writtenFields(script, template)) {
    if (f === opts.except) continue;
    const lits = f in tpl ? [tpl[f]!] : assignedLiterals(script, f);
    out.push(lits && new Set(lits).size === 1 ? { type: 'write', field: f, value: lits[0]! } : { type: 'write', field: f });
  }
  const seen = new Set<string>();
  for (const m of (script ?? '').matchAll(FORM_CALL)) {
    const aspect = /ReadOnly|Readonly|Disabled/.test(m[1]!) ? 'read_only' as const : m[1] === 'setMandatory' ? 'mandatory' as const : 'hidden' as const;
    const b = m[4] === undefined ? undefined : m[4] === 'true' || m[4] === '1';
    const sets = b === undefined ? undefined : aspect === 'hidden' ? !b : b;
    const k = `${m[3]}|${aspect}|${sets}`;
    if (seen.has(k) || m[3] === opts.except) continue;
    seen.add(k);
    out.push(sets === undefined ? { type: 'form', field: m[3]!, aspect } : { type: 'form', field: m[3]!, aspect, sets });
  }
  if (/setAbortAction\(\s*true\s*\)/.test(script ?? '')) out.push({ type: 'abort' });
  for (const m of (script ?? '').matchAll(/gs\.eventQueue\(\s*(['"])([^'"]+)\1/g)) out.push({ type: 'event', name: m[2]! });
  return out;
}

const short = (s: string | undefined, n = 120) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const brLane = (when: string | undefined, query?: string): { phase: DepPhase; kind: DepKind } => {
  const w = when ?? '';
  if (w === 'display' || query === 'true') return { phase: 'other', kind: 'br_display' };
  if (w.startsWith('async')) return { phase: 'async', kind: 'br_async' };
  if (w === 'after') return { phase: 'after', kind: 'br_after' };
  if (w === 'before') return { phase: 'before', kind: 'br_before' };
  return { phase: 'other', kind: 'br_after' };
};
const PHASE_ORDER: Record<DepPhase, number> = { client: 0, before: 1, after: 2, async: 3, other: 4 };
/** Dentro da mesma fase e ordem, o tipo que o ServiceNow roda primeiro. */
const KIND_ORDER: Record<DepKind, number> = { client_script: 0, ui_policy: 1, data_lookup: 2, br_display: 0, br_before: 0, br_via_script_include: 0, assignment_rule: 1, data_policy: 2, br_after: 0, sla: 1, br_async: 0, notification: 1, flow: 2, ui_action: 0, reference: 1 };
export const sortDependents = <T extends { phase: DepPhase; kind: DepKind | PreviewStep['kind']; order: number; name: string }>(list: T[]): T[] =>
  list.sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.order - b.order || (KIND_ORDER[a.kind as DepKind] ?? 0) - (KIND_ORDER[b.kind as DepKind] ?? 0) || a.name.localeCompare(b.name));

// ---------------------------------------------------------------- "Quem depende"

export interface FieldDepsOptions {
  /** Inclui as tabelas que apontam para esta (sys_dictionary). Padrão: só quando o campo é sys_id ("o registro"). */
  references?: boolean;
  timeoutMs?: number;
  language?: string;
}

export async function fieldDeps(client: RestClient, target: { table: string; field: string }, opts: FieldDepsOptions = {}): Promise<FieldDeps> {
  const started = Date.now();
  const sc = shared(client, opts.timeoutMs);
  const calls0 = sc.calls;
  const q = async (t: string, query: string, fields: string[], limit: number): Promise<Row[]> => (await sc.query({ table: t, query, fields, limit })).rows;
  const { table, field } = target;
  const tables = await tableHierarchy(q, table);
  const inT = `IN${tables.join(',')}`;
  const S = sharedQueries(tables, field);
  const run = (x: { table: string; query: string; fields: string[]; limit: number }) => q(x.table, x.query, x.fields, x.limit);
  const wantRefs = opts.references ?? field === 'sys_id';
  const slaLike = SLA_COLS.map(([, c]) => `${c}LIKE${field}`).join('^OR');

  const [brs, cs, pols, dps, lookups, uas, sis, rules, triggers, mails, slas, refs] = await Promise.all([
    run(S.businessRules),
    run(S.clientScripts),
    run(S.uiPolicies),
    q('sys_data_policy2', `model_table${inT}^active=true^conditionsLIKE${field}`, ['sys_id', 'short_description', 'model_table', 'conditions', 'enforce_ui', 'inherit', 'reverse_if_false'], 200),
    q('dl_definition_rel_match', `source_table_field=${field}^dl_definition.active=true^dl_definition.source_table${inT}`, ['dl_definition', 'dl_definition.name', 'dl_definition.source_table', 'dl_definition.run_on_form_change', 'dl_definition.run_on_update'], 50),
    run(S.uiActions),
    run(S.scriptIncludes),
    run(S.assignmentRules),
    run(S.flowTriggers),
    q('sysevent_email_action', `collection${inT}^active=true^conditionLIKE${field}^ORadvanced_conditionLIKE${field}`, ['sys_id', 'name', 'collection', 'condition', 'advanced_condition', 'action_insert', 'action_update', 'generation_type', 'event_name', 'order'], 200),
    q('contract_sla', `collection${inT}^active=true^${slaLike}`, ['sys_id', 'name', 'collection', ...SLA_COLS.map(([, c]) => c)], 200),
    wantRefs ? q('sys_dictionary', `reference${inT}^active=true`, ['sys_id', 'name', 'element', 'column_label', 'reference'], 300) : Promise.resolve([] as Row[]),
  ]);

  const out: Dependent[] = [];
  const link = (t: string, id: string | undefined) => ({ table: t, ...(id ? { sysId: id } : {}) });
  const ops = (r: Row) => ({ insert: r.action_insert === 'true', update: r.action_update === 'true', delete: r.action_delete === 'true' });
  const opsText = (o: { insert?: boolean; update?: boolean; delete?: boolean }) => [o.insert ? 'insert' : '', o.update ? 'update' : '', o.delete ? 'delete' : ''].filter(Boolean).join('/');
  const blankCond = (c: string | undefined) => { const t = (c ?? '').trim(); return !t || t === 'EQ' || t === '^EQ'; };

  // ---------- navegador: client scripts ----------
  for (const c of cs) {
    if (c.ui_type === '1') continue; // só celular / portal
    const how: DepHow[] = [];
    const type = c.type ?? '';
    if ((type === 'onChange' || type === 'onCellEdit') && c.field === field) how.push({ code: 'onchange' });
    else if (formReads(c.script, field)) how.push({ code: 'form_reads' });
    if (!how.length) continue;
    const when = type === 'onChange' || type === 'onCellEdit' ? `${type} de ${c.field ?? '?'}` : type;
    out.push({ phase: 'client', kind: 'client_script', name: c.name ?? '?', ...link('sys_script_client', c.sys_id), on: c.table ?? '', order: 0, when, how,
      does: [...scriptEffects(c.script), ...(type === 'onSubmit' && /return\s+false/.test(c.script ?? '') ? [{ type: 'abort' } as DepEffect] : [])],
      scriptType: type, ...(c.field ? { trigger: c.field } : {}) });
  }

  // ---------- navegador: UI policies (condição com o campo, ou script que lê o campo) ----------
  const polHits = pols.filter((p) => p.ui_type !== '1').map((p) => {
    const how = conditionUses(p.conditions, field);
    if (p.run_scripts === 'true' && (formReads(p.script_true, field) || formReads(p.script_false, field))) how.push({ code: 'form_reads' });
    return { p, how };
  }).filter((x) => x.how.length);
  const polIds = polHits.map((x) => x.p.sys_id ?? '').filter(Boolean);
  const dpIds = dps.map((p) => p.sys_id ?? '').filter(Boolean);
  const lookupIds = [...new Set(lookups.map((d) => d.dl_definition ?? '').filter(Boolean))];
  const [polActions, dpRules, lookupSets] = await Promise.all([
    polIds.length ? q('sys_ui_policy_action', `ui_policyIN${polIds.join(',')}`, ['sys_id', 'ui_policy', 'field', 'disabled', 'mandatory', 'visible'], 1000) : Promise.resolve([] as Row[]),
    dpIds.length ? q('sys_data_policy_rule', `sys_data_policyIN${dpIds.join(',')}`, ['sys_id', 'sys_data_policy', 'field', 'mandatory', 'disabled', 'read_only'], 500) : Promise.resolve([] as Row[]),
    lookupIds.length ? q('dl_definition_rel_set', `dl_definitionIN${lookupIds.join(',')}`, ['dl_definition', 'source_table_field'], 100) : Promise.resolve([] as Row[]),
  ]);
  const truth = (v: string | undefined) => (v === 'true' ? true : v === 'false' ? false : undefined);
  for (const { p, how } of polHits) {
    const does: DepEffect[] = [];
    for (const a of polActions.filter((x) => x.ui_policy === p.sys_id)) {
      const ro = truth(a.disabled), md = truth(a.mandatory), vis = truth(a.visible);
      if (ro !== undefined) does.push({ type: 'form', field: a.field ?? '?', aspect: 'read_only', sets: ro });
      if (md !== undefined) does.push({ type: 'form', field: a.field ?? '?', aspect: 'mandatory', sets: md });
      if (vis !== undefined) does.push({ type: 'form', field: a.field ?? '?', aspect: 'hidden', sets: !vis });
    }
    if (p.run_scripts === 'true') does.push(...scriptEffects(p.script_true), ...scriptEffects(p.script_false).filter((e) => e.type === 'write'));
    out.push({ phase: 'client', kind: 'ui_policy', name: p.short_description || 'UI policy', ...link('sys_ui_policy', p.sys_id), on: p.table ?? '', order: Number(p.order || 100),
      when: short(humanQuery(p.conditions)) || 'sempre', how, does, ...(blankCond(p.conditions) ? {} : { cond: p.conditions! }), reverse: p.reverse_if_false !== 'false' });
  }

  // ---------- navegador / ao gravar: data lookups com o campo de entrada ----------
  for (const d of lookups) {
    const id = d.dl_definition ?? '';
    const onForm = d['dl_definition.run_on_form_change'] === 'true', onSave = d['dl_definition.run_on_update'] === 'true';
    if (!onForm && !onSave) continue;
    const sets = [...new Set(lookupSets.filter((x) => x.dl_definition === id).map((x) => x.source_table_field ?? '').filter(Boolean))];
    out.push({ phase: onForm ? 'client' : 'before', kind: 'data_lookup', name: d['dl_definition.name'] || 'Data lookup', ...link('dl_definition', id), on: d['dl_definition.source_table'] ?? '', order: 0,
      when: [onForm ? 'ao mudar no formulário' : '', onSave ? 'ao gravar' : ''].filter(Boolean).join(' e '), how: [{ code: 'lookup_input' }], does: sets.map((f) => ({ type: 'write', field: f })) });
  }

  // ---------- servidor: regras de negócio (e script includes chamados por elas) ----------
  const siReaders = sis.filter((s) => serverReads(s.script, field, { anyRecord: true }).reads);
  for (const b of brs) {
    const { phase, kind } = brLane(b.when, b.action_query);
    const how: DepHow[] = [...conditionUses(b.filter_condition, field)];
    const cr = serverReads(b.condition, field);
    if (cr.reads) how.push({ code: cr.changes ? 'script_changes' : 'script_condition' });
    const sr = serverReads(b.script, field);
    if (sr.reads) how.push({ code: sr.changes ? 'script_changes' : 'script_reads' });
    const o = ops(b);
    const when = [opsText(o), short(humanQuery(b.filter_condition)), short(b.condition)].filter(Boolean).join(' · ') || 'sempre';
    const common = { on: b.collection ?? '', order: Number(b.order ?? 100), when, ops: o, ...(blankCond(b.filter_condition) ? {} : { cond: b.filter_condition! }), ...(b.condition?.trim() ? { jsCond: b.condition } : {}) };
    if (how.length) {
      out.push({ phase, kind, name: b.name ?? '?', ...link('sys_script', b.sys_id), ...common, how, does: scriptEffects(b.script, b.template) });
      continue;
    }
    const si = siReaders.find((x) => x.name && new RegExp(`\\b${escapeRegExp(x.name)}\\b`).test(b.script ?? ''));
    if (si) out.push({ phase, kind: 'br_via_script_include', name: `${b.name ?? '?'} → ${si.name}`, ...link('sys_script_include', si.sys_id), ...common,
      how: [{ code: 'via_script_include', detail: si.name ?? '' }], does: [...scriptEffects(b.script, b.template), ...scriptEffects(si.script)] });
  }

  // ---------- antes de gravar: regras de atribuição e data policies ----------
  for (const r of rules) {
    const how = conditionUses(r.condition, field);
    if (!how.length) continue;
    const does: DepEffect[] = [...(r.group ? [{ type: 'write', field: 'assignment_group', value: r.group } as DepEffect] : []), ...(r.user ? [{ type: 'write', field: 'assigned_to', value: r.user } as DepEffect] : [])];
    out.push({ phase: 'before', kind: 'assignment_rule', name: r.name ?? '?', ...link('sysrule_assignment', r.sys_id), on: r.table ?? '', order: Number(r.order ?? 100),
      when: `${short(humanQuery(r.condition)) || 'sempre'} · com o grupo/responsável vazio`, how, does, cond: r.condition ?? '' });
  }
  for (const p of dps) {
    const how = conditionUses(p.conditions, field);
    if (!how.length) continue;
    const does: DepEffect[] = [];
    for (const r of dpRules.filter((x) => x.sys_data_policy === p.sys_id)) {
      const ro = truth(r.disabled) ?? truth(r.read_only), md = truth(r.mandatory);
      if (ro !== undefined) does.push({ type: 'form', field: r.field ?? '?', aspect: 'read_only', sets: ro });
      if (md !== undefined) does.push({ type: 'form', field: r.field ?? '?', aspect: 'mandatory', sets: md });
    }
    out.push({ phase: 'before', kind: 'data_policy', name: p.short_description || 'Data policy', ...link('sys_data_policy2', p.sys_id), on: p.model_table ?? '', order: 0,
      when: `${short(humanQuery(p.conditions))}${p.enforce_ui === 'false' ? ' · só ao gravar' : ' · no formulário e ao gravar'}`, how, does, cond: p.conditions ?? '' });
  }

  // ---------- depois de gravar: SLAs ----------
  for (const s of slas) {
    const stages = SLA_COLS.filter(([, c]) => conditionUses(s[c], field).length).map(([stage, c]) => ({ stage, cond: s[c] ?? '' }));
    if (!stages.length) continue;
    const how: DepHow[] = stages.map((x) => ({ code: `sla_${x.stage}` as DepHowCode, detail: short(humanQuery(x.cond)) }));
    out.push({ phase: 'after', kind: 'sla', name: s.name ?? '?', ...link('contract_sla', s.sys_id), on: s.collection ?? '', order: 1000,
      when: stages.map((x) => `${x.stage}: ${short(humanQuery(x.cond), 60)}`).join(' · '), how, does: stages.map((x) => ({ type: 'sla', stage: x.stage })), stages });
  }

  // ---------- segundo plano: notificações ----------
  for (const n of mails) {
    const how = conditionUses(n.condition, field);
    const ar = serverReads(n.advanced_condition, field);
    if (ar.reads) how.push({ code: ar.changes ? 'script_changes' : 'script_condition' });
    if (!how.length) continue;
    const o = { insert: n.action_insert === 'true', update: n.action_update === 'true' };
    const byEvent = n.generation_type === 'event';
    out.push({ phase: 'async', kind: 'notification', name: n.name ?? '?', ...link('sysevent_email_action', n.sys_id), on: n.collection ?? '', order: Number(n.order || 100),
      when: [byEvent ? `evento ${n.event_name ?? '?'}` : opsText(o), short(humanQuery(n.condition))].filter(Boolean).join(' · ') || 'sempre', how, does: [{ type: 'notify' }],
      ...(byEvent ? {} : { ops: o }), ...(blankCond(n.condition) ? {} : { cond: n.condition! }), ...(n.advanced_condition?.trim() ? { jsCond: n.advanced_condition } : {}) });
  }

  // ---------- segundo plano: flows com gatilho de registro nesta tabela ----------
  const pill = new RegExp(`\\{\\{[^}]*\\.${escapeRegExp(field)}\\}\\}`);
  for (const t of triggers) {
    const inputs = (await decodeFlowValues(t.trigger_inputs)) ?? [];
    const pick = (n: string) => inputs.find((x) => x.name === n)?.value ?? '';
    const on = pick('table');
    if (!tables.includes(on)) continue;
    const c = pick('condition');
    const how = conditionUses(c, field);
    const acts = t.flow ? await run(S.flowActions(t.flow)) : [];
    const does: DepEffect[] = [];
    let step = false;
    for (const a of acts) {
      if (pill.test(a.values ?? '')) step = true;
      const ps = (await decodeFlowValues(a.values)) ?? [];
      if (ps.some((x) => pill.test(x.value ?? ''))) step = true;
      const w = parseFieldValues(ps.find((x) => x.name === 'values')?.value || ps.find((x) => x.name === 'fields')?.value);
      for (const [f, v] of Object.entries(w)) does.push(v.includes('{{') ? { type: 'write', field: f } : { type: 'write', field: f, value: v });
    }
    if (step) how.push({ code: 'flow_step' });
    if (!how.length) continue;
    const tt = t.trigger_type ?? '';
    const o = { insert: /create/.test(tt), update: /update/.test(tt) };
    out.push({ phase: 'async', kind: 'flow', name: t['flow.name'] || 'Flow', ...link('sys_hub_flow', t.flow), on, order: 0,
      when: `${tt}${c ? ` · ${short(humanQuery(c))}` : ''}`, how, does, ops: o, ...(blankCond(c) ? {} : { cond: c }) });
  }

  // ---------- outro: botões que aparecem conforme o campo, ou cujo script lê o campo ----------
  for (const u of uas) {
    const how: DepHow[] = [];
    const cr = serverReads(u.condition, field);
    if (cr.reads) how.push({ code: 'script_condition' });
    if (serverReads(u.script, field).reads || formReads(u.script, field)) how.push({ code: 'script_reads' });
    if (!how.length) continue;
    out.push({ phase: 'other', kind: 'ui_action', name: u.name ?? '?', ...link('sys_ui_action', u.sys_id), on: u.table ?? '', order: Number(u.order ?? 100),
      when: `botão${u.condition ? ` · ${short(u.condition)}` : ''}`, how, does: [...(cr.reads ? [{ type: 'show' } as DepEffect] : []), ...scriptEffects(u.script)], ...(u.condition?.trim() ? { jsCond: u.condition } : {}) });
  }

  // ---------- outro: tabelas que apontam para esta ----------
  for (const r of refs) {
    if (!r.name || !r.element || r.name.startsWith('var__m_')) continue;
    out.push({ phase: 'other', kind: 'reference', name: `${r.name}.${r.element}`, ...link('sys_dictionary', r.sys_id), on: r.reference ?? '', order: 0,
      when: r.column_label ? `${r.column_label} (${r.name})` : r.name, how: [{ code: 'references', detail: r.reference ?? '' }], does: [] });
  }

  sortDependents(out);

  const denied = sc.denied(Object.keys(DEP_SOURCES));
  const slow = sc.slow(Object.keys(DEP_SOURCES));
  const blind = [...denied, ...slow];
  const notSeen = [...new Set(blind.flatMap((t) => DEP_SOURCES[t]?.main ?? []))].filter((k) => k !== 'reference' || wantRefs);
  const effectsUnknown = [...new Set(blind.flatMap((t) => DEP_SOURCES[t]?.detail ?? []))].filter((k) => !notSeen.includes(k));
  let fieldLabels: Record<string, string> | undefined;
  if (opts.language !== undefined) {
    const wanted: Record<string, string[]> = { [field]: [] };
    for (const d of out) for (const e of d.does) if ('field' in e) wanted[e.field] ??= [];
    fieldLabels = (await resolveDisplay(q, tables, wanted, opts.language).catch(() => undefined))?.fields;
  }
  const access = Object.fromEntries(Object.entries(sc.access).filter(([t]) => t in DEP_SOURCES || t === 'sys_db_object'));
  return { table, field, tables, dependents: out, references: wantRefs, access, denied, slow, notSeen, effectsUnknown, ...(fieldLabels ? { fieldLabels } : {}), timing: { totalMs: Date.now() - started, calls: sc.calls - calls0 } };
}

// ---------------------------------------------------------------- a aba "Regras do campo"

export interface FieldRules {
  table: string;
  field: string;
  tables: string[];
  /** Quem grava: o que pode mudar o valor (`fieldMap`). */
  writers: MapItem[];
  /** Quem depende: o que lê o campo ou reage a ele. */
  dependents: Dependent[];
  references: boolean;
  /** Estado de cada fonte lida pelas duas partes. */
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  notSeen: DepKind[];
  effectsUnknown: DepKind[];
  fieldLabels?: Record<string, string>;
  timing: { totalMs: number; calls: number };
}

/**
 * "Quem grava" + "Quem depende" em paralelo, com as consultas em comum (hierarquia, sys_script, client scripts,
 * UI policies, UI actions, script includes, atribuição, flows) lidas uma vez só.
 */
export async function fieldRules(client: RestClient, target: { table: string; field: string }, opts: FieldDepsOptions = {}): Promise<FieldRules> {
  const started = Date.now();
  const sc = new SharedClient(client, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {});
  const [map, deps] = await Promise.all([fieldMap(sc, target), fieldDeps(sc, target, opts)]);
  const denied = sc.denied(), slow = sc.slow();
  const blind = [...denied, ...slow];
  const notSeen = [...new Set(blind.flatMap((t) => DEP_SOURCES[t]?.main ?? []))].filter((k) => k !== 'reference' || deps.references);
  return {
    table: target.table, field: target.field, tables: map.tables.length >= deps.tables.length ? map.tables : deps.tables,
    writers: map.items, dependents: deps.dependents, references: deps.references,
    access: { ...sc.access }, denied, slow, notSeen, effectsUnknown: deps.effectsUnknown.filter((k) => !notSeen.includes(k)),
    ...(deps.fieldLabels ? { fieldLabels: deps.fieldLabels } : {}),
    timing: { totalMs: Date.now() - started, calls: sc.calls },
  };
}

// ---------------------------------------------------------------- "Simular um valor"

export type SimWill = 'yes' | 'maybe' | 'no';
export type SimWhy =
  | 'preview' // vem da previsão de gravação (`previewChange`)
  | 'always' // roda em toda atualização, sem condição
  | 'cond_true' | 'cond_false' | 'cond_unknown'
  | 'onchange' // onChange do campo: roda ao mudar no formulário
  | 'other_field' // onChange de outro campo, que não muda
  | 'on_load' // só ao abrir o formulário
  | 'on_submit' // roda ao salvar
  | 'not_on_update' // só ao criar (ou apagar)
  | 'policy_true' | 'policy_false_reverse' | 'policy_unchanged' // UI policy: passa a valer, deixa de valer, não muda
  | 'field_not_empty' // regra de atribuição: o campo já está preenchido
  | 'sla_stage' | 'sla_none' // SLA: alguma etapa passa a valer / nenhuma
  | 'not_simulated'; // não se aplica a uma gravação (referências)

export interface SimItem {
  phase: DepPhase;
  kind: DepKind;
  name: string;
  table: string;
  sysId?: string;
  order: number;
  will: SimWill;
  why: SimWhy;
  /** Gravações calculadas pela previsão (`previewChange`). */
  writes: PreviewWrite[];
  /** Efeitos que não são gravação: notifica, SLA, mexe no formulário, aborta, dispara evento, mostra botão. */
  effects: DepEffect[];
  /** O dependente no desenho ("Quem depende"), quando é um. */
  dependent?: Dependent;
  /** O passo da previsão, quando há. */
  step?: PreviewStep;
}

export interface ValueSimulation {
  table: string;
  sysId: string;
  field: string;
  from: string;
  to: string;
  /** Rodariam com certeza, na ordem do ServiceNow. */
  runs: SimItem[];
  /** Podem rodar (condição que não dá para avaliar daqui). */
  maybe: SimItem[];
  /** Dependem do campo mas não rodariam com este valor (o "por que não"). */
  wontRun: SimItem[];
  /** A previsão de gravação completa (resultado, rótulos, passos), como no antigo "E se?". */
  preview: ChangePreview;
  recordReadable: boolean;
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  notSeen: DepKind[];
  timing: { totalMs: number; calls: number };
}

const NON_WRITE = (e: DepEffect) => e.type !== 'write';

/**
 * Dado um valor, o que rodaria: une os passos que gravam (`previewChange`) com os dependentes que reagem sem gravar.
 * As condições são avaliadas com `evalCondition` sobre o registro como ficaria depois da previsão (com o que as
 * regras anteriores gravaram); o que não dá para avaliar vira "pode rodar".
 */
export async function simulateValue(
  client: RestClient,
  target: { table: string; sysId: string; field: string; value: string; language?: string; user?: { name?: string; sysId?: string } },
  opts: { timeoutMs?: number } = {},
): Promise<ValueSimulation> {
  const started = Date.now();
  const sc = new SharedClient(client, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {});
  const { table, sysId, field, value } = target;
  const [preview, deps, recRows] = await Promise.all([
    previewChange(sc, target),
    fieldDeps(sc, { table, field }, { references: false }),
    // Mesma consulta que a previsão faz: o SharedClient lê uma vez só.
    sc.query({ table, query: `sys_id=${sysId}`, fields: [], limit: 1 }).then((r) => r.rows),
  ]);
  const recordReadable = !!recRows[0];
  const record: Record<string, string> = { ...(recRows[0] ?? {}), sys_id: sysId };
  // O registro como ficaria: o valor novo e o que a previsão calculou.
  const rec: Record<string, string> = { ...record, [field]: value };
  const changed = new Set<string>([field]);
  for (const [f, r] of Object.entries(preview.result)) { changed.add(f); if (r.to !== '\u0000calc') rec[f] = r.to; }
  if (deps.tables.includes('incident') && (field === 'state' || field === 'incident_state')) { const twin = field === 'state' ? 'incident_state' : 'state'; rec[twin] = value; changed.add(twin); }
  const changes = { set: changed, old: record };
  const env: Env = { rec, old: record, changed, ...(target.user ? { user: target.user } : {}) };
  const cond = (c: string | undefined) => evalCondition(c, rec, undefined, changes);
  const js = (c: string | undefined): boolean | undefined => { if (!c?.trim()) return true; const v = evalExpr(c, env); return v === undefined ? undefined : !!v && v !== 'false'; };
  const both = (a: boolean | undefined, b: boolean | undefined): boolean | undefined => (a === false || b === false ? false : a === undefined || b === undefined ? undefined : true);
  const fromBool = (b: boolean | undefined): { will: SimWill; why: SimWhy } => (b === true ? { will: 'yes', why: 'cond_true' } : b === false ? { will: 'no', why: 'cond_false' } : { will: 'maybe', why: 'cond_unknown' });

  const steps = [...preview.steps.map((s) => ({ s, sure: true })), ...preview.uncertain.map((s) => ({ s, sure: false }))];
  const used = new Set<PreviewStep>();
  const items: SimItem[] = [];
  for (const d of deps.dependents) {
    if (d.kind === 'reference') continue;
    const stepHit = steps.find((x) => x.s.sysId && x.s.sysId === d.sysId && x.s.kind === d.kind);
    let r: { will: SimWill; why: SimWhy };
    let effects: DepEffect[] = d.does.filter(NON_WRITE);
    switch (d.kind) {
      case 'client_script': {
        const t = d.scriptType ?? '';
        if (t === 'onLoad') r = { will: 'no', why: 'on_load' };
        else if (t === 'onSubmit') r = { will: 'yes', why: 'on_submit' };
        else if (d.trigger === field || (d.trigger && changed.has(d.trigger))) r = { will: 'yes', why: 'onchange' };
        else r = { will: 'no', why: 'other_field' };
        break;
      }
      case 'ui_policy': {
        if (!d.cond) { r = { will: 'no', why: 'policy_unchanged' }; break; }
        const before = evalCondition(d.cond, record), now = evalCondition(d.cond, rec);
        if (now !== undefined && now === before) r = { will: 'no', why: 'policy_unchanged' };
        else if (now === true) r = { will: 'yes', why: 'policy_true' };
        else if (now === false && d.reverse) {
          r = { will: 'yes', why: 'policy_false_reverse' };
          // A condição deixa de valer: as ações do formulário se desfazem (o contrário do que fazem).
          effects = effects.map((e) => (e.type === 'form' && e.sets !== undefined ? { ...e, sets: !e.sets } : e));
        } else if (now === false) r = { will: 'no', why: 'cond_false' };
        else r = { will: 'maybe', why: 'cond_unknown' };
        break;
      }
      case 'data_lookup':
        r = { will: 'yes', why: 'onchange' };
        break;
      case 'assignment_rule': {
        const empty = d.does.some((e) => e.type === 'write' && !rec[e.field]);
        r = !empty ? { will: 'no', why: 'field_not_empty' } : fromBool(cond(d.cond));
        break;
      }
      case 'data_policy':
        r = fromBool(d.cond ? cond(d.cond) : true);
        break;
      case 'sla': {
        const hit = (d.stages ?? []).map((s) => ({ s, before: evalCondition(s.cond, record), now: evalCondition(s.cond, rec, undefined, changes) }));
        const fires = hit.filter((h) => h.now === true && h.before !== true);
        const unsure = hit.filter((h) => h.now === undefined);
        effects = fires.length ? fires.map((h) => ({ type: 'sla', stage: h.s.stage }) as DepEffect) : unsure.map((h) => ({ type: 'sla', stage: h.s.stage }) as DepEffect);
        r = fires.length ? { will: 'yes', why: 'sla_stage' } : unsure.length ? { will: 'maybe', why: 'cond_unknown' } : { will: 'no', why: 'sla_none' };
        break;
      }
      case 'ui_action': {
        const b = js(d.jsCond);
        r = b === true ? { will: 'yes', why: 'cond_true' } : b === false ? { will: 'no', why: 'cond_false' } : { will: 'maybe', why: 'cond_unknown' };
        break;
      }
      case 'br_display':
        r = { will: 'no', why: 'on_load' };
        break;
      default: {
        // Regras de negócio, notificações e flows: só as que rodam em atualização; filtro e condição em script.
        if (d.ops && !d.ops.update) { r = { will: 'no', why: 'not_on_update' }; break; }
        const b = both(d.cond ? cond(d.cond) : true, d.kind === 'flow' ? true : js(d.jsCond));
        r = b === true && !d.cond && !d.jsCond ? { will: 'yes', why: 'always' } : fromBool(b);
      }
    }
    // A previsão já sabe o que esta regra grava (e se roda): ela manda.
    if (stepHit) { used.add(stepHit.s); r = { will: stepHit.sure ? 'yes' : 'maybe', why: 'preview' }; }
    items.push({ phase: d.phase, kind: d.kind, name: d.name, table: d.table, ...(d.sysId ? { sysId: d.sysId } : {}), order: d.order, will: r.will, why: r.why,
      writes: stepHit?.s.writes ?? [], effects, dependent: d, ...(stepHit ? { step: stepHit.s } : {}) });
  }
  // Passos da previsão que não são dependentes diretos do campo (reagem a algo que a mudança causou).
  for (const { s, sure } of steps) {
    if (used.has(s)) continue;
    items.push({ phase: s.phase, kind: s.kind, name: s.name, table: s.table, ...(s.sysId ? { sysId: s.sysId } : {}), order: s.order, will: sure ? 'yes' : 'maybe', why: 'preview', writes: s.writes, effects: [], step: s });
  }
  sortDependents(items);
  const denied = sc.denied(), slow = sc.slow();
  const notSeen = [...new Set([...denied, ...slow].flatMap((t) => DEP_SOURCES[t]?.main ?? []))].filter((k) => k !== 'reference');
  return {
    table, sysId, field, from: preview.from, to: value,
    runs: items.filter((x) => x.will === 'yes'), maybe: items.filter((x) => x.will === 'maybe'), wontRun: items.filter((x) => x.will === 'no'),
    preview, recordReadable, access: { ...sc.access }, denied, slow, notSeen,
    timing: { totalMs: Date.now() - started, calls: sc.calls },
  };
}

// ---------------------------------------------------------------- texto simples

type Lang = 'pt' | 'en';
const T = {
  pt: {
    condition: 'a condição usa o campo', changes: 'dispara quando o campo muda', changes_to: (v: string) => `dispara quando o campo muda para ${v}`,
    changes_from: (v: string) => `dispara quando o campo deixa de ser ${v}`, script_condition: 'a condição (script) lê o campo', script_reads: 'o script lê o campo',
    script_changes: 'o script testa se o campo mudou', onchange: 'roda no navegador quando o campo muda', form_reads: 'o script do formulário lê o campo',
    dotwalk: (v: string) => `a condição usa ${v} (do registro apontado pelo campo)`, lookup_input: 'o campo é entrada da tabela de busca (data lookup)',
    flow_step: 'um passo do flow usa o valor do campo', via_script_include: (v: string) => `a regra chama ${v}, que lê o campo`,
    sla: (stage: string, v?: string) => `o SLA ${({ start: 'começa', pause: 'pausa', resume: 'volta a contar', stop: 'para', reset: 'recomeça', cancel: 'é cancelado' } as Record<string, string>)[stage]} conforme o campo${v ? ` (${v})` : ''}`,
    references: (v: string) => `aponta para ${v}`,
    policy: 'a política mostra/esconde/obriga outro campo conforme este', notify: 'notifica quando a condição com o campo vale', assign: 'a atribuição usa o campo na condição',
    write: (f: string, v?: string) => (v !== undefined ? `grava ${f} = ${v}` : `grava ${f}`), ro: (f: string, b?: boolean) => `${b === false ? 'libera' : 'bloqueia'} ${f}`,
    md: (f: string, b?: boolean) => `${b === false ? 'tira a obrigação de' : 'obriga'} ${f}`, hd: (f: string, b?: boolean) => `${b === false ? 'mostra' : 'esconde'} ${f}`,
    notifyDo: 'envia a notificação', slaDo: (s: string) => `SLA: ${({ start: 'começa', pause: 'pausa', resume: 'volta a contar', stop: 'para', reset: 'recomeça', cancel: 'cancela' } as Record<string, string>)[s]}`,
    abort: 'impede a gravação', event: (n: string) => `dispara o evento ${n}`, show: 'o botão aparece',
  },
  en: {
    condition: 'the condition uses the field', changes: 'fires when the field changes', changes_to: (v: string) => `fires when the field changes to ${v}`,
    changes_from: (v: string) => `fires when the field changes from ${v}`, script_condition: 'the script condition reads the field', script_reads: 'the script reads the field',
    script_changes: 'the script checks whether the field changed', onchange: 'runs in the browser when the field changes', form_reads: 'the form script reads the field',
    dotwalk: (v: string) => `the condition uses ${v} (from the record the field points to)`, lookup_input: 'the field is an input of a data lookup',
    flow_step: 'a flow step uses the field value', via_script_include: (v: string) => `the rule calls ${v}, which reads the field`,
    sla: (stage: string, v?: string) => `the SLA ${({ start: 'starts', pause: 'pauses', resume: 'resumes', stop: 'stops', reset: 'resets', cancel: 'is cancelled' } as Record<string, string>)[stage]} based on the field${v ? ` (${v})` : ''}`,
    references: (v: string) => `points to ${v}`,
    policy: 'the policy shows/hides/requires another field based on this one', notify: 'notifies when the condition on the field holds', assign: 'the assignment uses the field in its condition',
    write: (f: string, v?: string) => (v !== undefined ? `sets ${f} = ${v}` : `sets ${f}`), ro: (f: string, b?: boolean) => `${b === false ? 'unlocks' : 'locks'} ${f}`,
    md: (f: string, b?: boolean) => `${b === false ? 'makes optional' : 'requires'} ${f}`, hd: (f: string, b?: boolean) => `${b === false ? 'shows' : 'hides'} ${f}`,
    notifyDo: 'sends the notification', slaDo: (s: string) => `SLA: ${({ start: 'starts', pause: 'pauses', resume: 'resumes', stop: 'stops', reset: 'resets', cancel: 'cancels' } as Record<string, string>)[s]}`,
    abort: 'blocks the save', event: (n: string) => `fires event ${n}`, show: 'the button shows',
  },
};

/** Uma linha de "como depende" por relação, e uma por efeito, em texto simples. */
export function describeDependent(d: Pick<Dependent, 'kind' | 'how' | 'does'>, lang: Lang = 'pt', labels: Record<string, string> = {}): { how: string[]; does: string[] } {
  const t = T[lang];
  const how = d.how.map((h) => {
    const base = (() => {
      switch (h.code) {
        case 'condition': return d.kind === 'ui_policy' ? t.policy : d.kind === 'notification' ? t.notify : d.kind === 'assignment_rule' ? t.assign : t.condition;
        case 'changes': return t.changes;
        case 'changes_to': return t.changes_to(h.detail ?? '');
        case 'changes_from': return t.changes_from(h.detail ?? '');
        case 'dotwalk': return t.dotwalk(h.detail ?? '');
        case 'via_script_include': return t.via_script_include(h.detail ?? '');
        case 'references': return t.references(h.detail ?? '');
        case 'sla_start': case 'sla_pause': case 'sla_resume': case 'sla_stop': case 'sla_reset': case 'sla_cancel': return t.sla(h.code.slice(4), h.detail);
        default: return t[h.code];
      }
    })();
    return base;
  });
  const lbl = (f: string) => labels[f] || f;
  const does = d.does.map((e) => {
    switch (e.type) {
      case 'write': return t.write(lbl(e.field), e.value);
      case 'form': return (e.aspect === 'read_only' ? t.ro : e.aspect === 'mandatory' ? t.md : t.hd)(lbl(e.field), e.sets);
      case 'notify': return t.notifyDo;
      case 'sla': return t.slaDo(e.stage);
      case 'abort': return t.abort;
      case 'event': return t.event(e.name);
      case 'show': return t.show;
    }
  });
  return { how, does };
}
