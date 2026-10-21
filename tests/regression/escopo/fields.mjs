import { startInPortal, readPortalTask } from './portal.mjs';

startInPortal(`(async()=>{
  const h={'X-UserToken':window.g_ck,'Content-Type':'application/json'};
  const apps=[
    {id:'3def6f75c3cc17101cbdb8e1b40131cf',tasks:['x_2270630_pttrail__pedido'],items:['x_2270630_pttrail__item']},
    {id:'b021f379c3cc17101cbdb8e1b401316a',tasks:['x_2270630_pttrailb_pedido'],items:['x_2270630_pttrailb_item']},
    {id:'c921f379c3cc17101cbdb8e1b401316e',tasks:['x_2270630_pttrailc_pedido','x_2270630_pttrailc_pedido_b'],items:['x_2270630_pttrailc_item']},
  ];
  const out=[];
  async function rows(table,query){
    const r=await fetch('/api/now/table/'+table+'?sysparm_query='+encodeURIComponent(query)+'&sysparm_fields=sys_id&sysparm_limit=5',{headers:h});
    const j=await r.json(); return j.result||[];
  }
  async function insert(table,body){
    const r=await fetch('/api/now/table/'+table,{method:'POST',headers:h,body:JSON.stringify(body)});
    const j=await r.json(); return {status:r.status,id:j.result?.sys_id,error:j.error?.message||j.result?.message};
  }
  for(const app of apps){
    await fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:h,body:JSON.stringify({app_id:app.id})});
    for(const table of app.tasks){
      for(const [element,label,type,choice,max] of [['u_categoria','[PT] Categoria','integer','1','40'],['u_valor','[PT] Valor','decimal','0','16']]){
        if(!(await rows('sys_dictionary','name='+table+'^element='+element)).length){
          out.push({table,element,dictionary:await insert('sys_dictionary',{name:table,element,column_label:label,internal_type:type,choice,audit:true,active:true,max_length:max})});
        }
        if(!(await rows('sys_documentation','name='+table+'^element='+element+'^language=en')).length){
          out.push({table,element,documentation:await insert('sys_documentation',{name:table,element,label,language:'en'})});
        }
      }
      for(const [value,label,sequence] of [['1','[PT] Hardware',100],['2','[PT] Software',200],['3','[PT] Acesso',300]]){
        if(!(await rows('sys_choice','name='+table+'^element=u_categoria^value='+value)).length){
          out.push({table,choice:value,result:await insert('sys_choice',{name:table,element:'u_categoria',value,label,sequence,language:'en',inactive:false})});
        }
      }
    }
    for(const table of app.items){
      for(const [element,label,type,choice,max] of [['u_nome','[PT] Nome do item','string','0','100'],['u_estoque','[PT] Estoque','integer','0','40'],['u_status','[PT] Status','integer','1','40']]){
        if(!(await rows('sys_dictionary','name='+table+'^element='+element)).length){
          out.push({table,element,dictionary:await insert('sys_dictionary',{name:table,element,column_label:label,internal_type:type,choice,audit:true,active:true,max_length:max})});
        }
        if(!(await rows('sys_documentation','name='+table+'^element='+element+'^language=en')).length){
          out.push({table,element,documentation:await insert('sys_documentation',{name:table,element,label,language:'en'})});
        }
      }
      for(const [value,label,sequence] of [['1','[PT] Disponível',100],['2','[PT] Reservado',200],['3','[PT] Esgotado',300]]){
        if(!(await rows('sys_choice','name='+table+'^element=u_status^value='+value)).length){
          out.push({table,choice:'u_status='+value,result:await insert('sys_choice',{name:table,element:'u_status',value,label,sequence,language:'en',inactive:false})});
        }
      }
    }
  }
  return JSON.stringify(out);
})()`, '_fieldsTask');

let result;
while (true) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const task = readPortalTask('_fieldsTask');
  if (task?.done) {
    if (task.error) throw new Error(task.error);
    result = JSON.parse(task.result);
    break;
  }
  process.stdout.write('.');
}

console.log(JSON.stringify(result,null,2));
