import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Investigation } from '@trail/core';
import '../shared/ui.css';
import { getPrefs } from '../shared/prefs';
import { t } from '../shared/i18n';
import { TrailMark, typeGlyph } from '../shared/icons';
import { recordLink } from '../shared/instances';
import { factText, humanField, localizeTimes, traceTitle, valueLabel, when } from '../sidepanel/Result';

document.documentElement.dataset.theme = 'light'; // papel é sempre claro
const s = t(getPrefs().lang);
const P = s.p;
type Payload = { r: Investigation; sel: number; origin: string };

/** Relatório imprimível (Salvar como PDF): o mesmo conteúdo do painel, numa página de papel. */
function Report() {
  const [d, setD] = useState<Payload>();
  useEffect(() => {
    const k = new URLSearchParams(location.search).get('k') ?? '';
    void chrome.storage.session.get(k).then((o) => {
      const p = o[k] as Payload | undefined;
      setD(p);
      if (p) { document.title = `Trail · ${p.r.target.display} · ${humanField(p.r.target.field)}`; setTimeout(() => window.print(), 600); }
    });
  }, []);
  if (!d) return <main class="paper">…</main>;
  const { r, origin } = d;
  const c = r.changes[d.sel] ?? r.changes[0]!;
  const field = humanField(r.target.field);
  const top = c.evidence[0];
  const day = c.at.slice(0, 10);
  return (
    <main class="paper">
      <header class="ph"><span class="mark"><TrailMark /></span><div><b>{P.rpTitle}</b><div class="muted">{new Date().toLocaleString(getPrefs().lang === 'en' ? 'en-US' : 'pt-BR')}</div></div>
        <button class="btn primary noprint" onClick={() => window.print()}>{P.rpPrint}</button></header>
      <section class="pcard">
        <div class="muted">{r.target.table}</div>
        <h1><a href={recordLink(origin, r.target.table, r.target.sysId)}>{r.target.display}</a>{r.target.title && <span> · {r.target.title}</span>}</h1>
        <div class="pchg"><span class="fld">{field}</span> <s>{valueLabel(r, c.oldValue) || P.tlEmptyValue}</s> → <b>{valueLabel(r, c.newValue) || P.tlEmptyValue}</b></div>
        <div class="muted">{when(c.at)} · {c.user}</div>
      </section>
      {top && (
        <section class="pcard">
          <h2>{P.rpWho}</h2>
          <div class="pwho"><span class="ic">{typeGlyph[top.type]}</span><div><b>{top.artifact.name}</b><div class="muted">{s.type[top.type]}</div></div>
            <span class={`pgrade ${top.grade}`}>{P.certainty[top.grade]} · {top.score}</span></div>
          <h3>{P.rpProofs}</h3>
          <ul class="pl">{top.facts.map((f) => <li class={f.points >= 0 ? 'ok' : 'no'}><b>{factText(f.kind, field)}</b><span>{localizeTimes(f.detail, day)}</span><i>{P.srcName[f.source] ?? f.source}</i></li>)}</ul>
          {top.gaps.length > 0 && <><h3>{P.rpGaps}</h3><ul class="pl">{top.gaps.map((g) => <li class="gap"><span>{localizeTimes(g, day)}</span></li>)}</ul></>}
        </section>
      )}
      {c.evidence.length > 1 && <section class="pcard"><h2>{P.rpAlts}</h2><ul class="pl">{c.evidence.slice(1, 5).map((e) => <li><b>{e.artifact.name}</b><span>{s.type[e.type]} · {P.likelihood[e.grade]}</span></li>)}</ul></section>}
      {c.trace?.length > 0 && (
        <section class="pcard"><h2>{P.rpTrace}</h2>
          <table class="ptr">{c.trace.map((it) => <tr class={it.cause ? 'cause' : ''}><td>{localizeTimes(it.at, '')}</td><td>{it.kind === 'write' ? P.otherWrite : traceTitle(r, c, it, field)}</td><td>{it.cause ? P.cause : ''}</td></tr>)}</table>
        </section>
      )}
      <footer class="muted">{P.rpFooter.replace('{when}', new Date().toLocaleString(getPrefs().lang === 'en' ? 'en-US' : 'pt-BR'))}</footer>
    </main>
  );
}
render(<Report />, document.getElementById('app')!);
