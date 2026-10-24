import type { HistoryChange, HistoryEntry, HistoryResult } from './client/RestClient';
import type { Row } from './types';

type Quiet = (table: string, query: string, fields: string[], limit?: number) => Promise<Row[]>;

/**
 * Histórico do formulário → linhas no formato de sys_audit, para o resto do motor não mudar.
 * Ajustes medidos na bateria de 2000 (admin x itil), para o resultado bater com a auditoria:
 * - Valores de lista voltam ao valor interno pelas opções do formulário (ui/meta) ou pelo sys_choice ("1 - High" → "1").
 * - Referências: o histórico mostra o nome ("Beth Anglin"); volta ao sys_id quando o nome acha um registro só.
 * - Datas e horas: o histórico mostra no fuso de quem está logado; voltam para UTC, como na auditoria.
 * - Usuário: user_name pelo user_id em sys_user; sem user_id, "System" é o usuário system.
 * - A gravação da criação do registro fica de fora: a auditoria não registra inserção (e o admin não a vê).
 * - Cada gravação vira um checkpoint, em ordem de tempo.
 */
export async function historyToAudit(h: HistoryResult, tables: string[], quiet: Quiet, createdOn?: string): Promise<Row[]> {
  const created = createdOn ? toMs(createdOn) : NaN;
  const entries = h.entries.filter((e) => !(Math.abs(toMs(e.at) - created) <= 2000 && e.changes.every((c) => !c.oldValue)));
  const fields = unique(entries.flatMap((e) => e.changes.map((c) => c.field)));
  const userIds = unique(entries.map((e) => e.userId ?? '').filter(Boolean));
  // Nomes exibidos em campos de referência, por tabela referenciada (no máximo 20 por tabela).
  const refNames: Record<string, string[]> = {};
  // Campo de exibição da tabela referenciada, pelo ui/meta. Sem ele não se chuta name/number: na instância, filtro com
  // campo inexistente é ignorado e a consulta devolve linhas quaisquer da tabela (medido no PDI em 23/10/2026).
  const refShown: Record<string, string> = {};
  for (const e of entries) for (const c of e.changes) {
    const ref = h.refs?.[c.field];
    if (!ref) continue;
    const shown = h.refDisplay?.[c.field];
    if (h.refDisplay && !shown) continue;
    if (shown && !refShown[ref]) refShown[ref] = shown;
    for (const v of [c.oldValue, c.newValue]) {
      const list = (refNames[ref] ??= []);
      if (v && !SYS_ID.test(v) && list.length < 20 && !list.includes(v)) list.push(v);
    }
  }
  const [choices, users, refRows] = await Promise.all([
    fields.length && !h.choices ? quiet('sys_choice', `nameIN${tables.join(',')}^elementIN${fields.join(',')}^inactive=false`, ['name', 'element', 'value', 'label'], 500) : Promise.resolve([] as Row[]),
    userIds.length ? quiet('sys_user', `sys_idIN${userIds.join(',')}`, ['sys_id', 'user_name'], 50) : Promise.resolve([] as Row[]),
    Promise.all(Object.entries(refNames).map(async ([table, names]) => {
      // Pelo campo de exibição do ui/meta; sem ui/meta (cliente de teste), tenta os mais comuns.
      // Nome com vírgula ou ^ mudaria o filtro (a vírgula separa a lista): fica de fora.
      const safe = names.filter((n) => !/[,^\r\n]/.test(n));
      if (!safe.length) return { table, rows: [] as { sys_id: string; name: string }[] };
      for (const field of refShown[table] ? [refShown[table]!] : ['name', 'number', 'display_name']) {
        const rows = await quiet(table, `${field}IN${safe.join(',')}`, ['sys_id', field], 60);
        if (rows.length) return { table, rows: rows.map((r) => ({ sys_id: r.sys_id ?? '', name: r[field] ?? '' })) };
      }
      return { table, rows: [] as { sys_id: string; name: string }[] };
    })),
  ]);
  // A tabela mais específica da hierarquia ganha (incident antes de task).
  const rank = (t?: string) => { const i = tables.indexOf(t ?? ''); return i < 0 ? 99 : i; };
  const toValue: Record<string, Record<string, string>> = {};
  for (const c of [...choices].sort((a, b) => rank(b.name) - rank(a.name))) (toValue[c.element ?? ''] ??= {})[c.label ?? ''] = c.value ?? '';
  // As opções do formulário (ui/meta) valem mais: é o que a pessoa vê, e quem não é admin nem sempre lê sys_choice.
  for (const [field, map] of Object.entries(h.choices ?? {})) toValue[field] = { ...toValue[field], ...map };
  // Nome → sys_id só quando o nome acha um registro só (dois "João Silva" ficam como estão).
  const byName: Record<string, Record<string, string>> = {};
  for (const { table, rows } of refRows) {
    const count: Record<string, number> = {};
    for (const r of rows) count[r.name] = (count[r.name] ?? 0) + 1;
    for (const r of rows) if (count[r.name] === 1) (byName[table] ??= {})[r.name] = r.sys_id;
  }
  const userName: Record<string, string> = Object.fromEntries(users.map((u) => [u.sys_id ?? '', u.user_name ?? '']));
  const raw = (c: HistoryChange, v: string, tz?: number) => {
    if (!v) return v;
    const choice = toValue[c.field]?.[v];
    if (choice !== undefined) return choice;
    const ref = h.refs?.[c.field];
    const id = ref ? byName[ref]?.[v] : undefined;
    if (id) return id;
    if (c.type === 'glide_date_time' && DATE_TIME.test(v)) {
      if (h.timeZone) { const utc = localToUtc(v, h.timeZone); if (utc) return utc; }
      if (tz) return new Date(toMs(v) - tz).toISOString().slice(0, 19).replace('T', ' ');
    }
    return v;
  };
  const who = (e: HistoryEntry) => userName[e.userId ?? ''] || (e.userName?.toLowerCase() === 'system' ? 'system' : e.userName) || '';
  return entries.flatMap((e, i) => e.changes.map((c): Row => ({
    sys_id: `history-${i}-${c.field}`,
    fieldname: c.field,
    oldvalue: raw(c, c.oldValue, e.tzOffsetMs),
    newvalue: raw(c, c.newValue, e.tzOffsetMs),
    user: who(e),
    sys_created_on: e.at,
    record_checkpoint: String(i + 1),
  })));
}

const SYS_ID = /^[0-9a-f]{32}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const toMs = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');

/** Hora local num fuso IANA → UTC, com o horário de verão daquela data (o offset do dia da gravação não serve). */
export function localToUtc(local: string, timeZone: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const offsetAt = (ms: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - ms;
    };
    const guess = toMs(local);
    let utc = guess - offsetAt(guess);
    utc = guess - offsetAt(utc); // segunda passada: perto da troca de horário
    return new Date(utc).toISOString().slice(0, 19).replace('T', ' ');
  } catch { return null; }
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
