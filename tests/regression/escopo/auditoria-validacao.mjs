import { startInPortal, readPortalTask } from './portal.mjs';
startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 async function req(url,method='GET',body){let r=await fetch(url,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});let t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t.slice(0,200)}}return {status:r.status,data:j}}
 await req('/api/now/ui/concoursepicker/application','PUT',{app_id:'3def6f75c3cc17101cbdb8e1b40131cf'});
 const table='x_2270630_pttrail__pedido_audit';
 let br=await req('/api/now/table/sys_script?sysparm_query='+encodeURIComponent('name=[PT] BR A audit child hardware')+'&sysparm_fields=sys_id,name&sysparm_limit=1');
 if(!br.data.result?.length) br=await req('/api/now/table/sys_script','POST',{name:'[PT] BR A audit child hardware',collection:table,when:'before',order:100,active:true,action_insert:true,action_update:true,filter_condition:'u_categoria=1',condition:'',script:"(function executeRule(current, previous) { current.setValue('priority','2'); })(current, previous);"});
 const rec=await req('/api/now/table/'+table,'POST',{short_description:'[PT] Validacao auditoria filha',u_categoria:'2',priority:'4'});
 const id=rec.data.result?.sys_id;
 if(!id) return JSON.stringify({br,rec});
 await req('/api/now/table/'+table+'/'+id,'PATCH',{u_categoria:'1'});
 const aud=await req('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey='+id)+'&sysparm_fields=sys_id,fieldname,oldvalue,newvalue,tablename,sys_created_on&sysparm_limit=30');
 const tableGet=await req('/api/now/table/'+table+'/'+id+'?sysparm_fields=sys_id,number,priority,u_categoria');
 return JSON.stringify({br:br.data?.result?.sys_id||br.data?.result,rec:id,tableGet:tableGet.data,aud:aud.data?.result});
})()`, '_auditValidate');
for (;;) { await new Promise(r=>setTimeout(r,1000)); const task=readPortalTask('_auditValidate'); if(task?.done){ if(task.error)throw new Error(task.error);console.log(task.result);break; } process.stdout.write('.'); }
