// Verifica a demonstração do site: clique em cada campo troca a análise; links não navegam.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../site');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let p = join(root, urlPath); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(4481);
const S = process.argv[2] ? resolve(process.argv[2]) + '/' : '';
const b = await chromium.launch({ channel: 'chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('top: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|TUNNEL/.test(m.text())) errs.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())); });
const navs = [];
page.on('framenavigated', (f) => { if (f !== page.mainFrame() && !/localhost:4481/.test(f.url())) navs.push(f.url()); });
page.on('popup', (p) => navs.push('popup ' + p.url()));
await page.goto('http://localhost:4481/b3/');
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await page.locator('.compo').scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
const form = page.frameLocator('#cform');
const panelF = () => page.frames().find((f) => f.url().includes('/demo/panel.html') && f.parentFrame() && f.name() === '' && f === page.frame({ url: /panel\.html/ }));
const cpanel = page.frames().find((f) => f.url().includes('/demo/panel.html'));
const panelFrame = await (await page.$('#cpanel')).contentFrame();
const formFrame = await (await page.$('#cform')).contentFrame();
const results = {};
for (const field of ['priority', 'impact', 'category', 'severity', 'description', 'assignment_group', 'number', 'state']) {
  await formFrame.evaluate((f) => { document.querySelector(`label[for="incident.${f}"] .trail-host`).shadowRoot.querySelector('button').click(); }, field);
  await page.waitForTimeout(1900);
  results[field] = await panelFrame.evaluate(() => ({
    chg: document.querySelector('.headcard .chg')?.textContent?.trim()?.slice(0, 60),
    who: document.querySelector('.who .nm')?.textContent?.trim()?.slice(0, 60),
    cert: document.querySelector('.cert b')?.textContent,
  }));
  if (field === 'priority' && S) await page.locator('.compo').screenshot({ path: S + 'compo-priority.png' });
}
// links dentro do painel
await panelFrame.evaluate(() => document.querySelector('.btns a, .headcard a')?.click());
await page.waitForTimeout(300);
results.toast = await panelFrame.evaluate(() => document.querySelector('.toast')?.textContent);
results.panelUrlAfterClick = panelFrame.url().replace(/^.*\/demo/, '/demo');
// galeria
for (const label of ['Registro inteiro', 'Lote', 'E se?', 'Popup', 'Opções', 'Painel · escuro', 'Painel · claro']) {
  await page.click(`#galseg button:has-text("${label}")`);
  await page.waitForTimeout(900);
}
await page.locator('#telas .gal').scrollIntoViewIfNeeded();
await page.click('#galseg button:has-text("Opções")'); await page.waitForTimeout(900);
if (S) await page.locator('#telas .gal').screenshot({ path: S + 'gal-options.png' });
await page.locator('#telas .story').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
if (S) await page.locator('#telas .story').screenshot({ path: S + 'gal-story.png' });
// dentro do painel: cada callout
await page.locator('#painel').scrollIntoViewIfNeeded();
for (const i of [0, 3, 4, 6, 7, 8]) { await page.click(`.co >> nth=${i}`); await page.waitForTimeout(1100); if (S) await page.locator('.inside').screenshot({ path: S + `inside-${i}.png` }); }
const brokenImgs = await page.$$eval('img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
if (S) await page.screenshot({ path: S + 'b3-390.png', fullPage: true });
console.log(JSON.stringify({ results, brokenImgs, overflow1280, overflow390, navs, errs }, null, 1));
await b.close(); srv.close();
