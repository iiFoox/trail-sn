import { startInPortal, readPortalTask, PORTAL } from './portal.mjs';
import { execFileSync } from 'node:child_process';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const admin='6816f79cc0a8016401c5a33be04be441';
 const target='bb523ff9c3cc17101cbdb8e1b401318f';
 const app='3def6f75c3cc17101cbdb8e1b40131cf';
 const record='2f18f7b9c30057101cbdb8e1b40131a9';
 const imp=await fetch('/api/now/ui/impersonate/'+target,{method:'POST',headers:h});
 return JSON.stringify({impersonation:imp.status,target,app,record});
})()`, '_profileAccess');
let t;
for(;;){await pause(500);t=readPortalTask('_profileAccess');if(t?.done)break;}
if(t.error)throw new Error(t.error);
const imp=JSON.parse(t.result);
if(imp.impersonation!==201)throw new Error(`Impersonation failed: ${imp.impersonation}`);
execFileSync('rtk',['maestri','portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do'],{encoding:'utf8'});
await pause(3500);
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const app=await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:'3def6f75c3cc17101cbdb8e1b40131cf'})});
 const user=await fetch('/api/now/ui/user/current_user',{headers:h}).then(async r=>({status:r.status,data:await r.json()}));
 const record=await fetch('/api/now/table/x_2270630_pttrail__pedido_audit/2f18f7b9c30057101cbdb8e1b40131a9?sysparm_fields=sys_id,number,short_description,u_categoria,priority',{headers:h}).then(async r=>({status:r.status,data:await r.json()}));
 const parent=await fetch('/api/now/table/x_2270630_pttrail__pedido/2f18f7b9c30057101cbdb8e1b40131a9?sysparm_fields=sys_id,number,short_description',{headers:h}).then(async r=>({status:r.status,data:await r.json()}));
 const acl=await fetch('/api/now/table/sys_security_acl?sysparm_query=name=x_2270630_pttrail__pedido_audit&sysparm_fields=sys_id,name,operation,active,sys_scope&sysparm_limit=20',{headers:h}).then(async r=>({status:r.status,data:await r.json()}));
 return JSON.stringify({appStatus:app.status,user,record,parent,acl});
})()`, '_profileAccessResult');
for(;;){await pause(500);t=readPortalTask('_profileAccessResult');if(t?.done)break;}
if(t.error)throw new Error(t.error);
console.log('PROFILE_RESULT '+JSON.stringify(t.result));
const res=typeof t.result==='string'?JSON.parse(t.result):t.result;
// Always restore the administrator and Global before leaving this probe.
execFileSync('rtk',['maestri','portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do'],{encoding:'utf8'});
await pause(1200);
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck};
 const r=await fetch('/api/now/ui/impersonate/6816f79cc0a8016401c5a33be04be441',{method:'POST',headers:h});
 return String(r.status);
})()`, '_profileAccessRestore');
for(;;){await pause(500);t=readPortalTask('_profileAccessRestore');if(t?.done)break;}
if(t.error||t.result!=='201')throw new Error(`Admin restoration failed: ${JSON.stringify(t)}`);
execFileSync('rtk',['maestri','portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do'],{encoding:'utf8'});
await pause(2500);
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:'global'})});
 const u=await fetch('/api/now/ui/user/current_user',{headers:h}).then(r=>r.json());
 const a=await fetch('/api/now/ui/concoursepicker/current',{headers:h}).then(r=>r.json());
 return JSON.stringify({user:u.result?.user_name,app:a.result?.currentApplication?.sysId});
})()`, '_profileAccessFinal');
for(;;){await pause(500);t=readPortalTask('_profileAccessFinal');if(t?.done)break;}
if(t.error)throw new Error(t.error);
console.log('RESTORED '+t.result);
