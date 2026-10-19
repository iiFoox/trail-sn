import { describe, expect, it } from 'vitest';
import { fact, gradeFor, scoreAll, THRESHOLDS } from '../src/scoring';
import { evidence } from '../src/signatures/context';
import { mergeWindows, refsField } from '../src/util';
import { classifyAccess } from '../src/client/RestClient';

describe('pontuação', () => {
  it('faixas', () => {
    expect(gradeFor(THRESHOLDS.confirmed)).toBe('confirmed');
    expect(gradeFor(THRESHOLDS.confirmed - 1)).toBe('probable');
    expect(gradeFor(THRESHOLDS.probable - 1)).toBe('candidate');
  });
  it('empate do mesmo tipo rebaixa', () => {
    const mk = () => evidence('br_before', { name: 'x' }, [fact('form_value_differs', 't', ''), fact('execution_in_window', 't', ''), fact('references_field', 't', ''), fact('references_table', 't', '')]);
    const [a, b] = scoreAll([mk(), mk()]);
    expect(a!.score).toBe(65);
    expect(a!.grade).toBe('probable');
    expect(b!.facts.some((f) => f.kind === 'tie_with_same_type')).toBe(true);
  });
});

describe('utilitários', () => {
  it('refsField cobre as formas comuns', () => {
    expect(refsField("current.state = 2", 'state')).toBe(true);
    expect(refsField("gr.setValue('state', 2)", 'state')).toBe(true);
    expect(refsField('state=2^active=true', 'state')).toBe(true);
    expect(refsField('active=true^state=2', 'state')).toBe(true);
    expect(refsField('current.statement', 'state')).toBe(false);
  });
  it('mergeWindows funde sobreposições', () => {
    expect(mergeWindows([{ from: '2026-01-01 00:00:00', to: '2026-01-01 00:00:15' }, { from: '2026-01-01 00:00:10', to: '2026-01-01 00:00:25' }, { from: '2026-01-01 01:00:00', to: '2026-01-01 01:00:15' }]))
      .toEqual([{ from: '2026-01-01 00:00:00', to: '2026-01-01 00:00:25' }, { from: '2026-01-01 01:00:00', to: '2026-01-01 01:00:15' }]);
  });
  it('classifyAccess distingue os estados da Fase 0', () => {
    expect(classifyAccess(200, [{ sys_id: 'x' }])).toBe('ok');
    expect(classifyAccess(200, [])).toBe('empty');
    expect(classifyAccess(403, [], '{"error":{"message":"Insufficient rights"}}')).toBe('denied');
    expect(classifyAccess(403, [], '{"error":{"detail":"Field(s) present in the query do not have permission"}}')).toBe('no_filter');
    expect(classifyAccess(401, [])).toBe('denied');
  });
});
