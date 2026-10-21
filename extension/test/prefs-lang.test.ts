import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserLang, normalize } from '../src/shared/prefs';
import { detectLang } from '../src/shared/i18n';

describe('idioma padrão', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sem idioma salvo, segue o navegador (pt para qualquer variante de português, en para o resto)', () => {
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(browserLang()).toBe('pt');
    expect(normalize(undefined).lang).toBe('pt');
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(normalize({ theme: 'light' }).lang).toBe('en');
    vi.stubGlobal('navigator', { language: 'es-ES' });
    expect(detectLang()).toBe('en');
  });

  it('chrome.i18n.getUILanguage tem preferência sobre navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'pt-PT' } });
    expect(browserLang()).toBe('pt');
  });

  it('quem já escolheu mantém a escolha, qualquer que seja o navegador', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(normalize({ lang: 'pt' }).lang).toBe('pt');
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(normalize({ lang: 'en' }).lang).toBe('en');
  });
});
