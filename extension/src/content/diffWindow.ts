/**
 * Janela "lado a lado" por cima da própria página do ServiceNow, no estilo de uma janela do macOS:
 * cantos arredondados, botões fechar / minimizar / maximizar, arrastar pela barra de título,
 * redimensionar pelo canto, duplo clique maximiza e Esc fecha. O conteúdo é a página de diferença
 * da extensão (src/diff) num iframe; o painel deixa o texto na sessão e passa só a chave.
 */
export interface DiffWindowRequest { key: string; title: string; sub?: string; theme?: 'dark' | 'light'; from?: 'right' | 'left'; labels?: { close: string; min: string; max: string } }

const HOST_ID = 'trail-diff-window';

const CSS = `
:host{all:initial}
.win{position:fixed;z-index:2147483646;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;
  background:var(--bg);border:1px solid var(--line);box-shadow:0 28px 80px rgba(0,0,0,.45),0 0 0 .5px rgba(0,0,0,.4);
  font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--fg);
  transform-origin:var(--ox,100%) var(--oy,50%);animation:zoom .42s cubic-bezier(.2,.9,.25,1.12) both;
  transition:left .32s cubic-bezier(.2,.8,.2,1),top .32s cubic-bezier(.2,.8,.2,1),width .32s cubic-bezier(.2,.8,.2,1),height .32s cubic-bezier(.2,.8,.2,1),border-radius .32s}
.win.dragging,.win.resizing{transition:none}
.win.dark{--bg:#0f171d;--bar:#16212a;--bar2:#1b2833;--line:#2a3a46;--fg:#e8edf1;--mu:#8c99a5}
.win.light{--bg:#ffffff;--bar:#ececf0;--bar2:#e2e3e8;--line:#cfd3da;--fg:#1d2329;--mu:#5d6772}
.win.max{border-radius:10px}
.win.closing{animation:shrink .26s cubic-bezier(.4,0,.6,1) both}
.win.mini{transform-origin:50% 50%;animation:genie .34s cubic-bezier(.4,0,.2,1) both}
.bar{height:38px;flex:none;display:flex;align-items:center;gap:12px;padding:0 12px;background:linear-gradient(180deg,var(--bar),var(--bar2));
  border-bottom:1px solid var(--line);cursor:default;user-select:none;-webkit-user-select:none}
.lights{display:flex;gap:8px}
.lights button{all:unset;width:12px;height:12px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25);color:rgba(0,0,0,.55);font:700 9px/1 system-ui,sans-serif}
.lights button span{opacity:0;transition:opacity .12s;pointer-events:none;transform:translateY(-.5px)}
.lights:hover button span,.lights button:focus-visible span{opacity:1}
.lights button:focus-visible{outline:2px solid #4c9ffe;outline-offset:2px}
.lights .c{background:#ff5f57}.lights .m{background:#febc2e}.lights .x{background:#28c840}
.win:not(.focus) .lights:not(:hover) button{background:var(--line)}
.title{flex:1;min-width:0;text-align:center;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:52px}
.title small{font-weight:400;color:var(--mu);margin-left:6px}
.body{flex:1;position:relative;background:var(--bg)}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--bg)}
.win.dragging iframe,.win.resizing iframe{pointer-events:none}
.grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:2}
.grip:after{content:"";position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid var(--mu);border-bottom:2px solid var(--mu);opacity:.5;border-radius:0 0 2px 0}
.dock{position:fixed;z-index:2147483647;left:50%;translate:-50% 0;bottom:22px;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 10px;border-radius:999px;
  background:var(--bar);color:var(--fg);border:1px solid var(--line);box-shadow:0 12px 32px rgba(0,0,0,.35);cursor:pointer;
  font:600 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;animation:pop .3s cubic-bezier(.2,1.3,.4,1) both}
.dock.dark{--bar:#16212a;--line:#2a3a46;--fg:#e8edf1}.dock.light{--bar:#fff;--line:#cfd3da;--fg:#1d2329}
.dock i{width:22px;height:22px;border-radius:6px;background:#1f8476;display:grid;place-items:center}
.dock i svg{width:13px;height:13px}
@keyframes zoom{from{opacity:0;transform:scale(.35) translate(var(--tx,30%),0)}60%{opacity:1}to{opacity:1;transform:none}}
@keyframes shrink{to{opacity:0;transform:scale(.6)}}
@keyframes genie{to{opacity:0;transform:translate(var(--gx,0),var(--gy,40vh)) scale(.12,.05)}}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.win,.win.closing,.win.mini,.dock{animation:none!important;transition:none!important}}
`;

const MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"><path d="M3 18c3-7 6-7 9 0s6 7 8-7"/></svg>';

let current: { host: HTMLElement; close: () => void } | null = null;

export function openDiffWindow(req: DiffWindowRequest): void {
  current?.close();
  const theme = req.theme ?? 'dark';
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(1180, vw - 48), h = Math.min(760, vh - 48);
  const rect = { left: Math.round((vw - w) / 2), top: Math.max(16, Math.round((vh - h) / 2)), width: w, height: h };
  const src = chrome.runtime.getURL(`src/diff/index.html?k=${encodeURIComponent(req.key)}&embed=1&theme=${theme}`);
  const L = req.labels ?? { close: 'Fechar', min: 'Minimizar', max: 'Maximizar' };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  root.innerHTML = `<style>${CSS}</style>
    <div class="win ${theme} focus" role="dialog" aria-label="${esc(req.title)}">
      <div class="bar">
        <div class="lights">
          <button class="c" data-a="close" aria-label="${esc(L.close)}" title="${esc(L.close)}"><span>✕</span></button>
          <button class="m" data-a="min" aria-label="${esc(L.min)}" title="${esc(L.min)}"><span>−</span></button>
          <button class="x" data-a="max" aria-label="${esc(L.max)}" title="${esc(L.max)}"><span>+</span></button>
        </div>
        <div class="title">${esc(req.title)}${req.sub ? `<small>${esc(req.sub)}</small>` : ''}</div>
      </div>
      <div class="body"><iframe src="${src}" title="${esc(req.title)}"></iframe></div>
      <div class="grip" aria-hidden="true"></div>
    </div>`;
  document.documentElement.appendChild(host);
  const win = root.querySelector<HTMLElement>('.win')!;
  const place = (r: typeof rect) => Object.assign(win.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  place(rect);
  // Abre "saindo" do lado do painel (direita), como se a janela viesse de lá.
  win.style.setProperty('--ox', req.from === 'left' ? '0%' : '100%');
  win.style.setProperty('--tx', req.from === 'left' ? '-30%' : '30%');

  let maxed = false;
  let saved = { ...rect };
  const maximize = () => {
    maxed = !maxed;
    win.classList.toggle('max', maxed);
    if (maxed) { saved = { left: win.offsetLeft, top: win.offsetTop, width: win.offsetWidth, height: win.offsetHeight }; place({ left: 10, top: 10, width: innerWidth - 20, height: innerHeight - 20 }); }
    else place(saved);
  };

  let dock: HTMLElement | null = null;
  const minimize = () => {
    // "Gênio": encolhe em direção à pílula que fica no centro, embaixo.
    win.style.setProperty('--gx', `${innerWidth / 2 - (win.offsetLeft + win.offsetWidth / 2)}px`);
    win.style.setProperty('--gy', `${innerHeight - 40 - (win.offsetTop + win.offsetHeight / 2)}px`);
    win.classList.add('mini');
    setTimeout(() => {
      win.style.display = 'none';
      win.classList.remove('mini');
      dock = document.createElement('div');
      dock.className = `dock ${theme}`;
      dock.setAttribute('role', 'button');
      dock.tabIndex = 0;
      dock.innerHTML = `<i>${MARK}</i>${esc(req.title)}`;
      const restore = () => { dock?.remove(); dock = null; win.style.display = ''; win.style.animation = 'none'; void win.offsetWidth; win.style.animation = ''; };
      dock.addEventListener('click', restore);
      dock.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') restore(); });
      root.appendChild(dock);
    }, 320);
  };

  const close = () => {
    removeEventListener('keydown', onKey, true);
    removeEventListener('message', onMsg);
    if (current?.host === host) current = null;
    win.classList.add('closing');
    setTimeout(() => host.remove(), 240);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dock) { e.stopPropagation(); close(); } };
  // O iframe da diferença avisa quando a pessoa aperta Esc lá dentro.
  const extOrigin = new URL(chrome.runtime.getURL('')).origin;
  let ready = false;
  const onMsg = (e: MessageEvent) => {
    if (e.origin !== extOrigin) return;
    const t = (e.data as { type?: string })?.type;
    if (t === 'trail-diff-esc') close();
    if (t === 'trail-diff-ready') ready = true;
  };
  // Se a página bloquear o iframe da extensão (política de segurança da instância), cai para uma janela do navegador.
  setTimeout(() => { if (!ready && host.isConnected) { close(); chrome.runtime.sendMessage({ type: 'open-diff-popup', key: req.key }).catch(() => undefined); } }, 4000);
  addEventListener('keydown', onKey, true);
  addEventListener('message', onMsg);

  root.querySelectorAll<HTMLButtonElement>('.lights button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = b.dataset.a;
    if (a === 'close') close(); else if (a === 'min') minimize(); else maximize();
  }));

  // Arrastar pela barra de título.
  const bar = root.querySelector<HTMLElement>('.bar')!;
  bar.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button')) maximize(); });
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
    if (maxed) maximize();
    const sx = e.clientX - win.offsetLeft, sy = e.clientY - win.offsetTop;
    win.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const left = Math.min(Math.max(ev.clientX - sx, 40 - win.offsetWidth), innerWidth - 40);
      const top = Math.min(Math.max(ev.clientY - sy, 0), innerHeight - 38);
      win.style.left = `${left}px`; win.style.top = `${top}px`;
    };
    const up = () => { win.classList.remove('dragging'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });

  // Redimensionar pelo canto.
  const grip = root.querySelector<HTMLElement>('.grip')!;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, sw = win.offsetWidth, sh = win.offsetHeight;
    win.classList.add('resizing');
    grip.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      win.style.width = `${Math.max(520, Math.min(innerWidth - win.offsetLeft - 8, sw + ev.clientX - sx))}px`;
      win.style.height = `${Math.max(320, Math.min(innerHeight - win.offsetTop - 8, sh + ev.clientY - sy))}px`;
    };
    const up = () => { win.classList.remove('resizing'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  win.addEventListener('pointerdown', () => win.classList.add('focus'));
  current = { host, close };
}
