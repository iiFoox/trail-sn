import type { QueryRequest, RestClient } from './client/RestClient';
import { documentation, fieldLabels, refTexts } from './display';
import { fieldPair, parseSubmit } from './txLog';
import { historyToAudit } from './history';
import { RecordNotFoundError, RecordUnavailableError, recordUnanswered, type AccessState, type Row, type Target } from './types';
import { failureLog, isFormSubmitFor, isWorkspaceAction, shift, toMs, uiActionMatches, uiActionQuery, uiActionRef, timedQuery, walkHierarchy, withTimeout } from './util';

/**
 * Linha do tempo do registro inteiro: cada gravação (checkpoint da auditoria) com quem gravou,
 * por onde entrou (formulário, API, job, automação...) e os campos que mudaram.
 * É a visão panorâmica; o porquê de um campo específico continua sendo `investigate`.
 */

export type SaveVia =
  | 'form'        // envio de formulário do registro
  | 'api'         // REST / Table API
  | 'ui_action'   // botão do formulário com script próprio
  | 'async'       // job ASYNC (BR assíncrona)
  | 'job'         // job agendado
  | 'background'  // Scripts - Background
  | 'chained'     // gravação no mesmo segundo da anterior, sem transação própria (BR after/async, script include)
  | 'system'      // usuário system sem transação identificada (job, integração, motor)
  | 'created'     // criação do registro
  | 'expired'     // rastros de transação já expiraram
  | 'unknown';

export interface TimelineField { field: string; label: string; oldValue: string; newValue: string; oldDisplay: string; newDisplay: string; journal: boolean; /** Tabela referenciada (os valores são sys_ids dela). */ ref?: string }
export interface TimelineSave {
  checkpoint: number;
  at: string;
  user: string;
  via: SaveVia;
  /** Nome do botão, do job, da BR assíncrona ou caminho da API, quando o rastro diz. */
  detail?: string;
  fields: TimelineField[];
}
export interface Timeline {
  target: { table: string; sysId: string; display: string; title?: string };
  saves: TimelineSave[];
  /** Mais gravações existem do que as carregadas. */
  truncated: boolean;
  /** Mudanças lidas do histórico do formulário (quem não lê sys_audit); só os campos de `historyFields`. */
  auditFrom?: 'history';
  historyFields?: string[];
  /** Gravações reconstruídas dos envios de formulário (sem auditoria nem histórico): só o que o formulário enviou. */
  fromTransactions?: boolean;
  /** O usuário não lê sys_audit (e não houve histórico do formulário): a tela avisa que a auditoria não está disponível. */
  auditDenied?: boolean;
  /** Fontes que não responderam (prazo, 5xx, página de login): o resultado pode estar incompleto. */
  missing?: string[];
  timing: { totalMs: number; calls: number };
}

const JOURNAL = new Set(['work_notes', 'comments', 'comments_and_work_notes']);
const MAX_AUDIT = 600;
const MAX_TX_SAVES = 30;

export async function recordTimeline(client: RestClient, target: Omit<Target, 'field'>, opts: { sourceTimeoutMs?: number; retentionDays?: number; language?: string } = {}): Promise<Timeline> {
  const started = Date.now();
  const callsBefore = client.calls;
  const timeout = opts.sourceTimeoutMs ?? 4000;
  const q = async (table: string, query: string, fields: string[], limit = 100): Promise<Row[]> => {
    const req: QueryRequest = { table, query, fields, limit };
    const r = await timedQuery(client, req, timeout);
    fails.note(req, r.access);
    return r.rows;
  };
  // Fonte sem resposta vira lista vazia, mas fica anotada: a linha do tempo avisa que pode estar incompleta.
  const fails = failureLog();

  // ---------- registro e hierarquia ----------
  const recQuery = target.sysId ? `sys_id=${target.sysId}` : `number=${target.number ?? ''}`;
  const recReq: QueryRequest = { table: target.table, query: recQuery, fields: ['sys_id', 'number', 'name', 'short_description', 'sys_created_on', 'sys_created_by', 'sys_updated_on'], limit: 1 };
  const recTimeout = { rows: [] as Row[], status: 0, access: 'timeout' as AccessState };
  const [recFirst, tables] = await Promise.all([
    timedQuery(client, recReq, timeout),
    hierarchy(target.table),
  ]);
  // Sem resposta útil (prazo ou 5xx): uma segunda tentativa com mais folga antes de desistir.
  const recRes = !recFirst.rows[0] && recordUnanswered(recFirst.access) ? await timedQuery(client, recReq, timeout * 3) : recFirst;
  const rec = recRes.rows[0];
  if (!rec) {
    if (recordUnanswered(recRes.access)) throw new RecordUnavailableError({ ...target, field: '' }, recRes.access === 'timeout' ? 'timeout' : 'error', recRes.status);
    throw new RecordNotFoundError({ ...target, field: '' });
  }
  const sysId = rec.sys_id ?? '';

  // ---------- auditoria completa (mais recentes primeiro) ----------
  const auditRes = await timedQuery(client, { table: 'sys_audit', query: `tablename=${target.table}^documentkey=${sysId}^ORDERBYDESCsys_created_on`,
    fields: ['fieldname', 'oldvalue', 'newvalue', 'user', 'sys_created_on', 'record_checkpoint'], limit: MAX_AUDIT }, timeout);
  let audit = auditRes.rows;
  // Quem não lê sys_audit vê o histórico no formulário: a linha do tempo sai dele (mais recentes primeiro, como a auditoria).
  let fromHistory: { auditFrom: 'history'; historyFields: string[] } | undefined;
  if (auditRes.access === 'denied' && client.history) {
    const h = await client.history(target.table, sysId).catch(() => null);
    if (h) { audit = (await historyToAudit(h, tables, q, rec.sys_created_on)).reverse(); fromHistory = { auditFrom: 'history', historyFields: h.fields }; }
  }
  // Sem auditoria e sem histórico do formulário: as gravações vêm dos envios de formulário que a instância guardou
  // (syslog_transaction). Só aparece o que o formulário enviou; gravação de fluxo, regra ou script não aparece.
  // Texto exibido no formulário (sys_display): vale para valor de referência que a tabela não deixou ler.
  const formDisplay: Record<string, Record<string, string>> = {};
  let fromTx = false;
  if (!audit.length && (auditRes.access === 'denied' || auditRes.access === 'timeout') && rec.sys_created_on) {
    const fieldsTx = ['url', 'type', 'sys_created_on', 'start_process_at', 'sys_created_by'];
    const to = shift(rec.sys_updated_on || rec.sys_created_on, 60);
    const first = await timedQuery(client, { table: 'syslog_transaction', query: `urlLIKE${sysId}^type=form^sys_created_on>=${rec.sys_created_on}^sys_created_on<=${to}^ORDERBYsys_created_on`, fields: fieldsTx, limit: 200 }, timeout);
    let rows = first.rows;
    // Filtro pela URL barrado para o usuário: janela de datas, que a instância aceita, e o sys_id conferido aqui.
    if (first.access === 'no_filter') {
      const byWindow = await timedQuery(client, { table: 'syslog_transaction', query: `sys_created_on>=${rec.sys_created_on}^sys_created_on<=${to}^ORDERBYsys_created_on`, fields: fieldsTx, limit: 1000 }, timeout);
      rows = byWindow.rows.filter((x) => x.type === 'form' && (x.url ?? '').includes(sysId));
    }
    const built: Row[] = [];
    for (const x of rows) {
      const startMs = toMs(x.start_process_at || x.sys_created_on || '');
      const s = parseSubmit(x.url ?? '', target.table, startMs);
      if (!s || Number.isNaN(startMs)) continue;
      const at = new Date(startMs).toISOString().slice(0, 19).replace('T', ' ');
      const cp = s.insert ? 1 : Math.max(2, (s.sysModCount ?? 0) + 1);
      for (const c of s.changes) {
        // Campo com ponto é de outro registro mostrado no formulário (dot-walking), não deste.
        if (c.field.includes('.')) continue;
        built.push({ fieldname: c.field, oldvalue: c.oldValue ?? '', newvalue: c.newValue ?? '', user: x.sys_created_by ?? '', sys_created_on: at, record_checkpoint: String(cp) });
        const p = fieldPair(x.url ?? '', target.table, c.field);
        const m = (formDisplay[c.field] ??= {});
        if (p.orig && p.origShown && p.origShown !== p.orig) m[p.orig] = p.origShown;
        if (p.sent && p.sentShown && p.sentShown !== p.sent) m[p.sent] = p.sentShown;
      }
    }
    if (built.length) { audit = built.sort((a, b) => (b.sys_created_on ?? '').localeCompare(a.sys_created_on ?? '')); fromTx = true; }
  }
  const truncated = audit.length >= MAX_AUDIT;
  const byCp = new Map<number, Row[]>();
  for (const a of audit) {
    const cp = Number(a.record_checkpoint ?? 0);
    if (!byCp.has(cp)) byCp.set(cp, []);
    byCp.get(cp)!.push(a);
  }
  const cps = [...byCp.keys()].sort((a, b) => b - a);
  const fields = [...new Set(audit.map((a) => a.fieldname ?? '').filter(Boolean))];

  // ---------- rótulos dos campos e dos valores ----------
  const [dict, docs, choices] = await Promise.all([
    fields.length ? q('sys_dictionary', `nameIN${tables.join(',')}^elementIN${fields.join(',')}`, ['name', 'element', 'column_label', 'internal_type', 'reference'], 300) : Promise.resolve([]),
    documentation(q, tables, fields, opts.language),
    fields.length ? q('sys_choice', `nameIN${tables.join(',')}^elementIN${fields.join(',')}^inactive=false`, ['name', 'element', 'value', 'label', 'language'], 1000) : Promise.resolve([]),
  ]);
  const rank = (t: string | undefined) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const colLabel = fieldLabels(docs, dict, tables, opts.language);
  const refTable: Record<string, string> = {};
  for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) {
    const el = d.element ?? '';
    if (!(el in refTable) && d.internal_type === 'reference' && d.reference) refTable[el] = d.reference;
  }
  const choiceLabel: Record<string, Record<string, string>> = {};
  for (const c of [...choices].sort((a, b) => rank(a.name) - rank(b.name) || (a.language === 'en' ? -1 : 0) - (b.language === 'en' ? -1 : 0))) {
    const m = (choiceLabel[c.element ?? ''] ??= {});
    if (c.value && c.label && !(c.value in m)) m[c.value] = c.label;
  }
  // Referências: um GET por tabela referenciada (no máximo 6), com os sys_ids que aparecem na auditoria.
  const refIds: Record<string, Set<string>> = {};
  for (const a of audit) {
    const t = refTable[a.fieldname ?? ''];
    if (!t) continue;
    for (const v of [a.oldvalue, a.newvalue]) if (v && /^[0-9a-f]{32}$/.test(v)) (refIds[t] ??= new Set()).add(v);
  }
  const refDisplay: Record<string, string> = {};
  await Promise.all(Object.entries(refIds).slice(0, 6).map(async ([t, ids]) => {
    Object.assign(refDisplay, await refTexts(q, t, [...ids]));
  }));
  const display = (field: string, v: string) => (v ? choiceLabel[field]?.[v] ?? refDisplay[v] ?? formDisplay[field]?.[v] ?? v : '');

  // ---------- transações das gravações mais recentes (janelas fundidas) ----------
  const recent = cps.slice(0, MAX_TX_SAVES).map((cp) => byCp.get(cp)![0]!.sys_created_on ?? '').filter(Boolean);
  const windows = merge(recent.map((at) => ({ from: shift(at, -3), to: shift(at, 3) })));
  const tx = (await Promise.all(windows.slice(0, 10).map((w) =>
    q('syslog_transaction', `sys_created_on>=${w.from}^sys_created_on<=${w.to}^ORDERBYsys_created_on`, ['sys_created_on', 'type', 'url', 'sys_created_by'], 200)))).flat();
  const retentionMs = (opts.retentionDays ?? 56) * 864e5;
  const uiIds = [...new Set(tx.filter((t) => (t.url ?? '').includes(sysId)).map((t) => uiActionRef(t.url) ?? '').filter(Boolean))];
  const uiRows = uiActionQuery(uiIds, [target.table]) ? await q('sys_ui_action', uiActionQuery(uiIds, [target.table]), ['sys_id', 'name', 'action_name'], 30) : [];

  // ---------- classificação de cada gravação ----------
  // Cada transação explica uma gravação só: a mais antiga do segundo fica com o formulário/API, as seguintes são encadeadas.
  const used = new Set<Row>();
  const ordered = cps.map((cp, i) => ({ cp, i })).reverse();
  const byIndex = new Map<number, TimelineSave>();
  for (const { cp, i } of ordered) byIndex.set(i, classify(cp, i));
  const saves: TimelineSave[] = cps.map((_cp, i) => byIndex.get(i)!);
  function classify(cp: number, i: number): TimelineSave {
    const rows = byCp.get(cp)!;
    const at = rows[0]!.sys_created_on ?? '';
    const user = rows[0]!.user ?? '';
    const prevAt = byCp.get(cps[i + 1] ?? -1)?.[0]?.sys_created_on;
    const near = (t: Row, before: number, after: number) => { const d = toMs(t.sys_created_on ?? '') - toMs(at); return d >= -before * 1000 && d <= after * 1000; };
    const mine = tx.filter((t) => !used.has(t) && (t.url ?? '').includes(sysId) && near(t, 3, 2));
    const form = mine.find((t) => isFormSubmitFor(t.url, sysId));
    const api = mine.find((t) => /\/api\//.test(t.url ?? ''));
    const jobs = tx.filter((t) => /^JOB: /.test(t.url ?? '') && near(t, 1, 2));
    const scripts = tx.find((t) => (t.url ?? '').includes('/sys.scripts.do') && t.sys_created_by === user && near(t, 3, 2));
    let via: SaveVia = 'unknown';
    let detail: string | undefined;
    if (form) used.add(form);
    if (api) used.add(api);
    const chained = !!prevAt && Math.abs(toMs(prevAt) - toMs(at)) <= 2000 && !form && !api;
    const async = jobs.find((t) => (t.url ?? '').startsWith('JOB: ASYNC: '));
    const job = jobs.find((t) => !(t.url ?? '').startsWith('JOB: ASYNC: '));
    if (form) {
      const action = uiActionRef(form.url);
      const ua = uiRows.find((u) => uiActionMatches(u, action));
      via = ua && !/^sysverb_/.test(ua.action_name ?? '') ? 'ui_action' : 'form';
      detail = ua?.name || undefined;
    } else if (api && isWorkspaceAction(api.url)) {
      // Workspace: o Salvar e os botões rodam como /api/now/ui/ui_action/<id>.
      const ua = uiRows.find((u) => uiActionMatches(u, uiActionRef(api.url)));
      via = ua && !/^sysverb_/.test(ua.action_name ?? '') ? 'ui_action' : 'form';
      detail = ua && via === 'ui_action' ? `Workspace · ${ua.name}` : 'Workspace';
    } else if (api) { via = 'api'; detail = (api.url ?? '').split('?')[0]; }
    else if (chained && async) { via = 'async'; detail = (async.url ?? '').slice(12).trim(); }
    else if (chained) via = 'chained';
    else if (async) { via = 'async'; detail = (async.url ?? '').slice(12).trim(); }
    else if (job) { via = 'job'; detail = (job.url ?? '').slice(5).trim(); }
    else if (scripts) via = 'background';
    else if (!truncated && i === cps.length - 1 && rows.every((r) => !r.oldvalue)) via = 'created';
    else if (Date.now() - toMs(at) > retentionMs || i >= MAX_TX_SAVES) via = 'expired';
    else if (user === 'system') via = 'system';
    const fields: TimelineField[] = rows.map((r) => {
      const f = r.fieldname ?? '';
      return { field: f, label: colLabel[f] ?? f, oldValue: r.oldvalue ?? '', newValue: r.newvalue ?? '', oldDisplay: display(f, r.oldvalue ?? ''), newDisplay: display(f, r.newvalue ?? ''), journal: JOURNAL.has(f), ...(refTable[f] ? { ref: refTable[f] } : {}) };
    }).sort((a, b) => Number(a.journal) - Number(b.journal) || a.label.localeCompare(b.label));
    return { checkpoint: cp, at, user, via, ...(detail ? { detail } : {}), fields };
  }

  return {
    target: { table: target.table, sysId, display: rec.number || rec.name || sysId, ...(rec.short_description ? { title: rec.short_description } : {}) },
    saves,
    truncated,
    ...(fromHistory ?? {}),
    ...(fromTx ? { fromTransactions: true } : {}),
    ...(auditRes.access === 'denied' && !fromHistory ? { auditDenied: true } : {}),
    ...(fails.missing().length ? { missing: fails.missing() } : {}),
    timing: { totalMs: Date.now() - started, calls: client.calls - callsBefore },
  };

  async function hierarchy(table: string): Promise<string[]> {
    return (await walkHierarchy(q, table, 6)).tables;
  }
}

function merge(ws: { from: string; to: string }[]): { from: string; to: string }[] {
  const s = [...ws].sort((a, b) => a.from.localeCompare(b.from));
  const out: { from: string; to: string }[] = [];
  for (const w of s) {
    const last = out[out.length - 1];
    if (last && w.from <= shift(last.to, 60)) { if (w.to > last.to) last.to = w.to; } else out.push({ ...w });
  }
  return out;
}

export interface SaveDiffRow {
  field: string;
  label: string;
  /** Valor logo depois da gravação A (o mais antigo dos dois pontos). */
  fromValue: string; fromDisplay: string;
  /** Valor logo depois da gravação B. */
  toValue: string; toDisplay: string;
  /** Quantas gravações entre A (exclusive) e B (inclusive) mexeram no campo, e por quem. */
  touches: number;
  users: string[];
  /** O campo mudou e voltou ao valor de A no meio do caminho. */
  reverted: boolean;
}
export interface SaveDiff { from: TimelineSave; to: TimelineSave; rows: SaveDiffRow[]; saves: number; journal: number }

/**
 * Compara o registro em dois pontos da linha do tempo: o estado logo depois da gravação `a`
 * e o estado logo depois da gravação `b` (a ordem dos argumentos não importa).
 * Usa só a auditoria: para cada campo mexido entre as duas, o valor de partida é o `oldValue`
 * da primeira mudança depois de A e o de chegada é o `newValue` da última até B.
 */
export function compareSaves(tl: Timeline, a: number, b: number): SaveDiff | undefined {
  const sa = tl.saves.find((s) => s.checkpoint === a);
  const sb = tl.saves.find((s) => s.checkpoint === b);
  if (!sa || !sb) return undefined;
  const [from, to] = sa.checkpoint <= sb.checkpoint ? [sa, sb] : [sb, sa];
  const between = tl.saves.filter((s) => s.checkpoint > from.checkpoint && s.checkpoint <= to.checkpoint).sort((x, y) => x.checkpoint - y.checkpoint);
  const acc = new Map<string, { first: TimelineField; last: TimelineField; touches: number; users: Set<string>; seenFrom: boolean }>();
  let journal = 0;
  for (const s of between) for (const f of s.fields) {
    if (f.journal) { journal++; continue; }
    const cur = acc.get(f.field);
    if (!cur) acc.set(f.field, { first: f, last: f, touches: 1, users: new Set([s.user]), seenFrom: false });
    else { if (f.newValue === cur.first.oldValue) cur.seenFrom = true; cur.last = f; cur.touches++; cur.users.add(s.user); }
  }
  const rows: SaveDiffRow[] = [];
  for (const [field, x] of acc) {
    const changed = x.first.oldValue !== x.last.newValue;
    if (!changed && x.touches < 2) continue;
    rows.push({ field, label: x.first.label, fromValue: x.first.oldValue, fromDisplay: x.first.oldDisplay, toValue: x.last.newValue, toDisplay: x.last.newDisplay, touches: x.touches, users: [...x.users], reverted: !changed });
  }
  rows.sort((p, q) => Number(p.reverted) - Number(q.reverted) || p.label.localeCompare(q.label));
  return { from, to, rows, saves: between.length, journal };
}
