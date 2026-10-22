import type { ComponentChildren } from 'preact';
/**
 * Aba "Regras do campo": o desenho da instância para este campo, em três partes —
 *  1. Estado agora: por que está somente leitura, obrigatório ou escondido neste registro;
 *  2. Quem grava: o que pode mudar o valor (regras, scripts, botões, lookups...), na ordem em que o ServiceNow roda;
 *  3. Quem depende: o que lê o campo ou reage a ele (raio de impacto).
 * Duas ferramentas no topo: "Simular um valor" e "Comparar com outra instância". Tudo só leitura.
 */
import { DEP_PHASES, describeDependent, type DepKind, type FieldRules, type Investigation, type TableConflictScan } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { demoFieldRules } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send, type ObservedField } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { ErrorMsg } from './ErrorMsg';
import { FormStates, StateNow } from './FieldLock';
import { conflictLines, humanField, isDemo, lang } from './format';
import { Simulate } from './Simulate';
import { CompareTool } from './Compare';
import { kindIcon } from './kinds';
import { Fold, Help } from './Fold';

const s = t(getPrefs().lang);
const P = s.p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;
export type RulesTool = 'sim' | 'cmp';

export function RulesTab({ r, origin, field, observed, tool, setTool }: { r: Investigation; origin: string; field: string; observed: ObservedField | null | undefined; tool?: RulesTool; setTool: (t: RulesTool | undefined) => void }) {
  const [res, setRes] = useState<FieldRules>();
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setRes(undefined); setErr('');
    (async () => {
      try {
        const out = isDemo ? await demoFieldRules(r.target.field) : await send<FieldRules & { error?: string }>({ type: 'field-rules', origin, tabId: trackedTab(), target: { table: r.target.table, field: r.target.field, sysId: r.target.sysId } });
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [r.target.table, r.target.field, tick]);
  const labels: Record<string, string> = { ...(res?.fieldLabels ?? {}), ...(r.display?.fields ?? {}), [r.target.field]: field };
  const lockTarget = { table: r.target.table, sysId: r.target.sysId, field: r.target.field, label: field };
  const toggle = (x: RulesTool) => setTool(tool === x ? undefined : x);
  // Ferramenta aberta de fora (ex.: "Simular outro valor" na Resposta): rola até ela.
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (tool) toolsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [tool]);
  const loading = !err && !res && <div class="box"><div class="li"><span class="spin" /><span class="grow muted small">{U.rulesLoading}</span></div></div>;
  // Ordem: primeiro o que manda neste campo (estado, quem grava, quem depende); depois as ferramentas e o resto do registro.
  return (
    <div class="stack rules">
      <h3 class="sec-h" id="rules-now">{U.secNow}<Help text={U.secNowHint} /></h3>
      <StateNow target={lockTarget} origin={origin} observed={observed} />

      <h3 class="sec-h" id="rules-writers">{U.secWriters}<Help text={fmt(U.secWritersHint, { field })} /></h3>
      {(r.conflicts?.length ?? 0) > 0 && <Conflicts r={r} origin={origin} />}
      {err && <div class="box"><div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /> <button class="link" onClick={() => setTick(tick + 1)}>{U.retry}</button></span></div></div>}
      {loading}
      {res && <Writers r={r} res={res} origin={origin} labels={labels} field={field} />}

      <h3 class="sec-h" id="rules-deps">{U.secDeps}<Help text={fmt(U.secDepsHint, { field })} /></h3>
      {loading}
      {res && <Dependents res={res} origin={origin} labels={labels} field={field} />}
      {res && <NotSeen res={res} />}

      <h3 class="sec-h" id="rules-tools">{U.secTools}<Help text={fmt(U.secToolsHint, { field })} /></h3>
      <div class="stack" ref={toolsRef}>
        <ToolFold open={tool === 'sim'} onToggle={(o) => setTool(o ? 'sim' : tool === 'sim' ? undefined : tool)} icon={Glyph.compare} title={U.simBtn}>
          <Simulate r={r} origin={origin} field={field} labels={labels} onClose={() => setTool(undefined)} />
        </ToolFold>
        <ToolFold open={tool === 'cmp'} onToggle={(o) => setTool(o ? 'cmp' : tool === 'cmp' ? undefined : tool)} icon={Glyph.server} title={U.cmpBtn}>
          <CompareTool r={r} origin={origin} field={field} onClose={() => setTool(undefined)} />
        </ToolFold>
      </div>

      <FormStates table={r.target.table} sysId={r.target.sysId} origin={origin} />
      <TableScan r={r} origin={origin} />
    </div>
  );
}

/** Ferramenta como seção recolhível (mesma seta das outras): o conteúdo só é montado aberto, para não consultar a instância à toa. */
function ToolFold({ open, onToggle, icon, title, children }: { open: boolean; onToggle: (open: boolean) => void; icon: ComponentChildren; title: ComponentChildren; children: ComponentChildren }) {
  return (
    <details class="box fold fold2 tool" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) onToggle(o); }}>
      <summary><h4><span class="caret" aria-hidden="true" /><span class="ic sm">{icon}</span><span class="grow">{title}</span></h4></summary>
      {open && children}
    </details>
  );
}

const LANES = ['client', 'before', 'after', 'async', 'other'] as const;

/** Quem grava: o mapa de automações (já na ordem) e, sem repetir, o que a investigação achou que cita o campo. */
function Writers({ r, res, origin, labels, field }: { r: Investigation; res: FieldRules; origin: string; labels: Record<string, string>; field: string }) {
  const ids = new Set(res.writers.map((w) => w.sysId).filter(Boolean));
  const names = new Set(res.writers.map((w) => w.name));
  const S = r.suspects;
  // O que a investigação achou (suspeitos estáticos) e o mapa não trouxe: só quem não está acima.
  const extra = [
    ...S.businessRules.map((b) => ({ name: b.name, table: 'sys_script', sysId: b.sysId, det: `${str(P.when)[b.when] ?? b.when} · ${s.order} ${b.order}` })),
    ...S.viaScriptInclude.map((x) => ({ name: x.scriptInclude, table: 'sys_script_include', sysId: x.scriptIncludeSysId, det: fmt(P.calledBy, { br: x.businessRule }) })),
    ...(S.clientScripts ?? []).map((c) => ({ name: c.name, table: 'sys_script_client', sysId: c.sysId, det: `${c.type}${c.trigger ? ` · ${labels[c.trigger] || humanField(c.trigger)}` : ''}` })),
    ...(S.dataLookups ?? []).map((d) => ({ name: d.name, table: 'dl_definition', sysId: d.sysId, det: '' })),
    ...(S.assignmentRules ?? []).map((a) => ({ name: a.name, table: 'sysrule_assignment', sysId: a.sysId, det: '' })),
    ...(S.uiActions ?? []).map((u) => ({ name: u.name, table: 'sys_ui_action', sysId: u.sysId, det: '' })),
  ].filter((x) => !ids.has(x.sysId) && !names.has(x.name)).filter((x, i, a) => a.findIndex((y) => y.sysId === x.sysId && y.name === x.name) === i);
  const lane = str(P.fmLane);
  if (!res.writers.length && !extra.length) return <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.fmNone}</span></div></div>;
  const lanes = LANES.map((l) => [l, res.writers.filter((i) => i.lane === l)] as const).filter(([, list]) => list.length > 0);
  return (
    <Fold cls="writers" title={fmt(U.writersCount[res.writers.length === 1 ? 0 : 1]!, { n: res.writers.length, field })} count={res.writers.length} open={false}>
      {lanes.map(([l, list]) => (
        <Fold nested cls="lane" title={lane[l]} count={list.length} open={lanes.length === 1}>
          {list.map((i) => {
            const writes = i.values.slice(0, 3).map((v) => r.labels?.[v] ?? v).join(', ');
            return (
              <div class="li one" title={`${P.fmWhen}: ${i.when}${i.on && i.on !== r.target.table ? ` · ${i.on}` : ''}`}>
                <span class="ck" title={s.type[i.kind as keyof typeof s.type] ?? i.kind}>{typeGlyph[i.kind] ?? Glyph.check}</span>
                <div class="grow">{i.sysId ? <a href={recordLink(origin, i.table, i.sysId)} target="_blank" rel="noreferrer">{i.name}</a> : i.name}{writes && <span class="muted small"> · {P.fmWrites} {writes}</span>}</div>
              </div>
            );
          })}
        </Fold>
      ))}
      {extra.length > 0 && (
        <Fold nested cls="writers-also" icon={Glyph.search} title={U.writersAlso} count={extra.length} open={false}>
          <div class="li muted small">{U.writersAlsoHint}</div>
          {extra.map((x) => <div class="li"><div class="grow"><a href={recordLink(origin, x.table, x.sysId)} target="_blank" rel="noreferrer">{x.name || '—'}</a>{x.det && <div class="det">{x.det}</div>}</div></div>)}
        </Fold>
      )}
    </Fold>
  );
}

/** Quem depende: o que lê o campo ou reage a ele, por fase, com "como depende" e "o que faz" em frases. */
function Dependents({ res, origin, labels, field }: { res: FieldRules; origin: string; labels: Record<string, string>; field: string }) {
  if (!res.dependents.length) return <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{U.depsNone}</span></div></div>;
  const phase = str(U.depPhase);
  const phases = DEP_PHASES.map((ph) => [ph, res.dependents.filter((d) => d.phase === ph)] as const).filter(([, list]) => list.length > 0);
  return (
    <Fold cls="deps" title={fmt(U.depsCount[res.dependents.length === 1 ? 0 : 1]!, { n: res.dependents.length, field })} count={res.dependents.length} open={false}>
      {phases.map(([ph, list]) => (
        <Fold nested cls="lane" title={phase[ph]} count={list.length} open={phases.length === 1 && list.length === 1}>
          {list.map((d) => {
            const x = describeDependent(d, lang, labels);
            const kind = str(U.depKind)[d.kind] ?? d.kind;
            // Uma linha: nome, tipo e o efeito mais importante; o "como depende" fica no tooltip.
            return (
              <div class="li dep one" title={[...x.how, ...x.does.map((e) => `→ ${e}`)].join('\n')}>
                <span class="ck" title={kind}>{kindIcon(d.kind)}</span>
                <div class="grow">{d.sysId ? <a href={recordLink(origin, d.table, d.sysId)} target="_blank" rel="noreferrer">{d.name}</a> : d.name} <span class="muted small">· {kind}</span>
                  {x.does.length > 0 && <span class="small dep-does"> <b>→</b> {x.does[0]}{x.does.length > 1 ? ` ${fmt(U.more, { n: x.does.length - 1 })}` : ''}</span>}
                </div>
              </div>
            );
          })}
        </Fold>
      ))}
    </Fold>
  );
}

/** O que não deu para ver (fonte negada ou lenta): dito por tipo, sem nome de tabela. */
function NotSeen({ res }: { res: FieldRules }) {
  if (!res.notSeen.length && !res.effectsUnknown.length) return null;
  const k = str(U.depKindPlural);
  const list = (xs: DepKind[]) => [...new Set(xs.map((x) => k[x] ?? x))].join(', ');
  return (
    <div class="notice small">
      {res.notSeen.length > 0 && <div><b>{U.notSeenTitle}</b> {list(res.notSeen)}.</div>}
      {res.effectsUnknown.length > 0 && <div>{fmt(U.effectsUnknown, { what: list(res.effectsUnknown) })}</div>}
      {(res.denied.length > 0 || res.slow.length > 0) && <details class="captech"><summary>{P.lkLimitedTech}</summary><code>{[...res.denied, ...res.slow].join(', ')}</code></details>}
    </div>
  );
}

function Conflicts({ r, origin }: { r: Investigation; origin: string }) {
  const lines = conflictLines(r);
  return (
    <Fold cls="conflict" warn title={P.cfTitle} count={lines.length} pill="w">
      <div class="li"><span class="grow muted small">{P.cfHint}</span></div>
      {(r.conflicts ?? []).map((k, i) => (
        <div class="li"><span class="ck w">!</span><div class="grow">
          <div><a href={recordLink(origin, k.a.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.a.sysId)} target="_blank" rel="noreferrer">{lines[i]!.a}</a></div>
          <div><a href={recordLink(origin, k.b.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.b.sysId)} target="_blank" rel="noreferrer">{lines[i]!.b}</a></div>
          <div class="det">{lines[i]!.overlap} · {lines[i]!.win}</div>
        </div></div>
      ))}
    </Fold>
  );
}

/** Varredura de conflitos de todos os campos da tabela, sob demanda (ferramenta de quem configura). */
function TableScan({ r, origin }: { r: Investigation; origin: string }) {
  const [st, setSt] = useState<'idle' | 'run' | 'done' | 'err'>('idle');
  const [res, setRes] = useState<TableConflictScan>();
  const [err, setErr] = useState('');
  const table = r.target.table;
  const run = async () => {
    setSt('run');
    try {
      const out = isDemo ? demoScan(r) : await send<TableConflictScan & { error?: string }>({ type: 'scan-conflicts', origin, table });
      if (isDemo) await new Promise((x) => setTimeout(x, 600));
      if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
      setRes(out); setSt('done');
    } catch (e) { setErr((e as Error).message); setSt('err'); }
  };
  const lines = res ? conflictLines({ ...r, conflicts: res.conflicts }) : [];
  return (
    <Fold cls="scan" title={fmt(P.scTitle, { table })} count={res ? res.conflicts.length : undefined} open={false}>
      {st === 'idle' && <div class="li"><span class="grow muted small">{P.scHint}</span><button class="btn sm" onClick={run}>{Glyph.search} {P.scRun}</button></div>}
      {st === 'run' && <div class="li"><span class="spin" /><span class="grow muted small">{P.scRunning}</span></div>}
      {st === 'err' && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={err} /></span></div>}
      {st === 'done' && res && <>
        <div class="li"><span class="grow muted small">{fmt(P.scSummary, { rules: res.rules, cs: res.clientScripts, fields: res.fields, ms: res.timing.totalMs })}</span></div>
        {!res.conflicts.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.scNone}</span></div>}
        {res.conflicts.map((k, i) => (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <div class="fld"><b>{humanField(k.field)}</b> <code>{k.field}</code></div>
            <div><a href={recordLink(origin, k.a.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.a.sysId)} target="_blank" rel="noreferrer">{lines[i]!.a}</a></div>
            <div><a href={recordLink(origin, k.b.kind === 'client_script' ? 'sys_script_client' : 'sys_script', k.b.sysId)} target="_blank" rel="noreferrer">{lines[i]!.b}</a></div>
            <div class="det">{lines[i]!.overlap} · {lines[i]!.win}</div>
          </div></div>
        ))}
      </>}
    </Fold>
  );
}

function demoScan(r: Investigation): TableConflictScan {
  const rule = (kind: 'br_before' | 'client_script', name: string, order: number, v: string) => ({ kind, name, sysId: name, table: r.target.table, order, values: [v] });
  return {
    table: r.target.table, tables: r.tables, rules: 214, clientScripts: 38, fields: 61, timing: { totalMs: 840, calls: 4 },
    conflicts: [
      { field: 'impact', overlap: 'always', winner: 'b', why: 'higher_order', a: rule('br_before', 'Impacto padrão', 100, '3'), b: rule('br_before', 'Impacto VIP', 400, '1') },
      { field: 'urgency', overlap: 'possible', winner: 'a', why: 'server_after_client', a: rule('br_before', 'Urgência por categoria', 100, '2'), b: rule('client_script', 'Sugere urgência', 0, '1') },
    ],
  };
}
