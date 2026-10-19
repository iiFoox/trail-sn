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
