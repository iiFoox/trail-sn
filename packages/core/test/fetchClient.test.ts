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

  it('detectAccess não reporta "full" quando as chamadas falham', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Illegal invocation'); }) as unknown as typeof fetch;
    const c = new FetchRestClient({ baseUrl: 'https://dev.example.com', getToken: async () => 't', fetchImpl });
    const rep = await detectAccess(c, 200);
    expect(rep.level).toBe('none');
  });

  it('fetchTokenFromHtml extrai g_ck do HTML', async () => {
    const fetchImpl = vi.fn(async () => new Response("<script>var g_ck = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';</script>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchTokenFromHtml('https://dev.example.com', fetchImpl)).toHaveLength(72);
  });
});
