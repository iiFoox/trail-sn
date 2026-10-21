/**
 * "Por que está bloqueado?" (demo): cartão no topo + aba "Bloqueio?", conflito por ordem, lista do registro inteiro
 * (inclusive escondidos), sem acesso (itil), gaveta "Um campo" e largura de 420/340 px sem rolagem lateral.
 * `SHOTS=<pasta>` também salva os prints (claro e escuro, 420 px).
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../extension/dist');
const shots = process.env.SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const errors = [];
const out = {};
for (const scheme of shots ? ['light', 'dark'] : ['light']) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-lock-')), { headless: true, channel: 'chromium', colorScheme: scheme, deviceScaleFactor: shots ? 2 : 1, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
  try {
    let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('page: ' + e.message));
    const base = `chrome-extension://${id}/src/sidepanel/index.html?demo=1&float=1&theme=${scheme}`;
    const noOverflow = async (w, what) => { const sw_ = await page.evaluate(() => document.documentElement.scrollWidth); if (sw_ > w + 1) errors.push(`${what}: rolagem lateral em ${w}px (${sw_})`); };
    const shot = async (name) => { if (shots) await page.screenshot({ path: resolve(shots, `${name}-${scheme}.png`), fullPage: true }); };

    for (const w of shots ? [420] : [420, 340]) {
      await page.setViewportSize({ width: w, height: 900 });
      // 1. Ícone do campo: cartão "No formulário agora" → aba Bloqueio?
      await page.goto(`${base}&field=assignment_group`);
      await page.waitForSelector('.lk-card', { timeout: 8000 }).catch(() => errors.push('sem cartão de campo bloqueado'));
      out.card = await page.locator('.lk-card').textContent().catch(() => '');
      if (!/somente leitura/.test(out.card ?? '')) errors.push('cartão sem "somente leitura": ' + out.card);
      await page.click('.lk-card button');
      await page.waitForSelector('.lk-aspect', { timeout: 8000 });
      out.tab = await page.locator('.seg-tabs button[aria-selected="true"]').textContent();
      if (out.tab !== 'Bloqueio?') errors.push('aba ativa não é Bloqueio?: ' + out.tab);
      out.group = await page.evaluate(() => ({
        head: document.querySelector('.lk-aspect .lk-head')?.textContent,
        maybe: [...document.querySelectorAll('.lk-aspect .lk-rule')].map((x) => x.querySelector('.lk-name')?.textContent),
        skipped: document.querySelector('details.box.fold .pill')?.textContent,
        foot: document.querySelector('.lk-foot')?.textContent,
      }));
      if (!/Resolvido trava o grupo/.test(out.group.head ?? '')) errors.push('regra vencedora errada: ' + JSON.stringify(out.group));
      if (!out.group.maybe.some((x) => /Só coordenador muda o grupo.*Pode ser/.test(x ?? ''))) errors.push('faltou o "pode ser" do client script: ' + JSON.stringify(out.group));
      if (!/ACL/.test(out.group.foot ?? '')) errors.push('rodapé sem a menção a ACL');
      await noOverflow(w, 'aba Bloqueio?');
      if (w === 420) await shot('lock-tab');

      // 2. Conflito por ordem (categoria).
      await page.goto(`${base}&field=category&tab=lock`);
      await page.waitForSelector('.lk-conflict', { timeout: 8000 }).catch(() => errors.push('sem conflito na categoria'));
      out.conflict = await page.locator('.lk-conflict').first().textContent().catch(() => '');
      if (!/vale "Resolvido exige categoria".*ordem maior/.test(out.conflict ?? '')) errors.push('texto do conflito: ' + out.conflict);

      // 3. Registro inteiro: lista com os escondidos, motivo resumido e detalhe ao clicar.
      await page.goto(`${base}&batch=rec`);
      await page.waitForSelector('.lk-list .lk-row', { timeout: 10000, state: 'attached' }).catch(() => errors.push('lista de campos bloqueados não apareceu'));
      await page.waitForFunction(() => [...document.querySelectorAll('.lk-list .lk-row .det')].every((d) => d.textContent && !/Lendo/.test(d.textContent)), null, { timeout: 8000 }).catch(() => errors.push('motivos da lista não chegaram'));
      out.list = await page.evaluate(() => ({ open: document.querySelector('.lk-list')?.hasAttribute('open'), rows: [...document.querySelectorAll('.lk-list .lk-row')].map((r) => r.querySelector('b')?.textContent + ' | ' + r.querySelector('.det')?.textContent) }));
      if (out.list.rows.length !== 8) errors.push('esperava 8 campos na lista: ' + JSON.stringify(out.list));
      if (out.list.open) errors.push('lista longa (8) deveria começar recolhida');
      if (!out.list.rows.some((r) => /^Parent Incident \| Escondido: por Esconde incidente pai vazio/.test(r))) errors.push('escondido sem motivo: ' + JSON.stringify(out.list.rows));
      if (!out.list.rows.some((r) => /^Caller \| Somente leitura: pode ser ACL/.test(r))) errors.push('bloqueado sem regra deveria dizer ACL: ' + JSON.stringify(out.list.rows));
      await page.click('.lk-list summary');
      await page.locator('.lk-list .lk-row', { hasText: 'Change Request' }).click();
      await page.waitForSelector('.lk-detail .lk-aspect', { timeout: 8000 }).catch(() => errors.push('detalhe do escondido não abriu'));
      out.detail = await page.locator('.lk-detail .lk-head').first().textContent().catch(() => '');
      if (!/Escondido por causa de.*Esconde mudança fora de software/.test(out.detail ?? '')) errors.push('detalhe do escondido: ' + out.detail);
      await noOverflow(w, 'lista do registro');
      if (w === 420) { await page.locator('.lk-list').scrollIntoViewIfNeeded(); await shot('lock-list'); }

      // 4. Sem acesso (itil): nada inventado, frase clara.
      await page.goto(`${base}&field=assignment_group&tab=lock&lock=itil`);
      await page.waitForSelector('.lk-limited', { timeout: 8000 }).catch(() => errors.push('sem aviso de papéis'));
      out.itil = await page.evaluate(() => ({ title: document.querySelector('.lk-limited .title')?.textContent, rules: document.querySelectorAll('.lk-rule').length, unexplained: document.querySelector('.lk-unexplained')?.textContent }));
      if (out.itil.title !== 'Seus papéis não deixam ver as regras do formulário' || out.itil.rules !== 0) errors.push('itil: ' + JSON.stringify(out.itil));
      if (w === 420) await shot('lock-itil');

      // 5. Gaveta "Investigar" › "Um campo": sugestões do formulário e "Por que está bloqueado?" para um escondido.
      await page.goto(`${base}&field=state`);
      await page.waitForSelector('.res');
      await page.click('details.drawer > summary');
      await page.waitForFunction(() => document.querySelectorAll('#trail-field-sugg option').length > 5, null, { timeout: 5000 }).catch(() => errors.push('gaveta sem sugestões de campo'));
      await page.fill('details.drawer .grid2 .field:nth-child(2) input', 'parent_incident');
      await page.click('details.drawer .lk-check');
      await page.waitForSelector('.lk-page .lk-aspect', { timeout: 8000 }).catch(() => errors.push('gaveta não abriu a vista de bloqueio'));
      out.drawer = await page.locator('.lk-page .lk-head').first().textContent().catch(() => '');
      if (!/Escondido por causa de/.test(out.drawer ?? '')) errors.push('gaveta: ' + out.drawer);
      await page.click('.lk-back');
      if (await page.locator('.lk-page').count()) errors.push('Voltar não fechou a vista de bloqueio');
    }
  } finally {
    await ctx.close();
  }
}
console.log(JSON.stringify({ ...out, errors }, null, 1));
if (errors.length) process.exitCode = 1;
