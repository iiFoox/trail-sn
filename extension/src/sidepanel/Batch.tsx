/** Investigação em lote: por que o campo mudou em cada registro selecionado na lista, agrupado por causa. */
import { batchCsv, groupBatch, type BatchItem } from '@trail/core';
import { useMemo } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { getPrefs } from '../shared/prefs';
import type { TabState } from '../shared/messages';

const P = t(getPrefs().lang).p;

export function Batch({ b, origin, onOpen }: { b: NonNullable<TabState['batch']>; origin: string; onOpen: (sysId: string, field?: string) => void }) {
  const rec = b.kind === 'fields';
  const done = b.items.filter((i) => i.status !== 'pending').length;
  const groups = useMemo(() => groupBatch(b.items), [b.items]);
  const changed = b.items.filter((i) => i.status === 'done').length;
  const quiet = b.items.filter((i) => i.status === 'unchanged' || i.status === 'unaudited');
  const errors = b.items.filter((i) => i.status === 'error');
  const key = (i: BatchItem) => (rec ? i.field ?? '' : i.sysId);
  const byId = new Map(b.items.map((i) => [key(i), i]));
  const download = () => {
    const blob = new Blob([batchCsv(b.items, P.btCsvHeader as string[])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trail-${b.table}-${b.field}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const pct = (n: number) => (changed ? Math.round((n / changed) * 100) : 0);
  const groupName = (g: ReturnType<typeof groupBatch>[number]) => (g.type === 'user_action' ? P.btPeople : g.name);
  return (
    <div class="stack batch">
      <div class="card">
        <div class="title">{rec ? fmt(P.btRecTitle, { rec: b.display ?? '', n: b.items.length }) : fmt(P.btTitle, { field: b.field, n: b.items.length })}</div>
        <div class="muted small">{b.table}</div>
        {b.error !== undefined && <div class="li"><span class="ck w">!</span><span class="grow">{fmt(P.btNotFound, { rec: b.error })}</span></div>}
        {rec && b.status === 'done' && !b.items.length && b.error === undefined && <div class="li"><span class="grow muted small">{P.btRecEmpty}</span></div>}
        {b.status === 'running' && b.items.length === 0 ? <div class="li"><span class="spin" /><span class="grow muted small">{P.btRecLoading}</span></div> : b.status === 'running'
          ? <div class="bt-prog"><div class="bar"><i style={`width:${Math.round((done / b.items.length) * 100)}%`} /></div><span class="muted small">{fmt(P.btProgress, { done, n: b.items.length })}</span></div>
          : <div class="bt-done"><span class="muted small">{fmt(P.btDone, { changed, n: b.items.length, s: Math.round((b.ms ?? 0) / 1000) })}</span><button class="btn sm" onClick={download}>{Glyph.copy} CSV</button></div>}
      </div>
      {groups.map((g) => (
        <details class="box fold" open={groups.length <= 3}>
          <summary><h4><span class="ck" title={g.type}>{typeGlyph[g.type as keyof typeof typeGlyph] ?? Glyph.check}</span><span class="grow">{groupName(g)}{g.type !== 'user_action' && <span class="why">{(P.kind as Record<string, string>)[g.type] ?? g.type}</span>}</span><span class="pill">{g.count} · {pct(g.count)}%</span></h4></summary>
          <div class="bt-bar"><i style={`width:${pct(g.count)}%`} /></div>
          {g.sysId && g.table && <div class="li"><a class="grow small" href={recordLink(origin, g.table, g.sysId)} target="_blank" rel="noreferrer">{fmt(P.openArtifact, { what: P.what[g.table] ?? g.table })}</a></div>}
          {g.items.slice(0, 60).map((id) => <Item it={byId.get(id)!} onOpen={onOpen} person={g.type === 'user_action'} rec={rec} />)}
          {g.items.length > 60 && <div class="muted small">{fmt(P.btMore, { n: g.items.length - 60 })}</div>}
        </details>
      ))}
      {quiet.length > 0 && (
        <details class="box fold">
          <summary><h4><span class="grow">{P.btQuiet}</span><span class="pill">{quiet.length}</span></h4></summary>
          {quiet.map((it) => <div class="li"><span class="ck x">–</span><a class="grow" href="#" onClick={(e) => { e.preventDefault(); onOpen(it.sysId, it.field); }}>{rec ? it.field : it.display}</a><span class="muted small">{it.status === 'unaudited' ? P.btUnaudited : P.btNoChange}</span></div>)}
        </details>
      )}
      {errors.length > 0 && (
        <details class="box fold">
          <summary><h4 class="warnh"><span class="grow">{P.btErrors}</span><span class="pill">{errors.length}</span></h4></summary>
          {errors.map((it) => <div class="li"><span class="ck w">!</span><div class="grow">{rec ? it.field : it.display}<div class="det">{it.error}</div></div></div>)}
        </details>
      )}
    </div>
  );
}

function Item({ it, onOpen, person, rec }: { it: BatchItem; onOpen: (sysId: string, field?: string) => void; person: boolean; rec: boolean }) {
  return (
    <div class="li">
      <div class="grow">
        <a href="#" onClick={(e) => { e.preventDefault(); onOpen(it.sysId, it.field); }}><b>{rec ? it.field : it.display}</b></a>{!rec && it.title ? <span class="muted small"> · {it.title}</span> : null}
        <div class="det">{localAt(it.at)} · {it.oldValue || '—'} → {it.newValue || '—'}{person ? ` · ${it.user}` : ''}</div>
      </div>
      {it.cause && <span class={`pill ${it.cause.grade === 'confirmed' ? '' : 'w'}`}>{P.certainty[it.cause.grade as 'confirmed']}</span>}
    </div>
  );
}

/** O motor guarda UTC; o painel mostra no fuso de quem lê. */
function localAt(at?: string): string {
  if (!at) return '';
  const d = new Date(at.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? at : d.toLocaleString(getPrefs().lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
