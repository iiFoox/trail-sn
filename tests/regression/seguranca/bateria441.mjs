// Roda os 441 casos (cases.json) como o usuário logado no portal e grava o resultado. Uso: node bateria441.mjs <bundle> <saida.json>
import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
const P='dev457034.service-now.com', B='https://dev457034.service-now.com';
const ev=(js)=>execFileSync('maestri',['portal','evaluate',P,js],{encoding:'utf8'}).trim();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<6;i++){execFileSync('maestri',['portal','navigate',P,B+'/incident_list.do?sysparm_limit=1']);await sleep(8000);if(ev("typeof g_ck")==='string')break;}
console.log('user', ev('g_user.userName'));
const b64=Buffer.from(readFileSync(process.argv[2],'utf8')).toString('base64');ev("window._b='';1");for(let i=0;i<b64.length;i+=3500)ev(`window._b+='${b64.slice(i,i+3500)}';1`);ev('(0,eval)(new TextDecoder().decode(Uint8Array.from(atob(window._b),c=>c.charCodeAt(0))));window._b=null;1');
ev("window._bat='running';TrailRegression.runRegression().then(x=>window._bat=JSON.stringify(x),e=>window._bat='ERR '+e);1");
const t0=Date.now();
for(;;){await sleep(20000);const r=ev("window._bat.length>200?window._bat.slice(0,20):window._bat");if(r!=='running'){const full=ev('window._bat');writeFileSync(process.argv[3],full);console.log('fim em',Math.round((Date.now()-t0)/1000),'s');break;}}
