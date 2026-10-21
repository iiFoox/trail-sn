import { TRAIL_MINI } from '../shared/mark';
/**
 * Painel flutuante: o mesmo painel do Trail (src/sidepanel), num iframe dentro da própria página do ServiceNow.
 * Sem a faixa do navegador por cima: o único cabeçalho é o do próprio painel, que também serve para arrastar.
 *
 *  - Abre sempre do tamanho do painel lateral: altura toda da tela, encostado na direita.
 *  - Só fecha no X. Minimizar vira uma bolinha do Trail no canto; um clique volta.
 *  - Arrastar pelo cabeçalho solta o painel; soltar perto de uma borda encosta de novo (direita ou esquerda).
 *    Duplo clique no cabeçalho encosta na direita. A borda de dentro muda a largura.
 *  - Sobrevive a recarregar a página: o worker guarda, por aba, se está aberto ou minimizado.
 *  - Muda de tamanho por qualquer borda ou canto (encostado: a borda de dentro e a de baixo).
 *  - Setinha na lateral: esconde o painel na bolinha do Trail (o mesmo que minimizar); um clique na bolinha traz de volta.
 *  - Esc fecha (com o foco no painel, ou na página fora de um campo).
 *  - Visual de janela do Mac: cantos arredondados, uma pequena margem da borda, bolinhas fechar/minimizar/sempre visível.
 *  - "Sempre visível" (bolinha verde): o painel passa para uma janela de Picture-in-Picture de documento, que o navegador
 *    mantém por cima de tudo, até de outros programas. Fechar essa janela devolve o painel para a página.
 *
 * O iframe conversa com esta página por postMessage (origem conferida).
 */

const HOST_ID = 'trail-float';
const W = 420; // largura do painel lateral
const MIN_W = 340;
const MIN_H = 260;
const SNAP = 28;
const GAP = 8; // margem do painel encostado até a borda da tela
const BUBBLE_SIZE = 46;
const BUBBLE_MARGIN = 20;
const ASSISTANT_ID = 'trail-assistant';

const ASSISTANT_CSS = `
:host{all:initial}
:host([data-motion="off"]) *{animation:none!important;transition:none!important}
.bub{all:unset;position:fixed;z-index:2147483646;width:${BUBBLE_SIZE}px;height:${BUBBLE_SIZE}px;border-radius:50%;cursor:grab;touch-action:none;user-select:none;
  background:#032d42;display:grid;place-items:center;box-shadow:0 10px 28px rgba(0,0,0,.35),0 0 0 3px rgba(98,216,78,.25);
  animation:pop .36s cubic-bezier(.2,1.4,.4,1) backwards;transition:left .42s cubic-bezier(.2,1.35,.35,1),top .42s cubic-bezier(.2,1.35,.35,1),transform .18s,box-shadow .18s}
.bub:hover{transform:scale(1.08)}.bub.dragging{cursor:grabbing;transition:none;transform:scale(1.12);box-shadow:0 20px 42px rgba(0,0,0,.45),0 0 0 4px rgba(98,216,78,.3)}
.bub[hidden]{display:none}
.bub:focus-visible,.close:focus-visible{outline:2px solid #62d84e;outline-offset:3px}.bub svg{width:24px;height:24px}
.balloon{position:fixed;z-index:2147483646;max-width:min(270px,calc(100vw - 100px));box-sizing:border-box;padding:11px 32px 11px 13px;
  font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eef2;background:#16212a;border:1px solid #2a3a46;border-radius:13px;
  box-shadow:0 12px 32px rgba(0,0,0,.35);animation:pop .22s ease-out backwards}
.balloon[hidden]{display:none}.balloon:after{content:"";position:absolute;top:16px;width:9px;height:9px;background:#16212a;border:solid #2a3a46;transform:rotate(45deg)}
.balloon.left:after{left:-6px;border-width:0 0 1px 1px}.balloon.right:after{right:-6px;border-width:1px 1px 0 0}
.balloon b{display:block;color:#fff;margin-bottom:2px}.close{all:unset;position:absolute;right:8px;top:5px;cursor:pointer;font-size:18px;line-height:1;color:#a9bac3}
@keyframes pop{from{transform:scale(.55);opacity:0}to{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.bub,.balloon{animation:none!important;transition:none!important}}
`;

const CSS = `
:host{all:initial}
:host([data-motion="off"]) *{animation:none!important;transition:none!important}
.pane{position:fixed;z-index:2147483645;top:${GAP}px;height:calc(100vh - ${2 * GAP}px);box-sizing:border-box;display:flex;flex-direction:column;
  background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.18);
  animation:slide .42s cubic-bezier(.16,1,.3,1) backwards;transform-origin:100% 50%;
  transition:left .28s cubic-bezier(.2,.8,.2,1),top .28s cubic-bezier(.2,.8,.2,1),height .28s cubic-bezier(.2,.8,.2,1),transform .38s cubic-bezier(.16,1,.3,1),border-radius .28s,box-shadow .28s}
.body{flex:1;display:flex;min-height:0;border-radius:11px;overflow:hidden}
.pane.left{animation-name:slidel;transform-origin:0 50%}
.pane.free{transform-origin:50% 40%}
.pane.free{box-shadow:0 28px 70px rgba(0,0,0,.42)}
.pane.moving,.pane.sizing{transition:none}
.pane.moving{box-shadow:0 36px 90px rgba(0,0,0,.5)}
.pane.dark{--bg:#0f171d;--line:#2a3a46}
.pane.light{--bg:#f4f6f8;--line:#cfd3da}
.pane.out{animation:out .26s cubic-bezier(.4,0,1,1) both;pointer-events:none}
.pane.left.out{animation-name:outl}
.pane.free.out{animation-name:outf}
.pane.mini{animation:mini .3s cubic-bezier(.4,0,.2,1) both}
iframe{flex:1;width:100%;border:0;background:var(--bg);display:block}
.rz{position:absolute;z-index:2}
.rz.w,.rz.e{top:12px;bottom:12px;width:8px;cursor:ew-resize}.rz.w{left:-4px}.rz.e{right:-4px}
.rz.n,.rz.s{left:12px;right:12px;height:8px;cursor:ns-resize}.rz.n{top:-4px}.rz.s{bottom:-4px}
.rz.nw,.rz.ne,.rz.sw,.rz.se{width:14px;height:14px}
.rz.nw{left:-4px;top:-4px;cursor:nwse-resize}.rz.se{right:-4px;bottom:-4px;cursor:nwse-resize}
.rz.ne{right:-4px;top:-4px;cursor:nesw-resize}.rz.sw{left:-4px;bottom:-4px;cursor:nesw-resize}
/* Encostado: só a borda de dentro, a de baixo e o canto entre elas. */
.pane:not(.free):not(.left) .rz:is(.e,.n,.nw,.ne,.se){display:none}
.pane.left .rz:is(.w,.n,.nw,.ne,.sw){display:none}
.rz.w:hover:after,.rz.e:hover:after{content:"";position:absolute;top:0;bottom:0;left:3px;width:2px;background:#2bb39f}
.rz.n:hover:after,.rz.s:hover:after{content:"";position:absolute;left:0;right:0;top:3px;height:2px;background:#2bb39f}
.tab{all:unset;position:absolute;top:50%;left:-22px;width:22px;height:52px;margin-top:-26px;box-sizing:border-box;cursor:pointer;z-index:3;
  display:grid;place-items:center;background:var(--bg);border:1px solid var(--line);border-right:0;border-radius:10px 0 0 10px;
  color:#62d84e;box-shadow:-6px 0 16px rgba(0,0,0,.18)}
.tab svg{width:14px;height:14px;transition:transform .28s}
.tab:hover{color:#8bf07a}
.tab:focus-visible{outline:2px solid #62d84e;outline-offset:2px}
.pane.left .tab{left:auto;right:-22px;border-right:1px solid var(--line);border-left:0;border-radius:0 10px 10px 0;box-shadow:6px 0 16px rgba(0,0,0,.18)}
.pane.left .tab svg{transform:rotate(180deg)}
.pane.free .tab{display:none}
.snap{position:fixed;top:${GAP}px;height:calc(100vh - ${2 * GAP}px);border-radius:12px;width:${W}px;z-index:2147483644;background:rgba(43,179,159,.12);border:2px dashed rgba(43,179,159,.6);box-sizing:border-box;pointer-events:none;opacity:0;transition:opacity .15s}
.snap.on{opacity:1}
@keyframes slide{from{transform:translateX(36px) scale(.96);opacity:0;filter:blur(3px)}60%{opacity:1;filter:none}to{transform:none;opacity:1}}
@keyframes slidel{from{transform:translateX(-36px) scale(.96);opacity:0;filter:blur(3px)}60%{opacity:1;filter:none}to{transform:none;opacity:1}}
@keyframes slidef{from{transform:scale(.92) translateY(10px);opacity:0;filter:blur(3px)}to{transform:none;opacity:1}}
@keyframes out{to{transform:translateX(28px) scale(.96);opacity:0;filter:blur(2px)}}
@keyframes outl{to{transform:translateX(-28px) scale(.96);opacity:0;filter:blur(2px)}}
@keyframes outf{to{transform:scale(.92) translateY(8px);opacity:0;filter:blur(2px)}}
@keyframes mini{to{transform:translate(var(--gx,0),var(--gy,40vh)) scale(.1);opacity:0}}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.pane,.bub{animation:none!important;transition:none!important}}
`;

type Dock = 'right' | 'left' | 'free';
interface State {
  host: HTMLElement; root: ShadowRoot; pane: HTMLElement; tabId: number; dock: Dock; w: number; ready: boolean; src: string; theme: 'dark' | 'light';
  /** Altura escolhida pela pessoa quando encostado; sem ela, a tela toda. */
  h?: number;
}
let st: State | null = null;
let bubble: HTMLButtonElement | null = null;
/** Posição da bolinha em proporção da área livre (0 a 1), em x e y: fica onde a pessoa soltou, sem grudar nas laterais. */
let assistant: { host: HTMLElement; balloon: HTMLElement; edge: 'left' | 'right'; x: number; y: number; origin: string; tabId: number; enabled: boolean; tip: string } | null = null;
let balloonTimer: number | undefined;
let tipLeaveTimer: number | undefined;
let balloonKind: 'tip' | 'message' | null = null;
let minimized = false;
/** Animações (preferência "Animações" das configurações). */
let motionOn = true;

/** Textos do painel e do balão no idioma escolhido (o content script manda quando carrega as preferências). */
let labels = { hide: 'Esconder o painel', close: 'Fechar' };
export function setFloatLabels(l: { hide: string; close: string }): void {
  labels = l;
  const tab = st?.root.querySelector<HTMLButtonElement>('.tab');
  if (tab) { tab.title = l.hide; tab.setAttribute('aria-label', l.hide); }
  assistant?.balloon.querySelector('.close')?.setAttribute('aria-label', l.close);
}

export function setFloatMotion(on: boolean): void {
  motionOn = on;
  for (const id of [HOST_ID, ASSISTANT_ID]) {
    const h = document.getElementById(id);
    if (h) { if (on) delete h.dataset.motion; else h.dataset.motion = 'off'; }
  }
}

/** Atalho de teclado da página: abre o painel, ou esconde na bolinha se ele já está aberto. */
export function toggleFloatByKey(tabId: number, theme?: 'dark' | 'light'): void {
  if (st && !minimized) minimize(); else if (st) restore(); else openFloat(tabId, { theme });
}
let disposed = false;
let onOutside: ((e: PointerEvent) => void) | null = null;
const extOrigin = (() => { try { return new URL(chrome.runtime.getURL('')).origin; } catch { return ''; } })();

const bubbleKey = (origin: string) => `trail.bubble:${origin}`;
const maxBubbleTop = () => Math.max(BUBBLE_MARGIN, innerHeight - BUBBLE_MARGIN - BUBBLE_SIZE);
const bubbleTop = (y: number) => BUBBLE_MARGIN + y * (maxBubbleTop() - BUBBLE_MARGIN);
const maxBubbleLeft = () => Math.max(BUBBLE_MARGIN, innerWidth - BUBBLE_MARGIN - BUBBLE_SIZE);
const bubbleLeft = (x: number) => BUBBLE_MARGIN + x * (maxBubbleLeft() - BUBBLE_MARGIN);
/** O balão abre para o lado com mais espaço: bolinha na metade esquerda, balão à direita dela. */
const sideOf = (x: number): 'left' | 'right' => (x < 0.5 ? 'left' : 'right');

function placeBubble(): void {
  if (!bubble || !assistant) return;
  assistant.edge = sideOf(assistant.x);
  bubble.style.left = `${bubbleLeft(assistant.x)}px`;
  bubble.style.top = `${bubbleTop(assistant.y)}px`;
  placeBalloon();
}

function placeBalloon(): void {
  if (!assistant || !bubble) return;
  const card = assistant.balloon;
  const r = bubble.getBoundingClientRect();
  card.classList.toggle('left', assistant.edge === 'left');
  card.classList.toggle('right', assistant.edge === 'right');
  card.style.left = assistant.edge === 'left' ? `${r.right + 12}px` : '';
  card.style.right = assistant.edge === 'right' ? `${innerWidth - r.left + 12}px` : '';
  card.style.top = `${Math.max(8, Math.min(innerHeight - card.offsetHeight - 8, r.top + 4))}px`;
}

function hideBalloon(): void {
  if (balloonTimer) clearTimeout(balloonTimer);
  if (tipLeaveTimer) clearTimeout(tipLeaveTimer);
  balloonKind = null;
  if (assistant) assistant.balloon.hidden = true;
}

function scheduleTipHide(): void {
  if (balloonKind !== 'tip') return;
  if (tipLeaveTimer) clearTimeout(tipLeaveTimer);
  tipLeaveTimer = window.setTimeout(hideBalloon, 150);
}

export function showAssistantMessage(text: string, title?: string): boolean {
  if (!assistant?.enabled || !bubble) return false;
  const card = assistant.balloon;
  const heading = card.querySelector<HTMLElement>('b')!;
  heading.textContent = title ?? '';
  heading.hidden = !title;
  card.querySelector<HTMLElement>('.text')!.textContent = text;
  card.hidden = false;
  balloonKind = 'message';
  placeBalloon();
  if (balloonTimer) clearTimeout(balloonTimer);
  balloonTimer = window.setTimeout(hideBalloon, 6000);
  return true;
}

export function canShowAssistantMessage(): boolean { return !!assistant?.enabled && !!bubble && !bubble.hidden; }

function showTip(): void {
  if (!assistant?.tip || balloonKind === 'message') return;
  const card = assistant.balloon;
  card.querySelector<HTMLElement>('b')!.hidden = true;
  card.querySelector<HTMLElement>('.text')!.textContent = assistant.tip;
  card.hidden = false;
  balloonKind = 'tip';
  if (tipLeaveTimer) clearTimeout(tipLeaveTimer);
  placeBalloon();
}

function ensureBubble(): void {
  if (!assistant?.enabled || (st && !minimized)) return;
  if (bubble) { placeBubble(); return; }
  const a = assistant;
  const b = a.host.shadowRoot!.querySelector<HTMLButtonElement>('.bub')!;
  bubble = b;
  b.hidden = false;
  placeBubble();
  document.dispatchEvent(new Event('trail:bubble-visible'));
  if (b.dataset.wired) return;
  b.dataset.wired = '1';
  let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let suppressClick = false;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    hideBalloon();
    const r = b.getBoundingClientRect();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    b.setPointerCapture(e.pointerId);
  });
  b.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    b.classList.add('dragging');
    b.style.left = `${Math.max(BUBBLE_MARGIN, Math.min(innerWidth - BUBBLE_MARGIN - BUBBLE_SIZE, drag.left + dx))}px`;
    b.style.top = `${Math.max(BUBBLE_MARGIN, Math.min(maxBubbleTop(), drag.top + dy))}px`;
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      suppressClick = true;
      // Fica onde foi solto (sem encostar na borda); a posição vira proporção para sobreviver a mudar o tamanho da janela.
      a.x = Math.max(0, Math.min(1, (parseFloat(b.style.left) - BUBBLE_MARGIN) / Math.max(1, maxBubbleLeft() - BUBBLE_MARGIN)));
      a.y = Math.max(0, Math.min(1, (parseFloat(b.style.top) - BUBBLE_MARGIN) / Math.max(1, maxBubbleTop() - BUBBLE_MARGIN)));
      a.edge = sideOf(a.x);
      b.classList.remove('dragging');
      placeBubble();
      void chrome.storage.local.set({ [bubbleKey(a.origin)]: { x: a.x, y: a.y, edge: a.edge } }).catch(() => undefined);
    }
    drag = null;
  };
  b.addEventListener('pointerup', end);
  b.addEventListener('pointercancel', end);
  b.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    hideBalloon();
    showFloat(a.tabId);
  });
  b.addEventListener('pointerenter', () => { if (!drag) showTip(); });
  b.addEventListener('pointerleave', scheduleTipHide);
}

function hideBubble(): void {
  hideBalloon();
  if (bubble) { bubble.hidden = true; bubble = null; }
}

export async function initAssistant(tabId: number, origin: string, enabled: boolean, tip: string): Promise<void> {
  if (disposed) return;
  if (assistant) { assistant.tabId = tabId; assistant.tip = tip; setAssistantEnabled(enabled); return; }
  const key = bubbleKey(origin);
  const stored: Record<string, unknown> = await chrome.storage.local.get(key).catch(() => ({}));
  if (disposed) return;
  try { if (!chrome.runtime.id) return; } catch { return; }
  const p = stored[key] as { x?: number; edge?: string; y?: number } | undefined;
  // Posição antiga (só a lateral) continua valendo: esquerda = 0, direita = 1.
  const px = typeof p?.x === 'number' && Number.isFinite(p.x) ? Math.max(0, Math.min(1, p.x)) : p?.edge === 'left' ? 0 : 1;
  const host = document.createElement('div');
  host.id = ASSISTANT_ID;
  if (!motionOn) host.dataset.motion = 'off';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${ASSISTANT_CSS}</style><button class="bub" type="button" aria-label="Trail" hidden>${TRAIL_MINI(3)}</button><div class="balloon" role="status" hidden><button class="close" type="button" aria-label="${labels.close}">×</button><b></b><span class="text"></span></div>`;
  document.documentElement.appendChild(host);
  assistant = { host, balloon: root.querySelector('.balloon')!, edge: sideOf(px), x: px, y: typeof p?.y === 'number' && Number.isFinite(p.y) ? Math.max(0, Math.min(1, p.y)) : 1, origin, tabId, enabled, tip };
  root.querySelector('.close')!.addEventListener('click', hideBalloon);
  assistant.balloon.addEventListener('pointerenter', () => { if (tipLeaveTimer) clearTimeout(tipLeaveTimer); });
  assistant.balloon.addEventListener('pointerleave', scheduleTipHide);
  onOutside = (e) => { if (assistant && !e.composedPath().includes(host)) hideBalloon(); };
  document.addEventListener('pointerdown', onOutside, true);
  ensureBubble();
}

export function setAssistantEnabled(enabled: boolean): void {
  if (!assistant) return;
  assistant.enabled = enabled;
  if (!enabled) { if (st && minimized) restore(); hideBubble(); }
  else ensureBubble();
}

/** Remove toda a interface desta cópia quando o contexto da extensão perde validade. */
export function disposeFloat(): void {
  disposed = true;
  st = null;
  minimized = false;
  pip?.close(); pip = null;
  hideBalloon();
  bubble = null;
  assistant?.host.remove(); assistant = null;
  if (onOutside) document.removeEventListener('pointerdown', onOutside, true);
  onOutside = null;
  removeEventListener('keydown', onEscape);
  removeEventListener('message', onMessage);
  removeEventListener('resize', onResize);
  document.getElementById(HOST_ID)?.remove();
}

function save(open: boolean, min = false): void {
  chrome.runtime.sendMessage({ type: 'float-set', open, min }).catch(() => undefined);
}

function place(s: State): void {
  const vw = document.documentElement.clientWidth || innerWidth;
  s.w = Math.max(MIN_W, Math.min(s.w, vw - 40 - 2 * GAP));
  const p = s.pane;
  p.classList.toggle('left', s.dock === 'left');
  p.classList.toggle('free', s.dock === 'free');
  p.style.width = `${s.w}px`;
  if (s.dock === 'free') return;
  p.style.top = `${GAP}px`;
  p.style.height = s.h ? `${Math.min(s.h, innerHeight - 2 * GAP)}px` : `calc(100vh - ${2 * GAP}px)`;
  p.style.left = s.dock === 'right' ? `${vw - s.w - GAP}px` : `${GAP}px`;
}

export function setFloatTheme(theme: 'dark' | 'light'): void {
  if (!st) return;
  st.theme = theme;
  st.pane.classList.toggle('dark', theme === 'dark');
  st.pane.classList.toggle('light', theme === 'light');
}

export function isFloatOpen(): boolean { return !!st; }

export function openFloat(tabId: number, opts: { theme?: 'dark' | 'light'; minimized?: boolean } = {}): void {
  if (st) { if (minimized) restore(); return; }
  hideBubble();
  minimized = false;
  const theme = opts.theme ?? 'dark';
  const host = document.createElement('div');
  host.id = HOST_ID;
  if (!motionOn) host.dataset.motion = 'off';
  const root = host.attachShadow({ mode: 'open' });
  const src = chrome.runtime.getURL(`src/sidepanel/index.html?float=1&tab=${tabId}&theme=${theme}`);
  root.innerHTML = `<style>${CSS}</style><div class="snap"></div><div class="pane ${theme}" role="complementary" aria-label="Trail">${RZ}<button class="tab" type="button">${CHEVRON}</button><div class="body"><iframe src="${src}" title="Trail" allow="clipboard-write"></iframe></div></div>`;
  document.documentElement.appendChild(host);
  const pane = root.querySelector<HTMLElement>('.pane')!;
  st = { host, root, pane, tabId, dock: 'right', w: W, ready: false, src, theme };
  place(st);
  save(true);
  // Instância que bloqueia o iframe da extensão (política de segurança): cai para a janela separada.
  const s0 = st;
  setTimeout(() => { if (st === s0 && !s0.ready) { closeFloat(false); chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }).catch(() => undefined); } }, 6000);
  wireResize(st);
  wireTab(st);
  if (opts.minimized) minimize(true);
}

export function toggleFloat(tabId: number, theme?: 'dark' | 'light'): void {
  if (st && !minimized) closeFloat(); else if (st) restore(); else openFloat(tabId, { theme });
}

export function closeFloat(persist = true): void {
  const s = st;
  if (!s) return;
  st = null;
  minimized = false;
  pip?.close(); pip = null;
  if (persist) save(false);
  s.pane.classList.add('out');
  setTimeout(() => s.host.remove(), 260);
  ensureBubble();
}

function minimize(instant = false): void {
  const s = st;
  if (!s || minimized) return;
  if (assistant && !assistant.enabled) { closeFloat(); return; }
  minimized = true;
  const r = s.pane.getBoundingClientRect();
  const bx = bubbleLeft(assistant?.x ?? 1);
  s.pane.style.setProperty('--gx', `${bx + BUBBLE_SIZE / 2 - (r.left + r.width / 2)}px`);
  s.pane.style.setProperty('--gy', `${bubbleTop(assistant?.y ?? 1) + BUBBLE_SIZE / 2 - (r.top + r.height / 2)}px`);
  const done = () => {
    if (st !== s || !minimized) return;
    s.pane.style.display = 'none';
    s.pane.classList.remove('mini');
    ensureBubble();
  };
  if (instant) done(); else { s.pane.classList.add('mini'); setTimeout(done, 280); }
  save(true, true);
}

function restore(): void {
  const s = st;
  if (!s) return;
  minimized = false;
  hideBubble();
  s.pane.style.display = '';
  s.pane.style.animation = 'none'; void s.pane.offsetWidth; s.pane.style.animation = '';
  place(s);
  save(true);
}

/** Abrir de novo ou investigar outra coisa com o painel minimizado: ele volta a aparecer. */
export function showFloat(tabId: number, theme?: 'dark' | 'light'): void {
  if (!st) openFloat(tabId, { theme }); else if (minimized) restore();
}

// ---------- arrastar ----------
// O cabeçalho fica dentro do iframe: ele prende o ponteiro (setPointerCapture) e manda início, movimento e fim
// por postMessage. Assim o arrasto não depende de camada por cima da página e nunca fica "preso" se o botão soltar rápido.
interface Drag { sx: number; sy: number; left: number; top: number; moved: boolean }
let drag: Drag | null = null;
const vw = () => document.documentElement.clientWidth || innerWidth;

function dragStart(s: State, sx: number, sy: number): void {
  const r = s.pane.getBoundingClientRect();
  drag = { sx, sy, left: r.left, top: r.top, moved: false };
}
function dragMove(s: State, x: number, y: number, px: number): void {
  if (!drag) return;
  const dx = x - drag.sx, dy = y - drag.sy;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    s.pane.classList.add('moving');
    if (s.dock !== 'free') {
      // Solta da borda: vira um cartão um pouco menor que a tela, sob o ponteiro.
      s.dock = 'free';
      place(s);
      s.pane.style.height = `${Math.min(innerHeight - 24, 680)}px`;
      drag.top = 12 - dy;
    }
  }
  const l = Math.min(Math.max(drag.left + dx, 60 - s.w), vw() - 60);
  const t = Math.min(Math.max(drag.top + dy, 0), innerHeight - 44);
  s.pane.style.left = `${l}px`; s.pane.style.top = `${t}px`;
  const snap = s.root.querySelector<HTMLElement>('.snap')!;
  const edge = px <= SNAP ? 'left' : px >= vw() - SNAP ? 'right' : '';
  snap.classList.toggle('on', !!edge);
  if (edge) { snap.style.width = `${s.w}px`; snap.style.left = edge === 'left' ? `${GAP}px` : `${vw() - s.w - GAP}px`; }
}
function dragEnd(s: State, px: number): void {
  const d = drag;
  drag = null;
  s.root.querySelector<HTMLElement>('.snap')!.classList.remove('on');
  s.pane.classList.remove('moving');
  if (!d?.moved) return;
  if (px <= SNAP) s.dock = 'left';
  else if (px >= vw() - SNAP) s.dock = 'right';
  place(s);
}

const RZ = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].map((d) => `<div class="rz ${d}" data-d="${d}" aria-hidden="true"></div>`).join('');
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function wireResize(s: State): void {
  for (const h of s.root.querySelectorAll<HTMLElement>('.rz')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      s.pane.classList.add('sizing');
      const d = h.dataset.d ?? '';
      const r0 = s.pane.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        let { left, top, width, height } = r0;
        if (d.includes('e')) width = r0.width + dx;
        if (d.includes('w')) width = r0.width - dx;
        if (d.includes('s')) height = r0.height + dy;
        if (d.includes('n')) height = r0.height - dy;
        width = Math.max(MIN_W, Math.min(vw() - 2 * GAP, width));
        height = Math.max(MIN_H, Math.min(innerHeight - 2 * GAP, height));
        if (d.includes('w')) left = r0.right - width;
        if (d.includes('n')) top = r0.bottom - height;
        s.w = width;
        s.pane.style.width = `${width}px`;
        s.pane.style.height = `${height}px`;
        if (s.dock === 'free') { s.pane.style.left = `${left}px`; s.pane.style.top = `${top}px`; return; }
        // Encostado: a altura só muda pela borda de baixo; quase a tela toda volta a ser "tela toda".
        if (d.includes('s')) s.h = height >= innerHeight - 2 * GAP - 4 ? undefined : height;
        s.pane.style.left = s.dock === 'right' ? `${vw() - width - GAP}px` : `${GAP}px`;
      };
      const end = () => { s.pane.classList.remove('sizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', end); h.removeEventListener('pointercancel', end); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    });
  }
}

/** Setinha da lateral: esconde o painel na bolinha do Trail, como minimizar. */
function wireTab(s: State): void {
  const tab = s.root.querySelector<HTMLButtonElement>('.tab')!;
  tab.title = labels.hide;
  tab.setAttribute('aria-label', labels.hide);
  tab.addEventListener('click', () => minimize());
}

// ---------- sempre visível (Picture-in-Picture de documento) ----------
interface PipApi { requestWindow(o: { width: number; height: number }): Promise<Window> }
let pip: Window | null = null;

async function togglePin(): Promise<void> {
  const s = st;
  if (!s) return;
  if (pip) { pip.close(); return; }
  const api = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
  // Navegador sem a API: a janela separada é o mais perto disso.
  if (!api) { chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }).catch(() => undefined); return; }
  let w: Window;
  // O clique na bolinha (dentro do iframe) conta como gesto também para esta página.
  try { w = await api.requestWindow({ width: s.w, height: Math.min(screen.availHeight - 60, 900) }); } catch { return; }
  if (st !== s) { w.close(); return; }
  pip = w;
  const bg = s.theme === 'light' ? '#f4f6f8' : '#0f171d';
  w.document.title = 'Trail';
  w.document.body.style.cssText = `margin:0;height:100vh;display:flex;background:${bg}`;
  const frame = w.document.createElement('iframe');
  frame.src = `${s.src}&pip=1`;
  frame.title = 'Trail';
  frame.allow = 'clipboard-write';
  frame.style.cssText = `flex:1;border:0;width:100%;height:100%;background:${bg}`;
  w.document.body.appendChild(frame);
  s.pane.style.display = 'none';
  w.addEventListener('message', (e: MessageEvent) => { if (e.origin === extOrigin) onPanelMessage(e.data, true); });
  w.addEventListener('pagehide', () => {
    if (pip === w) pip = null;
    if (st === s && !minimized) { s.pane.style.display = ''; place(s); }
  });
}

type PanelMsg = { type?: string; sx?: number; sy?: number; cx?: number } | null;
function onPanelMessage(d: PanelMsg, fromPip: boolean): void {
  if (!st) return;
  if (fromPip) {
    // Na janela sempre visível não há arrastar nem encostar: o sistema cuida da janela.
    switch (d?.type) {
      case 'trail-float-pin': pip?.close(); return;
      case 'trail-float-min': pip?.close(); minimize(true); return;
      case 'trail-float-close': closeFloat(); return;
    }
    return;
  }
  // Posição do ponteiro na página: o iframe manda a dele, relativa ao próprio painel.
  const px = () => st!.pane.getBoundingClientRect().left + (d?.cx ?? 0);
  switch (d?.type) {
    case 'trail-float-ready': st.ready = true; return;
    case 'trail-float-drag': dragStart(st, d.sx ?? 0, d.sy ?? 0); return;
    case 'trail-float-move': dragMove(st, d.sx ?? 0, d.sy ?? 0, px()); return;
    case 'trail-float-drop': dragEnd(st, px()); return;
    case 'trail-float-dock': st.dock = 'right'; place(st); return;
    case 'trail-float-min': minimize(); return;
    case 'trail-float-close': closeFloat(); return;
    case 'trail-float-pin': void togglePin(); return;
  }
}

// Esc na página fecha o painel, menos quando a pessoa está digitando num campo ou há um diálogo aberto.
function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !st || minimized || e.defaultPrevented) return;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  if (document.querySelector('dialog[open], .modal.in, .modal.show, [role="dialog"][aria-modal="true"]')) return;
  closeFloat();
}
addEventListener('keydown', onEscape);

function onMessage(e: MessageEvent): void {
  if (!st || e.origin !== extOrigin) return;
  onPanelMessage(e.data as PanelMsg, false);
}
function onResize(): void { if (st) place(st); placeBubble(); }
addEventListener('message', onMessage);
addEventListener('resize', onResize);
