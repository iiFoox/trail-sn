/**
 * Resultado da investigação em quatro abas, cada uma responde uma pergunta:
 *  - Resposta: o que mudou, quem ou o quê, com que certeza (frase simples no topo);
 *  - Como aconteceu: o momento da mudança (rastro, tempo do salvamento) e as provas;
 *  - Histórico: as mudanças do campo e do registro, o que rodou nele e quem o enxerga;
 *  - Regras do campo: estado agora, quem grava, quem depende, simular um valor e comparar instâncias.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 */
import type { AccessReport, Change, Investigation } from '@trail/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs, resolvedTheme } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { LockCard, useObserved } from './FieldLock';
import { diffLines, looksLong } from '../shared/diff';
import { DiffView, type DiffLabels } from '../shared/DiffView';
import { Val } from './Val';
import { demoParam, fieldName, isDemo, plural, secs, traceDaysLeft, valueLabel, when } from './format';
import { Answer } from './Answer';
import { How } from './How';
import { HistoryTab } from './HistoryTab';
import { RulesTab, type RulesTool } from './RulesTab';

export { refLink, humanField, fieldName, parts, when, valueLabel, plural, localizeTimes, factText, traceTitle, lossReason, traceDaysLeft, conflictLines } from './format';

const lang = getPrefs().lang;
const s = t(lang);
const P = s.p;
const U = P.ux;

export type Tab = 'answer' | 'how' | 'history' | 'rules';
export const TABS: Tab[] = ['answer', 'how', 'history', 'rules'];
/** Nomes das abas antigas (o site e links antigos ainda os usam). */
const ALIAS: Record<string, Tab> = { trace: 'how', proof: 'how', flows: 'history', whatif: 'rules', lock: 'rules' };
export const asTab = (x: string | null | undefined): Tab | undefined => (!x ? undefined : (TABS as string[]).includes(x) ? (x as Tab) : ALIAS[x]);
const forcedTab = asTab(demoParam('tab'));
const forcedTool: RulesTool | undefined = demoParam('sim') !== null || demoParam('tab') === 'whatif' ? 'sim' : demoParam('compare') !== null ? 'cmp' : undefined;

/** Certeza baixa: o que ajuda é ver o que aconteceu, então abre em "Como aconteceu". */
function tabFor(c: Change | undefined): Tab {
  if (forcedTab) return forcedTab;
  const top = c?.evidence[0];
  return c && (!top || top.grade === 'candidate') ? 'how' : 'answer';
}

export function Result({ r, origin, access, me, toast, onField }: { r: Investigation; origin: string; access?: AccessReport; me?: string; toast: (m: string) => void; onField: (field: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => tabFor(r.changes[0]));
  const [tool, setTool] = useState<RulesTool | undefined>(forcedTool);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  // Barra mais larga que o painel: degradê e seta na borda que tem mais abas escondidas.
  const [more, setMore] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const box = tabsRef.current;
    if (!box) return;
    const measure = () => {
      const b = box.querySelector<HTMLElement>('button[aria-selected="true"]');
      if (b) {
        setInd({ x: b.offsetLeft, w: b.offsetWidth });
        if (b.offsetLeft < box.scrollLeft) box.scrollLeft = b.offsetLeft - 8;
        else if (b.offsetLeft + b.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = b.offsetLeft + b.offsetWidth - box.clientWidth + 8;
      }
      setMore({ left: box.scrollLeft > 2, right: box.scrollLeft + box.clientWidth < box.scrollWidth - 2 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    box.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); box.removeEventListener('scroll', measure); };
  }, [tab]);
  const [histMode, setHistMode] = useState<'field' | 'record'>(demoParam('hist') === 'record' ? 'record' : 'field');
  const [diffOpen, setDiffOpen] = useState<false | { x: number; y: number }>(false);
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); setTab(tabFor(r.changes[0])); }, [r.target.field, r.target.sysId]);
  const go = (k: Tab, x?: RulesTool) => { setTab(k); if (x) setTool(x); };
  // No site, os textos ao lado do painel trocam a aba (só em demonstração; aceita os nomes antigos).
  useEffect(() => {
    if (!isDemo) return;
    const on = (e: MessageEvent) => { const d = e.data as { type?: string; tab?: string } | null; const k = asTab(d?.tab); if (d?.type === 'trail-demo-tab' && k) go(k, d.tab === 'whatif' ? 'sim' : undefined); };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  const c: Change | undefined = r.changes[sel];
  const tabs: Tab[] = c ? TABS : ['answer', 'history', 'rules'];
  // Teclado: ← → trocam de aba; ↑ ↓ andam pelas mudanças do campo (no Histórico). Esc fecha a diferença (no overlay).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || diffOpen || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = Math.max(0, tabs.indexOf(tab));
        setTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!); e.preventDefault();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tab === 'history' && histMode === 'field' && r.changes.length > 1) {
        setSel((v) => Math.max(0, Math.min(r.changes.length - 1, v + (e.key === 'ArrowDown' ? 1 : -1)))); e.preventDefault();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [tab, histMode, diffOpen, r.changes.length, tabs.length]);
  const field = fieldName(r);
  // Estado do campo no formulário (g_form): alimenta o cartão "No formulário agora" e "Estado agora".
  const observed = useObserved(r.target.table, r.target.sysId, r.target.field);

  const denied = useMemo(() => {
    const fromAccess = access?.denied ?? [];
    const fromRun = r.gaps.map((g) => g.split(':')[0] ?? '').filter(Boolean);
    return [...new Set([...fromAccess, ...fromRun])];
  }, [access, r.gaps]);
  const expired = (c?.notes ?? []).some((n) => n.startsWith('traces_expired'));
  const missing = denied.length > 0 || !!r.unaudited || expired;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast(P.copied); } catch { toast(text); }
  };
  const label: Record<Tab, [string, string]> = { answer: [U.tabAnswer, U.tabAnswerLong], how: [U.tabHow, U.tabHowLong], history: [U.tabHistory, U.tabHistoryLong], rules: [U.tabRules, U.tabRulesLong] };
  const count: Partial<Record<Tab, number>> = { history: r.changes.length + (r.unaudited ? 1 : 0) };

  return (
    <div class="res">
      <div class="headcard">
        <div class="rec">
          <a href={recordLink(origin, r.target.table, r.target.sysId)} target="_blank" rel="noreferrer"><b>{r.target.display}</b></a>
          {r.target.title && <span> · {r.target.title}</span>}
        </div>
        <div class="chg">
          <span class="fld" title={r.target.field}>{field}</span>
          {c ? (
            c.oldValue && c.oldValue.length > 40 && c.newValue.startsWith(c.oldValue) && !c.newValue.slice(c.oldValue.length).includes('\n') ? <span class="added" title={c.newValue}>{P.added} <b>“{c.newValue.slice(c.oldValue.length).trim()}”</b></span>
            : c.oldValue && looksLong(c.oldValue, c.newValue) ? <DiffSummary oldText={c.oldValue} newText={c.newValue} onOpen={(x, y) => setDiffOpen({ x, y })} />
            : c.oldValue || c.checkpoint > 1 ? <><Val cls="old" raw={c.oldValue} text={valueLabel(r, c.oldValue)} refTable={r.refTable} origin={origin} empty={P.empty} /><span class="arr">→</span><Val cls="new" raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></>
              : <><span class="muted small">{P.createdAs}</span><Val cls="new" raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></>
          ) : <span class="muted small">{r.fieldNotInHistory ? s.notInHistory : s.noChanges}</span>}
        </div>
        {c && <div class="when2">{when(c.at)}{r.changes.length > 1 && <span class="muted"> · {fmt(U.changeOf, { i: sel + 1, n: r.changes.length })}</span>}{(() => { const d = traceDaysLeft(c); return d !== null ? <span class="expire" title={P.expireHint}>{fmt(d === 0 ? P.expireToday : P.expireIn, { n: d })}</span> : null; })()}</div>}
      </div>
      {/* Sem leitura de sys_audit: as mudanças vêm do histórico do formulário (o que a pessoa já vê na instância). */}
      {r.auditFrom === 'history' && (
        <div class={`notice ${r.fieldNotInHistory ? '' : 'info'} small`}>
          <div class="title">{r.fieldNotInHistory ? s.notInHistoryTitle : s.fromHistoryTitle}</div>
          <div>{r.fieldNotInHistory ? s.notInHistoryHint : s.fromHistoryHint}</div>
        </div>
      )}
      {tab !== 'rules' && <LockCard observed={observed} onOpen={() => go('rules')} />}
      {c && diffOpen && <DiffOverlay at={diffOpen} title={`${r.target.display} · ${field}`} sub={when(c.at)} oldText={c.oldValue} newText={c.newValue} onClose={() => setDiffOpen(false)} />}

      <div class={`tabs-wrap ${more.left ? 'more-l' : ''} ${more.right ? 'more-r' : ''}`}>
        <div class="seg-tabs t4" role="tablist" ref={tabsRef} style={`--ix:${ind.x}px;--iw:${ind.w}px`}>
          <span class="ind" aria-hidden="true" />
          {tabs.map((k) => (
            <button role="tab" data-tab={k} aria-selected={tab === k} title={label[k][1]} onClick={() => setTab(k)}>
              {label[k][0]}{(count[k] ?? 0) > 0 && <i>{count[k]}</i>}{k === 'how' && missing && <span class="wdot" />}
            </button>
          ))}
        </div>
        {more.right && <button class="tabs-more r" tabIndex={-1} aria-hidden="true" onClick={() => { tabsRef.current?.scrollBy({ left: 120, behavior: 'smooth' }); }}>›</button>}
        {more.left && <button class="tabs-more l" tabIndex={-1} aria-hidden="true" onClick={() => { tabsRef.current?.scrollBy({ left: -120, behavior: 'smooth' }); }}>‹</button>}
      </div>

      <div class="tabpane" key={`${tab}-${sel}-${r.target.field}`} data-pane={tab}>
        {tab === 'answer' && (c
          ? <Answer r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} goHow={() => go('how')} goSim={() => go('rules', 'sim')} copy={copy} toast={toast} />
          : <NoChange r={r} goHistory={() => go('history')} />)}
        {tab === 'how' && c && <How r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} access={access} copy={copy} />}
        {tab === 'history' && <HistoryTab r={r} origin={origin} sel={c ? sel : -1} me={me} mode={histMode} setMode={setHistMode}
          onPick={(i) => { setSel(i); setTab(tabFor(r.changes[i]) === 'how' ? 'how' : 'answer'); }} onField={(f) => { setHistMode('field'); onField(f); }} />}
        {tab === 'rules' && <RulesTab r={r} origin={origin} field={field} observed={observed} tool={tool} setTool={setTool} />}
      </div>
      <div class="footer">
        <span title={fmt(s.timing, { calls: r.timing.calls, ms: r.timing.totalMs })}>{fmt(U.analyzedIn, { s: secs(r.timing.totalMs) })}</span>
        <button class="btn ghost sm" title={s.reloadHint} onClick={() => { void send({ type: 'clear-cache', origin }).then(() => { toast(s.reloaded); onField(r.target.field); }); }}>{Glyph.refresh} {s.reloadMeta}</button>
      </div>
    </div>
  );
}

/** Campo sem mudança registrada: a frase certa em vez de uma tela vazia. */
function NoChange({ r, goHistory }: { r: Investigation; goHistory: () => void }) {
  return (
    <div class="stack">
      <div class="ans-card none">
        <p class="ans-phrase">{r.fieldNotInHistory ? s.notInHistory : s.noChanges}</p>
        {r.unaudited && <p class="small muted">{plural(P.unauditedItem, r.unaudited.count)} {fmt(P.unauditedText, { when: when(r.unaudited.lastUpdatedOn), user: r.unaudited.lastUpdatedBy })}</p>}
      </div>
      <button class="link" onClick={goHistory}>{Glyph.clock} {U.seeHistory}</button>
    </div>
  );
}

const diffLabels = (): DiffLabels => ({ onlyChanges: P.diffOnly, whole: P.diffWhole, same: P.diffSame, added: P.diffAdded, removed: P.diffRemoved, before: P.diffBefore, after: P.diffAfter });

/** Valor longo (script, descrição): quantas linhas entraram e saíram, mostrando primeiro o que entrou. */
function DiffSummary({ oldText, newText, onOpen }: { oldText: string; newText: string; onOpen: (x: number, y: number) => void }) {
  const d = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const first = d.ops.find((o) => o.t === 'add') ?? d.ops.find((o) => o.t !== 'eq');
  const stat = [d.added ? plural(U.diffNew, d.added) : '', d.removed ? plural(U.diffGone, d.removed) : ''].filter(Boolean).join(', ');
  return (
    <button class="dsum" onClick={(e) => onOpen(e.clientX, e.clientY)}>
      <span class="stat">{stat}</span>
      {first && <code class={first.t}>{first.t === 'add' ? '+ ' : '− '}{first.text.trim().slice(0, 90) || ' '}</code>}
      <span class="go">{Glyph.open} {P.diffOpen}</span>
    </button>
  );
}

/** Diferença em tela cheia dentro do painel, com opção de abrir lado a lado numa janela larga. */
function DiffOverlay({ at, title, sub, oldText, newText, onClose }: { at: { x: number; y: number }; title: string; sub: string; oldText: string; newText: string; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, 220); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const sideBySide = async () => {
    if (isDemo) return;
    const key = `diff:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    await chrome.storage.session.set({ [key]: { title, sub, oldText, newText } });
    // Primeiro tenta a janela estilo Mac por cima da página do ServiceNow; sem a página (aba fechada, outra origem), abre uma janela do navegador.
    const tab = trackedTab();
    const ok = tab !== undefined && await chrome.tabs.sendMessage(tab, { type: 'diff-window', key, title, sub, theme: resolvedTheme(getPrefs().theme), from: getPrefs().panelMode === 'window' ? 'left' : 'right', labels: { close: P.close, min: P.winMin, max: P.winMax } })
      .then((r: { ok?: boolean } | undefined) => !!r?.ok).catch(() => false);
    if (ok) { if (getPrefs().panelMode !== 'window') await chrome.tabs.update(tab!, { active: true }).catch(() => undefined); close(); return; }
    await chrome.windows.create({ url: chrome.runtime.getURL(`src/diff/index.html?k=${encodeURIComponent(key)}`), type: 'popup', width: 1200, height: 860 });
  };
  return (
    <div class={`overlay ${closing ? 'closing' : ''}`} role="dialog" aria-label={title} style={`--ox:${at.x}px;--oy:${at.y}px`}>
      <div class="ohead">
        <div class="grow"><b>{title}</b><div class="muted small">{sub}</div></div>
        {!isDemo && <button class="btn sm" onClick={sideBySide}>{Glyph.detach} {P.diffSide}</button>}
        <button class="icon-btn" aria-label={P.close} title={P.close} onClick={close}>✕</button>
      </div>
      <DiffView oldText={oldText} newText={newText} labels={diffLabels()} />
    </div>
  );
}
