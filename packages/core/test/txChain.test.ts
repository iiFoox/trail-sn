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

  it('filtro pela URL barrado (no_filter): cai para a janela de datas e reconstrói', async () => {
    const s = cenario('depois');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    s.client.deny('sys_audit');
    const c = build(s);
    c.respond('syslog_transaction', (req) => (req.query.startsWith('urlLIKE')
      ? { rows: [], status: 403, access: 'no_filter' }
      : s.tx));
    const r = await investigate(c, target);
    expect(r.transactionChain).toBe(true);
    expect(r.changes).toHaveLength(1);
    expect(r.access.syslog_transaction).toBe('ok');
  });

  it('janela com 1000 gravações ou mais: avisa que pode ter ficado de fora', async () => {
    const s = cenario('depois');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    s.client.deny('sys_audit');
    const c = build(s);
    const filler = Array.from({ length: 1000 }, (_, i) => ({ sys_created_on: T0, type: 'rest', url: `/api/now/x${i}`, sys_created_by: 'x' }));
    c.respond('syslog_transaction', (req) => (req.query.startsWith('urlLIKE')
      ? { rows: [], status: 403, access: 'no_filter' }
      : [...s.tx, ...filler]));
    const r = await investigate(c, target);
    expect(r.gaps.join(' ')).toContain('janela com muitas gravações');
  });

  it('gravação sem auditoria: fluxo do mesmo segundo, com antes (último do formulário) e depois (atual)', async () => {
    const s = cenario('C');
    submit(s, shiftStr(T0, -600), 'alguem', 'A', 'B', 1);
    s.flows.push({ name: 'Fluxo X', state: 'complete', sys_created_on: T0 });
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.unaudited?.flow?.name).toBe('Fluxo X');
    expect(r.unaudited?.flowCandidates).toBeUndefined();
    expect(r.unaudited?.before).toBe('B');
    expect(r.unaudited?.after).toBe('C');
  });

  it('dois fluxos no mesmo segundo: lista os dois e não escolhe', async () => {
    const s = cenario('C');
    s.flows.push({ name: 'Fluxo X', state: 'complete', sys_created_on: T0 }, { name: 'Fluxo Y', state: 'complete', sys_created_on: T0 });
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.unaudited?.flow).toBeUndefined();
    expect(r.unaudited?.flowCandidates?.length).toBe(2);
  });

  it('gravação sem auditoria: linha do tempo com envios e fluxos, em ordem, com nome', async () => {
    const s = cenario('C');
    submit(s, shiftStr(T0, -600), 'alguem', 'A', 'B', 1);
    s.flows.push({ name: 'Fluxo Z', state: 'complete', sys_created_on: shiftStr(T0, -300) }, { name: 'Fluxo X', state: 'complete', sys_created_on: T0 });
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    const texts = r.unaudited?.timeline?.map((x) => x.text) ?? [];
    expect(texts[0]).toContain('formulário');
    expect(texts.join(' | ')).toContain('fluxo Fluxo Z');
    expect(texts.at(-1)).toContain('fluxo Fluxo X');
  });

  it('auditoria respondendo: o log de transações não é usado', async () => {
    const s = cenario('depois');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBeUndefined();
  });
});
