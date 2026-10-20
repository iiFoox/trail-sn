/**
 * Fase 13 — importação por transform map, UI policies e data policies. Tudo leva o prefixo [PT] F13 e é idempotente.
 *
 *   window.F13S = await f13Setup();      // tabela de importação, transform map, scripts, BRs, políticas e registros
 *   window.F13L = await f13Run(F13S);    // importações pela API, gravações de formulário (iframe) e PATCH
 *   window.F13A = await f13Audit(F13S);  // sys_audit dos registros
 */
(function () {
const F13 = {
  STAGE: 'u_pt_f13_import',
  MAP: '[PT] F13 Chamados do parceiro',
  SD: {
    IMP1: '[PT] F13-IMP1 Chamado do parceiro (tudo)',
    IMP2: '[PT] F13-IMP2 Chamado do parceiro (duas cargas)',
    IMP3: '[PT] F13-IMP3 Chamado do parceiro e ajuste manual',
    UIP1: '[PT] F13-UIP1 Política de rede',
    UIP2: '[PT] F13-UIP2 Política reversa',
    UIP3: '[PT] F13-UIP3 Política só obrigatória',
    DP1: '[PT] F13-DP1 Política de dados',
  },
};

function f13api() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, { method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  const upsert = async (table, values, key) => {
    const label = String(values.name || values.short_description || values.description || '');
    if (!/^\[PT\] F13/.test(label)) throw new Error('sem prefixo [PT] F13: ' + label);
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function f13Setup() {
  const { api, find, upsert } = f13api();
  const S = F13.SD;
  // ---------- tabela de importação ----------
  const base = await find('sys_db_object', 'name=sys_import_set_row');
  let stage = await find('sys_db_object', `name=${F13.STAGE}`);
  if (!stage) stage = await api('POST', 'table/sys_db_object', { name: F13.STAGE, label: '[PT] F13 importação do parceiro', super_class: base.sys_id, create_access_controls: 'false' });
  for (const [el, label] of Object.entries({ u_chave: 'Chave', u_descricao: 'Descrição', u_categoria: 'Categoria', u_codigo: 'Código', u_urgencia: 'Urgência' })) {
    if (!(await find('sys_dictionary', `name=${F13.STAGE}^element=${el}`))) await api('POST', 'table/sys_dictionary', { name: F13.STAGE, element: el, column_label: label, internal_type: 'string', max_length: '200', active: 'true' });
  }
  // ---------- transform map ----------
  const map = await upsert('sys_transform_map', { name: F13.MAP, source_table: F13.STAGE, target_table: 'incident', active: 'true', run_business_rules: 'true', enforce_mandatory_fields: 'no', order: '100',
    run_script: 'true', script: "(function transformRow(source, target, map, log, isUpdate) {\n  target.correlation_display = 'PARCEIRO-' + source.u_codigo;\n})(source, target, map, log, action==='update');" });
  const entry = async (src, tgt, extra = {}) => {
    const cur = await find('sys_transform_entry', `map=${map.sys_id}^target_field=${tgt}`);
    const v = { map: map.sys_id, source_table: F13.STAGE, source_field: src, target_table: 'incident', target_field: tgt, ...extra };
    return cur ? api('PATCH', `table/sys_transform_entry/${cur.sys_id}`, v) : api('POST', 'table/sys_transform_entry', v);
  };
  await entry('u_chave', 'short_description', { coalesce: 'true' });
  await entry('u_descricao', 'description');
  await entry('u_categoria', 'category', { choice_action: 'ignore' });
  await entry('', 'close_notes', { use_source_script: 'true', source_script: "answer = (function transformEntry(source) {\n  return 'Recebido do parceiro, código ' + source.u_codigo;\n})(source);" });
  const ts = await find('sys_transform_script', `map=${map.sys_id}^when=onBefore`);
  const tsv = { map: map.sys_id, when: 'onBefore', active: 'true', order: '100', script: "(function runTransformScript(source, map, log, target /*undefined onStart*/ ) {\n  target.correlation_id = 'PARC-' + source.u_codigo;\n})(source, map, log, target);" };
  ts ? await api('PATCH', `table/sys_transform_script/${ts.sys_id}`, tsv) : await api('POST', 'table/sys_transform_script', tsv);

  // ---------- regras do incidente que reagem à importação ----------
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (name, when, order, filter, script) => upsert('sys_script', {
    name, collection: 'incident', active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: filter + '^EQ', condition: '', script: wrap(script),
  }, `name=${name}^collection=incident`);
  await br('[PT] F13 Hardware do parceiro vira rede', 'before', 100, 'short_descriptionSTARTSWITH[PT] F13-IMP', "  if (current.category == 'hardware') current.category = 'network';");
  await br('[PT] F13 Urgência do parceiro', 'after', 100, `short_description=${S.IMP1}`, "  if (current.description.changes() && current.urgency != 2) { current.urgency = 2; current.update(); }");

  // ---------- UI policies ----------
  const pol = async (name, sd, extra) => upsert('sys_ui_policy', { short_description: name, table: 'incident', active: 'true', on_load: 'true', reverse_if_false: 'true', global: 'true', ui_type: '0', order: '100', ...extra,
    conditions: `short_description=${sd}^${extra.conditions}^EQ` }, `short_description=${name}^table=incident`);
  await pol('[PT] F13 Rede pede verificação de DNS', S.UIP1, { conditions: 'category=network', run_scripts: 'true',
    script_true: "function onCondition() {\n  g_form.setValue('description', 'Verificar resolução de DNS no site');\n}", script_false: 'function onCondition() {\n}' });
  await pol('[PT] F13 Fora de rede limpa a nota', S.UIP2, { conditions: 'category=network', run_scripts: 'true',
    script_true: 'function onCondition() {\n}', script_false: "function onCondition() {\n  g_form.setValue('close_notes', 'Fora do escopo de rede');\n}" });
  const p3 = await pol('[PT] F13 Hardware exige descrição', S.UIP3, { conditions: 'category=hardware', run_scripts: 'false' });
  if (!(await find('sys_ui_policy_action', `ui_policy=${p3.sys_id}^field=description`))) await api('POST', 'table/sys_ui_policy_action', { ui_policy: p3.sys_id, table: 'incident', field: 'description', mandatory: 'true', visible: 'ignore', disabled: 'ignore' });

  // ---------- data policy ----------
  const dp = await upsert('sys_data_policy2', { short_description: '[PT] F13 Política de dados do DP1', model_table: 'incident', active: 'true', apply_import_set: 'true', apply_soap: 'true', apply_ui: 'false',
    conditions: `short_description=${S.DP1}^EQ` }, `short_description=[PT] F13 Política de dados do DP1`);
  if (!(await find('sys_data_policy_rule', `sys_data_policy=${dp.sys_id}^field=close_notes`))) await api('POST', 'table/sys_data_policy_rule', { sys_data_policy: dp.sys_id, table: 'incident', field: 'close_notes', mandatory: 'true', disabled: 'ignore' });

  // ---------- registros ----------
  const recs = {};
  for (const [k, v] of Object.entries(S)) {
    const r = (await find('incident', `short_description=${v}`)) ?? await api('POST', 'table/incident', { short_description: v, caller_id: '6816f79cc0a8016401c5a33be04be441', impact: '3', urgency: '3', category: k === 'UIP2' ? 'network' : 'inquiry' });
    recs[k] = { number: r.number, sys_id: r.sys_id };
  }
  return { map: map.sys_id, recs };
}

/** Salva pelo formulário UI16 real num iframe. */
async function f13Form(sysId, values) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/incident.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await sleep(200);
  await sleep(1200);
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await sleep(900); }
  const seen = { description: w.g_form.getValue('description'), close_notes: w.g_form.getValue('close_notes') };
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), 'sysverb_update_and_stay');
  await Promise.race([done, sleep(15000)]);
  await sleep(500);
  f.remove();
  return seen;
}

async function f13Run(I) {
  const { api } = f13api();
  const S = F13.SD, R = I.recs, log = [];
  const imp = async (row) => { const r = await api('POST', `import/${F13.STAGE}`, row); log.push(`${new Date().toISOString()} import ${row.u_chave.slice(5, 14)} ${JSON.stringify((r.result || r)).slice(0, 160)}`); };
  await imp({ u_chave: S.IMP1, u_descricao: 'Parceiro relata falha no roteador da filial 12', u_categoria: 'hardware', u_codigo: '4471' });
  await sleep(2000);
  await imp({ u_chave: S.IMP2, u_descricao: 'Primeira carga do parceiro', u_categoria: 'software', u_codigo: '5001' });
  await sleep(2000);
  await imp({ u_chave: S.IMP3, u_descricao: 'Carga do parceiro antes do ajuste', u_categoria: 'software', u_codigo: '6001' });
  await sleep(4000);
  await api('PATCH', `table/incident/${R.IMP3.sys_id}`, { impact: '2' }); log.push(`${new Date().toISOString()} IMP3 patch impact`);
  log.push('UIP1 ' + JSON.stringify(await f13Form(R.UIP1.sys_id, { category: 'network' })));
  log.push('UIP2 ' + JSON.stringify(await f13Form(R.UIP2.sys_id, { urgency: '2', category: 'software' })));
  log.push('UIP3 ' + JSON.stringify(await f13Form(R.UIP3.sys_id, { category: 'hardware', description: 'Teclado do caixa 3 sem resposta' })));
  await api('PATCH', `table/incident/${R.DP1.sys_id}`, { close_notes: 'Encerrado pela API com nota obrigatória' }); log.push(`${new Date().toISOString()} DP1 patch`);
  await sleep(25000);
  await imp({ u_chave: S.IMP2, u_descricao: 'Segunda carga do parceiro', u_categoria: 'software', u_codigo: '5002' });
  return log.map((x) => x.replace(/[=&?]/g, '_'));
}

async function f13Audit(I) {
  const { api } = f13api();
  const a = await api('GET', `table/sys_audit?sysparm_limit=300&sysparm_fields=documentkey,fieldname,oldvalue,newvalue,user,sys_created_on&sysparm_query=documentkeyIN${Object.values(I.recs).map((r) => r.sys_id).join(',')}^ORDERBYsys_created_on`);
  return a.map((x) => `${x.sys_created_on} ${Object.entries(I.recs).find(([, r]) => r.sys_id === x.documentkey)[0]} ${x.fieldname} ${x.user} ${String(x.oldvalue).slice(0, 20)} -> ${String(x.newvalue).slice(0, 34)}`.replace(/[=&?]/g, '_'));
}

Object.assign(window, { F13, f13Setup, f13Run, f13Audit, f13Form });
})();
