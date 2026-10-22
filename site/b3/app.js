(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // nav
  const nav = $('#nav');
  addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 40), { passive: true });

  // ---------- suporte bilíngue (PT / EN) ----------
  let currentLang = new URLSearchParams(location.search).get('lang') === 'en' || localStorage.getItem('trail_lang') === 'en' ? 'en' : 'pt';
  const SCRAMBLE_DATA = {
    pt: ['// por que esse campo mudou?', '// quem resolveu esse incidente?', '// que regra alterou a prioridade?', '// foi job, flow ou alguém?', '// extensão para ServiceNow · somente leitura'],
    en: ['// why did this field change?', '// who resolved this incident?', '// which rule changed priority?', '// was it job, flow or someone?', '// ServiceNow extension · read-only']
  };
  const CAPS_DATA = {
    pt: [
      ['who', 'Quem mudou e quando', 'sys_audit · histórico do formulário'],
      ['rules', 'Regras automáticas', 'sys_script · sys_script_include'],
      ['flows', 'Flows e workflows', 'sys_flow_context · wf_context'],
      ['jobs', 'Jobs agendados', 'sysauto_script'],
      ['events', 'Eventos e script actions', 'sysevent · sysevent_script_action'],
      ['actions', 'Botões do formulário', 'sys_ui_action'],
      ['tx', 'Prova de formulário, API ou job', 'syslog_transaction'],
    ],
    en: [
      ['who', 'Who changed it and when', 'sys_audit · form history'],
      ['rules', 'Automated rules', 'sys_script · sys_script_include'],
      ['flows', 'Flows and workflows', 'sys_flow_context · wf_context'],
      ['jobs', 'Scheduled jobs', 'sysauto_script'],
      ['events', 'Events and script actions', 'sysevent · sysevent_script_action'],
      ['actions', 'Form buttons', 'sys_ui_action'],
      ['tx', 'Form, API or job evidence', 'syslog_transaction'],
    ]
  };
  const PROFILES_DATA = {
    pt: {
      admin: { v: ['Acesso completo', 'Perícia completa.', 'O Trail lê todas as fontes. O painel não mostra nenhum aviso.'] },
      itil: { v: ['Sem admin · itil', 'Quem mudou e quando, pelo histórico do formulário.', 'A auditoria completa é negada, então o Trail lê o histórico que a pessoa já vê no registro (os campos do Activity Stream). As regras automáticas ficam de fora, e o painel diz isso em palavras.'] },
      flow: { v: ['Sem admin · itil + Flow Designer', 'Linha do tempo e flows.', 'Além do histórico do formulário, o papel de Flow Designer mostra as execuções de flows no registro: o Trail cruza a mudança com elas.'] },
      basic: { v: ['Sem leitura do registro', 'Nada para mostrar.', 'Se o login não lê o registro, o Trail também não lê. Ele nunca vê mais do que a pessoa vê.'] },
    },
    en: {
      admin: { v: ['Full access', 'Complete forensics.', 'Trail reads all sources. The panel shows no warning.'] },
      itil: { v: ['No admin · itil', 'Who changed and when, from form history.', 'Full audit is denied, so Trail reads the history you already see on the record (Activity Stream fields). Automated rules remain excluded, and the panel explains this in plain words.'] },
      flow: { v: ['No admin · itil + Flow Designer', 'Timeline and flows.', 'In addition to form history, the Flow Designer role reveals flow executions on the record: Trail correlates the change with them.'] },
      basic: { v: ['No read access to record', 'Nothing to display.', 'If the user cannot read the record, Trail does not read it either. It never sees more than the user sees.'] },
    }
  };
  const LABEL_DATA = {
    pt: { ok: 'VÊ', part: 'EM PARTE', no: 'NÃO MOSTRA', unit: 'capacidades com o login deste perfil' },
    en: { ok: 'SEES', part: 'PARTIAL', no: 'NOT SHOWN', unit: 'capabilities with this profile login' }
  };
  const CASES_TEXT = {
    pt: {
      state: { who: 'Depois que admin salvou', type: 'BR assíncrona', grade: 'CONFIRMADO', facts: [['+50', 'Job ASYNC às 01:37:02 nomeia a regra'], ['+20', 'O script referencia "state"'], ['+10', 'BR da tabela incident']] },
      impact: { who: 'Ao salvar de pericia.itil', type: 'BR before', grade: 'CONFIRMADO', facts: [['+30', 'O formulário enviou 3, o gravado foi 1'], ['+20', 'Salvo às 02:10:33, na janela'], ['+20', 'O script referencia "impact"'], ['+10', 'BR before da tabela incident']] },
      contact_type: { who: 'Evento do registro', type: 'Script action (evento)', grade: 'CONFIRMADO', facts: [['+50', 'Evento processado no mesmo segundo'], ['+20', 'O script referencia "contact_type"']] },
      severity: { who: 'Job das 23:20', type: 'Job agendado', grade: 'CONFIRMADO', facts: [['+50', 'Transação JOB nomeia o job'], ['+20', 'O script referencia "severity"']] }
    },
    en: {
      state: { who: 'After admin saved', type: 'Async business rule', grade: 'CONFIRMED', facts: [['+50', 'ASYNC job at 01:37:02 names the rule'], ['+20', 'Script references "state"'], ['+10', 'Business rule on incident table']] },
      impact: { who: 'Upon save by pericia.itil', type: 'Before business rule', grade: 'CONFIRMED', facts: [['+30', 'Form submitted 3, stored value was 1'], ['+20', 'Saved at 02:10:33, in window'], ['+20', 'Script references "impact"'], ['+10', 'Before BR on incident table']] },
      contact_type: { who: 'Record event', type: 'Script action (event)', grade: 'CONFIRMED', facts: [['+50', 'Event processed in the same second'], ['+20', 'Script references "contact_type"']] },
      severity: { who: '23:20 scheduled job', type: 'Scheduled job', grade: 'CONFIRMED', facts: [['+50', 'JOB transaction names the job'], ['+20', 'Script references "severity"']] }
    }
  };
  const GAL_CAPTIONS = {
    pt: [
      "Painel · tema escuro (padrão) · cabeçalho com configurações, painel lateral, tema e fechar",
      "Registro inteiro · 'Tudo que mudou' em grupos por momento e 'O que roda neste registro' (regras na ordem de execução com campos gravados, flows, scripts e botões)",
      "Lote pela coluna da lista · mesma animação da trilha com a lupa, grupos por momento e exportação CSV",
      "Flows · execuções reais no registro (estado, horário, subflow recuado abaixo do flow pai e link) e flows configurados na tabela com gatilho e campos que gravam",
      "E se? · simule outro valor antes de salvar e veja quais regras, client scripts ou lookups rodariam",
      "Opções · tema, idioma, onde abrir o painel (na página, lateral ou janela separada), ícones e privacidade"
    ],
    en: [
      "Panel · dark theme (default) · header with settings, side panel, theme and close",
      "Full record · 'Everything that changed' in save groups and 'What runs on this record' (rules in execution order with written fields, flows, scripts and buttons)",
      "Batch by list column · animated progress trail with magnifying glass, save groups and CSV export",
      "Flows · real record executions (status, timestamp, subflow indented under parent flow and link) and configured table flows with triggers and written fields",
      "What if? · simulate another value before saving and see which rules, client scripts or lookups would run",
      "Options · theme, language, where to open panel (in-page, side or separate window), icons and privacy"
    ]
  };

  function updateGalCaptions() {
    const caps = GAL_CAPTIONS[currentLang] || GAL_CAPTIONS.pt;
    $$('#galseg button').forEach((b, i) => { if (caps[i]) b.dataset.c = caps[i]; });
    const act = $('#galseg button.on');
    const galcap = $('#galcap');
    if (act && galcap) galcap.textContent = act.dataset.c;
  }

  function applyLanguage(lang) {
    if (lang !== 'en' && lang !== 'pt') lang = 'pt';
    currentLang = lang;
    document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
    localStorage.setItem('trail_lang', lang);
    const url = new URL(location.href);
    if (lang === 'en') url.searchParams.set('lang', 'en');
    else url.searchParams.delete('lang');
    history.replaceState(null, '', url.toString());

    $$('.lang-btn').forEach((b) => {
      const on = b.dataset.lang === lang;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });

    const dict = window.TRAIL_I18N ? window.TRAIL_I18N[lang] : null;
    if (dict) {
      $$('[data-i18n]').forEach((el) => {
        const k = el.dataset.i18n;
        if (dict[k] !== undefined) el.innerHTML = dict[k];
      });
      $$('[data-i18n-title]').forEach((el) => {
        const k = el.dataset.i18nTitle;
        if (dict[k] !== undefined) { el.title = dict[k]; el.setAttribute('aria-label', dict[k]); }
      });
      if (dict.html_title) document.title = dict.html_title;
      const meta = $('meta[name="description"]');
      if (meta && dict.meta_desc) meta.content = dict.meta_desc;
    }

    if (typeof updateCapUi === 'function') updateCapUi();
    $$('.road-more').forEach((btn) => {
      btn.dataset.more = lang === 'en' ? 'View more (+24)' : 'Ver mais (+24)';
      btn.dataset.less = lang === 'en' ? 'View less' : 'Ver menos';
      const isOpen = btn.closest('div')?.classList.contains('open');
      btn.textContent = isOpen ? btn.dataset.less : btn.dataset.more;
    });
    updateGalCaptions();
  }
  window.applyLanguage = applyLanguage;


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
    const t = (CASES_TEXT[currentLang] && CASES_TEXT[currentLang][key]) || c;
    const who = t.who || c.who;
    const type = t.type || c.type;
    const grade = t.grade || c.grade;
    const facts = t.facts || c.facts;
    const isHigh = grade === 'CONFIRMED' || grade === 'CONFIRMADO';
    $('#p-field').textContent = c.field; $('#p-when').innerHTML = `${c.when} <small style="color:#8c99a5;font-weight:400">· ${who}</small>`;
    $('#p-old').textContent = c.old; $('#p-new').textContent = c.neu; $('#p-type').textContent = type; $('#p-name').textContent = c.name;
    const bd = $('#p-badge'); bd.innerHTML = `${isHigh ? (currentLang === 'en' ? 'HIGH CONFIDENCE' : 'CERTEZA ALTA') : (currentLang === 'en' ? 'MEDIUM CONFIDENCE' : 'CERTEZA MÉDIA')}<i class="stamp-wave"></i>`; bd.classList.toggle('p', !isHigh);
    $('#p-facts').innerHTML = facts.map(([p, tx]) => `<div><b>${p}</b>${tx}</div>`).join('');
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
  // O que cada perfil vê, medido no PDI por personificação (docs/sem-admin.md). Por capacidade, como no painel:
  // o nome técnico fica em letra pequena. ok = vê; part = vê em parte; no = os papéis não mostram.
  const CAPS = [
    ['who', 'Quem mudou e quando', 'sys_audit · histórico do formulário'],
    ['rules', 'Regras automáticas', 'sys_script · sys_script_include'],
    ['flows', 'Flows e workflows', 'sys_flow_context · wf_context'],
    ['jobs', 'Jobs agendados', 'sysauto_script'],
    ['events', 'Eventos e script actions', 'sysevent · sysevent_script_action'],
    ['actions', 'Botões do formulário', 'sys_ui_action'],
    ['tx', 'Prova de formulário, API ou job', 'syslog_transaction'],
  ];
  const all = (v) => Object.fromEntries(CAPS.map(([k]) => [k, v]));
  const PROFILES = {
    admin: { st: all('ok'), v: ['Acesso completo', 'Perícia completa.', 'O Trail lê todas as fontes. O painel não mostra nenhum aviso.'] },
    itil: { st: { ...all('no'), who: 'part' }, v: ['Sem admin · itil', 'Quem mudou e quando, pelo histórico do formulário.', 'A auditoria completa é negada, então o Trail lê o histórico que a pessoa já vê no registro (os campos do Activity Stream). As regras automáticas ficam de fora, e o painel diz isso em palavras.'] },
    flow: { st: { ...all('no'), who: 'part', flows: 'ok' }, v: ['Sem admin · itil + Flow Designer', 'Linha do tempo e flows.', 'Além do histórico do formulário, o papel de Flow Designer mostra as execuções de flows no registro: o Trail cruza a mudança com elas.'] },
    basic: { st: all('no'), v: ['Sem leitura do registro', 'Nada para mostrar.', 'Se o login não lê o registro, o Trail também não lê. Ele nunca vê mais do que a pessoa vê.'] },
  };
  const LABEL = { ok: 'VÊ', part: 'EM PARTE', no: 'NÃO MOSTRA' };
  const srcs = $('#srcs'), verdict = $('#verdict');
  let activeProfile = 'admin';
  function updateCapUi() {
    const caps = CAPS_DATA[currentLang] || CAPS_DATA.pt;
    if (srcs) {
      srcs.innerHTML = caps.map(([k, label, tech]) => `<div class="src cap" data-s="${k}"><span><b>${label}</b><small>${tech}</small></span><span class="st"></span></div>`).join('');
    }
    profile(activeProfile, true);
  }
  function profile(p, instant = false) {
    activeProfile = p;
    const pr = PROFILES[p];
    const profs = PROFILES_DATA[currentLang] || PROFILES_DATA.pt;
    const labels = LABEL_DATA[currentLang] || LABEL_DATA.pt;
    const caps = CAPS_DATA[currentLang] || CAPS_DATA.pt;
    caps.forEach(([k], i) => setTimeout(() => {
      const el = $(`.src[data-s="${k}"]`);
      if (el) {
        el.className = 'src cap ' + ({ ok: 'ok', part: 'em', no: 'no' })[pr.st[k]] + ' flip';
        const st = $('.st', el);
        if (st) st.textContent = labels[pr.st[k]];
      }
    }, (reduce || instant) ? 0 : i * 55));
    const seen = caps.filter(([k]) => pr.st[k] !== 'no').length;
    verdict.className = 'verdict rv in ' + (p === 'admin' ? 'full' : seen ? 'partial' : 'none');
    const [a, b, c] = (profs[p] && profs[p].v) || pr.v;
    $('.lvl', verdict).textContent = a; $('h3', verdict).textContent = b; $('p', verdict).textContent = c;
    $('code', verdict).textContent = currentLang === 'en'
      ? `${seen} of ${caps.length} ${labels.unit}`
      : `${seen} de ${caps.length} ${labels.unit}`;
  }
  $$('#seg button').forEach((b) => b.addEventListener('click', () => { $$('#seg button').forEach((x) => x.classList.toggle('on', x === b)); profile(b.dataset.p); }));
  updateCapUi();

  // ---------- iframes do painel: só carregam perto da tela, no tempo ocioso ----------
  // Cada iframe é o painel inteiro rodando; carregar todos de uma vez travava a rolagem.
  const lazyFrames = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const f = e.target; lazyFrames.unobserve(f);
    const go = () => { if (f.dataset.src && !f.getAttribute('src')) f.setAttribute('src', f.dataset.src); };
    'requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 700 }) : setTimeout(go, 60);
  }), { rootMargin: '600px 0px' });
  $$('iframe[data-src]').forEach((f) => lazyFrames.observe(f));

  // ---------- animações CSS contínuas só rodam na seção visível ----------
  // (pulsos, brilho do título, letreiro, trilha da lupa): fora da tela ficam paradas e não pedem quadro.
  const offIo = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('offscreen', !e.isIntersecting)), { rootMargin: '200px 0px' });
  $$('main > header, main > section').forEach((el) => offIo.observe(el));

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
    // O loop só roda enquanto o cursor ainda não alcançou o ponteiro; parado, não gasta quadro nenhum.
    let moving = false;
    const loop = () => {
      cx += (tx - cx) * .22; cy += (ty - cy) * .22;
      cur.style.transform = `translate(${cx}px,${cy}px) translate(-50%,-50%)`;
      if (Math.abs(tx - cx) + Math.abs(ty - cy) > .3) requestAnimationFrame(loop); else moving = false;
    };
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; cur.classList.remove('hid'); if (!moving) { moving = true; requestAnimationFrame(loop); } }, { passive: true });
    addEventListener('pointerleave', () => cur.classList.add('hid'));
    // dentro de um iframe a página para de receber o mouse: esconde a bolinha em vez de deixá-la presa na borda
    document.addEventListener('pointerover', (e) => { if (e.target.tagName === 'IFRAME') cur.classList.add('hid'); });
    document.addEventListener('mouseleave', () => cur.classList.add('hid'));
    addEventListener('blur', () => cur.classList.add('hid'));
    document.addEventListener('pointerover', (e) => cur.classList.toggle('on', !!e.target.closest('a,button,.tile,.q,.seg')));
  } else cur.remove();

  // ---------- fundo: correntes contínuas, independentes do cursor ----------
  const cv = $('#trails');
  if (!reduce && cv) {
    const ctx = cv.getContext('2d'); let W, H, running = !document.hidden;
    const size = () => {
      W = innerWidth; H = innerHeight;
      const budget = W < 700 ? 600000 : 1800000;
      const scale = Math.max(.8, Math.min(devicePixelRatio || 1, Math.sqrt(budget / (W * H))));
      cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.lineCap = 'round';
    };
    size(); addEventListener('resize', size);
    let t = 0, last = 0, looping = false;
    // Curvas lentas permitem menos desenhos por segundo sem perder fluidez.
    const STEP = 1000 / 20;
    const draw = () => {
      t += .0144;
      ctx.clearRect(0, 0, W, H);
      const count = W < 700 ? 7 : 12;
      for (let i = 0; i < count; i++) {
        const phase = i * 1.17, base = H * (i + .5) / count;
        const slope = Math.sin(i * 2.4) * .11;
        const amplitude = 16 + (i % 4) * 7;
        ctx.strokeStyle = i % 5 === 1 ? 'rgba(98,216,78,.12)' : 'rgba(43,179,159,.09)';
        ctx.lineWidth = i % 5 === 1 ? 1.25 : .9;
        ctx.beginPath();
        for (let x = -20; x <= W + 20; x += 18) {
          const u = x / W;
          const y = base + (x - W / 2) * slope
            + Math.sin(u * 9 + phase + t) * amplitude
            + Math.sin(u * 16 - phase + t * .55) * amplitude * .25;
          if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    const tick = (now) => {
      if (!running) { looping = false; return; }
      requestAnimationFrame(tick);
      if (now - last < STEP - 2) return;
      last = now; draw();
    };
    const start = () => { if (!looping && running) { looping = true; requestAnimationFrame(tick); } };
    start();
    // Só para quando a aba fica escondida.
    document.addEventListener('visibilitychange', () => { running = !document.hidden; start(); });
  }

  // ---------- texto que embaralha no topo ----------
  const sc = $('#scramble');
  if (sc && !reduce) {
    const phrases = () => (SCRAMBLE_DATA[currentLang] || SCRAMBLE_DATA.pt);
    const chars = '!<>-_\\/[]{}—=+*^?#________';
    let i = 0;
    const to = (txt) => new Promise((res) => { const from = sc.textContent; const len = Math.max(from.length, txt.length); let f = 0; const steps = 22;
      (function fr() { let out = ''; for (let k = 0; k < len; k++) { const p = k / len; out += f / steps > p + .15 ? (txt[k] || '') : f / steps > p - .15 ? chars[Math.floor(Math.random() * chars.length)] : (from[k] || ''); } sc.textContent = out; if (f++ < steps) requestAnimationFrame(fr); else { sc.textContent = txt; res(); } })(); });
    (async function cycle() { while (true) { await wait(3400); const pList = phrases(); i = (i + 1) % pList.length; await to(pList[i]); } })();
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
      // O laço do autoplay só roda com a seção na tela (antes pedia um quadro a cada 16 ms a página inteira).
      let looping = false;
      const stepLoop = (now) => {
        if (!inView) { looping = false; return; }
        const dt = now - lastTs;
        lastTs = now;
        if (!paused && !document.hidden) {
          elapsed += dt;
          cos[cur].style.setProperty('--p', Math.min(1, elapsed / STEP_MS).toFixed(3));
          if (elapsed >= STEP_MS) go(cur + 1, true);
        }
        requestAnimationFrame(stepLoop);
      };
      const pio = new IntersectionObserver((es) => es.forEach((e) => {
        inView = e.isIntersecting;
        if (inView) { lastTs = performance.now(); if (!looping) { looping = true; requestAnimationFrame(stepLoop); } }
      }), { threshold: .15 });
      pio.observe($('#painel') || insideImg);
    }
  }

  // ---- demos ao vivo
  const fitAll = () => {
    $$('.pic.live').forEach((pic) => { const f = $('iframe', pic); const k = pic.clientWidth / +pic.dataset.w; f.style.transform = `translate(${-pic.dataset.x * k}px,${-pic.dataset.y * k}px) scale(${k})`; });
    $$('.fit').forEach((box) => { const f = $('iframe', box); const k = box.clientWidth / +box.dataset.w; f.style.transform = `scale(${k})`; box.style.height = (620 * k) + 'px'; });
    const ti = $('#inside-img'); if (ti) { const f = $('iframe', ti); f.style.height = "1500px"; }
  };
  fitAll(); addEventListener('resize', fitAll);
  $$('.lang-btn').forEach((b) => b.addEventListener('click', () => applyLanguage(b.dataset.lang)));
  if (currentLang === 'en') applyLanguage('en');
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
  // bolinha-assistente + balão na demonstração do formulário (.compo .shot):
  // boas-vindas aparecem uma vez por registro e depois o balão só aparece com o mouse em cima da bolinha.
  const demoAsst = $('#demo-asst'), demoBub = $('#demo-bub'), demoBalloon = $('#demo-balloon'), demoBalloonB = $('#demo-balloon-b'), demoBalloonT = $('#demo-balloon-t'), demoBalloonX = $('#demo-balloon-x');
  let balloonKind = null, welcomeTimer = 0, tipLeaveTimer = 0, welcomedOnce = false;
  const demoShot = $('.compo .shot');
  const hideDemoBalloon = () => {
    clearTimeout(welcomeTimer); clearTimeout(tipLeaveTimer);
    balloonKind = null;
    demoShot?.classList.remove('welcoming');
    if (demoBalloon) demoBalloon.hidden = true;
  };
  const showWelcomeOnce = () => {
    if (welcomedOnce || !demoBalloon) return;
    welcomedOnce = true;
    // No celular o balão cobriria o formulário inteiro: lá a bolinha fica quieta.
    if (matchMedia('(max-width:640px)').matches) return;
    demoShot?.classList.add('welcoming');
    balloonKind = 'welcome';
    if (demoBalloonB) { demoBalloonB.textContent = 'Trail pronto nesta página'; demoBalloonB.hidden = false; }
    if (demoBalloonT) demoBalloonT.textContent = 'Clique num ícone nos campos ou aqui na bolinha para abrir o painel. Arraste para mudar de lugar.';
    demoBalloon.hidden = false;
    clearTimeout(welcomeTimer);
    welcomeTimer = setTimeout(hideDemoBalloon, 5000);
  };
  const showHoverTip = () => {
    if (!demoBalloon || balloonKind === 'welcome') return;
    clearTimeout(tipLeaveTimer);
    balloonKind = 'tip';
    if (demoBalloonB) demoBalloonB.hidden = true;
    if (demoBalloonT) demoBalloonT.textContent = 'Trail · clique para investigar o registro inteiro (arraste para mudar de lugar)';
    demoBalloon.hidden = false;
  };
  if (demoBalloonX) demoBalloonX.addEventListener('click', (e) => { e.stopPropagation(); hideDemoBalloon(); });
  if (demoAsst && demoBub) {
    const wio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setTimeout(showWelcomeOnce, reduce ? 0 : 1000); wio.disconnect(); } }), { threshold: .2 });
    wio.observe(demoAsst.parentElement || demoAsst);
    let dragged = false, sx = 0, sy = 0, startBottom = 14;
    demoBub.addEventListener('pointerenter', () => { if (!dragged) showHoverTip(); });
    demoBub.addEventListener('pointerleave', () => {
      if (balloonKind === 'tip') { clearTimeout(tipLeaveTimer); tipLeaveTimer = setTimeout(hideDemoBalloon, 150); }
    });
    demoBub.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); dragged = false; sx = e.clientX; sy = e.clientY;
      hideDemoBalloon();
      startBottom = parseFloat(demoAsst.style.bottom) || 14;
      demoBub.setPointerCapture(e.pointerId);
      const box = demoAsst.parentElement;
      const move = (ev) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) dragged = true;
        if (!dragged || !box) return;
        const r = box.getBoundingClientRect();
        const nb = Math.max(10, Math.min(r.height - 96, startBottom + (sy - ev.clientY)));
        demoAsst.style.bottom = nb + 'px';
        demoAsst.classList.toggle('left', (ev.clientX - r.left) < r.width / 2);
      };
      const end = () => {
        demoBub.removeEventListener('pointermove', move);
        demoBub.removeEventListener('pointerup', end);
        demoBub.removeEventListener('pointercancel', end);
        if (!dragged) {
          cpanel?.contentWindow?.postMessage({ type: 'trail-demo', batch: 'rec' }, '*');
        }
      };
      demoBub.addEventListener('pointermove', move);
      demoBub.addEventListener('pointerup', end);
      demoBub.addEventListener('pointercancel', end);
    });
  }
  const galimg = $('#galimg');
  if (galimg) $$('#galseg button').forEach((b) => b.addEventListener('click', () => { $$('#galseg button').forEach((x) => x.classList.toggle('on', x === b)); galimg.style.opacity = 0; setTimeout(() => { galimg.src = b.dataset.u; galimg.width = b.dataset.w; galimg.onload = () => { galimg.style.opacity = 1; }; $('#galcap').textContent = b.dataset.c; $('#galurl').textContent = 'chrome-extension://…/' + b.dataset.u.split('/').pop().split('.')[0]; }, 200); }));
})();
