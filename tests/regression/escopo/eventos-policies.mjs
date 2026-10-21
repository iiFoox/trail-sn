import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const apps=[
  {id:'3def6f75c3cc17101cbdb8e1b40131cf',key:'A',table:'x_2270630_pttrail__pedido',item:'x_2270630_pttrail__item'},
  {id:'b021f379c3cc17101cbdb8e1b401316a',key:'B',table:'x_2270630_pttrailb_pedido',item:'x_2270630_pttrailb_item'},
  {id:'c921f379c3cc17101cbdb8e1b401316e',key:'C',table:'x_2270630_pttrailc_pedido',item:'x_2270630_pttrailc_item'},
 ];
 const out=[];
 async function query(t,q,fields){const r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields='+fields+'&sysparm_limit=5',{headers:h});return (await r.json()).result||[]}
 async function insert(t,b){const r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});const j=await r.json();return {status:r.status,id:j.result?.sys_id,error:j.error?.message||j.result?.message}}
 for(const a of apps){
  await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:a.id})});
  const pn='[PT] UI Policy categoria '+a.key;
  if(!(await query('sys_ui_policy','short_description='+pn,'sys_id')).length)out.push({kind:'policy',name:pn,...await insert('sys_ui_policy',{short_description:pn,table:a.table,active:true,on_load:true,reverse_if_false:true,run_scripts:true,conditions:'u_categoria=3',script_true:"function onCondition() { g_form.setMandatory('u_valor', true); }",script_false:"function onCondition() { g_form.setMandatory('u_valor', false); }"})});
  const en='[PT] escopo.'+a.key.toLowerCase()+'.pedido.changed';const rn='[PT] BR '+a.key+' dispara evento';
  if(!(await query('sys_script','name='+rn,'sys_id')).length)out.push({kind:'event_rule',name:rn,...await insert('sys_script',{name:rn,collection:a.table,when:'after',order:600,active:true,action_insert:true,action_update:true,filter_condition:'u_categoria=3',condition:'',script:"(function executeRule(current, previous) { gs.eventQueue('"+en+"', current, current.getUniqueValue(), ''); })(current, previous);"})});
 }
 await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:apps[0].id})});
 const testName='[PT] Escopo A evento action smoke';let rec=(await query('x_2270630_pttrail__pedido','short_description='+testName,'sys_id,number'))[0];let id=rec?.sys_id;
 if(!id){const c=await insert('x_2270630_pttrail__pedido',{short_description:testName,u_categoria:'2',u_valor:'40',priority:'4'});id=c.id;out.push({kind:'event_test_create',...c})}
 if(id){const u=await fetch('/api/now/table/x_2270630_pttrail__pedido/'+id,{method:'PATCH',headers:h,body:JSON.stringify({u_categoria:'3'})});out.push({kind:'event_test_update',id,status:u.status});await new Promise(r=>setTimeout(r,5000));out.push({kind:'event_test_record',record:(await query('x_2270630_pttrail__pedido','sys_id='+id,'sys_id,number,u_categoria,u_valor,short_description'))[0]})}
 for(const a of apps){const row=(await query(a.item,'u_nome=[PT] Item '+a.key+' inicial 01','sys_id,u_estoque,u_nome'))[0];out.push({kind:'job_result',app:a.key,item:row})}
 return JSON.stringify(out);
})()`, '_eventTask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_eventTask');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break}process.stdout.write('.')}
