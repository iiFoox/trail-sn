import { evalJson, PORTAL } from './portal.mjs';
import { execFileSync } from 'node:child_process';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const current = () => evalJson(`Promise.all([fetch('/api/now/ui/user/current_user',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json()),fetch('/api/now/ui/concoursepicker/current',{headers:{'X-UserToken':window.g_ck}}).then(r=>r.json())]).then(JSON.stringify)`);
let state = current();
if (state[0]?.result?.user_name !== 'admin') {
  const status = evalJson(`fetch('/api/now/ui/impersonate/6816f79cc0a8016401c5a33be04be441',{method:'POST',headers:{'X-UserToken':window.g_ck}}).then(async r=>({status:r.status,body:await r.text()})).then(JSON.stringify)`);
  if (status.status !== 201) throw new Error(`Não foi possível voltar ao admin: ${JSON.stringify(status)}`);
  execFileSync('rtk', ['maestri','portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do'], { encoding:'utf8' });
  await pause(4500);
}
const global = evalJson(`fetch('/api/now/ui/concoursepicker/application',{method:'PUT',headers:{'X-UserToken':window.g_ck,'Content-Type':'application/json'},body:JSON.stringify({app_id:'global'})}).then(async r=>({status:r.status,body:await r.text()})).then(JSON.stringify)`);
if (global.status < 200 || global.status >= 300) throw new Error(`Não foi possível trocar para Global: ${JSON.stringify(global)}`);
execFileSync('rtk', ['maestri','portal','navigate',PORTAL,'https://dev457034.service-now.com/incident_list.do'], { encoding:'utf8' });
await pause(3500);
state = current();
const user = state[0]?.result?.user_name;
const app = state[1]?.result?.currentApplication?.sysId ?? state[1]?.result?.sys_id ?? state[1]?.result?.app_id ?? state[1]?.result?.name;
if (user !== 'admin') throw new Error(`Usuário final inesperado: ${user}`);
if (app !== 'global' && app !== 'Global') throw new Error(`Aplicativo final não confirmado como global: ${JSON.stringify(state[1])}`);
console.log(JSON.stringify({ user, app, verified: true }));
