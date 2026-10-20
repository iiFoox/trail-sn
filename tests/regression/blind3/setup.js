/**
 * Fase 10 — teste às cegas 3. Tudo leva o prefixo [PT] F10 (script include PTF10*) e é idempotente (upsert por nome).
 * Escopo: cada regra filtra por short_description dos registros [PT] F10-NN (ou por sys_id no client script).
 * Tabelas: problem, sc_task, change_task, incident, change_request.
 * Rodar na aba logada (admin) da PDI:
 *   window.F10S = await f10Setup();     // artefatos + registros + client scripts
 *   window.F10L = await f10Run(F10S);   // ações (formulário clássico, API, UI actions) + jobs de execução única
 *   (incident F10-31/32/33: salvos à mão no Service Operations Workspace, /now/sow/record/incident/<sys_id>, aba Details → Save)
 *   window.F10A = await f10Audit(F10S); // sys_audit de todos os registros
 * As respostas ficam APENAS em tests/regression/blind3/answers.json.
 */
const F10 = {
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { NET: '287ebd7da9fe198100f92cc8d1d2154e', DB: '287ee6fea9fe198100ada7950d0b1b73', HW: '8a5055c9c61122780043563ef53438e3', SD: 'd625dccec0a8016700a222a0f7900d06', SW: '8a4dde73c6112278017a6a4baf547aa7' },
  U: { BETH: '46d44a23a9fe19810012d100cca80666', DAVID: '5137153cc611227c000bbd1bd8cd2007', DON: '9ee1b13dc6112271007f9d0efdb69cd0' },
  SD: {
    P1: '[PT] F10-01 Lentidão recorrente no portal do cliente',
    P2: '[PT] F10-02 Falhas intermitentes no DNS interno',
    P3: '[PT] F10-03 Erro de memória no servidor de aplicação',
    P4: '[PT] F10-04 Certificado expirado no gateway de pagamentos',
    P5: '[PT] F10-05 Perda de pacotes no link MPLS',
    P6: '[PT] F10-06 Banco de relatórios sem espaço em disco',
    P7: '[PT] F10-07 Reinicializações inesperadas do cluster',
    P8: '[PT] F10-08 Lentidão na autenticação do AD',
    S1: '[PT] F10-11 Instalar software de design',
    S2: '[PT] F10-12 Liberar acesso à VPN para terceiro',
    S3: '[PT] F10-13 Configurar estação do novo analista',
    S4: '[PT] F10-14 Troca de toner da impressora do RH',
    S5: '[PT] F10-15 Ativar licença do Office',
    CP: '[PT] F10-20 Mudança mãe das tarefas de DR',
    T1: '[PT] F10-21 Backup completo antes da janela',
    T2: '[PT] F10-22 Validar replicação do storage',
    T3: '[PT] F10-23 Teste de failover do firewall',
    T4: '[PT] F10-24 Atualizar runbook do DR',
    I1: '[PT] F10-31 Câmera da sala de reunião sem imagem',
    I2: '[PT] F10-32 Leitor de crachá não reconhece cartões',
    I3: '[PT] F10-33 Wi-Fi do auditório instável',
    C1: '[PT] F10-41 Expansão de memória dos hosts VMware',
    C2: '[PT] F10-42 Atualização do sistema operacional dos caixas',
  },
};
const F10T = { P: 'problem', S: 'sc_task', T: 'change_task', I: 'incident', C: 'change_request' };

function f10api() {
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
    if (!/^(\[PT\] F10|PTF10)/.test(String(values.name || values.short_description))) throw new Error('sem prefixo [PT] F10');
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

async function f10Setup() {
  const { api, find, upsert } = f10api();
  const S = F10.SD, G = F10.G, U = F10.U;
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (table, name, when, order, filter, script, condition = '') => upsert('sys_script', {
    name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: filter + '^EQ', condition, script: wrap(script),
  }, `name=${name}^collection=${table}`);
  const sd = (k) => `short_description=${S[k]}`;
  const ua = (table, name, action_name, condition, script) => upsert('sys_ui_action', { name, table, action_name, active: 'true', form_button: 'true', client: 'false', condition, script: script + '\ncurrent.update();\naction.setRedirectURL(current);' }, `action_name=${action_name}^table=${table}`);
  const PRB = (...a) => br('problem', ...a), SCT = (...a) => br('sc_task', ...a), CTK = (...a) => br('change_task', ...a), INC = (...a) => br('incident', ...a), CHG = (...a) => br('change_request', ...a);

  // eventos
  for (const [ev, table] of [['pt.f10.problema', 'problem'], ['pt.f10.tarefa', 'sc_task']])
    if (!(await find('sysevent_register', `event_name=${ev}`))) await api('POST', 'table/sysevent_register', { event_name: ev, table, description: '[PT] F10 evento' });

  // script include compartilhado
  await upsert('sys_script_include', { name: 'PTF10Rotinas', description: '[PT] F10 rotinas de problema e tarefa', api_name: 'global.PTF10Rotinas', active: 'true', access: 'public', client_callable: 'false',
    script: `var PTF10Rotinas = Class.create();
PTF10Rotinas.prototype = {
  initialize: function() {},
  // problemas: anota quem iniciou a análise
  anotarAnalise: function(sysId) {
    var gr = new GlideRecord('problem');
    if (!gr.get(sysId) || gr.assigned_to.nil()) return;
    gr.cause_notes = 'Análise iniciada por ' + gr.assigned_to.getDisplayValue() + ' em ' + new GlideDateTime().getDate();
    gr.update();
  },
  // não usado hoje: fecha a análise
  encerrarAnalise: function(sysId) {
    var gr = new GlideRecord('problem');
    if (gr.get(sysId)) { gr.cause_notes = 'Causa raiz confirmada'; gr.known_error = true; gr.update(); }
  },
  // tarefas de mudança: instruções para o responsável
  instruirTarefa: function(sysId) {
    var gr = new GlideRecord('change_task');
    if (!gr.get(sysId) || gr.assigned_to.nil()) return;
    gr.description = 'Responsável: ' + gr.assigned_to.getDisplayValue() + '. Revisar o runbook com base na última simulação de DR.';
    gr.update();
  },
  type: 'PTF10Rotinas'
};` }, 'api_name=global.PTF10Rotinas');

  // ---------- problem ----------
  // P1
  await PRB('[PT] F10 Prioridade de problema grave', 'before', 100, sd('P1'), "  current.priority = 1;", 'current.major_problem == true');
  // P2
  await PRB('[PT] F10 Contorno padrão de rede', 'before', 100, sd('P2'), "  current.workaround = 'Reiniciar o cliente VPN e tentar novamente.';", "current.subcategory == 'vpn'");
  await PRB('[PT] F10 Contorno para DNS', 'before', 200, sd('P2'), "  if (current.cause_notes.changes() && String(current.cause_notes).indexOf('DNS') >= 0)\n    current.workaround = 'Apontar as estações para o DNS secundário enquanto a replicação é corrigida.';");
  // P3
  await PRB('[PT] F10 Fila de hardware', 'before', 100, sd('P3'), `  if (current.category.changes() && current.category == 'hardware') current.assignment_group = '${G.HW}';`);
  await PRB('[PT] F10 Grupo para falhas de memória', 'before', 300, sd('P3'), `  if (current.category.changes()) current.assignment_group = '${G.DB}';`, "current.subcategory == 'memory'");
  await PRB('[PT] F10 Escala problemas críticos', 'before', 600, sd('P3'), `  if (current.impact != 1) return;\n  current.assignment_group = '${G.SW}';`);
  // P4
  await ua('problem', '[PT] F10 Marcar como erro conhecido', 'pt_f10_erro_conhecido', `current.short_description == '${S.P4}'`, 'current.known_error = true;');
  await ua('problem', '[PT] F10 Retirar erro conhecido', 'pt_f10_retirar_erro', `current.short_description.toString().indexOf('[PT] F10-0') == 0 && current.known_error == true`, 'current.known_error = false;');
  await PRB('[PT] F10 Avisa erro conhecido', 'after', 100, sd('P4') + '^known_errorVALCHANGES', "  if (current.known_error == true) gs.eventQueue('pt.f10.problema', current, 'prazo', current.number);");
  await PRB('[PT] F10 Prazo para problema grave', 'before', 150, sd('P4'), "  var d = new GlideDateTime(); d.addDaysUTC(1); current.due_date = d;", 'current.major_problem == true');
  await upsert('sysevent_script_action', { name: '[PT] F10 Define prazo de correção', event_name: 'pt.f10.problema', active: 'true',
    script: "if (event.parm1 == 'prazo' && String(current.short_description).indexOf('[PT] F10-') == 0) {\n  var d = new GlideDateTime();\n  d.addDaysUTC(7);\n  current.due_date = d;\n  current.update();\n}" });
  // P5
  await PRB('[PT] F10 Plano de correção urgente', 'before', 100, sd('P5'), "  current.fix_notes = 'Troca emergencial do link';", 'current.impact == 1');
  await PRB('[PT] F10 Plano de correção por impacto', 'async', 100, sd('P5') + '^impactVALCHANGES', "  current.fix_notes = 'Substituir o roteador de borda do link MPLS (impacto ' + current.impact.getDisplayValue() + ').';\n  current.update();");
  await PRB('[PT] F10 Confere plano de correção', 'after', 100, sd('P5'), "  if (current.fix_notes.changes()) gs.info('[PT] F10 plano de correção: ' + current.fix_notes);");
  // P6
  await upsert('sysrule_assignment', { name: '[PT] F10 Problemas de banco de dados', table: 'problem', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.P6}^category=database^assignment_groupISEMPTY^EQ`, group: G.DB });
  await PRB('[PT] F10 Grupo de banco para prioridade alta', 'before', 100, sd('P6'), `  if (current.priority != 1) return;\n  current.assignment_group = '${G.NET}';`);
  // P7
  await PRB('[PT] F10 Problema grave por impacto', 'before', 100, sd('P7'), "  if (current.impact.changes() && current.impact == 1) current.major_problem = true;");
  await PRB('[PT] F10 Rebaixa problemas de banco', 'before', 500, sd('P7'), "  current.major_problem = false;", "current.category == 'database'");
  // P8
  await PRB('[PT] F10 Registra responsável pela análise', 'after', 100, sd('P8') + '^assigned_toVALCHANGES', "  new PTF10Rotinas().anotarAnalise(current.getUniqueValue());");

  // ---------- sc_task ----------
  // S1
  // (o formulário de sc_task desta PDI não mostra assignment_group; o gatilho é assigned_to)
  await SCT('[PT] F10 Prazo pelo técnico designado', 'before', 100, sd('S1'), `  if (!current.assigned_to.changes() || current.assigned_to.nil()) return;\n  var d = new GlideDateTime();\n  d.addDaysUTC(current.assigned_to == '${U.DAVID}' ? 3 : 5);\n  current.due_date = d;`);
  await SCT('[PT] F10 Prazo encurtado para urgentes', 'before', 400, sd('S1'), "  var d = new GlideDateTime(); d.addDaysUTC(1); current.due_date = d;", 'current.priority == 1');
  // S2
  await ua('sc_task', '[PT] F10 Encaminhar para redes', 'pt_f10_enc_redes', `current.short_description == '${S.S2}'`, `current.assignment_group = '${G.NET}';`);
  await ua('sc_task', '[PT] F10 Encaminhar para service desk', 'pt_f10_enc_sd', `current.short_description.toString().indexOf('[PT] F10-1') == 0 && !current.assignment_group.nil()`, `current.assignment_group = '${G.SD}';`);
  await SCT('[PT] F10 Registra encaminhamento', 'after', 100, sd('S2') + '^assignment_groupVALCHANGES', "  if (String(current.description).indexOf('Encaminhado') == 0) return;\n  current.description = 'Encaminhado para ' + current.assignment_group.getDisplayValue() + '. Pedido original: ' + previous.description;\n  current.update();");
  // S3
  await SCT('[PT] F10 Desmarca conhecimento', 'before', 100, sd('S3'), "  current.knowledge = false;", 'current.priority == 5');
  await SCT('[PT] F10 Conhecimento para tarefas urgentes', 'async', 100, sd('S3') + '^priorityVALCHANGES', "  if (current.knowledge != true) {\n    current.knowledge = true;\n    current.update();\n  }", 'current.priority <= 2');
  // S4
  await SCT('[PT] F10 Avisa suprimentos', 'after', 100, sd('S4') + '^assigned_toVALCHANGES', "  gs.eventQueue('pt.f10.tarefa', current, 'suprimentos', current.assigned_to);");
  await upsert('sysevent_script_action', { name: '[PT] F10 Fila de suprimentos', event_name: 'pt.f10.tarefa', active: 'true',
    script: `if (event.parm1 == 'suprimentos' && String(current.short_description).indexOf('[PT] F10-') == 0 && current.assignment_group.nil()) {\n  current.assignment_group = '${G.HW}';\n  current.update();\n}` });
  await upsert('sysrule_assignment', { name: '[PT] F10 Suprimentos de impressão', table: 'sc_task', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.S4}^priority=1^assignment_groupISEMPTY^EQ`, group: G.SD });
  // S5
  await SCT('[PT] F10 Descrição padrão de licença', 'before', 100, sd('S5'), "  current.description = 'Licença pendente de ativação';", 'current.description.nil()');

  // ---------- change_task ----------
  // T1
  await CTK('[PT] F10 Fim planejado pela duração', 'before', 100, sd('T1'), "  if (!current.planned_start_date.changes() || current.planned_start_date.nil()) return;\n  var d = new GlideDateTime(current.planned_start_date.getGlideObject());\n  d.addSeconds(4 * 3600);\n  current.planned_end_date = d;");
  // T2
  await CTK('[PT] F10 Grupo de storage', 'before', 100, sd('T2'), `  current.assignment_group = '${G.SW}';`, "current.change_task_type == 'testing'");
  await CTK('[PT] F10 Escala tarefa em espera', 'after', 100, sd('T2') + '^on_holdVALCHANGES', `  if (current.on_hold == true && current.assignment_group != '${G.DB}') {\n    current.assignment_group = '${G.DB}';\n    current.update();\n  }`);
  await CTK('[PT] F10 Log de espera', 'after', 200, sd('T2'), "  if (current.on_hold.changes()) gs.info('[PT] F10 tarefa em espera: ' + current.number + ' grupo ' + current.assignment_group.getDisplayValue());");
  // T3
  await ua('change_task', '[PT] F10 Concluir teste com ressalvas', 'pt_f10_ressalvas', `current.short_description == '${S.T3}'`, "current.close_code = 'successful_issues';");
  await ua('change_task', '[PT] F10 Concluir teste sem ressalvas', 'pt_f10_sem_ressalvas', `current.short_description.toString().indexOf('[PT] F10-2') == 0`, "current.close_code = 'successful';\ncurrent.close_notes = 'Teste concluído sem ressalvas';");
  await CTK('[PT] F10 Notas de encerramento', 'before', 100, sd('T3'), "  if (current.close_code.changes() && !current.close_code.nil())\n    current.close_notes = 'Encerrado com código ' + current.close_code.getDisplayValue() + ' em ' + new GlideDateTime().getDate();");
  // T4
  await CTK('[PT] F10 Descrição de tarefa de revisão', 'before', 100, sd('T4'), "  current.description = 'Revisar documentação';", "current.change_task_type == 'review'");
  await CTK('[PT] F10 Instruções para o responsável', 'after', 100, sd('T4') + '^assigned_toVALCHANGES', "  new PTF10Rotinas().instruirTarefa(current.getUniqueValue());");

  // ---------- incident (salvos pelo Service Operations Workspace) ----------
  await INC('[PT] F10 Urgência para salas de reunião', 'before', 100, sd('I1'), "  current.urgency = 1;", "current.contact_type == 'walk-in'");
  await INC('[PT] F10 Técnico de plantão', 'before', 100, sd('I3'), `  if (current.contact_type.changes()) current.assigned_to = '${U.BETH}';`);
  await INC('[PT] F10 Técnico presencial do auditório', 'before', 250, sd('I3'), `  if (current.contact_type.changes() && current.contact_type == 'walk-in') current.assigned_to = '${U.DON}';`);
  await INC('[PT] F10 Técnico remoto', 'before', 700, sd('I3'), `  if (current.contact_type != 'email') return;\n  current.assigned_to = '${U.DAVID}';`);

  // ---------- change_request ----------
  await CHG('[PT] F10 Sistema de produção por categoria', 'before', 100, sd('C1'), "  if (current.category.changes() && current.category == 'Hardware') current.production_system = true;");
  await CHG('[PT] F10 Ambiente de homologação', 'before', 300, sd('C1'), "  current.production_system = false;", "current.type == 'emergency'");
  await ua('change_request', '[PT] F10 Agendar janela de sábado', 'pt_f10_janela_sabado', `current.short_description == '${S.C2}'`,
    "var d = new GlideDateTime();\nd.addDaysUTC(7);\nd.setValue(d.getDate() + ' 22:00:00');\ncurrent.start_date = d;");
  await CHG('[PT] F10 Fim da janela', 'before', 100, sd('C2'), "  if (!current.start_date.changes() || current.start_date.nil()) return;\n  var d = new GlideDateTime(current.start_date.getGlideObject());\n  d.addSeconds(6 * 3600);\n  current.end_date = d;");
  await CHG('[PT] F10 Janela estendida', 'before', 500, sd('C2'), "  var d = new GlideDateTime(current.start_date.getGlideObject()); d.addSeconds(12 * 3600); current.end_date = d;", "current.risk == '2'");

  // ---------- registros ----------
  const base = {
    problem: { impact: '3', urgency: '3', category: 'software', description: 'inicial', known_error: 'false', major_problem: 'false' },
    sc_task: { priority: '4', description: 'inicial', knowledge: 'false' },
    change_task: { change_task_type: 'planning', description: 'inicial', on_hold: 'false' },
    incident: { caller_id: F10.ADMIN, contact_type: 'phone', impact: '3', urgency: '3', category: 'inquiry', description: 'inicial' },
    change_request: { type: 'normal', impact: '3', risk: '3', category: 'Other', description: 'inicial', production_system: 'false' },
  };
  const extra = { P3: { subcategory: 'memory' } };
  const recs = {};
  const getOrCreate = async (k, table, vals) => {
    const r = (await find(table, `short_description=${S[k]}`)) ?? await api('POST', `table/${table}`, { short_description: S[k], ...vals });
    recs[k] = { table, sys_id: r.sys_id, number: r.number };
  };
  await getOrCreate('CP', 'change_request', base.change_request);
  for (const k of Object.keys(S)) {
    if (k === 'CP') continue;
    const table = F10T[k[0]];
    await getOrCreate(k, table, { ...base[table], ...(table === 'change_task' ? { change_request: recs.CP.sys_id } : {}), ...(extra[k] || {}) });
  }

  // ---------- client scripts ----------
  const cs = (table, name, field, ui_type, script) => upsert('sys_script_client', { name, table, active: 'true', type: 'onChange', field, ui_type, script }, `name=${name}^table=${table}`);
  const on = (body) => `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n${body}\n}`;
  // problem (formulário clássico)
  await cs('problem', '[PT] F10 Sugere causa provável', 'category', '0', on(`  if (g_form.getUniqueValue() != '${recs.P2.sys_id}') return;\n  if (newValue == 'network') g_form.setValue('cause_notes', 'Possível falha de replicação entre os servidores DNS');`));
  await cs('problem', '[PT] F10 Avisa mudança de categoria', 'category', '0', on(`  if (g_form.getValue('short_description').indexOf('[PT] F10-') != 0) return;\n  g_form.showFieldMsg('category', 'Categoria alterada: revise a análise', 'info');`));
  // change_task (formulário clássico)
  await cs('change_task', '[PT] F10 Sugere início da implementação', 'change_task_type', '0', on(`  if (g_form.getUniqueValue() != '${recs.T1.sys_id}') return;\n  if (newValue != 'implementation') return;\n  var d = new Date(2026, 10, 7, 22, 0, 0);\n  g_form.setValue('planned_start_date', formatDate(d, g_user_date_time_format));`));
  await cs('change_task', '[PT] F10 Lembra janela de mudança', 'change_task_type', '0', on(`  if (g_form.getValue('short_description').indexOf('[PT] F10-') != 0) return;\n  g_form.addInfoMessage('Confira a janela da mudança ' + g_form.getDisplayBox('change_request').value);`));
  // incident (Workspace): UI type All x Desktop
  await cs('incident', '[PT] F10 Impacto sugerido para hardware', 'category', '10', on(`  if (g_form.getValue('short_description') != '${S.I2}') return;\n  if (newValue == 'hardware') g_form.setValue('impact', '2');`));
  await cs('incident', '[PT] F10 Urgência sugerida para hardware', 'category', '0', on(`  if (g_form.getValue('short_description') != '${S.I2}') return;\n  if (newValue == 'hardware') g_form.setValue('urgency', '1');`));
  return recs;
}

/** Salva pelo formulário UI16 real (iframe). action = 'sysverb_update_and_stay' ou o action_name de uma UI action. */
async function f10Form(table, sysId, values, action = 'sysverb_update_and_stay') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
  f.src = `/${table}.do?sys_id=${sysId}`;
  document.body.appendChild(f);
  await new Promise((r) => f.addEventListener('load', r, { once: true }));
  const w = f.contentWindow;
  for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1000));
  for (const [k, v] of Object.entries(values)) { w.g_form.setValue(k, v); await new Promise((r) => setTimeout(r, 1500)); }
  let missing = (w.g_form.getMissingFields && w.g_form.getMissingFields()) || [];
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'Atualização [PT] F10'); await new Promise((r) => setTimeout(r, 300)); missing = w.g_form.getMissingFields(); }
  if (missing.length) { f.remove(); throw new Error('obrigatórios: ' + missing.join(',')); }
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, 600));
  f.remove();
}

async function f10Run(R) {
  const { api, upsert } = f10api();
  const log = [];
  const step = async (k, fn) => { try { await fn(); log.push(k + ' ok'); } catch (e) { log.push(k + ' ERRO ' + e.message); } await new Promise((r) => setTimeout(r, 1500)); };
  const patch = (k, v) => api('PATCH', `table/${R[k].table}/${R[k].sys_id}`, v);
  await step('P1 api', () => patch('P1', { urgency: '1' }));
  await step('P2 form', () => f10Form('problem', R.P2.sys_id, { category: 'network' }));
  await step('P3 api', () => patch('P3', { category: 'hardware' }));
  await step('P4 ui', () => f10Form('problem', R.P4.sys_id, {}, 'pt_f10_erro_conhecido'));
  await step('P5 api', () => patch('P5', { impact: '2' }));
  await step('P7 form', () => f10Form('problem', R.P7.sys_id, { impact: '1' }));
  await step('P8 api', () => patch('P8', { assigned_to: F10.U.BETH }));
  await step('S1 form', () => f10Form('sc_task', R.S1.sys_id, { assigned_to: F10.U.DAVID }));
  await step('S2 ui', () => f10Form('sc_task', R.S2.sys_id, {}, 'pt_f10_enc_redes'));
  await step('S3 api', () => patch('S3', { priority: '2' }));
  await step('S4 api', () => patch('S4', { assigned_to: F10.U.DON }));
  await step('T1 form', () => f10Form('change_task', R.T1.sys_id, { change_task_type: 'implementation' }));
  await step('T2 api', () => patch('T2', { on_hold: 'true' }));
  await step('T3 ui', () => f10Form('change_task', R.T3.sys_id, {}, 'pt_f10_ressalvas'));
  await step('T4 api', () => patch('T4', { assigned_to: F10.U.BETH }));
  await step('C1 form', () => f10Form('change_request', R.C1.sys_id, { category: 'Hardware' }));
  await step('C2 ui', () => f10Form('change_request', R.C2.sys_id, {}, 'pt_f10_janela_sabado'));
  // jobs de execução única (UTC)
  const at = (s) => new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const t1 = at(120), t2 = at(150);
  await upsert('sysauto_script', { name: '[PT] F10 Reclassifica problemas de armazenamento', active: 'true', run_type: 'once', run_start: t1,
    script: `var gr = new GlideRecord('problem');\ngr.addQuery('short_description', '${F10.SD.P6}');\ngr.addQuery('category', '!=', 'database');\ngr.query();\nwhile (gr.next()) { gr.setValue('category', 'database'); gr.update(); }` });
  await upsert('sysauto_script', { name: '[PT] F10 Ativação de licenças pendentes', active: 'true', run_type: 'once', run_start: t2,
    script: `var gr = new GlideRecord('sc_task');\nif (gr.get('${R.S5.sys_id}') && gr.getValue('description') == 'inicial') { gr.setValue('description', 'Licença Microsoft 365 E3 atribuída; aguardando o primeiro login do usuário.'); gr.update(); }` });
  log.push('jobs ' + t1 + ' / ' + t2);
  return log;
}

async function f10Audit(R) {
  const { api } = f10api();
  const out = {};
  for (const [k, r] of Object.entries(R)) {
    const rows = await api('GET', `table/sys_audit?sysparm_query=documentkey=${r.sys_id}^ORDERBYDESCsys_created_on&sysparm_fields=fieldname,oldvalue,newvalue,user,record_checkpoint,sys_created_on&sysparm_limit=100`);
    out[k] = rows.filter((x) => !['sys_updated_on', 'sys_updated_by', 'sys_mod_count'].includes(x.fieldname)).map((x) => `${x.record_checkpoint} ${x.user} ${x.fieldname}: ${String(x.oldvalue).slice(0, 40)} -> ${String(x.newvalue).slice(0, 60)}`);
  }
  return out;
}
