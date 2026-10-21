/** Flows deste registro: os que rodaram nele e os configurados para a tabela (dentro de "O que rodou neste registro"). */
import type { RecordFlows } from '@trail/core';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { getPrefs } from '../shared/prefs';

const lang = getPrefs().lang;
const P = t(lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');

const when = (s: string) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Desenho das duas listas (rodaram / configurados); usado na aba e dentro de "O que roda neste registro". */
/** `filtered`: a lista já veio de uma busca; parte vazia some em vez de dizer "nenhum flow". */
export function FlowsView({ res, origin, field = '', filtered = false, labels = {} }: { res: RecordFlows; origin: string; field?: string; filtered?: boolean; labels?: Record<string, string> }) {
  const states = P.flState as Record<string, string>;
  const triggers = P.flTrigger as Record<string, string>;
  return (
    <div class="flows">
      {!(filtered && !res.runs.length) && <div class="box">
        <h4>{P.flRan}{res.runs.length > 0 && <span>{res.runs.length}</span>}</h4>
        {res.access.runs === 'denied' && <div class="li"><span class="ck w">!</span><span class="grow small">{P.flRunsDenied}</span></div>}
        {res.access.runs !== 'denied' && !res.runs.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small muted">{P.flNoRuns}</span></div>}
        {res.runs.map((x, i) => (
          <div class={`li fl-run ${x.parentSysId ? 'sub' : ''}`} style={`--i:${Math.min(i, 10)}`}>
            <span class={`fl-st ${x.state.replace(/\s+/g, '-')}`}>{states[x.state] ?? x.state}</span>
            <span class="grow"><b>{x.name}</b>{x.subflow && <small class="fl-tag">{P.flSubflow}</small>}<small class="muted"> · {when(x.at)}</small></span>
            {!isDemo && <a class="see" href={`${origin}/$flow-designer.do#/operations/context/${x.sysId}`} target="_blank" rel="noreferrer" title={P.flOpenRun} aria-label={P.flOpenRun}>{Glyph.open}</a>}
          </div>
        ))}
      </div>}
      {!(filtered && !res.definitions.length) && <div class="box">
        <h4>{fmt(P.flDefs, { table: res.table })}{res.definitions.length > 0 && <span>{res.definitions.length}</span>}</h4>
        {res.access.definitions === 'denied' && <div class="li"><span class="ck w">!</span><span class="grow small">{P.flDefsDenied}</span></div>}
        {res.access.definitions !== 'denied' && !res.definitions.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small muted">{P.flNoDefs}</span></div>}
        {res.definitions.map((d, i) => (
          <div class={`li fl-def ${d.writes.includes(field) ? 'hit' : ''}`} style={`--i:${Math.min(i, 10)}`}>
            <span class="grow">
              <b>{d.name}</b>{d.ranHere && <small class="fl-tag ran">{P.flRanHere}</small>}
              <small class="muted fl-when">{triggers[d.trigger] ?? d.trigger}{d.table !== res.table ? ` · ${d.table}` : ''} · {d.condition || P.flAlways}</small>
              {d.writes.length > 0 && <small class="fl-writes">{P.flWrites} {d.writes.map((w) => <code class={w === field ? 'on' : ''} title={w}>{labels[w] || w}</code>)}</small>}
              {d.scope && <small class="muted">{fmt(P.flScope, { scope: d.scope })}</small>}
            </span>
            {!isDemo && d.sysId && <a class="see" href={`${origin}/$flow-designer.do#/flow-designer/${d.sysId}`} target="_blank" rel="noreferrer" title={P.flOpenDef} aria-label={P.flOpenDef}>{Glyph.open}</a>}
          </div>
        ))}
      </div>}
    </div>
  );
}

export function demoFlows(table: string): RecordFlows {
  return {
    table,
    tables: [table, 'task'],
    runs: [
      { sysId: 'c1', name: 'Notificar prioridade crítica', state: 'complete', at: '2026-10-18 01:37:03', subflow: false },
      { sysId: 'c2', name: 'Aprovação de mudança', state: 'error', at: '2026-10-18 01:37:04', subflow: true, parentSysId: 'c1' },
    ],
    definitions: [
      { sysId: 'f1', name: 'Notificar prioridade crítica', trigger: 'record_update', table, condition: 'Priority é 1 - Critical', writes: ['notify'], scope: 'Global', ranHere: true },
      { sysId: 'f2', name: 'Fechar tarefas filhas', trigger: 'record_create_or_update', table: 'task', condition: 'State é Resolved', writes: ['state', 'close_notes'], scope: 'Global', ranHere: false },
    ],
    access: { runs: 'ok', definitions: 'ok' },
    timing: { totalMs: 450, calls: 6 },
  };
}
