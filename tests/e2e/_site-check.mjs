import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = '/home/claude/trail-site';
const mime = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }).listen(4477);
const browser = await chromium.launch({ channel: 'chromium' });
const out = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad';
for (const [name, vp] of [['desk', { width: 1280, height: 800 }], ['mob', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:4477/b3/'); await page.waitForTimeout(800); await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});
  // scroll through to trigger reveals
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += vp.height * .7) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(120); }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const broken = await page.$$eval('img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
  await page.screenshot({ path: `${out}/b3-${name}.png`, fullPage: true });
  console.log(name, { height: h, overflow, broken, errs });
  await page.close();
}
await browser.close(); srv.close();
