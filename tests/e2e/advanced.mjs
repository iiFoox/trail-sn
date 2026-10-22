/**
 * Modo avançado (demo): desligado por padrão, o painel é o da 1.0.0 (seis abas, nenhuma ferramenta nova à vista);
 * ligado nas Configurações, ganha a aba "Avançado" no fim, com as seções recolhidas que só carregam ao abrir.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-adv-')), { headless: true, channel: 'chromium', locale: 'pt-BR', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
const out = {};
const NEW_STUFF = '.adv, .lk-card, .lk-list, #who-sees, .st-now, .writers, .deps, .save-card, .tool-panel, .cmp-tool, .lk-check, .acc-chip';
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.setViewportSize({ width: 420, height: 900 });
  const base = `chrome-extension://${id}/src/sidepanel/index.html?demo=1&lang=pt`;

  // 1) Desligado (padrão): as seis abas da 1.0.0 e nada das ferramentas novas, em nenhuma aba nem no registro inteiro.
  await page.goto(`${base}&field=state`);
  await page.waitForSelector('.seg-tabs button');
  out.tabsOff = await page.$$eval('.seg-tabs button', (bs) => bs.map((b) => b.textContent.replace(/\d+$/, '').trim()));
  if (JSON.stringify(out.tabsOff) !== JSON.stringify(['Resposta', 'Rastro', 'Provas', 'Histórico', 'Flows', 'E se?'])) errors.push('abas do modo padrão diferentes da 1.0.0: ' + JSON.stringify(out.tabsOff));
  for (let i = 0; i < out.tabsOff.length; i++) {
    await page.locator('.seg-tabs button').nth(i).click();
    await page.waitForTimeout(500);
    const n = await page.locator(NEW_STUFF).count();
    if (n) errors.push(`ferramenta nova visível com o modo avançado desligado (aba ${out.tabsOff[i]}): ${n}`);
  }
  await page.goto(`${base}&batch=rec`);
  await page.waitForSelector('.batch .bt-group');
  await page.waitForTimeout(600);
  if (await page.locator(NEW_STUFF).count()) errors.push('registro inteiro mostra ferramenta nova com o modo avançado desligado');
  // A gaveta "Investigar" é a da 1.0.0: tabela, campo e registro, sem "Por que está bloqueado?".
  await page.goto(`${base}&empty=1`);
  await page.waitForSelector('details.drawer[open]');
  out.drawer = await page.$$eval('details.drawer .field label', (ls) => ls.map((l) => l.textContent));
  if (JSON.stringify(out.drawer) !== JSON.stringify(['Tabela', 'Campo', 'Número ou sys_id'])) errors.push('gaveta diferente da 1.0.0: ' + JSON.stringify(out.drawer));

  // 2) A chave nas Configurações liga e desliga a aba "Avançado" na hora.
  await page.goto(`${base}&field=state`);
  await page.waitForSelector('.seg-tabs button');
  await page.click('header .icon-btn[aria-label="Configurações"]');
  const sw2 = page.locator('.st-row', { hasText: 'Modo avançado' }).locator('[role="switch"]');
  if (await sw2.getAttribute('aria-checked') !== 'false') errors.push('Modo avançado não começa desligado');
  await sw2.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  out.tabsOn = await page.$$eval('.seg-tabs button', (bs) => bs.map((b) => b.textContent.replace(/\d+$/, '').trim()));
  if (out.tabsOn[out.tabsOn.length - 1] !== 'Avançado' || out.tabsOn.length !== 7) errors.push('aba Avançado não apareceu no fim: ' + JSON.stringify(out.tabsOn));
  await page.click('header .icon-btn[aria-label="Configurações"]');
  await sw2.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('.seg-tabs button', { hasText: 'Avançado' }).count()) errors.push('aba Avançado continuou depois de desligar');

  // 3) Ligado: a aba Avançado com as oito seções, todas recolhidas e sem conteúdo montado (nada consultado).
  await page.goto(`${base}&field=state&advanced=1&tab=advanced`);
  await page.waitForSelector('.adv');
  out.sections = await page.$$eval('.adv > details > summary', (ss) => ss.map((s) => s.querySelector('.grow')?.textContent?.trim() ?? s.textContent.trim()));
  const want = ['Por que está bloqueado, obrigatório ou escondido', 'Quem grava', 'Quem depende', 'Simular um valor', 'Comparar com outra instância', 'Tempo do salvamento', 'Quem enxerga este registro', 'Campos bloqueados do registro'];
  if (JSON.stringify(out.sections) !== JSON.stringify(want)) errors.push('seções do Avançado: ' + JSON.stringify(out.sections));
  if (await page.locator('.adv > details[open]').count()) errors.push('alguma seção do Avançado veio aberta');
  if (await page.locator('.adv .adv-body, .adv .st-now, .adv .save-card, .adv .tool-panel').count()) errors.push('conteúdo montado antes de abrir a seção');
  if (await page.locator('.adv > details .caret').count() !== want.length) errors.push('seção sem a seta única');
  // Contagem só à direita, e só depois de carregar.
  if (await page.locator('.adv > details > summary .cnt').count()) errors.push('contagem antes de carregar');
  // Abrir e fechar: Por que está bloqueado.
  await page.click('#adv-lock > summary');
  await page.waitForSelector('#adv-lock .st-now', { timeout: 5000 }).catch(() => errors.push('estado agora não carregou ao abrir'));
  await page.click('#adv-lock > summary');
  await page.waitForTimeout(400);
  if (await page.locator('#adv-lock').evaluate((d) => d.open)) errors.push('seção não fechou');
  // Quem grava: carrega e mostra a contagem à direita (Quem depende aproveita a mesma leitura).
  await page.click('#adv-writers > summary');
  await page.waitForSelector('#adv-writers .writers', { timeout: 8000 }).catch(() => errors.push('Quem grava não carregou'));
  out.writersCount = await page.locator('#adv-writers > summary .cnt').textContent().catch(() => null);
  out.depsCount = await page.locator('#adv-deps > summary .cnt').textContent().catch(() => null);
  if (!out.writersCount || !out.depsCount) errors.push('contagens de Quem grava / Quem depende: ' + JSON.stringify([out.writersCount, out.depsCount]));
  // Simular: abre a ferramenta; o ✕ dela recolhe a seção.
  await page.click('#adv-sim > summary');
  await page.waitForSelector('#adv-sim .tool-panel.sim');
  await page.click('#adv-sim .tool-panel .drawer-x');
  await page.waitForTimeout(400);
  if (await page.locator('#adv-sim').evaluate((d) => d.open)) errors.push('✕ do Simular não recolheu a seção');
  // Campos bloqueados do registro: carrega só ao abrir.
  await page.click('.adv details.lk-list > summary');
  await page.waitForSelector('.adv details.lk-list .lk-row', { timeout: 8000 }).catch(() => errors.push('Campos bloqueados não carregou ao abrir'));
  // Registro inteiro com o modo ligado: a lista dos campos bloqueados aparece, recolhida.
  await page.goto(`${base}&batch=rec&advanced=1`);
  await page.waitForSelector('.batch .bt-group');
  if (await page.locator('details.lk-list').count() !== 1) errors.push('registro inteiro sem Campos bloqueados no modo avançado');
  else if (await page.locator('details.lk-list').evaluate((d) => d.open)) errors.push('Campos bloqueados do registro deveria vir recolhido');

  // 4) Fora do demo: a chave grava a preferência (desligada por padrão) e vale depois de recarregar.
  await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?lang=pt`);
  await page.waitForSelector('.topbar');
  out.storedBefore = await page.evaluate(async () => (await chrome.storage.sync.get('trail.prefs'))['trail.prefs']?.advanced ?? null);
  await page.click('header .icon-btn[aria-label="Configurações"]');
  await page.locator('.st-row', { hasText: 'Modo avançado' }).locator('[role="switch"]').click();
  await page.waitForTimeout(400);
  out.storedAfter = await page.evaluate(async () => (await chrome.storage.sync.get('trail.prefs'))['trail.prefs']?.advanced ?? null);
  if (out.storedBefore === true || out.storedAfter !== true) errors.push('preferência advanced não gravou: ' + JSON.stringify([out.storedBefore, out.storedAfter]));
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.click('header .icon-btn[aria-label="Configurações"]');
  if (await page.locator('.st-row', { hasText: 'Modo avançado' }).locator('[role="switch"]').getAttribute('aria-checked') !== 'true') errors.push('Modo avançado não continuou ligado depois de recarregar');
} catch (e) {
  errors.push('exceção: ' + e.message);
}
console.log(JSON.stringify({ ...out, errors }, null, 1));
await ctx.close();
process.exit(errors.length ? 1 : 0);
