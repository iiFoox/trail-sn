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

// Demo: comparador da linha do tempo ("O que mudou entre dois momentos") e gaveta "O registro inteiro".
const demo = await ctx.newPage();
demo.on('pageerror', (e) => errors.push('demo: ' + e.message));
await demo.goto(`chrome-extension://${extId}/src/sidepanel/index.html?demo=1&tab=history&hist=record`);
await demo.waitForSelector('.cmpbar button');
const cmpBtn = (await demo.textContent('.cmpbar button'))?.trim() ?? '';
if (!cmpBtn.includes('O que mudou entre dois momentos')) errors.push('cmpBtn inesperado: ' + cmpBtn);
await demo.click('.cmpbar button');
const cmpHint = (await demo.textContent('.cmpbar .cmp-hint'))?.trim() ?? '';
if (!cmpHint.includes('Escolha dois momentos na linha do tempo')) errors.push('cmpHint inesperado: ' + cmpHint);
await demo.click('ol.rtl > li:nth-child(1) .hd');
await demo.click('ol.rtl > li:nth-child(4) .hd');
await demo.waitForSelector('.card.cmp');
const cmpTitle = (await demo.textContent('.card.cmp .cmp-hd'))?.trim() ?? '';
if (!cmpTitle.includes('O que mudou entre') || !cmpTitle.includes('gravações entre os dois momentos')) errors.push('cmpTitle inesperado: ' + cmpTitle);

await demo.click('details.drawer summary');
await demo.click('.manual-mode button:nth-child(2)');
await demo.click('details.drawer .btn.primary');
await demo.waitForSelector('.batch .bt-head.run');
await demo.waitForSelector('.batch .bt-head.ok', { timeout: 3000 });
const recRows = await demo.$$eval('.batch .bt-row:not(.wait)', (els) => els.length);
if (recRows !== 7) errors.push('demoRecord esperava 7 linhas prontas, achou ' + recRows);

console.log(JSON.stringify({ extId, popup: popupText.slice(0, 120), panel: panelText.slice(0, 120), cmpBtn, recRows, errors }, null, 1));
await ctx.close();
process.exit(errors.length ? 1 : 0);
