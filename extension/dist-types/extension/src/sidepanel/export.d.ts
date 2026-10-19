import type { Change, Investigation } from '@trail/core';
/** Uma frase sem termos técnicos sobre a mudança, para o usuário final (colar no chamado). */
export declare function plainSummary(r: Investigation, c: Change): string;
/** Relatório completo em texto puro, para colar no chamado: resposta, provas, lacunas, alternativas e rastro. */
export declare function fullReport(r: Investigation, c: Change, origin: string): string;
/** Abre a página de relatório numa janela; ela renderiza e chama a impressão (Salvar como PDF). */
export declare function savePdf(r: Investigation, sel: number, origin: string, demo: () => void): Promise<void>;
