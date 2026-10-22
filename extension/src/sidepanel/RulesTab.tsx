/**
 * Partes da antiga aba "Regras do campo", usadas no Modo avançado (aba "Avançado"):
 *  - Quem grava: o que pode mudar o valor (regras, scripts, botões, lookups...), na ordem em que o ServiceNow roda;
 *  - Quem depende: o que lê o campo ou reage a ele (raio de impacto).
 * Tudo só leitura.
 */
import { DEP_PHASES, describeDependent, type DepKind, type FieldRules, type Investigation } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoFieldRules } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { humanField, isDemo, lang } from './format';
import { kindIcon } from './kinds';
import { Fold } from './Fold';

const s = t(getPrefs().lang);
const P = s.p;
const U = P.ux;
const str = (x: unknown) => x as Record<string, string>;

/** Lê o mapa do campo (quem grava e quem depende) só quando `on` fica verdadeiro; uma leitura serve às duas seções. */
export function useFieldRules(r: Investigation, origin: string, on: boolean): { res?: FieldRules; err: string; retry: () => void } {
  const [res, setRes] = useState<FieldRules>();
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { setRes(undefined); setErr(''); }, [r.target.table, r.target.field]);
  useEffect(() => {
    if (!on || res) return;
    let alive = true;
    setErr('');
    (async () => {
      try {
        const out = isDemo ? await demoFieldRules(r.target.field) : await send<FieldRules & { error?: string }>({ type: 'field-rules', origin, tabId: trackedTab(), target: { table: r.target.table, field: r.target.field, sysId: r.target.sysId } });
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [on, r.target.table, r.target.field, tick]);
  return { res, err, retry: () => setTick((x) => x + 1) };
}

const LANES = ['client', 'before', 'after', 'async', 'other'] as const;

/** Quem grava: o mapa de automações (já na ordem) e, sem repetir, o que a investigação achou que cita o campo. */
export function Writers({ r, res, origin, labels, field, bare = false }: { r: Investigation; res: FieldRules; origin: string; labels: Record<string, string>; field: string; /** Sem a caixa de fora (a aba Avançado já dá o título). */ bare?: boolean }) {
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
  if (!res.writers.length && !extra.length) return bare ? <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.fmNone}</span></div> : <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.fmNone}</span></div></div>;
  const lanes = LANES.map((l) => [l, res.writers.filter((i) => i.lane === l)] as const).filter(([, list]) => list.length > 0);
  const body = <>
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
  </>;
  if (bare) return <div class="writers">{body}</div>;
  return (
    <Fold cls="writers" title={fmt(U.writersCount[res.writers.length === 1 ? 0 : 1]!, { n: res.writers.length, field })} count={res.writers.length} open={false}>
      {body}
    </Fold>
  );
}

/** Quem depende: o que lê o campo ou reage a ele, por fase, com "como depende" e "o que faz" em frases. */
export function Dependents({ res, origin, labels, field, bare = false }: { res: FieldRules; origin: string; labels: Record<string, string>; field: string; bare?: boolean }) {
  if (!res.dependents.length) return bare ? <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{U.depsNone}</span></div> : <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{U.depsNone}</span></div></div>;
  const phase = str(U.depPhase);
  const phases = DEP_PHASES.map((ph) => [ph, res.dependents.filter((d) => d.phase === ph)] as const).filter(([, list]) => list.length > 0);
  const body = <>
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
  </>;
  if (bare) return <div class="deps">{body}</div>;
  return (
    <Fold cls="deps" title={fmt(U.depsCount[res.dependents.length === 1 ? 0 : 1]!, { n: res.dependents.length, field })} count={res.dependents.length} open={false}>
      {body}
    </Fold>
  );
}

/** O que não deu para ver (fonte negada ou lenta): dito por tipo, sem nome de tabela. */
export function NotSeen({ res }: { res: FieldRules }) {
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
