/**
 * Fase 6 — teste cego. Tudo leva o prefixo [PT] F6 e é idempotente (upsert por nome).
 * Rodar na aba logada (admin) da PDI: colar este arquivo, depois
 *   const inc = await trailSetupF6();      // cria artefatos + incidentes
 *   await trailRunF6(inc);                 // executa as ações (form, REST, UI action, job)
 * As respostas ficam APENAS em tests/regression/blind/answers.json.
 */
const F6_CALLER = '6816f79cc0a8016401c5a33be04be441';

function f6api() {
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
    if (!String(values.name).startsWith('[PT] F6')) throw new Error('nome sem prefixo [PT] F6');
    const cur = await find(table, `name=${values.name}`);
    return cur && cur.name === values.name ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

async function trailSetupF6() {
  const { api, find, upsert } = f6api();
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const sd = (k) => `short_description=[PT] F6-${k}`;
  const br = (name, when, order, k, script, condition = '', extraFilter = '') => upsert('sys_script', {
    name, collection: 'incident', active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: sd(k) + extraFilter + '^EQ', condition, script: wrap(script),
  });
  const cs = (name, field, k, body) => upsert('sys_script_client', {
    name, table: 'incident', active: 'true', type: 'onChange', field, ui_type: '0',
    script: `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getValue('short_description') != '[PT] F6-${k}') return;\n  ${body}\n}`,
  });

  // 01
  await br('[PT] F6 Ajuste impacto por canal', 'before', 100, '01', "  if (current.contact_type.changes()) current.impact = 2;");
  await br('[PT] F6 Impacto equipamento crítico', 'before', 200, '01', "  if (current.category != 'hardware') return;\n  if (current.contact_type.changes()) current.impact = 1;");
  // 02
  await br('[PT] F6 Auditoria de urgência', 'before', 100, '02', "  var anterior = previous.urgency;\n  if (current.urgency.changes()) gs.info('[PT] F6 urgência alterada de ' + anterior + ' para ' + current.urgency);");
  await br('[PT] F6 Urgência cliente VIP', 'before', 150, '02', "  current.urgency = 1;", 'current.caller_id.vip == true');
  // 03
  await br('[PT] F6 Monta descrição padrão', 'before', 100, '03', "  if (current.contact_type.changes())\n    current.description = '[' + current.contact_type.getDisplayValue() + '] ' + current.short_description + ' - ' + current.caller_id.getDisplayValue();");
  await br('[PT] F6 Limpa descrição', 'before', 300, '03', "  current.description = 'Sem descrição informada';", 'current.description.nil()');
  // 04
  await cs('[PT] F6 Sugere impacto por categoria', 'category', '04', "if (newValue == 'software') g_form.setValue('impact', '2');");
  await br('[PT] F6 Revisão de impacto software', 'before', 100, '04', "  if (current.category.changes() && current.category == 'software') current.impact = 1;");
  // 05
  await cs('[PT] F6 Urgência por canal', 'contact_type', '05', "g_form.setValue('urgency', '2');");
  await br('[PT] F6 Urgência atendimento presencial', 'before', 100, '05', "  current.urgency = 1;", '', '^contact_type=walk-in');
  // 06
  await br('[PT] F6 Normaliza urgência integração', 'before', 100, '06', "  if (current.contact_type.changes() && current.contact_type == 'email') current.urgency = 1;");
  await br('[PT] F6 Impacto padrão integração', 'before', 200, '06', "  if (current.impact.changes()) {\n    var original = previous.impact;\n    gs.info('[PT] F6 impacto alterado de ' + original + ' para ' + current.impact);\n  }");
  // 07
  await br('[PT] F6 Sincroniza canal', 'after', 100, '07', "  if (current.contact_type.changes() && current.urgency != 2) {\n    current.urgency = 2;\n    current.update();\n  }");
  await br('[PT] F6 Severidade por urgência', 'before', 100, '07', "  if (current.urgency.changes() && current.urgency == 2) current.severity = 2;");
  // 08
  if (!(await find('sysevent_register', 'event_name=pt.f6.canal_alterado'))) await api('POST', 'table/sysevent_register', { event_name: 'pt.f6.canal_alterado', table: 'incident', description: '[PT] F6 canal alterado' });
  await br('[PT] F6 Notifica mudança de canal', 'after', 100, '08', "  if (current.contact_type.changes()) gs.eventQueue('pt.f6.canal_alterado', current, current.contact_type, previous.contact_type);");
  await upsert('sysevent_script_action', { name: '[PT] F6 Reclassifica severidade', event_name: 'pt.f6.canal_alterado', active: 'true',
    script: "var gr = new GlideRecord('incident');\nif (gr.get(current.sys_id) && String(gr.short_description).indexOf('[PT] F6-') == 0) { gr.severity = 1; gr.update(); }" });
  await br('[PT] F6 Severidade por canal', 'before', 100, '08', "  if (current.contact_type.changes() && current.contact_type == 'walk-in') current.severity = 1;");
  // 09
  await upsert('sys_ui_action', { name: '[PT] F6 Escalar atendimento', table: 'incident', action_name: 'pt_f6_escalar', active: 'true', form_button: 'true',
    condition: "current.short_description.toString().indexOf('[PT] F6-') == 0",
    script: "current.urgency = 1;\ncurrent.update();\naction.setRedirectURL(current);" });
  await br('[PT] F6 Notificação de escalonamento', 'before', 100, '09', "  if (current.urgency.changes() && current.urgency == 1) current.notify = 2;");
  // 10
  await br('[PT] F6 Texto padrão de triagem', 'before', 50, '10', "  if (current.contact_type.changes()) current.description = 'Triagem pendente';");
  await br('[PT] F6 Complementa descrição de triagem', 'before', 250, '10', "  if (current.description.changes()) current.description = current.description + ' (revisado por ' + gs.getUserName() + ')';");
  await br('[PT] F6 Texto de encerramento triagem', 'before', 400, '10', "  current.description = 'Triagem concluída';", 'current.impact == 1');
  // 11
  await br('[PT] F6 Urgência reprocessamento', 'before', 100, '11', "  if (current.urgency.changes()) current.urgency = 1;", 'gs.getSession().isInteractive()');

  const out = {};
  for (const k of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
    const desc = `[PT] F6-${k}`;
    const r = (await find('incident', `short_description=${desc}`)) ?? await api('POST', 'table/incident', {
      short_description: desc, caller_id: F6_CALLER, contact_type: 'phone', impact: '3', urgency: '3', severity: '3', notify: '1', category: 'inquiry', description: 'inicial' });
    out[k] = { number: r.number, sys_id: r.sys_id };
  }
  return out;
}

/** Salva pelo formulário UI16 real (iframe). action = 'sysverb_update_and_stay' ou o action_name de uma UI action. */
async function trailFormSave(sysId, values, action = 'sysverb_update_and_stay') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = '/incident.do?sys_id=' + sysId;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getValue('number')); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 800));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 700)); }
  if (action === 'sysverb_update_and_stay') w.g_form.setValue('work_notes', 'Teste Trail F6');
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await done;
  await new Promise((r) => setTimeout(r, 500));
  f.remove();
}

async function trailRunF6(inc) {
  const { api, upsert } = f6api();
  const log = {};
  await trailFormSave(inc['01'].sys_id, { contact_type: 'email' }); log['01'] = 'form';
  await trailFormSave(inc['02'].sys_id, { urgency: '2' }); log['02'] = 'form';
  await trailFormSave(inc['03'].sys_id, { contact_type: 'email' }); log['03'] = 'form';
  await trailFormSave(inc['04'].sys_id, { category: 'software' }); log['04'] = 'form';
  await trailFormSave(inc['05'].sys_id, { contact_type: 'email' }); log['05'] = 'form';
  await api('PATCH', `table/incident/${inc['06'].sys_id}`, { contact_type: 'email', urgency: '2', impact: '2' }); log['06'] = 'rest';
  await trailFormSave(inc['07'].sys_id, { contact_type: 'email' }); log['07'] = 'form';
  await trailFormSave(inc['08'].sys_id, { contact_type: 'email' }); log['08'] = 'form';
  await trailFormSave(inc['09'].sys_id, {}, 'pt_f6_escalar'); log['09'] = 'ui_action';
  await trailFormSave(inc['10'].sys_id, { contact_type: 'email' }); log['10'] = 'form';
  // 11: job de execução única, ~90 s no futuro (UTC)
  const t = new Date(Date.now() + 90e3).toISOString().replace('T', ' ').slice(0, 19);
  await upsert('sysauto_script', { name: '[PT] F6 Reprocessa pendências', active: 'true', run_type: 'once', run_start: t,
    script: "var gr = new GlideRecord('incident');\nif (gr.get('" + inc['11'].sys_id + "') && gr.short_description == '[PT] F6-11') { gr.urgency = 2; gr.update(); }" });
  log['11'] = 'job ' + t;
  return log;
}
