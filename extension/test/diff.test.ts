import { describe, expect, it } from 'vitest';
import { diffLines, hunks } from '../src/shared/diff';

describe('diferença de scripts', () => {
  it('acha a linha alterada e marca só o trecho que mudou', () => {
    const a = ['function x() {', "  current.state = 6;", '  current.update();', '}'].join('\n');
    const b = ['function x() {', "  current.state = 7;", "  current.close_code = 'Solved';", '  current.update();', '}'].join('\n');
    const d = diffLines(a, b);
    expect([d.added, d.removed]).toEqual([2, 1]);
    const del = d.ops.find((o) => o.t === 'del')!;
    expect(del.text.slice(del.mark![0], del.mark![1])).toBe('6');
    expect(d.ops.filter((o) => o.t === 'eq').map((o) => [o.a, o.b])).toEqual([[1, 1], [3, 4], [4, 5]]);
  });
  it('esconde as linhas iguais longe da mudança', () => {
    const base = Array.from({ length: 40 }, (_, i) => `linha ${i}`);
    const b = [...base]; b[20] = 'mudou';
    const h = hunks(diffLines(base.join('\n'), b.join('\n')).ops, 3);
    expect(h.map((x) => x.kind)).toEqual(['gap', 'ops', 'gap']);
    expect(h[0]).toMatchObject({ count: 17 });
  });
});
