import { describe, expect, it } from 'vitest';
import { detectPingPong } from '../src/pingpong';
import type { Change } from '../src/types';

const ch = (at: string, o: string, n: string, who: string): Change => ({ at, oldValue: o, newValue: n, user: 'system', checkpoint: 1, evidence: [{ type: 'br_async', grade: 'confirmed', score: 80, artifact: { name: who }, facts: [], gaps: [] }], trace: [], notes: [] } as unknown as Change);
describe('pingue-pongue', () => {
  it('duas regras alternando o valor: detecta', () => {
    const hist = [ch('2026-10-20 10:04:00', '1', '2', 'A'), ch('2026-10-20 10:03:00', '2', '1', 'B'), ch('2026-10-20 10:02:00', '1', '2', 'A'), ch('2026-10-20 10:01:00', '2', '1', 'B')].map((c) => c); // mais recente primeiro
    const pp = detectPingPong(hist)!;
    expect(pp.flips).toBe(4);
    expect(new Set(pp.actors)).toEqual(new Set(['A', 'B']));
  });
  it('a mesma causa voltando o valor não é pingue-pongue', () => {
    const hist = [ch('2026-10-20 10:03:00', '2', '1', 'A'), ch('2026-10-20 10:02:00', '1', '2', 'A'), ch('2026-10-20 10:01:00', '2', '1', 'A')];
    expect(detectPingPong(hist)).toBeUndefined();
  });
  it('só duas trocas: pouco para afirmar', () => {
    expect(detectPingPong([ch('2026-10-20 10:02:00', '2', '1', 'B'), ch('2026-10-20 10:01:00', '1', '2', 'A')])).toBeUndefined();
  });
});
