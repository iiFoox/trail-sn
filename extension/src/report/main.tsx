import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Evidence, Investigation, Timeline } from '@trail/core';
import '../shared/ui.css';
import './report.css';
import { getPrefs } from '../shared/prefs';
import { t } from '../shared/i18n';
import { TrailMark, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { send } from '../shared/messages';
import { diffLines, looksLong } from '../shared/diff';
import { DiffView } from '../shared/DiffView';
import { conflictLines, factText, humanField, localizeTimes, traceTitle, valueLabel, when } from '../sidepanel/Result';
import { plainSummary } from '../sidepanel/export';

document.documentElement.dataset.theme = 'light'; // papel é sempre claro
const s = t(getPrefs().lang);
const P = s.p;
const locale = getPrefs().lang === 'en' ? 'en-US' : 'pt-BR';
type Payload = { r: Investigation; sel: number; origin: string };

const gradeClass = (g: string) => (g === 'confirmed' ? 'hi' : g === 'probable' ? 'md' : 'lo');

/** Por que o candidato perdeu: o fato negativo mais forte, com o detalhe, ou "pontuação menor". */
function whyLost(e: Evidence, field: string, day: string): string {
  const neg = [...e.facts].filter((f) => f.points < 0).sort((a, b) => a.points - b.points)[0];
  if (!neg) return P.rpNoLoss;
  return `${factText(neg.kind, field)} ${localizeTimes(neg.detail, day)}`.trim();
}

/** Relatório para imprimir ou salvar em PDF: capa, veredito, linha do tempo, provas, diferença, descartados e histórico. */
function Report() {
  const [d, setD] = useState<Payload>();
  const [tl, setTl] = useState<Timeline | null>(null);
  useEffect(() => {
    const k = new URLSearchParams(location.search).get('k') ?? '';
    void chrome.storage.session.get(k).then(async (o) => {
      const p = o[k] as Payload | undefined;
      setD(p);
      if (!p) return;
      document.title = `Trail · ${p.r.target.display} · ${humanField(p.r.target.field)}`;
      // Histórico do registro: tenta por alguns segundos; se não vier, o relatório sai sem ele.
      const hist = await Promise.race([
        send<Timeline & { error?: string }>({ type: 'timeline', origin: p.origin, target: { table: p.r.target.table, sysId: p.r.target.sysId } }).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 7000)),
      ]);
      if (hist && !(hist as { error?: string }).error && Array.isArray(hist.saves)) setTl(hist);
      setTimeout(() => window.print(), 700);
    });
  }, []);
  useEffect(() => {
    if (!d) return;
    // Rodapé em toda página (caixas de margem do @page): registro, campo, página x de y e data.
    const st = document.createElement('style');
    const q = (x: string) => JSON.stringify(x);
    st.textContent = `@page { @bottom-left { content: ${q(`Trail · ${d.r.target.display} · ${humanField(d.r.target.field)}`)}; } @bottom-right { content: ${q(P.rpPage + ' ')} counter(page) ${q(' ' + P.rpOf + ' ')} counter(pages); } @bottom-center { content: ${q(new URL(d.origin).host)}; } }`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [d]);

  if (!d) return <main class="rpt">…</main>;
  const { r, origin } = d;
  const c = r.changes[d.sel] ?? r.changes[0]!;
  const field = humanField(r.target.field);
  const top = c.evidence[0];
  const day = c.at.slice(0, 10);
  const generated = new Date().toLocaleString(locale);
  const long = looksLong(c.oldValue, c.newValue);
  const dstat = diffLines(c.oldValue, c.newValue);
  const pct = top ? Math.max(4, Math.min(100, top.score)) : 0;
  const discarded = c.evidence.slice(1, 7);
  const saves = tl?.saves.slice(0, 15) ?? [];

  return (
    <main class="rpt">
      <div class="toolbar noprint"><button class="btn primary" onClick={() => window.print()}>{P.rpPrint}</button></div>

      {/* Capa */}
      <header class="cover">
        <div class="brand"><span class="mark"><TrailMark /></span><span>Trail</span></div>
        <div class="kicker">{P.rpCover}</div>
        <h1><a href={recordLink(origin, r.target.table, r.target.sysId)}>{r.target.display}</a></h1>
        {r.target.title && <div class="ttl">{r.target.title}</div>}
        <dl class="meta">
          <div><dt>{P.rpField}</dt><dd>{field} <code>{r.target.field}</code></dd></div>
          <div><dt>{P.rpRecord}</dt><dd><code>{r.target.table}</code></dd></div>
          <div><dt>{P.rpInstance}</dt><dd>{new URL(origin).host}</dd></div>
          <div><dt>{P.rpGenerated}</dt><dd>{generated}</dd></div>
        </dl>
      </header>

      {/* Veredito */}
      <section class="vd">
        <div class="vchg">
          <span class="lbl">{P.rpChange}</span>
          {long
            ? <div class="vvals small"><span class="dstat"><b class="add">+{dstat.added}</b> <b class="del">−{dstat.removed}</b> {P.diffLines}</span><div class="sub">{P.rpDiff} ↓</div></div>
            : <div class="vvals"><s>{valueLabel(r, c.oldValue) || P.tlEmptyValue}</s><span class="arr">→</span><b>{valueLabel(r, c.newValue) || P.tlEmptyValue}</b></div>}
          <div class="sub">{P.rpWhen}: {when(c.at)} · {P.rpBy}: {c.user}</div>
        </div>
        {top ? (
          <div class="vwho">
            <span class="lbl">{P.rpVerdict}</span>
            <div class="row"><span class="ic">{typeGlyph[top.type]}</span>
              <div class="grow"><b>{top.artifact.name}</b><div class="sub">{s.type[top.type]}</div>
                {top.artifact.sysId && top.artifact.table && <a class="lnk" href={recordLink(origin, top.artifact.table, top.artifact.sysId)}>{P.rpOpen} ↗</a>}</div>
            </div>
            <div class={`gauge ${gradeClass(top.grade)}`}>
              <div class="track"><i style={`width:${pct}%`} /><span class="t70" /><span class="t40" /></div>
              <div class="glbl"><b>{P.certainty[top.grade]}</b><span>{top.score} {P.rpPoints}</span></div>
            </div>
          </div>
        ) : <div class="vwho"><b>{P.noCause}</b></div>}
      </section>

      <p class="plainline"><b>{P.plainLbl}:</b> {plainSummary(r, c)}</p>

      {/* Linha do tempo desenhada */}
      {c.trace?.length > 0 && (
        <section class="blk">
          <h2>{P.rpTimeline}</h2>
          <ol class="tline">
            {c.trace.map((it) => (
              <li class={`${it.cause ? 'cause' : ''} ${it.kind === 'change' ? 'chg' : ''}`}>
                <time>{localizeTimes(it.at, '')}</time>
                <span class="dot" />
                <div><b>{it.kind === 'write' ? P.otherWrite : traceTitle(r, c, it, field)}</b>{it.user && <span class="sub"> · {it.user}</span>}{it.cause && <span class="tag">{P.rpCause}</span>}</div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Provas */}
      {top && (
        <section class="blk">
          <h2>{P.rpEvidence}</h2>
          <table class="ev">
            <thead><tr><th>{P.rpFact}</th><th>{P.rpDetail}</th><th>{P.rpSource}</th><th class="n">{P.rpPts}</th></tr></thead>
            <tbody>
              {top.facts.map((f) => (
                <tr class={f.points >= 0 ? 'ok' : 'no'}>
                  <td><span class="mk">{f.points >= 0 ? '✓' : '✗'}</span>{factText(f.kind, field)}</td>
                  <td>{localizeTimes(f.detail, day)}</td>
                  <td><code>{f.source}</code></td>
                  <td class="n">{f.points > 0 ? `+${f.points}` : f.points}</td>
                </tr>
              ))}
              <tr class="tot"><td colSpan={3}>{P.certainty[top.grade]}</td><td class="n">{top.score}</td></tr>
            </tbody>
          </table>
          {top.gaps.length > 0 && <div class="gaps"><b>{P.rpGaps}</b><ul>{top.gaps.map((g) => <li>{localizeTimes(g, day)}</li>)}</ul></div>}
        </section>
      )}

      {/* Diferença do texto / script */}
      {long && (
        <section class="blk diffblk">
          <h2>{P.rpDiff}</h2>
          <DiffView oldText={c.oldValue} newText={c.newValue} labels={{ onlyChanges: P.diffOnly, whole: P.diffWhole, same: P.diffSame, added: P.diffAdded, removed: P.diffRemoved, before: P.diffBefore, after: P.diffAfter }} />
        </section>
      )}

      {/* Descartados */}
      {discarded.length > 0 && (
        <section class="blk">
          <h2>{P.rpDiscarded}</h2>
          <table class="ev disc">
            <thead><tr><th>{P.rpVerdict}</th><th>{P.rpWhyLost}</th><th class="n">{P.rpPts}</th></tr></thead>
            <tbody>{discarded.map((e) => (
              <tr><td><b>{e.artifact.name}</b><div class="sub">{s.type[e.type]}</div></td><td>{whyLost(e, field, day)}{e.gaps[0] ? <div class="sub">{localizeTimes(e.gaps[0], day)}</div> : null}</td><td class="n">{e.score}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {(r.conflicts?.length ?? 0) > 0 && (
        <section class="blk">
          <h2>{P.cfTitle}</h2>
          <p class="sub">{P.cfHint}</p>
          <table class="ev"><tbody>{conflictLines(r).map((k) => <tr><td>{k.a}<br />{k.b}</td><td>{k.overlap}<div class="sub">{k.win}</div></td></tr>)}</tbody></table>
        </section>
      )}

      {/* Lacunas da investigação */}
      {(r.gaps.length > 0 || c.notes.length > 0) && (
        <section class="blk"><h2>{P.rpDenied}</h2><ul class="plain">{[...r.gaps, ...c.notes].map((g) => <li><code>{g}</code></li>)}</ul></section>
      )}

      {/* Histórico do campo */}
      {r.changes.length > 1 && (
        <section class="blk">
          <h2>{P.rpFieldHistory}</h2>
          <table class="ev">
            <tbody>{r.changes.map((ch, i) => (
              <tr class={i === d.sel ? 'sel' : ''}><td class="nw">{when(ch.at)}</td><td>{valueLabel(r, ch.oldValue) || P.tlEmptyValue} → <b>{valueLabel(r, ch.newValue) || P.tlEmptyValue}</b></td>
                <td>{ch.evidence[0] ? <>{ch.evidence[0].artifact.name} <span class={`pill ${gradeClass(ch.evidence[0].grade)}`}>{P.certainty[ch.evidence[0].grade]}</span></> : '—'}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {/* Histórico do registro (últimas gravações) */}
      {saves.length > 0 && (
        <section class="blk">
          <h2>{P.rpRecordHistory}</h2>
          <table class="ev">
            <tbody>{saves.map((sv) => (
              <tr><td class="nw">{when(sv.at)}</td><td>{sv.user}<div class="sub">{P.via[sv.via] ?? sv.via}{sv.detail ? ` · ${sv.detail}` : ''}</div></td>
                <td>{sv.fields.slice(0, 6).map((f) => <div><b>{f.label}</b>: {f.journal ? '…' : <>{f.oldDisplay || P.tlEmptyValue} → {f.newDisplay || P.tlEmptyValue}</>}</div>)}{sv.fields.length > 6 ? <div class="sub">+{sv.fields.length - 6}</div> : null}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <section class="blk method">
        <h2>{P.rpMethod}</h2>
        <p>{P.rpMethodText}</p>
        <p class="sub">{P.rpFooter.replace('{when}', generated)}</p>
      </section>
    </main>
  );
}
render(<Report />, document.getElementById('app')!);

