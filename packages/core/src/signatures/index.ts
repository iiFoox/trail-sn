import type { Evidence } from '../types';
import { asyncBusinessRule } from './asyncBusinessRule';
import { backgroundScript } from './backgroundScript';
import { isSystemUser, type ChangeContext } from './context';
import { isFormSubmitFor, isRecordWrite, toMs } from '../util';
import { flow, workflow } from './flowAndWorkflow';
import { importSet } from './importSet';
import { backgroundBefores, backgroundChain, batchWrite, listEdit, sameTransaction } from './sameTransaction';
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
/** BR que roda nesta operação? action_insert / action_update ausentes (cache antigo) contam como sim. */
const runsOn = (b: { action_insert?: string; action_update?: string }, op: 'insert' | 'update' | undefined) =>
  !op || (op === 'insert' ? b.action_insert !== 'false' : b.action_update !== 'false');

export function runSignatures(full: ChangeContext): Evidence[] {
  // Regras que não rodam nesta operação (ex.: só na criação, e a mudança foi uma atualização) saem da disputa.
  const op = full.operation;
  const ctx: ChangeContext = { ...full, meta: { ...full.meta,
    businessRules: full.meta.businessRules.filter((b) => runsOn(b, op)),
    brField: full.meta.brField.filter((b) => runsOn(b, op)),
    brViaSi: full.meta.brViaSi.filter((x) => runsOn(x.br, op)) } };
  const out = NAMED_TRACES.flatMap((s) => s(ctx));
  // Só um rastro que nomeia o artefato encerra a busca; sinais fracos (ex.: script action genérica) não.
  // Rastro forte só conta se nada o desmente (passo do flow que não grava o campo, valor diferente, condição falsa).
  const ruledOut = (e: Evidence) => e.facts.some((f) => f.kind === 'no_step_writes_field' || f.kind === 'sets_other_value' || f.kind === 'condition_false' || f.kind === 'reads_only' || f.kind === 'not_referenced');
  const strong = out.some((e) => !ruledOut(e) && e.facts.some((f) => f.kind === 'trace_names_artifact' || f.kind === 'trace_identifies_mechanism'));
  // Só transações DESTE registro: a mesma pessoa navegando em outras telas na hora não é uma gravação dela aqui.
  const anyUserTx = ctx.traces.transactions.some((t) => t.sys_created_by === ctx.user && !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, ctx.sysId))
    // Regras de atribuição e alguns motores gravam como "system" DENTRO da transação de outra pessoa no mesmo registro.
    || (isSystemUser(ctx.user) && ctx.traces.transactions.some((t) => !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, ctx.sysId) && Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 2000));
  const anySubmit = ctx.traces.transactions.some((t) => t.type === 'form' && isFormSubmitFor(t.url, ctx.sysId));
  if (!strong && !anyUserTx && !anySubmit) {
    out.push(...scheduledJobWithoutTransaction(ctx));
    // A gravação de fundo (script action, job, evento) também roda as BRs before: elas podem ter gravado este campo.
    out.push(...backgroundBefores(ctx));
    // Cadeia depois de uma gravação de fundo: BR after/async/SI que reagiu ao que o job ou o evento gravou.
    out.push(...backgroundChain(ctx));
    // Lote da Batch API da mesma pessoa no instante: a URL não diz o registro (a interface também usa lotes só para ler),
    // então só ganha força quando nenhuma automação explica a mudança.
    const explained = out.some((e) => !ruledOut(e) && e.facts.reduce((a, f) => a + f.points, 0) >= 40);
    const batch = batchWrite(ctx, explained);
    out.push(...batch, ...(batch.length ? [] : listEdit(ctx, explained)));
    if (!out.some((e) => !ruledOut(e))) out.push(...unknownBackground(ctx));
    return out;
  }
  if (!strong) out.push(...sameTransaction(ctx));
  return out;
}
