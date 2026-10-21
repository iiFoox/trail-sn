import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { describeVisibility, parseEncoded, readQueryScript, visibility, DYNAMIC_ME } from '../src/visibility';
import type { Row } from '../src/types';

const ID = 'a'.repeat(32);
const BETH = '1'.repeat(32); // solicitante do chamado
const ABEL = '2'.repeat(32); // sem relação com o chamado
const ADM = '3'.repeat(32);
const G1 = '9'.repeat(32);
const ITIL = 'r1'.padEnd(32, '0');

/** OOB "incident query" (Washington): quem não é itil só vê os chamados em que é solicitante, abriu ou está na watch list. */
const INCIDENT_QUERY = `if (!gs.hasRole("itil") && !gs.hasRole("sn_incident_read") && gs.isInteractive()) {
	var u = gs.getUserID();
	var qc = current.addQuery("caller_id", u).addOrCondition("opened_by", u).addOrCondition("watch_list", "CONTAINS", u);
	gs.print("query restricted to user: " + u);
}`;

interface Opts { rec?: Row; brs?: Row[]; acls?: Row[]; aclRoles?: Row[]; roles?: Row[]; groups?: Row[] }
function base(o: Opts = {}) {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  c.rows('incident', [{ sys_id: ID, caller_id: BETH, opened_by: ADM, watch_list: '', active: 'true', assignment_group: G1, sys_domain: 'global', ...o.rec }]);
  c.rows('sys_script', o.brs ?? []);
  c.rows('sys_security_acl', o.acls ?? []);
  c.rows('sys_security_acl_role', o.aclRoles ?? []);
  c.rows('sys_user', [
    { sys_id: BETH, user_name: 'beth.anglin', name: 'Beth Anglin', active: 'true' },
    { sys_id: ABEL, user_name: 'abel.tuter', name: 'Abel Tuter', active: 'true' },
    { sys_id: ADM, user_name: 'admin', name: 'System Administrator', active: 'true' },
  ]);
  c.rows('sys_user_has_role', o.roles ?? []);
  c.rows('sys_user_grmember', o.groups ?? []);
  return c;
}
const br = (o: Row) => ({ sys_id: 'br1', name: 'incident query', collection: 'incident', when: 'before', action_query: 'true', active: 'true', order: '100', condition: '', script: INCIDENT_QUERY, ...o });
const acl = (o: Row) => ({ sys_id: 'acl1', name: 'incident', 'operation.name': 'read', 'type.name': 'record', active: 'true', condition: '', script: '', advanced: 'false', admin_overrides: 'true', ...o });
const aclRole = (acl: string, role: string) => ({ sys_security_acl: acl, sys_user_role: `${role}id`, 'sys_user_role.name': role });
const hasRole = (user: string, role: string, o: Row = {}) => ({ user, role: role === 'itil' ? ITIL : `${role}id`, 'role.name': role, inherited: 'false', state: 'active', ...o });
const run = (c: FakeRestClient, user?: string, fields?: string[]) => visibility(c, { table: 'incident', sysId: ID, ...(user ? { user } : {}) }, fields ? { fields } : {});

/** ACLs que deixam todo mundo ver (para isolar a regra before query). */
const OPEN_ACLS = { acls: [acl({ sys_id: 'open', name: 'incident' }), acl({ sys_id: 'openf', name: 'incident.*' })] };

describe('Quem enxerga este registro: regras antes da consulta (before query)', () => {
  it('lê o "incident query" OOB: papéis, sessão pela tela e os três filtros em OU', () => {
    const r = readQueryScript(INCIDENT_QUERY);
    expect(r.readable).toBe('full');
    expect(r.branches).toHaveLength(1);
    const b = r.branches[0]!;
    expect(b.guards[0]!.atoms).toEqual([
      { kind: 'role', roles: ['itil'], has: false }, { kind: 'role', roles: ['sn_incident_read'], has: false }, { kind: 'interactive', is: true },
    ]);
    expect(b.groups).toEqual([{ terms: [
      { field: 'caller_id', op: '=', value: { kind: 'me' } },
      { field: 'opened_by', op: '=', value: { kind: 'me' } },
      { field: 'watch_list', op: 'CONTAINS', value: { kind: 'me' } },
    ] }]);
  });

  it('sem pessoa: explica em linguagem simples quem fica restrito e a quê', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS }));
    expect(v.combined.verdict).toBe('nao_da_para_afirmar');
    expect(v.notes).toContain('generic');
    const t = describeVisibility(v);
    expect(t).toContain('quem não tem o papel itil, não tem o papel sn_incident_read e está usando a tela (sessão interativa) só vê os registros em que caller_id é a própria pessoa, opened_by é a própria pessoa ou watch_list contém a própria pessoa');
    expect(describeVisibility(v, 'en')).toContain("whoever doesn't have the itil role");
  });

  it('pessoa sem itil que é a solicitante: o filtro vale, mas o registro passa → vê', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS }), 'beth.anglin');
    expect(v.user).toMatchObject({ sysId: BETH, userName: 'beth.anglin' });
    expect(v.filters[0]).toMatchObject({ hides: false });
    expect(v.filters[0]!.branches[0]).toMatchObject({ applies: true, recordMatches: true });
    expect(v.combined.verdict).toBe('ve');
    expect(v.notes).toContain('interactive_assumed');
  });

  it('pessoa sem itil e sem relação com o chamado: o filtro esconde → não vê', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS }), ABEL);
    expect(v.filters[0]!.hides).toBe(true);
    expect(v.combined).toMatchObject({ verdict: 'nao_ve' });
    expect(v.combined.why).toContain('filter_hides:incident query');
    expect(describeVisibility(v)).toContain('→ Esta regra esconde o registro de Abel Tuter.');
  });

  it('pessoa com itil (herdado de grupo): o filtro não vale para ela', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS, roles: [hasRole(ABEL, 'itil', { inherited: 'true' })] }), 'abel.tuter');
    expect(v.filters[0]!.branches[0]!.applies).toBe(false);
    expect(v.filters[0]!.hides).toBe(false);
    expect(v.userRoles).toMatchObject({ names: ['itil'], inherited: ['itil'], known: true });
    expect(v.combined.verdict).toBe('ve');
  });

  it('papel pendente (state != active) não conta', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS, roles: [hasRole(ABEL, 'itil', { state: 'requested' })] }), 'abel.tuter');
    expect(v.userRoles!.names).toEqual([]);
    expect(v.filters[0]!.hides).toBe(true);
  });

  it('script que entrega o registro a outra função: pode restringir, não afirma', async () => {
    const v = await run(base({ brs: [br({ name: 'filtro custom', script: 'new MyQueryFilter().restrict(current);' })], ...OPEN_ACLS }), BETH);
    expect(v.filters[0]).toMatchObject({ readable: 'none', delegates: ['MyQueryFilter.restrict'] });
    expect(v.filters[0]!.hides).toBeUndefined();
    expect(v.combined.verdict).toBe('nao_da_para_afirmar');
    expect(describeVisibility(v)).toContain('pode restringir quem vê (script não avaliado)');
  });

  it('else e return antecipado viram condições; addEncodedQuery com getMyGroups é lido', () => {
    const r = readQueryScript(`(function executeRule(current, previous) {
  if (gs.hasRole('admin')) return;
  if (gs.getUser().isMemberOf('Service Desk')) {
    current.addEncodedQuery('assignment_group=javascript:getMyGroups()^ORassigned_to=javascript:gs.getUserID()');
  } else {
    current.addActiveQuery();
  }
})(current, previous);`);
    expect(r.readable).toBe('full');
    expect(r.delegates).toEqual([]);
    expect(r.branches).toHaveLength(2);
    expect(r.branches[0]!.guards.map((g) => g.atoms)).toEqual([[{ kind: 'role', roles: ['admin'], has: false }], [{ kind: 'group', group: 'Service Desk', member: true }]]);
    expect(r.branches[0]!.groups[0]!.terms.map((t) => t.value.kind)).toEqual(['my_groups', 'me']);
    expect(r.branches[1]!.guards.map((g) => g.atoms)).toEqual([[{ kind: 'role', roles: ['admin'], has: false }], [{ kind: 'group', group: 'Service Desk', member: false }]]);
    expect(r.branches[1]!.groups).toEqual([{ terms: [{ field: 'active', op: '=', value: { kind: 'literal', value: 'true' } }] }]);
  });

  it('encoded query com filtro dinâmico "Me"', () => {
    expect(parseEncoded(`caller_idDYNAMIC${DYNAMIC_ME}^active=true`).groups).toEqual([
      { terms: [{ field: 'caller_id', op: '=', value: { kind: 'me' } }] },
      { terms: [{ field: 'active', op: '=', value: { kind: 'literal', value: 'true' } }] },
    ]);
  });
});

describe('Quem enxerga este registro: ACLs de leitura', () => {
  const roleAcl = { acls: [acl({ sys_id: 'a1', name: 'incident', admin_overrides: 'false' }), acl({ sys_id: 'f1', name: 'incident.*' })], aclRoles: [aclRole('a1', 'itil')] };

  it('ACL só com papel: quem tem o papel vê', async () => {
    const v = await run(base({ ...roleAcl, roles: [hasRole(ABEL, 'itil')] }), ABEL);
    const a = v.acls.find((x) => x.sysId === 'a1')!;
    expect(a).toMatchObject({ level: 'table', roles: ['itil'], roleOk: true, passes: true, used: true });
    expect(v.levels.table).toMatchObject({ key: 'incident', ok: true });
    expect(v.combined.verdict).toBe('ve');
    expect(describeVisibility(v)).toContain('tem o papel ✓');
  });

  it('ACL só com papel: quem não tem o papel não vê, e o texto diz qual falta', async () => {
    const v = await run(base(roleAcl), ABEL);
    expect(v.acls.find((x) => x.sysId === 'a1')).toMatchObject({ roleOk: false, missingRoles: ['itil'], passes: false });
    expect(v.combined).toMatchObject({ verdict: 'nao_ve' });
    expect(v.combined.why).toContain('table_fail');
    expect(describeVisibility(v)).toContain('falta o papel itil ✗');
  });

  it('ACLs da mesma chave são OU: basta uma passar', async () => {
    const v = await run(base({ acls: [...roleAcl.acls, acl({ sys_id: 'a2', name: 'incident', condition: 'caller_id=javascript:gs.getUserID()', admin_overrides: 'false' })], aclRoles: roleAcl.aclRoles }), BETH);
    expect(v.acls.find((x) => x.sysId === 'a1')!.passes).toBe(false);
    expect(v.acls.find((x) => x.sysId === 'a2')).toMatchObject({ conditionOk: true, passes: true, now: { caller_id: BETH } });
    expect(v.combined.verdict).toBe('ve');
  });

  it('condição verdadeira e falsa com os valores do registro', async () => {
    const acls = [acl({ sys_id: 'c1', name: 'incident', condition: 'active=true^EQ', admin_overrides: 'false' }), acl({ sys_id: 'f1', name: 'incident.*' })];
    const yes = await run(base({ acls }), ABEL);
    expect(yes.acls.find((x) => x.sysId === 'c1')).toMatchObject({ conditionOk: true, passes: true, now: { active: 'true' } });
    expect(yes.combined.verdict).toBe('ve');
    const no = await run(base({ acls, rec: { active: 'false' } }), ABEL);
    expect(no.acls.find((x) => x.sysId === 'c1')).toMatchObject({ conditionOk: false, passes: false });
    expect(no.combined.verdict).toBe('nao_ve');
    expect(describeVisibility(no)).toContain('condição não vale ✗');
  });

  it('ACL com script: não é avaliada, o veredito fica em "provável"', async () => {
    const acls = [acl({ sys_id: 's1', name: 'incident', advanced: 'true', script: 'answer = new TaskUtils().canRead(current);', admin_overrides: 'false' }), acl({ sys_id: 'f1', name: 'incident.*' })];
    const v = await run(base({ acls, aclRoles: [aclRole('s1', 'itil')], roles: [hasRole(ABEL, 'itil')] }), ABEL);
    expect(v.acls.find((x) => x.sysId === 's1')).toMatchObject({ script: true, roleOk: true, passes: undefined });
    expect(v.levels.table).toMatchObject({ ok: undefined, lean: true });
    expect(v.combined.verdict).toBe('provavel_ve');
    expect(describeVisibility(v)).toContain('script: não verificado');
    // Sem o papel, a mesma ACL falha com certeza.
    const w = await run(base({ acls, aclRoles: [aclRole('s1', 'itil')] }), ABEL);
    expect(w.combined.verdict).toBe('nao_ve');
  });

  it('tabela.* e tabela.campo: o nível campo é E com a tabela; a chave do campo vence a do *', async () => {
    const acls = [acl({ sys_id: 't1', name: 'incident' }), acl({ sys_id: 'w1', name: 'incident.*', admin_overrides: 'false' }), acl({ sys_id: 'd1', name: 'incident.short_description' })];
    const v = await run(base({ acls, aclRoles: [aclRole('w1', 'itil')] }), ABEL, ['short_description']);
    expect(v.levels.table.ok).toBe(true);
    expect(v.levels.field).toMatchObject({ key: 'incident.*', ok: false });
    expect(v.levels.fields.short_description).toMatchObject({ key: 'incident.short_description', ok: true });
    expect(v.combined.verdict).toBe('nao_ve');
    expect(v.combined.why).toEqual(expect.arrayContaining(['table_ok', 'field_fail']));
    expect(describeVisibility(v)).toContain('nível da tabela (a linha aparece) E no dos campos');
  });

  it('herança: sem ACL em incident vale a de task; com ACL em incident, a de task não entra', async () => {
    const onlyTask = await run(base({ acls: [acl({ sys_id: 'k1', name: 'task', admin_overrides: 'false' }), acl({ sys_id: 'kf', name: 'task.*' })], aclRoles: [aclRole('k1', 'itil')] }), ABEL);
    expect(onlyTask.levels.table).toMatchObject({ key: 'task', ok: false });
    expect(onlyTask.levels.field).toMatchObject({ key: 'task.*', ok: true });
    expect(onlyTask.combined.verdict).toBe('nao_ve');
    const c = base({ acls: [acl({ sys_id: 'k1', name: 'task', admin_overrides: 'false' }), acl({ sys_id: 'i1', name: 'incident' }), acl({ sys_id: 'kf', name: 'task.*' })], aclRoles: [aclRole('k1', 'itil')] });
    const both = await run(c, ABEL);
    expect(both.levels.table).toMatchObject({ key: 'incident', ok: true });
    expect(both.acls.find((x) => x.sysId === 'k1')!.used).toBe(false);
    expect(both.combined.verdict).toBe('ve');
    // A consulta pediu as chaves da hierarquia inteira e o *.
    expect(c.log.find((r) => r.table === 'sys_security_acl')!.query).toBe('nameINincident,incident.*,task,task.*,*,*.*^active=true');
  });

  it('admin_overrides: admin passa mesmo com script; sem admin_overrides, o script segura a certeza', async () => {
    const acls = (ov: string) => [acl({ sys_id: 's1', name: 'incident', advanced: 'true', script: 'answer = false;', admin_overrides: ov }), acl({ sys_id: 'f1', name: 'incident.*' })];
    const roles = [hasRole(ADM, 'admin')];
    const ov = await run(base({ acls: acls('true'), aclRoles: [aclRole('s1', 'itil')], roles }), 'admin');
    expect(ov.acls.find((x) => x.sysId === 's1')).toMatchObject({ byAdmin: true, passes: true });
    expect(ov.combined.verdict).toBe('ve');
    expect(describeVisibility(ov)).toContain('admin passa direto (admin_overrides) ✓');
    const no = await run(base({ acls: acls('false'), aclRoles: [aclRole('s1', 'itil')], roles }), 'admin');
    expect(no.acls.find((x) => x.sysId === 's1')).toMatchObject({ roleOk: true, passes: undefined });
    expect(no.combined.verdict).toBe('provavel_ve');
  });

  it('"nega a menos que" (decision_type=deny): precisa passar também', async () => {
    const acls = [acl({ sys_id: 'a1', name: 'incident' }), acl({ sys_id: 'dn', name: 'incident', decision_type: 'deny', condition: 'active=true', admin_overrides: 'false' }), acl({ sys_id: 'f1', name: 'incident.*' })];
    const v = await run(base({ acls, rec: { active: 'false' } }), ABEL);
    expect(v.notes).toContain('deny_unless');
    expect(v.acls.find((x) => x.sysId === 'dn')).toMatchObject({ decision: 'deny', passes: false, used: true });
    expect(v.combined.verdict).toBe('nao_ve');
  });

  it('ACL de outra operação (write) ou sem nome de operação fica de fora', async () => {
    const v = await run(base({ acls: [acl({ sys_id: 'wr', name: 'incident', 'operation.name': 'write' }), acl({ sys_id: 'op', name: 'incident', 'operation.name': '', operation: '8'.repeat(32) }), ...OPEN_ACLS.acls] }), ABEL);
    expect(v.acls.map((a) => a.sysId).sort()).toEqual(['open', 'openf']);
    expect(v.notes).toContain('acl_op_unknown');
  });
});

describe('Quem enxerga este registro: sem acesso e pessoa inexistente', () => {
  it('usuário inexistente: diz que não achou e não afirma nada', async () => {
    const v = await run(base({ brs: [br({})], ...OPEN_ACLS }), 'ninguem.aqui');
    expect(v.user).toBeUndefined();
    expect(v.notes).toContain('user_not_found');
    expect(v.combined.verdict).toBe('nao_da_para_afirmar');
    expect(v.combined.why[0]).toBe('user_not_found');
    expect(describeVisibility(v)).toContain('Não achei o usuário "ninguem.aqui"');
  });

  it('sys_security_acl negada (403): não inventa regras; mostra o filtro e os papéis da pessoa', async () => {
    const c = base({ brs: [br({})], roles: [hasRole(ABEL, 'itil')] });
    c.deny('sys_security_acl');
    const v = await run(c, ABEL);
    expect(v.acls).toEqual([]);
    expect(v.notes).toContain('acl_denied');
    expect(v.denied).toContain('sys_security_acl');
    expect(v.userRoles!.names).toEqual(['itil']);
    expect(v.filters[0]!.hides).toBe(false);
    expect(v.combined.verdict).toBe('nao_da_para_afirmar');
    const t = describeVisibility(v);
    expect(t).toContain('Seus papéis não deixam ver as regras de acesso');
    expect(t).not.toContain('falta o papel');
    // Não chegou a pedir os papéis das ACLs.
    expect(c.log.some((r) => r.table === 'sys_security_acl_role')).toBe(false);
  });

  it('sem acesso às ACLs, mas o filtro esconde: "provavelmente não vê"', async () => {
    const c = base({ brs: [br({})] });
    c.deny('sys_security_acl');
    const v = await run(c, ABEL);
    expect(v.combined.verdict).toBe('provavel_nao_ve');
  });

  it('sem sys_script nem papéis da pessoa: avisa, não chuta', async () => {
    const c = base(OPEN_ACLS);
    c.deny('sys_script').deny('sys_user_has_role');
    const v = await run(c, ABEL);
    expect(v.notes).toEqual(expect.arrayContaining(['rules_denied', 'roles_denied']));
    expect(v.userRoles!.known).toBe(false);
    expect(describeVisibility(v)).toContain('Seus papéis não deixam ver as regras de negócio');
    expect(describeVisibility(v)).toContain('não deixam ler os papéis dessa pessoa');
  });
});

describe('Quem enxerga este registro: base de conhecimento (user criteria)', () => {
  const KB = 'k'.repeat(32);
  function kb(o: { art?: Row; canBase?: string[]; cannotBase?: string[] } = {}) {
    const c = new FakeRestClient();
    c.rows('sys_db_object', [{ name: 'kb_knowledge', 'super_class.name': '' }]);
    c.rows('kb_knowledge', [{ sys_id: ID, kb_knowledge_base: KB, workflow_state: 'published', can_read_user_criteria: '', cannot_read_user_criteria: '', valid_to: '2100-01-01', ...o.art }]);
    c.rows('kb_knowledge_base', [{ sys_id: KB, title: 'IT' }]);
    c.rows('kb_uc_can_read_mtom', (o.canBase ?? []).map((u) => ({ kb_knowledge_base: KB, user_criteria: u })));
    c.rows('kb_uc_cannot_read_mtom', (o.cannotBase ?? []).map((u) => ({ kb_knowledge_base: KB, user_criteria: u })));
    c.rows('user_criteria', [
      { sys_id: 'uc1', name: 'Service Desk', group: G1, user: '', role: '', active: 'true', match_all: 'false', advanced: 'false' },
      { sys_id: 'uc2', name: 'Abel', user: ABEL, active: 'true', match_all: 'false', advanced: 'false' },
      { sys_id: 'uc3', name: 'Script', active: 'true', advanced: 'true', script: 'answer = gs.getUser().getCompanyID() == "x";' },
    ]);
    c.rows('sys_script', []);
    c.rows('sys_security_acl', [acl({ sys_id: 'k1', name: 'kb_knowledge' }), acl({ sys_id: 'k2', name: 'kb_knowledge.*' })]);
    c.rows('sys_security_acl_role', []);
    c.rows('sys_user', [{ sys_id: BETH, user_name: 'beth', name: 'Beth', active: 'true' }, { sys_id: ABEL, user_name: 'abel', name: 'Abel', active: 'true' }]);
    c.rows('sys_user_has_role', []);
    c.rows('sys_user_grmember', [{ user: BETH, group: G1, 'group.name': 'Service Desk' }]);
    return c;
  }
  const runKb = (c: FakeRestClient, user: string) => visibility(c, { table: 'kb_knowledge', sysId: ID, user });

  it('"pode ler" da base: quem é do grupo vê, quem não é não vê', async () => {
    const yes = await runKb(kb({ canBase: ['uc1'] }), 'beth');
    expect(yes.kb).toMatchObject({ canFrom: 'base', ok: true, baseName: 'IT' });
    expect(yes.combined.verdict).toBe('ve');
    const no = await runKb(kb({ canBase: ['uc1'] }), 'abel');
    expect(no.kb!.ok).toBe(false);
    expect(no.combined.verdict).toBe('nao_ve');
    expect(describeVisibility(no)).toContain('Pode ler (da base): Service Desk ✗');
  });

  it('"não pode ler" do artigo vence; critério do artigo substitui o da base', async () => {
    const v = await runKb(kb({ art: { can_read_user_criteria: 'uc2', cannot_read_user_criteria: 'uc1' }, canBase: ['uc1'] }), 'beth');
    expect(v.kb).toMatchObject({ canFrom: 'article', ok: false });
    expect(v.kb!.why).toContain('kb_cannot_match');
    const abel = await runKb(kb({ art: { can_read_user_criteria: 'uc2' }, canBase: ['uc1'] }), 'abel');
    expect(abel.kb!.ok).toBe(true);
  });

  it('critério com script e artigo não publicado', async () => {
    const s = await runKb(kb({ canBase: ['uc3'] }), 'abel');
    expect(s.kb!.ok).toBeUndefined();
    expect(s.kb!.why).toContain('kb_script');
    expect(s.combined.verdict).toBe('nao_da_para_afirmar');
    const d = await runKb(kb({ art: { workflow_state: 'draft' } }), 'abel');
    expect(d.kb!.ok).toBe(false);
    expect(describeVisibility(d)).toContain('O artigo não está publicado (draft)');
  });
});
