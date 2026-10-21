/**
 * Painel flutuante: abre do tamanho do painel lateral (altura toda, encostado na direita), carrega o painel no iframe,
 * arrasta pelo cabeçalho, encosta de novo ao soltar na borda, minimiza em bolinha e volta, fecha no X.
 * Roda numa página da própria extensão (o content script e o iframe ficam na mesma origem que a extensão).
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../extension/dist');
const shotDir = process.argv[2];
writeFileSync(resolve(dist, '_float-test.html'), '<!doctype html><meta charset="utf-8"><title>t</title><body style="margin:0;font:14px system-ui;background:#fff"><div style="padding:30px">Formulário de teste <input id="page-input" aria-label="Campo de teste"></div><script src="content.js"></script></body>');
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-float-')), { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
const errors = [];
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${id}/_float-test.html`);
  await page.waitForFunction(() => !!window.__trailFloat);
  const assistant = page.locator('#trail-assistant');
  const bubble = assistant.locator('.bub');
  await bubble.waitFor({ state: 'visible' });
  if (await page.locator('#trail-float').count()) errors.push('painel abriu antes do clique na bolinha');
  const balloon = assistant.locator('.balloon');
  await bubble.hover();
  await balloon.waitFor({ state: 'visible' });
  const overlaps = await page.evaluate(() => {
    const root = document.getElementById('trail-assistant').shadowRoot;
    const a = root.querySelector('.bub').getBoundingClientRect(), b = root.querySelector('.balloon').getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  if (overlaps) errors.push('balão cobre a bolinha');
  const tipBox = await balloon.boundingBox();
  await page.mouse.move(tipBox.x + tipBox.width / 2, tipBox.y + tipBox.height / 2);
  await page.waitForTimeout(220);
  if (!(await balloon.isVisible())) errors.push('dica sumiu ao mover o mouse para o balão');
  await page.mouse.move(150, 150);
  await page.waitForTimeout(220);
  if (await balloon.isVisible()) errors.push('dica não sumiu ao sair da bolinha e do balão');
  await bubble.hover();
  await balloon.waitFor({ state: 'visible' });
  await page.mouse.click(150, 150);
  if (await balloon.isVisible()) errors.push('clique fora não fechou o balão');
  const b0 = await bubble.boundingBox();
  await page.mouse.move(b0.x + 23, b0.y + 23);
  await page.mouse.down();
  // Solta no meio de baixo (ao lado de outro botão flutuante, como o virtual agent): fica ali, sem grudar na lateral.
  await page.mouse.move(640, 740, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const moved = await bubble.boundingBox();
  if (Math.abs(moved.x + 23 - 640) > 4 || Math.abs(moved.y + 23 - 740) > 4) errors.push('bolinha não ficou onde foi solta: ' + JSON.stringify(moved));
  await page.reload();
  await bubble.waitFor({ state: 'visible' });
  await page.waitForTimeout(450);
  const remembered = await bubble.boundingBox();
  if (Math.abs(remembered.x - moved.x) > 2 || Math.abs(remembered.y - moved.y) > 2) errors.push('posição da bolinha não foi lembrada: ' + JSON.stringify({ moved, remembered }));
  await page.setViewportSize({ width: 900, height: 600 });
  await page.waitForTimeout(450);
  const resized = await bubble.boundingBox();
  // Janela menor: continua na mesma proporção da tela (meio de baixo), inteira dentro dela.
  if (resized.x < 300 || resized.x > 560 || resized.y < 20 || resized.y + resized.height > 580) errors.push('bolinha saiu do lugar ou da tela após resize: ' + JSON.stringify(resized));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(450);
  await bubble.click();
  const pane = () => page.evaluate(() => { const p = document.getElementById('trail-float').shadowRoot.querySelector('.pane'); const r = p.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cls: p.className, shown: p.style.display !== 'none' }; });
  const dragGrip = async (selector, dx, dy) => {
    const box = await page.locator('#trail-float').locator(selector).boundingBox();
    if (!box) throw new Error('alça de tamanho não encontrada: ' + selector);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  await page.waitForTimeout(700);
  const opened = await pane();
  if (opened.w !== 420 || opened.h !== 800 - 16 || opened.x !== 1280 - 420 - 8 || opened.y !== 8) errors.push('não abriu do tamanho do painel lateral: ' + JSON.stringify(opened));
  const frame = page.frames().find((f) => f.url().includes('float=1'));
  if (!frame) throw new Error('iframe do painel não carregou');
  await frame.waitForSelector('header.topbar.drag');
  const nTop = await frame.$$eval('header.topbar', (h) => h.length);
  if (nTop !== 1) errors.push('esperava um cabeçalho só, achei ' + nTop);
  // Cabeçalho: sem as bolinhas do Mac; à direita, nesta ordem, configurações, painel lateral, tema e fechar.
  const actions = await frame.$$eval('header.topbar .actions .icon-btn', (bs) => bs.map((b) => b.getAttribute('aria-label')));
  const want = ['Configurações', 'Abrir no painel lateral do Edge', 'Alternar tema claro/escuro', 'Fechar (fica a bolinha no canto)'];
  if (JSON.stringify(actions) !== JSON.stringify(want)) errors.push('botões do cabeçalho fora da ordem: ' + JSON.stringify(actions));
  if (await frame.locator('header.topbar .lights').count()) errors.push('as bolinhas do Mac ainda estão no cabeçalho');
  // A engrenagem abre as configurações dentro do painel; Esc fecha só a folha.
  await frame.click('header.topbar button[aria-label="Configurações"]');
  await frame.waitForSelector('.st-sheet');
  await frame.press('.st-sheet', 'Escape');
  await page.waitForTimeout(300);
  if (await frame.locator('.st-sheet').count()) errors.push('Esc não fechou as configurações');
  if (!(await page.evaluate(() => !!document.getElementById('trail-float')))) errors.push('Esc nas configurações fechou o painel junto');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-open.png') });
  // A borda de baixo reduz a altura sem tirar o painel da direita.
  await dragGrip('.rz.s', 0, -180);
  const short = await pane();
  if (short.h >= opened.h - 100 || short.x !== opened.x || short.y !== 8 || short.cls.includes('free')) errors.push('borda de baixo não redimensionou encostado: ' + JSON.stringify(short));
  await dragGrip('.rz.s', 0, 240);
  const full = await pane();
  if (full.h !== opened.h || full.x !== opened.x) errors.push('borda de baixo não voltou à altura toda: ' + JSON.stringify(full));
  // Arrasta pelo cabeçalho para o meio da tela: vira cartão solto.
  const hb = await (await frame.$('header.topbar')).boundingBox();
  await page.mouse.move(hb.x + 120, hb.y + 15);
  await page.mouse.down();
  await page.mouse.move(hb.x - 200, hb.y + 120, { steps: 8 });
  await page.waitForTimeout(80);
  await page.mouse.move(hb.x - 400, hb.y + 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const free = await pane();
  if (!free.cls.includes('free') || free.x > 700 || free.y < 20) errors.push('arrastar não soltou o painel: ' + JSON.stringify(free));
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-free.png') });
  // O canto muda as duas dimensões; no limite, para em 340 × 260.
  await dragGrip('.rz.nw', 200, 500);
  const smallest = await pane();
  if (smallest.w !== 340 || smallest.h !== 260 || !smallest.cls.includes('free')) errors.push('canto não respeitou os mínimos: ' + JSON.stringify(smallest));
  await dragGrip('.rz.nw', -80, -100);
  const larger = await pane();
  if (larger.w <= smallest.w || larger.h <= smallest.h) errors.push('canto não aumentou largura e altura: ' + JSON.stringify(larger));
  // Solta na borda esquerda: encosta lá, altura toda.
  const hb2 = await (await frame.$('header.topbar')).boundingBox();
  await page.mouse.move(hb2.x + 100, hb2.y + 15);
  await page.mouse.down();
  await page.mouse.move(60, 300, { steps: 6 });
  await page.mouse.move(5, 300, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  const left = await pane();
  if (!left.cls.includes('left') || left.x !== 8 || left.h !== 800 - 16) errors.push('não encostou na esquerda: ' + JSON.stringify(left));
  // Duplo clique no cabeçalho: volta para a direita.
  await frame.dblclick('header.topbar .host, header.topbar', { position: { x: 160, y: 15 } }).catch(() => frame.dblclick('header.topbar'));
  await page.waitForTimeout(450);
  const back = await pane();
  if (back.x !== 1280 - 420 - 8 || back.cls.includes('left')) errors.push('duplo clique não encostou na direita: ' + JSON.stringify(back));
  // A setinha esconde o painel na bolinha do Trail; a bolinha traz de volta encostado na direita.
  await page.locator('#trail-float').locator('.tab').click();
  await page.waitForTimeout(450);
  const shut = await page.evaluate(() => {
    const root = document.getElementById('trail-float').shadowRoot;
    return { shown: root.querySelector('.pane').style.display !== 'none', bubble: !document.getElementById('trail-assistant').shadowRoot.querySelector('.bub').hidden };
  });
  if (shut.shown || !shut.bubble) errors.push('setinha não virou a bolinha: ' + JSON.stringify(shut));
  await bubble.click();
  await page.waitForTimeout(450);
  const unshut = await pane();
  if (!unshut.shown || unshut.x !== 1280 - unshut.w - 8) errors.push('a bolinha não trouxe o painel de volta pela setinha: ' + JSON.stringify(unshut));
  // O X esconde na bolinha.
  await frame.click(`header.topbar button[aria-label="Fechar (fica a bolinha no canto)"]`);
  await page.waitForTimeout(450);
  const mini = await pane();
  const bub = await bubble.isVisible();
  if (mini.shown || !bub) errors.push('minimizar não virou bolinha');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'float-mini.png') });
  await bubble.click();
  await page.waitForTimeout(400);
  const again = await pane();
  if (!again.shown || again.w !== 420) errors.push('a bolinha não trouxe o painel de volta: ' + JSON.stringify(again));
  // Esc dentro do painel fecha de vez; a bolinha fica.
  await frame.press('header.topbar', 'Escape');
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => !document.getElementById('trail-float'));
  if (!gone) errors.push('o Esc não fechou');
  if (!(await bubble.isVisible())) errors.push('o Esc não devolveu a bolinha');
  // Reabrir: volta ao tamanho padrão mesmo depois de ter mexido.
  await page.evaluate(() => window.__trailFloat.openFloat(1, { theme: 'light' }));
  await page.waitForTimeout(600);
  const re = await pane();
  if (re.w !== 420 || re.x !== 1280 - 420 - 8 || re.h !== 800 - 16) errors.push('reabrir não voltou ao tamanho do painel: ' + JSON.stringify(re));
  // Esc no campo da página não fecha; fora dele, fecha.
  await page.locator('#page-input').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  if (!(await page.locator('#trail-float').count())) errors.push('Esc dentro de input fechou o painel');
  await page.mouse.click(70, 130);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  if (await page.locator('#trail-float').count()) errors.push('Esc na página não fechou o painel');
  if (!(await bubble.isVisible())) errors.push('Esc na página não devolveu a bolinha');
  // Esc dentro do iframe também fecha pelo aviso enviado à página.
  const frameReady = page.waitForEvent('framenavigated', { predicate: (f) => f.url().includes('float=1'), timeout: 5000 });
  await page.evaluate(() => window.__trailFloat.openFloat(1, { theme: 'dark' }));
  const escapeFrame = await frameReady;
  await escapeFrame.waitForSelector('header.topbar .fname');
  await escapeFrame.locator('header.topbar .fname').press('Escape');
  await page.waitForTimeout(350);
  if (await page.locator('#trail-float').count()) errors.push('Esc dentro do iframe não fechou o painel');
  await page.evaluate(async () => {
    const key = 'trail.prefs', p = (await chrome.storage.sync.get(key))[key] ?? {};
    await chrome.storage.sync.set({ [key]: { ...p, showBubble: false } });
  });
  await page.waitForTimeout(150);
  if (await bubble.isVisible()) errors.push('desligar a bolinha nas opções não a escondeu');
  await page.evaluate(async () => {
    const key = 'trail.prefs', p = (await chrome.storage.sync.get(key))[key] ?? {};
    await chrome.storage.sync.set({ [key]: { ...p, showBubble: true } });
  });
  await bubble.waitFor({ state: 'visible' });
  console.log(JSON.stringify({ opened, short, full, free, smallest, larger, left, back, shut, unshut, again, re, errors }, null, 1));
} finally {
  await ctx.close();
  rmSync(resolve(dist, '_float-test.html'), { force: true });
}
if (errors.length) process.exit(1);
