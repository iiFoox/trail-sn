// Ferramentas para rodar o bundle de regressão no portal do Maestri, como um usuário [PT] impersonado, e ler as
// mensagens vermelhas que ficam na sessão do usuário. Uso:
//   node tests/regression/seguranca/portal.mjs <bundle.js> <sys_id do usuário> <página inicial> "<corpo JS async>"
// O corpo roda dentro de async()=>{...} na página e tem TrailRegression disponível. Sai: mensagens antes, resultado,
// mensagens depois (lidas na tela, depois de recarregar a página) e o usuário final (sempre volta ao admin).
// Variáveis da página próprias deste script (_seg*): não colidir com outras rodadas no mesmo portal.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const PORTAL = process.env.TRAIL_PORTAL ?? 'dev457034.service-now.com';
export const BASE = 'https://dev457034.service-now.com';
export const ADMIN = '6816f79cc0a8016401c5a33be04be441';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ev = (js) => execFileSync('maestri', ['portal', 'evaluate', PORTAL, js], { encoding: 'utf8' }).trim();

/** Roda um corpo async na página e espera o resultado (o evaluate do portal tem prazo de 10 s). */
export async function run(body, pollMs = 2500) {
  ev(`window._seg='running';(async()=>{${body}})().then(x=>window._seg=typeof x==='string'?x:JSON.stringify(x),e=>window._seg='ERR '+e);1`);
  for (;;) { await sleep(pollMs); const r = ev('window._seg'); if (r !== 'running') return r; }
}
/** Navega e espera a página ter g_ck (o balanceador do PDI devolve 500 de vez em quando: tenta de novo). */
export async function nav(path) {
  for (let i = 0; i < 8; i++) {
    execFileSync('maestri', ['portal', 'navigate', PORTAL, BASE + path]);
    await sleep(8000);
    if (ev('typeof g_ck') === 'string') return;
  }
  throw new Error(`página não carregou: ${path}`);
}
/** Mensagens vermelhas visíveis na página (as que o ServiceNow guardou na sessão). */
export const banners = () => ev("Array.from(document.querySelectorAll('.outputmsg_error')).map(e=>e.innerText.trim().replace('Error Message','').replace(/\s+/g,' ').slice(0,160)).join(' ;; ')");
export const impersonate = (id) => run(`return (await fetch('/api/now/ui/impersonate/${id}',{method:'POST',headers:{'X-UserToken':g_ck,Accept:'application/json','Content-Type':'application/json'},body:'{}'})).status`);
export function inject(file) {
  const b64 = Buffer.from(readFileSync(file, 'utf8')).toString('base64');
  ev("window._segB='';1");
  for (let i = 0; i < b64.length; i += 3500) ev(`window._segB+='${b64.slice(i, i + 3500)}';1`);
  ev('(0,eval)(new TextDecoder().decode(Uint8Array.from(atob(window._segB),c=>c.charCodeAt(0))));window._segB=null;1');
}

if (process.argv[1]?.endsWith('portal.mjs')) {
  const [bundle, user, start, body] = process.argv.slice(2);
  await nav('/incident_list.do?sysparm_limit=1');
  await impersonate(user);
  await nav(start);
  const before = banners();
  inject(bundle);
  const out = await run(body);
  await nav(start);
  const after = banners();
  await impersonate(ADMIN);
  await nav('/incident_list.do?sysparm_limit=1');
  console.log(JSON.stringify({ before, out, after, final: ev('g_user.userName') }));
}
