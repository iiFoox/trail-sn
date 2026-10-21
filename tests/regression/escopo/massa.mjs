import { writeFileSync } from 'node:fs';
import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
 const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
 const apps=[
  {id:'3def6f75c3cc17101cbdb8e1b40131cf',key:'A',table:'x_2270630_pttrail__pedido',rule:'[PT] BR A hardware priority'},
  {id:'b021f379c3cc17101cbdb8e1b401316a',key:'B',table:'x_2270630_pttrailb_pedido',rule:'[PT] BR B hardware priority'},
  {id:'c921f379c3cc17101cbdb8e1b401316e',key:'C',table:'x_2270630_pttrailc_pedido',rule:'[PT] BR C hardware priority'},
 ];
 async function request(path,method='GET',body){const r=await fetch(path,{method,headers:h,...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let j;try{j=JSON.parse(text)}catch{}return {status:r.status,data:j}}
 async function pool(items,limit,fn){let i=0;const workers=Array.from({length:limit},async()=>{while(i<items.length){const idx=i++;await fn(items[idx],idx)}});await Promise.all(workers)}
 const cases=[];const errors=[];const initial={pedido:[],item:[]};
 for(let n=1;n<=13;n++){let label='[PT] Escopo A inicial '+String(n).padStart(2,'0');let c=await request('/api/now/table/x_2270630_pttrail__pedido?sysparm_query='+encodeURIComponent('short_description='+label)+'&sysparm_fields=sys_id,number');if(c.data?.result?.length)continue;let r=await request('/api/now/table/x_2270630_pttrail__pedido','POST',{short_description:label,u_categoria:'2',u_valor:String(100+n),priority:'4'});if(r.data?.result)initial.pedido.push({sys_id:r.data.result.sys_id,number:r.data.result.number});else errors.push({seed:label,status:r.status,error:r.data?.error})}
 await pool(Array.from({length:10},(_,i)=>i+1),5,async(n)=>{let label='[PT] Item A inicial '+String(n).padStart(2,'0');let r=await request('/api/now/table/x_2270630_pttrail__item','POST',{u_nome:label,u_estoque:String(20+n),u_status:'1'});if(r.data?.result)initial.item.push({sys_id:r.data.result.sys_id});else errors.push({seed:label,status:r.status,error:r.data?.error})});
 for(const app of apps){
  await request('/api/now/ui/concoursepicker/application','PUT',{app_id:app.id});
  const targets=Array.from({length:100},(_,i)=>i+1);
  await pool(targets,6,async(n)=>{
    const short='[PT] Escopo '+app.key+' cenário '+String(n).padStart(3,'0');
    const r=await request('/api/now/table/'+app.table,'POST',{short_description:short,u_categoria:'2',u_valor:String(100+n),priority:'4'});
    const id=r.data?.result?.sys_id;
    if(!id){errors.push({app:app.key,n,phase:'insert',status:r.status,error:r.data?.error});return}
    const u=await request('/api/now/table/'+app.table+'/'+id,'PATCH',{u_categoria:'1'});
    if(u.status>=300){errors.push({app:app.key,n,phase:'update',status:u.status,error:u.data?.error});return}
    cases.push({id:app.key+'-BR-'+String(n).padStart(3,'0'),table:app.table,sysId:id,number:r.data.result.number,field:'priority',expectedType:'br_before',expectedName:app.rule,minGrade:'probable',scope:app.key});
  });
 }
 return JSON.stringify({cases,initial,errors,counts:{cases:cases.length,pedido:initial.pedido.length,item:initial.item.length}});
})()`, '_massTask');

while(true){await new Promise(r=>setTimeout(r,1000));const t=readPortalTask('_massTask');if(t?.done){if(t.error)throw new Error(t.error);const result=JSON.parse(t.result);writeFileSync('tests/regression/escopo/cases-escopo.json',JSON.stringify(result.cases,null,2)+'\n');writeFileSync('tests/regression/escopo/sementes.json',JSON.stringify({initial:result.initial,errors:result.errors,counts:result.counts},null,2)+'\n');console.log(JSON.stringify({counts:result.counts,errors:result.errors.slice(0,10)},null,2));break}process.stdout.write('.')}
