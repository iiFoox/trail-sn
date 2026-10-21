import type { AccessReport } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoBatch, demoFormStates, demoRecord, demoState, describeLink } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';
import { EmptyIllustration, Glyph, TrailMark } from '../shared/icons';
import { humanField } from './format';
import { Loading } from './Loading';
import { Settings } from './Settings';
import { Result } from './Result';
import { Batch } from './Batch';
import { setTrackedTab } from '../shared/tabRef';
import { askForm, send, storageKey, type ObservedField, type TabState } from '../shared/messages';
import { FieldLock, useObserved } from './FieldLock';
import { isEnabled, looksLikeServiceNow } from '../shared/instances';
import { ErrorMsg } from './ErrorMsg';

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

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<TabState | undefined>(isDemo ? demoInitial() : undefined);
  const [fallbackOrigin, setFallbackOrigin] = useState<string>();
  // "Por que está bloqueado?" pedido pela gaveta (um campo qualquer, inclusive escondido): vista própria.
  const [lock, setLock] = useState<{ table: string; sysId: string; field: string } | undefined>(isDemo && params.get('lockfield') ? { table: 'incident', sysId: 'INC0010001', field: params.get('lockfield')! } : undefined);
  useEffect(() => { if (!isDemo || !params.get('lockfield')) setLock(undefined); }, [state?.result?.target.field, state?.result?.target.sysId, state?.batch?.startedAt]);
  const [settings, setSettings] = useState(false);
  // O chip "Acesso parcial" do cabeçalho abre (e fecha) a explicação do que os papéis deixam ver.
  const [showAccess, setShowAccess] = useState(false);
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
    void send({ type: 'investigate', origin, mode: here, tabId: tracked.current, target: { table: tgt.table, sysId: tgt.sysId, field: f } });
  };

  /** "Tentar de novo" depois de um erro: refaz o último pedido (no demo, a análise de State). */
  const retry = () => {
    if (isDemo) { runDemoField(state?.pending?.target.field ?? 'state'); return; }
    const p = state?.pending;
    if (!origin || !p) return;
    void send({ type: 'investigate', origin, mode: here, tabId: tracked.current, target: p.target, ...(p.label ? { label: p.label } : {}), ...(p.display ? { display: p.display } : {}) });
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
    if (isFloat) {
      toPage('trail-float-ready');
      // Esc fecha o painel flutuante, a não ser que algo dentro dele (diferença em tela cheia, lista aberta) já tenha usado a tecla.
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTimeout(() => { if (!e.defaultPrevented) toPage('trail-float-close'); }); };
      addEventListener('keydown', esc);
      return () => { chrome.storage.onChanged.removeListener(onChange); removeEventListener('keydown', esc); };
    }
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
        {/* No painel do navegador, ele já mostra "Trail" em cima; no flutuante, este é o único cabeçalho e leva a marca. */}
        {isFloat && <span class="fmark" aria-hidden="true"><TrailMark /></span>}
        {isFloat && <b class="fname">Trail</b>}
        {origin && <span class="host" title={origin}>{origin.replace(/^https?:\/\//, '')}</span>}
        {level && level !== 'full' && <button class={`acc-chip ${level}`} aria-expanded={showAccess} title={s.p.ux.accChipHint} onClick={() => setShowAccess(!showAccess)}>{s.accessLevel[level]}</button>}
        <div class="actions">
          {isDemo && <span class="demo-badge">{s.demoBadge}</span>}
          {/* Ordem: configurações, painel lateral, fechar. O tema fica só nas Configurações. */}
          <button class={`icon-btn ${settings ? 'on' : ''}`} title={s.settings} aria-label={s.settings} aria-expanded={settings} onClick={() => setSettings(!settings)}>{Glyph.gear}</button>
          {isFloat && !isDemo && (
            <button class="icon-btn" title={s.floatToSide} aria-label={s.floatToSide} onClick={() => {
              // sidePanel.open precisa do gesto: chamado direto no clique, antes de qualquer await.
              void chrome.sidePanel.open({ tabId: floatTab })
                .then(() => toPage('trail-float-close'))
                .catch(() => send({ type: 'open-panel', mode: 'side' }).then(() => toPage('trail-float-close')));
            }}>{Glyph.toSide}</button>
          )}
          {isFloat && <button class="icon-btn" title={isPip ? s.floatUnpin : s.floatHide} aria-label={isPip ? s.floatUnpin : s.floatHide} onClick={() => toPage(isPip ? 'trail-float-pin' : 'trail-float-min')}>{Glyph.close}</button>}
          {!isWindow && !isFloat && (
            <button class="icon-btn" title={s.toFloat} aria-label={s.toFloat} onClick={() => {
              if (isDemo) { showToast(s.panelModeHint); return; }
              // Do painel lateral do Edge volta para o painel flutuante na página (sem o Trail na aba, o worker abre a janela).
              void send({ type: 'open-panel', mode: 'float' }).then(() => window.close());
            }}>{Glyph.detach}</button>
          )}
        </div>
      </header>
      {settings && <Settings demo={isDemo} canPin={isFloat && !isPip && !isDemo} onPin={() => { setSettings(false); toPage('trail-float-pin'); }} onClose={() => setSettings(false)} />}
      <main class="wrap">
        {lock && origin && <LockPage target={lock} origin={origin} onBack={() => setLock(undefined)} />}
        {!lock && <>
        {needsConnect && !state?.result && (
          <div class="card connect">
            <div class="title">{s.connectTitle}</div>
            <p class="muted small">{s.connectHint}</p>
            <button class="btn primary big full" onClick={connect}>{Glyph.plug} {s.activate}</button>
          </div>
        )}
        {state?.access && (showAccess || (!state.result && state.status !== 'error')) && <AccessNotice report={state.access} />}
        {state?.status === 'running' && <Loading steps={s.p.loadSteps as string[]} head={state.pending ? `${state.pending.display ?? state.pending.target.number ?? state.pending.target.table} · ${state.pending.label ?? humanField(state.pending.target.field)}` : undefined} />}
        {state?.status === 'error' && (
          <div class="notice bad err-box">
            <div class="title">{s.errorTitle}</div>
            <ErrorMsg msg={state.error ?? ''} />
            {(isDemo || state.pending) && <div class="row"><button class="btn sm primary" onClick={retry}>{Glyph.refresh} {s.p.ux.retry}</button></div>}
          </div>
        )}
        {state?.batch && !state.result && origin && state.status !== 'running' && <Batch b={state.batch} origin={origin} onOpen={(id, f) => { if (isDemo) { investigateField(f ?? state.batch!.field); return; } void send({ type: 'investigate', origin, mode: here, tabId, target: { table: state.batch!.table, sysId: id, field: f ?? state.batch!.field } }); }} />}
        {state?.result && origin && state.status !== 'running' && <Result r={state.result} origin={origin} access={state.access} {...(state.ctx?.userName ? { me: state.ctx.userName } : {})} toast={(m) => showToast(m)} onField={investigateField} />}
        {!needsConnect && !state?.result && !state?.batch && state?.status !== 'running' && state?.status !== 'error' && (
          <div class="empty">
            <EmptyIllustration />
            <div class="title">{s.emptyTitle}</div>
            <div>{s.noContext}</div>
          </div>
        )}
        </>}
      </main>
      <ManualDrawer origin={origin} table={state?.ctx?.table ?? state?.result?.target.table ?? state?.batch?.table} sysId={state?.ctx?.sysId ?? state?.result?.target.sysId ?? state?.batch?.sysId} field={state?.result?.target.field} tabId={tabId} open={!state?.result && !state?.batch && !lock}
        onDemo={(f, whole) => (whole ? runDemoRecord() : runDemoField(f))} onLock={(t) => { setLock(t); scrollTo(0, 0); }} />
      {toast && <div class="toast" role="status" onClick={() => showToast()}>{toast}</div>}
    </>
  );
}

/** Estado inicial da demonstração (`?demo=1`): o campo pedido, o lote, o registro inteiro ou os estados do painel. */
function demoInitial(): TabState | undefined {
  if (params.has('empty')) return undefined;
  if (params.has('batch')) return params.get('batch') === 'rec' ? demoRecord(params.has('wait')) : demoBatch();
  const st = demoState(params.get('field') ?? 'state');
  const pending = { target: { table: 'incident', field: st.result!.target.field }, label: st.result!.fieldLabel ?? humanField(st.result!.target.field), display: 'INC0010001' };
  if (params.has('access')) return { ...st, result: undefined, status: 'idle' };
  if (params.has('run')) return { ...st, result: undefined, status: 'running', pending };
  if (params.has('err')) return { ...st, result: undefined, status: 'error', pending, error: params.get('err') === '401' ? 'HTTP 401 Unauthorized' : 'Record unavailable: the instance did not answer (timeout)' };
  return st;
}

/**
 * O que os papéis de quem está logado deixam o Trail ver, em palavras e não em nomes de tabela.
 * O Trail usa a sessão da pessoa: o que ela lê entra como prova; o resto fica de fora e é dito aqui.
 */
const CAPS: { key: string; sources: string[] }[] = [
  { key: 'who', sources: ['sys_audit'] },
  { key: 'rules', sources: ['sys_script', 'sys_script_include'] },
  { key: 'flows', sources: ['sys_flow_context', 'wf_context'] },
  { key: 'jobs', sources: ['sysauto_script'] },
  { key: 'events', sources: ['sysevent', 'sysevent_script_action'] },
  { key: 'actions', sources: ['sys_ui_action'] },
  { key: 'tx', sources: ['syslog_transaction'] },
];
const joinList = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} ${s.p.ux.and} ${xs[xs.length - 1]}`);
function AccessNotice({ report }: { report: AccessReport }) {
  if (report.level === 'full') return null;
  // Só demorou a responder (não é 401/403): aviso leve, sem lista.
  if (!report.denied.length && report.slow?.length) {
    return (
      <div class="notice">
        <div class="title">{s.accessSlowTitle}</div>
        <div class="small">{fmt(s.accessSlow, { sources: report.slow.join(', ') })}</div>
      </div>
    );
  }
  const denied = new Set<string>(report.denied);
  const caps = CAPS.map((c) => ({ ...c, ok: !c.sources.some((x) => denied.has(x)) }));
  const capText = s.cap as Record<string, string>;
  const short = s.p.ux.capShort as Record<string, string>;
  // "who" sem auditoria ainda é parcial: o histórico do formulário mostra parte dos campos.
  const sees = caps.filter((c) => c.ok || c.key === 'who');
  const blind = caps.filter((c) => !c.ok);
  const lead = blind.length ? fmt(s.p.ux.capLead, { ok: joinList(sees.map((c) => (c.key === 'who' && !c.ok ? short.whoHistory! : short[c.key]!))), no: joinList(blind.filter((c) => c.key !== 'who').map((c) => short[c.key]!)) }) : '';
  return (
    <div class="notice caps">
      <div class="title">{s.capTitle}</div>
      {lead && <p class="small cap-lead">{lead}</p>}
      <div class="caps2">
        <div class="col ok"><b>{s.p.ux.capSee}</b><ul>{sees.map((c) => <li><span class="mk" aria-hidden="true">{c.ok ? '✓' : '◐'}</span>{capText[c.key]}{!c.ok && <small>{s.capWhoHistory}</small>}</li>)}</ul></div>
        {blind.some((c) => c.key !== 'who') && <div class="col no"><b>{s.p.ux.capNotSee}</b><ul>{blind.filter((c) => c.key !== 'who').map((c) => <li><span class="mk" aria-hidden="true">–</span>{capText[c.key]}</li>)}</ul></div>}
      </div>
      <div class="small muted">{s.capHint}</div>
      <details class="captech"><summary>{s.capTech}</summary><code>{report.denied.join(', ')}</code></details>
    </div>
  );
}

/** Vista "Por que está bloqueado?" aberta pela gaveta: o registro, o campo e as regras. */
function LockPage({ target, origin, onBack }: { target: { table: string; sysId: string; field: string }; origin: string; onBack: () => void }) {
  const observed = useObserved(target.table, target.sysId, target.field);
  return (
    <div class="res lk-page">
      <button class="link lk-back" onClick={onBack}>← {s.p.lkBack}</button>
      <div class="headcard"><div class="rec"><b>{target.sysId.length === 32 ? target.table : target.sysId}</b></div><div class="chg"><span class="fld">{observed?.label || target.field}</span></div></div>
      <FieldLock target={{ ...target, ...(observed?.label ? { label: observed.label } : {}) }} origin={origin} observed={observed} />
    </div>
  );
}

/** Prefixo do número → tabela (INC0010001 → incident). Sem prefixo conhecido, vale a tabela da página ou o "Avançado". */
const PREFIX: Record<string, string> = { INC: 'incident', CHG: 'change_request', CTASK: 'change_task', PRB: 'problem', PTASK: 'problem_task', RITM: 'sc_req_item', REQ: 'sc_request', SCTASK: 'sc_task', TASK: 'task', KB: 'kb_knowledge', IMS: 'interaction', STRY: 'rm_story' };
export function tableForNumber(n: string): string | undefined {
  const m = n.trim().toUpperCase().match(/^([A-Z]+)\d{3,}$/);
  return m ? PREFIX[m[1]!] : undefined;
}

/**
 * Gaveta "Investigar": pede só o número do registro (a tabela sai do prefixo) e o campo por uma lista com os nomes
 * do formulário. Tabela e campo técnicos ficam em "Avançado".
 */
function ManualDrawer({ origin, table, sysId, field, tabId, open, onDemo, onLock }: { origin?: string; table?: string; sysId?: string; field?: string; tabId?: number; open: boolean; onDemo: (field: string, whole: boolean) => void; onLock: (t: { table: string; sysId: string; field: string }) => void }) {
  const [rec, setRec] = useState(sysId && !/^[0-9a-f]{32}$/.test(sysId) ? sysId : '');
  const [fld, setFld] = useState(field ?? 'state');
  const [advTable, setAdvTable] = useState('');
  const [adv, setAdv] = useState(false);
  const [whole, setWhole] = useState(false);
  useEffect(() => { if (field) setFld(field); }, [table, sysId, field]);
  // Aberto/fechado sob controle: a pessoa fecha pelo X (ou pelo título) e reabre pelo título.
  const [isOpen, setOpen] = useState(open);
  useEffect(() => setOpen(open), [open]);
  // Sugestões de campo: os do formulário aberto (inclusive escondidos), lidos do g_form.
  const [sugg, setSugg] = useState<ObservedField[]>([]);
  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    void (isDemo ? Promise.resolve({ fields: demoFormStates() }) : askForm<{ fields?: ObservedField[] }>(tabId, { type: 'trail-form-states', ...(table ? { table } : {}) }))
      .then((x) => { if (alive) setSugg(x?.fields ?? []); });
    return () => { alive = false; };
  }, [isOpen, table, sysId]);
  // Registro: o número digitado ou, vazio, o registro aberto na página.
  const number = rec.trim();
  const tbl = advTable.trim() || (number ? tableForNumber(number) : undefined) || table || '';
  const recordRef = number || sysId || '';
  const sameTable = !table || tbl === table;
  const options = sameTable ? [...sugg].filter((f) => f.label).sort((a, b) => a.label!.localeCompare(b.label!)) : [];
  const needAdvanced = !!number && !tableForNumber(number) && !advTable.trim() && !table;
  const lockIt = () => {
    if (!tbl || !recordRef || !fld) return;
    setOpen(false);
    onLock({ table: tbl, sysId: recordRef, field: fld });
  };
  const go = async () => {
    setOpen(false);
    if (isDemo) { onDemo(fld, whole); return; }
    if (!origin || tabId === undefined || !tbl || !recordRef) return;
    if (whole) { await send({ type: 'record', origin, mode: here, tabId, table: tbl, record: recordRef }); return; }
    const target = /^[0-9a-f]{32}$/.test(recordRef) ? { table: tbl, sysId: recordRef, field: fld } : { table: tbl, number: recordRef, field: fld };
    const label = options.find((o) => o.field === fld)?.label;
    await send({ type: 'investigate', origin, mode: here, tabId, target, ...(label ? { label } : {}), ...(number ? { display: number.toUpperCase() } : {}) });
  };
  const ready = isDemo || (!!origin && !!tbl && !!recordRef && (whole || !!fld));
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
        <div class="field md-rec"><label>{s.p.ux.mdNumber}</label><input value={rec} placeholder={sysId && /^[0-9a-f]{32}$/.test(sysId) ? s.p.ux.mdThisRecord : 'INC0010001'} onInput={(e) => setRec((e.target as HTMLInputElement).value.trim())} /></div>
        {!whole && (
          <div class="field md-field"><label>{s.field}</label>
            {options.length && !adv
              ? <select value={fld} onChange={(e) => setFld((e.target as HTMLSelectElement).value)}>
                  {!options.some((o) => o.field === fld) && <option value={fld}>{fld}</option>}
                  {options.map((f) => <option value={f.field}>{f.label}{f.visible === false ? ` · ${(s.p.lkAspect as Record<string, string>).hidden!.toLowerCase()}` : ''}</option>)}
                </select>
              : <input value={fld} list="trail-field-sugg" autocomplete="off" placeholder="state" onInput={(e) => setFld((e.target as HTMLInputElement).value.trim())} />}
            <datalist id="trail-field-sugg">{sugg.map((f) => <option value={f.field}>{f.label ?? f.field}</option>)}</datalist>
          </div>
        )}
        {whole && <div class="muted small">{s.p.manualRecordHint}</div>}
        <details class="md-adv" open={adv || needAdvanced} onToggle={(e) => setAdv((e.currentTarget as HTMLDetailsElement).open)}>
          <summary class="small">{s.p.ux.mdAdvanced}</summary>
          <div class="grid2">
            <div class="field"><label>{s.table}</label><input value={advTable} placeholder={tbl || 'incident'} onInput={(e) => setAdvTable((e.target as HTMLInputElement).value.trim())} /></div>
            {!whole && <div class="field"><label>{s.p.ux.mdTechField}</label><input class="md-tech" value={fld} list="trail-field-sugg" autocomplete="off" onInput={(e) => setFld((e.target as HTMLInputElement).value.trim())} /></div>}
          </div>
          {needAdvanced && <div class="muted small">{s.p.ux.mdNeedTable}</div>}
        </details>
        <div class="row">
          <button class="btn primary" onClick={go} disabled={!ready}>{Glyph.search} {s.investigate}</button>
          {!whole && <button class="btn lk-check" onClick={lockIt} disabled={!isDemo && !ready}>{s.p.lkCheck}</button>}
          {!origin && <span class="muted small">{s.notServiceNow}</span>}
        </div>
      </div>
    </details>
  );
}
