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
  const tbl = $('#tbl');
  if (tbl) {
    const tio = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) {
        $$('tbody tr', tbl).forEach((r, i) => r.style.transitionDelay = (i * 35) + 'ms');
        tbl.classList.add('in');
        tio.disconnect();
      }
    }), { threshold: .1 });
    tio.observe(tbl);
  }

  // ---- tabela de 441 casos (30 iniciais + carregar mais 30 por clique)
  const EXTRA_DATA = {"summary15":[["F7-RITM","sc_req_item: mesmas 6 causas, com booleano e data/hora no fuso do usuário","6 campos","6 de 6 com o tipo certo","CONFIRMADO",1600],["F7-CUSTOM","Tabela customizada criada para o teste, com auditoria ligada","6 campos","6 de 6 com o tipo certo","CONFIRMADO",1200],["M8","Matriz: 12 mecanismos × 6 tipos de campo × 2 tabelas, cada registro com iscas","132 casos","Pessoa, API, BR before/after/async, script action, botão, client script, job, ordem, script include","CONFIRMADO",2000],["W9-WORKSPACE","Registros salvos pela interface do Service Operations Workspace","8 casos","Pessoa · BR before · client script \"All\"","CONFIRMADO",1900],["F9-BLIND","Teste às cegas 2: 30 alvos montados por outro agente, com cadeias e iscas","30 alvos","19 de primeira; 30 depois das correções","CONFIRMADO",2100],["F10-BLIND","Teste às cegas 3: problem, sc_task, change_task, incident e change, com saves pelo Workspace","30 alvos","25 de primeira; 30 depois das correções","CONFIRMADO",2000],["F11-HISTÓRICO","Teste às cegas 4: o mesmo campo muda de 3 a 5 vezes por causas diferentes; cada mudança é um alvo","30 alvos","30 de 30 de primeira","CONFIRMADO",2000],["F12-INTEGRAÇÃO","Conta de integração (só web service): PATCH, lote da Batch API, regras que reagem, regra de atribuição","17 casos","13 de primeira; 17 depois das correções","CONFIRMADO",2100],["F13-IMPORT/POLÍTICAS","Importação por transform map (staging, scripts do mapa), UI policy com script, data policy, \"Update Selected\" e edição na célula da lista","25 casos","Importação · BR before · BR after · UI policy · Pessoa","CONFIRMADO",2100],["F14-SUBFLOW","Flow cujo passo que grava está dentro de um subflow","2 casos","Flow · subflow · passo 1.1","CONFIRMADO",2100],["F15-BLIND","Teste às cegas 5: 14 mecanismos misturados com iscas em incident, problem e change","35 alvos","33 de primeira; 35 depois das correções","CONFIRMADO",2100],["F16-BLIND","Teste às cegas 6: sc_task, sc_req_item, CMDB (computador e servidor) e base de conhecimento","27 alvos válidos","23 de primeira; 27 depois da correção","CONFIRMADO",2300],["F17-PINGUE-PONGUE","Duas regras trocando a urgência do mesmo incidente; alerta de pingue-pongue","2 casos","BR before · BR async","CONFIRMADO",2300],["F18-CONTEXTO","Protótipo: a instância grava o contexto de cada escrita e o Trail confirma a origem","5 casos","Pessoa · BR before · data lookup · job","CONFIRMADO",2300],["F6-BLIND","11 cenários montados por outro agente, sem a resposta","16 alvos","16 de 16 certos (15 de primeira)","CONFIRMADO",1757]],"compact":[["F5-ORDERCOND","F5 cond 100","urgency","br_before","C130",2313],["F5-CASCADE-desc","F5 cascata A","description","br_after","C80",2256],["F5-CASCADE-imp","F5 cascata B","impact","br_before","C100",2364],["F5-EVENT-sev","F5 script action","severity","script_action","C85",2450],["F5-EVENT-notify","F5 evento before","notify","br_before","C80",2377],["F5-EVENT-contact","incident","contact_type","user_action","C80",2057],["F5-CLIENT2-imp","F5 client A","impact","client_script","C80",2192],["F5-CLIENT2-urg","F5 client B","urgency","client_script","C80",2100],["F5-CLIENT2-contact","incident","contact_type","user_action","C80",2105],["F5-RESTBR-urg","F5 rest before","urgency","br_before","C80",2089],["F5-RESTBR-contact","incident","contact_type","user_action","C75",2187],["F5-CALC","F5 calculo","description","br_before","C130",2059],["F5-LOOKUPBR","F5 prioridade","priority","br_before","C130",2236],["F5-LOOKUPBR-imp","incident","impact","user_action","C80",2037],["F6-B1","F6 Ajuste impacto por canal","impact","br_before","C130",2039],["F6-B2","incident","urgency","user_action","C80",2053],["F6-B3","F6 Monta descrição padrão","description","br_before","C115",2063],["F6-B4","incident","contact_type","user_action","C80",2050],["F6-B5","F6 Revisão de impacto software","impact","br_before","C130",2185],["F6-B6","Priority Lookup","priority","data_lookup","C115",2237],["F6-B7","F6 Urgência por canal","urgency","client_script","C80",2043],["F6-B8","F6 Normaliza urgência integração","urgency","br_before","C80",2196],["F6-B9","incident","impact","user_action","C75",2074],["F6-B10","F6 Sincroniza canal","urgency","br_after","C80",2179],["F6-B11","F6 Severidade por urgência","severity","br_before","C100",2216],["F6-B12","F6 Reclassifica severidade","severity","script_action","C85",2199],["F6-B13","F6 Escalar atendimento","urgency","ui_action","C95",2094],["F6-B14","F6 Notificação de escalonamento","notify","br_before","C80",2190],["F6-B15","F6 Complementa descrição de triagem","description","br_before","C110",2178],["F6-B16","F6 Reprocessa pendências","urgency","scheduled_job","C70",2374],["F7-CHG-BEFORE","F7 CHG before","change_request.justification","br_before","C80",2357],["F7-CHG-AFTER","F7 CHG after","change_request.implementation_plan","br_after","C80",2040],["F7-CHG-ASYNC","F7 CHG async","change_request.risk_impact_analysis","br_async","C80",2049],["F7-CHG-CLIENT","F7 CHG client","change_request.backout_plan","client_script","C80",2196],["F7-CHG-UI","F7 CHG botão","change_request.close_notes","ui_action","C95",1839],["F7-CHG-API","change_request","change_request.cab_recommendation","user_action","C75",1961],["F7-RITM-BEFORE","F7 RITM before","sc_req_item.close_notes","br_before","C80",2063],["F7-RITM-AFTER","F7 RITM after","sc_req_item.order","br_after","C80",2612],["F7-RITM-ASYNC","F7 RITM async","sc_req_item.correlation_id","br_async","C80",3383],["F7-RITM-CLIENT","F7 RITM client","sc_req_item.backordered","client_script","C80",2550],["F7-RITM-UI","F7 RITM botão","sc_req_item.estimated_delivery","ui_action","C95",2193],["F7-RITM-API","sc_req_item","sc_req_item.correlation_display","user_action","C75",2210],["F7-CUSTOM-BEFORE","F7 CUSTOM before","u_pt_trail_teste.u_antes","br_before","C80",2281],["F7-CUSTOM-AFTER","F7 CUSTOM after","u_pt_trail_teste.u_depois","br_after","C80",2399],["F7-CUSTOM-ASYNC","F7 CUSTOM async","u_pt_trail_teste.u_assincrono","br_async","C80",2360],["F7-CUSTOM-CLIENT","F7 CUSTOM client","u_pt_trail_teste.u_cliente","client_script","C80",2417],["F7-CUSTOM-UI","F7 CUSTOM botão","u_pt_trail_teste.u_botao","ui_action","C95",1636],["F7-CUSTOM-API","u_pt_trail_teste","u_pt_trail_teste.u_api","user_action","C75",1607],["F7-FLOWMULTI-severity","F7 flow varios campos · passo 1 (Update Record)","severity","flow","C85",3084],["F7-FLOWMULTI-description","F7 flow varios campos · passo 1 (Update Record)","description","flow","C85",3102],["F7-FLOWMULTI-notify","F7 flow varios campos · passo 1 (Update Record)","notify","flow","C85",3173],["F7-FLOWMULTI-gatilho","incident","contact_type","user_action","C75",2834],["M8-INC-PFORM-choice","incident","impact","user_action","C80",3420],["M8-INC-PAPI-choice","incident","impact","user_action","C75",3420],["M8-INC-BBF-choice","M8 INC before choice","impact","br_before","C130",3602],["M8-INC-BBA-choice","M8 INC before choice","impact","br_before","C80",3489],["M8-INC-BAF-choice","M8 INC after choice","impact","br_after","C80",3579],["M8-INC-BAS-choice","M8 INC async choice","impact","br_async","C80",3437],["M8-INC-SA-choice","M8 INC script action","impact","script_action","C85",4239],["M8-INC-UI-choice","M8 INC botão choice","impact","ui_action","C95",4007],["M8-INC-CS-choice","M8 INC client choice","impact","client_script","C80",3780],["M8-INC-JOB-choice","M8 INC job choice","impact","scheduled_job","C70",4009],["M8-INC-ORD-choice","M8 INC ordem 300 choice","impact","br_before","C80",3436],["M8-INC-SI-choice","M8 INC chama SI choice → PTM8GravaINC","impact","br_via_script_include","C80",4076],["M8-INC-PFORM-text","incident","close_notes","user_action","C80",3485],["M8-INC-PAPI-text","incident","close_notes","user_action","C75",3097],["M8-INC-BBF-text","M8 INC before text","close_notes","br_before","C130",3535],["M8-INC-BBA-text","M8 INC before text","close_notes","br_before","C80",4457],["M8-INC-BAF-text","M8 INC after text","close_notes","br_after","C80",3882],["M8-INC-BAS-text","M8 INC async text","close_notes","br_async","C80",2789],["M8-INC-SA-text","M8 INC script action","close_notes","script_action","C85",2314],["M8-INC-UI-text","M8 INC botão text","close_notes","ui_action","C95",2209],["M8-INC-CS-text","M8 INC client text","close_notes","client_script","C80",2332],["M8-INC-JOB-text","M8 INC job text","close_notes","scheduled_job","C70",2197],["M8-INC-ORD-text","M8 INC ordem 300 text","close_notes","br_before","C80",2224],["M8-INC-SI-text","M8 INC chama SI text → PTM8GravaINC","close_notes","br_via_script_include","C80",2433],["M8-INC-PFORM-ref","incident","assignment_group","user_action","C80",2400],["M8-INC-PAPI-ref","incident","assignment_group","user_action","C75",2489],["M8-INC-BBF-ref","M8 INC before ref","assignment_group","br_before","C130",2503],["M8-INC-BBA-ref","M8 INC before ref","assignment_group","br_before","C80",2294],["M8-INC-BAF-ref","M8 INC after ref","assignment_group","br_after","C80",2197],["M8-INC-BAS-ref","M8 INC async ref","assignment_group","br_async","C80",2345],["M8-INC-SA-ref","M8 INC script action","assignment_group","script_action","C85",2398],["M8-INC-UI-ref","M8 INC botão ref","assignment_group","ui_action","C95",2540],["M8-INC-CS-ref","M8 INC client ref","assignment_group","client_script","C80",2464],["M8-INC-JOB-ref","M8 INC job ref","assignment_group","scheduled_job","C70",2568],["M8-INC-ORD-ref","M8 INC ordem 300 ref","assignment_group","br_before","C80",2373],["M8-INC-SI-ref","M8 INC chama SI ref → PTM8GravaINC","assignment_group","br_via_script_include","C80",2513],["M8-INC-PFORM-bool","incident","knowledge","user_action","C80",2128],["M8-INC-PAPI-bool","incident","knowledge","user_action","C75",2292],["M8-INC-BBF-bool","M8 INC before bool","knowledge","br_before","C130",2492],["M8-INC-BBA-bool","M8 INC before bool","knowledge","br_before","C80",2603],["M8-INC-BAF-bool","M8 INC after bool","knowledge","br_after","C80",2571],["M8-INC-BAS-bool","M8 INC async bool","knowledge","br_async","C80",2730],["M8-INC-SA-bool","M8 INC script action","knowledge","script_action","C85",2478],["M8-INC-UI-bool","M8 INC botão bool","knowledge","ui_action","C95",2707],["M8-INC-CS-bool","M8 INC client bool","knowledge","client_script","C80",2585],["M8-INC-JOB-bool","M8 INC job bool","knowledge","scheduled_job","C70",2381],["M8-INC-ORD-bool","M8 INC ordem 300 bool","knowledge","br_before","C80",2842],["M8-INC-SI-bool","M8 INC chama SI bool → PTM8GravaINC","knowledge","br_via_script_include","C80",2322],["M8-CHG-PFORM-choice","change_request","change_request.impact","user_action","C80",2115],["M8-CHG-PAPI-choice","change_request","change_request.impact","user_action","C75",2212],["M8-CHG-BBF-choice","M8 CHG before choice","change_request.impact","br_before","C130",2480],["M8-CHG-BBA-choice","M8 CHG before choice","change_request.impact","br_before","C80",2602],["M8-CHG-BAF-choice","M8 CHG after choice","change_request.impact","br_after","C80",2403],["M8-CHG-BAS-choice","M8 CHG async choice","change_request.impact","br_async","C80",2167],["M8-CHG-SA-choice","M8 CHG script action","change_request.impact","script_action","C85",2281],["M8-CHG-UI-choice","M8 CHG botão choice","change_request.impact","ui_action","C95",2626],["M8-CHG-CS-choice","M8 CHG client choice","change_request.impact","client_script","C80",2505],["M8-CHG-JOB-choice","M8 CHG job choice","change_request.impact","scheduled_job","C70",2432],["M8-CHG-ORD-choice","M8 CHG ordem 300 choice","change_request.impact","br_before","C80",3053],["M8-CHG-SI-choice","M8 CHG chama SI choice → PTM8GravaCHG","change_request.impact","br_via_script_include","C80",2484],["M8-CHG-PFORM-text","change_request","change_request.justification","user_action","C80",2370],["M8-CHG-PAPI-text","change_request","change_request.justification","user_action","C75",2120],["M8-CHG-BBF-text","M8 CHG before text","change_request.justification","br_before","C130",2362],["M8-CHG-BBA-text","M8 CHG before text","change_request.justification","br_before","C80",2454],["M8-CHG-BAF-text","M8 CHG after text","change_request.justification","br_after","C80",2467],["M8-CHG-BAS-text","M8 CHG async text","change_request.justification","br_async","C80",2459],["M8-CHG-SA-text","M8 CHG script action","change_request.justification","script_action","C85",2485],["M8-CHG-UI-text","M8 CHG botão text","change_request.justification","ui_action","C95",2194],["M8-CHG-CS-text","M8 CHG client text","change_request.justification","client_script","C80",2432],["M8-CHG-JOB-text","M8 CHG job text","change_request.justification","scheduled_job","C70",2334],["M8-CHG-ORD-text","M8 CHG ordem 300 text","change_request.justification","br_before","C80",2519],["M8-CHG-SI-text","M8 CHG chama SI text → PTM8GravaCHG","change_request.justification","br_via_script_include","C80",2236],["M8-CHG-PFORM-ref","change_request","change_request.assignment_group","user_action","C80",2342],["M8-CHG-PAPI-ref","change_request","change_request.assignment_group","user_action","C75",2289],["M8-CHG-BBF-ref","M8 CHG before ref","change_request.assignment_group","br_before","C130",2253],["M8-CHG-BBA-ref","M8 CHG before ref","change_request.assignment_group","br_before","C80",2533],["M8-CHG-BAF-ref","M8 CHG after ref","change_request.assignment_group","br_after","C80",2408],["M8-CHG-BAS-ref","M8 CHG async ref","change_request.assignment_group","br_async","C80",2444],["M8-CHG-SA-ref","M8 CHG script action","change_request.assignment_group","script_action","C85",2541],["M8-CHG-UI-ref","M8 CHG botão ref","change_request.assignment_group","ui_action","C95",2411],["M8-CHG-CS-ref","M8 CHG client ref","change_request.assignment_group","client_script","C80",2432],["M8-CHG-JOB-ref","M8 CHG job ref","change_request.assignment_group","scheduled_job","C70",2553],["M8-CHG-ORD-ref","M8 CHG ordem 300 ref","change_request.assignment_group","br_before","C80",2613],["M8-CHG-SI-ref","M8 CHG chama SI ref → PTM8GravaCHG","change_request.assignment_group","br_via_script_include","C80",2560],["M8-CHG-PFORM-bool","change_request","change_request.cab_required","user_action","C80",2242],["M8-CHG-PAPI-bool","change_request","change_request.cab_required","user_action","C75",2283],["M8-CHG-BBF-bool","M8 CHG before bool","change_request.cab_required","br_before","C130",2531],["M8-CHG-BBA-bool","M8 CHG before bool","change_request.cab_required","br_before","C80",2449],["M8-CHG-BAF-bool","M8 CHG after bool","change_request.cab_required","br_after","C80",2365],["M8-CHG-BAS-bool","M8 CHG async bool","change_request.cab_required","br_async","C80",2387],["M8-CHG-SA-bool","M8 CHG script action","change_request.cab_required","script_action","C85",2466],["M8-CHG-UI-bool","M8 CHG botão bool","change_request.cab_required","ui_action","C95",2116],["M8-CHG-CS-bool","M8 CHG client bool","change_request.cab_required","client_script","C80",2319],["M8-CHG-JOB-bool","M8 CHG job bool","change_request.cab_required","scheduled_job","C70",2263],["M8-CHG-ORD-bool","M8 CHG ordem 300 bool","change_request.cab_required","br_before","C80",2309],["M8-CHG-SI-bool","M8 CHG chama SI bool → PTM8GravaCHG","change_request.cab_required","br_via_script_include","C80",2397],["W9-PESSOA-impact","incident","impact","user_action","C75",2298],["W9-BR-urgency","W9 before urgency","urgency","br_before","C80",2504],["W9-BR-contact_type","incident","contact_type","user_action","C75",2444],["W9-CS-description","W9 client descrição","description","client_script","C80",2417],["W9-CS-contact_type","incident","contact_type","user_action","C75",2194],["W9-BOTH-urgency","W9 before urgency","urgency","br_before","C80",2377],["W9-BOTH-description","W9 client descrição","description","client_script","C80",2337],["W9-BOTH-contact_type","incident","contact_type","user_action","C75",2209],["F9-B1","F9 Impacto para software","impact","br_before","C80",2185],["F9-B2","F9 Distribui mudanças de infraestrutura","change_request.assignment_group","scheduled_job","C70",2741],["F9-B3","F9 Gera plano de implementação → PTF9Politicas","change_request.implementation_plan","br_via_script_include","P65",2558],["F9-B4","change_request","change_request.impact","user_action","C80",1846],["F9-B5","F9 Plano de retorno padrão","change_request.backout_plan","br_after","C80",2174],["F9-B6","F9 Impressoras fiscais","assignment_group","assignment_rule","P65",2408],["F9-B7","F9 Justificativa para o CAB","change_request.justification","script_action","C85",2147],["F9-B8","F9 Escalar para N2","urgency","ui_action","C95",2230],["F9-B9","F9 Aplica política de banco → PTF9Politicas","notify","br_via_script_include","P65",2247],["F9-B10","F9 Testes por risco","change_request.test_plan","br_before","P65",2165],["F9-B11","F9 Sugere urgência pelo impacto","urgency","client_script","C80",2212],["F9-B12","F9 Registra histórico de rede","description","br_after","P65",2254],["F9-B13","F9 Monta resumo de impacto","description","br_before","C115",2234],["F9-B14","F9 Revisão final de testes","change_request.test_plan","br_after","C80",2256],["F9-B15","F9 Urgência ramal executivo","urgency","br_before","C80",2067],["F9-B16","F9 Marca para base de conhecimento","knowledge","br_async","C80",2196],["F9-B17","F9 Impacto por canal digital","impact","br_before","C130",2225],["F9-B18","F9 Reclassificar impacto","change_request.impact","ui_action","C95",2065],["F9-B19","F9 Roteia rede por urgência","assignment_group","br_after","C80",2083],["F9-B20","F9 Fila de provisionamento","sc_req_item.assignment_group","br_async","C80",1960],["F9-B21","F9 Sugere técnico de hardware","assigned_to","client_script","C80",2487],["F9-B22","F9 Reavaliação noturna de impacto","impact","scheduled_job","C70",2359],["F9-B23","incident","category","user_action","C80",2150],["F9-B24","F9 Solicitar aprovação do CAB","change_request.cab_required","ui_action","C95",2133],["F9-B25","Priority Lookup","priority","data_lookup","C115",2316],["F9-B26","F9 Severidade por urgência crítica","severity","br_before","C80",2174],["F9-B27","F9 Atribui DBA de plantão","assigned_to","script_action","C85",2209],["F9-B28","incident","impact","user_action","C75",2451],["F9-B29","F9 Risco sugerido por categoria","change_request.risk","client_script","C80",2196],["F9-B30","incident","contact_type","user_action","C75",2213],["M8-INB-PAPI-date","incident","follow_up","user_action","C75",2015],["M8-INB-BBA-date","M8 INB before date","follow_up","br_before","C80",2318],["M8-INB-BAF-date","M8 INB after date","follow_up","br_after","C80",2403],["M8-INB-BAS-date","M8 INB async date","follow_up","br_async","C80",2338],["M8-INB-SA-date","M8 INB script action","follow_up","script_action","C85",2314],["M8-INB-UI-date","M8 INB botão date","follow_up","ui_action","C95",2343],["M8-INB-JOB-date","M8 INB job date","follow_up","scheduled_job","C70",2762],["M8-INB-ORD-date","M8 INB ordem 300 date","follow_up","br_before","C80",2489],["M8-INB-SI-date","M8 INB chama SI date → PTM8GravaINB","follow_up","br_via_script_include","C80",2702],["M8-INB-PAPI-int","incident","order","user_action","C75",2891],["M8-INB-BBA-int","M8 INB before int","order","br_before","C80",3282],["M8-INB-BAF-int","M8 INB after int","order","br_after","C80",3053],["M8-INB-BAS-int","M8 INB async int","order","br_async","C80",3160],["M8-INB-SA-int","M8 INB script action","order","script_action","C85",2999],["M8-INB-UI-int","M8 INB botão int","order","ui_action","C95",2907],["M8-INB-JOB-int","M8 INB job int","order","scheduled_job","C70",2801],["M8-INB-ORD-int","M8 INB ordem 300 int","order","br_before","C80",4150],["M8-INB-SI-int","M8 INB chama SI int → PTM8GravaINB","order","br_via_script_include","C80",3281],["M8-CHB-PAPI-date","change_request","change_request.expected_start","user_action","C75",2839],["M8-CHB-BBA-date","M8 CHB before date","change_request.expected_start","br_before","C80",3209],["M8-CHB-BAF-date","M8 CHB after date","change_request.expected_start","br_after","C80",3670],["M8-CHB-BAS-date","M8 CHB async date","change_request.expected_start","br_async","C80",3114],["M8-CHB-SA-date","M8 CHB script action","change_request.expected_start","script_action","C85",3032],["M8-CHB-UI-date","M8 CHB botão date","change_request.expected_start","ui_action","C95",2665],["M8-CHB-JOB-date","M8 CHB job date","change_request.expected_start","scheduled_job","C70",2726],["M8-CHB-ORD-date","M8 CHB ordem 300 date","change_request.expected_start","br_before","C80",6920],["M8-CHB-SI-date","M8 CHB chama SI date → PTM8GravaCHB","change_request.expected_start","br_via_script_include","C80",3295],["M8-CHB-PAPI-int","change_request","change_request.order","user_action","C75",2882],["M8-CHB-BBA-int","M8 CHB before int","change_request.order","br_before","C80",3230],["M8-CHB-BAF-int","M8 CHB after int","change_request.order","br_after","C80",3325],["M8-CHB-BAS-int","M8 CHB async int","change_request.order","br_async","C80",3300],["M8-CHB-SA-int","M8 CHB script action","change_request.order","script_action","C85",3132],["M8-CHB-UI-int","M8 CHB botão int","change_request.order","ui_action","C95",2925],["M8-CHB-JOB-int","M8 CHB job int","change_request.order","scheduled_job","C70",2983],["M8-CHB-ORD-int","M8 CHB ordem 300 int","change_request.order","br_before","C80",3153],["M8-CHB-SI-int","M8 CHB chama SI int → PTM8GravaCHB","change_request.order","br_via_script_include","C80",3330],["F10-B1","F10 Conhecimento para tarefas urgen","sc_task.knowledge","br_async","C80",2740],["F10-B2","F10 Contorno para DNS","problem.workaround","br_before","C130",2867],["F10-B3","F10 Técnico presencial do auditório","assigned_to","br_before","C80",2617],["F10-B4","F10 Concluir teste com ressalvas","change_task.close_code","ui_action","C95",1939],["F10-B5","F10 Problemas de banco de dados","problem.assignment_group","assignment_rule","P65",2266],["F10-B6","change_request","change_request.category","user_action","C80",2184],["F10-B7","F10 Fim planejado pela duração","change_task.planned_end_date","br_before","C115",1932],["F10-B8","F10 Define prazo de correção","problem.due_date","script_action","C70",2084],["F10-B9","F10 Impacto sugerido para hardware","impact","client_script","C80",2196],["F10-B10","F10 Registra encaminhamento","sc_task.description","br_after","P65",2131],["F10-B11","F10 Registra responsável pela análi → PTF10Rotinas","problem.cause_notes","br_via_script_include","P65",2251],["F10-B12","change_task","change_task.on_hold","user_action","C75",2100],["F10-B13","F10 Ativação de licenças pendentes","sc_task.description","scheduled_job","C70",1964],["F10-B14","Priority Problem Lookup","problem.priority","data_lookup","P65",2105],["F10-B15","F10 Fim da janela","change_request.end_date","br_before","C115",2234],["F10-B16","F10 Prazo pelo técnico designado","sc_task.due_date","br_before","P65",2156],["F10-B17","F10 Grupo para falhas de memória","problem.assignment_group","br_before","C80",2194],["F10-B18","incident","urgency","user_action","C75",2049],["F10-B19","F10 Instruções para o responsável → PTF10Rotinas","change_task.description","br_via_script_include","P65",2107],["F10-B20","F10 Problema grave por impacto","problem.major_problem","br_before","C80",2111],["F10-B21","F10 Fila de suprimentos","sc_task.assignment_group","script_action","C85",2118],["F10-B22","F10 Notas de encerramento","change_task.close_notes","br_before","C115",1893],["F10-B23","F10 Plano de correção por impacto","problem.fix_notes","br_async","P65",1973],["F10-B24","F10 Sistema de produção por categor","change_request.production_system","br_before","C80",2031],["F10-B25","F10 Marcar como erro conhecido","problem.known_error","ui_action","C95",1975],["F10-B26","F10 Escala tarefa em espera","change_task.assignment_group","br_after","C80",1950],["F10-B27","incident","contact_type","user_action","C75",2316],["F10-B28","F10 Encaminhar para redes","sc_task.assignment_group","ui_action","C95",2037],["F10-B29","F10 Sugere início da implementação","change_task.planned_start_date","client_script","P65",1965],["F10-B30","F10 Sugere causa provável","problem.cause_notes","client_script","C80",1981],["F11-H1","F11 Designa plantonista → PTF11Rotinas","assigned_to","br_via_script_include","P65",3654],["F11-H2","F11 Registra início da análise → PTF11Rotinas","problem.cause_notes","br_via_script_include","P65",3688],["F11-H3","incident","urgency","user_action","C75",3361],["F11-H4","F11 Impressoras de loja","assignment_group","assignment_rule","P65",3639],["F11-H5","F11 Plano para impacto médio","change_request.implementation_plan","br_async","C80",3921],["F11-H6","F11 Grupo para atendimento presenci","assignment_group","client_script","C80",3141],["F11-H7","F11 Justificativa por risco","change_request.justification","br_after","C80",2966],["F11-H8","F11 Causa provável de rede","problem.cause_notes","br_before","C80",5422],["F11-H9","F11 Plano sugerido para rede","change_request.implementation_plan","client_script","C80",16966],["F11-H10","F11 Grupo de crise","problem.assignment_group","br_before","C80",5622],["F11-H11","F11 Escala chamados urgentes de loj","assignment_group","br_after","C80",3248],["F11-H12","F11 Consolida análises do LDAP","problem.cause_notes","scheduled_job","C70",4232],["F11-H13","F11 Escalar para software","problem.assignment_group","ui_action","C95",3280],["F11-H14","F11 Problemas de banco do ERP","problem.assignment_group","assignment_rule","P65",4275],["F11-H15","F11 Contorno por causa","problem.workaround","script_action","C85",3313],["F11-H16","change_request","change_request.justification","user_action","C80",2939],["F11-H17","Priority Problem Lookup","problem.priority","data_lookup","P65",3264],["F11-H18","F11 Plano após revisão técnica","change_request.implementation_plan","script_action","C85",2956],["F11-H19","F11 Elevar impacto","impact","ui_action","C95",3016],["F11-H20","F11 Revisão da justificativa → PTF11Rotinas","change_request.assignment_group","br_via_script_include","P65",2983],["F11-H21","F11 Contorno para urgentes","problem.workaround","br_async","C80",3120],["F11-H22","F11 Sugere contorno de rede","problem.workaround","client_script","C80",2844],["F11-H23","F11 Técnico de software","assigned_to","br_before","C130",3460],["F11-H24","F11 Impacto avaliado pela rede","impact","script_action","C85",3242],["F11-H25","F11 Mudanças de rede","change_request.assignment_group","assignment_rule","P65",2899],["F11-H26","change_request","change_request.risk","user_action","C75",2921],["F11-H27","F11 Grupo para alto risco","change_request.assignment_group","br_before","C80",3357],["F11-H28","incident","impact","user_action","C80",3798],["F11-H29","F11 Revisa justificativas de certificado","change_request.justification","scheduled_job","C70",3170],["F11-H30","F11 Reavalia impacto por urgência","impact","br_async","C80",3157],["I12-01","conta de integração","description","user_action","C85",3090],["I12-02a","I12 Nota de origem externa","close_notes","br_before","C80",3440],["I12-02b","conta de integração","urgency","user_action","C85",3510],["I12-03a","I12 Referência do ERP","correlation_display","br_after","C80",3458],["I12-03b","conta de integração","impact","user_action","C85",3077],["I12-04a","I12 Protocolo de sincronização","correlation_id","br_async","C80",2439],["I12-04b","conta de integração","category","user_action","C85",2355],["I12-05","I12 Categoria da operadora","category","br_before","P45",2223],["I12-06","conta de integração","description","user_action","C85",2290],["I12-07a","conta de integração","description","user_action","C85",2469],["I12-07b","incident","close_notes","user_action","C75",2991],["I12-08","conta de integração","description","user_action","P55",3344],["I12-09a","I12 Equipamentos de campo","assignment_group","assignment_rule","P65",3310],["I12-09b","conta de integração","category","user_action","C85",4238],["I12-10","conta de integração","assignment_group","user_action","C85",4142],["I12-11a","conta de integração","description","user_action","C85",3019],["I12-11b","conta de integração","description","user_action","C85",3044],["F13-IMP1-description","F13 Chamados do parceiro","description","import_set","C95",3347],["F13-IMP1-close_notes","F13 Chamados do parceiro","close_notes","import_set","C80",2939],["F13-IMP1-correlation_id","F13 Chamados do parceiro","correlation_id","import_set","C80",3330],["F13-IMP1-correlation_display","F13 Chamados do parceiro","correlation_display","import_set","C80",3162],["F13-IMP1-category","F13 Hardware do parceiro vira rede","category","br_before","C80",3097],["F13-IMP1-urgency","F13 Urgência do parceiro","urgency","br_after","C80",3383],["F13-IMP2-description-2","F13 Chamados do parceiro","description","import_set","C95",3151],["F13-IMP2-description-1","F13 Chamados do parceiro","description","import_set","C95",3020],["F13-IMP2-correlation_id-2","F13 Chamados do parceiro","correlation_id","import_set","C80",3711],["F13-IMP2-category","F13 Chamados do parceiro","category","import_set","C95",3654],["F13-IMP3-impact","incident","impact","user_action","C75",3066],["F13-IMP3-description","F13 Chamados do parceiro","description","import_set","C95",3906],["F13-UIP1-description","F13 Rede pede verificação de DNS","description","ui_policy","C80",3618],["F13-UIP1-close_notes","F13 Fora de rede limpa a nota","close_notes","ui_policy","C80",5911],["F13-UIP1-category","incident","category","user_action","C80",3546],["F13-UIP2-close_notes","F13 Fora de rede limpa a nota","close_notes","ui_policy","C80",4100],["F13-UIP2-category","incident","category","user_action","C80",3484],["F13-UIP3-description","incident","description","user_action","C80",3878],["F13-UIP3-close_notes","F13 Fora de rede limpa a nota","close_notes","ui_policy","C80",3381],["F13-DP1-close_notes","incident","close_notes","user_action","C75",2942],["F13-LIST1-category","incident","category","user_action","P45",3584],["F13-LIST2-description","incident","description","user_action","C80",6855],["F13-LIST2-urgency","incident","urgency","user_action","C80",4147],["F13-LIST3-description","incident","description","user_action","C80",3153],["F13-LIST3-urgency","incident","urgency","user_action","C80",2523],["F14-SUB1-description","F14 flow chama subflow · subflow [PT] F14 subflow descricao · passo 1.1 (Update Record)","description","flow","C85",3081],["F14-SUB1-urgency","incident","urgency","user_action","C75",3107],["F15-T01","F15 Periféricos de loja","assignment_group","assignment_rule","P65",2917],["F15-T02","incident","assignment_group","user_action","C80",2953],["F15-T03","F15 Encaminhar ao service desk","assignment_group","ui_action","C95",3233],["F15-T04","F15 Nota de urgência média","close_notes","br_before","C80",3235],["F15-T05","F15 Nota de impacto assíncrona","close_notes","br_async","C80",4314],["F15-T06","F15 Revisão noturna das notas","close_notes","scheduled_job","C70",4511],["F15-T07","F15 Descrição para autoatendimento","description","client_script","C80",4996],["F15-T08","F15 Hardware pede patrimônio","description","ui_policy","C80",4430],["F15-T09","F15 Fora de rede registra nota","close_notes","ui_policy","C80",3684],["F15-T10","incident","category","user_action","C80",5168],["F15-T11","F15 Pedidos da transportadora","description","import_set","C95",4455],["F15-T12","F15 Pedidos da transportadora","correlation_display","import_set","C80",3040],["F15-T13","F15 Pedidos da transportadora","correlation_id","import_set","C80",3324],["F15-T14","F15 Categoria da transportadora","category","br_before","C80",2876],["F15-T15","F15 Urgência da transportadora","urgency","br_after","C80",3145],["F15-T16","F15 Pedidos da transportadora","description","import_set","C95",3566],["F15-T17","incident","description","user_action","C75",3861],["F15-T18","F15 Pedidos da transportadora","description","import_set","C95",6261],["F15-T19","incident","description","user_action","P45",4652],["F15-T20","F15 Nota de origem do lote","close_notes","br_before","C80",6971],["F15-T21","F15 Designa técnico de campo → PTF15Rotinas","assigned_to","br_via_script_include","P65",5976],["F15-T22","incident","assigned_to","user_action","C75",4914],["F15-T23","F15 Assumir atendimento","assigned_to","ui_action","C95",6611],["F15-T24","incident","close_notes","user_action","C75",4025],["F15-T25","F15 Contorno para rede","problem.workaround","br_before","C80",5215],["F15-T26","F15 Aplicar contorno padrão","problem.workaround","ui_action","C95",4645],["F15-T27","problem","problem.workaround","user_action","C75",4792],["F15-T28","F15 Diagnóstico do backup → PTF15Rotinas","problem.cause_notes","br_via_script_include","P65",6232],["F15-T29","F15 Consolida diagnósticos","problem.cause_notes","scheduled_job","C70",5567],["F15-T30","change_request","change_request.implementation_plan","user_action","C80",6161],["F15-T31","F15 Plano para risco alto","change_request.implementation_plan","br_after","C80",4588],["F15-T32","F15 Congelar plano","change_request.implementation_plan","ui_action","C95",4634],["F15-T33","F15 Retorno para impacto alto","change_request.backout_plan","client_script","C80",4080],["F15-T34","change_request","change_request.justification","user_action","C75",4065],["F15-T35","F15 Padroniza justificativas","change_request.justification","scheduled_job","C70",2489],["F16-SLA1-has_breached","task_sla","task_sla.has_breached","unaudited","U",2577],["F17-PP-0","F17 Urgência volta para baixa","urgency","br_async","C80",5386],["F17-PP-1","F17 Urgência média ao descrever","urgency","br_before","C80",4360],["F16-X04","F16 Instruções da licença","sc_task.description","br_async","C80",3340],["F16-X05","F16 Revisa instruções de licença","sc_task.description","scheduled_job","C70",3871],["F16-X06","F16 Responsável do acesso → PTF16Rotinas","sc_task.assigned_to","br_via_script_include","P65",4048],["F16-X07","sc_task","sc_task.assigned_to","user_action","P45",4463],["F16-X08","F16 Roteiro de entrega urgente","sc_task.description","client_script","C80",4040],["F16-X09","F16 Especificação do notebook","sc_req_item.description","br_before","C80",4336],["F16-X10","F16 Padronizar especificação","sc_req_item.description","ui_action","C95",4422],["F16-X11","sc_req_item","sc_req_item.description","user_action","C75",4507],["F16-X12","sc_req_item","sc_req_item.assignment_group","user_action","P45",2458],["F16-X13","F16 Código da licença","sc_req_item.correlation_id","br_before","C80",3091],["F16-X14","F16 Renova códigos de licença","sc_req_item.correlation_id","scheduled_job","C70",3498],["F16-X15","F16 Termo de acesso financeiro","sc_req_item.description","br_after","C80",4054],["F16-X16","cmdb_ci_computer","cmdb_ci_computer.os_version","user_action","C80",3724],["F16-X17","F16 Descrição pela versão do SO","cmdb_ci_computer.short_description","client_script","C80",3364],["F16-X18","F16 Nota de memória ampliada","cmdb_ci_computer.comments","br_before","C80",3489],["F16-X19","F16 Marcar para recolhimento","cmdb_ci_computer.comments","ui_action","C95",6736],["F16-X20","F16 Inventário de notebooks","cmdb_ci_computer.serial_number","import_set","C95",5012],["F16-X21","cmdb_ci_computer","cmdb_ci_computer.serial_number","user_action","C75",3749],["F16-X22","F16 Inventário de notebooks","cmdb_ci_computer.serial_number","import_set","C95",3841],["F16-X23","F16 Inventário de notebooks","cmdb_ci_computer.os_version","import_set","C95",3364],["F16-X24","F16 Descrição pós-inventário","cmdb_ci_computer.short_description","br_after","C80",3334],["F16-X25","F16 Suporte do servidor → PTF16Rotinas","cmdb_ci_server.support_group","br_via_script_include","P65",3650],["F16-X26","F16 Realinha suporte de servidores","cmdb_ci_server.support_group","scheduled_job","C70",5597],["F16-X32","F16 Aviso de VPN no artigo","kb_knowledge.text","br_after","C80",3413],["F16-X33","F16 Revisão técnica do artigo → PTF16Rotinas","kb_knowledge.text","br_via_script_include","P65",2754],["F16-X34","kb_knowledge","kb_knowledge.meta","user_action","P45",2932],["F16-X35","F16 Renova validade das políticas","kb_knowledge.valid_to","scheduled_job","C70",3495],["F18-B-urgency","F18 Urgência pelo impacto","urgency","br_before","C130",5242],["F18-B-impact","incident","impact","user_action","C125",5347],["F18-B-priority","Priority Lookup","priority","data_lookup","C115",4957],["F18-A-description","incident","description","user_action","C125",3360],["F18-C-description","F18 Job que atualiza descrição","description","scheduled_job","C80",4668]]};
  const TYPE_MAP = { br_async: 'BR assíncrona', br_before: 'BR before', br_after: 'BR after', br_via_script_include: 'BR → script include', script_action: 'Script action', background_script: 'Script de fundo', scheduled_job: 'Job agendado', flow: 'Flow Designer', workflow: 'Workflow', ui_action: 'UI action', user_action: 'Ação do usuário', user_api: 'Ação via API', user_integration: 'Conta de integração (API)', assignment_rule: 'Regra de atribuição', data_lookup: 'Data lookup', client_script: 'Client script', import_set: 'Importação · transform map', ui_policy: 'UI policy', server_change: 'Servidor ao salvar', unaudited: 'Atualização sem auditoria' };
  const PHASE_MAP = { C1: 'Incidente (caso base)', C2: 'Incidente (BR before)', C3: 'Incidente (Script Include)', C4: 'Incidente (Evento + Script Action)', C5: 'Incidente (Script de fundo)', C5b: 'Incidente (Job agendado)', C6: 'Incidente (Flow Designer)', C8: 'Incidente (UI Action)', C9: 'Incidente (Sem auditoria)', F1: 'Fase 1 · atribuição, lookup e sequência', F2: 'Fase 2 · vários campos na mesma gravação', F3: 'Fase 3 · edição pelo formulário e diff de script', F4: 'Fase 4 · Import Set e transform map', F5: 'Fase 5 · ordem de regras e cascata', F6: 'Fase 6 · teste às cegas 1', F7: 'Fase 7 · change_request, sc_req_item e customizada', M8: 'Fase 8 · matriz de mecanismos × tipos de campo', W9: 'Fase 9 · Service Operations Workspace', F9: 'Fase 9 · teste às cegas 2 (cadeias e iscas)', F10: 'Fase 10 · teste às cegas 3 (várias tabelas e Workspace)', F11: 'Fase 11 · teste às cegas 4 (histórico longo do campo)', I12: 'Fase 12 · conta de integração e Batch API', F13: 'Fase 13 · Import Set, UI policy, data policy e lista', F14: 'Fase 14 · Flow Designer com subflow', F15: 'Fase 15 · teste às cegas 5 (14 mecanismos misturados)', F16: 'Fase 16 · teste às cegas 6 (CMDB, catálogo e KB)', F17: 'Fase 17 · pingue-pongue entre duas automações', F18: 'Fase 18 · contexto gravado na instância' };
  const ALL_EXTRA = [
    ...EXTRA_DATA.summary15,
    ...EXTRA_DATA.compact.map(([id, art, fld, t, g, ms]) => {
      const pref = id.split('-')[0];
      const ph = PHASE_MAP[pref] || 'Bateria PDI';
      const scen = art && !['incident', 'problem', 'change_request', 'sc_req_item', 'sc_task', 'change_task'].includes(art) ? ph + ' · ' + art : ph + ' (' + art + ')';
      const gLbl = g === 'U' ? 'DETECTADO' : (g[0] === 'C' ? 'CONFIRMADO ' : g[0] === 'P' ? 'PROVÁVEL ' : 'CANDIDATO ') + g.slice(1);
      return [id, scen, fld, TYPE_MAP[t] || t, gLbl, ms];
    }),
  ];
  const tblBody = $('#tbl tbody'), tblMore = $('#tbl-more'), tblLess = $('#tbl-less'), tblCount = $('#tbl-count');
  let extraIdx = 0;
  const updateTblUi = () => {
    const shown = 30 + extraIdx;
    if (tblCount) tblCount.textContent = `Mostrando ${shown} de 441`;
    const rem = 441 - shown;
    if (tblMore) {
      tblMore.hidden = rem <= 0;
      if (rem > 0) tblMore.textContent = `Ver mais (+${Math.min(30, rem)})`;
    }
    if (tblLess) tblLess.hidden = extraIdx === 0;
  };
  if (tblMore && tblBody) {
    tblMore.addEventListener('click', () => {
      const slice = ALL_EXTRA.slice(extraIdx, extraIdx + 30);
      slice.forEach(([id, scen, fld, tp, gr, ms]) => {
        const tr = document.createElement('tr');
        const cls = gr.startsWith('PROVÁVEL') ? 'g p' : (gr.startsWith('CANDIDATO') || gr === 'DETECTADO') ? 'g d' : 'g';
        tr.innerHTML = `<td class="m"></td><td></td><td class="m"></td><td></td><td><span class="${cls}"></span></td><td class="ms"></td>`;
        const tds = $$('td', tr);
        tds[0].textContent = id;
        tds[1].textContent = scen;
        tds[2].textContent = fld;
        tds[3].textContent = tp;
        $('span', tds[4]).textContent = gr;
        tds[5].textContent = String(ms);
        tblBody.appendChild(tr);
      });
      tbl?.classList.add('in');
      extraIdx += slice.length;
      updateTblUi();
    });
  }
  if (tblLess && tblBody) {
    tblLess.addEventListener('click', () => {
      const rows = $$('tr', tblBody);
      rows.slice(30).forEach((r) => r.remove());
      extraIdx = 0;
      updateTblUi();
      tbl?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // ---- roadmap: mostrar no máximo 5 itens por fase + botão Ver mais
  $$('.road-more').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = btn.closest('div');
      const open = box.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? btn.dataset.less : btn.dataset.more;
    });
  });

  // ---- dentro do painel (#painel): linha do tempo vertical + autoplay de 5s sem sticky
  const insideImg = $('#inside-img'), insideFrame = $('#inside-frame'), insideBox = $('#inside-box');
  const cos = $$('#callouts .co');
  if (insideImg && cos.length) {
    const seen = new Set([0]);
    let cur = 0, elapsed = 0, lastTs = performance.now(), paused = false, inView = false;
    const STEP_MS = 5000;
    const go = (idx, reset = true) => {
      cur = (idx + cos.length) % cos.length;
      seen.add(cur);
      cos.forEach((c, i) => {
        c.classList.toggle('on', i === cur);
        c.classList.toggle('seen', seen.has(i) && i !== cur);
        c.style.setProperty('--p', '0');
      });
      const co = cos[cur];
      insideFrame?.contentWindow?.postMessage({ type: 'trail-demo-tab', tab: co.dataset.tab }, '*');
      insideImg.style.transform = `translateY(${-(+co.dataset.y || 0)}px)`;
      if (reset) { elapsed = 0; lastTs = performance.now(); }
    };
    cos.forEach((co, i) => co.addEventListener('click', () => go(i, true)));
    if (insideBox) {
      insideBox.addEventListener('pointerenter', () => { paused = true; });
      insideBox.addEventListener('pointerleave', () => { paused = false; lastTs = performance.now(); });
    }
    if (!reduce) {
      const pio = new IntersectionObserver((es) => es.forEach((e) => {
        inView = e.isIntersecting;
        if (inView) lastTs = performance.now();
      }), { threshold: .15 });
      pio.observe($('#painel') || insideImg);
      const stepLoop = (now) => {
        const dt = now - lastTs;
        lastTs = now;
        if (inView && !paused && !document.hidden) {
          elapsed += dt;
          cos[cur].style.setProperty('--p', Math.min(1, elapsed / STEP_MS).toFixed(3));
          if (elapsed >= STEP_MS) go(cur + 1, true);
        }
        requestAnimationFrame(stepLoop);
      };
      requestAnimationFrame(stepLoop);
    }
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
