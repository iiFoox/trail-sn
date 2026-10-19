/**
 * Content script (mundo isolado, all_frames). Orquestra a interface:
 *  - detecta o contexto (URL primeiro, depois o page/, DOM só para posicionar o ícone);
 *  - injeta o ícone "por que mudou?" ao lado dos rótulos dos campos no UI16;
 *  - encaminha pedidos ao service worker. Nunca consulta a instância diretamente.
 *
 * Convivência com o SN Utils: prefixo trail- em tudo, shadowRoot próprio, ícone depois dos badges.
 */
import { detectLang, t } from '../shared/i18n';
import type { PageContext } from '../shared/messages';

const strings = t(detectLang());
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
const decorated = new WeakSet<Element>();

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

function makeIcon(field: string): HTMLElement {
  const host = document.createElement('span');
  host.className = 'trail-host';
  host.style.cssText = 'display:inline-block;margin-left:5px;vertical-align:middle;line-height:0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      button{all:unset;cursor:pointer;width:16px;height:16px;border-radius:50%;display:inline-grid;place-items:center;
             color:#6e7984;background:transparent;border:1px solid #c3cbd3;transition:all .12s ease;opacity:.7}
      button:hover,button:focus-visible{opacity:1;color:#fff;background:#1f8476;border-color:#1f8476;box-shadow:0 0 0 3px rgba(31,132,118,.18)}
      svg{width:10px;height:10px;display:block}
    </style>
    <button type="button" title="${strings.whyChanged} · ${field}" aria-label="${strings.whyChanged} (${field})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18c3-7 6-7 9 0s6 7 8-7"/><circle cx="21" cy="5" r="2" fill="currentColor" stroke="none"/></svg>
    </button>`;
  root.querySelector('button')!.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    investigate(field);
  });
  return host;
}

function investigate(field: string): void {
  if (!ctx.table || !ctx.sysId) return;
  chrome.runtime.sendMessage({
    type: 'investigate',
    origin,
    token: ctx.token,
    target: { table: ctx.table, sysId: ctx.sysId, field },
  }).catch(() => { /* noop */ });
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
});
mo.observe(document.documentElement, { childList: true, subtree: true });
decorateForm();
