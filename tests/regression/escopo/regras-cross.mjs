import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const A='3def6f75c3cc17101cbdb8e1b40131cf',B='b021f379c3cc17101cbdb8e1b401316a',C='c921f379c3cc17101cbdb8e1b401316e';
 const pedido='x_2270630_pttrail__pedido';const out=[];
 async function rows(t,q){const r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id,name,collection,when,sys_scope,source_scope,target_scope,target_name,operation,status&sysparm_limit=10',{headers:h});return (await r.json()).result||[]}
 async function insert(t,b){const r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});const j=await r.json();return {status:r.status,id:j.result?.sys_id,name:j.result?.name,scope:j.result?.sys_scope?.value,error:j.error?.message||j.result?.message}}
 async function rule(app,name,collection,script,filter){await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:app})});const e=(await rows('sys_script','name='+name))[0];if(e){out.push({name,existing:e.sys_id});return}out.push({name,...await insert('sys_script',{name,collection,when:'before',order:500,active:true,action_insert:true,action_update:true,filter_condition:filter,condition:'',script})})}
 await rule(B,'[PT] BR B escreve tabela A',pedido,"(function executeRule(current, previous) { if (current.u_categoria == '2') current.u_valor = 222; })(current, previous);",'u_categoria=2');
 await rule(C,'[PT] BR C chama include A',pedido,"(function executeRule(current, previous) { new PTTrailScopeHelper().apply(current); })(current, previous);",'u_categoria=2');
 const priv=(await rows('sys_scope_privilege','source_scope='+C+'^target_scope='+A+'^target_name=PTTrailScopeHelper^operation=execute'))[0];
 if(!priv)out.push({kind:'cross_scope_privilege',...await insert('sys_scope_privilege',{source_scope:C,target_scope:A,target_name:'PTTrailScopeHelper',operation:'execute',status:'allowed'})});else out.push({kind:'cross_scope_privilege',existing:priv.sys_id,status:priv.status});
 await rule(A,'[PT] BR A escreve incidente global','incident',"(function executeRule(current, previous) { if (current.short_description.toString().indexOf('[PT] Escopo') === 0) current.urgency = 1; })(current, previous);",'short_descriptionSTARTSWITH[PT] Escopo');
 await rule('global','[PT] BR global escreve pedido A',pedido,"(function executeRule(current, previous) { if (current.u_categoria == '2') current.u_valor = 333; })(current, previous);",'u_categoria=2');
 return JSON.stringify(out);
})()`, '_crossRulesTask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_crossRulesTask');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break}process.stdout.write('.')}
