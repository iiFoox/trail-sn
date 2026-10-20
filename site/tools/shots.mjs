// Gera imagens para o site: formulário UI16 realista com os ícones do content script real,
// recortes do painel, e frames da sequência.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const dist = '/home/claude/trail/extension/dist';
const content = readFileSync(`${dist}/content.js`, 'utf8');
const pagejs = readFileSync(`${dist}/page.js`, 'utf8');
const out = '/home/claude/trail-site/b3/img';
mkdirSync(out, { recursive: true });

const FORM = (hot) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f4f5f7;font:13px/1.4 "Helvetica Neue",Arial,sans-serif;color:#2e3a42}
.nav{height:48px;background:#293e40;color:#fff;display:flex;align-items:center;gap:16px;padding:0 16px;font-size:14px}
.nav .logo{font-weight:700;letter-spacing:.02em}
.nav .srch{margin-left:auto;background:#3b5255;border-radius:3px;padding:6px 10px;width:260px;color:#b6c6c8;font-size:12px}
.nav .av{width:28px;height:28px;border-radius:50%;background:#62d84e;color:#0b2a0f;display:grid;place-items:center;font-weight:700;font-size:12px}
.hdr{background:#fff;border-bottom:1px solid #d5dbe0;padding:10px 16px;display:flex;align-items:center;gap:10px}
.hdr b{font-size:15px}.hdr .ctx{color:#6b7780}.hdr .btns{margin-left:auto;display:flex;gap:6px}
.hdr .btn{border:1px solid #c7ced4;background:#fff;border-radius:3px;padding:5px 10px;font-size:12px}
.hdr .btn.p{background:#278efc;border-color:#278efc;color:#fff}
.form{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;padding:18px 20px;background:#fff;margin:14px 16px;border:1px solid #d5dbe0;border-radius:3px}
.f{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:8px}
label{text-align:right;color:#2e3a42;font-weight:600;display:flex;justify-content:flex-end;align-items:center;gap:6px}
label .req{color:#c83c3c}
input,.sel{height:30px;border:1px solid #c7ced4;border-radius:3px;padding:0 8px;background:#fff;color:#2e3a42;font:13px Arial}
.sel{display:flex;align-items:center;justify-content:space-between}
.sel:after{content:"▾";color:#6b7780}
.ref{display:flex;gap:4px}.ref input{flex:1}.ref i{width:30px;height:30px;border:1px solid #c7ced4;border-radius:3px;display:grid;place-items:center;color:#6b7780;font-style:normal}
.hot input,.hot .sel{border-color:#1f8476;box-shadow:0 0 0 3px rgba(31,132,118,.22)}
.wide{grid-column:1/-1}
textarea{width:100%;height:64px;border:1px solid #c7ced4;border-radius:3px;padding:6px 8px;font:13px Arial;resize:none}
.tabs{margin:0 16px;display:flex;gap:4px;border-bottom:1px solid #d5dbe0}
.tabs span{padding:8px 12px;font-weight:600;color:#6b7780;border-bottom:3px solid transparent}
.tabs span.on{color:#2e3a42;border-color:#278efc}
</style></head><body>
<div class="nav"><span class="logo">servicenow</span><span style="opacity:.7">Incidents</span><div class="srch">Search</div><div class="av">GA</div></div>
<div class="hdr"><span style="color:#6b7780">≡</span><b>Incident</b><span class="ctx">INC0010001</span><div class="btns"><span class="btn">Follow</span><span class="btn">Update</span><span class="btn p">Resolve</span><span class="btn">Delete</span></div></div>
<div class="form">
 <div class="f"><label for="incident.number">Number</label><input id="incident.number" value="INC0010001" readonly></div>
 <div class="f"><label for="incident.contact_type">Contact type</label><div class="sel" id="incident.contact_type">Email</div></div>
 <div class="f"><label for="incident.caller_id"><span class="req">*</span>Caller</label><div class="ref"><input id="incident.caller_id" value="Beth Anglin"><i>🔍</i></div></div>
 <div class="f ${hot==='state'?'hot':''}"><label for="incident.state">State</label><div class="sel" id="incident.state">Resolved</div></div>
 <div class="f"><label for="incident.category">Category</label><div class="sel" id="incident.category">Network</div></div>
 <div class="f ${hot==='impact'?'hot':''}"><label for="incident.impact"><span class="req">*</span>Impact</label><div class="sel" id="incident.impact">1 - High</div></div>
 <div class="f"><label for="incident.subcategory">Subcategory</label><div class="sel" id="incident.subcategory">-- None --</div></div>
 <div class="f"><label for="incident.urgency"><span class="req">*</span>Urgency</label><div class="sel" id="incident.urgency">2 - Medium</div></div>
 <div class="f"><label for="incident.cmdb_ci">Configuration item</label><div class="ref"><input id="incident.cmdb_ci" value="PRN-3A-01"><i>🔍</i></div></div>
 <div class="f"><label for="incident.priority">Priority</label><div class="sel" id="incident.priority">1 - Critical</div></div>
 <div class="f"><label for="incident.assignment_group">Assignment group</label><div class="ref"><input id="incident.assignment_group" value="Network"><i>🔍</i></div></div>
 <div class="f"><label for="incident.assigned_to">Assigned to</label><div class="ref"><input id="incident.assigned_to" value="Howard Johnson"><i>🔍</i></div></div>
 <div class="f wide"><label for="incident.short_description"><span class="req">*</span>Short description</label><input id="incident.short_description" value="Impressora do 3º andar sem rede"></div>
 <div class="f wide"><label for="incident.description" style="align-self:start;padding-top:6px">Description</label><textarea id="incident.description">Impressora PRN-3A-01 não responde no ping desde as 08:40. Já reiniciada pelo usuário.</textarea></div>
</div>
<div class="tabs"><span class="on">Notes</span><span>Related Records</span><span>Resolution Information</span></div>
<script>window.g_ck='${'a'.repeat(72)}';window.NOW={user_name:'admin'};window.g_form={getTableName:()=>'incident',getUniqueValue:()=>'${'b'.repeat(32)}'};</script>
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
async function form(name, hot, width = 1180, height = 620, clip) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.route('https://dev457034.service-now.com/**', (r) => r.fulfill({ contentType: 'text/html', body: FORM(hot) }));
  await page.goto('https://dev457034.service-now.com/incident.do?sys_id=' + 'b'.repeat(32));
  await page.evaluate(() => { window.chrome = { runtime: { sendMessage: () => Promise.resolve() } }; });
  await page.addScriptTag({ content: pagejs });
  await page.addScriptTag({ content });
  await page.waitForSelector('.trail-host');
  if (hot) await page.evaluate((h) => { const el = document.querySelector(`label[for="incident.${h}"] .trail-host`); el?.shadowRoot?.querySelector('button')?.classList.add('on'); el?.shadowRoot?.querySelector('button')?.focus(); }, hot);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png`, clip });
  await page.close();
}
await form('ui16-form', null);
await form('ui16-form-hot', 'state');
await form('ui16-zoom', 'state', 1180, 620, { x: 580, y: 170, width: 420, height: 130 });
await browser.close();

// recortes do painel real (dark)
const sp = '/home/claude/trail/docs/screenshots/sidepanel-dark.png';
const meta = await sharp(sp).metadata();
console.log('sidepanel', meta.width, meta.height);
const S = meta.width / 536; // escala a partir das coords da imagem exibida
const crop = (name, x, y, w, h) => sharp(sp).extract({ left: Math.round(x * S), top: Math.round(y * S), width: Math.round(w * S), height: Math.round(h * S) }).png().toFile(`${out}/${name}.png`);
await crop('panel-top', 0, 0, 536, 410);
await crop('panel-verdict', 0, 600, 536, 480);
await crop('panel-gaps', 0, 1450, 536, 400);
await crop('panel-unaudited', 0, 410, 536, 200);
await sharp(sp).extract({ left: 0, top: 0, width: meta.width, height: Math.round(1900 * S) }).resize({ width: 800 }).png().toFile(`${out}/panel-full.png`);
for (const n of ['popup-dark', 'options-dark', 'options-light', 'sidepanel-light']) await sharp(`/home/claude/trail/docs/screenshots/${n}.png`).png().toFile(`${out}/${n}.png`);
console.log('ok');
