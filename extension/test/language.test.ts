import { describe, expect, it } from 'vitest';
import { normalizeInstanceLanguage } from '../src/shared/messages';

describe('idioma da instância', () => {
  it('usa o código de português brasileiro do ServiceNow', () => {
    expect(['pt-BR', 'pt_br', 'pb', 'PT'].map(normalizeInstanceLanguage)).toEqual(['pb', 'pb', 'pb', 'pb']);
  });

  it('reduz idiomas com região e usa inglês quando o valor é inválido', () => {
    expect(['en-US', 'es-MX', 'fr', '', 'unknown'].map(normalizeInstanceLanguage)).toEqual(['en', 'es', 'fr', 'en', 'en']);
  });
});
