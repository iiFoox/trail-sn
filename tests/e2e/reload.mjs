/**
 * Extensão recarregada com a página da instância aberta (o que o auto-reload de desenvolvimento faz):
 * o script antigo tem que perceber que ficou órfão, tirar da página os ícones e o painel e não quebrar nada.
 *
 * Roda numa cópia do dist com a instância de teste em host_permissions, para não depender do pedido de permissão.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://dev000000.service-now.com';
const dist = mkdtempSync(resolve(tmpdir(), 'trail-reload-dist-'));
// cpSync derruba o processo no Node 24 para Windows; cópia simples.
const copy = (from, to) => { mkdirSync(to, { recursive: true }); for (const e of readdirSync(from, { withFileTypes: true })) (e.isDirectory() ? copy : copyFileSync)(resolve(from, e.name), resolve(to, e.name)); };
copy(resolve(here, '../../extension/dist'), dist);
const mf = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
mf.host_permissions = [...(mf.host_permissions ?? []), `${ORIGIN}/*`];
writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(mf));

const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-reload-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
const out = {};
try {
  // O g_form da página falsa segue o sys_id da URL, como num formulário de verdade.
  await ctx.route(`${ORIGIN}/**`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <script>window.g_ck='${'a'.repeat(72)}'; window.NOW={user_name:'admin'};
        window.g_form={getTableName:()=>'incident',getUniqueValue:()=>new URLSearchParams(location.search).get('sys_id')||'${'b'.repeat(32)}'};</script>
      <label for="incident.state">State</label><input id="incident.state">
      <label for="incident.impact">Impact</label><input id="incident.impact">
    </body></html>` }));
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  // Conecta a instância como o botão "Conectar nesta instância" faz.
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${id}/src/options/index.html`);
  out.activated = await opt.evaluate((origin) => chrome.runtime.sendMessage({ type: 'activate', origin }), ORIGIN);
  await opt.close();

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/incident.do?sys_id=${'b'.repeat(32)}`);
  const count = () => page.evaluate(() => ({ icons: document.querySelectorAll('.trail-host').length, hosts: document.querySelectorAll('#trail-float').length, bubble: document.querySelectorAll('#trail-assistant').length }));
  await page.waitForFunction(() => document.querySelectorAll('.trail-host').length > 0, null, { timeout: 10000 }).catch(() => undefined);
  out.before = await count();
  if (!out.before.icons) errors.push('os ícones não apareceram antes do reload: ' + JSON.stringify(out.before));
  if (out.before.bubble !== 1) errors.push('esperava uma bolinha do Trail antes do reload: ' + JSON.stringify(out.before));
  const balloon = page.locator('#trail-assistant').locator('.balloon');
  await balloon.waitFor({ state: 'visible', timeout: 5000 });
  out.welcomeFirst = await balloon.textContent();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.trail-host').length > 0 && !!document.getElementById('trail-assistant'));
  await page.waitForTimeout(400);
  out.welcomeRepeated = await balloon.isVisible();
  if (out.welcomeRepeated) errors.push('boas-vindas repetidas ao recarregar o mesmo registro');
  const otherTab = await ctx.newPage();
  await otherTab.goto(`${ORIGIN}/incident.do?sys_id=${'b'.repeat(32)}`);
  await otherTab.waitForFunction(() => !!document.getElementById('trail-assistant'));
  await otherTab.waitForTimeout(350);
  if (await otherTab.locator('#trail-assistant').locator('.balloon').isVisible()) errors.push('boas-vindas repetidas em outra aba do mesmo registro');
  await otherTab.close();
  await page.goto(`${ORIGIN}/incident.do?sys_id=${'c'.repeat(32)}`);
  await balloon.waitFor({ state: 'visible', timeout: 5000 });
  out.welcomeOtherRecord = true;
  await page.goto(`${ORIGIN}/incident.do?sys_id=${'b'.repeat(32)}`);
  await page.waitForFunction(() => document.querySelectorAll('.trail-host').length > 0 && !!document.getElementById('trail-assistant'));
  await page.waitForTimeout(400);
  if (await balloon.isVisible()) errors.push('boas-vindas repetidas ao voltar ao primeiro registro');

  // Simula a falha de resposta do content sem recarregar a extensão: o worker deve
  // reinjetar na aba autorizada e abrir o painel, sem duplicar ícones ou a bolinha.
  await page.evaluate(() => document.dispatchEvent(new Event('trail:dispose-content')));
  await page.waitForFunction(() => !document.querySelector('.trail-host, #trail-assistant'));
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => chrome.runtime.sendMessage({ type: 'open-panel', mode: 'float' }) });
  });
  await page.waitForFunction(() => document.querySelectorAll('.trail-host').length > 0 && !!document.getElementById('trail-float'), null, { timeout: 10000 });
  out.reinjected = await count();
  if (out.reinjected.icons !== out.before.icons || out.reinjected.hosts !== 1 || out.reinjected.bubble !== 1) errors.push('reinjeção não recuperou uma interface única: ' + JSON.stringify(out.reinjected));
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'float-toggle', tabId: tab.id }, { frameId: 0 });
  });
  await page.waitForFunction(() => !document.getElementById('trail-float'));

  // Recarrega a extensão como o auto-reload faz.
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  // No Chromium do Playwright a extensão carregada por linha de comando não volta depois do reload; o que dá para
  // conferir aqui é a metade do script antigo: ele percebe que ficou órfão, limpa a página e não quebra nada.
  // A reinjeção pelo worker novo só se vê no navegador de verdade (pasta carregada sem compactação).
  await page.waitForTimeout(3500);
  out.after = await count();
  if (out.after.icons !== 0 || out.after.hosts !== 0 || out.after.bubble !== 0) errors.push('o script órfão não limpou a página: ' + JSON.stringify(out.after));
  // A página continua funcionando: mexer nos campos não pode disparar erro do script antigo.
  await page.fill('[id="incident.state"]', 'x');
  await page.waitForTimeout(500);
} finally {
  console.log(JSON.stringify({ ...out, errors }, null, 1));
  await ctx.close();
  if (errors.length) process.exitCode = 1;
}
