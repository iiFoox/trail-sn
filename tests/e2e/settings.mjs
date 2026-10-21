// Configurações dentro do próprio painel (src/sidepanel/Settings.tsx):
// abre pela engrenagem, fecha só a folha no Esc, alterna Animações (data-motion + storage.sync),
// grava/restaura/desliga atalho (.st-key), troca modo do painel e muda para o tema Claro.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../extension/dist');
const userDir = mkdtempSync(resolve(tmpdir(), 'trail-settings-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  channel: 'chromium',
  locale: 'pt-BR', // sem idioma salvo, o Trail segue o idioma do navegador
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const errors = [];
const out = {};

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const readSyncPrefs = () => sw.evaluate(async () => (await chrome.storage.sync.get('trail.prefs'))['trail.prefs']);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?float=1&tab=1`);
  await page.waitForSelector('header.topbar');

  await page.evaluate(() => {
    window.__floatMsgs = [];
    window.addEventListener('message', (e) => {
      if (e.data && typeof e.data.type === 'string') window.__floatMsgs.push(e.data.type);
    });
  });

  // (1) Clicar na engrenagem abre .st-sheet; Esc fecha só a folha (sem mandar trail-float-close).
  await page.click('header.topbar button[aria-label="Configurações"]');
  await page.waitForSelector('.st-sheet');
  out.sheetOpened = (await page.locator('.st-sheet').count()) === 1;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  out.sheetClosedOnEsc = (await page.locator('.st-sheet').count()) === 0;
  const floatMsgsAfterEsc = await page.evaluate(() => window.__floatMsgs);
  out.floatClosedOnSheetEsc = floatMsgsAfterEsc.includes('trail-float-close');
  if (!out.sheetOpened) errors.push('engrenagem não abriu .st-sheet');
  if (!out.sheetClosedOnEsc) errors.push('Esc não fechou .st-sheet');
  if (out.floatClosedOnSheetEsc) errors.push('Esc com .st-sheet aberta disparou trail-float-close');

  // Reabre para os demais testes
  await page.click('header.topbar button[aria-label="Configurações"]');
  await page.waitForSelector('.st-sheet');

  // (2) Desligar 'Animações' põe data-motion='off' no <html> e grava motion=false; ligar de novo remove.
  const motionSwitch = page.locator('.st-row:has-text("Animações") button[role="switch"]');
  await motionSwitch.click();
  await page.waitForTimeout(200);
  out.motionOffAttr = await page.evaluate(() => document.documentElement.dataset.motion);
  out.motionOffSync = (await readSyncPrefs())?.motion;
  if (out.motionOffAttr !== 'off' || out.motionOffSync !== false) {
    errors.push(`desligar Animações falhou: data-motion=${out.motionOffAttr}, sync.motion=${out.motionOffSync}`);
  }
  await motionSwitch.click();
  await page.waitForTimeout(200);
  out.motionOnAttr = await page.evaluate(() => document.documentElement.dataset.motion ?? null);
  out.motionOnSync = (await readSyncPrefs())?.motion;
  if (out.motionOnAttr !== null || out.motionOnSync !== true) {
    errors.push(`religar Animações falhou: data-motion=${out.motionOnAttr}, sync.motion=${out.motionOnSync}`);
  }

  // (3) Gravar atalho: clicar em .st-key, apertar Control+Alt+K -> 'Ctrl+Alt+K' e grava panelKey;
  //     'Voltar ao padrão' -> 'Alt+Shift+P'; 'Desligar atalho' -> ''.
  await page.click('.st-key');
  await page.waitForTimeout(100);
  out.keyRecordingPrompt = (await page.textContent('.st-key'))?.trim();
  await page.keyboard.press('Control+Alt+k');
  await page.waitForTimeout(200);
  out.keyRecordedText = (await page.textContent('.st-key'))?.trim();
  out.keyRecordedSync = (await readSyncPrefs())?.panelKey;
  if (out.keyRecordedText !== 'Ctrl+Alt+K' || out.keyRecordedSync !== 'Ctrl+Alt+K') {
    errors.push(`gravar atalho falhou: texto="${out.keyRecordedText}", sync="${out.keyRecordedSync}"`);
  }

  const resetBtn = page.locator('.st-links button:has-text("Voltar ao padrão")');
  if (await resetBtn.count()) {
    await resetBtn.click();
    await page.waitForTimeout(200);
    out.keyResetText = (await page.textContent('.st-key'))?.trim();
    out.keyResetSync = (await readSyncPrefs())?.panelKey;
    if (out.keyResetText !== 'Alt+Shift+P' || out.keyResetSync !== 'Alt+Shift+P') {
      errors.push(`Voltar ao padrão falhou: texto="${out.keyResetText}", sync="${out.keyResetSync}"`);
    }
  } else {
    errors.push('botão "Voltar ao padrão" não apareceu após gravar Ctrl+Alt+K');
  }

  const offBtn = page.locator('.st-links button:has-text("Desligar atalho")');
  if ((await offBtn.count()) === 0) {
    errors.push('botão "Desligar atalho" não está visível quando o atalho é o padrão Alt+Shift+P (extension/src/sidepanel/Settings.tsx:79)');
    // Grava um atalho temporário para testar o clique em "Desligar atalho"
    await page.click('.st-key');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+Alt+k');
    await page.waitForTimeout(200);
  }
  if (await offBtn.count()) {
    await offBtn.click();
    await page.waitForTimeout(200);
    out.keyOffText = (await page.textContent('.st-key'))?.trim();
    out.keyOffSync = (await readSyncPrefs())?.panelKey;
    if (out.keyOffText !== 'Sem atalho' || out.keyOffSync !== '') {
      errors.push(`Desligar atalho falhou: texto="${out.keyOffText}", sync="${out.keyOffSync}"`);
    }
  }

  // (4) Trocar 'Onde o painel abre' para Lateral grava panelMode='side'.
  await page.click('[role="radiogroup"][aria-label="Onde o painel abre"] button:has-text("Lateral")');
  await page.waitForTimeout(200);
  out.panelModeSync = (await readSyncPrefs())?.panelMode;
  if (out.panelModeSync !== 'side') {
    errors.push(`trocar Onde o painel abre para Lateral falhou: sync.panelMode="${out.panelModeSync}"`);
  }

  // (5) Tema Claro põe data-theme='light'.
  await page.click('[role="radiogroup"][aria-label="Tema"] button:has-text("Claro")');
  await page.waitForTimeout(200);
  out.themeLightAttr = await page.evaluate(() => document.documentElement.dataset.theme);
  out.themeLightSync = (await readSyncPrefs())?.theme;
  if (out.themeLightAttr !== 'light' || out.themeLightSync !== 'light') {
    errors.push(`tema Claro falhou: data-theme="${out.themeLightAttr}", sync.theme="${out.themeLightSync}"`);
  }
} finally {
  await ctx.close();
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(JSON.stringify({ ...out, errors }, null, 1));
if (errors.length) process.exit(1);
