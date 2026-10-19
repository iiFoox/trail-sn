/**
 * Resultado da investigação em quatro abas: Resposta, Rastro, Provas e Histórico.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 * Princípio: a resposta primeiro, em linguagem de gente; o detalhe técnico continua lá, um clique abaixo.
 */
import type { AccessReport, Investigation } from '@trail/core';
/** Link para o passo na instância: o registro pelo sys_id ou a lista já filtrada. */
export declare function refLink(origin: string, ref: {
    table: string;
    sysId?: string;
    query?: string;
}): string;
export declare function humanField(f: string): string;
export declare function Result({ r, origin, access, toast }: {
    r: Investigation;
    origin: string;
    access?: AccessReport;
    toast: (m: string) => void;
}): import("preact").JSX.Element;
