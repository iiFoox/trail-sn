// Testa o content script contra um formulário UI16 sintético, com um stub de chrome.runtime.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../../extension/dist/content.js'), 'utf8');
const page_ = readFileSync(resolve(here, '../../extension/dist/page.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
await page.route('https://dev000000.service-now.com/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><body>
    <script>window.g_ck='${'a'.repeat(72)}'; window.NOW={user_name:'admin'};
      window.g_form={getTableName:()=>'incident',getUniqueValue:()=>'${'b'.repeat(32)}'};</script>
    <label for="incident.state">State</label><input id="incident.state">
    <label for="incident.impact">Impact</label><input id="incident.impact">
    <label for="incident.caller_id.name">Caller name (dot-walk, sem ícone)</label>
  </body></html>` }));
await page.goto('https://dev000000.service-now.com/incident.do?sys_id=' + 'b'.repeat(32));

await page.evaluate(() => {
  window.__msgs = [];
  window.chrome = { runtime: { sendMessage: (m) => { window.__msgs.push(m); return Promise.resolve(); } } };
});
await page.addScriptTag({ content: page_ });
await page.addScriptTag({ content });
await page.waitForSelector('.trail-host');

const icons = await page.$$eval('.trail-host', (els) => els.length);
await page.evaluate(() => {
  const host = document.querySelector('label[for="incident.state"] .trail-host');
  host.shadowRoot.querySelector('button').click();
});
await page.waitForTimeout(200);
const msgs = await page.evaluate(() => window.__msgs);
const ctx = msgs.find((m) => m.type === 'context');
const errors = [];
if (icons !== 2) errors.push(`esperava 2 ícones, achei ${icons}`);
if (!ctx || ctx.ctx.table !== 'incident' || ctx.ctx.token?.length !== 72) errors.push('contexto não publicado com tabela e token: ' + JSON.stringify(ctx));
const inv = msgs.find((m) => m.type === 'investigate');
if (!inv || inv.target.field !== 'state' || inv.target.table !== 'incident' || inv.token?.length !== 72) errors.push('clique não gerou investigate correto: ' + JSON.stringify(inv));
console.log(JSON.stringify({ icons, messages: msgs.map((m) => m.type), errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
