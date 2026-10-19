import { fact } from '../scoring';
import { evidence, type Signature } from './context';

/**
 * Nenhuma transação do usuário na janela e nenhuma outra evidência:
 * processo em segundo plano sem log (integração MID, importação, job sem transação).
 */
export const unknownBackground: Signature = (ctx) => [
  evidence('unknown_background', { name: '(desconhecido)' }, [
    fact('no_user_transaction', 'syslog_transaction', 'nenhuma transação do usuário na janela'),
  ], ['verificar jobs, integrações MID e importações do horário']),
];
