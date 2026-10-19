// Abre páginas da extensão com dados de demonstração na sessão (relatório, diferença lado a lado) e tira prints.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const S = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const demo = JSON.parse(readFileSync(S + 'demo.json', 'utf8'));
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`chrome-extension://${id}/src/options/index.html`);
const desc = demo.desc; const ch = desc.changes[0];
await p.evaluate(async ({ r, ch }) => {
  await chrome.storage.session.set({ 'report:1': { r, sel: 0, origin: 'https://dev457034.service-now.com' }, 'diff:1': { title: 'INC0010001 · Description', sub: '17/10 às 23:25', oldText: ch.oldValue, newText: ch.newValue } });
}, { r: desc, ch });
const which = process.argv[2] || 'report';
if (which === 'report') {
  await p.addInitScript(() => { window.print = () => {}; });
  await p.goto(`chrome-extension://${id}/src/report/index.html?k=report:1`); await p.waitForTimeout(900);
  await p.screenshot({ path: S + 'report.png', fullPage: true });
} else {
  await p.goto(`chrome-extension://${id}/src/diff/index.html?k=diff:1`); await p.waitForTimeout(Number(process.argv[3] || 1500));
  await p.screenshot({ path: S + 'diffpage.png' });
}
console.log(JSON.stringify(errs)); await ctx.close();
