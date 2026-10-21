/**
 * "Comparar com outra instância" (DEV × PROD): para este campo, o que só existe numa, o que está diferente
 * (condição, ordem, script, opções da lista) e o que não deu para comparar. Lê as duas com a sessão de quem está
 * logado (`compareInstances`); só leitura. A outra instância precisa estar conectada e com login.
 */
import { describeComparison, describeDifference, type CompareSide, type Difference, type InstanceComparison, type Investigation } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoCompare, demoOtherInstances } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { listInstances, recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { ErrorMsg } from './ErrorMsg';
import { demoParam, instanceLabel, isDemo, lang } from './format';

const P = t(getPrefs().lang).p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;

/** Outras instâncias conectadas e com permissão de leitura (a atual fica de fora). */
async function otherInstances(current: string): Promise<string[]> {
  if (isDemo) return demoOtherInstances();
  const list = (await listInstances()).map((i) => i.origin).filter((o) => o !== current);
  const ok = await Promise.all(list.map((o) => chrome.permissions.contains({ origins: [`${o}/*`] }).catch(() => false)));
  return list.filter((_, i) => ok[i]);
}

export function CompareTool({ r, origin, field, onClose }: { r: Investigation; origin: string; field: string; onClose: () => void }) {
  const [others, setOthers] = useState<string[]>();
  const [other, setOther] = useState('');
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<InstanceComparison>();
  const [err, setErr] = useState('');
  const run = async (b = other) => {
    if (!b) return;
    setSt('run');
    try {
      const out = isDemo ? await demoCompare(r.target.field, b) : await send<InstanceComparison & { error?: string }>({ type: 'compare-instances', origin, other: b, tabId: trackedTab(), target: { table: r.target.table, field: r.target.field } });
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  useEffect(() => {
    void otherInstances(origin).then((list) => {
      setOthers(list);
      if (list[0]) { setOther(list[0]); if (demoParam('compare') && demoParam('compare') !== 'none') void run(list[0]); }
    });
  }, [origin]);
  const host = (o: string) => o.replace(/^https?:\/\//, '');
  return (
    <div class="stack tool-panel cmp-tool">
      <div class="box">
        <h4><span class="grow">{fmt(U.cmpTitle, { field })}</span><button class="drawer-x inline" aria-label={P.close} title={P.close} onClick={onClose}>✕</button></h4>
        <div class="li"><span class="grow muted small">{U.cmpHint}</span></div>
        {others === undefined && <div class="li"><span class="spin" /><span class="grow muted small">{U.cmpListing}</span></div>}
        {others && !others.length && (
          <div class="li cmp-none"><span class="ck w">!</span><div class="grow small">{U.cmpNone}
            <div><button class="btn sm" onClick={() => { if (!isDemo) void chrome.runtime.openOptionsPage(); }}>{Glyph.plug} {U.cmpConnect}</button></div></div></div>
        )}
        {others && others.length > 0 && (
          <div class="pad cmp-pick">
            <span class="small muted">{fmt(U.cmpThis, { a: instanceLabel(origin) })}</span>
            <div class="wi-in">
              <select value={other} aria-label={U.cmpWith} onChange={(e) => setOther((e.target as HTMLSelectElement).value)}>
                {others.map((o) => <option value={o}>{host(o)}</option>)}
              </select>
              <button class="btn primary sm" disabled={!other || st === 'run'} onClick={() => void run()}>{Glyph.search} {U.cmpRun}</button>
            </div>
          </div>
        )}
        {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{fmt(U.cmpRunning, { b: instanceLabel(other) })}</span></div>}
        {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /> <button class="link" onClick={() => void run()}>{U.retry}</button></span></div>}
      </div>
      {st === 'done' && res && <CompareResult c={res} originA={origin} originB={other} onRetry={() => void run()} />}
    </div>
  );
}

function CompareResult({ c, originA, originB, onRetry }: { c: InstanceComparison; originA: string; originB: string; onRetry: () => void }) {
  const O: Record<CompareSide, string> = { a: originA, b: originB };
  const L: Record<CompareSide, string> = { a: c.a.label, b: c.b.label };
  const nc = c.notCompared.filter((x) => !c.unreachable.includes(x.side));
  const cats = str(U.cmpCat);
  return (
    <>
      {c.unreachable.map((side) => (
        <div class="notice cmp-login">
          <div class="title">{fmt(U.cmpNoLogin, { b: L[side] })}</div>
          <div class="small">{U.cmpNoLoginHint}</div>
          <div class="row"><a class="btn sm" href={O[side]} target="_blank" rel="noreferrer">{Glyph.open} {fmt(U.cmpOpen, { b: L[side] })}</a><button class="btn sm" onClick={onRetry}>{Glyph.refresh} {U.retry}</button></div>
        </div>
      ))}
      {c.unreachable.length < 2 && (
        <div class="box cmp-sum">
          <h4>{U.cmpSummary}<span>{fmt(U.cmpCounts, { d: c.counts.different, a: c.counts.onlyA, b: c.counts.onlyB, s: c.counts.same })}</span></h4>
          <div class="pad small">{describeComparison(c, lang)}</div>
        </div>
      )}
      {c.differences.length > 0 && (
        <div class="box cmp-diffs">
          <h4>{U.cmpDiffs}<span>{c.differences.length}</span></h4>
          {c.differences.map((d) => <DiffRow c={c} d={d} O={O} L={L} />)}
        </div>
      )}
      {nc.length > 0 && (
        <div class="box">
          <h4 class="warnh">{U.cmpNotCompared}</h4>
          {(['a', 'b'] as const).map((side) => {
            const xs = [...new Set(nc.filter((x) => x.side === side).map((x) => cats[x.what] ?? x.what))];
            return xs.length ? <div class="li"><span class="ck w">!</span><span class="grow small"><b>{L[side]}:</b> {xs.join(', ')} <span class="muted">· {U.cmpNoAccess}</span></span></div> : null;
          })}
        </div>
      )}
      <div class="muted small">{fmt(U.cmpTiming, { ms: c.timing.totalMs, a: c.timing.calls.a, b: c.timing.calls.b })}</div>
    </>
  );
}

function DiffRow({ c, d, O, L }: { c: InstanceComparison; d: Difference; O: Record<CompareSide, string>; L: Record<CompareSide, string> }) {
  const rule = d.rule !== undefined ? c.rules[d.rule] : undefined;
  const text = describeDifference(c, d, lang);
  const links = rule ? (['a', 'b'] as const).filter((x) => rule[x]?.sysId).map((x) => <a class="cmp-link" href={recordLink(O[x], rule.art, rule[x]!.sysId)} target="_blank" rel="noreferrer">{fmt(U.cmpSeeIn, { b: L[x] })} {Glyph.open}</a>) : [];
  return (
    <div class={`li cmp-diff ${d.weight >= 30 ? 'strong' : ''}`}>
      <span class={`ck ${d.weight >= 30 ? 'w' : ''}`}>{d.weight >= 30 ? '!' : '·'}</span>
      <div class="grow">
        <div class="small">{text.charAt(0).toUpperCase() + text.slice(1)}.</div>
        {links.length > 0 && <div class="cmp-links small">{links}</div>}
        {d.diff && d.diff.lines.length > 0 && (
          <details class="cmp-script">
            <summary class="small">{fmt(U.cmpScriptLines, { n: d.diff.lines.length + d.diff.more })}</summary>
            <ul class="cmp-lines">{d.diff.lines.map((l) => <li class={`s-${l.side}`}><span class="side">{L[l.side]} {l.n}</span><code>{l.text}</code></li>)}</ul>
            {d.diff.more > 0 && <div class="muted small">{fmt(U.cmpMoreLines, { n: d.diff.more })}</div>}
          </details>
        )}
      </div>
    </div>
  );
}
