import { startInPortal, readPortalTask } from './portal.mjs';
import { writeFileSync } from 'node:fs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'},A='3def6f75c3cc17101cbdb8e1b40131cf',B='b021f379c3cc17101cbdb8e1b401316a',C='c921f379c3cc17101cbdb8e1b401316e',G='global';
 const table='x_2270630_pttrail__pedido',ids={b:'7b23ff3dc3cc17101cbdb8e1b40131d4',c:'3f23373dc3cc17101cbdb8e1b4013192',global:'d033373dc3cc17101cbdb8e1b40131ee',inc:'c433f77dc3cc17101cbdb8e1b40131f3'};
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text(),j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,180)}}return {status:r.status,data:j}}
 async function scope(id){return req('/api/now/ui/concoursepicker/application','PUT',{app_id:id})}
 async function active(app,id,v){await scope(app);const p=await req('/api/now/table/sys_script/'+id,'PATCH',{active:String(v)});const g=await req('/api/now/table/sys_script/'+id+'?sysparm_fields=active');return {status:p.status,value:g.data?.result?.active}}
 async function create(label){await scope(A);const r=await req('/api/now/table/'+table,'POST',{short_description:'[PT] Probe base '+label,u_categoria:'1',u_valor:'700',priority:'4'});return r.data?.result}
 async function trigger(rec){await scope(A);await req('/api/now/table/'+table+'/'+rec.sys_id,'PATCH',{u_categoria:'2'});const q=await req('/api/now/table/'+table+'/'+rec.sys_id+'?sysparm_fields=sys_id,number,short_description,u_categoria,u_valor');return q.data?.result}
 const out={};await active(C,ids.c,false);await active(G,ids.global,false);await active(B,ids.b,true);let r=await create('B write');out.b=await trigger(r);
 await active(B,ids.b,false);await active(C,ids.c,true);r=await create('C include allowed');out.cAllowed=await trigger(r);
 await scope(C);await req('/api/now/table/sys_scope_privilege/'+ids.inc,'PATCH',{status:'denied'});r=await create('C include denied');out.cDenied=await trigger(r);await scope(C);out.includeRestore=await req('/api/now/table/sys_scope_privilege/'+ids.inc,'PATCH',{status:'allowed'});
 out.cRestore=await active(C,ids.c,true);out.bRestore=await active(B,ids.b,true);out.globalRestore=await active(G,ids.global,true);
 return JSON.stringify(out);
})()`, '_baseCross');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_baseCross');if(t?.done){if(t.error)throw new Error(t.error);const x=JSON.parse(t.result);writeFileSync('tests/regression/escopo/probe-cross-base.json',JSON.stringify(x,null,2)+'\n');console.log(JSON.stringify(x,null,2));break;}process.stdout.write('.');}
