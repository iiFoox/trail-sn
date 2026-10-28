import { describe, expect, it } from 'vitest';
import { FetchRestClient } from '../src/client/FetchRestClient';

/**
 * Zurich (28/10/2026): o GET do list_history num registro sem cache de histórico fez a plataforma criar o
 * sys_history_set (INC0010043); a Table API de sys_history_line não criou nada (INC0010044). Decisão do dono: o Trail só
 * chama o list_history quando o cache já existe.
 */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function instance(lines: unknown[] | 403) {
  const urls: string[] = [];
  const fetchImpl = (async (i: RequestInfo | URL) => {
    const u = String(i);
    urls.push(u);
    if (u.includes('/api/now/ui/meta/sys_history_line')) return json(200, { result: { columns: { set: { reference: 'sys_history_set', canmatch: true }, field: { canmatch: true } } } });
    if (u.includes('/api/now/ui/meta/sys_history_set')) return json(200, { result: { columns: { id: { canmatch: true } } } });
    if (u.includes('/api/now/ui/meta/')) return json(200, { result: { columns: { state: { canmatch: true } } } });
    if (u.includes('/api/now/table/sys_history_line')) return lines === 403 ? json(403, { error: { message: 'User Not Authorized' } }) : json(200, { result: lines });
    if (u.includes('/angular.do')) return json(200, { entries: [{ sys_timestamp: Date.UTC(2026, 9, 28), user_id: 'u', entries: { changes: [{ field_name: 'state', old_value: 'New', new_value: 'Closed' }] } }], fields: [{ name: 'state' }] });
    return json(200, { result: [] });
  }) as typeof fetch;
  return { urls, client: new FetchRestClient({ baseUrl: `https://guard${Math.random()}.example.com`, getToken: async () => 't', fetchImpl }) };
}

describe('list_history só com o cache de histórico já existente', () => {
  it('sem cache: não chama o list_history', async () => {
    const { urls, client } = instance([]);
    expect(await client.history('incident', 'a'.repeat(32))).toBeNull();
    expect(urls.some((u) => u.includes('/angular.do'))).toBe(false);
    expect(urls.some((u) => u.includes('sys_history_line') && decodeURIComponent(u).includes(`set.id=${'a'.repeat(32)}`))).toBe(true);
  });

  it('sem leitura de sys_history_line (não dá para conferir): também não chama', async () => {
    const { urls, client } = instance(403);
    expect(await client.history('incident', 'b'.repeat(32))).toBeNull();
    expect(urls.some((u) => u.includes('/angular.do'))).toBe(false);
  });

  it('com cache: chama e devolve o histórico', async () => {
    const { urls, client } = instance([{ set: 'c'.repeat(32) }]);
    const h = await client.history('incident', 'd'.repeat(32));
    expect(h?.entries).toHaveLength(1);
    expect(urls.some((u) => u.includes('/angular.do'))).toBe(true);
  });
});
