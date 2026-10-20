/**
 * Várias investigações de uma vez, no mesmo formato do histórico do campo:
 *  - registro inteiro: cada campo que mudou no registro;
 *  - lote da lista: o mesmo campo em vários registros.
 * Uma linha por mudança (quando · campo · antes → depois · quem ou o quê · certeza), a mais recente primeiro,
 * com filtros pela causa no topo. Clicar numa linha abre a análise completa daquela mudança.
 */
import { batchCsv, groupBatch, type BatchItem } from '@trail/core';
import { useMemo, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { getPrefs } from '../shared/prefs';
import type { TabState } from '../shared/messages';
import { parts, humanField } from './Result';
import { Val } from './Val';

const P = t(getPrefs().lang).p;
type B = NonNullable<TabState['batch']>;

export function Batch({ b, origin, onOpen }: { b: B; origin: string; onOpen: (sysId: string, field?: string) => void }) {
  const rec = b.kind === 'fields';
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => groupBatch(b.items), [b.items]);
  const done = b.items.filter((i) => i.status !== 'pending').length;
  const changed = b.items.filter((i) => i.status === 'done');
  const pending = b.items.filter((i) => i.status === 'pending');
  const quiet = b.items.filter((i) => i.status === 'unchanged' || i.status === 'unaudited');
  const errors = b.items.filter((i) => i.status === 'error');
  const running = b.status === 'running';
  const key = (i: BatchItem) => (rec ? i.field ?? '' : i.sysId);
  const groupOf = (i: BatchItem) => groups.find((g) => g.items.includes(key(i)))?.key ?? '';
  const rows = changed.filter((i) => !filter || groupOf(i) === filter).sort((a, c) => ((a.at ?? '') < (c.at ?? '') ? 1 : -1));
  const fieldLabel = b.items.find((i) => i.label)?.label ?? humanField(b.field);
  const title = rec ? fmt(P.btRecTitle, { rec: b.display ?? '' }) : fmt(P.btTitle, { field: fieldLabel, n: b.items.length });
  const sub = rec ? b.items.find((i) => i.title)?.title : b.table;
  const pct = b.items.length ? Math.round((done / b.items.length) * 100) : 0;

  const download = () => {
    const blob = new Blob([batchCsv(b.items, P.btCsvHeader as string[])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trail-${b.display ?? b.table}-${rec ? 'registro' : b.field}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div class="stack batch">
      <div class={`card bt-head ${running ? 'run' : 'ok'}`}>
        <div class="bt-title">
          <span class="bt-mark">{running ? <span class="spin" /> : Glyph.check}</span>
          <div class="grow">
            <div class="title">{rec && b.sysId ? <a href={recordLink(origin, b.table, b.sysId)} target="_blank" rel="noreferrer">{title}</a> : title}</div>
            {sub && <div class="muted small ell">{sub}</div>}
          </div>
          {!running && b.items.length > 0 && <button class="btn sm" onClick={download} title={P.btCsvHint}>{Glyph.copy} CSV</button>}
        </div>
        {b.error !== undefined && <div class="li"><span class="ck w">!</span><span class="grow">{fmt(P.btNotFound, { rec: b.error })}</span></div>}
        {running && b.items.length === 0 && b.error === undefined && <div class="muted small">{P.btRecLoading}</div>}
        {b.items.length > 0 && (
          <div class="bt-prog">
            <div class={`bar ${running ? 'live' : ''}`}><i style={`width:${pct}%`} /></div>
            <span class="muted small">{running ? fmt(rec ? P.btFieldsProgress : P.btProgress, { done, n: b.items.length }) : fmt(rec ? P.btRecDone : P.btDone, { changed: changed.length, n: b.items.length, s: Math.max(1, Math.round((b.ms ?? 0) / 1000)) })}</span>
          </div>
        )}
        {rec && !running && !b.items.length && b.error === undefined && <div class="muted small">{P.btRecEmpty}</div>}
      </div>

      {groups.length > 1 && (
        <div class="chips bt-chips" role="group" aria-label={P.btFilter}>
          <button aria-pressed={!filter} onClick={() => setFilter('')}>{P.btAll}<i>{changed.length}</i></button>
          {groups.map((g) => (
            <button aria-pressed={filter === g.key} onClick={() => setFilter(filter === g.key ? '' : g.key)} title={g.type === 'user_action' ? P.btPeople : g.name}>
              <span class="ci">{g.type === 'user_action' ? Glyph.user : typeGlyph[g.type as keyof typeof typeGlyph] ?? Glyph.check}</span>
              <span class="cn">{g.type === 'user_action' ? P.btPeopleShort : g.name}</span><i>{g.count}</i>
            </button>
          ))}
        </div>
      )}

      {(rows.length > 0 || pending.length > 0) && <div class="muted small">{P.btOpenHint}</div>}
      <div class="hist bt-list">
        {rows.map((it, i) => <Row key={`${key(it)}-done`} it={it} i={i} rec={rec} origin={origin} onOpen={onOpen} />)}
        {!filter && pending.map((it, i) => <Pending key={`${key(it)}-wait`} it={it} i={i} rec={rec} />)}
      </div>

      {quiet.length > 0 && !running && (
        <details class="box fold">
          <summary><h4><span class="grow">{rec ? P.btQuietRec : P.btQuiet}</span><span class="pill">{quiet.length}</span></h4></summary>
          {quiet.map((it) => <div class="li"><span class="ck x">–</span><a class="grow" href="#" onClick={(e) => { e.preventDefault(); onOpen(it.sysId, it.field); }}>{rec ? it.label ?? it.field : it.display}</a><span class="muted small">{it.status === 'unaudited' ? P.btUnaudited : P.btNoChange}</span></div>)}
        </details>
      )}
      {errors.length > 0 && !running && (
        <details class="box fold">
          <summary><h4 class="warnh"><span class="grow">{P.btErrors}</span><span class="pill">{errors.length}</span></h4></summary>
          {errors.map((it) => <div class="li"><span class="ck w">!</span><div class="grow">{rec ? it.label ?? it.field : it.display}<div class="det">{it.error}</div></div></div>)}
        </details>
      )}
    </div>
  );
}

/** Uma mudança: quando, o quê (campo ou registro), antes → depois, quem ou o quê mudou e a certeza. */
function Row({ it, i, rec, origin, onOpen }: { it: BatchItem; i: number; rec: boolean; origin: string; onOpen: (sysId: string, field?: string) => void }) {
  const p = parts(it.at ?? '');
  const c = it.cause;
  const person = c?.type === 'user_action';
  const kind = c && !person ? ((P.kind as Record<string, string>)[c.type] ?? c.type).split(' · ')[0] : '';
  const open = () => onOpen(it.sysId, it.field);
  return (
    <div class="h bt-row" role="button" tabIndex={0} style={`--i:${Math.min(i, 12)}`} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      <div class="dt">{p.date}<small>{p.time}</small></div>
      <div class="c">
        <div class="what">{rec ? <b class="fl">{it.label ?? humanField(it.field ?? '')}</b> : <><b class="fl">{it.display}</b>{it.title && <span class="muted"> · {it.title}</span>}</>}</div>
        <div class="vals">
          <Val raw={it.oldValue ?? ''} text={it.oldDisplay} refTable={it.refTable} origin={origin} cls="o" empty={P.btEmpty} /><span class="arr">→</span>
          <Val raw={it.newValue ?? ''} text={it.newDisplay} refTable={it.refTable} origin={origin} cls="n" empty={P.empty} />
        </div>
        <small class="by">
          <span class="ci">{person ? Glyph.user : c ? typeGlyph[c.type as keyof typeof typeGlyph] ?? Glyph.check : Glyph.question}</span>
          <span class="bt">{!c ? P.noTrace : person ? fmt(P.btByPerson, { who: c.name || it.user || '' })
            : <>{kind} · {c.sysId && c.table ? <a href={recordLink(origin, c.table, c.sysId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{c.name}</a> : c.name}</>}</span>
        </small>
      </div>
      <span class={`g ${c?.grade ?? 'none'}`}>{c ? P.certainty[c.grade as 'confirmed'] : P.noTrace}</span>
    </div>
  );
}

/** Ainda analisando: o nome já aparece, o resto pulsa até a resposta chegar. */
function Pending({ it, i, rec }: { it: BatchItem; i: number; rec: boolean }) {
  return (
    <div class="h bt-row wait" style={`--i:${Math.min(i, 12)}`} aria-busy="true">
      <div class="dt"><span class="sk" style="width:34px" /><small><span class="sk" style="width:26px" /></small></div>
      <div class="c">
        <div class="what"><b class="fl">{rec ? it.label ?? humanField(it.field ?? '') : it.display}</b></div>
        <div class="vals"><span class="sk" style="width:62%" /></div>
        <small class="by">{P.btAnalyzing}</small>
      </div>
      <span class="g none"><span class="dots"><i /><i /><i /></span></span>
    </div>
  );
}
