import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { previewChange } from '../src/preview';

const ID = 'rec1';
function base() {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  c.rows('incident', [{ sys_id: ID, category: 'inquiry', urgency: '3', impact: '3', assignment_group: '', short_description: 'x' }]);
  return c;
}

describe('"E se eu mudar?"', () => {
  it('ordem: client script → BR before (em ordem) → atribuição → BR after com update(); cada etapa vê a anterior', async () => {
    const c = base();
    c.rows('sys_script_client', [{ sys_id: 'cs1', name: 'Sugere urgência', type: 'onChange', field: 'category', table: 'incident', active: 'true', ui_type: '0', script: "function onChange(c, o, newValue) { if (newValue == 'network') g_form.setValue('urgency', '2'); }" }]);
    c.rows('sys_script', [
      { sys_id: 'b2', name: 'Impacto por urgência', when: 'before', order: '200', collection: 'incident', active: 'true', action_update: 'true', script: "if (current.urgency == 2) current.impact = 2;" },
      { sys_id: 'b1', name: 'Rede é prioridade', when: 'before', order: '100', collection: 'incident', active: 'true', action_update: 'true', filter_condition: 'categoryVALCHANGES^EQ', script: "if (current.category == 'network') current.urgency = 2;" },
      { sys_id: 'b3', name: 'Só hardware', when: 'before', order: '100', collection: 'incident', active: 'true', action_update: 'true', filter_condition: 'category=hardware^EQ', script: "current.impact = 1;" },
      { sys_id: 'b4', name: 'Nota depois', when: 'after', order: '100', collection: 'incident', active: 'true', action_update: 'true', filter_condition: 'categoryVALCHANGES^EQ', script: "current.close_notes = 'Rede'; current.update();" },
    ]);
    c.rows('sysrule_assignment', [{ sys_id: 'r1', name: 'Rede', table: 'incident', active: 'true', condition: 'category=network^EQ', group: 'grp_net', order: '100' }]);
    const p = await previewChange(c, { table: 'incident', sysId: ID, field: 'category', value: 'network' });
    expect(p.steps.map((s) => s.name)).toEqual(['Sugere urgência', 'Rede é prioridade', 'Impacto por urgência', 'Rede', 'Nota depois']);
    expect(p.result.impact).toEqual({ from: '3', to: '2', by: 'Impacto por urgência' });
    expect(p.result.assignment_group!.to).toBe('grp_net');
    expect(p.steps.find((s) => s.name === 'Nota depois')!.updatesAgain).toBe(true);
    expect(p.skipped.some((s) => s.name === 'Só hardware')).toBe(true);
  });
  it('UI policy: script do "senão" quando a condição deixa de valer', async () => {
    const c = base();
    c.rows('incident', [{ sys_id: ID, category: 'network', short_description: 'x' }]);
    c.rows('sys_ui_policy', [{ sys_id: 'p1', short_description: 'Fora de rede', table: 'incident', active: 'true', conditions: 'category=network^EQ', run_scripts: 'true', reverse_if_false: 'true', ui_type: '0', script_true: 'function onCondition() {}', script_false: "function onCondition() { g_form.setValue('close_notes', 'Fora de rede'); }" }]);
    const p = await previewChange(c, { table: 'incident', sysId: ID, field: 'category', value: 'software' });
    expect(p.steps[0]).toMatchObject({ kind: 'ui_policy', will: 'yes', writes: [{ field: 'close_notes', value: 'Fora de rede' }] });
  });
  it('regra que roda em toda gravação mas não muda nada não aparece', async () => {
    const c = base();
    c.rows('sys_script', [{ sys_id: 'b9', name: 'Sempre', when: 'before', order: '100', collection: 'incident', active: 'true', action_update: 'true', script: "current.short_description = 'x';" }]);
    const p = await previewChange(c, { table: 'incident', sysId: ID, field: 'urgency', value: '1' });
    expect(p.steps).toHaveLength(0);
  });
});
