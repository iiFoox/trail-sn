// Smoke test: carrega a extensão empacotada num Chromium e verifica service worker, popup e painel.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = new URL(sw.url()).host;
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('popup: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('popup console: ' + m.text()); });
await page.goto(`chrome-extension://${extId}/src/popup/index.html`);
await page.waitForSelector('.topbar');
const popupText = await page.textContent('body');
const panel = await ctx.newPage();
panel.on('pageerror', (e) => errors.push('sidepanel: ' + e.message));
await panel.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
await panel.waitForSelector('.topbar');
const panelText = await panel.textContent('body');
const opts = await ctx.newPage();
opts.on('pageerror', (e) => errors.push('options: ' + e.message));
await opts.goto(`chrome-extension://${extId}/src/options/index.html`);
await opts.waitForSelector('.topbar');
console.log(JSON.stringify({ extId, popup: popupText.slice(0, 120), panel: panelText.slice(0, 120), errors }, null, 1));
await ctx.close();
process.exit(errors.length ? 1 : 0);
