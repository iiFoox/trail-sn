/**
 * O padrão único de seção recolhível do painel (details/summary): título, resumo curto, contagem à direita e uma
 * seta à esquerda que gira (▸/▾). Regra: lista com mais de um item começa recolhida; com um item só (ou nenhum) começa aberta.
 *  - nível 1 (`box`): uma caixa inteira ("Quem depende · 11");
 *  - nível 2 (`nested`): um grupo dentro de uma caixa ("No navegador · 3").
 * A abertura é animada no CSS (`.fold2`), respeitando prefers-reduced-motion e a preferência de animações.
 */
import type { ComponentChildren } from 'preact';

/** Começa aberta? Só quando há no máximo um item (sem contagem ainda, enquanto carrega: fechada). */
export const startsOpen = (count: number | undefined) => count !== undefined && count <= 1;

export function Fold({ title, hint, count, badge, icon, nested = false, open, cls = '', warn = false, pill = '', id, onToggle, children }: {
  title: ComponentChildren; hint?: ComponentChildren; count?: number; badge?: ComponentChildren; icon?: ComponentChildren;
  nested?: boolean; open?: boolean; cls?: string; warn?: boolean; pill?: string; id?: string;
  /** Avisa quando a pessoa abre ou fecha (para carregar o conteúdo só ao abrir). */ onToggle?: (open: boolean) => void; children?: ComponentChildren;
}) {
  const isOpen = open ?? startsOpen(count);
  const toggle = onToggle ? (e: Event) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined;
  // Seta à esquerda (▸ fechada, ▾ aberta): não confunde com o › das linhas que navegam.
  const caret = <span class="caret" aria-hidden="true" />;
  if (nested) {
    return (
      <details class={`grp fold2 ${cls}`} open={isOpen} data-count={count} id={id} onToggle={toggle}>
        <summary>{caret}{icon && <span class="ic sm">{icon}</span>}<b class="grow">{title}{hint && <span class="why">{hint}</span>}</b>{badge}{count !== undefined && <i class="cnt">{count}</i>}</summary>
        {children}
      </details>
    );
  }
  return (
    <details class={`box fold fold2 ${cls}`} open={isOpen} data-count={count} id={id} onToggle={toggle}>
      <summary><h4 class={warn ? 'warnh' : ''}>{caret}<span class="grow">{title}{hint && <span class="why">{hint}</span>}</span>{badge}{count !== undefined && <span class={`pill cnt ${pill}`}>{count}</span>}</h4></summary>
      {children}
    </details>
  );
}

/** "?" com a explicação no lugar do subtítulo: aparece ao passar o mouse, ao focar (teclado) ou ao tocar. */
export function Help({ text }: { text: string }) {
  return <span class="help" role="img" tabIndex={0} title={text} aria-label={text}>?</span>;
}
