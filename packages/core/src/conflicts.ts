import type { Row } from './types';
import { evalExpr, scriptVerdict, writesOf, type Env } from './scriptEval';
import { assignedLiterals, evalCondition, parseFieldValues } from './util';

/**
 * Alerta de regras conflitantes: duas regras ativas que gravam o MESMO campo com valores DIFERENTES
 * e cujas condições não se excluem. Não depende de nenhuma mudança ter acontecido; é uma leitura do
 * desenho das regras, para avisar antes de virar chamado.
 *
 * Só entram regras que gravam valores literais (`current.x = '2'`, `setValue('x', '2')`, template).
 * Quando o valor é calculado, o Trail não afirma conflito.
 */

export type RuleKind = 'br_before' | 'br_after' | 'br_async' | 'client_script';
export interface ConflictRule { kind: RuleKind; name: string; sysId: string; table: string; order: number; values: string[]; condition?: string }
export interface RuleConflict {
  field: string;
  a: ConflictRule;
  b: ConflictRule;
  /** 'always': nenhuma das duas tem condição; 'now': as duas condições valem para este registro; 'possible': as condições não se excluem. */
  overlap: 'always' | 'now' | 'possible';
  /** Quem fica com a última palavra quando as duas rodam, se dá para saber. */
  winner?: 'a' | 'b';
  /** Por que esse vence (código para a interface traduzir). */
  why?: 'higher_order' | 'server_after_client' | 'after_update';
}

interface Need { eq?: Set<string>; prefix: string[] }
type Req = Map<string, Need>;

/** Literal: string entre aspas ou número; `q` é o número do grupo da aspa, para a referência de volta. */
const lit = (q: number): string => `(?:(['"])(.*?)\\${q}|(-?\\d+))`;
const val = (m: RegExpMatchArray, i: number) => m[i + 1] ?? m[i + 2] ?? '';

/** Lê uma condição simples do script como exigência sobre um campo; `neg` = a linha só roda quando a condição é FALSA. */
function guardNeeds(cond: string, neg: boolean, add: (f: string, n: Partial<Need>) => void): void {
  const c = cond.trim().replace(/^\((.*)\)$/, '$1');
  // !(a || b) = !a && !b ; (a && b) = a && b
  const parts = neg ? c.split(/\s*\|\|\s*/) : c.split(/\s*&&\s*/);
  if (parts.length > 1) { for (const p of parts) guardNeeds(p, neg, add); return; }
  const f = String.raw`current\.([a-z0-9_]+)`;
  let m = c.match(new RegExp(`^${f}\\s*(===?|!==?)\\s*${lit(3)}$`));
  if (m && ((m[2]!.startsWith('=') && !neg) || (m[2]!.startsWith('!') && neg))) { add(m[1]!, { eq: new Set([val(m, 3)]) }); return; }
  m = c.match(new RegExp(`^${f}(?:\\.toString\\(\\))?\\.indexOf\\(\\s*${lit(2)}\\s*\\)\\s*(===?|!==?)\\s*0$`));
  if (m && ((m[5]!.startsWith('=') && !neg) || (m[5]!.startsWith('!') && neg))) { add(m[1]!, { prefix: [val(m, 2)] }); return; }
  m = c.match(new RegExp(`^${f}(?:\\.toString\\(\\))?\\.startsWith\\(\\s*${lit(2)}\\s*\\)$`));
  if (m && !neg) add(m[1]!, { prefix: [val(m, 2)] });
}

/** Exigências simples por campo (igualdade e prefixo), da encoded query e das condições do script. */
function requirements(filter: string | undefined, guards: { cond: string; neg: boolean }[]): Req {
  const req: Req = new Map();
  const add = (f: string, n: Partial<Need>) => {
    const cur = req.get(f) ?? { prefix: [] };
    if (n.eq) cur.eq = cur.eq ? new Set([...n.eq].filter((v) => cur.eq!.has(v))) : n.eq;
    if (n.prefix) cur.prefix.push(...n.prefix);
    req.set(f, cur);
  };
  if (filter && !/\^NQ|\^OR|javascript:/.test(filter)) {
    for (const t of filter.split('^')) {
      const m = t.match(/^([a-z0-9_]+)(=|IN|STARTSWITH)(.*)$/);
      if (!m) continue;
      if (m[2] === 'STARTSWITH') add(m[1]!, { prefix: [m[3]!] });
      else add(m[1]!, { eq: new Set(m[2] === 'IN' ? m[3]!.split(',') : [m[3]!]) });
    }
  }
  for (const g of guards) guardNeeds(g.cond.replace(/g_form\.getValue\(\s*['"]([a-z0-9_]+)['"]\s*\)/g, 'current.$1').replace(/g_form\.getUniqueValue\(\)/g, 'current.sys_id'), g.neg, add);
  return req;
}

const fits = (v: string, n: Need) => (!n.eq || n.eq.has(v)) && n.prefix.every((p) => v.startsWith(p));
function disjoint(a: Req, b: Req): boolean {
  for (const [f, na] of a) {
    const nb = b.get(f);
    if (!nb) continue;
    if (na.eq && nb.eq && ![...na.eq].some((v) => nb.eq!.has(v))) return true;
    if (na.eq && !na.eq.size || nb.eq && !nb.eq.size) return true;
    if (na.eq && ![...na.eq].some((v) => fits(v, nb))) return true;
    if (nb.eq && ![...nb.eq].some((v) => fits(v, na))) return true;
    for (const pa of na.prefix) for (const pb of nb.prefix) if (!pa.startsWith(pb) && !pb.startsWith(pa)) return true;
  }
  return false;
}

/** Condições que valem para TODAS as gravações do campo no script (as da primeira gravação que se repetem nas demais). */
function commonGuards(scan: ReturnType<typeof writesOf>): { cond: string; neg: boolean }[] {
  const ws = scan?.writes ?? [];
  if (!ws.length) return [];
  return ws[0]!.guards.filter((g) => ws.every((w) => w.guards.some((h) => h.cond === g.cond && h.neg === g.neg)));
}

/** As exigências valem para este registro? true/false quando todos os campos citados são conhecidos; undefined se falta algum. */
function matches(req: Req, rec: Record<string, string>): boolean | undefined {
  let unknown = false;
  for (const [f, n] of req) {
    if (!(f in rec)) { unknown = true; continue; }
    if (!fits(rec[f] ?? '', n)) return false;
  }
  return unknown ? undefined : true;
}

const kindOf = (when: string | undefined): RuleKind => (when === 'before' ? 'br_before' : when === 'async' || when === 'async_always' ? 'br_async' : 'br_after');

export function findConflicts(field: string, brs: Row[], clientScripts: Row[], record: Record<string, string>, max = 8): RuleConflict[] {
  type R = ConflictRule & { req: Req; ops: Set<string>; cond: boolean | undefined; plain: boolean; persists: boolean; script?: string; condScript?: string };
  const rules: R[] = [];
  for (const b of brs) {
    const tpl = parseFieldValues(b.template)[field];
    const lits = assignedLiterals(b.script, field);
    const values = [...new Set([...(lits ?? []), ...(tpl !== undefined ? [tpl] : [])])];
    const scan = writesOf(b.script, field);
    // Grava por expressão ou nome dinâmico: valor desconhecido, nada a afirmar.
    if (!values.length || (lits === undefined && (scan?.writes.length || scan?.dynamic))) continue;
    const guards = commonGuards(scan);
    const kind = kindOf(b.when);
    const ops = new Set([b.action_insert !== 'false' ? 'insert' : '', b.action_update !== 'false' ? 'update' : ''].filter(Boolean));
    const persists = kind === 'br_before' || /current\.update\(\)/.test(b.script ?? '');
    rules.push({
      kind, name: b.name ?? '', sysId: b.sys_id ?? '', table: b.collection ?? '', order: Number(b.order ?? 100), values,
      ...(b.filter_condition ? { condition: b.filter_condition } : {}),
      req: requirements(b.filter_condition, [...guards, ...(b.condition?.trim() ? [{ cond: b.condition, neg: false }] : [])]), ops, cond: undefined,
      plain: !b.filter_condition && !b.condition && !guards.length, persists, script: b.script, condScript: b.condition,
    });
  }
  for (const c of clientScripts) {
    const m = [...(c.script ?? '').matchAll(new RegExp(String.raw`setValue\(\s*['"]${field}['"]\s*,\s*(?:(['"])((?:(?!\1).)*)\1|(-?\d+(?:\.\d+)?))\s*[,)]`, 'g'))];
    const total = ((c.script ?? '').match(new RegExp(String.raw`setValue\(\s*['"]${field}['"]`, 'g')) ?? []).length;
    if (!m.length || m.length !== total) continue;
    const scan = writesOf(c.script, field);
    const guards = commonGuards(scan);
    rules.push({
      kind: 'client_script', name: c.name ?? '', sysId: c.sys_id ?? '', table: c.table ?? '', order: 0, values: [...new Set(m.map((x) => x[2] ?? x[3] ?? ''))],
      req: requirements(undefined, guards), ops: new Set(['insert', 'update']), cond: undefined, plain: !guards.length, persists: true, script: c.script,
    });
  }

  // A regra vale para este registro? (filtro avaliado e exigências simples do script)
  // Valores atuais do registro; o que mudou numa gravação futura não se sabe, então changes() fica desconhecido.
  const env: Env = { rec: record, old: record, changed: new Set(), unknownChanges: true };
  for (const r of rules) {
    const f = r.condition ? evalCondition(r.condition, record) : true;
    const c = r.condScript?.trim() ? evalExpr(r.condScript, env) : true;
    const cOk = c === undefined ? undefined : !(c === false || c === '' || c === 0 || c === null);
    const v = scriptVerdict(r.script, field, env);
    const reach = v ? v.reachable : undefined;
    const m = matches(r.req, record);
    r.cond = f === false || cOk === false || reach === false || m === false ? false : f === true && cOk === true && m !== undefined && (reach === true || !v?.writes) ? true : undefined;
  }
  const keys = (r: R) => [...r.req.keys()].sort().join(',');
  const out: RuleConflict[] = [];
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = rules[i]!, b = rules[j]!;
    if (!a.persists || !b.persists) continue;
    if (![...a.ops].some((o) => b.ops.has(o))) continue;
    // Valores: conflito só quando nenhuma combinação dá o mesmo resultado garantido (cada uma com um valor, diferentes).
    if (a.values.length !== 1 || b.values.length !== 1 || a.values[0] === b.values[0]) continue;
    if (disjoint(a.req, b.req)) continue;
    // Uma das duas não vale para este registro: o painel é deste registro, então não avisa.
    if (a.cond === false || b.cond === false) continue;
    // Só "possível" quando as duas dependem dos mesmos campos (senão qualquer par de regras com condições diferentes viraria alerta).
    const overlap: RuleConflict['overlap'] = a.plain && b.plain ? 'always' : (a.plain || a.cond === true) && (b.plain || b.cond === true) ? 'now' : 'possible';
    if (overlap === 'possible' && (a.plain || b.plain || keys(a) !== keys(b))) continue;
    let winner: RuleConflict['winner']; let why: RuleConflict['why'];
    const rank = (r: R) => (r.kind === 'client_script' ? 0 : r.kind === 'br_before' ? 1 : 2);
    if (rank(a) !== rank(b)) { winner = rank(a) > rank(b) ? 'a' : 'b'; why = rank(a) === 0 || rank(b) === 0 ? (Math.max(rank(a), rank(b)) === 2 ? 'after_update' : 'server_after_client') : 'after_update'; }
    else if (a.kind === 'br_before' && a.order !== b.order) { winner = a.order > b.order ? 'a' : 'b'; why = 'higher_order'; }
    const strip = ({ req: _r, ops: _o, cond: _c, plain: _p, persists: _s, script: _x, condScript: _y, ...r }: R): ConflictRule => r;
    out.push({ field, a: strip(a), b: strip(b), overlap, ...(winner ? { winner, why } : {}) });
  }
  const w = { always: 0, now: 1, possible: 2 };
  return out.sort((x, y) => w[x.overlap] - w[y.overlap]).slice(0, max);
}

/** Campos que um script grava com nome fixo (`current.x =`, `setValue('x'`, template `x=v`). */
export function writtenFields(script: string | undefined, template?: string): string[] {
  const out = new Set<string>();
  for (const m of (script ?? '').matchAll(/\bcurrent\.([a-z][a-z0-9_]*)\s*=(?!=)/g)) out.add(m[1]!);
  for (const m of (script ?? '').matchAll(/\.setValue\(\s*['"]([a-z][a-z0-9_]*)['"]\s*,/g)) out.add(m[1]!);
  for (const f of Object.keys(parseFieldValues(template))) out.add(f);
  return [...out];
}

export interface TableConflictScan { table: string; tables: string[]; rules: number; clientScripts: number; fields: number; conflicts: RuleConflict[]; timing: { totalMs: number; calls: number } }

/**
 * Varredura da tabela inteira: todas as BRs e client scripts ativos da hierarquia, campo por campo.
 * Sem registro, só entram os pares que conflitam sempre (sem condição) ou que dependem dos mesmos campos
 * com condições que não se excluem.
 */
export async function scanTableConflicts(client: { query: (r: { table: string; query: string; fields: string[]; limit: number }) => Promise<{ rows: Row[] }>; calls: number }, table: string): Promise<TableConflictScan> {
  const started = Date.now();
  const calls0 = client.calls;
  const q = async (t: string, query: string, fields: string[], limit: number) => (await client.query({ table: t, query, fields, limit })).rows;
  const tables: string[] = [];
  let cur: string | undefined = table;
  for (let i = 0; cur && i < 10; i++) {
    tables.push(cur);
    cur = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1))[0]?.['super_class.name'] || undefined;
  }
  const [brs, cs] = await Promise.all([
    q('sys_script', `collectionIN${tables.join(',')}^active=true`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition', 'action_insert', 'action_update'], 1000),
    q('sys_script_client', `tableIN${tables.join(',')}^active=true^scriptLIKEsetValue`, ['sys_id', 'name', 'type', 'field', 'table', 'script'], 500),
  ]);
  const byField = new Map<string, { brs: Row[]; cs: Row[] }>();
  const slot = (f: string) => { let s = byField.get(f); if (!s) byField.set(f, (s = { brs: [], cs: [] })); return s; };
  for (const b of brs) for (const f of writtenFields(b.script, b.template)) slot(f).brs.push(b);
  for (const c of cs) for (const f of writtenFields(c.script)) slot(f).cs.push(c);
  const conflicts: RuleConflict[] = [];
  for (const [f, s] of byField) if (s.brs.length + s.cs.length > 1) conflicts.push(...findConflicts(f, s.brs, s.cs, {}, 50));
  const w = { always: 0, now: 1, possible: 2 };
  conflicts.sort((a, b) => w[a.overlap] - w[b.overlap] || a.field.localeCompare(b.field));
  return { table, tables, rules: brs.length, clientScripts: cs.length, fields: byField.size, conflicts, timing: { totalMs: Date.now() - started, calls: client.calls - calls0 } };
}
