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
 *  - Setinha na lateral: recolhe o painel encostado para fora da tela, deixando só a setinha; outro clique abre de novo.
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

const CSS = `
:host{all:initial}
.pane{position:fixed;z-index:2147483645;top:${GAP}px;height:calc(100vh - ${2 * GAP}px);box-sizing:border-box;display:flex;flex-direction:column;
  background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.32),0 2px 8px rgba(0,0,0,.18);
  animation:slide .42s cubic-bezier(.16,1,.3,1) both;transform-origin:100% 50%;
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
.pane.shut{transform:translateX(calc(100% + ${GAP}px));box-shadow:none}
.pane.left.shut{transform:translateX(calc(-100% - ${GAP}px))}
.pane.shut .tab svg{transform:rotate(180deg)}
.pane.left.shut .tab svg{transform:none}
.snap{position:fixed;top:${GAP}px;height:calc(100vh - ${2 * GAP}px);border-radius:12px;width:${W}px;z-index:2147483644;background:rgba(43,179,159,.12);border:2px dashed rgba(43,179,159,.6);box-sizing:border-box;pointer-events:none;opacity:0;transition:opacity .15s}
.snap.on{opacity:1}
.bub{all:unset;position:fixed;right:20px;bottom:20px;z-index:2147483645;width:46px;height:46px;border-radius:50%;cursor:pointer;
  background:#032d42;display:grid;place-items:center;box-shadow:0 10px 28px rgba(0,0,0,.35),0 0 0 3px rgba(98,216,78,.25);
  animation:pop .32s cubic-bezier(.2,1.3,.4,1) both;transition:transform .15s}
.bub:hover{transform:scale(1.08)}
.bub:focus-visible{outline:2px solid #62d84e;outline-offset:3px}
.bub svg{width:24px;height:24px}
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
  /** Recolhido pela setinha. */
  shut: boolean;
}
let st: State | null = null;
let bubble: HTMLButtonElement | null = null;
const extOrigin = (() => { try { return new URL(chrome.runtime.getURL('')).origin; } catch { return ''; } })();

function save(open: boolean, min = false): void {
  chrome.runtime.sendMessage({ type: 'float-set', open, min }).catch(() => undefined);
}

function place(s: State): void {
  const vw = document.documentElement.clientWidth || innerWidth;
  s.w = Math.max(MIN_W, Math.min(s.w, vw - 40 - 2 * GAP));
  const p = s.pane;
  p.classList.toggle('left', s.dock === 'left');
  p.classList.toggle('free', s.dock === 'free');
  if (s.dock === 'free') { s.shut = false; p.classList.remove('shut'); }
  p.style.width = `${s.w}px`;
  if (s.dock === 'free') return;
  p.classList.toggle('shut', s.shut);
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

export function isFloatOpen(): boolean { return !!st || !!bubble; }

export function openFloat(tabId: number, opts: { theme?: 'dark' | 'light'; minimized?: boolean } = {}): void {
  if (st) { if (bubble) restore(); return; }
  const theme = opts.theme ?? 'dark';
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const src = chrome.runtime.getURL(`src/sidepanel/index.html?float=1&tab=${tabId}&theme=${theme}`);
  root.innerHTML = `<style>${CSS}</style><div class="snap"></div><div class="pane ${theme}" role="complementary" aria-label="Trail">${RZ}<button class="tab" type="button">${CHEVRON}</button><div class="body"><iframe src="${src}" title="Trail" allow="clipboard-write"></iframe></div></div>`;
  document.documentElement.appendChild(host);
  const pane = root.querySelector<HTMLElement>('.pane')!;
  st = { host, root, pane, tabId, dock: 'right', w: W, ready: false, src, theme, shut: false };
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
  if (st && !bubble) closeFloat(); else if (st) restore(); else openFloat(tabId, { theme });
}

export function closeFloat(persist = true): void {
  const s = st;
  if (!s) return;
  st = null;
  pip?.close(); pip = null;
  bubble?.remove(); bubble = null;
  if (persist) save(false);
  s.pane.classList.add('out');
  setTimeout(() => s.host.remove(), 260);
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
  s.shut = false;
  s.pane.style.display = '';
  s.pane.style.animation = 'none'; void s.pane.offsetWidth; s.pane.style.animation = '';
  place(s);
  save(true);
}

/** Abrir de novo ou investigar outra coisa com o painel minimizado: ele volta a aparecer. */
export function showFloat(tabId: number, theme?: 'dark' | 'light'): void {
  if (!st) openFloat(tabId, { theme }); else if (bubble) restore(); else if (st.shut) { st.shut = false; place(st); }
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
      s.shut = false;
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

/** Setinha da lateral: recolhe o painel encostado para fora da tela e traz de volta. */
function wireTab(s: State): void {
  const tab = s.root.querySelector<HTMLButtonElement>('.tab')!;
  const label = () => {
    const t = s.shut ? 'Abrir o painel' : 'Recolher o painel';
    tab.title = t; tab.setAttribute('aria-label', t); tab.setAttribute('aria-expanded', String(!s.shut));
  };
  label();
  tab.addEventListener('click', () => { s.shut = !s.shut; place(s); label(); });
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
    if (st === s && !bubble) { s.pane.style.display = ''; place(s); }
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
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || !st || bubble || e.defaultPrevented) return;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
  if (document.querySelector('dialog[open], .modal.in, .modal.show, [role="dialog"][aria-modal="true"]')) return;
  closeFloat();
});

addEventListener('message', (e: MessageEvent) => {
  if (!st || e.origin !== extOrigin) return;
  onPanelMessage(e.data as PanelMsg, false);
});
addEventListener('resize', () => { if (st) place(st); });
