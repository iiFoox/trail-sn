import { describe, expect, it } from 'vitest';
import { FakeRestClient } from '../src/client/FakeRestClient';
import { recordVersions, versionPayloads } from '../src/versions';

const SI = '027ae9adc3a0421037586a3599013160';
const SET = '37d4d5b03da7031074a2476226988e43';

function client() {
  const c = new FakeRestClient();
  c.rows('sys_update_version', [
    { sys_id: 'a828292fc34853101cbdb8e1b4013191', name: `sys_script_include_${SI}`, sys_created_on: '2026-10-26 13:57:09', sys_created_by: 'admin', state: 'current', action: 'INSERT_OR_UPDATE', source: SET, source_table: 'sys_update_set', sys_recorded_at: '1a1788031530000001', payload: '<x>novo</x>' },
    { sys_id: 'ac28292fc34853101cbdb8e1b401318b', name: `sys_script_include_${SI}`, sys_created_on: '2026-10-26 13:57:09', sys_created_by: 'admin', state: 'previous', action: 'INSERT_OR_UPDATE', source: '', source_table: 'sys_upgrade_history', sys_recorded_at: '1a1788031080000001', payload: '<x>velho</x>' },
  ]);
  c.rows('sys_update_set', [{ sys_id: SET, name: 'Default' }]);
  return c;
}

describe('versões de um registro de configuração', () => {
  it('lista do mais novo ao mais antigo, com a origem e o nome do update set, sem o conteúdo', async () => {
    const c = client();
    const r = await recordVersions(c, { table: 'sys_script_include', sysId: SI });
    expect(r.versions.map((v) => [v.state, v.source, v.sourceName])).toEqual([['current', 'update_set', 'Default'], ['previous', 'upgrade', undefined]]);
    const list = c.log.find((x) => x.table === 'sys_update_version')!;
    expect(list.query).toBe(`name=sys_script_include_${SI}^ORDERBYDESCsys_recorded_at`);
    expect(list.fields).not.toContain('payload');
  });

  it('o conteúdo vem só para as versões pedidas, no máximo duas', async () => {
    const c = client();
    const p = await versionPayloads(c, ['a828292fc34853101cbdb8e1b4013191', 'ac28292fc34853101cbdb8e1b401318b', 'ffffffffffffffffffffffffffffffff', 'x']);
    expect(p).toEqual({ a828292fc34853101cbdb8e1b4013191: '<x>novo</x>', ac28292fc34853101cbdb8e1b401318b: '<x>velho</x>' });
    expect(c.log.at(-1)!.limit).toBe(2);
  });

  it('tabela ou sys_id fora do padrão não vira consulta', async () => {
    const c = client();
    expect((await recordVersions(c, { table: 'sys_script^x', sysId: SI })).versions).toEqual([]);
    expect(c.log).toHaveLength(0);
  });
});
