import type { AccessReport } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoBatch, demoRecord, demoState, describeLink } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { applyTheme, getPrefs, resolvedTheme, savePrefs } from '../shared/prefs';
import { EmptyIllustration, Glyph, TrailMark } from '../shared/icons';
import { Result } from './Result';
import { Batch } from './Batch';
import { setTrackedTab } from '../shared/tabRef';
import { send, storageKey, type TabState } from '../shared/messages';
import { isEnabled, looksLikeServiceNow } from '../shared/instances';

const s = t(getPrefs().lang);
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
/** Aberto como janela separada (chrome.windows), não como painel lateral. */
const isWindow = params.has('window');
/** Painel flutuante: num iframe dentro da página do ServiceNow, preso à aba que o abriu. */
const isFloat = params.has('float');
/** Painel flutuante destacado numa janela que fica por cima de tudo (Picture-in-Picture de documento). */
const isPip = params.has('pip');
const floatTab = Number(params.get('tab'));
/** Onde este painel está: pedidos feitos daqui não abrem outro painel em outro lugar. */
const here = isFloat ? 'float' as const : isWindow ? 'window' as const : 'side' as const;
const toPage = (type: string, extra: Record<string, unknown> = {}) => { try { parent.postMessage({ type, ...extra }, '*'); } catch { /* fora do iframe */ } };

/** A aba que o painel acompanha. Na janela separada, a aba ativa da última janela normal focada. */
async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  if (isFloat) return chrome.tabs.get(floatTab).catch(() => undefined);
  if (isWindow) {
    try {
      const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'], populate: true });
      return w.tabs?.find((x) => x.active);
    } catch { return undefined; }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(resolvedTheme(getPrefs().theme));
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next); applyTheme(next);
    if (!isDemo) void savePrefs({ theme: next });
  };
  return <button class="icon-btn" title={s.toggleTheme} aria-label={s.toggleTheme} onClick={flip}>{theme === 'dark' ? Glyph.sun : Glyph.moon}</button>;
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<TabState | undefined>(isDemo ? (params.has('batch') ? (params.get('batch') === 'rec' ? demoRecord(params.has('wait')) : demoBatch()) : demoState(params.get('field') ?? 'state')) : undefined);
  const [fallbackOrigin, setFallbackOrigin] = useState<string>();
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<number>();
  // Todo aviso é um toast: some sozinho, some ao clicar e some quando a análise troca.
  const showToast = (msg?: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    if (msg) toastTimer.current = window.setTimeout(() => setToast(undefined), 3200);
  };

  // Investigar outro campo do mesmo registro (a partir da linha do tempo) ou registro inteiro no demo.
  const demoTimer = useRef<number>();
  const runDemoField = (f: string) => {
    window.clearTimeout(demoTimer.current);
    showToast(); scrollTo(0, 0);
    setState({ ...demoState(f), status: 'running' });
    demoTimer.current = window.setTimeout(() => setState(demoState(f)), 650);
  };
  const runDemoRecord = () => {
    window.clearTimeout(demoTimer.current);
    showToast(); scrollTo(0, 0);
    setState(demoRecord(true));
    demoTimer.current = window.setTimeout(() => setState(demoRecord(false)), 750);
  };
  const investigateField = (f: string) => {
    if (isDemo) { runDemoField(f); return; }
    const tgt = state?.result?.target;
    if (!origin || !tgt) return;
    void send({ type: 'investigate', origin, mode: here, target: { table: tgt.table, sysId: tgt.sysId, field: f } });
  };

  // Demonstração: a página que hospeda o painel troca o campo; links não saem do site.
  useEffect(() => {
    if (!isDemo) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; field?: string; batch?: string } | null;
      if (d?.type === 'trail-demo') {
        if (d.batch === 'rec' || d.field === '*') runDemoRecord();
        else if (d.field) runDemoField(d.field);
      }
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a) return;
      e.preventDefault();
      showToast(fmt(s.demoLink, { what: describeLink(a.getAttribute('href') ?? '') }));
    };
    addEventListener('message', onMsg);
    document.addEventListener('click', onClick, true);
    return () => { removeEventListener('message', onMsg); document.removeEventListener('click', onClick, true); };
  }, []);

  // Acompanha a aba: troca de análise só quando a outra aba já tem uma (ou começa uma agora).
  // Abrir um link do painel, a janela lado a lado ou uma aba qualquer não apaga o que está na tela.
  const tracked = useRef<number>();
  const shown = useRef<TabState>();
  shown.current = state;
  const active = useRef<number>();
  useEffect(() => {
    if (isDemo) return;
    let myWindow: number | undefined;
    const follow = (id: number, st: TabState | undefined, url?: string) => {
      tracked.current = id; setTabId(id); setTrackedTab(id); setState(st);
      try { if (url) setFallbackOrigin(new URL(url).origin); } catch { /* chrome:// */ }
    };
    void (async () => {
      if (!isWindow) myWindow = (await chrome.windows.getCurrent().catch(() => undefined))?.id;
      const tab = await currentTab();
      if (!tab?.id) return;
      active.current = tab.id;
      const key = storageKey.tab(tab.id);
      follow(tab.id, (await chrome.storage.session.get(key))[key] as TabState | undefined, tab.url);
      void refreshConnected(tab.url);
    })();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session') return;
      for (const [k, ch] of Object.entries(changes)) {
        const m = k.match(/^tab:(\d+)$/);
        if (!m) continue;
        const id = Number(m[1]);
        const st = ch.newValue as TabState | undefined;
        if (id === tracked.current) setState(st);
        else if (id === active.current && (st?.status === 'running' || st?.batch?.status === 'running')) { tracked.current = id; setTabId(id); setTrackedTab(id); setState(st); }
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    if (isFloat) { toPage('trail-float-ready'); return () => chrome.storage.onChanged.removeListener(onChange); }
    const consider = async (tab: chrome.tabs.Tab | undefined) => {
      if (!tab?.id) return;
      active.current = tab.id;
      void refreshConnected(tab.url);
      const key = storageKey.tab(tab.id);
      const st = (await chrome.storage.session.get(key))[key] as TabState | undefined;
      if (st?.result || st?.batch || st?.status === 'running') follow(tab.id, st, tab.url);
      else if (!tracked.current || !shown.current?.result) follow(tab.id, st, tab.url);
    };
    const onActivated = (info: chrome.tabs.TabActiveInfo) => {
      if (!isWindow && myWindow !== undefined && info.windowId !== myWindow) return; // outra janela (ex.: lado a lado)
      void chrome.tabs.get(info.tabId).then(consider).catch(() => undefined);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    // Na janela separada, trocar de janela do navegador também pode trocar a aba acompanhada.
    const onFocus = (id: number) => { if (isWindow && id !== chrome.windows.WINDOW_ID_NONE) void currentTab().then(consider); };
    chrome.windows?.onFocusChanged.addListener(onFocus);
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => { if (id === active.current && info.status === 'complete') void refreshConnected(tab.url); };
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.storage.onChanged.removeListener(onChange); chrome.tabs.onActivated.removeListener(onActivated);
      chrome.windows?.onFocusChanged.removeListener(onFocus); chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Instância da aba ativa ainda não conectada: o painel oferece conectar, em vez de ficar vazio.
  const [needsConnect, setNeedsConnect] = useState<string>();
  async function refreshConnected(url?: string) {
    if (!url || !looksLikeServiceNow(url)) { setNeedsConnect(undefined); return; }
    try {
      const o = new URL(url).origin;
      setNeedsConnect((await isEnabled(o)) ? undefined : o);
    } catch { setNeedsConnect(undefined); }
  }
  const connect = async () => {
    if (!needsConnect) return;
    const ok = await chrome.permissions.request({ origins: [`${needsConnect}/*`] });
    if (!ok) { showToast(s.permissionDenied); return; }
    await send({ type: 'activate', origin: needsConnect });
    setNeedsConnect(undefined);
    showToast(s.connected);
  };

  const origin = state?.ctx?.origin ?? fallbackOrigin;
  const level = state?.access?.level;

  return (
    <>
      <header class={`topbar ${isFloat && !isPip ? 'drag' : ''}`} title={isFloat && !isPip ? s.floatDragHint : undefined}
        onPointerDown={isFloat && !isPip ? (e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button,a')) return;
          e.preventDefault();
          const el = e.currentTarget as HTMLElement;
          el.setPointerCapture(e.pointerId);
          toPage('trail-float-drag', { sx: e.screenX, sy: e.screenY });
          const move = (ev: PointerEvent) => toPage('trail-float-move', { sx: ev.screenX, sy: ev.screenY, cx: ev.clientX });
          const end = (ev: PointerEvent) => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); toPage('trail-float-drop', { cx: ev.clientX }); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
        } : undefined}
        onDblClick={isFloat && !isPip ? (e) => { if (!(e.target as HTMLElement).closest('button,a')) toPage('trail-float-dock'); } : undefined}>
        {/* Flutuante: botões no estilo de janela do Mac (fechar, minimizar, sempre visível). */}
        {isFloat && (
          <span class="lights">
            <button class="light close" title={s.floatClose} aria-label={s.floatClose} onClick={() => toPage('trail-float-close')} />
            <button class="light min" title={s.floatMin} aria-label={s.floatMin} onClick={() => toPage('trail-float-min')} />
            <button class={`light pin ${isPip ? 'on' : ''}`} title={isPip ? s.floatUnpin : s.floatPin} aria-label={isPip ? s.floatUnpin : s.floatPin} aria-pressed={isPip} onClick={() => toPage('trail-float-pin')} />
          </span>
        )}
        {/* No painel do navegador, ele já mostra "Trail" em cima; no flutuante, este é o único cabeçalho e leva a marca. */}
        {isFloat && <span class="fmark" aria-hidden="true"><TrailMark /></span>}
        {isFloat && <b class="fname">Trail</b>}
        {origin && <span class="host" title={origin}>{origin.replace(/^https?:\/\//, '')}</span>}
        {level && <span class={`dot ${level === 'full' ? '' : level}`} title={level} />}
        <div class="actions">
          {isDemo && <span class="demo-badge">{s.demoBadge}</span>}
          <ThemeToggle />
          {!isWindow && !isFloat && (
            <button class="icon-btn" title={s.detach} aria-label={s.detach} onClick={() => {
              if (isDemo) { showToast(s.panelModeHint); return; }
              void send({ type: 'open-panel', mode: 'window' }).then(() => window.close());
            }}>{Glyph.detach}</button>
          )}
        </div>
      </header>
      <main class="wrap">
        {needsConnect && !state?.result && (
          <div class="card connect">
            <div class="title">{s.connectTitle}</div>
            <p class="muted small">{s.connectHint}</p>
            <button class="btn primary big full" onClick={connect}>{Glyph.plug} {s.activate}</button>
          </div>
        )}
        {state?.access && !state.result && <AccessNotice report={state.access} />}
        {state?.status === 'running' && <Loading />}
        {state?.status === 'error' && <div class="notice bad"><div class="title">{s.errorTitle}</div>{state.error}</div>}
        {state?.batch && !state.result && origin && state.status !== 'running' && <Batch b={state.batch} origin={origin} onOpen={(id, f) => { if (isDemo) { investigateField(f ?? state.batch!.field); return; } void send({ type: 'investigate', origin, mode: here, target: { table: state.batch!.table, sysId: id, field: f ?? state.batch!.field } }); }} />}
        {state?.result && origin && state.status !== 'running' && <Result r={state.result} origin={origin} access={state.access} toast={(m) => showToast(m)} onField={investigateField} />}
        {!needsConnect && !state?.result && !state?.batch && state?.status !== 'running' && (
          <div class="empty">
            <EmptyIllustration />
            <div class="title">{s.emptyTitle}</div>
            <div>{s.noContext}</div>
          </div>
        )}
      </main>
      <ManualDrawer origin={origin} table={state?.ctx?.table ?? state?.result?.target.table ?? state?.batch?.table} sysId={state?.ctx?.sysId ?? state?.result?.target.sysId ?? state?.batch?.sysId} field={state?.result?.target.field} tabId={tabId} open={!state?.result && !state?.batch}
        onDemo={(f, whole) => (whole ? runDemoRecord() : runDemoField(f))} />
      {toast && <div class="toast" role="status" onClick={() => showToast()}>{toast}</div>}
    </>
  );
}

/** Enquanto investiga: o rastro se desenha e uma lupa percorre o caminho, com o passo atual da perícia. */
function Loading() {
  const steps = s.p.loadSteps as string[];
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((x) => (x + 1) % steps.length), 650); return () => clearInterval(id); }, []);
  return (
    <div class="card loader" role="status" aria-live="polite">
      <svg class="trailsvg" viewBox="0 0 320 90" aria-hidden="true">
        <path class="ghost" d="M10 70 C 60 70, 70 20, 120 24 S 190 78, 232 60 S 290 12, 310 18" />
        <path class="draw" d="M10 70 C 60 70, 70 20, 120 24 S 190 78, 232 60 S 290 12, 310 18" />
        {[[10, 70], [120, 24], [232, 60], [310, 18]].map(([x, y], k) => <circle class="stop" cx={x} cy={y} r="5" style={`--k:${k}`} />)}
        <g class="lens"><circle r="9" /><path d="M6.5 6.5 L13 13" /></g>
      </svg>
      <div class="lsteps"><b key={i}>{steps[i]}</b></div>
    </div>
  );
}

function AccessNotice({ report }: { report: AccessReport }) {
  if (report.level === 'full') return null;
  const sources = report.denied.join(', ');
  return (
    <div class={`notice ${report.level === 'none' ? 'bad' : ''}`}>
      <div class="title">{report.level === 'none' ? s.accessNoneTitle : s.accessPartialTitle}</div>
      <div class="small">{report.level === 'none' ? s.accessNone : fmt(s.accessPartial, { sources })}</div>
      <div class="small muted" style="margin-top:4px"><code>{sources}</code></div>
    </div>
  );
}

function ManualDrawer({ origin, table, sysId, field, tabId, open, onDemo }: { origin?: string; table?: string; sysId?: string; field?: string; tabId?: number; open: boolean; onDemo: (field: string, whole: boolean) => void }) {
  const [tbl, setTbl] = useState(table ?? 'incident');
  const [rec, setRec] = useState(sysId ?? '');
  const [fld, setFld] = useState(field ?? 'state');
  const [whole, setWhole] = useState(false);
  useEffect(() => { if (table) setTbl(table); if (sysId) setRec(sysId); if (field) setFld(field); }, [table, sysId, field]);
  // Aberto/fechado sob controle: a pessoa fecha pelo X (ou pelo título) e reabre pelo título.
  const [isOpen, setOpen] = useState(open);
  useEffect(() => setOpen(open), [open]);
  const go = async () => {
    setOpen(false);
    if (isDemo) { onDemo(fld, whole); return; }
    if (!origin || tabId === undefined) return;
    if (whole) { await send({ type: 'record', origin, mode: here, table: tbl, record: rec }); return; }
    const target = /^[0-9a-f]{32}$/.test(rec) ? { table: tbl, sysId: rec, field: fld } : { table: tbl, number: rec, field: fld };
    await send({ type: 'investigate', origin, mode: here, target });
  };
  return (
    <details class="drawer" open={isOpen} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{Glyph.search} {s.manualTitle}
        {isOpen && <button class="drawer-x" aria-label={s.p.close} title={s.p.close} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}>✕</button>}
      </summary>
      <div class="body">
        <div class="seg2 manual-mode" role="group">
          <button aria-pressed={!whole} onClick={() => setWhole(false)}>{s.p.manualField}</button>
          <button aria-pressed={whole} onClick={() => setWhole(true)}>{s.p.manualRecord}</button>
        </div>
        <div class={whole ? '' : 'grid2'}>
          <div class="field"><label>{s.table}</label><input value={tbl} onInput={(e) => setTbl((e.target as HTMLInputElement).value.trim())} /></div>
          {!whole && <div class="field"><label>{s.field}</label><input value={fld} onInput={(e) => setFld((e.target as HTMLInputElement).value.trim())} /></div>}
        </div>
        {whole && <div class="muted small">{s.p.manualRecordHint}</div>}
        <div class="field"><label>{s.record}</label><input value={rec} placeholder="INC0010001" onInput={(e) => setRec((e.target as HTMLInputElement).value.trim())} /></div>
        <div class="row">
          <button class="btn primary" onClick={go} disabled={!isDemo && (!origin || !tbl || !rec || (!whole && !fld))}>{Glyph.search} {s.investigate}</button>
          {!origin && <span class="muted small">{s.notServiceNow}</span>}
        </div>
      </div>
    </details>
  );
}
