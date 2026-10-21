import type { AccessReport, BatchItem, Investigation, Target } from '@trail/core';

/** Contexto que o page/ e o content/ extraem da página. Nenhum dado de negócio, só endereço. */
export interface PageContext {
  origin: string;
  table?: string;
  sysId?: string;
  /** X-UserToken da sessão, quando a página expõe window.g_ck. */
  token?: string;
  userName?: string;
  /** Idioma da sessão do ServiceNow, vindo do mundo MAIN. */
  language?: string;
  /** Fuso do usuário no ServiceNow (IANA), vindo do mundo MAIN. */
  timeZone?: string;
  surface: 'ui16' | 'workspace' | 'portal' | 'unknown';
}

export type Message =
  | { type: 'context'; ctx: PageContext }
  | { type: 'investigate'; origin: string; target: Target; token?: string; language?: string; mode?: import('./prefs').PanelMode }
  | { type: 'toggle-icons' }
  | { type: 'timeline'; origin: string; target: { table: string; sysId: string }; language?: string }
  | { type: 'scan-conflicts'; origin: string; table: string }
  | { type: 'batch'; origin: string; table: string; field: string; sysIds: string[]; token?: string; language?: string; mode?: import('./prefs').PanelMode }
  | { type: 'record'; origin: string; table: string; record: string; token?: string; language?: string; mode?: import('./prefs').PanelMode }
  | { type: 'field-map'; origin: string; table: string; field: string }
  | { type: 'flows'; origin: string; table: string; sysId: string }
  | { type: 'automations'; origin: string; table: string; sysId: string }
  | { type: 'preview'; origin: string; target: { table: string; sysId: string; field: string; value: string }; language?: string }
  | { type: 'field-state'; origin: string; target: { table: string; sysId: string; field: string }; observed?: import('@trail/core').FieldObserved; language?: string }
  | { type: 'field-states'; origin: string; table: string; sysId: string; fields: { field: string; observed?: import('@trail/core').FieldObserved }[]; language?: string }
  | { type: 'open-panel'; mode?: import('./prefs').PanelMode }
  | { type: 'float-get' }
  | { type: 'float-set'; open: boolean; min?: boolean }
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
  batch?: { table: string; field: string; items: BatchItem[]; status: 'running' | 'done'; startedAt: string; ms?: number; error?: string;
    /** 'fields': o registro inteiro (cada item é um campo); padrão: vários registros, um campo. */
    kind?: 'records' | 'fields'; sysId?: string; display?: string };
}

/** Chaves do chrome.storage.session. */
export const storageKey = {
  tab: (tabId: number) => `tab:${tabId}`,
  meta: (origin: string, table: string) => `meta:${origin}:${table}`,
  access: (origin: string) => `access:${origin}`,
  token: (origin: string) => `token:${origin}`,
  language: (origin: string) => `language:${origin}`,
  timeZone: (origin: string) => `tz:${origin}`,
  probe: (origin: string) => `probe:${origin}`,
};

/** sys_documentation usa `pb` para português brasileiro. */
export function normalizeInstanceLanguage(value: unknown): string {
  if (typeof value !== 'string') return 'en';
  const code = value.trim().toLowerCase().replace('_', '-');
  if (code === 'pb' || code === 'pt' || code === 'pt-br') return 'pb';
  const base = code.split('-')[0] ?? '';
  return /^[a-z]{2}$/.test(base) ? base : 'en';
}

export function send<T = unknown>(msg: Message): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

/** Estado de um campo lido do g_form (mundo MAIN), com o rótulo do formulário. */
export interface ObservedField { field: string; label?: string; onForm?: boolean; readOnly?: boolean; mandatory?: boolean; visible?: boolean }

/** Pergunta à aba (content → mundo MAIN) o estado de um campo ou de todos. Sem g_form (Workspace) volta undefined. */
export async function askForm<T>(tabId: number | undefined, msg: { type: 'trail-field-state'; field: string; table?: string; sysId?: string } | { type: 'trail-form-states'; table?: string; sysId?: string }): Promise<T | undefined> {
  if (tabId === undefined || !chrome.tabs?.sendMessage) return undefined;
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500));
  return Promise.race([chrome.tabs.sendMessage(tabId, msg).then((x) => (x ?? undefined) as T | undefined, () => undefined), timeout]);
}
