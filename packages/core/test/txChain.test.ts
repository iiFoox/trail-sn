import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, T0, build, scenario, shiftStr, tx } from './fixtures/builder';

/** Submit de formulário clássico como o log guarda: valor original e valor enviado na URL. */
const submit = (s: ReturnType<typeof scenario>, at: string, by: string, orig: string, sent: string, mc: number) =>
  tx(s, at, 'form', `/incident.do?sys_uniqueValue=${INC.sysId}&sys_modCount=${mc}&sys_original.incident.description=${encodeURIComponent(orig)}&incident.description=${encodeURIComponent(sent)}`, by);

const CUT = 'x'.repeat(997) + '...';
const target = { table: 'incident', number: INC.number, field: 'description' };

function cenario(current: string) {
  const s = scenario();
  s.record.description = current;
  s.record.sys_created_on = shiftStr(T0, -3600);
  s.record.sys_mod_count = '2';
  return s;
}

describe('reconstrução pelo log de transações (sem sys_audit)', () => {
  it('cadeia que bate com o registro vira mudanças, com valores e usuário', async () => {
    const s = cenario('depois');
    submit(s, shiftStr(T0, -600), 'alguem', 'antes', 'meio', 1);
    submit(s, T0, 'outra.pessoa', 'meio', 'depois', 2);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBe(true);
    // Mais recente primeiro, como no resto do motor.
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual(['meio>depois', 'antes>meio']);
    expect(r.changes[0]).toMatchObject({ oldValue: 'meio', newValue: 'depois', user: 'outra.pessoa' });
  });

  it('valor atual diferente do último submit: nada é mostrado', async () => {
    const s = cenario('outro texto');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBeUndefined();
    expect(r.changes).toHaveLength(0);
  });

  it('texto cortado pela instância: confere pelo começo e avisa que é só o começo', async () => {
    const atual = 'ini-' + 'x'.repeat(2400) + '-fim';
    const s = cenario(atual);
    submit(s, T0, 'alguem', 'inicio', 'ini-' + CUT, 1);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBe(true);
    expect(r.changes).toHaveLength(1);
    expect(r.gaps.join(' ')).toContain('valor longo cortado');
  });

  it('gravação fora da janela do registro não entra', async () => {
    const s = cenario('depois');
    submit(s, shiftStr(T0, -7200), 'alguem', 'antes', 'depois', 1);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.changes).toHaveLength(0);
  });

  it('auditoria respondendo: o log de transações não é usado', async () => {
    const s = cenario('depois');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBeUndefined();
  });
});
