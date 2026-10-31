/**
 * Alterações reconstruídas do log de transações (syslog_transaction), para quando a auditoria não está disponível.
 * Só submits de formulário clássico trazem os valores na URL: `sys_original.<tabela>.<campo>` (valor ao carregar o
 * formulário) e `<tabela>.<campo>` (valor enviado). Valores longos chegam cortados com "...", e a URL é HTML-escaped.
 * A cadeia só vale quando cada submit começa do valor que o anterior deixou, e quando o último valor bate com o registro.
 */

export interface TxChange {
  field: string;
  /** Valor ao carregar o formulário; ausente quando o log não trouxe. */
  oldValue?: string;
  newValue?: string;
  truncated: boolean;
}

export interface TxSubmit {
  /** Início da requisição em ms (start_process_at); o sys_created_on é o fim. */
  startMs: number;
  sysModCount?: number;
  changes: TxChange[];
}

export interface TxChain {
  field: string;
  changes: { at: number; oldValue?: string; newValue?: string; truncated: boolean }[];
  /** Motivos pelos quais a cadeia não fecha. Vazio quando a reconstrução está completa. */
  gaps: string[];
  /** false quando o valor atual do registro não bate com o fim da cadeia: nada é mostrado. */
  matchesCurrent: boolean;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };

/** Uma passada só: `&amp;lt;` vira `&lt;`, e não `<`. */
export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ENTITY[e] ?? _);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

const isCut = (v?: string) => v !== undefined && v.endsWith('...');

/** Normalização usada no histórico: quebra de linha, espaços e 1/0 como true/false. */
export function normalizeValue(v?: string): string {
  const x = (v ?? '').replace(/\r\n/g, '\n').trim();
  return x === '1' ? 'true' : x === '0' ? 'false' : x;
}

/**
 * Lê um submit de formulário clássico de `<tabela>.do`. Retorna null para URLs de outra tabela ou sem valores.
 * Campos enviados sem o valor original ficam sem `oldValue` (e a cadeia avisa).
 */
export function parseSubmit(url: string, table: string, startMs: number): TxSubmit | null {
  const m = /^\/?([a-z0-9_]+)\.do\?/i.exec(url);
  if (!m || m[1].toLowerCase() !== table.toLowerCase()) return null;
  const query = url.slice(m[0].length);
  const params = new Map<string, string>();
  // Separa antes de decodificar: o `&` que separa parâmetros chega cru, e o que faz parte de um valor chega como &amp;.
  for (const part of query.split('&')) {
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    if (params.has(k)) continue;
    params.set(k, i < 0 ? '' : decodeEntities(safeDecode(part.slice(i + 1))));
  }
  const orig = new Map<string, string>();
  const sent = new Map<string, string>();
  const origPrefix = `sys_original.${table}.`;
  for (const [k, v] of params) {
    if (k.startsWith(origPrefix)) orig.set(k.slice(origPrefix.length), v);
    else if (k.startsWith(`${table}.`)) sent.set(k.slice(table.length + 1), v);
  }
  const changes: TxChange[] = [];
  for (const [field, newValue] of sent) {
    const oldValue = orig.get(field);
    if (oldValue !== undefined && normalizeValue(oldValue) === normalizeValue(newValue)) continue;
    changes.push({ field, oldValue, newValue, truncated: isCut(oldValue) || isCut(newValue) });
  }
  if (!changes.length) return null;
  const mc = params.get('sys_modCount');
  return { startMs, sysModCount: mc !== undefined && /^\d+$/.test(mc) ? Number(mc) : undefined, changes };
}

/**
 * Cadeia de um campo, em ordem de tempo. Cada submit precisa começar do valor que o anterior deixou; o último valor
 * precisa bater com o valor atual do registro. Sem isso, o que faltou fica em `gaps` e o que não bate não é mostrado.
 */
export function chainField(submits: TxSubmit[], field: string, current?: string): TxChain {
  const gaps: string[] = [];
  const list = submits
    .filter((s) => s.changes.some((c) => c.field === field))
    .sort((a, b) => a.startMs - b.startMs || (a.sysModCount ?? 0) - (b.sysModCount ?? 0));
  const changes: TxChain['changes'] = [];
  let prev: TxChain['changes'][number] | undefined;
  let prevMc: number | undefined;
  for (const s of list) {
    const c = s.changes.find((x) => x.field === field)!;
    if (s.sysModCount !== undefined && s.sysModCount === prevMc) gaps.push(`dois submits com sys_modCount ${s.sysModCount}`);
    if (c.oldValue === undefined) gaps.push('submit sem valor original');
    else if (prev && !prev.truncated && !c.truncated && normalizeValue(c.oldValue) !== normalizeValue(prev.newValue))
      gaps.push('o valor original não é o que o submit anterior deixou');
    const item = { at: s.startMs, oldValue: c.oldValue, newValue: c.newValue, truncated: c.truncated };
    changes.push(item);
    prev = item;
    prevMc = s.sysModCount;
  }
  const last = changes.at(-1);
  let matchesCurrent = true;
  if (current !== undefined && last) {
    // Valor cortado no log (PDI: ~1000 caracteres + "..."): só dá para conferir o começo com o registro.
    if (last.truncated) matchesCurrent = last.newValue !== undefined && current.startsWith(last.newValue.slice(0, -3)) && current.length > last.newValue.length - 3;
    else matchesCurrent = normalizeValue(last.newValue) === normalizeValue(current);
    if (!matchesCurrent) gaps.push('o último valor não bate com o valor atual do registro');
  }
  return { field, changes, gaps, matchesCurrent };
}
