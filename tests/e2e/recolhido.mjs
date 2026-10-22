/**
 * Tudo recolhido (demo): em todas as abas, menos o Rastro, toda lista ou bloco com itens começa fechado, mostrando só o
 * cabeçalho (título, resumo e contagem à direita). Abrir e fechar funciona pelo clique e pelo teclado; o Rastro continua aberto.
 * Com `--shots <pasta>`, salva prints (420 px, escuro) de Provas, Histórico (registro inteiro) e Flows no estado inicial.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : '';
if (shots) mkdirSync(shots, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-fold-')), { headless: true, channel: 'chromium', locale: 'pt-BR', colorScheme: 'dark', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
const out = {};
/** Itens de lista: nenhum pode estar à vista antes de a pessoa abrir alguma coisa. */
const ITEMS = ['.li.fact', '.fl-run', '.fl-def', '.hist .h', 'ol.rtl ul.fl > li', 'details.grp > .li', '.lane .li', '.acc-list > div', '.alt-row',
  '.rr-row', '.bt-row', '.sim-row', '.lk-row', '.wi-result .li', '.wi-phase .li', '.conflict .li', '.why-not .li', '.missing .li'].join(', ');
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.setViewportSize({ width: 420, height: 900 });
  const base = `chrome-extension://${id}/src/sidepanel/index.html?demo=1&lang=pt&theme=dark`;

  /** Na área indicada: nada aberto, nenhum item à vista e todo recolhível com a seta. */
  const closed = async (name, scope = 'main.wrap') => {
    const st = await page.evaluate(({ scope, ITEMS }) => {
      const root = document.querySelector(scope);
      const vis = (el) => el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
      const ds = [...root.querySelectorAll('details')].filter((d) => !d.classList.contains('drawer') && !d.classList.contains('captech'));
      return {
        folds: ds.length,
        open: ds.filter((d) => d.open).map((d) => d.className),
        items: [...root.querySelectorAll(ITEMS)].filter(vis).map((el) => el.className || el.tagName),
        noCaret: ds.filter((d) => !d.querySelector(':scope > summary .caret')).map((d) => d.className),
      };
    }, { scope, ITEMS });
    out[name] = { folds: st.folds };
    if (!st.folds) errors.push(`${name}: nenhuma seção recolhível`);
    if (st.open.length) errors.push(`${name}: veio aberto: ` + JSON.stringify(st.open));
    if (st.items.length) errors.push(`${name}: itens à vista sem abrir: ` + JSON.stringify(st.items.slice(0, 6)));
    if (st.noCaret.length) errors.push(`${name}: recolhível sem a seta ▸: ` + JSON.stringify(st.noCaret));
  };
  const toggles = async (name, summary, inner) => {
    const s = page.locator(summary).first();
    await s.click();
    await page.waitForTimeout(350);
    const seen = () => page.locator(inner).first().evaluate((el) => el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }));
    if (!(await s.evaluate((x) => x.parentElement.open)) || !(await page.locator(inner).first().isVisible()) || !(await seen())) errors.push(`${name}: não abriu pelo clique`);
    await s.click();
    await page.waitForTimeout(350);
    if (await s.evaluate((x) => x.parentElement.open) || await seen()) errors.push(`${name}: não fechou pelo clique`);
    // Teclado: o cabeçalho recebe foco e abre com Enter.
    await s.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    if (!(await s.evaluate((x) => x.parentElement.open))) errors.push(`${name}: não abriu pelo teclado`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  };

  // Resposta: a resposta principal fica à vista; nada de lista aberta.
  await page.goto(`${base}&field=state&tab=answer`);
  await page.waitForSelector('.tabpane .who');
  if (!(await page.locator('.tabpane .plain').isVisible())) errors.push('Resposta: frase para o usuário sumiu');
  out.answerOpen = await page.locator('.tabpane details[open]').count();
  if (out.answerOpen) errors.push('Resposta: algo veio aberto');

  // Rastro: continua aberto, com os passos à vista.
  await page.goto(`${base}&field=state&tab=trace`);
  await page.waitForSelector('ol.tl > li');
  out.traceSteps = await page.locator('ol.tl > li').evaluateAll((ls) => ls.filter((l) => l.getBoundingClientRect().height > 0).length);
  if (out.traceSteps < 2) errors.push('Rastro deixou de vir aberto: ' + out.traceSteps);
  if (await page.locator('.tabpane details').count()) errors.push('Rastro ganhou recolhível');

  // Provas: tudo recolhido, com resumo no cabeçalho.
  await page.goto(`${base}&field=state&tab=proof`);
  await page.waitForSelector('.tabpane .why-this');
  await page.waitForTimeout(500);
  await closed('provas', '.tabpane');
  out.proofHeads = await page.$$eval('.tabpane > .stack > .box', (bs) => bs.map((b) => (b.querySelector('summary') ?? b.querySelector('h4')).innerText.replace(/\s+/g, ' ').trim()));
  if (!out.proofHeads.some((h) => /^Por que esta resposta .*\d+ provas$/.test(h))) errors.push('Provas: cabeçalho "Por que esta resposta · N provas": ' + JSON.stringify(out.proofHeads));
  if (!out.proofHeads.some((h) => h.startsWith('Por que não foi admin'))) errors.push('Provas: sem "Por que não foi admin"');
  if (!out.proofHeads.some((h) => h.includes('O que pode estar faltando'))) errors.push('Provas: sem "O que pode estar faltando"');
  if (shots) { await page.waitForTimeout(1200); await page.screenshot({ path: resolve(shots, 'provas.png'), fullPage: true }); }
  await toggles('Por que esta resposta', '.why-this > summary', '.why-this .li.fact');
  // Tudo que pode gravar: abre, roda e mostra a contagem no cabeçalho.
  await page.click('.fmap > summary');
  await page.click('.fmap .btn');
  await page.waitForSelector('.fmap .lane', { timeout: 5000 }).catch(() => errors.push('Tudo que pode gravar não rodou'));
  if (!(await page.locator('.fmap > summary .cnt').count())) errors.push('Tudo que pode gravar sem contagem depois de rodar');

  // Histórico do campo: a lista recolhida mostra a mudança atual; aberta, ↑ ↓ trocam sem recolher.
  await page.goto(`${base}&field=state&tab=history`);
  await page.waitForSelector('.tabpane .hist-fold');
  await closed('historico-campo', '.tabpane');
  out.histHead = (await page.locator('.hist-fold > summary').innerText()).replace(/\s+/g, ' ');
  if (!/→/.test(out.histHead)) errors.push('Histórico do campo sem a mudança atual no resumo: ' + out.histHead);
  await toggles('Mudanças do campo', '.hist-fold > summary', '.hist .h');
  await page.locator('.hist-fold > summary').click();
  await page.waitForTimeout(300);
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  if (!(await page.locator('.hist-fold').evaluate((d) => d.open))) errors.push('↓ no histórico recolheu a lista');

  // Histórico do registro inteiro: cada gravação recolhida (data, quem, via, "N campos"); filtros à vista.
  await page.goto(`${base}&field=state&tab=history&hist=record`);
  await page.waitForSelector('ol.rtl > li');
  await page.waitForTimeout(500);
  await closed('historico-registro', '.tabpane');
  for (const sel of ['.tlf .chips', '.tlf input[type="search"]', '.cmpbar button']) if (!(await page.locator(sel).first().isVisible())) errors.push('filtro escondido no registro inteiro: ' + sel);
  out.saveHead = (await page.locator('ol.rtl > li:first-child summary').innerText()).replace(/\s+/g, ' ').trim();
  if (!/\d+ campos?$/.test(out.saveHead)) errors.push('gravação sem "N campos" no cabeçalho: ' + out.saveHead);
  if (shots) { await page.waitForTimeout(1200); await page.screenshot({ path: resolve(shots, 'historico-registro.png'), fullPage: true }); }
  await toggles('Gravação', 'ol.rtl > li:first-child summary', 'ol.rtl > li:first-child ul.fl > li');
  // Busca: o que achou já vem aberto.
  await page.fill('.tlf input[type="search"]', 'prior');
  await page.waitForTimeout(300);
  if (!(await page.locator('ol.rtl > li').count()) || await page.locator('ol.rtl details.sv:not([open])').count()) errors.push('busca no registro inteiro não abriu as gravações achadas');

  // Flows: as duas listas recolhidas, com a contagem.
  await page.goto(`${base}&field=state&tab=flows`);
  await page.waitForSelector('.fl-ran');
  await closed('flows', '.tabpane');
  out.flowHeads = await page.$$eval('.flows > .box > summary', (ss) => ss.map((s) => s.innerText.replace(/\s+/g, ' ').trim()));
  if (out.flowHeads.length !== 2 || !out.flowHeads[0].startsWith('Rodaram neste registro') || !out.flowHeads[1].startsWith('Configurados para incident')) errors.push('cabeçalhos dos Flows: ' + JSON.stringify(out.flowHeads));
  if (shots) { await page.waitForTimeout(1200); await page.screenshot({ path: resolve(shots, 'flows.png'), fullPage: true }); }
  await toggles('Rodaram neste registro', '.fl-ran > summary', '.fl-run');

  // E se?: campo e botão à vista; os resultados recolhidos.
  await page.goto(`${base}&field=state&tab=whatif`);
  await page.waitForSelector('.wi-in input');
  await page.click('.wi-in input');
  await page.locator('.combo-list li').first().click();
  await page.click('.wi-in .btn.primary');
  await page.waitForSelector('.wi-result', { timeout: 5000 });
  if (!(await page.locator('.wi-in input').isVisible())) errors.push('E se?: o campo de valor sumiu');
  await closed('e-se', '.tabpane');
  await toggles('Passos da previsão', '.wi-phase > summary', '.wi-phase .li');

  // Registro inteiro (gaveta): grupos e "O que roda neste registro" recolhidos.
  await page.goto(`${base}&batch=rec`);
  await page.waitForSelector('.batch .bt-group');
  await page.waitForSelector('.rruns > summary .cnt', { timeout: 5000 });
  await closed('registro-inteiro', '.batch');
  await toggles('O que roda neste registro', '.rruns > summary', '.rruns details.grp');

  // Aba Avançado: as seções e as listas de dentro começam recolhidas.
  await page.goto(`${base}&field=state&advanced=1&tab=advanced`);
  await page.waitForSelector('.adv');
  await closed('avancado', '.tabpane');
  for (const sec of ['#adv-lock', '#adv-writers', '#adv-deps', '#adv-save']) {
    await page.click(`${sec} > summary`);
    await page.waitForTimeout(sec === '#adv-lock' ? 600 : 900);
  }
  await page.waitForSelector('#adv-writers .writers', { timeout: 8000 }).catch(() => errors.push('Quem grava não carregou'));
  await page.waitForTimeout(600);
  out.advInnerOpen = await page.$$eval('.adv-body details', (ds) => ds.filter((d) => d.open).map((d) => d.className));
  out.advInner = await page.locator('.adv-body details').count();
  if (!out.advInner) errors.push('Avançado: nenhuma lista interna para conferir');
  if (out.advInnerOpen.length) errors.push('Avançado: lista interna veio aberta: ' + JSON.stringify(out.advInnerOpen));
} catch (e) {
  errors.push('exceção: ' + e.message);
}
console.log(JSON.stringify({ ...out, errors }, null, 1));
await ctx.close();
process.exit(errors.length ? 1 : 0);
