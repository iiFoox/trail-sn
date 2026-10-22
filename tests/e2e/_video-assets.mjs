/**
 * Prints em alta resolução (2×) para o vídeo de divulgação: painel em modo demo (escuro e claro) e o formulário de demo do site.
 * Uso: node tests/e2e/_video-assets.mjs <pasta-saida> [<copia-do-site-com-assets-sincronizados>]
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname } from 'node:path';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const siteRoot = process.argv[3];
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-v-')), { headless: true, channel: 'chromium', locale: 'pt-BR', deviceScaleFactor: 2, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage(); await page.setViewportSize({ width: 420, height: 860 });
const go = async (tab, theme) => { await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?demo=1&lang=pt&theme=${theme}&field=state&tab=${tab}`); await page.waitForTimeout(1600); };
const shot = async (name, full = false) => page.screenshot({ path: join(out, name + '.png'), fullPage: full });
for (const theme of ['dark', 'light']) {
  const sfx = theme === 'dark' ? '' : '-claro';
  await go('answer', theme); await shot('painel-resposta' + sfx);
  await go('trace', theme); await shot('painel-rastro' + sfx);
  await go('proof', theme); await page.locator('.why-this > summary').click(); await page.waitForTimeout(500); await shot('painel-provas' + sfx);
  await go('history', theme); await page.locator('.hist-fold > summary').click(); await page.waitForTimeout(500); await shot('painel-historico' + sfx);
  await go('flows', theme); await shot('painel-flows' + sfx);
  await go('answer', theme); await page.locator('.headcard').screenshot({ path: join(out, 'painel-caminho' + sfx + '.png') });
}
if (siteRoot) {
  const mime = { '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  const srv = createServer((req, res) => { let p = join(siteRoot, decodeURIComponent(req.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }).listen(4491);
  const p2 = await ctx.newPage(); await p2.setViewportSize({ width: 1280, height: 720 });
  await p2.goto('http://localhost:4491/demo/form.html?hot=state'); await p2.waitForTimeout(1500);
  await p2.screenshot({ path: join(out, 'form-incident.png') });
  srv.close();
}
await ctx.close();
console.log('ok');
