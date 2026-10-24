/**
 * Instância simulada por fetch (sem rede) para a bateria de endurecimento da 1.4.5.
 * Responde /api/now/ui/meta/<tabela>, /api/now/table/<tabela> e /angular.do (list_history), registra cada pedido e
 * mede quantas chamadas ficam em andamento ao mesmo tempo por instância.
 */
import { filterRows } from '../src/client/FakeRestClient';
import type { Row } from '../src/types';

export type Col = { canmatch?: boolean; label?: string; type?: string; reference?: string; reference_display_field?: string; choices?: { label: string; value: string }[] };
export type MetaMode = Record<string, Col> | 'empty' | 'forbidden' | 'html' | 'hang' | 'throw' | 'array' | 'nullcol' | 's500' | 's401' | 's429' | 's404' | 'noresult';

export interface SimCfg {
  meta?: (table: string) => MetaMode;
  rows?: Record<string, Row[]>;
  /** Substitui a resposta da Table API (undefined = padrão). */
  table?: (table: string, query: string, url: URL, signal?: AbortSignal | null) => Response | Promise<Response> | undefined;
  history?: unknown;
  /** Atraso de cada resposta (ms). */
  latencyMs?: number;
  /** 403 da Table API para tabelas cujo ui/meta é 'empty' (o que a instância faria para itil). */
  denyEmptyMeta?: boolean;
}

export interface Logged { table: string; query: string; fields: string; limit: string; url: string; status?: number }

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Promessa que só termina quando o sinal aborta (como o fetch de verdade). */
export function hang(signal?: AbortSignal | null): Promise<Response> {
  return new Promise<Response>((_res, rej) => {
    if (!signal) return;
    if (signal.aborted) { rej(new DOMException('aborted', 'AbortError')); return; }
    signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

let hostSeq = 0;
/** Endereço novo por teste: o Gate, o cache do ui/meta e a memória de recusas são por instância. */
export const freshBase = (tag = 'h') => `https://${tag}${++hostSeq}-${Math.random().toString(36).slice(2, 7)}.service-now.test`;

export function sim(cfg: SimCfg = {}) {
  const log: Logged[] = [];
  const metaLog: string[] = [];
  const historyLog: string[] = [];
  const barred: Logged[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const metaOf = (t: string): MetaMode => cfg.meta?.(t) ?? 'forbidden';
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (cfg.latencyMs) await sleep(cfg.latencyMs);
      if (u.pathname.startsWith('/api/now/ui/meta/')) {
        const t = decodeURIComponent(u.pathname.slice('/api/now/ui/meta/'.length));
        metaLog.push(t);
        const m = metaOf(t);
        if (m === 'forbidden') return json(403, { error: { message: 'no' } });
        if (m === 'html') return new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
        if (m === 'hang') return await hang(init?.signal);
        if (m === 'throw') throw new TypeError('Failed to fetch');
        if (m === 'array') return json(200, { result: { columns: [] } });
        if (m === 'nullcol') return json(200, { result: { columns: { a: null } } });
        if (m === 'empty') return json(200, { result: { columns: {} } });
        if (m === 's500') return json(500, { error: {} });
        if (m === 's401') return json(401, { error: {} });
        if (m === 's429') return json(429, {});
        if (m === 's404') return json(404, {});
        if (m === 'noresult') return json(200, { foo: 1 });
        return json(200, { result: { columns: m } });
      }
      if (u.pathname === '/angular.do') {
        historyLog.push(u.search);
        return cfg.history === undefined ? json(404, {}) : json(200, cfg.history);
      }
      if (u.pathname.startsWith('/api/now/table/')) {
        const t = u.pathname.slice('/api/now/table/'.length);
        const p = u.searchParams;
        const entry: Logged = { table: t, query: p.get('sysparm_query') ?? '', fields: p.get('sysparm_fields') ?? '', limit: p.get('sysparm_limit') ?? '', url: String(input) };
        log.push(entry);
        const custom = await cfg.table?.(t, entry.query, u, init?.signal);
        if (custom) { entry.status = custom.status; if (custom.status === 403) barred.push(entry); return custom; }
        if (cfg.denyEmptyMeta && metaOf(t) === 'empty') {
          entry.status = 403; barred.push(entry);
          return json(403, { error: { message: 'User Not Authorized', detail: `User is unauthorized to access table: ${t}` }, status: 'failure' });
        }
        const rows = filterRows(cfg.rows?.[t] ?? [], entry.query).slice(0, Number(entry.limit) || 100);
        entry.status = 200;
        return json(200, { result: rows });
      }
      return json(404, {});
    } finally {
      inFlight--;
    }
  }) as typeof fetch;
  return { fetchImpl, log, metaLog, historyLog, barred, get maxInFlight() { return maxInFlight; }, get inFlight() { return inFlight; } };
}

/** Tabelas de rastro: nenhuma consulta a elas pode sair sem filtro que use índice. */
export const SENSITIVE = new Set(['sys_audit', 'syslog_transaction', 'sysevent', 'syslog', 'sys_import_set_row', 'sys_email', 'sys_flow_context']);

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Problemas de uma consulta: sem filtro, só ORDERBY, lista IN vazia, valor vazio em chave, data inválida, e, nas tabelas
 * de rastro, bloco ^NQ sem âncora (sys_id/documentkey/instance/source_record ou janela >= e <= de data).
 */
export function problemsOf(table: string, query: string, staging: Set<string> = new Set()): string[] {
  const out: string[] = [];
  const terms = query.split('^').filter((t) => t && t !== 'EQ' && !t.startsWith('ORDERBY'));
  if (!terms.length) out.push('sem filtro');
  if (/(?:^|\^|\^OR|\^NQ)[a-z0-9_.]+(?:NOT )?IN(?:\^|$)/.test(query)) out.push('IN vazio');
  if (/(?:^|\^)[a-z0-9_.]+IN,|IN[^\^]*,,|IN[^\^]*,(?:\^|$)/.test(query)) out.push('item vazio em IN');
  if (/NaN|Invalid/.test(query)) out.push('data inválida');
  if (/(?:^|\^)(?:documentkey|instance|source_record|sys_id|tablename|sys_target_sys_id)=(?:\^|$)/.test(query)) out.push('chave vazia');
  if (/[\r\n]/.test(query)) out.push('quebra de linha');
  if (SENSITIVE.has(table) || staging.has(table)) {
    for (const block of query.split('^NQ')) {
      const ts = block.split('^').filter((t) => t && !t.startsWith('ORDERBY'));
      const anchored = ts.some((t) => {
        const m = t.match(/^(documentkey|instance|source_record|sys_id|sys_target_sys_id)=(.*)$/);
        if (m && HEX32.test(m[2]!)) return true;
        const mi = t.match(/^(sys_id|source_record)IN(.+)$/);
        return !!mi && mi[2]!.split(',').every((x) => HEX32.test(x));
      });
      const win = (f: string) => ts.some((t) => t.startsWith(`${f}>=`)) && ts.some((t) => t.startsWith(`${f}<=`));
      const windowed = ['sys_created_on', 'sys_updated_on', 'processed'].some(win);
      if (!anchored && !windowed) out.push(`bloco sem âncora: ${block.slice(0, 80)}`);
    }
  }
  return out;
}

/** Gerador pseudoaleatório com semente fixa (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    hex: (n = 32) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(next() * 16)]).join(''),
  };
}

/** Valores hostis para campos, nomes e URLs. */
export const NASTY = [
  '', ' ', 'a^b', 'x,y', 'linha\nquebrada', 'cr\rlf', "it's", '"aspas"', 'javascript:gs.sleep(9000)', 'JAVASCRIPT:x', '😀', 'ação', 'NQ',
  '^NQsys_idISNOTEMPTY', 'ORsys_id!=x', '^ORsys_idISNOTEMPTY', 'ORDERBYname', '0'.repeat(32), 'z'.repeat(32), 'ABCDEF'.padEnd(32, '0'),
  '&sysparm_limit=99999', '%5E', '#frag', '\t', '\u0000', ' ', 'a'.repeat(300), 'nameISNOTEMPTY', 'IN', '=', '1,2,3', 'Beth Anglin',
] as const;

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const snDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
