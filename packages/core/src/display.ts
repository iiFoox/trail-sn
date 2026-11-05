/**
 * Nomes como aparecem no formulário: o rótulo de cada campo (business_service → Service) e o texto de cada valor
 * (choice → "1 - High"; referência → nome do registro). Só leitura; falhas viram "sem rótulo", nunca erro.
 */
import type { Row } from './types';

export interface DisplayNames {
  /** Rótulo de cada campo. */
  fields: Record<string, string>;
  /** Texto de cada valor, por campo. */
  values: Record<string, Record<string, string>>;
  /** Campos de referência e a tabela de cada um (os valores viram links). */
  refs: Record<string, string>;
}

type Q = (table: string, query: string, fields: string[], limit: number) => Promise<Row[]>;
const SYS_ID = /^[0-9a-f]{32}$/;

/** Documentação da tabela mais específica; dentro dela, idioma pedido antes do inglês. */
export function fieldLabels(docs: Row[], dict: Row[], tables: string[], language = 'en'): Record<string, string> {
  const rank = (name?: string) => { const i = tables.indexOf(name ?? ''); return i < 0 ? 99 : i; };
  const labels: Record<string, string> = {};
  for (const d of [...docs].sort((a, b) => rank(a.name) - rank(b.name)
    || Number(a.language !== language) - Number(b.language !== language))) {
    const el = d.element ?? '';
    if (rank(d.name) < 99 && d.label && (d.language === language || d.language === 'en') && !(el in labels)) labels[el] = d.label;
  }
  for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) {
    const el = d.element ?? '';
    if (rank(d.name) < 99 && d.column_label && !(el in labels)) labels[el] = d.column_label;
  }
  return labels;
}

export async function documentation(q: Q, tables: string[], names: string[], language = 'en'): Promise<Row[]> {
  if (!names.length || !tables.length) return [];
  const languages = language === 'en' ? 'en' : `${language},en`;
  try {
    return await q('sys_documentation', `nameIN${tables.join(',')}^elementIN${names.join(',')}^languageIN${languages}`,
      ['name', 'element', 'label', 'language'], 500);
  } catch { return []; }
}

/** `tables`: a hierarquia da tabela, da mais específica para a base. `wanted`: campo → valores a traduzir. */
/**
 * Texto de registros de uma tabela referenciada: a coluna de exibição da tabela (dicionário, display=true) e depois os
 * nomes comuns. Tabela customizada costuma exibir outra coluna (no DEV do dono, o Status saía como sys_id, 05/11/2026).
 */
export async function refTexts(q: Q, table: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!/^[a-z0-9_]+$/.test(table) || !ids.length) return out;
  const d = await q('sys_dictionary', `name=${table}^display=true`, ['element'], 1);
  const df = /^[a-z0-9_]+$/.test(d[0]?.element ?? '') ? d[0]!.element! : '';
  const fields = [...new Set(['sys_id', 'name', 'number', 'user_name', 'short_description', ...(df ? [df] : [])])];
  for (const r of await q(table, `sys_idIN${ids.slice(0, 80).join(',')}`, fields, 80)) {
    const text = (df && r[df]) || r.name || r.number || r.user_name || r.short_description || '';
    if (r.sys_id && text) out[r.sys_id] = text;
  }
  return out;
}

export async function resolveDisplay(q: Q, tables: string[], wanted: Record<string, (string | undefined)[]>, language = 'en', loadedDocs?: Row[]): Promise<DisplayNames> {
  const out: DisplayNames = { fields: {}, values: {}, refs: {} };
  const names = Object.keys(wanted).filter((f) => /^[a-z0-9_]+$/.test(f)).slice(0, 60);
  if (!names.length) return out;
  const [dict, docs, choices] = await Promise.all([
    q('sys_dictionary', `nameIN${tables.join(',')}^elementIN${names.join(',')}`, ['name', 'element', 'column_label', 'internal_type', 'reference'], 300),
    loadedDocs ? Promise.resolve(loadedDocs) : documentation(q, tables, names, language),
    q('sys_choice', `nameIN${tables.join(',')}^elementIN${names.join(',')}^inactive=false`, ['name', 'element', 'value', 'label', 'language'], 1000),
  ]);
  const rank = (t?: string) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  out.fields = fieldLabels(docs.filter((d) => names.includes(d.element ?? '')), dict, tables, language);
  for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) {
    const el = d.element ?? '';
    if (!(el in out.refs) && d.internal_type === 'reference' && d.reference) out.refs[el] = d.reference;
  }
  // A tabela mais específica ganha (incident.state 2 = In Progress; task.state 2 = Work in Progress); depois o inglês.
  for (const c of [...choices].sort((a, b) => rank(a.name) - rank(b.name) || (a.language === 'en' ? -1 : 0) - (b.language === 'en' ? -1 : 0))) {
    const m = (out.values[c.element ?? ''] ??= {});
    if (c.value && c.label && !(c.value in m)) m[c.value] = c.label;
  }
  const ids: Record<string, Set<string>> = {};
  for (const [f, t] of Object.entries(out.refs)) for (const v of wanted[f] ?? []) if (v && SYS_ID.test(v)) (ids[t] ??= new Set()).add(v);
  await Promise.all(Object.entries(ids).slice(0, 6).map(async ([t, set]) => {
    for (const [id, text] of Object.entries(await refTexts(q, t, [...set]))) {
      for (const [f, rt] of Object.entries(out.refs)) if (rt === t) (out.values[f] ??= {})[id] = text;
    }
  }));
  return out;
}
