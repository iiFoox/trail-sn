// Refaz, como pt.trail.itil, só os alvos que divergiram do admin na bateria de 2000 (I2/I3), com o motor corrigido.
// Volta ao admin no fim, mesmo com erro. Uso: node tests/regression/bateria2000/refazer-i2.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { evalInPortal } from './gerar-alvos.mjs';
import { injectBundle } from './injetar.mjs';
import { impersonate } from './testar-personificar.mjs';

const PORTAL = 'dev457034.service-now.com #2';
const ADMIN = '6816f79cc0a8016401c5a33be04be441';
const ITIL = '3fc011fdc3c4d3101cbdb8e1b401311c';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function injectTargets(list) {
  const b64 = Buffer.from(JSON.stringify(list), 'utf8').toString('base64');
  execSync(`maestri portal evaluate "${PORTAL}" "window._tB64='';1"`);
  for (let i = 0; i < b64.length; i += 3500) execSync(`maestri portal evaluate "${PORTAL}" "window._tB64+='${b64.slice(i, i + 3500)}';1"`);
  execSync(`maestri portal evaluate "${PORTAL}" "window._allTargets=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(window._tB64),c=>c.charCodeAt(0))));1"`);
}

const list = JSON.parse(readFileSync('tests/regression/bateria2000/alvos-i2.json', 'utf8'));
try {
  if ((await impersonate(ITIL)) !== 'pt.trail.itil') throw new Error('personificação do itil falhou');
  injectBundle();
  injectTargets(list);
  evalInPortal(`window._res=null;window._err=null;TrailRegression.runDifferential(window._allTargets, undefined, 2).then(r=>window._res=r).catch(e=>window._err=String(e));'ok'`);
  for (;;) {
    await sleep(15000);
    const st = evalInPortal(`window._err ? 'ERR ' + window._err : window._res ? 'DONE' : String((globalThis._differentialResults || []).length)`);
    console.log(new Date().toISOString().slice(11, 19), st);
    if (String(st).startsWith('DONE') || String(st).startsWith('ERR')) break;
  }
  const out = execSync(`maestri portal evaluate "${PORTAL}" "JSON.stringify(window._res)"`, { maxBuffer: 1 << 28 }).toString();
  writeFileSync('tests/regression/bateria2000/res-itil-i2.json', out);
} finally {
  console.log('volta ao admin:', await impersonate(ADMIN));
}
