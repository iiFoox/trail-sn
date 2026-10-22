// Bateria v2 de escopos: monta a lista de casos (só leitura), a partir dos registros [PT] v2 já criados e disparados
// por montar-v2-artefatos.js, montar-v2-registros.js e pelas ações de navegador/pessoa (UIA, CS, UIP, LST, FRM, API).
// Roda na aba do PDI como admin. Resultado: localStorage.pt_v2cases (JSON) e window.__v2cases.
// expectedNames: basta o nome da evidência principal conter um deles. expectNoChange: a automação falhou (XS: include
// de outro escopo gravando o registro) e o Trail não pode mostrar mudança nenhuma no campo.
(async () => {
  const H = () => ({ 'X-UserToken': g_ck, Accept: 'application/json' });
  const Q = async (t, q, f, l = 500) => (await (await fetch(`/api/now/table/${t}?sysparm_limit=${l}&sysparm_fields=${f}&sysparm_query=${encodeURIComponent(q)}`, { headers: H() })).json()).result || [];
  const apps = [
    { k: 'A', T: 'x_2270630_pttrail__pedido_audit', item: null, cross: 'PTv2CrossB' },
    { k: 'B', T: 'x_2270630_pttrailb_pedido', item: 'x_2270630_pttrailb_item', cross: 'PTv2CrossC' },
    { k: 'C', T: 'x_2270630_pttrailc_pedido', item: 'x_2270630_pttrailc_item', cross: 'PTv2CrossA' },
  ];
  const plan = (a) => ({
    BRB: [['priority', 'br_before', [`[PT] v2 BRB ${a.k}`]], ['urgency', 'br_before', [`[PT] v2 BRB ${a.k}`]]],
    BRA: [['state', 'br_after', [`[PT] v2 BRA ${a.k}`]], ['u_valor', 'br_after', [`[PT] v2 BRA ${a.k}`]]],
    BRS: [['assigned_to', 'br_async', [`[PT] v2 BRS ${a.k}`]], ['impact', 'br_async', [`[PT] v2 BRS ${a.k}`]]],
    SI: [['impact', 'br_via_script_include', [`PTv2Helper${a.k}`, `[PT] v2 SI ${a.k}`]], ['close_notes', 'br_via_script_include', [`PTv2Helper${a.k}`, `[PT] v2 SI ${a.k}`]]],
    XC: [['close_notes', 'br_via_script_include', [`PTv2Helper${a.k}`, `[PT] v2 XC ${a.k}`]]],
    XS: [['priority', 'none', [], true], ['urgency', 'none', [], true]],
    XSR: [['impact', 'br_before', [`[PT] v2 XSR ${a.k}`, a.cross]]],
    EV: [['opened_by', 'script_action', [`[PT] v2 Script Action ${a.k}`]], ['u_valor', 'script_action', [`[PT] v2 Script Action ${a.k}`]]],
    GBS: [['opened_by', 'br_before', [`[PT] v2 GBS ${a.k}`]], ['u_valor', 'br_before', [`[PT] v2 GBS ${a.k}`]]],
    JOB: [['priority', 'scheduled_job', [`[PT] v2 Job ${a.k}`]], ['u_valor', 'scheduled_job', [`[PT] v2 Job ${a.k}`]]],
    UIA: [['impact', 'ui_action', [`[PT] v2 UI Action ${a.k}`]], ['close_notes', 'ui_action', [`[PT] v2 UI Action ${a.k}`]]],
    CS: [['impact', 'client_script', [`[PT] v2 Client Script ${a.k}`]]],
    UIP: [['priority', 'ui_policy', [`[PT] v2 UI Policy ${a.k}`]]],
    FRM: [['state', 'user_action', []], ['urgency', 'user_action', []]],
    API: [['state', 'user_action', []], ['assigned_to', 'user_action', []]],
    LST: [['priority', 'user_action', []]],
  });
  const cases = [];
  const add = (o) => cases.push(o);
  for (const a of apps) {
    const recs = await Q(a.T, 'short_descriptionSTARTSWITH[PT] v2 ' + a.k + ' ', 'sys_id,number,short_description');
    for (const [tipo, fields] of Object.entries(plan(a))) {
      for (const r of recs.filter((x) => new RegExp(`^\\[PT\\] v2 ${a.k} ${tipo} \\d{3}$`).test(x.short_description))) {
        const n = r.short_description.slice(-3);
        for (const [field, type, names, none] of fields) add({ id: `${a.k}-${tipo}-${n}-${field}`, scope: a.k, tipo, table: a.T, sysId: r.sys_id, number: r.number, field, expectedType: type, expectedNames: names, ...(none ? { expectNoChange: true } : {}) });
      }
    }
    // BRO: a regra after do pedido grava outro registro (item em B/C; outro pedido "alvo" em A).
    if (a.item) {
      for (const it of await Q(a.item, 'u_nomeSTARTSWITH[PT] v2 alvo', 'sys_id,u_nome')) for (const f of ['u_estoque', 'u_status']) add({ id: `${a.k}-BRO-${it.u_nome.slice(-11)}-${f}`, scope: a.k, tipo: 'BRO', table: a.item, sysId: it.sys_id, field: f, expectedType: 'br_after', expectedNames: [`[PT] v2 BRO ${a.k}`] });
      for (const it of await Q(a.item, 'u_nomeSTARTSWITH[PT] v2 ' + a.k + ' JOB item', 'sys_id,u_nome')) for (const f of ['u_nome', 'u_estoque']) add({ id: `${a.k}-JOBI-${it.u_nome.slice(19, 22)}-${f}`, scope: a.k, tipo: 'JOB', table: a.item, sysId: it.sys_id, field: f, expectedType: 'scheduled_job', expectedNames: [`[PT] v2 Job ${a.k}`] });
    } else {
      for (const o of await Q(a.T, 'short_descriptionSTARTSWITH[PT] v2 A alvo', 'sys_id,number')) for (const f of ['impact', 'u_valor']) add({ id: `A-BRO-${o.number}-${f}`, scope: 'A', tipo: 'BRO', table: a.T, sysId: o.sys_id, number: o.number, field: f, expectedType: 'br_after', expectedNames: ['[PT] v2 BRO A'] });
    }
    // SG: regra do escopo grava o incidente global; a prioridade vem do data lookup.
    for (const r of await Q('incident', `short_descriptionSTARTSWITH[PT] v2 ${a.k} SG`, 'sys_id,number,short_description')) {
      const n = r.short_description.slice(-3);
      for (const [f, type, names] of [['impact', 'br_before', [`[PT] v2 SG ${a.k}`]], ['urgency', 'br_before', [`[PT] v2 SG ${a.k}`]], ['priority', 'data_lookup', ['Priority']]]) add({ id: `${a.k}-SG-${n}-${f}`, scope: a.k, tipo: 'SG', table: 'incident', sysId: r.sys_id, number: r.number, field: f, expectedType: type, expectedNames: names });
    }
  }
  window.__v2cases = cases;
  localStorage.pt_v2cases = JSON.stringify(cases);
  return cases.length;
})();
