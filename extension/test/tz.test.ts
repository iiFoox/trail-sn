import { afterEach, describe, expect, it } from 'vitest';
import { dayNumber, setDisplayTimeZone, tzOpt } from '../src/shared/tz';

describe('fuso de exibição do painel', () => {
  afterEach(() => setDisplayTimeZone(undefined));

  it('usa o fuso do usuário no ServiceNow', () => {
    setDisplayTimeZone('America/Sao_Paulo');
    const d = new Date('2026-10-26T21:48:13Z');
    expect(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...tzOpt() })).toBe('18:48:13');
    setDisplayTimeZone('Australia/Sydney');
    expect(d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...tzOpt() })).toBe('08:48');
  });

  it('dia muda no fuso do usuário (hoje/ontem)', () => {
    const d = new Date('2026-10-26T23:30:00Z');
    setDisplayTimeZone('UTC');
    const utcDay = dayNumber(d);
    setDisplayTimeZone('Australia/Sydney');
    expect(dayNumber(d)).toBe(utcDay + 1);
  });

  it('fuso inválido ou ausente: fica o do navegador', () => {
    setDisplayTimeZone('Nao/Existe');
    expect(tzOpt()).toEqual({});
    setDisplayTimeZone(undefined);
    expect(tzOpt()).toEqual({});
  });
});
