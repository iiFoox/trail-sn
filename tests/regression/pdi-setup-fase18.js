/**
 * Fase 18 — protótipo da "Fase 2" (Trail dentro da instância): uma regra grava o contexto de cada gravação
 * no momento em que ela acontece, numa tabela própria. Assim a resposta não depende do log de transações
 * (que expira) e o Trail sabe com certeza de onde veio a gravação.
 *
 * Protótipo restrito aos incidentes [PT] F18 (regra com filtro). Tabela u_pt_trail_contexto:
 *   u_tabela, u_registro, u_campos (campos que mudaram), u_usuario, u_transacao (URL da transação),
 *   u_interativo (sessão interativa), u_origem (form | api | job | outro), u_regras (BRs que gravaram, quando
 *   dá para saber: lista em u_trail_quem, preenchida pela própria regra de teste).
 *
 *   window.F18S = await f18Setup();  window.F18L = await f18Run(F18S);
 */
(function () {
const T = 'u_pt_trail_contexto';
const SD = { A: '[PT] F18-A Contexto pela API', B: '[PT] F18-B Contexto por regra', C: '[PT] F18-C Contexto por job' };
function api() {
  const ck = window.g_ck;
  const call = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return j.result;
  };
  const find = async (t, q) => (await call('GET', `table/${t}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  return { call, find };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function f18Setup() {
  const { call, find } = api();
  let tbl = await find('sys_db_object', `name=${T}`);
  if (!tbl) tbl = await call('POST', 'table/sys_db_object', { name: T, label: '[PT] Trail contexto de gravação', create_access_controls: 'false' });
  const cols = { u_tabela: 'Tabela', u_registro: 'Registro', u_campos: 'Campos', u_usuario: 'Usuário', u_transacao: 'Transação', u_interativo: 'Interativo', u_origem: 'Origem', u_servidor: 'Mudados no servidor' };
  for (const [el, label] of Object.entries(cols)) {
    if (!(await find('sys_dictionary', `name=${T}^element=${el}`))) await call('POST', 'table/sys_dictionary', { name: T, element: el, column_label: label, internal_type: 'string', max_length: ['u_transacao', 'u_campos', 'u_servidor'].includes(el) ? '1000' : '100', active: 'true' });
  }
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const upsertBr = async (name, v) => {
    const cur = await find('sys_script', `name=${name}^collection=incident`);
    return cur ? call('PATCH', `table/sys_script/${cur.sys_id}`, v) : call('POST', 'table/sys_script', v);
  };
  // Gravador: roda por último (order alto), depois de todas as BRs before, e registra o que mudou e de onde veio.
  await upsertBr('[PT] F18 Trail grava contexto', { name: '[PT] F18 Trail grava contexto', collection: 'incident', active: 'true', when: 'before', order: '2000000000', action_update: 'true', action_insert: 'true', advanced: 'true',
    filter_condition: 'short_descriptionSTARTSWITH[PT] F18^EQ', condition: '', script: wrap(`  var campos = [];
  var els = current.getElements();
  for (var i = 0; i < els.size(); i++) { var el = els.get(i); if (el.changes() && el.getName().indexOf('sys_') != 0) campos.push(el.getName()); }
  if (!campos.length) return;
  var url = '', interativo = false;
  try { var tx = GlideTransaction.get(); url = tx ? String(tx.getURL()) : ''; } catch (e) { url = ''; }
  try { interativo = gs.getSession().isInteractive(); } catch (e) {}
  var origem = /^\\/api\\//.test(url) ? 'api' : /\\.do\\?/.test(url) ? 'form' : (url.indexOf('JOB:') == 0 || !interativo) ? 'job' : 'outro';
  var c = new GlideRecord('${T}');
  c.initialize();
  c.u_tabela = current.getTableName(); c.u_registro = current.getUniqueValue(); c.u_campos = campos.join(',');
  var servidor = [];
  try {
    var ini = JSON.parse(String(gs.getSession().getProperty('trail_inicio_' + current.getUniqueValue()) || '{}'));
    for (var j = 0; j < campos.length; j++) { var f = campos[j]; if (f in ini && String(current.getValue(f) == null ? '' : current.getValue(f)) != ini[f]) servidor.push(f); }
    gs.getSession().clearProperty('trail_inicio_' + current.getUniqueValue());
  } catch (e) {}
  c.u_usuario = gs.getUserName(); c.u_transacao = url.substring(0, 1000); c.u_interativo = String(interativo); c.u_origem = origem; c.u_servidor = servidor.join(',');
  c.insert();`) });
  // Começo da gravação (order mais baixo): guarda o que chegou, para o gravador final saber o que o servidor mudou.
  await upsertBr('[PT] F18 Trail guarda o que chegou', { name: '[PT] F18 Trail guarda o que chegou', collection: 'incident', active: 'true', when: 'before', order: '-2000000000', action_update: 'true', action_insert: 'true', advanced: 'true',
    filter_condition: 'short_descriptionSTARTSWITH[PT] F18^EQ', condition: '', script: wrap(`  var v = {};
  var els = current.getElements();
  for (var i = 0; i < els.size(); i++) { var el = els.get(i); var n = el.getName(); if (n.indexOf('sys_') != 0) v[n] = String(el.getValue() == null ? '' : el.getValue()); }
  try { gs.getSession().putProperty('trail_inicio_' + current.getUniqueValue(), JSON.stringify(v)); } catch (e) {}`) });
  // Cenário B: uma BR before muda a urgência quando o impacto muda.
  await upsertBr('[PT] F18 Urgência pelo impacto', { name: '[PT] F18 Urgência pelo impacto', collection: 'incident', active: 'true', when: 'before', order: '100', action_update: 'true', action_insert: 'false', advanced: 'true',
    filter_condition: `short_description=${SD.B}^impactVALCHANGES^EQ`, condition: '', script: wrap("  if (current.impact == 1) current.urgency = 1;") });
  const recs = {};
  for (const [k, sd] of Object.entries(SD)) {
    const r = (await find('incident', `short_description=${sd}`)) ?? await call('POST', 'table/incident', { short_description: sd, caller_id: '6816f79cc0a8016401c5a33be04be441', impact: '3', urgency: '3' });
    recs[k] = { sys_id: r.sys_id, number: r.number };
  }
  return { recs };
}

async function f18Run(S) {
  const { call, find } = api();
  const log = [];
  await call('PATCH', `table/incident/${S.recs.A.sys_id}`, { description: 'Atualizado pela integração ' + Date.now() }); log.push('A api');
  await call('PATCH', `table/incident/${S.recs.B.sys_id}`, { impact: '3', urgency: '3' }); log.push('B volta ao início');
  await sleep(25000);
  await call('PATCH', `table/incident/${S.recs.B.sys_id}`, { impact: '1' }); log.push('B api+regra');
  const at = new Date(Date.now() + 10000).toISOString().replace('T', ' ').slice(0, 19);
  const name = '[PT] F18 Job que atualiza descrição';
  const v = { name, active: 'true', run_type: 'once', run_start: at, script: `var gr = new GlideRecord('incident'); if (gr.get('${S.recs.C.sys_id}')) { gr.description = 'Gravado pelo job F18'; gr.update(); }` };
  const cur = await find('sysauto_script', `name=${name}`);
  cur ? await call('PATCH', `table/sysauto_script/${cur.sys_id}`, v) : await call('POST', 'table/sysauto_script', v);
  log.push('C job agendado ' + at);
  await sleep(40000);
  const rows = await call('GET', `table/${T}?sysparm_fields=u_registro,u_campos,u_servidor,u_usuario,u_transacao,u_origem,sys_created_on&sysparm_query=${encodeURIComponent('u_registroIN' + Object.values(S.recs).map((r) => r.sys_id).join(',') + '^ORDERBYsys_created_on')}`);
  return { log, rows };
}
Object.assign(window, { f18Setup, f18Run });
})();
