import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { recordFlows } from '../src/flows';
import type { Row } from '../src/types';

const SYS = 'a'.repeat(32);
const F1 = '1'.repeat(32), F2 = '2'.repeat(32), F3 = '3'.repeat(32), SUB = '4'.repeat(32);
const inputs = (table: string, condition = '') => JSON.stringify([{ name: 'table', value: table }, { name: 'condition', value: condition }]);

function client() {
  return new FakeRestClient()
    .respond('sys_db_object', (req) => (req.query === 'name=incident' ? [{ 'super_class.name': 'task' }] : req.query === 'name=task' ? [{ 'super_class.name': '' }] : []))
    .respond('sys_flow_context', (): Row[] => [
      { sys_id: 'c1', name: '[PT] Notifica prioridade', state: 'complete', flow: F1, 'flow.sys_class_name': 'sys_hub_flow', sys_created_on: '2026-10-20 12:00:00', sys_updated_on: '2026-10-20 12:00:05' },
      { sys_id: 'c2', name: '[PT] Subflow de aprovação', state: 'error', flow: SUB, 'flow.sys_class_name': 'sys_hub_sub_flow', sys_created_on: '2026-10-20 12:00:01' } as Row,
    ])
    .respond('sys_hub_trigger_instance_v2', (): Row[] => [
      { flow: F1, 'flow.name': '[PT] Notifica prioridade', 'flow.sys_scope.name': 'Global', trigger_type: 'record_update', trigger_inputs: inputs('incident', 'priority=1') },
      { flow: F2, 'flow.name': '[PT] Fecha tarefas', 'flow.sys_scope.name': '[PT] Trail Escopo A', trigger_type: 'record_create_or_update', trigger_inputs: inputs('task') },
      { flow: F3, 'flow.name': '[PT] Outro de problem', trigger_type: 'record_create', trigger_inputs: inputs('problem') } as Row,
    ])
    .respond('sys_hub_action_instance_v2', (req) => (req.query.startsWith(`flow=${F1}`)
      ? [{ order: '1', values: JSON.stringify([{ name: 'values', value: 'urgency=1^notify=2' }]) }]
      : []));
}

describe('aba Flows: o que rodou no registro e o que está configurado na tabela', () => {
  it('lista execuções (com subflow) e só os flows da tabela e das tabelas-pai', async () => {
    const r = await recordFlows(client(), { table: 'incident', sysId: SYS });
    expect(r.tables).toEqual(['incident', 'task']);
    expect(r.runs.map((x) => [x.name, x.state, x.subflow])).toEqual([['[PT] Notifica prioridade', 'complete', false], ['[PT] Subflow de aprovação', 'error', true]]);
    // O de problem fica de fora; o que já rodou aqui vem primeiro.
    expect(r.definitions.map((d) => d.name)).toEqual(['[PT] Notifica prioridade', '[PT] Fecha tarefas']);
    expect(r.definitions[0]).toMatchObject({ ranHere: true, table: 'incident', trigger: 'record_update', writes: ['urgency', 'notify'], scope: 'Global' });
    expect(r.definitions[0]!.condition).not.toBe('');
    expect(r.definitions[1]).toMatchObject({ ranHere: false, table: 'task', condition: '', scope: '[PT] Trail Escopo A' });
  });

  it('sem leitura das execuções, a aba diz isso em vez de mostrar lista vazia', async () => {
    const r = await recordFlows(client().deny('sys_flow_context'), { table: 'incident', sysId: SYS });
    expect(r.access.runs).toBe('denied');
    expect(r.runs).toEqual([]);
    expect(r.definitions.length).toBe(2);
  });
});
