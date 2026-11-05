import { describe, expect, it } from 'vitest';
import { chainField, decodeEntities, fieldPair, parseSubmit, type TxSubmit } from '../src/txLog';

/** Formato medido na PDI (31/10/2026): sys_original.<tabela>.<campo> e <tabela>.<campo>, valor cortado em ~1000 + "...". */
const url = (fields: Record<string, string>, mc = 1) =>
  '/incident.do?sys_uniqueValue=abc&sys_modCount=' + mc + '&' +
  Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('&');

const CUT = 'x'.repeat(997) + '...';

describe('parseSubmit', () => {
  it('lê valor antigo e novo de um campo', () => {
    const s = parseSubmit(url({ 'sys_original.incident.description': 'inicio', 'incident.description': 'novo texto' }), 'incident', 1000);
    expect(s).not.toBeNull();
    expect(s!.sysModCount).toBe(1);
    expect(s!.changes).toEqual([{ field: 'description', oldValue: 'inicio', newValue: 'novo texto', truncated: false, newTruncated: false }]);
  });

  it('ignora campo sem mudança e URL de outra tabela', () => {
    expect(parseSubmit(url({ 'sys_original.incident.description': 'a', 'incident.description': 'a' }), 'incident', 1)).toBeNull();
    expect(parseSubmit(url({ 'sys_original.task.description': 'a', 'task.description': 'b' }), 'incident', 1)).toBeNull();
  });

  it('marca valor cortado com "..." como truncado', () => {
    const s = parseSubmit(url({ 'sys_original.incident.description': 'inicio', 'incident.description': 'ini-' + CUT }), 'incident', 1);
    expect(s!.changes[0]?.truncated).toBe(true);
  });

  it('desfaz entidades HTML em uma passada só: &amp;lt; vira &lt;, não <', () => {
    expect(decodeEntities('a &amp;lt; b &amp; c')).toBe('a &lt; b & c');
  });

  it('campo enviado sem valor original fica sem oldValue', () => {
    const s = parseSubmit(url({ 'incident.description': 'x' }), 'incident', 1);
    expect(s!.changes[0]?.oldValue).toBeUndefined();
  });
});

describe('fieldPair', () => {
  it('traz o valor ao abrir e o enviado, mesmo sem mudança', () => {
    const u = '/incident.do?sys_original.incident.state=Em Andamento&incident.state=Em Andamento&incident.description=x';
    expect(fieldPair(u, 'incident', 'state')).toEqual({ orig: 'Em Andamento', sent: 'Em Andamento' });
  });
  it('campo fora do envio: indefinido, sem inventar valor', () => {
    expect(fieldPair('/incident.do?incident.description=x', 'incident', 'state')).toEqual({ orig: undefined, sent: undefined });
  });
});

describe('valores com & cru (medido na PDI)', () => {
  it('& dentro do valor não corta o texto: só o & seguido de chave=', () => {
    const raw = '/incident.do?sys_uniqueValue=abc&sys_original.incident.description=antes&incident.description=AB&<>%+ #yyy&sys_modCount=3';
    const s = parseSubmit(raw, 'incident', 1);
    expect(s!.changes[0]?.newValue).toBe('AB&<>%+ #yyy');
    expect(s!.sysModCount).toBe(3);
  });

  it('valor antigo cortado e novo exato: o novo é comparado inteiro com o registro', () => {
    const atual = 'AB&<>%+ #yyy';
    const s = parseSubmit(`/incident.do?sys_original.incident.description=${'x'.repeat(997)}...&incident.description=${atual}`, 'incident', 1);
    const r = chainField([s!], 'description', atual);
    expect(r.changes[0]?.newTruncated).toBe(false);
    expect(r.matchesCurrent).toBe(true);
    expect(chainField([s!], 'description', 'AB').matchesCurrent).toBe(false);
  });
});

describe('chainField', () => {
  const sub = (startMs: number, mc: number, oldValue: string, newValue: string): TxSubmit => ({
    startMs,
    sysModCount: mc,
    changes: [{ field: 'description', oldValue, newValue, truncated: newValue.endsWith('...') || oldValue.endsWith('...'), newTruncated: newValue.endsWith('...') }],
  });

  it('cadeia contínua que termina no valor atual: completa', () => {
    const r = chainField([sub(1, 1, 'a', 'b'), sub(2, 2, 'b', 'c')], 'description', 'c');
    expect(r.matchesCurrent).toBe(true);
    expect(r.gaps).toEqual([]);
    expect(r.changes.map((c) => `${c.oldValue}>${c.newValue}`)).toEqual(['a>b', 'b>c']);
  });

  it('valor original que não é o deixado pelo anterior: aponta a quebra', () => {
    const r = chainField([sub(1, 1, 'a', 'b'), sub(2, 2, 'z', 'c')], 'description', 'c');
    expect(r.gaps.join(' ')).toContain('não é o que o submit anterior deixou');
  });

  it('último valor diferente do registro atual: nada é dado como certo', () => {
    const r = chainField([sub(1, 1, 'a', 'b')], 'description', 'outro');
    expect(r.matchesCurrent).toBe(false);
  });

  it('valor cortado: confere pelo começo com o registro atual', () => {
    const r = chainField([sub(1, 1, 'inicio', 'ini-' + CUT)], 'description', 'ini-' + 'x'.repeat(2000) + '-fim');
    expect(r.matchesCurrent).toBe(true);
  });

  it('valor cortado que não começa igual ao registro: não confere', () => {
    const r = chainField([sub(1, 1, 'inicio', 'ini-' + CUT)], 'description', 'outro começo' + 'x'.repeat(2000));
    expect(r.matchesCurrent).toBe(false);
  });

  it('dois submits com o mesmo sys_modCount: ambíguo', () => {
    const r = chainField([sub(1, 5, 'a', 'b'), sub(2, 5, 'b', 'c')], 'description', 'c');
    expect(r.gaps.join(' ')).toContain('sys_modCount 5');
  });

  it('ordena por horário de início, mesmo que a lista venha fora de ordem', () => {
    const r = chainField([sub(2, 2, 'b', 'c'), sub(1, 1, 'a', 'b')], 'description', 'c');
    expect(r.gaps).toEqual([]);
  });
});
