/**
 * Bateria da Fase 1, criada pela Table API a partir de uma aba logada (admin) da PDI.
 * Substitui pdi-setup-fase1.js (que exigia Scripts - Background). Tudo que cria leva o prefixo [PT] F1
 * para ser encontrado e removido depois. Idempotente: procura pelo nome antes de criar.
 *
 * Uso: colar no console da aba (ou via ferramenta) e chamar `await trailSetupF1()`.
 * As ações de formulário (salvar pelo UI16) são feitas à parte, para gerar transações de formulário reais.
 */
async function trailSetupF1() {
  const ck = window.g_ck;
  if (!ck) throw new Error('g_ck ausente: abra uma página UI16 da instância');
  const api = async (method, path, body) => {
    const r = await fetch('/api/now/' + path, {
      method, headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    return j.result;
  };
  const find = async (table, q) => (await api('GET', `table/${table}?sysparm_limit=1&sysparm_query=${encodeURIComponent(q)}`))[0];
  const upsert = async (table, key, values) => (await find(table, `${key}=${values[key]}`)) ?? api('POST', `table/${table}`, values);
  const out = {};

  // F1-ASSIGN: grupo e regra de atribuição
  const grp = await upsert('sys_user_group', 'name', { name: '[PT] Rede', description: 'Grupo da perícia (Fase 1)' });
  await upsert('sysrule_assignment', 'name', { name: '[PT] F1 atribui rede', table: 'incident', active: 'true', order: '100', condition: 'category=network^assignment_groupISEMPTY^short_descriptionSTARTSWITH[PT] F1-ASSIGN', group: grp.sys_id });

  // F1-SEQ: duas automações em sequência no mesmo campo
  const seqCond = 'short_descriptionSTARTSWITH[PT] F1-SEQ^EQ';
  await upsert('sys_script', 'name', { name: '[PT] F1 before impacto 2', collection: 'incident', active: 'true', when: 'before', order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: seqCond,
    script: '(function executeRule(current, previous) {\n  if (current.impact == 3) current.impact = 2; // primeira automação\n})(current, previous);' });
  await upsert('sys_script', 'name', { name: '[PT] F1 async impacto 1', collection: 'incident', active: 'true', when: 'async', order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: seqCond,
    script: '(function executeRule(current, previous) {\n  var gr = new GlideRecord("incident");\n  if (gr.get(current.sys_id) && gr.impact == 2) { gr.impact = 1; gr.update(); } // segunda automação\n})(current, previous);' });

  // F1-OTHER: outra tabela (problem), BR before
  await upsert('sys_script', 'name', { name: '[PT] F1 problem before impacto', collection: 'problem', active: 'true', when: 'before', order: '100', action_update: 'true', action_insert: 'false', advanced: 'true', filter_condition: 'short_descriptionSTARTSWITH[PT] F1-OTHER^EQ',
    script: '(function executeRule(current, previous) {\n  if (current.impact == 3) current.impact = 1;\n})(current, previous);' });

  // F1-CLIENT: client script que muda a urgência no navegador antes de salvar
  await upsert('sys_script_client', 'name', { name: '[PT] F1 client urgencia', table: 'incident', active: 'true', type: 'onChange', field: 'category', ui_type: '0',
    script: "function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading) return;\n  if (newValue == 'hardware' && g_form.getValue('short_description').indexOf('[PT] F1-CLIENT') == 0) g_form.setValue('urgency', '1');\n}" });

  // Registros de teste
  const inc = async (desc, extra = {}) => (await find('incident', `short_description=${desc}`)) ?? api('POST', 'table/incident', { short_description: desc, caller_id: '6816f79cc0a8016401c5a33be04be441', ...extra });
  const recs = {
    'F1-ASSIGN': await inc('[PT] F1-ASSIGN', { category: 'inquiry' }),
    'F1-SEQ': await inc('[PT] F1-SEQ', { impact: '1' }),
    'F1-MANY': await inc('[PT] F1-MANY'),
    'F1-REST': await inc('[PT] F1-REST'),
    'F1-LOOKUP': await inc('[PT] F1-LOOKUP'),
    'F1-CLIENT': await inc('[PT] F1-CLIENT', { category: 'inquiry' }),
  };
  recs['F1-OTHER'] = (await find('problem', 'short_description=[PT] F1-OTHER')) ?? await api('POST', 'table/problem', { short_description: '[PT] F1-OTHER', impact: '2' });
  for (const [k, r] of Object.entries(recs)) out[k] = { number: r.number, sys_id: r.sys_id };
  return out;
}

/** F1-MANY e F1-REST: gravações pela Table API (geram transações REST do admin). */
async function trailRestWrites(manySysId, restSysId) {
  const ck = window.g_ck;
  const patch = (id, body) => fetch('/api/now/table/incident/' + id, { method: 'PATCH', headers: { 'X-UserToken': ck, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
  const st = [];
  for (let i = 0; i < 60; i++) st.push(await patch(manySysId, { state: i % 2 ? '1' : '2' }));
  const rest = await patch(restSysId, { urgency: '1' });
  return { many: st.filter((s) => s === 200).length, rest };
}
