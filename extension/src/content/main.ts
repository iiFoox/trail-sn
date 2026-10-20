import { TRAIL_GLYPH, TRAIL_MINI } from '../shared/mark';
/**
 * Content script (mundo isolado, all_frames). Orquestra a interface:
 *  - detecta o contexto (URL primeiro, depois o page/, DOM só para posicionar o ícone);
 *  - injeta o ícone "por que mudou?" ao lado dos rótulos dos campos no UI16;
 *  - encaminha pedidos ao service worker. Nunca consulta a instância diretamente.
 *
 * Convivência com o SN Utils: prefixo trail- em tudo, shadowRoot próprio, ícone depois dos badges.
 */
import { fmt, t } from '../shared/i18n';
import { loadPrefs, normalize, PREFS_KEY, type Prefs } from '../shared/prefs';
import type { PageContext } from '../shared/messages';
import { openDiffWindow, type DiffWindowRequest } from './diffWindow';
(window as unknown as { __trailContent?: boolean }).__trailContent = true; // o worker não injeta de novo onde já está

// Português até a preferência chegar do storage; os ícones criados depois já saem no idioma escolhido.
let strings = t('pt');
let panelMode: 'side' | 'window' | undefined;
let showIcons = true;
const hosts = new Set<HTMLElement>();
const KEY_HINT = 'Alt+Shift+T';
void loadPrefs().then((p) => { strings = t(p.lang); panelMode = p.panelMode; applyIcons(p.showIcons); welcome(); }).catch(() => undefined);

// ---------- mostrar / esconder os ícones (atalho, popup ou opções) ----------
function applyIcons(on: boolean): void {
  showIcons = on;
  for (const h of hosts) { if (!h.isConnected) hosts.delete(h); else h.style.display = on ? 'inline-block' : 'none'; }
}
chrome.storage?.onChanged?.addListener((ch, area) => {
  if (area !== 'sync' || !ch[PREFS_KEY]) return;
  const before = normalize(ch[PREFS_KEY].oldValue as Partial<Prefs> | undefined);
  const after = normalize(ch[PREFS_KEY].newValue as Partial<Prefs> | undefined);
  panelMode = after.panelMode;
  if (before.showIcons === after.showIcons) return;
  applyIcons(after.showIcons);
  if (window === window.top) notice(fmt(after.showIcons ? strings.iconsShown : strings.iconsHidden, { key: KEY_HINT }));
});

// Atalho dentro da própria página: funciona mesmo quando o navegador não registrou o comando da extensão
// (no Edge, Alt+Shift+T pode ficar sem atribuir se outra extensão ou o próprio navegador já usa).
document.addEventListener('keydown', (e) => {
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyT') return;
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'toggle-icons' }).catch(() => undefined);
}, true);

// ---------- aviso discreto no canto da página (só no quadro de cima) ----------
function notice(text: string, title?: string, sticky = false): void {
  document.getElementById('trail-notice')?.remove();
  const host = document.createElement('div');
  host.id = 'trail-notice';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .b{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eef2;background:#16212a;border:1px solid #2a3a46;border-radius:14px;
         box-shadow:0 12px 32px rgba(0,0,0,.35);padding:12px 14px;max-width:340px;display:flex;gap:10px;align-items:flex-start;animation:in .18s ease-out}
      .m{flex:none;width:26px;height:26px;border-radius:50%;background:#032d42;display:grid;place-items:center}
      .m svg{width:15px;height:15px}
      b{display:block;margin-bottom:2px;color:#fff}
      kbd{font:11px ui-monospace,monospace;background:#22323d;border:1px solid #37485a;border-radius:5px;padding:0 5px}
      button{all:unset;cursor:pointer;margin-top:8px;font-weight:600;color:#5fd3c1}
      @keyframes in{from{opacity:0;transform:translateY(6px)}}
    </style>
    <div class="b" role="status"><span class="m">${TRAIL_MINI()}</span>
      <div>${title ? `<b></b>` : ''}<span class="t"></span>${sticky ? `<div><button type="button"></button></div>` : ''}</div></div>`;
  if (title) root.querySelector('b')!.textContent = title;
  root.querySelector('.t')!.innerHTML = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!)).replace(KEY_HINT, `<kbd>${KEY_HINT}</kbd>`);
  const close = () => host.remove();
  if (sticky) { const btn = root.querySelector('button')!; btn.textContent = strings.gotIt; btn.addEventListener('click', close); }
  else window.setTimeout(close, 3500);
  document.documentElement.appendChild(host);
}

/** Primeira vez nesta instância: explica em uma frase como usar e o atalho. */
function welcome(): void {
  if (window !== window.top) return;
  const k = `welcomed:${origin}`;
  void chrome.storage?.local.get(k).then((o) => {
    if (o[k]) return;
    void chrome.storage.local.set({ [k]: Date.now() });
    notice(fmt(strings.welcomeText, { key: KEY_HINT }), strings.welcomeTitle, true);
  }).catch(() => undefined);
}
const origin = location.origin;

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

document.addEventListener('trail:context', (e) => {
  const d = (e as CustomEvent<{ token?: string; userName?: string; table?: string; sysId?: string }>).detail ?? {};
  ctx = {
    ...ctx,
    token: d.token ?? ctx.token,
    userName: d.userName ?? ctx.userName,
    table: ctx.table ?? d.table,
    sysId: ctx.sysId ?? d.sysId,
    surface: ctx.surface === 'unknown' && d.table ? 'ui16' : ctx.surface,
  };
  pushContext();
  decorateForm();
});
document.dispatchEvent(new CustomEvent('trail:request-context'));
pushContext();

// ---------- ícone nos campos (UI16) ----------

function decorateForm(): void {
  if (!ctx.table || !ctx.sysId) return;
  const labels = document.querySelectorAll<HTMLLabelElement>(`label[for^="${ctx.table}."]`);
  for (const label of labels) {
    if (decorated.has(label)) continue;
    const field = (label.getAttribute('for') ?? '').replace(`${ctx.table}.`, '');
    if (!field || field.includes('.')) continue;
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
    // O modo vai junto para o worker abrir o painel lateral sem esperar nada: o Edge perde o gesto do clique em qualquer await.
    ...(panelMode ? { mode: panelMode } : {}),
    target: { table: ctx.table, sysId: ctx.sysId, field },
  }).catch(() => { /* noop */ });
}

// ---------- ícone nos campos do Service Portal / Employee Center (widget de formulário) ----------
function decoratePortal(): void {
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
  chrome.runtime.sendMessage({ type: 'batch', origin, table, field, sysIds: [...new Set(ids)], token: ctx.token, ...(panelMode ? { mode: panelMode } : {}) }).catch(() => { /* noop */ });
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
  const fromUrl = contextFromUrl(location.href);
  if (fromUrl.sysId && fromUrl.sysId !== ctx.sysId) {
    ctx = { ...ctx, ...fromUrl };
    pushContext();
    scheduleWorkspaceScan();
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
chrome.runtime?.onMessage?.addListener((m: { type?: string } & Partial<DiffWindowRequest>, _s, reply) => {
  if (m?.type !== 'diff-window' || window !== window.top || !m.key) return;
  openDiffWindow(m as DiffWindowRequest);
  reply({ ok: true });
});
// Gancho de teste (e2e): o mundo isolado do content script não é visível pela página.
(window as unknown as { __trailOpenDiff?: typeof openDiffWindow }).__trailOpenDiff = openDiffWindow;
