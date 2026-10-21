import { readFileSync, writeFileSync } from 'node:fs';
import { startInPortal, readPortalTask } from './portal.mjs';

const ident = JSON.parse(readFileSync('tests/regression/escopo/identidades.json','utf8'));
const assignments=[];
for (const [username,user] of Object.entries(ident.users)) {
  for (const assignment of user.roleAssignments||[]) {
    const roleId=ident.roles[assignment.role]?.id;
    if(roleId) assignments.push({username,userId:user.id,role:assignment.role,roleId});
  }
}
const encoded=Buffer.from(JSON.stringify(assignments),'utf8').toString('base64');
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck};
 const input=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0))));
 const out=[];
 for(const x of input){
  const q='user='+x.userId+'^role='+x.roleId;
  const r=await fetch('/api/now/table/sys_user_has_role?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id,user,role&sysparm_limit=2',{headers:h});
  let j;try{j=await r.json()}catch{j={}};
  out.push({username:x.username,role:x.role,status:r.status,count:j.result?.length||0,ids:(j.result||[]).map(a=>a.sys_id)});
 }
 const me=await fetch('/api/now/ui/user/current_user',{headers:h}).then(r=>r.json());
 const app=await fetch('/api/now/ui/concoursepicker/current',{headers:h}).then(r=>r.json());
 return JSON.stringify({user:me.result?.user_name,app:app.result?.currentApplication?.sysId,assignments:out});
})()`, '_verifyRoleAssignments');
for(;;){await new Promise(resolve=>setTimeout(resolve,500));const task=readPortalTask('_verifyRoleAssignments');if(task?.done){if(task.error)throw new Error(task.error);const result=typeof task.result==='string'?JSON.parse(task.result):task.result;writeFileSync('tests/regression/escopo/role-assignments-verified.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));break}}
