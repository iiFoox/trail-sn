import type { AccessReport, Change, Evidence, Investigation, StaticSuspects, Timeline, TimelineSave, TraceItem } from '@trail/core';

type DemoChange = Omit<Change, 'trace'>;
import type { ObservedField, TabState } from './messages';
import { FakeRestClient, compareInstances, fieldRules, fieldStates, saveTiming, simulateValue, visibility, type FieldRules, type FieldStateResult, type InstanceComparison, type Row, type SaveTiming, type ValueSimulation, type Visibility } from '@trail/core';

/**
 * Dados de demonstração do painel (sidepanel/index.html?demo=1&field=<campo>).
 *
 * Um único incidente, INC0010001, com uma história coerente: 14 atualizações (sys_mod_count 14),
 * 13 delas auditadas. Cada mecanismo reproduz um caso que rodou de verdade na PDI de testes
 * (BR async, BR before, script include, script action, script de fundo, job, UI action...).
 * A instância é fictícia de propósito: o site não pode depender de uma PDI que expira.
 */
export const DEMO_ORIGIN = 'https://sua-instancia.service-now.com';
const SYS_ID = 'ad7bbecdc3c413101cbdb8e1b40131f3';

const ID = {
  brAsync: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  brAutoclose: 'b1b2c3d4e5f60718293a4b5c6d7e8f90',
  brImpact: 'c7d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5',
  brC3: 'd2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7',
  si: 'c1b2c3d4e5f60718293a4b5c6d7e8f90',
  scriptAction: 'e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8',
  job: 'f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9',
  uiAction: 'a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0',
  rule: 'b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1',
  lookup: 'c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
  // valores de campos de referência, como o sys_audit os guarda
  beth: '46d44a23a9fe19810012d100cca80666',
  network: '287ebd7da9fe198100f92cc8d1d2154e',
  howard: '5137153cc611227c000bbd1bd8cd2005',
  printer: '0c4b1a5e1b2f2010a1b2c3d4e5f6a7b8',
};

const T0 = '2026-07-02 09:15:40'; // inserção, por integração; rastros já expiraram
const expired = ['traces_expired:syslog_transaction', 'traces_expired:sysevent'];

function creation(value: string): DemoChange {
  return { at: T0, oldValue: '', newValue: value, user: 'system', checkpoint: 1, notes: expired, evidence: [] };
}

function userForm(user: string, at: string, sent: string): Evidence {
  return {
    type: 'user_action', grade: 'confirmed', score: 80, artifact: { name: user }, gaps: [], facts: [
      { kind: 'form_value_equals', source: 'syslog_transaction', detail: `o formulário enviou exatamente "${sent}"`, points: 50 },
      { kind: 'execution_in_window', source: 'syslog_transaction', detail: `salvo às ${at.slice(11)}`, points: 20 },
      { kind: 'user_matches', source: 'syslog_transaction', detail: `por ${user}`, points: 10 },
    ],
  };
}

const noSuspects: StaticSuspects = { businessRules: [], viaScriptInclude: [], scriptIncludes: [] };

interface FieldStory { changes: DemoChange[]; suspects?: StaticSuspects; ms: number; calls: number }

const STORIES: Record<string, FieldStory> = {
  state: {
    ms: 1840, calls: 11,
    suspects: {
      businessRules: [
        { name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', sysId: ID.brAsync, when: 'async', order: '100', table: 'incident' },
        { name: 'Incident autoclose', sysId: ID.brAutoclose, when: 'before', order: '100', table: 'incident' },
        { name: 'Incident State Change to In Progress', sysId: ID.brImpact, when: 'before', order: '100', table: 'incident' },
        { name: 'Close interaction from incident', sysId: ID.brAutoclose, when: 'after', order: '100', table: 'incident' },
        { name: 'task closer', sysId: ID.brAutoclose, when: 'before', order: '900', table: 'task' },
      ],
      viaScriptInclude: [], scriptIncludes: [],
      clientScripts: [{ name: 'Resolve: exige código de fechamento', sysId: ID.uiAction, type: 'onChange', trigger: 'state', table: 'incident' }],
      uiActions: [{ name: 'Resolve Incident', sysId: ID.uiAction, table: 'incident' }],
    },
    changes: [
      {
        at: '2026-10-18 01:37:02', oldValue: '2', newValue: '6', user: 'admin', checkpoint: 3, notes: [],
        evidence: [
          { type: 'br_async', grade: 'confirmed', score: 80, artifact: { name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', sysId: ID.brAsync, table: 'sys_script' }, gaps: [], facts: [
            { kind: 'trace_names_artifact', source: 'syslog_transaction', detail: 'job ASYNC "[PERICIA-TESTE] Resolve incidente por pa" às 01:37:02', points: 50 },
            { kind: 'references_field', source: 'sys_script', detail: 'o script referencia "state"', points: 20 },
            { kind: 'references_table', source: 'sys_script', detail: 'BR da tabela incident', points: 10 },
          ] },
          { type: 'user_action', grade: 'candidate', score: 30, artifact: { name: 'admin' }, gaps: ['o formulário que ele salvou às 01:37:01 enviou State = In Progress, não Resolved'], facts: [
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'form /incident.do às 01:37:01', points: 20 },
            { kind: 'user_matches', source: 'syslog_transaction', detail: 'por admin', points: 10 },
          ] },
        ],
      },
      { at: '2026-10-17 14:02:11', oldValue: '1', newValue: '2', user: 'pericia.itil', checkpoint: 2, notes: [], evidence: [userForm('pericia.itil', '2026-10-17 14:02:11', '2')] },
      creation('1'),
    ],
  },
  impact: {
    ms: 2060, calls: 11,
    suspects: { businessRules: [{ name: '[PT] C2 before define impacto', sysId: ID.brImpact, when: 'before', order: '100', table: 'incident' }], viaScriptInclude: [], scriptIncludes: [] },
    changes: [
      {
        at: '2026-10-18 02:10:33', oldValue: '3', newValue: '1', user: 'pericia.itil', checkpoint: 6, notes: [],
        evidence: [
          { type: 'br_before', grade: 'confirmed', score: 80, artifact: { name: '[PT] C2 before define impacto', sysId: ID.brImpact, table: 'sys_script' }, gaps: [], facts: [
            { kind: 'form_value_differs', source: 'syslog_transaction', detail: 'o formulário enviou "3", o gravado foi "1": o servidor alterou ao salvar', points: 30 },
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'salvo às 02:10:33', points: 20 },
            { kind: 'references_field', source: 'sys_script', detail: 'o script referencia "impact"', points: 20 },
            { kind: 'references_table', source: 'sys_script', detail: 'BR before da tabela incident', points: 10 },
          ] },
        ],
      },
      creation('3'),
    ],
  },
  urgency: {
    ms: 1886, calls: 11,
    changes: [
      { at: '2026-10-18 02:12:05', oldValue: '3', newValue: '2', user: 'admin', checkpoint: 7, notes: [], evidence: [userForm('admin', '2026-10-18 02:12:05', '2')] },
      creation('3'),
    ],
  },
  priority: {
    ms: 2110, calls: 11,
    changes: [
      {
        at: '2026-10-18 02:12:05', oldValue: '3', newValue: '2', user: 'admin', checkpoint: 7, notes: [],
        evidence: [
          { type: 'server_change', grade: 'probable', score: 50, artifact: { name: 'Priority Lookup (data lookup)', sysId: ID.lookup, table: 'dl_u_priority' }, gaps: ['data lookups não deixam rastro próprio; o mecanismo é inferido'], facts: [
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'formulário salvo às 02:12:05, sem enviar priority', points: 20 },
            { kind: 'trace_identifies_mechanism', source: 'dl_definition', detail: 'regra de lookup ativa: impact + urgency → priority', points: 20 },
            { kind: 'references_table', source: 'dl_definition', detail: 'lookup da tabela incident', points: 10 },
          ] },
        ],
      },
      {
        at: '2026-10-18 02:10:33', oldValue: '5', newValue: '3', user: 'pericia.itil', checkpoint: 6, notes: [],
        evidence: [
          { type: 'server_change', grade: 'probable', score: 50, artifact: { name: 'Priority Lookup (data lookup)', sysId: ID.lookup, table: 'dl_u_priority' }, gaps: ['data lookups não deixam rastro próprio; o mecanismo é inferido'], facts: [
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'formulário salvo às 02:10:33, sem enviar priority', points: 20 },
            { kind: 'trace_identifies_mechanism', source: 'dl_definition', detail: 'regra de lookup ativa: impact + urgency → priority', points: 20 },
            { kind: 'references_table', source: 'dl_definition', detail: 'lookup da tabela incident', points: 10 },
          ] },
        ],
      },
      creation('5'),
    ],
  },
  category: {
    ms: 2028, calls: 11,
    suspects: { businessRules: [], viaScriptInclude: [{ businessRule: '[PT] C3 after chama script include', scriptInclude: 'PericiaTesteUtil', scriptIncludeSysId: ID.si }], scriptIncludes: [{ name: 'PericiaTesteUtil', sysId: ID.si }] },
    changes: [
      {
        at: '2026-10-18 02:16:40', oldValue: 'inquiry', newValue: 'network', user: 'admin', checkpoint: 10, notes: [],
        evidence: [
          { type: 'br_via_script_include', grade: 'probable', score: 50, artifact: { name: '[PT] C3 after chama script include → PericiaTesteUtil', sysId: ID.si, table: 'sys_script_include' }, gaps: ['o rastro não nomeia a BR; a ligação BR → script include vem do código'], facts: [
            { kind: 'new_checkpoint_same_second', source: 'sys_audit', detail: 'checkpoint 10 gravado no mesmo segundo do checkpoint 9, sem job nem evento', points: 20 },
            { kind: 'references_field', source: 'sys_script_include', detail: 'PericiaTesteUtil referencia "category"', points: 20 },
            { kind: 'references_table', source: 'sys_script', detail: 'BR after da tabela incident chama o script include', points: 10 },
          ] },
          { type: 'user_action', grade: 'candidate', score: 30, artifact: { name: 'admin' }, gaps: ['o formulário salvo às 02:16:40 não enviou category'], facts: [
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'form /incident.do às 02:16:40', points: 20 },
            { kind: 'user_matches', source: 'syslog_transaction', detail: 'por admin', points: 10 },
          ] },
        ],
      },
      creation('inquiry'),
    ],
  },
  contact_type: {
    ms: 2254, calls: 12,
    changes: [
      {
        at: '2026-10-18 02:14:07', oldValue: 'phone', newValue: 'email', user: 'admin', checkpoint: 8, notes: [],
        evidence: [
          { type: 'script_action', grade: 'confirmed', score: 70, artifact: { name: '[PT] C4 script action', sysId: ID.scriptAction, table: 'sysevent_script_action' }, gaps: [], facts: [
            { kind: 'trace_names_artifact', source: 'sysevent', detail: 'evento pt.contato do registro processado às 02:14:07', points: 50 },
            { kind: 'references_field', source: 'sysevent_script_action', detail: 'o script referencia "contact_type"', points: 20 },
          ] },
        ],
      },
      creation('phone'),
    ],
  },
  severity: {
    ms: 2361, calls: 12,
    changes: [
      {
        at: '2026-10-18 02:20:00', oldValue: '2', newValue: '1', user: 'system', checkpoint: 11, notes: [],
        evidence: [
          { type: 'scheduled_job', grade: 'confirmed', score: 70, artifact: { name: '[PT] C5 job ajusta severidade', sysId: ID.job, table: 'sysauto_script' }, gaps: [], facts: [
            { kind: 'trace_names_artifact', source: 'syslog_transaction', detail: 'transação "JOB: [PT] C5 job ajusta severidade" às 02:19:59', points: 50 },
            { kind: 'references_field', source: 'sysauto_script', detail: 'o script referencia "severity"', points: 20 },
          ] },
        ],
      },
      {
        at: '2026-10-18 02:05:12', oldValue: '3', newValue: '2', user: 'admin', checkpoint: 4, notes: [],
        evidence: [
          { type: 'background_script', grade: 'probable', score: 50, artifact: { name: 'Scripts - Background (admin)' }, gaps: ['o código executado em Scripts - Background não fica registrado'], facts: [
            { kind: 'trace_identifies_mechanism', source: 'syslog_transaction', detail: 'transação /sys.scripts.do às 02:05:12', points: 20 },
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'na janela da mudança', points: 20 },
            { kind: 'user_matches', source: 'syslog_transaction', detail: 'por admin, o mesmo usuário da auditoria', points: 10 },
          ] },
        ],
      },
      creation('3'),
    ],
  },
  description: {
    ms: 1922, calls: 12,
    changes: [
      {
        at: '2026-10-18 02:25:31', oldValue: 'Impressora PRN-3A-01 não responde no ping desde as 08:40.\nJá reiniciada pelo usuário.\nUsuário no ramal 4410.', newValue: 'Impressora PRN-3A-01 não responde no ping desde as 08:40.\nJá reiniciada pelo usuário duas vezes.\nUsuário no ramal 4410.\n[marcado para perícia]', user: 'admin', checkpoint: 12, notes: [],
        evidence: [
          { type: 'ui_action', grade: 'confirmed', score: 80, artifact: { name: '[PT] C8 Marcar perícia', sysId: ID.uiAction, table: 'sys_ui_action' }, gaps: [], facts: [
            { kind: 'trace_names_artifact', source: 'syslog_transaction', detail: 'transação com sys_action do botão "[PT] C8 Marcar perícia" às 02:25:31', points: 50 },
            { kind: 'references_field', source: 'sys_ui_action', detail: 'o script referencia "description"', points: 20 },
            { kind: 'references_table', source: 'sys_ui_action', detail: 'UI action da tabela incident', points: 10 },
          ] },
        ],
      },
      creation('Impressora PRN-3A-01 não responde no ping desde as 08:40.\nJá reiniciada pelo usuário.\nUsuário no ramal 4410.'),
    ],
  },
  assignment_group: {
    ms: 1975, calls: 11,
    changes: [
      {
        at: '2026-10-18 02:30:12', oldValue: '', newValue: ID.network, user: 'admin', checkpoint: 13, notes: [],
        evidence: [
          { type: 'assignment_rule', grade: 'probable', score: 60, artifact: { name: 'Network: categoria network', sysId: ID.rule, table: 'sysrule_assignment' }, gaps: ['regras de atribuição não deixam rastro próprio'], facts: [
            { kind: 'form_value_differs', source: 'syslog_transaction', detail: 'o formulário enviou o grupo vazio, o gravado foi Network', points: 30 },
            { kind: 'trace_identifies_mechanism', source: 'sysrule_assignment', detail: 'regra ativa: category = network → grupo Network', points: 20 },
            { kind: 'references_table', source: 'sysrule_assignment', detail: 'regra da tabela incident', points: 10 },
          ] },
        ],
      },
    ],
  },
  assigned_to: {
    ms: 1790, calls: 11,
    changes: [
      { at: '2026-10-18 02:31:50', oldValue: '', newValue: ID.howard, user: 'admin', checkpoint: 14, notes: [], evidence: [userForm('admin', '2026-10-18 02:31:50', 'Howard Johnson')] },
    ],
  },
  cmdb_ci: {
    ms: 1702, calls: 11,
    changes: [
      { at: '2026-10-18 02:16:40', oldValue: '', newValue: ID.printer, user: 'admin', checkpoint: 9, notes: [], evidence: [userForm('admin', '2026-10-18 02:16:40', 'PRN-3A-01')] },
    ],
  },
  caller_id: { ms: 1488, calls: 9, changes: [creation(ID.beth)] },
  short_description: { ms: 1512, calls: 9, changes: [creation('Impressora do 3º andar sem rede')] },
  number: { ms: 1320, calls: 7, changes: [] },
};

export const DEMO_FIELDS = Object.keys(STORIES);

// ---------- o que rodou no registro em volta de cada mudança (aba Rastro) ----------
let txSeq = 0;
const txRef = () => ({ table: 'syslog_transaction', sysId: `f0e1d2c3b4a5968778695a4b3c2d1e${String(++txSeq).padStart(2, '0')}` });
const form = (at: string, user: string, sent?: string, cause = true): TraceItem => ({ at, kind: 'form', label: '/incident.do', user, source: 'syslog_transaction', ref: txRef(), ...(sent !== undefined ? { sent } : {}), cause });
const TRACES: Record<string, TraceItem[]> = {
  'state:3': [form('2026-10-18 01:37:01', 'admin', '2', false), { at: '2026-10-18 01:37:02', kind: 'async', ref: txRef(), label: '[PERICIA-TESTE] Resolve incidente por palavra-chave', user: 'system', source: 'syslog_transaction', cause: true }],
  'state:2': [form('2026-10-17 14:02:10', 'pericia.itil', '2')],
  'impact:6': [form('2026-10-18 02:10:33', 'pericia.itil', '3')],
  'urgency:7': [form('2026-10-18 02:12:05', 'admin', '2')],
  'priority:7': [form('2026-10-18 02:12:05', 'admin')],
  'priority:6': [form('2026-10-18 02:10:33', 'pericia.itil')],
  'category:10': [form('2026-10-18 02:16:40', 'admin', undefined, false)],
  'contact_type:8': [form('2026-10-18 02:14:06', 'admin', undefined, false), { at: '2026-10-18 02:14:07', kind: 'event', label: 'pt.contato', source: 'sysevent', cause: true, ref: { table: 'sysevent', sysId: 'e1f2a3b4c5d6e7f8091a2b3c4d5e6f70' } }],
  'severity:11': [{ at: '2026-10-18 02:19:59', kind: 'job', ref: txRef(), label: '[PT] C5 job ajusta severidade', user: 'system', source: 'syslog_transaction', cause: true }],
  'severity:4': [{ at: '2026-10-18 02:05:11', kind: 'background_script', ref: txRef(), label: 'Scripts - Background', user: 'admin', source: 'syslog_transaction', cause: true }],
  'description:12': [{ at: '2026-10-18 02:25:31', kind: 'ui_action', ref: txRef(), label: '[PT] C8 Marcar perícia', user: 'admin', source: 'syslog_transaction', cause: true }],
  'assignment_group:13': [form('2026-10-18 02:30:12', 'admin', '')],
  'assigned_to:14': [form('2026-10-18 02:31:50', 'admin', ID.howard)],
  'cmdb_ci:9': [form('2026-10-18 02:16:40', 'admin', ID.printer)],
};

const HML = { '1': '1 - High', '2': '2 - Medium', '3': '3 - Low' };
const LABELS: Record<string, Record<string, string>> = {
  state: { '1': 'New', '2': 'In Progress', '3': 'On Hold', '6': 'Resolved', '7': 'Closed' },
  impact: HML, urgency: HML, severity: HML,
  priority: { '1': '1 - Critical', '2': '2 - High', '3': '3 - Moderate', '4': '4 - Low', '5': '5 - Planning' },
  category: { inquiry: 'Inquiry / Help', network: 'Network', hardware: 'Hardware' },
  contact_type: { phone: 'Phone', email: 'Email', 'self-service': 'Self-service' },
  assignment_group: { [ID.network]: 'Network' }, assigned_to: { [ID.howard]: 'Howard Johnson' },
  cmdb_ci: { [ID.printer]: 'PRN-3A-01' }, caller_id: { [ID.beth]: 'Beth Anglin' },
};

/** Outros campos gravados na mesma atualização (o rastro mostra o registro inteiro). */
const SAME_WRITE: Record<string, { field: string; oldValue: string; newValue: string }[]> = {
  'state:3': [{ field: 'close_code', oldValue: '', newValue: 'Solved (Permanently)' }, { field: 'close_notes', oldValue: '', newValue: 'Resolvido automaticamente: palavra-chave "reiniciada"' }],
  'impact:6': [{ field: 'priority', oldValue: '5', newValue: '3' }],
  'priority:6': [{ field: 'impact', oldValue: '3', newValue: '1' }],
  'priority:7': [{ field: 'urgency', oldValue: '3', newValue: '2' }],
  'urgency:7': [{ field: 'priority', oldValue: '3', newValue: '2' }],
  'category:10': [{ field: 'subcategory', oldValue: '', newValue: 'wireless' }],
  'severity:11': [{ field: 'work_notes', oldValue: '', newValue: 'Severidade ajustada pelo job de revisão' }],
};

function withTrace(field: string, c: DemoChange): Change {
  const before = TRACES[`${field}:${c.checkpoint}`] ?? [];
  const fields = SAME_WRITE[`${field}:${c.checkpoint}`];
  const ref = { table: 'sys_audit', query: `documentkey=${SYS_ID}^record_checkpoint=${c.checkpoint}` };
  return { ...c, trace: [...before, { at: c.at, kind: 'change', label: '', user: c.user, source: 'sys_audit', ref, ...(fields ? { fields } : {}) }] };
}

const access: AccessReport = {
  level: 'partial', denied: ['sys_flow_context', 'wf_context'], slow: [], checkedAt: '2026-10-19T12:00:00.000Z',
  states: { sys_audit: 'ok', syslog_transaction: 'ok', sysevent: 'empty', sysevent_script_action: 'ok', sys_flow_context: 'denied', wf_context: 'denied', sys_script: 'ok', sys_script_include: 'ok', sys_ui_action: 'ok', sysauto_script: 'ok', sys_db_object: 'ok' },
};

/** Estado do painel para o campo pedido; campo desconhecido cai em state. */
export function demoState(field = 'state'): TabState {
  const f = STORIES[field] ? field : 'state';
  const story = STORIES[f]!;
  const result: Investigation = {
    target: { table: 'incident', sysId: SYS_ID, field: f, display: 'INC0010001', title: 'Impressora do 3º andar sem rede' },
    tables: ['incident', 'task'],
    labels: LABELS[f] ?? {},
    changes: story.changes.map((c) => withTrace(f, c)),
    unaudited: { count: 1, lastUpdatedOn: '2026-10-18 02:40:00', lastUpdatedBy: 'admin', clues: ['2026-10-18 02:40:00 /sys.scripts.do (admin)'] },
    suspects: story.suspects ?? noSuspects,
    access: { sys_audit: 'ok', syslog_transaction: 'ok', sysevent: 'empty', sys_flow_context: 'denied' },
    gaps: ['sys_flow_context: denied'],
    ...(f === 'impact' ? { conflicts: [{
      field: 'impact', overlap: 'possible' as const, winner: 'a' as const, why: 'server_after_client' as const,
      a: { kind: 'br_before' as const, name: 'Impacto alto para rede', sysId: 'b1', table: 'incident', order: 100, values: ['1'], condition: 'category=network' },
      b: { kind: 'client_script' as const, name: 'Sugere impacto pelo contato', sysId: 'c1', table: 'incident', order: 0, values: ['2'] },
    }] } : {}),
    timing: { totalMs: story.ms, calls: story.calls },
  };
  return { tabId: 0, status: 'done', result, access, ctx: { origin: DEMO_ORIGIN, table: 'incident', sysId: SYS_ID, surface: 'ui16' } };
}

/** Rótulo do destino de um link, para o aviso "na extensão, isto abriria...". */
export function describeLink(href: string): string {
  const list = href.match(/\/([a-z0-9_]+)_list\.do\?sysparm_query=/);
  if (list) return list[1] === 'sys_audit' ? 'a auditoria dessa gravação' : list[1] === 'syslog_transaction' ? 'a lista dessas transações' : 'a lista filtrada';
  const m = href.match(/\/([a-z0-9_]+)\.do\?sys_id=/);
  const table = m?.[1] ?? '';
  const map: Record<string, string> = {
    syslog_transaction: 'essa transação', sysevent: 'esse evento', sys_flow_context: 'esse flow', wf_context: 'esse workflow',
    incident: 'o registro', sys_script: 'a business rule', sys_script_include: 'o script include', sysevent_script_action: 'a script action',
    sysauto_script: 'o job agendado', sys_ui_action: 'a UI action', sysrule_assignment: 'a regra de atribuição', dl_u_priority: 'o data lookup', dl_definition: 'o data lookup', cmdb_ci_service: 'o serviço',
  };
  return map[table] ?? 'o artefato';
}

/** Demonstração do registro inteiro: os campos que mudaram num incidente, com nomes e valores como no formulário. */
export function demoRecord(wait = false): TabState {
  const id = 'f'.repeat(32);
  const it = (field: string, label: string, at: string, o: string, n: string, od: string, nd: string, type: string, name: string, grade: string, refTable?: string) => ({ sysId: id, display: 'INC0010172', title: 'Sistema de pedidos fora do ar', field, label, status: 'done' as const, at, oldValue: o, newValue: n, oldDisplay: od, newDisplay: nd, user: 'admin', changes: 1, ...(refTable ? { refTable } : {}), cause: { type, name, grade, score: 90, ...(type === 'user_action' ? {} : { sysId: 'demo', table: type === 'data_lookup' ? 'dl_definition' : 'sysauto_script' }) } });
  const items = [
    it('business_service', 'Service', '2026-10-20 22:42:10', '', 'a'.repeat(32), '', 'SAP Enterprise Services', 'user_action', 'admin', 'confirmed', 'cmdb_ci_service'),
    it('subcategory', 'Subcategory', '2026-10-20 22:21:00', '', 'general_information', '', 'General Information', 'user_action', 'admin', 'confirmed'),
    it('urgency', 'Urgency', '2026-10-20 22:21:00', '3', '1', '3 - Low', '1 - High', 'user_action', 'admin', 'confirmed'),
    it('impact', 'Impact', '2026-10-20 22:21:00', '3', '1', '3 - Low', '1 - High', 'user_action', 'admin', 'confirmed'),
    it('priority', 'Priority', '2026-10-20 22:21:00', '4', '1', '4 - Low', '1 - Critical', 'data_lookup', 'Priority Lookup', 'confirmed'),
    it('description', 'Description', '2026-10-20 22:00:00', '', 'Gravado pelo job F18', '', 'Gravado pelo job F18', 'scheduled_job', '[PT] F18 Job que atualiza descrição', 'confirmed'),
    it('activity_due', 'Activity due', '2026-10-20 22:21:27', '2026-10-21 00:21:19', '2026-10-21 00:25:27', '2026-10-21 00:21:19', '2026-10-21 00:25:27', 'user_action', 'admin', 'candidate'),
  ];
  if (wait) for (const i of [2, 5, 6]) items[i] = { sysId: id, display: 'INC0010172', field: items[i]!.field, label: items[i]!.label, status: 'pending' } as never;
  return { tabId: 0, status: 'idle', ctx: { origin: DEMO_ORIGIN, table: 'incident', sysId: id, surface: 'ui16' }, batch: { table: 'incident', field: '*', kind: 'fields', sysId: id, display: 'INC0010172', items, status: wait ? 'running' : 'done', startedAt: new Date().toISOString(), ms: 5200 } };
}

/** Demonstração do lote: 12 incidentes, a categoria mudou por três causas. */
export function demoBatch(): TabState {
  const mk = (n: number, type: string, name: string, grade: string, user = 'system', at?: string) => ({ sysId: n.toString(16).padStart(32, '0'), display: `INC00${10100 + n}`, title: ['Impressora sem rede', 'VPN cai toda hora', 'Notebook lento', 'E-mail não sincroniza'][n % 4], status: 'done' as const,
    at: at ?? `2026-10-${10 + (n % 9)} 1${n % 9}:2${n % 6}:00`, oldValue: 'inquiry', newValue: n % 3 ? 'network' : 'hardware', oldDisplay: 'Inquiry / Help', newDisplay: n % 3 ? 'Network' : 'Hardware', user, changes: 1 + (n % 2), cause: { type, name, grade, score: grade === 'confirmed' ? 85 : 55, sysId: 'demo', table: 'sys_script' } });
  const items = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => mk(n, 'br_before', 'Categoria pelo grupo de suporte', 'confirmed', 'system', n <= 3 ? '2026-10-19 19:21:00' : undefined)),
    ...[8, 9, 10].map((n) => mk(n, 'user_action', 'beth.anglin', 'confirmed', 'beth.anglin')),
    mk(11, 'import_set', 'Chamados do parceiro', 'confirmed'),
    { sysId: '0'.repeat(31) + 'c', display: 'INC0010112', title: 'Monitor piscando', status: 'unchanged' as const, changes: 0 },
  ];
  return { tabId: 0, status: 'idle', ctx: { origin: DEMO_ORIGIN, table: 'incident', surface: 'ui16' }, batch: { table: 'incident', field: 'category', items, status: 'done', startedAt: new Date().toISOString(), ms: 8400 } };
}

/** Linha do tempo do registro de demonstração, montada a partir das mesmas histórias. */
export function demoTimeline(): Timeline {
  const COLS: Record<string, string> = { state: 'State', impact: 'Impact', urgency: 'Urgency', priority: 'Priority', category: 'Category', subcategory: 'Subcategory', contact_type: 'Channel', severity: 'Severity', description: 'Description', assignment_group: 'Assignment group', assigned_to: 'Assigned to', cmdb_ci: 'Configuration item', caller_id: 'Caller', short_description: 'Short description', close_code: 'Resolution code', close_notes: 'Resolution notes', work_notes: 'Work notes' };
  const VIA: Record<string, TimelineSave['via']> = { form: 'form', async: 'async', job: 'job', background_script: 'background', ui_action: 'ui_action', event: 'form' };
  const byCp = new Map<number, TimelineSave>();
  const add = (field: string, c: DemoChange) => {
    const sv = byCp.get(c.checkpoint) ?? { checkpoint: c.checkpoint, at: c.at, user: c.user, via: 'unknown' as TimelineSave['via'], fields: [] };
    if (!sv.fields.some((f) => f.field === field)) {
      const lb = LABELS[field] ?? {};
      sv.fields.push({ field, label: COLS[field] ?? field, oldValue: c.oldValue, newValue: c.newValue, oldDisplay: lb[c.oldValue] ?? c.oldValue, newDisplay: lb[c.newValue] ?? c.newValue, journal: field === 'work_notes' });
    }
    const tr = TRACES[`${field}:${c.checkpoint}`] ?? [];
    const cause = tr.find((x) => x.cause) ?? tr[0];
    if (cause && sv.via === 'unknown') {
      sv.via = VIA[cause.kind] ?? 'unknown';
      if (!['form', 'event', 'background_script'].includes(cause.kind)) sv.detail = cause.label;
    }
    if (c.checkpoint === 1) sv.via = 'created';
    else if (sv.via === 'unknown' && c.user === 'system') sv.via = 'expired';
    for (const w of SAME_WRITE[`${field}:${c.checkpoint}`] ?? []) {
      if (sv.fields.some((f) => f.field === w.field)) continue;
      const lb = LABELS[w.field] ?? {};
      sv.fields.push({ field: w.field, label: COLS[w.field] ?? w.field, oldValue: w.oldValue, newValue: w.newValue, oldDisplay: lb[w.oldValue] ?? w.oldValue, newDisplay: lb[w.newValue] ?? w.newValue, journal: w.field === 'work_notes' });
    }
    byCp.set(c.checkpoint, sv);
  };
  for (const [field, st] of Object.entries(STORIES)) for (const c of st.changes) add(field, c);
  const saves = [...byCp.values()].sort((a, b) => b.checkpoint - a.checkpoint);
  for (const sv of saves) sv.fields.sort((a, b) => Number(a.journal) - Number(b.journal) || a.label.localeCompare(b.label));
  return { target: { table: 'incident', sysId: SYS_ID, display: 'INC0010001', title: 'Impressora do 3º andar sem rede' }, saves, truncated: false, timing: { totalMs: 1240, calls: 9 } };
}

// ---------- "Por que está bloqueado?" (demonstração) ----------
// O demo roda o motor de verdade (fieldStates) contra uma instância falsa em memória: o que aparece é o que o
// motor diria com estas regras. `lock=itil` simula quem não lê as regras do formulário.

const LOCK_REC: Record<string, string> = {
  sys_id: SYS_ID, number: 'INC0010001', state: '6', category: 'network', impact: '2', urgency: '2', priority: '2', assignment_group: ID.network,
  assigned_to: ID.howard, caller_id: ID.beth, cmdb_ci: ID.printer, close_code: '', parent_incident: '', rfc: '', contact_type: 'phone', short_description: 'Impressora do 3º andar sem rede',
};
const LOCK_LABELS: Record<string, [string, string]> = {
  number: ['Number', 'task'], caller_id: ['Caller', 'incident'], category: ['Category', 'incident'], state: ['State', 'incident'], impact: ['Impact', 'task'], urgency: ['Urgency', 'task'],
  priority: ['Priority', 'task'], assignment_group: ['Assignment group', 'task'], assigned_to: ['Assigned to', 'task'], cmdb_ci: ['Configuration item', 'task'],
  close_code: ['Resolution code', 'incident'], parent_incident: ['Parent Incident', 'incident'], rfc: ['Change Request', 'incident'], contact_type: ['Channel', 'incident'], short_description: ['Short description', 'task'],
};
/** O que o g_form mostraria neste incidente resolvido. */
export function demoFormStates(): ObservedField[] {
  const ro = new Set(['number', 'caller_id', 'assignment_group']), md = new Set(['category', 'close_code', 'short_description']), hid = new Set(['parent_incident', 'rfc']);
  return Object.entries(LOCK_LABELS).map(([field, [label]]) => ({ field, label, onForm: true, readOnly: ro.has(field), mandatory: md.has(field), visible: !hid.has(field) }));
}
export function demoObserved(field: string): ObservedField | undefined {
  return demoFormStates().find((x) => x.field === field);
}
const P_ = (o: Record<string, string>) => ({ active: 'true', table: 'incident', on_load: 'true', reverse_if_false: 'true', global: 'true', ui_type: '0', run_scripts: 'false', order: '100', ...o });
const A_ = (o: Record<string, string>) => ({ disabled: 'ignore', mandatory: 'ignore', visible: 'ignore', 'ui_policy.active': 'true', 'ui_policy.table': 'incident', ...o });
const LOCK_DICT = Object.entries(LOCK_LABELS).map(([element, [column_label, name]]) => ({ sys_id: `d0${element}`.padEnd(32, '0').slice(0, 32), name, element, column_label, active: 'true', mandatory: element === 'short_description' ? 'true' : 'false', read_only: element === 'number' ? 'true' : 'false', internal_type: element === 'assignment_group' ? 'reference' : 'string', ...(element === 'assignment_group' ? { reference: 'sys_user_group' } : {}) }));
function lockInstance(itil: boolean): FakeRestClient {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  c.rows('incident', [LOCK_REC]);
  c.rows('sys_choice', [{ name: 'incident', element: 'state', value: '6', label: 'Resolved', language: 'en' }, { name: 'incident', element: 'category', value: 'network', label: 'Network', language: 'en' }]);
  c.rows('sys_documentation', []);
  c.rows('sys_user_group', [{ sys_id: ID.network, name: 'Network' }]);
  if (itil) {
    // itil no PDI: dicionário vem vazio e as regras do formulário dão 403.
    c.rows('sys_dictionary', []);
    return c;
  }
  c.rows('sys_dictionary', LOCK_DICT);
  c.rows('sys_dictionary_override', []);
  c.rows('sys_ui_policy', [
    P_({ sys_id: 'a0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Resolvido trava o grupo', conditions: 'state=6^EQ', order: '100' }),
    P_({ sys_id: 'b0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Rede: categoria opcional', conditions: 'category=network^EQ', order: '100' }),
    P_({ sys_id: 'c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Resolvido exige categoria', conditions: 'state=6^EQ', order: '200' }),
    P_({ sys_id: 'd0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Esconde incidente pai vazio', conditions: 'parent_incidentISEMPTY^EQ', order: '100' }),
    P_({ sys_id: 'e0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Fechado trava a descrição', conditions: 'state=7^EQ', order: '100', reverse_if_false: 'false' }),
  ]);
  c.rows('sys_ui_policy_action', [
    A_({ ui_policy: 'a0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'assignment_group', disabled: 'true' }),
    A_({ ui_policy: 'b0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'category', mandatory: 'false' }),
    A_({ ui_policy: 'c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'category', mandatory: 'true' }),
    A_({ ui_policy: 'd0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'parent_incident', visible: 'false' }),
    A_({ ui_policy: 'e0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'assignment_group', disabled: 'true' }),
  ]);
  c.rows('sys_data_policy_rule', [{ sys_id: 'r1', sys_data_policy: 'f0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', field: 'close_code', mandatory: 'true', disabled: 'ignore', 'sys_data_policy.active': 'true', 'sys_data_policy.model_table': 'incident' }]);
  c.rows('sys_data_policy2', [{ sys_id: 'f0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Resolvido exige código de fechamento', model_table: 'incident', conditions: 'state=6^EQ', enforce_ui: 'true', active: 'true' }]);
  c.rows('sys_script_client', [
    { sys_id: 'a1d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', name: 'Só coordenador muda o grupo', type: 'onLoad', table: 'incident', active: 'true', ui_type: '0', global: 'true',
      script: "function onLoad() {\n  if (!g_user.hasRole('itil_admin'))\n    g_form.setReadOnly('assignment_group', true);\n}" },
    { sys_id: 'b1d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', name: 'Esconde mudança fora de software', type: 'onLoad', table: 'incident', active: 'true', ui_type: '0', global: 'true',
      script: "function onLoad() {\n  if (g_form.getValue('category') != 'software')\n    g_form.setDisplay('rfc', false);\n}" },
  ]);
  return c;
}
const isItilDemo = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('lock') === 'itil';
export async function demoFieldStates(fields: string[]): Promise<FieldStateResult[]> {
  const obs = demoFormStates();
  return fieldStates(lockInstance(isItilDemo()), { table: 'incident', sysId: SYS_ID, fields: fields.map((field) => { const o = obs.find((x) => x.field === field); return { field, ...(o ? { observed: o } : {}) }; }) });
}

// ---------- Telas novas (Regras do campo, Simular, Salvamento, Quem enxerga, Comparar) ----------
// Igual ao "Por que está bloqueado?": o motor de verdade roda contra uma instância falsa em memória, então o que
// aparece na demonstração é o que o motor diria com estas regras. Parâmetros da URL (só no modo demo):
//   &tab=answer|how|history|rules   aba inicial (tab=trace, proof, flows, whatif e lock ainda valem, como apelidos)
//   &sim=<valor>                    Regras do campo › Simular um valor, já rodando com o valor (ex.: &sim=7)
//   &compare=1|nologin|none         Regras do campo › Comparar: com diferenças, outra instância sem login, nenhuma conectada
//   &visibility=1|<user_name>       Histórico › Quem enxerga este registro, já rodando (1 = abel.tuter, que não vê)
//   &slow=1|denied                  Como aconteceu › salvamento lento (ou sem acesso às transações)
//   &access=1 &err=1 &run=1 &empty=1  aviso de acesso, erro, carregando e painel vazio

const DEMO_USERS = { admin: '6816f79cc0a8016401c5a33be04be441', abel: '62826bf03710200044e0bfc8bcbe5df1', howard: ID.howard, beth: ID.beth };
/** Os mesmos campos de tempo que a instância lista no dicionário (syslog_transaction). */
const TIMING_DICT = ['response_time', 'client_response_time', 'business_rule_time', 'business_rule_count', 'sql_time', 'sql_count', 'acl_time', 'browser_time', 'client_network_time', 'semaphore_wait_time', 'session_wait_time', 'additional_info']
  .map((element) => ({ name: 'syslog_transaction', element, internal_type: 'integer' }));
/** Tabelas que os motores leem e que, nesta instância de mentira, existem e estão vazias (vazio ≠ sem acesso). */
const EMPTY_SOURCES = ['dl_definition_rel_match', 'dl_definition_rel_set', 'sys_script_include', 'sysrule_assignment', 'sys_hub_action_instance_v2', 'sysauto_script', 'sys_transform_entry',
  'sys_update_xml', 'sys_update_version', 'sys_update_set', 'sys_hub_flow', 'dl_definition', 'sys_transform_map', 'sys_user_grmember', 'sysevent', 'sys_flow_context', 'syslog'];

const BR = (o: Row): Row => ({ active: 'true', collection: 'incident', when: 'before', order: '100', action_insert: 'false', action_update: 'true', action_delete: 'false', action_query: 'false', filter_condition: '', condition: '', template: '', script: '', sys_updated_on: '2026-09-01 10:00:00', sys_updated_by: 'admin', ...o });
const INCIDENT_QUERY = 'if (!gs.hasRole("itil") && !gs.hasRole("sn_incident_read") && gs.isInteractive()) {\n\tvar u = gs.getUserID();\n\tvar qc = current.addQuery("caller_id", u).addOrCondition("opened_by", u).addOrCondition("watch_list", "CONTAINS", u);\n}';
function demoBrs(prod: boolean): Row[] {
  return [
    BR({ sys_id: ID.brAsync, name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', when: 'async', filter_condition: 'descriptionLIKEreiniciada^EQ', script: "current.state = 6;\ncurrent.close_code = 'Solved (Permanently)';\ncurrent.close_notes = 'Resolvido automaticamente';\ncurrent.update();" }),
    BR({ sys_id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1', name: 'mark_resolved', filter_condition: prod ? 'stateCHANGESTO7^EQ' : 'stateCHANGESTO6^EQ', script: 'current.resolved_by = gs.getUserID();\ncurrent.resolved_at = new GlideDateTime();', sys_updated_on: prod ? '2026-06-02 09:00:00' : '2026-09-01 10:00:00' }),
    BR({ sys_id: 'c3d4e5f60718293a4b5c6d7e8f90a1b2', name: 'Fecha as tarefas filhas', when: 'after', order: '200', filter_condition: 'stateCHANGESTO7^EQ', script: prod ? "var t = new GlideRecord('incident_task');\nt.addQuery('incident', current.sys_id);\nt.query();\nwhile (t.next()) { t.state = 3; t.update(); }" : "var t = new GlideRecord('incident_task');\nt.addQuery('incident', current.sys_id);\nt.addQuery('active', true);\nt.query();\nwhile (t.next()) { t.state = 3; t.update(); }" }),
    ...(prod ? [] : [BR({ sys_id: 'd4e5f60718293a4b5c6d7e8f90a1b2c3', name: 'Avisa o SLA quando o estado muda', when: 'async', filter_condition: 'stateVALCHANGES^EQ', script: "gs.eventQueue('incident.state.changed', current);" })]),
    BR({ sys_id: 'e5f60718293a4b5c6d7e8f90a1b2c3d4', name: 'Calcula prioridade', order: '50', filter_condition: 'impactVALCHANGES^ORurgencyVALCHANGES^EQ', script: 'current.priority = new IncidentUtils().priority(current);' }),
    BR({ sys_id: 'f60718293a4b5c6d7e8f90a1b2c3d4e5', name: 'incident query', action_query: 'true', action_update: 'false', script: INCIDENT_QUERY }),
  ];
}
function demoInstance(prod = false, slow: string | null = null): FakeRestClient {
  const c = lockInstance(false);
  for (const t of EMPTY_SOURCES) c.rows(t, []);
  c.rows('incident', [{ ...LOCK_REC, description: 'Impressora PRN-3A-01 não responde no ping.', opened_by: DEMO_USERS.admin, watch_list: '', active: 'true', sys_domain: 'global', sys_created_on: T0, sys_updated_on: '2026-10-18 02:40:00', sys_updated_by: 'admin' }]);
  c.rows('sys_dictionary', [...LOCK_DICT, ...TIMING_DICT]);
  c.rows('sys_choice', [
    ...Object.entries(LABELS.state!).filter(([v]) => !prod || v !== '3').map(([value, label]) => ({ name: 'incident', element: 'state', value, label, language: 'en', inactive: 'false', sequence: value })),
    { name: 'incident', element: 'category', value: 'network', label: 'Network', language: 'en', inactive: 'false' },
  ]);
  c.rows('sys_documentation', [{ name: 'incident', element: 'state', label: 'State', language: 'en' }, { name: 'task', element: 'close_notes', label: 'Resolution notes', language: 'en' }, { name: 'incident', element: 'close_code', label: 'Resolution code', language: 'en' }, { name: 'incident', element: 'resolved_by', label: 'Resolved by', language: 'en' }, { name: 'incident', element: 'resolved_at', label: 'Resolved', language: 'en' }]);
  c.rows('sys_script', demoBrs(prod));
  c.rows('sys_script_client', [
    { sys_id: 'a1d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', name: 'Só coordenador muda o grupo', type: 'onLoad', field: '', table: 'incident', active: 'true', ui_type: '0', global: 'true', script: "function onLoad() {\n  if (!g_user.hasRole('itil_admin'))\n    g_form.setReadOnly('assignment_group', true);\n}" },
    { sys_id: 'c1d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', name: 'Resolve: exige código de fechamento', type: 'onChange', field: 'state', table: 'incident', active: 'true', ui_type: '0', global: 'true', script: "function onChange(control, oldValue, newValue) {\n  if (newValue == '6') g_form.setMandatory('close_code', true);\n}" },
  ]);
  c.rows('sys_ui_action', [{ sys_id: ID.uiAction, name: 'Resolve Incident', table: 'incident', active: 'true', order: '300', condition: "current.state != 6 && current.state != 7", script: "current.state = 6;\ncurrent.update();" }]);
  c.rows('sysevent_email_action', [{ sys_id: 'n1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6', name: 'Incidente resolvido: avisa o solicitante', collection: 'incident', active: 'true', condition: 'stateCHANGESTO6^EQ', advanced_condition: '', action_insert: 'false', action_update: 'true', generation_type: 'engine', order: '100' }]);
  c.rows('contract_sla', [{ sys_id: 's1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6', name: 'Resolução P2 (8 h)', collection: 'incident', active: 'true', start_condition: 'priority=2^EQ', stop_condition: 'state=6^ORstate=7^EQ', pause_condition: 'state=3^EQ', reset_condition: '', cancel_condition: '', resume_condition: '' }]);
  c.rows('sys_hub_trigger_instance_v2', [{ flow: 'f2a3b4c5d6e7f8091a2b3c4d5e6f7a8b', 'flow.name': 'Fechar tarefas filhas', 'flow.active': 'true', 'flow.sys_class_name': 'sys_hub_flow', trigger_type: 'record_update', trigger_inputs: JSON.stringify([{ name: 'table', value: 'incident' }, { name: 'condition', value: 'state=7^EQ' }]) }]);
  c.rows('sys_ui_policy', [
    { sys_id: 'c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Resolvido exige categoria', table: 'incident', active: 'true', conditions: prod ? 'state=6^ORstate=7^EQ' : 'state=6^EQ', on_load: 'true', reverse_if_false: 'true', inherit: 'false', global: 'true', view: '', ui_type: '0', order: '200', run_scripts: 'false', script_true: '', script_false: '' },
    { sys_id: 'a0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5', short_description: 'Resolvido trava o grupo', table: 'incident', active: 'true', conditions: 'state=6^EQ', on_load: 'true', reverse_if_false: 'true', inherit: 'false', global: 'true', view: '', ui_type: '0', order: '100', run_scripts: 'false', script_true: '', script_false: '' },
  ]);
  // Transações: uma por gravação do incidente (form salvo pela tela) e as de outros incidentes nas horas antes (o "normal").
  const tx = (o: Row): Row => ({ sys_id: `tx${(o.sys_created_on ?? '').replace(/\D/g, '')}`, type: 'form', sys_created_by: 'admin', url: `/incident.do?sys_id=${SYS_ID}&sys_uniqueValue=${SYS_ID}&sys_action=sysverb_update`, ...o });
  const at = [...new Set(Object.values(STORIES).flatMap((st) => st.changes.map((c) => c.at)))];
  const heavy = slow === '1';
  const others = Array.from({ length: 14 }, (_, i) => tx({ sys_id: `h${i}`, sys_created_on: shiftUtc('2026-10-17 23:00:00', -i * 600), url: `/incident.do?sys_id=${String(i).padStart(32, 'c')}&sys_uniqueValue=${String(i).padStart(32, 'c')}&sys_action=sysverb_update`, response_time: String(560 + (i % 4) * 30) }));
  if (slow === 'denied') c.deny('syslog_transaction');
  else c.rows('syslog_transaction', [...at.map((a) => tx({ sys_created_on: shiftUtc(a, 1), response_time: heavy ? '4870' : '640', business_rule_time: heavy ? '3620' : '180', business_rule_count: heavy ? '17' : '9', sql_time: heavy ? '910' : '150', sql_count: heavy ? '64' : '31', client_response_time: heavy ? '5310' : '900', browser_time: heavy ? '260' : '180', client_network_time: '120', acl_time: '40', semaphore_wait_time: '0', session_wait_time: '0' })), ...others]);
  c.rows('sys_audit', Object.entries(STORIES).flatMap(([fieldname, st]) => st.changes.map((ch) => ({ fieldname, oldvalue: ch.oldValue, newvalue: ch.newValue, user: ch.user, sys_created_on: ch.at, record_checkpoint: String(ch.checkpoint), tablename: 'incident', documentkey: SYS_ID }))));
  if (heavy) c.rows('syslog', [{ source: 'mark_resolved', sys_created_on: '2026-10-18 01:37:03' }]);
  // Quem enxerga: a regra "incident query" do ServiceNow, as ACLs de leitura e as pessoas.
  c.rows('sys_security_acl', [
    { sys_id: 'acl0', name: 'incident', 'operation.name': 'read', 'type.name': 'record', active: 'true', condition: '', script: '', advanced: 'false', admin_overrides: 'true' },
    { sys_id: 'acl1', name: 'incident', 'operation.name': 'read', 'type.name': 'record', active: 'true', condition: 'caller_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe^EQ', script: '', advanced: 'false', admin_overrides: 'true' },
    { sys_id: 'acl2', name: 'incident.*', 'operation.name': 'read', 'type.name': 'record', active: 'true', condition: '', script: '', advanced: 'false', admin_overrides: 'true' },
  ]);
  c.rows('sys_security_acl_role', [{ sys_security_acl: 'acl0', sys_user_role: 'itilid', 'sys_user_role.name': 'itil' }]);
  c.rows('sys_user', [
    { sys_id: DEMO_USERS.admin, user_name: 'admin', name: 'System Administrator', active: 'true', sys_domain: 'global' },
    { sys_id: DEMO_USERS.beth, user_name: 'beth.anglin', name: 'Beth Anglin', active: 'true', sys_domain: 'global' },
    { sys_id: DEMO_USERS.abel, user_name: 'abel.tuter', name: 'Abel Tuter', active: 'true', sys_domain: 'global' },
    { sys_id: DEMO_USERS.howard, user_name: 'howard.johnson', name: 'Howard Johnson', active: 'true', sys_domain: 'global' },
  ]);
  c.rows('sys_user_has_role', [
    { user: DEMO_USERS.admin, role: 'adminid', 'role.name': 'admin', inherited: 'false', state: 'active' },
    { user: DEMO_USERS.howard, role: 'itilid', 'role.name': 'itil', inherited: 'true', state: 'active' },
  ]);
  return c;
}
function shiftUtc(at: string, sec: number): string {
  const d = new Date(at.replace(' ', 'T') + 'Z');
  return new Date(d.getTime() + sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
}
const demoParam = (k: string) => (typeof location !== 'undefined' ? new URLSearchParams(location.search).get(k) : null);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Regras do campo (Quem grava + Quem depende) na instância de demonstração. */
export async function demoFieldRules(field: string): Promise<FieldRules> {
  const r = await fieldRules(demoInstance(), { table: 'incident', field }, { language: 'en' });
  await pause(500);
  return r;
}
/** "Simular um valor" com o motor de verdade. */
export async function demoSimulate(field: string, value: string): Promise<ValueSimulation> {
  const r = await simulateValue(demoInstance(), { table: 'incident', sysId: SYS_ID, field, value, language: 'en', user: { name: 'admin', sysId: DEMO_USERS.admin } });
  await pause(500);
  return r;
}
/** Tempo do salvamento de uma mudança (`&slow=1`: lento; `&slow=denied`: sem acesso às transações). */
export async function demoSaveTiming(at: string, checkpoint: number): Promise<SaveTiming> {
  const r = await saveTiming(demoInstance(false, demoParam('slow')), { table: 'incident', sysId: SYS_ID, at, checkpoint });
  await pause(400);
  return r;
}
/** Quem enxerga o registro de demonstração. */
export async function demoVisibility(user: string): Promise<Visibility> {
  const r = await visibility(demoInstance(), { table: 'incident', sysId: SYS_ID, ...(user ? { user } : {}) }, { language: 'en' });
  await pause(450);
  return r;
}
/** Pessoas para sugerir no "Quem enxerga" do demo. */
export const DEMO_PEOPLE = ['admin', 'beth.anglin', 'abel.tuter', 'howard.johnson'];
export const DEMO_OTHER = 'https://sua-instancia-prod.service-now.com';
/** Outras instâncias conectadas no demo (`&compare=none`: nenhuma). */
export function demoOtherInstances(): string[] {
  return demoParam('compare') === 'none' ? [] : [DEMO_OTHER];
}
/** Comparação com a "produção" de mentira (`&compare=nologin`: sem login nela). */
export async function demoCompare(field: string, other: string): Promise<InstanceComparison> {
  const b = demoParam('compare') === 'nologin' ? new FakeRestClient() : demoInstance(true);
  const label = (o: string) => o.replace(/^https?:\/\//, '').split('.')[0]!;
  const r = await compareInstances({ client: demoInstance(), label: label(DEMO_ORIGIN) }, { client: b, label: label(other) }, { table: 'incident', field }, { language: 'en' });
  await pause(600);
  return r;
}
