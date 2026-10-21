/** Aba Flows (demo): execuções no registro e flows configurados para a tabela; "O que roda neste registro" no registro inteiro; abas cabem em 340 px. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-flows-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
const out = {};
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  for (const w of [420, 340]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?demo=1&float=1&tab=flows`);
    await page.waitForSelector('.fl-run');
    out[w] = await page.evaluate(() => {
      const t = document.querySelector('.seg-tabs'), a = t.querySelector('button[aria-selected="true"]');
      const tr = t.getBoundingClientRect(), ar = a.getBoundingClientRect();
      return { runs: document.querySelectorAll('.fl-run').length, defs: document.querySelectorAll('.fl-def').length, active: a.textContent, activeVisible: ar.left >= tr.left - 1 && ar.right <= tr.right + 1 };
    });
    if (out[w].runs !== 2 || out[w].defs !== 2) errors.push(`aba Flows sem as listas em ${w}px: ` + JSON.stringify(out[w]));
    if (out[w].active !== 'Flows' || !out[w].activeVisible) errors.push(`aba Flows ativa fora da vista em ${w}px: ` + JSON.stringify(out[w]));
  }
  await page.setViewportSize({ width: 420, height: 1300 });
  await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?demo=1&float=1&batch=rec`);
  await page.waitForSelector('.rruns .grp', { timeout: 8000 }).catch(() => errors.push('registro inteiro sem "O que roda neste registro"'));
  out.rec = await page.evaluate(() => [...document.querySelectorAll('.rruns .grp > summary b')].map((b) => b.textContent));
  for (const g of ['Regras de negócio', 'Flows', 'Client scripts', 'Botões (UI actions)']) if (!out.rec.includes(g)) errors.push('faltou o grupo ' + g + ': ' + JSON.stringify(out.rec));
} finally {
  console.log(JSON.stringify({ ...out, errors }, null, 1));
  await ctx.close();
  if (errors.length) process.exitCode = 1;
}
