/**
 * Resultado da investigação em quatro abas: Resposta, Rastro, Provas e Histórico.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 * Princípio: a resposta primeiro, em linguagem de gente; o detalhe técnico continua lá, um clique abaixo.
 */
import type { TableConflictScan, AccessReport, Change, Evidence, Grade, Investigation, TraceItem } from '@trail/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs, resolvedTheme } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { FlowsTab } from './Flows';
import { RecordTimeline } from './Timeline';
import { WhatIf } from './WhatIf';
import { FieldMapBox } from './FieldMap';
import { fullReport, plainSummary, savePdf } from './export';
import { diffLines, looksLong } from '../shared/diff';
import { DiffView, type DiffLabels } from '../shared/DiffView';
import { handoff } from '../shared/handoff';
import { Val } from './Val';
import { ErrorMsg } from './ErrorMsg';
import { AdvancedTab } from './AdvancedTab';
import { Fold, FoldStatic } from './Fold';

const lang = getPrefs().lang;
const s = t(lang);
const P = s.p;
const WINDOW = { before: 3, after: 15 };

type Tab = 'answer' | 'trace' | 'proof' | 'history' | 'flows' | 'whatif' | 'advanced';
const TABS: Tab[] = ['answer', 'trace', 'proof', 'history', 'flows', 'whatif'];
/** Com o Modo avançado ligado, uma aba a mais no fim: "Avançado". */
const tabsFor = (advanced: boolean): Tab[] => (advanced ? [...TABS, 'advanced'] : TABS);
const demoParams = new URLSearchParams(location.search);
const isDemo = demoParams.has('demo');
const forcedHist: 'field' | 'record' = isDemo && demoParams.get('hist') === 'record' ? 'record' : 'field';
const forcedTab: Tab | undefined = isDemo && tabsFor(true).includes(demoParams.get('tab') as Tab) ? (demoParams.get('tab') as Tab) : undefined;
/** Certeza baixa ou sem causa: o que ajuda é ver o que aconteceu, então abre no Rastro. */
function tabFor(c: Change | undefined): Tab {
  if (forcedTab) return forcedTab;
  const top = c?.evidence[0];
  return !c || !top || top.grade === 'candidate' ? (c ? 'trace' : 'answer') : 'answer';
}

/** Link para o passo na instância: o registro pelo sys_id ou a lista já filtrada. */
export function refLink(origin: string, ref: { table: string; sysId?: string; query?: string }): string {
  return ref.sysId ? `${origin}/${ref.table}.do?sys_id=${ref.sysId}` : `${origin}/${ref.table}_list.do?sysparm_query=${encodeURIComponent(ref.query ?? '')}`;
}

// ---------- formatação ----------
export function humanField(f: string): string {
  const x = f.replace(/_id$/, '').replace(/_/g, ' ');
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** O nome do campo como no formulário (business_service → Service); sem acesso ao dicionário, o técnico arrumado. */
export function fieldName(r: Investigation): string {
  return r.fieldLabel || humanField(r.target.field);
}

export function parts(utc: string): { date: string; time: string; full: string; rel: string } {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return { date: utc, time: '', full: utc, rel: '' };
  const loc = lang === 'en' ? 'en-US' : 'pt-BR';
  const date = d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const sec = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(new Date()) - day(d);
  return { date, time, full: sec, rel: diff === 0 ? P.today : diff === 1 ? P.yesterday : '' };
}

export function when(utc: string): string {
  const p = parts(utc);
  return fmt(P.at, { date: p.date, time: p.time }) + (p.rel ? ` · ${p.rel}` : '');
}

export function valueLabel(r: Investigation, v: string): string {
  if (!v) return P.empty;
  const l = r.labels?.[v] ?? v;
  return l.length > 70 ? l.slice(0, 67) + '…' : l;
}

const certaintyDots: Record<Grade, number> = { confirmed: 3, probable: 2, candidate: 1 };

export const plural = (forms: string[], n: number) => fmt(forms[n === 1 ? 0 : 1] ?? forms[0]!, { n });
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** O motor escreve horários em UTC; o painel mostra tudo no fuso de quem lê. */
export function localizeTimes(text: string, dayUtc: string): string {
  const out = text.replace(/(\d{4}-\d{2}-\d{2} )?\b(\d{2}:\d{2}:\d{2})\b/g, (m, d: string | undefined, h: string) => {
    if (d) { const p = parts(d + h); return `${p.date} ${p.full}`; }
    return dayUtc ? parts(`${dayUtc} ${h}`).full : m;
  });
  return out.charAt(0).toUpperCase() + out.slice(1); // todo texto exibido começa com maiúscula
}

export function factText(kind: string, field: string): string {
  return fmt(P.fact[kind] ?? kind, { field });
}

// ---------- componente principal ----------
export function Result({ r, origin, access, toast, onField, advanced = false, me }: { r: Investigation; origin: string; access?: AccessReport; toast: (m: string) => void; onField: (field: string) => void; /** Modo avançado (Configurações): a aba "Avançado". */ advanced?: boolean; me?: string }) {
  const tabs = tabsFor(advanced);
  const [tab, setTab] = useState<Tab>(() => tabFor(r.changes[0]));
  // Modo avançado desligado com a aba aberta: volta para a Resposta.
  useEffect(() => { if (!advanced && tab === 'advanced') setTab('answer'); }, [advanced]);
  // O realce verde acompanha a largura de cada aba (cada uma tem o tamanho do próprio texto).
  const tabsRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const box = tabsRef.current;
    if (!box) return;
    const measure = () => {
      const b = box.querySelector<HTMLElement>('button[aria-selected="true"]');
      if (!b) return;
      setInd({ x: b.offsetLeft, w: b.offsetWidth });
      // Painel estreito: a barra rola para o lado; a aba ativa fica sempre à vista.
      if (b.offsetLeft < box.scrollLeft) box.scrollLeft = b.offsetLeft - 8;
      else if (b.offsetLeft + b.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = b.offsetLeft + b.offsetWidth - box.clientWidth + 8;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [tab, advanced]);
  const [histMode, setHistMode] = useState<'field' | 'record'>(forcedHist);
  const [diffOpen, setDiffOpen] = useState<false | { x: number; y: number }>(false);
  const [sel, setSel] = useState(0);
  // A lista de mudanças do campo começa recolhida; aberta, continua aberta enquanto ↑ ↓ trocam a mudança.
  const [histOpen, setHistOpen] = useState(false);
  useEffect(() => { setSel(0); setTab(tabFor(r.changes[0])); setHistOpen(false); }, [r.target.field, r.target.sysId]);
  // No site, os textos ao lado do painel trocam a aba (só em demonstração).
  useEffect(() => {
    if (!isDemo) return;
    const on = (e: MessageEvent) => { const d = e.data as { type?: string; tab?: Tab } | null; if (d?.type === 'trail-demo-tab' && d.tab && tabs.includes(d.tab)) setTab(d.tab); };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  // Teclado: ← → trocam de aba; ↑ ↓ andam pelas mudanças do campo (na aba Histórico). Esc fecha a diferença (no overlay).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || diffOpen || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = tabs.indexOf(tab);
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
        setTab(n); e.preventDefault();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tab === 'history' && histMode === 'field' && r.changes.length > 1) {
        setSel((v) => Math.max(0, Math.min(r.changes.length - 1, v + (e.key === 'ArrowDown' ? 1 : -1)))); e.preventDefault();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [tab, histMode, diffOpen, r.changes.length, advanced]);
  const c: Change | undefined = r.changes[sel];
  const field = fieldName(r);

  const denied = useMemo(() => {
    const fromAccess = access?.denied ?? [];
    const fromRun = r.gaps.map((g) => g.split(':')[0] ?? '').filter(Boolean);
    return [...new Set([...fromAccess, ...fromRun])];
  }, [access, r.gaps]);
  const expired = (c?.notes ?? []).some((n) => n.startsWith('traces_expired'));

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast(P.copied); } catch { toast(text); }
  };

  return (
    <div class="res">
      <div class="headcard">
        <div class="rec">
          <a href={recordLink(origin, r.target.table, r.target.sysId)} target="_blank" rel="noreferrer"><b>{r.target.display}</b></a>
          {r.target.title && <span> · {r.target.title}</span>}
        </div>
        <div class="chg">
          <span class="fld">{field}</span>
          {c ? (
            c.oldValue && c.oldValue.length > 40 && c.newValue.startsWith(c.oldValue) && !c.newValue.slice(c.oldValue.length).includes('\n') ? <span class="added" title={c.newValue}>{P.added} <b>“{c.newValue.slice(c.oldValue.length).trim()}”</b></span>
            : c.oldValue && looksLong(c.oldValue, c.newValue) ? <DiffSummary oldText={c.oldValue} newText={c.newValue} onOpen={(x, y) => setDiffOpen({ x, y })} />
            : c.oldValue || c.checkpoint > 1 ? <><Val cls="old" raw={c.oldValue} text={valueLabel(r, c.oldValue)} refTable={r.refTable} origin={origin} empty={P.empty} /><span class="arr">→</span><Val cls="new" raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></>
              : <><span class="muted small">{P.createdAs}</span><Val cls="new" raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></>
          ) : <span class="muted small">{r.fieldNotInHistory ? s.notInHistory : s.noChanges}</span>}
        </div>
        {c && <div class="when2">{when(c.at)}{(() => { const d = traceDaysLeft(c); return d !== null ? <span class="expire" title={P.expireHint}>{fmt(d === 0 ? P.expireToday : P.expireIn, { n: d })}</span> : null; })()}</div>}
        {c && r.changes.length > 1 && <ChangePath r={r} sel={sel} onPick={setSel} />}
      </div>
      {/* Sem leitura de sys_audit: as mudanças vêm do histórico do formulário (o que a pessoa já vê na instância). */}
      {r.auditFrom === 'history' && (
        <div class={`notice ${r.fieldNotInHistory ? '' : 'info'} small`}>
          <div class="title">{r.fieldNotInHistory ? s.notInHistoryTitle : s.fromHistoryTitle}</div>
          <div>{r.fieldNotInHistory ? s.notInHistoryHint : s.fromHistoryHint}</div>
        </div>
      )}
      {c && diffOpen && <DiffOverlay at={diffOpen} title={`${r.target.display} · ${field}`} sub={when(c.at)} oldText={c.oldValue} newText={c.newValue} onClose={() => setDiffOpen(false)} />}

      {c && (
        <div class={`seg-tabs ${advanced ? 't7' : ''}`} role="tablist" ref={tabsRef} style={`--ix:${ind.x}px;--iw:${ind.w}px`}>
          <span class="ind" aria-hidden="true" />
          {([['answer', P.tabAnswer, 0], ['trace', P.tabTrace, c.trace?.length ?? 0], ['proof', P.tabProof, c.evidence[0]?.facts.length ?? 0], ['history', P.tabHistory, r.changes.length + (r.unaudited ? 1 : 0)], ['flows', P.tabFlows, 0], ['whatif', P.wiTab, 0], ...(advanced ? [['advanced', P.adv.tab, 0]] : [])] as [Tab, string, number][]).map(([k, label, n]) => (
            <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}{k !== 'answer' && n > 0 && <i>{n}</i>}{k === 'proof' && (denied.length > 0 || r.unaudited || expired) && <span class="wdot" />}
            </button>
          ))}
        </div>
      )}

      {!c && <History r={r} origin={origin} sel={-1} onPick={() => undefined} />}
      <div class="tabpane" key={`${tab}-${sel}-${r.target.field}`}>
      {c && tab === 'answer' && <Answer r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} goProof={() => setTab('proof')} copy={copy} toastFn={toast} />}
      {c && tab === 'trace' && <Trace r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} />}
      {c && tab === 'proof' && <Proof r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} access={access} copy={copy} />}
      {c && tab === 'flows' && <FlowsTab target={r.target} origin={origin} field={r.target.field} />}
      {c && tab === 'whatif' && <WhatIf r={r} origin={origin} field={field} />}
      {c && advanced && tab === 'advanced' && <AdvancedTab r={r} c={c} origin={origin} field={field} {...(me ? { me } : {})} />}
      {c && tab === 'history' && (
        <>
          <div class="seg2 hist-switch" role="group">
            <button aria-pressed={histMode === 'field'} onClick={() => setHistMode('field')}>{P.histField} · {field}</button>
            <button aria-pressed={histMode === 'record'} onClick={() => setHistMode('record')}>{P.histRecord}</button>
          </div>
          {histMode === 'field'
            ? <History r={r} origin={origin} sel={sel} open={histOpen} onOpen={setHistOpen} onPick={(i) => { setSel(i); setTab(tabFor(r.changes[i]) === 'trace' ? 'trace' : 'answer'); }} />
            : <RecordTimeline origin={origin} table={r.target.table} sysId={r.target.sysId} onField={(f) => { setHistMode('field'); onField(f); }} />}
        </>
      )}

      </div>
      <div class="footer">
        <span>{fmt(s.timing, { calls: r.timing.calls, ms: r.timing.totalMs })}</span>
        <button class="btn ghost sm" title={s.reloadHint} onClick={() => { void send({ type: 'clear-cache', origin }).then(() => { toast(s.reloaded); onField(r.target.field); }); }}>{Glyph.refresh} {s.reloadMeta}</button>
      </div>
    </div>
  );
}

// ---------- Resposta ----------
function Answer({ r, c, origin, field, denied, expired, goProof, copy, toastFn }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; goProof: () => void; copy: (t: string) => void; toastFn: (m: string) => void }) {
  const top = c.evidence[0];
  const alts = c.evidence.slice(1);
  const alt = alts.length === 1 ? alts[0] : undefined;
  const warns = [
    denied.length ? plural(P.warnDenied, denied.length) : '',
    r.unaudited ? plural(P.warnUnaudited, r.unaudited.count) : '',
    expired ? P.warnExpired : '',
    r.conflicts?.length ? plural(P.warnConflict, r.conflicts.length) : '',
  ].filter(Boolean);
  const summary = () => fmt(P.summary, {
    rec: r.target.display, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue), when: when(c.at),
    who: top?.artifact.name ?? '?', type: top ? s.type[top.type] : '?', cert: top ? P.certainty[top.grade] : P.noCause,
    facts: (top?.facts ?? []).map((f) => `• ${factText(f.kind, field)}`).join('\n'),
  });
  const link = top?.artifact.sysId && top.artifact.table ? recordLink(origin, top.artifact.table, top.artifact.sysId) : null;
  const best = top ? [...top.facts].sort((a, b) => b.points - a.points)[0] : undefined;
  const pp = r.pingPong;
  return (
    <div class="stack">
      {denied.length > 0 && (!top || top.grade !== 'confirmed') && denied.some((d) => P.srcImpact[d]) && (
        <div class="notice">
          <div class="title">{P.incompleteTitle}</div>
          <div class="small">{P.incompleteText}</div>
          {denied.filter((d) => P.srcImpact[d]).map((d) => <div class="small">· {P.srcImpact[d]}.</div>)}
        </div>
      )}
      {pp && (
        <div class="notice pp">
          <div class="title">{P.ppTitle}</div>
          <div class="small">{fmt(P.ppText, { a: pp.actors[0], b: pp.actors[1], va: valueLabel(r, pp.values[0]), vb: valueLabel(r, pp.values[1]), n: pp.flips, from: when(pp.from), to: when(pp.to) })}</div>
        </div>
      )}
      {top ? (
        <>
          <div class="who">
            <span class="ic">{typeGlyph[top.type]}</span>
            <div class="grow">
              <div class="k">{P.whoChanged} · {top.type === 'user_action' && top.facts.some((f) => f.kind === 'integration_user') ? (P.kind as Record<string, string>).user_integration : top.type === 'user_action' && top.facts.some((f) => /\/api\//.test(f.detail)) ? (P.kind as Record<string, string>).user_api : P.kind[top.type]}</div>
              <div class="nm">{top.artifact.name}</div>
              <div class="tech">{s.type[top.type]}</div>
            </div>
          </div>
          <div class={`cert ${top.grade}`}>
            <span class="dots">{[1, 2, 3].map((i) => <i class={i <= certaintyDots[top.grade] ? 'on' : ''} />)}</span>
            <b>{P.certainty[top.grade]}</b>
            {best && <span>{factText(best.kind, field)}</span>}
          </div>
        </>
      ) : (
        <div class="who none"><span class="ic">{Glyph.question}</span><div><div class="nm">{P.noCause}</div><div class="tech">{P.noCauseHint}</div></div></div>
      )}
      <div class="plain">
        <div class="pl-hd"><b>{P.plainTitle}</b><span class="muted small">{P.plainHint}</span></div>
        <p>{plainSummary(r, c)}</p>
        <button class="link" onClick={() => copy(plainSummary(r, c))}>{Glyph.copy} {P.plainCopy}</button>
      </div>
      <div class={`btns ${link ? '' : 'one'}`}>
        {link && <a class="btn primary big" href={link} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openArtifact, { what: P.what[top?.artifact.table ?? ''] ?? s.openInStudio })}</a>}
        <button class="btn big" onClick={() => copy(summary())}>{Glyph.copy} {P.copySummary}</button>
      </div>
      <div class="export">
        <button class="link" onClick={() => copy(fullReport(r, c, origin))}>{Glyph.copy} {P.copyFull}</button>
        <button class="link" onClick={() => void savePdf(r, r.changes.indexOf(c), origin, () => toastFn(P.demoPdf))}>{Glyph.open} {P.savePdf}</button>
      </div>
      {alt && (
        <button class="alt" onClick={goProof}>
          <span class="ic sm">{typeGlyph[alt.type]}</span>
          <span class="grow">{P.otherPossibility} <b>{alt.artifact.name}</b></span>
          <span class="pill">{P.likelihood[alt.grade]}</span>
        </button>
      )}
      {/* Mais de uma outra possibilidade: lista secundária, recolhida, com os nomes no resumo. */}
      {alts.length > 1 && (
        <Fold cls="alts" title={P.otherPossibilities} count={alts.length} hint={alts.map((e) => e.artifact.name).slice(0, 3).join(', ') + (alts.length > 3 ? '…' : '')}>
          {alts.map((e) => (
            <button class="li alt-row" onClick={goProof}>
              <span class="ic sm">{typeGlyph[e.type]}</span>
              <span class="grow"><b>{e.artifact.name}</b><div class="det">{lossReason(e, field)}</div></span>
              <span class="pill">{P.likelihood[e.grade]}</span>
            </button>
          ))}
        </Fold>
      )}
      {warns.length > 0 && (
        <button class="warnbar" onClick={goProof}>{Glyph.warn}<span class="grow">{warns.join(' · ')}</span><span class="muted">{P.seeInProof}</span></button>
      )}
    </div>
  );
}

// ---------- Rastro ----------
export function traceTitle(r: Investigation, c: Change, it: TraceItem, field: string): string {
  const key = it.kind === 'form' && it.label === 'Workspace' ? 'formWs' : it.kind;
  return fmt((P.tr as Record<string, string>)[key] ?? it.kind, { user: it.user ?? '', label: it.label, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue) });
}

const traceIcon: Record<string, preact.JSX.Element> = {
  form: Glyph.user, ui_action: Glyph.click, async: Glyph.async, job: Glyph.clock, api: Glyph.plug, background_script: Glyph.terminal,
  event: Glyph.event, flow: Glyph.flow, workflow: Glyph.flow, change: Glyph.check,
};

/** Outro campo citado no rastro: o rótulo do formulário, se a instância deixou ler. */
function otherName(r: Investigation, f: string): string {
  return r.display?.fields[f] || humanField(f);
}
function OtherVal({ r, f, v, origin }: { r: Investigation; f: string; v: string; origin: string }) {
  return <Val raw={v} text={r.display?.values[f]?.[v] ?? rawValue(v)} refTable={r.display?.refs[f]} origin={origin} empty={P.empty} />;
}

function rawValue(v: string): string {
  if (!v) return P.empty;
  return v.length > 48 ? v.slice(0, 45) + '…' : v;
}

function Trace({ r, c, origin, field, denied, expired }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean }) {
  const items = c.trace ?? [];
  const blind = denied.filter((d) => ['sys_flow_context', 'wf_context', 'sysevent', 'syslog_transaction'].includes(d));
  const txIds = items.filter((it) => it.ref?.table === 'syslog_transaction' && it.ref.sysId).map((it) => it.ref!.sysId!);
  return (
    <div class="stack">
      <div class="muted small">{fmt(P.traceIntro, WINDOW)}</div>
      {txIds.length > 1 && (
        <a class="btn sm openall" href={refLink(origin, { table: 'syslog_transaction', query: `sys_idIN${txIds.join(',')}` })} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openAllTx, { n: txIds.length })}</a>
      )}
      <ol class="tl rev">
        {[...items].reverse().map((it, idx) => {
          const p = parts(it.at);
          const isChange = it.kind === 'change';
          const isWrite = it.kind === 'write';
          return (
            <li class={`${it.cause ? 'key' : ''} ${isChange ? 'res' : ''} ${isWrite ? 'other' : ''}`} style={`--i:${idx}`}>
              <div class="t"><b>{p.full}</b>{it.cause ? <span class="tag">{P.cause}</span> : it.user ? <span class="muted">{it.user}</span> : null}</div>
              <div class="x"><span class="ti">{isWrite ? Glyph.rule : traceIcon[it.kind]}</span>{isWrite ? P.otherWrite : traceTitle(r, c, it, field)}</div>
              {(it.kind === 'async' || it.kind === 'job') && <div class="sub2">{it.label}</div>}
              {it.sent !== undefined && <div class="sub2">{fmt(P.sent, { field, value: valueLabel(r, it.sent) })}</div>}
              {isWrite && <ul class="fw">{(it.fields ?? []).slice(0, 6).map((f) => <li><b>{otherName(r, f.field)}</b> <OtherVal r={r} f={f.field} v={f.oldValue} origin={origin} /> → <OtherVal r={r} f={f.field} v={f.newValue} origin={origin} /></li>)}{(it.fields?.length ?? 0) > 6 && <li class="muted">{fmt(P.moreFields, { n: (it.fields?.length ?? 0) - 6 })}</li>}</ul>}
              {isChange && it.fields?.length ? <div class="sub2 muted">{fmt(P.sameWrite, { list: it.fields.map((f) => otherName(r, f.field)).join(', ') })}</div> : null}
              <div class="src">
                <span>{P.srcName[it.source] ?? it.source}{isChange || isWrite ? ` · ${fmt(P.checkpoint, { n: it.checkpoint ?? c.checkpoint })}` : ''}{it.kind === 'form' || it.kind === 'api' ? ` · ${it.label}` : ''}</span>
                {it.ref && <a class="see" href={refLink(origin, it.ref)} target="_blank" rel="noreferrer">{P.seeInSn} {Glyph.open}</a>}
              </div>
            </li>
          );
        })}
        {expired && <li class="gapi"><div class="t"><b>—</b><span class="tag a">{P.notChecked}</span></div><div class="x small">{P.expiredText}</div></li>}
        {!expired && blind.length > 0 && (
          <li class="gapi"><div class="t"><b>{parts(c.at).time}</b><span class="tag a">{P.notChecked}</span></div>
            <div class="x small">{fmt(P.notCheckedText, { what: blind.map((b) => P.srcName[b] ?? b).join(', ') })}</div></li>
        )}
      </ol>
      {c.traceOmitted ? <div class="muted small">{fmt(P.omitted, { n: c.traceOmitted })}</div> : null}
      {items.length <= 1 && !expired && <div class="muted small">{P.traceEmpty}</div>}
    </div>
  );
}

// ---------- Provas ----------
function Proof({ r, c, origin, field, denied, expired, access, copy }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; access?: AccessReport; copy: (t: string) => void }) {
  const [top, ...others] = c.evidence;
  const host = origin.replace(/^https?:\/\//, '');
  const missingCount = (denied.length ? 1 : 0) + (r.unaudited ? 1 : 0) + (expired ? 1 : 0);
  const entries = Object.entries(r.access).sort();
  const accRows = [...entries, ...(access ? Object.entries(access.states).filter(([k]) => !(k in r.access)).sort() : [])];
  const best = top ? [...top.facts].sort((a, b) => b.points - a.points)[0] : undefined;
  const missingHint = [
    denied.length ? plural(P.warnDenied, denied.length) : '',
    r.unaudited ? plural(P.warnUnaudited, r.unaudited.count) : '',
    expired ? P.warnExpired : '',
  ].filter(Boolean).join(' · ');
  return (
    <div class="stack">
      {top && (
        <Fold cls="why-this" title={P.whyThis} count={top.facts.length} countText={fmt(P.nProofs, { n: top.facts.length })}
          hint={best ? `${P.certainty[top.grade]} · ${factText(best.kind, field)}` : P.certainty[top.grade]}>
          {top.facts.map((f, i) => <FactRow i={i} kind={f.kind} detail={localizeTimes(f.detail, c.at.slice(0, 10))} source={f.source} field={field} ok={f.points >= 0} />)}
          {top.gaps.map((g) => <div class="li"><span class="ck w">!</span><span class="grow">{localizeTimes(g, c.at.slice(0, 10))}</span></div>)}
        </Fold>
      )}
      {others.map((e) => <Other e={e} origin={origin} field={field} day={c.at.slice(0, 10)} />)}
      {(r.conflicts?.length ?? 0) > 0 && <Conflicts r={r} origin={origin} />}
      <FieldMapBox r={r} origin={origin} field={field} />
      <TableScan r={r} origin={origin} />
      {/* Nada faltando: o próprio cabeçalho diz, sem nada para abrir. */}
      {!missingCount && <FoldStatic cls="missing" title={P.missing} hint={P.nothingMissing} />}
      {missingCount > 0 && <Fold cls="missing" warn title={P.missing} count={missingCount} pill="w" hint={missingHint}>
        {denied.length > 0 && (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <b>{cap(fmt(P.deniedItem, { what: denied.map((d) => P.srcName[d] ?? d).join(', ') }))}</b> {P.deniedHint}
            {denied.filter((d) => P.srcImpact[d]).map((d) => <div class="det">{cap(P.srcImpact[d]!)}.</div>)}
            <div><button class="link" onClick={() => copy(fmt(P.request, { host, tables: denied.join(', ') }))}>{Glyph.copy} {P.copyRequest}</button></div>
          </div></div>
        )}
        {r.unaudited && (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <b>{plural(P.unauditedItem, r.unaudited.count)}</b> {fmt(P.unauditedText, { when: when(r.unaudited.lastUpdatedOn), user: r.unaudited.lastUpdatedBy })}
            {r.unaudited.clues.map((x) => <div class="det">{fmt(P.clue, { x: localizeTimes(x, '') })}</div>)}
          </div></div>
        )}
        {expired && <div class="li"><span class="ck w">!</span><div class="grow"><b>{P.expiredItem}</b> {P.expiredText}</div></div>}
      </Fold>}
      <Fold cls="tech-access" title={P.techAccess} count={accRows.length}>
        <div class="acc-list">
          {accRows.map(([k, v]) => (
            <div><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></div>
          ))}
        </div>
        <div class="pad"><button class="btn sm" onClick={() => send({ type: 'check-access', origin })}>{Glyph.shield} {P.recheck}</button></div>
      </Fold>
    </div>
  );
}

/** Regras ativas que gravam este campo com valores diferentes e podem rodar juntas. */
export function conflictLines(r: Investigation): { a: string; b: string; win: string; overlap: string; aLink?: string; bLink?: string }[] {
  // Rótulos de valor só valem para o campo investigado (na varredura da tabela os campos são outros).
  const rule = (x: NonNullable<Investigation['conflicts']>[number]['a'], field: string) => { const v = x.values[0] ?? ''; return fmt(P.cfRule, { name: x.name, kind: s.type[x.kind] ?? x.kind, order: x.kind === 'br_before' ? fmt(P.cfOrder, { n: x.order }) : '', value: (field === r.target.field ? valueLabel(r, v) : v) || P.tlEmptyValue }); };
  return (r.conflicts ?? []).map((k) => ({
    a: rule(k.a, k.field), b: rule(k.b, k.field), overlap: P.cfOverlap[k.overlap] ?? k.overlap,
    win: k.winner ? fmt(P.cfWins, { name: (k.winner === 'a' ? k.a : k.b).name, why: P.cfWhy[k.why ?? ''] ?? '' }) : P.cfNoWinner,
  }));
}
function Conflicts({ r, origin }: { r: Investigation; origin: string }) {
  const lines = conflictLines(r);
  return (
    <Fold cls="conflict" warn title={P.cfTitle} count={lines.length} pill="w" hint={lines.length === 1 ? lines[0]!.win : undefined}>
      <div class="li"><span class="grow muted small">{P.cfHint}</span></div>
      {(r.conflicts ?? []).map((k, i) => (
        <div class="li"><span class="ck w">!</span><div class="grow">
          <div><a href={recordLink(origin, k.a.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.a.sysId)} target="_blank" rel="noreferrer">{lines[i]!.a}</a></div>
          <div><a href={recordLink(origin, k.b.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.b.sysId)} target="_blank" rel="noreferrer">{lines[i]!.b}</a></div>
          <div class="det">{lines[i]!.overlap} · {lines[i]!.win}</div>
        </div></div>
      ))}
    </Fold>
  );
}

/** Varredura de conflitos de todos os campos da tabela, sob demanda. */
function TableScan({ r, origin }: { r: Investigation; origin: string }) {
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<TableConflictScan>();
  const [err, setErr] = useState('');
  const table = r.target.table;
  const run = async () => {
    setSt('run');
    try {
      const out = isDemo ? demoScan(r) : await send<TableConflictScan & { error?: string }>({ type: 'scan-conflicts', origin, table });
      if (isDemo) await new Promise((x) => setTimeout(x, 600));
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  const lines = res ? conflictLines({ ...r, conflicts: res.conflicts }) : [];
  return (
    <Fold cls="scan" title={fmt(P.scTitle, { table })} count={res?.conflicts.length} hint={res ? (res.conflicts.length ? undefined : P.scNone) : P.scShort}>
      {st === 'idle' && <div class="li"><span class="grow muted small">{P.scHint}</span><button class="btn sm" onClick={run}>{Glyph.search} {P.scRun}</button></div>}
      {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.scRunning}</span></div>}
      {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div>}
      {st === 'done' && res && <>
        <div class="li"><span class="grow muted small">{fmt(P.scSummary, { rules: res.rules, cs: res.clientScripts, fields: res.fields, ms: res.timing.totalMs })}</span></div>
        {!res.conflicts.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.scNone}</span></div>}
        {res.conflicts.map((k, i) => (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <div class="fld"><b>{humanField(k.field)}</b> <code>{k.field}</code></div>
            <div><a href={recordLink(origin, k.a.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.a.sysId)} target="_blank" rel="noreferrer">{lines[i]!.a}</a></div>
            <div><a href={recordLink(origin, k.b.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.b.sysId)} target="_blank" rel="noreferrer">{lines[i]!.b}</a></div>
            <div class="det">{lines[i]!.overlap} · {lines[i]!.win}</div>
          </div></div>
        ))}
      </>}
    </Fold>
  );
}

function demoScan(r: Investigation): TableConflictScan {
  const rule = (kind: 'br_before' | 'client_script', name: string, order: number, v: string) => ({ kind, name, sysId: name, table: r.target.table, order, values: [v] });
  return {
    table: r.target.table, tables: r.tables, rules: 214, clientScripts: 38, fields: 61, timing: { totalMs: 840, calls: 4 },
    conflicts: [
      { field: 'impact', overlap: 'always', winner: 'b', why: 'higher_order', a: rule('br_before', 'Impacto padrão', 100, '3'), b: rule('br_before', 'Impacto VIP', 400, '1') },
      { field: 'urgency', overlap: 'possible', winner: 'a', why: 'server_after_client', a: rule('br_before', 'Urgência por categoria', 100, '2'), b: rule('client_script', 'Sugere urgência', 0, '1') },
    ],
  };
}

function FactRow({ kind, detail, source, field, ok, i = 0 }: { kind: string; detail: string; source: string; field: string; ok: boolean; i?: number }) {
  return (
    <div class="li fact" style={`--i:${i}`}>
      <span class={`ck ${ok ? '' : 'x'}`}>{ok ? Glyph.check : '–'}</span>
      <div class="grow">{factText(kind, field)}<div class="det">{detail}</div></div>
      <span class="srcp">{P.srcName[source] ?? source}</span>
    </div>
  );
}

/** Retenção padrão das fontes de rastro (sys_auto_flush): o que sustenta a resposta some depois disso. */
const RETENTION_DAYS: Record<string, number> = { sysevent: 7, sys_flow_context: 14, syslog_transaction: 56 };
/** Dias até a prova principal desta mudança expirar (só quando faltam menos de 30); null = não se aplica. */
export function traceDaysLeft(c: Change): number | null {
  const top = c.evidence[0];
  if (!top) return null;
  const days = top.facts.map((f) => RETENTION_DAYS[f.source]).filter((x): x is number => !!x);
  if (!days.length) return null;
  const age = (Date.now() - Date.parse(c.at.replace(' ', 'T') + 'Z')) / 864e5;
  const left = Math.floor(Math.min(...days) - age);
  return left >= 0 && left < 30 ? left : null;
}

/** Por que este candidato perdeu, numa frase: o fato que mais pesou contra ele (ou "pontuação menor"). */
export function lossReason(e: Evidence, field: string): string {
  const neg = e.facts.filter((f) => f.points < 0).sort((a, b) => a.points - b.points)[0];
  return neg ? factText(neg.kind, field) : P.weaker;
}

function Other({ e, origin, field, day }: { e: Evidence; origin: string; field: string; day: string }) {
  const link = e.artifact.sysId && e.artifact.table ? recordLink(origin, e.artifact.table, e.artifact.sysId) : null;
  return (
    <Fold cls="why-not" title={fmt(P.whyNotOther, { name: e.artifact.name })} hint={lossReason(e, field)} badge={<span class="pill">{P.likelihood[e.grade]}</span>}>
      {e.gaps.map((g) => <div class="li"><span class="ck x">–</span><span class="grow">{localizeTimes(g, day)}</span></div>)}
      {e.facts.map((f) => <FactRow kind={f.kind} detail={localizeTimes(f.detail, day)} source={f.source} field={field} ok={f.points >= 0} />)}
      {link && <div class="pad"><a href={link} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openArtifact, { what: P.what[e.artifact.table ?? ''] ?? s.openInStudio })}</a></div>}
    </Fold>
  );
}

// ---------- Histórico ----------
/**
 * Caminho do campo, da mudança mais antiga para a mais recente ("Inquiry → Access & Password → Inquiry → Security"),
 * com a mudança que está na tela destacada. Cada valor leva à mudança que o gravou. Some com valores longos (scripts).
 */
function ChangePath({ r, sel, onPick }: { r: Investigation; sel: number; onPick: (i: number) => void }) {
  const order = r.changes.map((c, i) => ({ c, i })).sort((a, b) => (a.c.at < b.c.at ? -1 : a.c.at > b.c.at ? 1 : a.c.checkpoint - b.c.checkpoint));
  if (order.some(({ c }) => looksLong(c.oldValue, c.newValue))) return null;
  const MAX = 6;
  const shown = order.length > MAX ? order.slice(-MAX) : order;
  const short = (v: string) => { const t = valueLabel(r, v); return t.length > 26 ? t.slice(0, 24) + '…' : t; };
  const first = shown[0]!.c;
  // Criação do registro: o caminho começa no primeiro valor, sem "antes".
  const created = order.length <= MAX && !first.oldValue && first.checkpoint <= 1;
  const pos = order.findIndex((x) => x.i === sel) + 1;
  const who = (c: Change) => { const e = c.evidence[0]; return e ? (e.type === 'user_action' ? e.artifact.name : P.kind[e.type].split(' · ')[0]) : c.user; };
  return (
    <div class="cpath" aria-label={fmt(P.pathTitle, { n: pos, total: order.length })}>
      <span class="cp-t">{fmt(P.pathTitle, { n: pos, total: order.length })}</span>
      <span class="cp-v">
        {order.length > MAX && <span class="cp-x">…</span>}
        {!created && <span class="cp-s">{short(first.oldValue)}</span>}
        {shown.map(({ c, i }, k) => (
          <>
            {(k > 0 || !created) && <span class={`cp-a ${i === sel ? 'on' : ''}`} aria-hidden="true">→</span>}
            <button class={i === sel ? 'on' : ''} aria-pressed={i === sel} title={`${when(c.at)} · ${who(c)}`} onClick={() => onPick(i)}>{short(c.newValue)}</button>
          </>
        ))}
      </span>
    </div>
  );
}

function History({ r, origin, sel, onPick, open, onOpen }: { r: Investigation; origin: string; sel: number; onPick: (i: number) => void; /** Lista aberta (fica com o Result: ↑ ↓ trocam a mudança sem recolher). */ open?: boolean; onOpen?: (o: boolean) => void }) {
  const field = fieldName(r);
  type Row = { at: string; i: number };
  const rows: Row[] = r.changes.map((c, i) => ({ at: c.at, i }));
  if (r.unaudited?.lastUpdatedOn) rows.push({ at: r.unaudited.lastUpdatedOn, i: -1 });
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  const S = r.suspects;
  const whenRank: Record<string, number> = { before: 0, after: 1, async: 2, async_always: 2, display: 3 };
  const brs = [...S.businessRules].sort((a, b) => (whenRank[a.when] ?? 4) - (whenRank[b.when] ?? 4) || Number(a.order) - Number(b.order));
  const link = (table: string, sysId: string, name: string) => <a href={recordLink(origin, table, sysId)} target="_blank" rel="noreferrer">{name || '—'}</a>;
  const groups: { key: string; title: string; icon: preact.JSX.Element; rows: preact.JSX.Element[] }[] = [
    { key: 'br', title: P.grp.br, icon: Glyph.rule, rows: brs.map((b) => (
      <div class="li"><div class="grow">{link('sys_script', b.sysId, b.name)}<div class="det">{b.table} · {s.order} {b.order}</div></div><span class={`when w-${b.when.startsWith('async') ? 'async' : b.when}`}>{P.when[b.when] ?? b.when}</span></div>)) },
    { key: 'si', title: P.grp.si, icon: Glyph.include, rows: S.viaScriptInclude.map((x) => (
      <div class="li"><div class="grow">{link('sys_script_include', x.scriptIncludeSysId, x.scriptInclude)}<div class="det">{fmt(P.calledBy, { br: x.businessRule })}</div></div></div>)) },
    { key: 'cs', title: P.grp.client, icon: typeGlyph.client_script, rows: (S.clientScripts ?? []).map((c) => (
      <div class="li"><div class="grow">{link('sys_script_client', c.sysId, c.name)}<div class="det">{c.table} · {c.type}{c.trigger ? ` · ${humanField(c.trigger)}` : ''}</div></div></div>)) },
    { key: 'dl', title: P.grp.lookup, icon: typeGlyph.data_lookup, rows: (S.dataLookups ?? []).map((d) => (
      <div class="li"><div class="grow">{link('dl_definition', d.sysId, d.name)}</div></div>)) },
    { key: 'ar', title: P.grp.assign, icon: Glyph.group, rows: (S.assignmentRules ?? []).map((a) => (
      <div class="li"><div class="grow">{link('sysrule_assignment', a.sysId, a.name)}<div class="det">{a.table}</div></div></div>)) },
    { key: 'ua', title: P.grp.ui, icon: Glyph.click, rows: (S.uiActions ?? []).map((u) => (
      <div class="li"><div class="grow">{link('sys_ui_action', u.sysId, u.name)}<div class="det">{u.table}</div></div></div>)) },
  ].filter((g) => g.rows.length > 0);
  const suspects = groups.reduce((n, g) => n + g.rows.length, 0);
  // Resumo da lista recolhida: a mudança que está na tela (de → para · quando).
  const cur = r.changes[sel >= 0 ? sel : 0];
  const curHint = cur ? `${cur.oldValue || cur.checkpoint > 1 ? `${valueLabel(r, cur.oldValue)} → ` : `${P.createdAs} `}${valueLabel(r, cur.newValue)} · ${when(cur.at)}` : undefined;
  return (
    <div class="stack">
      {rows.length > 0 && <Fold cls="hist-fold" title={fmt(P.histList, { field })} count={rows.length} hint={curHint} open={open} onToggle={onOpen}>
      {r.changes.length > 0 && <div class="li"><span class="grow muted small">{P.historyIntro}</span></div>}
      <div class="hist hist-in">
        {rows.map(({ at, i }) => {
          const p = parts(at);
          if (i === -1) {
            return (
              <div class="h unaud"><div class="dt">{p.date}<small>{p.time}</small></div>
                <div class="c">{P.unauditedRow}<small>{r.unaudited?.lastUpdatedBy}</small></div><span class="g warn">{P.attention}</span></div>
            );
          }
          const c = r.changes[i]!;
          const top = c.evidence[0];
          const expired = c.notes.some((n) => n.startsWith('traces_expired'));
          return (
            <div class={`h ${i === sel ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={i === sel} style={`--i:${i}`} onClick={() => onPick(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); } }}>
              <div class="dt">{p.date}<small>{p.time}</small></div>
              <div class="c">{c.oldValue || c.checkpoint > 1 ? <><Val raw={c.oldValue} text={valueLabel(r, c.oldValue)} refTable={r.refTable} origin={origin} empty={P.empty} /> → <b><Val raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></b></> : <>{P.createdAs} <b><Val raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></b></>}
                <small>{top ? `${top.type === 'user_action' ? top.artifact.name : P.kind[top.type].split(' · ')[0]}` : expired ? P.warnExpired : c.user}</small></div>
              <span class={`g ${top?.grade ?? 'none'}`}>{top ? P.certainty[top.grade] : P.noTrace}</span>
            </div>
          );
        })}
      </div>
      </Fold>}
      {suspects === 0 && <FoldStatic cls="other-rules" title={fmt(P.otherRules, { field })} hint={s.noSuspects} />}
      {suspects > 0 && <Fold cls="other-rules" title={fmt(P.otherRules, { field })} count={suspects} hint={groups.map((g) => `${g.title} ${g.rows.length}`).join(' · ')}>
        <div class="muted small pad">{P.otherRulesHint}</div>
        {groups.map((g) => (
          <Fold nested icon={g.icon} title={g.title} count={g.rows.length}>
            {g.rows}
          </Fold>
        ))}
      </Fold>}
    </div>
  );
}

const diffLabels = (): DiffLabels => ({ onlyChanges: P.diffOnly, whole: P.diffWhole, same: P.diffSame, added: P.diffAdded, removed: P.diffRemoved, before: P.diffBefore, after: P.diffAfter });

/** Valor longo (script, descrição): em vez do texto inteiro, quantas linhas mudaram e a primeira delas. */
function DiffSummary({ oldText, newText, onOpen }: { oldText: string; newText: string; onOpen: (x: number, y: number) => void }) {
  const d = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const first = d.ops.find((o) => o.t !== 'eq');
  return (
    <button class="dsum" onClick={(e) => onOpen(e.clientX, e.clientY)}>
      <span class="stat"><b class="add">+{d.added}</b> <b class="del">−{d.removed}</b> {P.diffLines}</span>
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
    const key = await handoff('diff', { title, sub, oldText, newText });
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
