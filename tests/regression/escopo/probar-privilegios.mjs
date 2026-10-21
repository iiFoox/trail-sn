import { startInPortal, readPortalTask } from './portal.mjs';
import { writeFileSync } from 'node:fs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'},A='3def6f75c3cc17101cbdb8e1b40131cf',B='b021f379c3cc17101cbdb8e1b401316a',C='c921f379c3cc17101cbdb8e1b401316e',G='global';
 const table='x_2270630_pttrail__pedido_audit',parent='x_2270630_pttrail__pedido',ids={b:'7b23ff3dc3cc17101cbdb8e1b40131d4',c:'3f23373dc3cc17101cbdb8e1b4013192',global:'d033373dc3cc17101cbdb8e1b40131ee',inc:'c433f77dc3cc17101cbdb8e1b40131f3'};
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text(),j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,200)}}return {status:r.status,data:j}}
 async function scope(id){return req('/api/now/ui/concoursepicker/application','PUT',{app_id:id})}
 async function setActive(app,id,v){await scope(app);let p=await req('/api/now/table/sys_script/'+id,'PATCH',{active:String(v)});let g=await req('/api/now/table/sys_script/'+id+'?sysparm_fields=active');return {status:p.status,value:g.data?.result?.active}}
 async function privilege(app,target,operation){await scope(app);const q='source_scope='+app+'^target_scope='+A+'^target_name='+target+'^operation='+operation;let r=await req('/api/now/table/sys_scope_privilege?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id,status,target_name,operation&sysparm_limit=2');if(r.data?.result?.length)return {existing:r.data.result[0]};return await req('/api/now/table/sys_scope_privilege','POST',{source_scope:app,target_scope:A,target_name:target,target_type:target===parent?'sys_db_object':'sys_db_object',operation,status:'allowed'})}
 async function create(label){await scope(A);let r=await req('/api/now/table/'+table,'POST',{short_description:'[PT] Privilege '+label,u_categoria:'1',u_valor:'700',priority:'4'});return r.data?.result}
 async function trigger(rec){await scope(A);let p=await req('/api/now/table/'+table+'/'+rec.sys_id,'PATCH',{u_categoria:'2'});let q=await req('/api/now/table/'+table+'/'+rec.sys_id+'?sysparm_fields=sys_id,number,short_description,u_categoria,u_valor');let au=await req('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey='+rec.sys_id)+'&sysparm_fields=fieldname,oldvalue,newvalue,sys_created_on&sysparm_limit=20');return {status:p.status,record:q.data?.result,audit:au.data?.result}}
 const out={};out.privB=await privilege(B,parent,'write');out.privC=await privilege(C,parent,'write');
 out.cOff=await setActive(C,ids.c,false);out.gOff=await setActive(G,ids.global,false);out.bOn=await setActive(B,ids.b,true);
 let r=await create('B permitted');out.bAllowed=await trigger(r);
 out.bOff=await setActive(B,ids.b,false);out.cOn=await setActive(C,ids.c,true);
 r=await create('C include permitted');out.cAllowed=await trigger(r);
 await scope(C);out.incDenied=await req('/api/now/table/sys_scope_privilege/'+ids.inc,'PATCH',{status:'denied'});
 r=await create('C include denied');out.cDenied=await trigger(r);
 await scope(C);out.incAllowedRestore=await req('/api/now/table/sys_scope_privilege/'+ids.inc,'PATCH',{status:'allowed'});
 out.cOff=await setActive(C,ids.c,false);out.gOn=await setActive(G,ids.global,true);out.bOnRestore=await setActive(B,ids.b,true);out.cOnRestore=await setActive(C,ids.c,true);
 return JSON.stringify(out);
})()`, '_privProbe');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_privProbe');if(t?.done){if(t.error)throw new Error(t.error);const value=JSON.parse(t.result);writeFileSync('tests/regression/escopo/probe-privilegios.json',JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify({privB:value.privB,privC:value.privC,b:value.bAllowed?.record,cAllowed:value.cAllowed?.record,denied:value.cDenied?.record,incidentErrors:[value.incDenied?.status,value.incAllowedRestore?.status],restored:[value.gOn,value.bOnRestore,value.cOnRestore]},null,2));break;}process.stdout.write('.');}
