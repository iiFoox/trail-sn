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

/** `tables`: a hierarquia da tabela, da mais específica para a base. `wanted`: campo → valores a traduzir. */
export async function resolveDisplay(q: Q, tables: string[], wanted: Record<string, (string | undefined)[]>): Promise<DisplayNames> {
  const out: DisplayNames = { fields: {}, values: {}, refs: {} };
  const names = Object.keys(wanted).filter((f) => /^[a-z0-9_]+$/.test(f)).slice(0, 60);
  if (!names.length) return out;
  const [dict, choices] = await Promise.all([
    q('sys_dictionary', `nameIN${tables.join(',')}^elementIN${names.join(',')}`, ['name', 'element', 'column_label', 'internal_type', 'reference'], 300),
    q('sys_choice', `nameIN${tables.join(',')}^elementIN${names.join(',')}^inactive=false`, ['name', 'element', 'value', 'label', 'language'], 1000),
  ]);
  const rank = (t?: string) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) {
    const el = d.element ?? '';
    if (!(el in out.fields) && d.column_label) out.fields[el] = d.column_label;
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
    for (const r of await q(t, `sys_idIN${[...set].slice(0, 80).join(',')}`, ['sys_id', 'name', 'number', 'user_name', 'short_description'], 80)) {
      if (!r.sys_id) continue;
      const text = r.name || r.number || r.user_name || r.short_description || '';
      if (!text) continue;
      for (const [f, rt] of Object.entries(out.refs)) if (rt === t) (out.values[f] ??= {})[r.sys_id] = text;
    }
  }));
  return out;
}
