import { findConflicts } from './conflicts';
import { detectPingPong } from './pingpong';
import { documentation, fieldLabels, resolveDisplay } from './display';
import type { QueryRequest, RestClient } from './client/RestClient';
import { historyToAudit } from './history';
import { scoreAll } from './scoring';
import { fieldsRead, writesOf } from './scriptEval';
import { siCallsWithField } from './util';
import { runSignatures, type ChangeContext, type TableMeta, type Traces } from './signatures';
import {
  DEFAULT_OPTIONS,
  RecordNotFoundError,
  RecordUnavailableError,
  recordUnanswered,
  type AccessState,
  type Change,
  type Investigation,
  type InvestigationOptions,
  type Row,
  type Target,
  type TraceItem,
} from './types';
import { isSaveButton } from './signatures/uiAction';
import { formSubmitOf } from './signatures/sameTransaction';
import { decodeFlowValues, formSent, linkFields, otherRecordWrite, isBatchCall, isFormSubmitFor, isMultiUpdate, isRecordWrite, isWorkspaceAction, parseFieldValues, uiActionMatches, uiActionQuery, uiActionRef } from './util';
import { conditionFields, inList, mergeWindows, refsField, shift, timedQuery, toMs, windowsFilter, withTimeout } from './util';

/** Cache de metadados por tabela (hierarquia, BRs, script includes). A extensão guarda em chrome.storage.session. */
export interface MetaCache {
  get(table: string): Promise<TableMeta | undefined>;
  set(table: string, meta: TableMeta): Promise<void>;
}

export const noCache: MetaCache = { get: async () => undefined, set: async () => {} };
/** Quanto antes do processamento um evento pode ter sido criado (agendado) e ainda entrar na busca. */
const EVENT_LOOKBACK_S = 86400;
/**
 * Quanto antes da mudança a abertura da lista pela pessoa ainda conta como pista de edição na célula. Cada minuto a mais
 * é mais syslog_transaction lido (a tabela que mais cresce numa instância); quem edita pela lista costuma abrir,
 * filtrar e editar em poucos minutos.
 */
const LIST_LOOKBACK_S = 600;

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
  // Tabela, campo e registro entram nas consultas: fora do padrão, nada sai (a extensão já confere; aqui é a segunda trava).
  const badTarget = !/^[a-z0-9_]+$/.test(target.table) || !/^[a-z0-9_]+$/.test(target.field)
    || (target.sysId ? !/^[0-9a-f]{32}$/.test(target.sysId) : !/^[A-Za-z0-9_.-]+$/.test(target.number ?? ''));
  if (badTarget) throw new RecordNotFoundError(target);
  const started = Date.now();
  const callsBefore = client.calls;
  const access: Record<string, AccessState> = {};

  const q = async (table: string, query: string, fields: string[], limit = 100, tag = table): Promise<Row[]> => {
    const req: QueryRequest = { table, query, fields, limit };
    const r = await timedQuery(client, req, opts.sourceTimeoutMs);
    const prev = access[tag];
    if (!prev || prev === 'empty' || prev === 'unknown' || (prev === 'timeout' && r.access !== 'timeout')) access[tag] = r.access;
    // Falha por consulta: a janela que respondeu não apaga a que não respondeu (no PDI, syslog_transaction de uma janela
    // estourou, a outra respondeu, e a fonte saía "ok" com a prova rebaixada). A mesma consulta repetida com sucesso sai.
    const key = `${table}|${query}|${fields.join(',')}|${limit}`;
    if (r.access === 'timeout' || r.access === 'unknown') failed.set(key, tag); else failed.delete(key);
    return r.rows;
  };
  const failed = new Map<string, string>();

  // Consultas só para rótulos: falha aqui não é lacuna de perícia, então não entra no relatório de acesso.
  const quiet = async (table: string, query: string, fields: string[], limit = 100): Promise<Row[]> =>
    (await timedQuery(client, { table, query, fields, limit }, opts.sourceTimeoutMs)).rows;

  /**
   * Linhas de staging que gravaram neste registro perto dos instantes dados. As tabelas de staging vêm dos transform maps
   * que gravam nesta tabela (sys_transform_map, tabela pequena), e em cada uma só o minuto em volta de cada mudança.
   * Não usa o cabeçalho sys_import_set: a API de importação reaproveita o mesmo import set o dia inteiro.
   */
  const importRowsNear = async (tables: string[], instants: string[]): Promise<Row[]> => {
    const maps = await quiet('sys_transform_map', `target_tableIN${tables.join(',')}`, ['sys_id', 'source_table'], 50);
    const sources = unique(maps.map((m) => m.source_table ?? '').filter((t) => /^[a-z0-9_]+$/.test(t))).slice(0, 10);
    const near = windowsFilter('sys_updated_on', instants, 60, 60, `sys_target_sys_id=${sysId}`);
    if (!near) return [];
    const rows = await Promise.all(sources.map(async (table) => (await quiet(table,
      `${near}^ORDERBYDESCsys_updated_on`,
      ['sys_id', 'sys_import_set', 'sys_import_set.number', 'sys_transform_map', 'sys_transform_map.name', 'sys_import_state', 'sys_updated_on', 'sys_updated_by'], 30))
      .map((r): Row => ({ ...r, sys_class_name: table }))));
    return rows.flat().sort((a, b) => toMs(b.sys_updated_on ?? '') - toMs(a.sys_updated_on ?? ''));
  };

  // ---------- rodada 1: registro, auditoria e metadados ----------
  const recQuery = target.sysId ? `sys_id=${target.sysId}` : `number=${target.number ?? ''}`;
  const recReq: QueryRequest = { table: target.table, query: recQuery, fields: ['sys_id', 'number', 'name', 'short_description', 'sys_mod_count', 'sys_created_on', 'sys_updated_on', 'sys_updated_by'], limit: 1 };
  const recTimeout = { rows: [] as Row[], status: 0, access: 'timeout' as AccessState };
  const [recFirst, metaOrNull] = await Promise.all([
    timedQuery(client, recReq, opts.sourceTimeoutMs),
    loadMeta(target.table, target.field),
  ]);
  // Sem resposta útil (prazo estourado ou erro 5xx): tenta de novo uma vez, com mais folga, como nas regras de negócio.
  const recRes = !recFirst.rows[0] && recordUnanswered(recFirst.access)
    ? await timedQuery(client, recReq, opts.sourceTimeoutMs * 3)
    : recFirst;
  access.record = recRes.access;
  const rec = recRes.rows[0];
  if (!rec) {
    // Vazio por falta de resposta não é "não encontrado": o registro pode existir.
    if (recordUnanswered(recRes.access)) throw new RecordUnavailableError(target, recRes.access === 'timeout' ? 'timeout' : 'error', recRes.status);
    throw new RecordNotFoundError(target);
  }
  const sysId = rec.sys_id ?? '';
  const meta = metaOrNull;

  // Rótulo do campo junto com a auditoria: não acrescenta rodada.
  const [auditRows, dict, docs] = await Promise.all([
    q(
      'sys_audit',
      `tablename=${target.table}^documentkey=${sysId}^ORDERBYsys_created_on^ORDERBYrecord_checkpoint`,
      ['sys_id', 'fieldname', 'oldvalue', 'newvalue', 'user', 'sys_created_on', 'record_checkpoint'],
      1000,
    ),
    quiet('sys_dictionary', `element=${target.field}^nameIN${meta.tables.join(',')}`, ['name', 'internal_type', 'reference', 'column_label', 'element'], 30),
    documentation(quiet, meta.tables, [target.field], opts.language),
  ]);
  // Quem não é admin quase nunca lê sys_audit, mas vê o histórico no formulário: usa esse histórico.
  let audit = auditRows;
  let auditFrom: 'audit' | 'history' = 'audit';
  let historyFields: string[] | undefined;
  let historyUnavailable = false;
  // Auditoria que não respondeu (no PDI, o 500 ao acaso na conferência do ui/meta) também tenta o histórico: é a
  // mesma informação, e sem ele a tela ficava só com "auditoria lenta" (bloco C, 24/10/2026: 6 de 300 para itil).
  if ((access.sys_audit === 'denied' || access.sys_audit === 'timeout') && client.history) {
    // No PDI (21/10/2026) o histórico às vezes não volta (1 em ~300 investigações por perfil): uma segunda tentativa, e
    // se ainda falhar, a lacuna aparece em vez de "nenhuma mudança".
    const ask = () => client.history!(target.table, sysId).catch(() => null);
    const h = (await ask()) ?? (await ask());
    if (!h) historyUnavailable = true;
    if (h) {
      audit = await historyToAudit(h, meta.tables, quiet, rec.sys_created_on);
      auditFrom = 'history';
      historyFields = h.fields;
    }
  }
  const checkpoints: Record<string, Row[]> = {};
  for (const a of audit) (checkpoints[a.record_checkpoint ?? '0'] ??= []).push(a);
  const maxCheckpoint = Math.max(0, ...Object.keys(checkpoints).map(Number));
  // Um update() numa BR after regrava na auditoria as mudanças que ainda estão em "previous": a mesma
  // mudança aparece de novo no checkpoint seguinte, segundos depois. Essa cópia não é uma mudança nova.
  // Duas gravações do mesmo campo no mesmo segundo (a pessoa grava 2→4 e uma regra devolve 4→2): o horário empata e
  // quem desempata é o checkpoint. Sem isso a ordem vinha ao acaso e a mudança da regra podia aparecer como a da pessoa.
  const ownAudit = audit.filter((a) => a.fieldname === target.field)
    .sort((a, b) => toMs(a.sys_created_on ?? '') - toMs(b.sys_created_on ?? '') || Number(a.record_checkpoint ?? 0) - Number(b.record_checkpoint ?? 0));
  const fieldChanges = ownAudit.filter((a, i) => !ownAudit.slice(0, i).some((p) =>
    p.oldvalue === a.oldvalue && p.newvalue === a.newvalue && Number(p.record_checkpoint) < Number(a.record_checkpoint)
    && Math.abs(toMs(a.sys_created_on ?? '') - toMs(p.sys_created_on ?? '')) <= 2000)).slice(-opts.maxChanges).reverse();

  // Regras desativadas depois da mudança: quem investiga costuma desligar a regra suspeita antes de perguntar quem
  // mudou o campo, e a busca só de regras ativas a escondia. Entram as inativas alteradas depois da mudança mais antiga.
  const firstChange = fieldChanges.at(-1)?.sys_created_on;
  const inactiveP = firstChange
    ? quiet('sys_script', `collectionIN${meta.tables.join(',')}^active=false^sys_updated_on>=${firstChange}`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition', 'action_insert', 'action_update', 'sys_updated_on'], 20)
      .then((rows) => rows.filter((b) => refsField(b.script, target.field) || refsField(b.template, target.field)))
    : Promise.resolve([] as Row[]);
  // O mesmo para client scripts e UI policies (no PDI, um client script [PT] preencheu a descrição e foi desligado em
  // seguida: a mudança saía como da pessoa). Consultas à parte: uma recusa aqui não derruba a lista das ativas.
  const offSince = firstChange ? `^active=false^sys_updated_on>=${firstChange}` : '';
  const inactiveClientP = firstChange
    ? quiet('sys_script_client', `tableIN${meta.tables.join(',')}${offSince}^scriptLIKE${target.field}`, ['sys_id', 'name', 'type', 'field', 'table', 'script', 'ui_type', 'active', 'sys_updated_on'], 20)
    : Promise.resolve([] as Row[]);
  const inactivePolicyP = firstChange
    ? quiet('sys_ui_policy', `tableIN${meta.tables.join(',')}${offSince}^run_scripts=true^script_trueLIKE${target.field}^ORscript_falseLIKE${target.field}`, ['sys_id', 'short_description', 'table', 'conditions', 'script_true', 'script_false', 'ui_type', 'reverse_if_false', 'active', 'sys_updated_on'], 20)
    : Promise.resolve([] as Row[]);

  // ---------- rodada 2: rastros por mudança (janelas fundidas) ----------
  const windows = fieldChanges.map((c) => ({ from: shift(c.sys_created_on ?? '', -opts.windowBefore), to: shift(c.sys_created_on ?? '', opts.windowAfter) }));
  const merged = mergeWindows(windows);
  const values = unique(fieldChanges.flatMap((c) => [c.oldvalue ?? '', c.newvalue ?? '']).filter(Boolean));
  const refTable = dict.find((d) => d.internal_type === 'reference' && d.reference)?.reference;
  // Rótulo do campo como aparece no formulário (business_service → Service): a tabela mais específica ganha.
  const fieldLabel = fieldLabels(docs, dict, meta.tables, opts.language)[target.field];
  /** Alguma mudança sem gravação da própria pessoa, fora de rotina, na janela: aí vale procurar rotinas e importações. */
  // A transação só explica a mudança se vier antes da gravação seguinte do registro: no PDI (F13-IMP3), a importação
  // gravou às 20:00:40 e um PATCH do mesmo admin às 20:00:45 caía na janela e escondia a importação.
  const writeTimes = unique(audit.map((a) => a.sys_created_on ?? '')).map(toMs).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const beforeNextWrite = (t: Row, c: Row) => toMs(t.sys_created_on ?? '') < (writeTimes.find((w) => w > toMs(c.sys_created_on ?? '')) ?? Infinity);
  const unexplained = (tx: Row[]) => fieldChanges.some((c) => !tx.some((t) => t.sys_created_by === c.user && !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, sysId) && inWindow(t, c, opts) && beforeNextWrite(t, c)));
  const changeUsers = unique(fieldChanges.map((c) => c.user ?? '').filter(Boolean));
  const txP = Promise.all(merged.map((w) => q('syslog_transaction', `sys_created_on>=${w.from}^sys_created_on<=${w.to}^ORDERBYsys_created_on`, ['sys_id', 'sys_created_on', 'type', 'url', 'sys_created_by'], 200))).then((r) => r.flat());
  const [txAll, evAll, flowsAll, wfAll, labelRows, importRows, userRows, recordedAll] = await Promise.all([
    txP,
    // Um dia de folga em sys_created_on (eventos agendados): numa instância grande, cada dia de sysevent são milhões de
    // linhas, e a consulta abandonada aqui continua no servidor, prendendo a sessão de quem usa o Trail.
    Promise.all(merged.map((w) => q('sysevent', `instance=${sysId}^sys_created_on>=${shift(w.from, -EVENT_LOOKBACK_S)}^sys_created_on<=${shift(w.to, 1)}^processed>=${shift(w.from, -1)}^processed<=${shift(w.to, 1)}`, ['sys_id', 'name', 'processed', 'sys_created_on'], 50))).then((r) => r.flat()),
    fieldChanges.length ? q('sys_flow_context', `source_record=${sysId}`, ['sys_id', 'name', 'state', 'flow', 'sys_created_on', 'sys_updated_on'], 50) : Promise.resolve([]),
    fieldChanges.length ? q('wf_context', `id=${sysId}`, ['sys_id', 'workflow_version.name', 'state', 'started', 'ended'], 50) : Promise.resolve([]),
    !values.length ? Promise.resolve([])
      : refTable ? (values.some((v) => /^[0-9a-f]{32}$/.test(v)) ? quiet(refTable, `sys_idIN${values.filter((v) => /^[0-9a-f]{32}$/.test(v)).join(',')}`, ['sys_id', 'name', 'number', 'user_name'], 50) : Promise.resolve([] as Row[]))
        .then((rows) => rows.map((r) => ({ value: r.sys_id ?? '', label: r.name || r.number || r.user_name || '' })))
      : quiet('sys_choice', `nameIN${meta.tables.join(',')}^element=${target.field}^inactive=false`, ['name', 'value', 'label', 'language'], 300)
        // A tabela mais específica ganha (incident.state 2 = In Progress; task.state 2 = Work in Progress); depois o inglês.
        .then((rows) => rows.sort((a, b) => (meta.tables.indexOf(a.name ?? '') - meta.tables.indexOf(b.name ?? '')) || ((a.language === 'en' ? -1 : 0) - (b.language === 'en' ? -1 : 0)))),
    // Importação: linhas de import set que gravaram neste registro. Nunca pela tabela base sys_import_set_row: ela junta
    // todas as tabelas de staging da instância (milhões de linhas em produção) e sys_target_sys_id não tem índice.
    // Só quando alguma mudança não tem gravação de pessoa que a explique (como as rotinas, abaixo): as tabelas de
    // staging costumam ser enormes e sem índice nos campos do filtro.
    fieldChanges.length ? txP.then((tx) => (unexplained(tx) ? importRowsNear(meta.tables, fieldChanges.map((c) => c.sys_created_on ?? '')) : [])) : Promise.resolve([]),
    // Quem gravou: usuário só de API ou de integração interna é uma integração, não uma pessoa.
    inList(changeUsers) ? quiet('sys_user', `user_nameIN${inList(changeUsers)}`, ['sys_id', 'user_name', 'name', 'web_service_access_only', 'internal_integration_user'], 20) : Promise.resolve([]),
    meta.recorder && fieldChanges.length ? quiet(meta.recorder, `u_registro=${sysId}^sys_created_on>=${shift(fieldChanges[fieldChanges.length - 1]?.sys_created_on ?? '', -5)}^ORDERBYsys_created_on`, ['sys_created_on', 'u_campos', 'u_servidor', 'u_usuario', 'u_transacao', 'u_origem'], 200) : Promise.resolve([] as Row[]),
  ]);
  const labels: Record<string, string> = {};
  for (const r of labelRows) if (r.value && r.label && !(r.value in labels)) labels[r.value] = r.label;

  // ---------- rodada 3: artefatos citados pelos rastros ----------
  const jobNames = unique(txAll.filter((t) => /^JOB: /.test(t.url ?? '') && !/^JOB: ASYNC: /.test(t.url ?? '')).map((t) => (t.url ?? '').slice(5).trim()));
  const eventNames = unique(evAll.map((e) => e.name ?? '').filter(Boolean));
  const uiActionIds = unique(txAll.filter((t) => (t.url ?? '').includes(sysId)).map((t) => uiActionRef(t.url) ?? '').filter(Boolean));
  // Só transações DESTE registro contam: o mesmo usuário mexendo em outras telas na hora não explica a mudança.
  const needsJobScan = unexplained(txAll);

  const isAssignmentField = target.field === 'assignment_group' || target.field === 'assigned_to';
  const flowIds = unique(flowsAll.map((f) => f.flow ?? '').filter(Boolean));
  const mapIds = unique(importRows.map((r) => r.sys_transform_map ?? '').filter(Boolean));
  const listWindows = inList(changeUsers) ? windowsFilter('sys_created_on', fieldChanges.map((c) => c.sys_created_on ?? ''), LIST_LOOKBACK_S, 5, `type=list^sys_created_byIN${inList(changeUsers)}`) : '';
  const [jobsByName, scriptActions, uiActions, jobsByScript, assignmentRules, lookupSets, clientRows, uiActionSuspects, flowActionRows, transformEntries, transformScripts, policyRows, listViews] = await Promise.all([
    inList(jobNames) ? q('sysauto_script', `nameIN${inList(jobNames)}`, ['sys_id', 'name', 'script'], 50) : Promise.resolve([]),
    inList(eventNames) ? q('sysevent_script_action', `active=true^event_nameIN${inList(eventNames)}`, ['sys_id', 'name', 'event_name', 'script'], 50) : Promise.resolve([]),
    uiActionQuery(uiActionIds, meta.tables) ? q('sys_ui_action', uiActionQuery(uiActionIds, meta.tables), ['sys_id', 'name', 'script', 'table', 'action_name'], 20) : Promise.resolve([]),
    needsJobScan ? q('sysauto_script', `scriptLIKE${target.field}^scriptLIKE${target.table}`, ['sys_id', 'name', 'script', 'run_type', 'run_start', 'run_time', 'run_as.user_name', 'active'], 50) : Promise.resolve([]),
    isAssignmentField ? q('sysrule_assignment', `active=true^tableIN${meta.tables.join(',')}`, ['sys_id', 'name', 'table', 'condition', 'group', 'user', 'order'], 50) : Promise.resolve([]),
    quiet('dl_definition_rel_set', `source_table_field=${target.field}^dl_definition.active=true^dl_definition.source_tableIN${meta.tables.join(',')}`, ['dl_definition', 'dl_definition.name', 'dl_definition.run_on_form_change', 'dl_definition.run_on_update', 'dl_definition.matcher_table', 'matcher_table_field'], 20),
    quiet('sys_script_client', `tableIN${meta.tables.join(',')}^active=true^scriptLIKE${target.field}`, ['sys_id', 'name', 'type', 'field', 'table', 'script', 'ui_type'], 30),
    // Só para a lista de "outras regras": UI actions da hierarquia que citam o campo.
    quiet('sys_ui_action', `tableIN${meta.tables.join(',')}^active=true^scriptLIKE${target.field}`, ['sys_id', 'name', 'table', 'script'], 30),
    // Passos dos flows que rodaram no registro: dizem qual ação grava o campo.
    flowIds.length ? (async () => {
      const fields = ['flow', 'order', 'comment', 'values', 'action_type.name'];
      const rows = await quiet('sys_hub_action_instance_v2', `flowIN${flowIds.join(',')}^ORDERBYorder`, fields, 100);
      // Subflows chamados pelo flow (até 2 níveis): os passos deles também gravam no registro.
      let parents = flowIds.map((id) => ({ id, root: id, prefix: '', via: '' }));
      for (let depth = 0; depth < 2 && parents.length; depth++) {
        const subs = await quiet('sys_hub_sub_flow_instance_v2', `flowIN${parents.map((x) => x.id).join(',')}^ORDERBYorder`, ['flow', 'order', 'subflow', 'subflow.name'], 50);
        const next = subs.filter((x) => x.subflow).map((x) => { const p = parents.find((y) => y.id === x.flow) ?? parents[0]!; return { id: x.subflow!, root: p.root, prefix: `${p.prefix}${x.order ?? ''}.`, via: x['subflow.name'] || 'subflow' }; });
        if (!next.length) break;
        const acts = await quiet('sys_hub_action_instance_v2', `flowIN${unique(next.map((x) => x.id)).join(',')}^ORDERBYorder`, fields, 100);
        for (const n of next) for (const a of acts.filter((x) => x.flow === n.id)) rows.push({ ...a, flow: n.root, order: n.prefix + (a.order ?? ''), subflow: n.via });
        parents = next;
      }
      return rows;
    })() : Promise.resolve([] as Row[]),
    mapIds.length ? quiet('sys_transform_entry', `mapIN${mapIds.join(',')}^target_field=${target.field}`, ['map', 'source_field', 'target_field', 'use_source_script', 'source_script'], 30) : Promise.resolve([]),
    // UI policies com "Run scripts" cujo script cita o campo (rodam no navegador, como client scripts).
    // Scripts do transform map (onBefore, onAfter...) e o script do próprio mapa que citam o campo.
    mapIds.length ? quiet('sys_transform_script', `mapIN${mapIds.join(',')}^active=true^scriptLIKE${target.field}`, ['map', 'when', 'script'], 30).then(async (rows) => [
      ...rows, ...(await quiet('sys_transform_map', `sys_idIN${mapIds.join(',')}^run_script=true^scriptLIKE${target.field}`, ['sys_id', 'script'], 10)).map((m): Row => ({ map: m.sys_id ?? '', when: 'map', script: m.script ?? '' }))]) : Promise.resolve([] as Row[]),
    quiet('sys_ui_policy', `tableIN${meta.tables.join(',')}^active=true^run_scripts=true^script_trueLIKE${target.field}^ORscript_falseLIKE${target.field}`, ['sys_id', 'short_description', 'table', 'conditions', 'script_true', 'script_false', 'ui_type', 'reverse_if_false'], 20),
    // Edição direto na lista (célula) não registra transação: a última abertura da lista da tabela pela pessoa é a pista.
    // Dez minutos antes de cada mudança, em janelas separadas: um intervalo único da primeira à última mudança podia
    // cobrir meses de syslog_transaction.
    needsJobScan && listWindows ? quiet('syslog_transaction', `${listWindows}^ORDERBYDESCsys_created_on`, ['sys_created_on', 'sys_created_by', 'url', 'type'], 50)
      .then((rows) => rows.filter((t) => meta.tables.some((tb) => (t.url ?? '').includes(`${tb}_list.do`)))) : Promise.resolve([] as Row[]),
  ]);

  // ---------- rodada 4 (só quando precisa): entradas dos data lookups e valores atuais para avaliar condições ----------
  const lookupIds = unique(lookupSets.map((r) => r.dl_definition ?? '').filter(Boolean));
  const condFields = unique([
    ...meta.brField.flatMap((b) => conditionFields(b.filter_condition)),
    ...meta.brViaSi.flatMap((x) => conditionFields(x.br.filter_condition)),
    ...assignmentRules.flatMap((r) => conditionFields(r.condition)),
    // Campos que os scripts candidatos leem (if, condição em script, valor calculado): avaliados com o valor da gravação.
    ...meta.brField.flatMap((b) => [...fieldsRead(b.script), ...fieldsRead(b.condition)]),
    ...meta.brViaSi.flatMap((x) => fieldsRead(x.br.condition)),
    ...clientRows.flatMap((c) => fieldsRead(c.script)),
    ...policyRows.flatMap((p) => [...conditionFields(p.conditions), ...fieldsRead(p.script_true), ...fieldsRead(p.script_false)]),
  ]).filter((f) => f !== target.field && !f.includes('.')).slice(0, 40);
  // Linhas da tabela do lookup que produzem os valores gravados (para saber se o lookup PODE ter dado aquele valor).
  const newValues = unique(fieldChanges.map((c) => c.newvalue ?? '').filter(Boolean));
  // Valores que chegaram na linha de staging (o que a importação mandou para o campo).
  const stageQueries = unique(importRows.map((r) => r.sys_class_name ?? '').filter((c) => c && c !== 'sys_import_set_row')).map((cls) => {
    const fields = unique(transformEntries.map((e) => e.source_field ?? '').filter(Boolean));
    const ids = importRows.filter((r) => r.sys_class_name === cls).map((r) => r.sys_id ?? '');
    return fields.length ? quiet(cls, `sys_idIN${ids.join(',')}`, ['sys_id', ...fields], 30) : Promise.resolve([] as Row[]);
  });
  const stageRowsP = Promise.all(stageQueries).then((r) => r.flat());
  const [lookupMatches, recCond, ...matcherRows] = await Promise.all([
    lookupIds.length ? quiet('dl_definition_rel_match', `dl_definitionIN${lookupIds.join(',')}`, ['dl_definition', 'source_table_field', 'matcher_table_field', 'exact_match'], 50) : Promise.resolve([]),
    // Com data lookup, o registro vem inteiro: os campos de entrada só são conhecidos depois desta rodada.
    condFields.length || lookupIds.length ? quiet(target.table, `sys_id=${sysId}`, lookupIds.length ? [] : condFields, 1) : Promise.resolve([]),
    ...lookupIds.map((id) => {
      const r = lookupSets.find((x) => x.dl_definition === id)!;
      const mt = r['dl_definition.matcher_table'];
      const col = r.matcher_table_field || target.field;
      return mt && inList(newValues) && /^[a-z0-9_]+$/.test(col) ? quiet(mt, `active=true^${col}IN${inList(newValues)}`, [], 50) : Promise.resolve(null);
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
  const flowSteps = await Promise.all(flowActionRows.map(async (a) => {
    const params = (await decodeFlowValues(a.values)) ?? [];
    const pick = (n: string) => params.find((p) => p.name === n)?.value ?? '';
    return { flow: a.flow ?? '', order: a.order ?? '', action: a['action_type.name'] || a.comment || 'Ação', table: pick('table_name'), writes: parseFieldValues(pick('values') || pick('fields')), ...(a.subflow ? { subflow: a.subflow } : {}) };
  }));
  const [inactiveClient, inactivePolicy] = await Promise.all([inactiveClientP, inactivePolicyP]);
  clientRows.push(...inactiveClient);
  policyRows.push(...inactivePolicy);
  const clientScripts = clientRows.filter((c) => new RegExp(`setValue\\(\\s*['"]${target.field}['"]`).test(c.script ?? ''));
  const setsField = (sc: string | undefined) => new RegExp(`setValue\\(\\s*['"]${target.field}['"]`).test(sc ?? '');
  const uiPolicies: Row[] = policyRows.flatMap((p) => [
    ...(setsField(p.script_true) ? [{ ...p, name: p.short_description ?? '', script: p.script_true ?? '', branch: 'true' }] : []),
    ...(setsField(p.script_false) && p.reverse_if_false !== 'false' ? [{ ...p, name: p.short_description ?? '', script: p.script_false ?? '', branch: 'false' }] : []),
  ]);
  // Campo ausente na resposta (sem acesso ao campo, ou inexistente) fica de fora: condição vira "não avaliada", nunca falsa.
  const recFields = unique([...condFields, ...dataLookups.flatMap((d) => d.match.map((m) => m.source))]).filter((f) => f && f !== target.field);
  const record: Record<string, string> = recCond[0] ? Object.fromEntries(recFields.filter((f) => f in recCond[0]!).map((f) => [f, recCond[0]![f] ?? ''])) : {};

  const stageRows = await stageRowsP;

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
  // Valores do registro como estavam naquela gravação: o valor atual, voltado para trás pela auditoria
  // (a primeira mudança posterior de cada campo guarda, no oldvalue, o valor que valia na hora).
  const recordAt = (cp: number): Record<string, string> => {
    const out = { ...record };
    for (const f of Object.keys(out)) {
      const later = audit.find((a) => a.fieldname === f && Number(a.record_checkpoint ?? 0) > cp);
      if (later) out[f] = later.oldvalue ?? '';
    }
    return out;
  };
  // Outro registro de outra tabela salvo no instante (problema que resolve os incidentes): as regras dele que abrem esta
  // tabela por GlideRecord e citam o campo. Só quando há essa gravação; as da própria hierarquia já estão nos metadados.
  const otherTables = unique(txAll.map((t) => otherRecordWrite(t.url, sysId)?.table ?? '').filter((t) => t && !meta.tables.includes(t))).slice(0, 5);
  const crossRules = otherTables.length
    // Ativas, e as desligadas depois da mudança mais antiga (no PDI, a regra do problema foi desligada logo após o teste).
    ? (await quiet('sys_script', [`active=true`, ...(firstChange ? [`active=false^sys_updated_on>=${firstChange}`] : [])].map((a) => `collectionIN${otherTables.join(',')}^${a}^scriptLIKEGlideRecord^scriptLIKE${target.field}`).join('^NQ'), ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'condition', 'filter_condition', 'action_insert', 'action_update', 'active', 'sys_updated_on'], 50))
      .filter((b) => refsField(b.script, target.field))
    : [];
  // Campo de vínculo das regras que gravam outros registros (parent_incident, problem_id...): lido deste registro só
  // quando outro registro foi salvo na janela, para saber se este é mesmo "filho" do salvo.
  if (txAll.some((t) => otherRecordWrite(t.url, sysId))) {
    const need = unique([...meta.businessRules, ...crossRules].flatMap((b) => linkFields(b.script))).filter((f) => !(f in record)).slice(0, 10);
    const row = need.length ? (await quiet(target.table, `sys_id=${sysId}`, need, 1))[0] : undefined;
    if (row) for (const f of need) if (f in row) record[f] = row[f] ?? '';
  }
  const inactive = await inactiveP;
  // Só para mudanças anteriores à alteração da regra: depois dela, a regra já podia estar desligada.
  const metaAt = (at: string): TableMeta => {
    const off = inactive.filter((b) => (b.sys_updated_on ?? '') > at);
    return off.length ? { ...meta, brField: [...meta.brField, ...off] } : meta;
  };
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
      listViews: listViews.filter((t) => t.sys_created_by === c.user && (t.sys_created_on ?? '') <= shift(at, 2) && (t.sys_created_on ?? '') >= shift(at, -LIST_LOOKBACK_S)),
      assignmentRules,
      // Desligado hoje só conta para mudanças anteriores à alteração dele.
      clientScripts: clientScripts.filter((x) => x.active !== 'false' || (x.sys_updated_on ?? '') > at),
      uiPolicies: uiPolicies.filter((x) => x.active !== 'false' || (x.sys_updated_on ?? '') > at),
      crossRules,
      recorded: recordedAll.filter((r) => Math.abs(toMs(r.sys_created_on ?? '') - toMs(at)) <= 5000),
      dataLookups,
      flowSteps,
      importRows: importRows.filter((r) => Math.abs(toMs(r.sys_updated_on ?? '') - toMs(at)) <= 30_000),
      transformEntries,
      transformScripts,
      stageRows,
      transformMapsLoaded: mapIds.length > 0,
      users: Object.fromEntries(userRows.map((u) => [u.user_name ?? '', { sysId: u.sys_id ?? '', name: u.name || u.user_name || '', integration: u.web_service_access_only === 'true' || u.internal_integration_user === 'true' }])),
    };
    const ctx: ChangeContext = {
      table: target.table, field: target.field, sysId, audit: c, at, user: c.user ?? '',
      checkpoint: Number(c.record_checkpoint ?? 0), checkpoints, meta: metaAt(at), traces, opts, record: recordAt(Number(c.record_checkpoint ?? 0)),
      // Criação do registro (insert) ou atualização: decide quais BRs rodaram (action_insert / action_update).
      // Um PATCH logo depois da criação ainda é atualização: na criação a auditoria não tem valor anterior.
      operation: rec.sys_created_on && Math.abs(toMs(rec.sys_created_on) - toMs(at)) <= 2000 && !(c.oldvalue ?? '') ? 'insert' : 'update',
      ...(access.syslog_transaction === 'denied' ? { txDenied: true } : {}),
    };
    const notes: string[] = [];
    const ageSec = (Date.now() - toMs(at)) / 1000;
    for (const t of ['syslog_transaction', 'sysevent'] as const) {
      const keep = opts.retention?.[t];
      if (keep && ageSec > keep) notes.push(`traces_expired:${t}`);
    }
    const evidence = scoreAll(runSignatures(ctx));
    for (const e of evidence) {
      const off = [...inactive, ...inactiveClient, ...inactivePolicy].find((b) => b.sys_id && b.sys_id === e.artifact.sysId);
      if (off) e.gaps.push(`está desativado hoje; foi alterado em ${off.sys_updated_on}, depois da mudança (confira se estava ativo na hora)`);
    }
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
      const [tx, evs] = await Promise.all([
        q('syslog_transaction', `sys_created_on>=${shift(updatedOn, -3)}^sys_created_on<=${shift(updatedOn, 5)}`, ['sys_created_on', 'type', 'url', 'sys_created_by'], 50),
        // Eventos do próprio registro no instante (ex.: sla.warning.breach no task_sla): dizem qual motor mexeu nele.
        quiet('sysevent', `instance=${sysId}^sys_created_on>=${shift(updatedOn, -3)}^sys_created_on<=${shift(updatedOn, 5)}`, ['sys_created_on', 'name'], 20),
      ]);
      for (const t of tx) {
        if (/^JOB: |\/sys\.scripts\.do|\/api\//.test(t.url ?? '')) clues.push(`${t.sys_created_on} ${t.type} ${(t.url ?? '').split('?')[0]?.slice(0, 80)} (${t.sys_created_by})`);
      }
      for (const e of evs) clues.push(`${e.sys_created_on} evento ${e.name ?? ''} neste registro`);
    }
    unaudited = { count: mods - maxCheckpoint, lastUpdatedOn: updatedOn, lastUpdatedBy: rec.sys_updated_by ?? '', clues };
  }

  // Nomes como no formulário para os outros campos que aparecem no rastro (gravados junto ou perto da mudança).
  const wanted: Record<string, string[]> = {};
  for (const c of changes) for (const t of c.trace ?? []) for (const f of t.fields ?? []) (wanted[f.field] ??= []).push(f.oldValue, f.newValue);
  const display = Object.keys(wanted).length ? await resolveDisplay(quiet, meta.tables, wanted, opts.language) : undefined;

  // Fonte com alguma consulta sem resposta (prazo, 500, página de login) vira lenta, mesmo que outra consulta a ela tenha
  // respondido: antes, um 500 ('unknown') ou uma janela perdida passava calado e a perícia saía incompleta.
  for (const tag of new Set(failed.values())) if (access[tag] !== 'denied' && access[tag] !== 'no_filter') access[tag] = 'timeout';
  const gaps = Object.entries(access)
    .filter(([k, s]) => (s === 'denied' || s === 'timeout' || s === 'no_filter') && !(k === 'sys_audit' && auditFrom === 'history'))
    .map(([k, s]) => `${k}: ${s}`);
  if (historyUnavailable) gaps.push('list_history: unavailable');

  return {
    target: { ...target, sysId, display: rec.number || rec.name || sysId, ...(rec.short_description ? { title: rec.short_description } : rec.number && rec.name ? { title: rec.name } : {}) },
    labels,
    ...(fieldLabel ? { fieldLabel } : {}),
    ...(refTable ? { refTable } : {}),
    ...(display ? { display } : {}),
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
    ...(auditFrom === 'history' ? { auditFrom, historyFields, ...(historyFields && !historyFields.includes(target.field) ? { fieldNotInHistory: true } : {}) } : {}),
    conflicts: findConflicts(target.field, meta.brField, clientRows.filter((x) => x.active !== 'false'), { ...record, sys_id: sysId }),
    ...(() => { const pp = detectPingPong(changes); return pp ? { pingPong: pp } : {}; })(),
    timing: { totalMs: Date.now() - started, calls: client.calls - callsBefore },
  };

  // ---------- metadados da tabela ----------
  async function loadMeta(table: string, field: string): Promise<TableMeta> {
    let cached = await cache.get(table);
    // Regra criada, ativada, desativada ou editada depois que o cache foi guardado (10 min na extensão): no PDI, uma BR
    // ativada para um teste ficava de fora. Uma consulta mínima pergunta se alguma regra da tabela mudou desde então.
    if (cached?.loadedAt) {
      const changed = await quiet('sys_script', `collectionIN${cached.tables.join(',')}^sys_updated_on>=${shift(cached.loadedAt, -120)}`, ['sys_id'], 1);
      if (changed.length) cached = undefined;
    }
    const base = cached ?? (await loadMetaBase(table));
    // Metadados incompletos (consulta de regras estourou o tempo) não vão para o cache: senão o erro se repetiria.
    // Guardar é só economia: armazenamento cheio (cota da sessão do navegador) não derruba a investigação.
    if (!cached && !base.incomplete) await Promise.resolve(cache.set(table, base)).catch(() => undefined);
    // O que depende do campo é recalculado a partir do cache (barato, sem rede).
    const brField = base.businessRules.filter((b) => refsField(b.script, field) || refsField(b.template, field));
    const siField = base.scriptIncludes.filter((s) => refsField(s.script, field));
    const brViaSi: TableMeta['brViaSi'] = [];
    for (const br of base.businessRules) for (const si of siField) if ((br.script ?? '').includes(si.name ?? '\u0000')) brViaSi.push({ br, si });
    // SI genérico: a BR chama new X().metodo(..., 'campo', 'valor') e o SI grava por nome dinâmico (setValue(campo, ...)).
    for (const br of base.businessRules) {
      for (const c of siCallsWithField(br.script, field)) {
        const si = base.scriptIncludes.find((x) => x.name === c.si);
        if (!si || siField.includes(si)) continue;
        if (!writesOf(si.script, field)?.dynamic) continue;
        brViaSi.push({ br, si, arg: { call: c.call, ...(c.value !== undefined ? { value: c.value } : {}) } });
      }
    }
    return { ...base, brField, siField, brViaSi };
  }

  async function loadMetaBase(table: string): Promise<TableMeta> {
    const startedAt = Date.now();
    const tables: string[] = [];
    let cur: string | undefined = table;
    // Passo da hierarquia sem resposta (no PDI, dois 500 seguidos do balanceador): a tabela pareceria sem pai e o
    // incident perderia as regras e as opções de task (urgency sem rótulo). Tenta mais uma vez; se faltar de novo, os
    // metadados ficam incompletos e não vão para o cache.
    let hierarchyGap = false;
    for (let i = 0; cur && i < 10; i++) {
      tables.push(cur);
      const req = { table: 'sys_db_object', query: `name=${cur}`, fields: ['super_class.name'], limit: 1 };
      let r = await timedQuery(client, req, opts.sourceTimeoutMs);
      if (r.access === 'timeout' || r.access === 'unknown') r = await timedQuery(client, req, opts.sourceTimeoutMs);
      const prev = access.sys_db_object;
      if (!prev || prev === 'empty' || prev === 'unknown' || (prev === 'timeout' && r.access !== 'timeout')) access.sys_db_object = r.access;
      // Sem resposta nas duas: vira fonte lenta (entra nas lacunas e o painel avisa), não 'unknown', que passaria calado.
      if (r.access === 'timeout' || r.access === 'unknown') { hierarchyGap = true; access.sys_db_object = 'timeout'; }
      cur = r.rows[0]?.['super_class.name'] || undefined;
    }
    const brReq = { table: 'sys_script', query: `collectionIN${tables.join(',')}^active=true`, fields: ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'condition', 'filter_condition', 'action_insert', 'action_update'], limit: 500 };
    // As regras são a base de tudo: se a consulta estourar o tempo, tenta de novo com mais folga antes de seguir sem elas.
    // 500, rede ou página de login ('unknown') também: sem as regras, a pessoa saía "confirmada" por falta de concorrente.
    const unanswered = (a: AccessState) => a === 'timeout' || a === 'unknown';
    let brRes = await timedQuery(client, brReq, opts.sourceTimeoutMs);
    if (unanswered(brRes.access)) brRes = await timedQuery(client, brReq, opts.sourceTimeoutMs * 3);
    if (!access.sys_script || unanswered(access.sys_script)) access.sys_script = brRes.access === 'unknown' ? 'timeout' : brRes.access;
    const businessRules = brRes.rows;
    const incomplete = unanswered(brRes.access) || hierarchyGap;
    // Script includes citados pelas BRs (por nome; buscar por conteúdo traz centenas de scripts nativos).
    const siNames = new Set<string>();
    for (const b of businessRules) (b.script ?? '').replace(/new\s+(?:global\.)?([A-Z][A-Za-z0-9_]+)\s*\(/g, (_m, n: string) => { siNames.add(n); return _m; });
    const scriptIncludes = siNames.size ? await q('sys_script_include', `active=true^nameIN${[...siNames].join(',')}`, ['sys_id', 'name', 'script'], 200) : [];
    // App do Trail na instância (ou o protótipo da fase 18): tabela com o contexto gravado na hora.
    const recorder = (await quiet('sys_db_object', 'nameINx_trail_context,u_pt_trail_contexto^ORDERBYDESCname', ['name'], 2))[0]?.name;
    const loadedAt = new Date(startedAt).toISOString().slice(0, 19).replace('T', ' ');
    return { tables, businessRules, scriptIncludes, brField: [], siField: [], brViaSi: [], loadedAt, ...(recorder ? { recorder } : {}), ...(incomplete ? { incomplete } : {}) };
  }
}

/**
 * Monta a sequência do que aconteceu no registro perto da mudança. Transações de outras
 * telas ficam de fora; jobs, scripts de fundo e chamadas de API entram porque podem ter escrito no registro.
 */
function buildTrace(ctx: ChangeContext, top: Change['evidence'][number] | undefined): TraceItem[] {
  const items: TraceItem[] = [];
  const name = top?.artifact.name ?? '';
  const submit = formSubmitOf(ctx);
  for (const t of ctx.traces.transactions) {
    const url = t.url ?? '';
    const at = t.sys_created_on ?? '';
    const user = t.sys_created_by ?? '';
    const ref = t.sys_id ? { table: 'syslog_transaction', sysId: t.sys_id } : undefined;
    const base = { at, user, source: 'syslog_transaction', ...(ref ? { ref } : {}) };
    if (url.startsWith('JOB: ASYNC: ')) { const n = url.slice(12).trim(); items.push({ ...base, kind: 'async', label: n, cause: !!name && name === n }); continue; }
    if (url.startsWith('JOB: ')) { const n = url.slice(5).trim(); items.push({ ...base, kind: 'job', label: n, cause: !!name && name === n }); continue; }
    if (url.includes('/sys.scripts.do')) { items.push({ ...base, kind: 'background_script', label: 'Scripts - Background', cause: top?.type === 'background_script' }); continue; }
    if (isBatchCall(url) && user === ctx.user && Math.abs(toMs(at) - toMs(ctx.at)) <= 3000) {
      items.push({ ...base, kind: 'api', label: 'Batch API ' + (url.split('?')[0] ?? url), cause: top?.type === 'user_action' });
      continue;
    }
    if (!url.includes(ctx.sysId)) continue;
    const action = uiActionRef(url);
    const ua = action ? ctx.traces.uiActions.find((u) => uiActionMatches(u, action)) : undefined;
    if (action && !isSaveButton(ua)) {
      items.push({ ...base, kind: 'ui_action', label: ua?.name ?? action, cause: top?.type === 'ui_action' && !!ua && top.artifact.sysId === ua.sys_id });
      continue;
    }
    if (isWorkspaceAction(url)) {
      const wsCause = !!top && ['user_action', 'br_before', 'server_change', 'assignment_rule', 'data_lookup', 'client_script', 'ui_policy'].includes(top.type) && Math.abs(toMs(at) - toMs(ctx.at)) <= 3000;
      items.push({ ...base, kind: 'form', label: 'Workspace', cause: wsCause });
      continue;
    }
    if (url.includes('/api/')) {
      // Só conta como gravação a chamada ao próprio registro (/api/now/table/<tabela>/<sys_id>). Leituras que só citam o
      // sys_id na consulta (ex.: /api/now/table/wf_context?sysparm_query=id=<sys_id>) são consultas, inclusive as do próprio
      // Trail ou de outras extensões, e não entram no rastro como "Gravação via API".
      const path = url.split('?')[0] ?? url;
      if (!path.includes(ctx.sysId)) continue;
      // Leituras da própria interface com o sys_id no caminho (o editor de scripts busca os pontos de depuração em
      // /api/now/js/debugpoints/script/<tabela>/<sys_id>; ui/meta, UX framework, GraphQL) não gravam o registro.
      if (/\/api\/now\/(?:v\d+\/)?(?:js|ui|uxf|graphql|sp|cxs|ais|form|related_list)\//.test(path)) continue;
      items.push({ ...base, kind: 'api', label: path.slice(0, 80) });
      continue;
    }
    // Só envios de formulário contam; o recarregamento da página depois de salvar (GET ?sys_id=) não.
    if (!isFormSubmitFor(url, ctx.sysId)) continue;
    const sent = formSent(url, ctx.table, ctx.field, ctx.audit.newvalue ?? '')?.value ?? null;
    // Só o envio que gravou esta mudança é causa; outros salvamentos na janela (antes ou depois) são só contexto.
    const formCause = !!top && ['user_action', 'br_before', 'server_change', 'assignment_rule', 'data_lookup', 'client_script', 'ui_policy'].includes(top.type);
    items.push({ ...base, kind: 'form', label: isMultiUpdate(url) ? 'Update Selected (lista)' : ua?.name ?? url.split('?')[0] ?? url, ...(sent !== null ? { sent } : {}), cause: formCause && sent !== null && t === submit });
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
  const writes = (rows: Row[], keepField = false) => rows.filter((r) => keepField || r.fieldname !== ctx.field).map((r) => ({ field: r.fieldname ?? '', oldValue: r.oldvalue ?? '', newValue: r.newvalue ?? '' }));
  for (const [cpKey, rows] of Object.entries(ctx.checkpoints)) {
    const cp = Number(cpKey);
    if (cp === ctx.checkpoint) continue;
    const at = rows[0]?.sys_created_on ?? '';
    if (!between(at, from, to)) continue;
    // Nas outras gravações, o próprio campo investigado vem primeiro (ex.: a pessoa salvou de novo trocando o valor).
    const fields = writes(rows, true).sort((a, b) => Number(b.field === ctx.field) - Number(a.field === ctx.field));
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

