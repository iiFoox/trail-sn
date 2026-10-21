// Testa o content script contra um formulário UI16 sintético, com um stub de chrome.runtime.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const content = readFileSync(resolve(here, '../../extension/dist/content.js'), 'utf8');
const page_ = readFileSync(resolve(here, '../../extension/dist/page.js'), 'utf8');

const browser = await chromium.launch({ channel: 'chromium' });
// Navegador em português: sem idioma salvo, o Trail segue o idioma do navegador.
const page = await browser.newPage({ locale: 'pt-BR' });
await page.route('https://dev000000.service-now.com/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><body>
    <script>window.g_ck='${'a'.repeat(72)}'; window.NOW={user_name:'admin'};
      window.g_form={getTableName:()=>'incident',getUniqueValue:()=>'${'b'.repeat(32)}',isMandatory:(f)=>f==='impact',
        // Igual ao UI16: isReadOnly(ge, control), true quando falta o control.
        isReadOnly:function(ge, control){ if (!control) return true; return control.disabled || control.readOnly; },getGlideUIElement:(f)=>({fieldName:f}),getLabelOf:(f)=>({state:'State',impact:'Impact',parent_incident:'Parent Incident'})[f]||f};</script>
    <div id="element.incident.state"><label for="incident.state">State</label><input id="incident.state" readonly></div>
    <div id="element.incident.impact"><label for="incident.impact">Impact</label><input id="incident.impact"></div>
    <div id="element.incident.parent_incident" style="display:none"><input id="incident.parent_incident"></div>
    <label for="sys_display.incident.business_service">Service</label><input id="sys_display.incident.business_service">
    <label for="ni.incident.active">Active</label><input type="checkbox" id="ni.incident.active"><label for="ni.incident.active"></label>
    <label for="sys_readonly.sys_display.incident.universal_request">Universal request</label>
    <label for="select_0incident.watch_list">Watch list</label>
    <label for="incident.caller_id.name">Caller name (dot-walk, sem ícone)</label>
  </body></html>` }));
await page.goto('https://dev000000.service-now.com/incident.do?sys_id=' + 'b'.repeat(32));

await page.evaluate(() => {
  window.__msgs = [];
  window.__runtimeListeners = [];
  window.chrome = { runtime: { id: 'trail-test', sendMessage: (m) => { window.__msgs.push(m); return Promise.resolve(); }, onMessage: {
    addListener: (fn) => window.__runtimeListeners.push(fn),
    removeListener: (fn) => { window.__runtimeListeners = window.__runtimeListeners.filter((x) => x !== fn); },
  } } };
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
if (icons !== 6) errors.push(`esperava 6 ícones (2 comuns, 2 referências, 1 caixa com dois rótulos, 1 lista), achei ${icons}`);
const refField = await page.evaluate(() => document.querySelector('label[for="sys_display.incident.business_service"] .trail-host')?.shadowRoot.querySelector('button').getAttribute('aria-label'));
if (!refField?.includes('(business_service)')) errors.push('referência sem ícone ou com campo errado: ' + refField);
if (!ctx || ctx.ctx.table !== 'incident' || ctx.ctx.token?.length !== 72) errors.push('contexto não publicado com tabela e token: ' + JSON.stringify(ctx));
const inv = msgs.find((m) => m.type === 'investigate');
if (!inv || inv.target.field !== 'state' || inv.target.table !== 'incident' || inv.token?.length !== 72) errors.push('clique não gerou investigate correto: ' + JSON.stringify(inv));
// "Por que está bloqueado?": o painel pede o estado de um campo e de todos (inclusive escondidos) ao content → g_form.
const formState = await page.evaluate(() => {
  const ask = (m) => { let r; for (const l of window.__runtimeListeners) l(m, {}, (x) => { r = x; }); return r; };
  return { one: ask({ type: 'trail-field-state', field: 'state', table: 'incident' }), other: ask({ type: 'trail-field-state', field: 'state', table: 'problem' }), all: ask({ type: 'trail-form-states', table: 'incident' }) };
});
const one = formState.one;
if (!one || one.readOnly !== true || one.mandatory !== false || one.visible !== true || one.label !== 'State') errors.push('estado do campo errado: ' + JSON.stringify(one));
if (formState.other) errors.push('respondeu para outra tabela: ' + JSON.stringify(formState.other));
const byName = Object.fromEntries((formState.all?.fields ?? []).map((f) => [f.field, f]));
if (byName.impact?.readOnly !== false) errors.push('campo editável dado como somente leitura (g_form.isReadOnly do UI16): ' + JSON.stringify(byName.impact));
if (byName.impact?.mandatory !== true || byName.parent_incident?.visible !== false || byName.parent_incident?.label !== 'Parent Incident') errors.push('lista do formulário errada: ' + JSON.stringify(formState.all));
// Reinjeção antes de o contexto antigo invalidar: a nova cópia desliga a anterior.
await page.addScriptTag({ content });
const whileAlive = await page.locator('.trail-host').count();
if (whileAlive !== icons) errors.push('reinjeção com script antigo vivo duplicou ícones: ' + whileAlive);
const shortcuts = await page.evaluate(() => {
  const before = window.__msgs.filter((m) => m.type === 'toggle-icons').length;
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyT', altKey: true, shiftKey: true }));
  return window.__msgs.filter((m) => m.type === 'toggle-icons').length - before;
});
if (shortcuts !== 1) errors.push('reinjeção deixou listeners de atalho duplicados: ' + shortcuts);
// O contexto antigo se invalida após reload da extensão; a cópia nova não duplica ícones.
await page.evaluate(() => { window.chrome.runtime.id = undefined; });
await page.waitForFunction(() => document.querySelectorAll('.trail-host').length === 0, null, { timeout: 4000 });
await page.evaluate(() => { window.chrome.runtime.id = 'trail-test'; });
await page.addScriptTag({ content });
await page.waitForSelector('.trail-host');
const afterReload = await page.locator('.trail-host').count();
if (afterReload !== icons) errors.push('reinjeção duplicou ou perdeu ícones: ' + afterReload);
const revoked = await page.evaluate(() => {
  let replies = 0;
  for (const listener of [...window.__runtimeListeners]) listener({ type: 'trail-dispose', origin: location.origin }, {}, () => replies++);
  return { replies, icons: document.querySelectorAll('.trail-host').length };
});
if (revoked.replies !== 1 || revoked.icons !== 0) errors.push('permissão revogada não desligou o content: ' + JSON.stringify(revoked));
console.log(JSON.stringify({ icons, whileAlive, shortcuts, afterReload, revoked, messages: msgs.map((m) => m.type), errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
