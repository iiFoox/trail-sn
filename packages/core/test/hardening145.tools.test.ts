/**
 * 1.4.5: ferramentas inteiras (investigate, recordTimeline, saveTiming, recordSaveTimes, fieldStates, automations, flows,
 * fieldRules, simulateValue, previewChange, fieldMap, visibility...) contra uma instância simulada por fetch:
 *  - admin (ui/meta indisponível: tudo vai à Table API) e itil (ui/meta vazio em todas as tabelas de sistema);
 *  - dados hostis (^, vírgula, quebra de linha, aspas, javascript:, emoji, sys_id falso) gerados com semente fixa.
 * Invariantes: nenhuma exceção; nenhuma consulta sem filtro, com IN vazio ou data inválida; tabelas de rastro sempre
 * ancoradas (sys_id/documentkey/instance ou janela de data); no perfil itil, nenhuma chamada à Table API barrada (403).
 * `it.fails` = DEFEITO encontrado (o teste descreve o comportamento correto).
 */
import { describe, expect, it } from 'vitest';
import { FetchRestClient } from '../src/client/FetchRestClient';
import { investigate } from '../src/investigate';
import { recordTimeline } from '../src/timeline';
import { recordSaveTimes, saveTiming } from '../src/saveTiming';
import { fieldStates } from '../src/fieldState';
import { tableAutomations } from '../src/automations';
import { recordFlows } from '../src/flows';
import { fieldRules, simulateValue, fieldDeps } from '../src/fieldDeps';
import { previewChange } from '../src/preview';
import { fieldMap } from '../src/fieldMap';
import { findUsers, visibility } from '../src/visibility';
import { scanTableConflicts } from '../src/conflicts';
import { historyToAudit } from '../src/history';
import type { HistoryResult } from '../src/client/RestClient';
import type { Row } from '../src/types';
import { NASTY, freshBase, problemsOf, rng, sim, snDate, type Col, type SimCfg } from './hardening145.helpers';

const S = '1f2e3d4c5b6a79881f2e3d4c5b6a7988';
const U = '0a0b0c0d0e0f10111213141516171819';
const U2 = '9a9b9c9d9e9f90919293949596979899';
const FLOW = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
const MAP = 'abababababababababababababababab';
const STAGE = 'u_stage_incident';
const T = (h: number, m = 0, s = 0) => `2026-10-20 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

interface World { rows: Record<string, Row[]>; history: unknown }

/** Registro com mudanças, transações, eventos, flow, import set e regras; `v` injeta valores hostis. */
function world(v: { old: string; nu: string; user: string; action: string; job: string; event: string; name: string; display: string; brName: string }): World {
  const now = Date.now();
  const recent = (sec: number) => snDate(now - sec * 1000);
  const rows: Record<string, Row[]> = {
    incident: [{ sys_id: S, number: 'INC0010001', short_description: v.name, sys_mod_count: '6', sys_created_on: T(10), sys_updated_on: recent(60), sys_updated_by: v.user, state: v.nu, caller_id: U, assignment_group: '' }],
    sys_db_object: [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }],
    sys_audit: [
      { sys_id: 'a1', tablename: 'incident', documentkey: S, fieldname: 'caller_id', oldvalue: '', newvalue: U, user: 'admin', sys_created_on: T(10), record_checkpoint: '1' },
      { sys_id: 'a2', tablename: 'incident', documentkey: S, fieldname: 'state', oldvalue: '1', newvalue: v.old, user: v.user, sys_created_on: T(11), record_checkpoint: '2' },
      { sys_id: 'a3', tablename: 'incident', documentkey: S, fieldname: 'state', oldvalue: v.old, newvalue: v.nu, user: 'system', sys_created_on: T(12), record_checkpoint: '3' },
      { sys_id: 'a4', tablename: 'incident', documentkey: S, fieldname: 'caller_id', oldvalue: U, newvalue: U2, user: v.user, sys_created_on: T(12, 30), record_checkpoint: '4' },
      { sys_id: 'a5', tablename: 'incident', documentkey: S, fieldname: 'short_description', oldvalue: 'x', newvalue: v.name, user: v.user, sys_created_on: recent(60), record_checkpoint: '5' },
    ],
    syslog_transaction: [
      { sys_id: 't1', sys_created_on: T(11, 0, 1), type: 'form', url: `/incident.do?sys_uniqueValue=${S}&incident.state=${encodeURIComponent(v.old)}&sys_action=${encodeURIComponent(v.action)}`, sys_created_by: v.user, response_time: '1200' },
      { sys_id: 't2', sys_created_on: T(12, 0, 1), type: 'other', url: `JOB: ${v.job}`, sys_created_by: 'system' },
      { sys_id: 't3', sys_created_on: T(12, 0, 2), type: 'other', url: `JOB: ASYNC: ${v.brName}`, sys_created_by: 'system' },
      { sys_id: 't4', sys_created_on: T(12, 30, 1), type: 'rest', url: `/api/now/table/incident/${S}`, sys_created_by: v.user },
      { sys_id: 't5', sys_created_on: T(11, 59, 30), type: 'list', url: '/incident_list.do?sysparm_query=active=true', sys_created_by: v.user },
      { sys_id: 't6', sys_created_on: recent(59), type: 'form', url: `/incident.do?sys_uniqueValue=${S}&sys_action=${encodeURIComponent(v.action)}`, sys_created_by: v.user, response_time: '900' },
    ],
    sysevent: [{ sys_id: 'e1', instance: S, name: v.event, processed: T(12, 0, 1), sys_created_on: T(12, 0, 1) }],
    sys_flow_context: [{ sys_id: 'fc'.repeat(16), source_record: S, name: 'Flow', state: 'COMPLETE', flow: FLOW, sys_created_on: T(12), sys_updated_on: T(12, 0, 3) }],
    sys_transform_map: [{ sys_id: MAP, source_table: STAGE, target_table: 'incident', name: v.name }],
    [STAGE]: [{ sys_id: 'st1', sys_target_sys_id: S, sys_updated_on: T(12, 30, 2), sys_import_set: 'is1', 'sys_import_set.number': 'ISET1', sys_transform_map: MAP, 'sys_transform_map.name': v.name, sys_import_state: 'inserted', u_state: v.nu }],
    sys_transform_entry: [{ map: MAP, source_field: 'u_state', target_field: 'state' }],
    sys_user: [{ sys_id: U, user_name: v.user, name: v.display }, { sys_id: U2, user_name: 'beth', name: 'Beth Anglin' }],
    sys_script: [{ sys_id: 'b1', name: v.brName, when: 'async', order: '100', collection: 'incident', script: 'current.state = 3; new X().y(current);', template: '', condition: '', filter_condition: `stateCHANGESTO${v.nu}^EQ`, action_insert: 'false', action_update: 'true', active: 'true' }],
    sys_script_include: [{ sys_id: 's1', name: 'X', script: 'current.state = 3;', active: 'true' }],
    sysauto_script: [{ sys_id: 'j1', name: v.job, script: 'gr.state=3; incident', active: 'true' }],
    sysevent_script_action: [{ sys_id: 'sa1', name: 'SA', event_name: v.event, script: 'current.state=3', active: 'true' }],
    sys_ui_action: [{ sys_id: 'ua1', name: 'Resolve', action_name: v.action, table: 'incident', script: 'current.state = 6', active: 'true' }],
    sys_hub_action_instance_v2: [{ flow: FLOW, order: '1', values: JSON.stringify([{ name: 'values', value: `state=${v.nu}` }, { name: 'table_name', value: 'incident' }]), 'action_type.name': 'Update Record' }],
    sys_choice: [{ name: 'incident', element: 'state', value: '1', label: 'New', language: 'en', inactive: 'false' }, { name: 'incident', element: 'state', value: v.nu, label: v.display, language: 'en', inactive: 'false' }],
    sys_dictionary: [{ name: 'incident', element: 'state', internal_type: 'integer', column_label: 'State' }, { name: 'task', element: 'caller_id', internal_type: 'reference', reference: 'sys_user', column_label: 'Caller' }],
  };
  const history = {
    fields: [{ name: 'state' }, { name: 'caller_id' }, { name: 'short_description' }, { name: 'comments', isJournal: true }],
    entries: [
      { sys_timestamp: Date.parse(T(10).replace(' ', 'T') + 'Z'), sys_created_on: T(10), user_id: U, sys_created_by: 'admin', entries: { changes: [{ field_name: 'caller_id', field_type: 'reference', old_value: '', new_value: v.display }] } },
      { sys_timestamp: Date.parse(T(11).replace(' ', 'T') + 'Z'), sys_created_on: T(11), user_id: U, sys_created_by: v.user, entries: { changes: [{ field_name: 'state', field_type: 'integer', old_value: 'New', new_value: v.old }] } },
      { sys_timestamp: Date.parse(T(12).replace(' ', 'T') + 'Z'), sys_created_on: T(12), user_id: U2, sys_created_by: 'system', entries: { changes: [{ field_name: 'state', field_type: 'integer', old_value: v.old, new_value: v.nu }] } },
      { sys_timestamp: Date.parse(T(12, 30).replace(' ', 'T') + 'Z'), sys_created_on: T(12, 30), user_id: U, sys_created_by: v.user, entries: { changes: [{ field_name: 'caller_id', field_type: 'reference', old_value: v.display, new_value: 'Beth Anglin' }] } },
    ],
  };
  return { rows, history };
}

const incMeta: Record<string, Col> = Object.fromEntries(['sys_id', 'number', 'short_description', 'sys_mod_count', 'sys_created_on', 'sys_updated_on', 'sys_updated_by', 'active', 'assignment_group', 'priority']
  .map((f) => [f, { canmatch: true, label: f, type: 'string' }]));
incMeta.state = { canmatch: true, label: 'Estado', type: 'choice', choices: [{ label: 'New', value: '1' }, { label: 'In Progress', value: '2' }] };
incMeta.caller_id = { canmatch: true, label: 'Solicitante', type: 'reference', reference: 'sys_user', reference_display_field: 'name' };
const userMeta: Record<string, Col> = { sys_id: { canmatch: true }, name: { canmatch: true }, user_name: { canmatch: true }, active: { canmatch: true }, first_name: { canmatch: true }, last_name: { canmatch: true } };

type Profile = 'admin' | 'itil';
function instance(w: World, profile: Profile, extra: Partial<SimCfg> = {}) {
  const cfg: SimCfg = profile === 'admin'
    ? { rows: w.rows, history: w.history, ...extra }
    : { rows: w.rows, history: w.history, denyEmptyMeta: true, meta: (t) => (t === 'incident' || t === 'task' ? incMeta : t === 'sys_user' ? userMeta : 'empty'), ...extra };
  const s = sim(cfg);
  const client = new FetchRestClient({ baseUrl: freshBase(profile), getToken: async () => `tok-${profile}`, fetchImpl: s.fetchImpl, timeoutMs: 2000 });
  return { s, client };
}

/** Problemas de todas as consultas registradas. */
function audit(s: ReturnType<typeof sim>, profile: Profile): string[] {
  const out: string[] = [];
  for (const l of s.log) for (const p of problemsOf(l.table, l.query, new Set([STAGE, 'sys_import_set_row']))) out.push(`${l.table}: ${p} :: ${l.query.slice(0, 160)}`);
  if (profile === 'itil') for (const b of s.barred) out.push(`barrada (403): ${b.table} :: ${b.query.slice(0, 120)}`);
  return out;
}

const clean = { old: '2', nu: '3', user: 'beth', action: 'resolve_incident', job: 'Auto close', event: 'incident.updated', name: 'Impressora', display: 'Beth Anglin', brName: 'Close it' };

type Tool = [string, (c: FetchRestClient) => Promise<unknown>];
const tools: Tool[] = [
  ['investigate state', (c) => investigate(c, { table: 'incident', sysId: S, field: 'state' })],
  ['investigate caller_id', (c) => investigate(c, { table: 'incident', sysId: S, field: 'caller_id' })],
  ['investigate short_description', (c) => investigate(c, { table: 'incident', sysId: S, field: 'short_description' })],
  ['investigate por número', (c) => investigate(c, { table: 'incident', number: 'INC0010001', field: 'state' })],
  ['recordTimeline', (c) => recordTimeline(c, { table: 'incident', sysId: S })],
  ['saveTiming (última)', (c) => saveTiming(c, { table: 'incident', sysId: S })],
  ['saveTiming (checkpoint 2)', (c) => saveTiming(c, { table: 'incident', sysId: S, checkpoint: 2 })],
  ['saveTiming (at)', (c) => saveTiming(c, { table: 'incident', sysId: S, at: T(12, 0, 2) })],
  ['recordSaveTimes', (c) => recordSaveTimes(c, { table: 'incident', sysId: S })],
  ['fieldStates', (c) => fieldStates(c, { table: 'incident', sysId: S, fields: [{ field: 'state' }, { field: 'caller_id' }, { field: 'short_description' }] })],
  ['tableAutomations', (c) => tableAutomations(c, { table: 'incident', sysId: S })],
  ['recordFlows', (c) => recordFlows(c, { table: 'incident', sysId: S })],
  ['fieldRules', (c) => fieldRules(c, { table: 'incident', field: 'state', sysId: S })],
  ['fieldDeps', (c) => fieldDeps(c, { table: 'incident', field: 'state', sysId: S })],
  ['simulateValue', (c) => simulateValue(c, { table: 'incident', sysId: S, field: 'state', value: '6' })],
  ['previewChange', (c) => previewChange(c, { table: 'incident', sysId: S, field: 'state', value: '6' })],
  ['fieldMap', (c) => fieldMap(c, { table: 'incident', field: 'state' })],
  ['visibility', (c) => visibility(c, { table: 'incident', sysId: S }, { fields: ['state'] })],
  ['scanTableConflicts', (c) => scanTableConflicts(c, 'incident')],
  ['findUsers', (c) => findUsers(c, 'beth')],
];

/** Ferramentas que hoje passam algum invariante: [ferramenta, perfil] → descrição do defeito (rodam como it.fails). */
const KNOWN: Record<string, string> = {
  // Nomes do histórico que não acham registro único (dois "Beth Anglin") ficam como texto; investigate.ts:160 filtra os
  // sys_ids e consulta sys_user com "sys_idIN" vazio.
};
/** Assinaturas de defeitos já isolados em testes próprios (it.fails abaixo): não repetem nos casos aleatórios. */
const KNOWN_SIGNATURES = [/^sys_ui_action: sem filtro/, /^syslog: IN vazio .*\^sourceIN$/, /^[a-z_]+: IN vazio :: sys_idIN$/, /^syslog_transaction: .*:: url=JOB: /];

async function runTool(fn: Tool[1], w: World, profile: Profile, extra: Partial<SimCfg> = {}) {
  const { s, client } = instance(w, profile, extra);
  let error: unknown;
  try { await fn(client); } catch (e) { error = e; }
  return { s, error, problems: audit(s, profile) };
}

describe('ferramentas com dados limpos', () => {
  for (const profile of ['admin', 'itil'] as const) {
    for (const [name, fn] of tools) {
      const key = `${name}|${profile}`;
      (KNOWN[key] ? it.fails : it)(`${name} (${profile}): sem exceção e sem consulta quebrada/barrada${KNOWN[key] ? ` — ${KNOWN[key]}` : ''}`, async () => {
        const { error, problems } = await runTool(fn, world(clean), profile);
        expect(error).toBeUndefined();
        if (problems.length) throw new Error('PROBLEMAS: ' + problems.join(' || '));
      });
    }
  }
});

describe('ferramentas com dados hostis (semente fixa)', () => {
  const r = rng(20261024);
  for (let i = 0; i < 24; i++) {
    const v = {
      old: r.pick(NASTY), nu: r.pick(NASTY), user: r.pick(['beth', ...NASTY.filter((x) => x)]), action: r.pick(['resolve_incident', 'ação', 'a b', 'x,y', '😀', 'javascript:x', 'sysverb_update', '0'.repeat(32)]),
      job: r.pick(NASTY), event: r.pick(NASTY), name: r.pick(NASTY), display: r.pick(NASTY), brName: r.pick(NASTY),
    };
    const profile: Profile = i % 2 ? 'itil' : 'admin';
    for (const [name, fn] of tools.filter((_, k) => k < 10)) {
      it(`semente ${i} ${profile} ${name}: ${JSON.stringify(v).slice(0, 80)}`, async () => {
        const { error, problems } = await runTool(fn, world(v), profile);
        expect(error).toBeUndefined();
        // Defeitos já isolados (KNOWN_SIGNATURES) têm teste próprio abaixo.
        { const pr = problems.filter((p) => !KNOWN_SIGNATURES.some((re) => re.test(p))); if (pr.length) throw new Error('PROBLEMAS: ' + pr.join(' || ')); }
      });
    }
  }
});

describe('consultas específicas (defeitos isolados)', () => {
  // util.ts:139 uiActionQuery devolve '' quando nenhuma referência é sys_id nem [\w.-]+ ("ação", "a b", emoji);
  // investigate.ts:189 e timeline.ts:146 consultam sys_ui_action com esse filtro vazio (tabela inteira, limit 20/30).
  for (const action of ['ação', 'a b', '😀', 'x,y']) {
    it(`CORRIGIDO: sys_action=${JSON.stringify(action)} faz investigate consultar sys_ui_action SEM filtro`, async () => {
      const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'state' }), world({ ...clean, action }), 'admin');
      expect(s.log.filter((l) => l.table === 'sys_ui_action' && !l.query)).toEqual([]);
    });
    it(`CORRIGIDO: sys_action=${JSON.stringify(action)} faz recordTimeline consultar sys_ui_action SEM filtro`, async () => {
      const { s } = await runTool((c) => recordTimeline(c, { table: 'incident', sysId: S }), world({ ...clean, action }), 'admin');
      expect(s.log.filter((l) => l.table === 'sys_ui_action' && !l.query)).toEqual([]);
    });
  }

  // investigate.ts:160: campo de referência com valores que não são sys_id (ex.: histórico do formulário sem nome único,
  // ou auditoria de referência com valor apagado) monta "sys_idIN" vazio na tabela referenciada.
  it('CORRIGIDO: referência sem nenhum valor sys_id monta sys_idIN vazio na tabela referenciada', async () => {
    const w = world(clean);
    w.rows.sys_audit = w.rows.sys_audit!.map((a) => (a.fieldname === 'caller_id' ? { ...a, oldvalue: a.oldvalue ? 'Fulano' : '', newvalue: 'Beltrano' } : a));
    const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'caller_id' }), w, 'admin');
    expect(s.log.filter((l) => /(^|\^)sys_idIN(\^|$)/.test(l.query))).toEqual([]);
  });

  // saveTiming.ts:374: nomes de BR com vírgula ou ^ são retirados, mas se TODOS forem retirados sobra "sourceIN" vazio.
  it('CORRIGIDO: todas as BRs com vírgula/^ no nome → syslog não é consultado (nada de sourceIN vazio)', async () => {
    const w = world({ ...clean, brName: 'Fecha, avisa' });
    const { s } = await runTool((c) => saveTiming(c, { table: 'incident', sysId: S, checkpoint: 3 }), w, 'admin');
    const sys = s.log.filter((l) => l.table === 'syslog');
    expect(sys.filter((l) => /sourceIN(\^|$)/.test(l.query))).toEqual([]);
  });

  // saveTiming.ts:289: a mediana de job/BR assíncrona filtra por `url=${url}` com o url cru da transação. Um nome com
  // "^NQ" abre um bloco novo SEM a janela de 6 h: varredura de syslog_transaction por url (sem índice).
  it('nome de job/BR com "^NQ" não tira a janela da consulta de mediana em syslog_transaction', async () => {
    const w = world({ ...clean, job: 'Fecha^NQsys_idISNOTEMPTY' });
    const { s } = await runTool((c) => saveTiming(c, { table: 'incident', sysId: S, at: T(12, 0, 2) }), w, 'admin');
    const bad = s.log.filter((l) => l.table === 'syslog_transaction').flatMap((l) => problemsOf(l.table, l.query));
    expect(bad).toEqual([]);
  });
  it('nome de job com ^ (sem NQ) mantém a janela no mesmo bloco', async () => {
    const w = world({ ...clean, job: 'Calc ^ prioridade' });
    const { s } = await runTool((c) => saveTiming(c, { table: 'incident', sysId: S, at: T(12, 0, 2) }), w, 'admin');
    expect(s.log.filter((l) => l.table === 'syslog_transaction').flatMap((l) => problemsOf(l.table, l.query))).toEqual([]);
  });

  // history.ts:50: nome exibido de referência entra em "<campo>IN<nomes>" sem barrar "javascript:" (valor do usuário).
  it('nome exibido "javascript:..." no histórico não vai para nameIN na tabela referenciada', async () => {
    const w = world({ ...clean, display: 'javascript:gs.sleep(9000)' });
    const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'caller_id' }), w, 'itil');
    expect(s.log.filter((l) => l.query.includes('javascript:'))).toEqual([]);
  });

  // investigate.ts:147 (e 312), timeline.ts:143, saveTiming.ts:175: shift() de data inválida lança RangeError.
  // O histórico do formulário sem sys_timestamp usa sys_created_on como veio (parseHistory, FetchRestClient.ts:402).
  for (const [name, fn] of [
    ['investigate', (c: FetchRestClient) => investigate(c, { table: 'incident', sysId: S, field: 'state' })],
    ['recordTimeline', (c: FetchRestClient) => recordTimeline(c, { table: 'incident', sysId: S })],
    ['recordSaveTimes', (c: FetchRestClient) => recordSaveTimes(c, { table: 'incident', sysId: S })],
  ] as const) {
    it(`CORRIGIDO: histórico com data fora do formato (sem sys_timestamp) derruba ${name} com RangeError`, async () => {
      const w = world(clean);
      const h = w.history as { entries: { sys_timestamp?: number; sys_created_on: string }[] };
      for (const e of h.entries) { delete e.sys_timestamp; }
      h.entries[2]!.sys_created_on = '20/10/2026 12:00:00';
      if (name === 'recordSaveTimes') h.entries[2]!.sys_created_on = 'zz-10-20 12:00:00';
      const { error } = await runTool(fn, w, 'itil');
      expect(error).toBeUndefined();
    });
  }

  it('sys_id falso / injeção no alvo: o motor recusa antes de consultar (segunda trava, além da extensão)', async () => {
    const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: `${S}^ORsys_idISNOTEMPTY`, field: 'state' }).catch(() => undefined), world(clean), 'admin');
    expect(s.log.filter((l) => l.query.includes('ISNOTEMPTY'))).toEqual([]);
  });

  // investigate.ts:113/162/190/192/193/195/212/215/217: target.field entra cru nas consultas (sem /^[a-z0-9_]+$/).
  it('CORRIGIDO (baixo): target.field com ^ é injetado nas consultas de dicionário/scripts', async () => {
    const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'state^NQactive=true' }), world(clean), 'admin');
    expect(s.log.filter((l) => l.query.includes('^NQactive=true'))).toEqual([]);
  });

  it('nenhuma consulta a tabela de rastro sai sem âncora, com 10 mudanças em meses diferentes', async () => {
    const w = world(clean);
    const audits: Row[] = [];
    for (let k = 0; k < 12; k++) audits.push({ sys_id: `x${k}`, tablename: 'incident', documentkey: S, fieldname: 'state', oldvalue: String(k), newvalue: String(k + 1), user: 'beth', sys_created_on: `2026-${String((k % 9) + 1).padStart(2, '0')}-1${k % 9} 0${k % 9}:00:00`, record_checkpoint: String(k + 1) });
    w.rows.sys_audit = audits;
    const { s, error, problems } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'state' }), w, 'admin');
    expect(error).toBeUndefined();
    if (problems.length) throw new Error('PROBLEMAS: ' + problems.join(' || '));
    // Edição em lista: janela de meia hora por mudança, nunca um intervalo de meses.
    for (const l of s.log.filter((x) => x.table === 'syslog_transaction')) {
      for (const block of l.query.split('^NQ')) {
        const from = block.match(/sys_created_on>=([^^]+)/)?.[1];
        const to = block.match(/sys_created_on<=([^^]+)/)?.[1];
        expect(Date.parse(to!.replace(' ', 'T') + 'Z') - Date.parse(from!.replace(' ', 'T') + 'Z')).toBeLessThanOrEqual(2 * 3600e3);
      }
    }
  });

  it('import set: staging só com sys_target_sys_id + janela de 1 min; nunca sys_import_set_row', async () => {
    const { s } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'state' }), world(clean), 'admin');
    expect(s.log.some((l) => l.table === 'sys_import_set_row')).toBe(false);
    const st = s.log.filter((l) => l.table === STAGE && !l.query.startsWith('sys_idIN'));
    expect(st.length).toBe(1);
    for (const block of st[0]!.query.replace(/\^ORDERBY.*$/, '').split('^NQ')) expect(block).toMatch(new RegExp(`^sys_target_sys_id=${S}\\^sys_updated_on>=.+\\^sys_updated_on<=.+$`));
  });

  it('source_table de transform map fora do padrão (ou sys_import_set_row) nunca é consultada sem âncora', async () => {
    const w = world(clean);
    w.rows.sys_transform_map = [{ sys_id: MAP, source_table: 'u_Stage', target_table: 'incident' }, { sys_id: 'm2', source_table: 'sys_import_set_row', target_table: 'incident' }, { sys_id: 'm3', source_table: 'x;drop', target_table: 'incident' }];
    const { s, problems } = await runTool((c) => investigate(c, { table: 'incident', sysId: S, field: 'state' }), w, 'admin');
    if (problems.length) throw new Error('PROBLEMAS: ' + problems.join(' || '));
    for (const l of s.log.filter((x) => x.table === 'sys_import_set_row')) expect(l.query).toContain(`sys_target_sys_id=${S}^sys_updated_on>=`);
  });

  it('histórico com user_id hostil não injeta na consulta de sys_user', async () => {
    const h: HistoryResult = { fields: ['state'], entries: [{ at: T(11), userId: 'x^NQsys_idISNOTEMPTY', userName: 'beth', changes: [{ field: 'state', oldValue: '1', newValue: '2' }] }] };
    const seen: string[] = [];
    await historyToAudit(h, ['incident'], async (_t, q) => { seen.push(q); return []; });
    // Só sys_id de verdade entra no sys_idIN.
    expect(seen.some((q) => q.includes('ISNOTEMPTY'))).toBe(false);
  });

  it('itil: nenhuma ferramenta chama a Table API para tabela com ui/meta vazio (todas juntas, mesma instância)', async () => {
    const w = world(clean);
    const { s, client } = instance(w, 'itil');
    const errors: string[] = [];
    await Promise.all(tools.map(([n, fn]) => fn(client).catch((e: Error) => { errors.push(`${n}: ${e.message}`); })));
    expect(errors).toEqual([]);
    expect(s.barred.map((b) => b.table)).toEqual([]);
    expect(s.maxInFlight).toBeLessThanOrEqual(2);
  }, 30_000);

  it('admin: todas as ferramentas juntas na mesma instância nunca passam de 2 chamadas simultâneas (sem histórico)', async () => {
    const w = world(clean);
    const { s, client } = instance(w, 'admin', { latencyMs: 1 });
    await Promise.all(tools.map(([, fn]) => fn(client).catch(() => undefined)));
    expect(s.maxInFlight).toBeLessThanOrEqual(2);
  }, 30_000);
});
