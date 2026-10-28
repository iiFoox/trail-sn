import { describe, expect, it } from 'vitest';
import { parseHistory } from '../src/client/FetchRestClient';
import { investigate } from '../src/investigate';
import { INC, T0, audit, build, formTx, scenario } from './fixtures/builder';

/**
 * Uso real (28/10/2026): usuário sem leitura de sys_audit, campo Status fora do Activity Stream da tabela: o painel só
 * dizia "este campo não aparece no histórico". Na Zurich, o itil lia sys_history_line por `set.id=<sys_id>` (sem ler
 * sys_history_set), com valores, usuário e hora, e a consulta não criava set. O Trail passa a usar essas linhas.
 */
const ADMIN = 'b'.repeat(32);
const [y, mo, d, h, mi, se] = T0.split(/[- :]/).map(Number) as [number, number, number, number, number, number];
const history = parseHistory({
  fields: [{ name: 'short_description' }],
  entries: [{ sys_timestamp: Date.UTC(y, mo - 1, d, h, mi, se), user_id: ADMIN, sys_created_by: 'System Administrator', entries: { changes: [{ field_name: 'short_description', old_value: 'a', new_value: 'b' }] } }],
})!;
const line = (o: Record<string, string>) => ({ field: 'description', set_id: '', user: ADMIN, user_id: 'admin', update_time: T0, update: '1', old: '', new: '', old_value: '', new_value: '', ...o });

function itil(lines: Record<string, string>[] | 'denied') {
  const s = scenario();
  audit(s, 'description', 'antes', 'depois', T0, 'admin', 1);
  formTx(s, T0, 'admin', { description: 'depois' });
  const c = build(s).rows('sys_user', [{ sys_id: ADMIN, user_name: 'admin' }]).deny('sys_audit').withHistory(history);
  // Como a instância responde (sem filtrar de novo aqui): o teste do filtro ignorado precisa ver a linha de outro set.
  if (lines !== 'denied') c.respond('sys_history_line', () => lines.map(({ set_id, ...l }) => ({ ...l, 'set.id': set_id ?? '' })));
  return c;
}

describe('histórico guardado (sys_history_line) para campo fora do Activity Stream', () => {
  it('traz a mudança com valores, usuário e hora; o painel sabe de onde veio', async () => {
    const r = await investigate(itil([line({ update: '0', new: 'inicial', update_time: '2026-01-01 00:00:00' }), line({ old: 'antes', new: 'depois', set_id: INC.sysId })]), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.auditFrom).toBe('history');
    expect(r.historyLines).toBe(true);
    expect(r.fieldNotInHistory).toBeUndefined();
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ oldValue: 'antes', newValue: 'depois', user: 'admin' });
  });

  it('linha de outro registro (filtro ignorado pela instância): descarta tudo', async () => {
    const r = await investigate(itil([line({ old: 'antes', new: 'depois', set_id: 'f'.repeat(32) })]), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.historyLines).toBeUndefined();
    expect(r.fieldNotInHistory).toBe(true);
    expect(r.changes).toHaveLength(0);
  });

  it('sem leitura de sys_history_line: segue como antes, sem lacuna nova', async () => {
    const r = await investigate(itil('denied'), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.fieldNotInHistory).toBe(true);
    expect(r.gaps.join(' ')).not.toContain('sys_history_line');
  });
});
