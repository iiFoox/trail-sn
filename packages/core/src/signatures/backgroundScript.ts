import { fact } from '../scoring';
import { evidence, type Signature } from './context';

/** Scripts - Background: transação /sys.scripts.do do mesmo usuário na janela (C5). */
export const backgroundScript: Signature = (ctx) => {
  const t = ctx.traces.transactions.find((x) => /^\/sys\.scripts\.do/.test(x.url ?? '') && x.sys_created_by === ctx.user);
  if (!t) return [];
  return [
    evidence('background_script', { name: 'Scripts - Background' }, [
      fact('trace_identifies_mechanism', 'syslog_transaction', 'transação /sys.scripts.do'),
      fact('execution_in_window', 'syslog_transaction', `executado às ${t.sys_created_on}`),
      fact('user_matches', 'syslog_transaction', `por ${t.sys_created_by}`),
    ], ['o código executado não fica registrado']),
  ];
};
