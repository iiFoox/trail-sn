/**
 * "Quem enxerga este registro" — o que controla quem vê (ou não vê) um registro, para uma pessoa ou de forma genérica.
 *
 * Fontes (só GET, pelo `SharedClient`, cada uma opcional):
 *  - `sys_script` (when=before, action_query=true, ativas, na hierarquia da tabela e `global`): as regras que filtram a
 *    lista ANTES da consulta ("before query"). O script é lido sem executar (`current.addQuery(...)`,
 *    `addOrCondition`, `addEncodedQuery`, `gs.hasRole(...)`, `gs.getUserID()`, `getMyGroups()`); o que não der para ler
 *    vira "pode restringir (script não avaliado)".
 *  - `sys_security_acl` (operação read, tipo record, ativas; chaves `tabela`, `tabela.*`, `tabela.campo`, na
 *    hierarquia e `*`) + `sys_security_acl_role` (papéis de cada ACL). Condição avaliada sobre o registro; script NÃO é
 *    avaliado ("depende de script"). `admin_overrides` e `decision_type` (deny = "nega a menos que") quando existem.
 *  - Para a pessoa: `sys_user` (por sys_id ou user_name), `sys_user_has_role` (papéis efetivos; `inherited` diz os
 *    herdados de grupo ou de papel contido; só `state` vazio ou `active`), `sys_user_grmember` (grupos).
 *  - Domínio (`sys_domain` do registro e da pessoa, quando o campo existe) e, para artigos do conhecimento
 *    (`kb_knowledge`), os critérios de usuário do artigo e da base (`kb_uc_can_read_mtom`, `kb_uc_cannot_read_mtom`,
 *    `user_criteria`).
 *
 * Como o ServiceNow combina (e como o resultado explica):
 *  - ACLs da mesma chave: basta passar em UMA (OU). Só vale a chave mais específica que tem regras: `incident` antes de
 *    `task` antes de `*`; no campo, `incident.campo` → `task.campo` → `*.campo` → `incident.*` → `task.*` → `*.*`.
 *  - Dentro de uma ACL: papel E condição E script.
 *  - Nível da tabela E nível dos campos: a linha só aparece se passar na tabela; o conteúdo depende do nível campo.
 *  - ACL "nega a menos que" (decision_type=deny): precisa passar em todas.
 * Quando há script ou condição que não dá para avaliar, o veredito fica em "provável" ou "não dá para afirmar".
 */
import type { RestClient } from './client/RestClient';
import { resolveDisplay, type DisplayNames } from './display';
import { tableHierarchy } from './fieldMap';
import { evalExpr, mask, matchClose, skipWs, stmtEnd } from './scriptEval';
import { shared } from './sharedClient';
import type { AccessState, Row } from './types';
import { isSysId, sameVal } from './util';

// ---------------------------------------------------------------- tipos

export type Tri = boolean | undefined;

export type TermValue =
  | { kind: 'literal'; value: string }
  /** A própria pessoa (gs.getUserID(), javascript:gs.getUserID(), filtro dinâmico "Me"). */
  | { kind: 'me' }
  /** Um dos grupos da pessoa (getMyGroups(), filtro dinâmico "One of My Groups"). */
  | { kind: 'my_groups' }
  /** Valor calculado que o Trail não lê. */
  | { kind: 'unknown'; expr: string };

export interface QueryTerm { field: string; op: string; value: TermValue }
/** Termos ligados por OU. `unknown`: parte do grupo não deu para ler (ex.: addCondition dentro de um OU). */
export interface QueryGroup { terms: QueryTerm[]; unknown?: boolean }

export type GuardAtom =
  | { kind: 'role'; roles: string[]; has: boolean }
  | { kind: 'interactive'; is: boolean }
  | { kind: 'group'; group: string; member: boolean }
  | { kind: 'other'; expr: string; neg: boolean };

/** Condição (if, else, return antecipado ou o campo `condition` da regra) que precisa valer para o filtro entrar. */
export interface QueryGuard {
  cond: string;
  neg: boolean;
  /** A condição em partes legíveis (já com a negação aplicada); undefined = mistura de E e OU, só o texto. */
  atoms?: GuardAtom[];
  join?: 'and' | 'or';
}

export interface QueryBranch {
  guards: QueryGuard[];
  /** Grupos ligados por E; dentro de cada grupo, OU. */
  groups: QueryGroup[];
  /** Com a pessoa: este trecho vale para ela? */
  applies?: Tri;
  /** O registro passa no filtro deste trecho? */
  recordMatches?: Tri;
}

export interface QueryRule {
  name: string;
  sysId?: string;
  /** Tabela da regra (incident, task, global). */
  on: string;
  order: number;
  /** full: script lido inteiro; partial: parte do filtro não é legível; none: script não avaliado. */
  readable: 'full' | 'partial' | 'none';
  branches: QueryBranch[];
  /** Funções que recebem `current` (podem acrescentar filtros que o Trail não vê). */
  delegates: string[];
  /** Com a pessoa: true esconde este registro dela; false não esconde; undefined não dá para saber. */
  hides?: Tri;
}

export type AclLevel = 'table' | 'field';
export interface AclCheck {
  sysId: string;
  /** Chave da ACL: incident, incident.*, incident.caller_id, *. */
  name: string;
  level: AclLevel;
  table: string;
  /** Campo ('*' para todos); só no nível campo. */
  field?: string;
  /** allow = "permite se"; deny = "nega a menos que". */
  decision: 'allow' | 'deny';
  roles: string[];
  /** Os papéis vieram (sys_security_acl_role legível). */
  rolesKnown: boolean;
  condition?: string;
  /** Tem script (avançada): não é avaliado. */
  script: boolean;
  adminOverrides: boolean;
  /** É a chave mais específica com regras (as outras não entram na decisão). */
  used: boolean;
  // ---- com a pessoa (ou só com o registro)
  roleOk?: Tri;
  missingRoles?: string[];
  conditionOk?: Tri;
  /** Valores do registro nos campos da condição. */
  now?: Record<string, string>;
  /** Passa nesta ACL? (papel E condição E script) */
  passes?: Tri;
  /** admin_overrides com uma pessoa admin: passa sem olhar o resto. */
  byAdmin?: boolean;
}

export interface LevelVerdict {
  /** Chave usada na decisão (a mais específica com regras), se houver. */
  key?: string;
  ok: Tri;
  /** Quando ok é undefined: tende a passar (só falta script) ou a falhar. */
  lean?: boolean;
}

export type VisibilityVerdict = 've' | 'nao_ve' | 'provavel_ve' | 'provavel_nao_ve' | 'nao_da_para_afirmar';

export interface VisibilityUser {
  sysId: string;
  userName?: string;
  name?: string;
  active?: boolean;
  domain?: string;
}

export interface UserRoles {
  /** Papéis efetivos (nomes), incluindo herdados. */
  names: string[];
  /** Os que vieram herdados (de grupo ou de papel contido). */
  inherited: string[];
  isAdmin: boolean;
  known: boolean;
  groups: { sysId: string; name?: string }[];
  groupsKnown: boolean;
}

export interface DomainCheck { record?: string; user?: string; ok: Tri }

export interface UcCheck { sysId: string; name?: string; matches: Tri }
export interface KbCheck {
  base?: string;
  baseName?: string;
  workflowState?: string;
  validTo?: string;
  canRead: UcCheck[];
  cannotRead: UcCheck[];
  /** Critérios vieram da base (o artigo não tinha os seus). */
  canFrom: 'article' | 'base' | 'none';
  ok: Tri;
  /** Códigos: kb_not_published, kb_expired, kb_cannot_match, kb_can_none, kb_can_match, kb_criteria_denied, kb_script. */
  why: string[];
}

export interface Visibility {
  table: string;
  sysId: string;
  tables: string[];
  /** Quem foi pedido (como veio) e quem foi achado. */
  asked?: string;
  user?: VisibilityUser;
  userRoles?: UserRoles;
  filters: QueryRule[];
  acls: AclCheck[];
  levels: { table: LevelVerdict; field: LevelVerdict; fields: Record<string, LevelVerdict> };
  domain?: DomainCheck;
  kb?: KbCheck;
  combined: { verdict: VisibilityVerdict; why: string[] };
  /** Rótulos dos campos e textos dos valores citados (para o painel). */
  labels: DisplayNames;
  /** Valores do registro lidos (campos das condições). */
  record?: Record<string, string>;
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  /**
   * Códigos: acl_denied, acl_empty, acl_roles_denied, rules_denied, record_unreadable, user_not_found, user_unreadable,
   * user_inactive, roles_denied, groups_denied, no_table_acl, interactive_assumed, domain_differs, deny_unless,
   * generic (sem pessoa), acl_op_unknown (ACL sem o nome da operação: fica de fora).
   */
  notes: string[];
  timing: { totalMs: number; calls: number };
}

export interface VisibilityOptions {
  /** Campos para checar também as ACLs de campo (`tabela.campo`). O `tabela.*` é checado sempre. */
  fields?: string[];
  timeoutMs?: number;
  /** Idioma dos rótulos (padrão en). */
  language?: string;
}

// ---------------------------------------------------------------- contexto da pessoa

interface Ctx {
  sysId?: string;
  userName?: string;
  roles: Set<string>;
  roleIds: Set<string>;
  rolesKnown: boolean;
  isAdmin: boolean;
  groupIds: Set<string>;
  groupNames: Set<string>;
  groupsKnown: boolean;
  user?: Row;
}

const and3 = (xs: Tri[]): Tri => (xs.some((x) => x === false) ? false : xs.some((x) => x === undefined) ? undefined : true);
const or3 = (xs: Tri[]): Tri => (xs.some((x) => x === true) ? true : xs.some((x) => x === undefined) ? undefined : false);
const not3 = (x: Tri): Tri => (x === undefined ? undefined : !x);

function hasRole(ctx: Ctx | undefined, list: string): Tri {
  if (!ctx || !ctx.rolesKnown) return undefined;
  if (ctx.isAdmin) return true;
  return list.split(',').map((r) => r.trim()).filter(Boolean).some((r) => ctx.roles.has(r));
}

// ---------------------------------------------------------------- leitura de encoded query

const OPS = ['ISNOTEMPTY', 'ISEMPTY', 'STARTSWITH', 'ENDSWITH', 'NOTLIKE', 'LIKE', 'NOT IN', 'IN', 'DYNAMIC', 'SAMEAS', 'NSAMEAS', 'VALCHANGES', 'CHANGESTO', 'CHANGESFROM', '!=', '>=', '<=', '>', '<', '='];
/** Filtros dinâmicos padrão do ServiceNow ("Me" e "One of My Groups"). A conferir no PDI. */
export const DYNAMIC_ME = '90d1921e5f510100a9ad2572f2b477fe';
export const DYNAMIC_MY_GROUPS = 'd6435e965f510100a9ad2572f2b47744';

function valueOf(raw: string): TermValue {
  const v = raw.trim();
  if (/^javascript:\s*(?:gs\.getUserID\(\)|gs\.getUser\(\)\.getID\(\))\s*;?$/.test(v)) return { kind: 'me' };
  if (/^javascript:\s*(?:gs\.getUser\(\)\.)?getMyGroups\(\)(?:\.toString\(\))?\s*;?$/.test(v)) return { kind: 'my_groups' };
  if (/^javascript:/.test(v)) return { kind: 'unknown', expr: v };
  return { kind: 'literal', value: v };
}

function parseTerm(t: string): QueryTerm | undefined {
  const m = t.match(/^([a-z0-9_.]+)(.*)$/);
  if (!m) return undefined;
  const field = m[1]!;
  const rest = m[2]!;
  const op = OPS.find((o) => rest.startsWith(o));
  if (!op) return undefined;
  const raw = rest.slice(op.length);
  if (op === 'DYNAMIC') {
    if (raw === DYNAMIC_ME) return { field, op: '=', value: { kind: 'me' } };
    if (raw === DYNAMIC_MY_GROUPS) return { field, op: 'IN', value: { kind: 'my_groups' } };
    return { field, op: '=', value: { kind: 'unknown', expr: `DYNAMIC${raw}` } };
  }
  return { field, op, value: valueOf(raw) };
}

/** Encoded query em grupos (E entre grupos, OU dentro). `complex`: tem ^NQ ou termo que não deu para ler. */
export function parseEncoded(q: string | undefined): { groups: QueryGroup[]; complex: boolean } {
  const groups: QueryGroup[] = [];
  let complex = false;
  if (!q) return { groups, complex };
  if (q.includes('^NQ')) return { groups: [{ terms: [], unknown: true }], complex: true };
  for (const part of q.split('^')) {
    if (!part || part === 'EQ' || part.startsWith('ORDERBY')) continue;
    // Campos são minúsculos: "OR" maiúsculo no começo é sempre o OU da encoded query.
    const isOr = part.startsWith('OR');
    const or = isOr && groups.length > 0;
    const body = isOr ? part.slice(2) : part;
    const term = parseTerm(body);
    if (!term) { complex = true; (or ? groups[groups.length - 1]! : (groups.push({ terms: [] }), groups[groups.length - 1]!)).unknown = true; continue; }
    if (or) groups[groups.length - 1]!.terms.push(term);
    else groups.push({ terms: [term] });
  }
  return { groups, complex };
}

// ---------------------------------------------------------------- avaliação de termos

function evalTerm(t: QueryTerm, rec: Record<string, string> | undefined, ctx: Ctx | undefined): Tri {
  if (!rec || !(t.field in rec)) return undefined;
  const v = rec[t.field] ?? '';
  if (t.op === 'ISEMPTY') return v === '';
  if (t.op === 'ISNOTEMPTY') return v !== '';
  if (t.value.kind === 'unknown') return undefined;
  let vals: string[];
  if (t.value.kind === 'me') { if (!ctx?.sysId) return undefined; vals = [ctx.sysId]; }
  else if (t.value.kind === 'my_groups') { if (!ctx?.groupsKnown) return undefined; vals = [...ctx.groupIds]; }
  else vals = t.op === 'IN' || t.op === 'NOT IN' ? t.value.value.split(',').map((x) => x.trim()) : [t.value.value];
  const list = t.value.kind === 'my_groups';
  switch (t.op) {
    case '=': return list ? vals.includes(v) : sameVal(v, vals[0]);
    case '!=': return list ? !vals.includes(v) : !sameVal(v, vals[0]);
    case 'IN': return vals.some((x) => sameVal(v, x));
    case 'NOT IN': return !vals.some((x) => sameVal(v, x));
    case 'LIKE': case 'CONTAINS': return vals.some((x) => v.includes(x));
    case 'NOTLIKE': case 'DOES NOT CONTAIN': return !vals.some((x) => v.includes(x));
    case 'STARTSWITH': return v.startsWith(vals[0] ?? '');
    case 'ENDSWITH': return v.endsWith(vals[0] ?? '');
    case '>': case '<': case '>=': case '<=': {
      const a = v, b = vals[0] ?? '';
      const num = /^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b);
      const c = num ? Number(a) - Number(b) : a.localeCompare(b);
      return t.op === '>' ? c > 0 : t.op === '<' ? c < 0 : t.op === '>=' ? c >= 0 : c <= 0;
    }
    default: return undefined;
  }
}

const evalGroups = (groups: QueryGroup[], rec: Record<string, string> | undefined, ctx: Ctx | undefined): Tri =>
  and3(groups.map((g) => { const r = or3(g.terms.map((t) => evalTerm(t, rec, ctx))); return g.unknown && r !== true ? undefined : r; }));

/** Condição de ACL (encoded query) sobre o registro, com "a própria pessoa" e "meus grupos". */
export function evalAclCondition(cond: string | undefined, rec: Record<string, string> | undefined, ctx?: Ctx): Tri {
  if (!cond) return true;
  const { groups, complex } = parseEncoded(cond);
  if (complex && !groups.length) return undefined;
  if (!groups.length) return true;
  return evalGroups(groups, rec, ctx);
}

// ---------------------------------------------------------------- leitura do script da regra "before query"

function splitTopLevel(expr: string, sep: string): string[] {
  const m = mask(expr);
  const out: string[] = [];
  let d = 0, start = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (d === 0 && m.startsWith(sep, i)) { out.push(expr.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  out.push(expr.slice(start));
  return out.map((x) => x.trim());
}

function stripParens(s: string): string {
  let t = s.trim();
  while (t.startsWith('(') && matchClose(mask(t), 0) === t.length - 1) t = t.slice(1, -1).trim();
  return t;
}

function atomOf(part: string): GuardAtom {
  let s = stripParens(part);
  let neg = false;
  while (s.startsWith('!')) { neg = !neg; s = stripParens(s.slice(1)); }
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^gs\.(?:getUser\(\)\.)?hasRole\(\s*(['"])([^'"]*)\1\s*\)$/))) return { kind: 'role', roles: m[2]!.split(',').map((r) => r.trim()).filter(Boolean), has: !neg };
  if (/^gs\.(?:getSession\(\)\.)?isInteractive\(\)$/.test(s)) return { kind: 'interactive', is: !neg };
  if ((m = s.match(/^gs\.getUser\(\)\.isMemberOf\(\s*(['"])([^'"]*)\1\s*\)$/))) return { kind: 'group', group: m[2]!, member: !neg };
  return { kind: 'other', expr: s, neg };
}

const negAtom = (a: GuardAtom): GuardAtom => (a.kind === 'role' ? { ...a, has: !a.has } : a.kind === 'interactive' ? { ...a, is: !a.is } : a.kind === 'group' ? { ...a, member: !a.member } : { ...a, neg: !a.neg });

/** Condição em partes legíveis; com `neg`, aplica De Morgan (não (a e b) = não a ou não b). */
export function guardOf(cond: string, neg: boolean): QueryGuard {
  const c = stripParens(cond);
  const ands = splitTopLevel(c, '&&');
  const ors = splitTopLevel(c, '||');
  let atoms: GuardAtom[] | undefined;
  let join: 'and' | 'or' | undefined;
  if (ands.length > 1 && ors.length === 1) { atoms = ands.map(atomOf); join = 'and'; }
  else if (ors.length > 1 && ands.length === 1) { atoms = ors.map(atomOf); join = 'or'; }
  else if (ands.length === 1 && ors.length === 1) { atoms = [atomOf(c)]; join = 'and'; }
  if (atoms && neg) { atoms = atoms.map(negAtom); join = join === 'and' ? 'or' : 'and'; }
  return { cond, neg, ...(atoms ? { atoms, join } : {}) };
}

/** A condição vale para a pessoa? Papéis e grupos substituídos; "pela tela" considerado verdadeiro (o caso do painel). */
export function evalGuardFor(g: QueryGuard, ctx: Ctx | undefined): Tri {
  if (!ctx) return undefined;
  const U = '__trail_unknown__';
  const c = g.cond
    .replace(/gs\.(?:getUser\(\)\.)?hasRole\(\s*(['"])([^'"]*)\1\s*\)/g, (_s, _q, r: string) => { const h = hasRole(ctx, r); return h === undefined ? U : String(h); })
    .replace(/gs\.(?:getSession\(\)\.)?isInteractive\(\)/g, 'true')
    .replace(/gs\.getUser\(\)\.isMemberOf\(\s*(['"])([^'"]*)\1\s*\)/g, (_s, _q, n: string) => (ctx.groupsKnown ? String(ctx.groupNames.has(n) || ctx.groupIds.has(n)) : U));
  const v = evalExpr(c, { rec: {}, old: {}, changed: new Set(), unknownChanges: true, user: { ...(ctx.sysId ? { sysId: ctx.sysId } : {}), ...(ctx.userName ? { name: ctx.userName } : {}) } });
  if (v === undefined) return undefined;
  const t = typeof v === 'string' ? v !== '' && v !== 'false' : !!v;
  return g.neg ? !t : t;
}

const ME_EXPR = /^(?:gs\.getUserID\(\)|gs\.getUser\(\)\.getID\(\)|gs\.getSession\(\)\.getUserID\(\))$/;
const GROUPS_EXPR = /^(?:gs\.getUser\(\)\.)?getMyGroups\(\)(?:\.toString\(\))?$/;

/** Regiões do script protegidas por if / else / return antecipado. */
function guardRegions(script: string, m: string): { start: number; end: number; guard: { cond: string; neg: boolean } }[] {
  const regions: { start: number; end: number; guard: { cond: string; neg: boolean } }[] = [];
  const done = new Set<number>();
  const enclosingClose = (from: number) => { let d = 0; for (let i = from; i < m.length; i++) { if (m[i] === '{') d++; else if (m[i] === '}') { if (d === 0) return i; d--; } } return m.length; };
  const parseIf = (at: number, prior: { cond: string; neg: boolean }[]): number => {
    done.add(at);
    const open = m.indexOf('(', at);
    const close = matchClose(m, open);
    if (open < 0 || close < 0) return m.length;
    const cond = script.slice(open + 1, close).trim();
    const b = skipWs(m, close + 1);
    let end: number;
    const pos = { cond, neg: false };
    if (m[b] === '{') { end = matchClose(m, b); if (end < 0) end = m.length; }
    else {
      end = stmtEnd(m, b);
      if (/^return\b/.test(script.slice(b, end).trim())) regions.push({ start: end + 1, end: enclosingClose(end + 1), guard: { cond, neg: true } });
    }
    for (const p of prior) regions.push({ start: b, end, guard: p });
    regions.push({ start: b, end, guard: pos });
    let e = skipWs(m, end + 1);
    if (m[e] === ';') e = skipWs(m, e + 1);
    if (m.startsWith('else', e) && !/[\w$]/.test(m[e + 4] ?? '')) {
      const negs = [...prior, { cond, neg: true }];
      const after = skipWs(m, e + 4);
      if (/^if\s*\(/.test(m.slice(after))) return parseIf(after, negs);
      let eEnd: number;
      if (m[after] === '{') { eEnd = matchClose(m, after); if (eEnd < 0) eEnd = m.length; } else eEnd = stmtEnd(m, after);
      for (const g of negs) regions.push({ start: after, end: eEnd, guard: g });
      return eEnd;
    }
    return end;
  };
  const re = /\bif\s*\(/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(m))) if (!done.has(mt.index)) parseIf(mt.index, []);
  return regions;
}

function argsOf(script: string, m: string, open: number): string[] | undefined {
  const close = matchClose(m, open);
  if (close < 0) return undefined;
  const inner = script.slice(open + 1, close);
  if (!inner.trim()) return [];
  const mi = m.slice(open + 1, close);
  const out: string[] = [];
  let d = 0, start = 0;
  for (let i = 0; i < mi.length; i++) {
    const c = mi[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) { out.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  out.push(inner.slice(start).trim());
  return out;
}

/**
 * Lê o script de uma regra "before query": os filtros que ela acrescenta em `current` e as condições de cada um.
 * Não executa nada. `condition` é o campo de condição da regra (JavaScript), que vale para todos os filtros.
 */
export function readQueryScript(script: string | undefined, condition?: string): Pick<QueryRule, 'readable' | 'branches' | 'delegates'> {
  const src = script ?? '';
  const m = mask(src);
  const vars = new Map<string, string>();
  for (const v of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
    if (m[v.index!] !== src[v.index!]) continue;
    const s = v.index! + v[0].length;
    vars.set(v[1]!, src.slice(s, stmtEnd(m, s)).trim());
  }
  const resolve = (arg: string): TermValue => {
    const a = arg.trim();
    const lit = a.match(/^(['"])((?:(?!\1).)*)\1$/s);
    if (lit) return { kind: 'literal', value: lit[2]! };
    if (/^-?\d+(\.\d+)?$/.test(a) || a === 'true' || a === 'false') return { kind: 'literal', value: a };
    if (ME_EXPR.test(a)) return { kind: 'me' };
    if (GROUPS_EXPR.test(a)) return { kind: 'my_groups' };
    const v = /^[A-Za-z_$][\w$]*$/.test(a) ? vars.get(a) : undefined;
    if (v !== undefined && v !== a) {
      const r = resolve(v);
      if (r.kind !== 'unknown') return r;
    }
    return { kind: 'unknown', expr: a };
  };

  const regions = guardRegions(src, m);
  const baseGuards = condition?.trim() ? [{ cond: condition.trim(), neg: false }] : [];
  const guardsAt = (p: number) => [...baseGuards, ...regions.filter((r) => p >= r.start && p <= r.end).map((r) => r.guard)];

  type G = { group: QueryGroup; key: string; guards: { cond: string; neg: boolean }[] };
  const groups: G[] = [];
  const alias = new Map<string, G>();
  let last: G | undefined;
  let partial = false;
  let found = false;
  const re = /\.\s*(addQuery|addOrCondition|addEncodedQuery|addActiveQuery|addInactiveQuery|addNullQuery|addNotNullQuery|addCondition)\s*\(/g;
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(src))) {
    if (m[mt.index] !== '.') continue; // dentro de string ou comentário
    const method = mt[1]!;
    const open = mt.index + mt[0].length - 1;
    const before = m.slice(0, mt.index).replace(/\s+$/, '');
    const chained = before.endsWith(')');
    const recv = chained ? undefined : before.match(/([A-Za-z_$][\w$]*)$/)?.[1];
    const args = argsOf(src, m, open);
    let target: G | undefined;
    let fresh = false;
    if (recv === 'current') {
      if (method === 'addOrCondition' || method === 'addCondition') { partial = true; last = undefined; continue; }
      fresh = true;
    } else if (chained) {
      target = last;
      if (!target) continue;
    } else if (recv && alias.has(recv)) {
      target = alias.get(recv);
    } else { last = undefined; continue; } // outra GlideRecord do script (não filtra este registro)
    found = true;
    const termsFrom = (): { terms: QueryTerm[]; groups?: QueryGroup[]; unknown?: boolean } => {
      if (!args) return { terms: [], unknown: true };
      const fieldArg = args[0] !== undefined ? resolve(args[0]) : undefined;
      switch (method) {
        case 'addActiveQuery': return { terms: [{ field: 'active', op: '=', value: { kind: 'literal', value: 'true' } }] };
        case 'addInactiveQuery': return { terms: [{ field: 'active', op: '=', value: { kind: 'literal', value: 'false' } }] };
        case 'addNullQuery': case 'addNotNullQuery':
          return fieldArg?.kind === 'literal' ? { terms: [{ field: fieldArg.value, op: method === 'addNullQuery' ? 'ISEMPTY' : 'ISNOTEMPTY', value: { kind: 'literal', value: '' } }] } : { terms: [], unknown: true };
        case 'addEncodedQuery': {
          if (fieldArg?.kind !== 'literal') return { terms: [], unknown: true };
          const p = parseEncoded(fieldArg.value);
          return { terms: [], groups: p.groups, ...(p.complex ? { unknown: true } : {}) };
        }
        default: {
          if (args.length === 1) {
            if (fieldArg?.kind !== 'literal') return { terms: [], unknown: true };
            const p = parseEncoded(fieldArg.value);
            return p.groups.length === 1 && !p.complex ? { terms: p.groups[0]!.terms } : { terms: [], groups: p.groups, ...(p.complex ? { unknown: true } : {}) };
          }
          if (fieldArg?.kind !== 'literal' || !/^[a-z0-9_.]+$/.test(fieldArg.value)) return { terms: [], unknown: true };
          const op = args.length >= 3 ? resolve(args[1]!) : { kind: 'literal' as const, value: '=' };
          if (op.kind !== 'literal') return { terms: [], unknown: true };
          const value = resolve(args[args.length >= 3 ? 2 : 1]!);
          return { terms: [{ field: fieldArg.value, op: op.value.trim().toUpperCase(), value }] };
        }
      }
    };
    const t = termsFrom();
    if (t.unknown) partial = true;
    if (fresh) {
      const guards = guardsAt(mt.index);
      const key = JSON.stringify(guards);
      const made: G[] = (t.groups ?? [{ terms: t.terms }]).map((g) => ({ group: { ...g, ...(t.unknown ? { unknown: true } : {}) }, key, guards }));
      if (!made.length) made.push({ group: { terms: [], unknown: true }, key, guards });
      groups.push(...made);
      last = made[made.length - 1];
      const a = m.slice(0, before.length - 'current'.length).match(/([A-Za-z_$][\w$]*)\s*=\s*$/);
      if (a && last) alias.set(a[1]!, last);
    } else if (target) {
      if (method === 'addCondition') { target.group.unknown = true; partial = true; }
      else if (t.groups) { for (const g of t.groups) target.group.terms.push(...g.terms); if (t.groups.length > 1 || t.unknown) target.group.unknown = true; }
      else { target.group.terms.push(...t.terms); if (t.unknown) target.group.unknown = true; }
      last = target;
    }
  }
  // `current` passado a outra função (script include etc.): ela pode acrescentar filtros que não vemos.
  const delegates: string[] = [];
  for (const d of m.matchAll(/([\w$.]+)\s*\(\s*current\s*[,)]/g)) {
    const callee = d[1]!;
    // Declaração de função (function executeRule(current, previous)) não é chamada.
    if (callee === 'function' || /\bfunction\s+$/.test(m.slice(0, d.index!))) continue;
    if (callee.startsWith('.')) {
      const recv = m.slice(0, d.index!).match(/new\s+([\w$.]+)\s*\([^()]*\)\s*$/)?.[1];
      delegates.push(recv ? `${recv}${callee}` : callee.slice(1));
    } else delegates.push(callee);
  }
  const branchMap = new Map<string, QueryBranch>();
  for (const g of groups) {
    let b = branchMap.get(g.key);
    if (!b) { b = { guards: g.guards.map((x) => guardOf(x.cond, x.neg)), groups: [] }; branchMap.set(g.key, b); }
    b.groups.push(g.group);
  }
  const branches = [...branchMap.values()];
  const mentions = /\b(?:addQuery|addEncodedQuery|addOrCondition|addActiveQuery|addNullQuery|addNotNullQuery|addDomainQuery)\b|\[\s*['"]add/.test(m);
  const readable: QueryRule['readable'] = !found && (mentions || delegates.length) ? 'none' : partial || delegates.length ? 'partial' : 'full';
  return { readable, branches, delegates: [...new Set(delegates)] };
}

/** Avalia a regra para a pessoa e o registro. */
function judgeRule(r: QueryRule, rec: Record<string, string> | undefined, ctx: Ctx | undefined): void {
  for (const b of r.branches) {
    b.applies = ctx ? and3(b.guards.map((g) => evalGuardFor(g, ctx))) : undefined;
    b.recordMatches = evalGroups(b.groups, rec, ctx);
  }
  if (!ctx) return;
  if (r.readable === 'none') { r.hides = undefined; return; }
  const hides = or3(r.branches.map((b) => (b.applies === false || b.recordMatches === true ? false : b.applies === true && b.recordMatches === false ? true : undefined)));
  r.hides = hides === false && r.readable === 'partial' ? undefined : hides;
}

// ---------------------------------------------------------------- ACLs

function aclKeyParts(name: string): { table: string; field?: string } {
  const i = name.indexOf('.');
  return i < 0 ? { table: name } : { table: name.slice(0, i), field: name.slice(i + 1) };
}

/** Ordem de busca das chaves no nível tabela e no nível campo (a primeira com regras vence). */
export function aclKeyOrder(tables: string[], field?: string): string[] {
  const all = [...tables, '*'];
  if (field === undefined) return all;
  if (field === '*') return all.map((t) => `${t}.*`);
  return [...all.map((t) => `${t}.${field}`), ...all.map((t) => `${t}.*`)];
}

function judgeAcl(a: AclCheck, rec: Record<string, string> | undefined, ctx: Ctx | undefined): void {
  if (ctx && a.adminOverrides && ctx.rolesKnown && ctx.isAdmin) { a.byAdmin = true; a.roleOk = true; a.conditionOk = true; a.passes = true; return; }
  if (!a.roles.length && a.rolesKnown) a.roleOk = true;
  else if (!a.rolesKnown || !ctx || !ctx.rolesKnown) a.roleOk = undefined;
  else if (ctx.isAdmin) a.roleOk = true;
  else { a.roleOk = a.roles.some((r) => ctx.roles.has(r)); if (!a.roleOk) a.missingRoles = [...a.roles]; }
  a.conditionOk = evalAclCondition(a.condition, rec, ctx);
  if (a.condition && rec) {
    const now: Record<string, string> = {};
    for (const g of parseEncoded(a.condition).groups) for (const t of g.terms) if (t.field in rec) now[t.field] = rec[t.field]!;
    if (Object.keys(now).length) a.now = now;
  }
  a.passes = and3([a.roleOk, a.conditionOk, a.script ? undefined : true]);
}

function levelOf(acls: AclCheck[], order: string[]): LevelVerdict {
  const pick = (decision: 'allow' | 'deny') => {
    for (const k of order) { const set = acls.filter((a) => a.name === k && a.decision === decision); if (set.length) return { key: k, set }; }
    return undefined;
  };
  const allow = pick('allow');
  const deny = pick('deny');
  for (const a of [...(allow?.set ?? []), ...(deny?.set ?? [])]) a.used = true;
  if (!allow && !deny) return { ok: undefined };
  const lean = (a: AclCheck) => a.roleOk === true && a.conditionOk === true; // só falta o script
  const allowOk: Tri = allow ? or3(allow.set.map((a) => a.passes)) : undefined;
  const denyOk: Tri = deny ? and3(deny.set.map((a) => a.passes)) : true;
  const ok = and3([allowOk, denyOk]);
  const out: LevelVerdict = { ...(allow ? { key: allow.key } : deny ? { key: deny.key } : {}), ok };
  if (ok === undefined) {
    const allowLean = allowOk === true || (allowOk === undefined && !!allow?.set.some((a) => a.passes !== false && lean(a)));
    const denyLean = denyOk === true || (denyOk === undefined && !!deny?.set.every((a) => a.passes === true || lean(a)));
    out.lean = allowLean && denyLean;
  }
  return out;
}

// ---------------------------------------------------------------- critérios de usuário (KB)

function ucMatches(c: Row, ctx: Ctx): Tri {
  const ids = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const dims: Tri[] = [];
  const u = ctx.user ?? {};
  if (ids(c.user).length) dims.push(ctx.sysId ? ids(c.user).includes(ctx.sysId) : undefined);
  if (ids(c.group).length) dims.push(ctx.groupsKnown ? ids(c.group).some((g) => ctx.groupIds.has(g)) : undefined);
  if (ids(c.role).length) dims.push(ctx.rolesKnown ? ids(c.role).some((r) => ctx.roleIds.has(r)) : undefined);
  for (const f of ['company', 'department', 'location'] as const) if (ids(c[f]).length) dims.push(f in u ? ids(c[f]).includes(u[f] ?? '') : undefined);
  const scripted = c.advanced === 'true' && !!(c.script ?? '').trim();
  if (scripted) dims.push(undefined);
  if (!dims.length) return scripted ? undefined : false;
  return c.match_all === 'true' ? and3(dims) : or3(dims);
}

// ---------------------------------------------------------------- principal

const KB_FIELDS = ['kb_knowledge_base', 'can_read_user_criteria', 'cannot_read_user_criteria', 'workflow_state', 'valid_to', 'author'];

export async function visibility(
  client: RestClient,
  input: { table: string; sysId: string; user?: string },
  opts: VisibilityOptions = {},
): Promise<Visibility> {
  const started = Date.now();
  const sc = shared(client, opts.timeoutMs);
  const calls0 = sc.calls;
  const notes: string[] = [];
  const q = async (table: string, query: string, fields: string[], limit = 100) => (await sc.query({ table, query, fields, limit })).rows;
  const { table, sysId } = input;
  const extraFields = (opts.fields ?? []).filter((f) => /^[a-z0-9_]+$/.test(f));

  // ---------- 1: hierarquia, regras, ACLs e a pessoa ----------
  const tables = await tableHierarchy(q, table);
  const isKb = tables.includes('kb_knowledge');
  const keys = [...new Set([...tables, '*'].flatMap((t) => [t, `${t}.*`, ...extraFields.map((f) => `${t}.${f}`)]))];
  const userQ = input.user ? (isSysId(input.user) ? `sys_id=${input.user}` : `user_name=${input.user}`) : '';
  const [brRes, aclRes, userRes] = await Promise.all([
    sc.query({ table: 'sys_script', query: `collectionIN${[...tables, 'global'].join(',')}^when=before^action_query=true^active=true^ORDERBYorder`, fields: ['sys_id', 'name', 'collection', 'order', 'condition', 'script'], limit: 100 }),
    sc.query({ table: 'sys_security_acl', query: `nameIN${keys.join(',')}^active=true`, fields: ['sys_id', 'name', 'operation', 'operation.name', 'type', 'type.name', 'condition', 'script', 'advanced', 'admin_overrides', 'decision_type', 'active'], limit: 500 }),
    userQ ? sc.query({ table: 'sys_user', query: userQ, fields: ['sys_id', 'user_name', 'name', 'active', 'sys_domain', 'company', 'department', 'location'], limit: 1 }) : Promise.resolve(undefined),
  ]);

  // Regras before query.
  if (brRes.access === 'denied' || brRes.access === 'no_filter') notes.push('rules_denied');
  const filters: QueryRule[] = brRes.rows.map((r) => ({
    name: r.name ?? '', ...(r.sys_id ? { sysId: r.sys_id } : {}), on: r.collection ?? '', order: Number(r.order) || 0,
    ...readQueryScript(r.script, r.condition),
  }));

  // ACLs de leitura do tipo record.
  const aclDenied = aclRes.access === 'denied' || aclRes.access === 'no_filter';
  if (aclDenied) notes.push('acl_denied');
  // operation e type são referências: vale o nome (operation.name, type.name); sem ele, o valor só serve se não for sys_id.
  const nameOf = (r: Row, f: string) => r[`${f}.name`] || (r[f] && !isSysId(r[f]!) ? r[f]! : '');
  if (aclRes.rows.some((r) => !nameOf(r, 'operation'))) notes.push('acl_op_unknown');
  const aclRows = aclRes.rows.filter((r) => {
    const ty = nameOf(r, 'type');
    return nameOf(r, 'operation') === 'read' && (!ty || ty === 'record') && r.active !== 'false';
  });
  if (!aclDenied && !aclRows.length) notes.push('acl_empty');
  let rolesByAcl = new Map<string, string[]>();
  let aclRolesKnown = true;
  if (aclRows.length) {
    const rr = await sc.query({ table: 'sys_security_acl_role', query: `sys_security_aclIN${aclRows.map((a) => a.sys_id).join(',')}`, fields: ['sys_security_acl', 'sys_user_role', 'sys_user_role.name'], limit: 1000 });
    if (rr.access === 'denied' || rr.access === 'no_filter') { aclRolesKnown = false; notes.push('acl_roles_denied'); }
    rolesByAcl = new Map();
    for (const x of rr.rows) {
      const id = x.sys_security_acl ?? '';
      const name = x['sys_user_role.name'] || x.sys_user_role || '';
      if (id && name) rolesByAcl.set(id, [...(rolesByAcl.get(id) ?? []), name]);
    }
  }
  const acls: AclCheck[] = aclRows.map((r) => {
    const name = r.name ?? '';
    const { table: t, field } = aclKeyParts(name);
    const script = r.advanced === 'true' && !!(r.script ?? '').trim() && !/^\s*answer\s*=\s*true\s*;?\s*$/.test(r.script ?? '');
    return {
      sysId: r.sys_id ?? '', name, level: field === undefined ? 'table' : 'field', table: t, ...(field !== undefined ? { field } : {}),
      decision: r.decision_type === 'deny' ? 'deny' : 'allow', roles: [...new Set(rolesByAcl.get(r.sys_id ?? '') ?? [])], rolesKnown: aclRolesKnown,
      ...(r.condition ? { condition: r.condition } : {}), script, adminOverrides: r.admin_overrides === 'true', used: false,
    } satisfies AclCheck;
  });
  if (acls.some((a) => a.decision === 'deny')) notes.push('deny_unless');

  // A pessoa: papéis e grupos.
  let ctx: Ctx | undefined;
  let user: VisibilityUser | undefined;
  let userRoles: UserRoles | undefined;
  if (!input.user) notes.push('generic');
  else if (userRes && (userRes.access === 'denied' || userRes.access === 'no_filter')) notes.push('user_unreadable');
  else if (!userRes?.rows[0]) notes.push('user_not_found');
  else {
    const u = userRes.rows[0];
    user = { sysId: u.sys_id ?? '', ...(u.user_name ? { userName: u.user_name } : {}), ...(u.name ? { name: u.name } : {}), ...(u.active ? { active: u.active === 'true' } : {}), ...(u.sys_domain ? { domain: u.sys_domain } : {}) };
    if (u.active === 'false') notes.push('user_inactive');
    const [rolesRes, grpRes] = await Promise.all([
      sc.query({ table: 'sys_user_has_role', query: `user=${user.sysId}`, fields: ['role', 'role.name', 'inherited', 'state'], limit: 1000 }),
      sc.query({ table: 'sys_user_grmember', query: `user=${user.sysId}`, fields: ['group', 'group.name'], limit: 500 }),
    ]);
    const rolesKnown = rolesRes.access === 'ok' || rolesRes.access === 'empty';
    const groupsKnown = grpRes.access === 'ok' || grpRes.access === 'empty';
    if (!rolesKnown) notes.push('roles_denied');
    if (!groupsKnown) notes.push('groups_denied');
    const live = rolesRes.rows.filter((r) => !r.state || r.state === 'active');
    const names = [...new Set(live.map((r) => r['role.name'] || '').filter(Boolean))].sort();
    const inherited = [...new Set(live.filter((r) => r.inherited === 'true').map((r) => r['role.name'] || '').filter(Boolean))]
      .filter((n) => !live.some((r) => r['role.name'] === n && r.inherited !== 'true')).sort();
    const groups = grpRes.rows.filter((g) => g.group).map((g) => ({ sysId: g.group!, ...(g['group.name'] ? { name: g['group.name'] } : {}) }));
    ctx = {
      sysId: user.sysId, ...(user.userName ? { userName: user.userName } : {}), roles: new Set(names), roleIds: new Set(live.map((r) => r.role ?? '').filter(Boolean)),
      rolesKnown, isAdmin: names.includes('admin'), groupIds: new Set(groups.map((g) => g.sysId)), groupNames: new Set(groups.map((g) => g.name ?? '').filter(Boolean)), groupsKnown, user: u,
    };
    userRoles = { names, inherited, isAdmin: ctx.isAdmin, known: rolesKnown, groups, groupsKnown };
  }

  // ---------- 2: o registro (só os campos que as condições citam) ----------
  const condFields = new Set<string>(['sys_id', 'sys_domain']);
  for (const r of filters) for (const b of r.branches) for (const g of b.groups) for (const t of g.terms) condFields.add(t.field);
  for (const a of acls) for (const g of parseEncoded(a.condition).groups) for (const t of g.terms) condFields.add(t.field);
  if (isKb) for (const f of KB_FIELDS) condFields.add(f);
  const recFields = [...condFields].filter((f) => /^[a-z0-9_.]+$/.test(f)).slice(0, 80);
  const recRes = await sc.query({ table, query: `sys_id=${sysId}`, fields: recFields, limit: 1 });
  const rec = recRes.rows[0];
  if (!rec) notes.push('record_unreadable');

  for (const r of filters) judgeRule(r, rec, ctx);
  if (filters.some((r) => r.branches.some((b) => b.guards.some((g) => /isInteractive\(\)/.test(g.cond))))) notes.push('interactive_assumed');
  for (const a of acls) judgeAcl(a, rec, ctx);

  const tableLevel = levelOf(acls, aclKeyOrder(tables));
  const fieldLevel = levelOf(acls, aclKeyOrder(tables, '*'));
  const fieldsLevels: Record<string, LevelVerdict> = {};
  for (const f of extraFields) fieldsLevels[f] = levelOf(acls, aclKeyOrder(tables, f));
  if (!aclDenied && acls.length && !tableLevel.key) notes.push('no_table_acl');

  // ---------- 3: domínio e base de conhecimento ----------
  let domain: DomainCheck | undefined;
  if (rec && 'sys_domain' in rec && rec.sys_domain) {
    const rd = rec.sys_domain, ud = user?.domain;
    const ok: Tri = rd === 'global' ? true : ud === undefined ? undefined : ud === rd ? true : undefined;
    domain = { record: rd, ...(ud ? { user: ud } : {}), ok };
    if (ud && ud !== rd && rd !== 'global') notes.push('domain_differs');
  }

  let kb: KbCheck | undefined;
  if (isKb && rec) kb = await kbCheck(sc, q, rec, ctx);

  // ---------- 4: combinação ----------
  const why: string[] = [];
  type F = { ok: Tri; lean?: boolean };
  const factors: F[] = [];
  for (const r of filters) {
    if (r.hides === true) why.push(`filter_hides:${r.name}`);
    else if (r.hides === undefined && ctx) why.push(r.readable === 'none' ? `filter_unread:${r.name}` : `filter_unknown:${r.name}`);
    factors.push({ ok: not3(r.hides) });
  }
  if (aclDenied) { why.push('acl_denied'); factors.push({ ok: undefined }); }
  else if (!acls.length) { why.push('acl_empty'); factors.push({ ok: undefined }); }
  else {
    why.push(tableLevel.ok === true ? 'table_ok' : tableLevel.ok === false ? 'table_fail' : tableLevel.key ? (tableLevel.lean ? 'table_script' : 'table_unknown') : 'table_none');
    factors.push(tableLevel);
    if (fieldLevel.key) { why.push(fieldLevel.ok === true ? 'field_ok' : fieldLevel.ok === false ? 'field_fail' : fieldLevel.lean ? 'field_script' : 'field_unknown'); factors.push(fieldLevel); }
  }
  if (domain) { if (domain.ok === undefined && domain.user) why.push('domain_differs'); factors.push({ ok: domain.ok, ...(domain.ok === undefined && domain.user ? { lean: false } : {}) }); }
  if (kb) { why.push(kb.ok === true ? 'kb_ok' : kb.ok === false ? 'kb_fail' : 'kb_unknown'); factors.push({ ok: kb.ok }); }

  let verdict: VisibilityVerdict;
  if (!ctx) verdict = 'nao_da_para_afirmar';
  else {
    const anyFalse = factors.some((f) => f.ok === false);
    const unknown = factors.filter((f) => f.ok === undefined);
    if (anyFalse) verdict = unknown.length ? 'provavel_nao_ve' : 'nao_ve';
    else if (!unknown.length) verdict = 've';
    else if (unknown.every((f) => f.lean === true)) verdict = 'provavel_ve';
    else if (unknown.some((f) => f.lean === false) && unknown.every((f) => f.lean !== undefined)) verdict = 'provavel_nao_ve';
    else verdict = 'nao_da_para_afirmar';
  }
  if (!ctx && input.user) why.unshift(notes.includes('user_not_found') ? 'user_not_found' : 'user_unreadable');

  // ---------- 5: rótulos ----------
  const wanted: Record<string, (string | undefined)[]> = {};
  for (const f of condFields) if (/^[a-z0-9_]+$/.test(f) && f !== 'sys_id') wanted[f] = [rec?.[f]];
  for (const r of filters) for (const b of r.branches) for (const g of b.groups) for (const t of g.terms) if (t.value.kind === 'literal' && wanted[t.field]) wanted[t.field]!.push(t.value.value);
  const labels = await resolveDisplay(q, tables, wanted, opts.language ?? 'en').catch(() => ({ fields: {}, values: {}, refs: {} }));

  const main = ['sys_script', 'sys_security_acl', 'sys_security_acl_role', 'sys_user', 'sys_user_has_role', 'sys_user_grmember', table];
  return {
    table, sysId, tables, ...(input.user ? { asked: input.user } : {}), ...(user ? { user } : {}), ...(userRoles ? { userRoles } : {}),
    filters, acls, levels: { table: tableLevel, field: fieldLevel, fields: fieldsLevels }, ...(domain ? { domain } : {}), ...(kb ? { kb } : {}),
    combined: { verdict, why }, labels, ...(rec ? { record: rec } : {}),
    access: { ...sc.access }, denied: sc.denied(main), slow: sc.slow(main), notes: [...new Set(notes)],
    timing: { totalMs: Date.now() - started, calls: sc.calls - calls0 },
  };
}

async function kbCheck(sc: ReturnType<typeof shared>, q: (t: string, query: string, f: string[], l?: number) => Promise<Row[]>, rec: Row, ctx: Ctx | undefined): Promise<KbCheck> {
  const why: string[] = [];
  const ids = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const base = rec.kb_knowledge_base || undefined;
  const [baseRow, canM, cannotM] = await Promise.all([
    base ? q('kb_knowledge_base', `sys_id=${base}`, ['sys_id', 'title'], 1) : Promise.resolve([] as Row[]),
    base ? sc.query({ table: 'kb_uc_can_read_mtom', query: `kb_knowledge_base=${base}`, fields: ['user_criteria'], limit: 200 }) : Promise.resolve(undefined),
    base ? sc.query({ table: 'kb_uc_cannot_read_mtom', query: `kb_knowledge_base=${base}`, fields: ['user_criteria'], limit: 200 }) : Promise.resolve(undefined),
  ]);
  const artCan = ids(rec.can_read_user_criteria);
  const artCannot = ids(rec.cannot_read_user_criteria);
  const baseCan = (canM?.rows ?? []).map((r) => r.user_criteria ?? '').filter(Boolean);
  const baseCannot = (cannotM?.rows ?? []).map((r) => r.user_criteria ?? '').filter(Boolean);
  const mtomDenied = [canM, cannotM].some((r) => r && (r.access === 'denied' || r.access === 'no_filter'));
  const all = [...new Set([...artCan, ...artCannot, ...baseCan, ...baseCannot])];
  const ucRes = all.length ? await sc.query({ table: 'user_criteria', query: `sys_idIN${all.join(',')}`, fields: ['sys_id', 'name', 'user', 'group', 'role', 'company', 'department', 'location', 'match_all', 'advanced', 'script', 'active'], limit: 200 }) : undefined;
  const ucDenied = !!ucRes && (ucRes.access === 'denied' || ucRes.access === 'no_filter');
  if (mtomDenied || ucDenied) why.push('kb_criteria_denied');
  const byId = new Map((ucRes?.rows ?? []).map((r) => [r.sys_id ?? '', r]));
  const check = (id: string): UcCheck => {
    const r = byId.get(id);
    if (!r) return { sysId: id, matches: undefined };
    if (r.advanced === 'true' && (r.script ?? '').trim()) why.push('kb_script');
    return { sysId: id, ...(r.name ? { name: r.name } : {}), matches: r.active === 'false' ? false : ctx ? ucMatches(r, ctx) : undefined };
  };
  const canFrom: KbCheck['canFrom'] = artCan.length ? 'article' : baseCan.length ? 'base' : 'none';
  const canRead = (artCan.length ? artCan : baseCan).map(check);
  const cannotRead = [...new Set([...artCannot, ...baseCannot])].map(check);
  const parts: Tri[] = [];
  // Não pode ler: basta um critério que case.
  const cannot = or3(cannotRead.map((c) => c.matches));
  if (cannot === true) why.push('kb_cannot_match');
  parts.push(cannotRead.length ? not3(cannot) : mtomDenied ? undefined : true);
  // Pode ler: sem critério, todos leem; com critério, precisa casar um.
  if (canFrom === 'none') { why.push('kb_can_none'); parts.push(mtomDenied ? undefined : true); }
  else { const can = or3(canRead.map((c) => c.matches)); if (can === true) why.push('kb_can_match'); parts.push(can); }
  // Artigo não publicado ou vencido: só autores e responsáveis.
  const isAuthor = !!ctx?.sysId && rec.author === ctx.sysId;
  if (rec.workflow_state && rec.workflow_state !== 'published') { why.push('kb_not_published'); parts.push(isAuthor ? undefined : false); }
  if (rec.valid_to && /^\d{4}-\d{2}-\d{2}/.test(rec.valid_to) && rec.valid_to.slice(0, 10) < new Date().toISOString().slice(0, 10)) { why.push('kb_expired'); parts.push(isAuthor ? undefined : false); }
  return {
    ...(base ? { base } : {}), ...(baseRow[0]?.title ? { baseName: baseRow[0].title } : {}), ...(rec.workflow_state ? { workflowState: rec.workflow_state } : {}), ...(rec.valid_to ? { validTo: rec.valid_to } : {}),
    canRead, cannotRead, canFrom, ok: ctx ? and3(parts) : undefined, why: [...new Set(why)],
  };
}

// ---------------------------------------------------------------- texto

type Lang = 'pt' | 'en';

function joinList(xs: string[], lang: Lang, word?: string): string {
  const w = word ?? (lang === 'pt' ? 'e' : 'and');
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} ${w} ${xs[xs.length - 1]}`;
}

function atomText(a: GuardAtom, lang: Lang): string {
  const pt = lang === 'pt';
  switch (a.kind) {
    case 'role': {
      const rs = joinList(a.roles, lang, pt ? 'ou' : 'or');
      const many = a.roles.length > 1;
      return a.has ? (pt ? `tem o papel ${rs}` : `has the ${rs} role`) : (pt ? `não tem ${many ? 'nenhum dos papéis' : 'o papel'} ${rs}` : `doesn't have the ${rs} role`);
    }
    case 'interactive': return a.is ? (pt ? 'está usando a tela (sessão interativa)' : 'is using the UI (interactive session)') : (pt ? 'não está usando a tela (integração, job)' : 'is not using the UI (integration, job)');
    case 'group': return a.member ? (pt ? `é do grupo ${a.group}` : `is in the ${a.group} group`) : (pt ? `não é do grupo ${a.group}` : `is not in the ${a.group} group`);
    default: return `${a.neg ? (pt ? 'não ' : 'not ') : ''}${a.expr}`;
  }
}

/** "quem não tem o papel itil e está usando a tela" */
export function guardText(guards: QueryGuard[], lang: Lang = 'pt'): string {
  const pt = lang === 'pt';
  const parts = guards.map((g) => (g.atoms ? joinList(g.atoms.map((a) => atomText(a, lang)), lang, g.join === 'or' ? (pt ? 'ou' : 'or') : (pt ? 'e' : 'and')) : `${g.neg ? (pt ? 'não ' : 'not ') : ''}(${g.cond})`));
  return joinList(parts, lang);
}

function valueText(t: QueryTerm, v: Visibility | undefined, lang: Lang): string {
  const pt = lang === 'pt';
  switch (t.value.kind) {
    case 'me': return pt ? 'a própria pessoa' : 'the user themself';
    case 'my_groups': return pt ? 'um dos grupos da pessoa' : "one of the user's groups";
    case 'unknown': return pt ? `um valor calculado no script (${t.value.expr})` : `a value computed in the script (${t.value.expr})`;
    default: {
      const raw = t.value.value;
      const d = v?.labels.values[t.field]?.[raw];
      return d && d !== raw ? `${d} (${raw})` : raw;
    }
  }
}

export function termText(t: QueryTerm, lang: Lang = 'pt', v?: Visibility): string {
  const pt = lang === 'pt';
  const label = v?.labels.fields[t.field];
  const f = label ? `${label} (${t.field})` : t.field;
  const val = valueText(t, v, lang);
  const groups = t.value.kind === 'my_groups';
  const ops: Record<string, [string, string]> = {
    '=': groups ? ['é', 'is'] : ['é', 'is'], '!=': ['não é', 'is not'], IN: groups ? ['é', 'is'] : ['é um de', 'is one of'], 'NOT IN': ['não é nenhum de', 'is none of'],
    LIKE: ['contém', 'contains'], CONTAINS: ['contém', 'contains'], NOTLIKE: ['não contém', "doesn't contain"], 'DOES NOT CONTAIN': ['não contém', "doesn't contain"],
    STARTSWITH: ['começa com', 'starts with'], ENDSWITH: ['termina com', 'ends with'], '>': ['>', '>'], '<': ['<', '<'], '>=': ['≥', '≥'], '<=': ['≤', '≤'],
  };
  if (t.op === 'ISEMPTY') return `${f} ${pt ? 'está vazio' : 'is empty'}`;
  if (t.op === 'ISNOTEMPTY') return `${f} ${pt ? 'está preenchido' : 'is not empty'}`;
  const o = ops[t.op];
  return `${f} ${o ? o[pt ? 0 : 1] : t.op} ${val}`;
}

export function groupsText(groups: QueryGroup[], lang: Lang = 'pt', v?: Visibility): string {
  const pt = lang === 'pt';
  return joinList(groups.map((g) => {
    const s = joinList(g.terms.map((t) => termText(t, lang, v)), lang, pt ? 'ou' : 'or');
    const u = g.unknown ? (pt ? `${s ? `${s} ` : ''}(com uma parte que o Trail não lê)` : `${s ? `${s} ` : ''}(with a part Trail can't read)`) : s;
    return g.terms.length > 1 && groups.length > 1 ? `(${u})` : u;
  }), lang);
}

const mark = (x: Tri) => (x === true ? '✓' : x === false ? '✗' : '?');

function who(v: Visibility, lang: Lang): string {
  return v.user?.name || v.user?.userName || v.asked || (lang === 'pt' ? 'a pessoa' : 'the user');
}

/** Texto em linguagem simples (pt/en). Não inventa: o que não foi lido ou avaliado é dito como tal. */
export function describeVisibility(v: Visibility, lang: Lang = 'pt'): string {
  const pt = lang === 'pt';
  const out: string[] = [];
  const name = who(v, lang);

  // Veredito.
  if (v.notes.includes('user_not_found')) out.push(pt ? `Não achei o usuário "${v.asked}" (nem por sys_id nem por user_name).` : `User "${v.asked}" was not found (by sys_id or user_name).`);
  else if (v.notes.includes('user_unreadable')) out.push(pt ? 'Seus papéis não deixam ler os usuários (sys_user): a análise fica genérica.' : "Your roles can't read users (sys_user): the analysis is generic.");
  if (v.user) {
    const verdicts: Record<VisibilityVerdict, [string, string]> = {
      ve: [`${name} vê este registro.`, `${name} can see this record.`],
      nao_ve: [`${name} não vê este registro.`, `${name} can't see this record.`],
      provavel_ve: [`${name} provavelmente vê este registro (falta conferir o que depende de script).`, `${name} can probably see this record (what depends on scripts was not checked).`],
      provavel_nao_ve: [`${name} provavelmente não vê este registro.`, `${name} probably can't see this record.`],
      nao_da_para_afirmar: [`Não dá para afirmar se ${name} vê este registro.`, `It's not possible to say whether ${name} can see this record.`],
    };
    out.push(verdicts[v.combined.verdict][pt ? 0 : 1]);
    if (v.notes.includes('user_inactive')) out.push(pt ? 'Atenção: este usuário está inativo (não consegue entrar).' : 'Note: this user is inactive (cannot log in).');
    if (v.userRoles) {
      if (!v.userRoles.known) out.push(pt ? 'Seus papéis não deixam ler os papéis dessa pessoa (sys_user_has_role).' : "Your roles can't read this user's roles (sys_user_has_role).");
      else out.push(pt ? `Papéis: ${v.userRoles.names.length ? v.userRoles.names.join(', ') : 'nenhum'}${v.userRoles.inherited.length ? ` (herdados: ${v.userRoles.inherited.join(', ')})` : ''}.`
        : `Roles: ${v.userRoles.names.length ? v.userRoles.names.join(', ') : 'none'}${v.userRoles.inherited.length ? ` (inherited: ${v.userRoles.inherited.join(', ')})` : ''}.`);
    }
  } else if (!v.asked) out.push(pt ? 'Quem enxerga este registro:' : 'Who can see this record:');

  // Regras antes da consulta.
  if (v.notes.includes('rules_denied')) out.push(pt ? 'Seus papéis não deixam ver as regras de negócio (sys_script): pode haver filtros antes da consulta que o Trail não vê.' : "Your roles can't read business rules (sys_script): there may be query filters Trail can't see.");
  for (const r of v.filters) {
    const head = pt ? `Regra "${r.name}" (filtra a lista antes da consulta, em ${r.on}):` : `Rule "${r.name}" (filters the list before the query, on ${r.on}):`;
    if (r.readable === 'none') { out.push(`${head} ${pt ? 'pode restringir quem vê (script não avaliado).' : 'may restrict who sees it (script not evaluated).'}`); continue; }
    const lines: string[] = [];
    for (const b of r.branches) {
      const g = b.guards.length ? guardText(b.guards, lang) : '';
      const what = groupsText(b.groups, lang, v);
      lines.push(g ? (pt ? `quem ${g} só vê os registros em que ${what}` : `whoever ${g} only sees records where ${what}`) : (pt ? `todos só veem os registros em que ${what}` : `everyone only sees records where ${what}`));
      if (v.user) {
        const app = b.applies === true ? (pt ? `vale para ${name}` : `applies to ${name}`) : b.applies === false ? (pt ? `não vale para ${name}` : `doesn't apply to ${name}`) : (pt ? `não dá para saber se vale para ${name}` : `can't tell if it applies to ${name}`);
        const rm = b.recordMatches === true ? (pt ? 'este registro passa no filtro' : 'this record passes the filter') : b.recordMatches === false ? (pt ? 'este registro não passa no filtro' : "this record doesn't pass the filter") : (pt ? 'não dá para saber se este registro passa' : "can't tell if this record passes");
        lines[lines.length - 1] += ` (${app} ${mark(b.applies)}; ${rm} ${mark(b.recordMatches)})`;
      }
    }
    if (!r.branches.length) lines.push(pt ? 'não acrescenta filtro reconhecível' : 'adds no recognizable filter');
    if (r.delegates.length) lines.push(pt ? `passa o registro para ${r.delegates.join(', ')}, que pode filtrar mais (não avaliado)` : `passes the record to ${r.delegates.join(', ')}, which may filter more (not evaluated)`);
    else if (r.readable === 'partial') lines.push(pt ? 'parte do script não foi lida' : 'part of the script was not read');
    out.push(`${head} ${lines.join('; ')}.`);
    if (r.hides === true) out.push(pt ? `→ Esta regra esconde o registro de ${name}.` : `→ This rule hides the record from ${name}.`);
  }
  if (v.notes.includes('interactive_assumed') && v.user) out.push(pt ? 'Considerei o acesso pela tela (sessão interativa); por integração ou job o resultado pode ser outro.' : 'Assumed access through the UI (interactive session); via integration or job it may differ.');

  // ACLs.
  if (v.notes.includes('acl_denied')) out.push(pt ? 'Seus papéis não deixam ver as regras de acesso (sys_security_acl): o Trail não sabe quais papéis ou condições são exigidos.' : "Your roles can't read access rules (sys_security_acl): Trail doesn't know which roles or conditions are required.");
  else if (v.notes.includes('acl_empty')) out.push(pt ? 'Nenhuma regra de acesso de leitura veio para esta tabela (pode ser falta de permissão para lê-las).' : 'No read access rules came back for this table (you may lack permission to read them).');
  else {
    out.push(pt ? 'Regras de acesso de leitura (ACL): em cada nível basta passar em uma; é preciso passar no nível da tabela (a linha aparece) E no dos campos (o conteúdo aparece). Dentro de uma regra: papel E condição E script.'
      : 'Read access rules (ACL): at each level passing one is enough; the user must pass the table level (the row shows) AND the field level (the content shows). Within a rule: role AND condition AND script.');
    if (v.notes.includes('acl_roles_denied')) out.push(pt ? 'Seus papéis não deixam ver os papéis exigidos por cada regra (sys_security_acl_role).' : "Your roles can't read the roles each rule requires (sys_security_acl_role).");
    for (const a of v.acls.filter((x) => x.used)) {
      const lvl = a.level === 'table' ? (pt ? 'tabela' : 'table') : (pt ? 'campos' : 'fields');
      const reqs: string[] = [];
      if (!a.rolesKnown) reqs.push(pt ? 'papéis não lidos' : 'roles not read');
      else if (a.roles.length) reqs.push(pt ? `papel ${joinList(a.roles, lang, 'ou')}` : `role ${joinList(a.roles, lang, 'or')}`);
      else reqs.push(pt ? 'sem papel exigido' : 'no role required');
      if (a.condition) reqs.push(pt ? `condição: ${groupsText(parseEncoded(a.condition).groups, lang, v) || a.condition}` : `condition: ${groupsText(parseEncoded(a.condition).groups, lang, v) || a.condition}`);
      if (a.script) reqs.push(pt ? 'depende de script' : 'depends on a script');
      let line = `${a.decision === 'deny' ? (pt ? 'Nega a menos que' : 'Deny unless') : '•'} ${a.name} (${lvl}): ${reqs.join('; ')}`;
      if (v.user) {
        const bits: string[] = [];
        if (a.byAdmin) bits.push(pt ? 'admin passa direto (admin_overrides) ✓' : 'admin passes (admin_overrides) ✓');
        else {
          if (a.roles.length) bits.push(a.roleOk === true ? (pt ? 'tem o papel ✓' : 'has the role ✓') : a.roleOk === false ? (pt ? `falta ${a.roles.length > 1 ? 'um dos papéis' : 'o papel'} ${joinList(a.missingRoles ?? a.roles, lang, 'ou')} ✗` : `missing the ${joinList(a.missingRoles ?? a.roles, lang, 'or')} role ✗`) : (pt ? 'papel não verificado ?' : 'role not checked ?'));
          if (a.condition) bits.push(a.conditionOk === true ? (pt ? 'condição vale ✓' : 'condition holds ✓') : a.conditionOk === false ? (pt ? 'condição não vale ✗' : "condition doesn't hold ✗") : (pt ? 'condição não avaliada ?' : 'condition not evaluated ?'));
          if (a.script) bits.push(pt ? 'script: não verificado' : 'script: not checked');
          if (!bits.length) bits.push(a.passes === true ? (pt ? 'passa ✓' : 'passes ✓') : mark(a.passes));
        }
        line += ` — ${bits.join(', ')}`;
      }
      out.push(line);
    }
    const unused = v.acls.filter((x) => !x.used && (x.level === 'table' || x.field === '*')).length;
    if (unused) out.push(pt ? `${unused} ${unused === 1 ? 'regra de tabela mais genérica não entra' : 'regras de tabela mais genéricas não entram'} (vale a mais específica).` : `${unused} more generic rule${unused === 1 ? '' : 's'} not used (the most specific one wins).`);
    if (v.notes.includes('no_table_acl')) out.push(pt ? 'Não há regra de leitura no nível da tabela visível: o padrão da instância decide (não verificado).' : 'No table-level read rule is visible: the instance default decides (not checked).');
    if (v.notes.includes('deny_unless')) out.push(pt ? 'Há regras "nega a menos que": precisam passar todas, antes das outras.' : 'There are "deny unless" rules: all must pass, before the others.');
  }

  // Domínio e conhecimento.
  if (v.notes.includes('domain_differs')) out.push(pt ? 'O registro está em outro domínio que o da pessoa: ela só vê se o domínio dela contiver o do registro (hierarquia de domínios não verificada).' : "The record is in a different domain from the user's: they only see it if their domain contains the record's (domain hierarchy not checked).");
  if (v.kb) {
    const k = v.kb;
    if (k.why.includes('kb_criteria_denied')) out.push(pt ? 'Seus papéis não deixam ler os critérios de usuário do conhecimento.' : "Your roles can't read the knowledge user criteria.");
    if (k.why.includes('kb_not_published')) out.push(pt ? `O artigo não está publicado (${k.workflowState}): leitores comuns não o veem.` : `The article is not published (${k.workflowState}): regular readers don't see it.`);
    if (k.why.includes('kb_expired')) out.push(pt ? `O artigo venceu em ${k.validTo}: leitores comuns não o veem.` : `The article expired on ${k.validTo}: regular readers don't see it.`);
    const nm = (c: UcCheck) => c.name || c.sysId;
    if (k.cannotRead.length) out.push(pt ? `Não pode ler: ${k.cannotRead.map((c) => `${nm(c)}${v.user ? ` ${c.matches === true ? '(casa ✗)' : c.matches === false ? '(não casa ✓)' : '(?)'}` : ''}`).join(', ')}.`
      : `Cannot read: ${k.cannotRead.map((c) => `${nm(c)}${v.user ? ` ${c.matches === true ? '(matches ✗)' : c.matches === false ? "(doesn't match ✓)" : '(?)'}` : ''}`).join(', ')}.`);
    if (k.canFrom === 'none') out.push(pt ? 'Sem critério "pode ler" no artigo nem na base: todos os usuários leem.' : 'No "can read" criteria on the article or base: all users can read.');
    else out.push(pt ? `Pode ler (${k.canFrom === 'article' ? 'do artigo' : 'da base'}): ${k.canRead.map((c) => `${nm(c)}${v.user ? ` ${mark(c.matches)}` : ''}`).join(', ')} — basta casar um.`
      : `Can read (${k.canFrom === 'article' ? 'article' : 'base'}): ${k.canRead.map((c) => `${nm(c)}${v.user ? ` ${mark(c.matches)}` : ''}`).join(', ')} — matching one is enough.`);
    if (k.why.includes('kb_script')) out.push(pt ? 'Algum critério usa script: não verificado.' : 'Some criteria use a script: not checked.');
  }

  if (v.notes.includes('record_unreadable')) out.push(pt ? 'Não consegui ler o registro com a sua sessão: as condições não foram avaliadas.' : "Couldn't read the record with your session: conditions were not evaluated.");
  out.push(pt ? 'Não verificado: scripts de ACL, filtros de segurança de dados e regras de outras aplicações que o Trail não lê.' : "Not checked: ACL scripts, security data filters and rules from other apps Trail can't read.");
  return out.join('\n');
}
