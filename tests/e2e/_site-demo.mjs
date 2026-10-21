// Verifica a demonstração do site: clique em cada campo troca a análise; links não navegam;
// confere também #painel (sem sticky, linha do tempo vertical + autoplay), #tbl (30 de 441 + Ver mais),
// #faq (todos fechados) e #roadmap (5 visíveis + Ver mais).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../site');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let p = join(root, urlPath); if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html'); if (!existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(4481);
const S = process.argv[2] ? resolve(process.argv[2]) + '/' : '';
const b = await chromium.launch({ channel: 'chromium' });
const page = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('top: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|TUNNEL/.test(m.text())) errs.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())); });
const navs = [];
page.on('framenavigated', (f) => { if (f !== page.mainFrame() && !/localhost:4481/.test(f.url())) navs.push(f.url()); });
page.on('popup', (p) => navs.push('popup ' + p.url()));
await page.goto('http://localhost:4481/b3/');
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
await page.locator('.compo').scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
const panelFrame = await (await page.$('#cpanel')).contentFrame();
const formFrame = await (await page.$('#cform')).contentFrame();
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
const macLights = await panelFrame.$$eval('.topbar .lights .light', (ls) => ls.length);
if (macLights !== 3) errs.push('esperava 3 bolinhas estilo Mac no topo do painel flutuante, achei ' + macLights);
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
for (const label of ['Registro inteiro', 'Lote', 'E se?', 'Popup', 'Opções', 'Painel · escuro', 'Painel · claro']) {
  await page.click(`#galseg button:has-text("${label}")`);
  await page.waitForTimeout(900);
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
for (const i of [0, 3, 4, 6, 7, 8]) {
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

// tabela de casos (#tbl): 30 iniciais, Ver mais (+30), Ver menos
await page.locator('#numeros').scrollIntoViewIfNeeded();
const tblInit = await page.$$eval('#tbl tbody tr', (rs) => rs.length);
const tblTxt0 = await page.$eval('#tbl-count', (el) => el.textContent.trim());
if (tblInit !== 30 || tblTxt0 !== 'Mostrando 30 de 441') errs.push(`tabela inicial inesperada: ${tblInit} (${tblTxt0})`);
if (S) await page.locator('#numeros').screenshot({ path: S + 'tbl-30.png' });
await page.click('#tbl-more');
await page.waitForTimeout(200);
const tblAfter1 = await page.$$eval('#tbl tbody tr', (rs) => rs.length);
const tblTxt1 = await page.$eval('#tbl-count', (el) => el.textContent.trim());
if (tblAfter1 !== 60 || tblTxt1 !== 'Mostrando 60 de 441') errs.push(`tabela após 1 clique: ${tblAfter1} (${tblTxt1})`);
await page.click('#tbl-less');
await page.waitForTimeout(200);
const tblReset = await page.$$eval('#tbl tbody tr', (rs) => rs.length);
if (tblReset !== 30) errs.push('Ver menos não voltou para 30 linhas: ' + tblReset);

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

const brokenImgs = await page.$$eval('img', (is) => is.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const overflow1280 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

// Mobile 390px: sem rolagem horizontal e painel acima da linha do tempo em #painel
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow390 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
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
  checks: { shotPosition, seenCount, progVal, tblInit, tblAfter1, tblReset, faqOpen, roadVis0, roadVis1, stack390 },
  brokenImgs,
  overflow1280,
  overflow390,
  navs,
  errs,
}, null, 1));
await b.close(); srv.close();
if (errs.length) process.exit(1);
