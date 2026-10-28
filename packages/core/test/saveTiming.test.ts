import { describe, expect, it } from 'vitest';
import { FakeRestClient, filterRows } from '../src/client/FakeRestClient';
import { describeSaveTiming, parseMs, recentSlowSaves, recordSaveTimes, saveTiming, verdictOf, windowsQuery } from '../src/saveTiming';
import { shift } from '../src/util';

const ID = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const AT = '2026-10-21 12:00:00';
const ALL_FIELDS = ['response_time', 'client_response_time', 'business_rule_time', 'business_rule_count', 'sql_time', 'sql_count', 'acl_time', 'browser_time', 'client_network_time',
  'semaphore_wait_time', 'session_wait_time', 'output_length', 'additional_debug_count', 'additional_info'];
const dict = (fields = ALL_FIELDS) => fields.map((element) => ({ name: 'syslog_transaction', element, internal_type: 'integer' }));
const formUrl = (id = ID) => `/incident.do?sys_id=${id}&sys_uniqueValue=${id}&sys_action=sysverb_update`;
const tx = (o: Record<string, string>) => ({ sys_id: `tx${Math.random().toString(16).slice(2, 10)}`, type: 'form', sys_created_by: 'beth', url: formUrl(), ...o });
/** Salvamentos normais da tabela nas horas anteriores (para a mediana). */
const history = (n: number, ms = 600) => Array.from({ length: n }, (_, i) => tx({ sys_id: `h${i}`, sys_created_on: shift(AT, -3600 - i * 60), url: formUrl(`${i}`.padStart(32, 'c')), response_time: String(ms + (i % 3) * 10) }));

function base(o: { tx?: Record<string, string>[]; dict?: Record<string, string>[] | null; brs?: Record<string, string>[] } = {}) {
  const c = new FakeRestClient();
  c.rows('sys_db_object', [{ name: 'incident', 'super_class.name': 'task' }, { name: 'task', 'super_class.name': '' }]);
  // Cada salvamento de outro registro nas transações também atualizou esse registro (sys_updated_on ~1 s antes do fim).
  const others = (o.tx ?? []).map((t) => ({ id: (t.url ?? '').match(/sys_uniqueValue=([0-9a-f]{32})/)?.[1] ?? (t.url ?? '').match(/table\/incident\/([0-9a-f]{32})/)?.[1], at: t.sys_created_on ?? '' }))
    .filter((x) => x.id && x.id !== ID).map((x) => ({ sys_id: x.id!, sys_updated_on: shift(x.at, -1) }));
  c.rows('incident', [{ sys_id: ID, sys_created_on: '2026-10-20 09:00:00', sys_updated_on: AT, sys_updated_by: 'beth', state: '2', priority: '1', category: 'network' }, ...others]);
  c.rows('sys_audit', [
    { fieldname: 'state', oldvalue: '1', newvalue: '2', user: 'beth', sys_created_on: AT, record_checkpoint: '3', tablename: 'incident', documentkey: ID },
    { fieldname: 'priority', oldvalue: '3', newvalue: '1', user: 'beth', sys_created_on: shift(AT, -7200), record_checkpoint: '2', tablename: 'incident', documentkey: ID },
  ]);
  if (o.dict !== null) c.rows('sys_dictionary', o.dict ?? dict());
  c.rows('syslog_transaction', o.tx ?? []);
  c.rows('sys_script', o.brs ?? []);
  c.rows('syslog', []);
  c.rows('sysevent', []);
  c.rows('sys_flow_context', []);
  return c;
}
const br = (o: Record<string, string>) => ({ active: 'true', collection: 'incident', when: 'before', order: '100', action_insert: 'false', action_update: 'true', filter_condition: '', condition: '', ...o });

describe('saveTiming', () => {
  it('salvamento normal: acha a transação do formulário, compara com a mediana da tabela', async () => {
    const c = base({ tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '650', business_rule_time: '120', business_rule_count: '9', sql_time: '200', sql_count: '41' }), ...history(12)] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t).toMatchObject({ at: AT, checkpoint: 3, txSysId: 'T1', via: 'form', user: 'beth', totalMs: 650, totalFrom: 'server', verdict: 'normal', verdictBasis: 'baseline', fieldsFrom: 'dictionary' });
    expect(t.parts).toMatchObject({ server: 650, rules: 120, rulesCount: 9, sql: 200, sqlCount: 41 });
    expect(t.baseline).toMatchObject({ n: 12, scope: 'table', hours: 24 });
    expect(t.baseline!.medianMs).toBe(610);
    expect(t.timingFields.server).toBe('response_time');
    expect(t.denied).toEqual([]);
    expect(describeSaveTiming(t)).toContain('Salvou em 0,7 s');
    expect(describeSaveTiming(t)).toContain('O normal nesta tabela é 0,6 s');
    expect(describeSaveTiming(t)).toContain('Dentro do normal.');
    // Só GET de leitura; a transação é pedida só com os campos que o dicionário lista.
    const txReq = c.log.find((r) => r.table === 'syslog_transaction')!;
    expect(txReq.fields).toContain('business_rule_time');
    expect(txReq.fields).not.toContain('br_time');
  });

  it('salvamento lento com regras dominando: diz quanto foi em regras e quais rodaram, sem tempo por regra', async () => {
    const brs = [
      br({ sys_id: 'b1', name: 'Recalcula SLA', order: '200', filter_condition: 'stateVALCHANGES^EQ' }),
      br({ sys_id: 'b2', name: 'Só no insert', action_insert: 'true', action_update: 'false' }),
      br({ sys_id: 'b3', name: 'Categoria hardware', filter_condition: 'category=hardware' }),
      br({ sys_id: 'b4', name: 'Prioridade alta', when: 'after', condition: "current.priority == '1'" }),
      br({ sys_id: 'b5', name: 'Notifica fora', when: 'async', filter_condition: '' }),
      br({ sys_id: 'b6', name: 'Script obscuro', condition: 'new Foo().bar()' }),
      br({ sys_id: 'b7', name: 'Mostra', when: 'display' }),
    ];
    const c = base({ brs, tx: [
      tx({ sys_id: 'T1', sys_created_on: shift(AT, 4), response_time: '4200', business_rule_time: '3100', business_rule_count: '14', sql_time: '900', sql_count: '41', semaphore_wait_time: '0', session_wait_time: '0' }),
      tx({ sys_id: 'J1', url: 'JOB: ASYNC: Notifica fora', sys_created_by: 'system', sys_created_on: shift(AT, 9), response_time: '300' }),
      ...history(10),
    ] });
    c.rows('syslog', [{ source: 'Recalcula SLA', sys_created_on: shift(AT, 2) }]);
    c.rows('sysevent', [{ sys_id: 'e1', name: 'incident.updated', instance: ID, sys_created_on: shift(AT, 1) }, { sys_id: 'e2', name: 'text_index', instance: ID, sys_created_on: AT }]);
    c.rows('sys_flow_context', [{ sys_id: 'f1', name: 'Avisa o grupo', source_record: ID, sys_created_on: shift(AT, 3) }]);
    const t = await saveTiming(c, { table: 'incident', sysId: ID, at: AT });
    expect(t).toMatchObject({ checkpoint: 3, txSysId: 'T1', totalMs: 4200, verdict: 'muito_lento', where: 'rules', txStart: shift(AT, -1) });
    expect(t.ran.map((r) => [r.kind, r.name, r.seen])).toEqual([
      ['br_before', 'Recalcula SLA', true],
      ['br_after', 'Prioridade alta', false],
      ['br_async', 'Notifica fora', true],
      ['event', 'incident.updated', true],
      ['flow', 'Avisa o grupo', true],
    ]);
    expect(t.notes).toEqual(expect.arrayContaining(['rules_unevaluated:1', 'async_separate', 'per_rule_time_unknown']));
    const txt = describeSaveTiming(t);
    expect(txt).toContain('Salvou em 4,2 s — 3,1 s em regras de negócio e 41 consultas ao banco (0,9 s).');
    expect(txt).toContain('Está muito lento (7× o normal).');
    expect(txt).toContain('Rodaram neste salvamento: 2 regras de negócio, 1 flow e 1 evento.');
    expect(txt).toContain('1 regra rodou depois, em segundo plano');
    expect(txt).toContain('não o tempo de cada uma');
    expect(describeSaveTiming(t, 'en')).toContain('Saved in 4.2 s — 3.1 s in business rules and 41 database queries (0.9 s).');
  });

  it('mediana: janelas em volta das gravações de outros registros, unidas por ^NQ, sem varrer 24 h por url', async () => {
    const c = base({ tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '650' }), ...history(12)] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.baseline).toMatchObject({ n: 12, scope: 'table' });
    const upd = c.log.find((r) => r.table === 'incident' && r.query.startsWith('sys_updated_on>='))!;
    expect(upd).toMatchObject({ limit: 21, fields: ['sys_id', 'sys_updated_on'] });
    const q = c.log.filter((r) => r.table === 'syslog_transaction').map((r) => r.query);
    expect(q).toHaveLength(2);
    const blocks = q[1]!.split('^NQ');
    expect(blocks).toHaveLength(12);
    // Cada bloco: o filtro de url do tipo + uma janela curta de sys_created_on (nunca as 24 h inteiras).
    for (const b of blocks) {
      const m = b.match(/^urlLIKE\/incident\.do\?\^urlLIKEsys_uniqueValue=\^sys_created_on>=(.{19})\^sys_created_on<=(.{19})$/)!;
      expect(m).toBeTruthy();
      expect(Date.parse(m[2]!.replace(' ', 'T') + 'Z') - Date.parse(m[1]!.replace(' ', 'T') + 'Z')).toBe(32_000);
    }
  });

  it('mediana que estoura o prazo: desiste cedo (uma tentativa), avisa baseline_slow, não "poucos salvamentos"', async () => {
    const rows = [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '2500' }), ...history(8)];
    const c = base({ tx: rows });
    let slowCalls = 0;
    c.respond('syslog_transaction', async (req) => {
      if (!req.query.startsWith('urlLIKE')) return filterRows(rows, req.query);
      slowCalls++;
      await new Promise((r) => setTimeout(r, 300));
      return filterRows(rows, req.query);
    });
    const t0 = Date.now();
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 }, { baselineTimeoutMs: 40 });
    expect(Date.now() - t0).toBeLessThan(250);
    expect(slowCalls).toBe(1);
    expect(t.txSysId).toBe('T1');
    expect(t.notes).toContain('baseline_slow');
    expect(t.notes.some((n) => n.startsWith('baseline_few'))).toBe(false);
    expect(t).toMatchObject({ verdict: 'lento', verdictBasis: 'absolute' });
    expect(describeSaveTiming(t)).toContain('demorou demais para comparar');
  });

  it('campos de tempo ausentes na versão: usa só os que o dicionário tem e avisa', async () => {
    const c = base({ dict: dict(['response_time', 'sql_time']), tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '2500', sql_time: '1800', business_rule_time: '999' })] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.timingFields).toEqual({ server: 'response_time', sql: 'sql_time' });
    expect(t.parts).toEqual({ server: 2500, sql: 1800 });
    expect(t.parts.rules).toBeUndefined();
    expect(t.notes).toEqual(expect.arrayContaining(['no_rule_time', 'no_client_time', 'baseline_few:0']));
    expect(t).toMatchObject({ verdict: 'lento', verdictBasis: 'absolute', where: 'sql' });
    expect(describeSaveTiming(t)).toContain('Salvou em 2,5 s — 1,8 s no banco.');
    expect(describeSaveTiming(t)).toContain('Poucos salvamentos parecidos');
  });

  it('sem dicionário (itil): sondagem — pede todos os candidatos e usa os que vieram', async () => {
    const c = base({ dict: [], tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '800', client_response_time: '1500', browser_time: '500', client_network_time: '200' })] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.fieldsFrom).toBe('probe');
    expect(t.notes).toContain('dict_unavailable');
    expect(t).toMatchObject({ totalMs: 1500, totalFrom: 'client', parts: { server: 800, client: 500, network: 200 } });
    expect(t.timingFields.rules).toBeUndefined();
    expect(describeSaveTiming(t)).toContain('0,5 s no navegador e 0,2 s na rede');
  });

  it('syslog_transaction negada (403): sem_dado, sem estimar; ainda lista regras pelas condições', async () => {
    const c = base({ brs: [br({ sys_id: 'b1', name: 'Recalcula SLA', filter_condition: 'stateVALCHANGES' })] });
    c.deny('syslog_transaction');
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.verdict).toBe('sem_dado');
    expect(t.totalMs).toBeUndefined();
    expect(t.parts).toEqual({});
    expect(t.baseline).toBeUndefined();
    expect(t.denied).toContain('syslog_transaction');
    expect(t.notes).toContain('tx_denied');
    expect(t.ran.map((r) => [r.name, r.seen])).toEqual([['Recalcula SLA', false]]);
    const txt = describeSaveTiming(t);
    expect(txt).toContain('Não dá para medir');
    expect(txt).not.toMatch(/Salvou em/);
    // Nenhuma consulta de mediana depois da negação.
    expect(c.log.filter((r) => r.table === 'syslog_transaction')).toHaveLength(1);
  });

  it('itil: sys_audit e sys_script negados, histórico do formulário dá o instante', async () => {
    const c = base();
    c.deny('syslog_transaction').deny('sys_audit').deny('sys_script');
    c.rows('sys_user', [{ sys_id: 'u1', user_name: 'beth' }]);
    c.withHistory({ entries: [{ at: AT, userId: 'u1', changes: [{ field: 'state', oldValue: 'New', newValue: 'In Progress' }] }], fields: ['state'] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID });
    expect(t.at).toBe(AT);
    expect(t.verdict).toBe('sem_dado');
    expect(t.denied).toEqual(expect.arrayContaining(['syslog_transaction', 'sys_script']));
    expect(t.denied).not.toContain('sys_audit');
    expect(t.notes).toEqual(expect.arrayContaining(['tx_denied', 'rules_denied']));
    expect(describeSaveTiming(t)).toContain('não leem as regras de negócio');
  });

  it('mediana com poucas amostras (n < 5): não compara, veredito por limite fixo', async () => {
    const c = base({ tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '1500' }), ...history(4, 100)] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.baseline).toBeUndefined();
    expect(t.notes).toContain('baseline_few:4');
    expect(t).toMatchObject({ verdict: 'normal', verdictBasis: 'absolute' });
    expect(describeSaveTiming(t)).not.toContain('O normal');
  });

  it('várias transações na janela: escolhe a gravação deste registro, da pessoa, aberta no instante', async () => {
    const c = base({ tx: [
      tx({ sys_id: 'OUTRO_REG', url: formUrl(OTHER), sys_created_on: shift(AT, 1), response_time: '9000' }),
      tx({ sys_id: 'RELOAD', url: `/incident.do?sys_id=${ID}`, sys_created_on: shift(AT, 2), response_time: '300' }),
      tx({ sys_id: 'OUTRA_PESSOA', sys_created_by: 'abel', sys_created_on: shift(AT, 2), response_time: '400' }),
      tx({ sys_id: 'SEGUNDO_SAVE', sys_created_on: shift(AT, 25), response_time: '700' }),
      tx({ sys_id: 'CERTA', sys_created_on: shift(AT, 3), response_time: '3500' }),
      tx({ sys_id: 'JOB', url: 'JOB: Limpeza', sys_created_by: 'system', sys_created_on: shift(AT, 1), response_time: '5000' }),
    ] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.txSysId).toBe('CERTA');
    expect(t.totalMs).toBe(3500);
  });

  it('gravação por job (sem transação do registro): a transação do job aberta no instante, marcada como por horário', async () => {
    const c = base({ tx: [
      tx({ sys_id: 'JOB', url: 'JOB: Fecha antigos', sys_created_by: 'system', sys_created_on: shift(AT, 6), response_time: '8000' }),
      ...Array.from({ length: 6 }, (_, i) => tx({ sys_id: `jh${i}`, url: 'JOB: Fecha antigos', sys_created_by: 'system', sys_created_on: shift(AT, -3600 * (i + 1)), response_time: '7000' })),
    ] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t).toMatchObject({ txSysId: 'JOB', via: 'job', totalMs: 8000, verdict: 'normal', baseline: { medianMs: 7000, n: 6, scope: 'url' } });
    expect(t.notes).toContain('tx_job_by_time');
    expect(describeSaveTiming(t)).toContain('nesta mesma rotina');
  });

  it('transação não achada (expirou): sem_dado com texto honesto', async () => {
    const c = base({ tx: [] });
    const t = await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(t.verdict).toBe('sem_dado');
    expect(t.notes).toContain('tx_not_found');
    expect(describeSaveTiming(t)).toContain('Não achei a transação');
  });
});

describe('recordSaveTimes / recentSlowSaves', () => {
  it('lista as gravações do registro com tempo, sem recargas da página: janelas pela auditoria, não urlLIKE em 7 dias', async () => {
    const now = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    const c = base({ tx: [
      tx({ sys_id: 'S1', sys_created_on: now, response_time: '6200' }),
      tx({ sys_id: 'S2', sys_created_on: shift(now, -600), response_time: '400' }),
      tx({ sys_id: 'R', url: `/incident.do?sys_id=${ID}`, sys_created_on: shift(now, -300), response_time: '100' }),
      tx({ sys_id: 'API', url: `/api/now/table/incident/${ID}`, sys_created_on: shift(now, -900), response_time: '2500' }),
      tx({ sys_id: 'LONGE', sys_created_on: shift(now, -3 * 864e2), response_time: '9000' }),
    ] });
    // Gravações vistas na auditoria (a transação termina um pouco depois do instante gravado).
    c.rows('sys_audit', [shift(now, -1), shift(now, -601), shift(now, -901)].map((at, i) => ({ fieldname: 'state', user: 'beth', sys_created_on: at, record_checkpoint: String(5 - i), tablename: 'incident', documentkey: ID })));
    const r = await recordSaveTimes(c, { table: 'incident', sysId: ID });
    expect(r.saves.map((s) => [s.txSysId, s.via, s.verdict])).toEqual([['S1', 'form', 'muito_lento'], ['S2', 'form', 'normal'], ['API', 'api', 'lento']]);
    expect(r.notes).toContain('saves_from_audit');
    const q = c.log.filter((x) => x.table === 'syslog_transaction');
    expect(q).toHaveLength(1);
    expect(q[0]!.query.split('^NQ').every((b) => b.startsWith(`urlLIKE${ID}^sys_created_on>=`))).toBe(true);
    const slow = await recentSlowSaves(c, { table: 'incident', sysId: ID });
    expect(slow.saves.map((s) => s.txSysId)).toEqual(['S1', 'API']);
  });

  it('auditoria negada: instantes pelo histórico do formulário; sem instante nenhum, não consulta', async () => {
    const now = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
    const c = base({ tx: [tx({ sys_id: 'S1', sys_created_on: shift(now, 2), response_time: '700' })] });
    c.deny('sys_audit').deny('incident');
    c.withHistory({ entries: [{ at: now, userId: 'u1', changes: [{ field: 'state', oldValue: 'New', newValue: 'In Progress' }] }], fields: ['state'] });
    const r = await recordSaveTimes(c, { table: 'incident', sysId: ID });
    expect(r.saves.map((s) => s.txSysId)).toEqual(['S1']);
    expect(r.notes).toContain('saves_from_history');
    const none = base({ tx: [tx({ sys_id: 'S1', sys_created_on: now })] });
    none.deny('sys_audit').deny('incident');
    const e = await recordSaveTimes(none, { table: 'incident', sysId: ID });
    expect(e.saves).toEqual([]);
    expect(e.notes).toContain('saves_unknown');
    expect(none.log.some((x) => x.table === 'syslog_transaction')).toBe(false);
  });

  it('windowsQuery funde janelas que se sobrepõem', () => {
    expect(windowsQuery(['2026-10-21 12:00:00', '2026-10-21 12:00:30', '2026-10-21 13:00:00'], 5, 60, 'urlLIKEx')).toBe(
      'urlLIKEx^sys_created_on>=2026-10-21 11:59:55^sys_created_on<=2026-10-21 12:01:30^NQurlLIKEx^sys_created_on>=2026-10-21 12:59:55^sys_created_on<=2026-10-21 13:01:00');
  });

  it('syslog_transaction negada: lista vazia com tx_denied', async () => {
    const c = base();
    c.deny('syslog_transaction');
    // Janela larga: a gravação da fixture (AT, 21/10/2026) não pode sair dos 7 dias padrão com o passar do tempo.
    const r = await recordSaveTimes(c, { table: 'incident', sysId: ID }, { days: 36500 });
    expect(r.saves).toEqual([]);
    expect(r.notes).toContain('tx_denied');
    expect(r.denied).toEqual(['syslog_transaction']);
  });
});

describe('auxiliares', () => {
  it('parseMs e verdictOf', () => {
    expect(parseMs('4200')).toBe(4200);
    expect(parseMs('1970-01-01 00:00:04')).toBe(4000);
    expect(parseMs('')).toBeUndefined();
    expect(parseMs('abc')).toBeUndefined();
    expect(verdictOf(undefined).verdict).toBe('sem_dado');
    expect(verdictOf(1200, 500).verdict).toBe('normal'); // 2,4× mas só 0,7 s a mais
    expect(verdictOf(1600, 500).verdict).toBe('lento');
    expect(verdictOf(4200, 600).verdict).toBe('muito_lento');
    expect(verdictOf(5000).verdict).toBe('muito_lento');
  });
});

describe('P7: additional_debug_count', () => {
  it('não é pedido nem na sondagem (não existe no PDI)', async () => {
    const c = base({ dict: [], tx: [tx({ sys_id: 'T1', sys_created_on: shift(AT, 1), response_time: '800' })] });
    await saveTiming(c, { table: 'incident', sysId: ID, checkpoint: 3 });
    expect(c.log.filter((r) => r.table === 'syslog_transaction').every((r) => !r.fields.includes('additional_debug_count'))).toBe(true);
  });
});
