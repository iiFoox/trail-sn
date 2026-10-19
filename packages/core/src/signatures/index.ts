import type { Evidence } from '../types';
import { asyncBusinessRule } from './asyncBusinessRule';
import { backgroundScript } from './backgroundScript';
import type { ChangeContext } from './context';
import { flow, workflow } from './flowAndWorkflow';
import { sameTransaction } from './sameTransaction';
import { scheduledJobWithTransaction, scheduledJobWithoutTransaction } from './scheduledJob';
import { scriptAction } from './scriptAction';
import { uiAction } from './uiAction';
import { unknownBackground } from './unknownBackground';

export * from './context';

/** Assinaturas que dependem de um rastro nomeado (job, evento, UI action, flow). */
const NAMED_TRACES = [asyncBusinessRule, scheduledJobWithTransaction, scriptAction, uiAction, backgroundScript, flow, workflow];

/**
 * Ordem de avaliação, igual à validada na Fase 0:
 *  1. rastros nomeados;
 *  2. sem transação do usuário na janela: jobs sem transação + processo desconhecido;
 *  3. sem nada: a mudança ocorreu na própria transação (BR after/SI, BR before, usuário).
 */
export function runSignatures(ctx: ChangeContext): Evidence[] {
  const out = NAMED_TRACES.flatMap((s) => s(ctx));
  const anyUserTx = ctx.traces.transactions.some((t) => t.sys_created_by === ctx.user && !/^JOB: /.test(t.url ?? ''));
  if (!out.length && !anyUserTx) {
    out.push(...scheduledJobWithoutTransaction(ctx));
    if (!out.length) out.push(...unknownBackground(ctx));
    return out;
  }
  if (!out.length) out.push(...sameTransaction(ctx));
  return out;
}
