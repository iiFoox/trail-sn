/**
 * Bateria da Fase 8: matriz. Cada combinação de MECANISMO × TIPO DE CAMPO × TABELA num registro próprio,
 * com a resposta declarada antes de rodar e com iscas (regras que citam o campo mas não deveriam ganhar).
 *
 * Tabelas: incident (gatilho contact_type) e change_request (gatilho description).
 * Tipos:  choice (impact), texto, referência (assignment_group) e booleano.
 * Mecanismos:
 *   PFORM   pessoa muda o campo no formulário                         → user_action
 *   PAPI    pessoa muda o campo por PATCH na API                      → user_action
 *   BBF     BR before reage ao gatilho mudado no formulário           → br_before
 *   BBA     BR before reage ao gatilho mudado pela API                → br_before
 *   BAF     BR after grava e chama current.update()                   → br_after
 *   BAS     BR async grava e chama current.update()                   → br_async
 *   SA      BR after dispara evento; script action grava              → script_action
 *   UI      botão do formulário (UI action) grava                     → ui_action
 *   CS      client script onChange do gatilho preenche no formulário  → client_script
 *   JOB     job agendado de execução única grava                      → scheduled_job
 *   ORD     duas BRs before gravam; a de ordem 300 vence              → br_before "... ordem 300"
 *   SI      BR after chama script include que grava                   → br_via_script_include
 * Iscas em todos os registros: uma BR before que grava OUTRO valor sob condição falsa e um client script que só lê.
 *
 * Tudo com prefixo [PT] M8 e escopo por short_description. Rodar na aba logada (admin) da PDI.
 */
const M8 = {
  MECHS: ['PFORM', 'PAPI', 'BBF', 'BBA', 'BAF', 'BAS', 'SA', 'UI', 'CS', 'JOB', 'ORD', 'SI'],
  TABLES: {
    incident: { key: 'INC', trig: 'contact_type', trigFrom: 'phone', trigTo: 'email', types: { choice: 'impact', text: 'close_notes', ref: 'assignment_group', bool: 'knowledge' }, base: { caller_id: '6816f79cc0a8016401c5a33be04be441', contact_type: 'phone', impact: '3', urgency: '3', knowledge: 'false', close_notes: 'inicial' } },
    change_request: { key: 'CHG', trig: 'description', trigFrom: 'inicial', trigTo: 'gatilho M8', types: { choice: 'impact', text: 'justification', ref: 'assignment_group', bool: 'cab_required' }, base: { type: 'normal', impact: '3', description: 'inicial', cab_required: 'false', justification: 'inicial' } },
  },
};

async function trailM8Api() {
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
    const cur = await find(table, key);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

/** Valores: o que o mecanismo grava (ok), o que a regra de ordem menor grava (low) e o da isca (bait). */
async function trailM8Values() {
  const { find } = await trailM8Api();
  const g1 = (await find('sys_user_group', 'name=Network')).sys_id;
  const g2 = (await find('sys_user_group', 'name=Hardware')).sys_id;
  const g3 = (await find('sys_user_group', 'name=Database')).sys_id;
  return {
    choice: { ok: '1', low: '2', bait: '2' },
    text: (m) => ({ ok: 'M8 ' + m, low: 'M8 baixa', bait: 'M8 isca' }),
    ref: { ok: g1, low: g2, bait: g3 },
    bool: { ok: 'true', low: 'false', bait: 'false' },
  };
}

function m8Val(V, type, mech) { return type === 'text' ? V.text(mech) : V[type]; }

async function trailSetupM8() {
  const { api, find, upsert } = await trailM8Api();
  const V = await trailM8Values();
  const wrap = (s) => `(function executeRule(current, previous) {\n${s}\n})(current, previous);`;
  const q = (s) => s.replace(/'/g, "\\'");
  const out = { values: { choice: V.choice, ref: V.ref, bool: V.bool }, recs: {} };
  for (const [table, T] of Object.entries(M8.TABLES)) {
    const sd = (mech, type) => `[PT] M8-${T.key}-${mech}-${type}`;
    const br = (name, when, order, filter, script, extra = {}) => upsert('sys_script', { name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: filter + '^EQ', script: wrap(script), ...extra }, `name=${name}^collection=${table}`);
    // evento e script include da tabela
    const ev = `pt.m8.${T.key.toLowerCase()}`;
    if (!(await find('sysevent_register', `event_name=${ev}`))) await api('POST', 'table/sysevent_register', { event_name: ev, table, description: '[PT] M8 evento' });
    const siName = `PTM8Grava${T.key}`;
    await upsert('sys_script_include', { name: siName, api_name: 'global.' + siName, active: 'true', access: 'public',
      script: `var ${siName} = Class.create();\n${siName}.prototype = {\n  initialize: function() {},\n  grava: function(sysId, campo, valor) {\n    var gr = new GlideRecord('${table}');\n    if (gr.get(sysId) && gr.getValue(campo) != valor) { gr.setValue(campo, valor); gr.update(); }\n  },\n  type: '${siName}'\n};` }, `name=${siName}`);
    const saCases = [];
    for (const [type, field] of Object.entries(T.types)) {
      const v = (m) => m8Val(V, type, m);
      const changed = `current.${T.trig}.changes()`;
      // mecanismos de servidor
      await br(`[PT] M8 ${T.key} before ${type}`, 'before', 100, `short_descriptionIN${sd('BBF', type)},${sd('BBA', type)}`, `  if (${changed}) current.${field} = '${q(v('BB').ok)}';`);
      await br(`[PT] M8 ${T.key} after ${type}`, 'after', 100, `short_description=${sd('BAF', type)}`, `  if (${changed} && current.getValue('${field}') != '${q(v('BAF').ok)}') { current.${field} = '${q(v('BAF').ok)}'; current.update(); }`);
      await br(`[PT] M8 ${T.key} async ${type}`, 'async', 100, `short_description=${sd('BAS', type)}`, `  if (current.getValue('${field}') != '${q(v('BAS').ok)}') { current.${field} = '${q(v('BAS').ok)}'; current.update(); }`);
      await br(`[PT] M8 ${T.key} dispara ${type}`, 'after', 100, `short_description=${sd('SA', type)}`, `  if (${changed}) gs.eventQueue('${ev}', current, '${field}', '${q(v('SA').ok)}');`);
      saCases.push(`if (current.short_description == '${sd('SA', type)}' && event.parm1 == '${field}') { current.${field} = '${q(v('SA').ok)}'; current.update(); }`);
      await br(`[PT] M8 ${T.key} ordem 100 ${type}`, 'before', 100, `short_description=${sd('ORD', type)}`, `  if (${changed}) current.${field} = '${q(v('ORD').low)}';`);
      await br(`[PT] M8 ${T.key} ordem 300 ${type}`, 'before', 300, `short_description=${sd('ORD', type)}`, `  if (${changed}) current.${field} = '${q(v('ORD').ok)}';`);
      await br(`[PT] M8 ${T.key} chama SI ${type}`, 'after', 100, `short_description=${sd('SI', type)}`, `  if (${changed}) new ${siName}().grava(current.getUniqueValue(), '${field}', '${q(v('SI').ok)}');`);
      // isca: BR before em TODOS os registros M8 desta tabela, grava outro valor sob condição falsa
      await br(`[PT] M8 ${T.key} isca ${type}`, 'before', 200, `short_descriptionSTARTSWITH[PT] M8-${T.key}-`, `  if (current.urgency == 'zzz' || current.short_description == 'nunca') current.${field} = '${q(v('ISCA').bait)}';`);
      // botão
      await upsert('sys_ui_action', { name: `[PT] M8 ${T.key} botão ${type}`, table, action_name: `pt_m8_${T.key.toLowerCase()}_${type}`, active: 'true', form_button: 'true', client: 'false',
        condition: `current.short_description == '${sd('UI', type)}'`, script: `current.${field} = '${q(v('UI').ok)}';\ncurrent.update();\naction.setRedirectURL(current);` }, `action_name=pt_m8_${T.key.toLowerCase()}_${type}^table=${table}`);
    }
    await upsert('sysevent_script_action', { name: `[PT] M8 ${T.key} script action`, event_name: ev, active: 'true', script: saCases.join('\n') }, `name=[PT] M8 ${T.key} script action`);

    // registros
    out.recs[table] = {};
    for (const type of Object.keys(T.types)) for (const mech of M8.MECHS) {
      const s = sd(mech, type);
      const r = (await find(table, `short_description=${s}`)) ?? await api('POST', `table/${table}`, { short_description: s, ...T.base });
      out.recs[table][`${mech}-${type}`] = r.sys_id;
    }
    // client scripts: um por tipo (preenche) e uma isca que só lê
    for (const [type, field] of Object.entries(T.types)) {
      await upsert('sys_script_client', { name: `[PT] M8 ${T.key} client ${type}`, table, active: 'true', type: 'onChange', field: T.trig, ui_type: '0',
        script: `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getUniqueValue() != '${out.recs[table]['CS-' + type]}') return;\n  g_form.setValue('${field}', '${q(m8Val(V, type, 'CS').ok)}');\n}` }, `name=[PT] M8 ${T.key} client ${type}^table=${table}`);
    }
    await upsert('sys_script_client', { name: `[PT] M8 ${T.key} client só lê`, table, active: 'true', type: 'onChange', field: T.trig, ui_type: '0',
      script: `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading) return;\n  var s = g_form.getValue('short_description');\n  if (s.indexOf('[PT] M8-') != 0) return;\n  var x = [${Object.values(T.types).map((f) => `g_form.getValue('${f}')`).join(', ')}];\n  if (x.length > 99) jslog(x.join());\n}` }, `name=[PT] M8 ${T.key} client só lê^table=${table}`);
  }
  return out;
}

/** Dispara todos os cenários. Formulário num iframe; job de execução única ~90 s à frente. */
async function trailTriggerM8(setup) {
  const { api, upsert } = await trailM8Api();
  const V = await trailM8Values();
  const log = [];
  const jobs = [];
  for (const [table, T] of Object.entries(M8.TABLES)) {
    const R = setup.recs[table];
    for (const [type, field] of Object.entries(T.types)) {
      const id = (m) => R[`${m}-${type}`];
      const v = (m) => m8Val(V, type, m).ok;
      const step = async (m, fn) => { try { await fn(); log.push(`${table} ${m}-${type} ok`); } catch (e) { log.push(`${table} ${m}-${type} ERRO ${e.message}`); } };
      await step('PFORM', () => trailM8Form(table, id('PFORM'), { [field]: v('PFORM') }, 'sysverb_update_and_stay'));
      await step('PAPI', () => api('PATCH', `table/${table}/${id('PAPI')}`, { [field]: v('PAPI') }));
      await step('BBF', () => trailM8Form(table, id('BBF'), { [T.trig]: T.trigTo }, 'sysverb_update_and_stay'));
      await step('BBA', () => api('PATCH', `table/${table}/${id('BBA')}`, { [T.trig]: T.trigTo }));
      for (const m of ['BAF', 'SA', 'ORD', 'SI']) await step(m, () => api('PATCH', `table/${table}/${id(m)}`, { [T.trig]: T.trigTo }));
      await step('BAS', () => api('PATCH', `table/${table}/${id('BAS')}`, { [T.trig]: T.trigTo }));
      await step('UI', () => trailM8Form(table, id('UI'), {}, `pt_m8_${T.key.toLowerCase()}_${type}`));
      await step('CS', () => trailM8Form(table, id('CS'), { [T.trig]: T.trigTo }, 'sysverb_update_and_stay'));
      jobs.push({ table, field, id: id('JOB'), value: m8Val(V, type, 'JOB').ok, name: `[PT] M8 ${T.key} job ${type}` });
    }
  }
  // jobs de execução única, espaçados 20 s, começando em ~90 s (UTC)
  let t0 = Date.now() + 90e3;
  for (const j of jobs) {
    const t = new Date(t0).toISOString().replace('T', ' ').slice(0, 19);
    t0 += 20e3;
    await upsert('sysauto_script', { name: j.name, active: 'true', run_type: 'once', run_start: t,
      script: `var gr = new GlideRecord('${j.table}');\nif (gr.get('${j.id}') && gr.getValue('${j.field}') != '${j.value}') { gr.setValue('${j.field}', '${j.value}'); gr.update(); }` }, `name=${j.name}`);
    log.push(`job ${j.name} ${t}`);
  }
  return log;
}

async function trailM8Form(table, sysId, values, action) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/${table}.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 800));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 700)); }
  // campos obrigatórios vazios bloqueiam o envio: preenche só se estiverem vazios
  let missing = (w.g_form.getMissingFields && w.g_form.getMissingFields()) || [];
  // Política da instância: mudar o impacto exige nota de trabalho. A nota não interfere no campo testado.
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'teste Trail M8'); await new Promise((r) => setTimeout(r, 300)); missing = w.g_form.getMissingFields(); }
  if (missing.length) throw new Error('obrigatórios: ' + missing.join(','));
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, 400));
  f.remove();
}

/** Casos para a regressão (resposta declarada antes de rodar). */
function trailM8Cases(setup) {
  const T = { PFORM: 'user_action', PAPI: 'user_action', BBF: 'br_before', BBA: 'br_before', BAF: 'br_after', BAS: 'br_async', SA: 'script_action', UI: 'ui_action', CS: 'client_script', JOB: 'scheduled_job', ORD: 'br_before', SI: 'br_via_script_include' };
  const out = [];
  for (const [table, TT] of Object.entries(M8.TABLES)) for (const [type, field] of Object.entries(TT.types)) for (const mech of M8.MECHS) {
    const name = { BBF: `before ${type}`, BBA: `before ${type}`, BAF: `after ${type}`, BAS: `async ${type}`, SA: 'script action', UI: `botão ${type}`, CS: `client ${type}`, JOB: `job ${type}`, ORD: `ordem 300 ${type}`, SI: `chama SI ${type}` }[mech];
    out.push({ id: `M8-${TT.key}-${mech}-${type}`, table, sysId: setup.recs[table][`${mech}-${type}`], field, expectedType: T[mech], ...(name ? { expectedName: `[PT] M8 ${TT.key} ${name}` } : {}), minGrade: mech === 'JOB' || mech === 'SI' ? 'probable' : 'confirmed' });
  }
  return out;
}
