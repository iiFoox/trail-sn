/**
 * Cliente compartilhado entre os módulos de uma mesma pergunta ("Regras do campo", "Simular um valor").
 *
 *  - A mesma consulta (tabela, filtro, campos, limite) feita por dois módulos vai à instância uma vez só: a segunda
 *    reaproveita a promessa da primeira (por exemplo, `sys_script` lido pelo "Quem grava" e pelo "Quem depende").
 *  - Cada consulta tem prazo, contado quando sai da fila, sem repetição. Erro, prazo ou falta de acesso viram lista vazia.
 *  - Guarda o estado de acesso de cada fonte (o pior visto), no mesmo padrão de `fieldState`.
 *
 * Só GET: é um invólucro de `RestClient.query`.
 */
import type { QueryRequest, QueryResult, RestClient } from './client/RestClient';
import type { AccessState } from './types';
import { timedQuery } from './util';

const RANK: Record<AccessState, number> = { ok: 0, empty: 1, unknown: 2, timeout: 3, no_filter: 4, denied: 5 };

export class SharedClient implements RestClient {
  /** Estado de cada fonte lida (o pior visto entre as consultas a ela). */
  readonly access: Record<string, AccessState> = {};
  private memo = new Map<string, Promise<QueryResult>>();
  private readonly timeoutMs: number;
  private readonly calls0: number;

  constructor(readonly inner: RestClient, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.calls0 = inner.calls;
  }

  /** Chamadas que de fato foram à instância (as reaproveitadas não contam). */
  get calls(): number { return this.inner.calls - this.calls0; }

  query(req: QueryRequest): Promise<QueryResult> {
    const key = `${req.table}|${req.query}|${req.fields.join(',')}|${req.limit}`;
    let p = this.memo.get(key);
    if (!p) {
      // Prazo contado quando a consulta sai da fila, e sem repetição: a consulta abandonada continua rodando no servidor,
      // e repetir só somava carga justo quando a instância estava lenta.
      p = timedQuery({ query: (r) => this.inner.query(r).catch(() => ({ rows: [], status: 0, access: 'unknown' as AccessState })) }, req, this.timeoutMs)
        .then((r) => {
          this.note(req.table, r.access);
          // Erro (500, rede, página de login) não fica guardado: quem repetir vai à instância. Prazo continua guardado.
          if (r.access === 'unknown') this.memo.delete(key);
          return r;
        });
      this.memo.set(key, p);
    }
    return p;
  }

  /** Marca uma fonte, como a hierarquia que faltou nas duas tentativas (vira lenta e entra em `slow`). */
  mark(table: string, a: AccessState): void { this.note(table, a); }

  private note(table: string, a: AccessState): void {
    const prev = this.access[table];
    if (!prev || RANK[a] > RANK[prev]) this.access[table] = a;
  }

  /** Fontes negadas (401/403, ou filtro recusado) e fontes que não responderam a tempo. */
  denied(only?: readonly string[]): string[] {
    return Object.entries(this.access).filter(([t, a]) => (a === 'denied' || a === 'no_filter') && (!only || only.includes(t))).map(([t]) => t);
  }
  slow(only?: readonly string[]): string[] {
    // Sem resposta é lenta: prazo, e também 500, rede ou página de login ('unknown'), que antes passavam calados.
    return Object.entries(this.access).filter(([t, a]) => (a === 'timeout' || a === 'unknown') && (!only || only.includes(t))).map(([t]) => t);
  }
}

/** Usa o cliente compartilhado que veio, ou cria um. */
export const shared = (client: RestClient, timeoutMs?: number): SharedClient =>
  client instanceof SharedClient ? client : new SharedClient(client, timeoutMs !== undefined ? { timeoutMs } : {});
