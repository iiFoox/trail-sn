// Janela "lado a lado" estilo Mac: abre sobre uma página, tira prints aberta, maximizada, minimizada e depois de arrastar.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const S = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const demo = JSON.parse(readFileSync(S + 'demo.json', 'utf8'));
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`], viewport: { width: 1400, height: 900 } });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errs = [];
const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`chrome-extension://${id}/src/options/index.html`);
const ch = demo.desc.changes[0];
await p.evaluate(async ({ ch }) => { await chrome.storage.session.set({ 'diff:1': { title: 'INC0010001 · Description', sub: '17/10 às 23:25', oldText: ch.oldValue, newText: ch.newValue } }); }, { ch });
await p.addScriptTag({ url: `chrome-extension://${id}/content.js` });
await p.waitForTimeout(300);
const theme = process.argv[2] || 'dark';
await p.evaluate((theme) => window.__trailOpenDiff({ key: 'diff:1', title: 'INC0010001 · Description', sub: '17/10 às 23:25', theme }), theme);
await p.waitForTimeout(120); await p.screenshot({ path: S + 'mac0.png' });
await p.waitForTimeout(1500); await p.screenshot({ path: S + 'mac1.png' });
const host = p.locator('#trail-diff-window');
// arrasta pela barra
const box = await p.evaluate(() => { const w = document.getElementById('trail-diff-window').shadowRoot.querySelector('.bar').getBoundingClientRect(); return { x: w.x + w.width / 2, y: w.y + 18 }; });
await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x - 200, box.y + 60, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(300); await p.screenshot({ path: S + 'mac2.png' });
// maximiza (botão verde)
await p.evaluate(() => document.getElementById('trail-diff-window').shadowRoot.querySelector('.x').click());
await p.waitForTimeout(600); await p.screenshot({ path: S + 'mac3.png' });
// minimiza
await p.evaluate(() => document.getElementById('trail-diff-window').shadowRoot.querySelector('.m').click());
await p.waitForTimeout(700); await p.screenshot({ path: S + 'mac4.png' });
// restaura e fecha com Esc
await p.evaluate(() => document.getElementById('trail-diff-window').shadowRoot.querySelector('.dock').click());
await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
const gone = await p.evaluate(() => !document.getElementById('trail-diff-window'));
console.log(JSON.stringify({ errs, closedByEsc: gone })); await ctx.close();
