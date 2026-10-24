import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { describeDependent, fieldDeps, fieldRules, simulateValue, conditionUses, serverReads } from '../src/fieldDeps';
import { fieldMap } from '../src/fieldMap';
import { previewChange } from '../src/preview';
import { SharedClient } from '../src/sharedClient';

const ID = 'rec1';
const SOURCES = ['sys_script', 'sys_script_client', 'sys_ui_policy', 'sys_ui_policy_action', 'sys_data_policy2', 'sys_data_policy_rule', 'dl_definition_rel_match', 'dl_definition_rel_set',
  'sys_ui_action', 'sys_script_include', 'sysrule_assignment', 'sys_hub_trigger_instance_v2', 'sys_hub_action_instance_v2', 'sysevent_email_action', 'contract_sla', 'sys_dictionary',
  'sysauto_script', 'sys_transform_entry', 'sys_documentation', 'sys_choice'];
/** Instância com tudo legível e vazio: cada teste declara só o que importa. */
function base(rec: Record<string, string> = { state: '2', category: 'network', priority: '3', assignment_group: '', close_notes: '' }) {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  c.rows('incident', [{ sys_id: ID, ...rec }]);
  for (const t of SOURCES) c.rows(t, []);
  return c;
}
const br = (o: Record<string, string>) => ({ active: 'true', collection: 'incident', when: 'before', order: '100', action_insert: 'false', action_update: 'true', script: '', ...o });
const trig = (o: { flow: string; name: string; table?: string; condition?: string; type?: string }) => ({
  flow: o.flow, 'flow.name': o.name, 'flow.active': 'true', 'flow.sys_class_name': 'sys_hub_flow', trigger_type: o.type ?? 'record_update',
  trigger_inputs: JSON.stringify([{ name: 'table', value: o.table ?? 'incident' }, ...(o.condition ? [{ name: 'condition', value: o.condition }] : [])]),
});
const deps = (c: FakeRestClient, field = 'state', opts = {}) => fieldDeps(c, { table: 'incident', field }, opts);

describe('leitura de condições e scripts', () => {
  it('conditionUses: termo direto, VALCHANGES, CHANGESTO, dot-walk; ignora campo de nome parecido', () => {
    expect(conditionUses('stateVALCHANGES^state=6^EQ', 'state').map((h) => h.code)).toEqual(['changes', 'condition']);
    expect(conditionUses('stateCHANGESTO6', 'state')).toEqual([{ code: 'changes_to', detail: '6' }]);
    expect(conditionUses('caller_id.vip=true', 'caller_id')).toEqual([{ code: 'dotwalk', detail: 'caller_id.vip' }]);
    expect(conditionUses('incident_state=6^ORstate_x=1', 'state')).toEqual([]);
    expect(conditionUses('priority=1^ORstate=6', 'state')).toEqual([{ code: 'condition' }]);
  });
  it('serverReads: gravar não é ler; changes() é ler', () => {
    expect(serverReads("current.state = 6;", 'state').reads).toBe(false);
    expect(serverReads("if (current.state == 6) current.close_notes = 'x';", 'state').reads).toBe(true);
    expect(serverReads("if (current.state.changesTo(6)) gs.log('x');", 'state')).toEqual({ reads: true, changes: true });
    expect(serverReads("var s = current.getValue('state');", 'state').reads).toBe(true);
  });
});

describe('Quem depende', () => {
  it('BR com VALCHANGES no filtro; BR cujo script lê o campo; BR que só grava o campo fica de fora', async () => {
    const c = base();
    c.rows('sys_script', [
      br({ sys_id: 'b1', name: 'Mudou o estado', filter_condition: 'stateVALCHANGES^EQ', script: "current.work_notes = 'mudou';" }),
      br({ sys_id: 'b2', name: 'Lê o estado', when: 'after', script: "if (current.state == 6) { current.close_notes = 'Resolvido'; current.update(); }" }),
      br({ sys_id: 'b3', name: 'Só grava', script: 'current.state = 2;' }),
    ]);
    const r = await deps(c);
    expect(r.dependents.map((d) => d.name)).toEqual(['Mudou o estado', 'Lê o estado']);
    const b1 = r.dependents[0]!;
    expect(b1).toMatchObject({ phase: 'before', kind: 'br_before', table: 'sys_script', sysId: 'b1', how: [{ code: 'changes' }], does: [{ type: 'write', field: 'work_notes', value: 'mudou' }], cond: 'stateVALCHANGES^EQ' });
    expect(r.dependents[1]).toMatchObject({ phase: 'after', kind: 'br_after', how: [{ code: 'script_reads' }], does: [{ type: 'write', field: 'close_notes', value: 'Resolvido' }] });
    expect(describeDependent(b1).how).toEqual(['dispara quando o campo muda']);
    expect(describeDependent(b1, 'en').does).toEqual(['sets work_notes = mudou']);
    expect(r.denied).toEqual([]);
    expect(r.notSeen).toEqual([]);
  });

  it('client script onChange do campo e onSubmit que lê o campo; onLoad que não lê fica de fora', async () => {
    const c = base();
    c.rows('sys_script_client', [
      { sys_id: 'c1', name: 'Ao mudar estado', type: 'onChange', field: 'state', table: 'incident', active: 'true', ui_type: '0', script: "function onChange(c, o, n) { if (n == 6) { g_form.setMandatory('close_notes', true); g_form.setValue('close_code', 'Solved'); } }" },
      { sys_id: 'c2', name: 'Confere ao salvar', type: 'onSubmit', field: '', table: 'task', active: 'true', ui_type: '0', script: "function onSubmit() { if (g_form.getValue('state') == '6' && !g_form.getValue('close_notes')) return false; }" },
      { sys_id: 'c3', name: 'Outro', type: 'onLoad', field: '', table: 'incident', active: 'true', ui_type: '0', script: "// state\ng_form.addInfoMessage('oi');" },
    ]);
    const r = await deps(c);
    expect(r.dependents.map((d) => d.sysId)).toEqual(['c1', 'c2']); // mesma fase e ordem: por nome
    const c1 = r.dependents.find((d) => d.sysId === 'c1')!;
    expect(c1).toMatchObject({ phase: 'client', how: [{ code: 'onchange' }], scriptType: 'onChange', trigger: 'state' });
    expect(c1.does).toEqual([{ type: 'write', field: 'close_code', value: 'Solved' }, { type: 'form', field: 'close_notes', aspect: 'mandatory', sets: true }]);
    expect(r.dependents.find((d) => d.sysId === 'c2')).toMatchObject({ how: [{ code: 'form_reads' }], does: [{ type: 'abort' }] });
  });

  it('UI policy condicionada ao campo que esconde outro campo; data policy que obriga', async () => {
    const c = base();
    c.rows('sys_ui_policy', [{ sys_id: 'p1', short_description: 'Resolvido esconde', table: 'incident', active: 'true', conditions: 'state=6^EQ', run_scripts: 'false', reverse_if_false: 'true', ui_type: '0', order: '100' }]);
    c.rows('sys_ui_policy_action', [{ sys_id: 'a1', ui_policy: 'p1', field: 'work_notes', disabled: 'ignore', mandatory: 'ignore', visible: 'false' }]);
    c.rows('sys_data_policy2', [{ sys_id: 'dp1', short_description: 'Fechar exige código', model_table: 'incident', active: 'true', conditions: 'state=7^EQ', enforce_ui: 'false' }]);
    c.rows('sys_data_policy_rule', [{ sys_id: 'dr1', sys_data_policy: 'dp1', field: 'close_code', mandatory: 'true', disabled: 'ignore' }]);
    const r = await deps(c);
    const p = r.dependents.find((d) => d.kind === 'ui_policy')!;
    expect(p).toMatchObject({ phase: 'client', how: [{ code: 'condition' }], does: [{ type: 'form', field: 'work_notes', aspect: 'hidden', sets: true }], cond: 'state=6^EQ', reverse: true });
    expect(describeDependent(p)).toEqual({ how: ['a política mostra/esconde/obriga outro campo conforme este'], does: ['esconde work_notes'] });
    const dp = r.dependents.find((d) => d.kind === 'data_policy')!;
    expect(dp).toMatchObject({ phase: 'before', does: [{ type: 'form', field: 'close_code', aspect: 'mandatory', sets: true }] });
    expect(dp.when).toContain('só ao gravar');
  });

  it('flow com condição no campo (e o que grava); flow de outra tabela e sem o campo ficam de fora', async () => {
    const c = base();
    c.rows('sys_hub_trigger_instance_v2', [
      trig({ flow: 'f1', name: 'Avisa resolvido', condition: 'state=6^EQ' }),
      trig({ flow: 'f2', name: 'Outra tabela', table: 'problem', condition: 'state=6^EQ' }),
      trig({ flow: 'f3', name: 'Sem o campo', condition: 'priority=1^EQ' }),
    ]);
    c.rows('sys_hub_action_instance_v2', [{ flow: 'f1', order: '1', values: JSON.stringify([{ name: 'values', value: 'u_resolved=true^close_notes=fd-scripted' }]) }]);
    const r = await deps(c);
    expect(r.dependents).toHaveLength(1);
    // "fd-scripted" é o marcador do Flow Designer para valor calculado por script: não é um valor fixo.
    expect(r.dependents[0]).toMatchObject({ phase: 'async', kind: 'flow', name: 'Avisa resolvido', table: 'sys_hub_flow', sysId: 'f1', how: [{ code: 'condition' }], does: [{ type: 'write', field: 'u_resolved', value: 'true' }, { type: 'write', field: 'close_notes' }], ops: { insert: false, update: true } });
    expect(r.dependents[0]!.does[1]).not.toHaveProperty('value');
  });

  it('notificação, SLA e regra de atribuição', async () => {
    const c = base();
    c.rows('sysevent_email_action', [{ sys_id: 'n1', name: 'Incidente resolvido', collection: 'incident', active: 'true', condition: 'stateCHANGESTO6^EQ', action_insert: 'false', action_update: 'true', generation_type: 'engine', recipient_users: 'NÃO LER' }]);
    c.rows('contract_sla', [{ sys_id: 's1', name: 'Resolução P1', collection: 'incident', active: 'true', start_condition: 'priority=1^EQ', stop_condition: 'stateIN6,7^EQ', pause_condition: 'state=3^EQ' }]);
    c.rows('sysrule_assignment', [{ sys_id: 'r1', name: 'Rede', table: 'incident', active: 'true', condition: 'category=network^EQ', group: 'grp_net', order: '100' }]);
    const r = await deps(c);
    const n = r.dependents.find((d) => d.kind === 'notification')!;
    expect(n).toMatchObject({ phase: 'async', how: [{ code: 'changes_to', detail: '6' }], does: [{ type: 'notify' }] });
    expect(JSON.stringify(n)).not.toContain('NÃO LER'); // destinatários não são lidos
    expect(describeDependent(n).how).toEqual(['dispara quando o campo muda para 6']);
    const s = r.dependents.find((d) => d.kind === 'sla')!;
    expect(s.phase).toBe('after');
    expect(s.stages!.map((x) => x.stage)).toEqual(['pause', 'stop']);
    expect(describeDependent(s).how[1]).toMatch(/^o SLA para conforme o campo/);
    expect(r.dependents.some((d) => d.kind === 'assignment_rule')).toBe(false); // a condição não usa state
    const rc = await deps(c, 'category');
    expect(rc.dependents.find((d) => d.kind === 'assignment_rule')).toMatchObject({ phase: 'before', does: [{ type: 'write', field: 'assignment_group', value: 'grp_net' }] });
  });

  it('incidente: state e incident_state são gêmeos (SLA e notificação com incident_state dependem de state)', async () => {
    const c = base();
    c.rows('sysevent_email_action', [{ sys_id: 'n1', name: 'Incident resolved', collection: 'incident', active: 'true', condition: 'incident_stateCHANGESTO6^universal_requestISEMPTY^EQ', action_insert: 'false', action_update: 'true', generation_type: 'engine' }]);
    c.rows('contract_sla', [{ sys_id: 's1', name: 'Priority 1 resolution', collection: 'incident', active: 'true', start_condition: 'active=true^priority=1^EQ', stop_condition: 'incident_stateIN6,7^EQ', pause_condition: 'incident_state=3^EQ' }]);
    const r = await deps(c);
    expect(r.dependents.find((d) => d.kind === 'notification')).toMatchObject({ how: [{ code: 'changes_to', detail: '6' }] });
    expect(r.dependents.find((d) => d.kind === 'sla')!.stages!.map((x) => x.stage)).toEqual(['pause', 'stop']);
    // Fora do incidente não há gêmeo: em problem, incident_state não é state.
    const p = new FakeRestClient();
    p.rows('sys_db_object', [{ name: 'problem', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
    for (const t of SOURCES) p.rows(t, []);
    p.rows('contract_sla', [{ sys_id: 's2', name: 'X', collection: 'problem', active: 'true', stop_condition: 'incident_stateIN6,7^EQ' }]);
    expect((await fieldDeps(p, { table: 'problem', field: 'state' })).dependents.some((d) => d.kind === 'sla')).toBe(false);
  });

  it('script include chamado por BR que lê o campo', async () => {
    const c = base();
    c.rows('sys_script_include', [
      { sys_id: 'si1', name: 'EstadoUtil', active: 'true', script: "var EstadoUtil = Class.create(); EstadoUtil.prototype = { avisa: function(gr) { if (gr.state == 6) gs.eventQueue('incident.resolvido', gr); } };" },
      { sys_id: 'si2', name: 'NaoChamado', active: 'true', script: 'function x(gr) { return gr.state; }' },
    ]);
    c.rows('sys_script', [br({ sys_id: 'b1', name: 'Chama util', when: 'after', script: 'new EstadoUtil().avisa(current);' })]);
    const r = await deps(c);
    expect(r.dependents).toHaveLength(1);
    expect(r.dependents[0]).toMatchObject({ kind: 'br_via_script_include', name: 'Chama util → EstadoUtil', table: 'sys_script_include', sysId: 'si1', phase: 'after', how: [{ code: 'via_script_include', detail: 'EstadoUtil' }], does: [{ type: 'event', name: 'incident.resolvido' }] });
  });

  it('ordem do ServiceNow: navegador → antes → depois → segundo plano → outro; ordem numérica dentro da fase', async () => {
    const c = base();
    c.rows('sys_script', [
      br({ sys_id: 'b9', name: 'Async', when: 'async', filter_condition: 'state=6^EQ' }),
      br({ sys_id: 'b2', name: 'Before 200', order: '200', filter_condition: 'state=6^EQ' }),
      br({ sys_id: 'b1', name: 'Before 50', order: '50', filter_condition: 'state=6^EQ' }),
      br({ sys_id: 'b3', name: 'After', when: 'after', filter_condition: 'state=6^EQ' }),
    ]);
    c.rows('sys_script_client', [{ sys_id: 'c1', name: 'Cliente', type: 'onChange', field: 'state', table: 'incident', active: 'true', ui_type: '0', script: '' }]);
    c.rows('sys_ui_action', [{ sys_id: 'u1', name: 'Resolver', table: 'incident', active: 'true', condition: 'current.state != 6', script: "current.state = 6; current.update();", order: '100' }]);
    const r = await deps(c);
    expect(r.dependents.map((d) => d.name)).toEqual(['Cliente', 'Before 50', 'Before 200', 'After', 'Async', 'Resolver']);
    expect(r.dependents.at(-1)).toMatchObject({ kind: 'ui_action', how: [{ code: 'script_condition' }], does: [{ type: 'show' }, { type: 'write', field: 'state', value: '6' }] });
  });

  it('acesso negado (403) em várias fontes: nada inventado, a fonte entra em denied e o tipo em notSeen', async () => {
    const c = base();
    c.deny('sys_script').deny('sysevent_email_action').deny('contract_sla').deny('sys_ui_policy_action');
    c.rows('sys_ui_policy', [{ sys_id: 'p1', short_description: 'P', table: 'incident', active: 'true', conditions: 'state=6^EQ', run_scripts: 'false', ui_type: '0' }]);
    const r = await deps(c);
    expect(r.denied.sort()).toEqual(['contract_sla', 'sys_script', 'sys_ui_policy_action', 'sysevent_email_action']);
    expect(r.notSeen).toEqual(expect.arrayContaining(['br_before', 'br_after', 'br_async', 'br_via_script_include', 'notification', 'sla']));
    expect(r.notSeen).not.toContain('reference'); // não foi pedido
    expect(r.effectsUnknown).toEqual(['ui_policy']);
    expect(r.dependents.map((d) => d.kind)).toEqual(['ui_policy']);
    expect(r.dependents[0]!.does).toEqual([]);
    expect(r.access.sys_script).toBe('denied');
    expect(r.access.sys_script_client).toBe('empty');
  });

  it('tabelas que apontam para esta: só para sys_id (ou se pedido)', async () => {
    const c = base();
    c.rows('sys_dictionary', [{ sys_id: 'd1', name: 'problem', element: 'u_incident', column_label: 'Incidente', reference: 'incident', active: 'true' }, { sys_id: 'd2', name: 'task_sla', element: 'task', column_label: 'Task', reference: 'task', active: 'true' }]);
    const r = await deps(c, 'sys_id');
    expect(r.references).toBe(true);
    expect(r.dependents.map((d) => d.name).sort()).toEqual(['problem.u_incident', 'task_sla.task']);
    expect(r.dependents[0]).toMatchObject({ phase: 'other', kind: 'reference', how: [{ code: 'references' }] });
    const s = await deps(c, 'state');
    expect(s.references).toBe(false);
    expect(c.log.filter((x) => x.table === 'sys_dictionary' && x.query.startsWith('reference'))).toHaveLength(1);
    const forced = await deps(c, 'state', { references: true });
    expect(forced.dependents.filter((d) => d.kind === 'reference')).toHaveLength(2);
  });
});

describe('Regras do campo (Quem grava + Quem depende)', () => {
  it('roda as duas partes e lê sys_script, client scripts e flows uma vez só', async () => {
    const c = base();
    c.rows('sys_script', [
      br({ sys_id: 'b1', name: 'Grava estado', script: "current.state = 2;" }),
      br({ sys_id: 'b2', name: 'Lê estado', filter_condition: 'stateVALCHANGES^EQ', script: "current.u_x = 'y';" }),
    ]);
    c.rows('sys_script_client', [{ sys_id: 'c1', name: 'Cliente', type: 'onChange', field: 'category', table: 'incident', active: 'true', ui_type: '0', script: "g_form.setValue('state', '2');" }]);
    c.rows('sys_hub_trigger_instance_v2', [trig({ flow: 'f1', name: 'F', condition: 'state=6^EQ' })]);
    c.rows('sys_hub_action_instance_v2', [{ flow: 'f1', order: '1', values: JSON.stringify([{ name: 'values', value: 'state=7' }]) }]);
    const r = await fieldRules(c, { table: 'incident', field: 'state' });
    expect(r.writers.map((w) => w.name)).toEqual(['Cliente', 'Grava estado', 'F']);
    expect(r.dependents.map((d) => d.name)).toEqual(['Lê estado', 'F']);
    for (const t of ['sys_script', 'sys_script_client', 'sys_ui_policy', 'sys_hub_trigger_instance_v2', 'sys_hub_action_instance_v2', 'sys_ui_action', 'sys_script_include']) {
      expect(c.log.filter((x) => x.table === t), t).toHaveLength(1);
    }
    expect(c.log.filter((x) => x.table === 'sys_db_object')).toHaveLength(2);
    expect(r.timing.calls).toBe(c.calls);
    expect(r.denied).toEqual([]);
  });

  it('negado em fieldRules aparece uma vez, com os tipos que ficaram sem ver', async () => {
    const c = base();
    c.deny('sys_script').deny('sys_hub_trigger_instance_v2');
    const r = await fieldRules(c, { table: 'incident', field: 'state' });
    expect(r.writers).toEqual([]);
    expect(r.dependents).toEqual([]);
    expect(r.denied.sort()).toEqual(['sys_hub_trigger_instance_v2', 'sys_script']);
    expect(r.notSeen).toEqual(expect.arrayContaining(['br_before', 'flow']));
  });

  it('não regressão do fieldMap: BR, client script, policy com script e atribuição', async () => {
    const c = base();
    c.rows('sys_script', [br({ sys_id: 'b1', name: 'Rede', filter_condition: 'category=network^EQ', script: "current.assignment_group = 'g1';" })]);
    c.rows('sys_script_client', [{ sys_id: 'c1', name: 'CS', type: 'onChange', field: 'category', table: 'incident', active: 'true', ui_type: '0', script: "g_form.setValue('assignment_group', 'g2');" },
      { sys_id: 'c2', name: 'Só onChange do campo', type: 'onChange', field: 'assignment_group', table: 'incident', active: 'true', ui_type: '0', script: "g_form.setValue('assigned_to', '');" }]);
    c.rows('sys_ui_policy', [
      { sys_id: 'p1', short_description: 'Com script', table: 'incident', active: 'true', conditions: 'state=6^EQ', run_scripts: 'true', script_true: "function onCondition() { g_form.setValue('assignment_group', 'g3'); }", order: '100' },
      { sys_id: 'p2', short_description: 'Sem executar script', table: 'incident', active: 'true', conditions: 'state=6^EQ', run_scripts: 'false', script_true: "function onCondition() { g_form.setValue('assignment_group', 'g4'); }", order: '100' },
    ]);
    c.rows('sysrule_assignment', [{ sys_id: 'r1', name: 'Atribui', table: 'incident', active: 'true', condition: 'category=network^EQ', group: 'g5', order: '100' }]);
    const m = await fieldMap(c, { table: 'incident', field: 'assignment_group' });
    expect(m.items.map((i) => [i.kind, i.name, i.values])).toEqual([
      ['client_script', 'CS', ['g2']],
      ['ui_policy', 'Com script', ['g3']],
      ['assignment_rule', 'Atribui', ['g5']],
      ['br_before', 'Rede', ['g1']],
    ]);
  });

  it('SharedClient: consulta igual vai uma vez só; prazo estourado não repete (a consulta continua no servidor)', async () => {
    const quick = { calls: 0, async query() { this.calls++; return { rows: [{ a: '1' }], status: 200, access: 'ok' as const }; } };
    const sc = new SharedClient(quick, { timeoutMs: 10 });
    const req = { table: 't', query: 'x=1', fields: ['a'], limit: 1 };
    const [a, b] = await Promise.all([sc.query(req), sc.query(req)]);
    expect(a.rows).toEqual([{ a: '1' }]);
    expect(b).toBe(a);
    expect(sc.calls).toBe(1);
    expect(sc.access.t).toBe('ok');
    const stuck = { calls: 0, query() { this.calls++; return new Promise<never>(() => undefined); } };
    const sc2 = new SharedClient(stuck, { timeoutMs: 5 });
    expect((await sc2.query(req)).access).toBe('timeout');
    expect(sc2.calls).toBe(1);
    expect(sc2.access.t).toBe('timeout');
  });
});

describe('Simular um valor', () => {
  function sim() {
    const c = base({ state: '2', priority: '1', category: 'network', assignment_group: 'g1', close_notes: '' });
    c.rows('sys_script', [br({ sys_id: 'b1', name: 'Nota ao resolver', filter_condition: 'stateCHANGESTO6^EQ', script: "current.close_notes = 'Resolvido';" })]);
    c.rows('sysevent_email_action', [
      { sys_id: 'n1', name: 'Resolvido (P1)', collection: 'incident', active: 'true', condition: 'state=6^priority=1^EQ', action_update: 'true', generation_type: 'engine' },
      { sys_id: 'n2', name: 'Cancelado', collection: 'incident', active: 'true', condition: 'state=8^EQ', action_update: 'true', generation_type: 'engine' },
      { sys_id: 'n3', name: 'Com script', collection: 'incident', active: 'true', condition: 'state=6^EQ', advanced_condition: 'current.caller_id.vip == true', action_update: 'true', generation_type: 'engine' },
      { sys_id: 'n4', name: 'Com OU', collection: 'incident', active: 'true', condition: 'state=6^ORstate=7^EQ', action_update: 'true', generation_type: 'engine' },
      { sys_id: 'n5', name: 'Só ao criar', collection: 'incident', active: 'true', condition: 'state=6^EQ', action_insert: 'true', action_update: 'false', generation_type: 'engine' },
    ]);
    c.rows('contract_sla', [{ sys_id: 's1', name: 'Resolução', collection: 'incident', active: 'true', start_condition: 'priority=1^EQ', stop_condition: 'stateIN6,7^EQ' }]);
    c.rows('task_sla', [{ sys_id: 'ts1', task: ID, sla: 's1', 'sla.name': 'Resolução', stage: 'in_progress', active: 'true' }]);
    c.rows('sys_ui_policy', [{ sys_id: 'p1', short_description: 'Resolvido esconde', table: 'incident', active: 'true', conditions: 'state=6^EQ', run_scripts: 'false', reverse_if_false: 'true', ui_type: '0', order: '100' }]);
    c.rows('sys_ui_policy_action', [{ sys_id: 'a1', ui_policy: 'p1', field: 'work_notes', visible: 'false', disabled: 'ignore', mandatory: 'ignore' }]);
    return c;
  }
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);

  it('condição verdadeira roda, falsa não roda, não avaliável vira "pode rodar"; une com os passos que gravam', async () => {
    const c = sim();
    const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
    expect(s.from).toBe('2');
    // "Com OU" (state=6^ORstate=7) roda: desde P1 o ^OR é avaliado.
    expect(names(s.runs)).toEqual(['Resolvido esconde', 'Nota ao resolver', 'Resolução', 'Com OU', 'Resolvido (P1)']);
    expect(s.runs.find((x) => x.name === 'Nota ao resolver')).toMatchObject({ why: 'preview', writes: [{ field: 'close_notes', value: 'Resolvido' }] });
    expect(s.runs.find((x) => x.name === 'Resolvido esconde')).toMatchObject({ why: 'policy_true', effects: [{ type: 'form', field: 'work_notes', aspect: 'hidden', sets: true }] });
    expect(s.runs.find((x) => x.name === 'Resolução')).toMatchObject({ why: 'sla_stage', effects: [{ type: 'sla', stage: 'stop' }] });
    expect(s.runs.find((x) => x.name === 'Resolvido (P1)')).toMatchObject({ why: 'cond_true', effects: [{ type: 'notify' }] });
    expect(s.runs.find((x) => x.name === 'Com OU')).toMatchObject({ why: 'cond_true' });
    expect(names(s.maybe).sort()).toEqual(['Com script']);
    expect(s.maybe.every((x) => x.why === 'cond_unknown')).toBe(true);
    expect(s.wontRun.map((x) => [x.name, x.why])).toEqual(expect.arrayContaining([['Cancelado', 'cond_false'], ['Só ao criar', 'not_on_update']]));
    expect(s.preview.result.close_notes).toEqual({ from: '', to: 'Resolvido', by: 'Nota ao resolver' });
    expect(s.recordReadable).toBe(true);
    // O registro é lido uma vez só (a previsão e o simulador compartilham a consulta).
    expect(c.log.filter((x) => x.table === 'incident')).toHaveLength(1);
  });

  it('outro valor: a policy deixa de valer e desfaz; notificação e SLA não rodam', async () => {
    const c = sim();
    c.rows('incident', [{ sys_id: ID, state: '6', priority: '1', close_notes: 'x' }]);
    const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '2' });
    expect(s.runs.find((x) => x.name === 'Resolvido esconde')).toMatchObject({ why: 'policy_false_reverse', effects: [{ type: 'form', field: 'work_notes', aspect: 'hidden', sets: false }] });
    expect(s.wontRun.find((x) => x.name === 'Resolvido (P1)')!.why).toBe('cond_false');
    expect(s.wontRun.find((x) => x.name === 'Resolução')!.why).toBe('sla_none');
    expect(s.wontRun.find((x) => x.name === 'Nota ao resolver')!.why).toBe('cond_false');
  });

  it('registro ilegível: nada vira certeza; fontes negadas ficam em denied', async () => {
    const c = sim();
    c.deny('incident').deny('contract_sla');
    const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
    expect(s.recordReadable).toBe(false);
    expect(s.runs.find((x) => x.name === 'Resolvido (P1)')).toBeUndefined();
    expect(names(s.maybe)).toContain('Resolvido (P1)');
    expect(s.denied).toEqual(expect.arrayContaining(['incident', 'contract_sla']));
    expect(s.notSeen).toContain('sla');
    expect([...s.runs, ...s.maybe, ...s.wontRun].some((x) => x.kind === 'sla')).toBe(false);
  });

  it('não regressão: previewChange continua igual com o cliente compartilhado', async () => {
    const c = sim();
    const direct = await previewChange(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
    const viaShared = await previewChange(new SharedClient(sim()), { table: 'incident', sysId: ID, field: 'state', value: '6' });
    const strip = (p: typeof direct) => ({ ...p, timing: undefined });
    expect(strip(viaShared)).toEqual(strip(direct));
    expect(direct.steps.map((x) => x.name)).toEqual(['Nota ao resolver']);
  });

  describe('P4: SLAs anexadas (task_sla)', () => {
    // PDI 21/10/2026, INC0010187 state→6: "Priority 3 resolution (1 day)" está em task_sla; as duas "ATF – …" não.
    function slas() {
      const c = sim();
      c.rows('contract_sla', [
        { sys_id: 'p3', name: 'Priority 3 resolution (1 day)', collection: 'incident', active: 'true', start_condition: 'priority=3^EQ', stop_condition: 'incident_stateIN6,7^EQ', pause_condition: 'incident_state=3^EQ' },
        { sys_id: 'atf1', name: 'ATF – Resolution', collection: 'incident', active: 'true', start_condition: 'short_descriptionSTARTSWITHATF^EQ', stop_condition: 'stateIN6,7^EQ' },
        { sys_id: 'atf2', name: 'ATF – Restart', collection: 'incident', active: 'true', start_condition: 'state=6^EQ' },
      ]);
      c.rows('task_sla', [{ sys_id: 'ts1', task: ID, sla: 'p3', 'sla.name': 'Priority 3 resolution (1 day)', stage: 'in_progress', active: 'true' }]);
      return c;
    }

    it('só para a SLA anexada; as outras dizem "definição existe, não anexada"', async () => {
      const c = slas();
      const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
      expect(s.runs.find((x) => x.name === 'Priority 3 resolution (1 day)')).toMatchObject({ why: 'sla_stage', slaAttached: true, effects: [{ type: 'sla', stage: 'stop' }] });
      expect(s.wontRun.find((x) => x.name === 'ATF – Resolution')).toMatchObject({ why: 'sla_not_attached', slaAttached: false });
      // Começaria pela condição, e não está anexada: começa.
      expect(s.runs.find((x) => x.name === 'ATF – Restart')).toMatchObject({ why: 'sla_stage', slaAttached: false, effects: [{ type: 'sla', stage: 'start' }] });
      expect(c.log.filter((x) => x.table === 'task_sla')).toEqual([expect.objectContaining({ query: `task=${ID}^active=true` })]);
    });

    it('início de SLA já anexada não roda', async () => {
      const c = slas();
      c.rows('task_sla', [{ sys_id: 'ts2', task: ID, sla: 'atf2', active: 'true' }]);
      const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
      expect(s.wontRun.find((x) => x.name === 'ATF – Restart')).toMatchObject({ why: 'sla_already_attached', slaAttached: true });
    });

    it('sem leitura de task_sla: a SLA fica em "pode rodar"', async () => {
      const c = slas();
      c.deny('task_sla');
      const s = await simulateValue(c, { table: 'incident', sysId: ID, field: 'state', value: '6' });
      expect(s.maybe.find((x) => x.name === 'Priority 3 resolution (1 day)')).toMatchObject({ why: 'sla_attach_unknown' });
      expect(s.maybe.find((x) => x.name === 'ATF – Resolution')!.slaAttached).toBeUndefined();
      expect(s.denied).toContain('task_sla');
    });

    it('fieldDeps de um registro marca anexada / não anexada, com texto', async () => {
      const c = slas();
      const d = await fieldDeps(c, { table: 'incident', field: 'state', sysId: ID });
      expect(d.attachedSlas).toEqual([{ sla: 'p3', name: 'Priority 3 resolution (1 day)', stage: 'in_progress' }]);
      const p3 = d.dependents.find((x) => x.sysId === 'p3')!, atf = d.dependents.find((x) => x.sysId === 'atf1')!;
      expect(p3.attached).toBe(true);
      expect(atf.attached).toBe(false);
      expect(describeDependent(atf).how).toContain('a definição existe, mas não está anexada a este registro');
      expect(describeDependent(p3, 'en').how).toContain('is attached to this record');
      // Sem registro: não lê task_sla e não marca nada.
      const plain = await fieldDeps(slas(), { table: 'incident', field: 'state' });
      expect(plain.attachedSlas).toBeUndefined();
      expect(plain.dependents.find((x) => x.sysId === 'p3')!.attached).toBeUndefined();
    });
  });
});

describe('P7: when=before_display', () => {
  it('BR before_display entra como before', async () => {
    const c = base();
    c.rows('sys_script', [br({ sys_id: 'bd', name: 'Antes de mostrar', when: 'before_display', filter_condition: 'stateVALCHANGES^EQ', script: "current.u_x = 'y';" })]);
    const d = await fieldDeps(c, { table: 'incident', field: 'state' });
    expect(d.dependents.find((x) => x.sysId === 'bd')).toMatchObject({ phase: 'before', kind: 'br_before' });
  });
});
