import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'b3/img');
mkdirSync(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const srv = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0);

const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chromium' });

try {
  // 1) Formulário UI16 com ícones do Trail (frame-1, frame-2, ui16-form-hot)
  {
    const page = await browser.newPage({ viewport: { width: 1180, height: 620 }, deviceScaleFactor: 1.5 });
    await page.goto(`${base}/demo/form.html?hot=state`);
    await page.waitForSelector('.trail-host');
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(out, 'ui16-form-hot.png'), clip: { x: 0, y: 0, width: 1180, height: 470 } });
    await page.screenshot({ path: resolve(out, 'frame-1.png'), clip: { x: 10, y: 52, width: 560, height: 340 } });
    await page.screenshot({ path: resolve(out, 'frame-2.png'), clip: { x: 585, y: 52, width: 575, height: 340 } });
    await page.close();
  }
  // 2) Painel escuro (panel-full, panel-top, panel-verdict)
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 920 }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
    await page.goto(`${base}/demo/panel.html?theme=dark&field=state`);
    await page.waitForSelector('.topbar');
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(out, 'panel-full.png'), fullPage: true });
    await page.screenshot({ path: resolve(out, 'panel-top.png'), clip: { x: 0, y: 0, width: 420, height: 360 } });
    await page.screenshot({ path: resolve(out, 'panel-verdict.png'), clip: { x: 0, y: 185, width: 420, height: 440 } });
    await page.close();
  }
  // 3) Painel claro (sidepanel-light)
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 920 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
    await page.goto(`${base}/demo/panel.html?theme=light&field=state`);
    await page.waitForSelector('.topbar');
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(out, 'sidepanel-light.png'), fullPage: true });
    await page.close();
  }
  // 4) Popup escuro (popup-dark)
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 500 }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
    await page.goto(`${base}/demo/popup.html?theme=dark`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, 'popup-dark.png') });
    await page.close();
  }
  // 5) Opções escuro e claro (options-dark, options-light)
  for (const scheme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 780, height: 520 }, deviceScaleFactor: 1.5, colorScheme: scheme });
    await page.goto(`${base}/demo/options.html?theme=${scheme}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, `options-${scheme}.png`) });
    await page.close();
  }
  console.log('ok', out);
} finally {
  await browser.close();
  srv.close();
}
