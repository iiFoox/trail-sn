import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, T0, audit, build, formTx, scenario } from './fixtures/builder';

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
