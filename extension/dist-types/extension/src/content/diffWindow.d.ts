/**
 * Janela "lado a lado" por cima da própria página do ServiceNow, no estilo de uma janela do macOS:
 * cantos arredondados, botões fechar / minimizar / maximizar, arrastar pela barra de título,
 * redimensionar pelo canto, duplo clique maximiza e Esc fecha. O conteúdo é a página de diferença
 * da extensão (src/diff) num iframe; o painel deixa o texto na sessão e passa só a chave.
 */
export interface DiffWindowRequest {
    key: string;
    title: string;
    sub?: string;
    theme?: 'dark' | 'light';
    from?: 'right' | 'left';
    labels?: {
        close: string;
        min: string;
        max: string;
    };
}
export declare function openDiffWindow(req: DiffWindowRequest): void;
