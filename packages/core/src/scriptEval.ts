/**
 * Leitura estática de scripts do ServiceNow (BR, client script, UI action), sem executar nada.
 *
 *  - writesOf(script, field): onde o script grava o campo, com a expressão gravada e as condições
 *    (if / else / return antecipado) que precisam valer para aquela linha rodar.
 *  - evalExpr(expr, env): avalia um subconjunto pequeno de JavaScript com os valores do registro
 *    (current.x, previous.x, g_form.getValue('x'), changes(), changesTo(), indexOf, +, ==, &&, || ...).
 *    O que não reconhece vira `undefined` e nunca vira um palpite.
 */

export interface Env {
  /** Valores do registro na gravação (os novos). */
  rec: Record<string, string>;
  /** Valores antes da gravação (previous / oldValue). */
  old: Record<string, string>;
  /** Campos que mudaram nesta gravação. */
  changed: Set<string>;
  /** Não se sabe o que mudou (leitura do desenho das regras, fora de uma gravação): changes() vira desconhecido. */
  unknownChanges?: boolean;
  /** Quem fez a gravação (gs.getUserID() / gs.getUserName()). */
  user?: { sysId?: string; name?: string };
  /** Client script onChange: valor novo e antigo do campo que disparou. */
  newValue?: string;
  oldValue?: string;
  /** Variáveis locais (var x = ...). */
  vars?: Record<string, Val>;
}

export type Val = string | number | boolean | undefined | null;

export interface Guard { cond: string; neg: boolean }
export interface Write { expr: string | null; guards: Guard[]; at: number }
export interface WriteScan { writes: Write[]; /** grava por nome dinâmico (setValue(variavel), current[x], applyTemplate) */ dynamic: boolean; vars: { name: string; expr: string; at: number }[] }

// ---------------------------------------------------------------- máscara de strings e comentários

/** Troca o conteúdo de strings e comentários por espaços (mesmo tamanho), para achar a estrutura sem ser enganado por texto. */
function mask(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += ' '.repeat(end - i); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n' && c !== '`') break; j++; }
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + (j < src.length ? c : '');
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function matchClose(m: string, open: number): number {
  const o = m[open]!; const cl = o === '(' ? ')' : o === '{' ? '}' : ']';
  let d = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === o) d++;
    else if (m[i] === cl) { d--; if (d === 0) return i; }
  }
  return -1;
}

/** Fim de um comando simples: `;` fora de parênteses/chaves, ou fim da linha quando não há `;`. */
function stmtEnd(m: string, from: number): number {
  let d = 0;
  for (let i = from; i < m.length; i++) {
    const c = m[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { if (d === 0) return i; d--; }
    else if (c === ';' && d === 0) return i;
    else if (c === '\n' && d === 0) {
      const rest = m.slice(i + 1).trimStart();
      if (!/^[.+\-*/?:&|]/.test(rest) && !/[+\-*/=&|,(]\s*$/.test(m.slice(from, i))) return i;
    }
  }
  return m.length;
}

const skipWs = (m: string, i: number) => { while (i < m.length && /\s/.test(m[i]!)) i++; return i; };

// ---------------------------------------------------------------- onde o campo é gravado

export function writesOf(script: string | undefined, field: string): WriteScan | undefined {
  if (!script) return undefined;
  const m = mask(script);
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Escopos abertos: cada `{` empilha as condições que valem dentro dele.
  type Frame = { close: number; guards: Guard[]; early: Guard[] };
  const frames: Frame[] = [{ close: m.length + 1, guards: [], early: [] }];
  const singles: { start: number; end: number; guard: Guard }[] = [];
  const blockGuards = new Map<number, Guard[]>(); // posição do `{` -> condições do bloco
  const writes: Write[] = [];
  const vars: WriteScan['vars'] = [];
  // Nome dinâmico só quando GRAVA: current[x] = ..., current[x].setValue(...), setValue(variavel, ...), applyTemplate. Ler current[x].changes() não conta.
  const dynamic = /\bcurrent\s*\[[^\]]*(?:\[[^\]]*\][^\]]*)*\]\s*(?:=(?!=)|\.setValue\s*\()|applyTemplate\s*\(|setValue\(\s*[a-zA-Z_$]/.test(m);

  const guardsAt = (p: number): Guard[] => [
    ...frames.flatMap((fr) => [...fr.guards, ...fr.early]),
    ...singles.filter((s) => p >= s.start && p <= s.end).map((s) => s.guard),
  ];

  // Pré-processa os if/else: para cada bloco ou comando simples, as condições que o protegem.
  const ifRe = /\b(else\s+if|if)\s*\(/g;
  const pendingElse = new Map<number, Guard[]>(); // fim do bloco/comando do if -> condições negadas para o else
  let mt: RegExpExecArray | null;
  while ((mt = ifRe.exec(m))) {
    const open = mt.index + mt[0].length - 1;
    const close = matchClose(m, open);
    if (close < 0) break;
    const cond = script.slice(open + 1, close).trim();
    const elseIf = mt[1]!.startsWith('else');
    const prior = elseIf ? (pendingElse.get(mt.index) ?? []) : [];
    const g: Guard[] = [...prior, { cond, neg: false }];
    const b = skipWs(m, close + 1);
    let end: number;
    if (m[b] === '{') {
      end = matchClose(m, b);
      if (end < 0) break;
      const body = script.slice(b + 1, end).trim();
      if (/^return\b[^;]*;?$/.test(body)) singles.push({ start: end + 1, end: -1, guard: { cond, neg: true } }); // marcado abaixo
      blockGuards.set(b, g);
    } else {
      end = stmtEnd(m, b);
      const body = script.slice(b, end).trim();
      if (/^return\b/.test(body)) singles.push({ start: end + 1, end: -1, guard: { cond, neg: true } });
      for (const p of prior) singles.push({ start: b, end, guard: p });
      singles.push({ start: b, end, guard: { cond, neg: false } });
    }
    // else logo depois?
    const e = skipWs(m, end + 1);
    if (m.startsWith('else', e)) {
      const neg: Guard[] = [...prior, { cond, neg: true }];
      const after = skipWs(m, e + 4);
      if (m.startsWith('if', after)) pendingElse.set(e, neg);
      else if (m[after] === '{') blockGuards.set(after, [...(blockGuards.get(after) ?? []), ...neg]);
      else { const se = stmtEnd(m, after); for (const g2 of neg) singles.push({ start: after, end: se, guard: g2 }); }
    }
  }
  // "if (x) return;" protege o resto do escopo onde está: fecha no fim do bloco que o contém.
  for (const s of singles.filter((s) => s.end === -1)) {
    let d = 0; let close = m.length;
    for (let i = s.start; i < m.length; i++) { if (m[i] === '{') d++; else if (m[i] === '}') { if (d === 0) { close = i; break; } d--; } }
    s.end = close;
  }

  const assignRe = new RegExp(String.raw`(?:\.${f}\s*=(?!=)|\bsetValue\(\s*['"]${f}['"]\s*,|\.${f}\.(?:setValue|setDisplayValue)\s*\()`, 'g');
  const varRe = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g;
  const marks: { at: number; kind: 'w' | 'v'; mt: RegExpExecArray }[] = [];
  let a: RegExpExecArray | null;
  // Procura no texto original (o nome do campo fica dentro de aspas em setValue) e descarta o que estiver dentro de string ou comentário.
  while ((a = assignRe.exec(script))) if (m[a.index] === script[a.index]) marks.push({ at: a.index, kind: 'w', mt: a });
  while ((a = varRe.exec(m))) marks.push({ at: a.index, kind: 'v', mt: a });
  marks.sort((x, y) => x.at - y.at);

  // Varre a estrutura em ordem, abrindo e fechando escopos, e registra as gravações.
  let mi = 0;
  for (let i = 0; i <= m.length; i++) {
    while (frames.length > 1 && i > frames[frames.length - 1]!.close) frames.pop();
    while (mi < marks.length && marks[mi]!.at === i) {
      const k = marks[mi]!; mi++;
      const start = k.at + k.mt[0].length;
      if (k.kind === 'v') { const e = stmtEnd(m, start); vars.push({ name: k.mt[1]!, expr: script.slice(start, e).trim(), at: k.at }); continue; }
      let expr: string | null;
      if (k.mt[0].endsWith('(') || k.mt[0].endsWith(',')) {
        // setValue('campo', expr) / .campo.setValue(expr): até o `)` que fecha.
        let d = 1; let j = start;
        for (; j < m.length; j++) { if (m[j] === '(') d++; else if (m[j] === ')') { d--; if (d === 0) break; } }
        const inner = script.slice(start, j).trim();
        expr = /setDisplayValue\s*\($/.test(k.mt[0]) ? null : (/^[^,]*,/.test(mask(inner)) && k.mt[0].endsWith('(') ? inner.split(',')[0]!.trim() : inner);
      } else {
        const e = stmtEnd(m, start);
        expr = script.slice(start, e).trim();
      }
      writes.push({ expr: expr || null, guards: guardsAt(k.at), at: k.at });
    }
    if (m[i] === '{') {
      const close = matchClose(m, i);
      frames.push({ close: close < 0 ? m.length : close, guards: blockGuards.get(i) ?? [], early: [] });
    }
  }
  return { writes, dynamic, vars };
}

// ---------------------------------------------------------------- avaliador

type Tok = { t: 'num' | 'str' | 'id' | 'op'; v: string };

function tokenize(s: string): Tok[] | undefined {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) { const m = /^\d+(?:\.\d+)?/.exec(s.slice(i))!; out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; let v = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') { j++; v += s[j] ?? ''; } else v += s[j]; j++; }
      if (j >= s.length) return undefined;
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i))!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const ops = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '(', ')', '.', ',', '!', '+', '-', '<', '>', '?', ':', '[', ']'];
    const op = ops.find((o) => s.startsWith(o, i));
    if (!op) return undefined;
    out.push({ t: 'op', v: op }); i += op.length;
  }
  return out;
}

const U = undefined;
const str = (v: Val): string | undefined => (v === undefined ? U : v === null ? '' : String(v));

/** Referência a um campo: guarda de onde veio para aceitar métodos de GlideElement. */
interface FieldRef { kind: 'field'; obj: 'current' | 'previous'; name: string }
type Node = Val | FieldRef | { kind: 'obj'; name: string };

function isRef(n: Node): n is FieldRef { return typeof n === 'object' && n !== null && (n as FieldRef).kind === 'field'; }
function isObj(n: Node): n is { kind: 'obj'; name: string } { return typeof n === 'object' && n !== null && (n as { kind: string }).kind === 'obj'; }

/** Avalia uma expressão. `undefined` = não deu para saber (nunca chuta). */
export function evalExpr(expr: string, env: Env): Val {
  const t0 = tokenize(expr);
  if (!t0) return U;
  const toks: Tok[] = t0;
  let p = 0;
  const peek = (v?: string) => (p < toks.length && (v === undefined || toks[p]!.v === v) ? toks[p] : undefined);
  const eat = (v: string) => { if (toks[p]?.v === v) { p++; return true; } return false; };
  let bad = false;

  const fieldVal = (r: FieldRef): Val => {
    const src = r.obj === 'previous' ? env.old : env.rec;
    return r.name in src ? src[r.name]! : U;
  };
  const value = (n: Node): Val => (isRef(n) ? fieldVal(n) : isObj(n) ? U : n);

  function primary(): Node {
    const t = toks[p];
    if (!t) { bad = true; return U; }
    if (t.t === 'num') { p++; return Number(t.v); }
    if (t.t === 'str') { p++; return t.v; }
    if (t.v === '(') { p++; const v = ternary(); if (!eat(')')) bad = true; return v; }
    if (t.t === 'id') {
      p++;
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null' || t.v === 'undefined') return null;
      if (t.v === 'isLoading') return false;
      if (t.v === 'newValue') return env.newValue ?? U;
      if (t.v === 'oldValue') return env.oldValue ?? U;
      if (t.v === 'current' || t.v === 'previous' || t.v === 'g_form' || t.v === 'gs') return { kind: 'obj', name: t.v };
      if (env.vars && t.v in env.vars) return env.vars[t.v];
      return U;
    }
    bad = true; return U;
  }

  function args(): Val[] {
    const out: Val[] = [];
    if (eat(')')) return out;
    do out.push(value(ternary())); while (eat(','));
    if (!eat(')')) bad = true;
    return out;
  }

  function postfix(): Node {
    let n = primary();
    for (;;) {
      if (eat('.')) {
        const id = toks[p]; if (!id || id.t !== 'id') { bad = true; return U; }
        p++;
        const call = eat('(');
        const a = call ? args() : [];
        n = member(n, id.v, call, a);
      } else break;
    }
    return n;
  }

  function member(n: Node, name: string, call: boolean, a: Val[]): Node {
    if (isObj(n)) {
      if (n.name === 'current' || n.name === 'previous') {
        if (!call) return { kind: 'field', obj: n.name, name };
        if (name === 'getValue') return a[0] !== undefined ? value({ kind: 'field', obj: n.name, name: String(a[0]) }) : U;
        if (name === 'getDisplayValue') return U;
        if (name === 'isNewRecord') return false;
        if (name === 'getUniqueValue') return env.rec.sys_id ?? U;
        if (name === 'operation') return 'update';
        if (name === 'changes') return env.unknownChanges ? U : env.changed.size > 0;
        return U;
      }
      if (n.name === 'gs' && call) {
        if (name === 'getUserID') return env.user?.sysId || U;
        if (name === 'getUserName') return env.user?.name || U;
        return U;
      }
      if (n.name === 'g_form') {
        if (call && (name === 'getValue' || name === 'getDisplayBox')) { const f = str(a[0]); return f !== undefined && f in env.rec ? env.rec[f]! : U; }
        if (call && name === 'getUniqueValue') return env.rec.sys_id ?? U;
        return U;
      }
      return U;
    }
    if (isRef(n)) {
      if (!call) return U; // current.campo.algo sem chamada
      if (env.unknownChanges && (name === 'changes' || name === 'changesTo' || name === 'changesFrom')) return U;
      if (name === 'changes') return n.obj === 'current' ? env.changed.has(n.name) : U;
      if (name === 'changesTo') return n.obj === 'current' ? (env.changed.has(n.name) ? (fieldVal(n) === U ? U : str(fieldVal(n)) === str(a[0])) : false) : U;
      if (name === 'changesFrom') return n.obj === 'current' ? (env.changed.has(n.name) ? (n.name in env.old ? env.old[n.name] === str(a[0]) : U) : false) : U;
      if (name === 'nil') { const v = fieldVal(n); return v === U ? U : str(v) === ''; }
      // getDisplayValue() devolve o rótulo ("2 - Medium", nome do grupo), que não temos aqui: desconhecido, nunca o valor cru.
      if (name === 'getDisplayValue') return U;
      if (name === 'getValue' || name === 'toString') return fieldVal(n);
      return stringMethod(fieldVal(n), name, a);
    }
    if (!call) return name === 'length' && typeof n === 'string' ? n.length : U;
    return stringMethod(n as Val, name, a);
  }

  function stringMethod(v: Val, name: string, a: Val[]): Val {
    if (v === U || a.some((x) => x === U)) return U;
    const s = String(v ?? '');
    const x = String(a[0] ?? '');
    switch (name) {
      case 'indexOf': return s.indexOf(x);
      case 'startsWith': return s.startsWith(x);
      case 'endsWith': return s.endsWith(x);
      case 'includes': return s.includes(x);
      case 'toLowerCase': return s.toLowerCase();
      case 'toUpperCase': return s.toUpperCase();
      case 'trim': return s.trim();
      case 'toString': return s;
      default: return U;
    }
  }

  function unary(): Val {
    if (eat('!')) { const v = unary(); return v === U ? U : !truthy(v); }
    if (eat('-')) { const v = unary(); return v === U ? U : -Number(v); }
    return value(postfix());
  }
  function additive(): Val {
    let l = unary();
    while (peek('+') || peek('-')) {
      const op = toks[p++]!.v; const r = unary();
      if (l === U || r === U) { l = U; continue; }
      if (op === '+') l = typeof l === 'number' && typeof r === 'number' ? l + r : String(l ?? '') + String(r ?? '');
      else l = Number(l) - Number(r);
    }
    return l;
  }
  function relational(): Val {
    let l = additive();
    while (peek('<') || peek('>') || peek('<=') || peek('>=')) {
      const op = toks[p++]!.v; const r = additive();
      if (l === U || r === U) { l = U; continue; }
      const a = Number(l), b = Number(r);
      l = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    }
    return l;
  }
  function equality(): Val {
    let l = relational();
    while (peek('==') || peek('!=') || peek('===') || peek('!==')) {
      const op = toks[p++]!.v; const r = relational();
      if (l === U || r === U) { l = U; continue; }
      // No ServiceNow os campos chegam como texto: '1' == 1 vale. Comparamos como texto.
      // Campo booleano: GlideElement == true compara com '1'/'true'.
      const asBool = (v: Val) => (v === true || v === '1' || v === 'true' ? 'true' : v === false || v === '0' || v === 'false' || v === '' ? 'false' : String(v));
      const eq = typeof l === 'boolean' || typeof r === 'boolean' ? asBool(l) === asBool(r) : String(l ?? '') === String(r ?? '');
      l = op.startsWith('!') ? !eq : eq;
    }
    return l;
  }
  function and(): Val {
    let l = equality();
    while (eat('&&')) { const r = equality(); l = l === false || r === false ? false : l === U || r === U ? U : truthy(l) && truthy(r); }
    return l;
  }
  function or(): Val {
    let l = and();
    while (eat('||')) { const r = and(); l = (l !== U && truthy(l)) || (r !== U && truthy(r)) ? true : l === U || r === U ? U : false; }
    return l;
  }
  function ternary(): Val {
    const c = or();
    if (eat('?')) { const a = ternary(); if (!eat(':')) { bad = true; return U; } const b = ternary(); return c === U ? U : truthy(c) ? a : b; }
    return c;
  }
  const v = ternary();
  if (bad || p !== toks.length) return U;
  return v;
}

function truthy(v: Val): boolean {
  if (typeof v === 'string') return v !== '' && v !== 'false';
  return !!v;
}

/** Condição de um trecho: true, false ou undefined quando não dá para avaliar. */
export function evalGuard(g: Guard, env: Env): boolean | undefined {
  const v = evalExpr(g.cond, env);
  if (v === U) return U;
  const t = truthy(v);
  return g.neg ? !t : t;
}

/** Variáveis locais definidas antes de `at`, avaliadas em ordem. */
export function varsBefore(scan: WriteScan, at: number, env: Env): Record<string, Val> {
  const vars: Record<string, Val> = {};
  for (const v of scan.vars.filter((x) => x.at < at)) vars[v.name] = evalExpr(v.expr, { ...env, vars });
  return vars;
}

export interface ScriptVerdict {
  /** O script grava o campo (de forma reconhecível)? */
  writes: boolean;
  /** Grava por nome dinâmico: não dá para afirmar que não grava. */
  dynamic: boolean;
  /** Alguma gravação pode ter rodado (condições não falsas)? false = todas as condições falham. */
  reachable: boolean | undefined;
  /** As condições da gravação escolhida valem com certeza. */
  guardsTrue: boolean;
  /** Valores que as gravações alcançáveis produzem (undefined = não calculável). */
  values: (string | undefined)[];
  /** Condição que falhou, para explicar. */
  failed?: string;
}

/** Junta tudo: o script grava o campo? com que valor? as condições valem para este registro? */
export function scriptVerdict(script: string | undefined, field: string, env: Env): ScriptVerdict | undefined {
  const scan = writesOf(script, field);
  if (!scan) return undefined;
  if (!scan.writes.length) return { writes: false, dynamic: scan.dynamic, reachable: scan.dynamic ? U : false, guardsTrue: false, values: [] };
  let anyUnknown = false; let anyTrue = false; let failed: string | undefined;
  const values: (string | undefined)[] = [];
  for (const w of scan.writes) {
    const vars = varsBefore(scan, w.at, env);
    const e = { ...env, vars };
    const rs = w.guards.map((g) => ({ g, r: evalGuard(g, e) }));
    const bad = rs.find((x) => x.r === false);
    if (bad) { failed ??= (bad.g.neg ? '!' : '') + bad.g.cond; continue; }
    const unknown = rs.some((x) => x.r === U);
    if (unknown) anyUnknown = true; else anyTrue = true;
    values.push(w.expr === null ? U : str(evalExpr(w.expr, e)));
  }
  const reachable = anyTrue ? true : anyUnknown ? U : false;
  return { writes: true, dynamic: scan.dynamic, reachable: scan.dynamic && reachable === false ? U : reachable, guardsTrue: anyTrue && !anyUnknown, values, failed };
}

/** Campos do registro que o script lê (para buscar o valor antes de avaliar). */
export function fieldsRead(script: string | undefined): string[] {
  if (!script) return [];
  const out = new Set<string>();
  for (const m of script.matchAll(/\b(?:current|previous)\.([a-z][a-z0-9_]*)/g)) if (!['update', 'insert', 'setValue', 'getValue', 'isNewRecord', 'operation', 'sys_id', 'setAbortAction', 'addQuery', 'get'].includes(m[1]!)) out.add(m[1]!);
  for (const m of script.matchAll(/(?:g_form|current|previous)\.getValue\(\s*['"]([a-z0-9_]+)['"]/g)) out.add(m[1]!);
  return [...out];
}
