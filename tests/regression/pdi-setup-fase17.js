/**
 * Fase 17 — pingue-pongue: duas regras trocando o valor da urgência do mesmo incidente.
 *   A (before): quando a descrição muda, urgência = 2.
 *   B (async):  quando a urgência vira 2, volta para 3 (current.update()).
 * Dois PATCH na descrição → 3→2 (A), 2→3 (B), 3→2 (A), 2→3 (B).
 *   window.F17S = await f17Setup(); window.F17L = await f17Run(F17S);
 */
(function () {
const SD = '[PT] F17-PP1 Urgência que vai e volta';
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
async function f17Setup() {
  const { call, find } = api();
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = async (name, when, script, filter) => {
    const v = { name, collection: 'incident', active: 'true', when, order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: `short_description=${SD}^${filter}^EQ`, condition: '', script: wrap(script) };
    const cur = await find('sys_script', `name=${name}^collection=incident`);
    return cur ? call('PATCH', `table/sys_script/${cur.sys_id}`, v) : call('POST', 'table/sys_script', v);
  };
  await br('[PT] F17 Urgência média ao descrever', 'before', "  current.urgency = 2;", 'descriptionVALCHANGES');
  await br('[PT] F17 Urgência volta para baixa', 'async', "  if (current.urgency == 2) { current.urgency = 3; current.update(); }", 'urgencyVALCHANGES');
  const r = (await find('incident', `short_description=${SD}`)) ?? await call('POST', 'table/incident', { short_description: SD, caller_id: '6816f79cc0a8016401c5a33be04be441', impact: '3', urgency: '3' });
  return { sys_id: r.sys_id, number: r.number };
}
async function f17Run(S) {
  const { call } = api();
  const log = [];
  for (const d of ['Primeira descrição do problema', 'Descrição revisada pelo usuário']) {
    await call('PATCH', `table/incident/${S.sys_id}`, { description: d });
    log.push(new Date().toISOString() + ' patch');
    await sleep(30000);
  }
  return log;
}
Object.assign(window, { f17Setup, f17Run });
})();
