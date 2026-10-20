/**
 * Fase 12 — bateria da conta de integração. Tudo leva o prefixo [PT] I12 e é idempotente.
 * O usuário de teste pt.trail.integracao foi criado com permissão do dono da PDI (sem senha: as gravações
 * dele são feitas por personificação da sessão admin, e no fim a conta vira "só web service").
 *
 *   window.I12S = await i12Setup();     // usuário, regras e registros (como admin)
 *   -- personificar pt.trail.integracao, recarregar a aba, carregar este arquivo de novo --
 *   window.I12L = await i12RunInteg(I12S);   // gravações como a integração
 *   -- voltar a admin, recarregar, carregar de novo --
 *   window.I12F = await i12Finish(I12S);     // gravação do admin no I12-07 e conta vira só web service
 */
(function () {
const I12 = {
  USER: 'pt.trail.integracao',
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { HW: '8a5055c9c61122780043563ef53438e3', NET: '287ebd7da9fe198100f92cc8d1d2154e' },
  SD: {
    R01: '[PT] I12-01 Chamado aberto pelo monitoramento',
    R02: '[PT] I12-02 Alerta de disco vindo do Zabbix',
    R03: '[PT] I12-03 Fila de impressão travada (ERP)',
    R04: '[PT] I12-04 Sincronização de pedidos atrasada',
    R05: '[PT] I12-05 Falha de link reportada pela operadora',
    R06: '[PT] I12-06 Ticket espelhado do Jira',
    R07: '[PT] I12-07 Chamado do portal do fornecedor',
    R08: '[PT] I12-08 Lote noturno de chamados',
    R09: '[PT] I12-09 Equipamento sem grupo',
    R10: '[PT] I12-10 Grupo informado pelo nome',
    R11: '[PT] I12-11 Duas atualizações seguidas',
  },
};

function i12api() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  const upsert = async (table, values, key) => {
    if (!/^\[PT\] I12/.test(String(values.name || values.short_description))) throw new Error('sem prefixo [PT] I12');
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function i12Setup() {
  const { api, find, upsert } = i12api();
  const S = I12.SD, G = I12.G;
  // Usuário de teste (sem senha), com itil para gravar incidentes.
  let u = await find('sys_user', `user_name=${I12.USER}`);
  if (!u) u = await api('POST', 'table/sys_user', { user_name: I12.USER, first_name: '[PT] Trail', last_name: 'Integração', active: 'true', web_service_access_only: 'false', internal_integration_user: 'false' });
  else await api('PATCH', `table/sys_user/${u.sys_id}`, { web_service_access_only: 'false', active: 'true' });
  const itil = await find('sys_user_role', 'name=itil');
  if (!(await find('sys_user_has_role', `user=${u.sys_id}^role=${itil.sys_id}`))) await api('POST', 'table/sys_user_has_role', { user: u.sys_id, role: itil.sys_id });

  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (name, when, order, filter, script) => upsert('sys_script', {
    name, collection: 'incident', active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: filter + '^EQ', condition: '', script: wrap(script),
  }, `name=${name}^collection=incident`);
  const sd = (k) => `short_description=${S[k]}`;

  await br('[PT] I12 Nota de origem externa', 'before', 100, sd('R02'), "  if (current.urgency.changes()) current.close_notes = 'Recebido do monitoramento externo';");
  await br('[PT] I12 Referência do ERP', 'after', 100, sd('R03'), "  if (current.impact.changes() && current.correlation_display != 'ERP-FILA') { current.correlation_display = 'ERP-FILA'; current.update(); }");
  await br('[PT] I12 Protocolo de sincronização', 'async', 100, sd('R04'), "  if (current.correlation_id != 'SYNC-77') { current.correlation_id = 'SYNC-77'; current.update(); }");
  await br('[PT] I12 Categoria da operadora', 'before', 100, sd('R05'), `  if (gs.getUserName() != '${I12.USER}') return;\n  if (current.category == 'hardware') current.category = 'network';`);
  await br('[PT] I12 Revisão da central', 'before', 100, sd('R06'), `  if (gs.getUserName() == '${I12.USER}') return;\n  if (current.description.changes()) current.description = 'Revisado pela central de serviços';`);
  await upsert('sysrule_assignment', { name: '[PT] I12 Equipamentos de campo', table: 'incident', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.R09}^category=hardware^assignment_groupISEMPTY^EQ`, group: G.HW });

  const recs = {};
  for (const [k, v] of Object.entries(S)) {
    const r = (await find('incident', `short_description=${v}`)) ?? await api('POST', 'table/incident', { short_description: v, caller_id: I12.ADMIN, impact: '3', urgency: '3', category: 'inquiry' });
    recs[k] = { number: r.number, sys_id: r.sys_id };
  }
  return { user: u.sys_id, recs };
}

/** Roda com a sessão personificando pt.trail.integracao. */
async function i12RunInteg(I) {
  const { api } = i12api();
  const me = await api('GET', `table/sys_user?sysparm_limit=1&sysparm_query=sys_id=javascript:gs.getUserID()&sysparm_fields=user_name`);
  if (me[0]?.user_name !== I12.USER) throw new Error('sessão não está como ' + I12.USER + ': ' + me[0]?.user_name);
  const R = I.recs, log = [];
  const P = async (k, body) => { await api('PATCH', `table/incident/${R[k].sys_id}`, body); log.push(`${new Date().toISOString()} ${k} ${Object.keys(body).join(',')}`); await sleep(1500); };
  await P('R01', { description: 'Aberto automaticamente: host srv-erp-02 sem resposta' });
  await P('R02', { urgency: '2' });
  await P('R03', { impact: '2' });
  await P('R04', { category: 'software' });
  await P('R05', { category: 'hardware' });
  await P('R06', { description: 'Espelhado do Jira: SUP-3381' });
  await P('R07', { description: 'Fornecedor informa troca de peça agendada' });
  // Batch API: a URL da transação não cita o registro.
  const body = { batch_request_id: 'pt-i12', rest_requests: [{ id: '1', exclude_response_headers: true, method: 'PATCH', url: `/api/now/table/incident/${R.R08.sys_id}`,
    headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Accept', value: 'application/json' }], body: btoa(JSON.stringify({ description: 'Importado no lote noturno 2026-10-20' })) }] };
  const b = await fetch('/api/now/v1/batch', { method: 'POST', headers: { 'X-UserToken': window.g_ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  log.push(`${new Date().toISOString()} R08 batch ${b.status} ${(await b.text()).slice(0, 120).replace(/[=&?]/g, '_')}`); await sleep(1500);
  await P('R09', { category: 'hardware' });
  const g = await fetch(`/api/now/table/incident/${R.R10.sys_id}?sysparm_input_display_value=true`, { method: 'PATCH', headers: { 'X-UserToken': window.g_ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment_group: 'Network' }) });
  log.push(`${new Date().toISOString()} R10 display ${g.status}`); await sleep(1500);
  await P('R11', { description: 'Primeira atualização da integração' });
  await sleep(4000);
  await P('R11', { description: 'Segunda atualização da integração' });
  return log;
}

/** Roda de novo como admin: uma gravação do admin no I12-07 e a conta vira só web service. */
async function i12Finish(I) {
  const { api } = i12api();
  await sleep(3000);
  await api('PATCH', `table/incident/${I.recs.R07.sys_id}`, { close_notes: 'Conferido pelo administrador' });
  await api('PATCH', `table/sys_user/${I.user}`, { web_service_access_only: 'true' });
  const a = await api('GET', `table/sys_audit?sysparm_limit=200&sysparm_fields=documentkey,fieldname,oldvalue,newvalue,user,sys_created_on&sysparm_query=documentkeyIN${Object.values(I.recs).map((r) => r.sys_id).join(',')}^ORDERBYsys_created_on`);
  return a.map((x) => `${x.sys_created_on} ${Object.entries(I.recs).find(([, r]) => r.sys_id === x.documentkey)[0]} ${x.fieldname} ${x.user} ${String(x.oldvalue).slice(0, 25)} -> ${String(x.newvalue).slice(0, 30)}`.replace(/[=&?]/g, '_'));
}

Object.assign(window, { I12, i12Setup, i12RunInteg, i12Finish });
})();
