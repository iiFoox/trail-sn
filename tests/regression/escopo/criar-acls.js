// Roda na aba do PDI logada como admin COM security_admin elevado (menu do usuário → Elevate role).
// Cria ACLs [PT] de leitura, escrita e criação nas tabelas dos apps de teste escopados, exigindo o papel .user do
// escopo dono, cada ACL dentro do escopo da sua tabela. Volta a sessão para o app global no fim.
// Uso no console ou via maestri portal evaluate: o resultado é um texto com o que foi criado.
(async () => {
  const h = { 'X-UserToken': g_ck, Accept: 'application/json', 'Content-Type': 'application/json' };
  const get = async (u) => (await (await fetch(u, { headers: h })).json()).result;
  const post = async (t, b) => { const r = await fetch('/api/now/table/' + t, { method: 'POST', headers: h, body: JSON.stringify(b) }); return [r.status, (await r.json().catch(() => ({}))).result]; };
  const setApp = async (id) => (await fetch('/api/now/ui/concoursepicker/application', { method: 'PUT', headers: h, body: JSON.stringify({ app_id: id }) })).status;
  const out = [];
  const scopes = Object.fromEntries((await get('/api/now/table/sys_scope?sysparm_fields=scope,sys_id&sysparm_query=scopeSTARTSWITHx_2270630')).map((s) => [s.scope, s.sys_id]));
  const roles = Object.fromEntries((await get('/api/now/table/sys_user_role?sysparm_fields=name,sys_id&sysparm_query=nameSTARTSWITHx_2270630')).map((r) => [r.name, r.sys_id]));
  const tables = await get('/api/now/table/sys_db_object?sysparm_fields=name,sys_scope.scope&sysparm_query=nameSTARTSWITHx_2270630');
  try {
    for (const t of tables) {
      const scope = t['sys_scope.scope'];
      const role = roles[scope + '.user'];
      out.push(`escopo ${scope}: ${await setApp(scopes[scope])}`);
      for (const op of ['read', 'write', 'create']) {
        const ex = await get(`/api/now/table/sys_security_acl?sysparm_fields=sys_id&sysparm_query=name=${t.name}^operation=${op}^type=record`);
        if (ex.length) { out.push(`${t.name} ${op}: já existia`); continue; }
        const [s, acl] = await post('sys_security_acl', { name: t.name, operation: op, type: 'record', active: 'true', admin_overrides: 'true', description: '[PT] ACL de teste do Trail' });
        let line = `${t.name} ${op}: ${s}`;
        if (s === 201 && role) { const [s2] = await post('sys_security_acl_role', { sys_security_acl: acl.sys_id, sys_user_role: role }); line += ` papel ${s2}`; }
        out.push(line);
      }
    }
  } finally {
    out.push('volta ao global: ' + (await setApp('global')));
  }
  return out.join('\n');
})();
