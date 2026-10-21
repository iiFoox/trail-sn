import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = resolve(root, 'b3/img');
const storeOut = resolve(root, '../docs/store');
mkdirSync(out, { recursive: true });
mkdirSync(storeOut, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const srv = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0);

const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chromium' });

const LOGO_SVG = `<svg viewBox="0 0 128 128" width="56" height="56"><rect width="128" height="128" rx="64" fill="#032d42"/><circle cx="64" cy="64" r="38" fill="none" stroke="#244f63" stroke-width="12"/><path d="M64 26a38 38 0 1 1-36.4 27" fill="none" stroke="#62d84e" stroke-width="12" stroke-linecap="round"/><path d="M18 40l10 15 15-9" fill="none" stroke="#62d84e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M64 44v22l14 9" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function storeShell({ title, sub, rightHtml }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;width:1280px;height:800px;overflow:hidden;background:radial-gradient(900px circle at 78% 45%,#0b354b 0%,#051b28 55%,#031018 100%);color:#e8eef2;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:grid;grid-template-columns:430px 1fr;align-items:center;padding:0 44px 0 56px;gap:32px}
    .copy{display:flex;flex-direction:column;gap:14px}
    .logo{width:56px;height:56px;border-radius:50%;box-shadow:0 12px 32px rgba(0,0,0,.4),0 0 0 1px rgba(122,211,196,.2)}
    .kicker{font:700 12.5px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;color:#62d84e;text-transform:uppercase;margin-top:4px}
    h1{margin:0;font-size:42px;line-height:1.08;letter-spacing:-.03em;color:#fff;font-weight:800}
    p{margin:0;font-size:17.5px;line-height:1.5;color:#a8c0cb}
    .stage{position:relative;width:100%;height:744px;display:flex;align-items:center;justify-content:center}
    .float-win{position:relative;width:430px;height:744px;border-radius:12px;border:1px solid #2a3a46;background:#0f171d;box-shadow:0 24px 64px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.05);overflow:hidden}
    .float-win iframe{width:100%;height:100%;border:0;display:block}
    .float-tab{position:absolute;top:50%;margin-top:-24px;left:-16px;width:16px;height:48px;border-radius:8px 0 0 8px;background:#032d42;color:#7ad3c4;border:1px solid #1f4c63;border-right:0;display:grid;place-items:center;font:700 14px/1 system-ui;box-shadow:-4px 0 14px rgba(0,0,0,.28);z-index:4}
    .float-wrap{position:relative;display:flex;align-items:center}
    /* composite form + float + bubble */
    .form-card{position:relative;width:740px;height:720px;border-radius:14px;border:1px solid #2a3a46;background:#f4f5f7;box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden}
    .form-bar{height:34px;background:#0f1c25;border-bottom:1px solid #223542;display:flex;align-items:center;gap:6px;padding:0 12px;font:11.5px ui-monospace,monospace;color:#8fa8b3}
    .form-bar i{width:9px;height:9px;border-radius:50%}
    .form-bar i:nth-child(1){background:#ff5f57}.form-bar i:nth-child(2){background:#febc2e}.form-bar i:nth-child(3){background:#28c840}
    .form-bar span{margin-left:8px;background:#071a24;border:1px solid #1d3544;border-radius:5px;padding:2px 10px;color:#b9ced6}
    .form-frame{width:1180px;height:720px;border:0;transform:scale(0.627);transform-origin:0 0;display:block}
    .asst{position:absolute;left:16px;bottom:16px;z-index:5;display:flex;align-items:flex-end;gap:10px;flex-direction:row-reverse;font:12.5px/1.38 system-ui,sans-serif}
    .bub{width:46px;height:46px;border-radius:50%;background:#032d42;display:grid;place-items:center;box-shadow:0 10px 28px rgba(0,0,0,.4),0 0 0 3px rgba(98,216,78,.32);flex:none}
    .bub svg{width:24px;height:24px}
    .balloon{position:relative;max-width:236px;padding:10px 26px 10px 12px;border-radius:13px;background:#16212a;color:#e8eef2;border:1px solid #2a3a46;box-shadow:0 14px 36px rgba(0,0,0,.45)}
    .balloon b{display:block;color:#7ad3c4;margin-bottom:2px;font-weight:700}
    .balloon i{position:absolute;top:6px;right:8px;font-style:normal;color:#8c99a5;font-size:14px}
    .overlay-float{position:absolute;right:10px;top:42px;bottom:10px;width:406px;z-index:6;display:flex;align-items:center}
    .overlay-float .float-win{width:406px;height:100%}
  </style></head><body>
    <div class="copy">
      <div class="logo">${LOGO_SVG}</div>
      <div class="kicker">Trail para ServiceNow</div>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
    <div class="stage">${rightHtml}</div>
  </body></html>`;
}

try {
  // 1) Formulário UI16 com ícones do Trail (frame-1, frame-2, ui16-form-hot)
  {
    const page = await browser.newPage({ viewport: { width: 1180, height: 620 }, deviceScaleFactor: 1.5 });
    await page.goto(`${base}/demo/form.html?hot=state`);
    await page.waitForSelector('.trail-host');
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(out, 'ui16-form-hot.png'), clip: { x: 0, y: 0, width: 1180, height: 470 } });
    await page.screenshot({ path: resolve(out, 'frame-1.png'), clip: { x: 10, y: 52, width: 560, height: 340 } });
    await page.screenshot({ path: resolve(out, 'frame-2.png'), clip: { x: 585, y: 52, width: 575, height: 340 } });
    await page.close();
  }
  // 2) Painel escuro flutuante (panel-full, panel-top, panel-verdict)
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 920 }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
    await page.goto(`${base}/demo/panel.html?theme=dark&field=state&float=1`);
    await page.waitForSelector('.topbar');
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(out, 'panel-full.png'), fullPage: true });
    await page.screenshot({ path: resolve(out, 'panel-top.png'), clip: { x: 0, y: 0, width: 420, height: 360 } });
    await page.screenshot({ path: resolve(out, 'panel-verdict.png'), clip: { x: 0, y: 185, width: 420, height: 440 } });
    await page.close();
  }
  // 3) Painel claro (sidepanel-light)
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 920 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
    await page.goto(`${base}/demo/panel.html?theme=light&field=state&float=1`);
    await page.waitForSelector('.topbar');
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(out, 'sidepanel-light.png'), fullPage: true });
    await page.close();
  }
  // 4) Popup escuro (popup-dark)
  {
    const page = await browser.newPage({ viewport: { width: 360, height: 500 }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
    await page.goto(`${base}/demo/popup.html?theme=dark`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, 'popup-dark.png') });
    await page.close();
  }
  // 5) Opções escuro e claro (options-dark, options-light)
  for (const scheme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 780, height: 520 }, deviceScaleFactor: 1.5, colorScheme: scheme });
    await page.goto(`${base}/demo/options.html?theme=${scheme}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, `options-${scheme}.png`) });
    await page.close();
  }

  // 6) Capturas 1280x800 da loja (docs/store/shot-*.png)
  // shot-1-resposta.png: formulário + bolinha-assistente com balão + painel flutuante estilo Mac com veredito
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const html = storeShell({
      title: 'Quem alterou, quando e por quê',
      sub: 'Bolinha-assistente no canto da página e painel flutuante com visual de janela do Mac: clique no campo e veja a causa com certeza alta e resumo pronto para o chamado.',
      rightHtml: `
        <div class="form-card">
          <div class="form-bar"><i></i><i></i><i></i><span>sua-instancia.service-now.com/incident.do?sys_id=ad7b…31f3</span></div>
          <iframe class="form-frame" src="${base}/demo/form.html?hot=state"></iframe>
          <div class="asst">
            <div class="balloon"><b>Trail pronto nesta página</b>Clique num ícone nos campos ou aqui na bolinha para abrir o painel. Arraste para mudar de lugar.<i>×</i></div>
            <div class="bub"><svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="38" fill="none" stroke="#244f63" stroke-width="12"/><path d="M64 26a38 38 0 1 1-36.4 27" fill="none" stroke="#62d84e" stroke-width="12" stroke-linecap="round"/><path d="M18 40l10 15 15-9" fill="none" stroke="#62d84e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M64 44v22l14 9" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          </div>
          <div class="overlay-float">
            <div class="float-tab">›</div>
            <div class="float-win"><iframe id="pframe" src="${base}/demo/panel.html?theme=dark&field=state&float=1"></iframe></div>
          </div>
        </div>`,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(storeOut, 'shot-1-resposta.png') });
    await page.close();
  }

  // shot-2-provas.png: Provas verificáveis, mapa de automações e regras em conflito
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const html = storeShell({
      title: 'Provas, não palpites',
      sub: 'Cada conclusão vem com os fatos verificáveis que a sustentam, o mapa de automações do campo e alerta quando duas regras gravam valores diferentes.',
      rightHtml: `<div class="float-wrap"><div class="float-tab">›</div><div class="float-win"><iframe id="pframe" src="${base}/demo/panel.html?theme=dark&field=impact&tab=proof&float=1"></iframe></div></div>`,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(storeOut, 'shot-2-provas.png') });
    await page.close();
  }

  // shot-3-rastro.png: Tudo que mudou em grupos por momento ("admin salvou 4 campos")
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const html = storeShell({
      title: 'Tudo que mudou, em grupos',
      sub: 'Investigue o registro inteiro e veja as alterações agrupadas por momento ("admin salvou 4 campos"), com rótulos do formulário, links nas referências e filtros por causa.',
      rightHtml: `<div class="float-wrap"><div class="float-tab">›</div><div class="float-win"><iframe id="pframe" src="${base}/demo/panel.html?theme=dark&batch=rec&float=1"></iframe></div></div>`,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const pf = await (await page.$('#pframe')).contentFrame();
    await pf.evaluate(() => {
      document.querySelectorAll('details.bt-group').forEach((d, i) => { if (i < 2) d.open = true; });
      for (const n of document.querySelectorAll('*')) {
        for (const c of n.childNodes) {
          if (c.nodeType === 3 && c.nodeValue.includes('pericia.itil')) c.nodeValue = c.nodeValue.replace(/pericia\.itil/g, 'analista.n2');
        }
      }
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(storeOut, 'shot-3-rastro.png') });
    await page.close();
  }

  // shot-4-comparar.png: O que mudou entre dois momentos na linha do tempo
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'dark' });
    const html = storeShell({
      title: 'O que mudou entre dois momentos',
      sub: 'Escolha dois momentos na linha do tempo e veja só o que ficou diferente no registro entre eles — ou simule na aba "E se?" o que mudaria antes de salvar.',
      rightHtml: `<div class="float-wrap"><div class="float-tab">›</div><div class="float-win"><iframe id="pframe" src="${base}/demo/panel.html?theme=dark&field=state&tab=history&float=1"></iframe></div></div>`,
    });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const pf = await (await page.$('#pframe')).contentFrame();
    await pf.evaluate(() => {
      const recBtn = [...document.querySelectorAll('.seg2 button, button')].find((b) => b.textContent?.includes('Registro inteiro'));
      recBtn?.click();
    });
    await page.waitForTimeout(600);
    await pf.evaluate(() => {
      const cmpBtn = document.querySelector('.cmpbar button');
      cmpBtn?.click();
    });
    await page.waitForTimeout(150);
    await pf.evaluate(() => {
      const pks = [...document.querySelectorAll('button.pk')];
      if (pks.length >= 4) {
        pks[0].click();
        pks[3].click();
      }
      for (const n of document.querySelectorAll('*')) {
        for (const c of n.childNodes) {
          if (c.nodeType === 3 && c.nodeValue.includes('pericia.itil')) c.nodeValue = c.nodeValue.replace(/pericia\.itil/g, 'analista.n2');
        }
      }
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(storeOut, 'shot-4-comparar.png') });
    await page.close();
  }

  console.log('ok', out, storeOut);
} finally {
  await browser.close();
  srv.close();
}
