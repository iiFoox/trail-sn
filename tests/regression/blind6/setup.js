/**
 * Teste às cegas 6 — tabelas ainda pouco testadas: sc_task, sc_req_item, cmdb_ci_computer, cmdb_ci_server e kb_knowledge.
 * Tudo leva o prefixo [PT] F16 (script include PTF16*) e é idempotente (upsert por nome).
 * Escopo: cada regra filtra pelo short_description (tarefas, itens e artigos) ou pelo name (CIs) dos registros [PT] F16,
 * ou checa o prefixo no próprio script.
 *
 * Rodar na aba logada (admin) da PDI, UI16 clássica, colando este arquivo no console:
 *   window.F16S = await f16Setup();            // auditoria das tabelas + artefatos + registros -> { recs, map, audit, auditReport }
 *   window.F16C = await f16Check(F16S);        // (opcional) confere campos e botões nos formulários clássicos
 *   window.F16L = []; await f16Run(F16S, F16L); // 3 rodadas (≥25 s entre gravações do mesmo registro); acompanhar F16L
 *   window.F16A = await f16Audit(F16S);        // sys_audit de todos os registros
 *   await f16Undo(F16S);                       // depois do teste: desliga as auditorias de tabela que o setup ligou
 * As respostas ficam APENAS em tests/regression/blind6/plan.json.
 */
(function () {
const F16 = {
  ADMIN: '6816f79cc0a8016401c5a33be04be441',
  G: { NET: '287ebd7da9fe198100f92cc8d1d2154e', DB: '287ee6fea9fe198100ada7950d0b1b73', HW: '8a5055c9c61122780043563ef53438e3', SD: 'd625dccec0a8016700a222a0f7900d06', SW: '8a4dde73c6112278017a6a4baf547aa7' },
  U: { BETH: '46d44a23a9fe19810012d100cca80666', DAVID: '5137153cc611227c000bbd1bd8cd2007' },
  STAGE: 'u_pt_f16_import',
  MAP: '[PT] F16 Inventário de notebooks',
  // tabelas em que o setup PODE ligar a auditoria da tabela (registro da coleção no sys_dictionary)
  AUDIT_SAFE: ['cmdb_ci_computer', 'cmdb_ci_server', 'kb_knowledge'],
  REQ: '[PT] F16 Pedido de onboarding da filial',
  SD: {
    T1: '[PT] F16-21 Preparar imagem do notebook',
    T2: '[PT] F16-22 Instalar licença do software de desenho',
    T3: '[PT] F16-23 Configurar acesso à pasta financeira',
    T4: '[PT] F16-24 Entregar notebook ao analista',
    R1: '[PT] F16-11 Notebook para novo analista',
    R2: '[PT] F16-12 Licença do software de desenho',
    R3: '[PT] F16-13 Acesso à pasta financeira',
    CC1: '[PT] F16-NB-0101',
    CC2: '[PT] F16-NB-0102',
    CC3: '[PT] F16-NB-0103',
    SV1: '[PT] F16-SRV-ARQ01',
    SV2: '[PT] F16-SRV-ERP02',
    K1: '[PT] F16-41 Como solicitar um notebook',
    K2: '[PT] F16-42 Configurar a VPN no Windows',
    K3: '[PT] F16-43 Política de senhas da empresa',
  },
};
// prefixo da chave -> tabela e campo que identifica o registro
const F16T = (k) => ({ T: 'sc_task', R: 'sc_req_item', CC: 'cmdb_ci_computer', SV: 'cmdb_ci_server', K: 'kb_knowledge' })[k.replace(/\d+$/, '')];
const F16KEY = (table) => (table.indexOf('cmdb_ci') == 0 ? 'name' : 'short_description');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function f16api() {
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
    if (!/^(\[PT\] F16|PTF16)/.test(label)) throw new Error('sem prefixo [PT] F16: ' + label);
    const cur = await find(table, key || `name=${values.name}`);
    return cur ? api('PATCH', `table/${table}/${cur.sys_id}`, values) : api('POST', `table/${table}`, values);
  };
  return { api, find, upsert };
}

/**
 * Auditoria: lê o registro da coleção (element vazio) no sys_dictionary de cada tabela usada.
 * Só LIGA a auditoria nas tabelas de F16.AUDIT_SAFE; nas demais apenas avisa. Também avisa campos com no_audit.
 * Devolve { changes: [{table, sys_id, from, to}], report: [linhas] }. As mudanças ficam também no localStorage
 * (chave pt_f16_audit) para o f16Undo poder desfazer mesmo sem o objeto S.
 */
async function f16AuditSetup(api, find) {
  const used = {
    sc_task: ['assignment_group', 'assigned_to', 'description', 'priority', 'urgency', 'impact'],
    sc_req_item: ['assignment_group', 'description', 'correlation_id', 'urgency', 'impact'],
    cmdb_ci_computer: ['os_version', 'short_description', 'comments', 'serial_number', 'ram'],
    cmdb_ci_server: ['support_group', 'short_description', 'used_for'],
    kb_knowledge: ['meta', 'text', 'valid_to'],
  };
  const changes = [], report = [];
  // cadeia de tabelas (a própria e as superiores), para achar onde o campo é definido
  const chain = async (table) => {
    const out = [];
    let t = await find('sys_db_object', `name=${table}`);
    for (let i = 0; t && i < 8; i++) {
      out.push(t.name);
      const sup = t.super_class && t.super_class.value;
      t = sup ? (await api('GET', `table/sys_db_object/${sup}`)) : null;
    }
    return out;
  };
  for (const [table, fields] of Object.entries(used)) {
    const col = await find('sys_dictionary', `name=${table}^elementISEMPTY`);
    if (!col) { report.push(`${table}: registro da coleção não encontrado`); continue; }
    const on = String(col.audit) === 'true';
    if (on) report.push(`${table}: auditoria da tabela já ligada`);
    else if (F16.AUDIT_SAFE.includes(table)) {
      await api('PATCH', `table/sys_dictionary/${col.sys_id}`, { audit: 'true' });
      changes.push({ table, sys_id: col.sys_id, from: String(col.audit || 'false'), to: 'true' });
      report.push(`${table}: auditoria da tabela LIGADA pelo setup (sys_dictionary ${col.sys_id}, era ${col.audit || 'false'})`);
    } else report.push(`${table}: AVISO auditoria da tabela desligada; o setup não altera esta tabela`);
    const tabs = await chain(table);
    for (const f of fields) {
      let d;
      for (const t of tabs) { d = await find('sys_dictionary', `name=${t}^element=${f}`); if (d) break; }
      if (!d) report.push(`${table}.${f}: AVISO campo não encontrado no dicionário`);
      else if (/no_audit/.test(String(d.attributes || ''))) report.push(`${table}.${f}: AVISO atributo no_audit em ${d.name}`);
    }
  }
  if (changes.length) {
    try {
      const prev = JSON.parse(localStorage.getItem('pt_f16_audit') || '[]');
      const merged = [...prev.filter((p) => !changes.some((c) => c.sys_id === p.sys_id)), ...changes];
      localStorage.setItem('pt_f16_audit', JSON.stringify(merged));
    } catch (e) { /* sem localStorage: fica só no objeto S */ }
  }
  report.forEach((l) => console.info('[PT] F16 auditoria: ' + l));
  return { changes, report };
}

async function f16Setup() {
  const { api, find, upsert } = f16api();
  const S = F16.SD, G = F16.G, U = F16.U;

  // ---------- auditoria das tabelas (antes de qualquer gravação) ----------
  const aud = await f16AuditSetup(api, find);
  // se a sessão já rodou o setup antes, preserva o que foi ligado da primeira vez
  let auditChanges = aud.changes;
  try { const prev = JSON.parse(localStorage.getItem('pt_f16_audit') || '[]'); if (prev.length) auditChanges = prev; } catch (e) { /* ignora */ }

  const wrap = (s) => `(function executeRule(current, previous /*null when async*/) {\n${s}\n})(current, previous);`;
  const br = (table, name, when, order, filter, script, condition = '') => {
    if (name.length > 40) throw new Error('nome de BR com mais de 40 caracteres: ' + name);
    return upsert('sys_script', {
      name, collection: table, active: 'true', when, order: String(order), action_update: 'true', action_insert: 'false',
      advanced: 'true', filter_condition: filter + '^EQ', condition, script: wrap(script),
    }, `name=${name}^collection=${table}`);
  };
  const sd = (k) => `short_description=${S[k]}`;
  const nm = (k) => `name=${S[k]}`;
  const TSK = (...a) => br('sc_task', ...a), RIT = (...a) => br('sc_req_item', ...a), PC = (...a) => br('cmdb_ci_computer', ...a), SRV = (...a) => br('cmdb_ci_server', ...a), KB = (...a) => br('kb_knowledge', ...a);
  const ua = (table, name, action_name, condition, script) => upsert('sys_ui_action', { name, table, action_name, active: 'true', form_button: 'true', client: 'false', condition, script: script + '\ncurrent.update();\naction.setRedirectURL(current);' }, `action_name=${action_name}^table=${table}`);
  const rule = (table, name, condition, group) => upsert('sysrule_assignment', { name, table, active: 'true', order: '100', match_conditions: 'ALL', condition: condition + '^EQ', group }, `name=${name}^table=${table}`);

  // ---------- script include ----------
  await upsert('sys_script_include', { name: 'PTF16Rotinas', description: '[PT] F16 rotinas de catálogo, CMDB e conhecimento', api_name: 'global.PTF16Rotinas', active: 'true', access: 'public', client_callable: 'false',
    script: `var PTF16Rotinas = Class.create();
PTF16Rotinas.prototype = {
  initialize: function() {},
  _escopo: function(gr, campo) { return String(gr.getValue(campo || 'short_description')).indexOf('[PT] F16') == 0; },
  // tarefas de catálogo: responsável padrão quando o grupo é definido e ninguém foi designado
  designarResponsavel: function(sysId) {
    var gr = new GlideRecord('sc_task');
    if (!gr.get(sysId) || !this._escopo(gr) || !gr.assigned_to.nil()) return;
    gr.assigned_to = '${U.BETH}';
    gr.update();
  },
  // não usado hoje: devolve a tarefa para a fila
  liberarResponsavel: function(sysId) {
    var gr = new GlideRecord('sc_task');
    if (gr.get(sysId) && this._escopo(gr)) { gr.assigned_to = ''; gr.update(); }
  },
  // não usado hoje: termo de responsabilidade do item
  gerarTermo: function(sysId) {
    var gr = new GlideRecord('sc_req_item');
    if (gr.get(sysId) && this._escopo(gr)) { gr.description = 'Termo de responsabilidade gerado automaticamente.'; gr.update(); }
  },
  // servidores de produção: grupo de suporte de banco de dados
  definirSuporte: function(sysId) {
    var gr = new GlideRecord('cmdb_ci_server');
    if (!gr.get(sysId) || !this._escopo(gr, 'name')) return;
    if (gr.used_for == 'Production') { gr.support_group = '${G.DB}'; gr.update(); }
  },
  // não usado hoje: tira o grupo de suporte do servidor
  liberarSuporte: function(sysId) {
    var gr = new GlideRecord('cmdb_ci_server');
    if (gr.get(sysId) && this._escopo(gr, 'name')) { gr.support_group = ''; gr.update(); }
  },
  // artigos: texto revisado pela equipe técnica quando a validade muda
  revisarArtigo: function(sysId) {
    var gr = new GlideRecord('kb_knowledge');
    if (!gr.get(sysId) || !this._escopo(gr)) return;
    gr.text = '<p>Revisão técnica: instale o FortiClient 7.2, importe o perfil corporativo e autentique com o MFA.</p>';
    gr.update();
  },
  // não usado hoje: palavras-chave automáticas
  sugerirPalavras: function(sysId) {
    var gr = new GlideRecord('kb_knowledge');
    if (gr.get(sysId) && this._escopo(gr)) { gr.meta = 'sugestão automática'; gr.update(); }
  },
  type: 'PTF16Rotinas'
};` }, 'api_name=global.PTF16Rotinas');

  // ---------- sc_task ----------
  // T1 (assignment_group)
  await rule('sc_task', '[PT] F16 Imagem de notebook urgente', `${sd('T1')}^urgency=1^assignment_groupISEMPTY`, G.HW);
  await rule('sc_task', '[PT] F16 Imagem de notebook comum', `${sd('T1')}^urgency=2^assignment_groupISEMPTY`, G.SW);
  await TSK('[PT] F16 Grupo de tarefas críticas', 'before', 100, sd('T1'), `  if (current.impact != 1) return;\n  current.assignment_group = '${G.DB}';`);
  await ua('sc_task', '[PT] F16 Encaminhar para redes', 'pt_f16_encaminhar_redes', `current.short_description == '${S.T1}'`, `current.assignment_group = '${G.NET}';`);
  // T2 (description)
  await TSK('[PT] F16 Instruções da licença', 'async', 100, sd('T2') + '^impactVALCHANGES', "  current.description = 'Instalar a licença de rede do software de desenho e registrar o número do ativo.';\n  current.update();");
  await TSK('[PT] F16 Registra descrição da tarefa', 'after', 100, sd('T2'), "  if (current.description.changes()) gs.info('[PT] F16 tarefa ' + current.number + ': ' + current.description);");
  // T3 (assigned_to)
  await TSK('[PT] F16 Responsável do acesso', 'after', 100, sd('T3') + '^assignment_groupVALCHANGES', '  new PTF16Rotinas().designarResponsavel(current.getUniqueValue());');
  await TSK('[PT] F16 Responsável de urgência', 'before', 100, sd('T3'), `  current.assigned_to = '${U.DAVID}';`, 'current.urgency == 1');
  // T4: só client scripts e UI policy (abaixo)

  // ---------- sc_req_item ----------
  // R1 (description)
  await RIT('[PT] F16 Especificação do notebook', 'before', 100, sd('R1'), "  if (current.urgency.changes() && current.urgency == 2)\n    current.description = 'Notebook padrão: 16 GB de RAM, SSD de 512 GB, Windows 11 corporativo.';");
  await RIT('[PT] F16 Especificação executiva', 'before', 200, sd('R1'), "  current.description = 'Notebook executivo: 32 GB de RAM, tela de 14 polegadas.';", 'current.urgency == 1');
  await ua('sc_req_item', '[PT] F16 Padronizar especificação', 'pt_f16_padronizar_espec', `current.short_description == '${S.R1}'`, "current.description = 'Especificação padrão do catálogo: modelo corporativo 2026.';");
  await ua('sc_req_item', '[PT] F16 Limpar especificação', 'pt_f16_limpar_espec', `current.short_description == '${S.R1}' && current.quantity > 5`, "current.description = '';");
  // R2 (correlation_id)
  await RIT('[PT] F16 Código da licença', 'before', 100, sd('R2'), "  if (current.assignment_group.changes() && !current.assignment_group.nil())\n    current.correlation_id = 'LIC-SW-2026';");
  // R3 (description)
  await RIT('[PT] F16 Termo de acesso financeiro', 'after', 100, sd('R3'), "  if (current.impact.changes() && current.impact == 2) {\n    current.description = 'Termo de acesso: leitura na pasta Financeiro/Fechamento, aprovado pela controladoria.';\n    current.update();\n  }");
  await RIT('[PT] F16 Termo de acesso urgente', 'before', 100, sd('R3'), "  current.description = 'Acesso emergencial: revogar em 24 horas.';", 'current.impact == 1');

  // ---------- cmdb_ci_computer ----------
  // CC1 (short_description): só a isca de BR aqui; o resto é client script
  await PC('[PT] F16 Descrição de legado', 'before', 100, nm('CC1'), "  current.short_description = 'Equipamento legado: agendar substituição.';", "current.os_version.toString().indexOf('6.1') == 0");
  // CC2 (comments)
  await PC('[PT] F16 Nota de memória ampliada', 'before', 100, nm('CC2'), "  if (current.ram.changes() && current.ram >= 16384)\n    current.comments = 'Memória ampliada para 16 GB pelo laboratório de hardware.';");
  await PC('[PT] F16 Nota de memória insuficiente', 'before', 200, nm('CC2'), "  current.comments = 'Memória insuficiente para a imagem corporativa.';", 'current.ram < 4096');
  await ua('cmdb_ci_computer', '[PT] F16 Marcar para recolhimento', 'pt_f16_recolhimento', `current.name == '${S.CC2}'`, "current.comments = 'Recolher ao estoque: notebook substituído no onboarding.';");
  await ua('cmdb_ci_computer', '[PT] F16 Liberar do recolhimento', 'pt_f16_liberar_recolhimento', `current.name == '${S.CC2}' && current.comments.toString().indexOf('Recolher') == 0 && current.install_status == 7`, "current.comments = 'Liberado para uso.';");
  // CC3 (importação + reações)
  await PC('[PT] F16 Descrição pós-inventário', 'after', 100, nm('CC3'), "  if (current.os_version.changes()) {\n    current.short_description = 'Inventário: Windows 11 ' + current.os_version + ' confirmado pelo agente.';\n    current.update();\n  }");
  await PC('[PT] F16 Serial do fabricante', 'before', 100, nm('CC3'), "  current.serial_number = 'FAB-' + current.serial_number;", 'current.manufacturer.nil() == false');

  // ---------- cmdb_ci_server ----------
  await SRV('[PT] F16 Suporte do servidor', 'after', 100, nm('SV1') + '^used_forVALCHANGES', '  new PTF16Rotinas().definirSuporte(current.getUniqueValue());');
  await SRV('[PT] F16 Suporte de contingência', 'before', 100, nm('SV1'), `  current.support_group = '${G.NET}';`, "current.used_for == 'Disaster recovery'");

  // ---------- kb_knowledge ----------
  // K1 (meta)
  await KB('[PT] F16 Palavras-chave de validade', 'before', 100, sd('K1'), "  if (current.valid_to.changes())\n    current.meta = 'notebook, solicitação, catálogo de serviços, validade 2027';");
  await KB('[PT] F16 Palavras-chave do wiki', 'before', 200, sd('K1'), "  current.meta = 'wiki, legado';", "current.article_type == 'wiki'");
  await ua('kb_knowledge', '[PT] F16 Revisar palavras-chave', 'pt_f16_revisar_palavras', `current.short_description == '${S.K1}'`, "current.meta = 'Revisado: notebook, onboarding, catálogo';");
  // K2 (text)
  await KB('[PT] F16 Aviso de VPN no artigo', 'after', 100, sd('K2'), "  if (current.meta.changes() && current.meta.toString().indexOf('forticlient') > -1) {\n    current.text = '<p>Use o FortiClient: baixe o instalador no portal e informe o servidor vpn.empresa.com.br.</p>';\n    current.update();\n  }");
  await KB('[PT] F16 Aviso de AnyConnect', 'after', 200, sd('K2'), "  if (current.meta.changes() && current.meta.toString().indexOf('anyconnect') > -1) {\n    current.text = '<p>Use o Cisco AnyConnect.</p>';\n    current.update();\n  }");
  await KB('[PT] F16 Revisão técnica do artigo', 'after', 300, sd('K2') + '^valid_toVALCHANGES', '  new PTF16Rotinas().revisarArtigo(current.getUniqueValue());');
  await KB('[PT] F16 Registra texto do artigo', 'after', 400, 'short_descriptionSTARTSWITH[PT] F16-4', "  if (current.text.changes()) gs.info('[PT] F16 artigo ' + current.number + ' alterado');");
  // K3 (meta/valid_to): isca assíncrona com condição falsa
  await KB('[PT] F16 Texto da política assíncrono', 'async', 100, sd('K3') + '^metaVALCHANGES', "  current.text = '<p>Política reescrita automaticamente.</p>';\n  current.update();", "current.article_type == 'wiki'");

  // ---------- client scripts (formulário clássico; checam o short_description / name) ----------
  const cs = (table, name, field, script) => upsert('sys_script_client', { name, table, active: 'true', type: 'onChange', field, ui_type: '0', script }, `name=${name}^table=${table}`);
  const on = (body) => `function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n${body}\n}`;
  await cs('sc_task', '[PT] F16 Roteiro de entrega urgente', 'priority', on(`  if (g_form.getValue('short_description') != '${S.T4}') return;\n  if (newValue == '1') g_form.setValue('description', 'Entrega urgente: levar o notebook à mesa do analista hoje e colher a assinatura do termo.');`));
  await cs('sc_task', '[PT] F16 Roteiro de entrega planejada', 'priority', on(`  if (g_form.getValue('short_description').indexOf('[PT] F16-2') != 0) return;\n  if (newValue == '4') g_form.setValue('description', 'Entrega planejada: agendar com o gestor.');`));
  await cs('sc_task', '[PT] F16 Avisa prioridade da tarefa', 'priority', on(`  if (g_form.getValue('short_description').indexOf('[PT] F16') != 0) return;\n  g_form.showFieldMsg('priority', 'Prioridade alterada: confira o prazo de entrega', 'info');`));
  await cs('cmdb_ci_computer', '[PT] F16 Descrição pela versão do SO', 'os_version', on(`  if (g_form.getValue('name') != '${S.CC1}') return;\n  if (newValue.indexOf('10.0.22') == 0) g_form.setValue('short_description', 'Notebook com Windows 11 23H2: imagem corporativa padrão aplicada.');`));
  await cs('cmdb_ci_computer', '[PT] F16 Descrição para Windows 10', 'os_version', on(`  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  if (newValue.indexOf('10.0.19') == 0) g_form.setValue('short_description', 'Notebook com Windows 10: migrar até o fim do suporte.');`));
  await cs('cmdb_ci_computer', '[PT] F16 Lembra versão do SO', 'os_version', on(`  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  g_form.showFieldMsg('os_version', 'Versão alterada: confira o inventário do agente', 'info');`));

  // ---------- UI policies ----------
  // Scripts do ramo "senão" rodam em todo formulário da tabela onde a condição é falsa: checam o prefixo [PT] F16.
  const pol = async (name, table, conditions, extra) => upsert('sys_ui_policy', { short_description: name, table, active: 'true', on_load: 'true', reverse_if_false: 'false', global: 'true', ui_type: '0', order: '100', run_scripts: 'false', ...extra,
    conditions: conditions + '^EQ' }, `short_description=${name}^table=${table}`);
  const polAction = async (p, table, field) => { if (!(await find('sys_ui_policy_action', `ui_policy=${p.sys_id}^field=${field}`))) await api('POST', 'table/sys_ui_policy_action', { ui_policy: p.sys_id, table, field, mandatory: 'true', visible: 'ignore', disabled: 'ignore' }); };
  const pTask = await pol('[PT] F16 Tarefa urgente exige descrição', 'sc_task', 'short_descriptionSTARTSWITH[PT] F16-2^priority=1', {});
  await polAction(pTask, 'sc_task', 'description');
  await pol('[PT] F16 Produção pede janela', 'cmdb_ci_server', `${nm('SV2')}^used_for=Production`, { run_scripts: 'true',
    script_true: "function onCondition() {\n  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  g_form.setValue('short_description', 'Servidor de produção: mudanças só na janela de sábado, 22h.');\n}", script_false: 'function onCondition() {\n}' });
  await pol('[PT] F16 Desenvolvimento libera mudanças', 'cmdb_ci_server', 'nameSTARTSWITH[PT] F16-SRV^used_for=Development', { run_scripts: 'true',
    script_true: "function onCondition() {\n  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  g_form.setValue('short_description', 'Servidor de desenvolvimento: mudanças livres.');\n}", script_false: 'function onCondition() {\n}' });
  const pSrv = await pol('[PT] F16 Produção exige descrição', 'cmdb_ci_server', 'nameSTARTSWITH[PT] F16-SRV^used_for=Production', { order: '200' });
  await polAction(pSrv, 'cmdb_ci_server', 'short_description');
  await pol('[PT] F16 SO legado registra aviso', 'cmdb_ci_computer', 'nameSTARTSWITH[PT] F16-NB^os_versionSTARTSWITH6.1', { run_scripts: 'true', reverse_if_false: 'true',
    script_true: "function onCondition() {\n  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  g_form.setValue('comments', 'Sistema operacional legado.');\n}",
    script_false: "function onCondition() {\n  if (g_form.getValue('name').indexOf('[PT] F16') != 0) return;\n  // só lê: mensagem informativa, não grava nada\n  g_form.showFieldMsg('os_version', 'Versão suportada pela imagem corporativa', 'info');\n}" });
  const pKb = await pol('[PT] F16 Artigo sem validade exige palavras', 'kb_knowledge', 'short_descriptionSTARTSWITH[PT] F16-4^valid_toISEMPTY', {});
  await polAction(pKb, 'kb_knowledge', 'meta');

  // ---------- importação para o CMDB (tabela de staging + transform map com coalesce no name) ----------
  const base = await find('sys_db_object', 'name=sys_import_set_row');
  let stage = await find('sys_db_object', `name=${F16.STAGE}`);
  if (!stage) stage = await api('POST', 'table/sys_db_object', { name: F16.STAGE, label: '[PT] F16 inventário de notebooks', super_class: base.sys_id, create_access_controls: 'false' });
  for (const [el, label] of Object.entries({ u_nome: 'Nome', u_serial: 'Serial', u_versao_so: 'Versão do SO', u_lote: 'Lote' })) {
    if (!(await find('sys_dictionary', `name=${F16.STAGE}^element=${el}`))) await api('POST', 'table/sys_dictionary', { name: F16.STAGE, element: el, column_label: label, internal_type: 'string', max_length: '200', active: 'true' });
  }
  const map = await upsert('sys_transform_map', { name: F16.MAP, source_table: F16.STAGE, target_table: 'cmdb_ci_computer', active: 'true', run_business_rules: 'true', enforce_mandatory_fields: 'no', order: '100', run_script: 'false', script: '' });
  const entry = async (src, tgt, extra = {}) => {
    const cur = await find('sys_transform_entry', `map=${map.sys_id}^target_field=${tgt}`);
    const v = { map: map.sys_id, source_table: F16.STAGE, source_field: src, target_table: 'cmdb_ci_computer', target_field: tgt, ...extra };
    return cur ? api('PATCH', `table/sys_transform_entry/${cur.sys_id}`, v) : api('POST', 'table/sys_transform_entry', v);
  };
  await entry('u_nome', 'name', { coalesce: 'true' });
  await entry('u_serial', 'serial_number');
  await entry('u_versao_so', 'os_version');
  const ts = await find('sys_transform_script', `map=${map.sys_id}^when=onBefore`);
  // só atualiza CIs [PT] F16 já existentes: nunca insere
  const tsv = { map: map.sys_id, when: 'onBefore', active: 'true', order: '100', script: "(function runTransformScript(source, map, log, target /*undefined onStart*/ ) {\n  if (String(source.u_nome).indexOf('[PT] F16') != 0 || action == 'insert') { ignore = true; return; }\n  target.comments = 'Inventariado pelo agente, lote ' + source.u_lote;\n})(source, map, log, target);" };
  ts ? await api('PATCH', `table/sys_transform_script/${ts.sys_id}`, tsv) : await api('POST', 'table/sys_transform_script', tsv);

  // ---------- registros ----------
  let kbBase = await find('kb_knowledge_base', 'active=true^title=IT');
  if (!kbBase) kbBase = await find('kb_knowledge_base', 'active=true');
  if (!kbBase) throw new Error('nenhuma base de conhecimento ativa');
  const req = (await find('sc_request', `short_description=${F16.REQ}`)) ?? await api('POST', 'table/sc_request', { short_description: F16.REQ, requested_for: F16.ADMIN, opened_by: F16.ADMIN, approval: 'approved', description: 'Pedido de equipamentos e acessos para o novo analista.' });
  const taskBase = { impact: '3', urgency: '3', description: 'inicial' };
  const base16 = {
    R1: { request: req.sys_id, ...taskBase, quantity: '1' }, R2: { request: req.sys_id, ...taskBase }, R3: { request: req.sys_id, ...taskBase },
    T1: { ...taskBase }, T2: { ...taskBase }, T3: { ...taskBase }, T4: { ...taskBase, priority: '4' },
    CC1: { os_version: '10.0.19045', ram: '8192', serial_number: 'SN-PT16-0101', short_description: 'inicial', comments: 'inicial' },
    CC2: { os_version: '10.0.22631', ram: '8192', serial_number: 'SN-PT16-0102', short_description: 'inicial', comments: 'inicial' },
    CC3: { os_version: '10.0.19045', ram: '16384', serial_number: 'SN-PT16-0103', short_description: 'inicial', comments: 'inicial' },
    SV1: { used_for: 'Development', os_version: '2022', short_description: 'inicial', comments: 'inicial' },
    SV2: { used_for: 'Test', os_version: '2019', short_description: 'inicial', comments: 'inicial' },
    K1: { kb_knowledge_base: kbBase.sys_id, workflow_state: 'draft', article_type: 'text', text: '<p>inicial</p>', meta: 'inicial', valid_to: '2026-12-31' },
    K2: { kb_knowledge_base: kbBase.sys_id, workflow_state: 'draft', article_type: 'text', text: '<p>inicial</p>', meta: 'inicial', valid_to: '2026-12-31' },
    K3: { kb_knowledge_base: kbBase.sys_id, workflow_state: 'draft', article_type: 'text', text: '<p>inicial</p>', meta: 'inicial', valid_to: '2026-12-31' },
  };
  const recs = {};
  // itens antes das tarefas (as tarefas apontam para o item)
  for (const k of ['R1', 'R2', 'R3', 'T1', 'T2', 'T3', 'T4', 'CC1', 'CC2', 'CC3', 'SV1', 'SV2', 'K1', 'K2', 'K3']) {
    const table = F16T(k), kf = F16KEY(table);
    const extra = { T1: { request_item: recs.R1 && recs.R1.sys_id }, T4: { request_item: recs.R1 && recs.R1.sys_id }, T2: { request_item: recs.R2 && recs.R2.sys_id }, T3: { request_item: recs.R3 && recs.R3.sys_id } }[k] || {};
    const r = (await find(table, `${kf}=${S[k]}`)) ?? await api('POST', `table/${table}`, { [kf]: S[k], ...base16[k], ...extra });
    recs[k] = { table, sys_id: r.sys_id, number: r.number || r.name };
  }
  return { recs, map: map.sys_id, request: req.sys_id, kbBase: kbBase.sys_id, audit: auditChanges, auditReport: aud.report };
}

/** Abre o formulário clássico num iframe oculto e diz quais campos/botões faltam. */
async function f16Check(S) {
  const R = S.recs;
  const need = {
    T1: [['assignment_group'], ['pt_f16_encaminhar_redes']], T4: [['priority', 'description'], []], R1: [['description'], ['pt_f16_padronizar_espec']],
    CC1: [['os_version', 'short_description'], []], CC2: [['comments'], ['pt_f16_recolhimento']], SV2: [['used_for', 'short_description'], []],
    K1: [['meta'], ['pt_f16_revisar_palavras']],
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
async function f16Form(table, sysId, values, action = 'sysverb_update_and_stay') {
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
  if (missing.includes('work_notes')) { w.g_form.setValue('work_notes', 'Atualização [PT] F16'); await sleep(300); missing = w.g_form.getMissingFields(); }
  if (missing.length) { f.remove(); throw new Error('obrigatórios: ' + missing.join(',')); }
  const done = new Promise((r) => f.addEventListener('load', r, { once: true }));
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  await Promise.race([done, sleep(15000)]);
  await sleep(600);
  f.remove();
}

/** Três rodadas. Cada passo espera ≥25 s desde a última gravação conferida no mesmo registro e confere o resultado (job e async inclusive). */
async function f16Run(S, log = []) {
  const { api, upsert } = f16api();
  const R = S.recs, G = F16.G, U = F16.U, SD = F16.SD;
  const at = (s) => new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const job = (name, script) => upsert('sysauto_script', { name, active: 'true', run_type: 'once', run_start: at(10), script });
  // job run once: grava um campo de UM registro [PT] F16 (gr.get pelo sys_id), só se ainda não tiver o valor
  const jobOne = (k, field, value) => {
    const r = R[k], kf = F16KEY(r.table);
    return `var gr = new GlideRecord('${r.table}');\nif (gr.get('${r.sys_id}') && String(gr.getValue('${kf}')).indexOf('[PT] F16') == 0 && String(gr.getValue('${field}')).replace(/<[^>]+>/g, '') != '${value}') {\n  gr.setValue('${field}', '${value}');\n  gr.update();\n}`;
  };
  // campos HTML (text do artigo) voltam com <p>: compara sem as tags
  const plain = (v) => String(v).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const starts = (f, p) => (r) => plain(r[f]).indexOf(p) == 0;
  const has = (f, p) => (r) => plain(r[f]).indexOf(p) > -1;
  const eq = (o) => (r) => Object.entries(o).every(([k, v]) => String(r[k]) == v);
  const all = (...fs) => (r) => fs.every((fn) => fn(r));
  const imp = async (row) => { const r = await api('POST', `import/${F16.STAGE}`, row); return JSON.stringify(r).slice(0, 140); };
  const batch = async (k, body) => {
    const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    const req = { batch_request_id: 'pt-f16-' + Date.now(), rest_requests: [{ id: '1', exclude_response_headers: true, method: 'PATCH', url: `/api/now/table/${R[k].table}/${R[k].sys_id}`,
      headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Accept', value: 'application/json' }], body: enc(body) }] };
    const b = await fetch('/api/now/v1/batch', { method: 'POST', headers: { 'X-UserToken': window.g_ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
    const t = await b.text();
    if (!b.ok) throw new Error('batch ' + b.status + ' ' + t.slice(0, 200));
    return 'batch ' + b.status;
  };
  const steps = [
    // ---------- rodada 1 ----------
    ['T1', 'api', { urgency: '1' }, eq({ assignment_group: G.HW })],
    ['T2', 'api', { impact: '2' }, starts('description', 'Instalar a licença')],
    ['T3', 'api', { assignment_group: G.SD }, eq({ assigned_to: U.BETH })],
    ['T4', 'form', { priority: '1' }, starts('description', 'Entrega urgente')],
    ['R1', 'api', { urgency: '2' }, starts('description', 'Notebook padrão')],
    ['R2', 'batch', { assignment_group: G.SW }, eq({ assignment_group: G.SW, correlation_id: 'LIC-SW-2026' })],
    ['R3', 'api', { impact: '2' }, starts('description', 'Termo de acesso')],
    ['CC1', 'form', { os_version: '10.0.22631' }, all(eq({ os_version: '10.0.22631' }), starts('short_description', 'Notebook com Windows 11'))],
    ['CC2', 'api', { ram: '16384' }, starts('comments', 'Memória ampliada')],
    ['CC3', 'import', { u_nome: SD.CC3, u_serial: 'SN-PT16-A1', u_versao_so: '10.0.22631', u_lote: 'L1' },
      all(eq({ serial_number: 'SN-PT16-A1', os_version: '10.0.22631' }), starts('short_description', 'Inventário'), has('comments', 'lote L1'))],
    ['SV1', 'api', { used_for: 'Production' }, eq({ used_for: 'Production', support_group: G.DB })],
    ['SV2', 'form', { used_for: 'Production' }, all(eq({ used_for: 'Production' }), starts('short_description', 'Servidor de produção'))],
    ['K1', 'form', { meta: 'notebook, solicitação, catálogo de serviços' }, starts('meta', 'notebook, solicitação')],
    ['K2', 'api', { meta: 'vpn, windows, forticlient' }, starts('text', 'Use o FortiClient')],
    ['K3', 'batch', { meta: 'senha, política, MFA, expiração' }, starts('meta', 'senha, política')],
    // ---------- rodada 2 ----------
    ['T1', 'form', { assignment_group: G.SD }, eq({ assignment_group: G.SD })],
    ['T2', 'job', () => job('[PT] F16 Revisa instruções de licença', jobOne('T2', 'description', 'Revisado: licença migrada para o servidor de licenças em nuvem.')), starts('description', 'Revisado')],
    ['T3', 'batch', { assigned_to: U.DAVID }, eq({ assigned_to: U.DAVID })],
    ['R1', 'ui', 'pt_f16_padronizar_espec', starts('description', 'Especificação padrão')],
    ['R2', 'job', () => job('[PT] F16 Renova códigos de licença', jobOne('R2', 'correlation_id', 'LIC-RENOVADA-2027')), eq({ correlation_id: 'LIC-RENOVADA-2027' })],
    ['CC2', 'ui', 'pt_f16_recolhimento', starts('comments', 'Recolher')],
    ['CC3', 'api', { serial_number: 'SN-PT16-A1-CORR' }, eq({ serial_number: 'SN-PT16-A1-CORR' })],
    ['SV1', 'job', () => job('[PT] F16 Realinha suporte de servidores', jobOne('SV1', 'support_group', G.NET)), eq({ support_group: G.NET })],
    ['K1', 'api', { valid_to: '2027-06-30' }, has('meta', 'validade 2027')],
    ['K2', 'api', { valid_to: '2027-06-30' }, starts('text', 'Revisão técnica')],
    ['K3', 'job', () => job('[PT] F16 Renova validade das políticas', jobOne('K3', 'valid_to', '2028-12-31')), eq({ valid_to: '2028-12-31' })],
    // ---------- rodada 3 ----------
    ['T1', 'ui', 'pt_f16_encaminhar_redes', eq({ assignment_group: G.NET })],
    ['R1', 'api', { description: 'Ajuste do solicitante: incluir dock station e segundo monitor.' }, starts('description', 'Ajuste do solicitante')],
    ['CC3', 'import', { u_nome: SD.CC3, u_serial: 'SN-PT16-B7', u_versao_so: '10.0.22631', u_lote: 'L2' }, all(eq({ serial_number: 'SN-PT16-B7' }), has('comments', 'lote L2'))],
    ['K1', 'ui', 'pt_f16_revisar_palavras', starts('meta', 'Revisado')],
  ];
  const fieldsBy = {
    sc_task: 'urgency,impact,priority,assignment_group,assigned_to,description',
    sc_req_item: 'urgency,impact,assignment_group,description,correlation_id',
    cmdb_ci_computer: 'name,os_version,ram,serial_number,short_description,comments',
    cmdb_ci_server: 'name,used_for,support_group,short_description,comments',
    kb_knowledge: 'meta,text,valid_to',
  };
  const last = {};
  const t00 = Date.now();
  for (const [k, kind, arg, check] of steps) {
    const r = R[k];
    while (last[k] && Date.now() - last[k] < 25000) await sleep(1000);
    const t0 = Date.now();
    let extraInfo = '';
    try {
      if (kind === 'api') await api('PATCH', `table/${r.table}/${r.sys_id}`, arg);
      else if (kind === 'form') await f16Form(r.table, r.sys_id, arg);
      else if (kind === 'ui') await f16Form(r.table, r.sys_id, {}, arg);
      else if (kind === 'job') await arg();
      else if (kind === 'import') extraInfo = await imp(arg);
      else if (kind === 'batch') extraInfo = await batch(k, arg);
      let ok = false, cur;
      for (let i = 0; i < 120 && !ok; i++) {
        cur = (await api('GET', `table/${r.table}?sysparm_query=sys_id=${r.sys_id}&sysparm_fields=${fieldsBy[r.table]}`))[0];
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
async function f16Audit(S) {
  const { api } = f16api();
  const R = S.recs;
  const ids = Object.values(R).map((r) => r.sys_id).join(',');
  const rows = await api('GET', `table/sys_audit?sysparm_limit=2000&sysparm_fields=documentkey,tablename,fieldname,oldvalue,newvalue,user,record_checkpoint,sys_created_on&sysparm_query=documentkeyIN${ids}^ORDERBYsys_created_on`);
  return rows.filter((x) => !['sys_updated_on', 'sys_updated_by', 'sys_mod_count'].includes(x.fieldname)).map((x) => {
    const key = (Object.entries(R).find(([, r]) => r.sys_id === x.documentkey) || ['?'])[0];
    return `${x.sys_created_on} ${key} cp${x.record_checkpoint} ${x.fieldname} ${x.user} ${String(x.oldvalue).slice(0, 40)} -> ${String(x.newvalue).slice(0, 60)}`.replace(/[=&?]/g, '_');
  });
}

/** Desfaz o que o setup ligou de auditoria (só registros de coleção das tabelas de F16.AUDIT_SAFE). */
async function f16Undo(S) {
  const { api } = f16api();
  let list = (S && S.audit) || [];
  if (!list.length) { try { list = JSON.parse(localStorage.getItem('pt_f16_audit') || '[]'); } catch (e) { list = []; } }
  const out = [];
  for (const c of list) {
    if (!F16.AUDIT_SAFE.includes(c.table)) { out.push(`${c.table}: ignorado (fora da lista segura)`); continue; }
    const cur = await api('GET', `table/sys_dictionary/${c.sys_id}?sysparm_fields=name,element,audit`);
    if (cur.name !== c.table || cur.element) { out.push(`${c.table}: ignorado (registro ${c.sys_id} não é a coleção da tabela)`); continue; }
    await api('PATCH', `table/sys_dictionary/${c.sys_id}`, { audit: c.from === 'true' ? 'true' : 'false' });
    out.push(`${c.table}: auditoria da tabela voltou para ${c.from === 'true' ? 'true' : 'false'}`);
  }
  try { localStorage.removeItem('pt_f16_audit'); } catch (e) { /* ignora */ }
  if (!list.length) out.push('nada a desfazer: o setup não ligou nenhuma auditoria');
  return out.map((l) => l.replace(/[=&?]/g, '_'));
}

Object.assign(window, { F16, f16Setup, f16Check, f16Form, f16Run, f16Audit, f16Undo });
})();
