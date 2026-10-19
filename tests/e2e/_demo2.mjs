import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = '/home/claude/trail-site';
const mime = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer((req, res) => { let p = join(root, decodeURIComponent(req.url.split('?')[0])); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }).listen(4480);
const b = await chromium.launch({ channel: 'chromium' });
const S = '/tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/';
for (const [u, vp, n] of [['/demo/popup.html?theme=dark', { width: 340, height: 420 }, 'demo-popup'], ['/demo/options.html?theme=dark', { width: 820, height: 520 }, 'demo-options'], ['/demo/panel.html?theme=light', { width: 400, height: 500 }, 'demo-panel-light']]) {
  const p = await b.newPage({ viewport: vp }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:4480' + u); await p.waitForTimeout(1000);
  await p.screenshot({ path: S + n + '.png' }); console.log(n, errs);
}
await b.close(); srv.close();
