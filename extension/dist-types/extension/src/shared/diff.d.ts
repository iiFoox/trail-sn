/**
 * Diferença linha a linha entre dois textos (scripts, descrições longas), sem dependências.
 * LCS clássico por linha; acima de ~4 milhões de células cai para um corte por prefixo/sufixo comum,
 * que ainda mostra o trecho alterado de forma honesta.
 */
export type Op = {
    t: 'eq' | 'del' | 'add';
    text: string;
    a?: number;
    b?: number; /** trecho alterado dentro da linha, para destacar */
    mark?: [number, number];
};
export interface Diff {
    ops: Op[];
    added: number;
    removed: number;
}
export declare function looksLong(a: string, b: string): boolean;
export declare function diffLines(oldText: string, newText: string): Diff;
/** Agrupa em trechos com algumas linhas de contexto; o resto vira "N linhas iguais". */
export type Hunk = {
    kind: 'ops';
    ops: Op[];
} | {
    kind: 'gap';
    count: number;
    from: number;
};
export declare function hunks(ops: Op[], context?: number): Hunk[];
