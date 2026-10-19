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
  host.style.cssText = 'display:inline-block;margin-left:4px;vertical-align:middle;line-height:0;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      button{all:unset;cursor:pointer;width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
             color:#6b7280;opacity:.55;font:600 10px/1 system-ui,sans-serif;border:1px solid currentColor}
      button:hover{opacity:1;color:#2563eb}
    </style>
    <button type="button" title="${strings.whyChanged} (${field})" aria-label="${strings.whyChanged}">?</button>`;
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

// Reage a navegação dentro da página (Workspace é SPA) e a formulários que carregam depois.
const mo = new MutationObserver(() => {
  const fromUrl = contextFromUrl(location.href);
  if (fromUrl.sysId && fromUrl.sysId !== ctx.sysId) {
    ctx = { ...ctx, ...fromUrl };
    pushContext();
  }
  decorateForm();
});
mo.observe(document.documentElement, { childList: true, subtree: true });
decorateForm();
