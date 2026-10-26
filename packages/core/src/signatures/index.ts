import type { Evidence } from '../types';
import { asyncBusinessRule } from './asyncBusinessRule';
import { backgroundScript } from './backgroundScript';
import { evidence, isSystemUser, type ChangeContext } from './context';
import { fact } from '../scoring';
import { isFormSubmitFor, isRecordWrite, toMs } from '../util';
import { flow, workflow } from './flowAndWorkflow';
import { importSet } from './importSet';
import { otherRecordRule } from './otherRecord';
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

/**
 * Contexto gravado na hora (app do Trail dentro da instância): diz, com certeza, se o campo chegou na requisição
 * ou foi mudado por uma regra do servidor nesta gravação, e de qual transação ou job veio. Ajusta as evidências.
 */
function applyRecorded(ctx: ChangeContext, out: Evidence[]): Evidence[] {
  const rows = (ctx.traces.recorded ?? []).filter((r) => (r.u_campos ?? '').split(',').includes(ctx.field) && Math.abs(toMs(r.sys_created_on ?? '') - toMs(ctx.at)) <= 2000);
  const r = rows[0];
  if (!r) return out;
  const server = (r.u_servidor ?? '').split(',').includes(ctx.field);
  const origin = r.u_origem ?? '';
  const tx = r.u_transacao ?? '';
  const serverKinds = new Set(['br_before', 'assignment_rule', 'data_lookup', 'br_via_script_include']);
  const ruled = (e: Evidence) => e.facts.some((f) => ['condition_false', 'sets_other_value', 'reads_only', 'not_referenced', 'no_step_writes_field'].includes(f.kind));
  for (const e of out) {
    // Fato positivo só para quem ainda está na disputa; uma regra com condição falsa não ganha pontos por isso.
    if (ruled(e)) continue;
    if (server) {
      if (e.type === 'user_action' || e.type === 'client_script' || e.type === 'ui_policy') e.facts.push(fact('recorded_contradicts', 'trail_context', 'o valor que chegou na requisição era outro: uma regra do servidor mudou o campo ao gravar'));
      else if (serverKinds.has(e.type)) e.facts.push(fact('recorded_context', 'trail_context', 'o contexto gravado na hora mostra que o servidor mudou o campo nesta gravação'));
    } else if (origin === 'api' || origin === 'form') {
      if (e.type === 'user_action' || e.type === 'client_script' || e.type === 'ui_policy') e.facts.push(fact('recorded_context', 'trail_context', `o campo chegou assim na requisição (${origin === 'api' ? 'API' : 'formulário'}, ${r.u_usuario ?? ''})`));
      else if (serverKinds.has(e.type)) e.facts.push(fact('recorded_contradicts', 'trail_context', 'o campo chegou assim na requisição: nenhuma regra do servidor o mudou'));
    } else if (origin === 'job') {
      if (e.type === 'scheduled_job' && tx && e.artifact.name === tx) e.facts.push(fact('recorded_context', 'trail_context', `gravado dentro do job "${tx}"`));
      else if (e.type === 'user_action') e.facts.push(fact('recorded_contradicts', 'trail_context', `gravado por um processo de fundo (${tx || 'sem sessão interativa'}), não por uma pessoa`));
    }
  }
  return out;
}

export function runSignatures(full: ChangeContext): Evidence[] {
  return applyRecorded(full, runSignaturesInner(full));
}

function runSignaturesInner(full: ChangeContext): Evidence[] {
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
  // Chamada da Table API no caminho do registro (/api/now/table/t/<sys_id>) pode ser só leitura (integração, outra extensão,
  // conferência): o syslog_transaction não registra o método. Só conta como gravação perto da mudança (no PDI, uma leitura
  // 12 s depois fazia o filho de uma cascata parecer gravado pela pessoa, e a regra do pai sumia).
  const nearChange = (t: { sys_created_on?: string; url?: string }) => isFormSubmitFor(t.url, ctx.sysId) || Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 5000;
  const anyUserTx = ctx.traces.transactions.some((t) => t.sys_created_by === ctx.user && !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, ctx.sysId) && nearChange(t))
    // Regras de atribuição e alguns motores gravam como "system" DENTRO da transação de outra pessoa no mesmo registro.
    || (isSystemUser(ctx.user) && ctx.traces.transactions.some((t) => !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, ctx.sysId) && Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 2000));
  const anySubmit = ctx.traces.transactions.some((t) => t.type === 'form' && isFormSubmitFor(t.url, ctx.sysId));
  if (!strong && !anyUserTx && !anySubmit) {
    // Gravação de outro registro no instante (pai que atualiza os filhos): a regra dele pode ter gravado aqui.
    out.push(...otherRecordRule(ctx));
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
    if (!out.some((e) => !ruledOut(e))) {
      // Sem leitura das transações (quem não é admin), a falta delas não prova nada: fica o autor da gravação,
      // com a lacuna dita, em vez de um "processo em segundo plano" que ninguém viu.
      if (ctx.txDenied) {
        const system = isSystemUser(ctx.user);
        out.push(evidence(system ? 'unknown_background' : 'user_action', { name: system ? '(automação)' : ctx.user },
          [fact('user_matches', 'sys_audit', `gravado em nome de ${ctx.user || 'system'}`)],
          ['seus papéis não leem as transações (syslog_transaction): não dá para confirmar se foi pelo formulário, pela API ou por uma regra']));
      } else out.push(...unknownBackground(ctx));
    }
    return out;
  }
  if (!strong) out.push(...sameTransaction(ctx));
  return out;
}
