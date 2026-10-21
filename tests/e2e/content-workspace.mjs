// Testa o content script contra um formulário Workspace sintético (shadow DOM aninhado).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../../extension/dist/content.js'), 'utf8');
const sysId = 'c'.repeat(32);
const browser = await chromium.launch({ channel: 'chromium' });
// Navegador em português: sem idioma salvo, o Trail segue o idioma do navegador.
const page = await browser.newPage({ locale: 'pt-BR' });
await page.route('https://dev000000.service-now.com/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><body>
    <script>window.g_ck='${'a'.repeat(72)}';
      class Field extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<div class="now-form-field-label">'+this.getAttribute('label')+'</div><input>'; } }
      customElements.define('sn-record-input-connected', Field);
      customElements.define('now-record-typeahead', class extends Field {});
      class Layout extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'});
        r.innerHTML='<sn-record-input-connected name="short_description" label="Short description"></sn-record-input-connected><now-record-typeahead name="assignment_group" label="Assignment group"></now-record-typeahead><sn-record-input-connected name="trigger" label="slot-like"></sn-record-input-connected>'; } }
      customElements.define('now-record-form-section-column-layout', Layout);
    </script>
    <now-record-form-section-column-layout></now-record-form-section-column-layout>
  </body></html>` }));
await page.goto(`https://dev000000.service-now.com/now/sow/record/incident/${sysId}/params/selected-tab-index/1`);
await page.evaluate(() => { window.__msgs = []; window.chrome = { runtime: { sendMessage: (m) => { window.__msgs.push(m); return Promise.resolve(); } } }; });
await page.addScriptTag({ content });
await page.waitForTimeout(2000);
const result = await page.evaluate(() => {
  const layout = document.querySelector('now-record-form-section-column-layout').shadowRoot;
  const hosts = [...layout.querySelectorAll('*')].flatMap((el) => [...(el.shadowRoot?.querySelectorAll('.trail-host') ?? [])]);
  hosts[0]?.shadowRoot.querySelector('button').click();
  return { icons: hosts.length, msgs: window.__msgs };
});
await page.waitForTimeout(200);
const msgs = await page.evaluate(() => window.__msgs);
const inv = msgs.find((m) => m.type === 'investigate');
const ctx = msgs.find((m) => m.type === 'context');
const errors = [];
if (result.icons !== 3) errors.push(`esperava 3 ícones (um por campo), achei ${result.icons}`);
if (!ctx || ctx.ctx.surface !== 'workspace' || ctx.ctx.table !== 'incident' || ctx.ctx.sysId !== sysId) errors.push('contexto workspace errado: ' + JSON.stringify(ctx));
if (!inv || inv.target.field !== 'short_description') errors.push('clique não gerou investigate: ' + JSON.stringify(inv));
console.log(JSON.stringify({ icons: result.icons, messages: msgs.map((m) => m.type), errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
