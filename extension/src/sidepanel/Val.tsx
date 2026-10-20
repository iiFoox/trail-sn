/** Um valor como aparece no formulário; se for referência (sys_id), vira link para o registro. */
import { recordLink } from '../shared/instances';

const SYS_ID = /^[0-9a-f]{32}$/;

export function Val({ raw, text, refTable, origin, cls, empty = '—' }: { raw: string; text?: string; refTable?: string; origin?: string; cls?: string; empty?: string }) {
  const shown = raw ? text || raw : empty;
  const short = shown.length > 70 ? shown.slice(0, 67) + '…' : shown;
  if (raw && refTable && origin && SYS_ID.test(raw)) {
    return <a class={`vlink ${cls ?? ''}`} href={recordLink(origin, refTable, raw)} target="_blank" rel="noreferrer" title={shown} onClick={(e) => e.stopPropagation()}>{short}</a>;
  }
  return <span class={`${cls ?? ''} ${raw ? '' : 'nil'}`} title={shown}>{short}</span>;
}
