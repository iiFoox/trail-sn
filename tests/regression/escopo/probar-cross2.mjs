import { startInPortal, readPortalTask } from './portal.mjs';
import { writeFileSync } from 'node:fs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'},A='3def6f75c3cc17101cbdb8e1b40131cf',B='b021f379c3cc17101cbdb8e1b401316a',C='c921f379c3cc17101cbdb8e1b401316e',G='global';
 const table='x_2270630_pttrail__pedido_audit',ids={b:'7b23ff3dc3cc17101cbdb8e1b40131d4',c:'3f23373dc3cc17101cbdb8e1b4013192',global:'d033373dc3cc17101cbdb8e1b40131ee',priv:'c433f77dc3cc17101cbdb8e1b40131f3'};
 async function req(url,method='GET',body){const r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text(),j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,180)}}return {status:r.status,data:j}}
 async function scope(app){return req('/api/now/ui/concoursepicker/application','PUT',{app_id:app})}
 async function active(app,id,v){await scope(app);const p=await req('/api/now/table/sys_script/'+id,'PATCH',{active:String(v)});const g=await req('/api/now/table/sys_script/'+id+'?sysparm_fields=sys_id,name,active');return {status:p.status,active:g.data?.result?.active}}
 async function make(label){await scope(A);const r=await req('/api/now/table/'+table,'POST',{short_description:'[PT] Probe2 '+label,u_categoria:'1',u_valor:'700',priority:'4'});return r.data?.result}
 async function fire(rec,fields){await scope(A);const p=await req('/api/now/table/'+table+'/'+rec.sys_id,'PATCH',fields);const g=await req('/api/now/table/'+table+'/'+rec.sys_id+'?sysparm_fields=sys_id,number,short_description,u_categoria,u_valor');const au=await req('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey='+rec.sys_id)+'&sysparm_fields=fieldname,oldvalue,newvalue,sys_created_on&sysparm_limit=20');return {status:p.status,record:g.data?.result,audit:au.data?.result}}
 const out={};
 out.cOff=await active(C,ids.c,false);out.globalOff=await active(G,ids.global,false);out.bOn=await active(B,ids.b,true);
 let r=await make('B only');out.b=await fire(r,{u_categoria:'2'});
 out.bOnRestore=await active(B,ids.b,true);out.globalOn=await active(G,ids.global,true);out.cOn=await active(C,ids.c,true);
 r=await make('C allowed');out.cAllowed=await fire(r,{u_categoria:'2'});
 out.privDenied=await (async()=>{await scope(C);const p=await req('/api/now/table/sys_scope_privilege/'+ids.priv,'PATCH',{status:'denied'});const g=await req('/api/now/table/sys_scope_privilege/'+ids.priv+'?sysparm_fields=status');return {status:p.status,value:g.data?.result?.status}})();
 r=await make('C denied');out.cDenied=await fire(r,{u_categoria:'2'});
 await scope(C);out.privAllowed=await req('/api/now/table/sys_scope_privilege/'+ids.priv,'PATCH',{status:'allowed'});
 out.cOnRestore=await active(C,ids.c,true);out.globalOnRestore=await active(G,ids.global,true);out.bOnRestore2=await active(B,ids.b,true);
 return JSON.stringify(out);
})()`, '_crossProbe2');
for(;;){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_crossProbe2');if(t?.done){if(t.error)throw new Error(t.error);const value=JSON.parse(t.result);writeFileSync('tests/regression/escopo/probe-cross.json',JSON.stringify(value,null,2)+'\n');for(const k of ['b','cAllowed','privDenied','cDenied','privAllowed'])console.log(k,JSON.stringify(value[k]));break;}process.stdout.write('.');}
