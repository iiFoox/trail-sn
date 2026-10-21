import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { parseHistory } from '../src/client/FetchRestClient';
import { investigate } from '../src/investigate';

const SYS = 'a'.repeat(32);
const ADMIN = 'b'.repeat(32);

/** Usuário só com itil: lê o incidente, sys_choice e sys_user; sys_audit e o resto negados. */
function itil(auditDenied = true) {
  const c = new FakeRestClient()
    .rows('incident', [{ sys_id: SYS, number: 'INC0010001', short_description: 'Teste', sys_mod_count: '3', sys_created_on: '2026-10-20 10:00:00', sys_updated_on: '2026-10-20 12:00:00', sys_updated_by: 'admin' }])
    .rows('sys_choice', [
      { name: 'incident', element: 'impact', value: '1', label: '1 - High', inactive: 'false' },
      { name: 'incident', element: 'impact', value: '3', label: '3 - Low', inactive: 'false' },
      { name: 'task', element: 'impact', value: '3', label: '3 - Baixo (task)', inactive: 'false' },
    ])
    .rows('sys_user', [{ sys_id: ADMIN, user_name: 'admin' }]);
  return auditDenied ? c.deny('sys_audit') : c;
}

const history = parseHistory({
  fields: [{ name: 'impact' }, { name: 'priority' }, { name: 'work_notes', isJournal: true }, { name: '*Attachments*' }],
  entries: [
    { sys_timestamp: Date.UTC(2026, 9, 20, 12, 0, 0), user_id: ADMIN, sys_created_by: 'System Administrator', entries: { changes: [{ field_name: 'impact', old_value: '3 - Low', new_value: '1 - High' }] } },
    { sys_timestamp: Date.UTC(2026, 9, 20, 10, 0, 0), user_id: ADMIN, sys_created_by: 'System Administrator', entries: { changes: [{ field_name: 'impact', old_value: '', new_value: '3 - Low' }] } },
    { sys_timestamp: Date.UTC(2026, 9, 20, 11, 0, 0), user_id: ADMIN, entries: { changes: [] } },
  ],
})!;

describe('histórico do formulário (quem não lê sys_audit)', () => {
  it('parseHistory ordena por tempo, ignora gravações sem mudança e campos de diário', () => {
    expect(history.entries.map((e) => e.at)).toEqual(['2026-10-20 10:00:00', '2026-10-20 12:00:00']);
    expect(history.fields).toEqual(['impact', 'priority']);
  });

  it('auditoria negada + histórico: as mudanças aparecem, com valor interno e user_name', async () => {
    const r = await investigate(itil().withHistory(history), { table: 'incident', sysId: SYS, field: 'impact' });
    expect(r.auditFrom).toBe('history');
    expect(r.fieldNotInHistory).toBeUndefined();
    expect(r.changes.map((c) => [c.oldValue, c.newValue, c.user])).toEqual([['3', '1', 'admin'], ['', '3', 'admin']]);
    // Sem leitura das transações, a causa é o autor da gravação (candidato), não um "segundo plano" inventado.
    expect(r.changes[0]!.evidence[0]!.type).toBe('user_action');
    expect(r.changes[0]!.evidence[0]!.artifact.name).toBe('admin');
    // sys_audit está coberto pelo histórico: não entra como lacuna.
    expect(r.gaps.some((g) => g.startsWith('sys_audit'))).toBe(false);
  });

  it('campo fora do Activity Stream: diz que o histórico não mostra o campo', async () => {
    const r = await investigate(itil().withHistory(history), { table: 'incident', sysId: SYS, field: 'urgency' });
    expect(r.auditFrom).toBe('history');
    expect(r.fieldNotInHistory).toBe(true);
    expect(r.changes).toHaveLength(0);
  });

  it('com sys_audit liberada, o histórico nem é consultado', async () => {
    let asked = false;
    const c = itil(false).rows('sys_audit', [{ sys_id: 'x', tablename: 'incident', documentkey: SYS, fieldname: 'impact', oldvalue: '3', newvalue: '1', user: 'admin', sys_created_on: '2026-10-20 12:00:00', record_checkpoint: '2' }]);
    c.history = async () => { asked = true; return history; };
    const r = await investigate(c, { table: 'incident', sysId: SYS, field: 'impact' });
    expect(asked).toBe(false);
    expect(r.auditFrom).toBeUndefined();
    expect(r.changes).toHaveLength(1);
  });
});
