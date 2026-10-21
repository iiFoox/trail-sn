/**
 * Aba "Resposta": a frase em linguagem simples no topo, a causa com o link para abri-la, um selo único de certeza
 * e uma ação principal ("Copiar para o chamado", com Frase / Resumo / Relatório completo / PDF).
 * O detalhe (rastro e provas) fica em "Como aconteceu".
 */
import type { Change, Grade, Investigation } from '@trail/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt, t } from '../shared/i18n';
import { Glyph, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { getPrefs } from '../shared/prefs';
import { fullReport, plainSummary, savePdf } from './export';
import { factText, plural, valueLabel, when } from './format';

const s = t(getPrefs().lang);
const P = s.p;
const U = P.ux;
const DOTS: Record<Grade, number> = { confirmed: 3, probable: 2, candidate: 1 };

/** Fontes de rastro que, negadas, podem esconder a causa (flows, workflows, eventos, transações...). */
const CAUSE_SOURCES = ['sys_flow_context', 'wf_context', 'sysevent', 'syslog_transaction', 'sys_script', 'sysauto_script', 'sys_hub_action_instance_v2', 'sys_import_set_row'];

/** O selo de certeza, igual nas três faixas: três pontos, o nome e (opcional) a frase da prova. */
export function Seal({ grade, why }: { grade: Grade; why?: string }) {
  return (
    <div class={`seal ${grade}`}>
      <span class="dots" aria-hidden="true">{[1, 2, 3].map((i) => <i class={i <= DOTS[grade] ? 'on' : ''} />)}</span>
      <b>{P.certainty[grade]}</b>
      {why && <span class="why">{why}</span>}
    </div>
  );
}

export function Answer({ r, c, origin, field, denied, expired, goHow, goSim, copy, toast }: { r: Investigation; c: Change; origin: string; field: string; denied: string[]; expired: boolean; goHow: () => void; goSim: () => void; copy: (t: string) => void; toast: (m: string) => void }) {
  const top = c.evidence[0];
  const alt = c.evidence[1];
  const warns = [
    denied.length ? plural(P.warnDenied, denied.length) : '',
    r.unaudited ? plural(P.warnUnaudited, r.unaudited.count) : '',
    expired ? P.warnExpired : '',
    r.conflicts?.length ? plural(P.warnConflict, r.conflicts.length) : '',
  ].filter(Boolean);
  // O aviso de "pode estar incompleta" só sobe para o topo quando a fonte negada pode ser a causa:
  // sem causa, certeza baixa, ou uma causa genérica ("processo em segundo plano", "o servidor").
  const weak = !top || top.grade === 'candidate' || (top.grade === 'probable' && (top.type === 'unknown_background' || top.type === 'server_change'));
  const hiding = weak ? denied.filter((d) => CAUSE_SOURCES.includes(d) && P.srcImpact[d]) : [];
  const summary = () => fmt(P.summary, {
    rec: r.target.display, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue), when: when(c.at),
    who: top?.artifact.name ?? '?', type: top ? s.type[top.type] : '?', cert: top ? P.certainty[top.grade] : P.noCause,
    facts: (top?.facts ?? []).map((f) => `• ${factText(f.kind, field)}`).join('\n'),
  });
  const link = top?.artifact.sysId && top.artifact.table ? recordLink(origin, top.artifact.table, top.artifact.sysId) : null;
  const best = top ? [...top.facts].sort((a, b) => b.points - a.points)[0] : undefined;
  const kind = top ? (top.type === 'user_action' && top.facts.some((f) => f.kind === 'integration_user') ? (P.kind as Record<string, string>).user_integration
    : top.type === 'user_action' && top.facts.some((f) => /\/api\//.test(f.detail)) ? (P.kind as Record<string, string>).user_api : P.kind[top.type]) : '';
  const pp = r.pingPong;
  const phrase = plainSummary(r, c);
  return (
    <div class="stack">
      {hiding.length > 0 && (
        <div class="notice">
          <div class="title">{P.incompleteTitle}</div>
          <div class="small">{P.incompleteText}</div>
          {hiding.map((d) => <div class="small">· {P.srcImpact[d]}.</div>)}
        </div>
      )}
      {pp && (
        <div class="notice pp">
          <div class="title">{P.ppTitle}</div>
          <div class="small">{fmt(P.ppText, { a: pp.actors[0], b: pp.actors[1], va: valueLabel(r, pp.values[0]), vb: valueLabel(r, pp.values[1]), n: pp.flips, from: when(pp.from), to: when(pp.to) })}</div>
        </div>
      )}
      <div class={`ans-card ${top?.grade ?? 'none'}`}>
        <p class="ans-phrase">{phrase}</p>
        {top ? (
          <div class="ans-cause">
            <span class="ic">{typeGlyph[top.type]}</span>
            <div class="grow">
              <div class="k">{U.causeLbl} · {kind}</div>
              <div class="nm"><span title={s.type[top.type]}>{top.artifact.name}</span>
                {link && <a class="ans-open" href={link} target="_blank" rel="noreferrer">{fmt(P.openArtifact, { what: P.what[top.artifact.table ?? ''] ?? s.openInStudio })} {Glyph.open}</a>}</div>
            </div>
          </div>
        ) : (
          <div class="ans-cause"><span class="ic">{Glyph.question}</span><div class="grow"><div class="nm">{P.noCause}</div><div class="k">{U.noCauseHint}</div></div></div>
        )}
        {top && <Seal grade={top.grade} why={best ? factText(best.kind, field) : undefined} />}
      </div>
      <CopyMenu items={[
        [U.copyPhrase, () => copy(phrase)],
        [U.copySummary, () => copy(summary())],
        [U.copyFull, () => copy(fullReport(r, c, origin))],
        [U.copyPdf, () => void savePdf(r, r.changes.indexOf(c), origin, () => toast(P.demoPdf))],
      ]} />
      {alt && (
        <button class="alt" onClick={goHow}>
          <span class="ic sm">{typeGlyph[alt.type]}</span>
          <span class="grow">{P.otherPossibility} <b>{alt.artifact.name}</b></span>
          <span class="pill">{P.likelihood[alt.grade]}</span>
        </button>
      )}
      {warns.length > 0 && (
        <button class="warnbar" onClick={goHow}>{Glyph.warn}<span class="grow">{fmt(U.mayMiss, { list: warns.join(' · ') })}</span><span class="muted">{U.seeMissing} →</span></button>
      )}
      <button class="link ans-sim" onClick={goSim}>{Glyph.compare} {U.simOther}</button>
    </div>
  );
}

/** Botão principal com menu: a pessoa escolhe o que copiar; Esc ou clique fora fecham. */
export function CopyMenu({ items }: { items: [string, () => void][] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', out);
    addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out); removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div class={`copymenu ${open ? 'open' : ''}`} ref={box}>
      <button class="btn primary big full" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{Glyph.copy} {U.copyTicket} <span class="cv">{Glyph.chevron}</span></button>
      {open && (
        <div class="cm-list" role="menu">
          {items.map(([label, run]) => <button role="menuitem" onClick={() => { setOpen(false); run(); }}>{label}</button>)}
        </div>
      )}
    </div>
  );
}
