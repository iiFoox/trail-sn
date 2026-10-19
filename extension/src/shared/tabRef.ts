/** Aba da instância que o painel está acompanhando (para abrir a janela "lado a lado" por cima dela). */
let tab: number | undefined;
export const setTrackedTab = (id: number | undefined): void => { tab = id; };
export const trackedTab = (): number | undefined => tab;
