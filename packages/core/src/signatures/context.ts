import type { Evidence, EvidenceType, Artifact, Fact, InvestigationOptions, Row } from '../types';

/** Metadados da tabela, carregados uma vez e cacheáveis por instância+tabela. */
export interface TableMeta {
  tables: string[];
  businessRules: Row[];
  /** BRs cujo script ou template referencia o campo. */
  brField: Row[];
  scriptIncludes: Row[];
  /** Script includes que referenciam o campo. */
  siField: Row[];
  /** Pares BR → script include quando a BR instancia um SI que escreve no campo. */
  brViaSi: { br: Row; si: Row }[];
}

/** Rastros de execução carregados para uma mudança. */
export interface Traces {
  transactions: Row[];
  events: Row[];
  /** Script actions dos eventos encontrados (por event_name). */
  scriptActions: Row[];
  flows: Row[];
  workflows: Row[];
  /** Jobs resolvidos a partir de transações "JOB: <nome>". */
  jobsByName: Row[];
  /** UI actions resolvidas a partir de sys_action=<sys_id> nas transações de formulário. */
  uiActions: Row[];
  /** Jobs que citam a tabela e o campo (só consultados quando não há transação do usuário). */
  jobsByScript: Row[];
}

export interface ChangeContext {
  table: string;
  field: string;
  sysId: string;
  /** Linha de sys_audit da mudança. */
  audit: Row;
  at: string;
  user: string;
  checkpoint: number;
  /** Auditoria agrupada por checkpoint, para detectar atualizações encadeadas. */
  checkpoints: Record<string, Row[]>;
  meta: TableMeta;
  traces: Traces;
  opts: InvestigationOptions;
}

/** Uma assinatura recebe os dados carregados e devolve evidências. Nunca faz chamada própria. */
export type Signature = (ctx: ChangeContext) => Evidence[];

export function evidence(type: EvidenceType, artifact: Artifact, facts: Fact[], gaps: string[] = []): Evidence {
  return { type, artifact, facts, gaps, grade: 'candidate', score: 0 };
}

export const isSystemUser = (u: string): boolean => !u || u === 'system' || u === 'guest';
