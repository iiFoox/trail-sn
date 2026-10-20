import { describe, expect, it } from 'vitest';
import { batchCsv, groupBatch, type BatchItem } from '../src/batch';

const it_ = (sysId: string, type: string, name: string, grade = 'confirmed'): BatchItem => ({ sysId, display: sysId, status: 'done', at: '2026-10-20 10:00:00', oldValue: '', newValue: 'x', user: 'admin', cause: { type, name, grade, score: 80 } });
describe('lote', () => {
  it('agrupa por causa; pessoas viram um grupo só; ordena pela contagem', () => {
    const g = groupBatch([it_('a', 'br_before', 'R1'), it_('b', 'br_before', 'R1'), it_('c', 'user_action', 'admin'), it_('d', 'user_action', 'beth'), it_('e', 'import_set', 'Mapa'), { sysId: 'f', display: 'f', status: 'unchanged' }]);
    expect(g.map((x) => [x.key, x.count])).toEqual([['br_before|R1', 2], ['user_action', 2], ['import_set|Mapa', 1]]);
  });
  it('CSV com ; e aspas quando precisa', () => {
    const csv = batchCsv([{ ...it_('a', 'br_before', 'Regra; com ponto e vírgula'), title: 'Diz "oi"' }]);
    expect(csv.split('\n')[1]).toContain('"Regra; com ponto e vírgula"');
    expect(csv.split('\n')[1]).toContain('"Diz ""oi"""');
  });
});
