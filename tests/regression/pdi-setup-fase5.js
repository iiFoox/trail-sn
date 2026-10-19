/**
 * Bateria da Fase 5: concorrência — vários scripts disputando o mesmo campo ou encadeados.
 * Tudo leva o prefixo [PT] F5 e é idempotente. Rodar na aba logada (admin) da PDI.
 *
 *  F5-ORDER      duas BRs before gravam impact (order 100 → 2, order 300 → 1)        impact      → br_before "[PT] F5 ordem 300"
 *  F5-ORDERCOND  duas BRs before gravam urgency; a de order maior tem condição falsa   urgency     → br_before "[PT] F5 cond 100"
 *  F5-CASCADE    BR after grava description + update(); BR before reage e grava impact description → br_after A; impact → br_before B
 *  F5-EVENT      BR after dispara evento → script action grava severity → BR before grava notify
 *  F5-CLIENT2    client script A (contact_type) grava impact → client script B (impact) grava urgency
 *  F5-RESTBR     PATCH muda contact_type; BR before grava urgency                      urgency     → br_before
 *  F5-CALC       BR before grava description = short_description + " calc"             description → br_before (valor calculado)
 *  F5-LOOKUPBR   pessoa muda impact; Priority Lookup calcula; BR before order 1000 força priority=1 → br_before
 */
async function trailSetupF5() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status);
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  const upsert = async (table, values) => {
    const cur = await find(table, `name=${values.name}`);
    return cur && cur.name === values.name ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  const wrap = (s) => `(function executeRule(current, previous) {\n${s}\n})(current, previous);`;
  const br = (name, when, order, cond, script) => upsert('sys_script', { name, collection: 'incident', active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: cond + '^EQ', script: wrap(script) });
  const pre = (k) => `short_descriptionSTARTSWITH[PT] ${k}`;

  await br('[PT] F5 ordem 100', 'before', 100, 'short_description=[PT] F5-ORDER', "  if (current.contact_type.changes()) current.impact = 2;");
  await br('[PT] F5 ordem 300', 'before', 300, 'short_description=[PT] F5-ORDER', "  if (current.contact_type.changes()) current.impact = 1;");
  await br('[PT] F5 cond 100', 'before', 100, pre('F5-ORDERCOND'), "  if (current.contact_type.changes()) current.urgency = 2;");
  await br('[PT] F5 cond 300', 'before', 300, pre('F5-ORDERCOND') + '^category=hardware', "  if (current.contact_type.changes()) current.urgency = 1;");
  await br('[PT] F5 cascata A', 'after', 100, pre('F5-CASCADE'), "  if (current.contact_type.changes() && current.description != 'F5 A') { current.description = 'F5 A'; current.update(); }");
  await br('[PT] F5 cascata B', 'before', 100, pre('F5-CASCADE'), "  if (current.description.changes() && current.description == 'F5 A') current.impact = 1;");
  if (!(await find('sysevent_register', 'event_name=pt.f5.evento'))) await api('POST', 'table/sysevent_register', { event_name: 'pt.f5.evento', table: 'incident', description: '[PT] F5 evento' });
  await br('[PT] F5 evento dispara', 'after', 100, pre('F5-EVENT'), "  if (current.contact_type.changes()) gs.eventQueue('pt.f5.evento', current, '', '');");
  await upsert('sysevent_script_action', { name: '[PT] F5 script action', event_name: 'pt.f5.evento', active: 'true', script: "var gr = new GlideRecord('incident');\nif (gr.get(current.sys_id)) { gr.severity = 1; gr.update(); }" });
  await br('[PT] F5 evento before', 'before', 100, pre('F5-EVENT'), "  if (current.severity.changes() && current.severity == 1) current.notify = 2;");
  await br('[PT] F5 rest before', 'before', 100, pre('F5-RESTBR'), "  if (current.contact_type.changes()) current.urgency = 1;");
  await br('[PT] F5 calculo', 'before', 100, pre('F5-CALC'), "  if (current.contact_type.changes()) current.description = current.short_description + ' calc';");
  await br('[PT] F5 prioridade', 'before', 1000, pre('F5-LOOKUPBR'), "  if (current.impact.changes()) current.priority = 1;");
  const cs = (name, field, body) => upsert('sys_script_client', { name, table: 'incident', active: 'true', type: 'onChange', field, ui_type: '0',
    script: `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getValue('short_description').indexOf('[PT] F5-CLIENT2') != 0) return;\n  ${body}\n}` });
  await cs('[PT] F5 client A', 'contact_type', "g_form.setValue('impact', '2');");
  await cs('[PT] F5 client B', 'impact', "g_form.setValue('urgency', '2');");

  const out = {};
  for (const k of ['F5-ORDER', 'F5-ORDERCOND', 'F5-CASCADE', 'F5-EVENT', 'F5-CLIENT2', 'F5-RESTBR', 'F5-CALC', 'F5-LOOKUPBR']) {
    const desc = `[PT] ${k}`;
    const r = (await find('incident', `short_description=${desc}`)) ?? await api('POST', 'table/incident', { short_description: desc, caller_id: '6816f79cc0a8016401c5a33be04be441', contact_type: 'phone', impact: '3', urgency: '3', severity: '3', notify: '1', category: 'inquiry', description: 'inicial' });
    out[k] = { number: r.number, sys_id: r.sys_id };
  }
  return out;
}

/** Salva pelo formulário UI16 real (num iframe), para gerar a transação de formulário e rodar os client scripts. */
async function trailFormSave(sysId, values) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/incident.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getValue('number')); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 800));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 600)); }
  const before = Object.fromEntries(['impact', 'urgency', 'description', 'contact_type'].map((k) => [k, w.g_form.getValue(k)]));
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), 'sysverb_update_and_stay');
  await done;
  await new Promise((r) => setTimeout(r, 500));
  f.remove();
  return before;
}
