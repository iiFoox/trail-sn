/**
 * O padrão único de seção recolhível do painel (details/summary): título, resumo curto, contagem à direita e uma
 * seta que gira. Regra: lista com mais de um item começa recolhida; com um item só (ou nenhum) começa aberta.
 *  - nível 1 (`box`): uma caixa inteira ("Quem depende · 11");
 *  - nível 2 (`nested`): um grupo dentro de uma caixa ("No navegador · 3").
 * A abertura é animada no CSS (`.fold2`), respeitando prefers-reduced-motion e a preferência de animações.
 */
import type { ComponentChildren } from 'preact';
import { Glyph } from '../shared/icons';

/** Começa aberta? Só quando há no máximo um item (sem contagem ainda, enquanto carrega: fechada). */
export const startsOpen = (count: number | undefined) => count !== undefined && count <= 1;

export function Fold({ title, hint, count, badge, icon, nested = false, open, cls = '', warn = false, pill = '', id, children }: {
  title: ComponentChildren; hint?: ComponentChildren; count?: number; badge?: ComponentChildren; icon?: ComponentChildren;
  nested?: boolean; open?: boolean; cls?: string; warn?: boolean; pill?: string; id?: string; children?: ComponentChildren;
}) {
  const isOpen = open ?? startsOpen(count);
  const chev = <span class="chev" aria-hidden="true">{Glyph.chevron}</span>;
  if (nested) {
    return (
      <details class={`grp fold2 ${cls}`} open={isOpen} data-count={count} id={id}>
        <summary>{icon && <span class="ic sm">{icon}</span>}<b class="grow">{title}{hint && <span class="why">{hint}</span>}</b>{badge}{count !== undefined && <i class="cnt">{count}</i>}{chev}</summary>
        {children}
      </details>
    );
  }
  return (
    <details class={`box fold fold2 ${cls}`} open={isOpen} data-count={count} id={id}>
      <summary><h4 class={warn ? 'warnh' : ''}><span class="grow">{title}{hint && <span class="why">{hint}</span>}</span>{badge}{count !== undefined && <span class={`pill cnt ${pill}`}>{count}</span>}{chev}</h4></summary>
      {children}
    </details>
  );
}
