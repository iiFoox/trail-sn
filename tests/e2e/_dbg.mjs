import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = '/home/claude/trail-site';
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': extname(p)==='.html'?'text/html':'image/png' }); res.end(readFileSync(p)); }).listen(4478);
const b = await chromium.launch({ channel: 'chromium' }); const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://localhost:4478/b3/'); await page.waitForTimeout(500); await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});
const h = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < h; y += 500) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(100); }
console.log(await page.evaluate(() => ({ h: document.documentElement.scrollHeight, rv: document.querySelectorAll('.rv').length, notin: [...document.querySelectorAll('.rv:not(.in)')].map(e => e.id || e.className).slice(0, 10), tipos: document.querySelector('#tipos').getBoundingClientRect().height, painel: document.querySelector('#painel').getBoundingClientRect().height, inside: document.querySelector('.inside').getBoundingClientRect().height })));
await b.close(); srv.close();
