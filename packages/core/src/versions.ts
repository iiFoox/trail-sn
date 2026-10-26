/**
 * Versões de um registro de configuração (script include, regra de negócio, client script, UI policy...): cada vez que
 * ele é salvo, a instância guarda o registro inteiro em sys_update_version (o mesmo que a lista "Versions" do
 * formulário mostra). Registros de dados (incidente, chamado) não têm versões; para eles vale o histórico.
 *
 * Duas leituras, as duas só GET: a lista (sem o conteúdo, que é o registro inteiro em XML) e, quando a pessoa escolhe
 * uma versão, o conteúdo dela e da anterior.
 */
import type { RestClient } from './client/RestClient';
import type { AccessState } from './types';
import { isSysId } from './util';

export interface RecordVersion {
  sysId: string;
  /** Quando foi salva (UTC, "AAAA-MM-DD hh:mm:ss"). */
  at: string;
  by: string;
  /** current: a versão em uso; previous e history: anteriores. */
  state: string;
  /** INSERT_OR_UPDATE ou DELETE. */
  action: string;
  /** De onde veio: update set (salvamento comum), atualização da plataforma ou outro (importação de update set, plugin). */
  source: 'update_set' | 'upgrade' | 'other';
  /** Nome do update set, quando é um. */
  sourceName?: string;
  sourceId?: string;
}

export interface RecordVersions {
  versions: RecordVersion[];
  access: AccessState;
  timing: { totalMs: number; calls: number };
}

const NAME_RE = /^[a-z0-9_]+$/;
const LIMIT = 50;

export async function recordVersions(client: RestClient, target: { table: string; sysId: string }): Promise<RecordVersions> {
  const started = Date.now();
  const calls0 = client.calls;
  if (!NAME_RE.test(target.table) || !isSysId(target.sysId)) return { versions: [], access: 'unknown', timing: { totalMs: 0, calls: 0 } };
  // sys_recorded_at desempata salvamentos no mesmo segundo (o formulário ordena por ele).
  const r = await client.query({
    table: 'sys_update_version',
    query: `name=${target.table}_${target.sysId}^ORDERBYDESCsys_recorded_at`,
    fields: ['sys_id', 'sys_created_on', 'sys_created_by', 'state', 'action', 'source', 'source_table'],
    limit: LIMIT,
  }).catch(() => ({ rows: [], status: 0, access: 'unknown' as AccessState }));
  const setIds = [...new Set(r.rows.filter((v) => v.source_table === 'sys_update_set' && isSysId(v.source ?? '')).map((v) => v.source!))];
  const sets = setIds.length
    ? (await client.query({ table: 'sys_update_set', query: `sys_idIN${setIds.join(',')}`, fields: ['sys_id', 'name'], limit: setIds.length }).catch(() => ({ rows: [] }))).rows
    : [];
  const setName = new Map(sets.map((s) => [s.sys_id ?? '', s.name ?? '']));
  const versions = r.rows.map((v): RecordVersion => {
    const source = v.source_table === 'sys_update_set' ? 'update_set' : v.source_table === 'sys_upgrade_history' ? 'upgrade' : 'other';
    const name = setName.get(v.source ?? '');
    return {
      sysId: v.sys_id ?? '', at: v.sys_created_on ?? '', by: v.sys_created_by ?? '', state: v.state ?? '', action: v.action ?? '', source,
      ...(name ? { sourceName: name } : {}), ...(source === 'update_set' && v.source ? { sourceId: v.source } : {}),
    };
  });
  return { versions, access: r.access, timing: { totalMs: Date.now() - started, calls: client.calls - calls0 } };
}

/** Conteúdo (XML do registro inteiro) das versões pedidas, por sys_id. No máximo duas por vez: a escolhida e a anterior. */
export async function versionPayloads(client: RestClient, sysIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(sysIds.filter(isSysId))].slice(0, 2);
  if (!ids.length) return {};
  const r = await client.query({ table: 'sys_update_version', query: `sys_idIN${ids.join(',')}`, fields: ['sys_id', 'payload'], limit: ids.length });
  return Object.fromEntries(r.rows.map((v) => [v.sys_id ?? '', v.payload ?? '']));
}
