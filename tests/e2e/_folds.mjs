import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { resolve } from 'node:path';
const dist = '/home/claude/iifoox/trail-sn/extension/dist';
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(),'f-')), { headless: true, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host; const page = await ctx.newPage(); await page.setViewportSize({ width: 420, height: 1000 });
for (const tab of ['answer','how','history','rules']) {
  for (const extra of ['', '&batch=rec']) {
  if (extra && tab!=='answer') continue;
  await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?demo=1&lang=pt&tab=${tab}${extra}`); await page.waitForTimeout(1500);
  // abre todas as seções para ver os títulos internos também
  for (let k=0;k<3;k++) await page.$$eval('details:not([open]) > summary', (ss) => ss.forEach((s) => s.click())).catch(()=>{});
  await page.waitForTimeout(400);
  const rows = await page.$$eval('summary', (ss) => ss.map((s) => s.innerText.replace(/\s+/g,' ').trim()));
  console.log('== ' + tab + extra); for (const r of rows) if (/\d/.test(r)) console.log('  ' + r.slice(0,120));
  }
}
await ctx.close();
