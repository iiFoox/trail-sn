import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, audit, build, scenario } from './fixtures/builder';

/** Caça de uso real (26/10/2026): campo com 15 mudanças; só as 10 mais recentes são analisadas e o painel não avisava. */
describe('campo com mais mudanças que o limite analisado', () => {
  it('analisa as 10 mais recentes e conta as mais antigas', async () => {
    const s = scenario();
    for (let i = 0; i < 12; i++) audit(s, 'description', `v${i}`, `v${i + 1}`, `2026-10-${String(10 + i).padStart(2, '0')} 10:00:00`, 'admin', i + 1);
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes).toHaveLength(10);
    expect(r.changes[0]!.newValue).toBe('v12');
    expect(r.olderChanges).toBe(2);
  });

  it('dentro do limite: sem aviso', async () => {
    const s = scenario();
    audit(s, 'description', 'a', 'b', '2026-10-10 10:00:00', 'admin', 1);
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.olderChanges).toBeUndefined();
  });
});
