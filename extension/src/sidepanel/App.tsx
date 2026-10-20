import type { AccessReport } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoState, describeLink } from '../shared/demo';
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

/** A aba que o painel acompanha. Na janela separada, a aba ativa da última janela normal focada. */
async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
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
  const [state, setState] = useState<TabState | undefined>(isDemo ? (params.has('batch') ? demoBatch() : demoState(params.get('field') ?? 'state')) : undefined);
  const [fallbackOrigin, setFallbackOrigin] = useState<string>();
  const [toast, setToast] = useState<string>();
  const toastTimer = useRef<number>();
  // Todo aviso é um toast: some sozinho, some ao clicar e some quando a análise troca.
  const showToast = (msg?: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    if (msg) toastTimer.current = window.setTimeout(() => setToast(undefined), 3200);
  };

  // Investigar outro campo do mesmo registro (a partir da linha do tempo).
  const investigateField = (f: string) => {
    if (isDemo) { showToast(); setState({ ...demoState(f), status: 'running' }); setTimeout(() => setState(demoState(f)), 650); return; }
    const tgt = state?.result?.target;
    if (!origin || !tgt) return;
    void send({ type: 'investigate', origin, target: { table: tgt.table, sysId: tgt.sysId, field: f } });
  };

  // Demonstração: a página que hospeda o painel troca o campo; links não saem do site.
  useEffect(() => {
    if (!isDemo) return;
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; field?: string } | null;
      if (d?.type === 'trail-demo' && d.field) { showToast(); scrollTo(0, 0); setState({ ...demoState(d.field), status: 'running' }); setTimeout(() => setState(demoState(d.field)), 650); }
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
      <header class="topbar">
        <div class="brand"><span class="mark"><TrailMark /></span>Trail</div>
        {origin && <span class="host" title={origin}>{origin.replace(/^https?:\/\//, '')}</span>}
        {level && <span class={`dot ${level === 'full' ? '' : level}`} title={level} />}
        <div class="actions">
          {isDemo && <span class="demo-badge">{s.demoBadge}</span>}
          <ThemeToggle />
          {!isWindow && (
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
        {state?.batch && !state.result && origin && state.status !== 'running' && <Batch b={state.batch} origin={origin} onOpen={(id) => { void send({ type: 'investigate', origin, target: { table: state.batch!.table, sysId: id, field: state.batch!.field } }); }} />}
        {state?.result && origin && state.status !== 'running' && <Result r={state.result} origin={origin} access={state.access} toast={(m) => showToast(m)} onField={investigateField} />}
        {!needsConnect && !state?.result && !state?.batch && state?.status !== 'running' && (
          <div class="empty">
            <EmptyIllustration />
            <div class="title">{s.emptyTitle}</div>
            <div>{s.noContext}</div>
          </div>
        )}
      </main>
      <ManualDrawer origin={origin} table={state?.ctx?.table ?? state?.result?.target.table} sysId={state?.ctx?.sysId ?? state?.result?.target.sysId} field={state?.result?.target.field} tabId={tabId} open={!state?.result && !state?.batch}
        onDemo={(f) => { showToast(); setState({ ...demoState(f), status: 'running' }); setTimeout(() => setState(demoState(f)), 650); }} />
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

function ManualDrawer({ origin, table, sysId, field, tabId, open, onDemo }: { origin?: string; table?: string; sysId?: string; field?: string; tabId?: number; open: boolean; onDemo: (field: string) => void }) {
  const [tbl, setTbl] = useState(table ?? 'incident');
  const [rec, setRec] = useState(sysId ?? '');
  const [fld, setFld] = useState(field ?? 'state');
  useEffect(() => { if (table) setTbl(table); if (sysId) setRec(sysId); if (field) setFld(field); }, [table, sysId, field]);
  // Aberto/fechado sob controle: a pessoa fecha pelo X (ou pelo título) e reabre pelo título.
  const [isOpen, setOpen] = useState(open);
  useEffect(() => setOpen(open), [open]);
  const go = async () => {
    if (isDemo) { onDemo(fld); return; }
    if (!origin || tabId === undefined) return;
    const target = /^[0-9a-f]{32}$/.test(rec) ? { table: tbl, sysId: rec, field: fld } : { table: tbl, number: rec, field: fld };
    await send({ type: 'investigate', origin, target });
  };
  return (
    <details class="drawer" open={isOpen} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{Glyph.search} {s.manualTitle}
        {isOpen && <button class="drawer-x" aria-label={s.p.close} title={s.p.close} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}>✕</button>}
      </summary>
      <div class="body">
        <div class="grid2">
          <div class="field"><label>{s.table}</label><input value={tbl} onInput={(e) => setTbl((e.target as HTMLInputElement).value.trim())} /></div>
          <div class="field"><label>{s.field}</label><input value={fld} onInput={(e) => setFld((e.target as HTMLInputElement).value.trim())} /></div>
        </div>
        <div class="field"><label>{s.record}</label><input value={rec} placeholder="INC0010001" onInput={(e) => setRec((e.target as HTMLInputElement).value.trim())} /></div>
        <div class="row">
          <button class="btn primary" onClick={go} disabled={!isDemo && (!origin || !tbl || !rec || !fld)}>{Glyph.search} {s.investigate}</button>
          {!origin && <span class="muted small">{s.notServiceNow}</span>}
        </div>
      </div>
    </details>
  );
}


/** Demonstração do lote: 12 incidentes, a categoria mudou por três causas. */
function demoBatch(): TabState {
  const mk = (n: number, type: string, name: string, grade: string, user = 'system') => ({ sysId: n.toString(16).padStart(32, '0'), display: `INC00${10100 + n}`, title: ['Impressora sem rede', 'VPN cai toda hora', 'Notebook lento', 'E-mail não sincroniza'][n % 4], status: 'done' as const,
    at: `2026-10-${10 + (n % 9)} 1${n % 9}:2${n % 6}:00`, oldValue: 'inquiry', newValue: n % 3 ? 'network' : 'hardware', user, changes: 1 + (n % 2), cause: { type, name, grade, score: grade === 'confirmed' ? 85 : 55, sysId: 'demo', table: 'sys_script' } });
  const items = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => mk(n, 'br_before', 'Categoria pelo grupo de suporte', 'confirmed')),
    ...[8, 9, 10].map((n) => mk(n, 'user_action', 'beth.anglin', 'confirmed', 'beth.anglin')),
    mk(11, 'import_set', 'Chamados do parceiro', 'confirmed'),
    { sysId: '0'.repeat(31) + 'c', display: 'INC0010112', title: 'Monitor piscando', status: 'unchanged' as const, changes: 0 },
  ];
  return { tabId: 0, status: 'idle', ctx: { origin: 'https://sua-instancia.service-now.com', surface: 'ui16' }, batch: { table: 'incident', field: 'category', items, status: 'done', startedAt: new Date().toISOString(), ms: 8400 } };
}
