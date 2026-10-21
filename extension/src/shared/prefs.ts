/**
 * Preferências do usuário: tema, idioma e onde o painel abre.
 * Padrões decididos: escuro, idioma do navegador (português ou inglês), painel flutuante na página.
 *
 * As páginas da extensão (painel, popup, opções) compartilham a mesma origem, então o
 * localStorage serve de leitura síncrona no carregamento. O chrome.storage.sync guarda a
 * mesma coisa para o service worker e o content script, que não enxergam esse localStorage.
 * A URL (?theme=, ?lang=) sobrepõe tudo: é o que o site usa para mostrar o painel em demonstração.
 */
export type Theme = 'dark' | 'light' | 'system';
export type Lang = 'pt' | 'en';
/** float: painel dentro da própria página (padrão desde a 0.12); side: painel lateral do navegador; window: janela separada. */
export type PanelMode = 'float' | 'side' | 'window';
export interface Prefs { theme: Theme; lang: Lang; panelMode: PanelMode; showIcons: boolean; showBubble: boolean;
  /** Animações do painel, da bolinha e da página. */ motion: boolean;
  /** Atalho na página para abrir e fechar o painel (ex.: "Alt+Shift+P"); vazio desliga. */ panelKey: string; /** Versão da escolha do painel: antes da 0.12 'side' era o padrão gravado, não uma escolha. */ modeV?: number }

export const DEFAULT_PANEL_KEY = 'Alt+Shift+P';
export const DEFAULT_PREFS: Prefs = { theme: 'dark', lang: 'pt', panelMode: 'float', showIcons: true, showBubble: true, motion: true, panelKey: DEFAULT_PANEL_KEY, modeV: 2 };
const KEY = 'trail.prefs';
export const PREFS_KEY = KEY;

/**
 * Idioma do navegador, usado enquanto a pessoa não escolhe um: qualquer variante de português vira 'pt',
 * o resto vira 'en'. Sem nenhuma informação (fora do navegador), português.
 */
export function browserLang(): Lang {
  let l = '';
  try { l = (globalThis as { chrome?: typeof chrome }).chrome?.i18n?.getUILanguage?.() ?? ''; } catch { /* sem chrome.i18n */ }
  if (!l) { try { l = typeof navigator !== 'undefined' ? navigator.language ?? '' : ''; } catch { /* sem navigator */ } }
  if (!l) return 'pt';
  return l.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

function params(): URLSearchParams {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
}

function readLocal(): Partial<Prefs> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>; } catch { return {}; }
}

export function normalize(p: Partial<Prefs> | undefined): Prefs {
  return {
    theme: p?.theme === 'light' || p?.theme === 'system' ? p.theme : 'dark',
    // Sem idioma salvo, segue o navegador; quem já escolheu mantém a escolha.
    lang: p?.lang === 'en' || p?.lang === 'pt' ? p.lang : browserLang(),
    // 'side' gravado antes da 0.12 era só o padrão da época: quem não escolheu passa para o flutuante.
    panelMode: p?.panelMode === 'window' ? 'window' : p?.panelMode === 'side' && p.modeV === 2 ? 'side' : 'float',
    showIcons: p?.showIcons !== false,
    showBubble: p?.showBubble !== false,
    motion: p?.motion !== false,
    panelKey: typeof p?.panelKey === 'string' ? p.panelKey : DEFAULT_PANEL_KEY,
    modeV: 2,
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
async function loadRaw(): Promise<Partial<Prefs> | undefined> {
  const o = await chrome.storage.sync.get(KEY);
  return o[KEY] as Partial<Prefs> | undefined;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    return normalize(await loadRaw());
  } catch { return normalize(undefined); }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  // Parte do que está salvo no sync (vale para todas as páginas e o worker), não só do localStorage desta página.
  const stored = await loadRaw().catch(() => readLocal());
  const next = normalize({ ...stored, ...patch });
  // O idioma só é gravado quando a pessoa escolhe; enquanto não escolher, continua seguindo o navegador.
  const keep: Partial<Prefs> = { ...next };
  if (stored?.lang === undefined && patch.lang === undefined) delete keep.lang;
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* sem localStorage */ }
  try { await chrome.storage.sync.set({ [KEY]: keep }); } catch { /* demo fora da extensão */ }
  return next;
}

export function resolvedTheme(t: Theme): 'dark' | 'light' {
  if (t !== 'system') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Animações desligadas nas opções: a página ganha data-motion="off" e o CSS para tudo. */
export function applyMotion(on: boolean = getPrefs().motion): void {
  if (on) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = 'off';
}

/**
 * Atalho de teclado a partir de um evento, no formato "Ctrl+Alt+Shift+P". Sem Ctrl, Alt ou Meta não vale
 * (senão o atalho dispararia enquanto a pessoa digita); só modificadores ainda não formam atalho.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const code = e.code ?? '';
  const key = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : null;
  if (!key) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', key].filter(Boolean).join('+');
}

export function applyTheme(t: Theme = getPrefs().theme): void {
  const r = resolvedTheme(t);
  document.documentElement.dataset.theme = r;
  document.documentElement.style.colorScheme = r;
}

/** Aplica o tema já no carregamento e acompanha mudanças feitas em outra página da extensão. */
export function bootPage(): void {
  applyTheme();
  applyMotion();
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const before = document.documentElement.lang;
    applyTheme();
    applyMotion();
    if ((getPrefs().lang === 'en' ? 'en' : 'pt-BR') !== before) location.reload();
  });
  document.documentElement.lang = getPrefs().lang === 'en' ? 'en' : 'pt-BR';
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getPrefs().theme === 'system') applyTheme(); });
  } catch { /* navegador antigo */ }
}
