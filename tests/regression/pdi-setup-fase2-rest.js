/**
 * Bateria da Fase 2: vários campos mudando na mesma gravação, por mecanismos diferentes.
 * Criada pela Table API a partir de uma aba logada (admin). Tudo leva o prefixo [PT] F2 e é idempotente.
 *
 *  F2-USER    pessoa muda contact_type, description e urgency no formulário        -> user_action em cada um
 *  F2-CLIENT  pessoa muda contact_type; client script preenche description e impact -> client_script
 *  F2-BEFORE  pessoa muda contact_type; BR before grava description e urgency        -> br_before
 *  F2-AFTER   pessoa muda contact_type; BR after grava description e urgency (update) -> br_after
 *  F2-ASYNC   pessoa muda contact_type; BR async grava description e urgency         -> br_async
 *  F2-REST    PATCH com contact_type, description e urgency de uma vez               -> user_action (candidato)
 *  F2-MIXED   uma gravação: contact_type pela pessoa, description pelo client script, urgency pela BR before
 *
 * Uso: `await trailSetupF2()` na aba; os salvamentos de formulário são feitos à parte (UI16) para gerar transações reais.
 */
async function trailSetupF2() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status);
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  const upsert = async (table, values) => (await find(table, `name=${values.name}`)) ?? api('POST', `table/${table}`, values);
  const br = (name, when, prefix, script) => upsert('sys_script', { name, collection: 'incident', active: 'true', when, order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: `short_descriptionSTARTSWITH[PT] ${prefix}^EQ`, script: `(function executeRule(current, previous) {\n${script}\n})(current, previous);` });

  await br('[PT] F2 before varios', 'before', 'F2-BEFORE', "  if (current.contact_type.changes()) { current.description = 'F2 before'; current.urgency = 2; }");
  await br('[PT] F2 after varios', 'after', 'F2-AFTER', "  if (current.description != 'F2 after') { current.description = 'F2 after'; current.urgency = 2; current.update(); }");
  await br('[PT] F2 async varios', 'async_always', 'F2-ASYNC', "  var gr = new GlideRecord('incident');\n  if (gr.get(current.sys_id) && gr.description != 'F2 async') { gr.description = 'F2 async'; gr.urgency = 2; gr.update(); }");
  await br('[PT] F2 mixed urgencia', 'before', 'F2-MIXED', "  if (current.contact_type.changes()) current.urgency = 1;");
  await upsert('sys_script_client', { name: '[PT] F2 client varios', table: 'incident', active: 'true', type: 'onChange', field: 'contact_type', ui_type: '0',
    script: "function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading) return;\n  var d = g_form.getValue('short_description');\n  if (d.indexOf('[PT] F2-CLIENT') == 0) { g_form.setValue('description', 'F2 client'); g_form.setValue('impact', '2'); }\n  if (d.indexOf('[PT] F2-MIXED') == 0) g_form.setValue('description', 'F2 mixed client');\n}" });

  const out = {};
  for (const k of ['F2-USER', 'F2-CLIENT', 'F2-BEFORE', 'F2-AFTER', 'F2-ASYNC', 'F2-REST', 'F2-MIXED']) {
    const desc = `[PT] ${k}`;
    const r = (await find('incident', `short_description=${desc}`)) ?? await api('POST', 'table/incident', { short_description: desc, caller_id: '6816f79cc0a8016401c5a33be04be441', contact_type: 'self-service', impact: '3', urgency: '3', description: 'inicial' });
    out[k] = { number: r.number, sys_id: r.sys_id };
  }
  return out;
}
