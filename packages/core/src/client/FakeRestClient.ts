import type { HistoryResult, QueryRequest, QueryResult, RestClient } from './RestClient';
import type { Row } from '../types';

export type Responder = (req: QueryRequest) => QueryResult | Row[] | undefined | Promise<QueryResult | Row[] | undefined>;

/**
 * Cliente para testes: devolve fixtures por tabela. Cada tabela pode ter
 * uma lista fixa de linhas (filtrada de forma simplificada) ou uma função.
 * Tabelas sem fixture devolvem acesso negado, para o teste declarar tudo que usa.
 */
export class FakeRestClient implements RestClient {
  calls = 0;
  readonly log: QueryRequest[] = [];
  private tables = new Map<string, Responder>();
  private denied = new Set<string>();

  rows(table: string, rows: Row[]): this {
    this.tables.set(table, (req) => filterRows(rows, req.query).slice(0, req.limit));
    return this;
  }

  respond(table: string, fn: Responder): this {
    this.tables.set(table, fn);
    return this;
  }

  deny(table: string): this {
    this.denied.add(table);
    return this;
  }

  /** Histórico do formulário (só existe se o teste declarar, como num cliente sem esse endpoint). */
  history?: RestClient['history'];
  withHistory(h: HistoryResult | null): this {
    this.history = async () => h;
    return this;
  }

  async query(req: QueryRequest): Promise<QueryResult> {
    this.calls++;
    this.log.push(req);
    if (this.denied.has(req.table)) return { rows: [], status: 403, access: 'denied' };
    const fn = this.tables.get(req.table);
    if (!fn) return { rows: [], status: 403, access: 'denied' };
    const out = await fn(req);
    if (!out) return { rows: [], status: 200, access: 'empty' };
    if (Array.isArray(out)) return { rows: out, status: 200, access: out.length ? 'ok' : 'empty' };
    return out;
  }
}

/**
 * Avaliador mínimo de encoded query para fixtures: suporta =, !=, IN, LIKE, STARTSWITH, >=, <=,
 * ORDERBY (ignorado), ^ como AND, ^OR como OU e ^NQ como OU entre consultas. Suficiente para as consultas do motor.
 */
export function filterRows(rows: Row[], query: string): Row[] {
  const blocks = query.split('^NQ').map((q) => {
    // "a^ORb" junta b ao termo anterior como alternativa (a OU b).
    const groups: string[][] = [];
    for (const t of q.split('^').filter((t) => t && !t.startsWith('ORDERBY'))) {
      if (t.startsWith('OR') && groups.length) groups[groups.length - 1]!.push(t.slice(2));
      else groups.push([t]);
    }
    return groups;
  });
  return rows.filter((row) => blocks.some((groups) => groups.every((g) => g.some((t) => matchTerm(row, t)))));
}

function matchTerm(row: Row, term: string): boolean {
  let m: RegExpMatchArray | null;
  if ((m = term.match(/^([\w.]+)IN(.*)$/))) {
    const set = new Set(m[2]!.split(','));
    return set.has(row[m[1]!] ?? '');
  }
  if ((m = term.match(/^([\w.]+)STARTSWITH(.*)$/))) return (row[m[1]!] ?? '').startsWith(m[2]!);
  if ((m = term.match(/^([\w.]+)LIKE(.*)$/))) return (row[m[1]!] ?? '').includes(m[2]!);
  if ((m = term.match(/^([\w.]+)>=(.*)$/))) return (row[m[1]!] ?? '') >= m[2]!;
  if ((m = term.match(/^([\w.]+)<=(.*)$/))) return (row[m[1]!] ?? '') <= m[2]!;
  if ((m = term.match(/^([\w.]+)!=(.*)$/))) return (row[m[1]!] ?? '') !== m[2]!;
  if ((m = term.match(/^([\w.]+)=(.*)$/))) return (row[m[1]!] ?? '') === m[2]!;
  return true;
}
