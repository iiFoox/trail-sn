// Preferências e janela destacável, com a extensão carregada de verdade:
// tema escuro por padrão, troca de tema persistida, idioma EN, open-panel em modo janela
// abre sidepanel?window=1 numa janela popup, e uma segunda chamada reaproveita a mesma janela.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../extension/dist');
// O headless do Chromium simula uma tela de 800x600, menor que a janela de 1280x720 criada pelo Playwright.
// O Trail posiciona a janela destacada na borda direita da janela normal (left = 850), mais da metade fora
// dessa tela, e chrome.windows.create recusa ("Bounds must be at least 50% within visible screen space").
// --screen-info dá ao headless uma tela do tamanho de um monitor comum; no modo com interface é ignorado.
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-prefs-')), {
  headless: true, channel: 'chromium', locale: 'pt-BR', colorScheme: 'light',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--screen-info={1920x1080}'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host;
const errors = [];
const out = {};

const opts = await ctx.newPage();
opts.on('pageerror', (e) => errors.push('options: ' + e.message));
await opts.goto(`chrome-extension://${id}/src/options/index.html`);
await opts.waitForSelector('.seg2');
// 0. sem idioma salvo, segue o navegador (este contexto está em pt-BR)
out.defaultLang = await opts.evaluate(() => document.documentElement.lang);
// 1. padrão escuro mesmo com o sistema em claro
out.defaultTheme = await opts.evaluate(() => document.documentElement.dataset.theme);
// 2. troca para claro e verifica persistência no storage
await opts.click('text=Claro');
out.afterLight = await opts.evaluate(() => document.documentElement.dataset.theme);
out.synced = await sw.evaluate(async () => (await chrome.storage.sync.get('trail.prefs'))['trail.prefs']);
// 3. painel abre já em claro (mesma origem, localStorage)
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push('panel: ' + e.message));
await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
await panel.waitForSelector('.topbar');
out.panelTheme = await panel.evaluate(() => document.documentElement.dataset.theme);
// 4. idioma EN
await opts.click('text=English');
await opts.waitForTimeout(600);
await panel.reload(); await panel.waitForSelector('.topbar');
out.panelEnglish = (await panel.textContent('body')).includes('No investigation in this tab');
out.syncedLang = await sw.evaluate(async () => (await chrome.storage.sync.get('trail.prefs'))['trail.prefs']?.lang);
// 5. janela separada
const before = ctx.pages().length;
const isPanelWindow = (p) => p.url().includes('sidepanel/index.html?window=1');
const winEvent = ctx.waitForEvent('page', { predicate: isPanelWindow, timeout: 10000 }).catch(() => undefined);
out.openReply = await opts.evaluate(() => chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }));
const win = (await winEvent) ?? ctx.pages().find(isPanelWindow);
if (win) await win.waitForSelector('.topbar').catch(() => undefined);
out.windowOpened = !!win;
out.windowUrl = win?.url().replace(/chrome-extension:\/\/[^/]+/, '');
out.windowHasDetachBtn = win ? await win.evaluate(() => !!document.querySelector('[aria-label="Open in a separate window"]')) : null;
out.secondReply = await opts.evaluate(() => chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }));
await opts.waitForTimeout(800);
out.windowsAfterSecondCall = ctx.pages().filter((p) => p.url().includes('window=1')).length;
out.pagesDelta = ctx.pages().length - before;
// volta ao padrão
await opts.click('text=Português'); await opts.waitForTimeout(400); await opts.click('text=Escuro');

await ctx.close();

// Navegador em inglês, perfil novo: sem escolha salva, o Trail abre em inglês.
const ctxEn = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-prefs-en-')), {
  headless: true, channel: 'chromium', locale: 'en-US',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [swEn] = ctxEn.serviceWorkers();
if (!swEn) swEn = await ctxEn.waitForEvent('serviceworker', { timeout: 15000 });
const en = await ctxEn.newPage();
en.on('pageerror', (e) => errors.push('options en: ' + e.message));
await en.goto(`chrome-extension://${new URL(swEn.url()).host}/src/options/index.html`);
await en.waitForSelector('.seg2');
out.englishBrowserLang = await en.evaluate(() => document.documentElement.lang);
await ctxEn.close();

console.log(JSON.stringify({ ...out, errors }, null, 1));
const ok = out.defaultLang === 'pt-BR' && out.synced && !('lang' in out.synced) && out.syncedLang === 'en' && out.englishBrowserLang === 'en'
  && out.defaultTheme === 'dark' && out.afterLight === 'light' && out.synced?.theme === 'light' && out.panelTheme === 'light'
  && out.panelEnglish && !out.openReply?.error && !out.secondReply?.error && out.windowOpened && out.windowHasDetachBtn === false && out.windowsAfterSecondCall === 1 && errors.length === 0;
process.exit(ok ? 0 : 1);
