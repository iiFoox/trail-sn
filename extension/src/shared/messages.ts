import type { AccessReport, BatchItem, Investigation, Target } from '@trail/core';

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

export type Message =
  | { type: 'context'; ctx: PageContext }
  | { type: 'investigate'; origin: string; target: Target; token?: string; mode?: import('./prefs').PanelMode }
  | { type: 'toggle-icons' }
  | { type: 'timeline'; origin: string; target: { table: string; sysId: string } }
  | { type: 'scan-conflicts'; origin: string; table: string }
  | { type: 'batch'; origin: string; table: string; field: string; sysIds: string[]; token?: string; mode?: import('./prefs').PanelMode }
  | { type: 'field-map'; origin: string; table: string; field: string }
  | { type: 'preview'; origin: string; target: { table: string; sysId: string; field: string; value: string } }
  | { type: 'open-panel'; mode?: import('./prefs').PanelMode }
  | { type: 'probe-auth'; origin: string }
  | { type: 'check-access'; origin: string; force?: boolean }
  | { type: 'activate'; origin: string }
  | { type: 'deactivate'; origin: string }
  | { type: 'clear-cache'; origin: string }
  | { type: 'open-diff-popup'; key: string };

export interface ProbeResult {
  origin: string;
  checkedAt: string;
  tokenSource: 'page' | 'html' | 'none';
  steps: { label: string; status: number | string; ok: boolean; detail?: string }[];
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
  /** Investigação em lote (vários registros, um campo), iniciada pela lista. */
  batch?: { table: string; field: string; items: BatchItem[]; status: 'running' | 'done'; startedAt: string; ms?: number };
}

/** Chaves do chrome.storage.session. */
export const storageKey = {
  tab: (tabId: number) => `tab:${tabId}`,
  meta: (origin: string, table: string) => `meta:${origin}:${table}`,
  access: (origin: string) => `access:${origin}`,
  token: (origin: string) => `token:${origin}`,
  probe: (origin: string) => `probe:${origin}`,
};

export function send<T = unknown>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
