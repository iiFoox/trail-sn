/**
 * "Por que este campo está bloqueado, obrigatório ou escondido?": as regras que valem AGORA neste registro.
 * Três portas de entrada: a aba "Bloqueio?" do campo (com o cartão no topo quando o formulário mostra o campo
 * travado), a gaveta "Investigar" › "Um campo" e a lista "Campos bloqueados, obrigatórios ou escondidos agora"
 * do registro inteiro (a única que alcança campos escondidos, que não têm ícone). Só leitura.
 */
import { activeStates, humanQuery, type FieldStateResult, type StateAspect, type StateRule } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { demoFieldStates, demoFormStates, demoObserved } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { askForm, send, type ObservedField } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { trackedTab } from '../shared/tabRef';
import { Fold, Help } from './Fold';
import { Val } from './Val';

const lang = getPrefs().lang;
const P = t(lang).p;
const isDemo = new URLSearchParams(location.search).has('demo');
const ASPECTS: StateAspect[] = ['read_only', 'mandatory', 'hidden'];
const LOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const kindGlyph = (k: StateRule['kind']) => (k === 'client_script' || k === 'ui_policy' ? typeGlyph[k] : k === 'data_policy' ? Glyph.shield : Glyph.server);
const str = (x: unknown) => x as Record<string, string>;
/** Nome para leitura: as regras do dicionário viram "Dicionário (task)" em vez de "task.campo". */
const ruleName = (r: StateRule) => (r.kind === 'dictionary' || r.kind === 'dictionary_override' ? `${str(P.lkKind)[r.kind]} (${r.on ?? r.table})` : r.name);

/** Estado do campo no formulário aberto (g_form no mundo MAIN). null = não deu para ler (Workspace, sem aba). */
export function useObserved(table: string, sysId: string, field: string): ObservedField | null | undefined {
  const [o, setO] = useState<ObservedField | null>();
  useEffect(() => {
    let alive = true;
    setO(undefined);
    (async () => {
      const got = isDemo ? demoObserved(field) : await askForm<ObservedField & { table?: string }>(trackedTab(), { type: 'trail-field-state', field, table, sysId });
      if (alive) setO(got ?? null);
    })();
    return () => { alive = false; };
  }, [table, sysId, field]);
  return o;
}

/** O que está ativo no formulário, em palavras ("somente leitura e obrigatório"); vazio quando nada. */
export function activeText(o: ObservedField | null | undefined): string {
  if (!o || o.onForm === false) return '';
  const on = [o.readOnly && 'read_only', o.mandatory && 'mandatory', o.visible === false && 'hidden'].filter(Boolean) as StateAspect[];
  return on.map((a) => str(P.lkAspect)[a]!.toLowerCase()).join(P.lkAnd);
}

/** Cartão no topo do resultado: aparece quando o formulário mostra o campo travado, obrigatório ou escondido. */
export function LockCard({ observed, onOpen }: { observed: ObservedField | null | undefined; onOpen: () => void }) {
  const what = activeText(observed);
  if (!what) return null;
  return (
    <div class="notice info small lk-card">
      <span class="lk-ic">{LOCK}</span>
      <span class="grow">{fmt(P.lkCard, { what })}</span>
      <button class="btn sm" onClick={onOpen}>{P.lkCardGo}</button>
    </div>
  );
}

type LockTarget = { table: string; sysId: string; field: string; label?: string };

/** Lê o estado de um campo pelo motor. `observed` undefined = ainda lendo o formulário (espera). */
function useFieldState(target: LockTarget, origin: string, observed: ObservedField | null | undefined): { res?: FieldStateResult; err: string } {
  const [res, setRes] = useState<FieldStateResult>();
  const [err, setErr] = useState('');
  useEffect(() => {
    if (observed === undefined) return;
    let alive = true;
    setRes(undefined); setErr('');
    (async () => {
      try {
        const obs = observed ? { ...(observed.readOnly !== undefined ? { readOnly: observed.readOnly } : {}), ...(observed.mandatory !== undefined ? { mandatory: observed.mandatory } : {}), ...(observed.visible !== undefined ? { visible: observed.visible } : {}), ...(observed.onForm !== undefined ? { onForm: observed.onForm } : {}) } : undefined;
        const out = isDemo ? (await demoFieldStates([target.field]))[0]! : await send<FieldStateResult & { error?: string }>({ type: 'field-state', origin, tabId: trackedTab(), target: { table: target.table, sysId: target.sysId, field: target.field }, ...(obs ? { observed: obs } : {}) });
        if (isDemo) await new Promise((x) => setTimeout(x, 350));
        if ((out as { error?: string }).error) throw new Error((out as { error?: string }).error);
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [target.table, target.sysId, target.field, observed]);
  return { res, err };
}

/** Busca e mostra o estado de um campo (gaveta "Investigar" › "Um campo"). */
export function FieldLock({ target, origin, observed }: { target: LockTarget; origin: string; observed: ObservedField | null | undefined }) {
  const { res, err } = useFieldState(target, origin, observed);
  const name = res?.fieldLabel || target.label || target.field;
  return (
    <div class="stack lock">
      <div class="box lk-box">
        <h4>{fmt(P.lkTitle, { field: name })}</h4>
        <div class="li"><span class="grow muted small">{P.lkHint}</span></div>
      </div>
      {err && <div class="box"><div class="li"><span class="ck w">!</span><span class="grow">{err}</span></div></div>}
      {!err && !res && <div class="box"><div class="li"><span class="spin" /><span class="grow muted small">{P.lkLoading}</span></div></div>}
      {res && <LockView res={res} origin={origin} />}
    </div>
  );
}

/** Aspecto ligado agora (no formulário ou pelas regras)? */
const isOn = (res: FieldStateResult, a: StateAspect) => !!(res.aspects[a].observed ?? res.aspects[a].rules);

/**
 * Aba Regras › "Estado agora": uma linha ("Editável, opcional e visível agora"), três quadros pequenos e o porquê
 * recolhido em "Ver por quê" — que só abre sozinho quando o campo ESTÁ travado, obrigatório ou escondido.
 */
export function StateNow({ target, origin, observed }: { target: LockTarget; origin: string; observed: ObservedField | null | undefined }) {
  const { res, err } = useFieldState(target, origin, observed);
  if (err) return <div class="box"><div class="li"><span class="ck w">!</span><span class="grow">{err}</span></div></div>;
  if (!res) return <div class="box"><div class="li"><span class="spin" /><span class="grow muted small">{P.lkLoading}</span></div></div>;
  const any = ASPECTS.some((a) => isOn(res, a));
  const W = P.ux.stLine;
  const word = (a: StateAspect) => W[a]![isOn(res, a) ? 1 : 0]!;
  return (
    <div class={`box st-now ${any ? 'locked' : ''}`}>
      <div class="li st-line"><span class={`ck ${any ? 'w' : ''}`}>{any ? LOCK : Glyph.check}</span><b class="grow">{fmt(P.ux.stNow, { a: word('read_only'), b: word('mandatory'), c: word('hidden') })}</b><Help text={P.lkAcl} /></div>
      <div class="lk-chips sm">
        {ASPECTS.map((a) => <span class={`lk-chip ${isOn(res, a) ? 'on' : ''}`} title={res.aspects[a].observed !== undefined ? P.lkOnForm : P.lkByRules}><span class="lbl">{str(P.lkAspect)[a]}</span><b>{isOn(res, a) ? P.lkYes : P.lkNo}</b></span>)}
      </div>
      <Fold nested cls="st-why" title={P.ux.stWhy}>
        <div class="st-detail"><LockView res={res} origin={origin} compact quiet /></div>
      </Fold>
    </div>
  );
}

/**
 * O resultado do motor em linguagem simples: estado, a regra que decide, conflitos, "pode ser" e o que não vale.
 * `quiet` (aba Regras): sem os quadros (já estão acima) e sem rodapé; o que não trava agora ("libera a edição",
 * "pode ser" de outra view) vai para "Regras que não valem agora", recolhido.
 */
export function LockView({ res, origin, compact = false, quiet = false }: { res: FieldStateResult; origin: string; compact?: boolean; quiet?: boolean }) {
  const labels = Object.entries(res.fieldLabels ?? {}).sort((a, b) => b[0].length - a[0].length);
  const human = (q: string) => labels.reduce((acc, [k, l]) => acc.replace(new RegExp(`\\b${k}\\b`, 'g'), l), humanQuery(q, lang));
  const fname = (f: string) => res.fieldLabels?.[f] || f;
  const effect = (r: StateRule) => (r.sets === undefined ? P.lkTouch : str(r.sets ? P.lkSet : P.lkClear)[r.aspect]);
  const why = (r: StateRule) => fmt(str(P.lkWhy)[r.why] ?? '', { on: r.on ?? '', view: r.view ?? '', trigger: r.trigger ? fname(r.trigger) : '' });
  const link = (x: { table: string; sysId?: string; name: string }) => (x.sysId ? <a href={recordLink(origin, x.table, x.sysId)} target="_blank" rel="noreferrer">{x.name}</a> : <span>{x.name}</span>);
  const Now = ({ now }: { now?: Record<string, string> }) => (now && Object.keys(now).length ? (
    <div class="small lk-now"><span class="muted">{P.lkNow}</span> {Object.entries(now).map(([f, v], i) => <>{i > 0 && ' · '}<b>{fname(f)}</b> = <Val raw={v} text={res.valueLabels?.[f]?.[v]} refTable={res.refTables?.[f]} origin={origin} empty={P.empty} /></>)}</div>
  ) : null);
  const Rule = ({ i, mark }: { i: number; mark?: 'win' | 'lost' }) => {
    const r = res.rules[i]!;
    return (
      <div class={`li lk-rule ${mark ?? ''}`}>
        <span class={`ck ${r.grade === 'maybe' ? 'w' : ''}`} title={r.kind}>{kindGlyph(r.kind)}</span>
        <div class="grow">
          <div class="lk-name">{link(r)} <span class={`pill ${r.grade === 'maybe' ? 'w' : 'ok'}`}>{str(P.lkGrade)[r.grade]}</span></div>
          <div class="small">{str(P.lkKind)[r.kind]}{r.kind === 'ui_policy' ? ` · ${fmt(P.lkOrder, { n: r.order })}` : ''} · <b>{effect(r)}</b></div>
          <div class="det">{why(r)}</div>
          {r.condition && <div class="small lk-cond"><span class="muted">{P.lkWhen}</span> {human(r.condition)}</div>}
          <Now now={r.now} />
          {r.serverOnly && <div class="small muted">{P.lkServerOnly}</div>}
        </div>
      </div>
    );
  };
  const obs = res.observed;
  const relevant = ASPECTS.filter((a) => { const x = res.aspects[a]; return (x.observed ?? x.rules) || x.winner !== undefined || x.maybe.length > 0; });
  const shown = quiet ? relevant.filter((a) => isOn(res, a)) : relevant;
  const hidden = quiet ? relevant.filter((a) => !isOn(res, a)) : [];
  const aspectBox = (a: StateAspect) => {
        const x = res.aspects[a];
        const on = x.observed ?? x.rules;
        const confirmed = res.rules.map((r, i) => ({ r, i })).filter(({ r }) => r.aspect === a && r.grade === 'confirmed' && r.sets !== undefined);
        const losers = new Set(x.conflicts.map((c) => c.loser));
        // Linhas da caixa: regras, conflitos, avisos e "pode ser". Mais de uma: começa recolhida, com a regra que decide no resumo.
        const rows = confirmed.length + x.conflicts.length + (x.unexplained ? 1 : 0) + (x.mismatch && !x.unexplained ? 1 : 0) + x.maybe.length;
        return (
          <Fold cls="lk-aspect" title={str(P.lkAspect)[a]} count={rows || undefined}
            badge={<span class={`pill ${on ? 'w' : ''}`}>{on ? P.lkYes : P.lkNo}</span>}
            hint={x.winner !== undefined ? <span class="lk-head"><b>{str(x.rules ? P.lkBecause : P.lkFreed)[a]}:</b> {ruleName(res.rules[x.winner]!)}</span> : undefined}>
            {confirmed.map(({ i }) => <Rule i={i} mark={i === x.winner ? 'win' : losers.has(i) ? 'lost' : undefined} />)}
            {x.conflicts.map((c) => {
              const l = res.rules[c.loser]!, w = res.rules[c.winner]!;
              const dictFirst = w.kind === 'dictionary' || w.kind === 'dictionary_override';
              return <div class="li lk-conflict"><span class="ck w">!</span><span class="grow small">{fmt(P.lkConflict, { loser: ruleName(l), el: effect(l) ?? '', winner: ruleName(w), reason: dictFirst && l.kind !== 'dictionary_override' ? P.lkDictFirst : P.lkLater })}</span></div>;
            })}
            {x.unexplained && <div class="li lk-unexplained"><span class="ck w">?</span><span class="grow small">{str(P.lkUnexplained)[a]}</span></div>}
            {x.mismatch && !x.unexplained && <div class="li"><span class="ck w">!</span><span class="grow small">{P.lkMismatch}</span></div>}
            {x.maybe.length > 0 && <>
              <div class="li lk-sub"><span class="grow small"><b>{P.lkMaybe}</b> <span class="muted">· {P.lkMaybeHint}</span></span></div>
              {x.maybe.map((i) => <Rule i={i} />)}
            </>}
          </Fold>
        );
  };
  return (
    <>
      {!quiet && <div class="box lk-state">
        <div class="lk-chips">
          {ASPECTS.map((a) => {
            const x = res.aspects[a];
            const on = x.observed ?? x.rules;
            return <span class={`lk-chip ${on ? 'on' : ''}`}><span class="lbl">{str(P.lkAspect)[a]}</span><b>{on ? P.lkYes : P.lkNo}</b><small>{x.observed !== undefined ? P.lkOnForm : P.lkByRules}</small></span>;
          })}
        </div>
        {!obs && !compact && <div class="li"><span class="grow muted small">{P.lkNoObserved}</span></div>}
        {obs?.onForm === false && <div class="li"><span class="grow muted small">{P.lkNotOnForm}</span></div>}
      </div>}
      {quiet && obs?.onForm === false && <div class="muted small">{P.lkNotOnForm}</div>}
      {res.limited && (
        <div class="notice small lk-limited">
          <div class="title">{P.lkLimitedTitle}</div>
          <div>{P.lkLimited}</div>
          {res.denied.length > 0 && <details class="captech"><summary>{P.lkLimitedTech}</summary><code>{[...res.denied, ...(res.dictionaryHidden ? ['sys_dictionary (vazio)'] : [])].join(', ')}</code></details>}
        </div>
      )}
      {shown.map(aspectBox)}
      {hidden.length > 0 && <Fold nested cls="lk-other" title={P.ux.stOther} count={hidden.length} open={false}>{hidden.map(aspectBox)}</Fold>}
      {!shown.length && <div class="box"><div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.lkNothing}</span></div></div>}
      {res.skipped.length > 0 && (
        <Fold cls="lk-skipped" title={P.lkSkipped} count={res.skipped.length} open={false}>
          {res.skipped.map((k) => (
            <div class="li"><span class="ck x">–</span><div class="grow">{link(k)}<div class="det">{str(P.lkSkipWhy)[k.why]}</div>{k.condition && <div class="small lk-cond"><span class="muted">{P.lkWhen}</span> {human(k.condition)}</div>}<Now now={k.now} /></div></div>
          ))}
        </Fold>
      )}
      {!quiet && <div class="muted small lk-foot">{P.lkAcl}{!compact && <> · {fmt(P.lkSummary, { n: res.rules.length + res.skipped.length, ms: res.timing.totalMs })}</>}</div>}
    </>
  );
}

/**
 * Lista do registro: todos os campos do formulário (inclusive escondidos, que não têm ícone) que estão
 * somente leitura, obrigatórios ou escondidos agora, cada um com o motivo resumido; clicar abre o detalhe.
 */
export function FormStates({ table, sysId, origin, title = P.lkListTitle, lazy = false }: { table: string; sysId: string; origin: string; title?: string; /** Só lê o formulário e a instância quando a pessoa abre a seção. */ lazy?: boolean }) {
  const [fields, setFields] = useState<ObservedField[] | null>();
  const [res, setRes] = useState<FieldStateResult[]>();
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<string>();
  const [opened, setOpened] = useState(!lazy);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setFields(undefined); setRes(undefined); setErr('');
    (async () => {
      const got = isDemo ? { fields: demoFormStates() } : await askForm<{ fields?: ObservedField[] }>(trackedTab(), { type: 'trail-form-states', table, sysId });
      const list = got?.fields ?? null;
      if (!alive) return;
      setFields(list);
      const active = (list ?? []).filter((f) => activeText(f));
      if (!active.length) return;
      try {
        const out = isDemo ? await demoFieldStates(active.map((f) => f.field))
          : await send<FieldStateResult[] | { error?: string }>({ type: 'field-states', origin, tabId: trackedTab(), table, sysId, fields: active.map(({ field, readOnly, mandatory, visible, onForm }) => ({ field, observed: { readOnly, mandatory, visible, onForm } })) });
        if (!Array.isArray(out)) throw new Error(out?.error ?? '?');
        if (alive) setRes(out);
      } catch (e) { if (alive) setErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [table, sysId, opened]);
  const active = (fields ?? []).filter((f) => activeText(f));
  const reason = (r: FieldStateResult | undefined) => {
    if (!r) return '';
    return activeStates(r).map((s) => `${str(P.lkAspect)[s.aspect]}: ${s.rule ? fmt(P.lkListBy, { name: ruleName(s.rule) }) : s.maybe ? fmt(P.lkListMaybe, { name: ruleName(s.maybe) }) : s.aspect === 'read_only' ? P.lkListAcl : P.lkListNoRule}`).join(' · ');
  };
  // Começa recolhida (o padrão do painel), com a contagem no cabeçalho.
  return (
    <Fold cls="lk-list" title={title} count={fields ? active.length : undefined} pill="w" open={lazy ? shown : undefined} onToggle={lazy ? (o) => { setShown(o); if (o) setOpened(true); } : undefined}>
      {fields && active.length > 0 && <div class="li"><span class="grow muted small">{P.lkListHint}</span></div>}
      {fields === undefined && <div class="li"><span class="spin" /><span class="grow muted small">{P.lkListLoading}</span></div>}
      {fields === null && <div class="li lk-noform"><span class="ck x">–</span><span class="grow small">{P.lkListNoForm}</span></div>}
      {fields && !active.length && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow small">{P.lkListNone}</span></div>}
      {err && <div class="li"><span class="ck w">!</span><span class="grow small">{err}</span></div>}
      {res?.[0]?.limited && <div class="li"><span class="ck w">!</span><span class="grow small"><b>{P.lkLimitedTitle}.</b> {P.lkLimited}</span></div>}
      {active.map((f) => {
        const r = res?.find((x) => x.field === f.field);
        const open = sel === f.field;
        return (
          <>
            <button class={`li lk-row ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setSel(open ? undefined : f.field)}>
              <span class="ck w">{LOCK}</span>
              <span class="grow">
                <b>{f.label || r?.fieldLabel || f.field}</b> <small class="muted">{activeText(f)}</small>
                <span class="det">{r ? reason(r) : res || err ? '' : P.lkListLoading}</span>
              </span>
              <span class="cv">{Glyph.chevron}</span>
            </button>
            {open && r && <div class="lk-detail"><LockView res={r} origin={origin} compact /></div>}
          </>
        );
      })}
    </Fold>
  );
}
