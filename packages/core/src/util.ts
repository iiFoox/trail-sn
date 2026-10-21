import type { Row } from './types';
/** Datas da ServiceNow são "YYYY-MM-DD HH:mm:ss" em UTC. */
export function toMs(t: string): number {
  return new Date(t.replace(' ', 'T') + 'Z').getTime();
}

export function shift(t: string, seconds: number): string {
  return new Date(toMs(t) + seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export function timeOfDay(t: string | undefined): string {
  return t ? t.slice(11, 19) : '';
}

/** Diferença em ms entre duas horas do dia, ignorando a data. */
export function timeOfDayDiffMs(a: string, b: string): number {
  return Math.abs(toMs('1970-01-01 ' + timeOfDay(a)) - toMs('1970-01-01 ' + timeOfDay(b)));
}

/**
 * O texto referencia o campo? Cobre `current.state`, `'state'`, `"state"`,
 * `state=` no início de linha e `^state=` em encoded queries/templates.
 */
export function refsField(text: string | undefined, field: string): boolean {
  if (!text) return false;
  const f = escapeRegExp(field);
  const re = new RegExp(`(\\.${f}\\b|['"]${f}['"]|^${f}=|\\^${f}=)`, 'm');
  return re.test(text);
}

export function refsAnyTable(text: string | undefined, tables: string[]): string | null {
  if (!text) return null;
  for (const t of tables) {
    if (new RegExp(`['"]${escapeRegExp(t)}['"]`).test(text)) return t;
  }
  return null;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Executa uma promessa com limite de tempo; estourou devolve `fallback`. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}

/** Funde janelas [from,to] que se sobrepõem, para consultar uma vez só. */
export function mergeWindows(windows: { from: string; to: string }[]): { from: string; to: string }[] {
  const sorted = [...windows].sort((a, b) => a.from.localeCompare(b.from));
  const out: { from: string; to: string }[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.from <= last.to) {
      if (w.to > last.to) last.to = w.to;
    } else {
      out.push({ ...w });
    }
  }
  return out;
}

type Tri = boolean | undefined;
type Changes = { set: Set<string>; old: Record<string, string> };

/** E de três valores: um falso decide; senão, um "não sei" contamina. */
function and3(vals: Tri[]): Tri {
  if (vals.some((v) => v === false)) return false;
  return vals.some((v) => v === undefined) ? undefined : true;
}
/** OU de três valores: um verdadeiro decide; senão, um "não sei" contamina. */
function or3(vals: Tri[]): Tri {
  if (vals.some((v) => v === true)) return true;
  return vals.some((v) => v === undefined) ? undefined : false;
}

/** Marca de termo que o motor não sabe ler (operador ou formato desconhecido). Torna a condição inteira não avaliável. */
const UNKNOWN = Symbol('unknown');

function evalTerm(term: string, rec: Record<string, string>, skipField: string | undefined, changes: Changes | undefined): Tri | typeof UNKNOWN {
  if (/javascript:/.test(term)) return UNKNOWN;
  const c = term.match(/^([a-z0-9_]+)(VALCHANGES|CHANGESTO|CHANGESFROM)(.*)$/);
  if (c) {
    if (!changes) return undefined;
    const [, f, op, val] = c as unknown as [string, string, string, string];
    if (!changes.set.has(f)) return false;
    if (op === 'VALCHANGES') return true;
    if (op === 'CHANGESTO') { if (f === skipField || !(f in rec)) return undefined; return rec[f] === val; }
    if (!(f in changes.old)) return undefined;
    return changes.old[f] === val;
  }
  const m = term.match(/^([a-z0-9_]+)(ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOTLIKE|LIKE|NOT IN|IN|!=|=)(.*)$/);
  if (!m) return UNKNOWN;
  const [, field, op, raw] = m as unknown as [string, string, string, string];
  if (field === skipField || !(field in rec)) return undefined;
  const v = rec[field] ?? '';
  const val = raw ?? '';
  switch (op) {
    case 'ISEMPTY': return v === '';
    case 'ISNOTEMPTY': return v !== '';
    case 'STARTSWITH': return v.startsWith(val);
    case 'ENDSWITH': return v.endsWith(val);
    case 'LIKE': return v.includes(val);
    case 'NOTLIKE': return !v.includes(val);
    case 'IN': return val.split(',').includes(v);
    case 'NOT IN': return !val.split(',').includes(v);
    case '!=': return v !== val;
    default: return v === val;
  }
}

/**
 * Avalia uma encoded query contra o registro, com a semântica da ServiceNow:
 * - `^` é E; `^OR` é OU com o termo anterior (o OU liga mais forte que o E: `a^b^ORc` = a E (b OU c));
 * - `^NQ` começa uma nova consulta, e o resultado é o OU dos blocos;
 * - `^EQ` e `ORDERBY…` são ignorados.
 *
 * Lógica de três valores: true/false quando dá para decidir, undefined quando depende de algo que não sabemos
 * (campo ausente do registro, `skipField`, mudança sem `changes`). Um termo com operador ou formato desconhecido (ou
 * `javascript:`) deixa a condição inteira não avaliável, como antes. `changes` diz o que mudou na gravação avaliada
 * (para VALCHANGES, CHANGESTO e CHANGESFROM); sem ele, esses termos ficam "não avaliados".
 */
export function evalCondition(cond: string | undefined, rec: Record<string, string>, skipField?: string, changes?: Changes): boolean | undefined {
  if (!cond) return undefined;
  const blocks: Tri[] = [];
  for (const q of cond.split('^NQ')) {
    const groups: Tri[][] = [];
    for (const part of q.split('^')) {
      if (!part || part === 'EQ' || part.startsWith('ORDERBY')) continue;
      // Campos são minúsculos: "OR" maiúsculo no começo é sempre o OU da encoded query.
      const isOr = part.startsWith('OR') && groups.length > 0;
      const r = evalTerm(isOr ? part.slice(2) : part, rec, skipField, changes);
      if (r === UNKNOWN) return undefined;
      if (isOr) groups[groups.length - 1]!.push(r);
      else groups.push([r]);
    }
    if (groups.length) blocks.push(and3(groups.map(or3)));
  }
  if (!blocks.length) return undefined;
  return or3(blocks);
}

/** Campos citados numa encoded query (para buscar só o necessário do registro). */
export function conditionFields(cond: string | undefined): string[] {
  if (!cond) return [];
  return [...new Set(cond.split(/\^(?:OR|NQ)?/).map((t) => t.match(/^([a-z0-9_]+)(?:ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOTLIKE|LIKE|NOT IN|IN|!=|=|CHANGESTO)/)?.[1]).filter((x): x is string => !!x))];
}

/**
 * Valores literais que um script grava no campo (`x.campo = 'v'`, `x.campo = 2`, `setValue('campo', 'v')`).
 * undefined quando o script não grava o campo de forma reconhecível ou grava algo não literal (variável, expressão).
 */
export function assignedLiterals(script: string | undefined, field: string): string[] | undefined {
  if (!script) return undefined;
  const f = escapeRegExp(field);
  const lit = String.raw`\s*(?:(['"])((?:(?!\1).)*)\1|(-?\d+(?:\.\d+)?))\s*(?=[;)\n}]|$)`;
  const anyAssign = new RegExp(String.raw`(?:\.${f}\s*=(?!=)|setValue\(\s*['"]${f}['"]\s*,)`, 'g');
  const litAssign = new RegExp(String.raw`(?:\.${f}\s*=(?!=)|setValue\(\s*['"]${f}['"]\s*,)` + lit, 'g');
  const total = (script.match(anyAssign) ?? []).length;
  if (!total) return undefined;
  const vals = [...script.matchAll(litAssign)].map((m) => m[2] ?? m[3] ?? '');
  return vals.length === total ? vals : undefined;
}

/**
 * Valores de uma ação de flow (sys_hub_action_instance_v2.values): JSON puro ou JSON em gzip+base64 ("H4sI...").
 * Devolve a lista de parâmetros, ou undefined se não der para ler.
 */
export async function decodeFlowValues(raw: string | undefined): Promise<{ name?: string; value?: string }[] | undefined> {
  if (!raw) return undefined;
  try {
    let text = raw.trim();
    if (!text.startsWith('[') && !text.startsWith('{')) {
      const bin = atob(text);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    }
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as { name?: string; value?: string }[]) : undefined;
  } catch { return undefined; }
}

/**
 * Valor de um campo numa ação de flow que não é fixo: pílula (`{{Trigger.current.x}}`) ou script. No PDI (21/10/2026) o
 * valor calculado por script aparece literalmente como `fd-scripted` em `values` ("close_notes=fd-scripted").
 */
export const isDynamicFlowValue = (v: string): boolean => v.includes('{{') || v.trim() === 'fd-scripted';

/** "notify=3^urgency=1" → { notify: '3', urgency: '1' } (campos que a ação de flow grava). */
export function parseFieldValues(q: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (q ?? '').split('^')) {
    const i = part.indexOf('=');
    if (i > 0 && part !== 'EQ') out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/**
 * Botão clicado no formulário: o parâmetro sys_action traz o sys_id da UI action ou, quando ela tem
 * action_name, o próprio action_name (ex.: "resolve_incident"). Os botões de salvar (sysverb_*) ficam de fora.
 */
export function uiActionRef(url: string | undefined): string | undefined {
  // Workspace: o botão roda como /api/now/ui/ui_action/<sys_id>?sysparm_table=...&sysparm_sys_id=...
  const ws = (url ?? '').match(/\/api\/now\/ui\/ui_action\/([0-9a-f]{32})/);
  if (ws) return ws[1];
  const m = (url ?? '').match(/[?&]sys_action=([^&]+)/);
  if (!m) return undefined;
  let v = m[1]!;
  try { v = decodeURIComponent(v); } catch { /* fica como veio */ }
  return v && !/^sysverb_/.test(v) && v !== 'none' ? v : undefined;
}
export const isSysId = (v: string): boolean => /^[0-9a-f]{32}$/.test(v);
/** Consulta de sys_ui_action para as referências vistas nas transações (sys_id ou action_name). */
export function uiActionQuery(refs: string[], tables: string[]): string {
  const ids = refs.filter(isSysId);
  const names = refs.filter((r) => !isSysId(r) && /^[\w.-]+$/.test(r));
  const parts: string[] = [];
  if (ids.length) parts.push(`sys_idIN${ids.join(',')}`);
  if (names.length) parts.push(`action_nameIN${names.join(',')}^tableIN${[...tables, 'global'].join(',')}`);
  return parts.join('^NQ');
}
/** A UI action corresponde à referência da transação? */
export const uiActionMatches = (ua: Row | undefined, ref: string | undefined): boolean => !!ua && !!ref && (ua.sys_id === ref || (!isSysId(ref) && ua.action_name === ref));

/** Campo booleano: a auditoria grava "1"/"0" e o script ou o formulário usam "true"/"false". */
const BOOL: Record<string, number> = { true: 1, '1': 1, false: 0, '0': 0 };
const DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export function sameVal(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  // Campo HTML: o editor guarda <p>texto</p>; o script grava só o texto.
  const tag = /<\/?[a-z][^>]*>/i;
  if (tag.test(a) || tag.test(b)) {
    const txt = (x: string) => x.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    if (txt(a) === txt(b)) return true;
  }
  // Data e hora: o script grava no fuso do usuário e a auditoria guarda em UTC. Diferença de fuso (múltiplo de 15 min, até 14 h) é o mesmo instante.
  if (DT.test(a) && DT.test(b)) { const d = Math.abs(toMs(a) - toMs(b)); return d <= 14 * 3600e3 && d % (15 * 60e3) === 0; }
  const x = BOOL[a], y = BOOL[b];
  return x !== undefined && y !== undefined && x === y && (a.length > 1 || b.length > 1);
}

/** Transação de um botão do Workspace (inclui o Salvar). */
export const isWorkspaceAction = (url: string | undefined): boolean => /\/api\/now\/ui\/ui_action\/[0-9a-f]{32}/.test(url ?? '');

/**
 * Chamadas `new SI(...).metodo(..., 'campo', valor)` em que o nome do campo vai como texto.
 * Devolve o SI, o trecho da chamada e o valor literal logo depois do nome do campo, se houver.
 */
export function siCallsWithField(script: string | undefined, field: string): { si: string; call: string; value?: string }[] {
  const out: { si: string; call: string; value?: string }[] = [];
  const f = escapeRegExp(field);
  const re = /new\s+(?:global\.)?([A-Za-z_]\w*)\s*\([^()]*\)\s*\.\s*\w+\s*\(((?:[^()]|\([^()]*\))*)\)/g;
  for (const m of (script ?? '').matchAll(re)) {
    const args = m[2] ?? '';
    const a = args.match(new RegExp(String.raw`(['"])${f}\1\s*(?:,\s*(?:(['"])((?:(?!\2).)*)\2|(-?\d+(?:\.\d+)?)))?`));
    if (!a) continue;
    const value = a[3] ?? a[4];
    out.push({ si: m[1]!, call: m[0], ...(value !== undefined ? { value } : {}) });
  }
  return out;
}

/**
 * Transação que GRAVA neste registro: envio do formulário, Table API no próprio registro ou botão do Workspace.
 * Leituras que só citam o sys_id (listas, auditoria, a própria análise do Trail) não contam.
 */
/** Chamada da Batch API (/api/now/v1/batch): várias requisições num lote; a URL não diz quais registros gravou. */
export function isBatchCall(url: string | undefined): boolean {
  return /\/api\/now\/(?:v\d+\/)?batch(?:[?/]|$)/.test(url ?? '');
}

/** Lote da Batch API da mesma pessoa no instante da mudança (até 3 s). */
export function batchAt(tx: { url?: string; sys_created_by?: string; sys_created_on?: string }[], user: string, at: string): typeof tx {
  const t0 = Date.parse(at.replace(' ', 'T') + 'Z');
  return tx.filter((t) => t.sys_created_by === user && isBatchCall(t.url) && Math.abs(Date.parse((t.sys_created_on ?? '').replace(' ', 'T') + 'Z') - t0) <= 3000);
}

/**
 * Envio de formulário que grava este registro: o formulário dele (sys_uniqueValue) ou o "Update Selected"/"Update All"
 * da lista, que envia os valores uma vez para vários registros (sysparm_checked_items=sys_idIN...).
 */
export function isFormSubmitFor(url: string | undefined, sysId: string): boolean {
  const u = url ?? '';
  if (!sysId || !u.includes(sysId)) return false;
  if (u.includes(`sys_uniqueValue=${sysId}`)) return true;
  return isMultiUpdate(u);
}

/** Atualização de vários registros de uma vez pela lista. */
export function isMultiUpdate(url: string | undefined): boolean {
  // O envio vai para <tabela>.do com sys_action=sysverb_post_update; abrir o formulário de atualização (<tabela>_update.do) não grava.
  // A URL pode vir cortada no fim (sys_action some), então basta o destino <tabela>.do com a lista de registros.
  const u = url ?? '';
  return /[?&]sysparm_checked_items=/.test(u) && (/[?&]sys_action=sysverb_post_update(?:&|$)/.test(u) || /^\/[a-z0-9_]+\.do\?/.test(u) && !/_update\.do\?/.test(u));
}

export function isRecordWrite(url: string | undefined, sysId: string): boolean {
  const u = url ?? '';
  if (!sysId || !u.includes(sysId)) return false;
  if (isFormSubmitFor(u, sysId)) return true;
  if (new RegExp(`/api/now/(?:v\\d+/)?table/[a-z0-9_]+/${sysId}(?:[?/]|$)`).test(u)) return true;
  return isWorkspaceAction(u);
}

/** Encoded query em texto curto: "category=network^urgencyVALCHANGES^EQ" → "category = network e urgency muda". */
export function humanQuery(q: string | undefined, lang: 'pt' | 'en' = 'pt'): string {
  if (!q) return '';
  const pt = lang === 'pt';
  const ops: [RegExp, (f: string, v: string) => string][] = [
    [/^([a-z0-9_.]+)VALCHANGES$/, (f) => `${f} ${pt ? 'muda' : 'changes'}`],
    [/^([a-z0-9_.]+)CHANGESTO(.*)$/, (f, v) => `${f} ${pt ? 'muda para' : 'changes to'} ${v}`],
    [/^([a-z0-9_.]+)CHANGESFROM(.*)$/, (f, v) => `${f} ${pt ? 'deixa de ser' : 'changes from'} ${v}`],
    [/^([a-z0-9_.]+)ISEMPTY$/, (f) => `${f} ${pt ? 'vazio' : 'empty'}`],
    [/^([a-z0-9_.]+)ISNOTEMPTY$/, (f) => `${f} ${pt ? 'preenchido' : 'not empty'}`],
    [/^([a-z0-9_.]+)STARTSWITH(.*)$/, (f, v) => `${f} ${pt ? 'começa com' : 'starts with'} "${v}"`],
    [/^([a-z0-9_.]+)NOTLIKE(.*)$/, (f, v) => `${f} ${pt ? 'não contém' : 'does not contain'} "${v}"`],
    [/^([a-z0-9_.]+)LIKE(.*)$/, (f, v) => `${f} ${pt ? 'contém' : 'contains'} "${v}"`],
    [/^([a-z0-9_.]+)NOT IN(.*)$/, (f, v) => `${f} ${pt ? 'fora de' : 'not in'} ${v}`],
    [/^([a-z0-9_.]+)IN(.*)$/, (f, v) => `${f} ${pt ? 'em' : 'in'} ${v}`],
    [/^([a-z0-9_.]+)!=(.*)$/, (f, v) => `${f} ≠ ${v}`],
    [/^([a-z0-9_.]+)=(.*)$/, (f, v) => `${f} = ${v}`],
  ];
  const term = (t: string) => { for (const [re, fn] of ops) { const m = t.match(re); if (m) return fn(m[1]!, m[2] ?? ''); } return t; };
  return q.split('^NQ').map((block) => block.split('^').filter((t) => t && t !== 'EQ' && !t.startsWith('ORDERBY'))
    .map((t, i) => (t.startsWith('OR') && i > 0 ? `${pt ? 'ou' : 'or'} ${term(t.slice(2))}` : term(t)))
    .reduce((acc, t) => (!acc ? t : /^(ou|or) /.test(t) ? `${acc} ${t}` : `${acc} ${pt ? 'e' : 'and'} ${t}`), '')).join(pt ? '; ou ' : '; or ');
}
