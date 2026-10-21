/** Aba "Flows": os flows que rodaram neste registro e os que estão configurados para rodar nesta tabela. */
import type { RecordFlows } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';

const lang = getPrefs().lang;
const P = t(lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');

const when = (s: string) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** `field`: o campo investigado (destaca os flows que gravam nele); no registro inteiro, vazio. */
export function FlowsTab({ target, origin, field = '' }: { target: { table: string; sysId: string }; origin: string; field?: string }) {
  const [res, setRes] = useState<RecordFlows>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = isDemo ? demoFlows(target.table) : await send<RecordFlows & { error?: string }>({ type: 'flows', origin, table: target.table, sysId: target.sysId });
        if (isDemo) await new Promise((x) => setTimeout(x, 450));
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [target.sysId]);

  if (err) return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow">{err}</span></div></div>;
  if (!res) return <div class="box"><div class="li"><span class="spin" /><span class="grow muted small">{P.flLoading}</span></div></div>;
  return <FlowsView res={res} origin={origin} field={field} />;
}

/** Desenho das duas listas (rodaram / configurados); usado na aba e dentro de "O que roda neste registro". */
export function FlowsView({ res, origin, field = '' }: { res: RecordFlows; origin: string; field?: string }) {
  const states = P.flState as Record<string, string>;
  const triggers = P.flTrigger as Record<string, string>;
  return (
    <div class="flows">
      <div class="box">
        <h4>{P.flRan}{res.runs.length > 0 && <span>{res.runs.length}</span>}</h4>
        {res.access.runs === 'denied' && <div class="li"><span class="ck w">!</span><span class="grow small">{P.flRunsDenied}</span></div>}
        {res.access.runs !== 'denied' && !res.runs.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small muted">{P.flNoRuns}</span></div>}
        {res.runs.map((x, i) => (
          <div class="li fl-run" style={`--i:${Math.min(i, 10)}`}>
            <span class={`fl-st ${x.state.replace(/\s+/g, '-')}`}>{states[x.state] ?? x.state}</span>
            <span class="grow"><b>{x.name}</b>{x.subflow && <small class="fl-tag">{P.flSubflow}</small>}<small class="muted"> · {when(x.at)}</small></span>
            {!isDemo && <a class="see" href={`${origin}/$flow-designer.do#/operations/context/${x.sysId}`} target="_blank" rel="noreferrer" title={P.flOpenRun} aria-label={P.flOpenRun}>{Glyph.open}</a>}
          </div>
        ))}
      </div>
      <div class="box">
        <h4>{fmt(P.flDefs, { table: res.table })}{res.definitions.length > 0 && <span>{res.definitions.length}</span>}</h4>
        {res.access.definitions === 'denied' && <div class="li"><span class="ck w">!</span><span class="grow small">{P.flDefsDenied}</span></div>}
        {res.access.definitions !== 'denied' && !res.definitions.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small muted">{P.flNoDefs}</span></div>}
        {res.definitions.map((d, i) => (
          <div class={`li fl-def ${d.writes.includes(field) ? 'hit' : ''}`} style={`--i:${Math.min(i, 10)}`}>
            <span class="grow">
              <b>{d.name}</b>{d.ranHere && <small class="fl-tag ran">{P.flRanHere}</small>}
              <small class="muted fl-when">{triggers[d.trigger] ?? d.trigger}{d.table !== res.table ? ` · ${d.table}` : ''} · {d.condition || P.flAlways}</small>
              {d.writes.length > 0 && <small class="fl-writes">{P.flWrites} {d.writes.map((w) => <code class={w === field ? 'on' : ''}>{w}</code>)}</small>}
              {d.scope && <small class="muted">{fmt(P.flScope, { scope: d.scope })}</small>}
            </span>
            {!isDemo && d.sysId && <a class="see" href={`${origin}/$flow-designer.do#/flow-designer/${d.sysId}`} target="_blank" rel="noreferrer" title={P.flOpenDef} aria-label={P.flOpenDef}>{Glyph.open}</a>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function demoFlows(table: string): RecordFlows {
  return {
    table,
    tables: [table, 'task'],
    runs: [
      { sysId: 'c1', name: 'Notificar prioridade crítica', state: 'complete', at: '2026-10-17 22:37:03', subflow: false },
      { sysId: 'c2', name: 'Aprovação de mudança', state: 'error', at: '2026-10-17 22:37:04', subflow: true },
    ],
    definitions: [
      { sysId: 'f1', name: 'Notificar prioridade crítica', trigger: 'record_update', table, condition: 'Priority é 1 - Critical', writes: ['notify'], scope: 'Global', ranHere: true },
      { sysId: 'f2', name: 'Fechar tarefas filhas', trigger: 'record_create_or_update', table: 'task', condition: 'State é Resolved', writes: ['state', 'close_notes'], scope: 'Global', ranHere: false },
    ],
    access: { runs: 'ok', definitions: 'ok' },
    timing: { totalMs: 450, calls: 6 },
  };
}
