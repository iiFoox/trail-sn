/**
 * "Por que este salvamento foi lento?" — quanto tempo uma gravação levou, onde o tempo foi gasto e o que rodou nela.
 *
 * Fontes (só GET, pelo `SharedClient`, cada uma opcional):
 *  - `syslog_transaction`: a transação do salvamento (a mesma janela que `investigate` usa para achar formulário, API ou
 *    job) e os seus campos de tempo. **Sem ela não há medida**: o resultado é `sem_dado` e nada é estimado.
 *  - `sys_dictionary` (name=syslog_transaction): quais campos de tempo existem nesta versão. Os nomes variam entre
 *    versões; pedimos só os que o dicionário lista. Quem não lê o dicionário (o itil recebe lista vazia) cai no modo
 *    "sondagem": pedimos todos os candidatos e usamos só os que vierem na resposta (a Table API omite campos que não
 *    existem em `sysparm_fields`).
 *  - `sys_audit` (ou o histórico do formulário): quando e quem gravou, e o que mudou (para avaliar as condições das regras).
 *  - `sys_script`: regras de negócio da hierarquia cujas condições valem para a gravação ("devem ter rodado").
 *  - Rastros do que rodou de fato ("visto"): transações `JOB: ASYNC: <regra>`, `syslog` com `source` igual ao nome de
 *    uma regra, eventos `sysevent` do registro no instante e flows (`sys_flow_context`) iniciados no instante.
 *  - Mediana dos salvamentos do mesmo tipo (formulário/API da tabela, ou o mesmo job) nas últimas N horas, para dizer o
 *    que é "normal". Com menos de 5 amostras não comparamos.
 *
 * Tempo por regra: `sys_script` não guarda; o `syslog_transaction` só traz o total das regras (`business_rule_time`).
 * Procuramos uma tabela de métricas por regra (`RULE_METRIC_TABLES`) em `sys_db_object`; se existir, só avisamos
 * (`rule_metrics_table:<nome>`) — não atribuímos tempo a cada regra sem saber o formato. `additional_info` vem cru.
 */
import type { RestClient } from './client/RestClient';
import { tableHierarchy } from './fieldMap';
import { historyToAudit } from './history';
import { evalExpr, type Env } from './scriptEval';
import { shared, type SharedClient } from './sharedClient';
import type { AccessState, Row } from './types';
import type { QueryRequest, QueryResult } from './client/RestClient';
import { evalCondition, inList, isFormSubmitFor, isRecordWrite, isWorkspaceAction, mergeWindows, shift, toMs, validDate, withTimeout } from './util';

// ---------------------------------------------------------------- campos de tempo

/**
 * Campos de tempo candidatos em `syslog_transaction`, em ordem de preferência (o primeiro que existir ganha).
 * Nomes conhecidos (Washington/Xanadu): response_time, sql_time, sql_count, business_rule_time, business_rule_count,
 * acl_time, client_response_time, client_network_time, browser_time, semaphore_wait_time, session_wait_time,
 * total_wait_time, output_length, additional_info (`additional_debug_count` não existe no PDI de 21/10/2026; existe
 * `additional_debug_info`, que não é contagem, e por isso não é pedido). Os alternativos (br_time, network_time...) são
 * de versões antigas ou de documentação; só entram se o dicionário disser que existem. A conferir no PDI.
 * Tempos em milissegundos (inteiros). Um campo glide_duration ("1970-01-01 00:00:04") também é lido.
 */
export const TIMING_FIELDS = {
  /** Tempo do servidor (do pedido chegar à resposta sair). */
  server: ['response_time'],
  /** Tempo total visto pelo navegador (servidor + rede + navegador), quando a instância grava os tempos do cliente. */
  clientTotal: ['client_response_time'],
  rules: ['business_rule_time', 'br_time'],
  rulesCount: ['business_rule_count', 'br_count'],
  sql: ['sql_time'],
  sqlCount: ['sql_count'],
  acl: ['acl_time'],
  /** Navegador: montar a página, client scripts e UI policies. */
  client: ['browser_time'],
  network: ['client_network_time', 'network_time'],
  semaphore: ['semaphore_wait_time'],
  sessionWait: ['session_wait_time'],
  totalWait: ['total_wait_time'],
  output: ['output_length'],
  info: ['additional_info'],
} as const;
export type TimingKey = keyof typeof TIMING_FIELDS;
/** Tabelas de métricas por regra que procuramos (só avisamos se existirem). */
export const RULE_METRIC_TABLES = ['sys_business_rule_metrics'];

const ALL_CANDIDATES = [...new Set(Object.values(TIMING_FIELDS).flat())];
const TX_BASE = ['sys_id', 'sys_created_on', 'sys_created_by', 'url', 'type'];

// ---------------------------------------------------------------- tipos

export type SaveVerdict = 'normal' | 'lento' | 'muito_lento' | 'sem_dado';
/** Por onde a gravação entrou (pela URL da transação). */
export type SaveTxVia = 'form' | 'api' | 'workspace' | 'job' | 'async' | 'background' | 'other';

export interface SaveParts {
  /** Servidor (response_time). */
  server?: number;
  /** Regras de negócio (total; inclui o SQL que elas fazem). */
  rules?: number;
  rulesCount?: number;
  /** Banco (total; parte dele acontece dentro das regras). */
  sql?: number;
  sqlCount?: number;
  /** Verificação de permissões (ACL). */
  acl?: number;
  /** Navegador. */
  client?: number;
  /** Rede. */
  network?: number;
  /** Espera por fila (semáforo) e pela sessão. */
  wait?: number;
}

export type RanKind = 'br_before' | 'br_after' | 'br_async' | 'event' | 'flow';
export interface RanItem {
  kind: RanKind;
  name: string;
  /** Tabela do artefato (para o link). */
  table: string;
  sysId?: string;
  /** true: há rastro de que rodou (log, job, evento, flow). false: as condições valem para esta gravação. */
  seen: boolean;
  /** Ordem (regras). */
  order?: number;
  at?: string;
}

export interface SaveBaseline { medianMs: number; n: number; hours: number; /** Comparou com o mesmo job/URL, com a tabela ou com qualquer tabela. */ scope: 'table' | 'url' | 'any_table' }

export interface SaveTiming {
  /** Quando gravou (auditoria/histórico, ou o pedido). */
  at: string;
  checkpoint?: number;
  /** Transação escolhida. */
  txSysId?: string;
  /** Fim da transação (syslog_transaction.sys_created_on) e início estimado (fim − tempo do servidor). */
  txEnd?: string;
  txStart?: string;
  url?: string;
  via?: SaveTxVia;
  user?: string;
  /** Tempo total: o do navegador quando existe, senão o do servidor. */
  totalMs?: number;
  totalFrom?: 'client' | 'server';
  parts: SaveParts;
  /** Parte que mais pesou (≥ 40 % do total), quando dá para dizer. */
  where?: 'rules' | 'sql' | 'acl' | 'client' | 'network' | 'wait';
  baseline?: SaveBaseline;
  verdict: SaveVerdict;
  /** Veredito pela mediana da tabela ou por limites fixos (sem mediana). */
  verdictBasis?: 'baseline' | 'absolute';
  ran: RanItem[];
  /** Campos de tempo usados (nomes reais da instância) e de onde se soube deles. */
  timingFields: Partial<Record<TimingKey, string>>;
  fieldsFrom: 'dictionary' | 'probe';
  /** `additional_info` cru (até 500 caracteres), quando existe. */
  additionalInfo?: string;
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  /**
   * Códigos: tx_denied, tx_not_found, tx_job_by_time, no_time_fields, no_rule_time, no_client_time, dict_unavailable,
   * baseline_few:<n>, baseline_slow (a consulta da mediana estourou o prazo), baseline_none, rules_denied, rules_unevaluated:<n>, rules_need_audit, async_separate,
   * per_rule_time_unknown, rule_metrics_table:<nome>, save_not_found.
   */
  notes: string[];
  timing: { totalMs: number; calls: number };
}

export interface SaveTimingOptions {
  /** Janela da mediana, em horas antes do salvamento (padrão 24). */
  baselineHours?: number;
  /** Máximo de transações na mediana (padrão 200). */
  baselineLimit?: number;
  /** Mínimo de amostras para comparar (padrão 5). */
  minBaseline?: number;
  /** Prazo da mediana, sem segunda tentativa (padrão 2500 ms): estourou, desiste e avisa `baseline_slow`. */
  baselineTimeoutMs?: number;
  timeoutMs?: number;
}

/**
 * Uma tentativa só, com prazo próprio (a mediana é opcional: melhor desistir cedo que gastar 2× o prazo do
 * `SharedClient`). Conta nas chamadas do cliente; a negação aparece como acesso.
 */
function quick(sc: SharedClient, req: QueryRequest, ms: number): Promise<QueryResult> {
  return withTimeout(sc.inner.query(req).catch(() => ({ rows: [], status: 0, access: 'unknown' as AccessState })), ms, { rows: [], status: 0, access: 'timeout' as AccessState });
}

/**
 * Janelas de `sys_created_on` em volta de cada instante, fundidas e unidas por ^NQ. `extra` (filtro de url) entra em
 * cada bloco. Filtrar `syslog_transaction` só por url não usa índice (11 a 16 s no PDI); por janelas de horário, 184 ms
 * para duas.
 */
export function windowsQuery(instants: string[], before: number, after: number, extra = ''): string {
  const ws = mergeWindows(instants.filter(validDate).map((t) => ({ from: shift(t, -before), to: shift(t, after) })));
  return ws.map((w) => `${extra ? `${extra}^` : ''}sys_created_on>=${w.from}^sys_created_on<=${w.to}`).join('^NQ');
}

// ---------------------------------------------------------------- campos disponíveis

export interface TimingFieldSet { fields: Partial<Record<TimingKey, string>>; from: 'dictionary' | 'probe' }

/** Quais campos de tempo existem nesta instância, pelo dicionário. Sem dicionário: sondagem (todos os candidatos). */
export async function timingFields(client: RestClient): Promise<TimingFieldSet> {
  const sc = shared(client);
  const r = await sc.query({ table: 'sys_dictionary', query: `name=syslog_transaction^elementIN${ALL_CANDIDATES.join(',')}`, fields: ['element', 'internal_type'], limit: 100 });
  const have = new Set(r.rows.map((x) => x.element ?? '').filter(Boolean));
  if (!have.size) return { fields: Object.fromEntries(Object.entries(TIMING_FIELDS).map(([k, v]) => [k, v[0]])) as TimingFieldSet['fields'], from: 'probe' };
  const fields: TimingFieldSet['fields'] = {};
  for (const [k, names] of Object.entries(TIMING_FIELDS) as [TimingKey, readonly string[]][]) {
    const n = names.find((x) => have.has(x));
    if (n) fields[k] = n;
  }
  return { fields, from: 'dictionary' };
}

/** Na sondagem pedimos todos os candidatos; os que não vieram em nenhuma linha não existem nesta versão. */
function probeFields(set: TimingFieldSet, rows: Row[]): Partial<Record<TimingKey, string>> {
  if (set.from === 'dictionary') return set.fields;
  const out: Partial<Record<TimingKey, string>> = {};
  for (const [k, names] of Object.entries(TIMING_FIELDS) as [TimingKey, readonly string[]][]) {
    const n = names.find((x) => rows.some((r) => x in r));
    if (n) out[k] = n;
  }
  return out;
}

const requestFields = (set: TimingFieldSet): string[] => [...TX_BASE, ...(set.from === 'dictionary' ? Object.values(set.fields) : ALL_CANDIDATES)];

/** Milissegundos de um campo de tempo: inteiro, decimal ou glide_duration ("1970-01-01 00:00:04"). */
export function parseMs(v: string | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Math.round(Number(s)); return n >= 0 ? n : undefined; }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) { const n = toMs(s); return Number.isFinite(n) && n >= 0 ? n : undefined; }
  return undefined;
}

function readParts(row: Row, f: Partial<Record<TimingKey, string>>): { parts: SaveParts; totalMs?: number; totalFrom?: 'client' | 'server' } {
  const g = (k: TimingKey) => (f[k] ? parseMs(row[f[k]!]) : undefined);
  const parts: SaveParts = {};
  const set = <K extends keyof SaveParts>(k: K, v: number | undefined) => { if (v !== undefined) parts[k] = v; };
  set('server', g('server'));
  set('rules', g('rules'));
  set('rulesCount', g('rulesCount'));
  set('sql', g('sql'));
  set('sqlCount', g('sqlCount'));
  set('acl', g('acl'));
  set('client', g('client'));
  set('network', g('network'));
  // Espera: o total da instância, quando existe; senão semáforo + sessão.
  const tw = g('totalWait');
  const sem = g('semaphore');
  const ses = g('sessionWait');
  set('wait', tw !== undefined ? tw : sem !== undefined || ses !== undefined ? (sem ?? 0) + (ses ?? 0) : undefined);
  const ct = g('clientTotal');
  // O total do navegador só vale quando foi gravado (0 = a instância não mediu o lado do cliente).
  if (ct && ct > 0) return { parts, totalMs: ct, totalFrom: 'client' };
  if (parts.server !== undefined) return { parts, totalMs: parts.server, totalFrom: 'server' };
  return { parts };
}

// ---------------------------------------------------------------- classificação da transação

/** Por onde a transação entrou, e se ela grava este registro. */
export function txVia(url: string | undefined): SaveTxVia {
  const u = url ?? '';
  if (u.startsWith('JOB: ASYNC: ')) return 'async';
  if (u.startsWith('JOB: ')) return 'job';
  if (u.includes('/sys.scripts.do')) return 'background';
  if (isWorkspaceAction(u)) return 'workspace';
  if (/\/api\//.test(u)) return 'api';
  if (/^\/[a-z0-9_]+\.do\?/.test(u)) return 'form';
  return 'other';
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

/**
 * Veredito. Com mediana (n ≥ 5): lento quando ≥ 2× o normal e pelo menos 1 s a mais; muito lento quando ≥ 4× e 3 s a
 * mais. Sem mediana: limites fixos de 2 s (lento) e 5 s (muito lento).
 */
export function verdictOf(totalMs: number | undefined, medianMs?: number): { verdict: SaveVerdict; basis?: 'baseline' | 'absolute' } {
  if (totalMs === undefined) return { verdict: 'sem_dado' };
  if (medianMs !== undefined) {
    const d = totalMs - medianMs;
    if (totalMs >= medianMs * 4 && d >= 3000) return { verdict: 'muito_lento', basis: 'baseline' };
    if (totalMs >= medianMs * 2 && d >= 1000) return { verdict: 'lento', basis: 'baseline' };
    return { verdict: 'normal', basis: 'baseline' };
  }
  return { verdict: totalMs >= 5000 ? 'muito_lento' : totalMs >= 2000 ? 'lento' : 'normal', basis: 'absolute' };
}

function whereOf(t: { totalMs?: number; parts: SaveParts }): SaveTiming['where'] {
  if (!t.totalMs) return undefined;
  const cand = (['rules', 'sql', 'acl', 'client', 'network', 'wait'] as const).map((k) => [k, t.parts[k] ?? 0] as const).sort((a, b) => b[1] - a[1]);
  const top = cand[0]!;
  // Regras incluem o SQL que fazem: quando as duas pesam, as regras são a explicação mais útil.
  if (top[0] === 'sql' && (t.parts.rules ?? 0) >= 0.4 * t.totalMs) return 'rules';
  return top[1] >= 0.4 * t.totalMs ? top[0] : undefined;
}

/** Filtro da mediana: salvamentos do mesmo tipo. Devolve a consulta (sem a janela) e o teste fino por linha. */
function baselineScope(via: SaveTxVia, url: string, tables: string[]): { query: string; keep: (r: Row) => boolean; scope: SaveBaseline['scope'] } | undefined {
  const table = tables[0] ?? '';
  if (via === 'form') return { query: `urlLIKE/${table}.do?^urlLIKEsys_uniqueValue=`, keep: (r) => (r.url ?? '').startsWith(`/${table}.do?`) && /sys_uniqueValue=[0-9a-f]{32}/.test(r.url ?? ''), scope: 'table' };
  if (via === 'api') return { query: `urlLIKE/table/${table}/`, keep: (r) => new RegExp(`/api/now/(?:v\\d+/)?table/${table}/[0-9a-f]{32}`).test(r.url ?? ''), scope: 'table' };
  if (via === 'workspace') return { query: 'urlLIKE/api/now/ui/ui_action/', keep: (r) => isWorkspaceAction(r.url), scope: 'any_table' };
  // Nome de job com ^ derrubaria a janela de horário da consulta; "javascript:" seria executado no servidor.
  if ((via === 'job' || via === 'async') && (/[\^\r\n]/.test(url) || /javascript:/i.test(url))) return undefined;
  if (via === 'job' || via === 'async') return { query: `url=${url}`, keep: (r) => r.url === url, scope: 'url' };
  return undefined;
}

// ---------------------------------------------------------------- saveTiming

export async function saveTiming(
  client: RestClient,
  input: { table: string; sysId: string; at?: string; checkpoint?: number },
  opts: SaveTimingOptions = {},
): Promise<SaveTiming> {
  const started = Date.now();
  const sc = shared(client, opts.timeoutMs);
  const calls0 = sc.calls;
  const notes: string[] = [];
  const q = async (table: string, query: string, fields: string[], limit = 100) => (await sc.query({ table, query, fields, limit })).rows;
  const { table, sysId } = input;

  // ---------- 1: registro, hierarquia, auditoria e campos de tempo ----------
  const [recRows, tables, auditRes, fset] = await Promise.all([
    q(table, `sys_id=${sysId}`, ['sys_id', 'sys_created_on', 'sys_updated_on', 'sys_updated_by'], 1),
    tableHierarchy(q, table),
    sc.query({ table: 'sys_audit', query: `tablename=${table}^documentkey=${sysId}^ORDERBYsys_created_on`, fields: ['fieldname', 'oldvalue', 'newvalue', 'user', 'sys_created_on', 'record_checkpoint'], limit: 1000 }),
    timingFields(sc),
  ]);
  const rec = recRows[0];
  let audit = auditRes.rows;
  if (auditRes.access === 'denied' && sc.inner.history) {
    const h = await sc.inner.history(table, sysId).catch(() => null);
    if (h) audit = await historyToAudit(h, tables, q, rec?.sys_created_on);
  }
  if (fset.from === 'probe') notes.push('dict_unavailable');

  // Qual gravação: pelo checkpoint, pelo horário (a gravação auditada mais próxima, até 2 s) ou a última do registro.
  let at = input.at ?? '';
  let checkpoint = input.checkpoint;
  let user = '';
  if (checkpoint !== undefined) {
    const row = audit.find((a) => Number(a.record_checkpoint) === checkpoint);
    if (row) { at = row.sys_created_on ?? ''; user = row.user ?? ''; } else notes.push('save_not_found');
  } else if (at) {
    const near = audit.filter((a) => Math.abs(toMs(a.sys_created_on ?? '') - toMs(at)) <= 2000).sort((a, b) => Math.abs(toMs(a.sys_created_on ?? '') - toMs(at)) - Math.abs(toMs(b.sys_created_on ?? '') - toMs(at)))[0];
    if (near) { checkpoint = Number(near.record_checkpoint); user = near.user ?? ''; }
  } else {
    const last = audit[audit.length - 1];
    if (last && (!rec?.sys_updated_on || Math.abs(toMs(last.sys_created_on ?? '') - toMs(rec.sys_updated_on)) <= 2000)) {
      at = last.sys_created_on ?? ''; checkpoint = Number(last.record_checkpoint); user = last.user ?? '';
    } else { at = rec?.sys_updated_on ?? ''; user = rec?.sys_updated_by ?? ''; }
  }
  const base = (): SaveTiming => ({
    at, ...(checkpoint !== undefined ? { checkpoint } : {}), parts: {}, verdict: 'sem_dado', ran: [], timingFields: {}, fieldsFrom: fset.from,
    access: sc.access, denied: [], slow: [], notes, timing: { totalMs: 0, calls: 0 },
  });
  const finish = (t: SaveTiming): SaveTiming => {
    const main = ['syslog_transaction', 'sys_audit', 'sys_script', 'sysevent', 'sys_flow_context', 'syslog', table];
    const denied = sc.denied(main).filter((s) => !(s === 'sys_audit' && audit.length));
    return { ...t, access: { ...sc.access }, denied, slow: sc.slow(main), notes: [...new Set(notes)], timing: { totalMs: Date.now() - started, calls: sc.calls - calls0 } };
  };
  if (!at) { notes.push('save_not_found'); return finish(base()); }

  // ---------- 2: a transação do salvamento ----------
  const hours = opts.baselineHours ?? 24;
  const bTimeout = opts.baselineTimeoutMs ?? 2500;
  const txRes = await sc.query({ table: 'syslog_transaction', query: `sys_created_on>=${shift(at, -5)}^sys_created_on<=${shift(at, 60)}^ORDERBYsys_created_on`, fields: requestFields(fset), limit: 200 });
  if (txRes.access === 'denied' || txRes.access === 'no_filter') { notes.push('tx_denied'); return finish({ ...base(), ran: await ranFromConditions() }); }
  const tf = probeFields(fset, txRes.rows);
  const tx = pickTransaction(txRes.rows, sysId, at, user, tf);
  if (!tx) { notes.push(txRes.access === 'timeout' ? 'tx_timeout' : 'tx_not_found'); return finish({ ...base(), timingFields: tf, ran: await ranFromConditions() }); }
  if (tx.byTime) notes.push('tx_job_by_time');
  const row = tx.row;
  const { parts, totalMs, totalFrom } = readParts(row, tf);
  if (totalMs === undefined) notes.push('no_time_fields');
  if (!tf.rules) notes.push('no_rule_time');
  if (!tf.client && !tf.clientTotal) notes.push('no_client_time');
  const end = row.sys_created_on ?? at;
  const start = parts.server !== undefined ? new Date(toMs(end) - parts.server).toISOString().replace('T', ' ').slice(0, 19) : end;
  const via = txVia(row.url);

  // ---------- 3: o que rodou (rastros + condições) e a mediana ----------
  const bscope = baselineScope(via, row.url ?? '', tables);
  let baselineSlow = false;
  const metricP = q('sys_db_object', `nameIN${RULE_METRIC_TABLES.join(',')}`, ['name'], 5);
  const [ranCond, asyncTx, logs, events, flows, bRows, metric] = await Promise.all([
    ranFromConditions(),
    Promise.resolve(txRes.rows.filter((t) => (t.url ?? '').startsWith('JOB: ASYNC: ') && (t.sys_created_on ?? '') >= start)),
    rulesP().then((brs) => { const names = inList([...new Set(brs.map((b) => b.name ?? ''))].slice(0, 100)); return names ? q('syslog', `sys_created_on>=${shift(start, -1)}^sys_created_on<=${shift(end, 1)}^sourceIN${names}`, ['source', 'sys_created_on'], 50) : []; }),
    q('sysevent', `instance=${sysId}^sys_created_on>=${shift(start, -1)}^sys_created_on<=${shift(end, 1)}`, ['sys_id', 'name', 'sys_created_on'], 50),
    q('sys_flow_context', `source_record=${sysId}^sys_created_on>=${shift(start, -1)}^sys_created_on<=${shift(end, 5)}`, ['sys_id', 'name', 'sys_created_on'], 20),
    baselineRows(),
    metricP,
  ]);
  for (const m of metric) if (m.name) notes.push(`rule_metrics_table:${m.name}`);

  const brs = await rulesP();
  const ran: RanItem[] = [...ranCond];
  const markSeen = (b: Row, kind: RanKind, when?: string) => {
    const hit = ran.find((x) => x.sysId === b.sys_id);
    if (hit) { hit.seen = true; return; }
    ran.push({ kind, name: b.name ?? '', table: 'sys_script', ...(b.sys_id ? { sysId: b.sys_id } : {}), seen: true, order: Number(b.order ?? 0), ...(when ? { at: when } : {}) });
  };
  for (const t of asyncTx) {
    const n = (t.url ?? '').slice(12).trim();
    const b = brs.find((x) => x.name === n && (x.when ?? '').startsWith('async'));
    if (b) markSeen(b, 'br_async', t.sys_created_on);
    else ran.push({ kind: 'br_async', name: n, table: 'sys_script', seen: true, ...(t.sys_created_on ? { at: t.sys_created_on } : {}) });
  }
  for (const l of logs) { const b = brs.find((x) => x.name === l.source); if (b) markSeen(b, kindOfWhen(b.when) ?? 'br_after'); }
  const seenEv = new Set<string>();
  for (const e of events) {
    if (/^(text_index|notification_engine\.|glide\.)/.test(e.name ?? '') || seenEv.has(e.name ?? '')) continue;
    seenEv.add(e.name ?? '');
    ran.push({ kind: 'event', name: e.name ?? '', table: 'sysevent', ...(e.sys_id ? { sysId: e.sys_id } : {}), seen: true, ...(e.sys_created_on ? { at: e.sys_created_on } : {}) });
  }
  for (const f of flows) ran.push({ kind: 'flow', name: f.name ?? '', table: 'sys_flow_context', ...(f.sys_id ? { sysId: f.sys_id } : {}), seen: true, ...(f.sys_created_on ? { at: f.sys_created_on } : {}) });
  if (ran.some((r) => r.kind === 'br_async')) notes.push('async_separate');
  if (ran.some((r) => r.kind.startsWith('br_') && r.kind !== 'br_async')) notes.push('per_rule_time_unknown');

  // Mediana: mesmo tipo de salvamento, sem a própria transação.
  let baseline: SaveBaseline | undefined;
  if (bscope) {
    const samples = bRows.filter((r) => r.sys_id !== row.sys_id && bscope.keep(r)).map((r) => readParts(r, tf).totalMs).filter((x): x is number => x !== undefined);
    const min = opts.minBaseline ?? 5;
    if (samples.length >= min) baseline = { medianMs: median(samples), n: samples.length, hours, scope: bscope.scope };
    else notes.push(baselineSlow ? 'baseline_slow' : `baseline_few:${samples.length}`);
  } else notes.push('baseline_none');

  const v = verdictOf(totalMs, baseline?.medianMs);
  const out: SaveTiming = {
    ...base(),
    ...(row.sys_id ? { txSysId: row.sys_id } : {}), txEnd: end, txStart: start,
    ...(row.url ? { url: row.url } : {}), via, user: row.sys_created_by || user,
    ...(totalMs !== undefined ? { totalMs } : {}), ...(totalFrom ? { totalFrom } : {}),
    parts, ...(baseline ? { baseline } : {}), verdict: v.verdict, ...(v.basis ? { verdictBasis: v.basis } : {}),
    ran: sortRan(ran), timingFields: tf,
    ...(tf.info && row[tf.info] ? { additionalInfo: String(row[tf.info]).slice(0, 500) } : {}),
  };
  const w = whereOf(out);
  return finish(w ? { ...out, where: w } : out);

  // ---------- mediana: salvamentos do mesmo tipo, sem varrer 24 h de syslog_transaction por url ----------
  async function baselineRows(): Promise<Row[]> {
    if (!bscope) return [];
    const done = (r: QueryResult) => { if (r.access === 'timeout') baselineSlow = true; return r.rows; };
    // Job/rotina: o mesmo url (exato), numa tentativa só. No máximo 6 h: url não tem índice e, numa instância grande,
    // 24 h de syslog_transaction são milhões de linhas varridas (o servidor continua a consulta mesmo após o prazo daqui).
    if (bscope.scope === 'url') return done(await quick(sc, { table: 'syslog_transaction', query: `${bscope.query}^sys_created_on>=${shift(at, -Math.min(hours, 6) * 3600)}^sys_created_on<=${at}`, fields: requestFields(fset), limit: opts.baselineLimit ?? 200 }, bTimeout));
    // Formulário, API e Workspace: janelas em volta das últimas gravações de outros registros da tabela.
    // Um prazo só para as duas consultas. Últimas gravações de outros registros da tabela (sys_updated_on costuma ter índice).
    const deadline = Date.now() + bTimeout;
    const others = await quick(sc, { table, query: `sys_updated_on>=${shift(at, -hours * 3600)}^sys_updated_on<=${at}^ORDERBYDESCsys_updated_on`, fields: ['sys_id', 'sys_updated_on'], limit: 21 }, bTimeout);
    if (others.access === 'timeout') { baselineSlow = true; return []; }
    const instants = others.rows.filter((r) => r.sys_id !== sysId).map((r) => r.sys_updated_on ?? '').filter((t) => t && t < shift(at, -2)).slice(0, 20);
    if (!instants.length) return [];
    return done(await quick(sc, { table: 'syslog_transaction', query: windowsQuery(instants, 2, 30, bscope.query), fields: requestFields(fset), limit: opts.baselineLimit ?? 200 }, Math.max(200, deadline - Date.now())));
  }

  // ---------- regras cujas condições valem para esta gravação ----------
  function rulesP(): Promise<Row[]> {
    return q('sys_script', `collectionIN${tables.join(',')}^active=true`, ['sys_id', 'name', 'when', 'order', 'collection', 'filter_condition', 'condition', 'action_insert', 'action_update'], 500);
  }
  async function ranFromConditions(): Promise<RanItem[]> {
    const brs = await rulesP();
    if (sc.access.sys_script === 'denied') { notes.push('rules_denied'); return []; }
    const cpRows = checkpoint !== undefined ? audit.filter((a) => Number(a.record_checkpoint) === checkpoint) : [];
    if (!cpRows.length) { if (brs.length) notes.push('rules_need_audit'); return []; }
    const changed = new Set(cpRows.map((r) => r.fieldname ?? ''));
    const old: Record<string, string> = Object.fromEntries(cpRows.map((r) => [r.fieldname ?? '', r.oldvalue ?? '']));
    // Valores do registro naquela gravação: os atuais voltados para trás pela auditoria (como em investigate).
    const need = [...new Set(brs.flatMap((b) => [...(b.filter_condition ?? '').matchAll(/(?:^|\^|OR)([a-z0-9_]+)(?=VALCHANGES|CHANGES|ISNOTEMPTY|ISEMPTY|STARTSWITH|ENDSWITH|NOTLIKE|LIKE|NOT IN|IN|!=|=)/g)].map((m) => m[1]!)
      .concat([...(b.condition ?? '').matchAll(/\b(?:current|previous)\.([a-z][a-z0-9_]*)/g)].map((m) => m[1]!))))].filter((f) => !['update', 'insert', 'operation', 'isNewRecord', 'getValue'].includes(f)).slice(0, 60);
    const cur = need.length ? (await q(table, `sys_id=${sysId}`, need, 1))[0] ?? {} : {};
    const recAt: Record<string, string> = {};
    for (const f of need) if (f in cur) {
      const later = audit.find((a) => a.fieldname === f && Number(a.record_checkpoint ?? 0) > checkpoint!);
      recAt[f] = later ? later.oldvalue ?? '' : cur[f] ?? '';
    }
    for (const r of cpRows) recAt[r.fieldname ?? ''] = r.newvalue ?? '';
    const isInsert = checkpoint === 1 && cpRows.every((r) => !r.oldvalue) && !!rec?.sys_created_on && Math.abs(toMs(rec.sys_created_on) - toMs(at)) <= 2000;
    const env: Env = { rec: recAt, old, changed, user: { name: user } };
    let unevaluated = 0;
    const out: RanItem[] = [];
    for (const b of brs) {
      const kind = kindOfWhen(b.when);
      if (!kind) continue;
      if ((isInsert ? b.action_insert : b.action_update) !== 'true') continue;
      const filter = (b.filter_condition ?? '').replace(/\^?EQ$/, '');
      const fc = filter ? evalCondition(filter, recAt, undefined, { set: changed, old }) : true;
      if (fc === false) continue;
      const jc = b.condition?.trim() ? evalExpr(b.condition, env) : true;
      if (jc === false || jc === 0 || jc === '') continue;
      // Condição que não sabemos avaliar: a regra fica de fora da lista (não dizemos que rodou), só contamos.
      if (fc === undefined || jc === undefined || jc === null) { unevaluated++; continue; }
      out.push({ kind, name: b.name ?? '', table: 'sys_script', ...(b.sys_id ? { sysId: b.sys_id } : {}), seen: false, order: Number(b.order ?? 0) });
    }
    if (unevaluated) notes.push(`rules_unevaluated:${unevaluated}`);
    return out;
  }
}

function kindOfWhen(when: string | undefined): RanKind | undefined {
  if (when === 'before') return 'br_before';
  if (when === 'after') return 'br_after';
  if ((when ?? '').startsWith('async')) return 'br_async';
  return undefined; // display roda ao abrir o formulário, não ao salvar
}

const KIND_RANK: Record<RanKind, number> = { br_before: 0, br_after: 1, br_async: 2, event: 3, flow: 4 };
function sortRan(r: RanItem[]): RanItem[] {
  return [...r].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Escolhe a transação do salvamento, como o motor já faz para formulário, API e job:
 *  1. transações que gravam ESTE registro (envio de formulário, Table API, botão do Workspace), preferindo a pessoa que
 *     gravou e a que estava aberta no instante da gravação (início = fim − tempo do servidor);
 *  2. sem nenhuma, a transação de job (ou Scripts - Background da pessoa) aberta no instante (marcada como por horário).
 * O syslog_transaction guarda o FIM da transação, com precisão de segundo: 1,5 s de folga.
 */
function pickTransaction(rows: Row[], sysId: string, at: string, user: string, tf: Partial<Record<TimingKey, string>>): { row: Row; byTime: boolean } | undefined {
  const t0 = toMs(at);
  const dist = (r: Row) => {
    const end = toMs(r.sys_created_on ?? '');
    const dur = tf.server ? parseMs(r[tf.server]) ?? 0 : 0;
    const startMs = end - dur;
    if (t0 >= startMs - 1500 && t0 <= end + 1500) return 0;
    return Math.min(Math.abs(t0 - startMs), Math.abs(t0 - end));
  };
  const writes = rows.filter((r) => isRecordWrite(r.url, sysId) && (r.sys_created_on ?? '') >= shift(at, -2));
  const score = (r: Row) => dist(r) + (user && r.sys_created_by !== user ? 5000 : 0) + (isFormSubmitFor(r.url, sysId) || /\/api\//.test(r.url ?? '') ? 0 : 500);
  const best = writes.sort((a, b) => score(a) - score(b))[0];
  if (best && dist(best) <= 3000) return { row: best, byTime: false };
  const jobs = rows.filter((r) => (/^JOB: /.test(r.url ?? '') || ((r.url ?? '').includes('/sys.scripts.do') && (!user || r.sys_created_by === user))) && dist(r) === 0)
    .sort((a, b) => toMs(a.sys_created_on ?? '') - toMs(b.sys_created_on ?? ''));
  const job = jobs[0];
  return job ? { row: job, byTime: true } : undefined;
}

// ---------------------------------------------------------------- lista de salvamentos do registro

export interface SaveTimeRow { at: string; txSysId?: string; url: string; via: SaveTxVia; user: string; totalMs?: number; parts: SaveParts; verdict: SaveVerdict }
export interface RecordSaveTimes {
  saves: SaveTimeRow[];
  timingFields: Partial<Record<TimingKey, string>>;
  access: Record<string, AccessState>;
  denied: string[];
  slow: string[];
  notes: string[];
  timing: { totalMs: number; calls: number };
}

/**
 * Salvamentos deste registro nos últimos `days` dias (padrão 7), com tempo, mais recentes primeiro (para o Histórico).
 * Os instantes vêm da auditoria (ou do histórico do formulário) e do próprio registro (criação e última gravação); a
 * transação é procurada em janelas de `sys_created_on` em volta deles (`[t−5 s, t+60 s]`, até 20, unidas por ^NQ).
 * Filtrar por `urlLIKE<sys_id>` em 7 dias levava 16 s no PDI e estourava o prazo.
 * Veredito por limites fixos (2 s / 5 s); a comparação com a mediana fica no `saveTiming` de cada um.
 * `syslog_transaction` negada → lista vazia com `tx_denied`. Sem nenhum instante: `saves_unknown`, sem consultar.
 */
export async function recordSaveTimes(client: RestClient, input: { table: string; sysId: string }, opts: { days?: number; limit?: number; timeoutMs?: number } = {}): Promise<RecordSaveTimes> {
  const started = Date.now();
  const sc: SharedClient = shared(client, opts.timeoutMs);
  const calls0 = sc.calls;
  const notes: string[] = [];
  const { table, sysId } = input;
  const since = new Date(Date.now() - (opts.days ?? 7) * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const [fset, recRes, auditRes] = await Promise.all([
    timingFields(sc),
    sc.query({ table, query: `sys_id=${sysId}`, fields: ['sys_id', 'sys_created_on', 'sys_updated_on'], limit: 1 }),
    sc.query({ table: 'sys_audit', query: `tablename=${table}^documentkey=${sysId}^sys_created_on>=${since}^ORDERBYDESCsys_created_on`, fields: ['sys_created_on', 'record_checkpoint'], limit: 500 }),
  ]);
  if (fset.from === 'probe') notes.push('dict_unavailable');
  let instants = auditRes.rows.map((a) => a.sys_created_on ?? '');
  if (auditRes.access === 'ok') notes.push('saves_from_audit');
  else if (auditRes.access === 'denied' && sc.inner.history) {
    const h = await sc.inner.history(table, sysId).catch(() => null);
    if (h?.entries.length) { instants = h.entries.map((e) => e.at); notes.push('saves_from_history'); }
  }
  const rec = recRes.rows[0];
  // A última gravação pode não ter mexido em campo auditado; a criação também é um salvamento.
  for (const t of [rec?.sys_updated_on, rec?.sys_created_on]) if (t) instants.push(t);
  const recent = [...new Set(instants.filter((t) => t && t >= since))].sort().reverse().slice(0, 20);
  const main = ['syslog_transaction'];
  const done = (rows: Row[], tf: Partial<Record<TimingKey, string>>): RecordSaveTimes => {
    const seen = new Set<string>();
    const saves = rows.filter((t) => isRecordWrite(t.url, sysId) && !seen.has(t.sys_id ?? t.sys_created_on ?? '') && seen.add(t.sys_id ?? t.sys_created_on ?? '')).map((t): SaveTimeRow => {
      const { parts, totalMs } = readParts(t, tf);
      return { at: t.sys_created_on ?? '', ...(t.sys_id ? { txSysId: t.sys_id } : {}), url: t.url ?? '', via: txVia(t.url), user: t.sys_created_by ?? '', ...(totalMs !== undefined ? { totalMs } : {}), parts, verdict: verdictOf(totalMs).verdict };
    }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.limit ?? 100);
    return { saves, timingFields: tf, access: { ...sc.access }, denied: sc.denied(main), slow: sc.slow(main), notes: [...new Set(notes)], timing: { totalMs: Date.now() - started, calls: sc.calls - calls0 } };
  };
  if (!recent.length) { notes.push('saves_unknown'); return done([], fset.from === 'dictionary' ? fset.fields : {}); }
  const r = await sc.query({ table: 'syslog_transaction', query: windowsQuery(recent, 5, 60, `urlLIKE${sysId}`), fields: requestFields(fset), limit: Math.min(1000, 50 * recent.length) });
  if (r.access === 'denied' || r.access === 'no_filter') notes.push('tx_denied');
  if (r.access === 'timeout') notes.push('tx_timeout');
  return done(r.rows, probeFields(fset, r.rows));
}

/** Só os salvamentos lentos ou muito lentos do registro. */
export async function recentSlowSaves(client: RestClient, input: { table: string; sysId: string }, opts: { days?: number; limit?: number; timeoutMs?: number } = {}): Promise<RecordSaveTimes> {
  const r = await recordSaveTimes(client, input, opts);
  return { ...r, saves: r.saves.filter((s) => s.verdict === 'lento' || s.verdict === 'muito_lento') };
}

// ---------------------------------------------------------------- texto simples

/** "4,2 s" / "4.2 s"; abaixo de 100 ms, em ms. */
export function fmtMs(ms: number, lang: 'pt' | 'en' = 'pt'): string {
  if (ms < 100) return `${Math.round(ms)} ms`;
  const s = (ms / 1000).toFixed(ms >= 10_000 ? 0 : 1);
  return `${lang === 'pt' ? s.replace('.', ',') : s} s`;
}

function list(xs: string[], lang: 'pt' | 'en'): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} ${lang === 'pt' ? 'e' : 'and'} ${xs[xs.length - 1]}`;
}

/** Texto em linguagem simples (pt/en) do tempo de um salvamento. Não inventa: sem medida, diz que não dá para medir. */
export function describeSaveTiming(t: SaveTiming, lang: 'pt' | 'en' = 'pt'): string {
  const pt = lang === 'pt';
  const f = (ms: number) => fmtMs(ms, lang);
  const out: string[] = [];
  if (t.notes.includes('tx_denied')) {
    out.push(pt ? 'Não dá para medir o tempo deste salvamento: os seus papéis não leem o registro de transações (syslog_transaction).'
      : "This save can't be timed: your roles can't read the transaction log (syslog_transaction).");
  } else if (t.totalMs === undefined) {
    out.push(t.txSysId
      ? (pt ? 'A transação deste salvamento foi achada, mas a instância não gravou o tempo dela.' : "This save's transaction was found, but the instance did not record its time.")
      : (pt ? 'Não achei a transação deste salvamento no registro de transações (pode ter expirado, ou foi feita por algo que não registra transação).'
        : "This save's transaction is not in the transaction log (it may have expired, or was made by something that doesn't log transactions)."));
  } else {
    const p = t.parts;
    const bits: string[] = [];
    if (p.rules !== undefined && p.rules >= 50) bits.push(pt ? `${f(p.rules)} em regras de negócio` : `${f(p.rules)} in business rules`);
    if (p.sqlCount !== undefined && p.sqlCount > 0) bits.push(pt ? `${p.sqlCount} consultas ao banco${p.sql !== undefined ? ` (${f(p.sql)})` : ''}` : `${p.sqlCount} database queries${p.sql !== undefined ? ` (${f(p.sql)})` : ''}`);
    else if (p.sql !== undefined && p.sql >= 50) bits.push(pt ? `${f(p.sql)} no banco` : `${f(p.sql)} in the database`);
    if (p.acl !== undefined && p.acl >= 200) bits.push(pt ? `${f(p.acl)} checando permissões` : `${f(p.acl)} checking permissions`);
    if (p.client !== undefined && p.client >= 200) bits.push(pt ? `${f(p.client)} no navegador` : `${f(p.client)} in the browser`);
    if (p.network !== undefined && p.network >= 200) bits.push(pt ? `${f(p.network)} na rede` : `${f(p.network)} on the network`);
    if (p.wait !== undefined && p.wait >= 200) bits.push(pt ? `${f(p.wait)} esperando na fila` : `${f(p.wait)} waiting in the queue`);
    out.push(`${pt ? 'Salvou em' : 'Saved in'} ${f(t.totalMs)}${bits.length ? ` — ${list(bits, lang)}` : ''}.`);
    if (t.baseline) {
      const scope = t.baseline.scope === 'url' ? (pt ? 'nesta mesma rotina' : 'for this same job') : t.baseline.scope === 'any_table' ? (pt ? 'no Workspace' : 'in Workspace') : (pt ? 'nesta tabela' : 'on this table');
      out.push(pt ? `O normal ${scope} é ${f(t.baseline.medianMs)} (mediana de ${t.baseline.n} salvamentos nas últimas ${t.baseline.hours} h).`
        : `Normal ${scope} is ${f(t.baseline.medianMs)} (median of ${t.baseline.n} saves in the last ${t.baseline.hours} h).`);
    } else {
      const few = t.notes.find((n) => n.startsWith('baseline_few:'));
      if (few) out.push(pt ? `Poucos salvamentos parecidos nas últimas horas (${few.split(':')[1]}) para dizer o que é normal.` : `Too few similar saves in recent hours (${few.split(':')[1]}) to say what is normal.`);
      else if (t.notes.includes('baseline_slow')) out.push(pt ? 'A instância demorou demais para comparar com outros salvamentos; o veredito usa limites fixos.' : 'The instance took too long to compare with other saves; the verdict uses fixed limits.');
    }
    const ratio = t.baseline && t.baseline.medianMs > 0 ? Math.round(t.totalMs / t.baseline.medianMs) : 0;
    if (t.verdict === 'muito_lento') out.push(pt ? `Está muito lento${ratio >= 2 ? ` (${ratio}× o normal)` : ''}.` : `This is very slow${ratio >= 2 ? ` (${ratio}× normal)` : ''}.`);
    else if (t.verdict === 'lento') out.push(pt ? `Está lento${ratio >= 2 ? ` (${ratio}× o normal)` : ''}.` : `This is slow${ratio >= 2 ? ` (${ratio}× normal)` : ''}.`);
    else if (t.verdict === 'normal') out.push(pt ? 'Dentro do normal.' : 'Within normal range.');
  }
  // O que rodou: visto nos rastros × deve ter rodado pelas condições.
  const n = (k: (r: RanItem) => boolean) => t.ran.filter(k).length;
  const sync = n((r) => r.kind === 'br_before' || r.kind === 'br_after');
  const asyncN = n((r) => r.kind === 'br_async');
  const ev = n((r) => r.kind === 'event');
  const fl = n((r) => r.kind === 'flow');
  const parts: string[] = [];
  if (sync) parts.push(pt ? `${sync} ${sync === 1 ? 'regra de negócio' : 'regras de negócio'}` : `${sync} business rule${sync === 1 ? '' : 's'}`);
  if (fl) parts.push(pt ? `${fl} ${fl === 1 ? 'flow' : 'flows'}` : `${fl} flow${fl === 1 ? '' : 's'}`);
  if (ev) parts.push(pt ? `${ev} ${ev === 1 ? 'evento' : 'eventos'}` : `${ev} event${ev === 1 ? '' : 's'}`);
  if (parts.length) out.push(pt ? `Rodaram neste salvamento: ${list(parts, lang)}.` : `Ran in this save: ${list(parts, lang)}.`);
  if (asyncN) out.push(pt ? `${asyncN} ${asyncN === 1 ? 'regra rodou' : 'regras rodaram'} depois, em segundo plano (fora deste tempo).` : `${asyncN} rule${asyncN === 1 ? '' : 's'} ran afterwards in the background (not in this time).`);
  if (sync && t.notes.includes('per_rule_time_unknown') && t.totalMs !== undefined) out.push(pt ? 'A instância só mede o total das regras, não o tempo de cada uma.' : 'The instance only measures the rules in total, not each one.');
  if (t.notes.includes('rules_denied')) out.push(pt ? 'Os seus papéis não leem as regras de negócio (sys_script): a lista do que rodou pode estar incompleta.' : "Your roles can't read business rules (sys_script): the list of what ran may be incomplete.");
  return out.join(' ');
}
