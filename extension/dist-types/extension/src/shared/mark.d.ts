/**
 * Marca do Trail em SVG puro (sem Preact), para os scripts que rodam dentro do ServiceNow.
 * Mesmo desenho do ícone da loja e do site: anel com seta de volta no tempo e ponteiros.
 */
/** Traço único em uma cor (ícone ao lado do campo, em 10–16 px). */
export declare const TRAIL_GLYPH: (stroke?: string, width?: number) => string;
/** Versão colorida para fundo escuro (aviso, janela da diferença): arco verde e ponteiros brancos. */
export declare const TRAIL_MINI: (width?: number) => string;
/** Cores da marca. */
export declare const BRAND: {
    readonly navy: "#032d42";
    readonly ring: "#244f63";
    readonly green: "#62d84e";
};
