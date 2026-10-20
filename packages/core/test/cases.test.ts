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

  it('C2 BR before via REST sem condição: grava sempre o valor, mas nada a liga a esta gravação → PROVÁVEL', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', "current.impact = 1;");
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const r = await run(s, 'impact');
    const before = r.changes[0]!.evidence.find((e) => e.type === 'br_before')!;
    expect(before.grade).toBe('probable');
    expect(before.gaps.length).toBeGreaterThan(0);
  });

  it('C2-REST BR before reage ao gatilho mudado pela API e grava o valor: o envio não importa → CONFIRMADO', async () => {
    const s = scenario();
    br(s, 'PT Before just', 'before', "if (current.description.changes()) current.impact = '1';");
    audit(s, 'description', 'a', 'b', T0, 'admin', 1);
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'impact'));
    expect([e.type, e.grade]).toEqual(['br_before', 'confirmed']);
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

  it('C8b UI action com action_name (sys_action=<nome>, não sys_id) → CONFIRMADO', async () => {
    const s = scenario();
    const ua = { sys_id: id(), name: 'PT Escalar', action_name: 'pt_escalar', script: "current.urgency = 1; current.update();", table: 'incident' };
    s.uiActions.push(ua);
    br(s, 'PT decoy', 'before', "if (current.contact_type == 'walk-in') current.urgency = 1;");
    (s.record as Record<string, string>).contact_type = 'phone';
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { urgency: '3' }, '&sys_action=pt_escalar');
    const e = top(await run(s, 'urgency'));
    expect(e.type).toBe('ui_action');
    expect(e.artifact.name).toBe('PT Escalar');
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
    expect(c.log.filter((q) => q.table === 'syslog_transaction' && !q.query.startsWith('type=list')).length).toBe(2);
  });
});

describe('Fase 1: casos novos (fixtures)', () => {
  it('regra de atribuição nomeada quando o formulário enviou outro grupo', async () => {
    const s = scenario();
    s.assignmentRules = [{ sys_id: id(), name: '[PT] Atribui rede', table: 'incident', condition: 'category=network', group: 'grp_rede', user: '', order: '100' }];
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: '' });
    const e = top(await run(s, 'assignment_group'));
    expect(e.type).toBe('assignment_rule');
    expect(e.grade).toBe('confirmed');
  });

  it('duas automações em sequência no mesmo campo: cada mudança tem a sua evidência', async () => {
    const s = scenario();
    br(s, 'PT Before impact', 'before', 'current.impact = 2;');
    br(s, 'PT Async impact', 'async', 'current.impact = 1; current.update();');
    audit(s, 'impact', '3', '2', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '3' });
    audit(s, 'impact', '2', '1', shiftStr(T0, 2), 'admin', 2);
    tx(s, shiftStr(T0, 2), 'other', 'JOB: ASYNC: PT Async impact', 'system');
    const r = await run(s, 'impact');
    expect(r.changes.map((c) => c.evidence[0]!.type)).toEqual(['br_async', 'br_before']);
  });

  it('registro com mais de 50 mudanças: analisa só as últimas maxChanges', async () => {
    const s = scenario();
    for (let i = 1; i <= 60; i++) audit(s, 'state', String(i), String(i + 1), shiftStr(T0, i * 60), 'system', i);
    const r = await run(s, 'state');
    expect(r.changes.length).toBe(10);
    expect(r.changes[0]!.checkpoint).toBe(60);
  });

  it('mudança mais antiga que a retenção ganha aviso de rastros expirados', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', '2020-01-01 00:00:00', 'system', 1);
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'state' }, { retention: { syslog_transaction: 56 * 86400, sysevent: 7 * 86400 } });
    expect(r.changes[0]!.notes).toEqual(['traces_expired:syslog_transaction', 'traces_expired:sysevent']);
  });
});

describe('Rastro e rótulos', () => {
  it('C1: rastro em ordem com o job marcado como causa e a mudança por último', async () => {
    const s = scenario();
    br(s, 'PT Async state', 'async', "current.state = 2; current.update();");
    audit(s, 'state', '1', '2', shiftStr(T0, 2), 'admin', 2);
    formTx(s, shiftStr(T0, 1), 'admin', { state: '1' });
    tx(s, shiftStr(T0, 2), 'other', 'JOB: ASYNC: PT Async state', 'system');
    const c = (await run(s, 'state')).changes[0]!;
    expect(c.trace.map((t) => t.kind)).toEqual(['form', 'async', 'change']);
    expect(c.trace.find((t) => t.kind === 'async')?.cause).toBe(true);
    expect(c.trace[0]?.sent).toBe('1');
  });

  it('rótulos de choice vêm de sys_choice, preferindo inglês', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const c = build(s);
    c.rows('sys_choice', [
      { name: 'incident', element: 'state', value: '2', label: 'Em andamento', language: 'pt', inactive: 'false' },
      { name: 'incident', element: 'state', value: '2', label: 'In Progress', language: 'en', inactive: 'false' },
      { name: 'incident', element: 'state', value: '1', label: 'New', language: 'en', inactive: 'false' },
      { name: 'task', element: 'state', value: '2', label: 'Work in Progress', language: 'en', inactive: 'false' },
    ]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'state' });
    expect(r.labels).toEqual({ '2': 'In Progress', '1': 'New' });
    expect(r.gaps.some((g) => g.startsWith('sys_choice'))).toBe(false);
  });

  it('rastro do registro inteiro: outras gravações na janela e campos da mesma atualização', async () => {
    const s = scenario();
    br(s, 'PT Async state', 'async', "current.state = 2; current.update();");
    audit(s, 'urgency', '3', '2', shiftStr(T0, 1), 'admin', 1);
    audit(s, 'priority', '4', '3', shiftStr(T0, 1), 'admin', 1);
    audit(s, 'state', '1', '2', shiftStr(T0, 2), 'admin', 2);
    audit(s, 'work_notes', '', 'resolvido', shiftStr(T0, 2), 'admin', 2);
    tx(s, shiftStr(T0, 2), 'other', 'JOB: ASYNC: PT Async state', 'system');
    const c = (await run(s, 'state')).changes[0]!;
    const write = c.trace.find((t) => t.kind === 'write');
    expect(write?.checkpoint).toBe(1);
    expect(write?.fields?.map((f) => f.field).sort()).toEqual(['priority', 'urgency']);
    const change = c.trace.find((t) => t.kind === 'change');
    expect(change?.fields?.map((f) => f.field)).toEqual(['work_notes']);
    expect(change?.ref?.query).toContain('record_checkpoint=2');
  });

  it('a causa registrada até 3 s depois da mudança aparece antes dela; eventos de infraestrutura ficam fora', async () => {
    const s = scenario();
    br(s, 'PT Async state', 'async', "current.state = 2; current.update();");
    audit(s, 'state', '1', '2', shiftStr(T0, 2), 'admin', 2);
    tx(s, shiftStr(T0, 3), 'other', 'JOB: ASYNC: PT Async state', 'system');
    s.events.push({ name: 'text_index', processed: shiftStr(T0, 2), sys_created_on: shiftStr(T0, 2) });
    const c = (await run(s, 'state')).changes[0]!;
    expect(c.trace.map((t) => t.kind)).toEqual(['async', 'change']);
  });

  it('script action genérica (não cita o campo) não vira causa forte', async () => {
    const s = scenario();
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { urgency: '1' });
    s.events.push({ name: 'metric.update', processed: T0, sys_created_on: T0 });
    s.scriptActions.push({ sys_id: id(), name: 'Metric Update', event_name: 'metric.update', script: 'new MetricInstance().process();' });
    const e = top(await run(s, 'urgency'));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
  });

  it('data lookup no navegador: prioridade recalculada quando o impacto mudou na mesma gravação', async () => {
    const s = scenario();
    audit(s, 'priority', '4', '3', T0, 'admin', 1);
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { priority: '3', impact: '1' });
    const c = build(s);
    c.rows('dl_definition_rel_set', [{ dl_definition: 'dl1', source_table_field: 'priority', 'dl_definition.name': 'Priority Lookup', 'dl_definition.run_on_form_change': 'true', 'dl_definition.run_on_update': 'true', 'dl_definition.active': 'true', 'dl_definition.source_table': 'incident' }]);
    c.rows('dl_definition_rel_match', [{ dl_definition: 'dl1', source_table_field: 'impact' }, { dl_definition: 'dl1', source_table_field: 'urgency' }]);
    c.rows('sys_script_client', []);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'priority' });
    const ev = r.changes[0]!.evidence;
    expect(ev[0]!.type).toBe('data_lookup');
    expect(ev.find((e) => e.type === 'user_action')!.score).toBeLessThan(ev[0]!.score);
  });

  it('client script onChange que preenche o campo quando o gatilho mudou na mesma gravação', async () => {
    const s = scenario();
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    audit(s, 'category', 'inquiry', 'hardware', T0, 'admin', 1);
    formTx(s, T0, 'admin', { urgency: '1', category: 'hardware' });
    const c = build(s);
    c.rows('dl_definition_rel_set', []);
    c.rows('sys_script_client', [{ sys_id: id(), name: '[PT] client', type: 'onChange', field: 'category', table: 'incident', active: 'true', script: "g_form.setValue('urgency', '1');" }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'urgency' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('client_script');
  });

  it('Workspace: o Salvar roda como ui_action REST; pessoa sem automação concorrente → ação do usuário', async () => {
    const s = scenario();
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/ui/ui_action/f4deef100b701300099a83eb37673a4d?sysparm_table=incident&sysparm_sys_id=${INC.sysId}`, 'admin');
    s.uiActions.push({ sys_id: 'f4deef100b701300099a83eb37673a4d', name: 'Save', action_name: 'sysverb_update', table: 'global', script: '' });
    const r = await run(s, 'impact');
    const e = top(r);
    expect([e.type, e.grade]).toEqual(['user_action', 'confirmed']);
    expect(e.facts.find((f) => f.kind === 'execution_in_window')!.detail).toContain('Workspace');
    expect(r.changes[0]!.trace.some((t) => t.kind === 'form' && t.label === 'Workspace')).toBe(true);
  });

  it('Workspace: client script "All" que preenche o campo quando o gatilho mudou → client script', async () => {
    const s = scenario();
    audit(s, 'description', 'inicial', 'W9 client', T0, 'admin', 1);
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/ui/ui_action/f4deef100b701300099a83eb37673a4d?sysparm_table=incident&sysparm_sys_id=${INC.sysId}`, 'admin');
    const c = build(s);
    c.rows('dl_definition_rel_set', []);
    c.rows('sys_script_client', [
      { sys_id: id(), name: 'PT ws', type: 'onChange', field: 'contact_type', table: 'incident', active: 'true', ui_type: '10', script: "g_form.setValue('description', 'W9 client');" },
      { sys_id: id(), name: 'PT desktop', type: 'onChange', field: 'contact_type', table: 'incident', active: 'true', ui_type: '0', script: "g_form.setValue('description', 'W9 client');" },
    ]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence[0]!;
    expect([e.type, e.artifact.name, e.grade]).toEqual(['client_script', 'PT ws', 'confirmed']);
    expect(r.changes[0]!.evidence.some((x) => x.artifact.name === 'PT desktop')).toBe(false);
  });

  it('condição falsa da BR desempata candidatas iguais', async () => {
    const s = scenario();
    s.record.short_description = '[PT] F1-SEQ';
    br(s, 'PT certa', 'before', 'current.impact = 2;');
    br(s, 'PT errada', 'before', 'current.impact = 2;');
    s.brs[0]!.filter_condition = 'short_descriptionSTARTSWITH[PT] F1-SEQ^EQ';
    s.brs[1]!.filter_condition = 'short_descriptionSTARTSWITH[PT] C2^EQ';
    audit(s, 'impact', '1', '2', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '3' });
    const e = top(await run(s, 'impact'));
    expect(e.artifact.name).toBe('PT certa');
    expect(e.grade).toBe('confirmed');
  });

  it('regra de atribuição gravada como system dentro do salvamento de outra pessoa', async () => {
    const s = scenario();
    s.assignmentRules = [{ sys_id: id(), name: '[PT] Atribui rede', table: 'incident', condition: 'category=network', group: 'grp_rede', user: '', order: '100' }];
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'system', 1);
    formTx(s, shiftStr(T0, 3), 'admin', { assignment_group: '', category: 'network' });
    const e = top(await run(s, 'assignment_group'));
    expect(e.type).toBe('assignment_rule');
  });

  it('BR assíncrona rápida, sem transação de job, reconhecida pela segunda gravação no mesmo segundo', async () => {
    const s = scenario();
    br(s, 'PT before', 'before', 'current.impact = 2;');
    br(s, 'PT async', 'async', 'var gr = new GlideRecord("incident"); gr.impact = 1; gr.update();');
    audit(s, 'impact', '1', '2', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '3' });
    audit(s, 'impact', '2', '1', T0, 'admin', 2);
    const r = await run(s, 'impact');
    expect(r.changes[0]!.evidence[0]!.type).toBe('br_async');
  });
  it('BR async_always (variante nova) é tratada como assíncrona', async () => {
    const s = scenario();
    br(s, 'PT async sempre', 'async_always', 'var gr = new GlideRecord("incident"); gr.impact = 1; gr.update();');
    audit(s, 'impact', '1', '2', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '2' });
    audit(s, 'impact', '2', '1', T0, 'admin', 2);
    expect(top(await run(s, 'impact')).type).toBe('br_async');
  });

  it('data lookup sem linha que produza o valor perde para a regra de atribuição', async () => {
    const s = scenario();
    s.record.category = 'network';
    s.assignmentRules = [{ sys_id: id(), name: '[PT] Atribui rede', table: 'incident', condition: 'category=network^assignment_groupISEMPTY', group: 'grp_rede', user: '', order: '100' }];
    audit(s, 'assignment_group', '', 'grp_rede', T0, 'system', 1);
    audit(s, 'category', 'inquiry', 'network', T0, 'admin', 1);
    formTx(s, T0, 'admin', { assignment_group: '', category: 'network' });
    const c = build(s);
    c.rows('dl_definition_rel_set', [{ dl_definition: 'dl2', source_table_field: 'assignment_group', matcher_table_field: 'assignment_group', 'dl_definition.name': 'Assignment Lookup', 'dl_definition.run_on_form_change': 'true', 'dl_definition.run_on_update': 'true', 'dl_definition.matcher_table': 'dl_u_assignment', 'dl_definition.active': 'true', 'dl_definition.source_table': 'incident' }]);
    c.rows('dl_definition_rel_match', [{ dl_definition: 'dl2', source_table_field: 'category', matcher_table_field: 'category', exact_match: 'false' }]);
    c.rows('dl_u_assignment', []);
    c.rows('sys_script_client', []);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'assignment_group' });
    const ev = r.changes[0]!.evidence;
    expect(ev[0]!.type).toBe('assignment_rule');
    expect(ev[0]!.grade).toBe('confirmed');
    expect(ev.find((e) => e.type === 'data_lookup')!.facts.some((f) => f.kind === 'condition_false')).toBe(true);
  });

  it('gravações REST em rajada no mesmo segundo não viram cadeia de BRs', async () => {
    const s = scenario();
    br(s, 'PT after qualquer', 'after', 'if (current.state == 2) current.work_notes = "x";');
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    audit(s, 'state', '2', '1', T0, 'admin', 2);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'state'));
    expect(e.type).toBe('user_action');
  });
  it('cópia da mudança regravada por update() de BR after não vira uma segunda mudança', async () => {
    const s = scenario();
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 2);
    audit(s, 'urgency', '3', '2', T0, 'admin', 2);
    formTx(s, T0, 'admin', { contact_type: 'email' });
    const r = await run(s, 'contact_type');
    expect(r.changes.length).toBe(1);
    expect(top(r).type).toBe('user_action');
  });
  it('client script que grava outro valor literal não leva a culpa de vários campos digitados', async () => {
    const s = scenario();
    audit(s, 'description', 'inicial', 'F2 user', T0, 'admin', 1);
    audit(s, 'contact_type', 'self-service', 'phone', T0, 'admin', 1);
    formTx(s, T0, 'admin', { description: 'F2 user', contact_type: 'phone' });
    const c = build(s);
    c.rows('dl_definition_rel_set', []);
    c.rows('sys_script_client', [{ sys_id: id(), name: '[PT] client', type: 'onChange', field: 'contact_type', table: 'incident', active: 'true', script: "g_form.setValue('description', 'F2 client');" }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('user_action');
    expect(r.changes[0]!.evidence[0]!.grade).toBe('confirmed');
  });

  it('BR after com update(): a recarga da página não desfaz a cadeia; o valor literal escolhe entre BRs', async () => {
    const s = scenario();
    br(s, 'PT before outro', 'before', "current.description = 'outro';");
    br(s, 'PT after certo', 'after', "current.description = 'F2 after'; current.update();");
    audit(s, 'contact_type', 'a', 'b', T0, 'admin', 1);
    audit(s, 'description', 'inicial', 'F2 after', T0, 'admin', 2);
    formTx(s, T0, 'admin', { contact_type: 'b', description: 'inicial' });
    tx(s, T0, 'form', `/incident.do?sys_id=${INC.sysId}`, 'admin');
    const e = top(await run(s, 'description'));
    expect(e.type).toBe('br_after');
    expect(e.artifact.name).toBe('PT after certo');
  });
  it('botão Save do formulário não vira causa: a pessoa digitou e o formulário enviou o valor', async () => {
    const s = scenario();
    const save = id();
    audit(s, 'short_description', 'antes', 'depois', T0, 'admin', 1);
    const p = new URLSearchParams({ sys_action: save, sys_uniqueValue: INC.sysId, 'incident.short_description': 'depois' });
    tx(s, T0, 'form', `/incident.do?${p}`, 'admin');
    s.uiActions.push({ sys_id: save, name: 'Save', script: '', table: 'global', action_name: 'sysverb_update_and_stay' });
    const r = await run(s, 'short_description');
    const e = top(r);
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
    expect(r.changes[0]!.trace.find((t) => t.kind === 'form')?.label).toBe('Save');
  });
  it('gravação pela API sem automação concorrente: ação da pessoa com certeza alta', async () => {
    const s = scenario();
    s.record.short_description = '[PT] F2-REST';
    br(s, 'PT before outra', 'before', "current.description = 'F2 before';");
    s.brs[0]!.filter_condition = 'short_descriptionSTARTSWITH[PT] F2-BEFORE^EQ';
    audit(s, 'description', 'inicial', 'F2 rest', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'description'));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
  });

  it('gravação pela API com BR que pode ter gravado o mesmo valor: continua incerto', async () => {
    const s = scenario();
    br(s, 'PT before impacto', 'before', 'current.impact = 1;');
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const ev = (await run(s, 'impact')).changes[0]!.evidence;
    expect(ev.find((e) => e.type === 'user_action')!.grade).toBe('candidate');
  });
  it('condição avaliada com os valores da época, não com os de hoje', async () => {
    const s = scenario();
    s.record.short_description = 'texto novo';
    br(s, 'PT before mixed', 'before', 'current.urgency = 1;');
    s.brs[0]!.filter_condition = 'short_descriptionSTARTSWITH[PT] F2-MIXED^EQ';
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { urgency: '3' });
    audit(s, 'short_description', '[PT] F2-MIXED', 'texto novo', shiftStr(T0, 600), 'admin', 2);
    const e = top(await run(s, 'urgency'));
    expect(e.type).toBe('br_before');
    expect(e.facts.some((f) => f.kind === 'condition_true')).toBe(true);
  });
  it('flow com vários campos: aponta o passo que grava o campo (valores em gzip)', async () => {
    const s = scenario();
    const flowId = id();
    s.flows.push({ sys_id: id(), name: '[PT] Flow', state: 'COMPLETE', flow: flowId, sys_created_on: T0, sys_updated_on: T0 });
    audit(s, 'notify', '1', '3', T0, 'system', 2);
    audit(s, 'urgency', '3', '1', T0, 'system', 2);
    const json = JSON.stringify([{ name: 'table_name', value: 'incident' }, { name: 'values', value: 'notify=3^urgency=1' }]);
    const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    const b64 = Buffer.from(gz).toString('base64');
    const c = build(s);
    c.rows('sys_hub_action_instance_v2', [{ flow: flowId, order: '1', 'action_type.name': 'Update Record', values: b64 }, { flow: flowId, order: '2', 'action_type.name': 'Log', values: '[]' }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'urgency' });
    const e = r.changes[0]!.evidence[0]!;
    expect(e.type).toBe('flow');
    expect(e.grade).toBe('confirmed');
    expect(e.artifact.name).toContain('passo 1 (Update Record)');
  });

  it('flow que roda no registro mas nenhum passo grava o campo perde força', async () => {
    const s = scenario();
    const flowId = id();
    s.flows.push({ sys_id: id(), name: '[PT] Flow', state: 'COMPLETE', flow: flowId, sys_created_on: T0, sys_updated_on: T0 });
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { urgency: '1' });
    const c = build(s);
    c.rows('sys_hub_action_instance_v2', [{ flow: flowId, order: '1', 'action_type.name': 'Update Record', values: JSON.stringify([{ name: 'values', value: 'notify=3' }]) }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'urgency' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('user_action');
  });
  it('importação: linha de import set transformada no instante, com o campo mapeado', async () => {
    const s = scenario();
    audit(s, 'severity', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'other', '/sys_import.do', 'admin');
    const map = id();
    const c = build(s);
    // Duas linhas do mesmo transform map (criação + atualização) não podem virar empate.
    c.rows('sys_import_set_row', [
      { sys_id: id(), sys_target_sys_id: INC.sysId, sys_transform_map: map, 'sys_transform_map.name': '[PT] Importa incidentes', 'sys_import_set.number': 'ISET0010001', sys_import_state: 'updated', sys_updated_on: T0, sys_updated_by: 'admin' },
      { sys_id: id(), sys_target_sys_id: INC.sysId, sys_transform_map: map, 'sys_transform_map.name': '[PT] Importa incidentes', 'sys_import_set.number': 'ISET0010000', sys_import_state: 'inserted', sys_updated_on: T0, sys_updated_by: 'admin' },
    ]);
    c.rows('sys_transform_entry', [{ map, source_field: 'u_severidade', target_field: 'severity' }]);
    const e = (await investigate(c, { table: 'incident', number: INC.number, field: 'severity' })).changes[0]!.evidence[0]!;
    expect(e.type).toBe('import_set');
    expect(e.grade).toBe('confirmed');
  });

  it('API gravada por conta de integração aparece como integração', async () => {
    const s = scenario();
    audit(s, 'description', 'a', 'b', T0, 'svc.integra', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'svc.integra');
    const c = build(s);
    c.rows('sys_user', [{ user_name: 'svc.integra', name: 'Integração ERP', web_service_access_only: 'true' }]);
    const e = (await investigate(c, { table: 'incident', number: INC.number, field: 'description' })).changes[0]!.evidence[0]!;
    expect(e.type).toBe('user_action');
    expect(e.facts.some((f) => f.kind === 'integration_user')).toBe(true);
    expect(e.grade).toBe('confirmed');
  });

  it('concorrência: duas BRs before no mesmo campo, vence a de order maior; a outra vira "sobrescrita"', async () => {
    const s = scenario();
    br(s, 'PT ordem 100', 'before', "if (current.contact_type.changes()) current.impact = 2;", 'incident', '100');
    br(s, 'PT ordem 300', 'before', "if (current.contact_type.changes()) current.impact = 1;", 'incident', '300');
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { contact_type: 'email', impact: '3' });
    const ev = (await run(s, 'impact')).changes[0]!.evidence;
    expect(ev[0]!.artifact.name).toBe('PT ordem 300');
    expect(ev[0]!.grade).toBe('confirmed');
    const low = ev.find((e) => e.artifact.name === 'PT ordem 100')!;
    expect(low.gaps.some((g) => g.includes('gravou depois'))).toBe(true);
  });

  it('concorrência: BR que só LÊ o campo não é suspeita dele', async () => {
    const s = scenario();
    br(s, 'PT reage ao canal', 'before', "if (current.contact_type.changes()) current.urgency = 1;");
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'contact_type'));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
  });

  it('concorrência: guarda no script falsa (if no short_description) derruba a regra', async () => {
    const s = scenario();
    (s.record as Record<string, string>).short_description = 'Impressora sem rede';
    br(s, 'PT guarda falsa', 'before', "if (current.short_description.indexOf('[OUTRO]') == 0) current.impact = 1;");
    br(s, 'PT guarda certa', 'before', "if (current.short_description.indexOf('Impressora') == 0) current.impact = 1;");
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '3' });
    const ev = (await run(s, 'impact')).changes[0]!.evidence;
    expect(ev[0]!.artifact.name).toBe('PT guarda certa');
    expect(ev.find((e) => e.artifact.name === 'PT guarda falsa')!.facts.some((f) => f.kind === 'condition_false')).toBe(true);
  });

  it('cascata: BR after com update() dispara BR before que grava outro campo na gravação aninhada', async () => {
    const s = scenario();
    br(s, 'PT cascata A', 'after', "if (current.contact_type.changes() && current.description != 'A') { current.description = 'A'; current.update(); }");
    br(s, 'PT cascata B', 'before', "if (current.description.changes() && current.description == 'A') current.impact = 1;");
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    audit(s, 'description', 'x', 'A', T0, 'admin', 2);
    audit(s, 'impact', '3', '1', T0, 'admin', 2);
    formTx(s, T0, 'admin', { contact_type: 'email' });
    const imp = top(await run(s, 'impact'));
    expect(imp.artifact.name).toBe('PT cascata B');
    expect(imp.grade).toBe('confirmed');
    expect(imp.gaps.some((g) => g.includes('PT cascata A'))).toBe(true);
    const desc = top(await run(s, 'description'));
    expect(desc.artifact.name).toBe('PT cascata A');
  });

  it('valor calculado: description = short_description + " calc"', async () => {
    const s = scenario();
    (s.record as Record<string, string>).short_description = 'Impressora sem rede';
    br(s, 'PT calculo', 'before', "if (current.contact_type.changes()) current.description = current.short_description + ' calc';");
    br(s, 'PT literal', 'before', "if (current.contact_type.changes()) current.description = 'outra';");
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    audit(s, 'description', 'x', 'Impressora sem rede calc', T0, 'admin', 1);
    formTx(s, T0, 'admin', { contact_type: 'email', description: 'x' });
    const e = top(await run(s, 'description'));
    expect(e.artifact.name).toBe('PT calculo');
    expect(e.facts.some((f) => f.kind === 'sets_same_value')).toBe(true);
  });
});

import { siCallsWithField } from '../src/util';
describe('script include genérico e job sem transação', () => {
  it('acha a chamada new SI().metodo(id, "campo", "valor")', () => {
    expect(siCallsWithField("if (current.contact_type.changes()) new PTGrava().grava(current.getUniqueValue(), 'close_notes', 'M8 SI');", 'close_notes')).toEqual([{ si: 'PTGrava', call: "new PTGrava().grava(current.getUniqueValue(), 'close_notes', 'M8 SI')", value: 'M8 SI' }]);
    expect(siCallsWithField("new PTGrava().grava(x, 'impact')", 'close_notes')).toEqual([]);
  });

  it('BR after que passa o campo para um SI genérico → br_via_script_include confirmado', async () => {
    const s = scenario();
    const b = br(s, 'PT chama SI', 'after', "if (current.contact_type.changes()) new PTGrava().grava(current.getUniqueValue(), 'close_notes', 'M8 SI');");
    s.sis.push({ sys_id: id(), name: 'PTGrava', script: "var PTGrava = Class.create(); PTGrava.prototype = { grava: function(i, campo, valor) { var gr = new GlideRecord('incident'); if (gr.get(i)) { gr.setValue(campo, valor); gr.update(); } } };", active: 'true' });
    audit(s, 'contact_type', 'phone', 'email', T0, 'admin', 1);
    audit(s, 'close_notes', 'inicial', 'M8 SI', T0, 'admin', 2);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'close_notes'));
    expect([e.type, e.grade]).toEqual(['br_via_script_include', 'confirmed']);
    expect(e.artifact.name).toContain(b.name!);
  });

  it('job de execução única sem transação, mesmo com o usuário ativo em outras telas → job agendado', async () => {
    const s = scenario();
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', '/api/now/table/sys_user_group?sysparm_limit=1', 'admin');
    s.jobs.push({ sys_id: id(), name: 'PT job', script: "var gr = new GlideRecord('incident'); if (gr.get('x')) { gr.setValue('impact', '1'); gr.update(); }", run_type: 'once', run_start: T0, 'run_as.user_name': 'admin', active: 'true' });
    const e = top(await run(s, 'impact'));
    expect([e.type, e.grade]).toEqual(['scheduled_job', 'confirmed']);
  });
});

describe('job sem horário coincidente', () => {
  it('job que cita o campo e roda como o mesmo usuário, mas em outro horário, fica só como candidato', async () => {
    const s = scenario();
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    s.jobs.push({ sys_id: id(), name: 'PT job diário', script: "var gr = new GlideRecord('incident'); gr.setValue('impact', '1'); gr.update();", run_type: 'daily', run_time: '1970-01-01 05:00:00', 'run_as.user_name': 'admin', active: 'true' });
    const r = await run(s, 'impact');
    const j = r.changes[0]!.evidence.find((e) => e.type === 'scheduled_job')!;
    expect(j.grade).toBe('candidate');
  });
});

describe('achados do teste às cegas 2', () => {
  it('update() aninhado repete na auditoria o valor de antes da transação: a regra after é avaliada com o valor da gravação anterior', async () => {
    const s = scenario();
    br(s, 'PT revisão', 'after', "if (current.risk.changes() && String(current.test_plan).indexOf('(revisado') < 0) { current.test_plan = current.test_plan + ' (revisado)'; current.update(); }");
    audit(s, 'risk', '3', '2', T0, 'admin', 1);
    audit(s, 'test_plan', 'inicial', 'Testes', T0, 'admin', 1);
    audit(s, 'risk', '3', '2', T0, 'admin', 2);
    audit(s, 'test_plan', 'inicial', 'Testes (revisado)', T0, 'admin', 2);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'test_plan'));
    expect([e.type, e.artifact.name]).toEqual(['br_after', 'PT revisão']);
    expect(e.facts.some((f) => f.kind === 'sets_same_value')).toBe(true);
    expect(e.facts.some((f) => f.kind === 'sets_other_value')).toBe(false);
  });

  it('PATCH logo depois da criação continua sendo atualização (regra só de update vale)', async () => {
    const s = scenario();
    s.record.sys_created_on = shiftStr(T0, -1);
    br(s, 'PT só update', 'before', "if (current.category.changes()) current.urgency = '1';");
    audit(s, 'category', 'inquiry', 'network', T0, 'admin', 1);
    audit(s, 'urgency', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    s.brs[0]!.action_insert = 'false';
    const e = top(await run(s, 'urgency'));
    expect(e.type).toBe('br_before');
  });

  it('job nativo que rodou na janela mas não cita a tabela não encerra a busca', async () => {
    const s = scenario();
    audit(s, 'contact_type', 'phone', 'self-service', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    tx(s, T0, 'other', 'JOB: SN Managed Apps Auto Upgrade', 'system');
    s.jobs.push({ sys_id: id(), name: 'SN Managed Apps Auto Upgrade', script: 'new sn_appclient.Upgrader().run();', active: 'true' });
    const e = top(await run(s, 'contact_type'));
    expect(e.type).toBe('user_action');
  });

  it('regra que só lê campos por nome dinâmico (current[x].changes()) não vira gravação', async () => {
    const s = scenario();
    br(s, 'PT auditoria', 'before', "var c = ['impact','description']; for (var i = 0; i < c.length; i++) if (current[c[i]].changes()) gs.info(c[i]);");
    br(s, 'PT resumo', 'before', "if (current.impact.changes()) current.description = 'Impacto ' + current.impact.getDisplayValue();");
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    audit(s, 'description', 'x', 'Impacto 1 - High', T0, 'admin', 1);
    formTx(s, T0, 'admin', { impact: '1', description: 'x' });
    const r = await run(s, 'description');
    expect(top(r).artifact.name).toBe('PT resumo');
    expect(r.changes[0]!.evidence.find((e) => e.artifact.name === 'PT auditoria')!.facts.some((f) => f.kind === 'reads_only')).toBe(true);
  });
});

describe('leituras e tempo esgotado', () => {
  it('consulta que só cita o sys_id (auditoria, lista) não é gravação da pessoa: job de execução única continua sendo a causa', async () => {
    const s = scenario();
    audit(s, 'follow_up', '', '2026-12-24 15:00:00', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/sys_audit?sysparm_query=documentkey=${INC.sysId}`, 'admin');
    s.jobs.push({ sys_id: id(), name: 'PT job data', script: "var gr = new GlideRecord('incident'); if (gr.get('x')) { gr.setValue('follow_up', '2026-12-24 15:00:00'); gr.update(); }", run_type: 'once', run_start: T0, 'run_as.user_name': 'admin', active: 'true' });
    const e = top(await run(s, 'follow_up'));
    expect(e.type).toBe('scheduled_job');
  });

  it('se as regras da tabela não carregam (tempo esgotado), a gravação pela API não sai como certeza alta', async () => {
    const s = scenario();
    audit(s, 'impact', '3', '1', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const c = build(s);
    c.respond('sys_script', () => new Promise(() => undefined) as never);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'impact' }, { sourceTimeoutMs: 30 });
    const e = r.changes[0]!.evidence[0]!;
    expect(e.type).toBe('user_action');
    expect(e.grade).not.toBe('confirmed');
    expect(r.gaps.some((g) => g.startsWith('sys_script'))).toBe(true);
  });
});

describe('URL da transação cortada', () => {
  it('valor enviado truncado que é o começo do novo conta como enviado; client script que preenche continua sendo a causa', async () => {
    const s = scenario();
    audit(s, 'cause_notes', '', '<p>Possível falha de replicação</p>', T0, 'admin', 1);
    audit(s, 'category', 'software', 'network', T0, 'admin', 1);
    formTx(s, T0, 'admin', { cause_notes: '<p>Poss', category: 'network' });
    const c = build(s);
    c.rows('dl_definition_rel_set', []);
    c.rows('sys_script_client', [{ sys_id: id(), name: 'PT causa', type: 'onChange', field: 'category', table: 'incident', active: 'true', script: "function onChange(c, o, newValue) { if (newValue == 'network') g_form.setValue('cause_notes', '<p>Possível falha de replicação</p>'); }" }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'cause_notes' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('client_script');
  });
});

describe('conta de integração (Fase 12)', () => {
  it('gravação pela API: o valor que chegou é desconhecido, então a BR before que troca hardware por rede ainda pode ter gravado', async () => {
    const s = scenario();
    s.record.category = 'network';
    br(s, 'PT categoria da operadora', 'before', "if (gs.getUserName() != 'pt.integ') return;\nif (current.category == 'hardware') current.category = 'network';");
    audit(s, 'category', 'inquiry', 'network', T0, 'pt.integ', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'pt.integ');
    const e = top(await run(s, 'category'));
    expect(e.type).toBe('br_before');
    expect(e.facts.some((f) => f.kind === 'condition_false')).toBe(false);
  });

  it('gravação por lote da Batch API: a pessoa ou integração do lote, provável', async () => {
    const s = scenario();
    audit(s, 'description', '', 'Importado no lote', T0, 'pt.integ', 1);
    tx(s, shiftStr(T0, 1), 'rest', '/api/now/v1/batch', 'pt.integ');
    const r = await run(s, 'description');
    const e = top(r);
    expect(e.type).toBe('user_action');
    expect(e.artifact.name).toBe('pt.integ');
    expect(e.grade).toBe('probable');
    expect(r.changes[0]!.trace.some((t) => t.label.startsWith('Batch API'))).toBe(true);
  });

  it('lote da Batch API de outra pessoa não conta', async () => {
    const s = scenario();
    audit(s, 'description', '', 'Importado no lote', T0, 'pt.integ', 1);
    tx(s, T0, 'rest', '/api/now/v1/batch', 'outra.pessoa');
    const e = top(await run(s, 'description'));
    expect(e.type).not.toBe('user_action');
  });

  it('condição com trecho que não sabemos avaliar ainda é falsa quando uma parte do && é falsa (BR padrão do incidente filho)', async () => {
    const s = scenario();
    const b = br(s, 'Derive State value from Parent Incident', 'before', 'current.close_notes = current.parent_incident.close_notes;');
    b.condition = "current.parent_incident.changes() && !current.parent_incident.nil() && (!GlidePluginManager.isActive('com.sn_ot_inc_mgmt') || new TableUtils('sn_ot_incident').getAllExtensions().indexOf(current.getTableName()) < 0)";
    audit(s, 'close_notes', '', 'Conferido', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const e = top(await run(s, 'close_notes'));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
  });
});

describe('UI policy com script (Fase 13)', () => {
  const policy = (cond: string, branch: 'true' | 'false') => ({ sys_id: id(), short_description: '[PT] política', table: 'incident', active: 'true', run_scripts: 'true', ui_type: '0', reverse_if_false: 'true', conditions: cond,
    script_true: branch === 'true' ? "function onCondition() {\n  g_form.setValue('description', 'Verificar DNS');\n}" : 'function onCondition() {}',
    script_false: branch === 'false' ? "function onCondition() {\n  g_form.setValue('description', 'Verificar DNS');\n}" : 'function onCondition() {}' });
  const base = (category: string) => {
    const s = scenario();
    s.record.category = category;
    audit(s, 'description', '', 'Verificar DNS', T0, 'admin', 2);
    audit(s, 'category', 'inquiry', category, T0, 'admin', 2);
    formTx(s, T0, 'admin', { description: 'Verificar DNS', category });
    return s;
  };
  it('a condição passou a valer na gravação e o script grava o valor: a UI policy é a causa', async () => {
    const c = build(base('network'));
    c.rows('sys_ui_policy', [policy('category=network^EQ', 'true')]);
    const e = top(await investigate(c, { table: 'incident', number: INC.number, field: 'description' }));
    expect(e.type).toBe('ui_policy');
    expect(atLeast(e.grade, 'probable')).toBe(true);
  });
  it('ramo "senão": a condição deixou de valer e o script do senão grava', async () => {
    const c = build(base('software'));
    c.rows('sys_ui_policy', [policy('category=network^EQ', 'false')]);
    expect(top(await investigate(c, { table: 'incident', number: INC.number, field: 'description' })).type).toBe('ui_policy');
  });
  it('condição que não vale: a pessoa digitou', async () => {
    const c = build(base('software'));
    c.rows('sys_ui_policy', [policy('category=network^EQ', 'true')]);
    expect(top(await investigate(c, { table: 'incident', number: INC.number, field: 'description' })).type).toBe('user_action');
  });
});

describe('importação por transform map (Fase 13)', () => {
  const MAP = 'map1', ROW = 'row1';
  const imp = (s: ReturnType<typeof scenario>, entries: Record<string, string>[], stage: Record<string, string>, scripts: Record<string, string>[] = []) => {
    tx(s, T0, 'rest', '/api/now/import/u_stage', 'admin');
    const c = build(s);
    c.rows('sys_import_set_row', [{ sys_id: ROW, sys_class_name: 'u_stage', sys_target_sys_id: INC.sysId, sys_import_set: 'is1', 'sys_import_set.number': 'ISET001', sys_transform_map: MAP, 'sys_transform_map.name': 'PT mapa', sys_import_state: 'updated', sys_updated_on: T0, sys_updated_by: 'admin' }]);
    c.rows('sys_transform_entry', entries.map((e) => ({ map: MAP, ...e })));
    c.rows('sys_transform_script', scripts.map((e) => ({ map: MAP, active: 'true', ...e })));
    c.rows('sys_transform_map', [{ sys_id: MAP, run_script: 'false', script: '' }]);
    c.rows('u_stage', [{ sys_id: ROW, ...stage }]);
    return c;
  };
  const go = async (c: ReturnType<typeof build>, field: string) => investigate(c, { table: 'incident', number: INC.number, field });

  it('mapeamento direto e a linha trouxe o valor: importação, certeza alta', async () => {
    const s = scenario();
    audit(s, 'description', '', 'Falha no roteador', T0, 'admin', 1);
    const e = top(await go(imp(s, [{ source_field: 'u_descricao', target_field: 'description' }], { u_descricao: 'Falha no roteador' }), 'description'));
    expect(e.type).toBe('import_set');
    expect(e.grade).toBe('confirmed');
  });
  it('a linha trouxe hardware e ficou rede: a BR before da gravação é a causa', async () => {
    const s = scenario();
    s.record.category = 'network';
    br(s, 'PT hardware vira rede', 'before', "if (current.category == 'hardware') current.category = 'network';");
    audit(s, 'category', 'inquiry', 'network', T0, 'admin', 1);
    const e = top(await go(imp(s, [{ source_field: 'u_categoria', target_field: 'category' }], { u_categoria: 'hardware' }), 'category'));
    expect(e.type).toBe('br_before');
    expect(e.grade).toBe('confirmed');
  });
  it('script onBefore do transform map grava o campo: importação', async () => {
    const s = scenario();
    audit(s, 'correlation_id', '', 'PARC-44', T0, 'admin', 1);
    const e = top(await go(imp(s, [], {}, [{ when: 'onBefore', script: "target.correlation_id = 'PARC-' + source.u_codigo;" }]), 'correlation_id'));
    expect(e.type).toBe('import_set');
    expect(atLeast(e.grade, 'probable')).toBe(true);
  });
  it('o transform map não grava o campo: a importação não é a causa', async () => {
    const s = scenario();
    audit(s, 'urgency', '3', '2', T0, 'admin', 1);
    const r = await go(imp(s, [], {}), 'urgency');
    const e = r.changes[0]!.evidence.find((x) => x.type === 'import_set')!;
    expect(e.facts.some((f) => f.kind === 'no_step_writes_field')).toBe(true);
    expect(e.grade).toBe('candidate');
  });
});

describe('lista: atualizar selecionados e edição na célula (Fase 13)', () => {
  it('"Update Selected" envia o valor para vários registros: a pessoa, pelo formulário de atualização em massa', async () => {
    const s = scenario();
    audit(s, 'description', '', 'Atualizado em lote', T0, 'admin', 1);
    tx(s, T0, 'form', `/incident.do?sys_row=-1&sysparm_checked_items=sys_idINabc,${INC.sysId}&incident.description=Atualizado em lote&sys_action=sysverb_post_update`, 'admin');
    const r = await run(s, 'description');
    const e = top(r);
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('confirmed');
    expect(r.changes[0]!.trace.some((t) => t.label === 'Update Selected (lista)')).toBe(true);
  });
  it('abrir o formulário de atualização em massa não é gravação', async () => {
    const s = scenario();
    audit(s, 'description', '', 'x', T0, 'admin', 1);
    tx(s, T0, 'form', `/incident_update.do?sys_action=sysverb_multiple_update&sysparm_multiple=true&sysparm_checked_items=sys_idIN${INC.sysId}`, 'admin');
    expect(top(await run(s, 'description')).grade).not.toBe('confirmed');
  });
  it('edição na célula da lista (sem transação): a pessoa que abriu a lista pouco antes, provável', async () => {
    const s = scenario();
    audit(s, 'category', 'inquiry', 'software', T0, 'admin', 1);
    tx(s, shiftStr(T0, -120), 'list', '/incident_list.do?sysparm_query=active=true', 'admin');
    const c = build(s);
    c.rows('sys_user', [{ sys_id: id(), user_name: 'admin', name: 'System Administrator', web_service_access_only: 'false', internal_integration_user: 'false' }]);
    const e = top(await investigate(c, { table: 'incident', number: INC.number, field: 'category' }));
    expect(e.type).toBe('user_action');
    expect(e.grade).toBe('probable');
  });
});

describe('flow que chama subflow (Fase 14)', () => {
  it('o passo que grava o campo está dentro do subflow: o flow continua sendo a causa, apontando o subflow', async () => {
    const s = scenario();
    const flowId = id(), subId = id();
    s.flows.push({ sys_id: id(), name: '[PT] Flow pai', state: 'COMPLETE', flow: flowId, sys_created_on: T0, sys_updated_on: T0 });
    audit(s, 'description', '', 'Preenchido pelo subflow', shiftStr(T0, 2), 'admin', 2);
    audit(s, 'urgency', '3', '2', T0, 'admin', 1);
    tx(s, T0, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const c = build(s);
    c.rows('sys_hub_action_instance_v2', [
      { flow: flowId, order: '2', 'action_type.name': 'Update Record', values: JSON.stringify([{ name: 'values', value: 'close_notes=Nota' }]) },
      { flow: subId, order: '1', 'action_type.name': 'Update Record', values: JSON.stringify([{ name: 'values', value: 'description=Preenchido pelo subflow' }]) },
    ]);
    c.rows('sys_hub_sub_flow_instance_v2', [{ flow: flowId, order: '1', subflow: subId, 'subflow.name': '[PT] Subflow descrição' }]);
    const e = top(await investigate(c, { table: 'incident', number: INC.number, field: 'description' }));
    expect(e.type).toBe('flow');
    expect(e.grade).toBe('confirmed');
    expect(e.artifact.name).toContain('subflow [PT] Subflow descrição');
    expect(e.artifact.name).toContain('passo 1.1');
  });
});
