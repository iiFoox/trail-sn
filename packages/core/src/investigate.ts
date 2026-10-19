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
  type TraceItem,
} from './types';
import { conditionFields, mergeWindows, refsField, shift, toMs, withTimeout } from './util';

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

  // Consultas só para rótulos: falha aqui não é lacuna de perícia, então não entra no relatório de acesso.
  const quiet = async (table: string, query: string, fields: string[], limit = 100): Promise<Row[]> =>
    (await withTimeout(client.query({ table, query, fields, limit }), opts.sourceTimeoutMs, { rows: [], status: 0, access: 'timeout' as AccessState })).rows;

  // ---------- rodada 1: registro, auditoria e metadados ----------
  const recQuery = target.sysId ? `sys_id=${target.sysId}` : `number=${target.number ?? ''}`;
  const [recRows, metaOrNull, dict] = await Promise.all([
    q(target.table, recQuery, ['sys_id', 'number', 'short_description', 'sys_mod_count', 'sys_updated_on', 'sys_updated_by'], 1, 'record'),
    loadMeta(target.table, target.field),
    quiet('sys_dictionary', `element=${target.field}^nameIN${target.table},task,cmdb_ci`, ['name', 'internal_type', 'reference'], 5),
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
  // Um update() numa BR after regrava na auditoria as mudanças que ainda estão em "previous": a mesma
  // mudança aparece de novo no checkpoint seguinte, segundos depois. Essa cópia não é uma mudança nova.
  const ownAudit = audit.filter((a) => a.fieldname === target.field);
  const fieldChanges = ownAudit.filter((a, i) => !ownAudit.slice(0, i).some((p) =>
    p.oldvalue === a.oldvalue && p.newvalue === a.newvalue && Number(p.record_checkpoint) < Number(a.record_checkpoint)
    && Math.abs(toMs(a.sys_created_on ?? '') - toMs(p.sys_created_on ?? '')) <= 2000)).slice(-opts.maxChanges).reverse();

  // ---------- rodada 2: rastros por mudança (janelas fundidas) ----------
  const windows = fieldChanges.map((c) => ({ from: shift(c.sys_created_on ?? '', -opts.windowBefore), to: shift(c.sys_created_on ?? '', opts.windowAfter) }));
  const merged = mergeWindows(windows);
  const values = unique(fieldChanges.flatMap((c) => [c.oldvalue ?? '', c.newvalue ?? '']).filter(Boolean));
  const refTable = dict.find((d) => d.internal_type === 'reference' && d.reference)?.reference;
  const [txAll, evAll, flowsAll, wfAll, labelRows] = await Promise.all([
    Promise.all(merged.map((w) => q('syslog_transaction', `sys_created_on>=${w.from}^sys_created_on<=${w.to}^ORDERBYsys_created_on`, ['sys_id', 'sys_created_on', 'type', 'url', 'sys_created_by'], 200))).then((r) => r.flat()),
    Promise.all(merged.map((w) => q('sysevent', `instance=${sysId}^processed>=${shift(w.from, -1)}^processed<=${shift(w.to, 1)}`, ['sys_id', 'name', 'processed', 'sys_created_on'], 50))).then((r) => r.flat()),
    fieldChanges.length ? q('sys_flow_context', `source_record=${sysId}`, ['sys_id', 'name', 'state', 'sys_created_on', 'sys_updated_on'], 50) : Promise.resolve([]),
    fieldChanges.length ? q('wf_context', `id=${sysId}`, ['sys_id', 'workflow_version.name', 'state', 'started', 'ended'], 50) : Promise.resolve([]),
    !values.length ? Promise.resolve([])
      : refTable ? quiet(refTable, `sys_idIN${values.filter((v) => /^[0-9a-f]{32}$/.test(v)).join(',')}`, ['sys_id', 'name', 'number', 'user_name'], 50)
        .then((rows) => rows.map((r) => ({ value: r.sys_id ?? '', label: r.name || r.number || r.user_name || '' })))
      : quiet('sys_choice', `nameIN${meta.tables.join(',')}^element=${target.field}^inactive=false`, ['name', 'value', 'label', 'language'], 300)
        // A tabela mais específica ganha (incident.state 2 = In Progress; task.state 2 = Work in Progress); depois o inglês.
        .then((rows) => rows.sort((a, b) => (meta.tables.indexOf(a.name ?? '') - meta.tables.indexOf(b.name ?? '')) || ((a.language === 'en' ? -1 : 0) - (b.language === 'en' ? -1 : 0)))),
  ]);
  const labels: Record<string, string> = {};
  for (const r of labelRows) if (r.value && r.label && !(r.value in labels)) labels[r.value] = r.label;

  // ---------- rodada 3: artefatos citados pelos rastros ----------
  const jobNames = unique(txAll.filter((t) => /^JOB: /.test(t.url ?? '') && !/^JOB: ASYNC: /.test(t.url ?? '')).map((t) => (t.url ?? '').slice(5).trim()));
  const eventNames = unique(evAll.map((e) => e.name ?? '').filter(Boolean));
  const uiActionIds = unique(txAll.map((t) => (t.url ?? '').match(/sys_action=([0-9a-f]{32})/)?.[1] ?? '').filter(Boolean));
  const needsJobScan = fieldChanges.some((c) => !txAll.some((t) => t.sys_created_by === c.user && !/^JOB: /.test(t.url ?? '') && inWindow(t, c, opts)));

  const isAssignmentField = target.field === 'assignment_group' || target.field === 'assigned_to';
  const [jobsByName, scriptActions, uiActions, jobsByScript, assignmentRules, lookupSets, clientRows, uiActionSuspects] = await Promise.all([
    jobNames.length ? q('sysauto_script', `nameIN${jobNames.join(',')}`, ['sys_id', 'name', 'script'], 50) : Promise.resolve([]),
    eventNames.length ? q('sysevent_script_action', `active=true^event_nameIN${eventNames.join(',')}`, ['sys_id', 'name', 'event_name', 'script'], 50) : Promise.resolve([]),
    uiActionIds.length ? q('sys_ui_action', `sys_idIN${uiActionIds.join(',')}`, ['sys_id', 'name', 'script', 'table'], 20) : Promise.resolve([]),
    needsJobScan ? q('sysauto_script', `scriptLIKE${target.field}^scriptLIKE${target.table}`, ['sys_id', 'name', 'script', 'run_type', 'run_start', 'run_time', 'run_as.user_name', 'active'], 50) : Promise.resolve([]),
    isAssignmentField ? q('sysrule_assignment', `active=true^tableIN${meta.tables.join(',')}`, ['sys_id', 'name', 'table', 'condition', 'group', 'user', 'order'], 50) : Promise.resolve([]),
    quiet('dl_definition_rel_set', `source_table_field=${target.field}^dl_definition.active=true^dl_definition.source_tableIN${meta.tables.join(',')}`, ['dl_definition', 'dl_definition.name', 'dl_definition.run_on_form_change', 'dl_definition.run_on_update', 'dl_definition.matcher_table', 'matcher_table_field'], 20),
    quiet('sys_script_client', `tableIN${meta.tables.join(',')}^active=true^scriptLIKE${target.field}`, ['sys_id', 'name', 'type', 'field', 'table', 'script'], 30),
    // Só para a lista de "outras regras": UI actions da hierarquia que citam o campo.
    quiet('sys_ui_action', `tableIN${meta.tables.join(',')}^active=true^scriptLIKE${target.field}`, ['sys_id', 'name', 'table', 'script'], 30),
  ]);

  // ---------- rodada 4 (só quando precisa): entradas dos data lookups e valores atuais para avaliar condições ----------
  const lookupIds = unique(lookupSets.map((r) => r.dl_definition ?? '').filter(Boolean));
  const condFields = unique([
    ...meta.brField.flatMap((b) => conditionFields(b.filter_condition)),
    ...meta.brViaSi.flatMap((x) => conditionFields(x.br.filter_condition)),
    ...assignmentRules.flatMap((r) => conditionFields(r.condition)),
  ]).filter((f) => f !== target.field && !f.includes('.'));
  // Linhas da tabela do lookup que produzem os valores gravados (para saber se o lookup PODE ter dado aquele valor).
  const newValues = unique(fieldChanges.map((c) => c.newvalue ?? '').filter(Boolean));
  const [lookupMatches, recCond, ...matcherRows] = await Promise.all([
    lookupIds.length ? quiet('dl_definition_rel_match', `dl_definitionIN${lookupIds.join(',')}`, ['dl_definition', 'source_table_field', 'matcher_table_field', 'exact_match'], 50) : Promise.resolve([]),
    // Com data lookup, o registro vem inteiro: os campos de entrada só são conhecidos depois desta rodada.
    condFields.length || lookupIds.length ? quiet(target.table, `sys_id=${sysId}`, lookupIds.length ? [] : condFields, 1) : Promise.resolve([]),
    ...lookupIds.map((id) => {
      const r = lookupSets.find((x) => x.dl_definition === id)!;
      const mt = r['dl_definition.matcher_table'];
      const col = r.matcher_table_field || target.field;
      return mt && newValues.length ? quiet(mt, `active=true^${col}IN${newValues.join(',')}`, [], 50) : Promise.resolve(null);
    }),
  ]);
  const dataLookups = lookupIds.map((id, i) => {
    const r = lookupSets.find((x) => x.dl_definition === id)!;
    const rows = matcherRows[i] ?? null;
    return {
      name: r['dl_definition.name'] || 'Data lookup', sysId: id,
      runOnForm: r['dl_definition.run_on_form_change'] === 'true', runOnUpdate: r['dl_definition.run_on_update'] === 'true',
      inputs: lookupMatches.filter((m) => m.dl_definition === id).map((m) => m.source_table_field ?? '').filter(Boolean),
      match: lookupMatches.filter((m) => m.dl_definition === id).map((m) => ({ source: m.source_table_field ?? '', matcher: m.matcher_table_field || m.source_table_field || '', exact: m.exact_match === 'true' })),
      setColumn: r.matcher_table_field || target.field,
      rows,
    };
  });
  const clientScripts = clientRows.filter((c) => new RegExp(`setValue\\(\\s*['"]${target.field}['"]`).test(c.script ?? ''));
  // Campo ausente na resposta (sem acesso ao campo, ou inexistente) fica de fora: condição vira "não avaliada", nunca falsa.
  const recFields = unique([...condFields, ...dataLookups.flatMap((d) => d.match.map((m) => m.source))]).filter((f) => f && f !== target.field);
  const record: Record<string, string> = recCond[0] ? Object.fromEntries(recFields.filter((f) => f in recCond[0]!).map((f) => [f, recCond[0]![f] ?? ''])) : {};

  // ---------- assinaturas e pontuação ----------
  // Transações de job (síncronas com a escrita) são atribuídas à mudança mais próxima no tempo,
  // para que um job logo após a mudança N+1 não seja creditado também à mudança N.
  const isJobTx = (t: Row) => /^JOB: /.test(t.url ?? '');
  const nearestChange = new Map<string, number>();
  for (const t of txAll.filter(isJobTx)) {
    let best = -1;
    let bestDist = Infinity;
    fieldChanges.forEach((c, i) => {
      const d = Math.abs(toMs(t.sys_created_on ?? '') - toMs(c.sys_created_on ?? ''));
      if (d < bestDist || (d === bestDist && toMs(c.sys_created_on ?? '') <= toMs(t.sys_created_on ?? ''))) { best = i; bestDist = d; }
    });
    nearestChange.set(t.sys_id ?? `${t.sys_created_on}|${t.url}`, best);
  }
  const changes: Change[] = fieldChanges.map((c, index) => {
    const at = c.sys_created_on ?? '';
    const from = shift(at, -opts.windowBefore);
    const to = shift(at, opts.windowAfter);
    const traces: Traces = {
      transactions: txAll.filter((t) => between(t.sys_created_on, from, to) && (!isJobTx(t) || nearestChange.get(t.sys_id ?? `${t.sys_created_on}|${t.url}`) === index)),
      events: evAll.filter((e) => between(e.processed, shift(at, -1), shift(at, 1))),
      scriptActions,
      flows: flowsAll.filter((f) => (f.sys_created_on ?? '') <= shift(at, 2) && (f.sys_updated_on ?? '') >= shift(at, -2)),
      workflows: wfAll.filter((w) => (w.started ?? '') <= to && (!w.ended || w.ended >= from)),
      jobsByName,
      uiActions,
      jobsByScript,
      assignmentRules,
      clientScripts,
      dataLookups,
    };
    const ctx: ChangeContext = {
      table: target.table, field: target.field, sysId, audit: c, at, user: c.user ?? '',
      checkpoint: Number(c.record_checkpoint ?? 0), checkpoints, meta, traces, opts, record,
    };
    const notes: string[] = [];
    const ageSec = (Date.now() - toMs(at)) / 1000;
    for (const t of ['syslog_transaction', 'sysevent'] as const) {
      const keep = opts.retention?.[t];
      if (keep && ageSec > keep) notes.push(`traces_expired:${t}`);
    }
    const evidence = scoreAll(runSignatures(ctx));
    const trace = buildTrace(ctx, evidence[0]);
    return {
      at, oldValue: c.oldvalue ?? '', newValue: c.newvalue ?? '', user: c.user ?? '', checkpoint: ctx.checkpoint,
      evidence, notes, trace,
      ...((trace as { omitted?: number }).omitted ? { traceOmitted: (trace as { omitted?: number }).omitted } : {}),
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
    target: { ...target, sysId, display: rec.number || sysId, ...(rec.short_description ? { title: rec.short_description } : {}) },
    labels,
    tables: meta.tables,
    changes,
    unaudited,
    suspects: {
      businessRules: meta.brField.map((b) => ({ name: b.name ?? '', sysId: b.sys_id ?? '', when: b.when ?? '', order: b.order ?? '', table: b.collection ?? '' })),
      viaScriptInclude: meta.brViaSi.map((x) => ({ businessRule: x.br.name ?? '', scriptInclude: x.si.name ?? '', scriptIncludeSysId: x.si.sys_id ?? '' })),
      scriptIncludes: meta.siField.map((s) => ({ name: s.name ?? '', sysId: s.sys_id ?? '' })),
      clientScripts: clientScripts.map((c) => ({ name: c.name ?? '', sysId: c.sys_id ?? '', type: c.type ?? '', trigger: c.field ?? '', table: c.table ?? '' })),
      dataLookups: dataLookups.map((d) => ({ name: d.name, sysId: d.sysId })),
      assignmentRules: assignmentRules.map((r) => ({ name: r.name ?? '', sysId: r.sys_id ?? '', table: r.table ?? '' })),
      uiActions: uiActionSuspects.filter((u) => refsField(u.script, target.field)).map((u) => ({ name: u.name ?? '', sysId: u.sys_id ?? '', table: u.table ?? '' })),
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

/**
 * Monta a sequência do que aconteceu no registro perto da mudança. Transações de outras
 * telas ficam de fora; jobs, scripts de fundo e chamadas de API entram porque podem ter escrito no registro.
 */
function buildTrace(ctx: ChangeContext, top: Change['evidence'][number] | undefined): TraceItem[] {
  const items: TraceItem[] = [];
  const name = top?.artifact.name ?? '';
  for (const t of ctx.traces.transactions) {
    const url = t.url ?? '';
    const at = t.sys_created_on ?? '';
    const user = t.sys_created_by ?? '';
    const ref = t.sys_id ? { table: 'syslog_transaction', sysId: t.sys_id } : undefined;
    const base = { at, user, source: 'syslog_transaction', ...(ref ? { ref } : {}) };
    if (url.startsWith('JOB: ASYNC: ')) { const n = url.slice(12).trim(); items.push({ ...base, kind: 'async', label: n, cause: !!name && name === n }); continue; }
    if (url.startsWith('JOB: ')) { const n = url.slice(5).trim(); items.push({ ...base, kind: 'job', label: n, cause: !!name && name === n }); continue; }
    if (url.includes('/sys.scripts.do')) { items.push({ ...base, kind: 'background_script', label: 'Scripts - Background', cause: top?.type === 'background_script' }); continue; }
    if (!url.includes(ctx.sysId)) continue;
    const action = url.match(/sys_action=([0-9a-f]{32})/)?.[1];
    if (action) {
      const ua = ctx.traces.uiActions.find((u) => u.sys_id === action);
      items.push({ ...base, kind: 'ui_action', label: ua?.name ?? action, cause: top?.type === 'ui_action' && top.artifact.sysId === action });
      continue;
    }
    if (url.includes('/api/')) { items.push({ ...base, kind: 'api', label: url.split('?')[0]?.slice(0, 80) ?? url }); continue; }
    // Só envios de formulário contam; o recarregamento da página depois de salvar (GET ?sys_id=) não.
    if (!url.includes('sys_uniqueValue=')) continue;
    const sent = new URLSearchParams(url.split('?')[1] ?? '').get(`${ctx.table}.${ctx.field}`);
    const formCause = !!top && ['user_action', 'br_before', 'server_change', 'assignment_rule', 'data_lookup', 'client_script'].includes(top.type);
    items.push({ ...base, kind: 'form', label: url.split('?')[0] ?? url, ...(sent !== null ? { sent } : {}), cause: formCause && sent !== null });
  }
  const sref = (table: string, sysId?: string) => (sysId ? { ref: { table, sysId } } : {});
  // Eventos de infraestrutura (indexação, motor de notificação) não explicam mudança de campo: ficam fora, e repetidos no mesmo segundo viram um só.
  const seenEv = new Set<string>();
  const events = ctx.traces.events.filter((e) => {
    const key = `${e.name}|${(e.processed ?? '').slice(0, 19)}`;
    if (/^(text_index|notification_engine\.|glide\.)/.test(e.name ?? '') || seenEv.has(key)) return false;
    seenEv.add(key); return true;
  });
  for (const e of events) items.push({ at: e.processed ?? e.sys_created_on ?? '', kind: 'event', label: e.name ?? '', source: 'sysevent', cause: top?.type === 'script_action', ...sref('sysevent', e.sys_id) });
  for (const f of ctx.traces.flows) items.push({ at: f.sys_created_on ?? '', kind: 'flow', label: f.name ?? '', source: 'sys_flow_context', cause: top?.type === 'flow' && name === f.name, ...sref('sys_flow_context', f.sys_id) });
  for (const w of ctx.traces.workflows) items.push({ at: w.started ?? '', kind: 'workflow', label: w['workflow_version.name'] ?? '', source: 'wf_context', cause: top?.type === 'workflow', ...sref('wf_context', w.sys_id) });

  // Registro inteiro: as outras gravações auditadas do registro na mesma janela, agrupadas por checkpoint.
  const from = shift(ctx.at, -ctx.opts.windowBefore);
  const to = shift(ctx.at, ctx.opts.windowAfter);
  const auditRef = (cp: number) => ({ table: 'sys_audit', query: `documentkey=${ctx.sysId}^record_checkpoint=${cp}` });
  const writes = (rows: Row[]) => rows.filter((r) => r.fieldname !== ctx.field).map((r) => ({ field: r.fieldname ?? '', oldValue: r.oldvalue ?? '', newValue: r.newvalue ?? '' }));
  for (const [cpKey, rows] of Object.entries(ctx.checkpoints)) {
    const cp = Number(cpKey);
    if (cp === ctx.checkpoint) continue;
    const at = rows[0]?.sys_created_on ?? '';
    if (!between(at, from, to)) continue;
    const fields = writes(rows);
    if (fields.length) items.push({ at, kind: 'write', label: '', user: rows[0]?.user ?? '', source: 'sys_audit', fields, checkpoint: cp, ref: auditRef(cp) });
  }
  const same = writes(ctx.checkpoints[String(ctx.checkpoint)] ?? []);
  items.push({ at: ctx.at, kind: 'change', label: '', user: ctx.user, source: 'sys_audit', ref: auditRef(ctx.checkpoint), ...(same.length ? { fields: same } : {}) });
  // O syslog_transaction registra a transação quando ela TERMINA; um job que gravou às 01:37:01 aparece às 01:37:02.
  // A causa que terminou até 3 s depois da mudança é posta antes dela, mantendo o horário real.
  const sortAt = (t: TraceItem) => (t.cause && t.source === 'syslog_transaction' && t.at > ctx.at && toMs(t.at) - toMs(ctx.at) <= 3000 ? ctx.at : t.at);
  const rank = (t: TraceItem) => (t.kind === 'change' || t.kind === 'write' ? 1 : 0) - (t.cause ? 0.5 : 0);
  const sorted = items.sort((a, b) => { const x = sortAt(a), y = sortAt(b); return x < y ? -1 : x > y ? 1 : rank(a) - rank(b); });
  // Registro muito movimentado: fica com os passos mais próximos da mudança, sempre incluindo causa e a própria mudança.
  if (sorted.length <= TRACE_MAX) return sorted;
  const dist = (t: TraceItem) => (t.kind === 'change' || t.cause ? -1 : Math.abs(toMs(t.at) - toMs(ctx.at)));
  const keep = new Set([...sorted].sort((a, b) => dist(a) - dist(b)).slice(0, TRACE_MAX));
  const kept = sorted.filter((t) => keep.has(t));
  (kept as TraceItem[] & { omitted?: number }).omitted = sorted.length - kept.length;
  return kept;
}

const TRACE_MAX = 14;

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
