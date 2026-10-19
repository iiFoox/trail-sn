export interface DiffLabels {
    onlyChanges: string;
    whole: string;
    same: string;
    added: string;
    removed: string;
    before: string;
    after: string;
}
/** Diferença entre dois textos: unificada (painel estreito) ou lado a lado (janela). */
export declare function DiffView({ oldText, newText, split, labels }: {
    oldText: string;
    newText: string;
    split?: boolean;
    labels: DiffLabels;
}): import("preact").JSX.Element;
