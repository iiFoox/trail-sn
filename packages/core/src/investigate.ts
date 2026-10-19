import type { QueryRequest, RestClient } from './client/RestClient';
import { scoreAll } from './scoring';
import { runSignatures, type ChangeContext, type TableMeta, type Traces } from './signatures';
import {
  DEFAULT_OPTIONS,
  RecordNotFoundError,
  type AccessState,
  type Change,
  type Investigation,
  type InvestigationOptions,
  type Row,
  type Target,
} from './types';
import { mergeWindows, refsField, shift, toMs, withTimeout } from './util';

/** Cache de metadados por tabela (hierarquia, BRs, script includes). A extensão guarda em chrome.storage.session. */
export interface MetaCache {
  get(table: string): Promise<TableMeta | undefined>;
  set(table: string, meta: TableMeta): Promise<void>;
}

export const noCache: MetaCache = { get: async () => undefined, set: async () => {} };

/**
 * Pipeline de uma investigação, em três rodadas de chamadas paralelas:
 *  1. registro + auditoria, e metadados da tabela (do cache ou da instância);
 *  2. rastros por mudança, com janelas próximas fundidas numa consulta só;
 *  3. artefatos citados pelos rastros (jobs por nome, script actions por evento, UI actions por sys_id).
 * As assinaturas recebem tudo carregado e não fazem chamada própria.
 */
export async function investigate(
  client: RestClient,
  target: Target,
  options: Partial<InvestigationOptions> = {},
  cache: MetaCache = noCache,
): Promise<Investigation> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const started = Date.now();
  const callsBefore = client.calls;
  const access: Record<string, AccessState> = {};

  const q = async (table: string, query: string, fields: string[], limit = 100, tag = table): Promise<Row[]> => {
    const req: QueryRequest = { table, query, fields, limit };
    const r = await withTimeout(client.query(req), opts.sourceTimeoutMs, { rows: [], status: 0, access: 'timeout' as AccessState });
    const prev = access[tag];
    if (!prev || prev === 'empty' || prev === 'unknown' || (prev === 'timeout' && r.access !== 'timeout')) access[tag] = r.access;
    return r.rows;
  };

  // ---------- rodada 1: registro, auditoria e metadados ----------
  const recQuery = target.sysId ? `sys_id=${target.sysId}` : `number=${target.number ?? ''}`;
  const [recRows, metaOrNull] = await Promise.all([
    q(target.table, recQuery, ['sys_id', 'number', 'sys_mod_count', 'sys_updated_on', 'sys_updated_by'], 1, 'record'),
    loadMeta(target.table, target.field),
  ]);
  const rec = recRows[0];
  if (!rec) throw new RecordNotFoundError(target);
  const sysId = rec.sys_id ?? '';
  const meta = metaOrNull;

  const audit = await q(
    'sys_audit',
    `tablename=${target.table}^documentkey=${sysId}^ORDERBYsys_created_on`,
    ['sys_id', 'fieldname', 'oldvalue', 'newvalue', 'user', 'sys_created_on', 'record_checkpoint'],
    1000,
  );
  const checkpoints: Record<string, Row[]> = {};
  for (const a of audit) (checkpoints[a.record_checkpoint ?? '0'] ??= []).push(a);
  const maxCheckpoint = Math.max(0, ...Object.keys(checkpoints).map(Number));
  const fieldChanges = audit.filter((a) => a.fieldname === target.field).slice(-opts.maxChanges).reverse();

  // ---------- rodada 2: rastros por mudança (janelas fundidas) ----------
  const windows = fieldChanges.map((c) => ({ from: shift(c.sys_created_on ?? '', -opts.windowBefore), to: shift(c.sys_created_on ?? '', opts.windowAfter) }));
  const merged = mergeWindows(windows);
  const [txAll, evAll, flowsAll, wfAll] = await Promise.all([
    Promise.all(merged.map((w) => q('syslog_transaction', `sys_created_on>=${w.from}^sys_created_on<=${w.to}^ORDERBYsys_created_on`, ['sys_id', 'sys_created_on', 'type', 'url', 'sys_created_by'], 200))).then((r) => r.flat()),
    Promise.all(merged.map((w) => q('sysevent', `instance=${sysId}^processed>=${shift(w.from, -1)}^processed<=${shift(w.to, 1)}`, ['sys_id', 'name', 'processed', 'sys_created_on'], 50))).then((r) => r.flat()),
    fieldChanges.length ? q('sys_flow_context', `source_record=${sysId}`, ['sys_id', 'name', 'state', 'sys_created_on', 'sys_updated_on'], 50) : Promise.resolve([]),
    fieldChanges.length ? q('wf_context', `id=${sysId}`, ['sys_id', 'workflow_version.name', 'state', 'started', 'ended'], 50) : Promise.resolve([]),
  ]);

  // ---------- rodada 3: artefatos citados pelos rastros ----------
  const jobNames = unique(txAll.filter((t) => /^JOB: /.test(t.url ?? '') && !/^JOB: ASYNC: /.test(t.url ?? '')).map((t) => (t.url ?? '').slice(5).trim()));
  const eventNames = unique(evAll.map((e) => e.name ?? '').filter(Boolean));
  const uiActionIds = unique(txAll.map((t) => (t.url ?? '').match(/sys_action=([0-9a-f]{32})/)?.[1] ?? '').filter(Boolean));
  const needsJobScan = fieldChanges.some((c) => !txAll.some((t) => t.sys_created_by === c.user && !/^JOB: /.test(t.url ?? '') && inWindow(t, c, opts)));

  const [jobsByName, scriptActions, uiActions, jobsByScript] = await Promise.all([
    jobNames.length ? q('sysauto_script', `nameIN${jobNames.join(',')}`, ['sys_id', 'name', 'script'], 50) : Promise.resolve([]),
    eventNames.length ? q('sysevent_script_action', `active=true^event_nameIN${eventNames.join(',')}`, ['sys_id', 'name', 'event_name', 'script'], 50) : Promise.resolve([]),
    uiActionIds.length ? q('sys_ui_action', `sys_idIN${uiActionIds.join(',')}`, ['sys_id', 'name', 'script', 'table'], 20) : Promise.resolve([]),
    needsJobScan ? q('sysauto_script', `scriptLIKE${target.field}^scriptLIKE${target.table}`, ['sys_id', 'name', 'script', 'run_type', 'run_start', 'run_time', 'run_as.user_name', 'active'], 50) : Promise.resolve([]),
  ]);

  // ---------- assinaturas e pontuação ----------
  const changes: Change[] = fieldChanges.map((c) => {
    const at = c.sys_created_on ?? '';
    const from = shift(at, -opts.windowBefore);
    const to = shift(at, opts.windowAfter);
    const traces: Traces = {
      transactions: txAll.filter((t) => between(t.sys_created_on, from, to)),
      events: evAll.filter((e) => between(e.processed, shift(at, -1), shift(at, 1))),
      scriptActions,
      flows: flowsAll.filter((f) => (f.sys_created_on ?? '') <= shift(at, 2) && (f.sys_updated_on ?? '') >= shift(at, -2)),
      workflows: wfAll.filter((w) => (w.started ?? '') <= to && (!w.ended || w.ended >= from)),
      jobsByName,
      uiActions,
      jobsByScript,
    };
    const ctx: ChangeContext = {
      table: target.table, field: target.field, sysId, audit: c, at, user: c.user ?? '',
      checkpoint: Number(c.record_checkpoint ?? 0), checkpoints, meta, traces, opts,
    };
    return {
      at, oldValue: c.oldvalue ?? '', newValue: c.newvalue ?? '', user: c.user ?? '', checkpoint: ctx.checkpoint,
      evidence: scoreAll(runSignatures(ctx)),
    };
  });

  // ---------- atualizações sem auditoria (setWorkflow(false) etc.) ----------
  let unaudited: Investigation['unaudited'] = null;
  const mods = Number(rec.sys_mod_count ?? 0);
  if (mods > maxCheckpoint) {
    const clues: string[] = [];
    const lastAudit = audit.length ? audit[audit.length - 1]?.sys_created_on ?? null : null;
    const updatedOn = rec.sys_updated_on ?? '';
    if (updatedOn && (!lastAudit || toMs(updatedOn) > toMs(lastAudit) + 1000)) {
      const tx = await q('syslog_transaction', `sys_created_on>=${shift(updatedOn, -3)}^sys_created_on<=${shift(updatedOn, 5)}`, ['sys_created_on', 'type', 'url', 'sys_created_by'], 50);
      for (const t of tx) {
        if (/^JOB: |\/sys\.scripts\.do|\/api\//.test(t.url ?? '')) clues.push(`${t.sys_created_on} ${t.type} ${(t.url ?? '').split('?')[0]?.slice(0, 80)} (${t.sys_created_by})`);
      }
    }
    unaudited = { count: mods - maxCheckpoint, lastUpdatedOn: updatedOn, lastUpdatedBy: rec.sys_updated_by ?? '', clues };
  }

  const gaps = Object.entries(access).filter(([, s]) => s === 'denied' || s === 'timeout' || s === 'no_filter').map(([k, s]) => `${k}: ${s}`);

  return {
    target: { ...target, sysId, display: rec.number || sysId },
    tables: meta.tables,
    changes,
    unaudited,
    suspects: {
      businessRules: meta.brField.map((b) => ({ name: b.name ?? '', sysId: b.sys_id ?? '', when: b.when ?? '', order: b.order ?? '', table: b.collection ?? '' })),
      viaScriptInclude: meta.brViaSi.map((x) => ({ businessRule: x.br.name ?? '', scriptInclude: x.si.name ?? '', scriptIncludeSysId: x.si.sys_id ?? '' })),
      scriptIncludes: meta.siField.map((s) => ({ name: s.name ?? '', sysId: s.sys_id ?? '' })),
    },
    access,
    gaps,
    timing: { totalMs: Date.now() - started, calls: client.calls - callsBefore },
  };

  // ---------- metadados da tabela ----------
  async function loadMeta(table: string, field: string): Promise<TableMeta> {
    const cached = await cache.get(table);
    const base = cached ?? (await loadMetaBase(table));
    if (!cached) await cache.set(table, base);
    // O que depende do campo é recalculado a partir do cache (barato, sem rede).
    const brField = base.businessRules.filter((b) => refsField(b.script, field) || refsField(b.template, field));
    const siField = base.scriptIncludes.filter((s) => refsField(s.script, field));
    const brViaSi: TableMeta['brViaSi'] = [];
    for (const br of base.businessRules) for (const si of siField) if ((br.script ?? '').includes(si.name ?? '\u0000')) brViaSi.push({ br, si });
    return { ...base, brField, siField, brViaSi };
  }

  async function loadMetaBase(table: string): Promise<TableMeta> {
    const tables: string[] = [];
    let cur: string | undefined = table;
    for (let i = 0; cur && i < 10; i++) {
      tables.push(cur);
      const o: Row | undefined = (await q('sys_db_object', `name=${cur}`, ['super_class.name'], 1))[0];
      cur = o?.['super_class.name'] || undefined;
    }
    const businessRules = await q('sys_script', `collectionIN${tables.join(',')}^active=true`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition'], 500);
    // Script includes citados pelas BRs (por nome; buscar por conteúdo traz centenas de scripts nativos).
    const siNames = new Set<string>();
    for (const b of businessRules) (b.script ?? '').replace(/new\s+(?:global\.)?([A-Z][A-Za-z0-9_]+)\s*\(/g, (_m, n: string) => { siNames.add(n); return _m; });
    const scriptIncludes = siNames.size ? await q('sys_script_include', `active=true^nameIN${[...siNames].join(',')}`, ['sys_id', 'name', 'script'], 200) : [];
    return { tables, businessRules, scriptIncludes, brField: [], siField: [], brViaSi: [] };
  }
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function between(t: string | undefined, from: string, to: string): boolean {
  return !!t && t >= from && t <= to;
}

function inWindow(t: Row, c: Row, opts: InvestigationOptions): boolean {
  const at = c.sys_created_on ?? '';
  return between(t.sys_created_on, shift(at, -opts.windowBefore), shift(at, opts.windowAfter));
}
