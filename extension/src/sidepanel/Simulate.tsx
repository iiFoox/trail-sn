/**
 * "Simular um valor" (o antigo "E se?"): se este campo for para outro valor, o que roda, o que cada coisa faz
 * (grava, avisa, obriga, inicia SLA...) e o que não roda, com o motivo. Usa `simulateValue`; nada é gravado.
 */
import { describeDependent, type Investigation, type SimItem, type ValueSimulation } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoSimulate } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { ErrorMsg } from './ErrorMsg';
import { demoParam, isDemo, lang } from './format';
import { Fold } from './Fold';
import { kindIcon } from './kinds';
import { Val } from './Val';

const P = t(getPrefs().lang).p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;

export function Simulate({ r, origin, field, labels = {}, onClose }: { r: Investigation; origin: string; field: string; labels?: Record<string, string>; onClose: () => void }) {
  const current = r.changes[0]?.newValue ?? '';
  const auto = demoParam('sim');
  const [value, setValue] = useState(auto && auto !== '1' ? auto : '');
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<ValueSimulation>();
  const [err, setErr] = useState('');
  const options = Object.entries(r.labels ?? {}).filter(([k]) => k !== current).slice(0, 40);
  const run = async (v = value) => {
    if (!v) return;
    if (v === current) { setErr(P.wiSame); setSt('err'); return; }
    setSt('run');
    try {
      const out = isDemo ? await demoSimulate(r.target.field, v) : await send<ValueSimulation & { error?: string }>({ type: 'simulate-value', origin, tabId: trackedTab(), target: { table: r.target.table, sysId: r.target.sysId, field: r.target.field, value: v } });
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  useEffect(() => { if (auto && auto !== '1') void run(auto); }, []);
  return (
    <div class="stack tool-panel sim">
      <div class="box wi-box">
        <h4><span class="grow">{fmt(U.simTitle, { field })}</span><button class="drawer-x inline" aria-label={P.close} title={P.close} onClick={onClose}>✕</button></h4>
        <div class="li"><span class="grow muted small">{U.simHint}</span></div>
        <div class="wi-now small"><span class="muted">{P.wiNow}</span> <b><Val raw={current} text={r.labels?.[current]} refTable={r.refTable} origin={origin} empty={P.empty} /></b></div>
        <div class="wi-in">
          <Combo options={options} value={value} initial={auto && auto !== '1' ? r.labels?.[auto] ?? auto : ''} placeholder={options.length ? P.wiPick : P.wiType} onChange={setValue} onEnter={(v) => void run(v)} />
          <button class="btn primary sm" disabled={!value || st === 'run'} onClick={() => void run()}>{Glyph.search} {U.simRun}</button>
        </div>
        {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.wiRunning}</span></div>}
        {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow">{err === P.wiSame ? err : <ErrorMsg msg={err} />}</span></div>}
      </div>
      {st === 'done' && res && <SimOutcome res={res} r={r} origin={origin} known={labels} />}
    </div>
  );
}

function SimOutcome({ res, r, origin, known }: { res: ValueSimulation; r: Investigation; origin: string; known: Record<string, string> }) {
  const pv = res.preview;
  const labels: Record<string, string> = { ...known, ...(pv.fieldLabels ?? {}), ...(r.display?.fields ?? {}) };
  const fname = (f: string) => labels[f] || (f === r.target.field ? r.fieldLabel ?? f : f);
  const vtext = (f: string, v: string) => pv.valueLabels?.[f]?.[v] ?? (f === r.target.field ? r.labels?.[v] : undefined);
  const V = ({ f, v, cls }: { f: string; v: string | undefined; cls?: string }) => (v === undefined || v === '\u0000calc'
    ? <i class="muted">{P.wiCalc}</i>
    : <Val raw={v} text={vtext(f, v)} refTable={pv.refTables?.[f] ?? (f === r.target.field ? r.refTable : undefined)} origin={origin} cls={cls} empty={P.empty} />);
  const why = str(U.simWhy);
  const phase = str(U.depPhase);
  const Row = ({ x }: { x: SimItem }) => {
    const effects = describeDependent({ kind: x.kind, how: [], does: x.effects }, lang, labels).does;
    return (
      <div class={`li sim-row w-${x.will}`}>
        <span class="ck" title={str(U.depKind)[x.kind] ?? x.kind}>{kindIcon(x.kind)}</span>
        <div class="grow">
          <div>{x.sysId ? <a href={recordLink(origin, x.table, x.sysId)} target="_blank" rel="noreferrer">{x.name}</a> : x.name} <span class="muted small">· {phase[x.phase] ?? x.phase}</span></div>
          {x.writes.map((w) => <div class="small wi-w"><b>{fname(w.field)}</b> → <V f={w.field} v={w.value} cls="n" /></div>)}
          {effects.length > 0 && <div class="small dep-does"><b>→</b> {effects.join('; ')}</div>}
          <div class="det">{why[x.why] ?? x.why}{x.step?.updatesAgain ? ` · ${P.wiAgain}` : ''}</div>
        </div>
      </div>
    );
  };
  const changed = Object.entries(pv.result);
  return (
    <>
      <Fold cls="wi-result" title={P.wiResult} count={changed.length} hint={changed.map(([f]) => fname(f)).slice(0, 4).join(', ')}>
        {changed.map(([f, x]) => (
          <div class="li"><div class="grow"><b>{fname(f)}</b><div class="wi-ft"><V f={f} v={x.from} cls="o" /> <span class="arr">→</span> <V f={f} v={x.to} cls="n" /> <span class="muted small">{fmt(P.wiBy, { who: x.by === 'você' ? P.wiYou : x.by })}</span></div></div></div>
        ))}
        {changed.length <= 1 && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small">{P.wiNothing}</span></div>}
      </Fold>
      <Fold cls="sim-runs" title={U.simRuns} count={res.runs.length}
        hint={res.runs.length > 0 ? res.runs.slice(0, 3).map((x) => x.name).join(', ') + (res.runs.length > 3 ? '…' : '') : undefined}>
        {!res.runs.length && <div class="li"><span class="grow muted small">{U.simNoRuns}</span></div>}
        {res.runs.map((x) => <Row x={x} />)}
      </Fold>
      {res.maybe.length > 0 && (
        <Fold cls="sim-maybe" title={U.simMaybe} hint={P.wiUncertainHint} count={res.maybe.length} pill="w">
          {res.maybe.map((x) => <Row x={x} />)}
        </Fold>
      )}
      {res.wontRun.length > 0 && (
        <Fold cls="sim-wont" title={U.simWont} count={res.wontRun.length}>
          {res.wontRun.map((x) => <Row x={x} />)}
        </Fold>
      )}
      {res.notSeen.length > 0 && <div class="notice small"><b>{U.notSeenTitle}</b> {[...new Set(res.notSeen.map((k) => str(U.depKindPlural)[k] ?? k))].join(', ')}.</div>}
      {!res.recordReadable && <div class="notice small">{U.simNoRecord}</div>}
      <div class="muted small">{fmt(U.simSummary, { n: res.runs.length + res.maybe.length, ms: res.timing.totalMs })}</div>
    </>
  );
}

/** Caixa de escolha no estilo do painel: mostra o nome do valor (ex.: "2 - Medium"); aceita digitar um valor livre. */
export function Combo({ options, value, initial = '', placeholder, onChange, onEnter }: { options: [string, string][]; value: string; initial?: string; placeholder: string; onChange: (v: string) => void; onEnter: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
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
