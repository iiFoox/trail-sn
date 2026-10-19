import type { Evidence, Fact, FactKind, Grade } from './types';

/**
 * Pesos dos fatos. Versionados no código; calibrados pela bateria de regressão.
 * Reproduzem os 12 casos da Fase 0 (ver test/cases.test.ts).
 */
export const WEIGHTS: Record<FactKind, number> = {
  trace_names_artifact: 50,
  execution_in_window: 20,
  references_field: 20,
  references_table: 10,
  user_matches: 10,
  form_value_differs: 30,
  form_value_equals: 50,
  new_checkpoint_same_second: 20,
  trace_identifies_mechanism: 20,
  job_schedule_matches: 30,
  no_user_transaction: 10,
  condition_true: 15,
  tie_with_same_type: -15,
};

export const THRESHOLDS = { confirmed: 70, probable: 40 } as const;

export function fact(kind: FactKind, source: string, detail: string): Fact {
  return { kind, source, detail, points: WEIGHTS[kind] };
}

export function gradeFor(score: number): Grade {
  if (score >= THRESHOLDS.confirmed) return 'confirmed';
  if (score >= THRESHOLDS.probable) return 'probable';
  return 'candidate';
}

/**
 * Soma os pontos, aplica a penalidade de empate (mais de uma evidência do mesmo
 * tipo com a mesma pontuação bruta) e ordena da mais forte para a mais fraca.
 */
export function scoreAll(evidence: Evidence[]): Evidence[] {
  const raw = evidence.map((e) => ({ e, score: e.facts.reduce((s, f) => s + f.points, 0) }));
  const groups = new Map<string, typeof raw>();
  for (const r of raw) {
    const key = `${r.e.type}:${r.score}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      r.e.facts.push(fact('tie_with_same_type', 'scoring', `${group.length} candidatos do mesmo tipo com a mesma pontuação`));
      r.score += WEIGHTS.tie_with_same_type;
    }
  }
  for (const r of raw) {
    r.e.score = r.score;
    r.e.grade = gradeFor(r.score);
  }
  return raw.map((r) => r.e).sort((a, b) => b.score - a.score);
}
