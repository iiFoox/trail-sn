import { readFileSync, writeFileSync } from 'node:fs';
import { startInPortal, readPortalTask, evalInPortal } from './portal.mjs';

const cases=JSON.parse(readFileSync('tests/regression/escopo/cases-escopo.json','utf8'));
const encoded=Buffer.from(JSON.stringify(cases),'utf8').toString('base64');
evalInPortal("window._auditCasesB64=''");
for(let i=0;i<encoded.length;i+=3000)evalInPortal(`window._auditCasesB64+='${encoded.slice(i,i+3000)}'`);
evalInPortal("window._auditCases=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(window._auditCasesB64),c=>c.charCodeAt(0))));window._auditCasesB64=null");

const source=`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 async function req(url,method='GET',body){let r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,160)}}return {status:r.status,data:j}}
 const rows=window._auditCases;const out={created:[],updated:[],errors:[]};
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:'3def6f75c3cc17101cbdb8e1b40131cf'});
 const a=rows.filter(x=>x.scope==='A');
 for(let i=0;i<a.length;i++){
  const c=a[i],n=String(i+1).padStart(3,'0');
  const r=await req('/api/now/table/x_2270630_pttrail__pedido_audit','POST',{short_description:'[PT] Audit A '+n,u_categoria:'2',u_valor:String(500+i),priority:'4'});
  const id=r.data&&r.data.result&&r.data.result.sys_id;
  if(!id){out.errors.push({id:c.id,phase:'insertA',status:r.status,data:r.data});continue;}
  const u=await req('/api/now/table/x_2270630_pttrail__pedido_audit/'+id,'PATCH',{u_categoria:'1'});
  if(u.status>=300){out.errors.push({id:c.id,phase:'updateA',status:u.status,data:u.data});continue;}
  c.table='x_2270630_pttrail__pedido_audit';c.sysId=id;c.number=r.data.result.number;c.expectedName='[PT] BR A audit child hardware';out.created.push({case:c.id,sysId:id,number:c.number});
 }
 for(const scope of ['B','C']){
  const app=scope==='B'?'b021f379c3cc17101cbdb8e1b401316a':'c921f379c3cc17101cbdb8e1b401316e';
  const table=scope==='B'?'x_2270630_pttrailb_pedido':'x_2270630_pttrailc_pedido';
  await req('/api/now/ui/concoursepicker/application','PUT',{app_id:app});
  const subset=rows.filter(x=>x.scope===scope);
  for(const c of subset){
   const pre=await req('/api/now/table/'+table+'/'+c.sysId,'PATCH',{u_categoria:'2',priority:'4'});
   if(pre.status>=300){out.errors.push({id:c.id,phase:'prepare'+scope,status:pre.status,data:pre.data});continue;}
   const u=await req('/api/now/table/'+table+'/'+c.sysId,'PATCH',{u_categoria:'1'});
   if(u.status>=300)out.errors.push({id:c.id,phase:'trigger'+scope,status:u.status,data:u.data});else out.updated.push(c.id);
  }
 }
 return JSON.stringify({created:out.created,updated:out.updated,errors:out.errors});
})()`;
new Function(`return (async()=>(${source}))()`);
startInPortal(source,'_auditBatch');
for(;;){await new Promise(r=>setTimeout(r,2000));const t=readPortalTask('_auditBatch');if(t&&t.done){if(t.error)throw new Error(t.error);const r=JSON.parse(t.result);const created=new Map(r.created.map(x=>[x.case,x]));for(const c of cases){const v=created.get(c.id);if(v){c.table='x_2270630_pttrail__pedido_audit';c.sysId=v.sysId;c.number=v.number;c.expectedName='[PT] BR A audit child hardware';}}writeFileSync('tests/regression/escopo/cases-escopo.json',JSON.stringify(cases,null,2)+'\n');writeFileSync('tests/regression/escopo/auditados.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({created:r.created.length,updated:r.updated.length,errors:r.errors.length,sample:r.errors.slice(0,5)},null,2));break;}process.stdout.write('.');}
