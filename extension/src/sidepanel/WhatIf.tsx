/** "E se eu mudar?": prevê o que o ServiceNow roda se o campo mudar para um valor novo. Só leitura. */
import type { ChangePreview, Investigation, PreviewStep } from '@trail/core';
import { useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');
const PHASES: PreviewStep['phase'][] = ['client', 'before', 'after', 'async'];

export function WhatIf({ r, origin, field }: { r: Investigation; origin: string; field: string }) {
  const current = r.changes[0]?.newValue ?? '';
  const [value, setValue] = useState('');
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<ChangePreview>();
  const [err, setErr] = useState('');
  // Os rótulos da investigação são do campo investigado; os outros campos mostram o valor gravado.
  const label = (v: string, f: string = field) => (!v ? '—' : f === field || f === r.target.field ? r.labels?.[v] ?? v : v);
  const options = Object.entries(r.labels ?? {}).filter(([k]) => k !== current).slice(0, 30);
  const run = async () => {
    if (value === current) { setErr(P.wiSame); setSt('err'); return; }
    setSt('run');
    try {
      const out = isDemo ? demoPreview(r, field, value) : await send<ChangePreview & { error?: string }>({ type: 'preview', origin, target: { table: r.target.table, sysId: r.target.sysId, field, value } });
      if (isDemo) await new Promise((x) => setTimeout(x, 500));
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  return (
    <div class="stack">
      <div class="box">
        <h4>{fmt(P.wiTitle, { field })}</h4>
        <div class="li"><span class="grow muted small">{P.wiHint}</span></div>
        <div class="li wi-in">
          <label class="grow"><span class="muted small">{P.wiValue}</span>
            <input list="wi-opts" value={value} placeholder={current ? label(current) : ''} onInput={(e) => setValue((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && value) void run(); }} />
            <datalist id="wi-opts">{options.map(([k, l]) => <option value={k}>{l}</option>)}</datalist>
          </label>
          <button class="btn sm" disabled={!value || st === 'run'} onClick={run}>{Glyph.search} {P.wiRun}</button>
        </div>
        {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.wiRunning}</span></div>}
        {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow">{err}</span></div>}
      </div>
      {st === 'done' && res && <Outcome res={res} origin={origin} label={label} />}
    </div>
  );
}

function Outcome({ res, origin, label }: { res: ChangePreview; origin: string; label: (v: string, f?: string) => string }) {
  const show = (v: string, f: string) => (v === '\u0000calc' ? P.wiCalc : label(v, f));
  const row = (s: PreviewStep) => (
    <div class="li">
      <span class="ck" title={s.kind}>{typeGlyph[s.kind] ?? Glyph.check}</span>
      <div class="grow">
        <div>{s.sysId ? <a href={recordLink(origin, s.table, s.sysId)} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</div>
        {s.writes.map((w) => <div class="small"><code>{w.field}</code> → {w.value !== undefined ? label(w.value, w.field) : <i>{P.wiCalc}</i>}</div>)}
        <div class="det">{s.why}{s.updatesAgain ? ` · ${P.wiAgain}` : ''}</div>
      </div>
    </div>
  );
  const effects = Object.entries(res.result).filter(([f]) => f !== res.field);
  return (
    <>
      {!res.steps.length && <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.wiNothing}</span></div></div>}
      {PHASES.map((ph) => {
        const list = res.steps.filter((s) => s.phase === ph);
        if (!list.length) return null;
        return <div class="box"><h4>{P.wiPhase[ph]}<span>{list.length}</span></h4>{list.map(row)}</div>;
      })}
      {effects.length > 0 && (
        <div class="box">
          <h4>{P.wiResult}</h4>
          {Object.entries(res.result).map(([f, x]) => (
            <div class="li"><div class="grow"><code>{f}</code> <span class="old">{label(x.from, f)}</span> <span class="arr">→</span> <span class="new">{show(x.to, f)}</span> <span class="muted small">{fmt(P.wiBy, { who: x.by === 'você' ? P.wiYou : x.by })}</span></div></div>
          ))}
        </div>
      )}
      {res.uncertain.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.wiUncertain}<span class="why">{P.wiUncertainHint}</span></span><span class="pill w">{res.uncertain.length}</span></h4></summary>
          {res.uncertain.map(row)}
        </details>
      )}
      {res.skipped.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.wiSkipped}</span><span class="pill">{res.skipped.length}</span></h4></summary>
          {res.skipped.slice(0, 40).map((s) => <div class="li"><span class="ck x">–</span><div class="grow">{s.name}<div class="det">{s.why}</div></div></div>)}
        </details>
      )}
      <div class="muted small">{fmt(P.wiSummary, { n: res.steps.length, ms: res.timing.totalMs })}</div>
    </>
  );
}

function demoPreview(r: Investigation, field: string, value: string): ChangePreview {
  const calc = '\u0000calc';
  return {
    table: r.target.table, sysId: r.target.sysId, field, from: r.changes[0]?.newValue ?? '', to: value,
    steps: [
      { phase: 'before', kind: 'br_before', name: 'mark_resolved', table: 'sys_script', sysId: 'demo', order: 100, will: 'yes', reacts: true, writes: [{ field: 'resolved_by' }, { field: 'resolved_at' }], why: `reage à mudança de ${field}` },
    ],
    uncertain: [{ phase: 'before', kind: 'br_before', name: 'Caller Close', table: 'sys_script', order: 100, will: 'maybe', reacts: true, writes: [{ field: 'close_code' }], why: `reage à mudança de ${field}` }],
    result: { [field]: { from: r.changes[0]?.newValue ?? '', to: value, by: 'você' }, resolved_by: { from: '', to: calc, by: 'mark_resolved' }, resolved_at: { from: '', to: calc, by: 'mark_resolved' } },
    skipped: [{ kind: 'br_before', name: 'Urgência para VIP', why: 'o filtro da regra não vale com este valor' }],
    timing: { totalMs: 880, calls: 9 },
  };
}
