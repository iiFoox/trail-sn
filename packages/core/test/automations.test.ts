import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { tableAutomations } from '../src/automations';
import type { Row } from '../src/types';

function client() {
  return new FakeRestClient()
    .respond('sys_db_object', (req) => (req.query === 'name=incident' ? [{ 'super_class.name': 'task' }] : req.query === 'name=task' ? [{ 'super_class.name': '' }] : []))
    .respond('sys_script', (): Row[] => [
      { sys_id: 'b2', name: 'Fecha filhas', when: 'after', order: '200', collection: 'task', script: 'var gr = new GlideRecord("task");', action_update: 'true' },
      { sys_id: 'b1', name: 'Calcula prioridade', when: 'before', order: '100', collection: 'incident', script: 'current.priority = new IncidentUtils().calc(current);', action_insert: 'true', action_update: 'true', 'sys_scope.name': 'Global' },
      { sys_id: 'b3', name: 'Mostra aviso', when: 'display', order: '50', collection: 'incident', script: 'g_scratchpad.x = 1;' },
    ])
    .respond('sys_script_include', (req): Row[] => (req.query.includes('IncidentUtils') ? [{ sys_id: 's1', name: 'IncidentUtils' }] : []))
    .respond('sys_script_client', (): Row[] => [{ sys_id: 'c1', name: 'Mostra resolução', type: 'onChange', field: 'state', table: 'incident' }])
    .deny('sys_ui_policy')
    .respond('sys_ui_action', (): Row[] => [{ sys_id: 'u1', name: 'Resolve', table: 'incident', action_name: 'resolve_incident', form_button: 'true' }])
    .respond('dl_definition', () => [])
    .respond('sysrule_assignment', () => [])
    .respond('sysauto_script', () => []);
}

describe('O que roda neste registro (tabela inteira, por tipo)', () => {
  it('regras em ordem de execução, com o que gravam; script include chamado; fontes negadas marcadas', async () => {
    const r = await tableAutomations(client(), { table: 'incident' });
    expect(r.tables).toEqual(['incident', 'task']);
    expect(r.businessRules.map((b) => b.name)).toEqual(['Mostra aviso', 'Calcula prioridade', 'Fecha filhas']);
    expect(r.businessRules[1]).toMatchObject({ writes: ['priority'], scope: 'Global' });
    expect(r.businessRules[1]!.detail).toContain('before');
    expect(r.scriptIncludes).toEqual([expect.objectContaining({ name: 'IncidentUtils', detail: 'chamado por Calcula prioridade' })]);
    expect(r.clientScripts[0]!.detail).toBe('onChange de state');
    expect(r.uiActions[0]!.detail).toContain('resolve_incident');
    expect(r.access.sys_ui_policy).toBe('denied');
    expect(r.uiPolicies).toEqual([]);
    expect(r.flows).toBeUndefined();
  });
});
