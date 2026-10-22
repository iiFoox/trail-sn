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
  out.why = await text('details.why-not .why');
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
  await page.waitForSelector('.deps .dep', { state: 'attached', timeout: 10000 }).catch(() => errors.push('sem "Quem depende"'));
  out.secs = await page.$$eval('.rules .sec-h', (hs) => hs.map((h) => h.firstChild.textContent));
  if (JSON.stringify(out.secs) !== JSON.stringify(['Estado agora', 'Quem grava', 'Quem depende'])) errors.push('seções de Regras: ' + JSON.stringify(out.secs));
  out.writers = await page.$$eval('.writers .li a', (as) => as.map((a) => a.textContent));
  if (!out.writers.includes('[PERICIA-TESTE] Resolve incidente por palavra-chave')) errors.push('quem grava: ' + JSON.stringify(out.writers));
  out.deps = await page.$$eval('.deps .dep', (xs) => xs.length);
  if (out.deps < 8) errors.push('quem depende com poucos itens: ' + out.deps);
  if (!(await page.locator('.deps .dep', { hasText: 'envia a notificação' }).count())) errors.push('dependente sem "o que faz"');

  await open('tab=rules&sim=7');
  await page.waitForSelector('.sim .sim-row', { state: 'attached', timeout: 10000 }).catch(() => errors.push('simulação não rodou'));
  out.sim = await page.$$eval('.sim .box', (bs) => bs.map((b) => b.querySelector('h4')?.textContent));
  if (!out.sim.some((h) => /^Rodaria/.test(h ?? '')) || !out.sim.some((h) => /Como o registro ficaria/.test(h ?? ''))) errors.push('simulação: ' + JSON.stringify(out.sim));
  if (!(await page.locator('.sim .sim-row', { hasText: 'Fecha as tarefas filhas' }).count())) errors.push('simular Closed deveria rodar "Fecha as tarefas filhas"');
  await elShot('.tool-panel.sim', 'simular-420-dark');
  await open('tab=whatif');
  await page.waitForSelector('.tool-panel.sim', { timeout: 8000 }).catch(() => errors.push('tab=whatif (apelido) não abriu o simular'));

  await open('tab=rules&compare=1');
  await page.waitForSelector('.cmp-diffs .cmp-diff', { state: 'attached', timeout: 10000 }).catch(() => errors.push('comparação sem diferenças'));
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

  // 5b. Seções recolhidas: em cada aba (e nas ferramentas), nenhuma lista com mais de 1 item vem aberta;
  //     abrir e fechar funciona (clique e teclado). Também confere que a resposta em si continua à vista.
  // `opened`: classe da seção que o próprio teste abriu (só as de dentro dela contam).
  const folds = async (what, opened = '') => {
    await page.waitForTimeout(1500);
    // Toda seção recolhível usa o mesmo componente: seta à esquerda (▸/▾) no cabeçalho.
    const odd = await page.evaluate(() => [...document.querySelectorAll('.tabpane details:not(.captech):not(.cmp-script)')].filter((d) => !d.classList.contains('fold2') || !d.querySelector(':scope > summary .caret')).map((d) => d.className));
    if (odd.length) errors.push(`${what}: seção sem o padrão (seta): ` + JSON.stringify(odd));
    const st = await page.evaluate(() => [...document.querySelectorAll('.tabpane details.fold2')].map((d) => ({ cls: d.className, n: d.dataset.count === undefined ? null : Number(d.dataset.count), open: d.open, visible: !!d.offsetParent || d.getClientRects().length > 0 })));
    const bad = st.filter((x) => x.open && x.n !== null && x.n > 1 && !(opened && x.cls.split(' ').includes(opened)));
    if (bad.length) errors.push(`${what}: lista com mais de 1 item aberta: ` + JSON.stringify(bad));
    out[`folds-${what}`] = st.map((x) => `${x.cls.replace(/\b(box|fold|fold2|grp)\b/g, '').trim()}:${x.n ?? '-'}${x.open ? ':aberta' : ''}`);
    return st;
  };
  const toggle = async (sel, what) => {
    const d = page.locator(sel).first();
    if (!(await d.count())) { errors.push(`${what}: sem ${sel}`); return; }
    if (await d.evaluate((el) => el.open)) { errors.push(`${what}: ${sel} deveria vir fechada`); return; }
    const body = d.locator(':scope > :not(summary)').first();
    await d.locator(':scope > summary').click();
    await page.waitForTimeout(400);
    if (!(await d.evaluate((el) => el.open)) || !(await body.isVisible())) errors.push(`${what}: ${sel} não abriu com clique`);
    await d.locator(':scope > summary').click();
    await page.waitForTimeout(400);
    if (await d.evaluate((el) => el.open)) errors.push(`${what}: ${sel} não fechou com clique`);
    await d.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    if (!(await d.evaluate((el) => el.open))) errors.push(`${what}: ${sel} não abriu com Enter`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    if (await d.evaluate((el) => el.open)) errors.push(`${what}: ${sel} não fechou com Espaço`);
  };
  await open('tab=answer');
  await page.waitForSelector('.ans-phrase');
  await folds('resposta');
  for (const sel of ['.ans-phrase', '.ans-cause', '.seal', '.copymenu > .btn']) if (!(await page.locator(sel).first().isVisible())) errors.push(`Resposta: ${sel} não está à vista`);
  await open('tab=how');
  await page.waitForSelector('.save-card h4 .pill', { timeout: 8000 });
  await folds('como-foi');
  if (!(await page.locator('.save-card h4').isVisible())) errors.push('Como foi: resumo do salvamento escondido');
  await toggle('.save-card details.save-ran', 'Como foi');
  await toggle('details.why-this', 'Como foi');
  await toggle('details.missing', 'Como foi');
  await open('tab=history&visibility=1');
  await page.waitForSelector('.vis-verdict', { timeout: 10000 });
  await page.waitForSelector('.rruns .pill.cnt', { timeout: 10000 }).catch(() => errors.push('"O que rodou neste registro" sem contagem'));
  await folds('historico');
  if (!(await page.locator('.vis-verdict').isVisible())) errors.push('Histórico: veredito do Quem enxerga escondido');
  await toggle('details.hist-fold', 'Histórico');
  await toggle('details.vis-reasons', 'Histórico');
  // Quem enxerga: começa recolhido; acha a pessoa pelo nome (uma, várias ou nenhuma) e sugere enquanto digita.
  await open('tab=history');
  await page.waitForSelector('details.vis', { state: 'attached' });
  if (await page.locator('details.vis').evaluate((d) => d.open)) errors.push('"Quem enxerga" deveria vir recolhido');
  if (await page.locator('details.vis .vis-in input').isVisible()) errors.push('"Quem enxerga" fechado mostra o campo da pessoa');
  await page.click('details.vis > summary');
  await page.fill('.vis-in input', 'Beth');
  await page.waitForSelector('.vis-sug li[role="option"]', { timeout: 5000 }).catch(() => errors.push('sem sugestões ao digitar "Beth"'));
  out.sug = await page.$$eval('.vis-sug li[role="option"]', (xs) => xs.map((x) => x.textContent));
  if (out.sug.length !== 2 || !out.sug.some((x) => /Beth Anglin/.test(x))) errors.push('sugestões para "Beth": ' + JSON.stringify(out.sug));
  await page.keyboard.press('Escape');
  await page.click('.vis-in .btn.primary');
  await page.waitForSelector('.vis-pick .vis-cands .btn', { timeout: 8000 }).catch(() => errors.push('"Beth" (duas pessoas) não pediu para escolher'));
  await page.locator('.vis-cands .btn', { hasText: 'Beth Anglin' }).click();
  await page.waitForFunction(() => /Beth Anglin vê/.test(document.querySelector('.vis-verdict b')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => errors.push('escolher Beth Anglin não analisou'));
  await page.fill('.vis-in input', 'Abel');
  await page.keyboard.press('Escape');
  await page.click('.vis-in .btn.primary');
  await page.waitForFunction(() => /Abel Tuter/.test(document.querySelector('.vis-verdict b')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => errors.push('"Abel" (uma pessoa) não analisou Abel Tuter'));
  await page.fill('.vis-in input', 'Fulano');
  await page.keyboard.press('Escape');
  await page.click('.vis-in .btn.primary');
  await page.waitForFunction(() => /Não achei ninguém com esse nome/.test(document.querySelector('.vis-verdict b')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => errors.push('"Fulano": faltou "Não achei ninguém com esse nome"'));
  await folds('historico-vis');
  // Aninhado: "O que rodou neste registro" › grupos também vêm fechados.
  await page.click('details.rruns > summary');
  await page.waitForTimeout(400);
  await folds('historico-rruns', 'rruns');
  await toggle('details.rruns > details.grp.fold2', 'Histórico › O que rodou');
  await open('tab=history&hist=record');
  await page.waitForSelector('ol.rtl > li', { timeout: 10000 });
  await folds('historico-registro');
  await open('tab=rules');
  await page.waitForSelector('.deps', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.lk-list')?.dataset.count !== undefined, null, { timeout: 10000 }).catch(() => errors.push('lista de campos bloqueados sem contagem'));
  await folds('regras');
  if ((await page.locator('.st-now .lk-chip').count()) !== 3 || !(await page.locator('.st-now .lk-chips').isVisible())) errors.push('Regras: os três quadros do Estado agora deveriam estar à vista');
  // Estado agora: uma linha, sem o cartão "Por que … está assim?"; o porquê recolhido quando nada trava o campo.
  out.stLine = await text('.st-now .st-line b');
  if (out.stLine !== 'Editável, opcional e visível agora') errors.push('linha do Estado agora: ' + out.stLine);
  if (await page.locator('.rules .lk-box').count()) errors.push('Regras: o cartão "Por que … está assim?" ainda aparece');
  if (await page.locator('details.st-why').evaluate((d) => d.open)) errors.push('Regras: "Ver por quê" deveria vir fechado com o campo livre');
  out.writersHead = await text('details.writers > summary');
  if (!/^2 regras podem gravar State/.test(out.writersHead.trim())) errors.push('resumo de "Quem grava": ' + out.writersHead);
  out.depsHead = await text('details.deps > summary');
  if (!/^11 regras dependem de State/.test(out.depsHead.trim())) errors.push('resumo de "Quem depende": ' + out.depsHead);
  // Ordem: o que manda no campo vem antes das ferramentas.
  out.order = await page.evaluate(() => [...document.querySelectorAll('.rules > *')].map((e) => e.id || e.className.split(' ').find((c) => ['st-now', 'writers', 'deps', 'rules-tools', 'lk-list', 'scan'].includes(c)) || '').filter(Boolean));
  if (out.order.indexOf('deps') > out.order.indexOf('rules-tools')) errors.push('ordem da aba Regras: ' + JSON.stringify(out.order));
  // Itens de "Quem depende" numa linha só, com o "como depende" no tooltip.
  out.depLine = await page.locator('.deps .dep').first().evaluate((d) => ({ title: d.getAttribute('title'), lines: d.querySelectorAll('.dep-how').length }));
  if (!out.depLine.title || out.depLine.lines) errors.push('item de "Quem depende" não está em uma linha: ' + JSON.stringify(out.depLine));
  await toggle('details.deps', 'Regras');
  await page.click('details.deps > summary');
  await page.waitForTimeout(400);
  await folds('regras-deps-aberta', 'deps');
  await toggle('details.deps details.lane', 'Regras › Quem depende');
  await toggle('details.lk-list', 'Regras');
  await toggle('details.writers', 'Regras');
  await open('tab=rules&sim=7');
  await page.waitForSelector('.sim .sim-row', { state: 'attached', timeout: 10000 });
  await folds('regras-simular');
  if (!(await page.locator('.sim .wi-result').isVisible())) errors.push('Simular: "Como o registro ficaria" deveria estar à vista');
  await toggle('details.sim-runs', 'Simular');
  await open('tab=rules&compare=1');
  await page.waitForSelector('.cmp-diffs .cmp-diff', { state: 'attached', timeout: 10000 });
  await folds('regras-comparar');
  if (!(await page.locator('.cmp-sum').isVisible())) errors.push('Comparar: resumo deveria estar à vista');
  await toggle('details.cmp-diffs', 'Comparar');
  // Preferência "sem animações": abre na hora, sem transição.
  await open('tab=rules&motion=off');
  await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; });
  out.motionOff = await page.evaluate(() => { const d = document.querySelector('details.fold2'); return d ? getComputedStyle(d, '::details-content').transitionDuration : ''; });
  if (out.motionOff && !/^0s/.test(out.motionOff)) errors.push('animação de abrir não respeita "sem animações": ' + out.motionOff);

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
