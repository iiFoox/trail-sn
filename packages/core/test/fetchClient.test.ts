import { describe, expect, it, vi } from 'vitest';
import { FetchRestClient, fetchTokenFromHtml } from '../src/client/FetchRestClient';
import { detectAccess } from '../src/access';

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
    expect(calls[0]!.url).toContain('https://dev.example.com/api/now/table/incident?');
    expect(calls[0]!.headers.get('X-UserToken')).toBe('tok');
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('500 não é repetido (sys_choice dá 500 sempre para escopo.user); 503 é', async () => {
    const f500 = vi.fn(async () => json(500, { error: { message: 'Internal' }, status: 'failure' })) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl: f500 });
    const r = await c.query({ table: 'sys_choice', query: 'name=incident', fields: ['value'], limit: 1 });
    expect(r).toMatchObject({ status: 500, access: 'unknown' });
    expect(f500).toHaveBeenCalledTimes(1);
    let n = 0;
    const f503 = vi.fn(async () => (n++ ? json(200, { result: [{ sys_id: 'x' }] }) : json(503, {}))) as unknown as typeof fetch;
    const c2 = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl: f503 });
    expect((await c2.query({ table: 'incident', query: '', fields: ['sys_id'], limit: 1 })).status).toBe(200);
    expect(f503).toHaveBeenCalledTimes(2);
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
