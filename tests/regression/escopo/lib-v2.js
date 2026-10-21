// Ajudantes da bateria v2 (colar na aba do PDI depois de cada recarga).
window.H = () => ({ 'X-UserToken': g_ck, Accept: 'application/json', 'Content-Type': 'application/json' });
window.J = async (url, opt = {}, tries = 4) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: H(), ...opt }); const t = await r.text(); try { return { status: r.status, j: JSON.parse(t) }; } catch { if (r.status < 500) return { status: r.status, j: null }; } } catch (e) { /* rede */ } await new Promise((r) => setTimeout(r, 2000 * (i + 1))); } return { status: 0, j: null }; };
window.Q = async (t, q, f, l = 200) => { const r = await J(`/api/now/table/${t}?sysparm_limit=${l}&sysparm_fields=${f}&sysparm_query=${encodeURIComponent(q)}`); return r.status === 200 ? r.j.result : { status: r.status }; };
window.setApp = async (id) => (await fetch('/api/now/ui/concoursepicker/application', { method: 'PUT', headers: H(), body: JSON.stringify({ app_id: id }) })).status;
window.P = (s, i) => s.slice(i * 950, (i + 1) * 950).replace(/[=&?]/g, '·');
window.V2 = {
  T: { A: 'x_2270630_pttrail__pedido_audit', B: 'x_2270630_pttrailb_pedido', C: 'x_2270630_pttrailc_pedido' },
  I: { B: 'x_2270630_pttrailb_item', C: 'x_2270630_pttrailc_item' },
  APP: { A: '3def6f75c3cc17101cbdb8e1b40131cf', B: 'b021f379c3cc17101cbdb8e1b401316a', C: 'c921f379c3cc17101cbdb8e1b401316e' },
};
// Formulário clássico num iframe da própria aba (mesma sessão): muda campos pelo g_form e envia a ação.
window.loadForm = (url) => new Promise((res, rej) => { let f = document.getElementById('ptf'); if (f) f.remove(); f = document.createElement('iframe'); f.id = 'ptf'; f.style.cssText = 'width:1200px;height:800px;position:fixed;top:0;left:0;z-index:99999;background:#fff'; document.body.appendChild(f); const t = setTimeout(() => rej('timeout'), 30000); f.onload = () => { clearTimeout(t); res(f.contentWindow); }; f.src = url; });
window.formAct = async (table, id, fn, action) => {
  const w = await loadForm(`/${table}.do?sys_id=${id}`); await new Promise((r) => setTimeout(r, 2000));
  if (!w.g_form) return 'sem g_form';
  const pre = fn ? fn(w.g_form) : null; await new Promise((r) => setTimeout(r, 1000));
  const snap = ['impact', 'urgency', 'priority', 'state'].map((f) => f + '=' + w.g_form.getValue(f)).join(',');
  const f = document.getElementById('ptf'); const done = new Promise((r) => { f.onload = () => r('loaded'); });
  w.gsftSubmit(null, w.g_form.getFormElement(), action);
  const res = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 20000))]);
  await new Promise((r) => setTimeout(r, 500)); f.remove();
  return `${pre} | ${snap} | ${res}`;
};
'lib ok';
