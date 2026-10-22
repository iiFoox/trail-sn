/**
 * "O que roda neste registro" (registro inteiro): tudo que está ativo para a tabela, separado por tipo —
 * regras de negócio, script includes, flows, client scripts, UI policies, botões, data lookups, atribuição e jobs.
 * O que causou mudanças neste registro ganha a marca "rodou aqui".
 */
import type { AutomationItem, BatchItem, RecordFlows, TableAutomations } from '@trail/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { demoFlows, FlowsView } from './Flows';
import { ErrorMsg } from './ErrorMsg';
import { Fold } from './Fold';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');

export function RecordRuns({ table, sysId, origin, items }: { table: string; sysId: string; origin: string; items: BatchItem[] }) {
  const [res, setRes] = useState<TableAutomations>();
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [onlyRan, setOnlyRan] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out = isDemo ? demoRuns(table) : await send<TableAutomations & { error?: string }>({ type: 'automations', origin, table, sysId });
        if (isDemo) await new Promise((x) => setTimeout(x, 450));
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [sysId]);

  // O que causou mudanças neste registro (pela análise de cada campo).
  const ran = new Set(items.map((i) => i.cause?.sysId).filter(Boolean) as string[]);
  const ranNames = new Set(items.map((i) => i.cause?.name).filter(Boolean) as string[]);
  const hit = (a: AutomationItem) => ran.has(a.sysId) || ranNames.has(a.name);
  // Busca em tudo: nome, quando roda, tabela, escopo e campos que grava ("priority" acha tudo que mexe na prioridade).
  const terms = norm(query).split(/\s+/).filter(Boolean);
  const filtering = terms.length > 0 || onlyRan;
  const keep = (a: AutomationItem) => (!onlyRan || hit(a)) && terms.every((t) => norm([a.name, a.detail, a.table, a.scope ?? '', ...a.writes].join(' ')).includes(t));
  const pick = (list: AutomationItem[]) => list.filter(keep);

  const row = (a: AutomationItem, linkTable: string) => (
    <div class={`li rr-row ${hit(a) ? 'hit' : ''}`}>
      <div class="grow">
        {isDemo ? <span class="lnk">{a.name}</span> : <a href={recordLink(origin, linkTable, a.sysId)} target="_blank" rel="noreferrer">{a.name}</a>}
        {hit(a) && <small class="fl-tag ran">{P.flRanHere}</small>}
        <div class="det">{[a.detail, a.table !== table && a.table !== linkTable ? a.table : '', a.scope ? fmt(P.flScope, { scope: a.scope }) : ''].filter(Boolean).join(' · ')}</div>
        {a.writes.length > 0 && <small class="fl-writes">{P.flWrites} {a.writes.slice(0, 8).map((w) => <code>{w}</code>)}</small>}
      </div>
    </div>
  );

  if (err) return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div></div>;
  const groups: { key: string; title: string; icon: ComponentChildren; denied: boolean; count: number; body: ComponentChildren }[] = !res ? [] : [
    ...([
      ['br', P.rrBr, Glyph.rule, 'sys_script', res.businessRules],
      ['si', P.rrSi, Glyph.include, 'sys_script_include', res.scriptIncludes],
    ] as const).map(([key, title, icon, tbl, list]) => ({ key, title, icon, denied: res.access[tbl] === 'denied', count: pick(list).length, body: pick(list).map((a) => row(a, tbl)) })),
    (() => {
      const fl = res.flows ? filterFlows(res.flows, terms, onlyRan) : undefined;
      return { key: 'fl', title: P.rrFlows, icon: Glyph.flow, denied: false, count: (fl?.runs.length ?? 0) + (fl?.definitions.length ?? 0), body: fl ? <FlowsView res={fl} origin={origin} filtered={filtering} /> : null };
    })(),
    ...([
      ['cs', P.rrCs, Glyph.terminal, 'sys_script_client', res.clientScripts],
      ['up', P.rrUp, Glyph.shield, 'sys_ui_policy', res.uiPolicies],
      ['ua', P.rrUa, Glyph.click, 'sys_ui_action', res.uiActions],
      ['dl', P.rrDl, Glyph.search, 'dl_definition', res.dataLookups],
      ['as', P.rrAs, Glyph.group, 'sysrule_assignment', res.assignmentRules],
      ['jb', P.rrJobs, Glyph.clock, 'sysauto_script', res.jobs],
    ] as const).map(([key, title, icon, tbl, list]) => ({ key, title, icon, denied: res.access[tbl] === 'denied', count: pick(list).length, body: pick(list).map((a) => row(a, tbl)) })),
  ].filter((g) => g.count > 0 || (g.denied && !filtering));
  const total = groups.reduce((n, g) => n + g.count, 0);
  return (
    <Fold cls="rruns" title={P.rrTitle} count={res ? total : undefined} hint={res ? groups.filter((g) => !g.denied).map((g) => `${g.title} ${g.count}`).slice(0, 4).join(' · ') : undefined}>
      <div class="muted small pad">{fmt(P.rrHint, { table })}</div>
      {res && (
        <div class="rr-tools">
          <label class="rr-search">{Glyph.search}<input type="search" value={query} placeholder={P.rrSearch} aria-label={P.rrSearch} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} /></label>
          <button type="button" class={`chip ${onlyRan ? 'on' : ''}`} aria-pressed={onlyRan} onClick={() => setOnlyRan(!onlyRan)}>{P.rrOnlyRan}</button>
        </div>
      )}
      {!res && <div class="li"><span class="spin" /><span class="grow muted small">{P.rrLoading}</span></div>}
      {/* Cada tipo começa recolhido; numa busca, o que achou já vem aberto. */}
      {groups.map((g) => (
        <Fold nested key={`${g.key}-${filtering}`} icon={g.icon} title={g.title} count={g.denied ? 0 : g.count} countText={g.denied ? '–' : undefined} open={filtering || undefined}>
          {g.denied ? <div class="li muted small">{P.rrDenied}</div> : g.body}
        </Fold>
      ))}
      {res && !groups.length && <div class="li muted">{filtering ? P.rrNoMatch : P.rrNone}</div>}
    </Fold>
  );
}

/** Sem acentos e em minúsculas, para "automação" achar "Automacao". */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function filterFlows(f: RecordFlows, terms: string[], onlyRan: boolean): RecordFlows {
  const ok = (text: string) => terms.every((t) => norm(text).includes(t));
  return {
    ...f,
    runs: f.runs.filter((r) => ok([r.name, r.state].join(' '))),
    definitions: f.definitions.filter((d) => (!onlyRan || d.ranHere) && ok([d.name, d.trigger, d.table, d.condition, d.scope ?? '', ...d.writes].join(' '))),
  };
}

function demoRuns(table: string): TableAutomations {
  const it = (name: string, detail: string, writes: string[] = [], tbl = table): AutomationItem => ({ sysId: name, name, table: tbl, detail, writes, scope: 'Global' });
  return {
    table, tables: [table, 'task'],
    businessRules: [
      it('Calcula prioridade', 'before · ordem 100 · ao criar, ao atualizar', ['priority']),
      it('[PERICIA-TESTE] Resolve incidente por palavra-chave', 'async · ordem 100 · ao atualizar', ['state', 'close_code']),
      it('Atualiza tarefas filhas', 'after · ordem 200 · ao atualizar', [], 'task'),
    ],
    scriptIncludes: [it('IncidentUtils', 'chamado por Calcula prioridade', [], 'sys_script_include')],
    clientScripts: [it('Mostra campos de resolução', 'onChange de state')],
    uiPolicies: [it('Campos obrigatórios ao resolver', 'ordem 100')],
    uiActions: [it('Resolve', 'resolve_incident · botão do formulário')],
    dataLookups: [it('Priority Lookup', '', ['priority'])],
    assignmentRules: [],
    jobs: [],
    flows: demoFlows(table),
    access: {},
    timing: { totalMs: 450, calls: 12 },
  };
}
