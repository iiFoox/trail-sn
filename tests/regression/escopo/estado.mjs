import { evalJson } from './portal.mjs';
const q = await evalJson(`(async()=>JSON.stringify(await Promise.all([
  fetch('/api/now/ui/user/current_user',{headers:{'X-UserToken':window.g_ck}}).then(async r=>({status:r.status,data:await r.json()})),
  fetch('/api/now/ui/concoursepicker/current',{headers:{'X-UserToken':window.g_ck}}).then(async r=>({status:r.status,data:await r.json()})),
  fetch('/api/now/table/sys_db_object?sysparm_query=nameLIKEpedido_audit&sysparm_fields=sys_id,name,label,super_class&sysparm_limit=10',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()),
  fetch('/api/now/table/sys_dictionary?sysparm_query=nameLIKEpedido_audit^element=&sysparm_fields=sys_id,name,element,audit&sysparm_limit=10',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()),
  fetch('/api/now/table/sys_dictionary?sysparm_query=name=x_2270630_pttrailb_pedido^element=&sysparm_fields=sys_id,name,element,audit&sysparm_limit=3',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()),
  fetch('/api/now/table/sys_dictionary?sysparm_query=name=x_2270630_pttrailc_pedido^element=&sysparm_fields=sys_id,name,element,audit&sysparm_limit=3',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json())
])))()`);
console.log(JSON.stringify(q,null,2));
