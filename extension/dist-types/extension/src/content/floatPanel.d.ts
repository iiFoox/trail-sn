export declare function setFloatTheme(theme: 'dark' | 'light'): void;
export declare function isFloatOpen(): boolean;
export declare function openFloat(tabId: number, opts?: {
    theme?: 'dark' | 'light';
    minimized?: boolean;
}): void;
export declare function toggleFloat(tabId: number, theme?: 'dark' | 'light'): void;
export declare function closeFloat(persist?: boolean): void;
/** Abrir de novo ou investigar outra coisa com o painel minimizado: ele volta a aparecer. */
export declare function showFloat(tabId: number, theme?: 'dark' | 'light'): void;
