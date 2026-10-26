/**
 * Aba "Avançado" (só com o Modo avançado ligado nas Configurações): as ferramentas para quem administra ou
 * desenvolve na instância, cada uma numa seção recolhida. Nada é consultado enquanto a seção está fechada:
 * o conteúdo só é montado (e só lê a instância ou o formulário) quando a pessoa abre. Tudo só leitura.
 */
import type { Change, Investigation } from '@trail/core';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';
import { CompareTool } from './Compare';
import { ErrorMsg } from './ErrorMsg';
import { FormStates, StateNow, useObserved } from './FieldLock';
import { Fold } from './Fold';
import { Dependents, NotSeen, useFieldRules, Writers } from './RulesTab';
import { SaveTimingCard } from './SaveTiming';
import { Simulate } from './Simulate';
import { WhatIf } from './WhatIf';
import { WhoSees } from './WhoSees';

const P = t(getPrefs().lang).p;
const A = P.adv;

/** Seção recolhida que só monta o conteúdo depois de aberta pela primeira vez (e o mantém, para não ler de novo). */
function Lazy({ id, title, count, onOpen, children }: { id: string; title: string; count?: number; onOpen?: () => void; children: (close: () => void) => ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const [ever, setEver] = useState(false);
  return (
    <Fold cls={`adv-sec adv-${id}`} id={`adv-${id}`} title={title} count={count} open={open}
      onToggle={(o) => { setOpen(o); if (o && !ever) { setEver(true); onOpen?.(); } }}>
      {ever && <div class="adv-body">{children(() => setOpen(false))}</div>}
    </Fold>
  );
}

/** Estado agora do campo (somente leitura, obrigatório, escondido) e o porquê. */
function LockNow({ r, origin, field }: { r: Investigation; origin: string; field: string }) {
  const observed = useObserved(r.target.table, r.target.sysId, r.target.field);
  return <StateNow target={{ table: r.target.table, sysId: r.target.sysId, field: r.target.field, label: field }} origin={origin} observed={observed} />;
}

export function AdvancedTab({ r, c, origin, field, me }: { r: Investigation; c: Change; origin: string; field: string; me?: string }) {
  // Quem grava e Quem depende vêm da mesma leitura (o mapa do campo): só acontece quando uma das duas abre.
  const [wantRules, setWantRules] = useState(false);
  const rules = useFieldRules(r, origin, wantRules);
  const labels: Record<string, string> = { ...(rules.res?.fieldLabels ?? {}), ...(r.display?.fields ?? {}), [r.target.field]: field };
  const rulesBody = (body: (res: NonNullable<typeof rules.res>) => ComponentChildren) => (
    <>
      {rules.err && <div class="li"><span class="ck w">!</span><span class="grow"><ErrorMsg msg={rules.err} /> <button class="link" onClick={rules.retry}>{P.ux.retry}</button></span></div>}
      {!rules.err && !rules.res && <div class="li"><span class="spin" /><span class="grow muted small">{P.ux.rulesLoading}</span></div>}
      {rules.res && body(rules.res)}
    </>
  );
  const people = [...new Set([me, ...r.changes.map((x) => x.user), ...r.changes.flatMap((x) => (x.trace ?? []).map((y) => y.user))].filter((x): x is string => !!x && x !== 'system'))];
  return (
    <div class="stack adv">
      <div class="muted small adv-intro">{A.intro}</div>
      <Lazy id="lock" title={A.lock}>{() => <LockNow r={r} origin={origin} field={field} />}</Lazy>
      <Lazy id="writers" title={A.writers} count={rules.res?.writers.length} onOpen={() => setWantRules(true)}>
        {() => rulesBody((res) => <Writers r={r} res={res} origin={origin} labels={labels} field={field} bare />)}
      </Lazy>
      <Lazy id="deps" title={A.deps} count={rules.res?.dependents.length} onOpen={() => setWantRules(true)}>
        {() => rulesBody((res) => <><Dependents res={res} origin={origin} labels={labels} field={field} bare /><NotSeen res={res} /></>)}
      </Lazy>
      <Lazy id="whatif" title={P.wiTab}>{() => <WhatIf r={r} origin={origin} field={field} />}</Lazy>
      <Lazy id="sim" title={A.sim}>{(close) => <Simulate r={r} origin={origin} field={field} labels={labels} onClose={close} />}</Lazy>
      <Lazy id="cmp" title={A.cmp}>{(close) => <CompareTool r={r} origin={origin} field={field} onClose={close} />}</Lazy>
      <Lazy id="save" title={A.save}>{() => <SaveTimingCard r={r} c={c} origin={origin} />}</Lazy>
      <WhoSees table={r.target.table} sysId={r.target.sysId} field={r.target.field} display={r.target.display} origin={origin} {...(me ? { me } : {})} people={people} />
      <FormStates table={r.target.table} sysId={r.target.sysId} origin={origin} title={A.form} lazy />
    </div>
  );
}
