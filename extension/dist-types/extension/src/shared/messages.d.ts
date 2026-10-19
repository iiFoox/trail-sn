import type { AccessReport, Investigation, Target } from '@trail/core';
/** Contexto que o page/ e o content/ extraem da página. Nenhum dado de negócio, só endereço. */
export interface PageContext {
    origin: string;
    table?: string;
    sysId?: string;
    /** X-UserToken da sessão, quando a página expõe window.g_ck. */
    token?: string;
    userName?: string;
    surface: 'ui16' | 'workspace' | 'unknown';
}
export type Message = {
    type: 'context';
    ctx: PageContext;
} | {
    type: 'investigate';
    origin: string;
    target: Target;
    token?: string;
} | {
    type: 'open-panel';
} | {
    type: 'probe-auth';
    origin: string;
} | {
    type: 'check-access';
    origin: string;
} | {
    type: 'activate';
    origin: string;
} | {
    type: 'deactivate';
    origin: string;
} | {
    type: 'clear-cache';
    origin: string;
};
export interface ProbeResult {
    origin: string;
    checkedAt: string;
    tokenSource: 'page' | 'html' | 'none';
    steps: {
        label: string;
        status: number | string;
        ok: boolean;
        detail?: string;
    }[];
    conclusion: string;
}
export interface TabState {
    tabId: number;
    ctx?: PageContext;
    status: 'idle' | 'running' | 'done' | 'error';
    startedAt?: string;
    result?: Investigation;
    error?: string;
    access?: AccessReport;
}
/** Chaves do chrome.storage.session. */
export declare const storageKey: {
    tab: (tabId: number) => string;
    meta: (origin: string, table: string) => string;
    access: (origin: string) => string;
    token: (origin: string) => string;
    probe: (origin: string) => string;
};
export declare function send<T = unknown>(msg: Message): Promise<T>;
