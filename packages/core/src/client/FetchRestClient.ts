import { classifyAccess, type HistoryResult, type QueryRequest, type QueryResult, type RestClient } from './RestClient';
import type { Row } from '../types';

export interface FetchRestClientOptions {
  /** https://devXXXXXX.service-now.com */
  baseUrl: string;
  /** Devolve o X-UserToken (g_ck). Chamado de novo após 401 para renovar. */
  getToken: () => Promise<string | null>;
  /** Implementação de fetch (injetável nos testes). */
  fetchImpl?: typeof fetch;
  /** Máximo de chamadas simultâneas por instância. */
  concurrency?: number;
  /** Tempo máximo por chamada, em ms. */
  timeoutMs?: number;
}

/**
 * Cliente da Table API com cookie da sessão + X-UserToken.
 *
 * Achado da Fase 1.2 (PDI dev457034): GET com cookie e SEM X-UserToken devolve 401
 * "User is not authenticated". O token é obrigatório mesmo para leitura, por isso
 * o cliente renova o token e repete uma vez quando recebe 401.
 *
 * Só GET. Serializa no máximo `concurrency` chamadas e recua em 429/5xx.
 */
export class FetchRestClient implements RestClient {
  calls = 0;
  private active = 0;
  private queue: (() => void)[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(private readonly opts: FetchRestClientOptions) {
    // Nunca guardar o fetch global como método: chamado com `this` = cliente dá "Illegal invocation".
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.concurrency = opts.concurrency ?? 6;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async query(req: QueryRequest): Promise<QueryResult> {
    await this.acquire();
    try {
      return await this.doQuery(req, true);
    } finally {
      this.release();
    }
  }

  /**
   * Histórico do formulário: o mesmo endpoint que o Activity Stream do UI16 usa (`angular.do?sysparm_type=list_history`).
   * Responde com as ACLs de quem está logado; no PDI, um usuário só com `itil` recebe 403 em `sys_audit` e 200 aqui.
   */
  async history(table: string, sysId: string): Promise<HistoryResult | null> {
    await this.acquire();
    try {
      if (!this.token) this.token = await this.opts.getToken();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers['X-UserToken'] = this.token;
      const base = this.opts.baseUrl.replace(/\/$/, '');
      const get = (url: string) => { this.calls++; return this.fetchImpl(url, { method: 'GET', headers, credentials: 'include' }).then((r) => (r.status === 200 ? r.json() : null), () => null).catch(() => null); };
      // Junto com o histórico, as opções das listas da tabela (o que o formulário usa para mostrar os rótulos).
      const [hist, meta] = await Promise.all([
        get(`${base}/angular.do?${new URLSearchParams({ sysparm_type: 'list_history', table, sys_id: sysId })}`),
        get(`${base}/api/now/ui/meta/${encodeURIComponent(table)}`),
      ]);
      const h = parseHistory(hist);
      if (h) { const choices = parseMetaChoices(meta); if (choices) h.choices = choices; }
      return h;
    } finally {
      this.release();
    }
  }

  private buildUrl(req: QueryRequest): string {
    const p = new URLSearchParams({
      sysparm_limit: String(req.limit),
      sysparm_display_value: 'false',
      sysparm_exclude_reference_link: 'true',
      sysparm_fields: req.fields.join(','),
      sysparm_query: req.query,
    });
    return `${this.opts.baseUrl.replace(/\/$/, '')}/api/now/table/${req.table}?${p}`;
  }

  private async doQuery(req: QueryRequest, mayRetryAuth: boolean, attempt = 0): Promise<QueryResult> {
    if (!this.token) this.token = await this.opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers['X-UserToken'] = this.token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      this.calls++;
      res = await this.fetchImpl(this.buildUrl(req), { method: 'GET', headers, credentials: 'include', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === 'AbortError') return { rows: [], status: 0, access: 'timeout' };
      throw e;
    }
    clearTimeout(timer);

    if (res.status === 401 && mayRetryAuth) {
      // Token ausente ou expirado: renova e repete uma vez.
      this.token = await this.opts.getToken();
      if (this.token) return this.doQuery(req, false, attempt);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(300 * 2 ** attempt);
      return this.doQuery(req, mayRetryAuth, attempt + 1);
    }

    const text = await res.text().catch(() => '');
    let rows: Row[] = [];
    try {
      const json = JSON.parse(text) as { result?: Row[] };
      rows = Array.isArray(json.result) ? json.result : [];
    } catch {
      rows = [];
    }
    return { rows, status: res.status, access: classifyAccess(res.status, rows, text) };
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve(); }));
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

type RawHistory = { entries?: { sys_timestamp?: number; sys_created_on?: string; user_id?: string; sys_created_by?: string; entries?: { changes?: { field_name?: string; field_label?: string; field_type?: string; old_value?: string; new_value?: string }[] } }[]; fields?: { name?: string; isJournal?: boolean }[] };

/** Converte a resposta do list_history. Gravações sem mudança de campo (só nota, anexo) ficam de fora. */
export function parseHistory(json: unknown): HistoryResult | null {
  const j = json as RawHistory | null;
  if (!j || !Array.isArray(j.entries)) return null;
  const at = (e: NonNullable<RawHistory['entries']>[number]) =>
    typeof e.sys_timestamp === 'number' ? new Date(e.sys_timestamp).toISOString().slice(0, 19).replace('T', ' ') : (e.sys_created_on ?? '');
  const entries = j.entries
    .map((e) => ({
      at: at(e),
      userId: e.user_id,
      userName: e.sys_created_by,
      changes: (e.entries?.changes ?? []).filter((c) => c.field_name).map((c) => ({
        field: c.field_name!, label: c.field_label, type: c.field_type, oldValue: c.old_value ?? '', newValue: c.new_value ?? '',
      })),
    }))
    .filter((e) => e.changes.length && e.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const fields = (j.fields ?? []).filter((f) => f.name && !f.isJournal && !f.name.startsWith('*')).map((f) => f.name!);
  return { entries, fields };
}

/** Opções das listas de /api/now/ui/meta/<tabela>: campo → rótulo → valor. */
export function parseMetaChoices(json: unknown): Record<string, Record<string, string>> | null {
  const cols = (json as { result?: { columns?: Record<string, { choices?: { label?: string; value?: string }[] }> } } | null)?.result?.columns;
  if (!cols) return null;
  const out: Record<string, Record<string, string>> = {};
  for (const [name, col] of Object.entries(cols)) {
    for (const c of col.choices ?? []) if (c.label && c.value !== undefined && c.value !== '') (out[name] ??= {})[c.label] = c.value;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Obtém o g_ck a partir do HTML de uma página leve da instância.
 * Confirmado na PDI: /navpage.do devolve o mesmo token que window.g_ck da página.
 * Usado quando o page/ não forneceu token (Workspace, painel manual) ou após 401.
 */
export async function fetchTokenFromHtml(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/navpage.do`, { credentials: 'include' });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/g_ck\s*=\s*['"]([0-9a-f]{32,})['"]/);
  return m ? m[1] ?? null : null;
}
