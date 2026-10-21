/**
 * "O que roda neste registro" (registro inteiro): tudo que está ativo para a tabela, separado por tipo —
 * regras de negócio, script includes, flows, client scripts, UI policies, botões, data lookups, atribuição e jobs.
 * O que causou mudanças neste registro ganha a marca "rodou aqui".
 */
import type { AutomationItem, BatchItem, TableAutomations } from '@trail/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { demoFlows, FlowsView } from './Flows';

const P = t(getPrefs().lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');

export function RecordRuns({ table, sysId, origin, items }: { table: string; sysId: string; origin: string; items: BatchItem[] }) {
  const [res, setRes] = useState<TableAutomations>();
  const [err, setErr] = useState('');
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

  if (err) return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow">{err}</span></div></div>;
  const groups: { key: string; title: string; icon: ComponentChildren; denied: boolean; count: number; body: ComponentChildren }[] = !res ? [] : [
    { key: 'br', title: P.rrBr, icon: Glyph.rule, denied: res.access.sys_script === 'denied', count: res.businessRules.length, body: res.businessRules.map((a) => row(a, 'sys_script')) },
    { key: 'si', title: P.rrSi, icon: Glyph.include, denied: res.access.sys_script_include === 'denied', count: res.scriptIncludes.length, body: res.scriptIncludes.map((a) => row(a, 'sys_script_include')) },
    { key: 'fl', title: P.rrFlows, icon: Glyph.flow, denied: false, count: (res.flows?.runs.length ?? 0) + (res.flows?.definitions.length ?? 0), body: res.flows ? <FlowsView res={res.flows} origin={origin} /> : null },
    { key: 'cs', title: P.rrCs, icon: Glyph.terminal, denied: res.access.sys_script_client === 'denied', count: res.clientScripts.length, body: res.clientScripts.map((a) => row(a, 'sys_script_client')) },
    { key: 'up', title: P.rrUp, icon: Glyph.shield, denied: res.access.sys_ui_policy === 'denied', count: res.uiPolicies.length, body: res.uiPolicies.map((a) => row(a, 'sys_ui_policy')) },
    { key: 'ua', title: P.rrUa, icon: Glyph.click, denied: res.access.sys_ui_action === 'denied', count: res.uiActions.length, body: res.uiActions.map((a) => row(a, 'sys_ui_action')) },
    { key: 'dl', title: P.rrDl, icon: Glyph.search, denied: res.access.dl_definition === 'denied', count: res.dataLookups.length, body: res.dataLookups.map((a) => row(a, 'dl_definition')) },
    { key: 'as', title: P.rrAs, icon: Glyph.group, denied: res.access.sysrule_assignment === 'denied', count: res.assignmentRules.length, body: res.assignmentRules.map((a) => row(a, 'sysrule_assignment')) },
    { key: 'jb', title: P.rrJobs, icon: Glyph.clock, denied: res.access.sysauto_script === 'denied', count: res.jobs.length, body: res.jobs.map((a) => row(a, 'sysauto_script')) },
  ].filter((g) => g.count > 0 || g.denied);
  const total = groups.reduce((n, g) => n + g.count, 0);
  return (
    <details class="box fold rruns" open>
      <summary><h4>{P.rrTitle}<span>{res ? total : ''} {Glyph.chevron}</span></h4></summary>
      <div class="muted small pad">{fmt(P.rrHint, { table })}</div>
      {!res && <div class="li"><span class="spin" /><span class="grow muted small">{P.rrLoading}</span></div>}
      {groups.map((g, gi) => (
        <details class="grp" open={gi === 0}>
          <summary><span class="ic sm">{g.icon}</span><b class="grow">{g.title}</b><i>{g.denied ? '–' : g.count}</i><span class="chev">{Glyph.chevron}</span></summary>
          {g.denied ? <div class="li muted small">{P.rrDenied}</div> : g.body}
        </details>
      ))}
      {res && !groups.length && <div class="li muted">{P.rrNone}</div>}
    </details>
  );
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
