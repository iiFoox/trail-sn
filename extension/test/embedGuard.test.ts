import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedAllowed } from '../src/shared/embedGuard';

const EXT = 'chrome-extension://abcdefghijklmnop';
/** Página da extensão dentro de quadros com estas origens (a primeira é a do quadro de cima, como no navegador). */
function framedBy(ancestors: string[] | undefined, opts: { protocol?: string; connected?: string[] } = {}) {
  const win = {} as Record<string, unknown>;
  win.top = ancestors ? {} : win;
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', { protocol: opts.protocol ?? 'chrome-extension:', origin: EXT, ...(ancestors ? { ancestorOrigins: ancestors } : {}) });
  vi.stubGlobal('chrome', { storage: { sync: { get: async () => ({ instances: (opts.connected ?? []).map((origin) => ({ origin, enabledAt: '' })) }) } } });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('painel embutido (B2, 25/10)', () => {
  it('fora de iframe (painel lateral, janela): abre', async () => {
    framedBy(undefined);
    expect(await embedAllowed()).toBe(true);
  });
  it('flutuante numa instância conectada (também dentro do gsft_main): abre', async () => {
    framedBy(['https://dev1.service-now.com'], { connected: ['https://dev1.service-now.com'] });
    expect(await embedAllowed()).toBe(true);
    framedBy(['https://dev1.service-now.com', 'https://dev1.service-now.com'], { connected: ['https://dev1.service-now.com'] });
    expect(await embedAllowed()).toBe(true);
  });
  it('embutido por outro site, ou uma instância dentro de outro site: não abre', async () => {
    framedBy(['https://evil.example.com'], { connected: ['https://dev1.service-now.com'] });
    expect(await embedAllowed()).toBe(false);
    framedBy(['https://dev1.service-now.com', 'https://evil.example.com'], { connected: ['https://dev1.service-now.com'] });
    expect(await embedAllowed()).toBe(false);
    framedBy([], { connected: ['https://dev1.service-now.com'] });
    expect(await embedAllowed()).toBe(false);
  });
  it('demonstração do site (fora da extensão): abre', async () => {
    framedBy(['https://trail-sn.vercel.app'], { protocol: 'https:' });
    expect(await embedAllowed()).toBe(true);
  });
});
