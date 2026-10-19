import type { AccessState, Row } from '../types';

export interface QueryRequest {
  table: string;
  /** Encoded query da ServiceNow (sem codificação de URL). */
  query: string;
  fields: string[];
  limit: number;
}

export interface QueryResult {
  rows: Row[];
  status: number;
  /** Estado de acesso inferido desta chamada. */
  access: AccessState;
}

/**
 * Abstração de leitura da Table API. O motor só conhece esta interface,
 * o que permite rodar com fetch no navegador ou com fixtures nos testes.
 */
export interface RestClient {
  query(req: QueryRequest): Promise<QueryResult>;
  /** Quantas chamadas foram feitas (para medir e para a regressão). */
  readonly calls: number;
}

/** Interpreta o status HTTP e o corpo no estado de acesso. Confirmado na Fase 0 (ver arquitetura). */
export function classifyAccess(status: number, rows: Row[], body?: string): AccessState {
  if (status === 403 && body && /Field\(s\) present in the query/i.test(body)) return 'no_filter';
  if (status === 403 || status === 401) return 'denied';
  if (status >= 200 && status < 300) return rows.length ? 'ok' : 'empty';
  return 'unknown';
}
