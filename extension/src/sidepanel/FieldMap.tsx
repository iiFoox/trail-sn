/** Mapa de automações do campo: tudo que está ativo e pode gravar o campo, na ordem de execução. */
import type { FieldMap, Investigation, MapLane } from '@trail/core';
import { useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { ErrorMsg } from './ErrorMsg';
import { Fold } from './Fold';
import { Missing } from './Missing';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');
const LANES: MapLane[] = ['client', 'before', 'after', 'async', 'other'];

export function FieldMapBox({ r, origin, field }: { r: Investigation; origin: string; field: string }) {
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<FieldMap>();
  const [err, setErr] = useState('');
  const run = async () => {
    setSt('run');
    try {
      const out = isDemo ? demoMap(r, field) : await send<FieldMap & { error?: string }>({ type: 'field-map', origin, table: r.target.table, field });
      if (isDemo) await new Promise((x) => setTimeout(x, 500));
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  return (
    <Fold cls="fmap" title={fmt(P.fmTitle, { field })} count={res?.items.length} hint={res ? (res.items.length ? undefined : P.fmNone) : P.fmShort}>
      {st === 'idle' && <div class="li"><span class="grow muted small">{P.fmHint}</span><button class="btn sm" onClick={run}>{Glyph.search} {P.fmRun}</button></div>}
      {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.fmRunning}</span></div>}
      {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div>}
      {st === 'done' && res && <>
        <Missing sources={res.missing} />
        {!res.items.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.fmNone}</span></div>}
        {LANES.map((lane) => {
          const list = res.items.filter((i) => i.lane === lane);
          if (!list.length) return null;
          return (
            <div class="lane">
              <div class="lane-h">{P.fmLane[lane]}</div>
              {list.map((i) => (
                <div class="li">
                  <span class="ck" title={i.kind}>{typeGlyph[i.kind] ?? Glyph.check}</span>
                  <div class="grow">
                    <div>{i.sysId ? <a href={recordLink(origin, i.table, i.sysId)} target="_blank" rel="noreferrer">{i.name}</a> : i.name}{i.order && i.lane !== 'other' && i.lane !== 'client' ? <span class="muted small"> · order {i.order}</span> : null}{i.on && i.on !== r.target.table ? <span class="muted small"> · {i.on}</span> : null}</div>
                    <div class="det">{P.fmWhen}: {i.when}{i.values.length ? ` · ${P.fmWrites}: ${i.values.slice(0, 4).join(', ')}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        <div class="li"><span class="grow muted small">{fmt(P.fmSummary, { n: res.items.length, ms: res.timing.totalMs })}</span></div>
      </>}
    </Fold>
  );
}

function demoMap(r: Investigation, field: string): FieldMap {
  return {
    table: r.target.table, field, tables: r.tables, timing: { totalMs: 1240, calls: 14 },
    items: [
      { lane: 'client', kind: 'client_script', name: 'Sugere estado pela categoria', table: 'sys_script_client', sysId: 'd1', on: r.target.table, order: 0, when: 'onChange de category', values: ['2'] },
      { lane: 'before', kind: 'br_before', name: 'mark_resolved', table: 'sys_script', sysId: 'd2', on: r.target.table, order: 100, when: 'update · incident_state = 6', values: [] },
      { lane: 'async', kind: 'br_async', name: 'Resolve pelo parceiro', table: 'sys_script', sysId: 'd3', on: r.target.table, order: 100, when: 'update · u_parceiro muda', values: ['6'] },
      { lane: 'other', kind: 'ui_action', name: 'Resolve Incident', table: 'sys_ui_action', sysId: 'd4', on: r.target.table, order: 300, when: 'botão', values: ['6'] },
    ],
  };
}
