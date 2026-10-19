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

/**
 * Avalia uma encoded query simples contra os valores ATUAIS do registro.
 * Devolve true/false quando todos os termos são avaliáveis; undefined quando há OR, NQ,
 * operadores desconhecidos ou campos que não temos (nesses casos o motor não usa a condição).
 */
export function evalCondition(cond: string | undefined, rec: Record<string, string>, skipField?: string): boolean | undefined {
  if (!cond) return undefined;
  if (/\^NQ|\^OR|javascript:/.test(cond)) return undefined;
  const terms = cond.split('^').filter((t) => t && t !== 'EQ' && !t.startsWith('ORDERBY'));
  if (!terms.length) return undefined;
  for (const term of terms) {
    const m = term.match(/^([a-z0-9_]+)(ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOTLIKE|LIKE|NOT IN|IN|!=|=)(.*)$/);
    if (!m) return undefined;
    const [, field, op, raw] = m as unknown as [string, string, string, string];
    if (field === skipField || !(field in rec)) return undefined;
    const v = rec[field] ?? '';
    const val = raw ?? '';
    let ok: boolean;
    switch (op) {
      case 'ISEMPTY': ok = v === ''; break;
      case 'ISNOTEMPTY': ok = v !== ''; break;
      case 'STARTSWITH': ok = v.startsWith(val); break;
      case 'ENDSWITH': ok = v.endsWith(val); break;
      case 'LIKE': ok = v.includes(val); break;
      case 'NOTLIKE': ok = !v.includes(val); break;
      case 'IN': ok = val.split(',').includes(v); break;
      case 'NOT IN': ok = !val.split(',').includes(v); break;
      case '!=': ok = v !== val; break;
      default: ok = v === val;
    }
    if (!ok) return false;
  }
  return true;
}

/** Campos citados numa encoded query (para buscar só o necessário do registro). */
export function conditionFields(cond: string | undefined): string[] {
  if (!cond) return [];
  return [...new Set(cond.split(/\^(?:OR|NQ)?/).map((t) => t.match(/^([a-z0-9_]+)(?:ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOTLIKE|LIKE|NOT IN|IN|!=|=)/)?.[1]).filter((x): x is string => !!x))];
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
