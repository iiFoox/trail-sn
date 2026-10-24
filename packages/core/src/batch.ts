/**
 * Investigação em lote: o mesmo campo em vários registros (selecionados numa lista).
 * Cada registro é investigado normalmente; aqui só se resume a causa da mudança mais recente de cada um
 * e se monta o CSV. O motor de cada investigação é o mesmo (e compartilha o cache de metadados da tabela).
 */
import type { Investigation } from './types';

export interface BatchItem {
  sysId: string;
  /** No modo "registro inteiro": o campo investigado (cada item é um campo do mesmo registro). */
  field?: string;
  display: string;
  title?: string;
  status: 'pending' | 'done' | 'error' | 'unchanged' | 'unaudited';
  error?: string;
  at?: string;
  oldValue?: string;
  newValue?: string;
  user?: string;
  /** Rótulo do campo (modo registro inteiro). */
  label?: string;
  /** Valores como aparecem no formulário (choice ou nome do registro referenciado). */
  oldDisplay?: string;
  newDisplay?: string;
  /** Tabela referenciada pelo campo: os valores viram links. */
  refTable?: string;
  cause?: { type: string; name: string; grade: string; score: number; sysId?: string; table?: string };
  /** Quantas vezes o campo mudou no período lido. */
  changes?: number;
}

export interface BatchGroup { key: string; type: string; name: string; sysId?: string; table?: string; count: number; items: string[]; grades: Record<string, number> }

/** Resume uma investigação no item do lote (a mudança mais recente do campo). */
export function batchItemFrom(r: Investigation): BatchItem {
  const c = r.changes[0];
  const base = { sysId: r.target.sysId, display: r.target.display, ...(r.target.title ? { title: r.target.title } : {}), ...(r.fieldLabel ? { label: r.fieldLabel } : {}), ...(r.refTable ? { refTable: r.refTable } : {}) };
  if (!c) return { ...base, status: r.unaudited ? 'unaudited' : 'unchanged', changes: 0 };
  const top = c.evidence[0];
  return {
    ...base, status: 'done', at: c.at, oldValue: c.oldValue, newValue: c.newValue, oldDisplay: c.oldValue ? r.labels[c.oldValue] ?? c.oldValue : '', newDisplay: c.newValue ? r.labels[c.newValue] ?? c.newValue : '', user: c.user, changes: r.changes.length,
    ...(top ? { cause: { type: top.type, name: top.artifact.name, grade: top.grade, score: top.score, ...(top.artifact.sysId ? { sysId: top.artifact.sysId } : {}), ...(top.artifact.table ? { table: top.artifact.table } : {}) } } : {}),
  };
}

/**
 * Agrupa por causa. Pessoas pelo formulário ou pela API viram um grupo por tipo ("pessoas"), não um por usuário,
 * para o resumo responder "quantos foram regra X, quantos foram pessoas".
 */
export function groupBatch(items: BatchItem[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const it of items) {
    if (it.status !== 'done') continue;
    const type = it.cause?.type ?? 'unknown';
    const person = type === 'user_action';
    const key = person ? 'user_action' : `${type}|${it.cause?.name ?? '?'}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, type, name: person ? '' : it.cause?.name ?? '?', ...(!person && it.cause?.sysId ? { sysId: it.cause.sysId } : {}), ...(!person && it.cause?.table ? { table: it.cause.table } : {}), count: 0, items: [], grades: {} }));
    g.count++;
    g.items.push(it.field ?? it.sysId); // no modo registro inteiro, o item é o campo
    const grade = it.cause?.grade ?? 'none';
    g.grades[grade] = (g.grades[grade] ?? 0) + 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count); // empate: ordem em que apareceram
}

const csvCell = (v: string | number | undefined) => {
  // Texto da instância começando com = + - @ vira fórmula no Excel: vai como texto.
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (separador ;, para abrir direto no Excel em português). */
export function batchCsv(items: BatchItem[], header: string[] = ['registro', 'sys_id', 'titulo', 'quando (UTC)', 'antes', 'depois', 'usuario', 'causa', 'tipo', 'certeza', 'pontos', 'mudancas', 'situacao']): string {
  const rows = items.map((i) => [i.field ? `${i.display} · ${i.label ?? i.field}` : i.display, i.sysId, i.title, i.at, i.oldDisplay ?? i.oldValue, i.newDisplay ?? i.newValue, i.user, i.cause?.name, i.cause?.type, i.cause?.grade, i.cause?.score, i.changes, i.status === 'error' ? `erro: ${i.error ?? ''}` : i.status]);
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n') + '\n';
}
