/**
 * Mensagens de erro técnicas (do motor, do fetch ou do próprio navegador, quase sempre em inglês) viram um texto
 * simples do i18n. A mensagem original não se perde: o painel mostra em "Detalhes técnicos".
 */
import { t } from './i18n';
import type { Lang } from './prefs';

export type ErrorKind = 'emptyRef' | 'notFound' | 'unavailable' | 'offline' | 'reloaded' | 'session' | 'other';

const RULES: [ErrorKind, RegExp][] = [
  // Dot-walking por uma referência em branco (EmptyReferenceError do motor): não há outro registro para investigar.
  ['emptyRef', /^Empty reference/],
  // Antes de "not found": "Record unavailable" (RecordUnavailableError do motor) é falta de resposta, não ausência.
  ['unavailable', /record unavailable|timeout|timed out|abort|HTTP 5\d\d|\b(500|502|503|504)\b|service unavailable|internal server error/i],
  ['reloaded', /receiving end does not exist|extension context invalidated|could not establish connection|message port closed/i],
  ['offline', /failed to fetch|networkerror|network error|net::err|load failed|err_internet_disconnected/i],
  // 401: a sessão do ServiceNow acabou (403 continua sendo falta de permissão no registro).
  ['session', /\b401\b|unauthori[sz]ed/i],
  ['notFound', /record not found|not readable|not found|\b403\b/i],
];

export function errorKind(msg: string | undefined): ErrorKind {
  const m = msg ?? '';
  return RULES.find(([, re]) => re.test(m))?.[0] ?? 'other';
}

export function friendlyError(msg: string | undefined, lang: Lang): string {
  const s = t(lang);
  switch (errorKind(msg)) {
    case 'emptyRef': return s.errEmptyRef;
    case 'notFound': return s.errNotFound;
    case 'unavailable': return s.errUnavailable;
    case 'offline': return s.errOffline;
    case 'reloaded': return s.errReloaded;
    case 'session': return s.errSession;
    default: return s.errOther;
  }
}
