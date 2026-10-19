import type { AccessReport, Investigation } from '@trail/core';
import type { TabState } from './messages';

/** Dados de exemplo para pré-visualizar o painel sem instância (sidepanel/index.html?demo=1). */
export function demoState(): TabState {
  const sysId = 'ad7bbecdc3c413101cbdb8e1b40131f3';
  const result: Investigation = {
    target: { table: 'incident', sysId, field: 'state', display: 'INC0010001' },
    tables: ['incident', 'task'],
    changes: [
      {
        at: '2026-10-18 01:37:02', oldValue: '2', newValue: '6', user: 'admin', checkpoint: 3, notes: [],
        evidence: [
          { type: 'br_async', grade: 'confirmed', score: 80, artifact: { name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', sysId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', table: 'sys_script' }, gaps: [], facts: [
            { kind: 'trace_names_artifact', source: 'syslog_transaction', detail: 'job ASYNC "[PERICIA-TESTE] Resolve incidente por pa" às 01:37:02', points: 50 },
            { kind: 'references_field', source: 'sys_script', detail: 'o script referencia "state"', points: 20 },
            { kind: 'references_table', source: 'sys_script', detail: 'BR da tabela incident', points: 10 },
          ] },
          { type: 'user_action', grade: 'candidate', score: 30, artifact: { name: 'admin' }, gaps: ['sem transação de formulário visível para comparar o valor enviado'], facts: [
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'form /incident.do às 01:37:01', points: 20 },
            { kind: 'user_matches', source: 'syslog_transaction', detail: 'por admin', points: 10 },
          ] },
        ],
      },
      {
        at: '2026-10-17 14:02:11', oldValue: '1', newValue: '2', user: 'pericia.itil', checkpoint: 2, notes: [],
        evidence: [
          { type: 'user_action', grade: 'confirmed', score: 80, artifact: { name: 'pericia.itil' }, gaps: [], facts: [
            { kind: 'form_value_equals', source: 'syslog_transaction', detail: 'o formulário enviou exatamente o novo valor', points: 50 },
            { kind: 'execution_in_window', source: 'syslog_transaction', detail: 'salvo às 14:02:11', points: 20 },
            { kind: 'user_matches', source: 'syslog_transaction', detail: 'por pericia.itil', points: 10 },
          ] },
        ],
      },
      {
        at: '2026-07-02 09:15:40', oldValue: '', newValue: '1', user: 'system', checkpoint: 1, notes: ['traces_expired:syslog_transaction', 'traces_expired:sysevent'],
        evidence: [
          { type: 'unknown_background', grade: 'candidate', score: 10, artifact: { name: '(desconhecido)' }, gaps: ['verificar jobs, integrações MID e importações do horário'], facts: [
            { kind: 'no_user_transaction', source: 'syslog_transaction', detail: 'nenhuma transação do usuário na janela', points: 10 },
          ] },
        ],
      },
    ],
    unaudited: { count: 1, lastUpdatedOn: '2026-10-18 02:10:00', lastUpdatedBy: 'admin', clues: ['2026-10-18 02:10:00 other /sys.scripts.do (admin)'] },
    suspects: {
      businessRules: [
        { name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', sysId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', when: 'async', order: '100', table: 'incident' },
        { name: 'Incident autoclose', sysId: 'b1b2c3d4e5f60718293a4b5c6d7e8f90', when: 'before', order: '100', table: 'incident' },
      ],
      viaScriptInclude: [{ businessRule: '[PT] C3 after chama script include', scriptInclude: 'PericiaTesteUtil', scriptIncludeSysId: 'c1b2c3d4e5f60718293a4b5c6d7e8f90' }],
      scriptIncludes: [{ name: 'PericiaTesteUtil', sysId: 'c1b2c3d4e5f60718293a4b5c6d7e8f90' }],
    },
    access: { sys_audit: 'ok', syslog_transaction: 'ok', sysevent: 'empty', sys_flow_context: 'denied' },
    gaps: ['sys_flow_context: denied'],
    timing: { totalMs: 1840, calls: 11 },
  };
  const access: AccessReport = {
    level: 'partial', denied: ['sys_flow_context', 'wf_context'], checkedAt: new Date().toISOString(),
    states: { sys_audit: 'ok', syslog_transaction: 'ok', sysevent: 'empty', sysevent_script_action: 'ok', sys_flow_context: 'denied', wf_context: 'denied', sys_script: 'ok', sys_script_include: 'ok', sys_ui_action: 'ok', sysauto_script: 'ok', sys_db_object: 'ok' },
  };
  return { tabId: 0, status: 'done', result, access, ctx: { origin: 'https://dev457034.service-now.com', table: 'incident', sysId, surface: 'ui16' } };
}
