import type { AccessState, Row } from '../types';

export interface QueryRequest {
  table: string;
  /** Encoded query da ServiceNow (sem codificação de URL). */
  query: string;
  fields: string[];
  limit: number;
  /**
   * Prazo do servidor para esta consulta, contado a partir de quando ela sai (não da fila). Sem ele, com poucas
   * chamadas simultâneas, a espera na fila estourava o prazo e a pista sumia sem o servidor ter demorado.
   */
  timeoutMs?: number;
  /** Quem pediu desistiu: se a consulta ainda estiver na fila, sai dela sem ir à instância. */
  signal?: AbortSignal;
}

export interface QueryResult {
  rows: Row[];
  status: number;
  /** Estado de acesso inferido desta chamada. */
  access: AccessState;
}

/** Uma mudança de campo no histórico do formulário (valores como o formulário mostra). */
export interface HistoryChange { field: string; label?: string; type?: string; oldValue: string; newValue: string }
/** Uma gravação no histórico do formulário: quem, quando (UTC, "AAAA-MM-DD hh:mm:ss") e o que mudou. */
export interface HistoryEntry {
  at: string; userId?: string; userName?: string; changes: HistoryChange[];
  /** Fuso de quem está logado, em ms (hora local - UTC): o histórico mostra datas no fuso da pessoa. */
  tzOffsetMs?: number;
}
/** Histórico do formulário: as gravações e os campos que ele mostra (os do Activity Stream da tabela). */
export interface HistoryResult {
  entries: HistoryEntry[];
  fields: string[];
  /** Opções das listas como o formulário mostra (campo → rótulo → valor), de /api/now/ui/meta; quem não lê sys_choice vê isto. */
  choices?: Record<string, Record<string, string>>;
  /** Campos de referência da tabela (campo → tabela referenciada), de /api/now/ui/meta: o histórico mostra o nome, não o sys_id. */
  refs?: Record<string, string>;
  /** Campo de exibição de cada referência (reference_display_field do ui/meta): campo → name, number, u_nome... */
  refDisplay?: Record<string, string>;
  /** Fuso do usuário (IANA): com ele, cada data volta para UTC com o horário de verão certo daquela data. */
  timeZone?: string;
}

/**
 * Abstração de leitura da Table API. O motor só conhece esta interface,
 * o que permite rodar com fetch no navegador ou com fixtures nos testes.
 */
export interface RestClient {
  query(req: QueryRequest): Promise<QueryResult>;
  /** Quantas chamadas foram feitas (para medir e para a regressão). */
  readonly calls: number;
  /**
   * Histórico do registro como o formulário mostra (Activity Stream), com as ACLs de quem está logado.
   * É o que sobra para quem não lê `sys_audit` (quase todo mundo que não é admin). null = indisponível.
   */
  history?(table: string, sysId: string): Promise<HistoryResult | null>;
}

/** Interpreta o status HTTP e o corpo no estado de acesso. Confirmado na Fase 0 (ver arquitetura). */
export function classifyAccess(status: number, rows: Row[], body?: string): AccessState {
  if (status === 403 && body && /Field\(s\) present in the query/i.test(body)) return 'no_filter';
  if (status === 403 || status === 401) return 'denied';
  if (status >= 200 && status < 300) return rows.length ? 'ok' : 'empty';
  return 'unknown';
}
