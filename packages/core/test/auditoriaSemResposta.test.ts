import { describe, expect, it } from 'vitest';
import { parseHistory } from '../src/client/FetchRestClient';
import { investigate } from '../src/investigate';
import { INC, T0, audit, build, formTx, scenario } from './fixtures/builder';

/**
 * Matriz de falhas (27/10/2026, M8-CHG-BAS-choice): com o ui/meta de sys_audit em 500, a auditoria não saía e o histórico
 * do formulário entrava no lugar. A BR assíncrona sumia e a pessoa saía "certeza alta", sem lacuna. O histórico não
 * mostra tudo o que as regras gravaram: a pessoa fica no máximo provável e a falta da auditoria aparece.
 */
const ADMIN = 'b'.repeat(32);
const [y, mo, d, h, mi, se] = T0.split(/[- :]/).map(Number) as [number, number, number, number, number, number];
const history = parseHistory({
  fields: [{ name: 'short_description' }],
  entries: [{ sys_timestamp: Date.UTC(y, mo - 1, d, h, mi, se), user_id: ADMIN, sys_created_by: 'System Administrator', entries: { changes: [{ field_name: 'short_description', old_value: 'antes', new_value: 'depois' }] } }],
})!;

function admin(auditAnswer: 'timeout' | 'ok') {
  const s = scenario();
  audit(s, 'short_description', 'antes', 'depois', T0, 'admin', 1);
  formTx(s, T0, 'admin', { short_description: 'depois' });
  const c = build(s).rows('sys_user', [{ sys_id: ADMIN, user_name: 'admin' }]);
  return auditAnswer === 'timeout' ? c.respond('sys_audit', () => ({ rows: [], status: 0, access: 'timeout' })).withHistory(history) : c;
}

describe('auditoria sem resposta, histórico no lugar', () => {
  it('a pessoa não sai confirmada e a falta da auditoria aparece', async () => {
    const r = await investigate(admin('timeout'), { table: 'incident', number: INC.number, field: 'short_description' });
    expect(r.auditFrom).toBe('history');
    expect(r.gaps).toContain('sys_audit: timeout');
    const top = r.changes[0]!.evidence[0]!;
    expect(top.type).toBe('user_action');
    expect(top.grade).toBe('probable');
    expect(top.gaps.join(' ')).toContain('histórico do formulário');
  });

  it('com a auditoria respondendo, segue confirmada', async () => {
    const r = await investigate(admin('ok'), { table: 'incident', number: INC.number, field: 'short_description' });
    expect(r.auditFrom).toBeUndefined();
    expect(r.changes[0]!.evidence[0]!.grade).toBe('confirmed');
  });
});
