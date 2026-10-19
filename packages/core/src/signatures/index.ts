import type { Evidence } from '../types';
import { asyncBusinessRule } from './asyncBusinessRule';
import { backgroundScript } from './backgroundScript';
import type { ChangeContext } from './context';
import { flow, workflow } from './flowAndWorkflow';
import { importSet } from './importSet';
import { sameTransaction } from './sameTransaction';
import { scheduledJobWithTransaction, scheduledJobWithoutTransaction } from './scheduledJob';
import { scriptAction } from './scriptAction';
import { uiAction } from './uiAction';
import { unknownBackground } from './unknownBackground';

export * from './context';

/** Assinaturas que dependem de um rastro nomeado (job, evento, UI action, flow). */
const NAMED_TRACES = [asyncBusinessRule, scheduledJobWithTransaction, scriptAction, uiAction, backgroundScript, flow, workflow, importSet];

/**
 * Ordem de avaliação, igual à validada na Fase 0:
 *  1. rastros nomeados;
 *  2. sem transação do usuário na janela: jobs sem transação + processo desconhecido;
 *  3. sem nada: a mudança ocorreu na própria transação (BR after/SI, BR before, usuário).
 */
export function runSignatures(ctx: ChangeContext): Evidence[] {
  const out = NAMED_TRACES.flatMap((s) => s(ctx));
  // Só um rastro que nomeia o artefato encerra a busca; sinais fracos (ex.: script action genérica) não.
  // Rastro forte só conta se nada o desmente (passo do flow que não grava o campo, valor diferente, condição falsa).
  const ruledOut = (e: Evidence) => e.facts.some((f) => f.kind === 'no_step_writes_field' || f.kind === 'sets_other_value' || f.kind === 'condition_false');
  const strong = out.some((e) => !ruledOut(e) && e.facts.some((f) => f.kind === 'trace_names_artifact' || f.kind === 'trace_identifies_mechanism'));
  const anyUserTx = ctx.traces.transactions.some((t) => t.sys_created_by === ctx.user && !/^JOB: /.test(t.url ?? ''));
  const anySubmit = ctx.traces.transactions.some((t) => t.type === 'form' && (t.url ?? '').includes(`sys_uniqueValue=${ctx.sysId}`));
  if (!strong && !anyUserTx && !anySubmit) {
    out.push(...scheduledJobWithoutTransaction(ctx));
    if (!out.length) out.push(...unknownBackground(ctx));
    return out;
  }
  if (!strong) out.push(...sameTransaction(ctx));
  return out;
}
