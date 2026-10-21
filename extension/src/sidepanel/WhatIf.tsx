/** "E se eu mudar?": prevê o que o ServiceNow roda se o campo mudar para um valor novo. Só leitura. */
import type { ChangePreview, Investigation, PreviewStep } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { trackedTab } from '../shared/tabRef';
import { getPrefs } from '../shared/prefs';
import { fieldName } from './Result';
import { Val } from './Val';
import { ErrorMsg } from './ErrorMsg';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');
const PHASES: PreviewStep['phase'][] = ['client', 'before', 'after', 'async'];

export function WhatIf({ r, origin }: { r: Investigation; origin: string; field?: string }) {
  const field = r.target.field;
  const name = fieldName(r);
  const current = r.changes[0]?.newValue ?? '';
  const [value, setValue] = useState('');
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<ChangePreview>();
  const [err, setErr] = useState('');
  const options = Object.entries(r.labels ?? {}).filter(([k]) => k !== current).slice(0, 40);
  const run = async (v = value) => {
    if (!v) return;
    if (v === current) { setErr(P.wiSame); setSt('err'); return; }
    setSt('run');
    try {
      const out = isDemo ? demoPreview(r, field, v) : await send<ChangePreview & { error?: string }>({ type: 'preview', origin, tabId: trackedTab(), target: { table: r.target.table, sysId: r.target.sysId, field, value: v } });
      if (isDemo) await new Promise((x) => setTimeout(x, 500));
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  return (
    <div class="stack">
      <div class="box wi-box">
        <h4>{fmt(P.wiTitle, { field: name })}</h4>
        <div class="li"><span class="grow muted small">{P.wiHint}</span></div>
        <div class="wi-now small"><span class="muted">{P.wiNow}</span> <b><Val raw={current} text={r.labels?.[current]} refTable={r.refTable} origin={origin} empty={P.empty} /></b></div>
        <div class="wi-in">
          <Combo options={options} value={value} placeholder={options.length ? P.wiPick : P.wiType} onChange={setValue} onEnter={(v) => void run(v)} />
          <button class="btn primary sm" disabled={!value || st === 'run'} onClick={() => void run()}>{Glyph.search} {P.wiRun}</button>
        </div>
        {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.wiRunning}</span></div>}
        {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow">{err === P.wiSame ? err : <ErrorMsg msg={err} />}</span></div>}
      </div>
      {st === 'done' && res && <Outcome res={res} r={r} origin={origin} />}
    </div>
  );
}

/** Caixa de escolha no estilo do painel: mostra o nome do valor (ex.: "2 - Medium"); aceita digitar um valor livre. */
function Combo({ options, value, placeholder, onChange, onEnter }: { options: [string, string][]; value: string; placeholder: string; onChange: (v: string) => void; onEnter: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, []);
  const needle = text.trim().toLowerCase();
  const list = options.filter(([k, l]) => !needle || options.some(([, x]) => x === text) || `${k} ${l}`.toLowerCase().includes(needle));
  const pick = (k: string, l: string) => { onChange(k); setText(l); setOpen(false); };
  const typed = (t: string) => { setText(t); setHi(0); setOpen(true); const hit = options.find(([k, l]) => l.toLowerCase() === t.trim().toLowerCase() || k === t.trim()); onChange(hit ? hit[0] : t.trim()); };
  return (
    <div class={`combo grow ${open ? 'open' : ''}`} ref={box}>
      <input value={text} placeholder={placeholder} role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => options.length && setOpen(true)} onClick={() => options.length && setOpen(true)}
        onInput={(e) => typed((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(list.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
          else if (e.key === 'Enter') { e.preventDefault(); const o = open ? list[hi] : undefined; if (o) pick(o[0], o[1]); else if (value) onEnter(value); }
        }} />
      {options.length > 0 && <button class="cv" tabIndex={-1} aria-label={P.wiPick} onClick={() => setOpen(!open)}>{Glyph.chevron}</button>}
      {open && list.length > 0 && (
        <ul class="combo-list" role="listbox">
          {list.map(([k, l], i) => (
            <li role="option" aria-selected={k === value} class={i === hi ? 'hi' : ''} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(k, l); }}>
              <span class="cl">{l}</span>{l !== k && !/^[0-9a-f]{32}$/.test(k) && <span class="ck2">{k}</span>}{k === value && <span class="ok">{Glyph.check}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Outcome({ res, r, origin }: { res: ChangePreview; r: Investigation; origin: string }) {
  const fname = (f: string) => res.fieldLabels?.[f] || (f === r.target.field ? fieldName(r) : f);
  const vtext = (f: string, v: string) => res.valueLabels?.[f]?.[v] ?? (f === r.target.field ? r.labels?.[v] : undefined);
  const V = ({ f, v, cls }: { f: string; v: string | undefined; cls?: string }) => (v === undefined || v === '\u0000calc'
    ? <i class="muted">{P.wiCalc}</i>
    : <Val raw={v} text={vtext(f, v)} refTable={res.refTables?.[f] ?? (f === r.target.field ? r.refTable : undefined)} origin={origin} cls={cls} empty={P.empty} />);
  // Os textos do motor citam o nome técnico ("reage à mudança de state"); aqui vira o nome do formulário.
  const names = Object.entries(res.fieldLabels ?? {}).sort((a, b) => b[0].length - a[0].length);
  const human = (t: string) => names.reduce((acc, [k, l]) => acc.replace(new RegExp(`\\b${k}\\b`, 'g'), l), t);
  const row = (s: PreviewStep) => (
    <div class="li">
      <span class="ck" title={s.kind}>{typeGlyph[s.kind] ?? Glyph.check}</span>
      <div class="grow">
        <div>{s.sysId ? <a href={recordLink(origin, s.table, s.sysId)} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</div>
        {s.writes.map((w) => <div class="small wi-w"><b>{fname(w.field)}</b> → <V f={w.field} v={w.value} cls="n" /></div>)}
        <div class="det">{human(s.why)}{s.updatesAgain ? ` · ${P.wiAgain}` : ''}</div>
      </div>
    </div>
  );
  const effects = Object.entries(res.result).filter(([f]) => f !== res.field);
  return (
    <>
      {!res.steps.length && <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.wiNothing}</span></div></div>}
      {effects.length > 0 && (
        <div class="box wi-result">
          <h4>{P.wiResult}</h4>
          {Object.entries(res.result).map(([f, x]) => (
            <div class="li"><div class="grow"><b>{fname(f)}</b><div class="wi-ft"><V f={f} v={x.from} cls="o" /> <span class="arr">→</span> <V f={f} v={x.to} cls="n" /> <span class="muted small">{fmt(P.wiBy, { who: x.by === 'você' ? P.wiYou : x.by })}</span></div></div></div>
          ))}
        </div>
      )}
      {PHASES.map((ph) => {
        const list = res.steps.filter((s) => s.phase === ph);
        if (!list.length) return null;
        return <div class="box"><h4>{P.wiPhase[ph]}<span>{list.length}</span></h4>{list.map(row)}</div>;
      })}
      {res.uncertain.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.wiUncertain}<span class="why">{P.wiUncertainHint}</span></span><span class="pill w">{res.uncertain.length}</span></h4></summary>
          {res.uncertain.map(row)}
        </details>
      )}
      {res.skipped.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.wiSkipped}</span><span class="pill">{res.skipped.length}</span></h4></summary>
          {res.skipped.slice(0, 40).map((s) => <div class="li"><span class="ck x">–</span><div class="grow">{s.name}<div class="det">{human(s.why)}</div></div></div>)}
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
    fieldLabels: { [field]: r.fieldLabel ?? 'State', resolved_by: 'Resolved by', resolved_at: 'Resolved', close_code: 'Resolution code' },
    timing: { totalMs: 880, calls: 9 },
  };
}
