// Verifica a demonstração do site: clique em cada campo troca a análise; links não navegam;
// confere também #painel (sem sticky, linha do tempo vertical + autoplay), #tbl (10 exemplos),
// #faq (todos fechados) e #roadmap (5 visíveis + Ver mais).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../site');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp' };
const srv = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let p = join(root, urlPath); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(4481);
const S = process.argv[2] ? resolve(process.argv[2]) + '/' : '';
const b = await chromium.launch({ channel: 'chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('top: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|TUNNEL/.test(m.text()) && !/fonts\.googleapis\.com/.test(m.location().url || '')) errs.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())); });
const navs = [];
page.on('framenavigated', (f) => { if (f !== page.mainFrame() && !/localhost:4481/.test(f.url())) navs.push(f.url()); });
page.on('popup', (p) => navs.push('popup ' + p.url()));
await page.goto('http://localhost:4481/b3/');
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await page.mouse.move(100, 100);
await page.mouse.move(800, 500);
const background = await page.evaluate(() => ({
  scale: document.getElementById('trails').width / innerWidth,
  cursorGlow: document.querySelector('.glow').style.cssText,
}));
if (background.scale < .95) errs.push('canvas do fundo está sendo esticado no desktop: ' + background.scale);
if (background.cursorGlow) errs.push('luzes do fundo ainda seguem o cursor: ' + background.cursorGlow);
await page.locator('.compo').scrollIntoViewIfNeeded();
await page.waitForSelector('#cform[src]', { timeout: 10000 });
await page.waitForSelector('#cpanel[src]', { timeout: 10000 });
const panelFrame = await (await page.$('#cpanel')).contentFrame();
const formFrame = await (await page.$('#cform')).contentFrame();
await formFrame.waitForFunction(() => document.querySelectorAll('.trail-host').length > 0, null, { timeout: 10000 });
const results = {};
for (const field of ['priority', 'impact', 'category', 'severity', 'description', 'assignment_group', 'number', 'state']) {
  await formFrame.evaluate((f) => { document.querySelector(`label[for="incident.${f}"] .trail-host`).shadowRoot.querySelector('button').click(); }, field);
  await page.waitForTimeout(1900);
  results[field] = await panelFrame.evaluate(() => ({
    chg: document.querySelector('.headcard .chg')?.textContent?.trim()?.slice(0, 60),
    who: document.querySelector('.who .nm')?.textContent?.trim()?.slice(0, 60),
    cert: document.querySelector('.cert b')?.textContent,
  }));
  if (field === 'priority' && S) await page.locator('.compo').screenshot({ path: S + 'compo-priority.png' });
}
// links dentro do painel
await panelFrame.evaluate(() => document.querySelector('.btns a, .headcard a')?.click());
await page.waitForTimeout(300);
results.toast = await panelFrame.evaluate(() => document.querySelector('.toast')?.textContent);
results.panelUrlAfterClick = panelFrame.url().replace(/^.*\/demo/, '/demo');
// Cabeçalho do painel flutuante: engrenagem das configurações e o X que esconde na bolinha (sem as bolinhas do Mac).
const headBtns = await panelFrame.$$eval('.topbar .actions .icon-btn', (bs) => bs.map((b) => b.getAttribute('aria-label')));
if (!headBtns.includes('Configurações') || !headBtns.some((l) => l?.startsWith('Fechar'))) errs.push('cabeçalho do painel sem configurações ou sem o X: ' + JSON.stringify(headBtns));
// bolinha-assistente + balão no formulário (.compo .shot):
// boas-vindas fecham após 5s, depois o balão só aparece com o mouse em cima da bolinha
const balloonAfterWelcome = await page.$eval('#demo-balloon', (el) => el.hidden);
if (!balloonAfterWelcome) errs.push('balão de boas-vindas deveria ter fechado após 5s (uma vez por registro)');
await page.hover('#demo-bub');
await page.waitForTimeout(100);
const balloonOnHover = await page.$eval('#demo-balloon', (el) => !el.hidden && getComputedStyle(el).display !== 'none');
if (!balloonOnHover) errs.push('balão da bolinha-assistente deveria aparecer ao passar o mouse');
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const balloonAfterLeave = await page.$eval('#demo-balloon', (el) => el.hidden);
if (!balloonAfterLeave) errs.push('balão da bolinha-assistente deveria sumir ao tirar o mouse');
await page.click('#demo-bub');
await page.waitForTimeout(1000);
const recGroupTitle = await panelFrame.$eval('.bt-group summary', (el) => el.textContent.trim()).catch(() => '');
if (!recGroupTitle.includes('salvou')) errs.push('clique na bolinha-assistente não abriu Tudo que mudou em grupos: ' + recGroupTitle);
// galeria
for (const label of ['Registro inteiro', 'Lote', 'Flows', 'E se?', 'Opções', 'Painel · escuro']) {
  await page.click(`#galseg button:has-text("${label}")`);
  await page.waitForTimeout(900);
  if (label === 'Flows') {
    const galFrame = await (await page.$('#galimg')).contentFrame();
    const hasSubflow = await galFrame?.$eval('.fl-run.sub', (el) => el.textContent.includes('subflow')).catch(() => false);
    if (!hasSubflow) errs.push('galeria Flows sem subflow recuado abaixo do flow pai (.fl-run.sub)');
  }
}
await page.locator('#telas .gal').scrollIntoViewIfNeeded();
await page.click('#galseg button:has-text("Opções")'); await page.waitForTimeout(900);
if (S) await page.locator('#telas .gal').screenshot({ path: S + 'gal-options.png' });
await page.locator('#telas .story').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
if (S) await page.locator('#telas .story').screenshot({ path: S + 'gal-story.png' });

// dentro do painel (#painel): sem sticky, linha do tempo vertical e autoplay
await page.locator('#painel').scrollIntoViewIfNeeded();
const shotPosition = await page.$eval('#inside-shot', (el) => getComputedStyle(el).position);
if (shotPosition === 'sticky') errs.push('#inside-shot ainda está sticky');
for (const i of [0, 3, 4, 6, 7, 8, 9]) {
  await page.click(`.co >> nth=${i}`);
  await page.waitForTimeout(600);
}
const seenCount = await page.$$eval('#callouts .co.seen', (els) => els.length);
if (seenCount < 4) errs.push('esperava passos já vistos (.seen) marcados na linha do tempo, achei ' + seenCount);
await page.mouse.move(10, 10); // fora de #inside-box para o autoplay rodar
await page.click('.co >> nth=0');
await page.mouse.move(10, 10);
await page.waitForTimeout(1200);
const progVal = await page.$eval('.co.on', (el) => parseFloat(el.style.getPropertyValue('--p') || '0'));
if (!(progVal > 0)) errs.push('barra de progresso do autoplay não avançou: ' + progVal);
if (S) await page.locator('#painel').screenshot({ path: S + 'painel-timeline-1280.png' });

// tabela de casos (#tbl): dez exemplos, sem controles de expansão
await page.locator('#numeros').scrollIntoViewIfNeeded();
const tblInit = await page.$$eval('#tbl tbody tr', (rs) => rs.length);
const tblCases = await page.$$eval('#tbl tbody tr td:first-child', (cells) => cells.map((el) => el.textContent.trim()));
if (tblInit !== 10 || !tblCases.includes('F7-CUSTOM') || !tblCases.includes('C6')) errs.push('tabela de exemplos inesperada: ' + tblCases.join(', '));
if (await page.locator('#tbl-more, #tbl-less, #tbl-count').count()) errs.push('controles da tabela longa ainda aparecem');
if (S) await page.locator('#numeros').screenshot({ path: S + 'tbl-10.png' });

// FAQ (#faq): todos fechados no início
await page.locator('#faq').scrollIntoViewIfNeeded();
const faqOpen = await page.$$eval('#faq details[open]', (ds) => ds.length);
if (faqOpen !== 0) errs.push('FAQ deveria começar com 0 abertos, achei ' + faqOpen);
if (S) await page.locator('#faq').screenshot({ path: S + 'faq-closed.png' });

// Roadmap (#roadmap): no máximo 5 itens visíveis + Ver mais (+22) / Ver menos
await page.locator('#roadmap').scrollIntoViewIfNeeded();
const roadVis0 = await page.$$eval('#roadmap .now ul li', (lis) => lis.filter((li) => getComputedStyle(li).display !== 'none').length);
const roadBtn0 = await page.$eval('#roadmap .road-more', (b) => b.textContent.trim());
if (roadVis0 !== 5 || !roadBtn0.startsWith('Ver mais')) errs.push(`roadmap inicial inesperado: ${roadVis0} (${roadBtn0})`);
if (S) await page.locator('#roadmap').screenshot({ path: S + 'roadmap-collapsed.png' });
await page.click('#roadmap .road-more');
await page.waitForTimeout(200);
const roadVis1 = await page.$$eval('#roadmap .now ul li', (lis) => lis.filter((li) => getComputedStyle(li).display !== 'none').length);
const roadBtn1 = await page.$eval('#roadmap .road-more', (b) => b.textContent.trim());
if (roadVis1 <= 5 || roadBtn1 !== 'Ver menos') errs.push(`roadmap expandido inesperado: ${roadVis1} (${roadBtn1})`);
await page.click('#roadmap .road-more');

// Teste do seletor bilíngue (PT / EN):
// 1. Clicar em EN: idioma muda para en, textos atualizam, sem overflow
await page.setViewportSize({ width: 1280, height: 860 });
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(400);
await page.click('.lang-btn[data-lang="en"]');
await page.waitForTimeout(300);
const langEn = await page.evaluate(() => document.documentElement.lang);
const titleEn = await page.title();
const navTryEn = await page.$eval('nav .btn.sm', (el) => el.textContent.trim());
const tblRowEn = await page.$eval('#tbl tbody tr:first-child td:nth-child(2)', (el) => el.textContent.trim());
const roadBtnEn = await page.$eval('#roadmap .road-more', (el) => el.textContent.trim());
const roadItemEn = await page.$eval('#roadmap .now ul li[data-i18n="road_p1_l1"]', (el) => el.textContent.trim());
const beforeItemEn = await page.$eval('#antes ol li[data-i18n="antes_without_li1"]', (el) => el.textContent.trim());
const numbersIntroEn = await page.$eval('#numeros p[data-i18n="numeros_sub"]', (el) => el.textContent.trim());
const screensIntroEn = await page.$eval('#telas p[data-i18n="telas_sub"]', (el) => el.textContent.trim());
const advancedEn = await page.$eval('#telas p[data-i18n="telas_advanced"]', (el) => el.textContent.trim());
const traceEn = await page.$eval('#callouts [data-i18n="co4_b"]', (el) => el.textContent.trim());
if (langEn !== 'en') errs.push('ao clicar em EN, documentElement.lang não ficou "en": ' + langEn);
if (!titleEn.includes('Record Forensics')) errs.push('ao clicar em EN, título não mudou para inglês: ' + titleEn);
if (navTryEn !== 'Try it') errs.push('ao clicar em EN, botão do nav não mudou para "Try it": ' + navTryEn);
if (!tblRowEn.includes('resolves the incident')) errs.push('ao clicar em EN, exemplo da tabela não traduziu: ' + tblRowEn);
if (!roadBtnEn.startsWith('View more')) errs.push('ao clicar em EN, botão do roadmap não mudou para "View more...": ' + roadBtnEn);
if (!roadItemEn.includes('Works without admin')) errs.push('ao clicar em EN, item da Fase 1 do roadmap não mudou para inglês: ' + roadItemEn);
if (!beforeItemEn.startsWith('Open record history')) errs.push('ao clicar em EN, passos de comparação não mudaram para inglês: ' + beforeItemEn);
if (!numbersIntroEn.startsWith('We tested changes')) errs.push('ao clicar em EN, introdução dos resultados não mudou para inglês: ' + numbersIntroEn);
if (!screensIntroEn.startsWith('The bubble')) errs.push('ao clicar em EN, introdução da galeria não mudou para inglês: ' + screensIntroEn);
if (!advancedEn.includes('off by default')) errs.push('modo avançado não traduziu: ' + advancedEn);
if (!traceEn.includes('newest to oldest')) errs.push('ordem do Rastro não traduziu: ' + traceEn);

// Checar acesso direto via URL ?lang=en e persistência após reload em nova aba
const pageEn = await b.newPage();
await pageEn.goto('http://localhost:4481/b3/?lang=en');
await pageEn.waitForTimeout(300);
const langUrlEn = await pageEn.evaluate(() => document.documentElement.lang);
const navTryUrlEn = await pageEn.$eval('nav .btn.sm', (el) => el.textContent.trim());
const roadItemUrlEn = await pageEn.$eval('#roadmap .now ul li[data-i18n="road_p1_l1"]', (el) => el.textContent.trim());
if (langUrlEn !== 'en') errs.push('ao abrir direto com ?lang=en, lang não ficou "en": ' + langUrlEn);
if (navTryUrlEn !== 'Try it') errs.push('ao abrir direto com ?lang=en, nav não mostrou "Try it": ' + navTryUrlEn);
if (!roadItemUrlEn.includes('Works without admin')) errs.push('ao abrir direto com ?lang=en, roadmap não ficou em inglês: ' + roadItemUrlEn);

await pageEn.reload();
await pageEn.waitForTimeout(300);
const langReload = await pageEn.evaluate(() => document.documentElement.lang);
const roadItemReload = await pageEn.$eval('#roadmap .now ul li[data-i18n="road_p1_l1"]', (el) => el.textContent.trim());
if (langReload !== 'en') errs.push('após reload com ?lang=en / localStorage, idioma não persistiu em EN: ' + langReload);
if (!roadItemReload.includes('Works without admin')) errs.push('após reload, item do roadmap não permaneceu em inglês: ' + roadItemReload);
await pageEn.close();

// Checar overflow em EN no desktop e mobile
const overflow1280En = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
if (overflow1280En > 0) errs.push('overflow em 1280px com idioma EN: ' + overflow1280En);

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const overflow390En = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
if (overflow390En > 0) errs.push('overflow em 390px com idioma EN: ' + overflow390En);

// 2. Voltar para PT: idioma volta para pt-BR, textos restaurados
await page.setViewportSize({ width: 1280, height: 860 });
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(200);
await page.click('.lang-btn[data-lang="pt"]');
await page.waitForTimeout(300);
const langPt = await page.evaluate(() => document.documentElement.lang);
const navTryPt = await page.$eval('nav .btn.sm', (el) => el.textContent.trim());
const tblRowPt = await page.$eval('#tbl tbody tr:first-child td:nth-child(2)', (el) => el.textContent.trim());
const roadItemPt = await page.$eval('#roadmap .now ul li[data-i18n="road_p1_l1"]', (el) => el.textContent.trim());
if (langPt !== 'pt-BR') errs.push('ao clicar em PT, documentElement.lang não voltou para "pt-BR": ' + langPt);
if (navTryPt !== 'Experimentar') errs.push('ao clicar em PT, botão do nav não voltou para "Experimentar": ' + navTryPt);
if (!tblRowPt.includes('resolve o incidente')) errs.push('ao voltar para PT, exemplo da tabela não voltou para português: ' + tblRowPt);
if (!roadItemPt.includes('Funciona sem admin')) errs.push('ao voltar para PT, item do roadmap não voltou para português: ' + roadItemPt);

await page.setViewportSize({ width: 1280, height: 860 });
await page.waitForTimeout(200);

const brokenImgs = await page.$$eval('img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// Mobile 390px: sem rolagem horizontal e painel acima da linha do tempo em #painel
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const mobileBackgroundScale = await page.evaluate(() => document.getElementById('trails').width / innerWidth);
if (mobileBackgroundScale < .95) errs.push('canvas do fundo está sendo esticado no celular: ' + mobileBackgroundScale);
await page.locator('#painel').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const stack390 = await page.evaluate(() => {
  const s = document.getElementById('inside-shot').getBoundingClientRect();
  const c = document.getElementById('callouts').getBoundingClientRect();
  return { shotTop: Math.round(s.top), shotBottom: Math.round(s.bottom), calloutsTop: Math.round(c.top) };
});
if (!(stack390.calloutsTop >= stack390.shotBottom - 4)) errs.push('em 390px a linha do tempo não ficou abaixo do painel: ' + JSON.stringify(stack390));
if (S) await page.locator('#painel').screenshot({ path: S + 'painel-timeline-390.png' });

console.log(JSON.stringify({
  results,
  checks: { shotPosition, seenCount, progVal, tblInit, faqOpen, roadVis0, roadVis1, background, mobileBackgroundScale, stack390 },
  brokenImgs,
  overflow1280,
  overflow390,
  navs,
  errs,
}, null, 1));
await b.close(); srv.close();
if (errs.length) process.exit(1);
