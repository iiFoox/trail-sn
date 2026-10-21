import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const apps=[
  {id:'3def6f75c3cc17101cbdb8e1b40131cf',key:'A',table:'x_2270630_pttrail__pedido',item:'x_2270630_pttrail__item',job:'8c34b731c30057101cbdb8e1b4013116'},
  {id:'b021f379c3cc17101cbdb8e1b401316a',key:'B',table:'x_2270630_pttrailb_pedido',item:'x_2270630_pttrailb_item',job:'2434b731c30057101cbdb8e1b4013197'},
  {id:'c921f379c3cc17101cbdb8e1b401316e',key:'C',table:'x_2270630_pttrailc_pedido',item:'x_2270630_pttrailc_item',job:'c534f731c30057101cbdb8e1b4013149'},
 ];
 const out=[];async function query(t,q,f){let r=await fetch('/api/now/table/'+t+'?sysparm_query='+encodeURIComponent(q)+'&sysparm_fields='+f+'&sysparm_limit=5',{headers:h});return (await r.json()).result||[]}
 async function insert(t,b){let r=await fetch('/api/now/table/'+t,{method:'POST',headers:h,body:JSON.stringify(b)});let j=await r.json();return {status:r.status,result:j.result,error:j.error?.message||j.result?.message}}
 async function patch(t,id,b){let r=await fetch('/api/now/table/'+t+'/'+id,{method:'PATCH',headers:h,body:JSON.stringify(b)});let j=await r.json();return {status:r.status,result:j.result,error:j.error?.message}}
 for(const a of apps){
  await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:a.id})});
  const ev='[PT] escopo.'+a.key.toLowerCase()+'.pedido.changed';
  if(!(await query('sysevent_register','event_name='+ev,'sys_id')).length)out.push({kind:'event_register',app:a.key,...await insert('sysevent_register',{event_name:ev,table:a.table,description:'[PT] Evento de teste '+a.key,queue:'default'})});
  if(a.key!=='A'){
   const name='[PT] Item '+a.key+' inicial 01';let exists=(await query(a.item,'u_nome='+name,'sys_id,u_estoque,u_nome'))[0];
   if(!exists){const made=await insert(a.item,{u_nome:name,u_estoque:'20',u_status:'1'});out.push({kind:'item_seed',app:a.key,id:made.result?.sys_id,status:made.status,error:made.error})}
   const future=new Date(Date.now()+120000).toISOString().slice(0,19).replace('T',' ');out.push({kind:'job_schedule',app:a.key,...await patch('sysauto_script',a.job,{run_start:future,active:true,run_type:'once'})});
  }
 }
 const at='x_2270630_pttrail__pedido';const name='[PT] Escopo A evento action smoke';const id=(await query(at,'short_description='+name,'sys_id'))[0]?.sys_id;
 if(id){await patch(at,id,{u_categoria:'2'});await patch(at,id,{u_categoria:'3'});await new Promise(r=>setTimeout(r,7000));out.push({kind:'event_result',record:(await query(at,'sys_id='+id,'sys_id,number,u_categoria,u_valor,short_description'))[0],event:(await query('sysevent','name=[PT] escopo.a.pedido.changed^instance='+id,'sys_id,name,instance,state,sys_created_on'))[0]})}
 return JSON.stringify(out);
})()`, '_evtJobTask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_evtJobTask');if(t?.done){if(t.error)throw new Error(t.error);console.log(JSON.stringify(JSON.parse(t.result),null,2));break}process.stdout.write('.')}
