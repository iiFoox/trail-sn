/** Aviso de fontes que não responderam (prazo, 5xx, página de login): o resultado ao lado pode estar incompleto. */
import { fmt, t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';

const P = t(getPrefs().lang).p;

export function Missing({ sources }: { sources?: string[] | undefined }) {
  if (!sources?.length) return null;
  return (
    <div class="notice small">
      <div class="title">{P.missingTitle}</div>
      <div>{fmt(P.missingHint, { sources: sources.join(', ') })}</div>
    </div>
  );
}
