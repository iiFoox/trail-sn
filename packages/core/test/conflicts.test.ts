import { describe, expect, it } from 'vitest';
import { findConflicts } from '../src/conflicts';

const br = (name: string, when: string, order: string, script: string, extra: Record<string, string> = {}) => ({ sys_id: name, name, when, order, collection: 'incident', script, action_insert: 'true', action_update: 'true', ...extra });

describe('regras conflitantes', () => {
  it('duas before sem condição gravando valores diferentes: sempre conflitam e a de ordem maior vence', () => {
    const c = findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';"), br('B', 'before', '200', "current.impact = 2;")], [], {});
    expect(c).toHaveLength(1);
    expect([c[0]!.overlap, c[0]!.winner, c[0]!.why, c[0]!.a.values[0], c[0]!.b.values[0]]).toEqual(['always', 'b', 'higher_order', '1', '2']);
  });
  it('mesmo valor, condições que se excluem, valor calculado ou after sem update: sem alerta', () => {
    expect(findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';"), br('B', 'before', '200', "current.impact = '1';")], [], {})).toEqual([]);
    expect(findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';", { filter_condition: 'state=1' }), br('B', 'before', '200', "current.impact = '2';", { filter_condition: 'state=2' })], [], {})).toEqual([]);
    expect(findConflicts('impact', [br('A', 'before', '100', "if (current.state == '1') current.impact = '1';"), br('B', 'before', '200', "if (current.state == 3) current.impact = '2';")], [], {})).toEqual([]);
    expect(findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';"), br('B', 'before', '200', 'current.impact = current.urgency;')], [], {})).toEqual([]);
    expect(findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';"), br('B', 'after', '200', "current.impact = '2';")], [], {})).toEqual([]);
    expect(findConflicts('impact', [br('A', 'before', '100', "current.impact = '1';", { action_update: 'false' }), br('B', 'before', '200', "current.impact = '2';", { action_insert: 'false' })], [], {})).toEqual([]);
  });
  it('client script contra BR before: o servidor vence; condições que valem agora marcam "now"', () => {
    const c = findConflicts('urgency', [br('S', 'before', '100', "current.urgency = '3';", { filter_condition: 'category=network' })],
      [{ sys_id: 'C', name: 'C', table: 'incident', script: "function onChange(){ g_form.setValue('urgency', '1'); }" }], { category: 'network' });
    expect([c[0]!.a.kind, c[0]!.b.kind, c[0]!.winner, c[0]!.why, c[0]!.overlap]).toEqual(['br_before', 'client_script', 'a', 'server_after_client', 'now']);
    const now = findConflicts('urgency', [br('X', 'before', '100', "current.urgency = '3';", { filter_condition: 'category=network' }), br('Y', 'before', '50', "current.urgency = '2';", { filter_condition: 'category=network' })], [], { category: 'network' });
    expect([now[0]!.overlap, now[0]!.winner]).toEqual(['now', 'a']);
  });
});

describe('regras conflitantes: escopos que se excluem', () => {
  it('prefixos diferentes no filtro, igualdade fora do prefixo, retorno antecipado no client script e sys_id', () => {
    const a = br('A', 'before', '100', "current.impact = '1';", { filter_condition: 'short_descriptionSTARTSWITH[PT] F5-ORDER' });
    const b = br('B', 'before', '200', "current.impact = '2';", { filter_condition: 'short_descriptionSTARTSWITH[PT] F6-' });
    const c = br('C', 'before', '300', "current.impact = '3';", { filter_condition: 'short_description=[PT] F1-X' });
    const cs = { sys_id: 'K', name: 'K', table: 'incident', script: "function onChange(){ if (g_form.getValue('short_description').indexOf('[PT] F5-CLIENT2') != 0) return; g_form.setValue('impact', '2'); }" };
    const cs2 = { sys_id: 'L', name: 'L', table: 'incident', script: "function onChange(){ if (g_form.getUniqueValue() != 'abc') return; g_form.setValue('impact', '3'); }" };
    const cs3 = { sys_id: 'M', name: 'M', table: 'incident', script: "function onChange(){ if (g_form.getUniqueValue() != 'xyz') return; g_form.setValue('impact', '1'); }" };
    expect(findConflicts('impact', [a, b, c], [cs, cs2, cs3], {}).map((k) => k.a.name + k.b.name)).toEqual([]);
  });
  it('mesmo prefixo continua conflito possível', () => {
    const a = br('A', 'before', '100', "current.impact = '1';", { filter_condition: 'short_descriptionSTARTSWITH[PT]' });
    const b = br('B', 'before', '200', "current.impact = '2';", { filter_condition: 'short_descriptionSTARTSWITH[PT] F6' });
    expect(findConflicts('impact', [a, b], [], {}).map((k) => k.overlap)).toEqual(['possible']);
  });
});

import { FakeRestClient } from '../src/client/FakeRestClient';
import { scanTableConflicts, writtenFields } from '../src/conflicts';
describe('varredura de conflitos da tabela', () => {
  it('acha os campos gravados e lista só os conflitos reais da hierarquia', async () => {
    expect(writtenFields("current.impact = 1; g_form.setValue('urgency', '2'); current.x == 3", 'state=6^EQ').sort()).toEqual(['impact', 'state', 'urgency']);
    const c = new FakeRestClient()
      .respond('sys_db_object', (r) => (r.query === 'name=incident' ? [{ 'super_class.name': 'task' }] : [{}]))
      .respond('sys_script', () => [
        br('A', 'before', '100', "current.impact = '1';"),
        br('B', 'before', '200', "current.impact = '2';", { collection: 'task' }),
        br('C', 'before', '100', "current.urgency = '1';", { filter_condition: 'category=network' }),
        br('D', 'before', '200', "current.urgency = '2';", { filter_condition: 'category=software' }),
        br('E', 'before', '100', 'current.state = current.u;'),
      ])
      .respond('sys_script_client', () => []);
    const s = await scanTableConflicts(c, 'incident');
    expect(s.tables).toEqual(['incident', 'task']);
    expect(s.conflicts.map((k) => [k.field, k.a.name, k.b.name, k.overlap, k.winner])).toEqual([['impact', 'A', 'B', 'always', 'b']]);
  });
});
