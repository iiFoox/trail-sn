import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { injectBundle } from '../bateria2000/injetar.mjs';
import { evalInPortal, PORTAL } from './portal.mjs';

const profile=process.argv[2]||'admin';
const userMap={
 admin:{id:'6816f79cc0a8016401c5a33be04be441',username:'admin',app:'global'},
 escopo_user:{id:'bb523ff9c3cc17101cbdb8e1b401318f',username:'pt.trail.escopo.user',app:'3def6f75c3cc17101cbdb8e1b40131cf'},
 escopo_admin:{id:'04623ff9c3cc17101cbdb8e1b40131d4',username:'pt.trail.escopo.admin',app:'3def6f75c3cc17101cbdb8e1b40131cf'},
 escopo_user_b:{id:'58627ff9c3cc17101cbdb8e1b4013136',username:'pt.trail.escopo.userb',app:'b021f379c3cc17101cbdb8e1b401316a'},
 escopo_admin_b:{id:'70627ff9c3cc17101cbdb8e1b4013152',username:'pt.trail.escopo.adminb',app:'b021f379c3cc17101cbdb8e1b401316a'},
 escopo_user_c:{id:'41627ff9c3cc17101cbdb8e1b401318f',username:'pt.trail.escopo.userc',app:'c921f379c3cc17101cbdb8e1b401316e'},
 escopo_admin_c:{id:'d5627ff9c3cc17101cbdb8e1b40131c3',username:'pt.trail.escopo.adminc',app:'c921f379c3cc17101cbdb8e1b401316e'},
 escopo_dev:{id:'b1627ff9c3cc17101cbdb8e1b40131db',username:'pt.trail.escopo.dev',app:'3def6f75c3cc17101cbdb8e1b40131cf'},
 itil:{id:'3fc011fdc3c4d3101cbdb8e1b401311c',username:'pt.trail.itil',app:'global'},
 sem_papel:{id:'3562bff9c3cc17101cbdb8e1b4013105',username:'pt.trail.escopo.sem_papel',app:'global'},
};
const target=userMap[profile];if(!target)throw new Error(`Unknown profile ${profile}`);
const rtk=(...args)=>execFileSync('rtk',['maestri',...args],{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const pause=(ms)=>new Promise(r=>setTimeout(r,ms));
function current(){return JSON.parse(evalInPortal(`Promise.all([fetch('/api/now/ui/user/current_user',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()),fetch('/api/now/ui/concoursepicker/current',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json())]).then(JSON.stringify)`));}

async function main(){
 let now=current();let username=now[0].result.user_name;
 if(username!=='admin'){evalInPortal(`fetch('/api/now/ui/impersonate/6816f79cc0a8016401c5a33be04be441',{method:'POST',headers:{'X-UserToken':window.g_ck}}).then(r=>r.status)`);rtk('portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do');await pause(5000)}
 if(profile!=='admin'){
  const imp=evalInPortal(`fetch('/api/now/ui/impersonate/${target.id}',{method:'POST',headers:{'X-UserToken':window.g_ck}}).then(r=>String(r.status))`);
  if(!imp.includes('201'))throw new Error(`Impersonation failed for ${profile}: ${imp}`);
  rtk('portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do');await pause(6000);
 }
 const expectedUser=target.username;
 const actual=evalInPortal(`fetch('/api/now/ui/user/current_user',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()).then(d=>d.result.user_name)`);
 if(actual!==expectedUser)throw new Error(`Wrong session, expected ${expectedUser}, actual ${actual}`);
 evalInPortal(`fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:{'X-UserToken':window.g_ck,'Content-Type':'application/json'},body:JSON.stringify({app_id:'${target.app}'})}).then(r=>r.status)`);
 rtk('portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do');await pause(5000);
 injectBundle();
 const cases=JSON.parse(readFileSync('tests/regression/escopo/cases-escopo.json','utf8'));
 const encoded=Buffer.from(JSON.stringify(cases),'utf8').toString('base64');
 evalInPortal("window._escopoCasesB64='';'ok'");
 for(let i=0;i<encoded.length;i+=3000)evalInPortal(`window._escopoCasesB64+='${encoded.slice(i,i+3000)}';'ok'`);
 evalInPortal("window._escopoCases=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(window._escopoCasesB64),c=>c.charCodeAt(0))));window._escopoCasesB64=null;'ready'");
 evalInPortal(`window._escopoRun=null;window._escopoError=null;TrailRegression.runDifferential(window._escopoCases,undefined,4).then(r=>window._escopoRun=r).catch(e=>window._escopoError=String(e));'started'`);
 const outDir=resolve('tests/regression/escopo/results');mkdirSync(outDir,{recursive:true});let last=0;
 while(true){await pause(10000);const s=JSON.parse(evalInPortal("JSON.stringify({count:window._differentialResults?.length||0,done:window._differentialDone||false,error:window._escopoError||'',result:window._escopoRun||null})"));
  if(s.error)throw new Error(s.error);
  if(s.count>last){last=s.count;console.log(`${profile}: ${last}/${cases.length}`);if(s.done){writeFileSync(resolve(outDir,`${profile}.json`),JSON.stringify({profile,username:actual,run:s.result,results:s.result?.results||[]},null,2)+'\n');break}}
 }
}
main().catch(async e=>{console.error(e.stack||e);process.exitCode=1});
