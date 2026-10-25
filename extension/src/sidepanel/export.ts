import type { Change, Investigation } from '@trail/core';
import { fmt, t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';
import { recordLink } from '../shared/instances';
import { factText, fieldName, localizeTimes, parts, traceTitle, valueLabel, when } from './Result';
import { looksLong } from '../shared/diff';
import { handoff } from '../shared/handoff';

const s = t(getPrefs().lang);
const P = s.p;
const isDemo = new URLSearchParams(location.search).has('demo');

const PLAIN: Record<string, string> = {
  user_action: 'form', br_before: 'rule', br_after: 'rule', br_async: 'rule', br_via_script_include: 'rule', script_action: 'rule', assignment_rule: 'rule', data_lookup: 'rule', server_change: 'rule',
  client_script: 'client', ui_policy: 'client', ui_action: 'ui', scheduled_job: 'job', flow: 'flow', workflow: 'flow', import_set: 'import', background_script: 'script', unknown_background: 'unknown',
};

/** Uma frase sem termos técnicos sobre a mudança, para o usuário final (colar no chamado). */
export function plainSummary(r: Investigation, c: Change): string {
  const top = c.evidence[0];
  const L = P.plain;
  const field = fieldName(r);
  const p = parts(c.at);
  const show = (v: string) => (valueLabel(r, v) || L.empty).replace(/\s+/g, ' ').trim();
  const chg = looksLong(c.oldValue, c.newValue) || show(c.oldValue).length > 60 || show(c.newValue).length > 60 ? L.chgText : fmt(L.chg, { old: show(c.oldValue), new: show(c.newValue) });
  let key = top ? PLAIN[top.type] ?? 'unknown' : 'unknown';
  if (top?.type === 'user_action' && top.facts.some((f) => f.kind === 'integration_user' || /\/api\//.test(f.detail))) key = 'api';
  if (key === 'rule' && (c.user === 'system' || top?.type === 'br_async' && c.user === 'system')) key = 'ruleSystem';
  const q = top ? L.q[top.grade] ?? '' : '';
  const out = fmt((L as unknown as Record<string, string>)[key] ?? L.unknown, { q, field, chg, when: fmt(P.at, { date: p.date, time: p.time }), user: c.user || '?', name: top?.artifact.name ?? '' });
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Relatório completo em texto puro, para colar no chamado: resposta, provas, lacunas, alternativas e rastro. */
export function fullReport(r: Investigation, c: Change, origin: string): string {
  const field = fieldName(r);
  const top = c.evidence[0];
  const day = c.at.slice(0, 10);
  const L: string[] = [];
  L.push(`${P.rpTitle} — ${r.target.display}${r.target.title ? ` · ${r.target.title}` : ''}`);
  L.push(recordLink(origin, r.target.table, r.target.sysId));
  L.push('');
  L.push(`${P.plainLbl}: ${plainSummary(r, c)}`);
  L.push('');
  L.push(`${P.rpField}: ${field}`);
  L.push(`${P.rpChange}: ${valueLabel(r, c.oldValue) || P.tlEmptyValue} → ${valueLabel(r, c.newValue) || P.tlEmptyValue} · ${when(c.at)} · ${c.user}`);
  L.push('');
  if (top) {
    L.push(`${P.rpWho}: ${top.artifact.name} (${s.type[top.type]})`);
    L.push(`${P.rpCert}: ${P.certainty[top.grade]} · ${top.score} ${P.rpPoints}`);
    if (top.artifact.sysId && top.artifact.table) L.push(recordLink(origin, top.artifact.table, top.artifact.sysId));
    L.push('');
    L.push(`${P.rpProofs}:`);
    for (const f of top.facts) L.push(`  ${f.points >= 0 ? '✓' : '✗'} ${factText(f.kind, field)} — ${localizeTimes(f.detail, day)} [${P.srcName[f.source] ?? f.source}]`);
    if (top.gaps.length) { L.push(''); L.push(`${P.rpGaps}:`); for (const g of top.gaps) L.push(`  ! ${localizeTimes(g, day)}`); }
  } else L.push(P.noCause);
  const alts = c.evidence.slice(1, 4);
  if (alts.length) { L.push(''); L.push(`${P.rpAlts}:`); for (const e of alts) L.push(`  - ${e.artifact.name} (${s.type[e.type]}) · ${P.likelihood[e.grade]}`); }
  if (c.trace?.length) {
    L.push(''); L.push(`${P.rpTrace}:`);
    for (const it of c.trace) L.push(`  ${localizeTimes(it.at, '')}  ${it.kind === 'write' ? P.otherWrite : traceTitle(r, c, it, field)}${it.cause ? `  ← ${P.cause}` : ''}`);
  }
  if (r.gaps.length) { L.push(''); L.push(`${P.rpDenied}: ${r.gaps.join(', ')}`); }
  L.push('');
  L.push(fmt(P.rpFooter, { when: new Date().toLocaleString(getPrefs().lang === 'en' ? 'en-US' : 'pt-BR') }));
  return L.join('\n');
}

/** Abre a página de relatório numa janela; ela renderiza e chama a impressão (Salvar como PDF). */
export async function savePdf(r: Investigation, sel: number, origin: string, demo: () => void): Promise<void> {
  if (isDemo) { demo(); return; }
  const key = await handoff('report', { r, sel, origin });
  await chrome.windows.create({ url: chrome.runtime.getURL(`src/report/index.html?k=${encodeURIComponent(key)}`), type: 'popup', width: 900, height: 900 });
}
