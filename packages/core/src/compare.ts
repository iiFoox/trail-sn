/**
 * Comparar instâncias (DEV × PROD): "por que funciona em DEV e não em PROD?".
 *
 * Para o mesmo campo `{table, field}`, lê as duas instâncias (um `RestClient` por origem, só GET) e diz o que difere:
 *  1. Regras do campo: quem grava e quem depende (`fieldRules`) e as regras estáticas do formulário (`fieldStates` sem
 *     registro: overrides, client scripts, UI e data policies). Cada artefato é relido nos DOIS lados pelo sys_id (sem
 *     filtro de ativo, para pegar "ativa só em DEV"); o que não casa pelo sys_id casa por (tabela do artefato + nome +
 *     tabela onde roda). Resultado: só em A, só em B, diferente (ativo, ordem, quando/fase, condição, script com diff
 *     curto, ações) ou igual.
 *  2. Definição do campo: `sys_dictionary`, `sys_documentation` (rótulos) e `sys_choice` (opções).
 *  3. Versões: para o que difere, qual lado foi atualizado por último e, se legível, o update set de origem
 *     (`sys_update_xml`, ou `sys_update_version`), só nome e data, sem o payload.
 *  4. Sem acesso: fonte negada ou lenta de um lado nunca vira "só existe no outro": vira "não deu para comparar".
 *  5. `describeComparison`: resumo em texto simples, ordenado pelo que mais explica comportamento diferente.
 */
import type { QueryRequest, QueryResult, RestClient } from './client/RestClient';
import { fieldRules } from './fieldDeps';
import { fieldStates } from './fieldState';
import { SharedClient } from './sharedClient';
import type { AccessState, Row } from './types';
import { conditionFields, humanQuery, safeValue } from './util';
import { resolveDisplay } from './display';

// ---------------------------------------------------------------- tipos

export type CompareSide = 'a' | 'b';
export type CompareLang = 'pt' | 'en';

export interface CompareInstance { client: RestClient; /** Nome curto para o texto (ex.: "DEV", "PROD"). */ label: string }

export interface CompareOptions {
  timeoutMs?: number;
  /** Idioma da sessão (ex.: 'pb'): rótulos de campo nas condições e o rótulo do campo nesse idioma. */
  language?: string;
  /** Lê as versões (update set de origem) do que difere. Padrão: sim. */
  versions?: boolean;
}

/** Aspecto de uma diferença, do que mais explica comportamento ao que menos explica. */
export type DiffAspect = 'active' | 'condition' | 'when' | 'actions' | 'script' | 'order' | 'other';

export interface ScriptDiffLine { side: CompareSide; /** Linha no script original (1 = primeira). */ n: number; text: string }
export interface ScriptDiff {
  /** Linhas que só existem em A / só em B (depois de normalizar espaços). */
  changedA: number;
  changedB: number;
  /** Até 10 linhas, na ordem do script. */
  lines: ScriptDiffLine[];
  /** Linhas mudadas que ficaram de fora de `lines`. */
  more: number;
}

export interface FieldDiff {
  aspect: DiffAspect;
  /** Coluna do artefato (script, conditions, order...). */
  col: string;
  a?: string;
  b?: string;
  /** Hash normalizado (scripts). */
  hashA?: string;
  hashB?: string;
  diff?: ScriptDiff;
}

export interface VersionInfo {
  /** Nome do registro de atualização (ex.: sys_script_<sys_id>). */
  name: string;
  updateSet?: string;
  at?: string;
  by?: string;
  from: 'sys_update_xml' | 'sys_update_version';
}

export interface RuleSnapshot {
  sysId: string;
  name: string;
  on?: string;
  active: boolean;
  updatedOn?: string;
  updatedBy?: string;
  /** Linha lida (só as colunas comparadas); ausente quando a sessão não leu o artefato. */
  values?: Row;
}

export type RuleStatus = 'only_a' | 'only_b' | 'different' | 'same' | 'unknown';
export type RuleRole = 'writes' | 'depends' | 'state';

export interface RuleComparison {
  /** Tabela do artefato (sys_script, sys_ui_policy...). */
  art: string;
  /** Tipo como o motor chama (br_before, ui_policy, client_script...), do lado que indicou. */
  kind: string;
  name: string;
  roles: RuleRole[];
  status: RuleStatus;
  matchedBy?: 'sys_id' | 'name';
  a?: RuleSnapshot;
  b?: RuleSnapshot;
  diffs: FieldDiff[];
  /** status 'unknown': qual lado não deu para ler e por quê. */
  unknown?: { side: CompareSide; reason: 'denied' | 'slow' };
  /** Para 'different': o lado atualizado por último ('same' = mesma data). */
  newer?: CompareSide | 'same';
  versions?: { a?: VersionInfo; b?: VersionInfo };
}

export type DefStatus = 'same' | 'different' | 'unknown' | 'missing_a' | 'missing_b' | 'missing_both';

export interface DictionaryComparison {
  status: DefStatus;
  a?: Row;
  b?: Row;
  diffs: FieldDiff[];
  unknown?: { side: CompareSide; reason: 'denied' | 'slow' | 'hidden' };
  newer?: CompareSide | 'same';
  versions?: { a?: VersionInfo; b?: VersionInfo };
}

export interface LabelsComparison {
  status: 'same' | 'different' | 'unknown';
  /** Idioma → rótulo. */
  a: Record<string, string>;
  b: Record<string, string>;
  diffs: { lang: string; a?: string; b?: string }[];
  unknown?: { side: CompareSide; reason: 'denied' | 'slow' };
}

export interface ChoiceInfo { value: string; label?: string; inactive: boolean; sequence?: string; dependentValue?: string }
export interface ChoicesComparison {
  status: 'same' | 'different' | 'unknown';
  a: ChoiceInfo[];
  b: ChoiceInfo[];
  onlyA: ChoiceInfo[];
  onlyB: ChoiceInfo[];
  changed: { value: string; label?: string; diffs: { col: 'inactive' | 'label' | 'sequence'; a?: string; b?: string }[] }[];
  unknown?: { side: CompareSide; reason: 'denied' | 'slow' };
}

export interface DefinitionComparison { dictionary: DictionaryComparison; labels: LabelsComparison; choices: ChoicesComparison }

export type DifferenceCode =
  | 'field_missing' | 'rule_only' | 'rule_active' | 'rule_condition' | 'rule_when' | 'rule_actions' | 'rule_script' | 'rule_order' | 'rule_other'
  | 'dict' | 'choice_only' | 'choice_inactive' | 'choice_label' | 'choice_order' | 'label';

/** Uma diferença para o resumo, com o peso (quanto pode explicar comportamento diferente). */
export interface Difference {
  code: DifferenceCode;
  weight: number;
  /** Lado onde existe / está ativo / é verdadeiro (só em A, ativa só em B, obrigatório só em B...). */
  side?: CompareSide;
  /** Índice em `rules`. */
  rule?: number;
  col?: string;
  a?: string;
  b?: string;
  value?: string;
  label?: string;
  lang?: string;
  /** rule_only: o artefato está ativo do lado onde existe. */
  active?: boolean;
  diff?: ScriptDiff;
}

export interface NotCompared { side: CompareSide; /** Categoria em texto técnico estável (business_rules, ui_policies...). */ what: string; reason: 'denied' | 'slow' | 'hidden'; tables: string[] }

export interface SideSummary {
  label: string;
  tables: string[];
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  calls: number;
}

export interface InstanceComparison {
  table: string;
  field: string;
  a: SideSummary;
  b: SideSummary;
  rules: RuleComparison[];
  definition: DefinitionComparison;
  /** Ordenadas do que mais explica comportamento ao que menos. */
  differences: Difference[];
  notCompared: NotCompared[];
  /** Lado que não respondeu nada legível (sessão expirada, sem login): nada dele foi comparado. */
  unreachable: CompareSide[];
  counts: { onlyA: number; onlyB: number; different: number; same: number; unknown: number };
  fieldLabels?: Record<string, string>;
  timing: { totalMs: number; calls: { a: number; b: number } };
}

// ---------------------------------------------------------------- artefatos e colunas comparadas

interface ArtSpec {
  /** Coluna do nome (para casar por nome). */
  name: string;
  /** Coluna da tabela onde roda (para casar por nome dentro da hierarquia). */
  on?: string;
  /** Tem coluna active. */
  active?: boolean;
  cols: Record<string, DiffAspect>;
  /** Filhos comparados como "ações" (policy → ações por campo). */
  children?: { table: string; parent: string; fields: string[] };
  category: string;
}

const SCRIPT = 'script' as const, COND = 'condition' as const, WHEN = 'when' as const, ORDER = 'order' as const, ACT = 'actions' as const, OTHER = 'other' as const;

export const ART_SPECS: Record<string, ArtSpec> = {
  sys_script: { name: 'name', on: 'collection', active: true, category: 'business_rules',
    cols: { when: WHEN, action_insert: WHEN, action_update: WHEN, action_delete: WHEN, action_query: WHEN, filter_condition: COND, condition: COND, order: ORDER, template: ACT, script: SCRIPT } },
  sys_script_client: { name: 'name', on: 'table', active: true, category: 'client_scripts',
    cols: { type: WHEN, field: WHEN, ui_type: WHEN, global: WHEN, view: WHEN, order: ORDER, script: SCRIPT } },
  sys_ui_policy: { name: 'short_description', on: 'table', active: true, category: 'ui_policies',
    cols: { conditions: COND, on_load: WHEN, reverse_if_false: WHEN, inherit: WHEN, global: WHEN, view: WHEN, ui_type: WHEN, order: ORDER, run_scripts: SCRIPT, script_true: SCRIPT, script_false: SCRIPT },
    children: { table: 'sys_ui_policy_action', parent: 'ui_policy', fields: ['disabled', 'mandatory', 'visible'] } },
  sys_data_policy2: { name: 'short_description', on: 'model_table', active: true, category: 'data_policies',
    cols: { conditions: COND, enforce_ui: WHEN, inherit: WHEN, reverse_if_false: WHEN },
    children: { table: 'sys_data_policy_rule', parent: 'sys_data_policy', fields: ['mandatory', 'disabled'] } },
  sys_ui_action: { name: 'name', on: 'table', active: true, category: 'ui_actions', cols: { condition: COND, client: WHEN, order: ORDER, onclick: SCRIPT, script: SCRIPT } },
  sys_script_include: { name: 'name', active: true, category: 'script_includes', cols: { script: SCRIPT } },
  sysrule_assignment: { name: 'name', on: 'table', active: true, category: 'assignment_rules', cols: { condition: COND, order: ORDER, group: ACT, user: ACT } },
  sysevent_email_action: { name: 'name', on: 'collection', active: true, category: 'notifications',
    cols: { condition: COND, advanced_condition: COND, action_insert: WHEN, action_update: WHEN, generation_type: WHEN, event_name: WHEN, order: ORDER } },
  contract_sla: { name: 'name', on: 'collection', active: true, category: 'slas',
    cols: { start_condition: COND, pause_condition: COND, resume_condition: COND, stop_condition: COND, reset_condition: COND, cancel_condition: COND, duration: OTHER, schedule: OTHER } },
  sys_hub_flow: { name: 'name', active: true, category: 'flows', cols: {} },
  dl_definition: { name: 'name', on: 'source_table', active: true, category: 'data_lookups', cols: { run_on_form_change: WHEN, run_on_update: WHEN, run_on_insert: WHEN } },
  sysauto_script: { name: 'name', active: true, category: 'scheduled_jobs', cols: { run_type: WHEN, run_time: WHEN, run_dayofweek: WHEN, conditional: WHEN, condition: COND, script: SCRIPT } },
  sys_transform_map: { name: 'name', on: 'target_table', active: true, category: 'transform_maps', cols: { run_script: WHEN, script: SCRIPT } },
  sys_dictionary_override: { name: 'element', on: 'name', category: 'dictionary_overrides',
    cols: { read_only_override: ACT, read_only: ACT, mandatory_override: ACT, mandatory: ACT, default_value_override: ACT, default_value: ACT, attributes_override: OTHER, attributes: OTHER } },
};

/** Fonte lida → categoria (para "não deu para comparar"). */
const SOURCE_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(ART_SPECS).map(([t, s]) => [t, s.category])),
  sys_ui_policy_action: 'ui_policies', sys_data_policy_rule: 'data_policies', dl_definition_rel_match: 'data_lookups', dl_definition_rel_set: 'data_lookups',
  sys_hub_trigger_instance_v2: 'flows', sys_hub_action_instance_v2: 'flows', sys_transform_entry: 'transform_maps',
  sys_dictionary: 'dictionary', sys_documentation: 'labels', sys_choice: 'choices', sys_db_object: 'hierarchy',
};

const DICT_COLS: Record<string, DiffAspect> = {
  active: 'active', mandatory: COND, read_only: COND, internal_type: ACT, reference: ACT, default_value: ACT, dependent: WHEN, dependent_on_field: WHEN, max_length: OTHER, attributes: OTHER,
};
const DICT_WEIGHT: Record<string, number> = { active: 100, mandatory: 78, read_only: 78, internal_type: 70, reference: 70, default_value: 65, dependent: 60, dependent_on_field: 60, max_length: 35, attributes: 35 };
const ASPECT_WEIGHT: Record<DiffAspect, number> = { active: 100, condition: 80, when: 75, actions: 70, script: 60, order: 40, other: 30 };
const ASPECT_CODE: Record<DiffAspect, DifferenceCode> = { active: 'rule_active', condition: 'rule_condition', when: 'rule_when', actions: 'rule_actions', script: 'rule_script', order: 'rule_order', other: 'rule_other' };

// ---------------------------------------------------------------- scripts: normalização, hash e diff curto

interface NLine { n: number; t: string }
/** Linhas sem espaços nas pontas, espaços internos colapsados e sem linhas vazias (n = linha original). */
export function normalizeLines(s: string | undefined): NLine[] {
  return (s ?? '').split(/\r?\n/).map((l, i) => ({ n: i + 1, t: l.trim().replace(/\s+/g, ' ') })).filter((x) => x.t !== '');
}
/** FNV-1a de 32 bits do texto normalizado, em hexadecimal. */
export function normalizedHash(s: string | undefined): string {
  const text = normalizeLines(s).map((x) => x.t).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Diff de linhas (LCS) depois de normalizar espaços. Scripts muito grandes: o miolo diferente conta inteiro. */
export function scriptDiff(a: string | undefined, b: string | undefined, max = 10): ScriptDiff {
  const A = normalizeLines(a), B = normalizeLines(b);
  let p = 0;
  while (p < A.length && p < B.length && A[p]!.t === B[p]!.t) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s]!.t === B[B.length - 1 - s]!.t) s++;
  const ma = A.slice(p, A.length - s), mb = B.slice(p, B.length - s);
  const out: ScriptDiffLine[] = [];
  if (ma.length * mb.length <= 4_000_000) {
    const n = ma.length, m = mb.length;
    const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = ma[i]!.t === mb[j]!.t ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ma[i]!.t === mb[j]!.t) { i++; j++; } else if (j < m && (i >= n || L[i]![j + 1]! >= L[i + 1]![j]!)) { out.push({ side: 'b', n: mb[j]!.n, text: mb[j]!.t }); j++; } else { out.push({ side: 'a', n: ma[i]!.n, text: ma[i]!.t }); i++; }
    }
  } else {
    out.push(...ma.map((x) => ({ side: 'a' as const, n: x.n, text: x.t })), ...mb.map((x) => ({ side: 'b' as const, n: x.n, text: x.t })));
  }
  const cut = (t: string) => (t.length > 160 ? t.slice(0, 159) + '…' : t);
  return {
    changedA: out.filter((x) => x.side === 'a').length,
    changedB: out.filter((x) => x.side === 'b').length,
    lines: out.slice(0, max).map((x) => ({ ...x, text: cut(x.text) })),
    more: Math.max(0, out.length - max),
  };
}

const normCond = (c: string | undefined) => (c ?? '').trim().replace(/\^EQ$/, '').replace(/^EQ$/, '');
const normAttrs = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean).sort().join(',');
const readable = (a: AccessState | undefined) => a === 'ok' || a === 'empty';
const blindReason = (a: AccessState | undefined): 'denied' | 'slow' => (a === 'timeout' || a === 'unknown' ? 'slow' : 'denied');

// ---------------------------------------------------------------- leitura de um lado

interface Nominee { art: string; sysId: string; name: string; kind: string; roles: Set<RuleRole>; on?: string }

interface SideData {
  sc: SharedClient;
  tables: string[];
  nominees: Map<string, Nominee>;
  rulesNotSeen: string[];
}

const keyOf = (art: string, sysId: string) => `${art}|${sysId}`;

async function readSide(client: RestClient, target: { table: string; field: string }, opts: CompareOptions): Promise<SideData> {
  const sc = new SharedClient(client, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {});
  const [rules, states] = await Promise.all([
    fieldRules(sc, target, { references: false, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) }),
    fieldStates(sc, { table: target.table, sysId: '', fields: [{ field: target.field }] }, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}).then((r) => r[0]),
  ]);
  const nominees = new Map<string, Nominee>();
  const add = (art: string, sysId: string | undefined, name: string, kind: string, role: RuleRole, on?: string) => {
    if (!sysId || !(art in ART_SPECS)) return;
    const k = keyOf(art, sysId);
    const prev = nominees.get(k);
    if (prev) { prev.roles.add(role); return; }
    nominees.set(k, { art, sysId, name, kind, roles: new Set([role]), ...(on ? { on } : {}) });
  };
  for (const w of rules.writers) add(w.table, w.sysId, w.kind === 'br_via_script_include' ? (w.name.split(' → ')[1] ?? w.name) : w.name, w.kind, 'writes', w.on);
  for (const d of rules.dependents) if (d.kind !== 'reference') add(d.table, d.sysId, d.kind === 'br_via_script_include' ? (d.name.split(' → ')[1] ?? d.name) : d.name, d.kind, 'depends', d.on);
  for (const r of [...(states?.rules ?? []), ...(states?.skipped ?? [])]) if (r.kind !== 'dictionary') add(r.table, r.sysId, r.name, r.kind, 'state', 'on' in r ? r.on : undefined);
  return { sc, tables: rules.tables, nominees, rulesNotSeen: rules.notSeen };
}

// ---------------------------------------------------------------- lado inalcançável

/**
 * Lado sem sessão (401) ou sem rede: depois de `limit` respostas assim, sem nenhuma resposta de verdade antes, as
 * próximas consultas desse lado voltam na hora com o mesmo resultado, sem ir à instância. No PDI, o lado B sem login
 * fazia 39 chamadas inúteis. 403 não conta: é uma sessão de verdade com papéis restritos, que ainda lê outras fontes.
 *
 * Até a primeira resposta que não seja "sem sessão", as consultas passam uma por vez: a leitura de cada lado dispara
 * dezenas de consultas em paralelo, e sem isso todas já estavam a caminho antes da primeira 401 voltar (no PDI, com o
 * portão só na entrada, o lado sem login ainda fazia 35 chamadas). O lado que responde paga uma ida e volta a mais.
 */
export class DeadSideGate implements RestClient {
  private dead = 0;
  private alive = false;
  /** Já veio uma resposta que não é "sem sessão": as consultas seguem em paralelo. */
  private open = false;
  private chain: Promise<void> = Promise.resolve();
  private last?: QueryResult;
  constructor(readonly inner: RestClient, private readonly limit = 2) {}
  get calls(): number { return this.inner.calls; }
  get stopped(): boolean { return !this.alive && this.dead >= this.limit; }
  async query(req: QueryRequest): Promise<QueryResult> {
    if (!this.open) {
      const prev = this.chain;
      let done!: () => void;
      this.chain = new Promise<void>((r) => { done = r; });
      await prev;
      if (!this.open) {
        try { return await this.pass(req); } finally { done(); }
      }
      done();
    }
    return this.pass(req);
  }
  private async pass(req: QueryRequest): Promise<QueryResult> {
    if (this.stopped && this.last) return { ...this.last, rows: [] };
    const r = await this.inner.query(req);
    const isDead = r.status === 401 || (r.status === 0 && r.access === 'unknown');
    if (isDead) { this.dead++; this.last = r; } else { this.open = true; if (r.status !== 0) this.alive = true; }
    return r;
  }
  history(table: string, sysId: string) { return this.inner.history ? this.inner.history(table, sysId) : Promise.resolve(null); }
}

// ---------------------------------------------------------------- comparação

export async function compareInstances(
  a: CompareInstance,
  b: CompareInstance,
  target: { table: string; field: string },
  opts: CompareOptions = {},
): Promise<InstanceComparison> {
  const started = Date.now();
  const { table, field } = target;
  const [A, B] = await Promise.all([readSide(new DeadSideGate(a.client), target, opts), readSide(new DeadSideGate(b.client), target, opts)]);
  const S = { a: A, b: B };
  const tables = [...new Set([...A.tables, ...B.tables])];
  const inT = `IN${tables.join(',')}`;
  const q = (s: CompareSide, t: string, query: string, fields: string[], limit: number) => S[s].sc.query({ table: t, query, fields, limit }).then((r) => r.rows);
  const both = <T>(fn: (s: CompareSide) => Promise<T>) => Promise.all([fn('a'), fn('b')]) as Promise<[T, T]>;

  // ---------- 1. regras: releitura de cada artefato nos dois lados, pelo sys_id ----------
  const byArt = new Map<string, Set<string>>();
  for (const n of [...A.nominees.values(), ...B.nominees.values()]) (byArt.get(n.art) ?? byArt.set(n.art, new Set()).get(n.art)!).add(n.sysId);
  const detailFields = (spec: ArtSpec) => [...new Set(['sys_id', spec.name, ...(spec.on ? [spec.on] : []), ...(spec.active ? ['active'] : []), ...Object.keys(spec.cols), 'sys_updated_on', 'sys_updated_by'])];
  const fetchByIds = async (s: CompareSide, art: string, ids: string[]): Promise<Row[]> => {
    const spec = ART_SPECS[art]!;
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      out.push(...await q(s, art, `sys_idIN${chunk.join(',')}`, detailFields(spec), chunk.length));
    }
    return out;
  };
  const nameOf = (art: string, r: Row) => (art === 'sys_dictionary_override' ? `${r.name ?? '?'}.${r.element ?? '?'}` : r[ART_SPECS[art]!.name] ?? '');

  type Entity = { art: string; nomA?: Nominee; nomB?: Nominee; rowA?: Row; rowB?: Row; matchedBy?: 'sys_id' | 'name' };
  const entities: Entity[] = [];
  await Promise.all([...byArt].map(async ([art, set]) => {
    const spec = ART_SPECS[art]!;
    const ids = [...set];
    const [rowsA, rowsB] = await both((s) => fetchByIds(s, art, ids));
    const mapA = new Map(rowsA.map((r) => [r.sys_id ?? '', r])), mapB = new Map(rowsB.map((r) => [r.sys_id ?? '', r]));
    const list: Entity[] = ids.map((id) => {
      const nomA = A.nominees.get(keyOf(art, id)), nomB = B.nominees.get(keyOf(art, id));
      const rowA = mapA.get(id), rowB = mapB.get(id);
      return { art, ...(nomA ? { nomA } : {}), ...(nomB ? { nomB } : {}), ...(rowA ? { rowA } : {}), ...(rowB ? { rowB } : {}), ...(rowA && rowB ? { matchedBy: 'sys_id' as const } : {}) };
    });
    const has = (e: Entity, s: CompareSide) => (s === 'a' ? !!(e.rowA || e.nomA) : !!(e.rowB || e.nomB));
    // Sem par pelo sys_id: procura do outro lado pelo nome (e pela tabela onde roda).
    for (const [from, to] of [['a', 'b'], ['b', 'a']] as const) {
      const lonely = list.filter((e) => has(e, from) && !has(e, to));
      if (!lonely.length || !readable(S[to].sc.access[art])) continue;
      const nm = (e: Entity) => { const r = from === 'a' ? e.rowA : e.rowB; const n = from === 'a' ? e.nomA : e.nomB; return r ? nameOf(art, r) : n?.name ?? ''; };
      const onOf = (e: Entity) => { const r = from === 'a' ? e.rowA : e.rowB; const n = from === 'a' ? e.nomA : e.nomB; return (spec.on && r?.[spec.on]) || n?.on || ''; };
      // A vírgula pode ficar (a comparação é por igualdade, sem lista IN); ^, quebra de linha e "javascript:" não.
      const names = [...new Set(lonely.map(nm).filter((x) => x && safeValue(x.replace(/,/g, ''))))];
      if (!names.length) continue;
      let query: string;
      if (art === 'sys_dictionary_override') query = `name${inT}^element=${field}`;
      else query = `${spec.on ? `${spec.on}${inT}^` : ''}${names.map((x, i) => `${i ? 'OR' : ''}${spec.name}=${x}`).join('^')}`;
      const cands = await q(to, art, query, detailFields(spec), 200);
      const taken = new Set(list.filter((e) => has(e, from) && has(e, to)).map((e) => (to === 'a' ? e.rowA?.sys_id : e.rowB?.sys_id)).filter(Boolean) as string[]);
      for (const e of lonely) {
        const pool = cands.filter((r) => !taken.has(r.sys_id ?? '') && nameOf(art, r) === nm(e) && (!spec.on || !onOf(e) || r[spec.on] === onOf(e)));
        const pick = pool.find((r) => r.active !== 'false') ?? pool[0];
        if (!pick) continue;
        taken.add(pick.sys_id ?? '');
        // Se o par já é uma entidade do outro lado (indicada lá), junta as duas.
        const twinIdx = list.findIndex((x) => x !== e && (to === 'a' ? x.rowA?.sys_id ?? x.nomA?.sysId : x.rowB?.sys_id ?? x.nomB?.sysId) === pick.sys_id && !has(x, from));
        const twin = twinIdx >= 0 ? list[twinIdx] : undefined;
        if (to === 'a') { e.rowA = pick; if (twin?.nomA) e.nomA = twin.nomA; } else { e.rowB = pick; if (twin?.nomB) e.nomB = twin.nomB; }
        e.matchedBy = 'name';
        if (twinIdx >= 0) list.splice(twinIdx, 1);
      }
    }
    entities.push(...list);
  }));

  // Filhos (ações das policies) dos pares lidos dos dois lados.
  const children: Record<CompareSide, Map<string, string>> = { a: new Map(), b: new Map() };
  await Promise.all(Object.entries(ART_SPECS).filter(([, s]) => s.children).map(async ([art, spec]) => {
    const ch = spec.children!;
    await Promise.all((['a', 'b'] as const).map(async (s) => {
      const ids = entities.filter((e) => e.art === art && e.rowA && e.rowB).map((e) => (s === 'a' ? e.rowA!.sys_id : e.rowB!.sys_id)).filter(Boolean) as string[];
      if (!ids.length) return;
      const rows = await q(s, ch.table, `${ch.parent}IN${ids.join(',')}`, ['sys_id', ch.parent, 'field', ...ch.fields], 1000);
      if (!readable(S[s].sc.access[ch.table])) return;
      const per = new Map<string, string[]>();
      for (const r of rows) (per.get(r[ch.parent] ?? '') ?? per.set(r[ch.parent] ?? '', []).get(r[ch.parent] ?? '')!).push(`${r.field ?? '?'}: ${ch.fields.map((f) => `${f}=${r[f] ?? ''}`).join(', ')}`);
      for (const id of ids) children[s].set(id, (per.get(id) ?? []).sort().join('; '));
    }));
  }));

  const snap = (art: string, row: Row | undefined, nom: Nominee | undefined): RuleSnapshot | undefined => {
    if (!row && !nom) return undefined;
    const spec = ART_SPECS[art]!;
    const values = row ? Object.fromEntries(Object.entries(row).filter(([k]) => k === 'active' || k in spec.cols)) : undefined;
    return {
      sysId: row?.sys_id ?? nom!.sysId, name: row ? nameOf(art, row) || nom?.name || '?' : nom!.name,
      ...((row && spec.on && row[spec.on]) || nom?.on ? { on: (row && spec.on && row[spec.on]) || nom!.on! } : {}),
      active: row ? row.active !== 'false' : true,
      ...(row?.sys_updated_on ? { updatedOn: row.sys_updated_on } : {}), ...(row?.sys_updated_by ? { updatedBy: row.sys_updated_by } : {}),
      ...(values ? { values } : {}),
    };
  };

  const rules: RuleComparison[] = entities.map((e) => {
    const spec = ART_SPECS[e.art]!;
    const accA = S.a.sc.access[e.art], accB = S.b.sc.access[e.art];
    const sa = snap(e.art, e.rowA, e.nomA), sb = snap(e.art, e.rowB, e.nomB);
    const nom = e.nomA ?? e.nomB!;
    const roles = [...new Set([...(e.nomA?.roles ?? []), ...(e.nomB?.roles ?? [])])].sort() as RuleRole[];
    const base = { art: e.art, kind: nom.kind, name: sa?.name ?? sb?.name ?? nom.name, roles, ...(sa ? { a: sa } : {}), ...(sb ? { b: sb } : {}), ...(e.matchedBy ? { matchedBy: e.matchedBy } : {}), diffs: [] as FieldDiff[] };
    if (e.rowA && e.rowB) {
      const diffs: FieldDiff[] = [];
      if (spec.active && (e.rowA.active ?? 'true') !== (e.rowB.active ?? 'true')) diffs.push({ aspect: 'active', col: 'active', a: e.rowA.active ?? 'true', b: e.rowB.active ?? 'true' });
      for (const [col, aspect] of Object.entries(spec.cols)) {
        const va = e.rowA[col], vb = e.rowB[col];
        if (va === undefined || vb === undefined) continue;
        if (aspect === 'script' && col !== 'run_scripts') {
          const ha = normalizedHash(va), hb = normalizedHash(vb);
          if (ha !== hb) diffs.push({ aspect, col, hashA: ha, hashB: hb, diff: scriptDiff(va, vb) });
        } else if (aspect === 'condition') {
          if (normCond(va) !== normCond(vb)) diffs.push({ aspect, col, a: normCond(va), b: normCond(vb) });
        } else if (col.startsWith('attributes')) {
          if (normAttrs(va) !== normAttrs(vb)) diffs.push({ aspect, col, a: va, b: vb });
        } else if (va.trim() !== vb.trim()) diffs.push({ aspect, col, a: va.trim(), b: vb.trim() });
      }
      if (spec.children) {
        const ca = children.a.get(e.rowA.sys_id ?? ''), cb = children.b.get(e.rowB.sys_id ?? '');
        if (ca !== undefined && cb !== undefined && ca !== cb) diffs.push({ aspect: 'actions', col: spec.children.table, a: ca, b: cb });
      }
      return { ...base, status: diffs.length ? 'different' : 'same', diffs };
    }
    const inA = !!(e.rowA || e.nomA), inB = !!(e.rowB || e.nomB);
    // Do lado que falta, só concluímos "não existe" se a sessão leu a tabela do artefato.
    if (inA && !inB) return readable(accB) ? { ...base, status: 'only_a' } : { ...base, status: 'unknown', unknown: { side: 'b', reason: blindReason(accB) } };
    if (inB && !inA) return readable(accA) ? { ...base, status: 'only_b' } : { ...base, status: 'unknown', unknown: { side: 'a', reason: blindReason(accA) } };
    // Indicado pelos dois lados, mas um deles não releu o artefato: não dá para comparar o conteúdo.
    const side: CompareSide = !e.rowA ? 'a' : 'b';
    return { ...base, status: 'unknown', unknown: { side, reason: blindReason(side === 'a' ? accA : accB) } };
  });
  const statusRank: Record<RuleStatus, number> = { different: 0, only_a: 1, only_b: 1, unknown: 2, same: 3 };
  rules.sort((x, y) => statusRank[x.status] - statusRank[y.status] || x.art.localeCompare(y.art) || x.name.localeCompare(y.name));

  // ---------- 2. definição do campo ----------
  const dictFields = ['sys_id', 'name', 'element', ...Object.keys(DICT_COLS).filter((c) => c !== 'active'), 'active', 'column_label', 'sys_updated_on', 'sys_updated_by'];
  const languages = [...new Set(['en', 'pb', 'pt', ...(opts.language ? [opts.language] : [])])];
  const [dictRows, docRows, choiceRows] = await Promise.all([
    both((s) => q(s, 'sys_dictionary', `name${inT}^element=${field}`, dictFields, 20)),
    both((s) => q(s, 'sys_documentation', `name${inT}^element=${field}^languageIN${languages.join(',')}`, ['name', 'element', 'label', 'language'], 50)),
    both((s) => q(s, 'sys_choice', `name${inT}^element=${field}`, ['name', 'element', 'value', 'label', 'language', 'inactive', 'sequence', 'dependent_value'], 1000)),
  ]);
  const depth = (t: string | undefined) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const pickDict = (rows: Row[]) => [...rows].sort((x, y) => depth(x.name) - depth(y.name))[0];
  const dA = pickDict(dictRows[0]), dB = pickDict(dictRows[1]);
  // Dicionário sem a linha do campo: o campo não existe ou a sessão não vê o dicionário (comum para quem não é admin)?
  const dictState = async (s: CompareSide, row: Row | undefined, other: Row | undefined): Promise<'ok' | 'missing' | 'hidden' | 'denied' | 'slow'> => {
    const acc = S[s].sc.access.sys_dictionary;
    if (row) return 'ok';
    if (acc === 'timeout' || acc === 'unknown') return 'slow';
    if (!readable(acc)) return 'denied';
    const probe = await q(s, 'sys_dictionary', `name${inT}`, ['sys_id'], 1);
    const seesDict = probe.length > 0 || (await q(s, 'sys_dictionary', '', ['sys_id'], 1)).length > 0;
    if (!seesDict) return 'hidden';
    // Sem a hierarquia deste lado, só confia na ausência se o outro lado achou o campo numa tabela consultada aqui.
    const hierarchyKnown = S[s].sc.access.sys_db_object === 'ok' || (!!other && tables.includes(other.name ?? ''));
    return hierarchyKnown ? 'missing' : 'hidden';
  };
  const [stA, stB] = await Promise.all([dictState('a', dA, dB), dictState('b', dB, dA)]);
  const dictionary: DictionaryComparison = { status: 'same', diffs: [], ...(dA ? { a: dA } : {}), ...(dB ? { b: dB } : {}) };
  const blindDict = (st: string) => st === 'hidden' || st === 'denied' || st === 'slow';
  if (blindDict(stA) || blindDict(stB)) {
    const side: CompareSide = blindDict(stA) ? 'a' : 'b';
    const st = side === 'a' ? stA : stB;
    dictionary.status = 'unknown';
    dictionary.unknown = { side, reason: st as 'hidden' | 'denied' | 'slow' };
  } else if (stA === 'missing' && stB === 'missing') dictionary.status = 'missing_both';
  else if (stA === 'missing') dictionary.status = 'missing_a';
  else if (stB === 'missing') dictionary.status = 'missing_b';
  else if (dA && dB) {
    for (const [col, aspect] of Object.entries(DICT_COLS)) {
      let va = dA[col], vb = dB[col];
      if (va === undefined || vb === undefined) continue;
      if (col === 'active' || col === 'mandatory' || col === 'read_only') { va = va || 'false'; vb = vb || 'false'; }
      const same = col === 'attributes' ? normAttrs(va) === normAttrs(vb) : col === 'max_length' ? Number(va || 0) === Number(vb || 0) : va.trim() === vb.trim();
      if (!same) dictionary.diffs.push({ aspect, col, a: va, b: vb });
    }
    if (dictionary.diffs.length) dictionary.status = 'different';
  }

  // Rótulos (sys_documentation), por idioma, da tabela mais específica.
  const labelsOf = (rows: Row[]) => {
    const out: Record<string, string> = {};
    for (const r of [...rows].sort((x, y) => depth(x.name) - depth(y.name))) if (r.language && r.label && !(r.language in out)) out[r.language] = r.label;
    return out;
  };
  const accDoc = { a: S.a.sc.access.sys_documentation, b: S.b.sc.access.sys_documentation };
  const labels: LabelsComparison = { status: 'same', a: labelsOf(docRows[0]), b: labelsOf(docRows[1]), diffs: [] };
  if (!readable(accDoc.a) || !readable(accDoc.b)) {
    const side: CompareSide = !readable(accDoc.a) ? 'a' : 'b';
    labels.status = 'unknown'; labels.unknown = { side, reason: blindReason(accDoc[side]) };
  } else if (dictionary.status !== 'missing_a' && dictionary.status !== 'missing_b') {
    for (const lang of [...new Set([...Object.keys(labels.a), ...Object.keys(labels.b)])]) {
      const la = labels.a[lang], lb = labels.b[lang];
      if ((la ?? '').trim() !== (lb ?? '').trim()) labels.diffs.push({ lang, ...(la !== undefined ? { a: la } : {}), ...(lb !== undefined ? { b: lb } : {}) });
    }
    if (labels.diffs.length) labels.status = 'different';
  }

  // Opções (sys_choice): por valor (e valor dependente), da tabela mais específica; rótulo em inglês ou no idioma pedido.
  const choiceLang = opts.language && opts.language !== 'en' ? opts.language : 'en';
  const choicesOf = (rows: Row[]): ChoiceInfo[] => {
    const best = new Map<string, Row>();
    const top = Math.min(99, ...rows.map((r) => depth(r.name)));
    for (const r of rows.filter((x) => depth(x.name) === top).sort((x, y) => Number(x.language !== choiceLang) - Number(y.language !== choiceLang) || Number(x.language !== 'en') - Number(y.language !== 'en'))) {
      const k = `${r.dependent_value ?? ''}|${r.value ?? ''}`;
      if (!best.has(k)) best.set(k, r);
    }
    return [...best.values()].map((r) => ({ value: r.value ?? '', ...(r.label ? { label: r.label } : {}), inactive: r.inactive === 'true', ...(r.sequence !== undefined ? { sequence: r.sequence } : {}), ...(r.dependent_value ? { dependentValue: r.dependent_value } : {}) }))
      .sort((x, y) => Number(x.sequence ?? 0) - Number(y.sequence ?? 0) || x.value.localeCompare(y.value));
  };
  const accCh = { a: S.a.sc.access.sys_choice, b: S.b.sc.access.sys_choice };
  const choices: ChoicesComparison = { status: 'same', a: choicesOf(choiceRows[0]), b: choicesOf(choiceRows[1]), onlyA: [], onlyB: [], changed: [] };
  if (!readable(accCh.a) || !readable(accCh.b)) {
    const side: CompareSide = !readable(accCh.a) ? 'a' : 'b';
    choices.status = 'unknown'; choices.unknown = { side, reason: blindReason(accCh[side]) };
  } else if (dictionary.status !== 'missing_a' && dictionary.status !== 'missing_b') {
    const ck = (c: ChoiceInfo) => `${c.dependentValue ?? ''}|${c.value}`;
    const mb = new Map(choices.b.map((c) => [ck(c), c])), ma = new Map(choices.a.map((c) => [ck(c), c]));
    choices.onlyA = choices.a.filter((c) => !mb.has(ck(c)));
    choices.onlyB = choices.b.filter((c) => !ma.has(ck(c)));
    for (const ca of choices.a) {
      const cb = mb.get(ck(ca));
      if (!cb) continue;
      const diffs: ChoicesComparison['changed'][number]['diffs'] = [];
      if (ca.inactive !== cb.inactive) diffs.push({ col: 'inactive', a: String(ca.inactive), b: String(cb.inactive) });
      if ((ca.label ?? '') !== (cb.label ?? '')) diffs.push({ col: 'label', ...(ca.label !== undefined ? { a: ca.label } : {}), ...(cb.label !== undefined ? { b: cb.label } : {}) });
      if (ca.sequence !== undefined && cb.sequence !== undefined && Number(ca.sequence || 0) !== Number(cb.sequence || 0)) diffs.push({ col: 'sequence', a: ca.sequence, b: cb.sequence });
      if (diffs.length) choices.changed.push({ value: ca.value, ...(ca.label ? { label: ca.label } : {}), diffs });
    }
    if (choices.onlyA.length || choices.onlyB.length || choices.changed.length) choices.status = 'different';
  }

  // ---------- 3. versões do que difere ----------
  const newerOf = (x?: string, y?: string): CompareSide | 'same' | undefined => (!x || !y ? undefined : x === y ? 'same' : x > y ? 'a' : 'b');
  for (const r of rules) if (r.status === 'different') { const n = newerOf(r.a?.updatedOn, r.b?.updatedOn); if (n) r.newer = n; }
  if (dictionary.status === 'different') { const n = newerOf(dA?.sys_updated_on, dB?.sys_updated_on); if (n) dictionary.newer = n; }
  if (opts.versions !== false) {
    const wanted: { a: string[]; b: string[] } = { a: [], b: [] };
    const updName = (art: string, s?: RuleSnapshot) => (s ? `${art}_${s.sysId}` : undefined);
    const dictName = (d?: Row) => (d?.name ? `sys_dictionary_${d.name}_${field}` : undefined);
    for (const r of rules.filter((x) => x.status === 'different')) {
      const na = updName(r.art, r.a), nb = updName(r.art, r.b);
      if (na) wanted.a.push(na);
      if (nb) wanted.b.push(nb);
    }
    if (dictionary.status === 'different') { const na = dictName(dA), nb = dictName(dB); if (na) wanted.a.push(na); if (nb) wanted.b.push(nb); }
    const [verA, verB] = await both((s) => readVersions(S[s].sc, wanted[s]));
    for (const r of rules.filter((x) => x.status === 'different')) {
      const va = r.a && verA.get(`${r.art}_${r.a.sysId}`), vb = r.b && verB.get(`${r.art}_${r.b.sysId}`);
      if (va || vb) r.versions = { ...(va ? { a: va } : {}), ...(vb ? { b: vb } : {}) };
    }
    if (dictionary.status === 'different') {
      const va = verA.get(dictName(dA) ?? ''), vb = verB.get(dictName(dB) ?? '');
      if (va || vb) dictionary.versions = { ...(va ? { a: va } : {}), ...(vb ? { b: vb } : {}) };
    }
  }

  // ---------- 4. o que não deu para comparar ----------
  const relevant = new Set([...Object.keys(SOURCE_CATEGORY)]);
  const notCompared: NotCompared[] = [];
  const pushNC = (side: CompareSide, what: string, reason: NotCompared['reason'], t: string) => {
    const prev = notCompared.find((x) => x.side === side && x.what === what);
    if (prev) { if (!prev.tables.includes(t)) prev.tables.push(t); return; }
    notCompared.push({ side, what, reason, tables: [t] });
  };
  for (const s of ['a', 'b'] as const) {
    for (const [t, acc] of Object.entries(S[s].sc.access)) {
      if (!relevant.has(t) || readable(acc)) continue;
      pushNC(s, SOURCE_CATEGORY[t]!, blindReason(acc), t);
    }
    const hier = S[s].sc.access.sys_db_object;
    if (hier !== 'ok' && !notCompared.some((x) => x.side === s && x.what === 'hierarchy')) pushNC(s, 'hierarchy', hier === 'empty' ? 'hidden' : blindReason(hier), 'sys_db_object');
  }
  if (dictionary.unknown?.reason === 'hidden') pushNC(dictionary.unknown.side, 'dictionary', 'hidden', 'sys_dictionary');
  const unreachable = (['a', 'b'] as const).filter((s) => { const v = Object.values(S[s].sc.access); return v.length > 0 && !v.some(readable); });

  // ---------- 5. diferenças ordenadas ----------
  const differences: Difference[] = [];
  if (dictionary.status === 'missing_a' || dictionary.status === 'missing_b') differences.push({ code: 'field_missing', weight: 110, side: dictionary.status === 'missing_a' ? 'b' : 'a' });
  rules.forEach((r, i) => {
    if (r.status === 'only_a' || r.status === 'only_b') {
      const s = r.status === 'only_a' ? r.a : r.b;
      const active = s?.active ?? true;
      differences.push({ code: 'rule_only', weight: active ? 100 : 15, side: r.status === 'only_a' ? 'a' : 'b', rule: i, active });
      return;
    }
    if (r.status !== 'different') return;
    const act = r.diffs.find((d) => d.aspect === 'active');
    if (act) { differences.push({ code: 'rule_active', weight: 100, side: act.a === 'false' ? 'b' : 'a', rule: i }); return; }
    const byAspect = new Map<DiffAspect, FieldDiff[]>();
    for (const d of r.diffs) (byAspect.get(d.aspect) ?? byAspect.set(d.aspect, []).get(d.aspect)!).push(d);
    for (const [aspect, ds] of byAspect) {
      const d0 = ds[0]!;
      differences.push({ code: ASPECT_CODE[aspect], weight: ASPECT_WEIGHT[aspect], rule: i, col: ds.map((d) => d.col).join(','), ...(d0.a !== undefined ? { a: d0.a } : {}), ...(d0.b !== undefined ? { b: d0.b } : {}), ...(d0.diff ? { diff: d0.diff } : {}) });
    }
  });
  for (const d of dictionary.diffs) {
    const bool = d.col === 'active' || d.col === 'mandatory' || d.col === 'read_only';
    differences.push({ code: 'dict', weight: DICT_WEIGHT[d.col] ?? 30, col: d.col, ...(d.a !== undefined ? { a: d.a } : {}), ...(d.b !== undefined ? { b: d.b } : {}), ...(bool ? { side: d.a === 'true' ? 'a' as const : 'b' as const } : {}) });
  }
  for (const c of choices.onlyA) differences.push({ code: 'choice_only', weight: c.inactive ? 15 : 80, side: 'a', value: c.value, ...(c.label ? { label: c.label } : {}) });
  for (const c of choices.onlyB) differences.push({ code: 'choice_only', weight: c.inactive ? 15 : 80, side: 'b', value: c.value, ...(c.label ? { label: c.label } : {}) });
  for (const c of choices.changed) for (const d of c.diffs) {
    const code: DifferenceCode = d.col === 'inactive' ? 'choice_inactive' : d.col === 'label' ? 'choice_label' : 'choice_order';
    differences.push({ code, weight: code === 'choice_inactive' ? 80 : 10, value: c.value, ...(c.label ? { label: c.label } : {}), ...(d.a !== undefined ? { a: d.a } : {}), ...(d.b !== undefined ? { b: d.b } : {}), ...(code === 'choice_inactive' ? { side: d.a === 'true' ? 'b' as const : 'a' as const } : {}) });
  }
  for (const l of labels.diffs) differences.push({ code: 'label', weight: 10, lang: l.lang, ...(l.a !== undefined ? { a: l.a } : {}), ...(l.b !== undefined ? { b: l.b } : {}) });
  differences.sort((x, y) => y.weight - x.weight);

  // Rótulos dos campos citados nas condições que diferem (para o texto).
  let fieldLabels: Record<string, string> | undefined;
  if (opts.language !== undefined) {
    const fs = new Set<string>([field]);
    for (const d of differences) if (d.code === 'rule_condition') for (const f of [...conditionFields(d.a), ...conditionFields(d.b)]) fs.add(f);
    const side: CompareSide = unreachable.includes('a') ? 'b' : 'a';
    fieldLabels = (await resolveDisplay((t, query, fields, limit) => q(side, t, query, fields, limit), tables, Object.fromEntries([...fs].map((f) => [f, []])), opts.language).catch(() => undefined))?.fields;
  }

  const count = (st: RuleStatus) => rules.filter((r) => r.status === st).length;
  const side = (s: CompareSide, label: string): SideSummary => ({ label, tables: S[s].tables, access: { ...S[s].sc.access }, denied: S[s].sc.denied(), slow: S[s].sc.slow(), calls: S[s].sc.calls });
  return {
    table, field, a: side('a', a.label), b: side('b', b.label), rules, definition: { dictionary, labels, choices }, differences, notCompared, unreachable,
    counts: { onlyA: count('only_a'), onlyB: count('only_b'), different: count('different'), same: count('same'), unknown: count('unknown') },
    ...(fieldLabels ? { fieldLabels } : {}),
    timing: { totalMs: Date.now() - started, calls: { a: S.a.sc.calls, b: S.b.sc.calls } },
  };
}

/** Update set de origem por nome do registro de atualização: sys_update_xml (sem payload) e, na falta, sys_update_version. */
async function readVersions(sc: SharedClient, names: string[]): Promise<Map<string, VersionInfo>> {
  const out = new Map<string, VersionInfo>();
  const uniq = [...new Set(names)].filter((n) => /^[a-z0-9_]+$/.test(n));
  if (!uniq.length) return out;
  const xml = (await sc.query({ table: 'sys_update_xml', query: `nameIN${uniq.join(',')}^ORDERBYDESCsys_updated_on`, fields: ['name', 'update_set.name', 'sys_updated_on', 'sys_updated_by'], limit: 100 })).rows;
  for (const r of [...xml].sort((x, y) => (y.sys_updated_on ?? '').localeCompare(x.sys_updated_on ?? ''))) {
    if (!r.name || out.has(r.name)) continue;
    out.set(r.name, { name: r.name, ...(r['update_set.name'] ? { updateSet: r['update_set.name'] } : {}), ...(r.sys_updated_on ? { at: r.sys_updated_on } : {}), ...(r.sys_updated_by ? { by: r.sys_updated_by } : {}), from: 'sys_update_xml' });
  }
  const rest = uniq.filter((n) => !out.has(n));
  if (!rest.length) return out;
  const vers = (await sc.query({ table: 'sys_update_version', query: `nameIN${rest.join(',')}^state=current`, fields: ['name', 'source_table', 'source', 'sys_recorded_at', 'sys_created_on', 'sys_created_by'], limit: 100 })).rows;
  const setIds = [...new Set(vers.filter((v) => v.source_table === 'sys_update_set' && v.source).map((v) => v.source!))];
  const sets = setIds.length ? (await sc.query({ table: 'sys_update_set', query: `sys_idIN${setIds.join(',')}`, fields: ['sys_id', 'name'], limit: setIds.length })).rows : [];
  const setName = new Map(sets.map((s) => [s.sys_id ?? '', s.name ?? '']));
  for (const v of vers) {
    if (!v.name || out.has(v.name)) continue;
    const us = v.source_table === 'sys_update_set' ? setName.get(v.source ?? '') : undefined;
    const at = v.sys_recorded_at || v.sys_created_on;
    out.set(v.name, { name: v.name, ...(us ? { updateSet: us } : {}), ...(at ? { at } : {}), ...(v.sys_created_by ? { by: v.sys_created_by } : {}), from: 'sys_update_version' });
  }
  return out;
}

// ---------------------------------------------------------------- texto simples

const NOUN: Record<CompareLang, Record<string, string>> = {
  pt: { sys_script: 'a regra', sys_script_client: 'o client script', sys_ui_policy: 'a UI policy', sys_data_policy2: 'a data policy', sys_ui_action: 'o botão', sys_script_include: 'o script include',
    sysrule_assignment: 'a regra de atribuição', sysevent_email_action: 'a notificação', contract_sla: 'o SLA', sys_hub_flow: 'o flow', dl_definition: 'o data lookup', sysauto_script: 'o job agendado',
    sys_transform_map: 'o transform map', sys_dictionary_override: 'o override do dicionário' },
  en: { sys_script: 'the business rule', sys_script_client: 'the client script', sys_ui_policy: 'the UI policy', sys_data_policy2: 'the data policy', sys_ui_action: 'the button', sys_script_include: 'the script include',
    sysrule_assignment: 'the assignment rule', sysevent_email_action: 'the notification', contract_sla: 'the SLA', sys_hub_flow: 'the flow', dl_definition: 'the data lookup', sysauto_script: 'the scheduled job',
    sys_transform_map: 'the transform map', sys_dictionary_override: 'the dictionary override' },
};
const FEM_PT = new Set(['sys_script', 'sys_ui_policy', 'sys_data_policy2', 'sysrule_assignment', 'sysevent_email_action']);

const CATEGORY: Record<CompareLang, Record<string, string>> = {
  pt: { business_rules: 'regras de negócio', client_scripts: 'client scripts', ui_policies: 'UI policies', data_policies: 'data policies', ui_actions: 'botões', script_includes: 'script includes',
    assignment_rules: 'regras de atribuição', notifications: 'notificações', slas: 'SLAs', flows: 'flows', data_lookups: 'data lookups', scheduled_jobs: 'jobs agendados', transform_maps: 'transform maps',
    dictionary_overrides: 'overrides do dicionário', dictionary: 'definição do campo (dicionário)', labels: 'rótulos do campo', choices: 'opções da lista', hierarchy: 'hierarquia da tabela' },
  en: { business_rules: 'business rules', client_scripts: 'client scripts', ui_policies: 'UI policies', data_policies: 'data policies', ui_actions: 'buttons', script_includes: 'script includes',
    assignment_rules: 'assignment rules', notifications: 'notifications', slas: 'SLAs', flows: 'flows', data_lookups: 'data lookups', scheduled_jobs: 'scheduled jobs', transform_maps: 'transform maps',
    dictionary_overrides: 'dictionary overrides', dictionary: 'field definition (dictionary)', labels: 'field labels', choices: 'choice list', hierarchy: 'table hierarchy' },
};

const DICT_TEXT: Record<CompareLang, Record<string, string>> = {
  pt: { internal_type: 'o tipo do campo', reference: 'a tabela de referência', default_value: 'o valor padrão', dependent: 'o campo do qual depende', dependent_on_field: 'o campo do qual depende', max_length: 'o tamanho máximo', attributes: 'os atributos' },
  en: { internal_type: 'the field type', reference: 'the reference table', default_value: 'the default value', dependent: 'the field it depends on', dependent_on_field: 'the field it depends on', max_length: 'the max length', attributes: 'the attributes' },
};

/** Ações de policy ("campo: disabled=true, ...; ...") em texto, só dos campos que diferem entre os lados. */
function humanActions(a: string | undefined, b: string | undefined, lang: CompareLang, labels: Record<string, string>): { a: string; b: string } {
  const pt = lang === 'pt';
  const parse = (x: string | undefined) => new Map((x ?? '').split('; ').filter(Boolean).map((e) => { const i = e.indexOf(': '); return [e.slice(0, i), e.slice(i + 2)] as const; }));
  const ma = parse(a), mb = parse(b);
  const WORDS: Record<string, [string, string]> = pt
    ? { disabled: ['bloqueia', 'libera'], read_only: ['bloqueia', 'libera'], mandatory: ['obriga', 'tira a obrigação de'], visible: ['mostra', 'esconde'] }
    : { disabled: ['locks', 'unlocks'], read_only: ['locks', 'unlocks'], mandatory: ['requires', 'makes optional'], visible: ['shows', 'hides'] };
  const text = (field: string, spec: string | undefined) => {
    if (spec === undefined) return pt ? `nada em ${labels[field] || field}` : `nothing on ${labels[field] || field}`;
    const acts = spec.split(', ').map((kv) => kv.split('=')).filter(([k, v]) => WORDS[k!] && (v === 'true' || v === 'false')).map(([k, v]) => `${WORDS[k!]![v === 'true' ? 0 : 1]} ${labels[field] || field}`);
    return acts.length ? acts.join(pt ? ' e ' : ' and ') : pt ? `nada em ${labels[field] || field}` : `nothing on ${labels[field] || field}`;
  };
  const fields = [...new Set([...ma.keys(), ...mb.keys()])].filter((f) => ma.get(f) !== mb.get(f));
  return { a: fields.map((f) => text(f, ma.get(f))).join(', '), b: fields.map((f) => text(f, mb.get(f))).join(', ') };
}

/** Uma frase curta por diferença. */
export function describeDifference(c: InstanceComparison, d: Difference, lang: CompareLang = 'pt'): string {
  const pt = lang === 'pt';
  const L = { a: c.a.label, b: c.b.label };
  const r = d.rule !== undefined ? c.rules[d.rule] : undefined;
  const lbl = c.fieldLabels ?? {};
  const cond = (q: string | undefined) => {
    let t = humanQuery(q, lang) || (pt ? 'sem condição' : 'no condition');
    for (const f of conditionFields(q)) if (lbl[f]) t = t.replace(new RegExp(`(^|[\\s(])${f}(?=\\s)`, 'g'), `$1${lbl[f]}`);
    return t;
  };
  const ref = r ? `${NOUN[lang][r.art] ?? (pt ? 'o artefato' : 'the artifact')} '${r.name}'` : '';
  const fem = r ? FEM_PT.has(r.art) : false;
  const v = (x?: string) => (x === undefined || x === '' ? (pt ? '(vazio)' : '(empty)') : x);
  const both = (a?: string, b?: string) => `(${L.a}: ${v(a)}; ${L.b}: ${v(b)})`;
  const fname = lbl[c.field] ? (pt ? `o campo '${lbl[c.field]}'` : `the field '${lbl[c.field]}'`) : pt ? 'o campo' : 'the field';
  switch (d.code) {
    case 'field_missing': return pt ? `${fname} só existe em ${L[d.side!]}` : `${fname} exists only in ${L[d.side!]}`;
    case 'rule_only':
      return d.active
        ? (pt ? `${ref} existe e está ${fem ? 'ativa' : 'ativo'} só em ${L[d.side!]}` : `${ref} exists and is active only in ${L[d.side!]}`)
        : (pt ? `${ref} existe só em ${L[d.side!]}, mas está ${fem ? 'inativa' : 'inativo'}` : `${ref} exists only in ${L[d.side!]}, but is inactive`);
    case 'rule_active': return pt ? `${ref} está ${fem ? 'ativa' : 'ativo'} só em ${L[d.side!]}` : `${ref} is active only in ${L[d.side!]}`;
    case 'rule_condition': return pt ? `${ref} tem condição diferente (${L.a}: ${cond(d.a)}; ${L.b}: ${cond(d.b)})` : `${ref} has a different condition (${L.a}: ${cond(d.a)}; ${L.b}: ${cond(d.b)})`;
    case 'rule_when': return pt ? `${ref} roda em momento diferente ${both(d.a, d.b)}` : `${ref} runs at a different time ${both(d.a, d.b)}`;
    case 'rule_actions': {
      const h = d.col === 'sys_ui_policy_action' || d.col === 'sys_data_policy_rule' ? humanActions(d.a, d.b, lang, lbl) : { a: d.a, b: d.b };
      return pt ? `${ref} faz coisas diferentes ${both(h.a, h.b)}` : `${ref} does different things ${both(h.a, h.b)}`;
    }
    case 'rule_script': {
      const df = d.diff;
      const lines = (s: CompareSide) => [...new Set((df?.lines ?? []).filter((x) => x.side === s).map((x) => x.n))].slice(0, 4).join(', ');
      const la = lines('a'), lb = lines('b');
      const where = [la ? `${L.a} ${pt ? 'linha' : 'line'}${la.includes(',') ? 's' : ''} ${la}` : '', lb ? `${L.b} ${pt ? 'linha' : 'line'}${lb.includes(',') ? 's' : ''} ${lb}` : ''].filter(Boolean).join('; ');
      return pt ? `${ref} tem script diferente${where ? ` (${where})` : ''}` : `${ref} has a different script${where ? ` (${where})` : ''}`;
    }
    case 'rule_order': return pt ? `${ref} roda em outra ordem ${both(d.a, d.b)}` : `${ref} runs in a different order ${both(d.a, d.b)}`;
    case 'rule_other': return pt ? `${ref} tem configuração diferente ${both(d.a, d.b)}` : `${ref} has a different setting ${both(d.a, d.b)}`;
    case 'dict': {
      if (d.col === 'mandatory') return pt ? `${fname} é obrigatório só em ${L[d.side!]}` : `${fname} is mandatory only in ${L[d.side!]}`;
      if (d.col === 'read_only') return pt ? `${fname} é somente leitura só em ${L[d.side!]}` : `${fname} is read-only only in ${L[d.side!]}`;
      if (d.col === 'active') return pt ? `${fname} está ativo só em ${L[d.side!]}` : `${fname} is active only in ${L[d.side!]}`;
      const what = DICT_TEXT[lang][d.col ?? ''] ?? d.col;
      return pt ? `${what} é diferente ${both(d.a, d.b)}` : `${what} is different ${both(d.a, d.b)}`;
    }
    case 'choice_only': return pt ? `a opção '${d.label ? `${d.label} (${d.value})` : d.value}' existe só em ${L[d.side!]}` : `the choice '${d.label ? `${d.label} (${d.value})` : d.value}' exists only in ${L[d.side!]}`;
    case 'choice_inactive': return pt ? `a opção '${d.label ?? d.value}' está ativa só em ${L[d.side!]}` : `the choice '${d.label ?? d.value}' is active only in ${L[d.side!]}`;
    case 'choice_label': return pt ? `o texto da opção '${d.value}' é diferente ${both(d.a, d.b)}` : `the text of choice '${d.value}' is different ${both(d.a, d.b)}`;
    case 'choice_order': return pt ? `a opção '${d.label ?? d.value}' está em outra posição na lista ${both(d.a, d.b)}` : `the choice '${d.label ?? d.value}' is in a different position ${both(d.a, d.b)}`;
    case 'label': return pt ? `o rótulo do campo (${d.lang}) é diferente ${both(d.a, d.b)}` : `the field label (${d.lang}) is different ${both(d.a, d.b)}`;
  }
}

/** Resumo em texto simples: as diferenças que podem explicar comportamento, depois o resto e o que não deu para comparar. */
export function describeComparison(c: InstanceComparison, lang: CompareLang = 'pt', max = 5): string {
  const pt = lang === 'pt';
  const L = { a: c.a.label, b: c.b.label };
  const parts: string[] = [];
  if (c.unreachable.length) {
    const who = c.unreachable.map((s) => L[s]).join(pt ? ' e ' : ' and ');
    parts.push(pt ? `Não deu para ler ${who}: entre na instância nesta janela do navegador (ou renove a sessão) e tente de novo.` : `Could not read ${who}: sign in to that instance in this browser window (or renew the session) and try again.`);
    if (c.unreachable.length === 2 || !c.differences.length) return parts.join(' ');
  }
  const strong = c.differences.filter((d) => d.weight >= 30);
  const weak = c.differences.filter((d) => d.weight < 30);
  const list = (ds: Difference[]) => {
    const t = ds.slice(0, max).map((d) => describeDifference(c, d, lang));
    const rest = ds.length - t.length;
    return t.join('; ') + (rest > 0 ? (pt ? `; e mais ${rest}` : `; and ${rest} more`) : '');
  };
  if (strong.length) {
    const n = strong.length;
    parts.push(pt ? `${n} ${n === 1 ? 'diferença que pode explicar comportamentos diferentes' : 'diferenças que podem explicar comportamentos diferentes'}: ${list(strong)}.`
      : `${n} ${n === 1 ? 'difference that may explain different behavior' : 'differences that may explain different behavior'}: ${list(strong)}.`);
  } else if (!c.unreachable.length) {
    parts.push(pt ? `Nenhuma diferença de comportamento encontrada entre ${L.a} e ${L.b} neste campo.` : `No behavior difference found between ${L.a} and ${L.b} for this field.`);
  }
  if (weak.length) parts.push(pt ? `Também difere: ${list(weak)}.` : `Also different: ${list(weak)}.`);
  const nc = c.notCompared.filter((x) => !c.unreachable.includes(x.side));
  if (nc.length) {
    const bySide = (['a', 'b'] as const).map((s) => {
      const cats = [...new Set(nc.filter((x) => x.side === s).map((x) => CATEGORY[lang][x.what] ?? x.what))];
      return cats.length ? (pt ? `${cats.join(', ')} (sem acesso em ${L[s]})` : `${cats.join(', ')} (no access in ${L[s]})`) : '';
    }).filter(Boolean);
    parts.push(pt ? `Não deu para comparar: ${bySide.join('; ')}.` : `Could not compare: ${bySide.join('; ')}.`);
  }
  const unknownRules = c.rules.filter((r) => r.status === 'unknown' && !c.unreachable.includes(r.unknown!.side));
  if (unknownRules.length && !nc.length) parts.push(pt ? `${unknownRules.length} regra(s) não puderam ser comparadas.` : `${unknownRules.length} rule(s) could not be compared.`);
  return parts.join(' ');
}
