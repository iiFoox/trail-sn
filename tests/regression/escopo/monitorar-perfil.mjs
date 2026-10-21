import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evalInPortal } from './portal.mjs';

const profile=process.argv[2]||'admin';const outDir=resolve('tests/regression/escopo/results');mkdirSync(outDir,{recursive:true});let last=-1;
while(true){
 await new Promise(r=>setTimeout(r,10000));
 let state;
 try{state=JSON.parse(evalInPortal("JSON.stringify({count:window._differentialResults?.length||0,done:window._differentialDone||false,error:window._escopoError||'',result:window._escopoRun||null})"))}
 catch(e){console.log('Portal busy; retrying:',e.message);continue}
 if(state.error)throw new Error(state.error);
 if(state.count!==last){last=state.count;console.log(`${profile}: ${state.count}/300`)}
 if(state.done){writeFileSync(resolve(outDir,`${profile}.json`),JSON.stringify({profile,run:state.result,results:state.result?.results||[]},null,2)+'\n');console.log(`Saved ${profile} result`);break}
}
