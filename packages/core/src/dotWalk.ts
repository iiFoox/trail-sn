import type { RestClient } from './client/RestClient';
import { RecordNotFoundError, RecordUnavailableError, recordUnanswered, type Target } from './types';

/**
 * Campo de outro registro mostrado no formulário (dot-walking: `u_solicitacao.number`). O valor e a auditoria dele são
 * do registro apontado, não do aberto: a investigação vai para lá. Pedido do dono (28/10/2026): esses campos ficavam
 * sem ícone.
 */
export interface DotWalkTarget { table: string; sysId: string; field: string; via: { table: string; field: string }[] }

/** Caminho com ponto: até 5 níveis de nomes técnicos. */
export const DOT_PATH = /^[a-z0-9_]{1,80}(?:\.[a-z0-9_]{1,80}){1,4}$/;

/** Uma referência vazia no caminho: o campo mostrado está em branco e não há registro para investigar. */
export class EmptyReferenceError extends Error {
  constructor(public readonly field: string) {
    super(`Empty reference: ${field}`);
    this.name = 'EmptyReferenceError';
  }
}

export async function resolveDotWalk(client: RestClient, start: { table: string; sysId: string; path: string }): Promise<DotWalkTarget> {
  if (!DOT_PATH.test(start.path)) throw new RecordNotFoundError({ table: start.table, sysId: start.sysId, field: start.path });
  const parts = start.path.split('.');
  const field = parts.pop()!;
  let table = start.table, sysId = start.sysId;
  // Tabela da referência quando o registro é de uma classe filha: campos herdados estão no dicionário dela.
  let base: string | undefined;
  const via: DotWalkTarget['via'] = [];
  for (const ref of parts) {
    const t: Target = { table, sysId, field: ref };
    // Tabela apontada: pelo dicionário (que o cliente responde pelo ui/meta, legível por quem vê o formulário).
    const dict = await client.query({ table: 'sys_dictionary', query: `name${base ? `IN${table},${base}` : `=${table}`}^element=${ref}`, fields: ['element', 'reference'], limit: 1 });
    const refTable = dict.rows[0]?.reference;
    if (!refTable) {
      if (recordUnanswered(dict.access)) throw new RecordUnavailableError(t, dict.access === 'timeout' ? 'timeout' : 'error', dict.status);
      throw new RecordNotFoundError(t);
    }
    const rec = await client.query({ table, query: `sys_id=${sysId}`, fields: [ref], limit: 1 });
    if (recordUnanswered(rec.access)) throw new RecordUnavailableError(t, rec.access === 'timeout' ? 'timeout' : 'error', rec.status);
    const row = rec.rows[0];
    if (!row) throw new RecordNotFoundError(t);
    const next = row[ref] ?? '';
    if (!next) throw new EmptyReferenceError(ref);
    if (!/^[0-9a-f]{32}$/.test(next)) throw new RecordNotFoundError(t);
    via.push({ table, field: ref });
    // A referência pode apontar para a tabela-mãe (task); a auditoria fica com a classe do registro (incident).
    const cls = await client.query({ table: refTable, query: `sys_id=${next}`, fields: ['sys_class_name'], limit: 1 });
    const actual = cls.rows[0]?.sys_class_name;
    table = actual && /^[a-z0-9_]+$/.test(actual) ? actual : refTable;
    base = table !== refTable ? refTable : undefined;
    sysId = next;
  }
  return { table, sysId, field, via };
}
