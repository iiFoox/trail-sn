/**
 * Painel flutuante: abre do tamanho do painel lateral (altura toda, encostado na direita), carrega o painel no iframe,
 * arrasta pelo cabeçalho, encosta de novo ao soltar na borda, minimiza em bolinha e volta, fecha no X.
 * Roda numa página da própria extensão (o content script e o iframe ficam na mesma origem que a extensão).
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../extension/dist');
const shotDir = process.argv[2];
writeFileSync(resolve(dist, '_float-test.html'), '<!doctype html><meta charset="utf-8"><title>t</title><body style="margin:0;font:14px system-ui;background:#fff"><div style="padding:30px">Formulário de teste</div><script src="content.js"></script></body>');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-float-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${id}/_float-test.html`);
  await page.waitForFunction(() => !!window.__trailFloat);
  await page.evaluate(() => window.__trailFloat.openFloat(1, { theme: 'dark' }));
  const pane = () => page.evaluate(() => { const p = document.getElementById('trail-float').shadowRoot.querySelector('.pane'); const r = p.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cls: p.className, shown: p.style.display !== 'none' }; });
  await page.waitForTimeout(700);
  const opened = await pane();
  if (opened.w !== 420 || opened.h !== 800 - 16 || opened.x !== 1280 - 420 - 8 || opened.y !== 8) errors.push('não abriu do tamanho do painel lateral: ' + JSON.stringify(opened));
  const frame = page.frames().find((f) => f.url().includes('float=1'));
  if (!frame) throw new Error('iframe do painel não carregou');
  await frame.waitForSelector('header.topbar.drag');
  const nTop = await frame.$$eval('header.topbar', (h) => h.length);
  if (nTop !== 1) errors.push('esperava um cabeçalho só, achei ' + nTop);
  if (!(await frame.$('header.topbar .lights .light.pin'))) errors.push('faltou a bolinha verde (sempre visível)');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-open.png') });
  // Arrasta pelo cabeçalho para o meio da tela: vira cartão solto.
  const hb = await (await frame.$('header.topbar')).boundingBox();
  await page.mouse.move(hb.x + 120, hb.y + 15);
  await page.mouse.down();
  await page.mouse.move(hb.x - 200, hb.y + 120, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.move(hb.x - 400, hb.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const free = await pane();
  if (!free.cls.includes('free') || free.x > 700 || free.y < 20) errors.push('arrastar não soltou o painel: ' + JSON.stringify(free));
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-free.png') });
  // Solta na borda esquerda: encosta lá, altura toda.
  const hb2 = await (await frame.$('header.topbar')).boundingBox();
  await page.mouse.move(hb2.x + 100, hb2.y + 15);
  await page.mouse.down();
  await page.mouse.move(60, 300, { steps: 6 });
  await page.mouse.move(5, 300, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const left = await pane();
  if (!left.cls.includes('left') || left.x !== 8 || left.h !== 800 - 16) errors.push('não encostou na esquerda: ' + JSON.stringify(left));
  // Duplo clique no cabeçalho: volta para a direita.
  await frame.dblclick('header.topbar .host, header.topbar', { position: { x: 160, y: 15 } }).catch(() => frame.dblclick('header.topbar'));
  await page.waitForTimeout(450);
  const back = await pane();
  if (back.x !== 1280 - 420 - 8 || back.cls.includes('left')) errors.push('duplo clique não encostou na direita: ' + JSON.stringify(back));
  // Minimizar e voltar.
  await frame.click(`header.topbar button[aria-label^="Minimizar"]`);
  await page.waitForTimeout(450);
  const mini = await pane();
  const bub = await page.evaluate(() => !!document.getElementById('trail-float').shadowRoot.querySelector('.bub'));
  if (mini.shown || !bub) errors.push('minimizar não virou bolinha');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-mini.png') });
  await page.evaluate(() => document.getElementById('trail-float').shadowRoot.querySelector('.bub').click());
  await page.waitForTimeout(400);
  const again = await pane();
  if (!again.shown || again.w !== 420) errors.push('a bolinha não trouxe o painel de volta: ' + JSON.stringify(again));
  // Fechar no X.
  await frame.click(`header.topbar button[aria-label="Fechar o painel"]`);
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => !document.getElementById('trail-float'));
  if (!gone) errors.push('o X não fechou');
  // Reabrir: volta ao tamanho padrão mesmo depois de ter mexido.
  await page.evaluate(() => window.__trailFloat.openFloat(1, { theme: 'light' }));
  await page.waitForTimeout(600);
  const re = await pane();
  if (re.w !== 420 || re.x !== 1280 - 420 - 8 || re.h !== 800 - 16) errors.push('reabrir não voltou ao tamanho do painel: ' + JSON.stringify(re));
  console.log(JSON.stringify({ opened, free, left, back, again, re, errors }, null, 1));
} finally {
  await ctx.close();
  rmSync(resolve(dist, '_float-test.html'), { force: true });
}
if (errors.length) process.exit(1);
