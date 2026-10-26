/**
 * Conteúdo de uma versão (sys_update_version.payload): o registro inteiro em XML,
 * `<record_update table="t"><t action="..."><campo>valor</campo>...</t></record_update>`.
 * Os campos ficam lado a lado (sem aninhar); scripts vêm em CDATA, o resto com &lt; &amp;... Leitura própria em vez do
 * DOMParser: funciona em qualquer contexto e nos testes.
 * Os campos de controle (sys_updated_on, sys_mod_count...) mudam em toda versão e ficam de fora da comparação.
 */
export interface VersionField { value: string; display?: string }

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);

export function parsePayload(xml: string): Record<string, VersionField> {
  const out: Record<string, VersionField> = {};
  const table = xml.match(/<record_update[^>]*\stable="([a-z0-9_]+)"/)?.[1];
  if (!table) return out;
  const open = xml.search(new RegExp(`<${table}[\\s>]`));
  const close = xml.lastIndexOf(`</${table}>`);
  if (open < 0 || close < 0) return out;
  const body = xml.slice(xml.indexOf('>', open) + 1, close);
  // Campo vazio (<x/>), com texto (escapado) ou com uma ou mais seções CDATA (um "]]>" no texto vira duas seções).
  const re = /<([a-z0-9_]+)((?:\s[^>]*?)?)\s*(?:\/>|>((?:<!\[CDATA\[[\s\S]*?\]\]>)+|[^<]*)<\/\1>)/g;
  for (const m of body.matchAll(re)) {
    const [, name, attrs = '', content = ''] = m;
    if (!name || name.startsWith('sys_')) continue;
    const value = content.startsWith('<![CDATA[') ? content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : decode(content);
    const display = attrs.match(/\sdisplay_value="([^"]*)"/)?.[1];
    out[name] = { value, ...(display ? { display: decode(display) } : {}) };
  }
  return out;
}

/** Campos que mudaram de uma versão para a outra, na ordem em que aparecem. */
export function changedFields(before: Record<string, VersionField>, after: Record<string, VersionField>): { field: string; before: VersionField; after: VersionField }[] {
  const names = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  const empty: VersionField = { value: '' };
  return names
    .filter((f) => (before[f]?.value ?? '').replace(/\r\n/g, '\n') !== (after[f]?.value ?? '').replace(/\r\n/g, '\n'))
    .map((f) => ({ field: f, before: before[f] ?? empty, after: after[f] ?? empty }));
}
