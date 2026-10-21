import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const apps=[
  {id:'3def6f75c3cc17101cbdb8e1b40131cf',role:'c35237f9c3cc17101cbdb8e1b40131ec',tables:['x_2270630_pttrail__pedido','x_2270630_pttrail__item']},
  {id:'b021f379c3cc17101cbdb8e1b401316a',role:'9b52fbf9c3cc17101cbdb8e1b40131ee',tables:['x_2270630_pttrailb_pedido','x_2270630_pttrailb_item']},
  {id:'c921f379c3cc17101cbdb8e1b401316e',role:'af523ff9c3cc17101cbdb8e1b401311f',tables:['x_2270630_pttrailc_pedido','x_2270630_pttrailc_item','x_2270630_pttrailc_pedido_b']},
 ];
 const out=[];
 async function rows(t,q){const r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id&sysparm_limit=4',{headers:h});return (await r.json()).result||[]}
 async function insert(t,b){const r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});const j=await r.json();return {status:r.status,id:j.result?.sys_id,error:j.error?.message||j.result?.message}}
 for(const app of apps){
  await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:app.id})});
  for(const table of app.tables)for(const op of ['read','create','write']){
   const acl=(await rows('sys_security_acl','name='+table+'^operation='+op))[0];
   let aclId=acl?.sys_id;
   if(!aclId){const made=await insert('sys_security_acl',{name:table,operation:op,type:'record',active:true,admin_overrides:true,decision_type:'allow',advanced:false});aclId=made.id;out.push({table,op,acl:made})}
   if(aclId){const link=(await rows('sys_security_acl_role','sys_security_acl='+aclId+'^sys_user_role='+app.role))[0];if(!link){out.push({table,op,role:await insert('sys_security_acl_role',{sys_security_acl:aclId,sys_user_role:app.role})})}}
  }
 }
 return JSON.stringify(out);
})()`, '_aclTask');

while (true) {
 await new Promise((resolve) => setTimeout(resolve,1000));
 const task=readPortalTask('_aclTask');
 if(task?.done){if(task.error)throw new Error(task.error);console.log(JSON.stringify(JSON.parse(task.result),null,2));break}
 process.stdout.write('.');
}
