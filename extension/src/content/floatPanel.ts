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
 *
 * O iframe conversa com esta página por postMessage (origem conferida).
 */

const HOST_ID = 'trail-float';
const W = 420; // largura do painel lateral
const MIN_W = 340;
const SNAP = 28;

const CSS = `
:host{all:initial}
.pane{position:fixed;z-index:2147483645;top:0;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;
  background:var(--bg);border-left:1px solid var(--line);box-shadow:-14px 0 40px rgba(0,0,0,.22);
  animation:slide .34s cubic-bezier(.2,.8,.2,1) both;
  transition:left .28s cubic-bezier(.2,.8,.2,1),top .28s cubic-bezier(.2,.8,.2,1),height .28s cubic-bezier(.2,.8,.2,1),border-radius .28s,box-shadow .28s}
.pane.left{border-left:0;border-right:1px solid var(--line);box-shadow:14px 0 40px rgba(0,0,0,.22);animation-name:slidel}
.pane.free{border:1px solid var(--line);border-radius:14px;box-shadow:0 28px 70px rgba(0,0,0,.42)}
.pane.moving,.pane.sizing{transition:none}
.pane.moving{box-shadow:0 36px 90px rgba(0,0,0,.5)}
.pane.dark{--bg:#0f171d;--line:#2a3a46}
.pane.light{--bg:#f4f6f8;--line:#cfd3da}
.pane.out{animation:out .22s cubic-bezier(.4,0,.6,1) both}
.pane.mini{animation:mini .3s cubic-bezier(.4,0,.2,1) both}
iframe{flex:1;width:100%;border:0;background:var(--bg);display:block}
.edge{position:absolute;top:0;bottom:0;left:-3px;width:8px;cursor:ew-resize;z-index:2}
.pane.left .edge{left:auto;right:-3px}
.edge:hover:after,.pane.sizing .edge:after{content:"";position:absolute;top:0;bottom:0;left:3px;width:2px;background:#2bb39f}
.snap{position:fixed;top:0;height:100vh;width:${W}px;z-index:2147483644;background:rgba(43,179,159,.12);border:2px dashed rgba(43,179,159,.6);box-sizing:border-box;pointer-events:none;opacity:0;transition:opacity .15s}
.snap.on{opacity:1}
.bub{all:unset;position:fixed;right:20px;bottom:20px;z-index:2147483645;width:46px;height:46px;border-radius:50%;cursor:pointer;
  background:#032d42;display:grid;place-items:center;box-shadow:0 10px 28px rgba(0,0,0,.35),0 0 0 3px rgba(98,216,78,.25);
  animation:pop .32s cubic-bezier(.2,1.3,.4,1) both;transition:transform .15s}
.bub:hover{transform:scale(1.08)}
.bub:focus-visible{outline:2px solid #62d84e;outline-offset:3px}
.bub svg{width:24px;height:24px}
@keyframes slide{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
@keyframes slidel{from{transform:translateX(-40px);opacity:0}to{transform:none;opacity:1}}
@keyframes out{to{transform:translateX(30px);opacity:0}}
@keyframes mini{to{transform:translate(var(--gx,0),var(--gy,40vh)) scale(.1);opacity:0}}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.pane,.bub{animation:none!important;transition:none!important}}
`;

type Dock = 'right' | 'left' | 'free';
interface State { host: HTMLElement; root: ShadowRoot; pane: HTMLElement; tabId: number; dock: Dock; w: number; ready: boolean }
let st: State | null = null;
let bubble: HTMLButtonElement | null = null;
const extOrigin = (() => { try { return new URL(chrome.runtime.getURL('')).origin; } catch { return ''; } })();

function save(open: boolean, min = false): void {
  chrome.runtime.sendMessage({ type: 'float-set', open, min }).catch(() => undefined);
}

function place(s: State): void {
  const vw = document.documentElement.clientWidth || innerWidth;
  s.w = Math.max(MIN_W, Math.min(s.w, vw - 40));
  const p = s.pane;
  p.classList.toggle('left', s.dock === 'left');
  p.classList.toggle('free', s.dock === 'free');
  p.style.width = `${s.w}px`;
  if (s.dock === 'free') return;
  p.style.top = '0px';
  p.style.height = '100vh';
  p.style.left = s.dock === 'right' ? `${vw - s.w}px` : '0px';
}

export function setFloatTheme(theme: 'dark' | 'light'): void {
  if (!st) return;
  st.pane.classList.toggle('dark', theme === 'dark');
  st.pane.classList.toggle('light', theme === 'light');
}

export function isFloatOpen(): boolean { return !!st || !!bubble; }

export function openFloat(tabId: number, opts: { theme?: 'dark' | 'light'; minimized?: boolean } = {}): void {
  if (st) { if (bubble) restore(); return; }
  const theme = opts.theme ?? 'dark';
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const src = chrome.runtime.getURL(`src/sidepanel/index.html?float=1&tab=${tabId}&theme=${theme}`);
  root.innerHTML = `<style>${CSS}</style><div class="snap"></div><div class="pane ${theme}" role="complementary" aria-label="Trail"><div class="edge" aria-hidden="true"></div><iframe src="${src}" title="Trail" allow="clipboard-write"></iframe></div>`;
  document.documentElement.appendChild(host);
  const pane = root.querySelector<HTMLElement>('.pane')!;
  st = { host, root, pane, tabId, dock: 'right', w: W, ready: false };
  place(st);
  save(true);
  // Instância que bloqueia o iframe da extensão (política de segurança): cai para a janela separada.
  const s0 = st;
  setTimeout(() => { if (st === s0 && !s0.ready) { closeFloat(false); chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }).catch(() => undefined); } }, 6000);
  wireResize(st);
  if (opts.minimized) minimize(true);
}

export function toggleFloat(tabId: number, theme?: 'dark' | 'light'): void {
  if (st && !bubble) closeFloat(); else if (st) restore(); else openFloat(tabId, { theme });
}

export function closeFloat(persist = true): void {
  const s = st;
  if (!s) return;
  st = null;
  bubble?.remove(); bubble = null;
  if (persist) save(false);
  s.pane.classList.add('out');
  setTimeout(() => s.host.remove(), 220);
}

function minimize(instant = false): void {
  const s = st;
  if (!s || bubble) return;
  const r = s.pane.getBoundingClientRect();
  s.pane.style.setProperty('--gx', `${innerWidth - 43 - (r.left + r.width / 2)}px`);
  s.pane.style.setProperty('--gy', `${innerHeight - 43 - (r.top + r.height / 2)}px`);
  const done = () => {
    s.pane.style.display = 'none';
    s.pane.classList.remove('mini');
    bubble = document.createElement('button');
    bubble.className = 'bub';
    bubble.title = 'Trail';
    bubble.setAttribute('aria-label', 'Trail');
    bubble.innerHTML = TRAIL_MINI(3);
    bubble.addEventListener('click', restore);
    s.root.appendChild(bubble);
  };
  if (instant) done(); else { s.pane.classList.add('mini'); setTimeout(done, 280); }
  save(true, true);
}

function restore(): void {
  const s = st;
  if (!s) return;
  bubble?.remove(); bubble = null;
  s.pane.style.display = '';
  s.pane.style.animation = 'none'; void s.pane.offsetWidth; s.pane.style.animation = '';
  place(s);
  save(true);
}

/** Abrir de novo ou investigar outra coisa com o painel minimizado: ele volta a aparecer. */
export function showFloat(tabId: number, theme?: 'dark' | 'light'): void {
  if (!st) openFloat(tabId, { theme }); else if (bubble) restore();
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
  if (edge) { snap.style.width = `${s.w}px`; snap.style.left = edge === 'left' ? '0px' : `${vw() - s.w}px`; }
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

function wireResize(s: State): void {
  const edge = s.root.querySelector<HTMLElement>('.edge')!;
  edge.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    edge.setPointerCapture(e.pointerId);
    s.pane.classList.add('sizing');
    const x0 = e.clientX, w0 = s.w, l0 = s.pane.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const fromLeftEdge = s.dock !== 'left'; // docado à direita ou solto: a alça fica do lado esquerdo
      s.w = Math.max(MIN_W, Math.min(vw() - 40, fromLeftEdge ? w0 - dx : w0 + dx));
      s.pane.style.width = `${s.w}px`;
      if (s.dock === 'right') s.pane.style.left = `${vw() - s.w}px`;
      else if (s.dock === 'free') s.pane.style.left = `${l0 + (w0 - s.w)}px`;
    };
    const end = () => { s.pane.classList.remove('sizing'); edge.removeEventListener('pointermove', move); edge.removeEventListener('pointerup', end); edge.removeEventListener('pointercancel', end); };
    edge.addEventListener('pointermove', move); edge.addEventListener('pointerup', end); edge.addEventListener('pointercancel', end);
  });
}

addEventListener('message', (e: MessageEvent) => {
  if (!st || e.origin !== extOrigin) return;
  const d = e.data as { type?: string; sx?: number; sy?: number; cx?: number } | null;
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
  }
});
addEventListener('resize', () => { if (st) place(st); });
