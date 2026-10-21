import { startInPortal, readPortalTask } from './portal.mjs';
import { writeFileSync } from 'node:fs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'},A='3def6f75c3cc17101cbdb8e1b40131cf';
 const task='x_2270630_pttrail__pedido_audit';
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text(),j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,200)}}return {status:r.status,data:j}}
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:A});
 async function make(label,body){const x=await req('/api/now/table/'+task,'POST',{short_description:'[PT] Fonte '+label,u_categoria:'2',u_valor:'900',priority:'4',...body});return x.data?.result}
 async function get(table,id,fields){return (await req('/api/now/table/'+table+'/'+id+'?sysparm_fields='+fields)).data?.result}
 async function audit(id){return (await req('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey='+id)+'&sysparm_fields=fieldname,oldvalue,newvalue,tablename,sys_created_on&sysparm_limit=30')).data?.result}
 const out={};
 let r=await make('script include',{u_categoria:'2'});await req('/api/now/table/'+task+'/'+r.sys_id,'PATCH',{u_categoria:'3'});out.include={record:await get(task,r.sys_id,'sys_id,number,short_description,u_categoria'),audit:await audit(r.sys_id)};
 r=await make('after',{u_categoria:'2',u_valor:'900'});await req('/api/now/table/'+task+'/'+r.sys_id,'PATCH',{u_valor:'1250'});await new Promise(r=>setTimeout(r,1000));out.after={record:await get(task,r.sys_id,'sys_id,number,u_valor,u_aprovador'),audit:await audit(r.sys_id)};
 r=await make('async',{u_categoria:'2',state:'2'});await req('/api/now/table/'+task+'/'+r.sys_id,'PATCH',{state:'3'});await new Promise(r=>setTimeout(r,9000));out.async={record:await get(task,r.sys_id,'sys_id,number,state,u_data_limite'),audit:await audit(r.sys_id)};
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:A});const inc=await req('/api/now/table/incident','POST',{short_description:'[PT] Escopo A grava incidente global',urgency:'3',impact:'3',category:'software'});out.incident={status:inc.status,record:inc.data?.result?{sys_id:inc.data.result.sys_id,number:inc.data.result.number,short_description:inc.data.result.short_description,urgency:inc.data.result.urgency}:inc.data};if(inc.data?.result?.sys_id)out.incident.audit=await audit(inc.data.result.sys_id);
 return JSON.stringify(out);
})()`, '_sourceProbe');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_sourceProbe');if(t?.done){if(t.error)throw new Error(t.error);const x=JSON.parse(t.result);writeFileSync('tests/regression/escopo/probe-fontes.json',JSON.stringify(x,null,2)+'\n');for(const [k,v] of Object.entries(x))console.log(k,JSON.stringify(v.record||v));break;}process.stdout.write('.');}
