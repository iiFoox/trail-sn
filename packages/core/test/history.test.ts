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

describe('histórico do formulário: ajustes da bateria de 2000', () => {
  it('referência volta ao sys_id, data volta para UTC, "System" vira system', async () => {
    const USR = 'c'.repeat(32);
    const h = parseHistory({
      fields: [{ name: 'assigned_to' }, { name: 'due_date' }],
      entries: [{ sys_timestamp: Date.UTC(2026, 9, 20, 12, 0, 0), sys_created_on: '2026-10-20 12:00:00', sys_created_on_adjusted: '2026-10-20 05:00:00', sys_created_by: 'System', entries: { changes: [
        { field_name: 'assigned_to', field_type: 'reference', old_value: '', new_value: 'Beth Anglin' },
        { field_name: 'due_date', field_type: 'glide_date_time', old_value: '', new_value: '2026-10-21 08:00:00' },
      ] } }],
    })!;
    h.refs = { assigned_to: 'sys_user' };
    const c = new FakeRestClient()
      .rows('incident', [{ sys_id: SYS, number: 'INC0010001', sys_created_on: '2026-10-19 10:00:00' }])
      .deny('sys_audit')
      .rows('sys_user', [{ sys_id: USR, name: 'Beth Anglin', user_name: 'beth.anglin' }])
      .withHistory(h);
    const r = await investigate(c, { table: 'incident', sysId: SYS, field: 'assigned_to' });
    expect(r.changes[0]!.newValue).toBe(USR);
    expect(r.changes[0]!.user).toBe('system');
    const d = await investigate(c, { table: 'incident', sysId: SYS, field: 'due_date' });
    // O histórico mostra 08:00 no fuso de quem está logado (UTC-7): na auditoria é 15:00 UTC.
    expect(d.changes[0]!.newValue).toBe('2026-10-21 15:00:00');
  });
});

describe('histórico do formulário (quem não lê sys_audit)', () => {
  it('parseHistory ordena por tempo, ignora gravações sem mudança e campos de diário', () => {
    expect(history.entries.map((e) => e.at)).toEqual(['2026-10-20 10:00:00', '2026-10-20 12:00:00']);
    expect(history.fields).toEqual(['impact', 'priority']);
  });

  it('auditoria negada + histórico: as mudanças aparecem, com valor interno e user_name', async () => {
    const r = await investigate(itil().withHistory(history), { table: 'incident', sysId: SYS, field: 'impact' });
    expect(r.auditFrom).toBe('history');
    expect(r.fieldNotInHistory).toBeUndefined();
    // A gravação das 10:00 é a criação do registro: a auditoria não registra inserção, então ela fica de fora.
    expect(r.changes.map((c) => [c.oldValue, c.newValue, c.user])).toEqual([['3', '1', 'admin']]);
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

  it('histórico falha uma vez: tenta de novo e as mudanças aparecem', async () => {
    const c = itil();
    let n = 0;
    c.history = async () => (++n === 1 ? null : history);
    const r = await investigate(c, { table: 'incident', sysId: SYS, field: 'impact' });
    expect(n).toBe(2);
    expect(r.auditFrom).toBe('history');
    expect(r.changes).toHaveLength(1);
  });

  it('histórico não volta: a lacuna aparece (não é "nenhuma mudança" calada)', async () => {
    const c = itil();
    c.history = async () => null;
    const r = await investigate(c, { table: 'incident', sysId: SYS, field: 'impact' });
    expect(r.changes).toHaveLength(0);
    expect(r.gaps).toContain('list_history: unavailable');
    expect(r.gaps.some((g) => g.startsWith('sys_audit'))).toBe(true);
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

describe('fuso do usuário com horário de verão', () => {
  it('localToUtc usa o offset da própria data, não o do dia da gravação', async () => {
    const { localToUtc } = await import('../src/history');
    expect(localToUtc('2025-11-25 08:00:00', 'America/Los_Angeles')).toBe('2025-11-25 16:00:00'); // PST, UTC-8
    expect(localToUtc('2026-10-21 08:00:00', 'America/Los_Angeles')).toBe('2026-10-21 15:00:00'); // PDT, UTC-7
    expect(localToUtc('2026-10-21 08:00:00', 'America/Sao_Paulo')).toBe('2026-10-21 11:00:00');
    expect(localToUtc('2026-10-21 08:00:00', 'Fuso/Inexistente')).toBeNull();
  });
});

describe('mudanças do mesmo campo no mesmo segundo', () => {
  it('o checkpoint desempata: a mais recente é a da regra (4→2), mesmo com as linhas fora de ordem', async () => {
    const c = new FakeRestClient()
      .rows('incident', [{ sys_id: SYS, number: 'INC0010001', sys_created_on: '2026-10-19 10:00:00' }])
      .respond('sys_audit', () => [
        { sys_id: 'y', fieldname: 'priority', oldvalue: '4', newvalue: '2', user: 'system', sys_created_on: '2026-10-20 12:00:00', record_checkpoint: '3' },
        { sys_id: 'x', fieldname: 'priority', oldvalue: '2', newvalue: '4', user: 'admin', sys_created_on: '2026-10-20 12:00:00', record_checkpoint: '2' },
      ].reverse());
    const r = await investigate(c, { table: 'incident', sysId: SYS, field: 'priority' });
    expect(r.changes.map((x) => `${x.oldValue}>${x.newValue}`)).toEqual(['4>2', '2>4']);
  });
});
