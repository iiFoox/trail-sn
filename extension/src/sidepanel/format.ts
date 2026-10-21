/**
 * Formatação compartilhada pelo painel e pelo relatório: nomes de campo, horários no fuso de quem lê,
 * valores do formulário e as frases curtas das provas. Sem componentes aqui (evita importações circulares).
 */
import type { Change, Evidence, Investigation, TraceItem } from '@trail/core';
import { fmt, t } from '../shared/i18n';
import { getPrefs } from '../shared/prefs';

export const lang = getPrefs().lang;
const s = t(lang);
const P = s.p;

/** Link para o passo na instância: o registro pelo sys_id ou a lista já filtrada. */
export function refLink(origin: string, ref: { table: string; sysId?: string; query?: string }): string {
  return ref.sysId ? `${origin}/${ref.table}.do?sys_id=${ref.sysId}` : `${origin}/${ref.table}_list.do?sysparm_query=${encodeURIComponent(ref.query ?? '')}`;
}

export function humanField(f: string): string {
  const x = f.replace(/_id$/, '').replace(/_/g, ' ');
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** O nome do campo como no formulário (business_service → Service); sem acesso ao dicionário, o técnico arrumado. */
export function fieldName(r: Investigation): string {
  return r.fieldLabel || humanField(r.target.field);
}

export function parts(utc: string): { date: string; time: string; full: string; rel: string } {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return { date: utc, time: '', full: utc, rel: '' };
  const loc = lang === 'en' ? 'en-US' : 'pt-BR';
  const date = d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const sec = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(new Date()) - day(d);
  return { date, time, full: sec, rel: diff === 0 ? P.today : diff === 1 ? P.yesterday : '' };
}

export function when(utc: string): string {
  const p = parts(utc);
  return fmt(P.at, { date: p.date, time: p.time }) + (p.rel ? ` · ${p.rel}` : '');
}

export function valueLabel(r: Investigation, v: string): string {
  if (!v) return P.empty;
  const l = r.labels?.[v] ?? v;
  return l.length > 70 ? l.slice(0, 67) + '…' : l;
}

export const plural = (forms: string[], n: number) => fmt(forms[n === 1 ? 0 : 1] ?? forms[0]!, { n });
export const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** Segundos em texto curto ("1,8 s" / "1.8 s"). */
export function secs(ms: number): string {
  if (ms < 100) return `${Math.round(ms)} ms`;
  const x = (ms / 1000).toFixed(ms >= 10_000 ? 0 : 1);
  return `${lang === 'pt' ? x.replace('.', ',') : x} s`;
}

/** O motor escreve horários em UTC; o painel mostra tudo no fuso de quem lê. */
export function localizeTimes(text: string, dayUtc: string): string {
  const out = text.replace(/(\d{4}-\d{2}-\d{2} )?\b(\d{2}:\d{2}:\d{2})\b/g, (m, d: string | undefined, h: string) => {
    if (d) { const p = parts(d + h); return `${p.date} ${p.full}`; }
    return dayUtc ? parts(`${dayUtc} ${h}`).full : m;
  });
  return out.charAt(0).toUpperCase() + out.slice(1); // todo texto exibido começa com maiúscula
}

export function factText(kind: string, field: string): string {
  return fmt(P.fact[kind] ?? kind, { field });
}

export function traceTitle(r: Investigation, c: Change, it: TraceItem, field: string): string {
  const key = it.kind === 'form' && it.label === 'Workspace' ? 'formWs' : it.kind;
  return fmt((P.tr as Record<string, string>)[key] ?? it.kind, { user: it.user ?? '', label: it.label, field, old: valueLabel(r, c.oldValue), new: valueLabel(r, c.newValue) });
}

/**
 * Por que este candidato perdeu, numa frase: o fato que mais pesou contra ele; sem fato contra, a primeira lacuna
 * ("o formulário que ele salvou às 22:37:01 enviou In Progress, não Resolved"); só por último "tem menos provas".
 */
export function lossReason(e: Evidence, field: string, day = ''): string {
  const neg = e.facts.filter((f) => f.points < 0).sort((a, b) => a.points - b.points)[0];
  if (neg) return factText(neg.kind, field);
  if (e.gaps[0]) return localizeTimes(e.gaps[0], day);
  return P.weaker;
}

/** Retenção padrão das fontes de rastro (sys_auto_flush): o que sustenta a resposta some depois disso. */
const RETENTION_DAYS: Record<string, number> = { sysevent: 7, sys_flow_context: 14, syslog_transaction: 56 };
/** Dias até a prova principal desta mudança expirar (só quando faltam menos de 30); null = não se aplica. */
export function traceDaysLeft(c: Change): number | null {
  const top = c.evidence[0];
  if (!top) return null;
  const days = top.facts.map((f) => RETENTION_DAYS[f.source]).filter((x): x is number => !!x);
  if (!days.length) return null;
  const age = (Date.now() - Date.parse(c.at.replace(' ', 'T') + 'Z')) / 864e5;
  const left = Math.floor(Math.min(...days) - age);
  return left >= 0 && left < 30 ? left : null;
}

/** Regras ativas que gravam este campo com valores diferentes e podem rodar juntas. */
export function conflictLines(r: Investigation): { a: string; b: string; win: string; overlap: string; aLink?: string; bLink?: string }[] {
  // Rótulos de valor só valem para o campo investigado (na varredura da tabela os campos são outros).
  const rule = (x: NonNullable<Investigation['conflicts']>[number]['a'], field: string) => { const v = x.values[0] ?? ''; return fmt(P.cfRule, { name: x.name, kind: s.type[x.kind] ?? x.kind, order: x.kind === 'br_before' ? fmt(P.cfOrder, { n: x.order }) : '', value: (field === r.target.field ? valueLabel(r, v) : v) || P.empty }); };
  return (r.conflicts ?? []).map((k) => ({
    a: rule(k.a, k.field), b: rule(k.b, k.field), overlap: P.cfOverlap[k.overlap] ?? k.overlap,
    win: k.winner ? fmt(P.cfWins, { name: (k.winner === 'a' ? k.a : k.b).name, why: P.cfWhy[k.why ?? ''] ?? '' }) : P.cfNoWinner,
  }));
}

/** Nome curto de uma instância para os textos (sua-empresa.service-now.com → sua-empresa). */
export function instanceLabel(origin: string): string {
  return origin.replace(/^https?:\/\//, '').split('.')[0] ?? origin;
}

/** Parâmetros da demonstração (só valem com ?demo=1). */
const demoParams = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const isDemo = demoParams.has('demo');
export const demoParam = (k: string): string | null => (isDemo ? demoParams.get(k) : null);
