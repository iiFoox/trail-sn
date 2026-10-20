(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // luz que segue o cursor
  const glow = $('.glow');
  if (!reduce) addEventListener('pointermove', (e) => {
    glow.style.setProperty('--gx', ((e.clientX / innerWidth) - .5) * 160 + 'px');
    glow.style.setProperty('--gy', ((e.clientY / innerHeight) - .5) * 160 + 'px');
  }, { passive: true });

  // nav
  const nav = $('#nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });

  // revelar ao rolar
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .15 });
  $$('.rv').forEach((el) => io.observe(el));

  // ---------- demonstração: casos reais da PDI ----------
  const CASES = {
    state: { field: 'state', old: 'In Progress', neu: 'Resolved', when: '17/10 22:37', who: 'Depois que admin salvou', type: 'BR assíncrona', name: '[PERICIA-TESTE] Resolve incidente por palavra-chave', grade: 'CONFIRMADO', score: 80,
      lines: ['<span class="m">→</span> GET sys_audit         <span class="t">documentkey=ad7b…31f3</span>   <span class="g">3 mudanças</span>', '<span class="m">→</span> GET sys_script        <span class="t">collectionIN incident,task</span> <span class="g">cache</span>', '<span class="m">→</span> GET syslog_transaction <span class="t">01:36:59 … 01:37:17</span>  <span class="g">14 linhas</span>', '<span class="m">→</span> GET sysevent · sys_flow_context · wf_context  <span class="m">0 · 0 · 0</span>', '<span class="a">✓</span> JOB: ASYNC: [PERICIA-TESTE] Resolve incidente por pa…', '<span class="a">✓</span> o script referencia <span class="t">"state"</span> · BR da tabela incident', '<span class="m">11 chamadas · 1,84 s · somente GET</span>'],
      facts: [['+50', 'Job ASYNC às 01:37:02 nomeia a regra'], ['+20', 'O script referencia "state"'], ['+10', 'BR da tabela incident']] },
    impact: { field: 'impact', old: '3 - Low', neu: '1 - High', when: '17/10 23:10', who: 'Ao salvar de pericia.itil', type: 'BR before', name: '[PT] C2 before define impacto', grade: 'CONFIRMADO', score: 80,
      lines: ['<span class="m">→</span> GET sys_audit         <span class="t">documentkey=…</span>   <span class="g">1 mudança</span>', '<span class="m">→</span> GET syslog_transaction <span class="t">02:10:30 … 02:10:48</span>  <span class="g">6 linhas</span>', '<span class="a">✓</span> form /incident.do?sys_uniqueValue=… <span class="t">incident.impact=3</span>', '<span class="a">✓</span> enviado <span class="t">3</span> · gravado <span class="g">1</span> → o servidor alterou ao salvar', '<span class="a">✓</span> 1 BR before ativa referencia <span class="t">"impact"</span>', '<span class="m">11 chamadas · 2,06 s · somente GET</span>'],
      facts: [['+30', 'O formulário enviou 3, o gravado foi 1'], ['+20', 'Salvo às 02:10:33, na janela'], ['+20', 'O script referencia "impact"'], ['+10', 'BR before da tabela incident']] },
    contact_type: { field: 'contact_type', old: 'Phone', neu: 'Email', when: '17/10 23:14', who: 'Evento do registro', type: 'Script action (evento)', name: '[PT] C4 script action', grade: 'CONFIRMADO', score: 70,
      lines: ['<span class="m">→</span> GET sys_audit         <span class="g">2 mudanças</span>', '<span class="m">→</span> GET sysevent          <span class="t">instance=… processed 02:14:06…08</span> <span class="g">1 evento</span>', '<span class="a">✓</span> evento <span class="t">pt.contato</span> processado às 02:14:07', '<span class="m">→</span> GET sysevent_script_action <span class="t">event_name=pt.contato</span> <span class="g">1</span>', '<span class="a">✓</span> o script referencia <span class="t">"contact_type"</span>', '<span class="m">12 chamadas · 2,25 s · somente GET</span>'],
      facts: [['+50', 'Evento processado no mesmo segundo'], ['+20', 'O script referencia "contact_type"']] },
    severity: { field: 'severity', old: '2 - Medium', neu: '1 - High', when: '17/10 23:20', who: 'Job das 23:20', type: 'Job agendado', name: '[PT] C5 job ajusta severidade', grade: 'CONFIRMADO', score: 70,
      lines: ['<span class="m">→</span> GET sys_audit         <span class="g">1 mudança · usuário system</span>', '<span class="m">→</span> GET syslog_transaction <span class="t">02:19:57 … 02:20:15</span>  <span class="g">3 linhas</span>', '<span class="a">✓</span> JOB: [PT] C5 job ajusta severidade <span class="m">· system · 02:19:59</span>', '<span class="m">→</span> GET sysauto_script    <span class="t">nameIN …</span> <span class="g">1</span>', '<span class="a">✓</span> o script referencia <span class="t">"severity"</span>', '<span class="m">12 chamadas · 2,05 s · somente GET</span>'],
      facts: [['+50', 'Transação JOB nomeia o job'], ['+20', 'O script referencia "severity"']] },
  };

  const stage = $('#stage'), con = $('#console'), panel = $('#panel'), ev = $('#ev');
  let token = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

  async function run(key) {
    const c = CASES[key]; const my = ++token;
    stage.classList.remove('done');
    $$('.q').forEach((b) => { b.classList.toggle('on', b.dataset.k === key); b.classList.remove('pulse'); });
    $$('.f').forEach((f) => f.classList.toggle('hot', f.dataset.k === key));
    $$('.f .in').forEach((i) => i.classList.remove('changed'));
    $('#c-target').textContent = 'incident.' + key;
    panel.classList.remove('in'); ev.classList.remove('in'); $('#p-meter').style.width = '0';
    con.innerHTML = '';
    for (const l of c.lines) {
      if (my !== token) return;
      const s = document.createElement('span'); s.className = 'ln'; s.innerHTML = l + '\n'; con.appendChild(s);
      requestAnimationFrame(() => s.classList.add('show'));
      await wait(260 + Math.random() * 180);
    }
    const caret = document.createElement('span'); caret.className = 'caret'; con.appendChild(caret);
    if (my !== token) return;
    $('#p-field').textContent = c.field; $('#p-when').innerHTML = `${c.when} <small style="color:#8c99a5;font-weight:400">· ${c.who}</small>`;
    $('#p-old').textContent = c.old; $('#p-new').textContent = c.neu; $('#p-type').textContent = c.type; $('#p-name').textContent = c.name;
    const bd = $('#p-badge'); bd.innerHTML = `${c.grade === 'CONFIRMADO' ? 'CERTEZA ALTA' : 'CERTEZA MÉDIA'}<i class="stamp-wave"></i>`; bd.classList.toggle('p', c.grade !== 'CONFIRMADO');
    $('#p-facts').innerHTML = c.facts.map(([p, t]) => `<div><b>${p}</b>${t}</div>`).join('');
    panel.classList.add('in');
    await wait(350);
    ev.classList.add('in');
    $('#p-meter').style.setProperty('--w', c.score + '%'); $('#p-meter').style.width = c.score + '%';
    const field = $(`.f[data-k="${key}"] .in`); if (field) field.classList.add('changed');
    await wait(900);
    if (my === token) stage.classList.add('done');
  }
  $$('.q').forEach((b) => b.addEventListener('click', () => run(b.dataset.k)));
  $('#replay').addEventListener('click', () => run($('.q.on')?.dataset.k || 'state'));
  setTimeout(() => run('state'), reduce ? 0 : 1200);

  // ---------- método: passo ativo controla a camada ----------
  const steps = $$('.step'), layers = $$('.layer');
  const so = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { const i = e.target.dataset.i; steps.forEach((s) => s.classList.toggle('on', s.dataset.i === i)); layers.forEach((l) => l.classList.toggle('on', l.dataset.i === i)); } }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => so.observe(s));

  // ---------- mosaico: holofote e expansão ----------
  $$('.tile').forEach((t) => {
    t.addEventListener('pointermove', (e) => { const r = t.getBoundingClientRect(); t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    t.addEventListener('click', () => t.classList.toggle('open'));
  });

  // ---------- números ----------
  const no = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; no.unobserve(e.target);
    const b = e.target; const end = parseFloat(b.dataset.count), dec = +(b.dataset.dec || 0), suf = b.dataset.suffix || '';
    const t0 = performance.now(), dur = reduce ? 0 : 1400;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur); const v = end * (1 - Math.pow(1 - k, 3)); b.textContent = v.toFixed(dec).replace('.', ',') + suf; if (k < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: .6 });
  $$('[data-count]').forEach((b) => no.observe(b));

  // ---------- acesso por perfil (observado na PDI) ----------
  const SRC = ['sys_audit', 'syslog_transaction', 'sysevent', 'sysevent_script_action', 'sys_flow_context', 'wf_context', 'sys_script', 'sys_script_include', 'sys_ui_action', 'sysauto_script', 'sys_db_object'];
  const PROFILES = {
    admin: { lvl: 'full', st: Object.fromEntries(SRC.map((s) => [s, 'ok'])) },
    reader: { lvl: 'full', st: Object.fromEntries(SRC.map((s) => [s, 'ok'])) },
    itil: { lvl: 'none', st: { sys_audit: 'no', syslog_transaction: 'no', sysevent: 'em', sysevent_script_action: 'no', sys_flow_context: 'em', wf_context: 'em', sys_script: 'no', sys_script_include: 'no', sys_ui_action: 'ok', sysauto_script: 'em', sys_db_object: 'ok' } },
    basic: { lvl: 'none', st: Object.fromEntries(SRC.map((s) => [s, s === 'sys_db_object' ? 'ok' : 'no'])) },
  };
  const LABEL = { ok: 'LÊ', no: 'NEGADO', em: 'VAZIO' };
  const TXT = {
    full: ['Acesso completo', 'Perícia completa.', 'Todas as fontes leem. O painel não mostra nenhum aviso.'],
    partial: ['Acesso parcial', 'Perícia com lacunas.', 'Auditoria e metadados lidos, mas algumas fontes estão negadas. BRs assíncronas e UI actions podem não aparecer.'],
    none: ['Sem perícia', 'A auditoria está negada.', 'Sem sys_audit não há linha do tempo. O painel mostra o que pedir ao administrador, com os nomes técnicos para copiar no chamado.'],
  };
  const srcs = $('#srcs'), verdict = $('#verdict');
  srcs.innerHTML = SRC.map((s) => `<div class="src" data-s="${s}"><span>${s}</span><span class="st"></span></div>`).join('');
  function profile(p) {
    const pr = PROFILES[p];
    SRC.forEach((s, i) => setTimeout(() => { const el = $(`.src[data-s="${s}"]`); el.className = 'src ' + pr.st[s]; $('.st', el).textContent = LABEL[pr.st[s]]; }, reduce ? 0 : i * 45));
    const denied = SRC.filter((s) => pr.st[s] === 'no');
    const lvl = pr.lvl === 'full' && denied.length ? 'partial' : pr.lvl;
    verdict.className = 'verdict rv in ' + lvl;
    const [a, b, c] = TXT[lvl];
    $('.lvl', verdict).textContent = a; $('h3', verdict).textContent = b; $('p', verdict).textContent = c;
    $('code', verdict).textContent = denied.length ? 'Negado: ' + denied.join(', ') : (p === 'reader' ? 'Papel: x_trail_reader (read em ' + SRC.length + ' tabelas, nenhuma escrita)' : 'Nenhuma fonte negada');
  }
  $$('#seg button').forEach((b) => b.addEventListener('click', () => { $$('#seg button').forEach((x) => x.classList.toggle('on', x === b)); profile(b.dataset.p); }));
  profile('admin');

  // ---------- B3: barra de progresso + nav que se esconde ao descer ----------
  const prog = $('#progress'); let lastY = 0;
  addEventListener('scroll', () => {
    const h = document.documentElement; const p = h.scrollTop / (h.scrollHeight - h.clientHeight);
    prog.style.transform = `scaleX(${p})`;
    nav.classList.toggle('hide', scrollY > lastY + 6 && scrollY > 300); if (Math.abs(scrollY - lastY) > 6) lastY = scrollY;
  }, { passive: true });

  // ---------- cursor próprio (só com mouse) ----------
  const cur = $('#cursor');
  if (!reduce && matchMedia('(hover:hover)').matches) {
    let cx = innerWidth / 2, cy = innerHeight / 2, tx = cx, ty = cy;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; cur.classList.remove('hid'); }, { passive: true });
    addEventListener('pointerleave', () => cur.classList.add('hid'));
    // dentro de um iframe a página para de receber o mouse: esconde a bolinha em vez de deixá-la presa na borda
    document.addEventListener('pointerover', (e) => { if (e.target.tagName === 'IFRAME') cur.classList.add('hid'); });
    document.addEventListener('mouseleave', () => cur.classList.add('hid'));
    addEventListener('blur', () => cur.classList.add('hid'));
    document.addEventListener('pointerover', (e) => cur.classList.toggle('on', !!e.target.closest('a,button,.tile,.q,.seg')));
    (function loop() { cx += (tx - cx) * .22; cy += (ty - cy) * .22; cur.style.transform = `translate(${cx}px,${cy}px) translate(-50%,-50%)`; requestAnimationFrame(loop); })();
  } else cur.remove();

  // ---------- fundo: partículas em trilhas (campo de fluxo), atraídas pelo cursor ----------
  const cv = $('#trails');
  if (!reduce && cv) {
    const ctx = cv.getContext('2d'); let W, H, pts = [], mx = -1e9, my = -1e9, running = true;
    const DPR = Math.min(2, devicePixelRatio || 1);
    const size = () => { W = cv.width = innerWidth * DPR; H = cv.height = innerHeight * DPR; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px'; };
    size(); addEventListener('resize', size);
    addEventListener('pointermove', (e) => { mx = e.clientX * DPR; my = e.clientY * DPR; }, { passive: true });
    const N = innerWidth < 700 ? 60 : 140;
    for (let i = 0; i < N; i++) pts.push({ x: Math.random() * innerWidth * DPR, y: Math.random() * innerHeight * DPR, vx: 0, vy: 0, life: Math.random() * 200, hue: Math.random() < .25 ? 'g' : 't' });
    const field = (x, y, t) => { const s = 0.0016 / DPR; return Math.sin(x * s + t) * Math.cos(y * s * 1.3 - t * .7) * Math.PI * 2; };
    let t = 0;
    const tick = () => {
      if (!running) return;
      t += 0.004;
      ctx.fillStyle = 'rgba(7,26,36,0.10)'; ctx.fillRect(0, 0, W, H);
      for (const p of pts) {
        const a = field(p.x, p.y, t); let ax = Math.cos(a) * .18, ay = Math.sin(a) * .18;
        const dx = mx - p.x, dy = my - p.y, d2 = dx * dx + dy * dy;
        if (d2 < (260 * DPR) ** 2) { const d = Math.sqrt(d2) + 1; ax += (dx / d) * .9; ay += (dy / d) * .9; }
        p.vx = (p.vx + ax) * .94; p.vy = (p.vy + ay) * .94;
        const ox = p.x, oy = p.y; p.x += p.vx * DPR; p.y += p.vy * DPR;
        ctx.strokeStyle = p.hue === 'g' ? 'rgba(98,216,78,.55)' : 'rgba(43,179,159,.45)'; ctx.lineWidth = 1.2 * DPR;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (++p.life > 420 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.vx = p.vy = 0; p.life = 0; }
      }
      requestAnimationFrame(tick);
    };
    tick();
    document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) tick(); });
  }

  // ---------- texto que embaralha no topo ----------
  const sc = $('#scramble');
  if (sc && !reduce) {
    const phrases = ['// por que esse campo mudou?', '// quem resolveu esse incidente?', '// que regra alterou a prioridade?', '// foi job, flow ou alguém?', '// extensão para ServiceNow · somente leitura'];
    const chars = '!<>-_\\/[]{}—=+*^?#________';
    let i = 0;
    const to = (txt) => new Promise((res) => { const from = sc.textContent; const len = Math.max(from.length, txt.length); let f = 0; const steps = 22;
      (function fr() { let out = ''; for (let k = 0; k < len; k++) { const p = k / len; out += f / steps > p + .15 ? (txt[k] || '') : f / steps > p - .15 ? chars[Math.floor(Math.random() * chars.length)] : (from[k] || ''); } sc.textContent = out; if (f++ < steps) requestAnimationFrame(fr); else { sc.textContent = txt; res(); } })(); });
    (async function cycle() { while (true) { await wait(3400); i = (i + 1) % phrases.length; await to(phrases[i]); } })();
  }

  // ---------- paralaxe do palco ----------
  if (!reduce && matchMedia('(hover:hover)').matches) {
    stage.classList.add('parallax');
    stage.addEventListener('pointermove', (e) => { const r = stage.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width - .5) * 14, py = ((e.clientY - r.top) / r.height - .5) * 10; stage.style.setProperty('--px', px + 'px'); stage.style.setProperty('--py', py + 'px'); });
    stage.addEventListener('pointerleave', () => { stage.style.setProperty('--px', '0px'); stage.style.setProperty('--py', '0px'); });
  }

  // ---------- inclinação 3D dos cartões ----------
  if (!reduce && matchMedia('(hover:hover)').matches) $$('.tile').forEach((t) => {
    t.classList.add('tilt');
    t.addEventListener('pointermove', (e) => { const r = t.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; t.style.transform = `translateY(-3px) rotateX(${-y * 10}deg) rotateY(${x * 12}deg)`; });
    t.addEventListener('pointerleave', () => { t.style.transform = ''; });
  });

  // ---------- flip ao trocar perfil ----------
  $$('#seg button').forEach((b) => b.addEventListener('click', () => { if (reduce) return; $$('.src').forEach((el, i) => { el.classList.remove('flip'); void el.offsetWidth; el.style.animationDelay = (i * 40) + 'ms'; el.classList.add('flip'); }); }));

  // ---------- número "pula" ao terminar ----------
  $$('[data-count]').forEach((b) => { const mo = new MutationObserver(() => { if (b.textContent.startsWith(String(b.dataset.count).replace('.', ','))) { b.classList.add('pop'); mo.disconnect(); } }); mo.observe(b, { childList: true, characterData: true, subtree: true }); });
  // ---- conteúdo extra (B3.1)
  const tbl = $('#tbl'); if (tbl) { const tio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { $$('tbody tr', tbl).forEach((r, i) => r.style.transitionDelay = (i * 45) + 'ms'); tbl.classList.add('in'); tio.disconnect(); } }), { threshold: .2 }); tio.observe(tbl); }
  const insideImg = $('#inside-img'), insideFrame = $('#inside-frame');
  if (insideImg) {
    const go = (co) => {
      $$('.co').forEach((c) => c.classList.toggle('on', c === co));
      insideFrame?.contentWindow?.postMessage({ type: 'trail-demo-tab', tab: co.dataset.tab }, '*');
      insideImg.style.transform = `translateY(${-(+co.dataset.y || 0)}px)`;
    };
    $$('.co').forEach((co) => co.addEventListener('click', () => go(co)));
    const cio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && matchMedia('(min-width:961px)').matches) go(e.target); }), { rootMargin: '-40% 0px -50% 0px' });
    $$('.co').forEach((co) => cio.observe(co));
  }

  // ---- demos ao vivo
  const fitAll = () => {
    $$('.pic.live').forEach((pic) => { const f = $('iframe', pic); const k = pic.clientWidth / +pic.dataset.w; f.style.transform = `translate(${-pic.dataset.x * k}px,${-pic.dataset.y * k}px) scale(${k})`; });
    $$('.fit').forEach((box) => { const f = $('iframe', box); const k = box.clientWidth / +box.dataset.w; f.style.transform = `scale(${k})`; box.style.height = (620 * k) + 'px'; });
    const ti = $('#inside-img'); if (ti) { const f = $('iframe', ti); f.style.height = "1500px"; }
  };
  fitAll(); addEventListener('resize', fitAll);
  const side = $('.compo .side'), cform = $('#cform');
  const LINES = ['→ GET sys_audit', '→ GET syslog_transaction', '→ GET sysevent · sys_flow_context · wf_context', '→ GET sys_script · sys_ui_action · sysauto_script', '✓ cruzando janela de 3 s antes a 15 s depois', '✓ pontuando candidatos'];
  let busyT;
  const cpanel = $('#cpanel');
  const LABEL_F = { state: 'State', impact: 'Impact', urgency: 'Urgency', priority: 'Priority', category: 'Category', contact_type: 'Contact type', severity: 'Severity', description: 'Description', assignment_group: 'Assignment group', assigned_to: 'Assigned to', cmdb_ci: 'Configuration item', caller_id: 'Caller', short_description: 'Short description', number: 'Number' };
  let scanToken = 0;
  addEventListener('message', async (e) => {
    if (!e.data || e.data.trail !== 'investigate' || !side || e.source !== cform?.contentWindow) return;
    const field = e.data.field || 'state'; const my = ++scanToken;
    clearTimeout(busyT); $('#cscan-f').textContent = LABEL_F[field] ? `${LABEL_F[field]} (${field})` : field; const pre = $('#cscan-l'); pre.textContent = '';
    side.classList.add('busy'); $('.hintbar')?.remove();
    for (const l of LINES) { if (my !== scanToken) return; pre.textContent += l + '\n'; await new Promise((r) => setTimeout(r, reduce ? 0 : 140)); }
    if (my !== scanToken) return;
    cpanel?.contentWindow?.postMessage({ type: 'trail-demo', field }, '*');
    busyT = setTimeout(() => side.classList.remove('busy'), reduce ? 0 : 250);
  });
  const galimg = $('#galimg');
  if (galimg) $$('#galseg button').forEach((b) => b.addEventListener('click', () => { $$('#galseg button').forEach((x) => x.classList.toggle('on', x === b)); galimg.style.opacity = 0; setTimeout(() => { galimg.src = b.dataset.u; galimg.width = b.dataset.w; galimg.onload = () => { galimg.style.opacity = 1; }; $('#galcap').textContent = b.dataset.c; $('#galurl').textContent = 'chrome-extension://…/' + b.dataset.u.split('/').pop().split('.')[0]; }, 200); }));
})();
