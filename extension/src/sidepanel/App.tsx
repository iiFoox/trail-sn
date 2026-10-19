import type { AccessReport, Change, Evidence, Investigation } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { recordLink } from '../shared/instances';
import { send, storageKey, type TabState } from '../shared/messages';

const s = t();

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

export function App() {
  const [tabId, setTabId] = useState<number>();
  const [state, setState] = useState<TabState>();

  useEffect(() => {
    let key = '';
    void currentTabId().then(async (id) => {
      if (id === undefined) return;
      setTabId(id);
      key = storageKey.tab(id);
      const o = await chrome.storage.session.get(key);
      setState(o[key] as TabState | undefined);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const ch = changes[key];
      if (area === 'session' && key && ch) setState(ch.newValue as TabState | undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    const onTab = () => void currentTabId().then((id) => { if (id !== undefined && id !== tabId) location.reload(); });
    chrome.tabs.onActivated.addListener(onTab);
    return () => { chrome.storage.onChanged.removeListener(listener); chrome.tabs.onActivated.removeListener(onTab); };
  }, []);

  const ctx = state?.ctx;
  const origin = ctx?.origin;

  return (
    <div class="wrap">
      <h1>Trail</h1>
      {state?.access && <AccessNotice report={state.access} />}
      {state?.status === 'running' && <div class="card">{s.running}</div>}
      {state?.status === 'error' && <div class="notice bad">{state.error}</div>}
      {state?.result && origin && <Result r={state.result} origin={origin} />}
      <ManualForm origin={origin} table={ctx?.table} sysId={ctx?.sysId} tabId={tabId} />
    </div>
  );
}

function AccessNotice({ report }: { report: AccessReport }) {
  if (report.level === 'full') return null;
  const sources = report.denied.join(', ');
  return (
    <div class={`notice ${report.level === 'none' ? 'bad' : ''}`}>
      {report.level === 'none' ? s.accessNone : fmt(s.accessPartial, { sources })}
      {report.level === 'none' && <div class="muted"><code>{sources}</code></div>}
    </div>
  );
}

function ManualForm({ origin, table, sysId, tabId }: { origin?: string; table?: string; sysId?: string; tabId?: number }) {
  const [tbl, setTbl] = useState(table ?? 'incident');
  const [rec, setRec] = useState(sysId ?? '');
  const [field, setField] = useState('state');
  useEffect(() => { if (table) setTbl(table); if (sysId) setRec(sysId); }, [table, sysId]);

  const go = async () => {
    const o = origin ?? (await currentOrigin());
    if (!o || tabId === undefined) return;
    const target = /^[0-9a-f]{32}$/.test(rec) ? { table: tbl, sysId: rec, field } : { table: tbl, number: rec, field };
    await send({ type: 'investigate', origin: o, target });
  };

  return (
    <details open={!sysId}>
      <summary>{s.manualTitle}</summary>
      {!origin && <p class="muted">{s.noContext}</p>}
      <label>{s.table}</label>
      <input value={tbl} onInput={(e) => setTbl((e.target as HTMLInputElement).value.trim())} />
      <label>{s.record}</label>
      <input value={rec} onInput={(e) => setRec((e.target as HTMLInputElement).value.trim())} />
      <label>{s.field}</label>
      <input value={field} onInput={(e) => setField((e.target as HTMLInputElement).value.trim())} />
      <div class="row" style="margin-top:8px">
        <button class="primary" onClick={go} disabled={!tbl || !rec || !field}>{s.investigate}</button>
      </div>
    </details>
  );
}

async function currentOrigin(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try { return tab?.url ? new URL(tab.url).origin : undefined; } catch { return undefined; }
}

function Result({ r, origin }: { r: Investigation; origin: string }) {
  return (
    <div>
      <div class="card">
        <div><b>{r.target.display}</b> · <code>{r.target.table}.{r.target.field}</code></div>
        <div class="muted">{fmt(s.timing, { calls: r.timing.calls, ms: r.timing.totalMs })}</div>
      </div>

      <h2>{s.changes}</h2>
      {r.changes.length === 0 && <p class="muted">{s.noChanges}</p>}
      <div class="timeline">
        {r.changes.map((c) => <ChangeView c={c} origin={origin} key={c.at + c.checkpoint} />)}
      </div>

      {r.unaudited && (
        <>
          <h2>{s.unaudited}</h2>
          <div class="notice">
            {fmt(s.unauditedHint, { n: r.unaudited.count })}
            <div class="muted">{r.unaudited.lastUpdatedOn} {s.by} {r.unaudited.lastUpdatedBy}</div>
            {r.unaudited.clues.length > 0 && <ul>{r.unaudited.clues.map((x) => <li><code>{x}</code></li>)}</ul>}
          </div>
        </>
      )}

      <h2>{s.suspects}</h2>
      <p class="muted">{s.suspectsHint}</p>
      <ul>
        {r.suspects.businessRules.map((b) => (
          <li>[{b.when}/{b.order}] <a href={recordLink(origin, 'sys_script', b.sysId)} target="_blank">{b.name}</a> <span class="muted">({b.table})</span></li>
        ))}
        {r.suspects.viaScriptInclude.map((x) => (
          <li>{x.businessRule} → <a href={recordLink(origin, 'sys_script_include', x.scriptIncludeSysId)} target="_blank">{x.scriptInclude}</a></li>
        ))}
      </ul>

      {r.gaps.length > 0 && (
        <>
          <h2>{s.gaps}</h2>
          <ul>{r.gaps.map((g) => <li><code>{g}</code></li>)}</ul>
        </>
      )}
    </div>
  );
}

function ChangeView({ c, origin }: { c: Change; origin: string }) {
  return (
    <div class="change">
      <div><span class="when">{c.at}</span> <span class="muted">UTC · {s.by} {c.user} · cp {c.checkpoint}</span></div>
      <div class="value">"{c.oldValue}" → "{c.newValue}"</div>
      {c.notes.map((n) => <div class="notice">{fmt(s.tracesExpired, { table: n.split(':')[1] ?? '' })}</div>)}
      {c.evidence.map((e) => <EvidenceView e={e} origin={origin} />)}
    </div>
  );
}

function EvidenceView({ e, origin }: { e: Evidence; origin: string }) {
  const link = e.artifact.sysId && e.artifact.table ? recordLink(origin, e.artifact.table, e.artifact.sysId) : null;
  return (
    <div class="card">
      <div class="row">
        <span class={`badge ${e.grade}`}>{s.grade[e.grade]} · {e.score}</span>
        <b>{s.type[e.type]}</b>
        {link ? <a href={link} target="_blank">{e.artifact.name}</a> : <span>{e.artifact.name}</span>}
      </div>
      <details>
        <summary>{e.facts.length} fatos{e.gaps.length ? ` · ${e.gaps.length} lacunas` : ''}</summary>
        <table>
          {e.facts.map((f) => <tr><td>{f.points > 0 ? '+' : ''}{f.points}</td><td>{f.detail}</td><td class="muted"><code>{f.source}</code></td></tr>)}
        </table>
        {e.gaps.length > 0 && <ul class="muted">{e.gaps.map((g) => <li>{g}</li>)}</ul>}
      </details>
    </div>
  );
}
