/**
 * As 4 abas (demo): Resposta · Como aconteceu · Histórico · Regras do campo.
 * Navegação (clique e ← →), 420 e 340 px sem rolagem lateral, escuro e claro, cada tela nova com o motor de verdade
 * (salvamento, quem enxerga, quem grava/depende, simular, comparar) e os estados do painel (acesso, erro, carregando, vazio).
 * `SHOTS=<pasta>` também salva os prints.
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
const ctx = await chromium.launchPersistentContext(mkdtempSync(resolve(tmpdir(), 'trail-tabs4-')), { headless: true, channel: 'chromium', locale: 'pt-BR', deviceScaleFactor: shots ? 2 : 1, args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] });
try {
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  const open = async (q, w = 420, theme = 'dark') => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`chrome-extension://${id}/src/sidepanel/index.html?demo=1&float=1&lang=pt&theme=${theme}&${q}`);
  };
  const noOverflow = async (w, what) => { const x = await page.evaluate(() => document.documentElement.scrollWidth); if (x > w + 1) errors.push(`${what}: rolagem lateral em ${w}px (${x})`); };
  // Prints: espera as animações de entrada e esconde a gaveta fixa do rodapé (senão ela aparece no meio da imagem).
  const settle = async () => { await page.waitForTimeout(900); await page.addStyleTag({ content: '.drawer{display:none!important}' }); };
  const shot = async (name) => { if (shots) { await settle(); await page.screenshot({ path: resolve(shots, `${name}.png`), fullPage: true }); } };
  const elShot = async (sel, name) => { if (shots) { await settle(); await page.addStyleTag({ content: '.topbar,.tabs-wrap{position:static!important}' }); await page.locator(sel).scrollIntoViewIfNeeded(); await page.locator(sel).screenshot({ path: resolve(shots, `${name}.png`) }); } };
  const text = (sel) => page.locator(sel).first().textContent({ timeout: 8000 }).catch(() => '');

  // 1. Navegação: 4 abas com nomes curtos; clique e setas; tudo cabe (ou degradê + seta) em 420/340, escuro e claro.
  for (const theme of ['dark', 'light']) {
    for (const w of [420, 340]) {
      await open('', w, theme);
      await page.waitForSelector('.seg-tabs.t4');
      const tabs = await page.$$eval('.seg-tabs.t4 button', (bs) => bs.map((b) => [b.dataset.tab, b.textContent.trim()]));
      out[`tabs-${w}-${theme}`] = tabs;
      if (JSON.stringify(tabs.map((t) => t[0])) !== JSON.stringify(['answer', 'how', 'history', 'rules'])) errors.push('abas erradas: ' + JSON.stringify(tabs));
      const fit = await page.evaluate(() => { const t = document.querySelector('.seg-tabs.t4'); return { fits: t.scrollWidth <= t.clientWidth + 1, arrow: !!document.querySelector('.tabs-more.r') }; });
      if (!fit.fits && !fit.arrow) errors.push(`abas não cabem em ${w}px e não há seta: ` + JSON.stringify(fit));
      out[`fit-${w}-${theme}`] = fit;
      for (const k of ['how', 'history', 'rules', 'answer']) {
        await page.click(`.seg-tabs.t4 button[data-tab="${k}"]`);
        await page.waitForSelector(`.tabpane[data-pane="${k}"]`);
        await noOverflow(w, `aba ${k} (${theme})`);
        if (shots && w === 420) await shot(`${k}-420-${theme}`);
        if (shots && w === 340 && theme === 'dark') await shot(`${k}-340-dark`);
      }
      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('ArrowRight');
      if ((await page.locator('.seg-tabs.t4 button[aria-selected="true"]').getAttribute('data-tab')) !== 'how') errors.push('→ não foi para "Como aconteceu"');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
      if ((await page.locator('.seg-tabs.t4 button[aria-selected="true"]').getAttribute('data-tab')) !== 'rules') errors.push('← ← não deu a volta para "Regras"');
    }
  }

  // 2. Resposta: frase no topo, selo único de certeza, "Abrir a regra" junto da causa e o menu "Copiar para o chamado".
  await open('tab=answer');
  await page.waitForSelector('.ans-phrase');
  out.phrase = await text('.ans-phrase');
  if (!/O campo State mudou de “In Progress” para “Resolved”/.test(out.phrase)) errors.push('frase-resposta: ' + out.phrase);
  out.seal = await text('.seal b');
  if (out.seal !== 'Certeza alta') errors.push('selo: ' + out.seal);
  if (!(await page.locator('.ans-cause .ans-open').count())) errors.push('sem "Abrir a regra" junto da causa');
  if (await page.locator('.who, .cert, .plain').count()) errors.push('blocos antigos (Quem mudou / carimbo / Para o usuário) ainda aparecem');
  if (await page.locator('.notice', { hasText: 'pode estar incompleta' }).count()) errors.push('aviso de incompleta no topo com certeza alta');
  await page.click('.copymenu > .btn');
  out.copy = await page.$$eval('.cm-list button', (bs) => bs.map((b) => b.textContent));
  if (out.copy.length !== 4 || !/Em uma frase/.test(out.copy[0])) errors.push('menu de cópia: ' + JSON.stringify(out.copy));
  await page.keyboard.press('Escape');

  // 3. Como aconteceu: momento, salvamento (normal e lento), provas e o "por que não foi" com o motivo bom.
  await open('tab=how');
  await page.waitForSelector('.save-card h4 .pill', { timeout: 8000 });
  out.save = await text('.save-card h4');
  if (!/Este salvamento levou 0,9 s/.test(out.save) || !/Normal/.test(out.save)) errors.push('salvamento normal: ' + out.save);
  out.why = await text('details.box.fold .why');
  if (!/enviou State = In Progress, não Resolved/.test(out.why)) errors.push('"por que não foi" sem o motivo bom: ' + out.why);
  if (await page.locator('.fmap, .scan').count()) errors.push('ferramentas (mapa/varredura) ainda em "Como aconteceu"');
  await open('tab=how&slow=1');
  await page.waitForSelector('.save-card .sbar', { timeout: 8000 }).catch(() => errors.push('salvamento lento sem a barra'));
  out.slow = await text('.save-card');
  if (!/5,3 s/.test(out.slow) || !/Muito lento/.test(out.slow) || !/9× o normal/.test(out.slow)) errors.push('salvamento lento: ' + out.slow);
  await elShot('.save-card', 'salvamento-lento-420-dark');
  await open('tab=how&slow=denied');
  await page.waitForSelector('.save-card .save-text', { timeout: 8000 });
  out.denied = await text('.save-card .save-text');
  if (!/Não dá para medir o tempo/.test(out.denied)) errors.push('salvamento sem acesso: ' + out.denied);

  // 4. Histórico: "O que rodou neste registro" e "Quem enxerga este registro".
  await open('tab=history&visibility=1');
  await page.waitForSelector('.vis-verdict', { timeout: 10000 }).catch(() => errors.push('quem enxerga não respondeu'));
  out.vis = await text('.vis-verdict b');
  if (out.vis !== 'Abel Tuter não vê este registro.') errors.push('quem enxerga: ' + out.vis);
  out.visWhy = await page.$$eval('.vis-why', (xs) => xs.map((x) => x.textContent));
  if (!out.visWhy.some((x) => /"incident query" esconde/.test(x))) errors.push('motivos de quem enxerga: ' + JSON.stringify(out.visWhy));
  if (!/script/.test(await text('.vis .li .muted'))) errors.push('sem o limite honesto (scripts não avaliados)');
  if (!(await page.locator('.rruns').count())) errors.push('Histórico sem "O que rodou neste registro"');
  await elShot('#who-sees', 'quem-enxerga-420-dark');
  await page.fill('.vis-in input', 'beth.anglin');
  await page.click('.vis-in .btn.primary');
  await page.waitForFunction(() => /Beth Anglin vê/.test(document.querySelector('.vis-verdict b')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => errors.push('beth.anglin deveria ver'));

  // 5. Regras do campo: estado agora, quem grava, quem depende; simular e comparar.
  await open('tab=rules');
  await page.waitForSelector('.deps .dep', { timeout: 10000 }).catch(() => errors.push('sem "Quem depende"'));
  out.secs = await page.$$eval('.rules .sec-h', (hs) => hs.map((h) => h.firstChild.textContent));
  if (JSON.stringify(out.secs) !== JSON.stringify(['Estado agora', 'Quem grava', 'Quem depende'])) errors.push('seções de Regras: ' + JSON.stringify(out.secs));
  out.writers = await page.$$eval('.writers .li a', (as) => as.map((a) => a.textContent));
  if (!out.writers.includes('[PERICIA-TESTE] Resolve incidente por palavra-chave')) errors.push('quem grava: ' + JSON.stringify(out.writers));
  out.deps = await page.$$eval('.deps .dep', (xs) => xs.length);
  if (out.deps < 8) errors.push('quem depende com poucos itens: ' + out.deps);
  if (!(await page.locator('.deps .dep', { hasText: 'envia a notificação' }).count())) errors.push('dependente sem "o que faz"');

  await open('tab=rules&sim=7');
  await page.waitForSelector('.sim .sim-row', { timeout: 10000 }).catch(() => errors.push('simulação não rodou'));
  out.sim = await page.$$eval('.sim .box', (bs) => bs.map((b) => b.querySelector('h4')?.textContent));
  if (!out.sim.some((h) => /^Rodaria/.test(h ?? '')) || !out.sim.some((h) => /Como o registro ficaria/.test(h ?? ''))) errors.push('simulação: ' + JSON.stringify(out.sim));
  if (!(await page.locator('.sim .sim-row', { hasText: 'Fecha as tarefas filhas' }).count())) errors.push('simular Closed deveria rodar "Fecha as tarefas filhas"');
  await elShot('.tool-panel.sim', 'simular-420-dark');
  await open('tab=whatif');
  await page.waitForSelector('.tool-panel.sim', { timeout: 8000 }).catch(() => errors.push('tab=whatif (apelido) não abriu o simular'));

  await open('tab=rules&compare=1');
  await page.waitForSelector('.cmp-diffs .cmp-diff', { timeout: 10000 }).catch(() => errors.push('comparação sem diferenças'));
  out.cmp = await page.$$eval('.cmp-diff', (xs) => xs.map((x) => x.querySelector('.small')?.textContent));
  if (!out.cmp.some((x) => /'mark_resolved' tem condição diferente/.test(x ?? ''))) errors.push('comparação: ' + JSON.stringify(out.cmp));
  if (!(await page.locator('.cmp-link').count())) errors.push('comparação sem links para os dois lados');
  if (!(await page.locator('.cmp-script').count())) errors.push('comparação sem o diff de script recolhido');
  await elShot('.cmp-tool', 'comparar-420-dark');
  await open('tab=rules&compare=nologin');
  await page.waitForSelector('.cmp-login', { timeout: 10000 }).catch(() => errors.push('sem aviso de login na outra instância'));
  out.nologin = await page.$$eval('.cmp-login .btn', (bs) => bs.map((b) => b.textContent.trim()));
  if (!out.nologin.some((x) => /^Abrir sua-instancia-prod/.test(x)) || !out.nologin.includes('Tentar de novo')) errors.push('sem login: ' + JSON.stringify(out.nologin));
  await open('tab=rules&compare=none');
  await page.waitForSelector('.cmp-none', { timeout: 8000 }).catch(() => errors.push('sem instância: faltou "Conectar outra instância"'));

  // 6. Estados do painel: acesso (Vejo / Não vejo), erro com "Tentar de novo" sem o vazio, carregando com o alvo, vazio.
  await open('access=1', 340, 'light');
  await page.waitForSelector('.caps2');
  out.cap = await text('.cap-lead');
  if (!/^Dá para ver .*não dá para ver flows\.$/.test(out.cap)) errors.push('frase do acesso: ' + out.cap);
  if (!(await page.locator('.acc-chip').count())) errors.push('sem o chip "Acesso parcial" no cabeçalho');
  if (await page.locator('header .dot').count()) errors.push('bolinha de acesso ainda no cabeçalho');
  await noOverflow(340, 'aviso de acesso');
  await open('err=1', 340);
  await page.waitForSelector('.err-box');
  if (await page.locator('.empty').count()) errors.push('erro mostra o estado vazio junto');
  await page.click('.err-box .btn');
  await page.waitForSelector('.ans-phrase', { timeout: 5000 }).catch(() => errors.push('"Tentar de novo" não refez a análise'));
  await open('err=401', 340);
  out.err401 = await text('.err-box .errmsg');
  if (!/sessão do ServiceNow expirou/.test(out.err401)) errors.push('erro 401: ' + out.err401);
  await open('run=1', 340);
  out.run = await text('.loader .lhead');
  if (out.run !== 'INC0010001 · State') errors.push('carregando sem o alvo: ' + out.run);
  await open('empty=1', 340);
  out.empty = await text('.empty');
  if (!/ícone do Trail ao lado de um campo/.test(out.empty)) errors.push('vazio: ' + out.empty);
  if (await page.locator('header .icon-btn[aria-label="Alternar tema claro/escuro"]').count()) errors.push('tema ainda no cabeçalho');
} finally {
  console.log(JSON.stringify({ ...out, errors }, null, 1));
  await ctx.close();
  if (errors.length) process.exitCode = 1;
}
