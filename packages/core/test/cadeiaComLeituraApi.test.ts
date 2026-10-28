import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, T0, audit, br, build, scenario, shiftStr, tx } from './fixtures/builder';

/**
 * Zurich 147f (tabelas escopadas): PATCH pela API grava u_estado; uma BR after (ou async) regrava u_status por
 * GlideRecord.update() no mesmo segundo. Uma leitura pela API do registro logo depois (mesma URL /table/x/<sys_id>, sem
 * método registrado) contava como segunda gravação da pessoa, e o Trail dava "user_action confirmed 75" sem lacuna.
 */
function scene(when: 'after' | 'async', withRead: boolean) {
  const s = scenario();
  audit(s, 'u_estado', 'work', 'cancelled', T0, 'admin', 8);
  audit(s, 'u_status', 'work', 'closed', when === 'after' ? T0 : shiftStr(T0, 1), 'admin', 9);
  tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
  if (withRead) tx(s, shiftStr(T0, 1), 'rest', `/api/now/table/incident/${INC.sysId}?sysparm_fields=sys_id,u_status`, 'admin');
  br(s, '[PT] BR grava status', when, `(function executeRule(current, previous) { if (current.u_estado.changes()) { var gr = new GlideRecord('incident'); if (gr.get(current.getUniqueValue())) { gr.setValue('u_status', 'closed'); gr.update(); } } })(current, previous);`);
  return build(s);
}

describe('cadeia after/async com leitura pela API logo depois', () => {
  for (const when of ['after', 'async'] as const) {
    it(`BR ${when}: a pessoa não fica confirmada e a regra aparece`, async () => {
      const r = await investigate(scene(when, true), { table: 'incident', number: INC.number, field: 'u_status' });
      const ev = r.changes[0]!.evidence;
      expect(ev[0]!.type).toBe(when === 'after' ? 'br_after' : 'br_async');
      expect(ev.find((e) => e.type === 'user_action')?.grade ?? 'candidate').not.toBe('confirmed');
    });
  }

  it('sem a leitura extra continua como antes (cadeia)', async () => {
    const r = await investigate(scene('after', false), { table: 'incident', number: INC.number, field: 'u_status' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('br_after');
  });
});
