import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const apps=[
  {id:'3def6f75c3cc17101cbdb8e1b40131cf',key:'A',scope:'x_2270630_pttrail_',task:'x_2270630_pttrail__pedido',item:'x_2270630_pttrail__item'},
  {id:'b021f379c3cc17101cbdb8e1b401316a',key:'B',scope:'x_2270630_pttrailb',task:'x_2270630_pttrailb_pedido',item:'x_2270630_pttrailb_item'},
  {id:'c921f379c3cc17101cbdb8e1b401316e',key:'C',scope:'x_2270630_pttrailc',task:'x_2270630_pttrailc_pedido',item:'x_2270630_pttrailc_item'},
 ];
 const out=[];
 async function find(t,name){let r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent('name='+name)+'&sysparm_fields=sys_id,name&sysparm_limit=2',{headers:h});return (await r.json()).result||[]}
 async function make(t,name,body){if((await find(t,name)).length){out.push({kind:t,name,existing:true});return}let r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(body)});let j=await r.json();out.push({kind:t,name,status:r.status,id:j.result?.sys_id,scope:j.result?.sys_scope?.value,error:j.error?.message||j.result?.message})}
 const now=new Date(Date.now()+120000);const runStart=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,19).replace('T',' ');
 for(const a of apps){
  await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:a.id})});
  await make('sys_ui_action','[PT] UI Action categoria '+a.key,{name:'[PT] UI Action categoria '+a.key,action_name:'pt_escopo_'+a.key.toLowerCase()+'_categoria',table:a.task,active:true,client:false,form_button:true,show_insert:false,show_update:true,order:100,script:"current.u_categoria = '3'; current.update(); action.setRedirectURL(current);"});
  await make('sys_ui_policy','[PT] UI Policy categoria '+a.key,{short_description:'[PT] UI Policy categoria '+a.key,table:a.task,active:true,on_load:true,reverse_if_false:true,run_scripts:true,conditions:'u_categoria=3',script_true:"function onCondition() { g_form.setMandatory('u_valor', true); }",script_false:"function onCondition() { g_form.setMandatory('u_valor', false); }"});
  await make('sys_script_client','[PT] Client Script categoria '+a.key,{name:'[PT] Client Script categoria '+a.key,table:a.task,active:true,type:'onChange',field:'u_categoria',description:'[PT] Ajusta valor ao escolher acesso',script:"function onChange(control, oldValue, newValue, isLoading) { if (isLoading) return; if (newValue == '3') g_form.setValue('u_valor','808'); }"});
  const ev='[PT] escopo.'+a.key.toLowerCase()+'.pedido.changed';
  await make('sysevent_register',ev,{name:ev,table:a.task,description:'[PT] Evento de teste do escopo '+a.key});
  await make('sysevent_script_action','[PT] Script Action '+a.key,{name:'[PT] Script Action '+a.key,event_name:ev,active:true,script:"var gr = new GlideRecord('"+a.task+"'); if (gr.get(event.instance)) { gr.setValue('u_valor','555'); gr.update(); }"});
  await make('sysauto_script','[PT] Job estoque '+a.key,{name:'[PT] Job estoque '+a.key,active:true,run_type:'once',run_start:runStart,run_time:'1970-01-01 04:00:00',script:"var gr = new GlideRecord('"+a.item+"'); gr.addQuery('u_nome','[PT] Item "+a.key+" inicial 01'); gr.query(); if (gr.next()) { gr.setValue('u_estoque','99'); gr.update(); }"});
 }
 return JSON.stringify({runStart,out});
})()`, '_resourceTask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_resourceTask');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break}process.stdout.write('.')}
