import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { compareInstances, describeComparison, normalizedHash, scriptDiff } from '../src/compare';
import type { Row } from '../src/types';

const F = 'state';
const SOURCES = ['sys_script', 'sys_script_client', 'sys_ui_policy', 'sys_ui_policy_action', 'sys_data_policy2', 'sys_data_policy_rule', 'dl_definition_rel_match', 'dl_definition_rel_set',
  'sys_ui_action', 'sys_script_include', 'sysrule_assignment', 'sys_hub_trigger_instance_v2', 'sys_hub_action_instance_v2', 'sysevent_email_action', 'contract_sla',
  'sysauto_script', 'sys_transform_entry', 'sys_documentation', 'sys_choice', 'sys_dictionary_override', 'sys_update_xml', 'sys_update_version', 'sys_update_set',
  'sys_hub_flow', 'dl_definition', 'sys_transform_map'];
const dict = (o: Record<string, string> = {}): Row => ({ sys_id: 'd1', name: 'task', element: F, internal_type: 'integer', max_length: '40', reference: '', default_value: '1', mandatory: 'false', read_only: 'false', active: 'true', dependent: '', dependent_on_field: '', attributes: '', column_label: 'State', sys_updated_on: '2026-01-01 00:00:00', ...o });
const other: Row = { sys_id: 'd2', name: 'task', element: 'priority', internal_type: 'integer', active: 'true' };

/** Instância com tudo legível e vazio, o campo state no dicionário: cada teste declara só o que importa. */
function inst(o: { tables?: Record<string, Row[]>; dict?: Row[] } = {}) {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  for (const t of SOURCES) c.rows(t, []);
  c.rows('sys_dictionary', o.dict ?? [dict(), other]);
  for (const [t, rows] of Object.entries(o.tables ?? {})) c.rows(t, rows);
  return c;
}
const br = (o: Record<string, string>): Row => ({ active: 'true', collection: 'incident', when: 'before', order: '100', action_insert: 'false', action_update: 'true', action_delete: 'false', action_query: 'false',
  filter_condition: 'stateVALCHANGES^EQ', condition: '', template: '', script: "current.work_notes = 'mudou';", sys_updated_on: '2026-01-01 00:00:00', sys_updated_by: 'admin', ...o });
const run = (a: FakeRestClient, b: FakeRestClient, opts = {}) => compareInstances({ client: a, label: 'DEV' }, { client: b, label: 'PROD' }, { table: 'incident', field: F }, opts);

describe('Comparar instâncias: regras do campo', () => {
  it('regra só em A: "só em DEV", com peso máximo', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = inst();
    const c = await run(a, b);
    expect(c.rules).toHaveLength(1);
    expect(c.rules[0]).toMatchObject({ art: 'sys_script', name: 'Set priority', status: 'only_a', roles: ['depends'] });
    expect(c.differences[0]).toMatchObject({ code: 'rule_only', side: 'a', active: true, weight: 100 });
    expect(c.counts).toMatchObject({ onlyA: 1, onlyB: 0, different: 0 });
    expect(describeComparison(c)).toContain("a regra 'Set priority' existe e está ativa só em DEV");
    expect(c.notCompared).toEqual([]);
  });

  it('regra inativa em B: casada pelo sys_id (relida sem filtro de ativo) e "ativa só em DEV"', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority', active: 'false', sys_updated_on: '2026-03-01 10:00:00' })] } });
    const c = await run(a, b);
    expect(c.rules[0]).toMatchObject({ status: 'different', matchedBy: 'sys_id', newer: 'b', a: { active: true }, b: { active: false } });
    expect(c.rules[0]!.diffs).toEqual([{ aspect: 'active', col: 'active', a: 'true', b: 'false' }]);
    expect(c.differences).toEqual([expect.objectContaining({ code: 'rule_active', side: 'a', weight: 100 })]);
    expect(describeComparison(c, 'en')).toContain("the business rule 'Set priority' is active only in DEV");
  });

  it('UI policy com condição diferente: texto com os dois lados e rótulo do campo', async () => {
    const pol = (cond: string): Row => ({ sys_id: 'p1', short_description: 'Bloquear após resolver', table: 'incident', active: 'true', conditions: cond, on_load: 'true', reverse_if_false: 'true', inherit: 'false', global: 'true', view: '', ui_type: '0', order: '100', run_scripts: 'false', script_true: '', script_false: '' });
    const act: Row = { sys_id: 'x1', ui_policy: 'p1', field: F, disabled: 'true', mandatory: 'ignore', visible: 'ignore', 'ui_policy.active': 'true', 'ui_policy.table': 'incident' };
    const doc: Row = { name: 'task', element: F, label: 'State', language: 'en' };
    const a = inst({ tables: { sys_ui_policy: [pol('state=6^EQ')], sys_ui_policy_action: [act], sys_documentation: [doc] } });
    const b = inst({ tables: { sys_ui_policy: [pol('state=7^EQ')], sys_ui_policy_action: [act], sys_documentation: [doc] } });
    const c = await run(a, b, { language: 'en' });
    const r = c.rules[0]!;
    expect(r).toMatchObject({ art: 'sys_ui_policy', status: 'different', matchedBy: 'sys_id' });
    expect(r.roles).toEqual(['depends', 'state']);
    expect(r.diffs).toEqual([{ aspect: 'condition', col: 'conditions', a: 'state=6', b: 'state=7' }]);
    expect(c.differences[0]).toMatchObject({ code: 'rule_condition', weight: 80, a: 'state=6', b: 'state=7' });
    expect(describeComparison(c)).toContain("a UI policy 'Bloquear após resolver' tem condição diferente (DEV: State = 6; PROD: State = 7)");
  });

  it('script diferente: hash normalizado ignora espaços; diff curto aponta a linha; versão e update set de origem', async () => {
    const sa = "var x = 1;\nif (current.state == 6) {\n  current.close_notes = 'ok';\n}";
    const sb = "var  x = 1;   \n\nif (current.state == 7) {\n\tcurrent.close_notes = 'ok';\n}";
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Fecha', script: sa })] } });
    const b = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Fecha', script: sb, sys_updated_on: '2026-05-02 09:00:00', sys_updated_by: 'maria' })],
      sys_update_xml: [{ name: 'sys_script_b1', 'update_set.name': 'US 42 - fechamento', sys_updated_on: '2026-05-02 09:00:00', sys_updated_by: 'maria', payload: '<grande/>' }] } });
    const c = await run(a, b);
    const r = c.rules[0]!;
    expect(r.status).toBe('different');
    const d = r.diffs.find((x) => x.aspect === 'script')!;
    expect(d.hashA).not.toBe(d.hashB);
    expect(d.diff).toMatchObject({ changedA: 1, changedB: 1, more: 0 });
    expect(d.diff!.lines).toHaveLength(2);
    expect(d.diff!.lines).toEqual(expect.arrayContaining([{ side: 'a', n: 2, text: 'if (current.state == 6) {' }, { side: 'b', n: 3, text: 'if (current.state == 7) {' }]));
    expect(r.newer).toBe('b');
    expect(r.versions?.b).toEqual({ name: 'sys_script_b1', updateSet: 'US 42 - fechamento', at: '2026-05-02 09:00:00', by: 'maria', from: 'sys_update_xml' });
    // Não pede o payload do update.
    expect(b.log.find((x) => x.table === 'sys_update_xml')!.fields).not.toContain('payload');
    expect(describeComparison(c)).toContain("a regra 'Fecha' tem script diferente (DEV linha 2; PROD linha 3)");
  });

  it('casa pelo sys_id mesmo com o nome mudado', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Nome antigo' })] } });
    const b = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Nome novo' })] } });
    const c = await run(a, b);
    expect(c.rules).toHaveLength(1);
    expect(c.rules[0]).toMatchObject({ status: 'same', matchedBy: 'sys_id', a: { name: 'Nome antigo' }, b: { name: 'Nome novo' } });
    expect(c.differences).toEqual([]);
    expect(describeComparison(c)).toBe('Nenhuma diferença de comportamento encontrada entre DEV e PROD neste campo.');
  });

  it('casa por tipo + nome + tabela quando o sys_id é diferente', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = inst({ tables: { sys_script: [br({ sys_id: 'b9', name: 'Set priority' }), br({ sys_id: 'b8', name: 'Set priority', collection: 'problem' })] } });
    const c = await run(a, b);
    expect(c.rules).toHaveLength(1);
    expect(c.rules[0]).toMatchObject({ status: 'same', matchedBy: 'name', a: { sysId: 'b1' }, b: { sysId: 'b9' } });
    expect(c.counts).toMatchObject({ onlyA: 0, onlyB: 0, same: 1 });
  });
});

describe('Comparar instâncias: definição do campo', () => {
  it('opção a mais em B e texto de opção diferente', async () => {
    const ch = (v: string, l: string, seq: string, extra: Record<string, string> = {}): Row => ({ name: 'incident', element: F, value: v, label: l, language: 'en', inactive: 'false', sequence: seq, dependent_value: '', ...extra });
    const a = inst({ tables: { sys_choice: [ch('1', 'New', '1'), ch('6', 'Resolved', '6')] } });
    const b = inst({ tables: { sys_choice: [ch('1', 'New', '1'), ch('6', 'Solved', '6'), ch('8', 'Canceled', '8')] } });
    const c = await run(a, b);
    expect(c.definition.choices).toMatchObject({ status: 'different', onlyA: [], onlyB: [{ value: '8', label: 'Canceled' }] });
    expect(c.definition.choices.changed).toEqual([{ value: '6', label: 'Resolved', diffs: [{ col: 'label', a: 'Resolved', b: 'Solved' }] }]);
    expect(c.differences.map((d) => d.code)).toEqual(['choice_only', 'choice_label']);
    const text = describeComparison(c);
    expect(text).toContain("1 diferença que pode explicar comportamentos diferentes: a opção 'Canceled (8)' existe só em PROD.");
    expect(text).toContain("Também difere: o texto da opção '6' é diferente (DEV: Resolved; PROD: Solved).");
  });

  it('dicionário: obrigatório só em PROD; versão do dicionário', async () => {
    const a = inst();
    const b = inst({ dict: [dict({ mandatory: 'true', sys_updated_on: '2026-02-01 00:00:00' }), other] });
    const c = await run(a, b);
    expect(c.definition.dictionary).toMatchObject({ status: 'different', newer: 'b', diffs: [{ aspect: 'condition', col: 'mandatory', a: 'false', b: 'true' }] });
    expect(c.differences[0]).toMatchObject({ code: 'dict', col: 'mandatory', side: 'b' });
    expect(describeComparison(c)).toContain('o campo é obrigatório só em PROD');
    expect(b.log.some((x) => x.table === 'sys_update_xml' && x.query.includes('sys_dictionary_task_state'))).toBe(true);
  });

  it('campo inexistente em B (o dicionário é legível lá): "só existe em DEV"', async () => {
    const a = inst();
    const b = inst({ dict: [other] });
    const c = await run(a, b);
    expect(c.definition.dictionary.status).toBe('missing_b');
    expect(c.differences[0]).toMatchObject({ code: 'field_missing', side: 'a', weight: 110 });
    expect(describeComparison(c)).toContain('o campo só existe em DEV');
  });

  it('dicionário que a sessão não vê em B (vazio para tudo): não conclui que o campo não existe', async () => {
    const a = inst();
    const b = inst({ dict: [] });
    const c = await run(a, b);
    expect(c.definition.dictionary).toMatchObject({ status: 'unknown', unknown: { side: 'b', reason: 'hidden' } });
    expect(c.differences.some((d) => d.code === 'field_missing')).toBe(false);
    expect(describeComparison(c)).toContain('definição do campo (dicionário) (sem acesso em PROD)');
  });
});

describe('Comparar instâncias: sem acesso', () => {
  it('sys_script negada em B: não conclui "só em DEV"; diz que não deu para comparar', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = inst().deny('sys_script');
    const c = await run(a, b);
    expect(c.rules[0]).toMatchObject({ status: 'unknown', unknown: { side: 'b', reason: 'denied' } });
    expect(c.counts.onlyA).toBe(0);
    expect(c.differences.some((d) => d.code === 'rule_only')).toBe(false);
    expect(c.notCompared).toContainEqual(expect.objectContaining({ side: 'b', what: 'business_rules', reason: 'denied' }));
    const text = describeComparison(c);
    expect(text).not.toContain('só em DEV');
    expect(text).toContain('Não deu para comparar: regras de negócio (sem acesso em PROD).');
  });

  it('sem login em B (tudo negado): B inalcançável, nenhuma diferença inventada', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = new FakeRestClient(); // nenhuma tabela: tudo 403
    const c = await run(a, b);
    expect(c.unreachable).toEqual(['b']);
    expect(c.differences).toEqual([]);
    expect(c.rules.every((r) => r.status === 'unknown')).toBe(true);
    expect(describeComparison(c)).toMatch(/^Não deu para ler PROD/);
  });

  it('resumo ordenado: ativa só de um lado > condição > obrigatório (exemplo do dono)', async () => {
    const pol = (cond: string): Row => ({ sys_id: 'p1', short_description: 'Bloquear após resolver', table: 'incident', active: 'true', conditions: cond, on_load: 'true', reverse_if_false: 'true', ui_type: '0', order: '100', run_scripts: 'false' });
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })], sys_ui_policy: [pol('state=6')] } });
    const b = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority', active: 'false' })], sys_ui_policy: [pol('state=7')] }, dict: [dict({ mandatory: 'true' }), other] });
    const c = await run(a, b);
    expect(c.differences.map((d) => d.code)).toEqual(['rule_active', 'rule_condition', 'dict']);
    expect(describeComparison(c)).toBe("3 diferenças que podem explicar comportamentos diferentes: a regra 'Set priority' está ativa só em DEV; a UI policy 'Bloquear após resolver' tem condição diferente (DEV: state = 6; PROD: state = 7); o campo é obrigatório só em PROD.");
  });
});

describe('Comparar instâncias: ações das policies', () => {
  it('mesma UI policy que bloqueia em DEV e libera em PROD: "faz coisas diferentes", em texto simples', async () => {
    const pol: Row = { sys_id: 'p1', short_description: 'Trava estado', table: 'incident', active: 'true', conditions: 'priority=1', ui_type: '0', order: '100', run_scripts: 'false' };
    const act = (disabled: string): Row => ({ sys_id: 'x1', ui_policy: 'p1', field: F, disabled, mandatory: 'ignore', visible: 'ignore', 'ui_policy.active': 'true', 'ui_policy.table': 'incident' });
    const c = await run(inst({ tables: { sys_ui_policy: [pol], sys_ui_policy_action: [act('true')] } }), inst({ tables: { sys_ui_policy: [pol], sys_ui_policy_action: [act('false')] } }));
    expect(c.rules[0]).toMatchObject({ status: 'different', roles: ['state'] });
    expect(c.differences[0]).toMatchObject({ code: 'rule_actions', col: 'sys_ui_policy_action' });
    expect(describeComparison(c)).toContain("a UI policy 'Trava estado' faz coisas diferentes (DEV: bloqueia state; PROD: libera state)");
  });
});

describe('scripts: hash e diff', () => {
  it('hash ignora espaços e linhas vazias; diff de linha inserida', () => {
    expect(normalizedHash('a  =  1;\n\n  b();')).toBe(normalizedHash('a = 1;\nb();   '));
    expect(normalizedHash('a = 1;')).not.toBe(normalizedHash('a = 2;'));
    const d = scriptDiff('a();\nb();\nc();', 'a();\nb();\nnovo();\nc();');
    expect(d).toEqual({ changedA: 0, changedB: 1, lines: [{ side: 'b', n: 3, text: 'novo();' }], more: 0 });
  });
});

describe('P7: lado sem sessão para cedo', () => {
  it('B responde 401 (sem login): poucas chamadas, B inalcançável, nenhuma diferença inventada', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = { calls: 0, async query() { this.calls++; return { rows: [], status: 401, access: 'denied' as const }; } };
    const c = await run(a, b as unknown as FakeRestClient);
    expect(c.unreachable).toEqual(['b']);
    expect(c.differences).toEqual([]);
    expect(c.rules.every((r) => r.status === 'unknown')).toBe(true);
    // A hierarquia (as primeiras consultas, em paralelo) vai; o resto não.
    expect(b.calls).toBeLessThanOrEqual(8); // antes: dezenas (39 no PDI)
    expect(c.timing.calls.b).toBe(b.calls);
  });

  it('B responde 401 com atraso de rede: as consultas em paralelo não passam todas antes da primeira 401 (PDI: 35)', async () => {
    const a = inst({ tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } });
    const b = { calls: 0, async query() { this.calls++; await new Promise((r) => setTimeout(r, 5)); return { rows: [], status: 401, access: 'denied' as const }; } };
    const c = await run(a, b as unknown as FakeRestClient);
    expect(c.unreachable).toEqual(['b']);
    expect(c.differences).toEqual([]);
    expect(b.calls).toBe(2);
  });

  it('lado que responde, com atraso: depois da primeira resposta as consultas seguem e a comparação sai igual', async () => {
    const slow = (x: FakeRestClient) => ({ get calls() { return x.calls; }, async query(req: Parameters<FakeRestClient['query']>[0]) { await new Promise((r) => setTimeout(r, 2)); return x.query(req); } });
    const rows = { tables: { sys_script: [br({ sys_id: 'b1', name: 'Set priority' })] } };
    const c = await run(slow(inst(rows)) as unknown as FakeRestClient, slow(inst()) as unknown as FakeRestClient);
    expect(c.unreachable ?? []).toEqual([]);
    expect(c.rules[0]).toMatchObject({ name: 'Set priority', status: 'only_a' });
  });

  it('B com 403 (sessão com papéis restritos) continua lendo o que puder', async () => {
    const a = inst();
    const b = new FakeRestClient();
    b.rows('sysevent_email_action', []);
    await run(a, b);
    expect(b.log.some((r) => r.table === 'sysevent_email_action')).toBe(true);
  });
});
