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

describe('reconstrução: o que a tela mostra (teste do dono no DEV, 05/11/2026)', () => {
  it('de (vazio) para Sim não vira "Criado como", não rebaixa sem lacuna e o rastro aponta para o formulário', async () => {
    const s = cenario('true');
    submit(s, T0, 'quem.salvou', '', 'true', 0);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    const c = r.changes[0]!;
    expect(c.oldValue).toBe('');
    expect(c.checkpoint).toBeGreaterThanOrEqual(2);
    expect(c.evidence[0]?.gaps.join(' ') ?? '').not.toContain('reconstruída a partir');
    const change = (c.trace ?? []).find((t) => t.kind === 'change');
    expect(change?.source).toBe('syslog_transaction');
  });
});

describe('texto exibido do valor (referência como sys_id)', () => {
  it('usa o texto que o formulário exibia (sys_display) quando a tabela referenciada não dá o nome', async () => {
    const A = 'a'.repeat(32), B = 'b'.repeat(32);
    const s = cenario(B);
    tx(s, shiftStr(T0, -60), 'form', `/incident.do?sys_uniqueValue=${INC.sysId}&sys_modCount=1&sys_original.incident.description=${A}&sys_display.original.incident.description=Em Andamento&incident.description=${B}&sys_display.incident.description=Concluído`, 'pessoa');
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual([`${A}>${B}`]);
    expect(r.labels[A]).toBe('Em Andamento');
    expect(r.labels[B]).toBe('Concluído');
  });
});

describe('mudança de valor sem formulário (ex.: Status por fluxo)', () => {
  it('sai da sequência do que os formulários viram ao abrir, com intervalo e fluxos do intervalo', async () => {
    const s = cenario('C');
    submit(s, shiftStr(T0, -600), 'pessoa', 'A', 'A', 1);
    submit(s, shiftStr(T0, -60), 'pessoa', 'B', 'B', 2);
    s.flows.push(
      { sys_id: 'f'.repeat(32), name: 'Fluxo do meio', state: 'complete', sys_created_on: shiftStr(T0, -300) },
      { sys_id: 'e'.repeat(32), name: 'Fluxo do fim', state: 'complete', sys_created_on: T0 },
    );
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    // Viram mudanças normais (abas, prova, rastro), da mais recente para a mais antiga.
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual(['B>C', 'A>B']);
    // Horário: o do único fluxo do intervalo, quando há um só.
    expect(r.changes[1]!.at).toBe(shiftStr(T0, -300));
    expect(r.changes[0]!.at).toBe(T0);
    for (const c of r.changes) {
      expect(c.evidence[0]?.grade).not.toBe('confirmed');
      expect(c.evidence[0]?.gaps.join(' ')).toContain('mudança deduzida');
    }
    const flows = (r.recordEvents ?? []).filter((e) => e.kind === 'flow');
    expect(flows.length).toBe(2);
    expect(flows.every((f) => f.sysId)).toBe(true);
  });

  it('mudança que o próprio formulário enviou não vira mudança deduzida', async () => {
    const s = cenario('B');
    submit(s, shiftStr(T0, -600), 'pessoa', 'A', 'B', 1);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual(['A>B']);
    expect(r.changes[0]!.evidence[0]?.gaps.join(' ') ?? '').not.toContain('mudança deduzida');
  });
});

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

  it('valor atual diferente do último envio: a mudança do formulário aparece, e a seguinte é deduzida', async () => {
    const s = cenario('outro texto');
    submit(s, shiftStr(T0, -60), 'alguem', 'antes', 'depois', 1);
    s.client.deny('sys_audit');
    const r = await investigate(build(s), target);
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual(['depois>outro texto', 'antes>depois']);
    expect(r.changes[1]!.user).toBe('alguem');
    expect(r.changes[0]!.evidence[0]?.gaps.join(' ')).toContain('mudança deduzida');
    expect(r.changes[1]!.evidence[0]?.gaps.join(' ') ?? '').not.toContain('mudança deduzida');
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
    // Mais gravações do que as explicadas: continua havendo gravação sem auditoria.
    s.record.sys_mod_count = '5';
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
    const ev = r.recordEvents ?? [];
    expect(ev[0]).toMatchObject({ kind: 'form', who: 'alguem', from: 'A', to: 'B', changed: true });
    expect(ev.map((e) => e.name ?? '')).toContain('Fluxo Z');
    expect(ev.at(-1)).toMatchObject({ kind: 'flow', name: 'Fluxo X', state: 'complete' });
  });

  it('auditoria respondendo: o log de transações não é usado', async () => {
    const s = cenario('depois');
    submit(s, T0, 'alguem', 'antes', 'depois', 1);
    const r = await investigate(build(s), target);
    expect(r.transactionChain).toBeUndefined();
  });
});
