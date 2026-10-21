import { TRAIL_GLYPH } from '../shared/mark';
/**
 * Content script (mundo isolado, all_frames). Orquestra a interface:
 *  - detecta o contexto (URL primeiro, depois o page/, DOM só para posicionar o ícone);
 *  - injeta o ícone "por que mudou?" ao lado dos rótulos dos campos no UI16;
 *  - encaminha pedidos ao service worker. Nunca consulta a instância diretamente.
 *
 * Convivência com o SN Utils: prefixo trail- em tudo, shadowRoot próprio, ícone depois dos badges.
 */
import { fmt, t } from '../shared/i18n';
import { loadPrefs, normalize, PREFS_KEY, resolvedTheme, type Prefs } from '../shared/prefs';
import type { PageContext } from '../shared/messages';
import { openDiffWindow, type DiffWindowRequest } from './diffWindow';
import { canShowAssistantMessage, disposeFloat, initAssistant, openFloat, setAssistantEnabled, setFloatTheme, showAssistantMessage, showFloat, toggleFloat } from './floatPanel';
// Se a cópia anterior ainda responde, ela solta observers e listeners antes desta assumir.
document.dispatchEvent(new Event('trail:dispose-content'));
for (const el of deepWalk(document)) {
  if (el.matches('.trail-host, #trail-float, #trail-assistant, #trail-notice, #trail-update-notice')) el.remove();
}
(window as unknown as { __trailContent?: boolean }).__trailContent = true; // o worker não injeta de novo onde já está

let disposed = false;
function contextAlive(): boolean {
  try {
    if (typeof chrome.runtime.getURL === 'function') return !!chrome.runtime.id && !!chrome.runtime.getURL('');
    return !('id' in chrome.runtime) || !!chrome.runtime.id; // stub dos testes de UI
  } catch { return false; }
}
function dispose(): void {
  if (disposed) return;
  disposed = true;
  mo.disconnect();
  clearInterval(livenessTimer);
  clearTimeout(wsTimer);
  document.removeEventListener('click', scheduleWorkspaceScan, true);
  document.removeEventListener('keydown', onShortcut, true);
  document.removeEventListener('trail:context', onPageContext);
  document.removeEventListener('trail:dispose-content', dispose);
  document.removeEventListener('trail:bubble-visible', welcome);
  try { chrome.storage?.onChanged?.removeListener(onPrefsChanged); } catch { /* contexto inválido */ }
  try { chrome.runtime?.onMessage?.removeListener(onRuntimeMessage); } catch { /* contexto inválido */ }
  disposeFloat();
  for (const h of hosts) h.remove();
  document.querySelectorAll('.trail-host, #trail-notice, #trail-update-notice').forEach((el) => el.remove());
  (window as unknown as { __trailContent?: boolean }).__trailContent = false;
}
function checkContext(): boolean {
  if (disposed) return false;
  if (contextAlive()) return true;
  dispose();
  return false;
}
const livenessTimer = window.setInterval(checkContext, 2000);
document.addEventListener('trail:dispose-content', dispose);

// Português até a preferência chegar do storage; os ícones criados depois já saem no idioma escolhido.
let strings = t('pt');
let panelMode: Prefs['panelMode'] | undefined;
let theme: 'dark' | 'light' = 'dark';
let showIcons = true;
const hosts = new Set<HTMLElement>();
const KEY_HINT = 'Alt+Shift+T';
void loadPrefs().then((p) => { if (!checkContext()) return; strings = t(p.lang); panelMode = p.panelMode; theme = resolvedTheme(p.theme); applyIcons(p.showIcons); void restoreFloat(p); }).catch(() => undefined);

// ---------- painel flutuante (só no quadro de cima) ----------
/** Recarregou a página com o painel aberto: ele volta no mesmo estado (aberto ou minimizado). */
async function restoreFloat(p: Prefs): Promise<void> {
  if (window !== window.top) return;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'float-get' }) as { tabId?: number; open?: boolean; min?: boolean } | undefined;
    if (!checkContext()) return;
    if (typeof r?.tabId !== 'number') return;
    if (r.open) openFloat(r.tabId, { theme, minimized: !!r.min && p.showBubble });
    await initAssistant(r.tabId, origin, p.showBubble, strings.bubbleTip);
    if (!checkContext()) return;
    if (p.showBubble && (!r.open || r.min)) welcome();
  } catch { /* worker indisponível */ }
}

// ---------- mostrar / esconder os ícones (atalho, popup ou opções) ----------
function applyIcons(on: boolean): void {
  showIcons = on;
  for (const h of hosts) { if (!h.isConnected) hosts.delete(h); else h.style.display = on ? 'inline-block' : 'none'; }
}
function onPrefsChanged(ch: { [key: string]: chrome.storage.StorageChange }, area: string): void {
  if (!checkContext()) return;
  if (area !== 'sync' || !ch[PREFS_KEY]) return;
  const before = normalize(ch[PREFS_KEY].oldValue as Partial<Prefs> | undefined);
  const after = normalize(ch[PREFS_KEY].newValue as Partial<Prefs> | undefined);
  panelMode = after.panelMode;
  theme = resolvedTheme(after.theme);
  setFloatTheme(theme);
  if (window === window.top) {
    setAssistantEnabled(after.showBubble);
    if (!before.showBubble && after.showBubble) welcome();
  }
  if (before.showIcons === after.showIcons) return;
  applyIcons(after.showIcons);
  if (window === window.top) showAssistantMessage(fmt(after.showIcons ? strings.iconsShown : strings.iconsHidden, { key: KEY_HINT }));
}
chrome.storage?.onChanged?.addListener(onPrefsChanged);

// Atalho dentro da própria página: funciona mesmo quando o navegador não registrou o comando da extensão
// (no Edge, Alt+Shift+T pode ficar sem atribuir se outra extensão ou o próprio navegador já usa).
function onShortcut(e: KeyboardEvent): void {
  if (!checkContext()) return;
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyT') return;
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'toggle-icons' }).catch(() => undefined);
}
document.addEventListener('keydown', onShortcut, true);

/** Boas-vindas uma vez para cada registro, quando a bolinha está visível. */
const welcomePending = new Set<string>();
function welcome(): void {
  if (window !== window.top || !ctx.table || !ctx.sysId || !chrome.storage?.local) return;
  const k = `welcomed:${origin}:${ctx.table}:${ctx.sysId}`;
  if (welcomePending.has(k)) return;
  welcomePending.add(k);
  const claim = async () => {
    if (!checkContext() || k !== `welcomed:${origin}:${ctx.table}:${ctx.sysId}` || !canShowAssistantMessage()) return false;
    const o = await chrome.storage.local.get(k);
    if (o[k] || !canShowAssistantMessage()) return false;
    await chrome.storage.local.set({ [k]: Date.now() });
    return true;
  };
  // A trava evita que duas abas abertas no mesmo registro mostrem a saudação juntas.
  const reserved = navigator.locks ? navigator.locks.request(k, claim) : claim();
  void reserved.then((ok) => {
    if (ok && checkContext() && k === `welcomed:${origin}:${ctx.table}:${ctx.sysId}`) showAssistantMessage(strings.bubbleWelcome, strings.welcomeTitle);
  }).catch(() => undefined).finally(() => welcomePending.delete(k));
}
const origin = location.origin;
document.addEventListener('trail:bubble-visible', welcome);

let ctx: PageContext = { origin, surface: 'unknown', ...contextFromUrl(location.href) };
let lastSent = '';

function contextFromUrl(href: string): Partial<PageContext> {
  try {
    const u = new URL(href);
    // Workspace: /now/sow/record/incident/<sys_id>  |  /now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D...
    let m = u.pathname.match(/\/now\/[^/]+\/record\/([a-z0-9_]+)\/([0-9a-f]{32})/);
    if (m) return { table: m[1], sysId: m[2], surface: 'workspace' };
    m = u.pathname.match(/\/now\/nav\/ui\/classic\/params\/target\/(.+)$/);
    if (m) return { ...contextFromUrl(`${u.origin}/${decodeURIComponent(m[1] ?? '')}`), surface: 'ui16' };
    // Service Portal / Employee Center: /sp?id=form&table=incident&sys_id=... (também /esc, /csm e outros portais)
    const pt = u.searchParams.get('table'), ps = u.searchParams.get('sys_id');
    if (u.searchParams.has('id') && pt && /^[a-z0-9_]+$/.test(pt) && ps && /^[0-9a-f]{32}$/.test(ps) && !/\.do$/.test(u.pathname)) return { table: pt, sysId: ps, surface: 'portal' };
    // UI16: /incident.do?sys_id=...
    m = u.pathname.match(/^\/([a-z0-9_]+)\.do$/);
    const sysId = u.searchParams.get('sys_id') ?? undefined;
    if (m && sysId && /^[0-9a-f]{32}$/.test(sysId)) return { table: m[1], sysId, surface: 'ui16' };
    if (m) return { table: m[1], surface: 'ui16' };
  } catch { /* ignore */ }
  return {};
}

function pushContext(): void {
  const json = JSON.stringify(ctx);
  if (json === lastSent) return;
  lastSent = json;
  chrome.runtime.sendMessage({ type: 'context', ctx }).catch(() => { /* service worker dormindo; tenta depois */ });
}

// ---------- page/ (mundo da página) ----------
// Declarado antes do listener: page.js pode responder ao request-context de forma síncrona.
const decorated = new WeakSet<Element>();

function onPageContext(e: Event): void {
  if (!checkContext()) return;
  const d = (e as CustomEvent<{ token?: string; userName?: string; language?: string; table?: string; sysId?: string }>).detail ?? {};
  ctx = {
    ...ctx,
    token: d.token ?? ctx.token,
    userName: d.userName ?? ctx.userName,
    language: d.language ?? ctx.language,
    table: ctx.table ?? d.table,
    sysId: ctx.sysId ?? d.sysId,
    surface: ctx.surface === 'unknown' && d.table ? 'ui16' : ctx.surface,
  };
  pushContext();
  decorateForm();
  welcome();
}
document.addEventListener('trail:context', onPageContext);
document.dispatchEvent(new CustomEvent('trail:request-context'));
pushContext();

// ---------- ícone nos campos (UI16) ----------

function decorateForm(): void {
  if (!checkContext()) return;
  if (!ctx.table || !ctx.sysId) return;
  // Campos comuns: for="incident.state". Referências (Caller, Service, Assignment group...): for="sys_display.incident.caller_id".
  // Somente leitura: "sys_readonly." na frente. Caixas de seleção: "ni.". Listas (watch list): "select_0incident.watch_list".
  // Sem tratar esses prefixos, as referências e as listas ficavam sem ícone (visto no PDI).
  const re = new RegExp(`^(?:sys_readonly\\.)?(?:sys_display\\.|ni\\.|select_0)?${ctx.table}\\.([a-z0-9_]+)$`);
  const labels = document.querySelectorAll<HTMLLabelElement>(`label[for*="${ctx.table}."]`);
  // Um ícone por campo (a caixa de seleção do Knowledge, por exemplo, tem dois rótulos).
  const done = new Set([...labels].filter((l) => decorated.has(l)).map((l) => l.getAttribute('for')?.match(re)?.[1] ?? ''));
  for (const label of labels) {
    if (decorated.has(label)) continue;
    const field = (label.getAttribute('for') ?? '').match(re)?.[1];
    if (!field || done.has(field)) continue;
    done.add(field);
    decorated.add(label);
    label.appendChild(makeIcon(field));
  }
}

function makeIcon(field: string, title?: string, onClick?: () => void): HTMLElement {
  const host = document.createElement('span');
  host.className = 'trail-host';
  host.style.cssText = `display:${showIcons ? 'inline-block' : 'none'};margin-left:5px;vertical-align:middle;line-height:0;`;
  hosts.add(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      button{all:unset;cursor:pointer;width:16px;height:16px;border-radius:50%;display:inline-grid;place-items:center;
             color:#6e7984;background:transparent;border:1px solid #c3cbd3;transition:all .12s ease;opacity:.7}
      button:hover,button:focus-visible{opacity:1;color:#62d84e;background:#032d42;border-color:#032d42;box-shadow:0 0 0 3px rgba(98,216,78,.22)}
      svg{width:12px;height:12px;display:block}
    </style>
    <button type="button" title="${title ?? `${strings.whyChanged} · ${field}`}" aria-label="${title ?? strings.whyChanged} (${field})">
      ${TRAIL_GLYPH('currentColor', 2.8)}
    </button>`;
  root.querySelector('button')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (onClick) onClick(); else investigate(field);
  });
  return host;
}

function investigate(field: string): void {
  if (!ctx.table || !ctx.sysId) return;
  chrome.runtime.sendMessage({
    type: 'investigate',
    origin,
    token: ctx.token,
    language: ctx.language,
    // O modo vai junto para o worker abrir o painel lateral sem esperar nada: o Edge perde o gesto do clique em qualquer await.
    ...(panelMode ? { mode: panelMode } : {}),
    target: { table: ctx.table, sysId: ctx.sysId, field },
  }).catch(() => { /* noop */ });
}

// ---------- ícone nos campos do Service Portal / Employee Center (widget de formulário) ----------
function decoratePortal(): void {
  if (!checkContext()) return;
  if (!ctx.table || !ctx.sysId || ctx.surface !== 'portal') return;
  for (const span of document.querySelectorAll<HTMLElement>('span[id^="sp_field_label_"]')) {
    if (decorated.has(span)) continue;
    const field = span.id.slice('sp_field_label_'.length);
    if (!/^[a-z0-9_]+$/.test(field)) continue;
    decorated.add(span);
    span.after(makeIcon(field));
  }
}

// ---------- ícone nas colunas da lista (UI16): investigação em lote ----------
function listTable(): string | undefined {
  const g = document.querySelector('table.list_table[glide_table], [glide_table]')?.getAttribute('glide_table');
  if (g) return g;
  return location.pathname.match(/^\/([a-z0-9_]+)_list\.do$/)?.[1];
}

function decorateList(): void {
  if (!checkContext()) return;
  const table = listTable();
  if (!table || !/_list\.do$/.test(location.pathname)) return;
  for (const th of document.querySelectorAll<HTMLElement>('th.list_header_cell[name]')) {
    if (decorated.has(th)) continue;
    const field = th.getAttribute('name') ?? '';
    if (!/^[a-z0-9_]+$/.test(field)) continue;
    decorated.add(th);
    const icon = makeIcon(field, strings.p.btIcon as string, () => batch(table, field));
    (th.querySelector('.column_head, a') ?? th).after(icon);
  }
}

function batch(table: string, field: string): void {
  const checked = [...document.querySelectorAll<HTMLInputElement>(`input[id^="check_${table}_"]:checked`)].map((c) => c.id.slice(`check_${table}_`.length)).filter((x) => /^[0-9a-f]{32}$/.test(x));
  const ids = checked.length ? checked : [...document.querySelectorAll<HTMLElement>('tr.list_row[sys_id]')].map((r) => r.getAttribute('sys_id') ?? '').filter((x) => /^[0-9a-f]{32}$/.test(x));
  if (!ids.length) return;
  chrome.runtime.sendMessage({ type: 'batch', origin, table, field, sysIds: [...new Set(ids)], token: ctx.token, language: ctx.language, ...(panelMode ? { mode: panelMode } : {}) }).catch(() => { /* noop */ });
}

// ---------- ícone nos campos (Workspace / Next Experience) ----------
// Observado na SOW (Zurich): dentro de now-record-form-section-column-layout, cada campo é um
// componente sn-record-input-connected | now-record-typeahead(-multiple) | now-record-date-picker | ...
// com atributo name=<campo técnico>; o rótulo é um div.now-form-field-label no shadow root do componente.
const WS_FIELD = /^(sn|now)-record-/;

function* deepWalk(root: ParentNode, depth = 0): Generator<Element> {
  if (depth > 60) return;
  for (const el of root.querySelectorAll('*')) {
    yield el;
    if (el.shadowRoot) yield* deepWalk(el.shadowRoot, depth + 1);
  }
}

function decorateWorkspace(): void {
  if (!checkContext()) return;
  if (!ctx.table || !ctx.sysId || ctx.surface !== 'workspace') return;
  for (const el of deepWalk(document)) {
    if (!WS_FIELD.test(el.tagName.toLowerCase()) || decorated.has(el)) continue;
    const field = el.getAttribute('name') ?? '';
    if (!/^[a-z0-9_]+$/.test(field) || !el.shadowRoot) continue;
    const label = el.shadowRoot.querySelector('.now-form-field-label, label');
    if (!label) continue;
    decorated.add(el);
    label.appendChild(makeIcon(field));
  }
}

let wsTimer: number | undefined;
function scheduleWorkspaceScan(): void {
  if (!checkContext()) return;
  if (ctx.surface !== 'workspace') return;
  window.clearTimeout(wsTimer);
  wsTimer = window.setTimeout(decorateWorkspace, 800);
}
// Mudanças dentro de shadow roots não chegam ao MutationObserver do documento:
// varre após cliques (troca de aba "Details"), após navegação e algumas vezes no início.
document.addEventListener('click', scheduleWorkspaceScan, true);
for (const ms of [1500, 4000, 8000, 15000]) window.setTimeout(decorateWorkspace, ms);

// Reage a navegação dentro da página (Workspace é SPA) e a formulários que carregam depois.
const mo = new MutationObserver(() => {
  if (!checkContext()) return;
  const fromUrl = contextFromUrl(location.href);
  if (fromUrl.sysId && fromUrl.sysId !== ctx.sysId) {
    ctx = { ...ctx, ...fromUrl };
    pushContext();
    scheduleWorkspaceScan();
    welcome();
  }
  decorateForm();
  decorateList();
  decoratePortal();
});
mo.observe(document.documentElement, { childList: true, subtree: true });
decorateForm();
decorateList();
decoratePortal();

// Janela "lado a lado" pedida pelo painel: desenhada só no quadro de cima, por cima da página inteira.
function onRuntimeMessage(m: { type?: string; tabId?: number; origin?: string } & Partial<DiffWindowRequest>, _s: chrome.runtime.MessageSender, reply: (response?: unknown) => void): void {
  if (!checkContext()) return;
  if (m?.type === 'trail-dispose' && m.origin === origin) { reply({ ok: true }); dispose(); return; }
  if (m?.type === 'trail-ping' && window === window.top) { reply({ ok: true }); return; }
  if ((m?.type === 'float-open' || m?.type === 'float-toggle') && window === window.top && typeof m.tabId === 'number') {
    if (m.type === 'float-open') showFloat(m.tabId, theme); else toggleFloat(m.tabId, theme);
    reply({ ok: true });
    return;
  }
  if (m?.type !== 'diff-window' || window !== window.top || !m.key) return;
  openDiffWindow(m as DiffWindowRequest);
  reply({ ok: true });
}
chrome.runtime?.onMessage?.addListener(onRuntimeMessage);
// Gancho de teste (e2e): o mundo isolado do content script não é visível pela página.
(window as unknown as { __trailOpenDiff?: typeof openDiffWindow }).__trailOpenDiff = openDiffWindow;
(window as unknown as { __trailFloat?: unknown }).__trailFloat = { openFloat, showFloat, toggleFloat };
