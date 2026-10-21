// Bateria v2 de escopos: cria (idempotente) os artefatos [PT] v2 nos apps A/B/C.
// Roda na aba do PDI logada como admin (sem security_admin). Cada artefato é criado com o app dono selecionado.
// Gatilho comum: o registro tem short_description "[PT] v2 ..." e o campo description muda para "go:<TIPO>".
// Resultado em window._v2art (texto). Volta ao app Global no fim.
(async () => {
  const H = () => ({ 'X-UserToken': g_ck, Accept: 'application/json', 'Content-Type': 'application/json' });
  const get = async (t, q, f = 'sys_id') => { const r = await fetch(`/api/now/table/${t}?sysparm_limit=5&sysparm_fields=${f}&sysparm_query=${encodeURIComponent(q)}`, { headers: H() }); return (await r.json()).result || []; };
  const post = async (t, b) => { const r = await fetch('/api/now/table/' + t, { method: 'POST', headers: H(), body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); return { status: r.status, id: j.result?.sys_id, err: j.error?.message }; };
  const patch = async (t, id, b) => (await fetch(`/api/now/table/${t}/${id}`, { method: 'PATCH', headers: H(), body: JSON.stringify(b) })).status;
  const setApp = async (id) => (await fetch('/api/now/ui/concoursepicker/application', { method: 'PUT', headers: H(), body: JSON.stringify({ app_id: id }) })).status;
  const out = [];
  const make = async (t, key, body, upd = true) => {
    const ex = (await get(t, key))[0];
    if (ex) { if (upd) await patch(t, ex.sys_id, body); out.push(`${t} ${body.name || body.short_description || body.event_name}: existe`); return ex.sys_id; }
    const r = await post(t, body); out.push(`${t} ${body.name || body.short_description || body.event_name}: ${r.status}${r.err ? ' ' + r.err : ''}`); return r.id;
  };
  const ADMIN = '6816f79cc0a8016401c5a33be04be441', ITIL = '3fc011fdc3c4d3101cbdb8e1b401311c';
  const apps = [
    { k: 'A', app: '3def6f75c3cc17101cbdb8e1b40131cf', scope: 'x_2270630_pttrail_', T: 'x_2270630_pttrail__pedido_audit', item: null, section: '54124c0ec38057101cbdb8e1b40131bc' },
    { k: 'B', app: 'b021f379c3cc17101cbdb8e1b401316a', scope: 'x_2270630_pttrailb', T: 'x_2270630_pttrailb_pedido', item: 'x_2270630_pttrailb_item', section: '1752844ec38057101cbdb8e1b4013148' },
    { k: 'C', app: 'c921f379c3cc17101cbdb8e1b401316e', scope: 'x_2270630_pttrailc', T: 'x_2270630_pttrailc_pedido', item: 'x_2270630_pttrailc_item', section: 'f752844ec38057101cbdb8e1b4013195' },
  ];
  const next = { A: 'B', B: 'C', C: 'A' };
  const go = (k, tipo) => `short_descriptionSTARTSWITH[PT] v2 ${k}^descriptionCHANGESTOgo:${tipo}`;
  const br = (a, tipo, when, script, order = 150, collection = a.T, k = a.k) => make('sys_script', `name=[PT] v2 ${tipo} ${a.k}`, {
    name: `[PT] v2 ${tipo} ${a.k}`, collection, when, order, active: true, action_insert: false, action_update: true,
    filter_condition: go(k, tipo), condition: '', script: `(function executeRule(current, previous) {\n${script}\n})(current, previous);`,
    description: '[PT] Bateria v2 de escopos',
  });
  try {
    for (const a of apps) {
      out.push('app ' + a.k + ': ' + (await setApp(a.app)));
      const y = apps.find((x) => x.k === next[a.k]);
      // Script includes: próprio (grava impact/close_notes) e o "cross" deste app, que outro app chama.
      await make('sys_script_include', `name=PTv2Helper${a.k}`, { name: `PTv2Helper${a.k}`, active: true, access: 'public', description: '[PT] v2 include do proprio escopo',
        script: `var PTv2Helper${a.k} = Class.create();\nPTv2Helper${a.k}.prototype = {\n  initialize: function() {},\n  aplicar: function(gr) { gr.impact = 3; gr.close_notes = '[PT] v2 include ${a.k}'; },\n  type: 'PTv2Helper${a.k}'\n};` });
      await make('sys_script_include', `name=PTv2Cross${a.k}`, { name: `PTv2Cross${a.k}`, active: true, access: 'public', description: '[PT] v2 include chamado por outro escopo',
        script: `var PTv2Cross${a.k} = Class.create();\nPTv2Cross${a.k}.prototype = {\n  initialize: function() {},\n  gravar: function(gr) { gr.priority = 3; gr.urgency = 2; },\n  valor: function() { return '1'; },\n  type: 'PTv2Cross${a.k}'\n};` });
      await br(a, 'BRB', 'before', `current.priority = 1;\ncurrent.urgency = 1;`);
      await br(a, 'BRA', 'after', `current.state = 2;\ncurrent.u_valor = 777;\ncurrent.update();`);
      await br(a, 'BRO', 'after', a.item
        ? `var gr = new GlideRecord('${a.item}');\ngr.addQuery('u_nome', '[PT] v2 alvo ' + current.number);\ngr.query();\nif (gr.next()) { gr.u_estoque = 55; gr.u_status = 2; gr.update(); }`
        : `var gr = new GlideRecord('${a.T}');\ngr.addQuery('short_description', '[PT] v2 A alvo ' + current.number);\ngr.query();\nif (gr.next()) { gr.impact = 1; gr.u_valor = 55; gr.update(); }`);
      await br(a, 'BRS', 'async', `var gr = new GlideRecord('${a.T}');\nif (gr.get(current.getUniqueValue())) { gr.assigned_to = '${ADMIN}'; gr.impact = 2; gr.update(); }`);
      await br(a, 'SI', 'before', `new PTv2Helper${a.k}().aplicar(current);`);
      await br(a, 'XS', 'before', `new ${y.scope}.PTv2Cross${y.k}().gravar(current);`);
      await br(a, 'XSR', 'before', `current.impact = new ${y.scope}.PTv2Cross${y.k}().valor();`);
      const ev = `[PT] v2.${a.k.toLowerCase()}.evento`;
      await make('sysevent_register', `event_name=${ev}`, { event_name: ev, table: a.T, description: '[PT] v2 evento de teste ' + a.k, queue: '' });
      await br(a, 'EV', 'after', `gs.eventQueue('${ev}', current, current.number, '');`);
      await make('sysevent_script_action', `name=[PT] v2 Script Action ${a.k}`, { name: `[PT] v2 Script Action ${a.k}`, event_name: ev, active: true,
        script: `var gr = new GlideRecord('${a.T}');\nif (gr.get(event.instance)) { gr.opened_by = '${ITIL}'; gr.u_valor = 909; gr.update(); }` });
      // Escopo do app grava incidente global.
      await br(a, 'SG', 'before', `current.impact = 1;\ncurrent.urgency = 1;`, 150, 'incident');
      // Job de execução única, criado INATIVO; é ativado só na hora de rodar e desativado depois.
      await make('sysauto_script', `name=[PT] v2 Job ${a.k}`, { name: `[PT] v2 Job ${a.k}`, active: false, run_type: 'once', run_as: ADMIN,
        script: `var gr = new GlideRecord('${a.T}');\ngr.addQuery('short_description', 'STARTSWITH', '[PT] v2 ${a.k} JOB');\ngr.query();\nwhile (gr.next()) { gr.priority = 5; gr.u_valor = 123; gr.update(); }` +
          (a.item ? `\nvar it = new GlideRecord('${a.item}');\nit.addQuery('u_nome', 'STARTSWITH', '[PT] v2 ${a.k} JOB item');\nit.query();\nwhile (it.next()) { it.u_nome = it.u_nome + ' (job)'; it.u_estoque = 77; it.update(); }` : '') }, false);
      await make('sys_ui_action', `name=[PT] v2 UI Action ${a.k}`, { name: `[PT] v2 UI Action ${a.k}`, action_name: `pt_v2_${a.k.toLowerCase()}_ua`, table: a.T, active: true, client: false, form_button: true, show_insert: false, show_update: true, order: 110,
        script: `current.impact = 2;\ncurrent.close_notes = '[PT] v2 UI action ${a.k}';\ncurrent.update();\naction.setRedirectURL(current);` });
      await make('sys_script_client', `name=[PT] v2 Client Script ${a.k}`, { name: `[PT] v2 Client Script ${a.k}`, table: a.T, active: true, type: 'onChange', field: 'urgency', ui_type: '10', description: '[PT] v2',
        script: `function onChange(control, oldValue, newValue, isLoading, isTemplate) {\n  if (isLoading) return;\n  if (newValue == '1') g_form.setValue('impact', '1');\n}` });
      await make('sys_ui_policy', `short_description=[PT] v2 UI Policy ${a.k}`, { short_description: `[PT] v2 UI Policy ${a.k}`, table: a.T, active: true, on_load: false, reverse_if_false: false, run_scripts: true, conditions: 'urgency=2', ui_type: '10',
        script_true: `function onCondition() {\n  g_form.setValue('priority', '3');\n}`, script_false: '' });
      // Layout: garante no formulário os campos que os scripts de navegador mexem.
      if (a.section) {
        const els = await get('sys_ui_element', `sys_ui_section=${a.section}`, 'element,position');
        let pos = Math.max(-1, ...els.map((e) => Number(e.position) || 0)) + 1;
        for (const f of ['urgency', 'impact', 'priority', 'state', 'assigned_to', 'description', 'close_notes']) {
          if (els.some((e) => e.element === f)) continue;
          const r = await post('sys_ui_element', { sys_ui_section: a.section, element: f, position: String(pos++) });
          out.push(`layout ${a.k} ${f}: ${r.status}`);
        }
      }
    }
    // Regra global (app Global) escrevendo nas tabelas escopadas.
    out.push('global: ' + (await setApp('global')));
    for (const a of apps) await br(a, 'GBS', 'before', `current.opened_by = '${ITIL}';\ncurrent.u_valor = 444;`, 160, a.T);
  } finally {
    out.push('volta global: ' + (await setApp('global')));
  }
  window._v2art = out.join('\n');
  return out.length;
})();
