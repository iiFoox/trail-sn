/**
 * Fase 11 — teste às cegas 4 (histórico longo). Tudo leva o prefixo [PT] F11 (script include PTF11*) e é idempotente (upsert por nome).
 * Escopo: cada regra filtra por short_description dos registros [PT] F11-NN (ou por sys_id no client script).
 * Tabelas: problem, incident, change_request. Em cada registro o MESMO campo muda 4 ou 5 vezes, uma causa por rodada.
 * Rodar na aba logada (admin) da PDI:
 *   window.F11S = await f11Setup();          // artefatos + registros + client scripts
 *   window.F11C = await f11Check(F11S);      // confere se os campos usados estão nos formulários clássicos
 *   window.F11L = []; f11Run(F11S, F11L);    // 5 rodadas (≥25 s entre gravações do mesmo registro); acompanhar F11L
 *   window.F11A = await f11Audit(F11S);      // sys_audit de todos os registros
 * As respostas ficam APENAS em tests/regression/blind4/answers.json.
 */
const F11 = {
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { NET: '287ebd7da9fe198100f92cc8d1d2154e', DB: '287ee6fea9fe198100ada7950d0b1b73', HW: '8a5055c9c61122780043563ef53438e3', SD: 'd625dccec0a8016700a222a0f7900d06', SW: '8a4dde73c6112278017a6a4baf547aa7' },
  U: { BETH: '46d44a23a9fe19810012d100cca80666', DAVID: '5137153cc611227c000bbd1bd8cd2007', DON: '9ee1b13dc6112271007f9d0efdb69cd0' },
  SD: {
    P1: '[PT] F11-01 Lentidão no ERP após atualização',
    P2: '[PT] F11-02 Falha no envio de notas fiscais',
    P3: '[PT] F11-03 Erros de sincronização do LDAP',
    I1: '[PT] F11-11 Impressora fiscal da loja 12 travando',
    I2: '[PT] F11-12 Wi-Fi do centro de distribuição instável',
    I3: '[PT] F11-13 Sistema de ponto fora do ar',
    C1: '[PT] F11-21 Migração do storage do datacenter',
    C2: '[PT] F11-22 Atualização do firmware dos switches',
    C3: '[PT] F11-23 Troca do certificado do portal',
  },
};
const F11T = { P: 'problem', I: 'incident', C: 'change_request' };

function f11api() {
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
    if (!/^(\[PT\] F11|PTF11)/.test(String(values.name || values.short_description))) throw new Error('sem prefixo [PT] F11');
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

async function f11Setup() {
  const { api, find, upsert } = f11api();
  const S = F11.SD, G = F11.G, U = F11.U;
  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (table, name, when, order, filter, script, condition = '') => upsert('sys_script', {
    name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
    advanced: 'true', filter_condition: filter + '^EQ', condition, script: wrap(script),
  }, `name=${name}^collection=${table}`);
  const sd = (k) => `short_description=${S[k]}`;
  const ua = (table, name, action_name, condition, script) => upsert('sys_ui_action', { name, table, action_name, active: 'true', form_button: 'true', client: 'false', condition, script: script + '\ncurrent.update();\naction.setRedirectURL(current);' }, `action_name=${action_name}^table=${table}`);
  const PRB = (...a) => br('problem', ...a), INC = (...a) => br('incident', ...a), CHG = (...a) => br('change_request', ...a);

  for (const [ev, table] of [['pt.f11.problema', 'problem'], ['pt.f11.incidente', 'incident'], ['pt.f11.mudanca', 'change_request']])
    if (!(await find('sysevent_register', `event_name=${ev}`))) await api('POST', 'table/sysevent_register', { event_name: ev, table, description: '[PT] F11 evento' });

  await upsert('sys_script_include', { name: 'PTF11Rotinas', description: '[PT] F11 rotinas de problema, incidente e mudança', api_name: 'global.PTF11Rotinas', active: 'true', access: 'public', client_callable: 'false',
    script: `var PTF11Rotinas = Class.create();
PTF11Rotinas.prototype = {
  initialize: function() {},
  // problemas: registra quem iniciou a análise
  anotarCausa: function(sysId) {
    var gr = new GlideRecord('problem');
    if (!gr.get(sysId) || gr.assigned_to.nil()) return;
    gr.cause_notes = 'Análise iniciada por ' + gr.assigned_to.getDisplayValue() + ': coletar logs do conector LDAP.';
    gr.update();
  },
  // incidentes: plantonista do grupo quando ninguém foi designado
  designarPlantonista: function(sysId) {
    var gr = new GlideRecord('incident');
    if (!gr.get(sysId) || !gr.assigned_to.nil()) return;
    gr.assigned_to = '${U.BETH}';
    gr.update();
  },
  // mudanças: justificativa nova vai para revisão do time de software
  revisarMudanca: function(sysId) {
    var gr = new GlideRecord('change_request');
    if (!gr.get(sysId)) return;
    gr.assignment_group = '${G.SW}';
    gr.update();
  },
  // não usado hoje
  encerrarAnalise: function(sysId) {
    var gr = new GlideRecord('problem');
    if (gr.get(sysId)) { gr.cause_notes = 'Causa raiz confirmada'; gr.update(); }
  },
  type: 'PTF11Rotinas'
};` }, 'api_name=global.PTF11Rotinas');

  // ---------- problem ----------
  // P1 (assignment_group)
  await upsert('sysrule_assignment', { name: '[PT] F11 Problemas de banco do ERP', table: 'problem', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.P1}^category=database^assignment_groupISEMPTY^EQ`, group: G.DB });
  await ua('problem', '[PT] F11 Escalar para software', 'pt_f11_escalar_sw', `current.short_description == '${S.P1}'`, `current.assignment_group = '${G.SW}';`);
  await ua('problem', '[PT] F11 Devolver ao service desk', 'pt_f11_devolver_sd', `current.short_description.toString().indexOf('[PT] F11-0') == 0 && !current.assignment_group.nil()`, `current.assignment_group = '${G.SD}';`);
  await PRB('[PT] F11 Grupo de crise', 'before', 100, sd('P1'), `  if (current.impact.changes() && current.impact == 1) current.assignment_group = '${G.SD}';`);
  await PRB('[PT] F11 Grupo de crise de rede', 'before', 400, sd('P1'), `  if (current.category != 'network') return;\n  current.assignment_group = '${G.NET}';`);
  // P2 (workaround)
  await PRB('[PT] F11 Contorno padrão', 'before', 100, sd('P2'), "  current.workaround = 'Reiniciar o serviço de mensageria.';", "current.subcategory == 'vpn'");
  await PRB('[PT] F11 Contorno para urgentes', 'async', 100, sd('P2') + '^urgencyVALCHANGES', "  current.workaround = 'Prioridade alta: emitir em contingência (EPEC) até a SEFAZ normalizar.';\n  current.update();", 'current.urgency == 1');
  await PRB('[PT] F11 Avisa causa identificada', 'after', 100, sd('P2') + '^cause_notesVALCHANGES', "  gs.eventQueue('pt.f11.problema', current, 'contorno', current.number);");
  await upsert('sysevent_script_action', { name: '[PT] F11 Contorno por causa', event_name: 'pt.f11.problema', active: 'true',
    script: "if (event.parm1 == 'contorno' && String(current.short_description).indexOf('[PT] F11-') == 0) {\n  current.workaround = 'Renovar o certificado A1 e reenviar o lote rejeitado.';\n  current.update();\n}" });
  // P3 (cause_notes)
  await PRB('[PT] F11 Registra início da análise', 'after', 100, sd('P3') + '^assigned_toVALCHANGES', "  new PTF11Rotinas().anotarCausa(current.getUniqueValue());");
  await PRB('[PT] F11 Causa provável de rede', 'before', 100, sd('P3'), "  if (current.category.changes() && current.category == 'network')\n    current.cause_notes = 'Provável perda de pacotes entre o conector e os controladores de domínio.';");
  await PRB('[PT] F11 Causa provável de banco', 'before', 300, sd('P3'), "  current.cause_notes = 'Base de identidades corrompida.';", "current.category == 'database'");

  // ---------- incident ----------
  // I1 (assignment_group)
  await upsert('sysrule_assignment', { name: '[PT] F11 Impressoras de loja', table: 'incident', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.I1}^category=hardware^assignment_groupISEMPTY^EQ`, group: G.HW });
  await INC('[PT] F11 Grupo de hardware crítico', 'before', 100, sd('I1'), `  if (current.priority != 1) return;\n  current.assignment_group = '${G.HW}';`);
  await INC('[PT] F11 Escala chamados urgentes de loja', 'after', 100, sd('I1'), `  if (current.urgency.changes() && current.urgency == 1 && current.assignment_group != '${G.DB}') {\n    current.assignment_group = '${G.DB}';\n    current.update();\n  }`);
  await INC('[PT] F11 Log de urgência de loja', 'after', 200, sd('I1'), "  if (current.urgency.changes()) gs.info('[PT] F11 urgência ' + current.number + ' grupo ' + current.assignment_group.getDisplayValue());");
  // I2 (impact)
  await ua('incident', '[PT] F11 Elevar impacto', 'pt_f11_elevar_impacto', `current.short_description == '${S.I2}'`, 'current.impact = 1;');
  await ua('incident', '[PT] F11 Reduzir impacto', 'pt_f11_reduzir_impacto', `current.short_description.toString().indexOf('[PT] F11-1') == 0 && current.impact == 1`, 'current.impact = 3;');
  await INC('[PT] F11 Avisa equipe de rede', 'after', 100, sd('I2') + '^categoryVALCHANGES', "  if (current.category == 'network') gs.eventQueue('pt.f11.incidente', current, 'rede', current.category);");
  await upsert('sysevent_script_action', { name: '[PT] F11 Impacto avaliado pela rede', event_name: 'pt.f11.incidente', active: 'true',
    script: "if (event.parm1 == 'rede' && String(current.short_description).indexOf('[PT] F11-') == 0 && current.impact != 2) {\n  current.impact = 2;\n  current.update();\n}" });
  await INC('[PT] F11 Impacto para walk-in', 'before', 100, sd('I2'), "  current.impact = 1;", "current.contact_type == 'walk-in'");
  await INC('[PT] F11 Impacto por canal digital', 'before', 200, sd('I2'), "  if (current.contact_type.changes() && current.contact_type == 'email') current.impact = 3;");
  await INC('[PT] F11 Reavalia impacto por urgência', 'async', 100, sd('I2') + '^urgencyVALCHANGES', "  if (current.impact != 1) {\n    current.impact = 1;\n    current.update();\n  }");
  await INC('[PT] F11 Registra urgência', 'after', 100, sd('I2'), "  if (current.urgency.changes()) gs.info('[PT] F11 urgência ' + current.number + ' impacto ' + current.impact);");
  // I3 (assigned_to)
  await INC('[PT] F11 Designa plantonista', 'after', 100, sd('I3') + '^assignment_groupVALCHANGES', "  new PTF11Rotinas().designarPlantonista(current.getUniqueValue());");
  await ua('incident', '[PT] F11 Assumir chamado', 'pt_f11_assumir', `current.short_description == '${S.I3}'`, 'current.assigned_to = gs.getUserID();');
  await ua('incident', '[PT] F11 Devolver para a fila', 'pt_f11_devolver_fila', `current.short_description.toString().indexOf('[PT] F11-1') == 0 && !current.assigned_to.nil()`, "current.assigned_to = '';");
  await INC('[PT] F11 Técnico de sistemas', 'before', 100, sd('I3'), `  if (current.category.changes()) current.assigned_to = '${U.BETH}';`);
  await INC('[PT] F11 Técnico de software', 'before', 300, sd('I3'), `  if (current.category.changes() && current.category == 'software') current.assigned_to = '${U.DON}';`);
  await INC('[PT] F11 Técnico de banco', 'before', 500, sd('I3'), `  current.assigned_to = '${U.DAVID}';`, "current.category == 'database'");

  // ---------- change_request ----------
  // C1 (implementation_plan)
  await CHG('[PT] F11 Plano para impacto alto', 'before', 100, sd('C1'), "  current.implementation_plan = 'Migração em janela única de 12h.';", 'current.impact == 1');
  await CHG('[PT] F11 Plano para impacto médio', 'async', 100, sd('C1') + '^impactVALCHANGES', "  current.implementation_plan = 'Plano revisado para impacto médio: migrar em 3 janelas noturnas de 4h.';\n  current.update();", 'current.impact == 2');
  await ua('change_request', '[PT] F11 Pedir revisão técnica', 'pt_f11_revisao_tecnica', `current.short_description == '${S.C1}'`, 'current.cab_required = true;');
  await ua('change_request', '[PT] F11 Dispensar revisão técnica', 'pt_f11_dispensar_revisao', `current.short_description.toString().indexOf('[PT] F11-2') == 0 && current.cab_required == true`, 'current.cab_required = false;');
  await CHG('[PT] F11 Sinaliza revisão técnica', 'after', 100, sd('C1') + '^cab_requiredVALCHANGES', "  if (current.cab_required == true) gs.eventQueue('pt.f11.mudanca', current, 'revisao', current.number);");
  await upsert('sysevent_script_action', { name: '[PT] F11 Plano após revisão técnica', event_name: 'pt.f11.mudanca', active: 'true',
    script: "if (event.parm1 == 'revisao' && String(current.short_description).indexOf('[PT] F11-') == 0) {\n  current.implementation_plan = 'Revisão técnica solicitada: congelar o plano até o parecer do arquiteto de storage.';\n  current.update();\n}" });
  // C2 (assignment_group)
  await upsert('sysrule_assignment', { name: '[PT] F11 Mudanças de rede', table: 'change_request', active: 'true', order: '100', match_conditions: 'ALL',
    condition: `short_description=${S.C2}^category=Network^assignment_groupISEMPTY^EQ`, group: G.NET });
  await CHG('[PT] F11 Grupo de emergência', 'before', 50, sd('C2'), `  current.assignment_group = '${G.SD}';`, "current.type == 'emergency'");
  await CHG('[PT] F11 Grupo para alto risco', 'before', 100, sd('C2'), `  if (current.risk.changes() && current.risk == 2) current.assignment_group = '${G.DB}';`);
  await CHG('[PT] F11 Revisão da justificativa', 'after', 100, sd('C2') + '^justificationVALCHANGES', "  new PTF11Rotinas().revisarMudanca(current.getUniqueValue());");
  // C3 (justification)
  await ua('change_request', '[PT] F11 Justificar por segurança', 'pt_f11_just_seguranca', `current.short_description == '${S.C3}'`, "current.justification = 'Certificado do portal usa SHA-1 e está sendo rejeitado pelos navegadores.';");
  await ua('change_request', '[PT] F11 Justificar por obsolescência', 'pt_f11_just_obsoleto', `current.short_description.toString().indexOf('[PT] F11-2') == 0`, "current.justification = 'Componente fora de suporte.';");
  await CHG('[PT] F11 Justificativa por risco', 'after', 100, sd('C3'), "  if (current.risk.changes() && current.risk == 2) {\n    current.justification = 'Risco alto: o portal de clientes fica fora do ar se o certificado expirar.';\n    current.update();\n  }");
  await CHG('[PT] F11 Log de risco', 'after', 200, sd('C3'), "  if (current.risk.changes()) gs.info('[PT] F11 risco ' + current.number + ': ' + current.justification);");

  // ---------- registros ----------
  const base = {
    problem: { impact: '3', urgency: '3', category: 'software', description: 'inicial' },
    incident: { caller_id: F11.ADMIN, contact_type: 'phone', impact: '3', urgency: '3', category: 'inquiry', description: 'inicial' },
    change_request: { type: 'normal', impact: '3', risk: '3', category: 'Other', description: 'inicial', cab_required: 'false' },
  };
  const recs = {};
  for (const k of Object.keys(S)) {
    const table = F11T[k[0]];
    const r = (await find(table, `short_description=${S[k]}`)) ?? await api('POST', `table/${table}`, { short_description: S[k], ...base[table] });
    recs[k] = { table, sys_id: r.sys_id, number: r.number };
  }

  // ---------- client scripts (formulário clássico) ----------
  const cs = (table, name, field, script) => upsert('sys_script_client', { name, table, active: 'true', type: 'onChange', field, ui_type: '0', script }, `name=${name}^table=${table}`);
  const on = (body) => `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n${body}\n}`;
  await cs('problem', '[PT] F11 Sugere contorno de rede', 'category', on(`  if (g_form.getUniqueValue() != '${recs.P2.sys_id}') return;\n  if (newValue == 'network') g_form.setValue('workaround', 'Verificar a rota até o webservice da SEFAZ e reenviar pelo link secundário.');`));
  await cs('problem', '[PT] F11 Avisa mudança de categoria', 'category', on(`  if (g_form.getValue('short_description').indexOf('[PT] F11-') != 0) return;\n  g_form.showFieldMsg('category', 'Categoria alterada: revise o contorno', 'info');`));
  await cs('incident', '[PT] F11 Grupo para atendimento presencial', 'contact_type', on(`  if (g_form.getUniqueValue() != '${recs.I1.sys_id}') return;\n  if (newValue == 'walk-in') g_form.setValue('assignment_group', '${G.SD}');`));
  await cs('incident', '[PT] F11 Lembra canal de contato', 'contact_type', on(`  if (g_form.getValue('short_description').indexOf('[PT] F11-') != 0) return;\n  g_form.showFieldMsg('contact_type', 'Canal alterado: confirme o contato do solicitante', 'info');`));
  await cs('change_request', '[PT] F11 Plano sugerido para rede', 'category', on(`  if (g_form.getUniqueValue() != '${recs.C1.sys_id}') return;\n  if (newValue == 'Network') g_form.setValue('implementation_plan', 'Janela de rede: replicar os volumes pelo link dedicado de 10G antes do corte.');`));
  await cs('change_request', '[PT] F11 Avisa categoria de mudança', 'category', on(`  if (g_form.getValue('short_description').indexOf('[PT] F11-') != 0) return;\n  g_form.addInfoMessage('Categoria alterada: revise o plano de implementação');`));
  return recs;
}

/** Abre o formulário clássico num iframe oculto e diz quais campos não estão nele. */
async function f11Check(R) {
  const need = { P1: ['assignment_group'], P2: ['category', 'workaround'], P3: ['cause_notes', 'description'], I1: ['contact_type', 'assignment_group'], I2: ['impact', 'description', 'contact_type'], I3: ['category'], C1: ['implementation_plan', 'justification', 'category'], C2: ['assignment_group'], C3: ['justification'] };
  const out = {};
  for (const [k, fields] of Object.entries(need)) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px';
    f.src = `/${R[k].table}.do?sys_id=${R[k].sys_id}`;
    document.body.appendChild(f);
    await new Promise((r) => f.addEventListener('load', r, { once: true }));
    const w = f.contentWindow;
    for (let i = 0; i < 50 && !(w.g_form && w.g_form.getUniqueValue()); i++) await new Promise((r) => setTimeout(r, 200));
    const buttons = [...w.document.querySelectorAll('button[id]')].map((b) => b.id).filter((id) => id.indexOf('pt_f11') == 0);
    out[k] = { missing: fields.filter((x) => !w.g_form.hasField(x)), buttons };
    f.remove();
  }
  return out;
}

/** Salva pelo formulário UI16 real (iframe). action = 'sysverb_update_and_stay' ou o action_name de uma UI action. */
async function f11Form(table, sysId, values, action = 'sysverb_update_and_stay') {
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
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'Atualização [PT] F11'); await new Promise((r) => setTimeout(r, 300)); missing = w.g_form.getMissingFields(); }
  if (missing.length) { f.remove(); throw new Error('obrigatórios: ' + missing.join(',')); }
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, 600));
  f.remove();
}

/** As 5 rodadas. Cada passo espera ≥25 s desde a última gravação observada no mesmo registro e confere o resultado (job e async inclusive). */
async function f11Run(R, log = []) {
  const { api, upsert } = f11api();
  const G = F11.G, U = F11.U, S = F11.SD;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (s) => new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const job = (name, script) => upsert('sysauto_script', { name, active: 'true', run_type: 'once', run_start: at(10), script });
  // workaround é HTML nesta PDI (<p>...</p>): compara sem as tags
  const starts = (f, p) => (r) => String(r[f]).replace(/<[^>]+>/g, '').indexOf(p) == 0;
  const eq = (o) => (r) => Object.entries(o).every(([k, v]) => String(r[k]) == v);
  const steps = [
    // rodada 1
    ['P1', 'job', () => job('[PT] F11 Reclassifica problemas do ERP', `var gr = new GlideRecord('problem');\ngr.addQuery('short_description', '${S.P1}');\ngr.addQuery('category', '!=', 'database');\ngr.query();\nwhile (gr.next()) { gr.setValue('category', 'database'); gr.update(); }`), eq({ category: 'database', assignment_group: G.DB })],
    ['P2', 'api', { workaround: 'Reenviar as notas pelo portal da SEFAZ até a fila normalizar.' }, starts('workaround', 'Reenviar')],
    ['P3', 'api', { assigned_to: U.BETH }, starts('cause_notes', 'Análise')],
    ['I1', 'api', { category: 'hardware' }, eq({ assignment_group: G.HW })],
    ['I2', 'form', { impact: '2', description: 'Usuários do galpão B relatam quedas a cada 5 minutos.' }, eq({ impact: '2' })],
    ['I3', 'api', { assignment_group: G.SW }, eq({ assigned_to: U.BETH })],
    ['C1', 'form', { implementation_plan: '1. Snapshot dos LUNs. 2. Migrar os volumes em lotes de 10.', justification: 'Storage atual sem suporte do fabricante.' }, starts('implementation_plan', '1.')],
    ['C2', 'job', () => job('[PT] F11 Classifica mudanças de rede', `var gr = new GlideRecord('change_request');\ngr.addQuery('short_description', '${S.C2}');\ngr.addQuery('category', '!=', 'Network');\ngr.query();\nwhile (gr.next()) { gr.setValue('category', 'Network'); gr.update(); }`), eq({ category: 'Network', assignment_group: G.NET })],
    ['C3', 'ui', 'pt_f11_just_seguranca', starts('justification', 'Certificado')],
    // rodada 2
    ['P1', 'form', { assignment_group: G.NET }, eq({ assignment_group: G.NET })],
    ['P2', 'form', { category: 'network' }, starts('workaround', 'Verificar')],
    ['P3', 'job', () => job('[PT] F11 Consolida análises do LDAP', `var gr = new GlideRecord('problem');\nif (gr.get('${R.P3.sys_id}') && String(gr.cause_notes).indexOf('Consolidado') != 0) { gr.setValue('cause_notes', 'Consolidado: falhas concentradas no controlador DC02 entre 2h e 4h.'); gr.update(); }`), starts('cause_notes', 'Consolidado')],
    ['I1', 'form', { contact_type: 'walk-in' }, eq({ assignment_group: G.SD })],
    ['I2', 'ui', 'pt_f11_elevar_impacto', eq({ impact: '1' })],
    ['I3', 'api', { assigned_to: U.DAVID }, eq({ assigned_to: U.DAVID })],
    ['C1', 'api', { impact: '2' }, starts('implementation_plan', 'Plano revisado')],
    ['C2', 'form', { assignment_group: G.HW }, eq({ assignment_group: G.HW })],
    ['C3', 'api', { risk: '2' }, starts('justification', 'Risco alto')],
    // rodada 3
    ['P1', 'ui', 'pt_f11_escalar_sw', eq({ assignment_group: G.SW })],
    ['P2', 'api', { urgency: '1' }, starts('workaround', 'Prioridade')],
    ['P3', 'form', { cause_notes: 'Conta de serviço do conector LDAP bloqueada por senha expirada.', description: 'Sincronização falha desde a troca de senha da conta de serviço.' }, starts('cause_notes', 'Conta de serviço')],
    ['I1', 'job', () => job('[PT] F11 Redistribui chamados de loja', `var gr = new GlideRecord('incident');\ngr.addQuery('short_description', '${S.I1}');\ngr.addQuery('assignment_group', '!=', '${G.NET}');\ngr.query();\nwhile (gr.next()) { gr.setValue('assignment_group', '${G.NET}'); gr.update(); }`), eq({ assignment_group: G.NET })],
    ['I2', 'api', { category: 'network' }, eq({ impact: '2' })],
    ['I3', 'ui', 'pt_f11_assumir', eq({ assigned_to: F11.ADMIN })],
    ['C1', 'form', { category: 'Network' }, starts('implementation_plan', 'Janela de rede')],
    ['C2', 'api', { risk: '2' }, eq({ assignment_group: G.DB })],
    ['C3', 'job', () => job('[PT] F11 Revisa justificativas de certificado', `var gr = new GlideRecord('change_request');\nif (gr.get('${R.C3.sys_id}') && String(gr.justification).indexOf('Revisão') != 0) { gr.setValue('justification', 'Revisão trimestral: certificados com menos de 30 dias de validade devem ser trocados.'); gr.update(); }`), starts('justification', 'Revisão trimestral')],
    // rodada 4
    ['P1', 'api', { impact: '1' }, eq({ assignment_group: G.SD })],
    ['P2', 'api', { cause_notes: 'Certificado A1 da SEFAZ vencido no servidor de integração.' }, starts('workaround', 'Renovar')],
    ['P3', 'api', { category: 'network' }, starts('cause_notes', 'Provável')],
    ['I1', 'api', { urgency: '1' }, eq({ assignment_group: G.DB })],
    ['I2', 'form', { contact_type: 'email' }, eq({ impact: '3' })],
    ['I3', 'form', { category: 'software' }, eq({ assigned_to: U.DON })],
    ['C1', 'ui', 'pt_f11_revisao_tecnica', starts('implementation_plan', 'Revisão técnica')],
    ['C2', 'api', { justification: 'Firmware 9.3 corrige vulnerabilidade crítica no plano de controle.' }, eq({ assignment_group: G.SW })],
    ['C3', 'form', { justification: 'Certificado do portal expira em 10 dias; troca aprovada pelo gestor de segurança.' }, starts('justification', 'Certificado do portal expira')],
    // rodada 5
    ['I2', 'api', { urgency: '2' }, eq({ impact: '1' })],
  ];
  const last = {};
  for (const [k, kind, arg, check] of steps) {
    const r = R[k];
    while (last[k] && Date.now() - last[k] < 25000) await sleep(1000);
    const t0 = Date.now();
    try {
      if (kind === 'api') await api('PATCH', `table/${r.table}/${r.sys_id}`, arg);
      else if (kind === 'form') await f11Form(r.table, r.sys_id, arg);
      else if (kind === 'ui') await f11Form(r.table, r.sys_id, {}, arg);
      else if (kind === 'job') await arg();
      let ok = false, cur;
      for (let i = 0; i < 120 && !ok; i++) {
        cur = (await api('GET', `table/${r.table}?sysparm_query=sys_id=${r.sys_id}&sysparm_fields=impact,urgency,priority,category,assignment_group,assigned_to,workaround,cause_notes,implementation_plan,justification,cab_required,risk`))[0];
        cur = Object.fromEntries(Object.entries(cur).map(([f, v]) => [f, v && typeof v === 'object' ? v.value : v]));
        ok = check(cur);
        if (!ok) await sleep(2000);
      }
      last[k] = Date.now();
      log.push(`${new Date().toISOString().slice(11, 19)} ${k} ${kind} ${ok ? 'ok' : 'NAO CONFERIU'} ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) { last[k] = Date.now(); log.push(`${k} ${kind} ERRO ${e.message}`); }
  }
  log.push('FIM');
  return log;
}

async function f11Audit(R) {
  const { api } = f11api();
  const out = {};
  for (const [k, r] of Object.entries(R)) {
    const rows = await api('GET', `table/sys_audit?sysparm_query=documentkey=${r.sys_id}^ORDERBYDESCsys_created_on&sysparm_fields=fieldname,oldvalue,newvalue,user,record_checkpoint,sys_created_on&sysparm_limit=200`);
    out[k] = rows.filter((x) => !['sys_updated_on', 'sys_updated_by', 'sys_mod_count'].includes(x.fieldname)).map((x) => `${x.sys_created_on.slice(11)} cp${x.record_checkpoint} ${x.user} ${x.fieldname}: ${String(x.oldvalue).slice(0, 34)} -> ${String(x.newvalue).slice(0, 44)}`);
  }
  return out;
}
