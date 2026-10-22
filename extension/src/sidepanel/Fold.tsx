/**
 * O padrão único de seção recolhível do painel (details/summary): título, resumo curto, contagem à direita e uma
 * seta à esquerda que gira (▸/▾). Regra: toda lista ou bloco com itens começa recolhido (a única exceção do painel é a aba
 * Rastro, que não usa este componente); o cabeçalho mostra o título, um resumo de uma linha e a contagem à direita.
 *  - nível 1 (`box`): uma caixa inteira ("Quem depende · 11");
 *  - nível 2 (`nested`): um grupo dentro de uma caixa ("No navegador · 3").
 * A abertura é animada no CSS (`.fold2`), respeitando prefers-reduced-motion e a preferência de animações.
 */
import type { ComponentChildren } from 'preact';

/** Começa aberta? Nunca: tudo começa recolhido, com a contagem no cabeçalho. */
export const startsOpen = (_count?: number) => false;

export function Fold({ title, hint, count, countText, badge, icon, nested = false, open, cls = '', warn = false, pill = '', id, onToggle, children }: {
  title: ComponentChildren; hint?: ComponentChildren; count?: number; /** Texto da contagem no lugar do número (ex.: "3 campos"). */ countText?: string; badge?: ComponentChildren; icon?: ComponentChildren;
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
        <summary>{caret}{icon && <span class="ic sm">{icon}</span>}<b class="grow">{title}{hint && <span class="why">{hint}</span>}</b>{badge}{count !== undefined && <i class="cnt">{countText ?? count}</i>}</summary>
        {children}
      </details>
    );
  }
  return (
    <details class={`box fold fold2 ${cls}`} open={isOpen} data-count={count} id={id} onToggle={toggle}>
      <summary><h4 class={warn ? 'warnh' : ''}>{caret}<span class="grow">{title}{hint && <span class="why">{hint}</span>}</span>{badge}{count !== undefined && <span class={`pill cnt ${pill}`}>{countText ?? count}</span>}</h4></summary>
      {children}
    </details>
  );
}

/**
 * Cabeçalho no mesmo desenho do `Fold`, mas sem nada para abrir: a lista está vazia e o resumo já diz tudo
 * ("Nenhum flow rodou neste registro", "Todas as fontes foram lidas").
 */
export function FoldStatic({ title, hint, cls = '', warn = false, id }: { title: ComponentChildren; hint?: ComponentChildren; cls?: string; warn?: boolean; id?: string }) {
  return (
    <div class={`box fold-static ${cls}`} id={id}>
      <h4 class={warn ? 'warnh' : ''}><span class="caret-sp" aria-hidden="true" /><span class="grow">{title}{hint && <span class="why">{hint}</span>}</span></h4>
    </div>
  );
}

/** "?" com a explicação no lugar do subtítulo: aparece ao passar o mouse, ao focar (teclado) ou ao tocar. */
export function Help({ text }: { text: string }) {
  return <span class="help" role="img" tabIndex={0} title={text} aria-label={text}>?</span>;
}
