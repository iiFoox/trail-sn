/**
 * "Por que este campo está bloqueado, obrigatório ou escondido?"
 *
 * Lê, só com GET, as regras que mudam o estado de um campo no formulário e diz quais valem AGORA para este registro:
 *   dicionário (+ override da tabela) → client scripts onLoad → UI policies (em ordem; a de ordem maior vence)
 *   → data policies (valem também ao gravar).
 * Condições das policies são avaliadas com `evalCondition` sobre o registro lido; scripts com `scriptVerdict`.
 * O que não dá para avaliar daqui (javascript:, papéis, dot-walk, onChange) vira "pode ser", nunca certeza.
 *
 * ACLs (sys_security_acl) NÃO são avaliadas: dependem de papéis e scripts do servidor. Quando o formulário mostra o campo
 * bloqueado e nenhuma regra lida explica, o resultado diz isso (`aclNote`).
 */
import type { RestClient } from './client/RestClient';
import { scriptVerdict, type Env } from './scriptEval';
import type { AccessState, Row } from './types';
import { conditionFields, evalCondition, withTimeout } from './util';
import { resolveDisplay } from './display';

export type StateAspect = 'read_only' | 'mandatory' | 'hidden';
export const STATE_ASPECTS: StateAspect[] = ['read_only', 'mandatory', 'hidden'];

/** Estado lido do formulário (g_form, no mundo MAIN). undefined = não deu para ler. */
export interface FieldObserved {
  readOnly?: boolean;
  mandatory?: boolean;
  visible?: boolean;
  /** O campo está no formulário (há elemento para ele). */
  onForm?: boolean;
  /** O campo está vazio no formulário agora (pode diferir do registro gravado). undefined = usa o valor do registro. */
  empty?: boolean;
}

export type StateRuleKind = 'dictionary' | 'dictionary_override' | 'client_script' | 'ui_policy' | 'data_policy';

/** Por que a regra tem (ou pode ter) efeito agora. O painel transforma em texto, nas duas línguas. */
export type StateWhy =
  | 'dict' // definido no dicionário do campo
  | 'override' // sobrescrito no dicionário para esta tabela
  | 'inactive' // campo inativo no dicionário
  | 'always' // policy sem condição: vale sempre
  | 'cond_true' // a condição vale para o registro agora
  | 'cond_false_reverse' // a condição não vale e a policy desfaz as ações ("reverter se falso")
  | 'cond_unknown' // condição que o Trail não avalia (script, OU, campo de outra tabela)
  | 'record_unreadable' // não deu para ler o registro: condição não avaliada
  | 'not_on_load' // a policy não roda ao abrir o formulário; só depois de mudar um campo
  | 'view' // só numa view específica
  | 'onload' // client script ao abrir o formulário, condições valem
  | 'onload_unknown' // client script ao abrir, com condição que o Trail não avalia (ex.: papel)
  | 'onchange' // client script que só roda quando outro campo muda
  | 'value_unknown' // o valor passado não é fixo (variável, expressão)
  | 'policy_script' // vem do script da UI policy (executar script)
  | 'mandatory_empty' // trava o campo, mas no UI16 g_form.setReadOnly não trava campo obrigatório e vazio
  | 'same_order'; // outra regra da mesma camada e com a mesma ordem diz o contrário: não dá para saber qual roda por último

export interface StateRule {
  kind: StateRuleKind;
  name: string;
  /** Tabela do artefato (para o link) e sys_id. */
  table: string;
  sysId?: string;
  /** Tabela da hierarquia onde a regra foi definida (incident, task...). */
  on?: string;
  /** Ordem da UI policy (as outras regras usam a posição da camada). */
  order: number;
  aspect: StateAspect;
  /** true = bloqueia/obriga/esconde; false = libera/tira a obrigação/mostra; undefined = não dá para saber. */
  sets: boolean | undefined;
  grade: 'confirmed' | 'maybe';
  why: StateWhy;
  /** Condição (encoded query) da policy, para mostrar em texto. */
  condition?: string;
  /** Valores atuais dos campos da condição. */
  now?: Record<string, string>;
  /** Campo que dispara o client script onChange. */
  trigger?: string;
  view?: string;
  /** Data policy sem "usar como UI policy": vale ao gravar, não aparece no formulário. */
  serverOnly?: boolean;
  /** Índice (em `rules`) da regra posterior que desfaz esta. */
  overriddenBy?: number;
  /** Motivo original quando `why` virou `mandatory_empty` ou `same_order`. */
  whyBefore?: StateWhy;
}

export interface StateSkip { kind: StateRuleKind; name: string; table: string; sysId?: string; condition?: string; now?: Record<string, string>; why: 'cond_false' | 'not_inherited' }

export interface AspectSummary {
  aspect: StateAspect;
  /** Estado no formulário (undefined = não lido, como no Workspace). */
  observed?: boolean;
  /** O que as regras confirmadas dizem, na ordem. false também quando nenhuma regra confirmada mexe. */
  rules: boolean;
  /** Regra confirmada que decide (índice em `rules`). */
  winner?: number;
  /** Regras "pode ser" que mudariam o resultado. */
  maybe: number[];
  /** Duas regras confirmadas discordam: a de depois (ordem maior) vence. */
  conflicts: { loser: number; winner: number }[];
  /** O formulário mostra ativo e nenhuma regra lida (confirmada ou "pode ser") explica. */
  unexplained: boolean;
  /** O formulário mostra diferente do que as regras confirmadas dizem. */
  mismatch: boolean;
  /**
   * Só em `read_only`: o campo é obrigatório e está vazio, e o formulário (UI16) ignora `setReadOnly(true)` nesse caso.
   * As travas das regras do formulário viram "pode ser" (`why: 'mandatory_empty'`): travam depois que o campo é preenchido.
   */
  mandatoryEmpty?: boolean;
  /**
   * Só em `hidden`: campo de diário (comments, work_notes). O UI16 esconde o elemento de cada um e mostra um campo de
   * notas combinado; o "escondido" lido do formulário não é regra e fica de fora (`observed` some).
   */
  journalCombined?: boolean;
}

export interface FieldStateResult {
  table: string;
  sysId: string;
  field: string;
  tables: string[];
  fieldLabel?: string;
  /** Rótulos de campos citados nas condições. */
  fieldLabels?: Record<string, string>;
  valueLabels?: Record<string, Record<string, string>>;
  refTables?: Record<string, string>;
  observed?: FieldObserved;
  rules: StateRule[];
  skipped: StateSkip[];
  aspects: Record<StateAspect, AspectSummary>;
  /** Estado de cada fonte lida. */
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  /** O dicionário veio vazio: o campo existe, então a sessão não lê sys_dictionary. */
  dictionaryHidden: boolean;
  /** Fontes das regras do formulário negadas: "Seus papéis não deixam ver as regras do formulário". */
  limited: boolean;
  /** Bloqueado no formulário sem regra encontrada: pode ser ACL, que o Trail não verifica. */
  aclNote: boolean;
  recordReadable: boolean;
  timing: { totalMs: number; calls: number };
}

const FORM_SOURCES = ['sys_dictionary', 'sys_dictionary_override', 'sys_ui_policy', 'sys_ui_policy_action', 'sys_data_policy2', 'sys_data_policy_rule', 'sys_script_client'];
const CALL = /g_form\.(setReadOnly|setReadonly|setDisabled|setMandatory|setDisplay|setVisible)\(\s*(['"])([a-z0-9_.]+)\2\s*,/g;
const PSEUDO: Record<StateAspect, string> = { read_only: '__trail_ro__', mandatory: '__trail_mand__', hidden: '__trail_vis__' };
/** Campos de diário OOB que o UI16 mostra no campo de notas combinado. */
const JOURNAL_FIELDS = ['comments', 'work_notes'];
const truth = (v: string | undefined): boolean | undefined => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Um campo. `sysId` pode ser o número do registro (INC0010001). */
export async function fieldState(
  client: RestClient,
  target: { table: string; sysId: string; field: string; observed?: FieldObserved; language?: string },
  opts: { timeoutMs?: number } = {},
): Promise<FieldStateResult> {
  const [one] = await fieldStates(client, { table: target.table, sysId: target.sysId, fields: [{ field: target.field, ...(target.observed ? { observed: target.observed } : {}) }], ...(target.language ? { language: target.language } : {}) }, opts);
  return one!;
}

/**
 * Vários campos do mesmo registro com as mesmas consultas (IN / OU): usado pela lista "Campos bloqueados, obrigatórios
 * ou escondidos agora" do registro inteiro. Até 40 campos por chamada; o resto fica de fora.
 */
export async function fieldStates(
  client: RestClient,
  target: { table: string; sysId: string; fields: { field: string; observed?: FieldObserved }[]; language?: string },
  opts: { timeoutMs?: number } = {},
): Promise<FieldStateResult[]> {
  const started = Date.now();
  const calls0 = client.calls;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const { table } = target;
  const wantedFields = target.fields.filter((x) => /^[a-z0-9_]+$/.test(x.field)).slice(0, 40);
  if (!wantedFields.length) return [];
  const names_ = wantedFields.map((x) => x.field);
  const access: Record<string, AccessState> = {};
  const rank: Record<AccessState, number> = { ok: 0, empty: 1, unknown: 2, timeout: 3, no_filter: 4, denied: 5 };
  const note = (t: string, a: AccessState) => { const prev = access[t]; if (!prev || rank[a] > rank[prev]) access[t] = a; };
  // Cada fonte é opcional: negada, vazia ou lenta vira lacuna, nunca erro. Estourou o prazo: tenta mais uma vez.
  const q = async (t: string, query: string, fields: string[], limit: number, track = true): Promise<Row[]> => {
    const once = () => withTimeout(client.query({ table: t, query, fields, limit }).catch(() => ({ rows: [], status: 0, access: 'unknown' as AccessState })), timeoutMs, { rows: [], status: 0, access: 'timeout' as AccessState });
    let r = await once();
    if (r.access === 'timeout') r = await once();
    if (track) note(t, r.access);
    return r.rows;
  };

  const tables: string[] = [];
  let cur: string | undefined = table;
  for (let i = 0; cur && i < 10; i++) {
    tables.push(cur);
    cur = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1, false))[0]?.['super_class.name'] || undefined;
  }
  const inT = `IN${tables.join(',')}`;
  const inF = `IN${names_.join(',')}`;
  const likeAny = (col: string | string[]) => names_.flatMap((f) => (Array.isArray(col) ? col : [col]).map((c) => `${c}LIKE${f}`)).join('^OR');
  // Registro: pelo sys_id ou, se veio o número, pelo número.
  const byNumber = !/^[0-9a-f]{32}$/.test(target.sysId) && /^[A-Z]{2,}[A-Z0-9]*\d{3,}$/.test(target.sysId);
  const [recRows, dictAll, overridesAll, actionsAll, scriptPols, dpRulesAll, csAll] = await Promise.all([
    // Sem registro (sysId vazio): só o desenho estático (dicionário, overrides, policies e condições), sem avaliar.
    target.sysId ? q(table, byNumber ? `number=${target.sysId}` : `sys_id=${target.sysId}`, [], 1) : Promise.resolve([] as Row[]),
    q('sys_dictionary', `name${inT}^element${inF}`, ['sys_id', 'name', 'element', 'read_only', 'mandatory', 'active', 'attributes', 'column_label', 'internal_type'], 200),
    q('sys_dictionary_override', `name${inT}^element${inF}`, ['sys_id', 'name', 'element', 'base_table', 'read_only_override', 'read_only', 'mandatory_override', 'mandatory', 'attributes_override', 'attributes'], 200),
    q('sys_ui_policy_action', `field${inF}^ui_policy.active=true^ui_policy.table${inT}`, ['sys_id', 'ui_policy', 'field', 'disabled', 'mandatory', 'visible', 'table'], 1000),
    q('sys_ui_policy', `table${inT}^active=true^run_scripts=true^${likeAny(['script_true', 'script_false'])}`, ['sys_id'], 300),
    q('sys_data_policy_rule', `field${inF}^sys_data_policy.active=true^sys_data_policy.model_table${inT}`, ['sys_id', 'sys_data_policy', 'field', 'mandatory', 'disabled', 'read_only', 'table'], 500),
    q('sys_script_client', `table${inT}^active=true^${likeAny('script')}`, ['sys_id', 'name', 'type', 'field', 'table', 'script', 'ui_type', 'global', 'view'], 300),
  ]);
  const polIds = [...new Set([...actionsAll.map((a) => a.ui_policy ?? ''), ...scriptPols.map((p) => p.sys_id ?? '')].filter(Boolean))];
  const dpIds = [...new Set(dpRulesAll.map((r) => r.sys_data_policy ?? '').filter(Boolean))];
  const [pols, dps] = await Promise.all([
    polIds.length ? q('sys_ui_policy', `sys_idIN${polIds.join(',')}^active=true`, ['sys_id', 'short_description', 'table', 'conditions', 'on_load', 'reverse_if_false', 'global', 'view', 'run_scripts', 'script_true', 'script_false', 'ui_type', 'order', 'inherit'], 200) : Promise.resolve([] as Row[]),
    dpIds.length ? q('sys_data_policy2', `sys_idIN${dpIds.join(',')}^active=true`, ['sys_id', 'short_description', 'model_table', 'conditions', 'enforce_ui', 'inherit', 'reverse_if_false'], 100) : Promise.resolve([] as Row[]),
  ]);

  const recordReadable = !!recRows[0];
  const sysId = byNumber ? recRows[0]?.sys_id || target.sysId : target.sysId;
  const record: Record<string, string> = recordReadable ? { ...recRows[0], sys_id: sysId } : {};
  const depth = (t: string | undefined) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const dictionaryHidden = !dictAll.length && access.sys_dictionary === 'empty';
  const denied = Object.entries(access).filter(([, a]) => a === 'denied' || a === 'no_filter').map(([t]) => t);
  const slow = Object.entries(access).filter(([, a]) => a === 'timeout').map(([t]) => t);
  const limited = dictionaryHidden || FORM_SOURCES.some((t) => denied.includes(t));
  const nowOf = (cond: string | undefined) => {
    const fs = conditionFields(cond);
    if (!recordReadable || !fs.length) return undefined;
    return Object.fromEntries(fs.filter((f) => f in record).map((f) => [f, record[f] ?? '']));
  };
  // Policy vale nesta tabela? Definida numa tabela-mãe só vale se herdar.
  const inherits = (on: string | undefined, inherit: string | undefined) => (on ?? table) === table || inherit !== 'false';
  const env: Env = { rec: record, old: record, changed: new Set(), unknownChanges: true };

  const compute = (field: string, observed: FieldObserved | undefined) => {
  const rules: StateRule[] = [];
  const skipped: StateSkip[] = [];
  const dict = dictAll.filter((x) => x.element === field);
  const overrides = overridesAll.filter((x) => x.element === field);
  const actions = actionsAll.filter((x) => x.field === field);
  const dpRules = dpRulesAll.filter((x) => x.field === field);

  // ---------- 1. dicionário (o mais específico da hierarquia) ----------
  const d = [...dict].sort((a, b) => depth(a.name) - depth(b.name))[0];
  if (d) {
    const base = { kind: 'dictionary' as const, name: `${d.name ?? table}.${field}`, table: 'sys_dictionary', ...(d.sys_id ? { sysId: d.sys_id } : {}), on: d.name ?? table, order: 0, grade: 'confirmed' as const };
    if (d.read_only === 'true') rules.push({ ...base, aspect: 'read_only', sets: true, why: 'dict' });
    if (d.mandatory === 'true') rules.push({ ...base, aspect: 'mandatory', sets: true, why: 'dict' });
    if (d.active === 'false') rules.push({ ...base, aspect: 'hidden', sets: true, why: 'inactive' });
  }
  // ---------- 2. override do dicionário para a tabela (o mais específico) ----------
  const ov = [...overrides].sort((a, b) => depth(a.name) - depth(b.name));
  for (const [aspect, flag, val] of [['read_only', 'read_only_override', 'read_only'], ['mandatory', 'mandatory_override', 'mandatory']] as const) {
    const o = ov.find((x) => x[flag] === 'true');
    if (!o) continue;
    rules.push({ kind: 'dictionary_override', name: `${o.name ?? table}.${field}`, table: 'sys_dictionary_override', ...(o.sys_id ? { sysId: o.sys_id } : {}), on: o.name ?? table, order: 1, aspect, sets: o[val] === 'true', grade: 'confirmed', why: 'override' });
  }

  // ---------- chamadas g_form.setReadOnly/setMandatory/setDisplay num script ----------
  /** Para cada aspecto que o script mexe neste campo: o valor (true = ativa) e se as condições valem com certeza. */
  const scriptEffects = (script: string | undefined): { aspect: StateAspect; sets: boolean | undefined; sure: boolean; valueKnown: boolean }[] => {
    if (!script) return [];
    const hits = [...script.matchAll(CALL)].filter((m) => m[3] === field);
    if (!hits.length) return [];
    // Troca cada chamada do campo por um setValue num nome falso por aspecto: assim o leitor de scripts acha as
    // condições (if/else/return) que protegem a chamada e o valor passado, sem código novo de análise.
    let s = script;
    for (const [aspect, methods] of [['read_only', 'setReadOnly|setReadonly|setDisabled'], ['mandatory', 'setMandatory'], ['hidden', 'setDisplay|setVisible']] as const) {
      s = s.replace(new RegExp(String.raw`g_form\.(?:${methods})\(\s*(['"])${field.replace(/\./g, '\\.')}\1\s*,`, 'g'), `g_form.setValue('${PSEUDO[aspect]}',`);
    }
    const out: { aspect: StateAspect; sets: boolean | undefined; sure: boolean; valueKnown: boolean }[] = [];
    for (const aspect of STATE_ASPECTS) {
      const v = scriptVerdict(s, PSEUDO[aspect], env);
      if (!v || !v.writes || v.reachable === false) continue;
      const vals = [...new Set(v.values)];
      const b = vals.length === 1 ? truth(vals[0] === undefined ? undefined : vals[0] === '1' ? 'true' : vals[0] === '0' ? 'false' : vals[0]) : undefined;
      // setDisplay/setVisible(campo, false) esconde: o aspecto "escondido" é o contrário do valor.
      const sets = b === undefined ? undefined : aspect === 'hidden' ? !b : b;
      out.push({ aspect, sets, sure: v.guardsTrue && v.reachable === true && sets !== undefined, valueKnown: sets !== undefined });
    }
    return out;
  };

  // ---------- 3. client scripts (onLoad roda ao abrir; onChange só quando outro campo muda) ----------
  for (const c of csAll) {
    if (c.ui_type === '1') continue; // só celular / portal
    const type = c.type ?? '';
    if (type !== 'onLoad' && type !== 'onChange') continue;
    for (const e of scriptEffects(c.script)) {
      const viewOnly = c.global === 'false' && !!c.view;
      const why: StateWhy = type === 'onChange' ? 'onchange' : !e.valueKnown ? 'value_unknown' : viewOnly ? 'view' : e.sure ? 'onload' : 'onload_unknown';
      rules.push({ kind: 'client_script', name: c.name ?? '?', table: 'sys_script_client', ...(c.sys_id ? { sysId: c.sys_id } : {}), on: c.table ?? table, order: 2, aspect: e.aspect, sets: e.sets,
        grade: type === 'onLoad' && e.sure && !viewOnly ? 'confirmed' : 'maybe', why, ...(type === 'onChange' && c.field ? { trigger: c.field } : {}), ...(viewOnly ? { view: c.view } : {}) });
    }
  }

  // ---------- 4. UI policies, em ordem (a de ordem maior roda depois e vence) ----------
  const ordered = [...pols].sort((a, b) => Number(a.order || 100) - Number(b.order || 100) || (a.short_description ?? '').localeCompare(b.short_description ?? ''));
  for (const p of ordered) {
    if (p.ui_type === '1') continue;
    // Só as policies que mexem neste campo (ação para ele ou chamada no script).
    if (!actions.some((x) => x.ui_policy === p.sys_id) && !(p.run_scripts === 'true' && (scriptEffects(p.script_true).length || scriptEffects(p.script_false).length))) continue;
    const name = p.short_description || 'UI policy';
    const link = { table: 'sys_ui_policy', ...(p.sys_id ? { sysId: p.sys_id } : {}) };
    if (!inherits(p.table, p.inherit)) { skipped.push({ kind: 'ui_policy', name, ...link, why: 'not_inherited' }); continue; }
    const cond = (p.conditions ?? '').trim();
    const blank = !cond || cond === 'EQ' || cond === '^EQ';
    const now = blank ? true : recordReadable ? evalCondition(cond, record) : undefined;
    const reverse = p.reverse_if_false !== 'false';
    const viewOnly = p.global === 'false' && !!p.view;
    const notOnLoad = p.on_load === 'false';
    const extra = { ...(blank ? {} : { condition: cond }), ...(nowOf(cond) ? { now: nowOf(cond)! } : {}), ...(viewOnly ? { view: p.view } : {}) };
    if (now === false && !reverse) { skipped.push({ kind: 'ui_policy', name, ...link, ...(extra.condition ? { condition: extra.condition } : {}), ...(extra.now ? { now: extra.now } : {}), why: 'cond_false' }); continue; }
    const why: StateWhy = notOnLoad ? 'not_on_load' : viewOnly ? 'view' : now === undefined ? (recordReadable ? 'cond_unknown' : 'record_unreadable') : now === false ? 'cond_false_reverse' : blank ? 'always' : 'cond_true';
    const sure = now !== undefined && !notOnLoad && !viewOnly;
    const flip = (b: boolean | undefined) => (b === undefined ? undefined : now === false ? !b : b);
    for (const a of actions.filter((x) => x.ui_policy === p.sys_id)) {
      const ro = truth(a.disabled), md = truth(a.mandatory), vis = truth(a.visible);
      const effects: [StateAspect, boolean | undefined][] = [['read_only', ro], ['mandatory', md], ['hidden', vis === undefined ? undefined : !vis]];
      for (const [aspect, b] of effects) {
        if (b === undefined) continue; // "ignorar": a ação não mexe neste aspecto
        rules.push({ kind: 'ui_policy', name, ...link, on: p.table ?? table, order: Number(p.order || 100), aspect, sets: flip(b), grade: sure ? 'confirmed' : 'maybe', why, ...extra });
      }
    }
    // Script da policy ("executar script"): o do "verdadeiro" quando a condição vale, o do "falso" quando não.
    if (p.run_scripts === 'true') {
      const scripts = now === true ? [p.script_true] : now === false ? [p.script_false] : [p.script_true, p.script_false];
      for (const sc of scripts) for (const e of scriptEffects(sc)) {
        rules.push({ kind: 'ui_policy', name, ...link, on: p.table ?? table, order: Number(p.order || 100), aspect: e.aspect, sets: e.sets, grade: sure && e.sure ? 'confirmed' : 'maybe', why: !e.valueKnown ? 'value_unknown' : sure && !e.sure ? 'policy_script' : why, ...extra });
      }
    }
  }

  // ---------- 5. data policies (valem ao gravar; com "usar como UI policy", também no formulário) ----------
  for (const p of dps) {
    if (!dpRules.some((x) => x.sys_data_policy === p.sys_id)) continue;
    const name = p.short_description || 'Data policy';
    const link = { table: 'sys_data_policy2', ...(p.sys_id ? { sysId: p.sys_id } : {}) };
    if (!inherits(p.model_table, p.inherit)) { skipped.push({ kind: 'data_policy', name, ...link, why: 'not_inherited' }); continue; }
    const cond = (p.conditions ?? '').trim();
    const blank = !cond || cond === 'EQ' || cond === '^EQ';
    const now = blank ? true : recordReadable ? evalCondition(cond, record) : undefined;
    const extra = { ...(blank ? {} : { condition: cond }), ...(nowOf(cond) ? { now: nowOf(cond)! } : {}) };
    // Data policy não "libera" quando a condição é falsa: só não se aplica.
    if (now === false) { skipped.push({ kind: 'data_policy', name, ...link, ...extra, why: 'cond_false' }); continue; }
    const serverOnly = p.enforce_ui === 'false';
    const why: StateWhy = now === undefined ? (recordReadable ? 'cond_unknown' : 'record_unreadable') : blank ? 'always' : 'cond_true';
    for (const r of dpRules.filter((x) => x.sys_data_policy === p.sys_id)) {
      // O campo "somente leitura" da regra de data policy aparece como `disabled` (e em algumas versões `read_only`).
      const ro = truth(r.disabled) ?? truth(r.read_only), md = truth(r.mandatory);
      for (const [aspect, b] of [['read_only', ro], ['mandatory', md]] as [StateAspect, boolean | undefined][]) {
        if (b === undefined) continue;
        rules.push({ kind: 'data_policy', name, ...link, on: p.model_table ?? table, order: 4, aspect, sets: b, grade: now === undefined ? 'maybe' : 'confirmed', why, ...extra, ...(serverOnly ? { serverOnly: true } : {}) });
      }
    }
  }

  // ---------- veredito por aspecto, na ordem em que o formulário aplica ----------
  const layer = (r: StateRule) => (r.kind === 'dictionary' ? 0 : r.kind === 'dictionary_override' ? 1 : r.kind === 'client_script' ? (r.why === 'onchange' ? 6 : 2) : r.kind === 'ui_policy' ? 3 : 5);
  const seq = rules.map((r, i) => ({ r, i })).sort((a, b) => layer(a.r) - layer(b.r) || a.r.order - b.r.order || a.i - b.i);
  // Diário (journal): no UI16, comments e work_notes aparecem juntos no campo de notas e o elemento de cada um fica
  // escondido. Sem ler o dicionário (itil), vale pelo nome.
  const journal = d?.internal_type ? /^journal/.test(d.internal_type) : JOURNAL_FIELDS.includes(field);
  const journalCombined = journal && observed?.visible === false && observed.onForm !== false;
  const obsOf: Record<StateAspect, boolean | undefined> = {
    read_only: observed?.readOnly,
    mandatory: observed?.mandatory,
    // Fora do layout do formulário não é regra: fica sem estado observado. Diário escondido também (campo combinado).
    hidden: observed?.visible === undefined || observed.onForm === false || journalCombined ? undefined : !observed.visible,
  };
  const aspects = {} as Record<StateAspect, AspectSummary>;
  // Valor vazio agora: o do formulário quando lido; senão o do registro gravado.
  const empty = observed?.empty ?? (recordReadable && field in record ? (record[field] ?? '') === '' : undefined);
  // Obrigatório primeiro: no UI16, g_form.setReadOnly(campo, true) não trava campo obrigatório e vazio (visto no PDI em
  // 21/10/2026 com o Caller). Vale para o que passa pelo g_form (client script, UI policy, data policy no formulário);
  // o somente leitura do dicionário vem do servidor e continua valendo.
  for (const aspect of ['mandatory', 'read_only', 'hidden'] as StateAspect[]) {
    let mandatoryEmpty = false;
    if (aspect === 'read_only' && empty === true && (aspects.mandatory.observed ?? aspects.mandatory.rules)) {
      for (const r of rules) {
        if (r.aspect !== 'read_only' || r.sets !== true || r.grade !== 'confirmed' || layer(r) <= 1 || r.serverOnly) continue;
        mandatoryEmpty = true;
        r.whyBefore = r.why; r.why = 'mandatory_empty'; r.grade = 'maybe';
      }
    }
    // Mesma camada e mesma ordem, valores opostos: o formulário não garante qual roda por último. No PDI (21/10/2026),
    // a OOB "Make fields read-only on close" (ordem 100, condição falsa, reverte = libera) e a [PT] VAL-FS A (ordem 100,
    // trava por script) disputavam o Caller; o formulário travou, e o motor dava "livre" só pela ordem da consulta.
    const tied = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.aspect === aspect && r.grade === 'confirmed' && r.sets !== undefined && layer(r) > 1);
    const ties = new Set<StateRule>();
    for (const a of tied) for (const b of tied) if (a.i < b.i && layer(a.r) === layer(b.r) && a.r.order === b.r.order && a.r.sets !== b.r.sets) { ties.add(a.r); ties.add(b.r); }
    for (const r of ties) { r.whyBefore = r.why; r.why = 'same_order'; r.grade = 'maybe'; }
    let state: boolean | undefined; let winner: number | undefined;
    const maybe: number[] = []; const conflicts: AspectSummary['conflicts'] = [];
    for (const { r, i } of seq) {
      if (r.aspect !== aspect) continue;
      if (r.grade !== 'confirmed' || r.sets === undefined) { maybe.push(i); continue; }
      if (winner !== undefined && state !== r.sets) {
        // O que o dicionário torna somente leitura ou obrigatório, regra do formulário não desfaz: o dicionário prevalece.
        if (state === true && layer(rules[winner]!) <= 1 && layer(r) > 1) { r.overriddenBy = winner; conflicts.push({ loser: i, winner }); continue; }
        rules[winner]!.overriddenBy = i; conflicts.push({ loser: winner, winner: i });
      }
      state = r.sets; winner = i;
    }
    const ruleState = state ?? false;
    const obs = obsOf[aspect];
    const maybeSets = maybe.some((i) => rules[i]!.sets !== false);
    aspects[aspect] = {
      aspect, ...(obs !== undefined ? { observed: obs } : {}), rules: ruleState, ...(winner !== undefined ? { winner } : {}), maybe, conflicts,
      unexplained: obs === true && !ruleState && !maybeSets,
      mismatch: obs !== undefined && obs !== ruleState && maybe.length === 0,
      ...(mandatoryEmpty ? { mandatoryEmpty } : {}),
      ...(aspect === 'hidden' && journalCombined ? { journalCombined } : {}),
    };
  }

  return { field, observed, rules, skipped, aspects, dictLabel: d?.column_label };
  };
  const parts = wantedFields.map((x) => compute(x.field, x.observed));

  // Rótulos dos campos e dos campos citados nas condições, com o texto dos valores atuais (uma consulta para todos).
  const wanted: Record<string, (string | undefined)[]> = Object.fromEntries(names_.map((f) => [f, []]));
  for (const pt of parts) for (const r of [...pt.rules, ...pt.skipped]) for (const [f, v] of Object.entries(r.now ?? {})) (wanted[f] ??= []).push(v);
  const names = await resolveDisplay((t, query, fields, limit) => q(t, query, fields, limit, false), tables, wanted, target.language).catch(() => undefined);
  const timing = { totalMs: Date.now() - started, calls: client.calls - calls0 };

  return parts.map(({ field, observed, rules, skipped, aspects, dictLabel }) => {
    const fieldLabel = names?.fields[field] || dictLabel || undefined;
    return {
      table, sysId, field, tables, ...(fieldLabel ? { fieldLabel } : {}),
      ...(names ? { fieldLabels: names.fields, valueLabels: names.values, refTables: names.refs } : {}),
      ...(observed ? { observed } : {}),
      rules, skipped, aspects, access, denied, slow, dictionaryHidden, limited,
      // Sem ler as regras do formulário (itil), o bloqueio sem explicação é tão provável de ser uma UI policy quanto uma ACL.
      aclNote: aspects.read_only.unexplained && !limited, recordReadable, timing,
    };
  });
}

/** Resumo de uma linha por aspecto ativo (formulário ou regras): qual regra explica, "pode ser" ou nada. */
export interface ActiveState { aspect: StateAspect; observed?: boolean; rule?: StateRule; maybe?: StateRule; unexplained: boolean }
export function activeStates(r: FieldStateResult): ActiveState[] {
  const out: ActiveState[] = [];
  for (const aspect of STATE_ASPECTS) {
    const a = r.aspects[aspect];
    const on = a.observed ?? a.rules;
    if (!on) continue;
    const rule = a.rules && a.winner !== undefined ? r.rules[a.winner] : undefined;
    const maybe = rule ? undefined : a.maybe.map((i) => r.rules[i]!).find((x) => x.sets !== false);
    out.push({ aspect, ...(a.observed !== undefined ? { observed: a.observed } : {}), ...(rule ? { rule } : {}), ...(maybe ? { maybe } : {}), unexplained: !rule && !maybe });
  }
  return out;
}
