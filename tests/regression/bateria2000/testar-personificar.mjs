// tests/regression/bateria2000/testar-personificar.mjs
import { execSync } from 'node:child_process';
import { evalInPortal } from './gerar-alvos.mjs';

const PORTAL = 'dev457034.service-now.com #2';
const ADMIN_SYS_ID = '6816f79cc0a8016401c5a33be04be441';
const ITIL_SYS_ID = '3fc011fdc3c4d3101cbdb8e1b401311c';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function impersonate(sysId) {
  console.log(`Personificando sys_id: ${sysId}...`);
  const postRes = evalInPortal(`fetch('/api/now/ui/impersonate/${sysId}', {method: 'POST', headers: {'X-UserToken': window.g_ck}}).then(r=>r.status)`);
  console.log('Status do impersonate POST:', postRes);

  console.log('Navegando portal para /incident_list.do...');
  execSync(`maestri portal navigate "${PORTAL}" "https://dev457034.service-now.com/incident_list.do"`, { encoding: 'utf8' });

  console.log('Aguardando 6s para a nova sessão assentar...');
  await sleep(6000);

  const currentUser = evalInPortal(`fetch('/api/now/ui/user/current_user', {headers: {'X-UserToken': window.g_ck}}).then(r=>r.json()).then(d=>d.result.user_name)`);
  console.log('Usuário ativo após impersonate:', currentUser);
  return currentUser;
}

async function main() {
  console.log('1. Conferindo usuário inicial...');
  const u1 = evalInPortal(`fetch('/api/now/ui/user/current_user', {headers: {'X-UserToken': window.g_ck}}).then(r=>r.json()).then(d=>d.result.user_name)`);
  console.log('Usuário inicial:', u1);

  console.log('2. Mudando para ITIL...');
  const u2 = await impersonate(ITIL_SYS_ID);
  if (u2 !== 'pt.trail.itil') throw new Error(`Esperado pt.trail.itil, veio ${u2}`);

  console.log('3. Voltando para ADMIN...');
  const u3 = await impersonate(ADMIN_SYS_ID);
  if (u3 !== 'admin') throw new Error(`Esperado admin, veio ${u3}`);

  console.log('Teste de personificação concluído com SUCESSO! Estamos de volta ao admin.');
}

if (process.argv[1] && process.argv[1].endsWith('testar-personificar.mjs')) {
  main().catch(console.error);
}
