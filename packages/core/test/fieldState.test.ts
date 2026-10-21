import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { fieldState } from '../src/fieldState';

const ID = 'rec1';
const F = 'assignment_group';
/** Instância com tudo legível e vazio: cada teste declara só as regras que importam. */
function base(rec: Record<string, string> = { state: '2', category: 'network', priority: '3', assignment_group: 'g1' }) {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  c.rows('incident', [{ sys_id: ID, ...rec }]);
  c.rows('sys_dictionary', [{ sys_id: 'd1', name: 'task', element: F, read_only: 'false', mandatory: 'false', active: 'true', column_label: 'Assignment group' }]);
  for (const t of ['sys_dictionary_override', 'sys_ui_policy_action', 'sys_ui_policy', 'sys_data_policy_rule', 'sys_data_policy2', 'sys_script_client', 'sys_documentation', 'sys_choice']) c.rows(t, []);
  return c;
}
const run = (c: FakeRestClient, observed?: Parameters<typeof fieldState>[1]['observed']) => fieldState(c, { table: 'incident', sysId: ID, field: F, ...(observed ? { observed } : {}) });
const policy = (o: Record<string, string>) => ({ active: 'true', table: 'incident', on_load: 'true', reverse_if_false: 'true', global: 'true', ui_type: '0', run_scripts: 'false', order: '100', ...o });
const action = (o: Record<string, string>) => ({ field: F, disabled: 'ignore', mandatory: 'ignore', visible: 'ignore', 'ui_policy.active': 'true', 'ui_policy.table': 'incident', ...o });

describe('Por que o campo está bloqueado, obrigatório ou escondido', () => {
  it('UI policy com condição verdadeira agora: confirmada, bloqueia', async () => {
    const c = base({ state: '6', assignment_group: 'g1' });
    c.rows('sys_ui_policy', [policy({ sys_id: 'p1', short_description: 'Resolvido trava o grupo', conditions: 'state=6^EQ' })]);
    c.rows('sys_ui_policy_action', [action({ sys_id: 'a1', ui_policy: 'p1', disabled: 'true' })]);
    const r = await run(c, { readOnly: true, mandatory: false, visible: true });
    const rule = r.rules.find((x) => x.kind === 'ui_policy')!;
    expect(rule).toMatchObject({ aspect: 'read_only', sets: true, grade: 'confirmed', why: 'cond_true', sysId: 'p1', table: 'sys_ui_policy', now: { state: '6' } });
    expect(r.aspects.read_only).toMatchObject({ observed: true, rules: true, unexplained: false, mismatch: false });
    expect(r.aclNote).toBe(false);
    expect(r.limited).toBe(false);
  });

  it('reverse_if_false: condição falsa desfaz a ação (libera); sem reverse não se aplica', async () => {
    const c = base({ state: '2' });
    c.rows('sys_ui_policy', [
      policy({ sys_id: 'p1', short_description: 'Obriga ao resolver', conditions: 'state=6^EQ' }),
      policy({ sys_id: 'p2', short_description: 'Trava ao fechar', conditions: 'state=7^EQ', reverse_if_false: 'false' }),
    ]);
    c.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', mandatory: 'true' }), action({ ui_policy: 'p2', disabled: 'true' })]);
    const r = await run(c);
    expect(r.rules.find((x) => x.sysId === 'p1')).toMatchObject({ aspect: 'mandatory', sets: false, grade: 'confirmed', why: 'cond_false_reverse' });
    expect(r.rules.some((x) => x.sysId === 'p2')).toBe(false);
    expect(r.skipped).toEqual([expect.objectContaining({ sysId: 'p2', why: 'cond_false' })]);
    expect(r.aspects.mandatory.rules).toBe(false);
  });

  it('duas policies em conflito: a de ordem maior vence', async () => {
    const c = base({ state: '2', priority: '1' });
    c.rows('sys_ui_policy', [
      policy({ sys_id: 'p2', short_description: 'Crítico libera', conditions: 'priority=1^EQ', order: '200' }),
      policy({ sys_id: 'p1', short_description: 'Em andamento obriga', conditions: 'state=2^EQ', order: '100' }),
    ]);
    c.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', mandatory: 'true' }), action({ ui_policy: 'p2', mandatory: 'false' })]);
    const r = await run(c, { mandatory: false });
    const a = r.aspects.mandatory;
    expect(a.rules).toBe(false);
    expect(r.rules[a.winner!]!.sysId).toBe('p2');
    expect(a.conflicts).toHaveLength(1);
    expect(r.rules[a.conflicts[0]!.loser]!.sysId).toBe('p1');
    expect(r.rules.find((x) => x.sysId === 'p1')!.overriddenBy).toBe(a.winner);
  });

  it('data policy: obriga ao gravar; sem "usar como UI policy" marca que só vale no servidor', async () => {
    const c = base({ state: '6' });
    c.rows('sys_data_policy_rule', [{ sys_id: 'r1', sys_data_policy: 'dp1', field: F, mandatory: 'true', disabled: 'ignore', 'sys_data_policy.active': 'true', 'sys_data_policy.model_table': 'incident' }]);
    c.rows('sys_data_policy2', [{ sys_id: 'dp1', short_description: 'Resolvido exige grupo', model_table: 'incident', conditions: 'state=6', enforce_ui: 'false', active: 'true' }]);
    const r = await run(c);
    expect(r.rules).toEqual([expect.objectContaining({ kind: 'data_policy', aspect: 'mandatory', sets: true, grade: 'confirmed', serverOnly: true, table: 'sys_data_policy2', sysId: 'dp1' })]);
    expect(r.aspects.mandatory.rules).toBe(true);
  });

  it('client script com condição que o Trail não avalia (papel) vira "pode ser"; onChange também', async () => {
    const c = base();
    c.rows('sys_script_client', [
      { sys_id: 'cs1', name: 'Só gestor edita o grupo', type: 'onLoad', table: 'incident', active: 'true', ui_type: '0', global: 'true',
        script: `function onLoad() { if (!g_user.hasRole('itil_admin')) g_form.setReadOnly('${F}', true); }` },
      { sys_id: 'cs2', name: 'Categoria obriga grupo', type: 'onChange', field: 'category', table: 'incident', active: 'true', ui_type: '0', global: 'true',
        script: `function onChange(control, oldValue, newValue, isLoading) { if (isLoading) return; g_form.setMandatory('${F}', newValue == 'network'); }` },
      { sys_id: 'cs3', name: 'Estado fechado esconde', type: 'onLoad', table: 'incident', active: 'true', ui_type: '0', global: 'true',
        script: `function onLoad() { if (g_form.getValue('state') == '7') g_form.setDisplay('${F}', false); }` },
    ]);
    const r = await run(c, { readOnly: true });
    expect(r.rules.find((x) => x.sysId === 'cs1')).toMatchObject({ aspect: 'read_only', sets: true, grade: 'maybe', why: 'onload_unknown' });
    expect(r.rules.find((x) => x.sysId === 'cs2')).toMatchObject({ aspect: 'mandatory', grade: 'maybe', why: 'onchange', trigger: 'category' });
    // state = 2: a condição do terceiro é falsa, então ele nem aparece.
    expect(r.rules.some((x) => x.sysId === 'cs3')).toBe(false);
    expect(r.aspects.read_only).toMatchObject({ rules: false, unexplained: false });
    expect(r.aclNote).toBe(false);
  });

  it('client script onLoad com condição verdadeira: confirmado', async () => {
    const c = base({ state: '7' });
    c.rows('sys_script_client', [{ sys_id: 'cs3', name: 'Fechado esconde', type: 'onLoad', table: 'incident', active: 'true', ui_type: '0', global: 'true',
      script: `function onLoad() { if (g_form.getValue('state') == '7') g_form.setDisplay('${F}', false); }` }]);
    const r = await run(c);
    expect(r.rules).toEqual([expect.objectContaining({ aspect: 'hidden', sets: true, grade: 'confirmed', why: 'onload' })]);
    expect(r.aspects.hidden.rules).toBe(true);
  });

  it('dicionário read_only: bloqueia, e policy que tenta liberar não vence o dicionário', async () => {
    const c = base({ state: '2' });
    c.rows('sys_dictionary', [{ sys_id: 'd1', name: 'task', element: F, read_only: 'true', mandatory: 'false', active: 'true' }]);
    c.rows('sys_ui_policy', [policy({ sys_id: 'p1', short_description: 'Libera em andamento', conditions: 'state=2' })]);
    c.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', disabled: 'false' })]);
    const r = await run(c, { readOnly: true });
    const a = r.aspects.read_only;
    expect(r.rules[a.winner!]).toMatchObject({ kind: 'dictionary', why: 'dict', on: 'task', table: 'sys_dictionary', sysId: 'd1' });
    expect(a.rules).toBe(true);
    expect(a.conflicts).toHaveLength(1);
    expect(r.rules.find((x) => x.sysId === 'p1')!.overriddenBy).toBe(a.winner);
    expect(r.aclNote).toBe(false);
  });

  it('override do dicionário na tabela filha vence o dicionário da tabela-mãe', async () => {
    const c = base();
    c.rows('sys_dictionary', [{ sys_id: 'd1', name: 'task', element: F, read_only: 'false', mandatory: 'true', active: 'true' }]);
    c.rows('sys_dictionary_override', [{ sys_id: 'o1', name: 'incident', element: F, base_table: 'task', mandatory_override: 'true', mandatory: 'false', read_only_override: 'false' }]);
    const r = await run(c, { mandatory: false });
    expect(r.rules.map((x) => [x.kind, x.sets])).toEqual([['dictionary', true], ['dictionary_override', false]]);
    const a = r.aspects.mandatory;
    expect(r.rules[a.winner!]).toMatchObject({ kind: 'dictionary_override', why: 'override', on: 'incident' });
    expect(a.rules).toBe(false);
    expect(a.mismatch).toBe(false);
  });

  it('acesso negado (itil): não inventa regra, lista as fontes e mostra o estado observado', async () => {
    const c = base();
    c.rows('sys_dictionary', []); // itil: vem vazio, não 403
    c.deny('sys_ui_policy').deny('sys_ui_policy_action').deny('sys_script_client').deny('sys_dictionary_override').deny('sys_data_policy_rule');
    const r = await run(c, { readOnly: true, mandatory: true, visible: true });
    expect(r.rules).toEqual([]);
    expect(r.limited).toBe(true);
    expect(r.dictionaryHidden).toBe(true);
    expect(r.denied).toEqual(expect.arrayContaining(['sys_ui_policy', 'sys_ui_policy_action', 'sys_script_client']));
    expect(r.aspects.read_only).toMatchObject({ observed: true, rules: false, unexplained: true });
    expect(r.aspects.mandatory.observed).toBe(true);
    // Nenhuma chamada fora de leitura: o cliente falso só responde a GET de tabela.
    expect(c.log.every((x) => typeof x.query === 'string')).toBe(true);
  });

  it('bloqueado no formulário sem regra encontrada: avisa que pode ser ACL', async () => {
    const c = base();
    const r = await run(c, { readOnly: true, mandatory: false, visible: true });
    expect(r.rules).toEqual([]);
    expect(r.limited).toBe(false);
    expect(r.aspects.read_only).toMatchObject({ observed: true, rules: false, unexplained: true });
    expect(r.aclNote).toBe(true);
  });

  it('policy com condição em script (javascript:) ou registro ilegível vira "pode ser"', async () => {
    const c = base();
    c.rows('sys_ui_policy', [policy({ sys_id: 'p1', short_description: 'VIP', conditions: 'caller_id.vip=true^EQ' }), policy({ sys_id: 'p2', short_description: 'Script', conditions: 'javascript:gs.hasRole("x")' })]);
    c.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', visible: 'false' }), action({ ui_policy: 'p2', disabled: 'true' })]);
    const r = await run(c, { readOnly: true, visible: false });
    expect(r.rules.map((x) => [x.sysId, x.aspect, x.sets, x.grade, x.why])).toEqual([['p2', 'read_only', true, 'maybe', 'cond_unknown'], ['p1', 'hidden', true, 'maybe', 'cond_unknown']]);
    expect(r.aclNote).toBe(false);
    const d = base();
    d.deny('incident');
    d.rows('sys_ui_policy', [policy({ sys_id: 'p1', short_description: 'X', conditions: 'state=6' })]);
    d.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', disabled: 'true' })]);
    const r2 = await run(d);
    expect(r2.recordReadable).toBe(false);
    expect(r2.rules[0]).toMatchObject({ grade: 'maybe', why: 'record_unreadable' });
  });

  it('policy da tabela-mãe sem herança não vale; script da policy entra com a condição', async () => {
    const c = base({ state: '6' });
    c.rows('sys_ui_policy', [
      policy({ sys_id: 'p1', short_description: 'Só em task', table: 'task', inherit: 'false', conditions: '' }),
      policy({ sys_id: 'p2', short_description: 'Script ao resolver', conditions: 'state=6', run_scripts: 'true', script_true: `function onCondition() { g_form.setMandatory('${F}', true); }`, script_false: '' }),
    ]);
    c.rows('sys_ui_policy_action', [action({ ui_policy: 'p1', disabled: 'true', 'ui_policy.table': 'task' })]);
    const r = await run(c);
    expect(r.skipped).toEqual([expect.objectContaining({ sysId: 'p1', why: 'not_inherited' })]);
    expect(r.rules).toEqual([expect.objectContaining({ sysId: 'p2', aspect: 'mandatory', sets: true, grade: 'confirmed' })]);
  });
});
