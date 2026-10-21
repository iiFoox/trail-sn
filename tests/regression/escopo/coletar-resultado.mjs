import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evalInPortal } from './portal.mjs';

const profile=process.argv[2]||'admin';
const meta=JSON.parse(evalInPortal("JSON.stringify({done:window._differentialDone,count:window._differentialResults?.length||0,run:window._escopoRun?{access:window._escopoRun.access,denied:window._escopoRun.denied,totalMs:window._escopoRun.totalMs,medianMs:window._escopoRun.medianMs}:null,error:window._escopoError||null})"));
if(!meta.done||!meta.run)throw new Error(`Run incomplete: ${JSON.stringify(meta)}`);
const results=[];
for(let i=0;i<meta.count;i+=25){const chunk=JSON.parse(evalInPortal(`JSON.stringify(window._differentialResults.slice(${i},${i+25}))`));results.push(...chunk);}
const dir=resolve('tests/regression/escopo/resultados');mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,`${profile}.json`),JSON.stringify({profile,...meta.run,results},null,2)+'\n');
console.log(JSON.stringify({profile,count:results.length,...meta.run,errors:results.filter(x=>!x.ok).length},null,2));
