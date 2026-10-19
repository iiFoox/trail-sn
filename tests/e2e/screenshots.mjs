// Captura o painel, o popup e as opções em modo demo (sem instância) para revisão visual.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../extension/dist');
const out = resolve(here, '../../docs/screenshots');
mkdirSync(out, { recursive: true });
const scheme = process.argv[2] === 'dark' ? 'dark' : 'light';
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-shot-')), {
  headless: true, channel: 'chromium', colorScheme: scheme, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host;
const shots = [
  ['sidepanel', `src/sidepanel/index.html?demo=1`, { width: 400, height: 900 }],
  ['popup', `src/popup/index.html?demo=1`, { width: 340, height: 420 }],
  ['options', `src/options/index.html`, { width: 820, height: 420 }],
];
for (const [name, path, viewport] of shots) {
  const page = await ctx.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/${path}`);
  await page.waitForSelector('.topbar');
  if (name === 'sidepanel') await page.$$eval('details.facts', (ds) => { ds[0]?.setAttribute('open', ''); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(out, `${name}-${scheme}.png`), fullPage: name === 'sidepanel' });
  if (errors.length) console.error(name, errors);
}
await ctx.close();
console.log('ok', out);
