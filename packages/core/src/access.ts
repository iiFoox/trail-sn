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
  /** Fontes negadas (401/403), por nome técnico, para o usuário copiar no chamado. */
  denied: Source[];
  /** Fontes que não responderam a tempo: não é falta de acesso, é instância lenta. */
  slow: Source[];
  checkedAt: string;
}

/**
 * Uma chamada GET com sysparm_limit=1 por fonte, todas em paralelo.
 * Decide o que o painel pode prometer: perícia completa, parcial ou só orientação.
 *
 * O prazo conta também o tempo na fila do cliente (6 por vez), então com a instância lenta as últimas fontes
 * estouravam e apareciam como "sem acesso" para quem é admin. Agora: prazo maior, e o que não responder a tempo vai
 * para `slow`, separado de `denied` (401/403).
 */
export async function detectAccess(client: RestClient, timeoutMs = 8000): Promise<AccessReport> {
  const probe = (table: Source) => withTimeout(
    client.query({ table, query: '', fields: ['sys_id'], limit: 1 }),
    timeoutMs,
    { rows: [], status: 0, access: 'timeout' as AccessState },
  ).then((r) => [table, r.access] as const);
  // Sem segunda tentativa: o navegador desiste da resposta, mas a consulta continua rodando no servidor. Repetir só
  // somava carga justamente quando a instância já estava lenta.
  const states = Object.fromEntries(await Promise.all(SOURCES.map(probe))) as Record<Source, AccessState>;
  // Só 'ok' e 'empty' contam como leitura (tabela vazia é acessível).
  const readable = (s: AccessState) => s === 'ok' || s === 'empty';
  const denied = SOURCES.filter((s) => states[s] === 'denied');
  const slow = SOURCES.filter((s) => !readable(states[s]) && states[s] !== 'denied');
  const level: AccessLevel = !readable(states.sys_audit) ? 'none' : denied.length || slow.length ? 'partial' : 'full';
  return { level, states, denied, slow, checkedAt: new Date().toISOString() };
}

/** Retenção configurada em sys_auto_flush para as tabelas de rastro (só regras sem condição). Negado → vazio. */
export async function fetchRetention(client: RestClient): Promise<Partial<Record<'syslog_transaction' | 'sysevent', number>>> {
  const r = await client.query({ table: 'sys_auto_flush', query: 'active=true^tablenameINsyslog_transaction,sysevent', fields: ['tablename', 'age', 'conditions'], limit: 20 });
  const out: Partial<Record<'syslog_transaction' | 'sysevent', number>> = {};
  for (const row of r.rows) {
    if (row.conditions) continue;
    const t = row.tablename as 'syslog_transaction' | 'sysevent';
    const age = Number(row.age);
    if (!age) continue;
    out[t] = Math.min(out[t] ?? Infinity, age);
  }
  return out;
}
