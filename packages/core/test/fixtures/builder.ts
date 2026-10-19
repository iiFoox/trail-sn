/**
 * Construtor de cenários sintéticos que reproduzem os sinais observados na PDI (Fase 0).
 * As formas das linhas seguem a Table API (sysparm_display_value=false, campos com ponto
 * para dot-walk). Nenhum dado real: sys_ids gerados, usuários fictícios.
 */
import { FakeRestClient } from '../../src/client/FakeRestClient';
import type { Row } from '../../src/types';

let seq = 0;
export const id = (): string => (0x1000000 + ++seq).toString(16).padStart(32, 'a');

export const T0 = '2026-10-18 01:37:00';
export const INC = { sysId: id(), number: 'INC0010001' };

export function shiftStr(t: string, s: number): string {
  return new Date(new Date(t.replace(' ', 'T') + 'Z').getTime() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

export interface Scenario {
  client: FakeRestClient;
  record: Row;
  audit: Row[];
  tx: Row[];
  events: Row[];
  brs: Row[];
  sis: Row[];
  jobs: Row[];
  uiActions: Row[];
  scriptActions: Row[];
  flows: Row[];
  workflows: Row[];
}

export function scenario(): Scenario {
  const s: Scenario = {
    client: new FakeRestClient(),
    record: { sys_id: INC.sysId, number: INC.number, sys_mod_count: '0', sys_updated_on: T0, sys_updated_by: 'admin' },
    audit: [], tx: [], events: [], brs: [], sis: [], jobs: [], uiActions: [], scriptActions: [], flows: [], workflows: [],
  };
  return s;
}

/** Linha de auditoria; atualiza sys_mod_count para bater com o checkpoint. */
export function audit(s: Scenario, field: string, oldv: string, newv: string, at: string, user: string, checkpoint: number): Row {
  const row = { sys_id: id(), tablename: 'incident', documentkey: INC.sysId, fieldname: field, oldvalue: oldv, newvalue: newv, user, sys_created_on: at, record_checkpoint: String(checkpoint) };
  s.audit.push(row);
  s.record.sys_mod_count = String(Math.max(Number(s.record.sys_mod_count), checkpoint));
  s.record.sys_updated_on = at;
  s.record.sys_updated_by = user;
  return row;
}

export function tx(s: Scenario, at: string, type: string, url: string, by: string): Row {
  const row = { sys_id: id(), sys_created_on: at, type, url, sys_created_by: by };
  s.tx.push(row);
  return row;
}

export function br(s: Scenario, name: string, when: string, script: string, collection = 'incident', order = '100'): Row {
  const row = { sys_id: id(), name, when, order, collection, script, template: '', condition: '', filter_condition: '', active: 'true' };
  s.brs.push(row);
  return row;
}

/** Transação de formulário do UI16, com o valor enviado pelo usuário no parâmetro tabela.campo. */
export function formTx(s: Scenario, at: string, by: string, sent: Record<string, string>, extra = ''): Row {
  const p = new URLSearchParams({ sys_uniqueValue: INC.sysId, ...Object.fromEntries(Object.entries(sent).map(([k, v]) => [`incident.${k}`, v])) });
  return tx(s, at, 'form', `/incident.do?${p}${extra}`, by);
}

/** Monta o cliente com todas as tabelas do cenário. */
export function build(s: Scenario): FakeRestClient {
  const c = s.client;
  c.rows('incident', [s.record]);
  c.rows('sys_db_object', [
    { name: 'incident', 'super_class.name': 'task' },
    { name: 'task', 'super_class.name': '' },
  ]);
  c.rows('sys_script', s.brs);
  c.rows('sys_script_include', s.sis.map((r) => ({ active: 'true', ...r })));
  c.rows('sys_audit', s.audit);
  c.rows('syslog_transaction', s.tx);
  c.rows('sysevent', s.events.map((r) => ({ instance: INC.sysId, ...r })));
  c.rows('sysevent_script_action', s.scriptActions.map((r) => ({ active: 'true', ...r })));
  c.rows('sys_ui_action', s.uiActions);
  c.rows('sysauto_script', s.jobs);
  c.rows('sys_flow_context', s.flows.map((r) => ({ source_record: INC.sysId, ...r })));
  c.rows('wf_context', s.workflows.map((r) => ({ id: INC.sysId, ...r })));
  return c;
}
