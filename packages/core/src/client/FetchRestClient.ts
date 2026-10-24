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
  /** Fuso do usuário no ServiceNow (IANA), para o histórico do formulário. */
  getTimeZone?: () => Promise<string | undefined>;
  /**
   * Onde guardar o ui/meta entre execuções (na extensão, chrome.storage.session): o service worker dorme depois de
   * ~30 s parado e perde a memória; sem isso, cada investigação conferiria as tabelas de novo.
   */
  store?: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
}

/**
 * Cliente da Table API com cookie da sessão + X-UserToken.
 *
 * Achado da Fase 1.2 (PDI dev457034): GET com cookie e SEM X-UserToken devolve 401
 * "User is not authenticated". O token é obrigatório mesmo para leitura, por isso
 * o cliente renova o token e repete uma vez quando recebe 401.
 *
 * Só GET. Serializa no máximo `concurrency` chamadas e recua em 429/5xx.
 *
 * Cuidados com a instância (revisão de 23/10/2026, depois de erros em instância real):
 * - `sysparm_no_count=true`: sem ele a Table API faz um COUNT(*) com o mesmo filtro a cada chamada; na sondagem sem
 *   filtro isso contava a sys_audit e a syslog_transaction inteiras (416 mil linhas no PDI; milhões em produção).
 * - O limite de chamadas simultâneas é da instância (compartilhado por todos os clientes do mesmo endereço), e não de
 *   cada cliente: o painel cria um cliente por mensagem e várias rodam juntas.
 * - Recusa não se repete na mesma sessão: tabela negada (403 "User Not Authorized") e consulta barrada por Query ACL
 *   (403 "Insufficient rights to query records") ficam guardadas por 10 min. Cada recusa vira um erro no log da
 *   instância, e um usuário sem acesso gerava dezenas por registro.
 * - Rótulos, tipos e opções dos campos vêm do /api/now/ui/meta da tabela (o que o próprio formulário usa), e não de
 *   sys_dictionary, sys_choice e sys_documentation. Para quem não tem Query ACL nessas tabelas, cada consulta barrada
 *   deixava mensagens vermelhas na sessão do usuário ("Part of the query on sys_dictionary has been ignored...").
 */
export class FetchRestClient implements RestClient {
  calls = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly gate: Gate;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(private readonly opts: FetchRestClientOptions) {
    // Nunca guardar o fetch global como método: chamado com `this` = cliente dá "Illegal invocation".
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.gate = gateFor(opts.baseUrl, opts.concurrency ?? DEFAULT_CONCURRENCY);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async query(req: QueryRequest): Promise<QueryResult> {
    // Tabela vira parte do caminho da URL: fora do padrão (minúsculas, números e _), não sai.
    if (!TABLE_NAME.test(req.table) || !req.fields.every((f) => FIELD_NAME.test(f))) return { rows: [], status: 0, access: 'unknown' };
    if (!this.token) this.token = await this.opts.getToken();
    const allowed = await this.filterAllowed(req);
    if (allowed !== 'ok') {
      // Rótulo, tipo e opções que o usuário não pode consultar no dicionário: vêm do ui/meta da tabela (o que o próprio
      // formulário usa). Quem pode consultar (admin) continua lendo o dicionário, como sempre: o ui/meta descreve o
      // tipo de outro jeito (choice onde o dicionário diz integer) e o motor compara valores pelo tipo.
      const fromMeta = await this.fromUiMeta(req);
      return fromMeta ?? { rows: [], status: 403, access: allowed };
    }
    const known = refusals.get(this.opts.baseUrl, this.token, req);
    if (known) return known;
    await this.acquire();
    try {
      const r = await this.doQuery(req, true);
      if (r.access === 'denied' || r.access === 'no_filter') refusals.put(this.opts.baseUrl, this.token, req, r);
      return r;
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
      if (h) {
        const choices = parseMetaChoices(meta); if (choices) h.choices = choices;
        const refs = parseMetaRefs(meta); if (refs) h.refs = refs;
        const shown = parseMetaRefDisplay(meta); if (shown) h.refDisplay = shown;
        const tz = await this.opts.getTimeZone?.().catch(() => undefined); if (tz) h.timeZone = tz;
      }
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
      sysparm_no_count: 'true',
    });
    return `${this.opts.baseUrl.replace(/\/$/, '')}/api/now/table/${req.table}?${p}`;
  }

  private async doQuery(req: QueryRequest, mayRetryAuth: boolean, attempt = 0): Promise<QueryResult> {
    if (!this.token) this.token = await this.opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers['X-UserToken'] = this.token;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? this.timeoutMs);
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
    // Repete só o que costuma passar: limite de taxa e gateway/serviço indisponível. 500 da Table API é erro do pedido
    // (no PDI, sys_choice para escopo.user dá 500 sempre): repetir só gasta tempo.
    if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < 2) {
      await sleep(300 * 2 ** attempt);
      return this.doQuery(req, mayRetryAuth, attempt + 1);
    }

    const text = await res.text().catch(() => '');
    // 500 que não é JSON vem do balanceador da ServiceNow ("snow_adc"), não da Table API: no PDI aparece ao acaso,
    // em qualquer página. Uma nova tentativa. Erro de verdade da API vem em JSON e não se repete.
    if (res.status === 500 && !text.trimStart().startsWith('{') && attempt < 1) {
      await sleep(400);
      return this.doQuery(req, mayRetryAuth, attempt + 1);
    }
    let rows: Row[] = [];
    let parsed = false;
    try {
      const json = JSON.parse(text) as { result?: Row[] };
      parsed = Array.isArray(json.result);
      rows = parsed ? json.result! : [];
    } catch {
      rows = [];
    }
    // 200 sem lista de resultado (página de login do SSO, HTML de erro, proxy): não é "vazio", é "não sei".
    if (res.ok && !parsed) return { rows: [], status: res.status, access: 'unknown' };
    return { rows, status: res.status, access: classifyAccess(res.status, rows, text) };
  }

  /**
   * Antes de filtrar, confere no ui/meta da tabela se o usuário pode filtrar por cada coluna do filtro. Qualquer tabela
   * pode ter Query ACL (no PDI: sys_dictionary, sys_choice, syslog, sysauto_script, sys_data_policy_rule...), e cada
   * consulta barrada deixa mensagens vermelhas na sessão do usuário. O ui/meta só lista as colunas que o usuário pode
   * ler, com canmatch=true nas que pode filtrar; para itil e usuários de escopo, as tabelas de sistema vêm sem coluna.
   * - Nenhuma coluna: o usuário não lê nada ali → 'denied' (é o que leva ao histórico do formulário quando falta sys_audit).
   * - Coluna do filtro ausente ou sem canmatch → 'no_filter'. Ordenação só exige que a coluna exista.
   * - Coluna com ponto (flow.active): confere cada tabela do caminho.
   * - ui/meta indisponível: segue como antes.
   */
  private async filterAllowed(req: QueryRequest): Promise<'ok' | 'denied' | 'no_filter'> {
    if (!req.query) return 'ok';
    const cols = await this.uiMeta(req.table);
    if (!cols) return 'ok';
    if (!Object.keys(cols).length) return 'denied';
    for (const { path, order } of queryTerms(req.query)) {
      if (path === 'sys_id') continue;
      let c: Record<string, MetaColumn> | null = cols;
      const parts = path.split('.');
      for (let i = 0; i < parts.length && c; i++) {
        const col: MetaColumn | undefined = c[parts[i]!];
        if (!col) return 'no_filter';
        const last = i === parts.length - 1;
        if (last && !order && col.canmatch !== true) return 'no_filter';
        if (!last) {
          if (!col.reference) return 'no_filter';
          c = await this.uiMeta(col.reference);
          if (c && !Object.keys(c).length) return 'no_filter';
        }
      }
    }
    return 'ok';
  }

  /** Colunas de /api/now/ui/meta/<tabela>, guardadas por 10 min por instância e sessão. Nulo se a instância negar. */
  private uiMeta(table: string): Promise<Record<string, MetaColumn> | null> {
    // Consultas simultâneas à mesma tabela esperam a mesma busca em vez de cada uma pedir o ui/meta.
    const key = `${this.opts.baseUrl.replace(/\/$/, '')}|${this.token ?? ''}|${table}`;
    const running = metaInflight.get(key);
    if (running) return running;
    const p = this.loadUiMeta(table).finally(() => metaInflight.delete(key));
    metaInflight.set(key, p);
    return p;
  }

  private async loadUiMeta(table: string): Promise<Record<string, MetaColumn> | null> {
    if (!TABLE_NAME.test(table)) return null;
    const key = `${this.opts.baseUrl.replace(/\/$/, '')}|${this.token ?? ''}|${table}`;
    const hit = metaCache.get(key);
    if (hit && Date.now() - hit.at < META_TTL_MS) return hit.columns;
    const stored = (await this.opts.store?.get(`meta|${key}`).catch(() => undefined)) as { at: number; columns: Record<string, MetaColumn> | null } | undefined;
    if (stored && Date.now() - stored.at < META_TTL_MS) { metaCache.set(key, stored); return stored.columns; }
    await this.acquire();
    try {
      this.calls++;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers['X-UserToken'] = this.token;
      const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/api/now/ui/meta/${encodeURIComponent(table)}`, { method: 'GET', headers, credentials: 'include' });
      const raw = res.status === 200 ? ((await res.json()) as { result?: { columns?: Record<string, MetaColumn> } })?.result?.columns : undefined;
      const columns = raw && typeof raw === 'object' && !Array.isArray(raw) ? slimColumns(raw) : null;
      const entry = { at: Date.now(), columns };
      metaCache.set(key, entry);
      // Só respostas boas vão para o armazenamento: uma falha passageira não fica valendo por 10 min.
      if (columns) await this.opts.store?.set(`meta|${key}`, entry).catch(() => undefined);
      return columns;
    } catch { return null; } finally {
      this.release();
    }
  }

  /**
   * Responde pelo ui/meta as consultas de rótulo, tipo e opções por tabela e campo ("nameIN<tabelas>^elementIN<campos>").
   * As linhas saem com `name` = primeira tabela da lista (a do registro; o ui/meta já inclui os campos herdados).
   * Qualquer outro formato, ou campo que o ui/meta não tenha, segue para a Table API.
   */
  private async fromUiMeta(req: QueryRequest): Promise<QueryResult | null> {
    const supported = META_FIELDS[req.table];
    if (!supported || !req.fields.every((f) => supported.includes(f))) return null;
    let tables: string[] | undefined, elements: string[] | undefined, languages: string[] | undefined;
    for (const term of req.query.split('^').filter(Boolean)) {
      const m = term.match(/^(name|element|language)(=|IN)(.+)$/);
      if (m) {
        const list = m[3]!.split(',').filter(Boolean);
        if (m[1] === 'name') tables = list; else if (m[1] === 'element') elements = list; else languages = list;
      } else if (!/^(inactive=false|active=true|ORDERBY(DESC)?[a-z_]+)$/.test(term)) return null;
    }
    if (!tables?.length) return null;
    const cols = await this.uiMeta(tables[0]!);
    if (!cols) return null;
    const table = tables[0]!;
    const rows: Row[] = [];
    for (const [element, c] of Object.entries(cols)) {
      if (elements && !elements.includes(element)) continue;
      if (req.table === 'sys_choice') {
        for (const ch of c.choices ?? []) if (ch.value !== undefined && ch.value !== '' && ch.label) rows.push(pick({ name: table, element, value: String(ch.value), label: ch.label, language: languages?.[0] ?? '', inactive: 'false' }, req.fields));
      } else if (req.table === 'sys_documentation') {
        if (c.label) rows.push(pick({ name: table, element, label: c.label, language: languages?.[0] ?? '' }, req.fields));
      } else {
        rows.push(pick({ sys_id: '', name: table, element, column_label: c.label ?? '', internal_type: c.type ?? '', reference: c.reference ?? '',
          read_only: String(!!c.read_only), mandatory: String(!!c.mandatory), active: 'true', attributes: c.attributes ?? '' }, req.fields));
      }
    }
    return { rows: rows.slice(0, req.limit), status: 200, access: rows.length ? 'ok' : 'empty' };
  }

  private acquire(): Promise<void> {
    return this.gate.acquire();
  }

  private release(): void {
    this.gate.release();
  }
}

/**
 * Chamadas simultâneas por instância. Medido no PDI (23/10/2026): a sessão do usuário atende os pedidos em fila; com
 * consultas pesadas em paralelo, a página do próprio usuário levou 0,8 s (1), 6 s (3), 15 s (6) e 28 s (12).
 */
const DEFAULT_CONCURRENCY = 2;
const TABLE_NAME = /^[a-z0-9_]+$/;
const FIELD_NAME = /^[a-z0-9_.]+$/;

interface MetaColumn { canmatch?: boolean; label?: string; type?: string; reference?: string; mandatory?: boolean; read_only?: boolean; attributes?: string; choices?: { label?: string; value?: string }[] }
const META_TTL_MS = 10 * 60 * 1000;
const metaCache = new Map<string, { at: number; columns: Record<string, MetaColumn> | null }>();
const metaInflight = new Map<string, Promise<Record<string, MetaColumn> | null>>();
/** Campos que o ui/meta sabe preencher, por tabela de configuração. */
const META_FIELDS: Record<string, string[]> = {
  sys_dictionary: ['sys_id', 'name', 'element', 'column_label', 'internal_type', 'reference', 'read_only', 'mandatory', 'active', 'attributes'],
  sys_choice: ['name', 'element', 'value', 'label', 'language', 'inactive'],
  sys_documentation: ['name', 'element', 'label', 'language'],
};
const pick = (row: Record<string, string>, fields: string[]): Row => Object.fromEntries(fields.map((f) => [f, row[f] ?? ''])) as Row;

/** Fila de chamadas de uma instância: no máximo `limit` ao mesmo tempo, somando todos os clientes. */
class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(() => { this.active++; resolve(); }));
  }
  release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}
const gates = new Map<string, Gate>();
function gateFor(baseUrl: string, limit: number): Gate {
  const key = baseUrl.replace(/\/$/, '');
  let g = gates.get(key);
  if (!g) { g = new Gate(limit); gates.set(key, g); }
  return g;
}

/**
 * Recusas já recebidas, por instância, sessão (o token muda a cada login e impersonação) e formato da consulta (tabela
 * e campos do filtro). Valem só para o mesmo formato: a mesma tabela pode negar uma consulta e liberar outra.
 */
const REFUSAL_TTL_MS = 10 * 60 * 1000;
const refusals = {
  map: new Map<string, { at: number; result: QueryResult }>(),
  key(baseUrl: string, token: string | null, req: QueryRequest): string {
    return `${baseUrl.replace(/\/$/, '')}|${token ?? ''}|${req.table}|${queryFields(req.query)}`;
  },
  get(baseUrl: string, token: string | null, req: QueryRequest): QueryResult | undefined {
    const key = this.key(baseUrl, token, req);
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < REFUSAL_TTL_MS) return { ...hit.result, rows: [] };
    if (hit) this.map.delete(key);
    return undefined;
  },
  // Mesmo "tabela negada" fica pelo formato: no PDI, sys_script sem filtro dá 403 para o usuário de escopo e, filtrada
  // pelo app dele, dá 200 com as regras. Guardar pela tabela inteira escondia essas regras.
  put(baseUrl: string, token: string | null, req: QueryRequest, result: QueryResult): void {
    this.map.set(this.key(baseUrl, token, req), { at: Date.now(), result: { ...result, rows: [] } });
  },
};

/** Só o que o motor usa de cada coluna do ui/meta (guardado na sessão do navegador). */
function slimColumns(raw: Record<string, MetaColumn & { reference_display_field?: string }>): Record<string, MetaColumn> {
  const out: Record<string, MetaColumn> = {};
  for (const [name, c] of Object.entries(raw)) {
    out[name] = { canmatch: c.canmatch === true, label: c.label, type: c.type, reference: c.reference, mandatory: c.mandatory, read_only: c.read_only, attributes: c.attributes,
      ...(c.choices?.length ? { choices: c.choices.map((x) => ({ label: x.label, value: x.value })) } : {}) };
  }
  return out;
}

/** Colunas do filtro e se são só de ordenação: "a=1^ORDERBYb" → [{a}, {b, order}]. Sem /i: operador é maiúsculo. */
function queryTerms(query: string): { path: string; order: boolean }[] {
  return query.split(/\^(?:OR|NQ)?/).flatMap((t) => {
    const m = t.match(/^(ORDERBYDESC|ORDERBY)?([a-z0-9_.]+)/);
    return m ? [{ path: m[2]!, order: !!m[1] }] : [];
  });
}

/**
 * Campos usados no filtro, em ordem: "name=incident^element=state" e "name=problem^element=x" dão "element,name".
 * Sem /i: campo é minúsculo e operador é maiúsculo ("sourceINx" → "source").
 */
function queryFields(query: string): string {
  const fields = query.split(/\^(?:OR|NQ)?/).map((t) => t.match(/^(?:ORDERBYDESC|ORDERBY)?([a-z0-9_.]+)/)?.[1]).filter((f): f is string => !!f);
  return [...new Set(fields)].sort().join(',');
}

type RawHistory = { entries?: { sys_timestamp?: number; sys_created_on?: string; sys_created_on_adjusted?: string; user_id?: string; sys_created_by?: string; entries?: { changes?: { field_name?: string; field_label?: string; field_type?: string; old_value?: string; new_value?: string }[] } }[]; fields?: { name?: string; isJournal?: boolean }[] };

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
      ...(e.sys_created_on && e.sys_created_on_adjusted ? { tzOffsetMs: utcMs(e.sys_created_on_adjusted) - utcMs(e.sys_created_on) } : {}),
      changes: (e.entries?.changes ?? []).filter((c) => c.field_name).map((c) => ({
        field: c.field_name!, label: c.field_label, type: c.field_type, oldValue: c.old_value ?? '', newValue: c.new_value ?? '',
      })),
    }))
    .filter((e) => e.changes.length && e.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const fields = (j.fields ?? []).filter((f) => f.name && !f.isJournal && !f.name.startsWith('*')).map((f) => f.name!);
  return { entries, fields };
}

const utcMs = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');

/** Campos de referência de /api/now/ui/meta/<tabela>: campo → tabela referenciada. */
export function parseMetaRefs(json: unknown): Record<string, string> | null {
  const cols = (json as { result?: { columns?: Record<string, { type?: string; reference?: string }> } } | null)?.result?.columns;
  if (!cols) return null;
  const out: Record<string, string> = {};
  for (const [name, col] of Object.entries(cols)) if (col.type === 'reference' && col.reference) out[name] = col.reference;
  return out;
}

/** Campo de exibição de cada referência em /api/now/ui/meta/<tabela> (reference_display_field). */
export function parseMetaRefDisplay(json: unknown): Record<string, string> | null {
  const cols = (json as { result?: { columns?: Record<string, { type?: string; reference_display_field?: string }> } } | null)?.result?.columns;
  if (!cols) return null;
  const out: Record<string, string> = {};
  for (const [name, col] of Object.entries(cols)) if (col.type === 'reference' && col.reference_display_field && /^[a-z0-9_]+$/.test(col.reference_display_field)) out[name] = col.reference_display_field;
  return out;
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
