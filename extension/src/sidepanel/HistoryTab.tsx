/**
 * Aba "Histórico": as mudanças deste campo ou do registro inteiro (duas visões, um seletor), o que rodou neste
 * registro (flows, regras, botões...) e quem enxerga o registro.
 */
import type { BatchItem, Investigation } from '@trail/core';
import { fmt, t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';
import { fieldName, parts, valueLabel, when } from './format';
import { RecordRuns } from './RecordRuns';
import { RecordTimeline } from './Timeline';
import { Fold } from './Fold';
import { Val } from './Val';
import { WhoSees } from './WhoSees';

const P = t(getPrefs().lang).p;
const U = P.ux;

export function HistoryTab({ r, origin, sel, me, mode, setMode, onPick, onField }: { r: Investigation; origin: string; sel: number; me?: string; mode: 'field' | 'record'; setMode: (m: 'field' | 'record') => void; onPick: (i: number) => void; onField: (f: string) => void }) {
  const field = fieldName(r);
  // "Rodou aqui": as causas apontadas nas mudanças deste campo.
  const items = r.changes.map((c) => ({ cause: c.evidence[0] ? { name: c.evidence[0].artifact.name, sysId: c.evidence[0].artifact.sysId } : undefined })) as unknown as BatchItem[];
  const labels: Record<string, string> = { ...(r.display?.fields ?? {}), [r.target.field]: field };
  const people = [...new Set([me, ...r.changes.map((c) => c.user), ...r.changes.flatMap((c) => (c.trace ?? []).map((x) => x.user))].filter((x): x is string => !!x && x !== 'system'))];
  return (
    <div class="stack">
      <div class="seg2 hist-switch" role="group">
        <button aria-pressed={mode === 'field'} onClick={() => setMode('field')}>{P.histField} · {field}</button>
        <button aria-pressed={mode === 'record'} onClick={() => setMode('record')}>{P.histRecord}</button>
      </div>
      {mode === 'field'
        ? <FieldHistory r={r} origin={origin} sel={sel} onPick={onPick} />
        : <RecordTimeline origin={origin} table={r.target.table} sysId={r.target.sysId} onField={onField} />}
      <RecordRuns table={r.target.table} sysId={r.target.sysId} origin={origin} items={items} labels={labels} open={false} />
      <WhoSees table={r.target.table} sysId={r.target.sysId} field={r.target.field} display={r.target.display} origin={origin} me={me} people={people} />
    </div>
  );
}

/** As mudanças deste campo, da mais nova para a mais antiga; clicar abre a análise daquela mudança. */
function FieldHistory({ r, origin, sel, onPick }: { r: Investigation; origin: string; sel: number; onPick: (i: number) => void }) {
  type Row = { at: string; i: number };
  const rows: Row[] = r.changes.map((c, i) => ({ at: c.at, i }));
  if (r.unaudited?.lastUpdatedOn) rows.push({ at: r.unaudited.lastUpdatedOn, i: -1 });
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  const cur = r.changes[sel];
  const curText = cur ? `${parts(cur.at).date} ${parts(cur.at).time} · ${cur.oldValue || cur.checkpoint > 1 ? `${valueLabel(r, cur.oldValue)} → ` : ''}${valueLabel(r, cur.newValue)}` : '';
  const list = (
      <div class="hist">
        {rows.map(({ at, i }) => {
          const p = parts(at);
          if (i === -1) {
            return (
              <div class="h unaud" title={fmt(P.unauditedText, { when: when(r.unaudited!.lastUpdatedOn), user: r.unaudited!.lastUpdatedBy })}>
                <div class="dt">{p.date}<small>{p.time}</small></div>
                <div class="c">{P.unauditedRow}<small>{r.unaudited?.lastUpdatedBy}</small></div><span class="g warn">{P.attention}</span></div>
            );
          }
          const c = r.changes[i]!;
          const top = c.evidence[0];
          const expired = c.notes.some((n) => n.startsWith('traces_expired'));
          return (
            <div class={`h ${i === sel ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={i === sel} style={`--i:${i}`} onClick={() => onPick(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); } }}>
              <div class="dt">{p.date}<small>{p.time}</small></div>
              <div class="c">{c.oldValue || c.checkpoint > 1 ? <><Val cls="o" raw={c.oldValue} text={valueLabel(r, c.oldValue)} refTable={r.refTable} origin={origin} empty={P.empty} /> → <b><Val raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></b></> : <>{P.createdAs} <b><Val raw={c.newValue} text={valueLabel(r, c.newValue)} refTable={r.refTable} origin={origin} empty={P.empty} /></b></>}
                <small>{top ? `${top.type === 'user_action' ? top.artifact.name : P.kind[top.type].split(' · ')[0]}` : expired ? P.warnExpired : c.user}</small></div>
              <span class={`g ${top?.grade ?? 'none'}`}>{top ? P.certainty[top.grade] : P.noTrace}</span>
            </div>
          );
        })}
      </div>
  );
  if (!r.changes.length) return <><div class="muted small">{r.fieldNotInHistory ? t(getPrefs().lang).notInHistory : t(getPrefs().lang).noChanges}</div>{list}</>;
  return (
    <Fold cls="hist-fold" title={U.foldHist} hint={rows.length > 1 && curText ? fmt(U.foldHistHint, { x: curText }) : undefined} count={rows.length}>
      <div class="pad"><div class="muted small hist-intro">{P.historyIntro}</div>{list}</div>
    </Fold>
  );
}
