import { startInPortal, readPortalTask } from './portal.mjs';
import { writeFileSync } from 'node:fs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const jobs=[
  {key:'B',app:'b021f379c3cc17101cbdb8e1b401316a',table:'x_2270630_pttrailb_item',item:'89b4b771c30057101cbdb8e1b401314b',job:'2434b731c30057101cbdb8e1b4013197'},
  {key:'C',app:'c921f379c3cc17101cbdb8e1b401316e',table:'x_2270630_pttrailc_item',item:'44d4b771c30057101cbdb8e1b4013189',job:'c534f731c30057101cbdb8e1b4013149'},
 ];
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text(),j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,180)}}return {status:r.status,data:j}}
 const out=[];const start=new Date(Date.now()+120000).toISOString().slice(0,19).replace('T',' ');
 for(const x of jobs){await req('/api/now/ui/concoursepicker/application','PUT',{app_id:x.app});const d=await req('/api/now/table/sys_dictionary?sysparm_query='+encodeURIComponent('name='+x.table+'^element=')+'&sysparm_fields=sys_id,audit&sysparm_limit=1');const dict=d.data?.result?.[0];let audited=null;if(dict)audited=await req('/api/now/table/sys_dictionary/'+dict.sys_id,'PATCH',{audit:'true'});const reset=await req('/api/now/table/'+x.table+'/'+x.item,'PATCH',{u_estoque:'20'});const schedule=await req('/api/now/table/sysauto_script/'+x.job,'PATCH',{active:'true',run_type:'once',run_start:start});out.push({key:x.key,dict:dict&&{id:dict.sys_id,before:dict.audit,patch:audited?.status},reset:reset.status,schedule:schedule.status,when:start,item:x.item,job:x.job});}
 return JSON.stringify(out);
})()`, '_jobAuditSetup');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_jobAuditSetup');if(t?.done){if(t.error)throw new Error(t.error);const x=JSON.parse(t.result);writeFileSync('tests/regression/escopo/jobs-reagendados.json',JSON.stringify({setup:x},null,2)+'\n');console.log(JSON.stringify(x,null,2));break;}process.stdout.write('.');}
