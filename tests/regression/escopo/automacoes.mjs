import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const A='3def6f75c3cc17101cbdb8e1b40131cf';
 const table='x_2270630_pttrail__pedido';
 await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:A})});
 const out=[];
 async function query(t,q){const r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields=sys_id,name,collection,when,active,access,api_name&sysparm_limit=5',{headers:h});return (await r.json()).result||[]}
 async function insert(t,b){const r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});const j=await r.json();return {status:r.status,id:j.result?.sys_id,name:j.result?.name,scope:j.result?.sys_scope?.value,error:j.error?.message||j.result?.message}}
 let include=(await query('sys_script_include','name=PTTrailScopeHelper'))[0];
 if(!include){const x=await insert('sys_script_include',{name:'PTTrailScopeHelper',description:'[PT] Helper de teste do pedido',active:true,access:'public',script:"var PTTrailScopeHelper = Class.create(); PTTrailScopeHelper.prototype = { initialize: function(){}, apply: function(current){ current.short_description = '[PT] Script Include A'; }, type: 'PTTrailScopeHelper' };"});out.push({kind:'script_include',...x})}else out.push({kind:'script_include',existing:include.sys_id});
 const rules=[
  {name:'[PT] BR A after aprova',when:'after',order:200,filter_condition:'u_valor>1000',script:"(function executeRule(current, previous) { if (current.u_valor > 1000 && current.u_aprovador.nil()) { var gr = new GlideRecord('x_2270630_pttrail__pedido'); if (gr.get(current.getUniqueValue())) { gr.setValue('u_aprovador','6816f79cc0a8016401c5a33be04be441'); gr.update(); } } })(current, previous);"},
  {name:'[PT] BR A async data limite',when:'async',order:300,filter_condition:'state=6',script:"(function executeRule(current, previous) { var gr = new GlideRecord('x_2270630_pttrail__pedido'); if (gr.get(current.getUniqueValue()) && gr.u_data_limite.nil()) { gr.setValue('u_data_limite',gs.nowDateTime()); gr.update(); } })(current, previous);"},
  {name:'[PT] BR A include descricao',when:'before',order:400,filter_condition:'u_categoria=3',script:"(function executeRule(current, previous) { new PTTrailScopeHelper().apply(current); })(current, previous);"},
 ];
 for(const rule of rules){let existing=(await query('sys_script','name='+rule.name))[0];if(existing){out.push({kind:'rule',name:rule.name,existing:existing.sys_id});continue}const x=await insert('sys_script',{name:rule.name,collection:table,when:rule.when,order:rule.order,active:true,action_insert:true,action_update:true,filter_condition:rule.filter_condition,condition:'',script:rule.script});out.push({kind:'rule',...x})}
 return JSON.stringify(out);
})()`, '_autoATask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_autoATask');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break}process.stdout.write('.')}
