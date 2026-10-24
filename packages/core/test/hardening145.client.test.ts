/**
 * 1.4.5: bateria agressiva do FetchRestClient (Gate, precheck no ui/meta, memória de recusas, respostas estranhas) e
 * dos utilitários de filtro (windowsFilter, inList, timedQuery). Só fetch falso; nada de rede.
 * Testes marcados com `it.fails` documentam DEFEITOS encontrados (o teste descreve o comportamento correto).
 */
import { describe, expect, it } from 'vitest';
import { FetchRestClient } from '../src/client/FetchRestClient';
import { detectAccess } from '../src/access';
import { inList, timedQuery, windowsFilter } from '../src/util';
import { windowsQuery } from '../src/saveTiming';
import { NASTY, freshBase, hang, json, problemsOf, rng, sim, sleep, snDate, type Col } from './hardening145.helpers';

const mk = (fetchImpl: typeof fetch, opts: Partial<ConstructorParameters<typeof FetchRestClient>[0]> = {}) =>
  new FetchRestClient({ baseUrl: freshBase(), getToken: async () => 'tok', fetchImpl, timeoutMs: 300, ...opts });

// ------------------------------------------------------------------ util

describe('windowsFilter: nunca devolve filtro quebrado', () => {
  const r = rng(145);
  const valid = () => snDate(Date.UTC(2020, 0, 1) + r.int(6 * 365 * 864e5));
  const invalid = ['', 'x', '2026-10-24', '2026-10-24T10:00:00', '24/10/2026 10:00:00', '2026-10-24 10:00:00^ORsys_id!=1',
    '2026-10-24 10:00:00\n', ' 2026-10-24 10:00:00', 'NaN', 'javascript:gs.daysAgo(1)'];
  for (let i = 0; i < 120; i++) {
    const n = r.int(6);
    const instants = Array.from({ length: n }, () => (r.next() < 0.4 ? r.pick(invalid) : valid()));
    const extra = r.pick(['', 'type=list', `sys_target_sys_id=${r.hex()}`, 'urlLIKEabc']);
    it(`caso ${i}: ${n} instantes (${instants.filter((x) => !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x)).length} inválidos), extra=${extra || '-'}`, () => {
      const f = windowsFilter('sys_created_on', instants, r.int(1800), r.int(60), extra);
      const good = instants.filter((x) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x) && !Number.isNaN(Date.parse(x.replace(' ', 'T') + 'Z')));
      if (!good.length) { expect(f).toBe(''); return; }
      expect(f).not.toBe('');
      expect(problemsOf('syslog_transaction', f)).toEqual([]);
      for (const block of f.split('^NQ')) {
        if (extra) expect(block.startsWith(`${extra}^`)).toBe(true);
        expect(block).toMatch(/sys_created_on>=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\^sys_created_on<=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      }
    });
  }

  // util.ts:53/61: SN_DATE confere só o formato; mês 13 ou hora 25 passam e shift() lança RangeError.
  it('CORRIGIDO: data no formato certo mas inexistente (2026-13-01 00:00:00) lança RangeError', () => {
    expect(() => windowsFilter('sys_created_on', ['2026-13-01 00:00:00'], 5, 5)).not.toThrow();
  });
});

describe('windowsQuery (saveTiming) com instante inválido', () => {
  // saveTiming.ts:175 filtra só por Boolean; recordSaveTimes passa instantes do histórico do formulário (e.at).
  it('CORRIGIDO: instante fora do formato lança RangeError em vez de ser ignorado', () => {
    expect(() => windowsQuery(['2026-10-20 10:00:00', '20/10/2026 10:00'], 5, 60, 'urlLIKEx')).not.toThrow();
  });
});

describe('inList: valores hostis nunca mudam o sentido da consulta', () => {
  const r = rng(7);
  for (let i = 0; i < 80; i++) {
    const vals = Array.from({ length: 1 + r.int(6) }, () => (r.next() < 0.5 ? r.pick(NASTY) : `user${r.int(99)}`));
    it(`caso ${i}: ${JSON.stringify(vals).slice(0, 70)}`, () => {
      const s = inList(vals);
      expect(s).not.toMatch(/[\^\r\n]/);
      if (s) for (const v of s.split(',')) expect(v).not.toBe('');
      expect(problemsOf('sys_user', `user_nameIN${s}`).filter((p) => p !== 'IN vazio')).toEqual([]);
    });
  }
  it('lista sem nenhum valor aproveitável volta vazia (quem chama não consulta)', () => {
    expect(inList(['', 'a,b', 'x^y', 'l\nq'])).toBe('');
  });
  // ServiceNow avalia valores "javascript:" em encoded query (no sandbox do servidor, com a sessão de quem investiga).
  it('valor "javascript:..." (nome exibido, valor gravado) não entra na lista IN', () => {
    expect(inList(['Beth', 'javascript:gs.sleep(9000)'])).not.toContain('javascript:');
  });
});

describe('timedQuery', () => {
  it('cliente que rejeita vira timeout (sem exceção)', async () => {
    const r = await timedQuery({ query: async () => { throw new Error('rede'); } }, { table: 'incident', query: 'a=1', fields: [], limit: 1 }, 10);
    expect(r.access).toBe('timeout');
  });
  it('cliente que nunca responde vira timeout em ms*5', async () => {
    const t0 = Date.now();
    const r = await timedQuery({ query: () => new Promise(() => undefined) }, { table: 'incident', query: 'a=1', fields: [], limit: 1 }, 10);
    expect(r.access).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

// ------------------------------------------------------------------ validação de nomes

describe('nomes de tabela e campo fora do padrão não saem', () => {
  const badTables = ['', 'Incident', 'incident/../sys_user', 'incident?x=1', 'inc ident', 'incident%2F', 'incident.do', 'sys_user#', '../api', 'ção', 'incident\n', 'a;b'];
  for (const t of badTables) {
    it(`tabela ${JSON.stringify(t)}`, async () => {
      const s = sim();
      const r = await mk(s.fetchImpl).query({ table: t, query: 'active=true', fields: ['sys_id'], limit: 1 });
      expect(r.access).toBe('unknown');
      expect(s.log.length + s.metaLog.length).toBe(0);
    });
  }
  const badFields = ['Name', 'a,b', 'a b', 'a^b', 'a\nb', 'a&sysparm_limit=1', '*', 'ção'];
  for (const f of badFields) {
    it(`campo ${JSON.stringify(f)}`, async () => {
      const s = sim();
      await mk(s.fetchImpl).query({ table: 'incident', query: 'active=true', fields: ['sys_id', f], limit: 1 });
      expect(s.log.length).toBe(0);
    });
  }
  it('valor com & e = no filtro não injeta parâmetros na URL', async () => {
    const s = sim();
    await mk(s.fetchImpl).query({ table: 'incident', query: 'short_description=a&sysparm_limit=99999&sysparm_query=', fields: ['sys_id'], limit: 3 });
    const u = new URL(s.log[0]!.url);
    expect(u.searchParams.getAll('sysparm_limit')).toEqual(['3']);
    expect(u.searchParams.getAll('sysparm_query')).toEqual(['short_description=a&sysparm_limit=99999&sysparm_query=']);
    expect(u.searchParams.get('sysparm_no_count')).toBe('true');
  });
});

// ------------------------------------------------------------------ precheck

describe('precheck no ui/meta antes de consulta filtrada', () => {
  const user: Record<string, Col> = { sys_id: { canmatch: true }, name: { canmatch: true }, user_name: { canmatch: true }, secret: { canmatch: false } };
  const inc: Record<string, Col> = {
    sys_id: { canmatch: true }, number: { canmatch: true }, state: { canmatch: true }, hidden_sort: { canmatch: false },
    caller_id: { canmatch: true, type: 'reference', reference: 'sys_user' }, opened_by: { canmatch: true, type: 'reference', reference: 'sys_user_ro' },
    cmdb_ci: { canmatch: true, type: 'reference', reference: 'cmdb_ci_denied' }, plain: { canmatch: true, type: 'string' },
    sys_created_on: { canmatch: true }, ghost_ref: { canmatch: true, type: 'reference', reference: 'meta_fails' },
  };
  const metaFor = (t: string) => (t === 'incident' ? inc : t === 'sys_user' ? user : t === 'cmdb_ci_denied' ? 'empty' as const : t === 'meta_fails' ? 'forbidden' as const : t === 'sys_user_ro' ? { name: { canmatch: false } } : 'empty' as const);
  // [consulta, chega à Table API?, estado esperado quando barrada]
  const cases: [string, boolean, string?][] = [
    ['state=2', true], ['stateIN1,2,3', true], ['stateNOT IN1,2', true], ['stateLIKE2', true], ['stateSTARTSWITH2', true], ['stateISEMPTY', true], ['stateISNOTEMPTY', true],
    ['state>=2', true], ['state<=2', true], ['state!=2', true], ['sys_created_onBETWEENjavascript:gs.dateGenerate(\'2026-01-01\',\'00:00:00\')@javascript:gs.dateGenerate(\'2026-01-02\',\'00:00:00\')', true],
    ['sys_created_onDATEPARTMonday@javascript:gs.datePart(\'dayofweek\',\'monday\',\'EE\')', true], ['sys_created_on>=javascript:gs.daysAgoStart(1)', true],
    ['sys_id=abc', true], ['sys_idINa,b', true], ['zzz=1', false, 'no_filter'], ['state=2^zzz=1', false, 'no_filter'], ['state=2^ORzzz=1', false, 'no_filter'],
    ['state=2^NQzzz=1', false, 'no_filter'], ['hidden_sort=1', false, 'no_filter'], ['state=2^ORhidden_sort=1', false, 'no_filter'], ['state=2^NQhidden_sort=1', false, 'no_filter'],
    ['hidden_sortISEMPTY', false, 'no_filter'], ['hidden_sortLIKEx', false, 'no_filter'],
    ['caller_id.name=Beth', true], ['caller_id.user_name=beth^state=2', true], ['caller_id.secret=x', false, 'no_filter'], ['caller_id.nope=x', false, 'no_filter'],
    ['opened_by.name=x', false, 'no_filter'], ['cmdb_ci.name=x', false, 'no_filter'], ['plain.name=x', false, 'no_filter'], ['ghost_ref.name=x', true],
    ['state=2^ORDERBYnumber', true], ['state=2^ORDERBYDESCnumber', true], ['state=2^ORDERBYhidden_sort', true], ['ORDERBYnumber', true],
    ['state=2^EQ', true], ['state=2^ORDERBYDESCsys_created_on^ORDERBYnumber', true],
  ];
  for (const [q, reaches, state] of cases) {
    it(`${q} → ${reaches ? 'Table API' : state}`, async () => {
      const s = sim({ meta: metaFor });
      const r = await mk(s.fetchImpl).query({ table: 'incident', query: q, fields: ['sys_id'], limit: 1 });
      expect(s.log.length).toBe(reaches ? 1 : 0);
      if (!reaches) expect(r.access).toBe(state);
    });
  }

  // FetchRestClient.ts:395 (queryTerms): o split /\^(?:OR|NQ)?/ come o "OR" de "^ORDERBY", e o termo vira "DERBYx" (ignorado).
  // A conferência de ordenação ("só exige que a coluna exista") nunca roda para ORDERBY depois de outro termo.
  it('CORRIGIDO: ^ORDERBY por coluna inexistente passa sem conferência (o split come o OR de ORDERBY)', async () => {
    const s = sim({ meta: metaFor });
    await mk(s.fetchImpl).query({ table: 'incident', query: 'state=2^ORDERBYcoluna_que_nao_existe', fields: ['sys_id'], limit: 1 });
    expect(s.log.length).toBe(0);
  });
  it('ORDERBY no começo da consulta é conferido (coluna inexistente barra)', async () => {
    const s = sim({ meta: metaFor });
    await mk(s.fetchImpl).query({ table: 'incident', query: 'ORDERBYcoluna_que_nao_existe', fields: ['sys_id'], limit: 1 });
    expect(s.log.length).toBe(0);
  });
  // Termo que não começa com [a-z0-9_.] não é conferido (queryTerms ignora): chega à Table API sem precheck.
  it('CORRIGIDO (baixo): termo com campo fora de [a-z0-9_.] (U_campo=1) escapa do precheck', async () => {
    const s = sim({ meta: metaFor });
    await mk(s.fetchImpl).query({ table: 'incident', query: 'state=2^U_Campo=1', fields: ['sys_id'], limit: 1 });
    expect(s.log.length).toBe(0);
  });

  it('ui/meta com 0 colunas dá denied sem tocar a Table API (inclusive só por sys_id)', async () => {
    for (const q of ['sys_id=abc', 'active=true', 'documentkey=abc^ORDERBYsys_created_on']) {
      const s = sim({ meta: () => 'empty' });
      const r = await mk(s.fetchImpl).query({ table: 'sys_audit', query: q, fields: ['sys_id'], limit: 1 });
      expect(r.access).toBe('denied');
      expect(s.log.length).toBe(0);
    }
  });
  // Novo comportamento: ui/meta que respondeu sem colunas utilizáveis (4xx exceto 401/429, JSON sem columns) segue sem
  // conferência; ui/meta que não respondeu (rede, prazo, 5xx, 429, 401 após renovar, 200 não-JSON) barra: 'unknown', status 0.
  for (const mode of ['forbidden', 's404', 'array', 'noresult'] as const) {
    it(`ui/meta respondeu sem colunas (${mode}): segue para a Table API`, async () => {
      const s = sim({ meta: () => mode });
      const r = await mk(s.fetchImpl).query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 });
      expect(['ok', 'empty']).toContain(r.access);
      expect(s.log.length).toBe(1);
    });
  }
  for (const mode of ['html', 'throw', 's500', 's429', 's401', 'hang'] as const) {
    it(`ui/meta não respondeu (${mode}): consulta filtrada não sai e volta unknown/0`, async () => {
      const s = sim({ meta: () => mode });
      const r = await mk(s.fetchImpl, { timeoutMs: 40 }).query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 });
      expect(r).toMatchObject({ access: 'unknown', status: 0 });
      expect(s.log.length).toBe(0);
    });
  }
  it('ui/meta com coluna nula (200 JSON malformado) não lança exceção', async () => {
    const s = sim({ meta: () => 'nullcol' });
    const r = await mk(s.fetchImpl).query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 });
    expect(['ok', 'empty', 'unknown', 'denied']).toContain(r.access);
  });
  it('ui/meta 401: renova o token (getToken(true)) e repete uma vez; com o token novo, a consulta sai', async () => {
    const seen: string[] = [];
    const forced: unknown[] = [];
    let n = 0;
    const f = (async (i: RequestInfo | URL, init?: RequestInit) => {
      const tok = new Headers(init?.headers).get('X-UserToken')!;
      if (String(i).includes('/ui/meta/')) { seen.push(tok); return tok === 'velho' ? json(401, {}) : json(200, { result: { columns: { state: { canmatch: true } } } }); }
      return json(200, { result: [{ sys_id: 'x' }] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: freshBase(), getToken: async (force?: boolean) => { forced.push(force); return n++ ? 'novo' : 'velho'; }, fetchImpl: f });
    const r = await c.query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 });
    expect(seen).toEqual(['velho', 'novo']);
    expect(forced).toContain(true);
    expect(r.access).toBe('ok');
  });
  it('ui/meta que nunca responde: aborta no prazo e libera a vaga (outra tabela segue)', async () => {
    const s = sim({ meta: (t) => (t === 'incident' ? 'hang' : 'forbidden') });
    const c = mk(s.fetchImpl, { timeoutMs: 40 });
    const t0 = Date.now();
    const rs = await Promise.all([1, 2, 3, 4].map(() => c.query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 })));
    expect(rs.every((r) => r.access === 'unknown')).toBe(true);
    expect((await c.query({ table: 'problem', query: 'state=2', fields: ['sys_id'], limit: 1 })).access).toBe('empty');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(s.metaLog.filter((t) => t === 'incident').length).toBe(1);
  });
  it('falha do ui/meta fica guardada só por pouco tempo (não pede ui/meta a cada consulta, mas volta a pedir)', async () => {
    const s = sim({ meta: () => 'forbidden' });
    const c = mk(s.fetchImpl);
    await c.query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 });
    await c.query({ table: 'incident', query: 'state=3', fields: ['sys_id'], limit: 1 });
    expect(s.metaLog.filter((t) => t === 'incident').length).toBe(1);
  });
  it('consultas simultâneas à mesma tabela pedem o ui/meta uma vez só', async () => {
    const s = sim({ meta: (t) => (t === 'incident' ? inc : 'forbidden'), latencyMs: 5 });
    const c = mk(s.fetchImpl);
    await Promise.all(Array.from({ length: 8 }, (_, i) => c.query({ table: 'incident', query: `state=${i}`, fields: ['sys_id'], limit: 1 })));
    expect(s.metaLog.filter((t) => t === 'incident').length).toBe(1);
  });

  // Propriedade: consultas aleatórias montadas com colunas conhecidas, desconhecidas e sem canmatch.
  const r = rng(31337);
  const known = ['state', 'number', 'sys_created_on', 'caller_id.name', 'caller_id.user_name'];
  const blocked = ['zzz', 'hidden_sort', 'caller_id.secret', 'cmdb_ci.name', 'plain.x', 'opened_by.name'];
  const ops = ['=1', 'IN1,2', 'LIKEa', 'STARTSWITHa', '>=1', 'ISEMPTY', 'ISNOTEMPTY', '!=1', 'NOT IN1', '=javascript:gs.getUserID()'];
  const joins = ['^', '^OR', '^NQ'];
  for (let i = 0; i < 60; i++) {
    const n = 1 + r.int(4);
    const cols = Array.from({ length: n }, () => (r.next() < 0.3 ? r.pick(blocked) : r.pick(known)));
    const q = cols.map((c, k) => (k ? r.pick(joins) : '') + c + r.pick(ops)).join('') + (r.next() < 0.3 ? '^ORDERBYDESCsys_created_on' : '');
    const expectBlocked = cols.some((c) => blocked.includes(c));
    it(`aleatório ${i}: ${q.slice(0, 90)}`, async () => {
      const s = sim({ meta: metaFor });
      const res = await mk(s.fetchImpl).query({ table: 'incident', query: q, fields: ['sys_id'], limit: 1 });
      expect(s.log.length).toBe(expectBlocked ? 0 : 1);
      if (expectBlocked) expect(res.access).toBe('no_filter');
    });
  }
});

// ------------------------------------------------------------------ respostas de rótulo pelo ui/meta

describe('fromUiMeta responde dicionário, opções e documentação para quem não pode consultá-los', () => {
  const inc: Record<string, Col> = {
    state: { canmatch: true, label: 'Estado', type: 'choice', choices: [{ label: 'Novo', value: '1' }, { label: 'Em andamento', value: '2' }, { label: '', value: '9' }] },
    caller_id: { canmatch: true, label: 'Solicitante', type: 'reference', reference: 'sys_user' },
  };
  const meta = (t: string) => (t === 'incident' ? inc : 'empty' as const);
  const cases: [string, string, string[], number][] = [
    ['sys_choice', 'nameINincident,task^elementINstate^inactive=false', ['name', 'element', 'value', 'label'], 2],
    ['sys_choice', 'nameINincident,task^element=state^inactive=false', ['name', 'value', 'label', 'language'], 2],
    ['sys_dictionary', 'element=state^nameINincident,task', ['name', 'internal_type', 'reference', 'column_label', 'element'], 1],
    ['sys_dictionary', 'nameINincident^elementINstate,caller_id', ['name', 'element', 'column_label', 'internal_type', 'reference'], 2],
    ['sys_documentation', 'nameINincident,task^elementINstate^languageINpt,en', ['name', 'element', 'label', 'language'], 1],
    ['sys_dictionary', 'nameINincident', ['sys_id', 'name', 'element'], 2],
  ];
  for (const [table, q, fields, n] of cases) {
    it(`${table}: ${q}`, async () => {
      const s = sim({ meta });
      const r = await mk(s.fetchImpl).query({ table, query: q, fields, limit: 50 });
      expect(s.log.length).toBe(0);
      expect(r.rows.length).toBe(n);
      for (const row of r.rows) expect(Object.keys(row).sort()).toEqual([...fields].sort());
    });
  }
  const notSupported: [string, string, string[]][] = [
    ['sys_choice', 'nameINincident^elementINstate^sys_created_on>=2026-01-01 00:00:00', ['name', 'value']],
    ['sys_choice', 'nameINincident^elementINstate', ['name', 'value', 'sys_id']],
    ['sys_dictionary', 'elementINstate', ['name', 'element']],
    ['sys_user', 'nameINincident', ['name']],
  ];
  for (const [table, q, fields] of notSupported) {
    it(`fora do formato (${table}: ${q}) não chega à Table API e dá denied`, async () => {
      const s = sim({ meta });
      const r = await mk(s.fetchImpl).query({ table, query: q, fields, limit: 50 });
      expect(s.log.length).toBe(0);
      expect(r.access).toBe('denied');
    });
  }
  it('lista de tabelas com nome inválido não pede ui/meta fora do padrão', async () => {
    const s = sim({ meta });
    const r = await mk(s.fetchImpl).query({ table: 'sys_choice', query: 'nameIN../sys_user,incident^elementINstate', fields: ['name', 'value'], limit: 50 });
    expect(s.metaLog.some((t) => t.includes('/'))).toBe(false);
    expect(s.log.length).toBe(0);
    expect(r.rows).toEqual([]);
  });
});

// ------------------------------------------------------------------ Gate

describe('Gate: no máximo 2 chamadas em andamento por instância, sem travar', () => {
  const base = () => freshBase('gate');
  it('muitos clientes e muitas consultas (com ui/meta) nunca passam de 2 ao mesmo tempo', async () => {
    const s = sim({ meta: (t) => (t === 'incident' ? { state: { canmatch: true } } : 'forbidden'), latencyMs: 3 });
    const b = base();
    const cs = Array.from({ length: 5 }, (_, k) => new FetchRestClient({ baseUrl: k % 2 ? b : `${b}/`, getToken: async () => `t${k % 2}`, fetchImpl: s.fetchImpl }));
    await Promise.all(cs.flatMap((c) => Array.from({ length: 6 }, (_, i) => c.query({ table: i % 2 ? 'incident' : 'problem', query: `state=${i}`, fields: ['sys_id'], limit: 1 }))));
    expect(s.maxInFlight).toBeLessThanOrEqual(2);
    expect(s.log.length).toBe(30);
  });

  // FetchRestClient.ts:91-96: history() pega UMA vaga e dispara list_history e ui/meta em paralelo (2 fetches por vaga).
  it('history() não passa de 2 chamadas em andamento (ui/meta e list_history em vagas próprias)', async () => {
    const s = sim({ latencyMs: 20, history: { entries: [], fields: [] } });
    const b = base();
    const c1 = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: s.fetchImpl });
    const c2 = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: s.fetchImpl });
    await Promise.all([c1.history('incident', 'a'.repeat(32)), c2.history('incident', 'b'.repeat(32))]);
    expect(s.maxInFlight).toBeLessThanOrEqual(2);
  });

  // FetchRestClient.ts:88-104: history() não tem prazo nem AbortController; resposta que nunca chega prende a vaga para sempre.
  it('list_history que nunca responde não prende a vaga (tem prazo)', async () => {
    const b = base();
    const stuck = (async (i: RequestInfo | URL, init?: RequestInit) => (String(i).includes('/angular.do') || String(i).includes('/ui/meta/') ? hang(init?.signal) : json(200, { result: [] }))) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: stuck, timeoutMs: 30 });
    void c.history('incident', 'a'.repeat(32));
    void c.history('incident', 'b'.repeat(32));
    const r = await Promise.race([c.query({ table: 'incident', query: '', fields: ['sys_id'], limit: 1 }).then(() => 'respondeu'), sleep(400).then(() => 'travou')]);
    expect(r).toBe('respondeu');
  });

  // FetchRestClient.ts:131-145: o prazo (clearTimeout) acaba quando chegam os cabeçalhos; res.text() não tem prazo.
  // FetchRestClient.ts (doQuery): `res.text().catch(() => '')` engole o AbortError do prazo; corpo lento vira 200 sem JSON
  // -> 'unknown' em vez de 'timeout'. A vaga é liberada (ver teste seguinte); só a classificação fica errada.
  it('CORRIGIDO (baixo): prazo estourado durante a leitura do corpo é classificado como unknown, não timeout', async () => {
    const b = base();
    const slowBody = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      if (String(i).includes('sys_audit')) {
        return { status: 200, ok: true, headers: new Headers(), text: () => hang(init?.signal).then(() => '') } as unknown as Response;
      }
      return json(200, { result: [] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: slowBody, timeoutMs: 30 });
    const a1 = c.query({ table: 'sys_audit', query: 'documentkey=x', fields: ['sys_id'], limit: 1 });
    const r = await Promise.race([a1.then((x) => x.access), sleep(400).then(() => 'travou')]);
    expect(r).toBe('timeout');
  });

  it('corpo que nunca termina não prende a vaga (o prazo cobre a leitura do corpo)', async () => {
    const b = base();
    const slowBody = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      if (String(i).includes('sys_audit')) return { status: 200, ok: true, headers: new Headers(), text: () => hang(init?.signal).then(() => '') } as unknown as Response;
      return json(200, { result: [] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: slowBody, timeoutMs: 30 });
    void c.query({ table: 'sys_audit', query: 'documentkey=x', fields: ['sys_id'], limit: 1 });
    void c.query({ table: 'sys_audit', query: 'documentkey=y', fields: ['sys_id'], limit: 1 });
    const r = await Promise.race([c.query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 }).then((x) => x.access), sleep(1000).then(() => 'travou')]);
    expect(r).toBe('empty');
  });
  const failures: [string, (signal?: AbortSignal | null) => Promise<Response>][] = [
    ['fetch lança TypeError (rede caiu)', async () => { throw new TypeError('Failed to fetch'); }],
    ['fetch lança erro qualquer', async () => { throw new Error('boom'); }],
    ['timeout (AbortError)', (sig) => hang(sig)],
    ['res.text() rejeita', async () => ({ status: 200, ok: true, headers: new Headers(), text: async () => { throw new Error('stream'); } }) as unknown as Response],
    ['HTML 200', async () => new Response('<html>SSO</html>', { status: 200 })],
    ['500 HTML (snow_adc)', async () => new Response('<html>500</html>', { status: 500 })],
    ['500 JSON', async () => json(500, { error: { message: 'x' } })],
    ['503 sempre', async () => json(503, {})],
    ['401 sempre', async () => json(401, {})],
  ];
  for (const [name, fail] of failures) {
    it(`vaga é liberada depois de: ${name}`, async () => {
      let bad = true;
      const f = (async (i: RequestInfo | URL, init?: RequestInit) => {
        if (String(i).includes('/ui/meta/')) return json(403, {});
        return bad ? fail(init?.signal) : json(200, { result: [{ sys_id: 'x' }] });
      }) as typeof fetch;
      const c = new FetchRestClient({ baseUrl: base(), getToken: async () => 't', fetchImpl: f, timeoutMs: 30 });
      await Promise.all([1, 2, 3].map(() => c.query({ table: 'incident', query: 'state=1', fields: ['sys_id'], limit: 1 }).catch(() => null)));
      bad = false;
      const r = await Promise.race([c.query({ table: 'problem', query: 'number=2', fields: ['sys_id'], limit: 1 }).then((x) => x.access), sleep(3000).then(() => 'travou')]);
      expect(r).toBe('ok');
    }, 10_000);
  }
  it('getToken que lança não prende vaga', async () => {
    const s = sim();
    const b = base();
    let n = 0;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => { if (n++ < 3) throw new Error('sem token'); return 't'; }, fetchImpl: s.fetchImpl });
    for (let i = 0; i < 3; i++) await c.query({ table: 'incident', query: 'state=1', fields: ['sys_id'], limit: 1 }).catch(() => null);
    const r = await Promise.race([c.query({ table: 'incident', query: 'state=2', fields: ['sys_id'], limit: 1 }).then((x) => x.access), sleep(1000).then(() => 'travou')]);
    expect(r).toBe('empty');
  });
  it('ui/meta com corpo que lança (text/json) libera a vaga e não lança exceção', async () => {
    let bad = true;
    const f = (async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/')
      ? (bad ? ({ status: 200, ok: true, headers: new Headers(), text: async () => { throw new SyntaxError('bad'); }, json: async () => { throw new SyntaxError('bad'); } } as unknown as Response) : json(403, {}))
      : json(200, { result: [] }))) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: base(), getToken: async () => 't', fetchImpl: f });
    const rs = await Promise.all(['incident', 'problem', 'change_request', 'sc_task'].map((t) => c.query({ table: t, query: 'active=true', fields: ['sys_id'], limit: 1 })));
    expect(rs.every((r) => r.access === 'unknown')).toBe(true);
    bad = false;
    const r = await Promise.race([c.query({ table: 'task', query: 'active=true', fields: ['sys_id'], limit: 1 }).then((x) => x.access), sleep(1000).then(() => 'travou')]);
    expect(r).toBe('empty');
  });
  it('repetição: no máximo UMA para 429/502/503/504 e 500 HTML; 500 JSON não repete; 400/404 não repetem', async () => {
    const count = async (resp: () => Response) => {
      let n = 0;
      const f = (async (i: RequestInfo | URL) => { if (String(i).includes('/ui/meta/')) return json(403, {}); n++; return resp(); }) as typeof fetch;
      await new FetchRestClient({ baseUrl: base(), getToken: async () => 't', fetchImpl: f }).query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 });
      return n;
    };
    for (const st of [429, 502, 503, 504]) expect(await count(() => json(st, {}))).toBe(2);
    expect(await count(() => new Response('<html/>', { status: 500 }))).toBe(2);
    expect(await count(() => new Response('', { status: 500 }))).toBe(2);
    expect(await count(() => json(500, { error: {} }))).toBe(1);
    expect(await count(() => json(400, { error: {} }))).toBe(1);
    expect(await count(() => json(404, { error: {} }))).toBe(1);
    // Retry-After respeitado até 5 s.
    const t0 = Date.now();
    expect(await count(() => new Response('{}', { status: 503, headers: { 'Retry-After': '1' } }))).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    const t1 = Date.now();
    expect(await count(() => new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }))).toBe(2);
    expect(Date.now() - t1).toBeLessThan(6000);
  }, 15_000);

  // util.ts:72 + FetchRestClient: timedQuery desiste em ms*5, mas o pedido continua na fila do Gate e sai depois.
  it('consulta abandonada por timedQuery sai da fila e não vai à instância', async () => {
    const b = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const urls: string[] = [];
    const f = (async (i: RequestInfo | URL) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      urls.push(String(i));
      if (String(i).includes('/slow?')) await gate;
      return json(200, { result: [] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: f, timeoutMs: 5000 });
    const s1 = c.query({ table: 'slow', query: 'a=1', fields: ['sys_id'], limit: 1 });
    const s2 = c.query({ table: 'slow', query: 'a=2', fields: ['sys_id'], limit: 1 });
    const given = await timedQuery(c, { table: 'abandonada', query: 'a=1', fields: ['sys_id'], limit: 1 }, 10);
    expect(given.access).toBe('timeout');
    release();
    await Promise.all([s1, s2]);
    await sleep(20);
    expect(urls.some((u) => u.includes('/abandonada?'))).toBe(false);
  });

  // FetchRestClient.ts loadUiMeta: `await this.acquire()` sem o sinal da consulta. A consulta abandonada sai da fila da
  // Table API, mas o ui/meta que ela pediu continua na fila e vai à instância quando a fila anda.
  it.fails('DEFEITO (baixo): ui/meta pedido por consulta abandonada ainda sai para a instância', async () => {
    const b = base();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const metas: string[] = [];
    const f = (async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes('/ui/meta/')) { metas.push(u); return json(403, {}); }
      if (u.includes('/slow?')) await gate;
      return json(200, { result: [] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: b, getToken: async () => 't', fetchImpl: f, timeoutMs: 5000 });
    const s1 = c.query({ table: 'slow', query: '', fields: ['sys_id'], limit: 1 });
    const s2 = c.query({ table: 'slow', query: '', fields: ['sys_id'], limit: 1 });
    await sleep(5);
    expect((await timedQuery(c, { table: 'abandonada', query: 'a=1', fields: ['sys_id'], limit: 1 }, 10)).access).toBe('timeout');
    release();
    await Promise.all([s1, s2]);
    await sleep(20);
    expect(metas.some((u) => u.includes('/abandonada'))).toBe(false);
  });
});

// ------------------------------------------------------------------ memória de recusas

describe('memória de recusas', () => {
  const denyAll = (calls: string[]) => (async (i: RequestInfo | URL, init?: RequestInit) => {
    if (String(i).includes('/ui/meta/')) return json(403, {});
    calls.push(`${new Headers(init?.headers).get('X-UserToken')}|${new URL(String(i)).searchParams.get('sysparm_query')}`);
    return json(403, { error: { message: 'User Not Authorized', detail: 'unauthorized' } });
  }) as typeof fetch;

  it('não vaza entre tokens (impersonação): cada token pergunta uma vez', async () => {
    const calls: string[] = [];
    const b = freshBase('ref');
    const tokens = ['admin', 'itil', 'impersonado', 'admin'];
    for (const t of tokens) {
      const c = new FetchRestClient({ baseUrl: b, getToken: async () => t, fetchImpl: denyAll(calls) });
      expect((await c.query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 })).access).toBe('denied');
      expect((await c.query({ table: 'sys_audit', query: 'documentkey=b', fields: ['sys_id'], limit: 1 })).access).toBe('denied');
    }
    expect(calls.length).toBe(3);
  });
  it('recusa de um token não responde pelo outro: o outro recebe as linhas', async () => {
    const b = freshBase('ref');
    const f = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      return new Headers(init?.headers).get('X-UserToken') === 'itil' ? json(403, { error: { message: 'User Not Authorized' } }) : json(200, { result: [{ sys_id: 'x' }] });
    }) as typeof fetch;
    await new FetchRestClient({ baseUrl: b, getToken: async () => 'itil', fetchImpl: f }).query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 });
    const r = await new FetchRestClient({ baseUrl: b, getToken: async () => 'admin', fetchImpl: f }).query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 });
    expect(r.access).toBe('ok');
  });
  const shapes: [string, string, boolean][] = [
    ['documentkey=a', 'documentkey=b', true],
    ['documentkey=a', 'tablename=x^documentkey=a', false],
    ['documentkey=a', 'documentkeyINa,b', true],
    ['documentkey=a', '', false],
    ['', 'sys_id=x', false],
    ['sys_created_on>=1^sys_created_on<=2', 'sys_created_on>=3^sys_created_on<=4^NQsys_created_on>=5^sys_created_on<=6', true],
    ['name=a', 'name=a^ORelement=b', false],
    ['name=a^element=b', 'element=c^name=d', true],
  ];
  for (const [a, b2, same] of shapes) {
    it(`formato "${a}" ${same ? 'responde' : 'não responde'} por "${b2}"`, async () => {
      const calls: string[] = [];
      const c = new FetchRestClient({ baseUrl: freshBase('ref'), getToken: async () => 't', fetchImpl: denyAll(calls) });
      await c.query({ table: 'sys_script', query: a, fields: ['sys_id'], limit: 1 });
      await c.query({ table: 'sys_script', query: b2, fields: ['sys_id'], limit: 1 });
      expect(calls.length).toBe(same ? 1 : 2);
    });
  }
  it('recusa de uma tabela não vale para outra tabela', async () => {
    const calls: string[] = [];
    const c = new FetchRestClient({ baseUrl: freshBase('ref'), getToken: async () => 't', fetchImpl: denyAll(calls) });
    await c.query({ table: 'sys_script', query: 'collection=a', fields: ['sys_id'], limit: 1 });
    await c.query({ table: 'sys_script_client', query: 'collection=a', fields: ['sys_id'], limit: 1 });
    expect(calls.length).toBe(2);
  });
  it('erro passageiro (timeout, 503, HTML 200, rede) não vira recusa guardada', async () => {
    for (const resp of [() => new Response('<html/>', { status: 200 }), () => json(404, {}), () => json(500, { error: {} })]) {
      let n = 0;
      const f = (async (i: RequestInfo | URL) => { if (String(i).includes('/ui/meta/')) return json(403, {}); n++; return resp(); }) as typeof fetch;
      const c = new FetchRestClient({ baseUrl: freshBase('ref'), getToken: async () => 't', fetchImpl: f });
      await c.query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 });
      await c.query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 });
      expect(n).toBe(2);
    }
  });
  it('401 → token novo → 200: nada fica guardado como recusa', async () => {
    let n = 0;
    const toks = ['velho', 'novo', 'novo'];
    const f = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      n++;
      return new Headers(init?.headers).get('X-UserToken') === 'velho' ? json(401, {}) : json(200, { result: [{ sys_id: 'x' }] });
    }) as typeof fetch;
    let k = 0;
    const c = new FetchRestClient({ baseUrl: freshBase('ref'), getToken: async () => toks[k++] ?? 'novo', fetchImpl: f });
    expect((await c.query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 })).access).toBe('ok');
    expect((await c.query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 })).access).toBe('ok');
    expect(n).toBe(3);
  });
  it('Query ACL (403 "Field(s) present in the query") vira no_filter e fica guardada pelo formato', async () => {
    let n = 0;
    const f = (async (i: RequestInfo | URL) => {
      if (String(i).includes('/ui/meta/')) return json(403, {});
      n++;
      return json(403, { error: { message: 'Insufficient rights to query records', detail: 'Field(s) present in the query do not have permission to be read' } });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: freshBase('ref'), getToken: async () => 't', fetchImpl: f });
    expect((await c.query({ table: 'syslog', query: 'sourceINa', fields: ['sys_id'], limit: 1 })).access).toBe('no_filter');
    expect((await c.query({ table: 'syslog', query: 'sourceINb', fields: ['sys_id'], limit: 1 })).access).toBe('no_filter');
    expect(n).toBe(1);
  });
});

// ------------------------------------------------------------------ respostas estranhas

describe('respostas estranhas da Table API', () => {
  const cases: [string, () => Response, string][] = [
    ['HTML 200 (SSO)', () => new Response('<html>login</html>', { status: 200 }), 'unknown'],
    ['JSON sem result', () => json(200, { foo: 1 }), 'unknown'],
    ['result objeto', () => json(200, { result: { sys_id: 'x' } }), 'unknown'],
    ['result null', () => json(200, { result: null }), 'unknown'],
    ['result string', () => json(200, { result: 'x' }), 'unknown'],
    ['JSON literal null', () => new Response('null', { status: 200 }), 'unknown'],
    ['JSON número', () => new Response('42', { status: 200 }), 'unknown'],
    ['204 vazio', () => new Response(null, { status: 204 }), 'unknown'],
    ['200 corpo vazio', () => new Response('', { status: 200 }), 'unknown'],
    ['JSON truncado', () => new Response('{"result":[{"sys_id":"x"', { status: 200 }), 'unknown'],
    ['result []', () => json(200, { result: [] }), 'empty'],
    ['result [linha]', () => json(200, { result: [{ sys_id: 'x' }] }), 'ok'],
    ['403 HTML', () => new Response('<html>403</html>', { status: 403 }), 'denied'],
    ['403 Query ACL', () => json(403, { error: { detail: 'Field(s) present in the query do not have permission' } }), 'no_filter'],
    ['404', () => json(404, { error: {} }), 'unknown'],
    ['400', () => json(400, { error: {} }), 'unknown'],
    ['302 sem seguir', () => new Response('', { status: 302 }), 'unknown'],
  ];
  for (const [name, resp, access] of cases) {
    it(`${name} → ${access}`, async () => {
      const f = (async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(403, {}) : resp())) as typeof fetch;
      const r = await new FetchRestClient({ baseUrl: freshBase('odd'), getToken: async () => 't', fetchImpl: f }).query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 });
      expect(r.access).toBe(access);
      expect(Array.isArray(r.rows)).toBe(true);
    });
  }
  it('rede caindo: query rejeita (timedQuery converte em timeout, sem exceção para o motor)', async () => {
    const f = (async (i: RequestInfo | URL) => { if (String(i).includes('/ui/meta/')) return json(403, {}); throw new TypeError('Failed to fetch'); }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: freshBase('odd'), getToken: async () => 't', fetchImpl: f });
    await expect(c.query({ table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 })).rejects.toThrow();
    expect((await timedQuery(c, { table: 'incident', query: 'a=1', fields: ['sys_id'], limit: 1 }, 50)).access).toBe('timeout');
  });
});

// ------------------------------------------------------------------ sondagem de acesso

describe('detectAccess para usuário sem leitura das tabelas de sistema (ui/meta vazio)', () => {
  // access.ts:44: a sondagem usa query '' e filterAllowed() devolve 'ok' sem conferir o ui/meta (FetchRestClient.ts:162),
  // então as 11 sondagens sem filtro vão à Table API e cada uma vira 403 no log da instância.
  it('CORRIGIDO (baixo): sondagem sem filtro ignora o ui/meta vazio e leva 403 em cada fonte', async () => {
    const s = sim({ meta: () => 'empty', denyEmptyMeta: true });
    const rep = await detectAccess(new FetchRestClient({ baseUrl: freshBase('probe'), getToken: async () => 't', fetchImpl: s.fetchImpl }), 2000);
    expect(rep.level).toBe('none');
    expect(s.barred.length).toBe(0);
  });
  it('a sondagem de admin pede sysparm_limit=1 e sysparm_no_count=true em cada fonte', async () => {
    const s = sim();
    await detectAccess(new FetchRestClient({ baseUrl: freshBase('probe'), getToken: async () => 't', fetchImpl: s.fetchImpl }), 2000);
    expect(s.log.length).toBe(11);
    for (const l of s.log) {
      const u = new URL(l.url);
      expect(u.searchParams.get('sysparm_limit')).toBe('1');
      expect(u.searchParams.get('sysparm_no_count')).toBe('true');
      expect(u.searchParams.get('sysparm_query')).toBe('');
    }
  });
});
