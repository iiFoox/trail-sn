import { startInPortal, readPortalTask } from './portal.mjs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const appA='3def6f75c3cc17101cbdb8e1b40131cf',appC='c921f379c3cc17101cbdb8e1b401316e';
 const table='x_2270630_pttrail__pedido_audit';
 const ids={b:'7b23ff3dc3cc17101cbdb8e1b40131d4',c:'3f23373dc3cc17101cbdb8e1b4013192',global:'d033373dc3cc17101cbdb8e1b40131ee',priv:'c433f77dc3cc17101cbdb8e1b40131f3'};
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,180)}}return {status:r.status,data:j}}
 async function setActive(id,active){return req('/api/now/table/sys_script/'+id,'PATCH',{active:String(active)})}
 async function create(label){const r=await req('/api/now/table/'+table,'POST',{short_description:'[PT] Probe '+label,u_categoria:'1',u_valor:'700',priority:'4'});return r.data?.result}
 async function run(record,patch){const r=await req('/api/now/table/'+table+'/'+record.sys_id,'PATCH',patch);const q=await req('/api/now/table/'+table+'/'+record.sys_id+'?sysparm_fields=sys_id,number,short_description,u_categoria,u_valor,u_aprovador,u_data_limite,priority');const au=await req('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey='+record.sys_id)+'&sysparm_fields=fieldname,oldvalue,newvalue,tablename,sys_created_on&sysparm_limit=20');return {status:r.status,record:q.data?.result,audit:au.data?.result}}
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:appA});
 const before={b:await req('/api/now/table/sys_script/'+ids.b),c:await req('/api/now/table/sys_script/'+ids.c),global:await req('/api/now/table/sys_script/'+ids.global),priv:await req('/api/now/table/sys_scope_privilege/'+ids.priv)};
 const out={};
 await setActive(ids.c,false);await setActive(ids.global,false);
 let rec=await create('B cross writes A');out.b=await run(rec,{u_categoria:'2'});
 await setActive(ids.b,false);await setActive(ids.global,true);await setActive(ids.c,false);
 rec=await create('global writes A');out.global=await run(rec,{u_categoria:'2'});
 await setActive(ids.b,false);await setActive(ids.global,false);await setActive(ids.c,true);
 rec=await create('C invokes A include allowed');out.cAllowed=await run(rec,{u_categoria:'2'});
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:appC});
 const denied=await req('/api/now/table/sys_scope_privilege/'+ids.priv,'PATCH',{status:'denied'});out.privDeniedPatch=denied.status;
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:appA});
 rec=await create('C invokes A include denied');out.cDenied=await run(rec,{u_categoria:'2'});
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:appC});
 out.privRestore=await req('/api/now/table/sys_scope_privilege/'+ids.priv,'PATCH',{status:'allowed'});
 await setActive(ids.b,true);await setActive(ids.c,true);await setActive(ids.global,true);
 out.finalPrivilege=await req('/api/now/table/sys_scope_privilege/'+ids.priv);
 out.ruleActive={b:await req('/api/now/table/sys_script/'+ids.b+'?sysparm_fields=active'),c:await req('/api/now/table/sys_script/'+ids.c+'?sysparm_fields=active'),global:await req('/api/now/table/sys_script/'+ids.global+'?sysparm_fields=active')};
 return JSON.stringify(out);
})()`, '_crossProbe');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_crossProbe');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break;}process.stdout.write('.');}
