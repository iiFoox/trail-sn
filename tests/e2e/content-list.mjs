// Lista UI16 sintética: ícone nas colunas e clique gera investigação em lote dos registros marcados (ou da página).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../../extension/dist/content.js'), 'utf8');
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
const browser = await chromium.launch({ channel: 'chromium' });
// Navegador em português: sem idioma salvo, o Trail segue o idioma do navegador.
const page = await browser.newPage({ locale: 'pt-BR' });
await page.route('https://dev000000.service-now.com/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><body><table class="list_table" glide_table="incident"><thead><tr>
    <th name="search" class="col-control"></th>
    <th name="number" class="list_header_cell"><a class="column_head">Number</a></th>
    <th name="category" class="list_header_cell"><a class="column_head">Category</a></th></tr></thead><tbody>
    ${[A, B, C].map((x) => `<tr class="list_row" sys_id="${x}"><td><input type="checkbox" id="check_incident_${x}"></td><td>INC</td><td>x</td></tr>`).join('')}
  </tbody></table></body></html>` }));
await page.goto('https://dev000000.service-now.com/incident_list.do');
await page.evaluate(() => { window.__msgs = []; window.chrome = { runtime: { sendMessage: (m) => { window.__msgs.push(m); return Promise.resolve(); } } }; });
await page.addScriptTag({ content });
await page.waitForSelector('.trail-host');
const icons = await page.$$eval('.trail-host', (els) => els.length);
const click = () => page.evaluate(() => document.querySelector('th[name="category"] .trail-host').shadowRoot.querySelector('button').click());
await click();
await page.check(`#check_incident_${B}`);
await click();
await page.waitForTimeout(150);
const batches = (await page.evaluate(() => window.__msgs)).filter((m) => m.type === 'batch');
const errors = [];
if (icons !== 2) errors.push(`esperava 2 ícones, achei ${icons}`);
if (batches[0]?.sysIds.length !== 3 || batches[0]?.field !== 'category' || batches[0]?.table !== 'incident') errors.push('sem marcação devia mandar a página: ' + JSON.stringify(batches[0]));
if (batches[1]?.sysIds.join() !== B) errors.push('com marcação devia mandar só o marcado: ' + JSON.stringify(batches[1]));
console.log(JSON.stringify({ icons, batches: batches.map((b) => b.sysIds.length), errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
