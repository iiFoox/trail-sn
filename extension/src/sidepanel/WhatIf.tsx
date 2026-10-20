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
  const sure = res.steps.filter((s) => s.will === 'yes' || s.writes.length || s.kind === 'flow');
  return (
    <>
      {!sure.length && <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.wiNothing}</span></div></div>}
      {PHASES.map((ph) => {
        const list = res.steps.filter((s) => s.phase === ph);
        if (!list.length) return null;
        return (
          <div class="box">
            <h4>{P.wiPhase[ph]}<span>{list.length}</span></h4>
            {list.map((s) => (
              <div class="li">
                <span class="ck" title={s.kind}>{typeGlyph[s.kind] ?? Glyph.check}</span>
                <div class="grow">
                  <div>{s.sysId ? <a href={recordLink(origin, s.table, s.sysId)} target="_blank" rel="noreferrer">{s.name}</a> : s.name} <span class={`pill ${s.will === 'yes' ? '' : 'w'}`}>{s.will === 'yes' ? P.wiYes : P.wiMaybe}</span></div>
                  {s.writes.length > 0 && <div class="small">{s.writes.map((w) => <code>{w.field} = {w.value !== undefined ? label(w.value, w.field) : '?'}</code> )}</div>}
                  <div class="det">{s.why}{s.updatesAgain ? ` · ${P.wiAgain}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
      {Object.keys(res.result).length > 0 && (
        <div class="box">
          <h4>{P.wiResult}</h4>
          {Object.entries(res.result).map(([f, x]) => (
            <div class="li"><div class="grow"><code>{f}</code> <span class="old">{label(x.from, f)}</span> <span class="arr">→</span> <span class="new">{label(x.to, f)}</span> <span class="muted small">{fmt(P.wiBy, { who: x.by === 'você' ? P.wiYou : x.by })}</span></div></div>
          ))}
        </div>
      )}
      {res.skipped.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.wiSkipped}</span><span class="pill">{res.skipped.length}</span></h4></summary>
          {res.skipped.slice(0, 40).map((s) => <div class="li"><span class="ck x">–</span><div class="grow">{s.name}<div class="det">{s.why}</div></div></div>)}
        </details>
      )}
      <div class="muted small">{fmt(P.wiSummary, { n: res.steps.length, ms: res.timing.totalMs })} · {P.wiNote}</div>
    </>
  );
}

function demoPreview(r: Investigation, field: string, value: string): ChangePreview {
  const st = (phase: PreviewStep['phase'], kind: PreviewStep['kind'], name: string, writes: PreviewStep['writes'], why: string, extra: Partial<PreviewStep> = {}): PreviewStep => ({ phase, kind, name, table: 'sys_script', order: 100, will: 'yes', reacts: true, writes, why, ...extra });
  return {
    table: r.target.table, sysId: r.target.sysId, field, from: r.changes[0]?.newValue ?? '', to: value,
    steps: [
      st('client', 'data_lookup', 'Priority Lookup', [{ field: 'priority', value: '2' }], `"${field}" é entrada do lookup: recalcula no formulário`),
      st('before', 'br_before', 'Escala para o plantão', [{ field: 'assignment_group', value: 'Service Desk' }], `reage à mudança (${field})`),
      st('after', 'br_after', 'Avisa o solicitante', [{ field: 'work_notes' }], `reage à mudança (${field})`, { will: 'maybe', updatesAgain: true }),
    ],
    result: { [field]: { from: r.changes[0]?.newValue ?? '', to: value, by: 'você' }, priority: { from: '3', to: '2', by: 'Priority Lookup' }, assignment_group: { from: '', to: 'Service Desk', by: 'Escala para o plantão' } },
    skipped: [{ kind: 'br_before', name: 'Urgência para VIP', why: 'o filtro da regra não vale com este valor' }],
    timing: { totalMs: 920, calls: 11 },
  };
}
