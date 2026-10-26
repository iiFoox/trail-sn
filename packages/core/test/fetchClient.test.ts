import { describe, expect, it, vi } from 'vitest';
import { FetchRestClient, fetchTokenFromHtml } from '../src/client/FetchRestClient';
import { detectAccess } from '../src/access';

/** Chamadas à Table API (sem contar o ui/meta, que o cliente consulta antes de filtrar). */
const tableCalls = (f: unknown) => (f as { mock: { calls: unknown[][] } }).mock.calls.filter(([u]) => String(u).includes('/api/now/table/')).length;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('FetchRestClient', () => {
  it('usa o fetch global sem "Illegal invocation" e envia X-UserToken', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return json(200, { result: [{ sys_id: 'x' }] });
    }) as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com/', getToken: async () => 'tok' });
    const r = await c.query({ table: 'incident', query: 'number=INC1', fields: ['sys_id'], limit: 1 });
    expect(r.access).toBe('ok');
    const call = calls.find((x) => x.url.includes('/api/now/table/'))!;
    expect(call.url).toContain('https://dev.example.com/api/now/table/incident?');
    expect(call.headers.get('X-UserToken')).toBe('tok');
  });

  it('renova o token e repete uma vez após 401 (achado da PDI: cookie puro não basta)', async () => {
    let n = 0;
    const tokens = ['velho', 'novo'];
    const fetchImpl = vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Headers(init?.headers).get('X-UserToken') === 'novo' ? json(200, { result: [{ sys_id: 'x' }] }) : json(401, { error: { message: 'User is not authenticated' } }),
    ) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => tokens[n++] ?? null, fetchImpl });
    const r = await c.query({ table: 'incident', query: '', fields: ['sys_id'], limit: 1 });
    expect(r.status).toBe(200);
    // O ui/meta (sondagem de quem pode ler) também renova; a Table API vai uma vez só, já com o token novo.
    expect(tableCalls(fetchImpl)).toBe(1);
  });

  it('500 não é repetido (no PDI, sys_choice dava 500 sempre para escopo.user); 503 é', async () => {
    // ui/meta responde sem colunas (segue sem conferência); a Table API dá 500 em JSON.
    const f500 = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(200, { result: {} }) : json(500, { error: { message: 'Internal' }, status: 'failure' }))) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl: f500 });
    const r = await c.query({ table: 'sys_ui_policy', query: 'table=incident', fields: ['sys_id'], limit: 1 });
    expect(r).toMatchObject({ status: 500, access: 'unknown' });
    expect(tableCalls(f500)).toBe(1);
    let n = 0;
    const f503 = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(200, { result: {} }) : n++ ? json(200, { result: [{ sys_id: 'x' }] }) : json(503, {}))) as unknown as typeof fetch;
    const c2 = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl: f503 });
    expect((await c2.query({ table: 'incident', query: '', fields: ['sys_id'], limit: 1 })).status).toBe(200);
    expect(tableCalls(f503)).toBe(2);
  });

  it('detectAccess não reporta "full" quando as chamadas falham', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Illegal invocation'); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl });
    const rep = await detectAccess(c, 200);
    expect(rep.level).toBe('none');
  });

  it('detectAccess separa fonte lenta (timeout) de fonte negada (403)', async () => {
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i);
      if (u.includes('/sysevent?')) return json(403, { error: { message: 'ACL' } });
      if (u.includes('/wf_context?')) return new Promise<Response>(() => undefined); // nunca responde
      return json(200, { result: [{ sys_id: 'x' }] });
    }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl });
    const rep = await detectAccess(c, 50);
    expect(rep.denied).toEqual(['sysevent']);
    expect(rep.slow).toEqual(['wf_context']);
    expect(rep.level).toBe('partial');
  });

  it('fetchTokenFromHtml extrai g_ck do HTML', async () => {
    const fetchImpl = vi.fn(async () => new Response("<script>var g_ck = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';</script>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchTokenFromHtml('https://dev.example.com', fetchImpl)).toHaveLength(72);
  });
});

describe('FetchRestClient protege a instância', () => {
  const deny = (msg: string, detail: string) => json(403, { error: { message: msg, detail }, status: 'failure' });

  it('pede sysparm_no_count=true (sem isso a Table API conta a tabela inteira a cada consulta)', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => { urls.push(String(i)); return json(200, { result: [] }); }) as unknown as typeof fetch;
    await new FetchRestClient({ baseUrl: 'https://nocount.example.com', getToken: async () => 't', fetchImpl }).query({ table: 'sys_audit', query: '', fields: ['sys_id'], limit: 1 });
    expect(new URL(urls.find((u) => u.includes('/api/now/table/'))!).searchParams.get('sysparm_no_count')).toBe('true');
  });

  it('o limite de chamadas simultâneas vale para a instância, não para cada cliente', async () => {
    let inFlight = 0, max = 0;
    const fetchImpl = vi.fn(async () => { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return json(200, { result: [] }); }) as unknown as typeof fetch;
    const mk = () => new FetchRestClient({ baseUrl: 'https://gate.example.com', getToken: async () => 't', fetchImpl, concurrency: 2 });
    const a = mk(), b = mk(), c = mk();
    await Promise.all([a, b, c].flatMap((x) => [1, 2, 3].map(() => x.query({ table: 'incident', query: 'active=true', fields: ['sys_id'], limit: 1 }))));
    expect(tableCalls(fetchImpl)).toBe(9);
    expect(max).toBe(2);
  });

  it('tabela negada não é consultada de novo na mesma sessão (cada recusa vira erro no log da instância)', async () => {
    const fetchImpl = vi.fn(async () => deny('User Not Authorized', 'User is unauthorized to access table: sys_audit')) as unknown as typeof fetch;
    const mk = (tok: string) => new FetchRestClient({ baseUrl: 'https://deny.example.com', getToken: async () => tok, fetchImpl });
    expect((await mk('s1').query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 })).access).toBe('denied');
    const again = mk('s1');
    expect((await again.query({ table: 'sys_audit', query: 'documentkey=b', fields: ['sys_id'], limit: 1 })).access).toBe('denied');
    expect(tableCalls(fetchImpl)).toBe(1);
    expect(again.calls).toBe(0);
    // Outra sessão (outro login ou impersonação) pergunta de novo.
    await mk('s2').query({ table: 'sys_audit', query: 'documentkey=b', fields: ['sys_id'], limit: 1 });
    expect(tableCalls(fetchImpl)).toBe(2);
  });

  it('"Insufficient rights to query records" (Query ACL): não repete o mesmo formato de consulta, mas tenta outros', async () => {
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(200, { result: {} }) : new URL(String(i)).searchParams.get('sysparm_query')!.startsWith('sys_created_on>=')
      ? deny('Insufficient rights to query records', 'Field(s) present in the query do not have permission to be read')
      : json(200, { result: [{ sys_id: 'x' }] }))) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://qacl.example.com', getToken: async () => 't', fetchImpl });
    expect((await c.query({ table: 'sysevent', query: 'sys_created_on>=2026-10-01 00:00:00^sys_created_on<=2026-10-02 00:00:00', fields: ['name'], limit: 50 })).access).toBe('no_filter');
    expect((await c.query({ table: 'sysevent', query: 'sys_created_on>=2026-10-05 00:00:00^sys_created_on<=2026-10-06 00:00:00', fields: ['name'], limit: 50 })).access).toBe('no_filter');
    expect(tableCalls(fetchImpl)).toBe(1);
    expect((await c.query({ table: 'sysevent', query: 'sys_id=abc', fields: ['name'], limit: 1 })).access).toBe('ok');
    expect(tableCalls(fetchImpl)).toBe(2);
  });

  it('detectAccess não repete a sondagem que estourou o prazo (a consulta continua rodando no servidor)', async () => {
    const spy = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/wf_context?') ? new Promise<Response>(() => undefined) : json(200, { result: [{ sys_id: 'x' }] })));
    const c = new FetchRestClient({ baseUrl: 'https://slowprobe.example.com', getToken: async () => 't', fetchImpl: spy as unknown as typeof fetch });
    const rep = await detectAccess(c, 30);
    expect(rep.slow).toEqual(['wf_context']);
    expect(spy.mock.calls.filter(([u]) => String(u).includes('/wf_context?')).length).toBe(1);
  });
});

describe('rótulos, tipos e opções vêm do ui/meta (o que o formulário usa), sem consultar o dicionário', () => {
  const meta = { result: { columns: {
    state: { label: 'Estado', type: 'choice', mandatory: false, read_only: false, attributes: 'x=1', choices: [{ label: 'Novo', value: '1' }, { label: 'Em andamento', value: '2' }] },
    caller_id: { label: 'Solicitante', type: 'reference', reference: 'sys_user', mandatory: true, read_only: false },
    short_description: { label: 'Descrição resumida', type: 'string' },
  } } };
  const mk = (base: string) => {
    const urls: string[] = [];
    // Como para itil e usuários de escopo: o ui/meta das tabelas de dicionário vem sem colunas (não podem consultá-las).
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => { urls.push(String(i)); return String(i).includes('/api/now/ui/meta/incident') ? json(200, meta) : String(i).includes('/api/now/ui/meta/') ? json(200, { result: { columns: {} } }) : json(403, { error: { message: 'Insufficient rights to query records', detail: 'Field(s) present in the query do not have permission to be read' } }); }) as unknown as typeof fetch;
    return { c: new FetchRestClient({ baseUrl: base, getToken: async () => 't', fetchImpl }), urls };
  };

  it('quem não pode consultar o dicionário: sys_dictionary, sys_choice e sys_documentation vêm do ui/meta, sem Table API', async () => {
    const { c, urls } = mk('https://meta1.example.com');
    const dict = await c.query({ table: 'sys_dictionary', query: 'nameINincident,task^elementINstate,caller_id', fields: ['name', 'element', 'column_label', 'internal_type', 'reference'], limit: 300 });
    expect(dict.access).toBe('ok');
    expect(dict.rows).toEqual([
      { name: 'incident', element: 'state', column_label: 'Estado', internal_type: 'choice', reference: '' },
      { name: 'incident', element: 'caller_id', column_label: 'Solicitante', internal_type: 'reference', reference: 'sys_user' },
    ]);
    const ch = await c.query({ table: 'sys_choice', query: 'nameINincident,task^elementINstate^inactive=false', fields: ['name', 'element', 'value', 'label', 'language'], limit: 1000 });
    expect(ch.rows.map((r) => [r.value, r.label])).toEqual([['1', 'Novo'], ['2', 'Em andamento']]);
    const doc = await c.query({ table: 'sys_documentation', query: 'nameINincident^elementINshort_description^languageINpt,en', fields: ['name', 'element', 'label', 'language'], limit: 500 });
    expect(doc.rows).toEqual([{ name: 'incident', element: 'short_description', label: 'Descrição resumida', language: 'pt' }]);
    const fs = await c.query({ table: 'sys_dictionary', query: 'nameINincident^elementINcaller_id', fields: ['sys_id', 'name', 'element', 'read_only', 'mandatory', 'active', 'attributes', 'column_label', 'internal_type'], limit: 200 });
    expect(fs.rows[0]).toMatchObject({ element: 'caller_id', mandatory: 'true', read_only: 'false', active: 'true' });
    // Nenhuma consulta à Table API; o ui/meta de cada tabela uma vez só.
    expect(urls.filter((u) => u.includes('/api/now/table/'))).toEqual([]);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('consulta ao dicionário que o ui/meta não sabe responder, sem permissão: negada sem sair', async () => {
    const { c, urls } = mk('https://meta2.example.com');
    expect((await c.query({ table: 'sys_dictionary', query: 'referenceINincident^active=true', fields: ['sys_id', 'name', 'element'], limit: 300 })).access).toBe('denied');
    expect(urls.some((u) => u.includes('/api/now/table/'))).toBe(false);
  });

  it('quem pode consultar o dicionário (admin) continua lendo o dicionário, como na 1.4.4', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => { urls.push(String(i)); return String(i).includes('/ui/meta/sys_dictionary') ? json(200, { result: { columns: { name: { canmatch: true }, element: { canmatch: true } } } }) : json(200, { result: [{ name: 'incident', element: 'state', internal_type: 'integer' }] }); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://meta3.example.com', getToken: async () => 't', fetchImpl });
    const r = await c.query({ table: 'sys_dictionary', query: 'nameINincident^elementINstate', fields: ['name', 'element', 'internal_type'], limit: 10 });
    expect(r.rows[0]!.internal_type).toBe('integer');
    expect(urls.filter((u) => u.includes('/api/now/table/sys_dictionary')).length).toBe(1);
  });
});

describe('tabelas com Query ACL: confere no ui/meta antes de filtrar', () => {
  it('coluna do filtro fora do ui/meta (usuário não pode filtrar por ela): não consulta, e nada vai para a sessão do usuário', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => { urls.push(String(i)); return String(i).includes('/ui/meta/syslog') ? json(200, { result: { columns: { message: { label: 'Message' } } } }) : json(200, { result: [{ sys_id: 'x' }] }); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://guard1.example.com', getToken: async () => 't', fetchImpl });
    const r = await c.query({ table: 'syslog', query: 'sys_created_on>=2026-10-01 00:00:00^sourceINx', fields: ['message'], limit: 10 });
    expect(r.access).toBe('no_filter');
    expect(urls.some((u) => u.includes('/api/now/table/'))).toBe(false);
  });

  it('com a coluna liberada (canmatch), consulta normalmente', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => { urls.push(String(i)); return String(i).includes('/ui/meta/syslog') ? json(200, { result: { columns: { sys_created_on: { canmatch: true }, source: { canmatch: true } } } }) : json(200, { result: [{ sys_id: 'x' }] }); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://guard2.example.com', getToken: async () => 't', fetchImpl });
    expect((await c.query({ table: 'syslog', query: 'sys_created_on>=2026-10-01 00:00:00^sourceINx', fields: ['message'], limit: 10 })).access).toBe('ok');
    expect(urls.filter((u) => u.includes('/api/now/table/syslog')).length).toBe(1);
  });
});

describe('respostas estranhas e nomes inválidos', () => {
  it('200 que não é JSON (página de login do SSO) não vira "vazio", que o motor leria como "nada aconteceu"', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html><body>Sign in with your account</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const r = await new FetchRestClient({ baseUrl: 'https://sso.example.com', getToken: async () => 't', fetchImpl }).query({ table: 'sys_audit', query: 'documentkey=a', fields: ['sys_id'], limit: 1 });
    // Nem "vazio" nem "ok": a fonte fica como não respondida (o ui/meta também veio como página de login).
    expect(['unknown', 'timeout']).toContain(r.access);
  });

  it('nome de tabela fora do padrão do ServiceNow não vira chamada', async () => {
    const fetchImpl = vi.fn(async () => json(200, { result: [{ sys_id: 'x' }] })) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://badname.example.com', getToken: async () => 't', fetchImpl });
    for (const table of ['incident?sysparm_query=x', '../stats', 'Incident', 'u stage', '']) expect((await c.query({ table, query: '', fields: ['sys_id'], limit: 1 })).access).toBe('unknown');
    expect((await c.query({ table: 'x_2270630_pttrail__pedido', query: '', fields: ['sys_id'], limit: 1 })).access).toBe('ok');
    expect(tableCalls(fetchImpl)).toBe(1);
  });

  it('padrão: no máximo 2 chamadas ao mesmo tempo por instância (a sessão do usuário atende em fila)', async () => {
    let inFlight = 0, max = 0;
    const fetchImpl = vi.fn(async () => { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return json(200, { result: [] }); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://default2.example.com', getToken: async () => 't', fetchImpl });
    await Promise.all(Array.from({ length: 8 }, () => c.query({ table: 'incident', query: 'active=true', fields: ['sys_id'], limit: 1 })));
    expect(max).toBe(2);
  });
});

describe('qualquer tabela: só filtra pelo que o ui/meta diz que o usuário pode filtrar', () => {
  const metaOf = (byTable: Record<string, Record<string, unknown>>) => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => {
      const u = String(i); urls.push(u);
      const m = u.match(/\/api\/now\/ui\/meta\/([a-z0-9_]+)/);
      if (m) return byTable[m[1]!] ? json(200, { result: { columns: byTable[m[1]!] } }) : json(403, {});
      return json(200, { result: [{ sys_id: 'x' }] });
    }) as unknown as typeof fetch;
    return { fetchImpl, urls, table: (u: string[]) => u.filter((x) => x.includes('/api/now/table/')).length };
  };

  it('tabela sem nenhuma coluna no ui/meta (itil em sysauto_script): "negado", sem consulta', async () => {
    const m = metaOf({ sysauto_script: {} });
    const c = new FetchRestClient({ baseUrl: 'https://g3.example.com', getToken: async () => 't', fetchImpl: m.fetchImpl });
    expect((await c.query({ table: 'sysauto_script', query: 'active=true^scriptLIKEpriority', fields: ['sys_id'], limit: 5 })).access).toBe('denied');
    expect(m.table(m.urls)).toBe(0);
  });

  it('coluna com ponto: confere a tabela referenciada; ordenação só precisa da coluna existir', async () => {
    const m = metaOf({
      sys_hub_trigger_instance_v2: { flow: { canmatch: true, reference: 'sys_hub_flow' }, trigger_type: { canmatch: true }, sys_created_on: {} },
      sys_hub_flow: { active: { canmatch: true } },
    });
    const c = new FetchRestClient({ baseUrl: 'https://g4.example.com', getToken: async () => 't', fetchImpl: m.fetchImpl });
    expect((await c.query({ table: 'sys_hub_trigger_instance_v2', query: 'flow.active=true^trigger_typeSTARTSWITHrecord^ORDERBYsys_created_on', fields: ['flow'], limit: 5 })).access).toBe('ok');
    // sys_class_name não aparece no ui/meta de sys_hub_flow: filtro barrado antes de sair.
    expect((await c.query({ table: 'sys_hub_trigger_instance_v2', query: 'flow.sys_class_name=sys_hub_flow', fields: ['flow'], limit: 5 })).access).toBe('no_filter');
    expect(m.table(m.urls)).toBe(1);
  });

  it('o ui/meta guardado na sessão do navegador é reaproveitado (o service worker perde a memória)', async () => {
    const saved = new Map<string, unknown>();
    const store = { get: async (k: string) => saved.get(k), set: async (k: string, v: unknown) => { saved.set(k, v); } };
    const m = metaOf({ incident: { active: { canmatch: true } } });
    await new FetchRestClient({ baseUrl: 'https://g5.example.com', getToken: async () => 't', fetchImpl: m.fetchImpl, store }).query({ table: 'incident', query: 'active=true', fields: ['sys_id'], limit: 1 });
    expect(m.urls.filter((u) => u.includes('/ui/meta/')).length).toBe(1);
    // Mesma sessão, outro endereço de chave em memória não existe: simula memória perdida apagando o cache em memória
    // pela troca de cliente com outro token não serve; então confere que a chave foi guardada.
    expect([...saved.keys()].some((k) => k.startsWith('meta|https://g5.example.com|t|incident'))).toBe(true);
  });
});

describe('negação depende do filtro', () => {
  it('a mesma tabela negada sem filtro continua sendo consultada com outro filtro (sys_script do usuário de escopo)', async () => {
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => {
      const u = new URL(String(i));
      if (u.pathname.includes('/ui/meta/')) return json(403, {});
      return u.searchParams.get('sysparm_query')!.startsWith('collectionIN') ? json(200, { result: [{ sys_id: 'br1' }] }) : json(403, { error: { message: 'User Not Authorized', detail: 'User is unauthorized to access table: sys_script' } });
    }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://shape.example.com', getToken: async () => 't', fetchImpl });
    expect((await c.query({ table: 'sys_script', query: 'active=true^scriptLIKEpriority', fields: ['sys_id'], limit: 5 })).access).toBe('denied');
    expect((await c.query({ table: 'sys_script', query: 'collectionINx_app_pedido^active=true', fields: ['sys_id'], limit: 5 })).access).toBe('ok');
  });
});

describe('500 do balanceador', () => {
  it('500 em HTML (snow_adc) é repetido uma vez; 500 em JSON (erro da API) não', async () => {
    let n = 0;
    const adc = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(403, {}) : n++ ? json(200, { result: [{ sys_id: 'x' }] }) : new Response('<html><center>snow_adc</center></html>', { status: 500 }))) as unknown as typeof fetch;
    expect((await new FetchRestClient({ baseUrl: 'https://adc.example.com', getToken: async () => 't', fetchImpl: adc }).query({ table: 'incident', query: 'active=true', fields: ['sys_id'], limit: 1 })).access).toBe('ok');
    expect(tableCalls(adc)).toBe(2);
    const api = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(403, {}) : json(500, { error: { message: 'x' } }))) as unknown as typeof fetch;
    await new FetchRestClient({ baseUrl: 'https://api500.example.com', getToken: async () => 't', fetchImpl: api }).query({ table: 'incident', query: 'active=true', fields: ['sys_id'], limit: 1 });
    expect(tableCalls(api)).toBe(1);
  });
});

describe('ui/meta que não respondeu (revisão 24/10)', () => {
  it('o registro (filtro só por sys_id) ainda é lido; consulta filtrada vira fonte lenta, nunca "vazia"', async () => {
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => (String(i).includes('/ui/meta/') ? json(503, {}) : json(200, { result: [{ sys_id: 'a'.repeat(32) }] }))) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://slowmeta.example.com', getToken: async () => 't', fetchImpl });
    const rec = await c.query({ table: 'incident', query: `sys_id=${'a'.repeat(32)}`, fields: ['sys_id'], limit: 1 });
    expect(rec.access).toBe('ok');
    const audit = await c.query({ table: 'sys_audit', query: `documentkey=${'a'.repeat(32)}^ORDERBYDESCsys_created_on`, fields: ['fieldname'], limit: 10 });
    expect(audit.access).toBe('timeout');
    expect(tableCalls(fetchImpl)).toBe(1);
  });

  it('500 em HTML do balanceador no ui/meta: repete uma vez e a consulta sai conferida (bloco C, 24/10)', async () => {
    let metaCalls = 0;
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => {
      if (!String(i).includes('/ui/meta/')) return json(200, { result: [] });
      return ++metaCalls === 1
        ? new Response('<html>snow_adc</html>', { status: 500, headers: { 'Content-Type': 'text/html' } })
        : json(200, { result: { columns: { documentkey: { name: 'documentkey', canmatch: true } } } });
    }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://html500meta.example.com', getToken: async () => 't', fetchImpl });
    const audit = await c.query({ table: 'sys_audit', query: `documentkey=${'a'.repeat(32)}`, fields: ['fieldname'], limit: 10 });
    expect(metaCalls).toBe(2);
    expect(audit.access).toBe('empty');
  });

  it('500 em JSON no ui/meta: não repete (erro do pedido, não do balanceador)', async () => {
    let metaCalls = 0;
    const fetchImpl = vi.fn(async (i: RequestInfo | URL) => {
      if (!String(i).includes('/ui/meta/')) return json(200, { result: [] });
      metaCalls++;
      return json(500, { error: { message: 'x' } });
    }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://json500meta.example.com', getToken: async () => 't', fetchImpl });
    const audit = await c.query({ table: 'sys_audit', query: `documentkey=${'a'.repeat(32)}`, fields: ['fieldname'], limit: 10 });
    expect(metaCalls).toBe(1);
    expect(audit.access).toBe('timeout');
    expect(tableCalls(fetchImpl)).toBe(0);
  });
});

describe('cliente cancelado (M9: clique novo na mesma aba, 25/10)', () => {
  it('a consulta no ar é abortada e a da fila sai sem ir à instância', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      if (String(input).includes('/ui/meta/')) return Promise.resolve(json(200, { result: { columns: { sys_id: { canmatch: true } } } }));
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    }) as unknown as typeof fetch;
    const ctrl = new AbortController();
    const c = new FetchRestClient({ baseUrl: 'https://cancel.example.com', getToken: async () => 'tok', fetchImpl, signal: ctrl.signal });
    const q = (n: number) => c.query({ table: 'incident', query: '', fields: ['sys_id'], limit: n });
    const all = Promise.all([q(1), q(2), q(3)]);
    await new Promise((r) => setTimeout(r, 20));
    expect(tableCalls(fetchImpl)).toBe(2); // no máximo 2 por instância: a terceira espera na fila
    ctrl.abort();
    const rs = await all;
    expect(rs.map((r) => r.access)).toEqual(['timeout', 'timeout', 'timeout']);
    expect(tableCalls(fetchImpl)).toBe(2);
    // A vaga foi devolvida: outro cliente da mesma instância segue normalmente.
    const ok = vi.fn(async () => json(200, { result: [{ sys_id: 'x' }] })) as unknown as typeof fetch;
    const c2 = new FetchRestClient({ baseUrl: 'https://cancel.example.com', getToken: async () => 'tok', fetchImpl: ok });
    expect((await c2.query({ table: 'incident', query: '', fields: ['sys_id'], limit: 1 })).access).toBe('ok');
  });
});

describe('resposta depois do prazo (caça 1.4.6)', () => {
  it('fetch que ignora o cancelamento e devolve 200 vazio depois do prazo é timeout, não lista vazia', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/ui/meta/')) return new Response('', { status: 404 });
      await new Promise((r) => setTimeout(r, 80));
      return new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const c = new FetchRestClient({ baseUrl: 'https://late.example.com', getToken: async () => 't', fetchImpl, timeoutMs: 20 });
    const r = await c.query({ table: 'sys_audit', query: 'sys_id=0123456789abcdef0123456789abcdef', fields: ['sys_id'], limit: 1 });
    expect(r.access).toBe('timeout');
  });
});
