import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = '/home/claude/trail-site', S = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer((req, res) => { const p = join(root, req.url.split('?')[0]); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] }); res.end(readFileSync(p)); }).listen(4484);
const b = await chromium.launch({ channel: 'chromium' });
const errs = [];
for (const theme of ['dark', 'light']) {
  const page = await b.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:4484/demo/panel.html?theme=${theme}&lang=${process.argv[3] || 'pt'}&field=${process.argv[2] || 'state'}`); await page.waitForTimeout(900);
  const tabs = ['Resposta', 'Rastro', 'Provas', 'Histórico'];
  for (const [i, tname] of tabs.entries()) {
    if (await page.$('.seg-tabs')) { await page.click(`.seg-tabs button:nth-child(${i + 1})`); await page.waitForTimeout(250); }
    if (tname === 'Provas') await page.evaluate(() => document.querySelectorAll('details.fold').forEach((d) => d.open = true));
    await page.screenshot({ path: `${S}tab-${theme}-${i}.png`, fullPage: true });
  }
  await page.close();
}
console.log(JSON.stringify(errs));
await b.close(); srv.close();
