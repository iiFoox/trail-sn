// Formulário do Service Portal sintético: ícone ao lado do rótulo e clique investiga o campo do registro da URL.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../../extension/dist/content.js'), 'utf8');
const ID = 'd'.repeat(32);
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
await page.route('https://dev000000.service-now.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
  <div class="form-group"><label class="field-label" for="sp_formfield_category"><span id="sp_field_label_category">Category</span></label><select id="sp_formfield_category"></select></div>
  <div class="form-group"><label class="field-label" for="sp_formfield_urgency"><span id="sp_field_label_urgency">Urgency</span></label><select id="sp_formfield_urgency"></select></div>
</body></html>` }));
await page.goto(`https://dev000000.service-now.com/sp?id=form&table=incident&sys_id=${ID}`);
await page.evaluate(() => { window.__msgs = []; window.chrome = { runtime: { sendMessage: (m) => { window.__msgs.push(m); return Promise.resolve(); } } }; });
await page.addScriptTag({ content });
await page.waitForSelector('.trail-host');
const icons = await page.$$eval('.trail-host', (els) => els.length);
await page.evaluate(() => document.querySelector('#sp_field_label_urgency + .trail-host').shadowRoot.querySelector('button').click());
await page.waitForTimeout(150);
const msgs = await page.evaluate(() => window.__msgs);
const inv = msgs.find((m) => m.type === 'investigate');
const errors = [];
if (icons !== 2) errors.push(`esperava 2 ícones, achei ${icons}`);
if (!inv || inv.target.table !== 'incident' || inv.target.sysId !== ID || inv.target.field !== 'urgency') errors.push('investigate errado: ' + JSON.stringify(inv));
console.log(JSON.stringify({ icons, errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
