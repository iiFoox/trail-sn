import type { QueryRequest, RestClient } from './client/RestClient';
import { RecordNotFoundError, type AccessState, type Row, type Target } from './types';
import { shift, toMs, uiActionMatches, uiActionQuery, uiActionRef, withTimeout } from './util';

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

export interface TimelineField { field: string; label: string; oldValue: string; newValue: string; oldDisplay: string; newDisplay: string; journal: boolean }
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
  timing: { totalMs: number; calls: number };
}

const JOURNAL = new Set(['work_notes', 'comments', 'comments_and_work_notes']);
const MAX_AUDIT = 600;
const MAX_TX_SAVES = 30;

export async function recordTimeline(client: RestClient, target: Omit<Target, 'field'>, opts: { sourceTimeoutMs?: number; retentionDays?: number } = {}): Promise<Timeline> {
  const started = Date.now();
  const callsBefore = client.calls;
  const timeout = opts.sourceTimeoutMs ?? 4000;
  const q = async (table: string, query: string, fields: string[], limit = 100): Promise<Row[]> => {
    const req: QueryRequest = { table, query, fields, limit };
    return (await withTimeout(client.query(req), timeout, { rows: [], status: 0, access: 'timeout' as AccessState })).rows;
  };

  // ---------- registro e hierarquia ----------
  const recQuery = target.sysId ? `sys_id=${target.sysId}` : `number=${target.number ?? ''}`;
  const [recRows, tables] = await Promise.all([
    q(target.table, recQuery, ['sys_id', 'number', 'name', 'short_description', 'sys_created_on', 'sys_created_by'], 1),
    hierarchy(target.table),
  ]);
  const rec = recRows[0];
  if (!rec) throw new RecordNotFoundError({ ...target, field: '' });
  const sysId = rec.sys_id ?? '';

  // ---------- auditoria completa (mais recentes primeiro) ----------
  const audit = await q('sys_audit', `tablename=${target.table}^documentkey=${sysId}^ORDERBYDESCsys_created_on`,
    ['fieldname', 'oldvalue', 'newvalue', 'user', 'sys_created_on', 'record_checkpoint'], MAX_AUDIT);
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
  const [dict, choices] = await Promise.all([
    fields.length ? q('sys_dictionary', `nameIN${tables.join(',')}^elementIN${fields.join(',')}`, ['name', 'element', 'column_label', 'internal_type', 'reference'], 300) : Promise.resolve([]),
    fields.length ? q('sys_choice', `nameIN${tables.join(',')}^elementIN${fields.join(',')}^inactive=false`, ['name', 'element', 'value', 'label', 'language'], 1000) : Promise.resolve([]),
  ]);
  const rank = (t: string | undefined) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const colLabel: Record<string, string> = {};
  const refTable: Record<string, string> = {};
  for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) {
    const el = d.element ?? '';
    if (!(el in colLabel) && d.column_label) colLabel[el] = d.column_label;
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
    const rows = await q(t, `sys_idIN${[...ids].slice(0, 80).join(',')}`, ['sys_id', 'name', 'number', 'user_name', 'short_description'], 80);
    for (const r of rows) refDisplay[r.sys_id ?? ''] = r.name || r.number || r.user_name || r.short_description || '';
  }));
  const display = (field: string, v: string) => (v ? choiceLabel[field]?.[v] ?? refDisplay[v] ?? v : '');

  // ---------- transações das gravações mais recentes (janelas fundidas) ----------
  const recent = cps.slice(0, MAX_TX_SAVES).map((cp) => byCp.get(cp)![0]!.sys_created_on ?? '').filter(Boolean);
  const windows = merge(recent.map((at) => ({ from: shift(at, -3), to: shift(at, 3) })));
  const tx = (await Promise.all(windows.slice(0, 10).map((w) =>
    q('syslog_transaction', `sys_created_on>=${w.from}^sys_created_on<=${w.to}^ORDERBYsys_created_on`, ['sys_created_on', 'type', 'url', 'sys_created_by'], 200)))).flat();
  const retentionMs = (opts.retentionDays ?? 56) * 864e5;
  const uiIds = [...new Set(tx.filter((t) => (t.url ?? '').includes(sysId)).map((t) => uiActionRef(t.url) ?? '').filter(Boolean))];
  const uiRows = uiIds.length ? await q('sys_ui_action', uiActionQuery(uiIds, [target.table]), ['sys_id', 'name', 'action_name'], 30) : [];

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
    const form = mine.find((t) => (t.url ?? '').includes(`sys_uniqueValue=${sysId}`));
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
      return { field: f, label: colLabel[f] ?? f, oldValue: r.oldvalue ?? '', newValue: r.newvalue ?? '', oldDisplay: display(f, r.oldvalue ?? ''), newDisplay: display(f, r.newvalue ?? ''), journal: JOURNAL.has(f) };
    }).sort((a, b) => Number(a.journal) - Number(b.journal) || a.label.localeCompare(b.label));
    return { checkpoint: cp, at, user, via, ...(detail ? { detail } : {}), fields };
  }

  return {
    target: { table: target.table, sysId, display: rec.number || rec.name || sysId, ...(rec.short_description ? { title: rec.short_description } : {}) },
    saves,
    truncated,
    timing: { totalMs: Date.now() - started, calls: client.calls - callsBefore },
  };

  async function hierarchy(table: string): Promise<string[]> {
    const out: string[] = [];
    let t: string | undefined = table;
    for (let i = 0; t && i < 6; i++) {
      out.push(t);
      const r: Row | undefined = (await q('sys_db_object', `name=${t}`, ['super_class.name'], 1))[0];
      t = r?.['super_class.name'] || undefined;
    }
    return out;
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
