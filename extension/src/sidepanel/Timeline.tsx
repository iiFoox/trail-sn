import type { Timeline as TL, TimelineSave } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoTimeline } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { parts, plural, refLink } from './Result';

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

  useEffect(() => {
    setData(undefined); setErr(undefined); setShown(PAGE);
    if (isDemo) { const id = setTimeout(() => setData(demoTimeline()), 450); return () => clearTimeout(id); }
    send<TL & { error?: string }>({ type: 'timeline', origin, target: { table, sysId } })
      .then((r) => (r?.error ? setErr(r.error) : setData(r)))
      .catch((e: Error) => setErr(e.message));
    return undefined;
  }, [origin, table, sysId]);

  if (err) return <div class="notice bad small">{fmt(P.tlError, { msg: err })}</div>;
  if (!data) return <div class="card"><div class="row"><span class="spin" /> <span class="muted">{P.tlLoading}</span></div><div class="skeleton" /><div class="skeleton" style="width:70%" /></div>;
  if (!data.saves.length) return <div class="muted small">{P.tlEmpty}</div>;

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
      {!filtered.length && <div class="muted small">{P.tlNone}</div>}
      <ol class="rtl">
        {saves.map((sv, i) => <Save i={i % PAGE} sv={sv} origin={origin} sysId={data.target.sysId} onField={onField} />)}
      </ol>
      {filtered.length > shown && <button class="btn sm" onClick={() => setShown(shown + PAGE)}>{fmt(P.tlMore, { n: Math.min(PAGE, filtered.length - shown) })}</button>}
      {data.truncated && <div class="muted small">{P.tlTruncated}</div>}
      <div class="muted small" style="text-align:center">{fmt(t(getPrefs().lang).timing, { calls: data.timing.calls, ms: data.timing.totalMs })}</div>
    </div>
  );
}

function Save({ i, sv, origin, sysId, onField }: { i: number; sv: TimelineSave; origin: string; sysId: string; onField: (field: string) => void }) {
  const p = parts(sv.at);
  const audit = refLink(origin, { table: 'sys_audit', query: `documentkey=${sysId}^record_checkpoint=${sv.checkpoint}` });
  const fields = sv.fields.filter((f) => !f.journal);
  const notes = sv.fields.filter((f) => f.journal);
  return (
    <li class={`via-${sv.via}`} style={`--i:${i}`}>
      <div class="hd">
        <span class="ti" title={P.viaHint[sv.via]}>{viaIcon[sv.via]}</span>
        <div class="grow">
          <div class="tm"><b>{p.date} {p.full}</b>{p.rel && <span class="muted"> · {p.rel}</span>}</div>
          <div class="by">{sv.user}<span class="via">{P.via[sv.via]}{sv.detail ? ` · ${sv.detail}` : ''}</span></div>
        </div>
        <a class="see" href={audit} target="_blank" rel="noreferrer" title={P.seeInSn}>{Glyph.open}</a>
      </div>
      <ul class="fl">
        {fields.map((f) => (
          <li><button class="fbtn" onClick={() => onField(f.field)} title={P.tlInvestigate}>
            <b>{f.label}</b>
            <span class="v"><span class={`o ${f.oldDisplay ? "" : "nil"}`}>{short(f.oldDisplay, P.tlEmptyValue)}</span> → <span class="n">{short(f.newDisplay, P.tlEmptyValue)}</span></span>
            <span class="go">{Glyph.chevron}</span>
          </button></li>
        ))}
        {notes.map((f) => <li class="note"><b>{f.label}</b><q>{f.newDisplay.length > 160 ? f.newDisplay.slice(0, 157) + '…' : f.newDisplay}</q></li>)}
      </ul>
    </li>
  );
}
