/**
 * Resultado da investigação em quatro abas: Resposta, Rastro, Provas e Histórico.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 * Princípio: a resposta primeiro, em linguagem de gente; o detalhe técnico continua lá, um clique abaixo.
 */
import type { AccessReport, Change, Investigation, TraceItem } from '@trail/core';
/** Link para o passo na instância: o registro pelo sys_id ou a lista já filtrada. */
export declare function refLink(origin: string, ref: {
    table: string;
    sysId?: string;
    query?: string;
}): string;
export declare function humanField(f: string): string;
export declare function parts(utc: string): {
    date: string;
    time: string;
    full: string;
    rel: string;
};
export declare function when(utc: string): string;
export declare function valueLabel(r: Investigation, v: string): string;
export declare const plural: (forms: string[], n: number) => string;
/** O motor escreve horários em UTC; o painel mostra tudo no fuso de quem lê. */
export declare function localizeTimes(text: string, dayUtc: string): string;
export declare function factText(kind: string, field: string): string;
export declare function Result({ r, origin, access, toast, onField }: {
    r: Investigation;
    origin: string;
    access?: AccessReport;
    toast: (m: string) => void;
    onField: (field: string) => void;
}): import("preact").JSX.Element;
export declare function traceTitle(r: Investigation, c: Change, it: TraceItem, field: string): string;
