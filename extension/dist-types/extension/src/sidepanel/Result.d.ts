/**
 * Resultado da investigação em quatro abas: Resposta, Rastro, Provas e Histórico.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 * Princípio: a resposta primeiro, em linguagem de gente; o detalhe técnico continua lá, um clique abaixo.
 */
import type { AccessReport, Change, Evidence, Investigation, TraceItem } from '@trail/core';
/** Link para o passo na instância: o registro pelo sys_id ou a lista já filtrada. */
export declare function refLink(origin: string, ref: {
    table: string;
    sysId?: string;
    query?: string;
}): string;
export declare function humanField(f: string): string;
/** O nome do campo como no formulário (business_service → Service); sem acesso ao dicionário, o técnico arrumado. */
export declare function fieldName(r: Investigation): string;
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
/** Regras ativas que gravam este campo com valores diferentes e podem rodar juntas. */
export declare function conflictLines(r: Investigation): {
    a: string;
    b: string;
    win: string;
    overlap: string;
    aLink?: string;
    bLink?: string;
}[];
/** Dias até a prova principal desta mudança expirar (só quando faltam menos de 30); null = não se aplica. */
export declare function traceDaysLeft(c: Change): number | null;
/** Por que este candidato perdeu, numa frase: o fato que mais pesou contra ele (ou "pontuação menor"). */
export declare function lossReason(e: Evidence, field: string): string;
