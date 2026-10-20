/**
 * Teste às cegas 5 — cenários mistos (mecanismos novos e antigos, com iscas). Tudo leva o prefixo [PT] F15
 * (script include PTF15*) e é idempotente (upsert por nome).
 * Escopo: cada regra filtra pelo short_description dos registros [PT] F15-NN (ou checa no script).
 * Tabelas: incident (maioria), problem, change_request.
 *
 * Rodar na aba logada (admin) da PDI, colando este arquivo no console:
 *   window.F15S = await f15Setup();            // artefatos + registros  -> { recs, map }
 *   window.F15C = await f15Check(F15S);        // (opcional) confere campos e botões nos formulários clássicos
 *   window.F15L = []; await f15Run(F15S, F15L); // 3 rodadas (≥25 s entre gravações do mesmo registro); acompanhar F15L
 *   window.F15A = await f15Audit(F15S);        // sys_audit de todos os registros
 * As respostas ficam APENAS em tests/regression/blind5/plan.json.
 */
(function () {
const F15 = {
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { NET: '287ebd7da9fe198100f92cc8d1d2154e', DB: '287ee6fea9fe198100ada7950d0b1b73', HW: '8a5055c9c61122780043563ef53438e3', SD: 'd625dccec0a8016700a222a0f7900d06', SW: '8a4dde73c6112278017a6a4baf547aa7' },
  U: { BETH: '46d44a23a9fe19810012d100cca80666', DAVID: '5137153cc611227c000bbd1bd8cd2007', DON: '9ee1b13dc6112271007f9d0efdb69cd0' },
  STAGE: 'u_pt_f15_import',
  MAP: '[PT] F15 Pedidos da transportadora',
  SD: {
    I1: '[PT] F15-01 Leitor de código de barras do caixa 4 falhando',
    I2: '[PT] F15-02 Lentidão no sistema de pedidos',
    I3: '[PT] F15-03 VPN dos representantes caindo',
    I4: '[PT] F15-04 Câmera do estoque sem imagem',
    I5: '[PT] F15-05 Telefone IP da recepção mudo',
    I6: '[PT] F15-06 Integração com a transportadora',
    I7: '[PT] F15-07 Pedido do parceiro com ajuste manual',
    I8: '[PT] F15-08 Lote de alertas do monitoramento',
    I9: '[PT] F15-09 Notebook da diretoria sem bateria',
    I10: '[PT] F15-10 Fechamento do chamado do fornecedor',
    P1: '[PT] F15-21 Quedas recorrentes do link MPLS',
    P2: '[PT] F15-22 Falha no backup do ERP',
    C1: '[PT] F15-31 Migração do banco de faturamento',
    C2: '[PT] F15-32 Atualização do antivírus corporativo',
    C3: '[PT] F15-33 Troca do balanceador de carga',
  },
};
const F15T = { P: 'problem', I: 'incident', C: 'change_request' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function f15api() {
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
    const label = String(values.name || values.short_description || '');
    if (!/^(\[PT\] F15|PTF15)/.test(label)) throw new Error('sem prefixo [PT] F15: ' + label);
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

async function f15Setup() {
  const { api, find, upsert } = f15api();
  const S = F15.SD, G = F15.G, U = F15.U;
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (table, name, when, order, filter, script, condition = '') => {
    if (name.length > 40) throw new Error('nome de BR com mais de 40 caracteres: ' + name);
    return upsert('sys_script', {
      name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
      advanced: 'true', filter_condition: filter + '^EQ', condition, script: wrap(script),
    }, `name=${name}^collection=${table}`);
  };
  const sd = (k) => `short_description=${S[k]}`;
  const INC = (...a) => br('incident', ...a), PRB = (...a) => br('problem', ...a), CHG = (...a) => br('change_request', ...a);
  const ua = (table, name, action_name, condition, script) => upsert('sys_ui_action', { name, table, action_name, active: 'true', form_button: 'true', client: 'false', condition, script: script + '\ncurrent.update();\naction.setRedirectURL(current);' }, `action_name=${action_name}^table=${table}`);
  const rule = (table, name, condition, group) => upsert('sysrule_assignment', { name, table, active: 'true', order: '100', match_conditions: 'ALL', condition: condition + '^EQ', group }, `name=${name}^table=${table}`);

  // ---------- script include ----------
  await upsert('sys_script_include', { name: 'PTF15Rotinas', description: '[PT] F15 rotinas de atendimento e problemas', api_name: 'global.PTF15Rotinas', active: 'true', access: 'public', client_callable: 'false',
    script: `var PTF15Rotinas = Class.create();
PTF15Rotinas.prototype = {
  initialize: function() {},
  _escopo: function(gr) { return String(gr.short_description).indexOf('[PT] F15') == 0; },
  // incidentes de campo: técnico padrão quando ninguém foi designado
  designarTecnico: function(sysId) {
    var gr = new GlideRecord('incident');
    if (!gr.get(sysId) || !this._escopo(gr) || !gr.assigned_to.nil()) return;
    gr.assigned_to = '${U.BETH}';
    gr.update();
  },
  // não usado hoje: devolve o chamado para a fila
  liberarTecnico: function(sysId) {
    var gr = new GlideRecord('incident');
    if (gr.get(sysId) && this._escopo(gr)) { gr.assigned_to = ''; gr.update(); }
  },
  // problemas de backup: registra o diagnóstico inicial
  diagnosticarBackup: function(sysId) {
    var gr = new GlideRecord('problem');
    if (!gr.get(sysId) || !this._escopo(gr)) return;
    gr.cause_notes = 'Diagnóstico: o job de backup excede a janela por falta de espaço no repositório.';
    gr.update();
  },
  // não usado hoje: justificativa padrão de mudança
  sugerirJustificativa: function(sysId) {
    var gr = new GlideRecord('change_request');
    if (gr.get(sysId) && this._escopo(gr)) { gr.justification = 'Mudança recomendada pelo fornecedor.'; gr.update(); }
  },
  type: 'PTF15Rotinas'
};` }, 'api_name=global.PTF15Rotinas');

  // ---------- incident ----------
  // I1 (assignment_group)
  await rule('incident', '[PT] F15 Periféricos de loja', `${sd('I1')}^category=hardware^assignment_groupISEMPTY`, G.HW);
  await rule('incident', '[PT] F15 Periféricos de rede', `${sd('I1')}^category=network^assignment_groupISEMPTY`, G.NET);
  await INC('[PT] F15 Grupo de periféricos críticos', 'before', 100, sd('I1'), `  if (current.priority != 1) return;\n  current.assignment_group = '${G.HW}';`);
  await ua('incident', '[PT] F15 Encaminhar ao service desk', 'pt_f15_encaminhar_sd', `current.short_description == '${S.I1}'`, `current.assignment_group = '${G.SD}';`);
  // I2 (close_notes)
  await INC('[PT] F15 Nota de urgência média', 'before', 100, sd('I2'), "  if (current.urgency.changes() && current.urgency == 2)\n    current.close_notes = 'Urgência média: acompanhar a fila de pedidos a cada 2 horas.';");
  await INC('[PT] F15 Nota de urgência crítica', 'before', 200, sd('I2'), "  current.close_notes = 'Urgência crítica: acionar o gestor de plantão.';", 'current.urgency == 1');
  await INC('[PT] F15 Nota de impacto assíncrona', 'async', 100, sd('I2') + '^impactVALCHANGES', "  current.close_notes = 'Impacto reavaliado: lentidão atinge as filiais do sul.';\n  current.update();");
  await INC('[PT] F15 Registra nota do chamado', 'after', 100, sd('I2'), "  if (current.close_notes.changes()) gs.info('[PT] F15 nota ' + current.number + ': ' + current.close_notes);");
  // I4 (isca: BR que cita description com condição falsa)
  await INC('[PT] F15 Descrição de balcão', 'before', 100, sd('I4'), "  current.description = 'Equipamento trazido ao balcão.';", "current.category == 'hardware' && current.contact_type == 'walk-in'");
  // I6 (importação + reações)
  await INC('[PT] F15 Categoria da transportadora', 'before', 100, sd('I6'), "  if (current.category == 'hardware') current.category = 'network';");
  await INC('[PT] F15 Urgência da transportadora', 'after', 100, sd('I6'), "  if (current.description.changes() && current.urgency != 2) {\n    current.urgency = 2;\n    current.update();\n  }");
  await INC('[PT] F15 Correlação de coleta urgente', 'before', 200, sd('I6'), "  if (current.urgency == 1) current.correlation_id = 'COLETA-URGENTE';");
  // I8 (lote)
  await INC('[PT] F15 Nota de origem do lote', 'before', 100, sd('I8'), "  if (current.description.changes()) current.close_notes = 'Recebido pelo lote do monitoramento.';");
  // I9 (assigned_to)
  await INC('[PT] F15 Designa técnico de campo', 'after', 100, sd('I9') + '^assignment_groupVALCHANGES', '  new PTF15Rotinas().designarTecnico(current.getUniqueValue());');
  await INC('[PT] F15 Técnico de banco', 'before', 100, sd('I9'), `  current.assigned_to = '${U.DAVID}';`, "current.category == 'database'");
  await ua('incident', '[PT] F15 Assumir atendimento', 'pt_f15_assumir', `current.short_description == '${S.I9}'`, 'current.assigned_to = gs.getUserID();');
  await ua('incident', '[PT] F15 Devolver para a fila', 'pt_f15_devolver_fila', "current.short_description.toString().indexOf('[PT] F15-0') == 0 && !current.assigned_to.nil()", "current.assigned_to = '';");

  // ---------- problem ----------
  // P1 (workaround)
  await PRB('[PT] F15 Contorno para rede', 'before', 100, sd('P1'), "  if (current.category.changes() && current.category == 'network')\n    current.workaround = 'Rotear o tráfego pelo link de contingência 4G até a operadora estabilizar o MPLS.';");
  await PRB('[PT] F15 Contorno para banco', 'before', 200, sd('P1'), "  current.workaround = 'Reiniciar o listener do banco.';", "current.category == 'database'");
  await ua('problem', '[PT] F15 Aplicar contorno padrão', 'pt_f15_contorno_padrao', `current.short_description == '${S.P1}'`, "current.workaround = 'Contorno padrão: reduzir o MTU para 1400 nos roteadores das filiais.';");
  // P2 (cause_notes)
  await PRB('[PT] F15 Diagnóstico do backup', 'after', 100, sd('P2') + '^impactVALCHANGES', '  new PTF15Rotinas().diagnosticarBackup(current.getUniqueValue());');

  // ---------- change_request ----------
  // C1 (implementation_plan)
  await CHG('[PT] F15 Plano para risco alto', 'after', 100, sd('C1'), "  if (current.risk.changes() && current.risk == 2) {\n    current.implementation_plan = 'Risco alto: executar em duas janelas com ensaio prévio em homologação.';\n    current.update();\n  }");
  await CHG('[PT] F15 Log de risco da mudança', 'after', 200, sd('C1'), "  if (current.risk.changes()) gs.info('[PT] F15 risco ' + current.number + ': ' + current.implementation_plan);");
  await ua('change_request', '[PT] F15 Congelar plano', 'pt_f15_congelar_plano', `current.short_description == '${S.C1}'`, "current.implementation_plan = 'Plano congelado: aguardar parecer do comitê de mudanças.';");
  await ua('change_request', '[PT] F15 Descongelar plano', 'pt_f15_descongelar_plano', `current.short_description == '${S.C1}' && current.implementation_plan.toString().indexOf('Plano congelado') == 0 && current.cab_required == true`, "current.implementation_plan = 'Plano liberado para execução.';");
  // C3 (justification)
  await CHG('[PT] F15 Justificativa de emergência', 'before', 100, sd('C3'), "  current.justification = 'Mudança emergencial aprovada pelo gestor.';", "current.type == 'emergency'");

  // ---------- client scripts (formulário clássico; checam o short_description) ----------
  const cs = (table, name, field, script) => upsert('sys_script_client', { name, table, active: 'true', type: 'onChange', field, ui_type: '0', script }, `name=${name}^table=${table}`);
  const on = (body) => `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n${body}\n}`;
  await cs('incident', '[PT] F15 Descrição para autoatendimento', 'contact_type', on(`  if (g_form.getValue('short_description') != '${S.I3}') return;\n  if (newValue == 'self-service') g_form.setValue('description', 'Aberto pelo portal de autoatendimento: usuário informa queda da VPN a cada 10 minutos.');`));
  await cs('incident', '[PT] F15 Descrição para presencial', 'contact_type', on(`  if (g_form.getValue('short_description').indexOf('[PT] F15-0') != 0) return;\n  if (newValue == 'walk-in') g_form.setValue('description', 'Atendimento no balcão: anotar o patrimônio do notebook.');`));
  await cs('incident', '[PT] F15 Lembra canal de contato', 'contact_type', on(`  if (g_form.getValue('short_description').indexOf('[PT] F15') != 0) return;\n  g_form.showFieldMsg('contact_type', 'Canal alterado: confirme o contato do solicitante', 'info');`));
  await cs('change_request', '[PT] F15 Retorno para impacto alto', 'impact', on(`  if (g_form.getValue('short_description') != '${S.C2}') return;\n  if (newValue == '1') g_form.setValue('backout_plan', 'Impacto alto: restaurar a versão anterior do agente pelo console central.');`));
  await cs('change_request', '[PT] F15 Avisa impacto da mudança', 'impact', on(`  if (g_form.getValue('short_description').indexOf('[PT] F15') != 0) return;\n  g_form.addInfoMessage('Impacto alterado: revise o plano de retorno');`));

  // ---------- UI policies ----------
  // Os scripts do ramo "senão" rodam em TODO formulário de incidente onde a condição é falsa: checam o prefixo [PT] F15.
  const pol = async (name, table, conditions, extra) => upsert('sys_ui_policy', { short_description: name, table, active: 'true', on_load: 'true', reverse_if_false: 'false', global: 'true', ui_type: '0', order: '100', run_scripts: 'false', ...extra,
    conditions: conditions + '^EQ' }, `short_description=${name}^table=${table}`);
  const polAction = async (p, table, field) => { if (!(await find('sys_ui_policy_action', `ui_policy=${p.sys_id}^field=${field}`))) await api('POST', 'table/sys_ui_policy_action', { ui_policy: p.sys_id, table, field, mandatory: 'true', visible: 'ignore', disabled: 'ignore' }); };
  await pol('[PT] F15 Hardware pede patrimônio', 'incident', `${sd('I4')}^category=hardware`, { run_scripts: 'true',
    script_true: "function onCondition() {\n  if (g_form.getValue('short_description').indexOf('[PT] F15') != 0) return;\n  g_form.setValue('description', 'Informar o número de patrimônio da câmera e o local de instalação.');\n}", script_false: 'function onCondition() {\n}' });
  await pol('[PT] F15 Fora de rede registra nota', 'incident', `${sd('I5')}^category=network`, { run_scripts: 'true', reverse_if_false: 'true',
    script_true: 'function onCondition() {\n}',
    script_false: `function onCondition() {\n  var sd = g_form.getValue('short_description');\n  if (sd.indexOf('[PT] F15') != 0) return;\n  if (sd != '${S.I5}') return;\n  g_form.setValue('close_notes', 'Fora do escopo de rede: encaminhar para telefonia.');\n}` });
  await pol('[PT] F15 Banco pede nota de fechamento', 'incident', 'short_descriptionSTARTSWITH[PT] F15-0^category=database', { run_scripts: 'true',
    script_true: "function onCondition() {\n  if (g_form.getValue('short_description').indexOf('[PT] F15') != 0) return;\n  g_form.setValue('close_notes', 'Banco de dados: anexar o plano de retorno.');\n}", script_false: 'function onCondition() {\n}' });
  const pMand = await pol('[PT] F15 Software exige descrição', 'incident', 'short_descriptionSTARTSWITH[PT] F15-05^category=software', {});
  await polAction(pMand, 'incident', 'description');
  const pChg = await pol('[PT] F15 Emergência exige retorno', 'change_request', 'short_descriptionSTARTSWITH[PT] F15-3^type=emergency', {});
  await polAction(pChg, 'change_request', 'backout_plan');

  // ---------- data policy (só obrigatoriedade) ----------
  const dpName = '[PT] F15 Nota obrigatória do fornecedor';
  const dp = await upsert('sys_data_policy2', { short_description: dpName, model_table: 'incident', active: 'true', apply_import_set: 'true', apply_soap: 'true', apply_ui: 'false',
    conditions: `${sd('I10')}^EQ` }, `short_description=${dpName}`);
  if (!(await find('sys_data_policy_rule', `sys_data_policy=${dp.sys_id}^field=close_notes`))) await api('POST', 'table/sys_data_policy_rule', { sys_data_policy: dp.sys_id, table: 'incident', field: 'close_notes', mandatory: 'true', disabled: 'ignore' });

  // ---------- importação (tabela de staging + transform map) ----------
  const base = await find('sys_db_object', 'name=sys_import_set_row');
  let stage = await find('sys_db_object', `name=${F15.STAGE}`);
  if (!stage) stage = await api('POST', 'table/sys_db_object', { name: F15.STAGE, label: '[PT] F15 importação da transportadora', super_class: base.sys_id, create_access_controls: 'false' });
  for (const [el, label] of Object.entries({ u_chave: 'Chave', u_descricao: 'Descrição', u_categoria: 'Categoria', u_codigo: 'Código' })) {
    if (!(await find('sys_dictionary', `name=${F15.STAGE}^element=${el}`))) await api('POST', 'table/sys_dictionary', { name: F15.STAGE, element: el, column_label: label, internal_type: 'string', max_length: '200', active: 'true' });
  }
  const map = await upsert('sys_transform_map', { name: F15.MAP, source_table: F15.STAGE, target_table: 'incident', active: 'true', run_business_rules: 'true', enforce_mandatory_fields: 'no', order: '100', run_script: 'false', script: '' });
  const entry = async (src, tgt, extra = {}) => {
    const cur = await find('sys_transform_entry', `map=${map.sys_id}^target_field=${tgt}`);
    const v = { map: map.sys_id, source_table: F15.STAGE, source_field: src, target_table: 'incident', target_field: tgt, ...extra };
    return cur ? api('PATCH', `table/sys_transform_entry/${cur.sys_id}`, v) : api('POST', 'table/sys_transform_entry', v);
  };
  await entry('u_chave', 'short_description', { coalesce: 'true' });
  await entry('u_descricao', 'description');
  await entry('u_categoria', 'category', { choice_action: 'ignore' });
  await entry('', 'correlation_display', { use_source_script: 'true', source_script: "answer = (function transformEntry(source) {\n  return 'TRANSP-' + source.u_codigo;\n})(source);" });
  const ts = await find('sys_transform_script', `map=${map.sys_id}^when=onBefore`);
  const tsv = { map: map.sys_id, when: 'onBefore', active: 'true', order: '100', script: "(function runTransformScript(source, map, log, target /*undefined onStart*/ ) {\n  if (String(source.u_chave).indexOf('[PT] F15') != 0) { ignore = true; return; }\n  target.correlation_id = 'COLETA-' + source.u_codigo;\n  // coletas de banco de dados entram como urgentes\n  if (source.u_categoria == 'database') target.urgency = 1;\n})(source, map, log, target);" };
  ts ? await api('PATCH', `table/sys_transform_script/${ts.sys_id}`, tsv) : await api('POST', 'table/sys_transform_script', tsv);

  // ---------- registros ----------
  const baseRec = {
    incident: { caller_id: F15.ADMIN, contact_type: 'phone', impact: '3', urgency: '3', category: 'inquiry', description: 'inicial' },
    problem: { impact: '3', urgency: '3', category: 'software', description: 'inicial' },
    change_request: { type: 'normal', impact: '3', risk: '3', category: 'Other', description: 'inicial' },
  };
  const extra = { I5: { category: 'network' }, I10: { close_notes: 'Aberto com nota obrigatória do fornecedor.' } };
  const recs = {};
  for (const k of Object.keys(S)) {
    const table = F15T[k[0]];
    const r = (await find(table, `short_description=${S[k]}`)) ?? await api('POST', `table/${table}`, { short_description: S[k], ...baseRec[table], ...(extra[k] || {}) });
    recs[k] = { table, sys_id: r.sys_id, number: r.number };
  }
  return { recs, map: map.sys_id };
}

/** Abre o formulário clássico num iframe oculto e diz quais campos/botões faltam. */
async function f15Check(S) {
  const R = S.recs;
  const need = {
    I1: [['assignment_group'], ['pt_f15_encaminhar_sd']], I3: [['contact_type', 'description'], []], I4: [['category', 'description'], []], I5: [['category', 'close_notes'], []],
    I9: [[], ['pt_f15_assumir']], P1: [[], ['pt_f15_contorno_padrao']], C1: [['implementation_plan'], ['pt_f15_congelar_plano']], C2: [['impact', 'backout_plan'], []],
  };
  const out = {};
  for (const [k, [fields, btns]] of Object.entries(need)) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
    f.src = `/${R[k].table}.do?sys_id=${R[k].sys_id}`;
    document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    const w = f.contentWindow;
    for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await sleep(200);
    const ids = [...w.document.querySelectorAll('button[id]')].map((b) => b.id);
    out[k] = { missingFields: fields.filter((x) => !w.g_form.hasField(x)), missingButtons: btns.filter((b) => !ids.includes(b)) };
    f.remove();
  }
  return out;
}

/** Salva pelo formulário UI16 real (iframe). action = 'sysverb_update_and_stay' ou o action_name de uma UI action. */
async function f15Form(table, sysId, values, action = 'sysverb_update_and_stay') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/${table}.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await sleep(200);
  await sleep(1200);
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await sleep(1500); }
  let missing = (w.g_form.getMissingFields && w.g_form.getMissingFields()) || [];
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'Atualização [PT] F15'); await sleep(300); missing = w.g_form.getMissingFields(); }
  if (missing.length) { f.remove(); throw new Error('obrigatórios: ' + missing.join(',')); }
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, sleep(15000)]);
  await sleep(600);
  f.remove();
}

/** Três rodadas. Cada passo espera ≥25 s desde a última gravação conferida no mesmo registro e confere o resultado (job e async inclusive). */
async function f15Run(S, log = []) {
  const { api, upsert } = f15api();
  const R = S.recs, G = F15.G, U = F15.U, SD = F15.SD;
  const at = (s) => new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const job = (name, script) => upsert('sysauto_script', { name, active: 'true', run_type: 'once', run_start: at(10), script });
  const jobOne = (table, k, field, prefix, value) => `var gr = new GlideRecord('${table}');\nif (gr.get('${R[k].sys_id}') && String(gr.short_description).indexOf('[PT] F15') == 0 && String(gr.${field}).replace(/<[^>]+>/g, '').indexOf('${prefix}') != 0) {\n  gr.setValue('${field}', '${value}');\n  gr.update();\n}`;
  // campos HTML (workaround etc.) podem voltar com <p>: compara sem as tags
  const starts = (f, p) => (r) => String(r[f]).replace(/<[^>]+>/g, '').indexOf(p) == 0;
  const eq = (o) => (r) => Object.entries(o).every(([k, v]) => String(r[k]) == v);
  const all = (...fs) => (r) => fs.every((fn) => fn(r));
  const imp = async (row) => { const r = await api('POST', `import/${F15.STAGE}`, row); return JSON.stringify(r).slice(0, 140); };
  const batch = async (k, body) => {
    const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    const req = { batch_request_id: 'pt-f15-' + Date.now(), rest_requests: [{ id: '1', exclude_response_headers: true, method: 'PATCH', url: `/api/now/table/${R[k].table}/${R[k].sys_id}`,
      headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Accept', value: 'application/json' }], body: enc(body) }] };
    const b = await fetch('/api/now/v1/batch', { method: 'POST', headers: { 'X-UserToken': window.g_ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const t = await b.text();
    if (!b.ok) throw new Error('batch ' + b.status + ' ' + t.slice(0, 200));
    return 'batch ' + b.status;
  };
  const steps = [
    // ---------- rodada 1 ----------
    ['I1', 'api', { category: 'hardware' }, eq({ assignment_group: G.HW })],
    ['I2', 'api', { urgency: '2' }, starts('close_notes', 'Urgência média')],
    ['I3', 'form', { contact_type: 'self-service' }, all(eq({ contact_type: 'self-service' }), starts('description', 'Aberto pelo portal'))],
    ['I4', 'form', { category: 'hardware' }, all(eq({ category: 'hardware' }), starts('description', 'Informar o número'))],
    ['I5', 'form', { category: 'software' }, all(eq({ category: 'software' }), starts('close_notes', 'Fora do escopo'))],
    ['I6', 'import', { u_chave: SD.I6, u_descricao: 'Transportadora informa 37 pedidos sem etiqueta de coleta', u_categoria: 'hardware', u_codigo: '8812' },
      all(eq({ category: 'network', urgency: '2', correlation_id: 'COLETA-8812', correlation_display: 'TRANSP-8812' }), starts('description', 'Transportadora'))],
    ['I7', 'import', { u_chave: SD.I7, u_descricao: 'Pedido 1001: parceiro solicita reenvio da nota de coleta', u_categoria: 'software', u_codigo: '9101' }, starts('description', 'Pedido 1001')],
    ['I8', 'batch', { description: 'Lote do monitoramento: 4 alertas de disco agrupados no servidor srv-arq-01' }, all(starts('description', 'Lote do monitoramento'), starts('close_notes', 'Recebido pelo lote'))],
    ['I9', 'api', { assignment_group: G.HW }, eq({ assigned_to: U.BETH })],
    ['I10', 'api', { close_notes: 'Fornecedor substituiu a fonte do equipamento; nota exigida pela política de dados.' }, starts('close_notes', 'Fornecedor substituiu')],
    ['P1', 'api', { category: 'network' }, starts('workaround', 'Rotear o tráfego')],
    ['P2', 'api', { impact: '2' }, starts('cause_notes', 'Diagnóstico')],
    ['C1', 'form', { implementation_plan: '1. Congelar a escrita. 2. Replicar a base. 3. Virar o DNS do faturamento.' }, starts('implementation_plan', '1. Congelar')],
    ['C2', 'form', { impact: '1' }, all(eq({ impact: '1' }), starts('backout_plan', 'Impacto alto'))],
    ['C3', 'api', { justification: 'Balanceador atual fora de suporte do fabricante desde março.' }, starts('justification', 'Balanceador atual')],
    // ---------- rodada 2 ----------
    ['I1', 'form', { assignment_group: G.NET }, eq({ assignment_group: G.NET })],
    ['I2', 'api', { impact: '2' }, starts('close_notes', 'Impacto reavaliado')],
    ['I7', 'api', { description: 'Ajuste manual: parceiro confirmou endereço novo para a coleta' }, starts('description', 'Ajuste manual')],
    ['I9', 'api', { assigned_to: U.DAVID }, eq({ assigned_to: U.DAVID })],
    ['P1', 'ui', 'pt_f15_contorno_padrao', starts('workaround', 'Contorno padrão')],
    ['P2', 'job', () => job('[PT] F15 Consolida diagnósticos', jobOne('problem', 'P2', 'cause_notes', 'Consolidado', 'Consolidado: repositório de backup ampliado; falhas cessaram após 3 execuções.')), starts('cause_notes', 'Consolidado')],
    ['C1', 'api', { risk: '2' }, starts('implementation_plan', 'Risco alto')],
    ['C3', 'job', () => job('[PT] F15 Padroniza justificativas', jobOne('change_request', 'C3', 'justification', 'Padronizado', 'Padronizado: troca de ativo fora de suporte (política de ciclo de vida).')), starts('justification', 'Padronizado')],
    // ---------- rodada 3 ----------
    ['I1', 'ui', 'pt_f15_encaminhar_sd', eq({ assignment_group: G.SD })],
    ['I2', 'job', () => job('[PT] F15 Revisão noturna das notas', jobOne('incident', 'I2', 'close_notes', 'Revisão noturna', 'Revisão noturna: chamado mantido em observação até o fechamento do lote.')), starts('close_notes', 'Revisão noturna')],
    ['I7', 'import', { u_chave: SD.I7, u_descricao: 'Pedido 1002: parceiro cancelou a coleta do dia', u_categoria: 'software', u_codigo: '9102' }, starts('description', 'Pedido 1002')],
    ['I9', 'ui', 'pt_f15_assumir', eq({ assigned_to: F15.ADMIN })],
    ['P1', 'api', { workaround: 'Operadora aplicou QoS provisório; manter o link 4G como backup.' }, starts('workaround', 'Operadora aplicou')],
    ['C1', 'ui', 'pt_f15_congelar_plano', starts('implementation_plan', 'Plano congelado')],
  ];
  const fields = 'impact,urgency,priority,category,contact_type,assignment_group,assigned_to,description,close_notes,correlation_id,correlation_display,workaround,cause_notes,implementation_plan,backout_plan,justification,risk';
  const last = {};
  const t00 = Date.now();
  for (const [k, kind, arg, check] of steps) {
    const r = R[k];
    while (last[k] && Date.now() - last[k] < 25000) await sleep(1000);
    const t0 = Date.now();
    let extraInfo = '';
    try {
      if (kind === 'api') await api('PATCH', `table/${r.table}/${r.sys_id}`, arg);
      else if (kind === 'form') await f15Form(r.table, r.sys_id, arg);
      else if (kind === 'ui') await f15Form(r.table, r.sys_id, {}, arg);
      else if (kind === 'job') await arg();
      else if (kind === 'import') extraInfo = await imp(arg);
      else if (kind === 'batch') extraInfo = await batch(k, arg);
      let ok = false, cur;
      for (let i = 0; i < 120 && !ok; i++) {
        cur = (await api('GET', `table/${r.table}?sysparm_query=sys_id=${r.sys_id}&sysparm_fields=${fields}`))[0];
        cur = Object.fromEntries(Object.entries(cur).map(([f, v]) => [f, v && typeof v === 'object' ? v.value : v]));
        ok = check(cur);
        if (!ok) await sleep(2000);
      }
      last[k] = Date.now();
      log.push(`${new Date().toISOString().slice(11, 19)} ${k} ${kind} ${ok ? 'ok' : 'NAO CONFERIU'} ${Math.round((Date.now() - t0) / 1000)}s ${extraInfo}`.replace(/[=&?]/g, '_'));
    } catch (e) { last[k] = Date.now(); log.push(`${new Date().toISOString().slice(11, 19)} ${k} ${kind} ERRO ${e.message}`.replace(/[=&?]/g, '_')); }
  }
  log.push(`FIM ${Math.round((Date.now() - t00) / 1000)}s`);
  return log;
}

/** sys_audit de todos os registros, em ordem cronológica. */
async function f15Audit(S) {
  const { api } = f15api();
  const R = S.recs;
  const ids = Object.values(R).map((r) => r.sys_id).join(',');
  const rows = await api('GET', `table/sys_audit?sysparm_limit=1000&sysparm_fields=documentkey,fieldname,oldvalue,newvalue,user,record_checkpoint,sys_created_on&sysparm_query=documentkeyIN${ids}^ORDERBYsys_created_on`);
  return rows.filter((x) => !['sys_updated_on', 'sys_updated_by', 'sys_mod_count'].includes(x.fieldname)).map((x) => {
    const key = (Object.entries(R).find(([, r]) => r.sys_id === x.documentkey) || ['?'])[0];
    return `${x.sys_created_on} ${key} cp${x.record_checkpoint} ${x.fieldname} ${x.user} ${String(x.oldvalue).slice(0, 40)} -> ${String(x.newvalue).slice(0, 60)}`.replace(/[=&?]/g, '_');
  });
}

Object.assign(window, { F15, f15Setup, f15Check, f15Form, f15Run, f15Audit });
})();
