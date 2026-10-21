/** Erro em linguagem simples, com a mensagem técnica original recolhida em "Detalhes técnicos". */
import { friendlyError } from '../shared/errors';
import { t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';

const lang = getPrefs().lang;
const s = t(lang);

export function ErrorMsg({ msg, text }: { msg: string; text?: string }) {
  return (
    <span class="errmsg">
      {text ?? friendlyError(msg, lang)}
      {msg && <details class="captech"><summary>{s.errTech}</summary><code>{msg}</code></details>}
    </span>
  );
}
