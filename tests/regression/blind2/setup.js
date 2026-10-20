/**
 * Fase 9 — teste às cegas 2. Tudo leva o prefixo [PT] F9 e é idempotente (upsert por nome).
 * Escopo: cada regra filtra por short_description dos registros [PT] F9-NN (ou por sys_id no client script).
 * Rodar na aba logada (admin) da PDI:
 *   window.F9S = await f9Setup();      // artefatos + registros + client scripts
 *   window.F9L = await f9Run(F9S);     // ações (formulário, API, UI actions) + jobs de execução única
 * As respostas ficam APENAS em tests/regression/blind2/answers.json.
 */
const F9 = {
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { NET: '287ebd7da9fe198100f92cc8d1d2154e', DB: '287ee6fea9fe198100ada7950d0b1b73', HW: '8a5055c9c61122780043563ef53438e3', SD: 'd625dccec0a8016700a222a0f7900d06', SW: '8a4dde73c6112278017a6a4baf547aa7' },
  U: { BETH: '46d44a23a9fe19810012d100cca80666', DAVID: '5137153cc611227c000bbd1bd8cd2007', DON: '9ee1b13dc6112271007f9d0efdb69cd0' },
  SD: {
    I1: '[PT] F9-01 Lentidão no ERP financeiro',
    I2: '[PT] F9-02 VPN cai a cada 10 minutos',
    I3: '[PT] F9-03 Notebook não liga após atualização',
    I4: '[PT] F9-04 E-mail corporativo fora do ar',
    I5: '[PT] F9-05 Falha no backup noturno do Oracle',
    I6: '[PT] F9-06 Sistema de ponto indisponível',
    I7: '[PT] F9-07 Telefone IP sem tom de discagem',
    I8: '[PT] F9-08 Acesso negado à pasta compartilhada',
    I9: '[PT] F9-09 Monitor piscando na recepção',
    I10: '[PT] F9-10 Impressora fiscal travando',
    C1: '[PT] F9-11 Atualização de firmware dos switches do core',
    C2: '[PT] F9-12 Migração do banco de dados do CRM',
    C3: '[PT] F9-13 Janela de manutenção do storage',
    C4: '[PT] F9-14 Renovação de certificados SSL',
    C5: '[PT] F9-15 Troca do nobreak do datacenter',
    C6: '[PT] F9-16 Deploy da nova versão do app mobile',
    R1: '[PT] F9-17 Notebook para novo colaborador',
  },
};

function f9api() {
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
    if (!/^(\[PT\] F9|PTF9)/.test(String(values.name || values.short_description))) throw new Error('sem prefixo [PT] F9');
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

async function f9Setup() {
  const { api, find, upsert } = f9api();
  const S = F9.SD, G = F9.G, U = F9.U;
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (table, name, when, order, filter, script, condition = '') => upsert('sys_script', {
    name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: filter + '^EQ', condition, script: wrap(script),
  }, `name=${name}^collection=${table}`);
  const sd = (k) => `short_description=${S[k]}`;
  const INC = (...a) => br('incident', ...a);
  const CHG = (...a) => br('change_request', ...a);

  // eventos
  for (const [ev, table] of [['pt.f9.incidente', 'incident'], ['pt.f9.mudanca', 'change_request']])
    if (!(await find('sysevent_register', `event_name=${ev}`))) await api('POST', 'table/sysevent_register', { event_name: ev, table, description: '[PT] F9 evento' });

  // script include compartilhado (o nome precisa ser o da classe; a descrição leva o prefixo [PT] F9)
  await upsert('sys_script_include', { name: 'PTF9Politicas', description: '[PT] F9 políticas de atendimento', api_name: 'global.PTF9Politicas', active: 'true', access: 'public', client_callable: 'false',
    script: `var PTF9Politicas = Class.create();
PTF9Politicas.prototype = {
  initialize: function() {},
  // incidentes de banco de dados: liga a notificação por e-mail
  aplicarBanco: function(sysId) {
    var gr = new GlideRecord('incident');
    if (!gr.get(sysId) || gr.getValue('category') != 'database') return;
    if (gr.getValue('notify') != '2') { gr.setValue('notify', '2'); gr.update(); }
  },
  // não usado hoje: plantonista de banco
  atribuirPlantonista: function(sysId) {
    var gr = new GlideRecord('incident');
    if (gr.get(sysId)) { gr.setValue('assigned_to', '${U.DAVID}'); gr.update(); }
  },
  // mudanças de infraestrutura: monta o plano a partir do grupo
  planoImplementacao: function(sysId) {
    var gr = new GlideRecord('change_request');
    if (!gr.get(sysId) || gr.assignment_group.nil()) return;
    gr.implementation_plan = '1. Comunicar ' + gr.assignment_group.getDisplayValue() + '\\n2. Transferir carga para o gerador\\n3. Substituir equipamento\\n4. Validar energia';
    gr.update();
  },
  type: 'PTF9Politicas'
};` }, 'api_name=global.PTF9Politicas');

  // ---------- incident ----------
  // decoys gerais
  await INC('[PT] F9 Urgência para cliente VIP', 'before', 100, 'short_descriptionSTARTSWITH[PT] F9-0', "  current.urgency = 1;", 'current.caller_id.vip == true');
  await INC('[PT] F9 Prioridade manual de segurança', 'before', 900, 'short_descriptionSTARTSWITH[PT] F9-0', "  if (current.category == 'security' && current.impact == 1) current.priority = 1;");
  await INC('[PT] F9 Auditoria de alterações', 'before', 50, 'short_descriptionSTARTSWITH[PT] F9-', "  var campos = ['impact', 'urgency', 'category', 'assignment_group', 'description', 'knowledge'];\n  for (var i = 0; i < campos.length; i++)\n    if (current[campos[i]].changes()) gs.info('[PT] F9 ' + current.number + ' ' + campos[i] + ': ' + previous.getValue(campos[i]) + ' -> ' + current.getValue(campos[i]));");
  // 01
  await INC('[PT] F9 Impacto por canal digital', 'before', 100, sd('I1'), "  if (current.contact_type.changes() && current.contact_type == 'email') current.impact = 2;");
  await INC('[PT] F9 Classificação automática de software', 'before', 150, sd('I1'), "  current.category = 'software';", "current.contact_type == 'walk-in'");
  await INC('[PT] F9 Impacto reavaliado por hardware', 'before', 400, sd('I1'), "  if (current.category != 'hardware') return;\n  current.impact = 1;");
  // 02
  await INC('[PT] F9 Roteia rede por urgência', 'after', 100, sd('I2'), `  if (current.urgency.changes() && current.urgency == 2 && current.assignment_group.nil()) {\n    current.assignment_group = '${G.NET}';\n    current.update();\n  }`);
  // 03
  await upsert('sys_ui_action', { name: '[PT] F9 Escalar para N2', table: 'incident', action_name: 'pt_f9_escalar_n2', active: 'true', form_button: 'true', client: 'false',
    condition: `current.short_description == '${S.I3}'`, script: "current.urgency = 1;\ncurrent.update();\naction.setRedirectURL(current);" }, 'action_name=pt_f9_escalar_n2^table=incident');
  await INC('[PT] F9 Severidade por urgência crítica', 'before', 100, sd('I3'), "  if (current.urgency.changes() && current.urgency == 1) current.severity = 1;");
  await INC('[PT] F9 Severidade por impacto', 'async', 100, sd('I3'), "  current.severity = 2;\n  current.update();", 'current.impact == 1');
  // 04
  await INC('[PT] F9 Monta resumo de impacto', 'before', 100, sd('I4'), "  if (current.impact.changes())\n    current.description = 'Impacto ' + current.impact.getDisplayValue() + ' / urgência ' + current.urgency.getDisplayValue() + ' - aberto por ' + current.caller_id.getDisplayValue();");
  await INC('[PT] F9 Limpa resumo vazio', 'before', 300, sd('I4'), "  current.description = 'Sem descrição informada';", 'current.description.nil()');
  // 05
  await INC('[PT] F9 Notifica DBA', 'after', 100, sd('I5'), "  if (current.category.changes() && current.category == 'database') gs.eventQueue('pt.f9.incidente', current, 'dba', current.category);");
  await INC('[PT] F9 Aplica política de banco', 'after', 200, sd('I5'), "  if (current.category.changes()) new PTF9Politicas().aplicarBanco(current.getUniqueValue());");
  await upsert('sysevent_script_action', { name: '[PT] F9 Atribui DBA de plantão', event_name: 'pt.f9.incidente', active: 'true',
    script: `if (event.parm1 == 'dba' && String(current.short_description).indexOf('[PT] F9-') == 0 && current.assigned_to.nil()) {\n  current.assigned_to = '${U.BETH}';\n  current.update();\n}` });
  // 06
  await INC('[PT] F9 Marca para base de conhecimento', 'async', 100, sd('I6') + '^impactVALCHANGES', "  if (current.knowledge != true) {\n    current.knowledge = true;\n    current.update();\n  }");
  // 07
  await INC('[PT] F9 Urgência padrão telefonia', 'before', 100, sd('I7'), "  if (current.category.changes()) current.urgency = 2;");
  await INC('[PT] F9 Urgência telefonia diretoria', 'before', 500, sd('I7'), "  if (current.category.changes() && current.category == 'network') current.urgency = 1;", "current.contact_type == 'phone'");
  await INC('[PT] F9 Urgência por impacto alto', 'before', 700, sd('I7'), "  if (current.impact != 1) return;\n  current.urgency = 3;");
  await INC('[PT] F9 Registra histórico de rede', 'after', 100, sd('I7'), "  if (current.category.changes() && current.category == 'network' && String(current.description).indexOf('Encaminhado') != 0) {\n    current.description = 'Encaminhado para rede em ' + new GlideDateTime().getDate() + ' (urgência ' + current.urgency.getDisplayValue() + ')';\n    current.update();\n  }");
  // 08
  await INC('[PT] F9 Canal autoatendimento', 'before', 100, sd('I8'), "  if (current.contact_type.changes() && current.contact_type == 'self-service') current.category = 'software';");
  await INC('[PT] F9 Impacto para software', 'before', 200, sd('I8'), "  if (current.category.changes() && current.category == 'software') current.impact = 2;");
  // 09
  await INC('[PT] F9 Hardware gera artigo', 'before', 100, sd('I9'), "  current.knowledge = true;", 'current.assignment_group.changes()');
  await INC('[PT] F9 Limpa técnico ao trocar grupo', 'before', 200, sd('I9'), "  if (!current.assignment_group.changes()) return;\n  if (current.assignment_group.getDisplayValue() == 'Software') current.assigned_to = '';");
  // 10
  await upsert('sysrule_assignment', { name: '[PT] F9 Impressoras fiscais', table: 'incident', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.I10}^category=hardware^assignment_groupISEMPTY^EQ`, group: G.HW });
  await INC('[PT] F9 Grupo padrão de hardware', 'before', 100, sd('I10'), `  if (current.priority != 1) return;\n  current.assignment_group = '${G.DB}';`);

  // ---------- change_request ----------
  await CHG('[PT] F9 Risco de emergência', 'before', 300, 'short_descriptionSTARTSWITH[PT] F9-1', "  if (current.type != 'emergency') return;\n  current.risk = 2;");
  // 11
  await CHG('[PT] F9 CAB obrigatório para rede', 'before', 100, sd('C1'), "  current.cab_required = true;", "current.category.changes() && current.category == 'Network'");
  // 12
  await CHG('[PT] F9 Plano de retorno padrão', 'after', 100, sd('C2'), "  if (current.description.changes()) {\n    current.backout_plan = 'Restaurar o snapshot do banco tirado antes da janela e reapontar o CRM.';\n    current.update();\n  }");
  await CHG('[PT] F9 Plano de testes padrão', 'async', 100, sd('C2') + '^descriptionVALCHANGES', "  current.test_plan = 'Validar login, relatórios e integrações do CRM após a migração.';\n  current.update();");
  await CHG('[PT] F9 Confere plano de retorno', 'before', 100, sd('C2'), "  if (current.backout_plan.changes()) gs.info('[PT] F9 plano de retorno alterado: ' + current.backout_plan);");
  // 13
  await upsert('sys_ui_action', { name: '[PT] F9 Solicitar aprovação do CAB', table: 'change_request', action_name: 'pt_f9_pedir_cab', active: 'true', form_button: 'true', client: 'false',
    condition: `current.short_description == '${S.C3}'`, script: "current.cab_required = true;\ncurrent.update();\naction.setRedirectURL(current);" }, 'action_name=pt_f9_pedir_cab^table=change_request');
  await upsert('sys_ui_action', { name: '[PT] F9 Dispensar CAB', table: 'change_request', action_name: 'pt_f9_dispensar_cab', active: 'true', form_button: 'true', client: 'false',
    condition: `current.short_description.toString().indexOf('[PT] F9-1') == 0 && current.cab_required == true`, script: "current.cab_required = false;\ncurrent.justification = 'CAB dispensado';\ncurrent.update();\naction.setRedirectURL(current);" }, 'action_name=pt_f9_dispensar_cab^table=change_request');
  await CHG('[PT] F9 Sinaliza CAB', 'after', 100, sd('C3') + '^cab_requiredVALCHANGES', "  gs.eventQueue('pt.f9.mudanca', current, 'cab', current.cab_required);");
  await upsert('sysevent_script_action', { name: '[PT] F9 Justificativa para o CAB', event_name: 'pt.f9.mudanca', active: 'true',
    script: "if (event.parm1 == 'cab' && String(current.short_description).indexOf('[PT] F9-') == 0) {\n  current.justification = 'Mudança com impacto em storage compartilhado: requer revisão do CAB.';\n  current.update();\n}" });
  // 14
  await upsert('sys_ui_action', { name: '[PT] F9 Reclassificar impacto', table: 'change_request', action_name: 'pt_f9_reclassificar', active: 'true', form_button: 'true', client: 'false',
    condition: `current.short_description == '${S.C4}'`, script: "current.impact = 1;\ncurrent.update();\naction.setRedirectURL(current);" }, 'action_name=pt_f9_reclassificar^table=change_request');
  // 15
  await CHG('[PT] F9 Gera plano de implementação', 'after', 100, sd('C5') + '^assignment_groupVALCHANGES', "  new PTF9Politicas().planoImplementacao(current.getUniqueValue());");
  await CHG('[PT] F9 Grupo para alto risco', 'before', 100, sd('C5'), `  current.assignment_group = '${G.DB}';`, "current.risk == '2'");
  // 16
  await CHG('[PT] F9 Testes por risco', 'before', 200, sd('C6'), "  if (current.risk.changes() && String(current.test_plan).indexOf('Testes obrigatórios') != 0)\n    current.test_plan = 'Testes obrigatórios: ' + (current.risk == 2 ? 'regressão completa + carga' : 'smoke test');");
  await CHG('[PT] F9 Revisão final de testes', 'after', 100, sd('C6'), "  if (current.risk.changes() && String(current.test_plan).indexOf('(revisado') < 0) {\n    current.test_plan = current.test_plan + ' (revisado pela qualidade)';\n    current.update();\n  }");

  // ---------- sc_req_item ----------
  await br('sc_req_item', '[PT] F9 Fila de provisionamento', 'async', 100, sd('R1') + '^descriptionVALCHANGES', `  if (current.assignment_group.nil()) {\n    current.assignment_group = '${G.HW}';\n    current.update();\n  }`);
  await br('sc_req_item', '[PT] F9 Grupo por quantidade', 'before', 100, sd('R1'), `  if (current.quantity > 5) current.assignment_group = '${G.SD}';`);

  // ---------- registros ----------
  const incBase = { caller_id: F9.ADMIN, contact_type: 'phone', impact: '3', urgency: '3', severity: '3', notify: '1', category: 'inquiry', description: 'inicial', knowledge: 'false' };
  const chgBase = { type: 'normal', impact: '3', risk: '3', category: 'Other', description: 'inicial', justification: 'inicial', backout_plan: 'inicial', test_plan: 'inicial', implementation_plan: 'inicial', cab_required: 'false' };
  const recs = {};
  for (const k of Object.keys(S)) {
    const table = k[0] === 'I' ? 'incident' : k[0] === 'C' ? 'change_request' : 'sc_req_item';
    const base = table === 'incident' ? incBase : table === 'change_request' ? chgBase : { description: 'inicial', quantity: '1' };
    const r = (await find(table, `short_description=${S[k]}`)) ?? await api('POST', `table/${table}`, { short_description: S[k], ...base });
    recs[k] = { table, sys_id: r.sys_id, number: r.number };
  }

  // ---------- client scripts (escopo por sys_id) ----------
  const cs = (table, name, field, script) => upsert('sys_script_client', { name, table, active: 'true', type: 'onChange', field, ui_type: '0', script }, `name=${name}^table=${table}`);
  await cs('incident', '[PT] F9 Sugere urgência pelo impacto', 'impact', `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getUniqueValue() != '${recs.I4.sys_id}') return;\n  if (newValue == '2') g_form.setValue('urgency', '2');\n}`);
  await cs('incident', '[PT] F9 Alerta de impacto alto', 'impact', `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading) return;\n  if (g_form.getValue('short_description').indexOf('[PT] F9-') != 0) return;\n  if (newValue == '1') g_form.showFieldMsg('impact', 'Impacto alto: avise o coordenador', 'info');\n}`);
  await cs('incident', '[PT] F9 Impacto sugerido por categoria', 'category', `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getValue('short_description').indexOf('[PT] F9-') != 0) return;\n  if (newValue == 'hardware') g_form.setValue('impact', '1');\n}`);
  await cs('incident', '[PT] F9 Sugere técnico de hardware', 'assignment_group', `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getUniqueValue() != '${recs.I9.sys_id}') return;\n  if (newValue == '${G.HW}') setTimeout(function() { g_form.setValue('assigned_to', '${U.DON}'); }, 300);\n}`);
  await cs('change_request', '[PT] F9 Risco sugerido por categoria', 'category', `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getUniqueValue() != '${recs.C1.sys_id}') return;\n  if (newValue == 'Network') g_form.setValue('risk', '2');\n}`);
  return recs;
}

/** Salva pelo formulário UI16 real (iframe). action = 'sysverb_update_and_stay' ou o action_name de uma UI action. */
async function f9Form(table, sysId, values, action = 'sysverb_update_and_stay') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/${table}.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1000));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 1200)); }
  let missing = (w.g_form.getMissingFields && w.g_form.getMissingFields()) || [];
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'Atualização [PT] F9'); await new Promise((r) => setTimeout(r, 300)); missing = w.g_form.getMissingFields(); }
  if (missing.length) { f.remove(); throw new Error('obrigatórios: ' + missing.join(',')); }
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, 600));
  f.remove();
}

async function f9Run(R) {
  const { api, upsert } = f9api();
  const log = [];
  const step = async (k, fn) => { try { await fn(); log.push(k + ' ok'); } catch (e) { log.push(k + ' ERRO ' + e.message); } await new Promise((r) => setTimeout(r, 1500)); };
  const patch = (k, v) => api('PATCH', `table/${R[k].table}/${R[k].sys_id}`, v);
  await step('I1 form', () => f9Form('incident', R.I1.sys_id, { contact_type: 'email', category: 'software' }));
  await step('I2 api', () => patch('I2', { urgency: '2' }));
  await step('I3 ui', () => f9Form('incident', R.I3.sys_id, {}, 'pt_f9_escalar_n2'));
  await step('I4 form', () => f9Form('incident', R.I4.sys_id, { impact: '2' }));
  await step('I5 api', () => patch('I5', { category: 'database' }));
  await step('I6 api', () => patch('I6', { impact: '2' }));
  await step('I7 form', () => f9Form('incident', R.I7.sys_id, { category: 'network' }));
  await step('I8 api', () => patch('I8', { contact_type: 'self-service' }));
  await step('I9 form', () => f9Form('incident', R.I9.sys_id, { assignment_group: F9.G.HW }));
  await step('I10 api', () => patch('I10', { category: 'hardware' }));
  await step('C1 form', () => f9Form('change_request', R.C1.sys_id, { category: 'Network' }));
  await step('C2 api', () => patch('C2', { description: 'Migração do Oracle 12c para PostgreSQL 15; janela de 4h no sábado.' }));
  await step('C3 ui', () => f9Form('change_request', R.C3.sys_id, {}, 'pt_f9_pedir_cab'));
  await step('C4 form', () => f9Form('change_request', R.C4.sys_id, { impact: '2' }));
  await new Promise((r) => setTimeout(r, 3000));
  await step('C4 ui', () => f9Form('change_request', R.C4.sys_id, {}, 'pt_f9_reclassificar'));
  await step('C6 api', () => patch('C6', { risk: '2' }));
  await step('R1 api', () => patch('R1', { description: 'Notebook i7 16GB para o colaborador que começa na segunda.' }));
  // jobs de execução única (UTC)
  const at = (s) => new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const t1 = at(120), t2 = at(150);
  await upsert('sysauto_script', { name: '[PT] F9 Reavaliação noturna de impacto', active: 'true', run_type: 'once', run_start: t1,
    script: `var gr = new GlideRecord('incident');\nif (gr.get('${R.I6.sys_id}') && gr.getValue('impact') == '2') { gr.setValue('impact', '1'); gr.update(); }` });
  await upsert('sysauto_script', { name: '[PT] F9 Distribui mudanças de infraestrutura', active: 'true', run_type: 'once', run_start: t2,
    script: `var gr = new GlideRecord('change_request');\ngr.addQuery('short_description', '${F9.SD.C5}');\ngr.addNullQuery('assignment_group');\ngr.query();\nwhile (gr.next()) { gr.setValue('assignment_group', '${F9.G.NET}'); gr.update(); }` });
  log.push('jobs ' + t1 + ' / ' + t2);
  return log;
}

/**
 * Complemento (rodado depois de f9Run): no F9-07 a BR after com current.update() duplicou na auditoria a urgência
 * e a categoria, então a disputa por ordem foi refeita num registro próprio, salvo pela API.
 *   const R = { ...F9S, ...(await f9Extra()) };
 */
async function f9Extra() {
  const { api, find, upsert } = f9api();
  const SD11 = '[PT] F9-18 Ramal da diretoria mudo';
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (name, order, script, condition = '') => upsert('sys_script', {
    name, collection: 'incident', active: 'true', when: 'before', order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: `short_description=${SD11}^EQ`, condition, script: wrap(script),
  }, `name=${name}^collection=incident`);
  await br('[PT] F9 Urgência padrão de ramal', 100, "  if (current.category.changes() && current.category == 'network') current.urgency = 2;");
  await br('[PT] F9 Urgência ramal executivo', 450, "  if (current.category.changes()) current.urgency = 1;", "current.contact_type == 'phone' && current.caller_id == gs.getUserID()");
  await br('[PT] F9 Urgência rebaixada fora do horário', 800, "  var h = new GlideDateTime().getLocalTime().getHourOfDayLocalTime();\n  if (current.impact != 1 || h < 22) return;\n  current.urgency = 3;");
  const r = (await find('incident', `short_description=${SD11}`)) ?? await api('POST', 'table/incident', { short_description: SD11, caller_id: F9.ADMIN, contact_type: 'phone', impact: '3', urgency: '3', severity: '3', notify: '1', category: 'inquiry', description: 'inicial', knowledge: 'false' });
  await new Promise((res) => setTimeout(res, 1500));
  await api('PATCH', `table/incident/${r.sys_id}`, { category: 'network' });
  return { I11: { table: 'incident', sys_id: r.sys_id, number: r.number } };
}
