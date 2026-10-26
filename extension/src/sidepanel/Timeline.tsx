import { compareSaves, type Timeline as TL, type TimelineSave } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoTimeline } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { send } from '../shared/messages';
import { trackedTab } from '../shared/tabRef';
import { getPrefs } from '../shared/prefs';
import { parts, plural, refLink } from './Result';
import { Val } from './Val';
import { ErrorMsg } from './ErrorMsg';
import { friendlyError } from '../shared/errors';
import { Missing } from './Missing';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');
const PAGE = 12;
type Group = 'all' | 'people' | 'api' | 'auto';
/** Agrupa as vias em três filtros que fazem sentido para quem investiga: pessoas, API e automação. */
const GROUP: Record<string, Group> = { form: 'people', ui_action: 'people', created: 'people', api: 'api', async: 'auto', job: 'auto', chained: 'auto', background: 'auto', system: 'auto', expired: 'auto', unknown: 'auto' };

const viaIcon: Record<string, preact.JSX.Element> = {
  form: Glyph.user, api: Glyph.plug, ui_action: Glyph.click, async: Glyph.async, job: Glyph.clock, background: Glyph.terminal,
  chained: Glyph.rule, system: Glyph.server, created: Glyph.check, expired: Glyph.question, unknown: Glyph.question,
};

function short(v: string, empty: string): string {
  if (!v) return empty;
  const one = v.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? one.slice(0, 57) + '…' : one;
}

/** Linha do tempo do registro inteiro: gravações, por onde entraram e os campos de cada uma. */
export function RecordTimeline({ origin, table, sysId, onField }: { origin: string; table: string; sysId: string; onField: (field: string) => void }) {
  const [data, setData] = useState<TL>();
  const [err, setErr] = useState<string>();
  const [shown, setShown] = useState(PAGE);
  const [via, setVia] = useState<Group>('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [cmp, setCmp] = useState<number[] | null>(null);

  useEffect(() => {
    setData(undefined); setErr(undefined); setShown(PAGE);
    if (isDemo) { const id = setTimeout(() => setData(demoTimeline()), 450); return () => clearTimeout(id); }
    send<TL & { error?: string }>({ type: 'timeline', origin, tabId: trackedTab(), target: { table, sysId } })
      .then((r) => (r?.error ? setErr(r.error) : setData(r)))
      .catch((e: Error) => setErr(e.message));
    return undefined;
  }, [origin, table, sysId]);

  if (err) return <div class="notice bad small"><ErrorMsg msg={err} text={fmt(P.tlError, { msg: friendlyError(err, getPrefs().lang) })} /></div>;
  if (!data) return <div class="card"><div class="row"><span class="spin" /> <span class="muted">{P.tlLoading}</span></div><div class="skeleton" /><div class="skeleton" style="width:70%" /></div>;
  if (!data.saves.length) return <><Missing sources={data.missing} /><div class="muted small">{P.tlEmpty}</div></>;

  const users = [...new Set(data.saves.map((x) => x.user))].sort();
  const needle = q.trim().toLowerCase();
  const filtered = data.saves
    .filter((x) => via === 'all' || GROUP[x.via] === via)
    .filter((x) => !who || x.user === who)
    .map((x) => (needle ? { ...x, fields: x.fields.filter((f) => `${f.label} ${f.field} ${f.oldDisplay} ${f.newDisplay}`.toLowerCase().includes(needle)) } : x))
    .filter((x) => x.fields.length > 0);
  const saves = filtered.slice(0, shown);
  const count = (g: Group) => data.saves.filter((x) => g === 'all' || GROUP[x.via] === g).length;
  return (
    <div class="stack">
      <Missing sources={data.missing} />
      <div class="muted small">{P.tlIntro} <b>{plural(P.tlSaves, data.saves.length)}</b>.</div>
      <div class="tlf">
        <div class="chips" role="group">
          {(['all', 'people', 'api', 'auto'] as Group[]).map((g) => count(g) > 0 || g === 'all' ? <button aria-pressed={via === g} onClick={() => { setVia(g); setShown(PAGE); }}>{P.tlGroup[g]}<i>{count(g)}</i></button> : null)}
        </div>
        <div class="row2">
          <input type="search" placeholder={P.tlSearch} value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setShown(PAGE); }} />
          {users.length > 1 && <select value={who} onChange={(e) => { setWho((e.target as HTMLSelectElement).value); setShown(PAGE); }}><option value="">{P.tlAllUsers}</option>{users.map((u) => <option value={u}>{u}</option>)}</select>}
        </div>
        {(via !== 'all' || who || needle) && <div class="muted small">{fmt(P.tlShowing, { n: filtered.length, total: data.saves.length })} <button class="link" onClick={() => { setVia('all'); setWho(''); setQ(''); }}>{P.tlClear}</button></div>}
      </div>
      {data.saves.length > 1 && <div class="cmpbar">
        <button class={`btn sm ${cmp ? 'on' : ''}`} aria-pressed={!!cmp} onClick={() => setCmp(cmp ? null : [])}>{Glyph.compare} {cmp ? P.cmpOff : P.cmpBtn}</button>
        {cmp && cmp.length < 2 && <p class="cmp-hint muted small">{cmp.length ? P.cmpPickOne : P.cmpPick}</p>}
      </div>}
      {cmp?.length === 2 && <Compare data={data} a={cmp[0]!} b={cmp[1]!} onClose={() => setCmp([])} />}
      {!filtered.length && <div class="muted small">{P.tlNone}</div>}
      <ol class={`rtl ${cmp ? 'picking' : ''}`}>
        {saves.map((sv, i) => <Save i={i % PAGE} sv={sv} origin={origin} sysId={data.target.sysId} onField={onField} found={!!needle}
          pick={cmp ? (cmp.indexOf(sv.checkpoint) === 0 ? 'A' : cmp.indexOf(sv.checkpoint) === 1 ? 'B' : '') : undefined}
          onPick={() => setCmp((c) => { const cur = c ?? []; if (cur.includes(sv.checkpoint)) return cur.filter((x) => x !== sv.checkpoint); return [...cur, sv.checkpoint].slice(-2); })} />)}
      </ol>
      {filtered.length > shown && <button class="btn sm" onClick={() => setShown(shown + PAGE)}>{fmt(P.tlMore, { n: Math.min(PAGE, filtered.length - shown) })}</button>}
      {data.truncated && <div class="muted small">{P.tlTruncated}</div>}
      <div class="muted small" style="text-align:center">{fmt(t(getPrefs().lang).timing, { calls: data.timing.calls, ms: data.timing.totalMs })}</div>
    </div>
  );
}

/** Diferença do registro entre duas gravações escolhidas na linha do tempo. */
function Compare({ data, a, b, onClose }: { data: TL; a: number; b: number; onClose: () => void }) {
  const d = compareSaves(data, a, b);
  if (!d) return null;
  const pa = parts(d.from.at), pb = parts(d.to.at);
  return (
    <div class="card cmp" role="region" aria-label={P.cmpBtn}>
      <div class="cmp-hd">
        <div class="grow"><b>{fmt(P.cmpTitle, { a: `${pa.date} ${pa.full}`, b: `${pb.date} ${pb.full}` })}</b>
          <div class="muted small">{d.from.user} → {d.to.user} · {fmt(P.cmpSaves, { n: d.saves })}</div></div>
        <button class="drawer-x inline" aria-label={P.cmpClose} title={P.cmpClose} onClick={onClose}>✕</button>
      </div>
      {!d.rows.length ? <div class="muted small">{P.cmpSame}</div> : (
        <table class="cmpt"><tbody>{d.rows.map((r) => (
          <tr class={r.reverted ? 'rev' : ''}>
            <th>{r.label}<div class="muted">{r.reverted ? P.cmpReverted : r.touches > 1 ? fmt(P.cmpTouches, { n: r.touches }) : ''}{r.users.length ? ` · ${r.users.join(', ')}` : ''}</div></th>
            <td><span class={`o ${r.fromDisplay ? '' : 'nil'}`}>{short(r.fromDisplay, P.tlEmptyValue)}</span></td>
            <td class="ar">→</td>
            <td><span class="n">{short(r.toDisplay, P.tlEmptyValue)}</span></td>
          </tr>))}</tbody></table>
      )}
      {d.journal > 0 && <div class="muted small">{fmt(P.cmpJournal, { n: d.journal })}</div>}
    </div>
  );
}

/** Uma gravação: começa recolhida (data, quem, via e quantos campos); numa busca, o que achou já vem aberto. */
function Save({ i, sv, origin, sysId, onField, pick, onPick, found = false }: { i: number; sv: TimelineSave; origin: string; sysId: string; onField: (field: string) => void; pick?: string; onPick?: () => void; found?: boolean }) {
  const p = parts(sv.at);
  const audit = refLink(origin, { table: 'sys_audit', query: `documentkey=${sysId}^record_checkpoint=${sv.checkpoint}` });
  const fields = sv.fields.filter((f) => !f.journal);
  const notes = sv.fields.filter((f) => f.journal);
  return (
    <li class={`via-${sv.via} ${pick ? 'picked' : ''}`} style={`--i:${i}`}>
      <details class="sv fold2" key={String(found)} open={found || undefined}>
      {/* Escolhendo dois momentos, clicar no cabeçalho escolhe em vez de abrir. */}
      <summary class="hd" onClick={pick !== undefined ? (e) => { e.preventDefault(); if (!(e.target as HTMLElement).closest('a,button')) onPick?.(); } : undefined}>
        <span class="caret" aria-hidden="true" />
        {pick !== undefined && <button class={`pk ${pick ? 'on' : ''}`} aria-pressed={!!pick} aria-label={P.cmpBtn} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick?.(); }}>{pick || ''}</button>}
        <span class="ti" title={P.viaHint[sv.via]}>{viaIcon[sv.via]}</span>
        <div class="grow">
          <div class="tm"><b>{p.date} {p.full}</b>{p.rel && <span class="muted"> · {p.rel}</span>}</div>
          <div class="by">{sv.user}<span class="via">{P.via[sv.via]}{sv.detail ? ` · ${sv.detail}` : ''}</span></div>
        </div>
        <a class="see" href={audit} target="_blank" rel="noreferrer" title={P.seeInSn} onClick={(e) => e.stopPropagation()}>{Glyph.open}</a>
        <span class="pill cnt">{plural(P.tlFields, sv.fields.length)}</span>
      </summary>
      <ul class="fl">
        {fields.map((f) => (
          <li><div class="fbtn" role="button" tabIndex={0} onClick={() => onField(f.field)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onField(f.field); } }} title={P.tlInvestigate}>
            <b>{f.label}</b>
            <span class="v"><Val cls="o" raw={f.oldValue} text={short(f.oldDisplay, P.tlEmptyValue)} refTable={f.ref} origin={origin} empty={P.tlEmptyValue} /> → <Val cls="n" raw={f.newValue} text={short(f.newDisplay, P.tlEmptyValue)} refTable={f.ref} origin={origin} empty={P.tlEmptyValue} /></span>
            <span class="go">{Glyph.chevron}</span>
          </div></li>
        ))}
        {notes.map((f) => <li class="note"><b>{f.label}</b><q>{f.newDisplay.length > 160 ? f.newDisplay.slice(0, 157) + '…' : f.newDisplay}</q></li>)}
      </ul>
      </details>
    </li>
  );
}
