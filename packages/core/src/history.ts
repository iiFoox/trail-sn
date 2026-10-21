import type { HistoryResult } from './client/RestClient';
import type { Row } from './types';

type Quiet = (table: string, query: string, fields: string[], limit?: number) => Promise<Row[]>;

/**
 * Histórico do formulário → linhas no formato de sys_audit, para o resto do motor não mudar.
 * - Valores de lista voltam ao valor interno pelo sys_choice ("1 - High" → "1"); o resto fica como o formulário mostra.
 * - Usuário: user_name lido de sys_user pelo user_id (quem não é admin costuma ler sys_user).
 * - Cada gravação vira um checkpoint, em ordem de tempo.
 */
export async function historyToAudit(h: HistoryResult, tables: string[], quiet: Quiet): Promise<Row[]> {
  const fields = unique(h.entries.flatMap((e) => e.changes.map((c) => c.field)));
  const userIds = unique(h.entries.map((e) => e.userId ?? '').filter(Boolean));
  const [choices, users] = await Promise.all([
    fields.length && !h.choices ? quiet('sys_choice', `nameIN${tables.join(',')}^elementIN${fields.join(',')}^inactive=false`, ['name', 'element', 'value', 'label'], 500) : Promise.resolve([] as Row[]),
    userIds.length ? quiet('sys_user', `sys_idIN${userIds.join(',')}`, ['sys_id', 'user_name'], 50) : Promise.resolve([] as Row[]),
  ]);
  // A tabela mais específica da hierarquia ganha (incident antes de task).
  const rank = (t?: string) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const toValue: Record<string, Record<string, string>> = {};
  for (const c of [...choices].sort((a, b) => rank(b.name) - rank(a.name))) (toValue[c.element ?? ''] ??= {})[c.label ?? ''] = c.value ?? '';
  // As opções do formulário (ui/meta) valem mais: é o que a pessoa vê, e quem não é admin nem sempre lê sys_choice.
  for (const [field, map] of Object.entries(h.choices ?? {})) toValue[field] = { ...toValue[field], ...map };
  const userName: Record<string, string> = Object.fromEntries(users.map((u) => [u.sys_id ?? '', u.user_name ?? '']));
  const raw = (field: string, v: string) => (v && toValue[field]?.[v] !== undefined ? toValue[field][v] : v);
  return h.entries.flatMap((e, i) => e.changes.map((c): Row => ({
    sys_id: `history-${i}-${c.field}`,
    fieldname: c.field,
    oldvalue: raw(c.field, c.oldValue),
    newvalue: raw(c.field, c.newValue),
    user: userName[e.userId ?? ''] || e.userName || '',
    sys_created_on: e.at,
    record_checkpoint: String(i + 1),
  })));
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
