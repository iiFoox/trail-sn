// tests/regression/bateria2000/gerar-alvos.mjs
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PORTAL = 'dev457034.service-now.com #2';

export function evalInPortal(code) {
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  const cmd = `maestri portal evaluate "${PORTAL}" "(0,eval)(new TextDecoder().decode(Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0))))"`;
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

async function main() {
  console.log('Testando conexão com o portal...');
  const user = evalInPortal(`fetch('/api/now/ui/user/current_user', {headers: {'X-UserToken': window.g_ck}}).then(r=>r.json()).then(d=>d.result.user_name)`);
  console.log('Usuário atual na aba:', user);

  // Tabelas para buscar
  const tables = [
    'incident',
    'problem',
    'change_request',
    'sc_req_item',
    'sc_task',
    'change_task',
    'kb_knowledge',
    'cmdb_ci_server',
    'cmdb_ci_computer',
    'cmdb_ci_database',
    'cmdb_ci_service',
    'cmdb_ci_printer',
    'cmdb_ci_netgear',
    'alm_consumable',
    'alm_hardware',
    'cab_meeting',
    'cert_audit',
    'u_pt_trail_teste',
  ];

  console.log('Consultando estatísticas de sys_audit para as tabelas...');
  const jsQuery = `
    Promise.all(${JSON.stringify(tables)}.map(async (t) => {
      try {
        const url = '/api/now/stats/sys_audit?sysparm_count=true&sysparm_group_by=tablename,documentkey,fieldname&sysparm_query=tablename=' + t;
        const res = await fetch(url, { headers: { 'X-UserToken': window.g_ck } });
        const data = await res.json();
        const rows = data.result || [];
        return {
          table: t,
          items: rows.map(r => {
            const get = (k) => r.groupby_fields?.find(f => f.field === k)?.value;
            return {
              table: t,
              sysId: get('documentkey'),
              field: get('fieldname'),
              auditCount: Number(r.stats?.count || 1)
            };
          }).filter(x => x.sysId && x.field && !x.field.startsWith('sys_'))
        };
      } catch (e) {
        return { table: t, error: e.message, items: [] };
      }
    })).then(r => JSON.stringify(r))
  `;

  const raw = evalInPortal(jsQuery);
  const byTable = JSON.parse(raw);

  let allTargets = [];
  for (const t of byTable) {
    console.log(`- ${t.table}: ${t.items.length} alvos disponíveis`);
    allTargets.push(...t.items);
  }
  console.log(`Total de alvos brutos: ${allTargets.length}`);

  // Deduplicar por `${table}:${sysId}:${field}`
  const map = new Map();
  for (const item of allTargets) {
    const key = `${item.table}:${item.sysId}:${item.field}`;
    if (!map.has(key)) map.set(key, item);
  }
  const unique = Array.from(map.values());
  console.log(`Total únicos: ${unique.length}`);

  // Selecionar 1000 alvos com boa distribuição
  // Queremos:
  // - incident: até 300
  // - problem: todos (49)
  // - change_request: até 150
  // - sc_req_item: todos (20)
  // - sc_task: todos (22)
  // - change_task: todos (11)
  // - kb_knowledge: todos (38)
  // - u_pt_trail_teste: todos (10)
  // - cmdb_ci_server: todos (~60)
  // - cmdb_ci_database, cmdb_ci_service, cmdb_ci_printer, etc.: todos
  // - alm_consumable, alm_hardware, cab_meeting, cert_audit: amostras
  // - cmdb_ci_computer: o restante para completar 1000

  const quotas = {
    incident: 280,
    problem: 50,
    change_request: 150,
    sc_req_item: 25,
    sc_task: 25,
    change_task: 15,
    kb_knowledge: 40,
    u_pt_trail_teste: 15,
    cmdb_ci_server: 60,
    cmdb_ci_database: 20,
    cmdb_ci_service: 20,
    cmdb_ci_printer: 50,
    cmdb_ci_netgear: 15,
    cab_meeting: 25,
    cert_audit: 25,
    alm_consumable: 50,
    alm_hardware: 10,
    cmdb_ci_computer: 1000 // preenche o restante
  };

  const selected = [];
  const selectedKeys = new Set();

  // Primeiro as tabelas prioritárias
  for (const [tbl, limit] of Object.entries(quotas)) {
    if (tbl === 'cmdb_ci_computer') continue;
    const candidates = unique.filter(x => x.table === tbl);
    // Embaralhar determinístico ou pegar espaçado
    const slice = candidates.slice(0, limit);
    for (const item of slice) {
      const key = `${item.table}:${item.sysId}:${item.field}`;
      if (!selectedKeys.has(key)) {
        selectedKeys.add(key);
        selected.push(item);
      }
    }
  }

  // Preencher até 1000 com cmdb_ci_computer e outras restantes
  const computers = unique.filter(x => x.table === 'cmdb_ci_computer');
  for (const item of computers) {
    if (selected.length >= 1000) break;
    const key = `${item.table}:${item.sysId}:${item.field}`;
    if (!selectedKeys.has(key)) {
      selectedKeys.add(key);
      selected.push(item);
    }
  }

  // Se ainda faltar, pegar de qualquer tabela restante
  for (const item of unique) {
    if (selected.length >= 1000) break;
    const key = `${item.table}:${item.sysId}:${item.field}`;
    if (!selectedKeys.has(key)) {
      selectedKeys.add(key);
      selected.push(item);
    }
  }

  console.log(`Alvos finais selecionados: ${selected.length}`);
  const finalTargets = selected.slice(0, 1000).map((item, idx) => ({
    id: `T${String(idx + 1).padStart(4, '0')}`,
    table: item.table,
    sysId: item.sysId,
    field: item.field,
    auditCount: item.auditCount
  }));

  // Distribuição por tabela
  const dist = {};
  for (const t of finalTargets) dist[t.table] = (dist[t.table] || 0) + 1;
  console.log('Distribuição por tabela:', dist);

  writeFileSync('tests/regression/bateria2000/alvos.json', JSON.stringify(finalTargets, null, 2), 'utf8');
  console.log('Gravado em tests/regression/bateria2000/alvos.json');
}

if (process.argv[1] && process.argv[1].endsWith('gerar-alvos.mjs')) {
  main().catch(console.error);
}
