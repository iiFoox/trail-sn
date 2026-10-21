/**
 * Aba "Como aconteceu": o momento da mudança (o que rodou em volta, em ordem, e quanto o salvamento levou) e,
 * embaixo, as provas — por que esta resposta, por que não foi outra e o que pode estar faltando.
 */
import type { AccessReport, Change, Evidence, Investigation, TraceItem } from '@trail/core';
import { fmt, t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { getPrefs } from '../shared/prefs';
import { cap, factText, humanField, localizeTimes, lossReason, parts, plural, refLink, traceTitle, valueLabel, when } from './format';
import { SaveTimingCard } from './SaveTiming';
import { Val } from './Val';

const s = t(getPrefs().lang);
const P = s.p;
const U = P.ux;
const WINDOW = { before: 3, after: 15 };

export function How({ r, c, origin, field, denied, expired, access, copy }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; access?: AccessReport; copy: (t: string) => void }) {
  return (
    <div class="stack">
      <Trace r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} />
      <SaveTimingCard r={r} c={c} origin={origin} />
      <h3 class="sec-h">{U.proofTitle}<small>{U.proofHint}</small></h3>
      <Proof r={r} c={c} origin={origin} field={field} denied={denied} expired={expired} access={access} copy={copy} />
    </div>
  );
}

// ---------- o momento ----------
const traceIcon: Record<string, preact.JSX.Element> = {
  form: Glyph.user, ui_action: Glyph.click, async: Glyph.async, job: Glyph.clock, api: Glyph.plug, background_script: Glyph.terminal,
  event: Glyph.event, flow: Glyph.flow, workflow: Glyph.flow, change: Glyph.check,
};

/** Outro campo citado no rastro: o rótulo do formulário, se a instância deixou ler. */
function otherName(r: Investigation, f: string): string {
  return r.display?.fields[f] || humanField(f);
}
function rawValue(v: string): string {
  if (!v) return P.empty;
  return v.length > 48 ? v.slice(0, 45) + '…' : v;
}
function OtherVal({ r, f, v, origin }: { r: Investigation; f: string; v: string; origin: string }) {
  return <Val raw={v} text={r.display?.values[f]?.[v] ?? rawValue(v)} refTable={r.display?.refs[f]} origin={origin} empty={P.empty} />;
}

function Trace({ r, c, origin, field, denied, expired }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean }) {
  const items: TraceItem[] = c.trace ?? [];
  const blind = denied.filter((d) => ['sys_flow_context', 'wf_context', 'sysevent', 'syslog_transaction'].includes(d));
  const txIds = items.filter((it) => it.ref?.table === 'syslog_transaction' && it.ref.sysId).map((it) => it.ref!.sysId!);
  return (
    <section class="how-moment">
      <h3 class="sec-h">{U.momentTitle}<small>{fmt(P.traceIntro, WINDOW)}</small></h3>
      {txIds.length > 1 && <a class="btn sm openall" href={refLink(origin, { table: 'syslog_transaction', query: `sys_idIN${txIds.join(',')}` })} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openAllTx, { n: txIds.length })}</a>}
      <div>
        <ol class="tl">
          {items.map((it, idx) => {
            const p = parts(it.at);
            const isChange = it.kind === 'change';
            const isWrite = it.kind === 'write';
            return (
              <li class={`${it.cause ? 'key' : ''} ${isChange ? 'res' : ''} ${isWrite ? 'other' : ''}`} style={`--i:${idx}`}>
                <div class="t"><b>{p.full}</b>{it.cause ? <span class="tag">{P.cause}</span> : it.user ? <span class="muted">{it.user}</span> : null}</div>
                <div class="x"><span class="ti">{isWrite ? Glyph.rule : traceIcon[it.kind]}</span>{isWrite ? P.otherWrite : traceTitle(r, c, it, field)}</div>
                {(it.kind === 'async' || it.kind === 'job') && <div class="sub2">{it.label}</div>}
                {it.sent !== undefined && <div class="sub2">{fmt(P.sent, { field, value: valueLabel(r, it.sent) })}</div>}
                {isWrite && <ul class="fw">{(it.fields ?? []).slice(0, 6).map((f) => <li><b>{otherName(r, f.field)}</b> <OtherVal r={r} f={f.field} v={f.oldValue} origin={origin} /> → <OtherVal r={r} f={f.field} v={f.newValue} origin={origin} /></li>)}{(it.fields?.length ?? 0) > 6 && <li class="muted">{fmt(P.moreFields, { n: (it.fields?.length ?? 0) - 6 })}</li>}</ul>}
                {isChange && it.fields?.length ? <div class="sub2 muted">{fmt(P.sameWrite, { list: it.fields.map((f) => otherName(r, f.field)).join(', ') })}</div> : null}
                <div class="src">
                  <span>{P.srcName[it.source] ?? it.source}{isChange || isWrite ? ` · ${fmt(P.checkpoint, { n: it.checkpoint ?? c.checkpoint })}` : ''}{it.kind === 'form' || it.kind === 'api' ? ` · ${it.label}` : ''}</span>
                  {it.ref && <a class="see" href={refLink(origin, it.ref)} target="_blank" rel="noreferrer">{P.seeInSn} {Glyph.open}</a>}
                </div>
              </li>
            );
          })}
          {expired && <li class="gapi"><div class="t"><b>—</b><span class="tag a">{P.notChecked}</span></div><div class="x small">{P.expiredText}</div></li>}
          {!expired && blind.length > 0 && (
            <li class="gapi"><div class="t"><b>{parts(c.at).time}</b><span class="tag a">{P.notChecked}</span></div>
              <div class="x small">{fmt(P.notCheckedText, { what: blind.map((b) => P.srcName[b] ?? b).join(', ') })}</div></li>
          )}
        </ol>
        {c.traceOmitted ? <div class="muted small">{fmt(P.omitted, { n: c.traceOmitted })}</div> : null}
        {items.length <= 1 && !expired && <div class="muted small">{P.traceEmpty}</div>}
      </div>
    </section>
  );
}

// ---------- as provas ----------
function Proof({ r, c, origin, field, denied, expired, access, copy }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; access?: AccessReport; copy: (t: string) => void }) {
  const [top, ...others] = c.evidence;
  const host = origin.replace(/^https?:\/\//, '');
  const missingCount = (denied.length ? 1 : 0) + (r.unaudited ? 1 : 0) + (expired ? 1 : 0);
  const entries = Object.entries(r.access).sort();
  const day = c.at.slice(0, 10);
  return (
    <>
      {top && (
        <div class="box">
          <h4>{P.whyThis}<span>{fmt(P.nProofs, { n: top.facts.length })}</span></h4>
          {top.facts.map((f, i) => <FactRow i={i} kind={f.kind} detail={localizeTimes(f.detail, day)} source={f.source} field={field} ok={f.points >= 0} />)}
          {top.gaps.map((g) => <div class="li"><span class="ck w">!</span><span class="grow">{localizeTimes(g, day)}</span></div>)}
        </div>
      )}
      {others.map((e) => <Other e={e} origin={origin} field={field} day={day} />)}
      <div class="box">
        <h4 class={missingCount ? 'warnh' : ''}>{P.missing}</h4>
        {!missingCount && <div class="li"><span class="ck">{Glyph.check}</span><span class="grow">{P.nothingMissing}</span></div>}
        {denied.length > 0 && (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <b>{cap(fmt(P.deniedItem, { what: denied.map((d) => P.srcName[d] ?? d).join(', ') }))}</b> {P.deniedHint}
            {denied.filter((d) => P.srcImpact[d]).map((d) => <div class="det">{cap(P.srcImpact[d]!)}.</div>)}
            <div><button class="link" onClick={() => copy(fmt(P.request, { host, tables: denied.join(', ') }))}>{Glyph.copy} {P.copyRequest}</button></div>
          </div></div>
        )}
        {r.unaudited && (
          <div class="li"><span class="ck w">!</span><div class="grow">
            <b>{plural(P.unauditedItem, r.unaudited.count)}</b> {fmt(P.unauditedText, { when: when(r.unaudited.lastUpdatedOn), user: r.unaudited.lastUpdatedBy })}
            {r.unaudited.clues.map((x) => <div class="det">{fmt(P.clue, { x: localizeTimes(x, '') })}</div>)}
          </div></div>
        )}
        {expired && <div class="li"><span class="ck w">!</span><div class="grow"><b>{P.expiredItem}</b> {P.expiredText}</div></div>}
        <details class="tech-acc">
          <summary class="pad small muted">{P.techAccess} {Glyph.chevron}</summary>
          <div class="acc-list">
            {[...entries, ...(access ? Object.entries(access.states).filter(([k]) => !(k in r.access)).sort() : [])].map(([k, v]) => (
              <div><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></div>
            ))}
          </div>
          <div class="pad"><button class="btn sm" onClick={() => send({ type: 'check-access', origin })}>{Glyph.shield} {P.recheck}</button></div>
        </details>
      </div>
    </>
  );
}

function FactRow({ kind, detail, source, field, ok, i = 0 }: { kind: string; detail: string; source: string; field: string; ok: boolean; i?: number }) {
  return (
    <div class="li fact" style={`--i:${i}`}>
      <span class={`ck ${ok ? '' : 'x'}`}>{ok ? Glyph.check : '–'}</span>
      <div class="grow">{factText(kind, field)}<div class="det">{detail}</div></div>
      <span class="srcp">{P.srcName[source] ?? source}</span>
    </div>
  );
}

function Other({ e, origin, field, day }: { e: Evidence; origin: string; field: string; day: string }) {
  const link = e.artifact.sysId && e.artifact.table ? recordLink(origin, e.artifact.table, e.artifact.sysId) : null;
  return (
    <details class="box fold">
      <summary><h4><span class="grow">{fmt(P.whyNotOther, { name: e.artifact.name })}<span class="why">{lossReason(e, field, day)}</span></span><span class="pill">{P.likelihood[e.grade]}</span></h4></summary>
      {e.gaps.map((g) => <div class="li"><span class="ck x">–</span><span class="grow">{localizeTimes(g, day)}</span></div>)}
      {e.facts.map((f) => <FactRow kind={f.kind} detail={localizeTimes(f.detail, day)} source={f.source} field={field} ok={f.points >= 0} />)}
      {link && <div class="pad"><a href={link} target="_blank" rel="noreferrer">{Glyph.open} {fmt(P.openArtifact, { what: P.what[e.artifact.table ?? ''] ?? s.openInStudio })}</a></div>}
    </details>
  );
}
