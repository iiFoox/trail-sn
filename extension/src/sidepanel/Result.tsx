/**
 * Resultado da investigação em quatro abas: Resposta, Rastro, Provas e Histórico.
 * O cartão do topo (registro, campo, de → para, quando) fica fixo em todas.
 * Princípio: a resposta primeiro, em linguagem de gente; o detalhe técnico continua lá, um clique abaixo.
 */
import type { AccessReport, Change, Evidence, Grade, Investigation, TraceItem } from '@trail/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { RecordTimeline } from './Timeline';
import { diffLines, looksLong } from '../shared/diff';
import { DiffView, type DiffLabels } from '../shared/DiffView';

const lang = getPrefs().lang;
const s = t(lang);
const P = s.p;
const WINDOW = { before: 3, after: 15 };

type Tab = 'answer' | 'trace' | 'proof' | 'history';
const TABS: Tab[] = ['answer', 'trace', 'proof', 'history'];
const demoParams = new URLSearchParams(location.search);
const isDemo = demoParams.has('demo');
const forcedHist: 'field' | 'record' = isDemo && demoParams.get('hist') === 'record' ? 'record' : 'field';
const forcedTab: Tab | undefined = isDemo && TABS.includes(demoParams.get('tab') as Tab) ? (demoParams.get('tab') as Tab) : undefined;
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

function when(utc: string): string {
  const p = parts(utc);
  return fmt(P.at, { date: p.date, time: p.time }) + (p.rel ? ` · ${p.rel}` : '');
}

function valueLabel(r: Investigation, v: string): string {
  if (!v) return P.empty;
  const l = r.labels?.[v] ?? v;
  return l.length > 70 ? l.slice(0, 67) + '…' : l;
}

const certaintyDots: Record<Grade, number> = { confirmed: 3, probable: 2, candidate: 1 };

export const plural = (forms: string[], n: number) => fmt(forms[n === 1 ? 0 : 1] ?? forms[0]!, { n });
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** O motor escreve horários em UTC; o painel mostra tudo no fuso de quem lê. */
function localizeTimes(text: string, dayUtc: string): string {
  return text.replace(/(\d{4}-\d{2}-\d{2} )?\b(\d{2}:\d{2}:\d{2})\b/g, (m, d: string | undefined, h: string) => {
    if (d) { const p = parts(d + h); return `${p.date} ${p.full}`; }
    return dayUtc ? parts(`${dayUtc} ${h}`).full : m;
  });
}

function factText(kind: string, field: string): string {
  return fmt(P.fact[kind] ?? kind, { field });
}

// ---------- componente principal ----------
export function Result({ r, origin, access, toast, onField }: { r: Investigation; origin: string; access?: AccessReport; toast: (m: string) => void; onField: (field: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => tabFor(r.changes[0]));
  const [histMode, setHistMode] = useState<'field' | 'record'>(forcedHist);
  const [diffOpen, setDiffOpen] = useState(false);
  const [sel, setSel] = useState(0);
  useEffect(() => { setSel(0); setTab(tabFor(r.changes[0])); }, [r.target.field, r.target.sysId]);
  // No site, os textos ao lado do painel trocam a aba (só em demonstração).
  useEffect(() => {
    if (!isDemo) return;
    const on = (e: MessageEvent) => { const d = e.data as { type?: string; tab?: Tab } | null; if (d?.type === 'trail-demo-tab' && d.tab && TABS.includes(d.tab)) setTab(d.tab); };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  const c: Change | undefined = r.changes[sel];
  const field = humanField(r.target.field);

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
            : c.oldValue && looksLong(c.oldValue, c.newValue) ? <DiffSummary oldText={c.oldValue} newText={c.newValue} onOpen={() => setDiffOpen(true)} />
            : c.oldValue || c.checkpoint > 1 ? <><span class="old" title={c.oldValue}>{valueLabel(r, c.oldValue)}</span><span class="arr">→</span><span class="new" title={c.newValue}>{valueLabel(r, c.newValue)}</span></>
              : <><span class="muted small">{P.createdAs}</span><span class="new" title={c.newValue}>{valueLabel(r, c.newValue)}</span></>
          ) : <span class="muted small">{s.noChanges}</span>}
        </div>
        {c && <div class="when2">{when(c.at)}</div>}
      </div>
      {c && diffOpen && <DiffOverlay title={`${r.target.display} · ${field}`} sub={when(c.at)} oldText={c.oldValue} newText={c.newValue} onClose={() => setDiffOpen(false)} />}

      {c && (
        <div class="seg-tabs" role="tablist">
          {([['answer', P.tabAnswer, 0], ['trace', P.tabTrace, c.trace?.length ?? 0], ['proof', P.tabProof, c.evidence[0]?.facts.length ?? 0], ['history', P.tabHistory, r.changes.length + (r.unaudited ? 1 : 0)]] as [Tab, string, number][]).map(([k, label, n]) => (
            <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}{k !== 'answer' && n > 0 && <i>{n}</i>}{k === 'proof' && (denied.length > 0 || r.unaudited || expired) && <span class="wdot" />}
            </button>
          ))}
        </div>
      )}

      {!c && <History r={r} origin={origin} sel={-1} onPick={() => undefined} />}
      {c && tab === 'answer' && <Answer r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} goProof={() => setTab('proof')} copy={copy} />}
      {c && tab === 'trace' && <Trace r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} />}
      {c && tab === 'proof' && <Proof r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} access={access} copy={copy} />}
      {c && tab === 'history' && (
        <>
          <div class="seg2 hist-switch" role="group">
            <button aria-pressed={histMode === 'field'} onClick={() => setHistMode('field')}>{P.histField} · {field}</button>
            <button aria-pressed={histMode === 'record'} onClick={() => setHistMode('record')}>{P.histRecord}</button>
          </div>
          {histMode === 'field'
            ? <History r={r} origin={origin} sel={sel} onPick={(i) => { setSel(i); setTab(tabFor(r.changes[i]) === 'trace' ? 'trace' : 'answer'); }} />
            : <RecordTimeline origin={origin} table={r.target.table} sysId={r.target.sysId} onField={(f) => { setHistMode('field'); onField(f); }} />}
        </>
      )}

      <div class="footer">
        <span>{fmt(s.timing, { calls: r.timing.calls, ms: r.timing.totalMs })}</span>
        <button class="btn ghost sm" onClick={() => send({ type: 'clear-cache', origin })}>{Glyph.refresh} {s.reloadMeta}</button>
      </div>
    </div>
  );
}

// ---------- Resposta ----------
function Answer({ r, c, origin, field, denied, expired, goProof, copy }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; goProof: () => void; copy: (t: string) => void }) {
  const top = c.evidence[0];
  const alt = c.evidence[1];
  const warns = [
    denied.length ? plural(P.warnDenied, denied.length) : '',
    r.unaudited ? plural(P.warnUnaudited, r.unaudited.count) : '',
    expired ? P.warnExpired : '',
  ].filter(Boolean);
  const summary = () => fmt(P.summary, {
    rec: r.target.display, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue), when: when(c.at),
    who: top?.artifact.name ?? '?', type: top ? s.type[top.type] : '?', cert: top ? P.certainty[top.grade] : P.noCause,
    facts: (top?.facts ?? []).map((f) => `• ${factText(f.kind, field)}`).join('\n'),
  });
  const link = top?.artifact.sysId && top.artifact.table ? recordLink(origin, top.artifact.table, top.artifact.sysId) : null;
  const best = top ? [...top.facts].sort((a, b) => b.points - a.points)[0] : undefined;
  return (
    <div class="stack">
      {top ? (
        <>
          <div class="who">
            <span class="ic">{typeGlyph[top.type]}</span>
            <div class="grow">
              <div class="k">{P.whoChanged} · {top.type === 'user_action' && top.facts.some((f) => /\/api\//.test(f.detail)) ? (P.kind as Record<string, string>).user_api : P.kind[top.type]}</div>
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
      <div class={`btns ${link ? '' : 'one'}`}>
        {link && <a class="btn primary big" href={link} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openArtifact, { what: P.what[top?.artifact.table ?? ''] ?? s.openInStudio })}</a>}
        <button class="btn big" onClick={() => copy(summary())}>{Glyph.copy} {P.copySummary}</button>
      </div>
      {alt && (
        <button class="alt" onClick={goProof}>
          <span class="ic sm">{typeGlyph[alt.type]}</span>
          <span class="grow">{P.otherPossibility} <b>{alt.artifact.name}</b></span>
          <span class="pill">{P.likelihood[alt.grade]}</span>
        </button>
      )}
      {warns.length > 0 && (
        <button class="warnbar" onClick={goProof}>{Glyph.warn}<span class="grow">{warns.join(' · ')}</span><span class="muted">{P.seeInProof}</span></button>
      )}
    </div>
  );
}

// ---------- Rastro ----------
function traceTitle(r: Investigation, c: Change, it: TraceItem, field: string): string {
  return fmt(P.tr[it.kind] ?? it.kind, { user: it.user ?? '', label: it.label, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue) });
}

const traceIcon: Record<string, preact.JSX.Element> = {
  form: Glyph.user, ui_action: Glyph.click, async: Glyph.async, job: Glyph.clock, api: Glyph.plug, background_script: Glyph.terminal,
  event: Glyph.event, flow: Glyph.flow, workflow: Glyph.flow, change: Glyph.check,
};

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
      <ol class="tl">
        {items.map((it) => {
          const p = parts(it.at);
          const isChange = it.kind === 'change';
          const isWrite = it.kind === 'write';
          return (
            <li class={`${it.cause ? 'key' : ''} ${isChange ? 'res' : ''} ${isWrite ? 'other' : ''}`}>
              <div class="t"><b>{p.full}</b>{it.cause ? <span class="tag">{P.cause}</span> : it.user ? <span class="muted">{it.user}</span> : null}</div>
              <div class="x"><span class="ti">{isWrite ? Glyph.rule : traceIcon[it.kind]}</span>{isWrite ? P.otherWrite : traceTitle(r, c, it, field)}</div>
              {(it.kind === 'async' || it.kind === 'job') && <div class="sub2">{it.label}</div>}
              {it.sent !== undefined && <div class="sub2">{fmt(P.sent, { field, value: valueLabel(r, it.sent) })}</div>}
              {isWrite && <ul class="fw">{(it.fields ?? []).slice(0, 6).map((f) => <li><b>{humanField(f.field)}</b> {rawValue(f.oldValue)} → {rawValue(f.newValue)}</li>)}{(it.fields?.length ?? 0) > 6 && <li class="muted">{fmt(P.moreFields, { n: (it.fields?.length ?? 0) - 6 })}</li>}</ul>}
              {isChange && it.fields?.length ? <div class="sub2 muted">{fmt(P.sameWrite, { list: it.fields.map((f) => humanField(f.field)).join(', ') })}</div> : null}
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
  return (
    <div class="stack">
      {top && (
        <div class="box">
          <h4>{P.whyThis}<span>{fmt(P.nProofs, { n: top.facts.length })}</span></h4>
          {top.facts.map((f) => <FactRow kind={f.kind} detail={localizeTimes(f.detail, c.at.slice(0, 10))} source={f.source} field={field} ok={f.points >= 0} />)}
          {top.gaps.map((g) => <div class="li"><span class="ck w">!</span><span class="grow">{localizeTimes(g, c.at.slice(0, 10))}</span></div>)}
        </div>
      )}
      {others.map((e) => <Other e={e} origin={origin} field={field} day={c.at.slice(0, 10)} />)}
      <div class="box">
        <h4 class={missingCount ? 'warnh' : ''}>{P.missing}</h4>
        {!missingCount && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.nothingMissing}</span></div>}
        {denied.length > 0 && (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <b>{cap(fmt(P.deniedItem, { what: denied.map((d) => P.srcName[d] ?? d).join(', ') }))}</b> {P.deniedHint}
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
      </div>
      <details class="box fold">
        <summary><h4>{P.techAccess}<span>{Glyph.chevron}</span></h4></summary>
        <div class="acc-list">
          {[...entries, ...(access ? Object.entries(access.states).filter(([k]) => !(k in r.access)).sort() : [])].map(([k, v]) => (
            <div><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></div>
          ))}
        </div>
        <div class="pad"><button class="btn sm" onClick={() => send({ type: 'check-access', origin })}>{Glyph.shield} {P.recheck}</button></div>
      </details>
    </div>
  );
}

function FactRow({ kind, detail, source, field, ok }: { kind: string; detail: string; source: string; field: string; ok: boolean }) {
  return (
    <div class="li">
      <span class={`ck ${ok ? '' : 'x'}`}>{ok ? Glyph.check : '–'}</span>
      <div class="grow">{factText(kind, field)}<div class="det">{detail}</div></div>
      <span class="srcp">{P.srcName[source] ?? source}</span>
    </div>
  );
}

function Other({ e, origin, field, day }: { e: Evidence; origin: string; field: string; day: string }) {
  const link = e.artifact.sysId && e.artifact.table ? recordLink(origin, e.artifact.table, e.artifact.sysId) : null;
  return (
    <details class="box fold">
      <summary><h4><span class="grow">{fmt(P.whyNotOther, { name: e.artifact.name })}</span><span class="pill">{P.likelihood[e.grade]}</span></h4></summary>
      <div class="li"><span class="ck x">–</span><span class="grow">{P.weaker}</span></div>
      {e.gaps.map((g) => <div class="li"><span class="ck x">–</span><span class="grow">{localizeTimes(g, day)}</span></div>)}
      {e.facts.map((f) => <FactRow kind={f.kind} detail={localizeTimes(f.detail, day)} source={f.source} field={field} ok={f.points >= 0} />)}
      {link && <div class="pad"><a href={link} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openArtifact, { what: P.what[e.artifact.table ?? ''] ?? s.openInStudio })}</a></div>}
    </details>
  );
}

// ---------- Histórico ----------
function History({ r, origin, sel, onPick }: { r: Investigation; origin: string; sel: number; onPick: (i: number) => void }) {
  const field = humanField(r.target.field);
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
  return (
    <div class="stack">
      {r.changes.length > 0 && <div class="muted small">{P.historyIntro}</div>}
      <div class="hist">
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
            <button class={`h ${i === sel ? 'on' : ''}`} onClick={() => onPick(i)}>
              <div class="dt">{p.date}<small>{p.time}</small></div>
              <div class="c">{c.oldValue || c.checkpoint > 1 ? <>{valueLabel(r, c.oldValue)} → <b>{valueLabel(r, c.newValue)}</b></> : <>{P.createdAs} <b>{valueLabel(r, c.newValue)}</b></>}
                <small>{top ? `${top.type === 'user_action' ? top.artifact.name : P.kind[top.type].split(' · ')[0]}` : expired ? P.warnExpired : c.user}</small></div>
              <span class={`g ${top?.grade ?? 'none'}`}>{top ? P.certainty[top.grade].toLowerCase() : P.noTrace}</span>
            </button>
          );
        })}
      </div>
      <details class="box fold">
        <summary><h4>{fmt(P.otherRules, { field })}<span>{suspects} {Glyph.chevron}</span></h4></summary>
        <div class="muted small pad">{P.otherRulesHint}</div>
        {groups.map((g, gi) => (
          <details class="grp" open={gi === 0 && groups.length <= 2}>
            <summary><span class="ic sm">{g.icon}</span><b class="grow">{g.title}</b><i>{g.rows.length}</i><span class="chev">{Glyph.chevron}</span></summary>
            {g.rows}
          </details>
        ))}
        {suspects === 0 && <div class="li muted">{s.noSuspects}</div>}
      </details>
    </div>
  );
}

const diffLabels = (): DiffLabels => ({ onlyChanges: P.diffOnly, whole: P.diffWhole, same: P.diffSame, added: P.diffAdded, removed: P.diffRemoved, before: P.diffBefore, after: P.diffAfter });

/** Valor longo (script, descrição): em vez do texto inteiro, quantas linhas mudaram e a primeira delas. */
function DiffSummary({ oldText, newText, onOpen }: { oldText: string; newText: string; onOpen: () => void }) {
  const d = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const first = d.ops.find((o) => o.t !== 'eq');
  return (
    <button class="dsum" onClick={onOpen}>
      <span class="stat"><b class="add">+{d.added}</b> <b class="del">−{d.removed}</b> {P.diffLines}</span>
      {first && <code class={first.t}>{first.t === 'add' ? '+ ' : '− '}{first.text.trim().slice(0, 90) || ' '}</code>}
      <span class="go">{Glyph.open} {P.diffOpen}</span>
    </button>
  );
}

/** Diferença em tela cheia dentro do painel, com opção de abrir lado a lado numa janela larga. */
function DiffOverlay({ title, sub, oldText, newText, onClose }: { title: string; sub: string; oldText: string; newText: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const sideBySide = async () => {
    if (isDemo) return;
    const key = `diff:${Date.now()}`;
    await chrome.storage.session.set({ [key]: { title, sub, oldText, newText } });
    await chrome.windows.create({ url: chrome.runtime.getURL(`src/diff/index.html?k=${encodeURIComponent(key)}`), type: 'popup', width: 1200, height: 860 });
  };
  return (
    <div class="overlay" role="dialog" aria-label={title}>
      <div class="ohead">
        <div class="grow"><b>{title}</b><div class="muted small">{sub}</div></div>
        {!isDemo && <button class="btn sm" onClick={sideBySide}>{Glyph.detach} {P.diffSide}</button>}
        <button class="icon-btn" aria-label={P.close} title={P.close} onClick={onClose}>✕</button>
      </div>
      <DiffView oldText={oldText} newText={newText} labels={diffLabels()} />
    </div>
  );
}
