/**
 * Bateria da Fase 7: outras tabelas além de incident (change_request, sc_req_item e uma tabela customizada).
 * Para cada tabela, um registro por cenário, cada regra com escopo pelo short_description do próprio registro:
 *
 *  BEFORE   BR before: quando o gatilho muda, grava o campo A                       → br_before
 *  AFTER    BR after: grava o campo B e chama current.update()                       → br_after
 *  ASYNC    BR async: grava o campo C e current.update()                             → br_async
 *  CLIENT   client script onChange grava o campo D no formulário (salvo pelo form)    → client_script
 *  UI       botão do formulário (UI action) grava o campo E                          → ui_action
 *  API      PATCH pela Table API grava o campo F                                     → user_action (api)
 *
 * Tudo leva o prefixo [PT] F7 e é idempotente. Rodar na aba logada (admin) da PDI.
 */
const F7 = {
  change_request: { scope: 'short_description', trig: 'description', a: 'justification', b: 'implementation_plan', c: 'risk_impact_analysis', d: 'backout_plan', dTrig: 'impact', dTrigValue: '1', e: 'close_notes', f: 'cab_recommendation', key: 'CHG' },
  sc_req_item: { scope: 'short_description', trig: 'description', a: 'close_notes', b: 'order', bValue: '7', c: 'correlation_id', d: 'backordered', dValue: 'true', dTrig: 'quantity', dTrigValue: '3', e: 'estimated_delivery', eValue: '2026-12-01 10:00:00', f: 'correlation_display', key: 'RITM' },
  u_pt_trail_teste: { scope: 'u_short_description', trig: 'u_gatilho', a: 'u_antes', b: 'u_depois', c: 'u_assincrono', d: 'u_cliente', dTrig: 'u_gatilho_form', dTrigValue: 'mudou', e: 'u_botao', f: 'u_api', key: 'CUSTOM' },
};

async function trailF7Api() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  return { api, find };
}

/** Cria a tabela customizada (se não existir), as colunas e liga a auditoria. */
async function trailF7Table() {
  const { api, find } = await trailF7Api();
  const t = 'u_pt_trail_teste';
  let tbl = await find('sys_db_object', `name=${t}`);
  if (!tbl) tbl = await api('POST', 'table/sys_db_object', { name: t, label: '[PT] Trail teste', create_access_controls: 'false' });
  const cols = { u_short_description: 'Descrição curta', u_gatilho: 'Gatilho', u_gatilho_form: 'Gatilho do formulário', u_antes: 'Antes', u_depois: 'Depois', u_assincrono: 'Assíncrono', u_cliente: 'Cliente', u_botao: 'Botão', u_api: 'API' };
  for (const [el, label] of Object.entries(cols)) {
    const cur = await find('sys_dictionary', `name=${t}^element=${el}`);
    if (!cur) await api('POST', 'table/sys_dictionary', { name: t, element: el, column_label: label, internal_type: 'string', max_length: '200', active: 'true' });
  }
  const coll = await find('sys_dictionary', `name=${t}^elementISEMPTY`);
  if (coll && coll.audit !== 'true') await api('PATCH', `table/sys_dictionary/${coll.sys_id}`, { audit: 'true' });
  const dispCol = await find('sys_dictionary', `name=${t}^element=u_short_description`);
  if (dispCol && dispCol.display !== 'true') await api('PATCH', `table/sys_dictionary/${dispCol.sys_id}`, { display: 'true' });
  return { table: tbl.sys_id, audit: coll && coll.audit };
}

async function trailSetupF7() {
  const { api, find } = await trailF7Api();
  const upsert = async (table, values) => {
    const cur = await find(table, `name=${values.name}^${values.collection ? 'collection' : 'table'}=${values.collection || values.table}`);
    return cur && cur.name === values.name ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  const wrap = (s) => `(function executeRule(current, previous) {\n${s}\n})(current, previous);`;
  const out = {};
  for (const [table, c] of Object.entries(F7)) {
    const sd = (k) => `[PT] F7-${c.key}-${k}`;
    const cond = (k) => `${c.scope}=${sd(k)}^EQ`;
    const br = (name, when, k, script) => upsert('sys_script', { name, collection: table, active: 'true', when, order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: cond(k), script: wrap(script) });
    const v = (x, def) => c[x + 'Value'] ?? def;
    await br(`[PT] F7 ${c.key} before`, 'before', 'BEFORE', `  if (current.${c.trig}.changes()) current.${c.a} = '${v('a', 'F7 before')}';`);
    await br(`[PT] F7 ${c.key} after`, 'after', 'AFTER', `  if (current.${c.trig}.changes() && current.${c.b} != '${v('b', 'F7 after')}') { current.${c.b} = '${v('b', 'F7 after')}'; current.update(); }`);
    await br(`[PT] F7 ${c.key} async`, 'async', 'ASYNC', `  if (current.${c.c} != '${v('c', 'F7 async')}') { current.${c.c} = '${v('c', 'F7 async')}'; current.update(); }`);
    await upsert('sys_ui_action', { name: `[PT] F7 ${c.key} botão`, table, action_name: `pt_f7_${c.key.toLowerCase()}`, active: 'true', form_button: 'true', client: 'false',
      condition: `current.${c.scope} == '${sd('UI')}'`, script: `current.${c.e} = '${v('e', 'F7 ui')}';\ncurrent.update();\naction.setRedirectURL(current);` });
    out[table] = {};
    for (const k of ['BEFORE', 'AFTER', 'ASYNC', 'CLIENT', 'UI', 'API']) {
      const base = { [c.scope]: sd(k) };
      if (table === 'change_request') Object.assign(base, { type: 'normal', impact: '3' });
      if (table === 'sc_req_item') Object.assign(base, { quantity: '1' });
      const r = (await find(table, `${c.scope}=${sd(k)}`)) ?? await api('POST', `table/${table}`, base);
      out[table][k] = { number: r.number || '', sys_id: r.sys_id };
    }
    // Escopo do client script pelo sys_id do registro de teste: o short_description nem sempre está no formulário (RITM).
    await upsert('sys_script_client', { name: `[PT] F7 ${c.key} client`, table, active: 'true', type: 'onChange', field: c.dTrig, ui_type: '0',
      script: `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getUniqueValue() != '${out[table].CLIENT.sys_id}') return;\n  g_form.setValue('${c.d}', '${v('d', 'F7 client')}');\n}` });
  }
  return out;
}

/** Dispara os cenários: PATCH no gatilho (servidor), formulário (client) e botão (UI action). */
async function trailTriggerF7(recs) {
  const { api } = await trailF7Api();
  const log = [];
  for (const [table, c] of Object.entries(F7)) {
    const r = recs[table];
    const stamp = 'F7 gatilho ' + new Date().toISOString();
    for (const k of ['BEFORE', 'AFTER', 'ASYNC']) { await api('PATCH', `table/${table}/${r[k].sys_id}`, { [c.trig]: stamp }); log.push(`${table} ${k} patch`); }
    await api('PATCH', `table/${table}/${r.API.sys_id}`, { [c.f]: 'F7 api ' + Date.now() }); log.push(`${table} API patch`);
    await trailFormSaveT(table, r.CLIENT.sys_id, { [c.dTrig]: c.dTrigValue }, 'sysverb_update_and_stay'); log.push(`${table} CLIENT form`);
    await trailFormSaveT(table, r.UI.sys_id, {}, `pt_f7_${c.key.toLowerCase()}`); log.push(`${table} UI button`);
  }
  return log;
}

/** Salva pelo formulário UI16 real num iframe; `action` é o action_name do botão. */
async function trailFormSaveT(table, sysId, values, action) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/${table}.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 800));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 700)); }
  const mand = (w.g_form.getMissingFields && w.g_form.getMissingFields()) || [];
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, 500));
  f.remove();
  return { mand };
}
