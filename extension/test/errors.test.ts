import { describe, expect, it } from 'vitest';
import { errorKind, friendlyError } from '../src/shared/errors';
import { t } from '../src/shared/i18n';

describe('erros em linguagem simples', () => {
  it('classifica as mensagens técnicas mais comuns', () => {
    expect(errorKind('Record not found or not readable')).toBe('notFound');
    expect(errorKind('Record unavailable: the instance did not answer (timeout)')).toBe('unavailable');
    expect(errorKind('Record unavailable: the instance did not answer (HTTP 500)')).toBe('unavailable');
    expect(errorKind('Failed to fetch')).toBe('offline');
    expect(errorKind('Could not establish connection. Receiving end does not exist.')).toBe('reloaded');
    expect(errorKind('Extension context invalidated.')).toBe('reloaded');
    expect(errorKind('Cannot read properties of undefined')).toBe('other');
    expect(errorKind(undefined)).toBe('other');
  });

  it('devolve o texto do i18n no idioma pedido; registro indisponível pede para tentar de novo', () => {
    expect(friendlyError('Record unavailable: the instance did not answer (timeout)', 'pt')).toBe('A instância não respondeu; tente de novo.');
    expect(friendlyError('Failed to fetch', 'en')).toBe(t('en').errOffline);
    expect(friendlyError('Record not found or not readable', 'pt')).toBe(t('pt').errNotFound);
    expect(friendlyError('qualquer coisa', 'pt')).toBe(t('pt').errOther);
  });
});
