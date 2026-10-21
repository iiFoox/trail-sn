import { readFileSync, writeFileSync } from 'node:fs';
import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
  const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
  const apps=[
    {id:'3def6f75c3cc17101cbdb8e1b40131cf',prefix:'x_2270630_pttrail_',user:'x_2270630_pttrail_.user',admin:'x_2270630_pttrail_.admin'},
    {id:'b021f379c3cc17101cbdb8e1b401316a',prefix:'x_2270630_pttrailb',user:'x_2270630_pttrailb.user',admin:'x_2270630_pttrailb.admin'},
    {id:'c921f379c3cc17101cbdb8e1b401316e',prefix:'x_2270630_pttrailc',user:'x_2270630_pttrailc.user',admin:'x_2270630_pttrailc.admin'},
  ];
  const out={roles:{},users:{}};
  async function query(t,q){const r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id,name,user_name&sysparm_limit=5',{headers:h});return (await r.json()).result||[]}
  async function insert(t,b){const r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});const j=await r.json();return {status:r.status,result:j.result,error:j.error?.message||j.result?.message}}
  for(const app of apps){
    await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:app.id})});
    for(const [kind,name] of [['user',app.user],['admin',app.admin]]){
      let existing=await query('sys_user_role','name='+name);let x=existing[0];
      if(!x){const c=await insert('sys_user_role',{name,description:'[PT] Papel de teste do app escopado'});x=c.result;out.roles[name]={status:c.status,id:x?.sys_id,error:c.error}}
      else out.roles[name]={existing:true,id:x.sys_id};
    }
  }
  await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:'global'})});
  const users=[
    {username:'pt.trail.escopo.user',roles:['x_2270630_pttrail_.user'],desc:'[PT] Usuario de teste do app A'},
    {username:'pt.trail.escopo.admin',roles:['x_2270630_pttrail_.user','x_2270630_pttrail_.admin'],desc:'[PT] Admin de teste do app A'},
    {username:'pt.trail.escopo.userb',roles:['x_2270630_pttrailb.user'],desc:'[PT] Usuario de teste do app B'},
    {username:'pt.trail.escopo.adminb',roles:['x_2270630_pttrailb.user','x_2270630_pttrailb.admin'],desc:'[PT] Admin de teste do app B'},
    {username:'pt.trail.escopo.userc',roles:['x_2270630_pttrailc.user'],desc:'[PT] Usuario de teste do app C'},
    {username:'pt.trail.escopo.adminc',roles:['x_2270630_pttrailc.user','x_2270630_pttrailc.admin'],desc:'[PT] Admin de teste do app C'},
    {username:'pt.trail.escopo.dev',roles:[],desc:'[PT] Desenvolvedor delegado de teste do app A'},
    {username:'pt.trail.escopo.sem_papel',roles:[],desc:'[PT] Usuario de teste sem papel'},
  ];
  for(const u of users){
    let x=(await query('sys_user','user_name='+u.username))[0];
    if(!x){const c=await insert('sys_user',{user_name:u.username,first_name:'[PT] Escopo',last_name:u.username.split('.').at(-1),active:true,comments:u.desc});x=c.result;out.users[u.username]={status:c.status,id:x?.sys_id,error:c.error}}
    else out.users[u.username]={existing:true,id:x.sys_id};
    if(u.roles.length&&x?.sys_id){
      out.users[u.username].roleAssignments=[];
      for(const roleName of u.roles){
        const role=(await query('sys_user_role','name='+roleName))[0];
        if(role){const q='user='+x.sys_id+'^role='+role.sys_id;let has=(await query('sys_user_has_role',q))[0];if(!has){const c=await insert('sys_user_has_role',{user:x.sys_id,role:role.sys_id});out.users[u.username].roleAssignments.push({role:roleName,status:c.status})}else out.users[u.username].roleAssignments.push({role:roleName,status:'exists'})}
      }
    }
  }
  return JSON.stringify(out);
})()`, '_identityTask');

let result;
while (true) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const task = readPortalTask('_identityTask');
  if (task?.done) {
    if (task.error) throw new Error(task.error);
    result = JSON.parse(task.result);
    break;
  }
  process.stdout.write('.');
}

writeFileSync('tests/regression/escopo/identidades.json', JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
