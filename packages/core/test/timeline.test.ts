import { describe, expect, it } from 'vitest';
import { recordTimeline } from '../src/timeline';
import { INC, T0, audit, build, formTx, id, scenario, shiftStr, tx } from './fixtures/builder';

describe('linha do tempo do registro', () => {
  it('agrupa por gravação e diz por onde cada uma entrou', async () => {
    const s = scenario();
    const t1 = shiftStr(T0, -3600), t2 = T0, t3 = shiftStr(T0, 60), t4 = shiftStr(T0, 120);
    audit(s, 'short_description', '', 'Impressora', t1, 'admin', 1);
    audit(s, 'state', '', '1', t1, 'admin', 1);
    audit(s, 'impact', '3', '1', t2, 'admin', 2);
    audit(s, 'priority', '5', '3', t2, 'admin', 2);
    formTx(s, t2, 'admin', { impact: '3' });
    audit(s, 'category', 'inquiry', 'network', t2, 'admin', 3); // mesma segundo, sem transação própria
    audit(s, 'urgency', '3', '1', t3, 'admin', 4);
    tx(s, t3, 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    audit(s, 'severity', '2', '1', t4, 'system', 5);
    tx(s, t4, 'other', 'JOB: PT job', 'system');
    const c = build(s);
    c.rows('sys_dictionary', [{ name: 'task', element: 'impact', column_label: 'Impact' }, { name: 'incident', element: 'category', column_label: 'Category' }]);
    c.rows('sys_choice', [{ name: 'task', element: 'impact', value: '1', label: '1 - High', language: 'en', inactive: 'false' }, { name: 'task', element: 'impact', value: '3', label: '3 - Low', language: 'en', inactive: 'false' }]);
    const tl = await recordTimeline(c, { table: 'incident', number: INC.number });
    expect(tl.saves.map((x) => [x.checkpoint, x.via])).toEqual([[5, 'job'], [4, 'api'], [3, 'chained'], [2, 'form'], [1, 'created']]);
    const imp = tl.saves.find((x) => x.checkpoint === 2)!.fields.find((f) => f.field === 'impact')!;
    expect([imp.label, imp.oldDisplay, imp.newDisplay]).toEqual(['Impact', '3 - Low', '1 - High']);
  });

  it('botão Save conta como formulário; botão com script próprio aparece como UI action', async () => {
    const s = scenario();
    const save = id(), mark = id();
    audit(s, 'description', 'a', 'b', T0, 'admin', 1);
    tx(s, T0, 'form', `/incident.do?sys_action=${save}&sys_uniqueValue=${INC.sysId}`, 'admin');
    audit(s, 'description', 'b', 'c', shiftStr(T0, 90), 'admin', 2);
    tx(s, shiftStr(T0, 90), 'form', `/incident.do?sys_action=${mark}&sys_uniqueValue=${INC.sysId}`, 'admin');
    s.uiActions.push({ sys_id: save, name: 'Save', action_name: 'sysverb_update_and_stay' }, { sys_id: mark, name: 'Marcar perícia', action_name: 'mark' });
    const tl = await recordTimeline(build(s), { table: 'incident', number: INC.number });
    expect(tl.saves.map((x) => [x.via, x.detail])).toEqual([['ui_action', 'Marcar perícia'], ['form', 'Save']]);
  });
});

import { compareSaves, type Timeline as TLT } from '../src/timeline';
describe('comparar duas gravações', () => {
  const f = (field: string, o: string, n: string, journal = false) => ({ field, label: field, oldValue: o, newValue: n, oldDisplay: o, newDisplay: n, journal });
  const tl: TLT = {
    target: { table: 'incident', sysId: 'x', display: 'INC1' }, truncated: false, timing: { totalMs: 0, calls: 0 },
    saves: [
      { checkpoint: 4, at: '2026-01-01 10:04:00', user: 'beth', via: 'form', fields: [f('state', '2', '6'), f('impact', '2', '3')] },
      { checkpoint: 3, at: '2026-01-01 10:03:00', user: 'system', via: 'chained', fields: [f('priority', '3', '1'), f('work_notes', '', 'oi', true)] },
      { checkpoint: 2, at: '2026-01-01 10:02:00', user: 'abel', via: 'api', fields: [f('impact', '3', '2'), f('state', '1', '2')] },
      { checkpoint: 1, at: '2026-01-01 10:01:00', user: 'abel', via: 'created', fields: [f('state', '', '1')] },
    ],
  };
  it('mostra de onde para onde cada campo foi entre A e B, quem mexeu e o que voltou', () => {
    const d = compareSaves(tl, 4, 1)!;
    expect([d.from.checkpoint, d.to.checkpoint, d.saves, d.journal]).toEqual([1, 4, 3, 1]);
    expect(d.rows.map((r) => [r.field, r.fromValue, r.toValue, r.touches, r.reverted, r.users.join()])).toEqual([
      ['priority', '3', '1', 1, false, 'system'],
      ['state', '1', '6', 2, false, 'abel,beth'],
      ['impact', '3', '3', 2, true, 'abel,beth'],
    ]);
  });
  it('gravações vizinhas mostram só o que a de cima gravou', () => {
    expect(compareSaves(tl, 2, 3)!.rows.map((r) => r.field)).toEqual(['priority']);
  });
});
