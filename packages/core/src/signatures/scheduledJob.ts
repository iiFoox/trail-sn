import { fact } from '../scoring';
import { refsField, timeOfDayDiffMs, toMs } from '../util';
import { scriptFacts } from './scriptFacts';
import { evidence, isSystemUser, type Signature } from './context';

/** Job agendado com transação "JOB: <nome>" na janela (C5b). */
export const scheduledJobWithTransaction: Signature = (ctx) => {
  const out = [];
  const jobTx = ctx.traces.transactions.filter((t) => /^JOB: /.test(t.url ?? '') && !/^JOB: ASYNC: /.test(t.url ?? ''));
  for (const job of ctx.traces.jobsByName) {
    const tx = jobTx.find((t) => (t.url ?? '').slice(5).trim() === job.name);
    if (!tx) continue;
    const facts = [fact('trace_names_artifact', 'syslog_transaction', `transação JOB "${job.name}" às ${tx.sys_created_on}`)];
    if (refsField(job.script, ctx.field)) facts.push(fact('references_field', 'sysauto_script', `o script referencia "${ctx.field}"`), ...scriptFacts(ctx, job.script, 'sysauto_script', { mode: 'trigger' }));
    if ((job.script ?? '').includes(ctx.table)) facts.push(fact('references_table', 'sysauto_script', `o script cita "${ctx.table}"`));
    out.push(evidence('scheduled_job', { name: job.name ?? '?', sysId: job.sys_id, table: 'sysauto_script' }, facts));
  }
  return out;
};

/**
 * Job agendado sem transação (achado da Fase 0: alguns jobs não geram syslog_transaction
 * nem deixam sys_trigger). Só roda quando não houve transação do usuário na janela.
 */
export const scheduledJobWithoutTransaction: Signature = (ctx) => {
  const out = [];
  for (const job of ctx.traces.jobsByScript) {
    if (!refsField(job.script, ctx.field)) continue;
    const runAs = job['run_as.user_name'] ?? '';
    const startMatches = !!job.run_start && Math.abs(toMs(job.run_start) - toMs(ctx.at)) <= 3000;
    const dailyMatches = !!job.run_time && timeOfDayDiffMs(job.run_time, ctx.at) <= 5000;
    const facts = [
      fact('references_field', 'sysauto_script', `o script referencia "${ctx.field}"`),
      fact('references_table', 'sysauto_script', `o script cita "${ctx.table}"`),
    ];
    if (startMatches || dailyMatches) {
      facts.push(fact('job_schedule_matches', 'sysauto_script', `horário programado (${job.run_start || job.run_time}) coincide com a mudança`));
    }
    if (runAs && (runAs === ctx.user || isSystemUser(ctx.user))) {
      facts.push(fact('user_matches', 'sysauto_script', `executa como "${runAs || 'system'}"`));
    }
    const gaps = startMatches || dailyMatches ? [] : ['horário do job não confirmado'];
    out.push(evidence('scheduled_job', { name: job.name ?? '?', sysId: job.sys_id, table: 'sysauto_script' }, facts, gaps));
  }
  return out;
};
