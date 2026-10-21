import { execFileSync } from 'node:child_process';

export const PORTAL = 'dev457034.service-now.com #2';

/** Run JavaScript inside the connected, already-authenticated Maestri portal. */
export function evalInPortal(source) {
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  const expression = `(0,eval)(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0))))`;
  return execFileSync('rtk', ['maestri', 'portal', 'evaluate', PORTAL, expression], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

export function evalJson(source) {
  const raw = evalInPortal(source);
  try { return JSON.parse(raw); }
  catch { throw new Error(`Portal did not return JSON: ${raw.slice(0, 500)}`); }
}

export function startInPortal(source, key = '_escopoTask') {
  const wrapper = `window.${key}={done:false,result:null,error:null};(async()=>(${source}))().then(result=>{window.${key}.result=result;window.${key}.done=true}).catch(error=>{window.${key}.error=String(error?.stack||error);window.${key}.done=true});'started'`;
  return evalInPortal(wrapper);
}

export function readPortalTask(key = '_escopoTask') {
  return evalJson(`JSON.stringify(window.${key}||null)`);
}
