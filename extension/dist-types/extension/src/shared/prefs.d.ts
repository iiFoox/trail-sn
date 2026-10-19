/**
 * Preferências do usuário: tema, idioma e onde o painel abre.
 * Padrões decididos: escuro, português, painel lateral.
 *
 * As páginas da extensão (painel, popup, opções) compartilham a mesma origem, então o
 * localStorage serve de leitura síncrona no carregamento. O chrome.storage.sync guarda a
 * mesma coisa para o service worker e o content script, que não enxergam esse localStorage.
 * A URL (?theme=, ?lang=) sobrepõe tudo: é o que o site usa para mostrar o painel em demonstração.
 */
export type Theme = 'dark' | 'light' | 'system';
export type Lang = 'pt' | 'en';
export type PanelMode = 'side' | 'window';
export interface Prefs {
    theme: Theme;
    lang: Lang;
    panelMode: PanelMode;
}
export declare const DEFAULT_PREFS: Prefs;
export declare function normalize(p: Partial<Prefs> | undefined): Prefs;
/** Leitura síncrona para páginas da extensão. */
export declare function getPrefs(): Prefs;
/** Leitura assíncrona para o service worker e o content script. */
export declare function loadPrefs(): Promise<Prefs>;
export declare function savePrefs(patch: Partial<Prefs>): Promise<Prefs>;
export declare function resolvedTheme(t: Theme): 'dark' | 'light';
export declare function applyTheme(t?: Theme): void;
/** Aplica o tema já no carregamento e acompanha mudanças feitas em outra página da extensão. */
export declare function bootPage(): void;
