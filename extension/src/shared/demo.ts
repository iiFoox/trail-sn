import type { AccessReport, Change, Evidence, Investigation, StaticSuspects, Timeline, TimelineSave, TraceItem } from '@trail/core';

type DemoChange = Omit<Change, 'trace'>;
import type { TabState } from './messages';

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
  level: 'partial', denied: ['sys_flow_context', 'wf_context'], checkedAt: '2026-10-19T12:00:00.000Z',
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
    at: at ?? `2026-10-${10 + (n % 9)} 1${n % 9}:2${n % 6}:00`, oldValue: 'inquiry', newValue: n % 3 ? 'network' : 'hardware', user, changes: 1 + (n % 2), cause: { type, name, grade, score: grade === 'confirmed' ? 85 : 55, sysId: 'demo', table: 'sys_script' } });
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
