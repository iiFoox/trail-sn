import type { AccessReport } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoState, describeLink } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { applyTheme, getPrefs, resolvedTheme, savePrefs } from '../shared/prefs';
import { EmptyIllustration, Glyph, TrailMark } from '../shared/icons';
import { Result } from './Result';
import { send, storageKey, type TabState } from '../shared/messages';

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
  const [state, setState] = useState<TabState | undefined>(isDemo ? demoState(params.get('field') ?? 'state') : undefined);
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

  useEffect(() => {
    if (isDemo) return;
    let key = '';
    void currentTab().then(async (tab) => {
      if (!tab?.id) return;
      setTabId(tab.id);
      try { if (tab.url) setFallbackOrigin(new URL(tab.url).origin); } catch { /* chrome:// etc. */ }
      key = storageKey.tab(tab.id);
      const o = await chrome.storage.session.get(key);
      setState(o[key] as TabState | undefined);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const ch = changes[key];
      if (area === 'session' && key && ch) setState(ch.newValue as TabState | undefined);
    };
    chrome.storage.onChanged.addListener(onChange);
    const onTab = () => void currentTab().then((tab) => { if (tab?.id !== undefined && tab.id !== tabId) location.reload(); });
    chrome.tabs.onActivated.addListener(onTab);
    // Na janela separada, trocar de janela do navegador também troca a aba acompanhada.
    const onFocus = (id: number) => { if (isWindow && id !== chrome.windows.WINDOW_ID_NONE) onTab(); };
    chrome.windows?.onFocusChanged.addListener(onFocus);
    return () => {
      chrome.storage.onChanged.removeListener(onChange); chrome.tabs.onActivated.removeListener(onTab);
      chrome.windows?.onFocusChanged.removeListener(onFocus);
    };
  }, []);

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
        {state?.access && !state.result && <AccessNotice report={state.access} />}
        {state?.status === 'running' && <Loading />}
        {state?.status === 'error' && <div class="notice bad"><div class="title">{s.errorTitle}</div>{state.error}</div>}
        {state?.result && origin && state.status !== 'running' && <Result r={state.result} origin={origin} access={state.access} toast={(m) => showToast(m)} onField={investigateField} />}
        {!state?.result && state?.status !== 'running' && (
          <div class="empty">
            <EmptyIllustration />
            <div class="title">{s.emptyTitle}</div>
            <div>{s.noContext}</div>
          </div>
        )}
      </main>
      <ManualDrawer origin={origin} table={state?.ctx?.table ?? state?.result?.target.table} sysId={state?.ctx?.sysId ?? state?.result?.target.sysId} field={state?.result?.target.field} tabId={tabId} open={!state?.result}
        onDemo={(f) => { showToast(); setState({ ...demoState(f), status: 'running' }); setTimeout(() => setState(demoState(f)), 650); }} />
      {toast && <div class="toast" role="status" onClick={() => showToast()}>{toast}</div>}
    </>
  );
}

function Loading() {
  return (
    <div class="card">
      <div class="row"><span class="spin" /> <b>{s.running}</b></div>
      <div class="skeleton" style="width:60%" /><div class="skeleton" /><div class="skeleton" style="width:80%" />
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
  const go = async () => {
    if (isDemo) { onDemo(fld); return; }
    if (!origin || tabId === undefined) return;
    const target = /^[0-9a-f]{32}$/.test(rec) ? { table: tbl, sysId: rec, field: fld } : { table: tbl, number: rec, field: fld };
    await send({ type: 'investigate', origin, target });
  };
  return (
    <details class="drawer" open={open}>
      <summary>{Glyph.search} {s.manualTitle}</summary>
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

