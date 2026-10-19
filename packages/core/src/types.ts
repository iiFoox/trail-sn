/**
 * Tipos do motor. Identificadores em inglês; os rótulos em PT/EN ficam na interface.
 */

/** Linha devolvida pela Table API (sysparm_display_value=false). */
export type Row = Record<string, string>;

export interface Target {
  /** Tabela do registro (ex.: incident). */
  table: string;
  /** sys_id do registro; se ausente, usa `number`. */
  sysId?: string;
  /** Número do registro (INC0010001), para tabelas com campo number. */
  number?: string;
  /** Campo investigado. */
  field: string;
}

export interface InvestigationOptions {
  /** Segundos antes da mudança incluídos na janela de rastros. */
  windowBefore: number;
  /** Segundos depois da mudança incluídos na janela de rastros. */
  windowAfter: number;
  /** Quantas mudanças recentes do campo analisar. */
  maxChanges: number;
  /** Tempo máximo por fonte, em ms; estourou vira lacuna, não erro. */
  sourceTimeoutMs: number;
}

export const DEFAULT_OPTIONS: InvestigationOptions = {
  windowBefore: 3,
  windowAfter: 15,
  maxChanges: 10,
  sourceTimeoutMs: 3000,
};

export type Grade = 'confirmed' | 'probable' | 'candidate';

export type EvidenceType =
  | 'br_async'
  | 'br_before'
  | 'br_after'
  | 'br_via_script_include'
  | 'script_action'
  | 'ui_action'
  | 'scheduled_job'
  | 'flow'
  | 'workflow'
  | 'background_script'
  | 'user_action'
  | 'server_change'
  | 'unknown_background';

/** Fato verificável que soma pontos. `kind` indexa o peso em scoring.ts. */
export type FactKind =
  | 'trace_names_artifact'
  | 'execution_in_window'
  | 'references_field'
  | 'references_table'
  | 'user_matches'
  | 'form_value_differs'
  | 'form_value_equals'
  | 'new_checkpoint_same_second'
  | 'trace_identifies_mechanism'
  | 'job_schedule_matches'
  | 'no_user_transaction'
  | 'condition_true'
  | 'tie_with_same_type';

export interface Fact {
  kind: FactKind;
  /** Fonte do fato (tabela consultada). */
  source: string;
  /** Descrição curta e verificável, ex.: "transação JOB: ASYNC às 01:37:02". */
  detail: string;
  points: number;
}

export interface Artifact {
  name: string;
  sysId?: string;
  table?: string;
}

export interface Evidence {
  type: EvidenceType;
  artifact: Artifact;
  grade: Grade;
  score: number;
  facts: Fact[];
  /** O que não pôde ser verificado (falta de acesso ou de dados). */
  gaps: string[];
}

export interface Change {
  /** Instante da auditoria, UTC, "YYYY-MM-DD HH:mm:ss". */
  at: string;
  oldValue: string;
  newValue: string;
  user: string;
  checkpoint: number;
  evidence: Evidence[];
}

export interface UnauditedUpdates {
  count: number;
  lastUpdatedOn: string;
  lastUpdatedBy: string;
  clues: string[];
}

export type AccessState = 'ok' | 'denied' | 'empty' | 'no_filter' | 'timeout' | 'unknown';

export interface StaticSuspects {
  businessRules: { name: string; sysId: string; when: string; order: string; table: string }[];
  viaScriptInclude: { businessRule: string; scriptInclude: string; scriptIncludeSysId: string }[];
  scriptIncludes: { name: string; sysId: string }[];
}

export interface Investigation {
  target: Target & { sysId: string; display: string };
  tables: string[];
  changes: Change[];
  unaudited: UnauditedUpdates | null;
  suspects: StaticSuspects;
  access: Record<string, AccessState>;
  /** Fontes negadas ou vazias que limitam o resultado, por nome técnico. */
  gaps: string[];
  timing: { totalMs: number; calls: number };
}

export class RecordNotFoundError extends Error {
  constructor(public readonly target: Target) {
    super('Record not found or not readable');
    this.name = 'RecordNotFoundError';
  }
}
