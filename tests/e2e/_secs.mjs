import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = '/home/claude/trail-site', S = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer((req, res) => { let p = join(root, req.url.split('?')[0]); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] }); res.end(readFileSync(p)); }).listen(4485);
const b = await chromium.launch({ channel: 'chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
await page.goto('http://localhost:4485/b3/'); await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await page.waitForTimeout(3500);
await page.screenshot({ path: S + 's-hero.png' });
await page.locator('.story').scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
await page.locator('.story').screenshot({ path: S + 's-story.png' });
await page.locator('#painel').scrollIntoViewIfNeeded(); await page.waitForTimeout(1500);
for (const i of [3, 5]) { await page.click(`.co >> nth=${i}`); await page.waitForTimeout(1200); await page.screenshot({ path: S + `s-inside-${i}.png` }); }
await b.close(); srv.close();
