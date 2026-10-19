import type { RestClient } from './client/RestClient';
import type { AccessState } from './types';
import { withTimeout } from './util';

/** Fontes que o detector verifica e o que cada uma habilita. */
export const SOURCES = [
  'sys_audit',
  'syslog_transaction',
  'sysevent',
  'sysevent_script_action',
  'sys_flow_context',
  'wf_context',
  'sys_script',
  'sys_script_include',
  'sys_ui_action',
  'sysauto_script',
  'sys_db_object',
] as const;

export type Source = (typeof SOURCES)[number];

export type AccessLevel = 'full' | 'partial' | 'none';

export interface AccessReport {
  level: AccessLevel;
  states: Record<Source, AccessState>;
  /** Fontes negadas, por nome técnico, para o usuário copiar no chamado. */
  denied: Source[];
  checkedAt: string;
}

/**
 * Uma chamada GET com sysparm_limit=1 por fonte, todas em paralelo.
 * Decide o que o painel pode prometer: perícia completa, parcial ou só orientação.
 */
export async function detectAccess(client: RestClient, timeoutMs = 3000): Promise<AccessReport> {
  const entries = await Promise.all(
    SOURCES.map(async (table) => {
      const r = await withTimeout(
        client.query({ table, query: '', fields: ['sys_id'], limit: 1 }),
        timeoutMs,
        { rows: [], status: 0, access: 'timeout' as AccessState },
      );
      // Tabela vazia é acessível; só 403/401 é negado.
      return [table, r.access] as const;
    }),
  );
  const states = Object.fromEntries(entries) as Record<Source, AccessState>;
  // Só 'ok' e 'empty' contam como leitura. Timeout e erro de rede também limitam o resultado.
  const readable = (s: AccessState) => s === 'ok' || s === 'empty';
  const denied = SOURCES.filter((s) => !readable(states[s]));
  const level: AccessLevel = !readable(states.sys_audit) ? 'none' : denied.length ? 'partial' : 'full';
  return { level, states, denied, checkedAt: new Date().toISOString() };
}
