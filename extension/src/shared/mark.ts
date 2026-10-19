/**
 * Marca do Trail em SVG puro (sem Preact), para os scripts que rodam dentro do ServiceNow.
 * Mesmo desenho do ícone da loja e do site: anel com seta de volta no tempo e ponteiros.
 */

/** Traço único em uma cor (ícone ao lado do campo, em 10–16 px). */
export const TRAIL_GLYPH = (stroke = 'currentColor', width = 2.6): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.9a7.1 7.1 0 1 1-6.8 5.1"/><path d="M3.4 7.5l1.9 2.8 2.8-1.7"/><path d="M12 8.3v4.1l2.6 1.7"/></svg>`;

/** Versão colorida para fundo escuro (aviso, janela da diferença): arco verde e ponteiros brancos. */
export const TRAIL_MINI = (width = 2.8): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.1" stroke="#244f63" stroke-width="${width}"/><path d="M12 4.9a7.1 7.1 0 1 1-6.8 5.1" stroke="#62d84e" stroke-width="${width}"/><path d="M3.4 7.5l1.9 2.8 2.8-1.7" stroke="#62d84e" stroke-width="${width - 0.4}"/><path d="M12 8.3v4.1l2.6 1.7" stroke="#fff" stroke-width="${width - 0.4}"/></svg>`;

/** Cores da marca. */
export const BRAND = { navy: '#032d42', ring: '#244f63', green: '#62d84e' } as const;
