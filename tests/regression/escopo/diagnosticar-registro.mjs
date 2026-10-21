import { evalInPortal } from './portal.mjs';
const id=process.argv[2];if(!id)throw new Error('sys_id required');
const code=`Promise.all([
 fetch('/api/now/table/x_2270630_pttrail__pedido/${id}?sysparm_fields=sys_id,number,u_categoria,priority,short_description',{headers:{'X-UserToken':window.g_ck}}).then(async r=>({status:r.status,body:(await r.text()).slice(0,700)})),
 fetch('/api/now/table/sys_audit?sysparm_query='+encodeURIComponent('documentkey=${id}')+'&sysparm_fields=sys_id,tablename,fieldname,oldvalue,newvalue,sys_created_on&sysparm_limit=10',{headers:{'X-UserToken':window.g_ck}}).then(async r=>({status:r.status,body:(await r.text()).slice(0,1300)}))
]).then(JSON.stringify)`;
console.log(evalInPortal(code));
