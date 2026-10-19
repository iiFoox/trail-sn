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

  const saves = data.saves.slice(0, shown);
  return (
    <div class="stack">
      <div class="muted small">{P.tlIntro} <b>{plural(P.tlSaves, data.saves.length)}</b>.</div>
      <ol class="rtl">
        {saves.map((sv) => <Save sv={sv} origin={origin} sysId={data.target.sysId} onField={onField} />)}
      </ol>
      {data.saves.length > shown && <button class="btn sm" onClick={() => setShown(shown + PAGE)}>{fmt(P.tlMore, { n: Math.min(PAGE, data.saves.length - shown) })}</button>}
      {data.truncated && <div class="muted small">{P.tlTruncated}</div>}
      <div class="muted small" style="text-align:center">{fmt(t(getPrefs().lang).timing, { calls: data.timing.calls, ms: data.timing.totalMs })}</div>
    </div>
  );
}

function Save({ sv, origin, sysId, onField }: { sv: TimelineSave; origin: string; sysId: string; onField: (field: string) => void }) {
  const p = parts(sv.at);
  const audit = refLink(origin, { table: 'sys_audit', query: `documentkey=${sysId}^record_checkpoint=${sv.checkpoint}` });
  const fields = sv.fields.filter((f) => !f.journal);
  const notes = sv.fields.filter((f) => f.journal);
  return (
    <li class={`via-${sv.via}`}>
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
            <span class="v"><span class="o">{short(f.oldDisplay, P.tlEmptyValue)}</span> → <span class="n">{short(f.newDisplay, P.tlEmptyValue)}</span></span>
            <span class="go">{Glyph.chevron}</span>
          </button></li>
        ))}
        {notes.map((f) => <li class="note"><b>{f.label}</b><q>{f.newDisplay.length > 160 ? f.newDisplay.slice(0, 157) + '…' : f.newDisplay}</q></li>)}
      </ul>
    </li>
  );
}
