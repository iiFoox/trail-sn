/**
 * Bateria dos 12 casos da Fase 0, em fixtures sintéticas. Cada caso reproduz o
 * sinal visto na PDI e exige o tipo e o grau mínimo esperados na arquitetura.
 */
import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import type { Grade, Investigation } from '../src/types';
import { INC, T0, audit, br, build, formTx, id, scenario, shiftStr, tx } from './fixtures/builder';

const order: Grade[] = ['candidate', 'probable', 'confirmed'];
const atLeast = (g: Grade, min: Grade) => order.indexOf(g) >= order.indexOf(min);

async function run(s: ReturnType<typeof scenario>, field: string): Promise<Investigation> {
  return investigate(build(s), { table: 'incident', number: INC.number, field });
}
function top(r: Investigation) {
  const e = r.changes[0]?.evidence[0];
  if (!e) throw new Error('sem evidência');
  return e;
}

describe('Fase 0: 12 casos', () => {
  it('C1 BR assíncrona → CONFIRMADO', async () => {
    const s = scenario();
    br(s, 'PT Async state', 'async', "current.state = 2; current.update();");
    audit(s, 'state', '1', '2', shiftStr(T0, 2), 'admin', 2);
    tx(s, shiftStr(T0, 2), 'other', 'JOB: ASYNC: PT Async state', 'system');
    const e = top(await run(s, 'state'));
    expect(e.type).toBe('br_async');
    expect(e.grade).toBe('confirmed');
    expect(e.artifact.name).toBe('PT Async state');
  });

  it('C2 BR before via REST (sem transação de formulário) → CANDIDATO', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', "current.impact = 1;");
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const r = await run(s, 'impact');
    const before = r.changes[0]!.evidence.find((e) => e.type === 'br_before')!;
    expect(before.grade).toBe('candidate');
    expect(before.gaps.length).toBeGreaterThan(0);
  });

  it('C2-FORM BR before com valor enviado diferente do gravado → CONFIRMADO', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', "current.impact = 1;");
    audit(s, 'impact', '3', '1', T0, 'pericia.itil', 1);
    formTx(s, T0, 'pericia.itil', { impact: '3', urgency: '2' });
    const e = top(await run(s, 'impact'));
    expect(e.type).toBe('br_before');
    expect(e.grade).toBe('confirmed');
  });

  it('C2-FORM urgency: formulário enviou exatamente o valor → ação do usuário CONFIRMADO', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', "current.impact = 1;");
    audit(s, 'urgency', '3', '2', T0, 'pericia.itil', 1);
    formTx(s, T0, 'pericia.itil', { impact: '3', urgency: '2' });
    const e = top(await run(s, 'urgency'));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
  });

  it('C3 BR after via script include → PROVÁVEL', async () => {
    const s = scenario();
    br(s, 'PT After via SI', 'after', "new PTCategorizer().apply(current);");
    s.sis.push({ sys_id: id(), name: 'PTCategorizer', script: "apply: function(gr){ gr.category = 'network'; gr.update(); }" });
    audit(s, 'short_description', 'a', 'b', T0, 'admin', 1);
    audit(s, 'category', 'inquiry', 'network', T0, 'admin', 2);
    formTx(s, T0, 'admin', { short_description: 'b' });
    const e = top(await run(s, 'category'));
    expect(e.type).toBe('br_via_script_include');
    expect(atLeast(e.grade, 'probable')).toBe(true);
  });

  it('C4 evento + script action → CONFIRMADO', async () => {
    const s = scenario();
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 2);
    s.events.push({ sys_id: id(), name: 'pt.contact', processed: T0, sys_created_on: shiftStr(T0, -1) });
    s.scriptActions.push({ sys_id: id(), name: 'PT Script action', event_name: 'pt.contact', script: "current.contact_type = 'email'; current.update();" });
    const e = top(await run(s, 'contact_type'));
    expect(e.type).toBe('script_action');
    expect(e.grade).toBe('confirmed');
  });

  it('C5 script de fundo → PROVÁVEL', async () => {
    const s = scenario();
    audit(s, 'severity', '3', '1', T0, 'admin', 1);
    tx(s, shiftStr(T0, -1), 'other', '/sys.scripts.do', 'admin');
    const e = top(await run(s, 'severity'));
    expect(e.type).toBe('background_script');
    expect(e.grade).toBe('probable');
  });

  it('C5b job agendado com transação → CONFIRMADO', async () => {
    const s = scenario();
    s.jobs.push({ sys_id: id(), name: 'PT Job severity', script: "var gr = new GlideRecord('incident'); gr.severity = 1; gr.update();" });
    audit(s, 'severity', '3', '1', T0, 'system', 1);
    tx(s, shiftStr(T0, -1), 'other', 'JOB: PT Job severity', 'system');
    const e = top(await run(s, 'severity'));
    expect(e.type).toBe('scheduled_job');
    expect(e.grade).toBe('confirmed');
  });

  it('C5c job agendado SEM transação, horário bate e executa como system → CONFIRMADO', async () => {
    const s = scenario();
    s.jobs.push({ sys_id: id(), name: 'PT Job silent', script: "var gr = new GlideRecord('incident'); gr.severity = 1; gr.update();", run_type: 'daily', run_time: '1970-01-01 01:37:00', run_start: '', 'run_as.user_name': 'system', active: 'true' });
    audit(s, 'severity', '3', '1', T0, 'system', 1);
    const r = await run(s, 'severity');
    const e = top(r);
    expect(e.type).toBe('scheduled_job');
    expect(e.grade).toBe('confirmed');
    expect(r.changes[0]!.evidence.some((x) => x.type === 'unknown_background')).toBe(false);
  });

  it('C6 flow → PROVÁVEL', async () => {
    const s = scenario();
    audit(s, 'notify', '1', '2', T0, 'admin', 2);
    s.flows.push({ sys_id: id(), name: 'PT Flow notify', state: 'COMPLETE', sys_created_on: shiftStr(T0, -1), sys_updated_on: shiftStr(T0, 1) });
    const e = top(await run(s, 'notify'));
    expect(e.type).toBe('flow');
    expect(e.grade).toBe('probable');
  });

  it('C8 UI action → CONFIRMADO', async () => {
    const s = scenario();
    const ua = { sys_id: id(), name: 'PT Marcar', script: "current.description = 'marcado'; current.update();", table: 'incident' };
    s.uiActions.push(ua);
    audit(s, 'description', '', 'marcado', T0, 'admin', 1);
    formTx(s, T0, 'admin', {}, `&sys_action=${ua.sys_id}`);
    const e = top(await run(s, 'description'));
    expect(e.type).toBe('ui_action');
    expect(e.grade).toBe('confirmed');
  });

  it('C9 atualização sem auditoria (setWorkflow(false)) é detectada', async () => {
    const s = scenario();
    audit(s, 'impact', '3', '2', T0, 'admin', 1);
    s.record.sys_mod_count = '3';
    s.record.sys_updated_on = shiftStr(T0, 60);
    tx(s, shiftStr(T0, 60), 'other', '/sys.scripts.do', 'admin');
    const r = await run(s, 'impact');
    expect(r.unaudited).not.toBeNull();
    expect(r.unaudited!.count).toBe(2);
    expect(r.unaudited!.clues.length).toBe(1);
  });

  it('processo desconhecido quando não há rastro nem transação do usuário → CANDIDATO', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'system', 1);
    const e = top(await run(s, 'state'));
    expect(e.type).toBe('unknown_background');
    expect(e.grade).toBe('candidate');
  });
});

describe('acesso e lacunas', () => {
  it('fonte negada vira lacuna, não erro', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', "current.impact = 1;");
    audit(s, 'impact', '3', '1', T0, 'pericia.itil', 1);
    const c = build(s).deny('syslog_transaction');
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'impact' });
    expect(r.access.syslog_transaction).toBe('denied');
    expect(r.gaps).toContain('syslog_transaction: denied');
    expect(r.changes[0]!.evidence[0]!.type).not.toBe('user_action');
  });

  it('registro inexistente lança RecordNotFoundError', async () => {
    const s = scenario();
    await expect(investigate(build(s), { table: 'incident', number: 'INC9999999', field: 'state' })).rejects.toThrow(/not found/);
  });

  it('janelas próximas são fundidas numa consulta só de transações', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    audit(s, 'state', '2', '3', shiftStr(T0, 5), 'admin', 2);
    audit(s, 'state', '3', '6', shiftStr(T0, 3600), 'admin', 3);
    const c = build(s);
    await investigate(c, { table: 'incident', number: INC.number, field: 'state' });
    expect(c.log.filter((q) => q.table === 'syslog_transaction').length).toBe(2);
  });
});
