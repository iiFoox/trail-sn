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
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-prefs-')), {
  headless: true, channel: 'chromium', colorScheme: 'light',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
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
// 5. janela separada
const before = ctx.pages().length;
await opts.evaluate(() => chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }));
await opts.waitForTimeout(1200);
const win = ctx.pages().find((p) => p.url().includes('sidepanel/index.html?window=1'));
out.windowOpened = !!win;
out.windowUrl = win?.url().replace(/chrome-extension:\/\/[^/]+/, '');
out.windowHasDetachBtn = win ? await win.evaluate(() => !!document.querySelector('[aria-label="Open in a separate window"]')) : null;
await opts.evaluate(() => chrome.runtime.sendMessage({ type: 'open-panel', mode: 'window' }));
await opts.waitForTimeout(800);
out.windowsAfterSecondCall = ctx.pages().filter((p) => p.url().includes('window=1')).length;
out.pagesDelta = ctx.pages().length - before;
// volta ao padrão
await opts.click('text=Português'); await opts.waitForTimeout(400); await opts.click('text=Escuro');

await ctx.close();
console.log(JSON.stringify({ ...out, errors }, null, 1));
const ok = out.defaultTheme === 'dark' && out.afterLight === 'light' && out.synced?.theme === 'light' && out.panelTheme === 'light'
  && out.panelEnglish && out.windowOpened && out.windowHasDetachBtn === false && out.windowsAfterSecondCall === 1 && errors.length === 0;
process.exit(ok ? 0 : 1);
