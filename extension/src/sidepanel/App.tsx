import type { AccessReport, Change, Evidence, Investigation } from '@trail/core';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { demoState } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { EmptyIllustration, Glyph, TrailMark, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send, storageKey, type TabState } from '../shared/messages';

const s = t();
const isDemo = new URLSearchParams(location.search).has('demo');

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<TabState | undefined>(isDemo ? demoState() : undefined);
  const [fallbackOrigin, setFallbackOrigin] = useState<string>();

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
    return () => { chrome.storage.onChanged.removeListener(onChange); chrome.tabs.onActivated.removeListener(onTab); };
  }, []);

  const origin = state?.ctx?.origin ?? fallbackOrigin;
  const level = state?.access?.level;

  return (
    <>
      <header class="topbar">
        <div class="brand"><span class="mark"><TrailMark /></span>Trail</div>
        {origin && <span class="host" title={origin}>{origin.replace(/^https?:\/\//, '')}</span>}
        {level && <span class={`dot ${level === 'full' ? '' : level}`} title={level} />}
      </header>
      <main class="wrap">
        {state?.access && <AccessNotice report={state.access} />}
        {state?.status === 'running' && <Loading />}
        {state?.status === 'error' && <div class="notice bad"><div class="title">{s.errorTitle}</div>{state.error}</div>}
        {state?.result && origin && <Result r={state.result} origin={origin} />}
        {!state?.result && state?.status !== 'running' && (
          <div class="empty">
            <EmptyIllustration />
            <div class="title">{s.emptyTitle}</div>
            <div>{s.noContext}</div>
          </div>
        )}
      </main>
      <ManualDrawer origin={origin} table={state?.ctx?.table ?? state?.result?.target.table} sysId={state?.ctx?.sysId ?? state?.result?.target.sysId} field={state?.result?.target.field} tabId={tabId} open={!state?.result} />
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

function ManualDrawer({ origin, table, sysId, field, tabId, open }: { origin?: string; table?: string; sysId?: string; field?: string; tabId?: number; open: boolean }) {
  const [tbl, setTbl] = useState(table ?? 'incident');
  const [rec, setRec] = useState(sysId ?? '');
  const [fld, setFld] = useState(field ?? 'state');
  useEffect(() => { if (table) setTbl(table); if (sysId) setRec(sysId); if (field) setFld(field); }, [table, sysId, field]);
  const go = async () => {
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
          <button class="btn primary" onClick={go} disabled={isDemo || !origin || !tbl || !rec || !fld}>{Glyph.search} {s.investigate}</button>
          {!origin && <span class="muted small">{s.notServiceNow}</span>}
        </div>
      </div>
    </details>
  );
}

type Tab = 'timeline' | 'suspects' | 'access';

function Result({ r, origin }: { r: Investigation; origin: string }) {
  const [tab, setTab] = useState<Tab>('timeline');
  const suspectsCount = r.suspects.businessRules.length + r.suspects.viaScriptInclude.length;
  return (
    <div>
      <div class="card record">
        <div>
          <div class="num"><a href={recordLink(origin, r.target.table, r.target.sysId)} target="_blank" rel="noreferrer">{r.target.display}</a></div>
          <div class="sub">{r.tables.join(' › ')}</div>
        </div>
        <span class="chip teal"><span class="k">{s.field}:</span> {r.target.field}</span>
      </div>

      <div class="tabs" role="tablist">
        <button class="tab" role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>{s.changes} <span class="count">{r.changes.length}</span></button>
        <button class="tab" role="tab" aria-selected={tab === 'suspects'} onClick={() => setTab('suspects')}>{s.suspects} <span class="count">{suspectsCount}</span></button>
        <button class="tab" role="tab" aria-selected={tab === 'access'} onClick={() => setTab('access')}>{s.accessTab}{r.gaps.length > 0 && <span class="count">{r.gaps.length}</span>}</button>
      </div>

      {tab === 'timeline' && <Timeline r={r} origin={origin} />}
      {tab === 'suspects' && <Suspects r={r} origin={origin} />}
      {tab === 'access' && <Access r={r} origin={origin} />}

      <div class="footer">
        <span>{fmt(s.timing, { calls: r.timing.calls, ms: r.timing.totalMs })}</span>
        <button class="btn ghost sm" onClick={() => send({ type: 'clear-cache', origin })}>{Glyph.refresh} {s.reloadMeta}</button>
      </div>
    </div>
  );
}

function Timeline({ r, origin }: { r: Investigation; origin: string }) {
  return (
    <>
      {r.unaudited && (
        <div class="notice">
          <div class="title">{s.unaudited}</div>
          <div class="small">{fmt(s.unauditedHint, { n: r.unaudited.count })}</div>
          <div class="small muted">{r.unaudited.lastUpdatedOn} UTC · {s.by} {r.unaudited.lastUpdatedBy}</div>
          {r.unaudited.clues.length > 0 && <ul class="small" style="margin:4px 0 0;padding-left:16px">{r.unaudited.clues.map((x) => <li><code>{x}</code></li>)}</ul>}
        </div>
      )}
      {r.changes.length === 0 && <div class="empty"><EmptyIllustration /><div class="title">{s.noChanges}</div></div>}
      <div class="timeline">
        {r.changes.map((c) => <ChangeView c={c} origin={origin} key={c.at + c.checkpoint} />)}
      </div>
    </>
  );
}

function initials(user: string): string {
  if (!user || user === 'system') return 'SYS';
  return user.split(/[._\s]/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function localTime(utc: string): string {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? utc : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
}

function ChangeView({ c, origin }: { c: Change; origin: string }) {
  const top = c.evidence[0]?.grade ?? 'candidate';
  return (
    <div class={`change ${top}`}>
      <div class="change-head">
        <span class="when" title={`${c.at} UTC`}>{localTime(c.at)}<small>cp {c.checkpoint}</small></span>
        <span class="avatar" title={c.user}>{initials(c.user)}</span>
        <span class="muted small">{c.user}</span>
      </div>
      <div class="values">
        <span class="val" title={c.oldValue}>{c.oldValue || '∅'}</span>
        <span class="arrow">→</span>
        <span class="val new" title={c.newValue}>{c.newValue || '∅'}</span>
      </div>
      {c.notes.map((n) => <div class="notice info small">{fmt(s.tracesExpired, { table: n.split(':')[1] ?? '' })}</div>)}
      {c.evidence.map((e) => <EvidenceView e={e} origin={origin} />)}
    </div>
  );
}

function EvidenceView({ e, origin }: { e: Evidence; origin: string }) {
  const link = e.artifact.sysId && e.artifact.table ? recordLink(origin, e.artifact.table, e.artifact.sysId) : null;
  const pct = Math.max(4, Math.min(100, e.score));
  return (
    <div class={`ev ${e.grade}`}>
      <div class="ev-head">
        <span class="ev-icon">{typeGlyph[e.type]}</span>
        <div class="ev-title">
          <span class="type">{s.type[e.type]}</span>
          {link ? <a href={link} target="_blank" rel="noreferrer">{e.artifact.name}</a> : <span>{e.artifact.name}</span>}
        </div>
        <span class={`badge ${e.grade}`}>{s.grade[e.grade]} <span class="mono">{e.score}</span></span>
      </div>
      <div class="meter"><i style={`width:${pct}%`} /></div>
      <details class="facts">
        <summary>{fmt(s.factsSummary, { n: e.facts.length })}{e.gaps.length ? ` · ${fmt(s.gapsSummary, { n: e.gaps.length })}` : ''}</summary>
        <table class="facts-table">
          {e.facts.map((f) => <tr><td class={`pts ${f.points < 0 ? 'neg' : ''}`}>{f.points > 0 ? '+' : ''}{f.points}</td><td>{f.detail}</td><td class="src">{f.source}</td></tr>)}
        </table>
        {e.gaps.map((g) => <div class="gap">{g}</div>)}
      </details>
    </div>
  );
}

function Suspects({ r, origin }: { r: Investigation; origin: string }) {
  return (
    <>
      <p class="muted small">{s.suspectsHint}</p>
      <div class="card flat">
        <ul class="list">
          {r.suspects.businessRules.map((b) => (
            <li><span class="ev-icon">{Glyph.rule}</span>
              <div class="grow"><a href={recordLink(origin, 'sys_script', b.sysId)} target="_blank" rel="noreferrer">{b.name}</a><div class="muted small">{b.table} · {b.when} · {s.order} {b.order}</div></div>
              <span class="chip">{b.when}</span></li>
          ))}
          {r.suspects.viaScriptInclude.map((x) => (
            <li><span class="ev-icon">{Glyph.include}</span>
              <div class="grow">{x.businessRule} → <a href={recordLink(origin, 'sys_script_include', x.scriptIncludeSysId)} target="_blank" rel="noreferrer">{x.scriptInclude}</a></div></li>
          ))}
          {r.suspects.businessRules.length + r.suspects.viaScriptInclude.length === 0 && <li class="muted">{s.noSuspects}</li>}
        </ul>
      </div>
    </>
  );
}

function Access({ r, origin }: { r: Investigation; origin: string }) {
  const entries = useMemo(() => Object.entries(r.access).sort(), [r.access]);
  return (
    <>
      <p class="muted small">{s.accessHint}</p>
      <div class="card flat">
        <div class="access-grid">
          {entries.map(([k, v]) => <><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></>)}
        </div>
      </div>
      {r.gaps.length > 0 && (
        <div class="notice"><div class="title">{s.gaps}</div>
          <div class="small">{s.gapsHint}</div>
          <div class="small" style="margin-top:4px"><code>{r.gaps.join(' · ')}</code></div>
        </div>
      )}
      <div class="row" style="margin-top:10px">
        <button class="btn sm" onClick={() => send({ type: 'check-access', origin })}>{Glyph.shield} {s.checkAccess}</button>
      </div>
    </>
  );
}
