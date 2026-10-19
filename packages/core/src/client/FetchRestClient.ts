import { classifyAccess, type QueryRequest, type QueryResult, type RestClient } from './RestClient';
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
