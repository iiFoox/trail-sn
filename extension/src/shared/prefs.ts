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
export interface Prefs { theme: Theme; lang: Lang; panelMode: PanelMode }

export const DEFAULT_PREFS: Prefs = { theme: 'dark', lang: 'pt', panelMode: 'side' };
const KEY = 'trail.prefs';

function params(): URLSearchParams {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}

function readLocal(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>; } catch { return {}; }
}

export function normalize(p: Partial<Prefs> | undefined): Prefs {
  return {
    theme: p?.theme === 'light' || p?.theme === 'system' ? p.theme : 'dark',
    lang: p?.lang === 'en' ? 'en' : 'pt',
    panelMode: p?.panelMode === 'window' ? 'window' : 'side',
  };
}

/** Leitura síncrona para páginas da extensão. */
export function getPrefs(): Prefs {
  const q = params();
  const base = normalize(readLocal());
  const theme = q.get('theme');
  const lang = q.get('lang');
  return normalize({ ...base, ...(theme ? { theme: theme as Theme } : {}), ...(lang ? { lang: lang as Lang } : {}) });
}

/** Leitura assíncrona para o service worker e o content script. */
export async function loadPrefs(): Promise<Prefs> {
  try {
    const o = await chrome.storage.sync.get(KEY);
    return normalize(o[KEY] as Partial<Prefs> | undefined);
  } catch { return DEFAULT_PREFS; }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = normalize({ ...normalize(readLocal()), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sem localStorage */ }
  try { await chrome.storage.sync.set({ [KEY]: next }); } catch { /* demo fora da extensão */ }
  return next;
}

export function resolvedTheme(t: Theme): 'dark' | 'light' {
  if (t !== 'system') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(t: Theme = getPrefs().theme): void {
  const r = resolvedTheme(t);
  document.documentElement.dataset.theme = r;
  document.documentElement.style.colorScheme = r;
}

/** Aplica o tema já no carregamento e acompanha mudanças feitas em outra página da extensão. */
export function bootPage(): void {
  applyTheme();
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const before = document.documentElement.lang;
    applyTheme();
    if ((getPrefs().lang === 'en' ? 'en' : 'pt-BR') !== before) location.reload();
  });
  document.documentElement.lang = getPrefs().lang === 'en' ? 'en' : 'pt-BR';
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getPrefs().theme === 'system') applyTheme(); });
  } catch { /* navegador antigo */ }
}
