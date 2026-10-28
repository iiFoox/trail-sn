import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, T0, audit, br, build, formTx, id, scenario } from './fixtures/builder';

/**
 * B-441 (F9-B6): com sysrule_assignment respondendo 500, a mudança de assignment_group saía "pessoa, certeza alta".
 * Fonte de automação sem resposta: a pessoa fica no máximo provável, com o aviso de qual fonte faltou.
 */
describe('fonte de automação sem resposta', () => {
  it('regras de atribuição em 500: a pessoa não sai confirmada', async () => {
    const s = scenario();
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: 'grp_rede' });
    const c = build(s).respond('sysrule_assignment', () => ({ rows: [], status: 500, access: 'unknown' }));
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'assignment_group' });
    const top = r.changes[0]!.evidence[0]!;
    expect(top.type).toBe('user_action');
    expect(top.grade).toBe('probable');
    expect(top.gaps.join(' ')).toContain('sysrule_assignment');
  });

  it('com todas as fontes respondendo, segue confirmada', async () => {
    const s = scenario();
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: 'grp_rede' });
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'assignment_group' });
    expect(r.changes[0]!.evidence[0]!.grade).toBe('confirmed');
  });
});

describe('fontes lidas em modo silencioso', () => {
  it('data lookups em 500: vira lacuna e a pessoa não sai confirmada', async () => {
    const s = scenario();
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: 'grp_rede' });
    const c = build(s).respond('dl_definition_rel_set', () => ({ rows: [], status: 500, access: 'unknown' }));
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'assignment_group' });
    expect(r.gaps).toContain('dl_definition_rel_set: timeout');
    expect(r.changes[0]!.evidence[0]!.grade).toBe('probable');
  });

  it('rótulos (sys_choice) em 500 não viram lacuna', async () => {
    const s = scenario();
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: 'grp_rede' });
    const c = build(s).respond('sys_choice', () => ({ rows: [], status: 500, access: 'unknown' }));
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'assignment_group' });
    expect(r.gaps.some((g) => g.startsWith('sys_choice'))).toBe(false);
  });
});

/**
 * Zurich (27/10/2026): com sys_script_include em 500, a lacuna aparecia, mas a pessoa saía confirmada. Uma BR que
 * delega a um script include não mostra o que grava sem o script include.
 */
describe('script include sem resposta', () => {
  const s = () => {
    const sc = scenario();
    br(sc, 'PT chama SI', 'before', 'new PTAjusta().ajusta(current);');
    sc.sis.push({ sys_id: id(), name: 'PTAjusta', script: "var PTAjusta = Class.create(); PTAjusta.prototype = { ajusta: function(r) { r.setValue('impact', '2'); } };", active: 'true' });
    audit(sc, 'impact', '3', '2', T0, 'admin', 1);
    formTx(sc, T0, 'admin', { impact: '2' });
    return sc;
  };

  it('a pessoa não sai confirmada e a lacuna aparece', async () => {
    const c = build(s()).respond('sys_script_include', () => ({ rows: [], status: 500, access: 'unknown' }));
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'impact' });
    expect(r.gaps).toContain('sys_script_include: timeout');
    const top = r.changes[0]!.evidence[0]!;
    expect(top.type === 'user_action' && top.grade === 'confirmed').toBe(false);
  });
});
