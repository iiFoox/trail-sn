// Bateria v2: cria os registros [PT] v2 e dispara as causas server-side (como admin, pela Table API).
// Pré-requisito: montar-v2-artefatos.js. Roda na aba do PDI como admin. Resultado: window._v2cases (lista de casos).
// Tipos aqui: BRB BRA BRO BRS SI XS XSR EV GBS SG (incidente global) e prepara JOB (registros; o job roda à parte).
// Os tipos de navegador/pessoa (UIA CS UIP FRM LST API) só têm os registros criados aqui; a mudança é feita em
// montar-v2-ui.js.
(async () => {
  const H = () => ({ 'X-UserToken': g_ck, Accept: 'application/json', 'Content-Type': 'application/json' });
  const post = async (t, b) => { const r = await fetch(`/api/now/table/${t}?sysparm_fields=sys_id,number`, { method: 'POST', headers: H(), body: JSON.stringify(b) }); return (await r.json()).result; };
  const patch = async (t, id, b) => (await fetch(`/api/now/table/${t}/${id}?sysparm_fields=sys_id`, { method: 'PATCH', headers: H(), body: JSON.stringify(b) })).status;
  const get = async (t, q, f) => (await (await fetch(`/api/now/table/${t}?sysparm_limit=50&sysparm_fields=${f}&sysparm_query=${encodeURIComponent(q)}`, { headers: H() })).json()).result || [];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const apps = [
    { k: 'A', T: 'x_2270630_pttrail__pedido_audit', item: null, cross: 'PTv2CrossB' },
    { k: 'B', T: 'x_2270630_pttrailb_pedido', item: 'x_2270630_pttrailb_item', cross: 'PTv2CrossC' },
    { k: 'C', T: 'x_2270630_pttrailc_pedido', item: 'x_2270630_pttrailc_item', cross: 'PTv2CrossA' },
  ];
  const N = 3;
  // tipo → campos-alvo no próprio registro, com o tipo/nome esperados
  const plan = (a) => ({
    BRB: [['priority', 'br_before', `[PT] v2 BRB ${a.k}`], ['urgency', 'br_before', `[PT] v2 BRB ${a.k}`]],
    BRA: [['state', 'br_after', `[PT] v2 BRA ${a.k}`], ['u_valor', 'br_after', `[PT] v2 BRA ${a.k}`]],
    BRS: [['assigned_to', 'br_async', `[PT] v2 BRS ${a.k}`], ['impact', 'br_async', `[PT] v2 BRS ${a.k}`]],
    SI: [['impact', 'br_via_script_include', `PTv2Helper${a.k}|[PT] v2 SI ${a.k}`], ['close_notes', 'br_via_script_include', `PTv2Helper${a.k}|[PT] v2 SI ${a.k}`]],
    XS: [['priority', 'br_via_script_include', `${a.cross}|[PT] v2 XS ${a.k}`], ['urgency', 'br_via_script_include', `${a.cross}|[PT] v2 XS ${a.k}`]],
    XSR: [['impact', 'br_before', `[PT] v2 XSR ${a.k}`]],
    EV: [['opened_by', 'script_action', `[PT] v2 Script Action ${a.k}`], ['u_valor', 'script_action', `[PT] v2 Script Action ${a.k}`]],
    GBS: [['opened_by', 'br_before', `[PT] v2 GBS ${a.k}`], ['u_valor', 'br_before', `[PT] v2 GBS ${a.k}`]],
    JOB: [['priority', 'scheduled_job', `[PT] v2 Job ${a.k}`], ['u_valor', 'scheduled_job', `[PT] v2 Job ${a.k}`]],
    UIA: [['impact', 'ui_action', `[PT] v2 UI Action ${a.k}`], ['close_notes', 'ui_action', `[PT] v2 UI Action ${a.k}`]],
    CS: [['impact', 'client_script', `[PT] v2 Client Script ${a.k}`]],
    UIP: [['priority', 'ui_policy', `[PT] v2 UI Policy ${a.k}`]],
    FRM: [['state', 'user_action', ''], ['urgency', 'user_action', '']],
    API: [['state', 'user_action', ''], ['assigned_to', 'user_action', '']],
    LST: [['priority', 'user_action', '']],
  });
  const triggered = new Set(['BRB', 'BRA', 'BRS', 'SI', 'XS', 'XSR', 'EV', 'GBS']);
  const cases = [];
  const recs = [];
  for (const a of apps) {
    for (const [tipo, fields] of Object.entries(plan(a))) {
      for (let n = 1; n <= N; n++) {
        if (tipo === 'LST' && n > 2) continue;
        const sd = `[PT] v2 ${a.k} ${tipo} ${String(n).padStart(3, '0')}`;
        const ex = (await get(a.T, `short_description=${sd}`, 'sys_id,number'))[0];
        const r = ex || await post(a.T, { short_description: sd, impact: tipo === 'SI' ? 2 : 3, urgency: 3, priority: 4, state: 1, u_valor: 10 });
        recs.push({ a, tipo, sd, id: r.sys_id, number: r.number, existed: !!ex });
        for (const [field, type, name] of fields) cases.push({ id: `${a.k}-${tipo}-${String(n).padStart(3, '0')}-${field}`, table: a.T, sysId: r.sys_id, number: r.number, sd, field, expectedType: type, expectedName: name, scope: a.k, tipo });
      }
    }
    // BRO: pedido gatilho + alvo
    for (let n = 1; n <= N; n++) {
      const sd = `[PT] v2 ${a.k} BRO ${String(n).padStart(3, '0')}`;
      const ex = (await get(a.T, `short_description=${sd}`, 'sys_id,number'))[0];
      const r = ex || await post(a.T, { short_description: sd, impact: 3, urgency: 3, priority: 4, state: 1, u_valor: 10 });
      recs.push({ a, tipo: 'BRO', sd, id: r.sys_id, number: r.number, existed: !!ex });
      if (a.item) {
        const nome = `[PT] v2 alvo ${r.number}`;
        const it = (await get(a.item, `u_nome=${nome}`, 'sys_id'))[0] || await post(a.item, { u_nome: nome, u_estoque: 10, u_status: 1 });
        for (const f of ['u_estoque', 'u_status']) cases.push({ id: `${a.k}-BRO-${String(n).padStart(3, '0')}-${f}`, table: a.item, sysId: it.sys_id, sd: nome, field: f, expectedType: 'br_after', expectedName: `[PT] v2 BRO ${a.k}`, scope: a.k, tipo: 'BRO', via: r.number });
      } else {
        const sdo = `[PT] v2 A alvo ${r.number}`;
        const o = (await get(a.T, `short_description=${sdo}`, 'sys_id,number'))[0] || await post(a.T, { short_description: sdo, impact: 3, urgency: 3, priority: 4, state: 1, u_valor: 10 });
        for (const f of ['impact', 'u_valor']) cases.push({ id: `A-BRO-${String(n).padStart(3, '0')}-${f}`, table: a.T, sysId: o.sys_id, number: o.number, sd: sdo, field: f, expectedType: 'br_after', expectedName: '[PT] v2 BRO A', scope: 'A', tipo: 'BRO', via: r.number });
      }
    }
    // Itens que o job renomeia (B/C)
    if (a.item) for (let n = 1; n <= 2; n++) {
      const nome = `[PT] v2 ${a.k} JOB item ${String(n).padStart(3, '0')}`;
      const it = (await get(a.item, `u_nomeSTARTSWITH${nome}`, 'sys_id'))[0] || await post(a.item, { u_nome: nome, u_estoque: 10, u_status: 1 });
      for (const f of ['u_nome', 'u_estoque']) cases.push({ id: `${a.k}-JOB-item${n}-${f}`, table: a.item, sysId: it.sys_id, sd: nome, field: f, expectedType: 'scheduled_job', expectedName: `[PT] v2 Job ${a.k}`, scope: a.k, tipo: 'JOB' });
    }
    // Incidente global gravado pela regra do escopo (SG): impacto/urgência pela regra; prioridade pelo data lookup.
    for (let n = 1; n <= N; n++) {
      const sd = `[PT] v2 ${a.k} SG ${String(n).padStart(3, '0')}`;
      const ex = (await get('incident', `short_description=${sd}`, 'sys_id,number'))[0];
      const r = ex || await post('incident', { short_description: sd, impact: 3, urgency: 3, caller_id: '6816f79cc0a8016401c5a33be04be441' });
      recs.push({ a, tipo: 'SG', sd, id: r.sys_id, number: r.number, existed: !!ex, table: 'incident' });
      for (const [f, type, name] of [['impact', 'br_before', `[PT] v2 SG ${a.k}`], ['urgency', 'br_before', `[PT] v2 SG ${a.k}`], ['priority', 'data_lookup', 'Priority']])
        cases.push({ id: `${a.k}-SG-${String(n).padStart(3, '0')}-${f}`, table: 'incident', sysId: r.sys_id, number: r.number, sd, field: f, expectedType: type, expectedName: name, scope: a.k, tipo: 'SG' });
    }
  }
  await pause(3000);
  // Disparo: description muda para go:<TIPO> (admin, Table API)
  const fire = recs.filter((r) => !r.existed && (triggered.has(r.tipo) || r.tipo === 'BRO' || r.tipo === 'SG'));
  const st = [];
  for (const r of fire) st.push(await patch(r.table || r.a.T, r.id, { description: `go:${r.tipo}` }));
  window._v2cases = cases;
  window._v2recs = recs.map((r) => ({ k: r.a.k, tipo: r.tipo, sd: r.sd, id: r.id, number: r.number, table: r.table || r.a.T }));
  return `casos ${cases.length}, registros ${recs.length}, disparos ${fire.length} status ${[...new Set(st)].join(',')}`;
})();
