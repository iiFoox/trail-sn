// tests/regression/bateria2000/injetar.mjs
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PORTAL = 'dev457034.service-now.com #2';

function injectB64Var(varName, contentString) {
  const b64 = Buffer.from(contentString, 'utf8').toString('base64');
  const CHUNK_SIZE = 3500;
  execSync(`maestri portal evaluate "${PORTAL}" "window.${varName}B64='';1"`, { encoding: 'utf8' });

  for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
    const chunk = b64.slice(i, i + CHUNK_SIZE);
    execSync(`maestri portal evaluate "${PORTAL}" "window.${varName}B64+='${chunk}';1"`, { encoding: 'utf8' });
  }

  const evalCmd = `window.${varName} = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(window.${varName}B64),c=>c.charCodeAt(0)))); window.${varName}B64=null; 1`;
  execSync(`maestri portal evaluate "${PORTAL}" "${evalCmd}"`, { encoding: 'utf8' });
}

export function injectBundle() {
  const code = readFileSync('tests/regression/browser/dist/regression.js', 'utf8');
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  const CHUNK_SIZE = 3500;

  execSync(`maestri portal evaluate "${PORTAL}" "window._trailB64='';1"`, { encoding: 'utf8' });

  for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
    const chunk = b64.slice(i, i + CHUNK_SIZE);
    execSync(`maestri portal evaluate "${PORTAL}" "window._trailB64+='${chunk}';1"`, { encoding: 'utf8' });
  }

  const evalCmd = `(0,eval)(new TextDecoder().decode(Uint8Array.from(atob(window._trailB64),c=>c.charCodeAt(0)))); window._trailB64=null; 1`;
  execSync(`maestri portal evaluate "${PORTAL}" "${evalCmd}"`, { encoding: 'utf8' });

  const check = execSync(`maestri portal evaluate "${PORTAL}" "typeof window.TrailRegression?.runDifferential"`, { encoding: 'utf8' }).trim();
  console.log('Bundle injetado! typeof runDifferential:', check);
}

export function injectTargets() {
  const content = readFileSync('tests/regression/bateria2000/alvos.json', 'utf8');
  injectB64Var('_allTargets', content);
  const count = execSync(`maestri portal evaluate "${PORTAL}" "window._allTargets?.length || 0"`, { encoding: 'utf8' }).trim();
  console.log(`Alvos injetados na página: ${count} alvos prontos.`);
}

if (process.argv[1] && process.argv[1].endsWith('injetar.mjs')) {
  injectBundle();
  injectTargets();
}
