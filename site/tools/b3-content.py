import re, pathlib
p = pathlib.Path('/home/claude/trail-site/b3/index.html')
s = p.read_text()

CSS = r'''
/* ---------- conteúdo extra (B3.1) ---------- */
section{padding-block:84px}
.steps{gap:30vh;padding-block:6vh 22vh}
.shot{border-radius:var(--r2);border:1px solid var(--line2);overflow:hidden;background:#0b141b;box-shadow:0 30px 80px rgba(0,0,0,.5);position:relative}
.shot img{display:block;width:100%;height:auto}
.shot .chrome{display:flex;gap:6px;align-items:center;padding:9px 12px;background:#0f1c25;border-bottom:1px solid var(--line);font:11px var(--mono);color:var(--mu)}
.shot .chrome i{width:9px;height:9px;border-radius:50%;background:var(--kelp2)}
.shot .chrome i:nth-child(1){background:#ff7a70}.shot .chrome i:nth-child(2){background:#f0c75a}.shot .chrome i:nth-child(3){background:#62d84e}
.shot .chrome span{margin-left:10px;background:#071a24;border:1px solid var(--line);border-radius:6px;padding:3px 10px;flex:1;max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* storyboard */
.story{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:40px}
.frame{background:var(--kelp);border:1px solid var(--line);border-radius:var(--r2);padding:14px;display:flex;flex-direction:column;gap:12px;min-width:0;transition:border-color .4s,transform .5s var(--ease)}
.frame:hover{border-color:var(--line2);transform:translateY(-4px)}
.frame .pic{border-radius:10px;overflow:hidden;border:1px solid var(--line2);aspect-ratio:4/3;background:#0b141b;position:relative}
.frame .pic img{width:100%;height:100%;object-fit:cover;object-position:var(--pos,50% 0);display:block;transition:transform .8s var(--ease)}
.frame:hover .pic img{transform:scale(1.05)}
.frame .n{font:600 11px var(--mono);color:var(--green);letter-spacing:.1em}
.frame h3{margin:0;font-size:17px;letter-spacing:-.01em}
.frame p{margin:0;color:var(--fg2);font-size:14px}
.frame .pic .ring{position:absolute;width:34px;height:34px;border-radius:50%;border:2px solid var(--green);box-shadow:0 0 0 6px rgba(98,216,78,.18);animation:ping2 1.8s infinite;left:var(--rx);top:var(--ry)}
/* hero composite */
.compo{display:grid;grid-template-columns:1fr 360px;gap:0;align-items:stretch;margin-top:40px}
.compo .shot{border-radius:var(--r2) 0 0 var(--r2)}
.compo .side{border:1px solid var(--line2);border-left:0;border-radius:0 var(--r2) var(--r2) 0;overflow:hidden;background:#0b141b;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.compo .side img{width:100%;display:block}
/* inside the panel: callouts */
.inside{display:grid;grid-template-columns:420px minmax(0,1fr);gap:48px;align-items:start;margin-top:40px}
.inside .shot{position:sticky;top:100px;max-height:calc(100vh - 130px);overflow:hidden}
.inside .shot img{transition:transform 1s var(--ease)}
.callouts{display:flex;flex-direction:column;gap:14px}
.co{background:var(--kelp);border:1px solid var(--line);border-left:3px solid var(--kelp2);border-radius:var(--r);padding:16px 18px;cursor:pointer;transition:border-color .4s,background .4s}
.co.on,.co:hover{border-left-color:var(--green);background:#12333f}
.co b{display:flex;gap:10px;align-items:center;font-size:16px}
.co b i{font:600 11px var(--mono);color:#052a0c;background:var(--green);border-radius:999px;width:22px;height:22px;display:grid;place-items:center;font-style:normal}
.co p{margin:8px 0 0;color:var(--fg2);font-size:14px}
.co code{font:12px var(--mono);color:var(--aqua)}
/* before/after */
.ba{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:40px}
.ba>div{background:var(--kelp);border:1px solid var(--line);border-radius:var(--r2);padding:22px}
.ba h3{margin:0 0 6px;font-size:20px;display:flex;justify-content:space-between;align-items:baseline}
.ba h3 span{font:600 13px var(--mono);color:var(--red)}
.ba .ok h3 span{color:var(--green)}
.ba ol{margin:12px 0 0;padding-left:20px;color:var(--fg2);font-size:14.5px;display:flex;flex-direction:column;gap:7px}
.ba li::marker{color:var(--mu);font:600 12px var(--mono)}
.ba .ok ol li::marker{color:var(--green)}
.ba .clock{margin-top:16px;border-top:1px solid var(--line);padding-top:12px;font:600 34px/1 var(--mono);letter-spacing:-.03em;color:var(--fg)}
.ba .clock small{display:block;font:13px var(--sans);color:var(--mu);margin-top:4px;letter-spacing:0}
.ba .ok .clock{color:var(--green)}
/* cases table */
.tbl{margin-top:36px;border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden;background:var(--kelp)}
.tbl table{width:100%;border-collapse:collapse;font:13px var(--sans)}
.tbl th{font:600 11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--mu);text-align:left;padding:12px 14px;border-bottom:1px solid var(--line2);background:#0c2533}
.tbl td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:last-child td{border-bottom:0}
.tbl tr{opacity:0;transform:translateX(-10px);transition:opacity .5s,transform .6s var(--ease)}
.tbl.in tr{opacity:1;transform:none}
.tbl td.m{font:12px var(--mono);color:var(--aqua)}
.tbl .g{font:700 10px var(--mono);letter-spacing:.06em;padding:3px 8px;border-radius:999px;background:#163a26;color:#a7e8bd;white-space:nowrap}
.tbl .g.p{background:#3d2f0b;color:#ffd98a}.tbl .g.d{background:#1d2d38;color:var(--fg2)}
.tbl .ms{font:12px var(--mono);color:var(--mu);text-align:right;white-space:nowrap}
.tbl tr:hover td{background:rgba(143,168,179,.06)}
/* gallery */
.gal{margin-top:36px}
.gal .seg{margin-bottom:16px}
.gal .shot{min-height:300px}
.gal .shot img{opacity:0;transition:opacity .5s}
.gal .shot img.on{opacity:1}
.gal .cap{color:var(--mu);font-size:13px;margin-top:10px;font-family:var(--mono)}
/* personas */
.who{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:40px}
.who>div{background:var(--kelp);border:1px solid var(--line);border-radius:var(--r2);padding:22px;position:relative;overflow:hidden}
.who>div:before{content:"";position:absolute;inset:auto -40px -40px auto;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(43,179,159,.25),transparent 70%)}
.who h3{margin:0 0 6px;font-size:19px}
.who .q{all:unset;display:block;font:italic 15px/1.5 var(--sans);color:var(--fg2);margin:0 0 12px}
.who p{margin:0;color:var(--fg2);font-size:14px}
.who p b{color:var(--aqua);font-weight:600}
/* faq */
.faq{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.faq details{background:var(--kelp);border:1px solid var(--line);border-radius:var(--r);padding:0 18px;transition:border-color .3s}
.faq details[open]{border-color:var(--line2)}
.faq summary{cursor:pointer;list-style:none;padding:16px 0;font-weight:600;display:flex;justify-content:space-between;gap:12px;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary:after{content:"+";font:300 22px/1 var(--mono);color:var(--green);transition:transform .35s var(--ease)}
.faq details[open] summary:after{transform:rotate(45deg)}
.faq .a{padding:0 0 16px;color:var(--fg2);font-size:14.5px}
.faq code{font:12px var(--mono);color:var(--aqua)}
/* roadmap */
.road{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin-top:40px;position:relative}
.road:before{content:"";position:absolute;left:0;right:0;top:11px;height:2px;background:linear-gradient(90deg,var(--green) 0,var(--green) 40%,var(--kelp2) 40%)}
.road>div{padding:34px 18px 0 0;position:relative}
.road>div:before{content:"";position:absolute;left:0;top:4px;width:16px;height:16px;border-radius:50%;background:var(--kelp2);border:3px solid var(--deep);box-shadow:0 0 0 2px var(--kelp2)}
.road>div.done:before{background:var(--green);box-shadow:0 0 0 2px var(--green)}
.road>div.now:before{background:var(--deep);box-shadow:0 0 0 2px var(--green);animation:ping 2s infinite}
.road .n{font:600 11px var(--mono);color:var(--mu);letter-spacing:.1em}
.road.done .n,.road>div.done .n,.road>div.now .n{color:var(--green)}
.road h3{margin:6px 0 8px;font-size:18px}
.road ul{margin:0;padding-left:16px;color:var(--fg2);font-size:14px;display:flex;flex-direction:column;gap:4px}
@media (max-width:960px){.story{grid-template-columns:1fr 1fr}.compo{grid-template-columns:1fr}.compo .shot{border-radius:var(--r2) var(--r2) 0 0}.compo .side{border-left:1px solid var(--line2);border-top:0;border-radius:0 0 var(--r2) var(--r2)}.inside{grid-template-columns:1fr}.inside .shot{position:static;max-height:none}.ba,.faq{grid-template-columns:1fr}.who,.road{grid-template-columns:1fr}.road:before{display:none}.road>div{padding:0 0 22px 22px}.road>div:before{left:0;top:4px}.tbl{overflow-x:auto}.tbl table{min-width:640px}}
@media (max-width:600px){.story{grid-template-columns:1fr}}
'''

STORY = r'''
<section id="passos"><div class="wrap">
  <div class="rv"><span class="eyebrow">Na prática</span><h2>Quatro passos, dentro do ServiceNow.</h2><p class="sub">Capturas reais da extensão rodando num formulário de incidente e no painel. Nada de mock: o ícone é o content script de verdade.</p></div>
  <div class="story">
    <div class="frame rv"><div class="pic" style="--pos:70% 18%"><img src="img/ui16-form.png" alt="Formulário de incidente no UI16 com o ícone do Trail ao lado de cada campo" loading="lazy"></div><div class="n">01 · ÍCONE</div><h3>Um ícone ao lado de cada campo</h3><p>Aparece em formulários UI16 e no Workspace, só em campos do próprio registro. Dot-walk fica de fora.</p></div>
    <div class="frame rv"><div class="pic" style="--pos:100% 24%"><img src="img/ui16-form-hot.png" alt="Campo State com o ícone ativo" loading="lazy"><i class="ring" style="--rx:66%;--ry:36%"></i></div><div class="n">02 · CLIQUE</div><h3>Clique no campo que intriga</h3><p>O Trail lê tabela, sys_id e o token da sua sessão direto da página. Nenhuma credencial é digitada.</p></div>
    <div class="frame rv"><div class="pic" style="--pos:50% 0"><img src="img/panel-top.png" alt="Topo do painel com o aviso de acesso parcial e o registro" loading="lazy"></div><div class="n">03 · CONSULTA</div><h3>Onze chamadas GET em paralelo</h3><p>Auditoria, transações, eventos, flows e artefatos. Se uma fonte está negada, vira aviso no topo, não erro.</p></div>
    <div class="frame rv"><div class="pic" style="--pos:50% 0"><img src="img/panel-verdict.png" alt="Veredito: business rule assíncrona confirmada com 80 pontos" loading="lazy"></div><div class="n">04 · VEREDITO</div><h3>Causa, fatos e link</h3><p>Quem, quando, de que valor pra qual, e o artefato responsável com os fatos que pontuaram. Clique e abre o script.</p></div>
  </div>
  <div class="compo rv">
    <div class="shot"><div class="chrome"><i></i><i></i><i></i><span>dev457034.service-now.com/incident.do?sys_id=ad7b…31f3</span></div><img src="img/ui16-form-hot.png" alt="Formulário UI16 com o Trail ativo no campo State" loading="lazy"></div>
    <div class="side"><img src="img/panel-full.png" alt="Painel lateral do Trail com a investigação do campo State" loading="lazy" style="object-fit:cover;object-position:top;height:100%"></div>
  </div>
</div></section>
'''

INSIDE = r'''
<section id="painel"><div class="wrap">
  <div class="rv"><span class="eyebrow">Dentro do painel</span><h2>Cada pedaço tem um motivo.</h2><p class="sub">Clique nos itens para percorrer o painel. É a captura real, em modo escuro, de uma investigação na PDI.</p></div>
  <div class="inside">
    <div class="shot rv" id="inside-shot"><div class="chrome"><i></i><i></i><i></i><span>Trail · painel lateral</span></div><img src="img/panel-full.png" alt="Painel do Trail completo" id="inside-img" loading="lazy"></div>
    <div class="callouts rv" id="callouts">
      <div class="co on" data-y="0"><b><i>1</i>Aviso de acesso, antes de qualquer promessa</b><p>O Trail testa cada fonte com uma chamada mínima. Aqui a instância negou <code>sys_flow_context</code> e <code>wf_context</code>: flows podem faltar, e o painel diz isso logo de cara, com os nomes técnicos para copiar no chamado ao admin.</p></div>
      <div class="co" data-y="13"><b><i>2</i>Registro, campo e as três abas</b><p><b>Mudanças</b> é a linha do tempo do campo. <b>Suspeitos estáticos</b> lista todo artefato que cita o campo, mesmo sem rastro. <b>Acesso</b> mostra fonte a fonte o que leu, o que veio vazio e o que foi negado.</p></div>
      <div class="co" data-y="22"><b><i>3</i>Atualização sem auditoria</b><p><code>sys_mod_count</code> maior que o número de checkpoints: alguém gravou com <code>setWorkflow(false)</code>, importação ou campo não auditado. O Trail conta a diferença e mostra as transações daquele horário como pista, aqui um <code>/sys.scripts.do</code> do admin.</p></div>
      <div class="co" data-y="33"><b><i>4</i>Mudança, valor antigo → novo, checkpoint</b><p>Cada ponto da linha é uma mudança do campo em <code>sys_audit</code>: hora, usuário e <code>cp 3</code>, o checkpoint da atualização. Abaixo, 2 → 6: de In Progress para Resolved.</p></div>
      <div class="co" data-y="40"><b><i>5</i>Veredito com fatos que somam</b><p>Business rule assíncrona, <b>CONFIRMADO 80</b>. Os três fatos: a transação JOB nomeia a regra (+50), o script referencia <code>state</code> (+20) e é BR da tabela incident (+10). A barra é a pontuação; cada fato aponta a tabela de onde veio.</p></div>
      <div class="co" data-y="58"><b><i>6</i>Candidatos fracos também aparecem</b><p>O admin que salvou o formulário segundos antes é listado como ação direta, <b>CANDIDATO 30</b>. O Trail não esconde a alternativa: mostra por que ela perdeu.</p></div>
      <div class="co" data-y="78"><b><i>7</i>Quando o rastro expirou</b><p>Mudança de julho: a retenção de <code>syslog_transaction</code> (56 dias) e <code>sysevent</code> (7 dias) já apagou os rastros. O painel declara a lacuna e deixa só o que ainda é verificável: auditoria e suspeitos estáticos.</p></div>
      <div class="co" data-y="100"><b><i>8</i>Custo visível</b><p>Rodapé com o número de chamadas e o tempo: <b>11 calls em 1 840 ms</b>. O botão recarrega os metadados (BRs, script includes, UI actions) que ficam em cache por instância.</p></div>
    </div>
  </div>
</div></section>
'''

BA = r'''
<section id="antes"><div class="wrap">
  <div class="rv"><span class="eyebrow">Antes e depois</span><h2>O que você faz hoje quando um campo muda sozinho.</h2><p class="sub">A rotina de quem já perseguiu uma business rule às 18h de uma sexta.</p></div>
  <div class="ba rv">
    <div><h3>Sem o Trail <span>manual</span></h3>
      <ol><li>Abrir o histórico do registro e achar a mudança.</li><li>Anotar a hora e o usuário, converter o fuso.</li><li>Abrir <em>sys_audit</em> e filtrar por documentkey e campo.</li><li>Abrir <em>syslog_transaction</em>, filtrar a janela, ler URL por URL.</li><li>Listar as BRs da tabela e abrir uma por uma procurando o campo.</li><li>Checar flows, workflows, jobs e script actions, cada um na sua tela.</li><li>Se nada bateu: perguntar no chat de quem é aquela regra.</li></ol>
      <div class="clock">25–60 min<small>por campo, quando a pessoa sabe onde procurar</small></div></div>
    <div class="ok"><h3>Com o Trail <span>1 clique</span></h3>
      <ol><li>Clicar no ícone ao lado do campo.</li><li>Ler o veredito, os fatos e abrir o artefato pelo link.</li></ol>
      <p style="margin:14px 0 0;color:var(--fg2);font-size:14.5px">E quando não dá para afirmar, o painel diz exatamente o que faltou: fonte negada, rastro expirado ou atualização sem auditoria. A dúvida vira um pedido objetivo ao admin, não uma caça.</p>
      <div class="clock">2,05 s<small>mediana medida na PDI, 11 chamadas GET, sem cache</small></div></div>
  </div>
</div></section>
'''

CASES = r'''
  <div class="tbl rv" id="tbl"><table>
    <thead><tr><th>Caso</th><th>Cenário criado na PDI</th><th>Campo</th><th>Tipo detectado</th><th>Grau</th><th style="text-align:right">ms</th></tr></thead>
    <tbody>
      <tr><td class="m">C1</td><td>BR async que resolve incidente por palavra-chave</td><td class="m">state</td><td>BR assíncrona</td><td><span class="g">CONFIRMADO 80</span></td><td class="ms">2201</td></tr>
      <tr><td class="m">C2</td><td>BR before define impacto, salva via REST (sem formulário)</td><td class="m">impact</td><td>BR before</td><td><span class="g d">CANDIDATO 30</span></td><td class="ms">2193</td></tr>
      <tr><td class="m">C2-FORM</td><td>Mesma BR, salva pelo formulário: enviado 3, gravado 1</td><td class="m">impact</td><td>BR before</td><td><span class="g">CONFIRMADO 80</span></td><td class="ms">2060</td></tr>
      <tr><td class="m">C2-FORM-urg</td><td>Usuário muda a urgência pelo formulário, sem automação</td><td class="m">urgency</td><td>Ação do usuário</td><td><span class="g">CONFIRMADO 80</span></td><td class="ms">1886</td></tr>
      <tr><td class="m">C3</td><td>BR after que chama um script include</td><td class="m">category</td><td>BR → script include</td><td><span class="g p">PROVÁVEL 50</span></td><td class="ms">2028</td></tr>
      <tr><td class="m">C4</td><td>Evento disparado + script action que altera o campo</td><td class="m">contact_type</td><td>Script action</td><td><span class="g">CONFIRMADO 70</span></td><td class="ms">2254</td></tr>
      <tr><td class="m">C5</td><td>Scripts - Background altera o campo</td><td class="m">severity</td><td>Script de fundo</td><td><span class="g p">PROVÁVEL 50</span></td><td class="ms">2361</td></tr>
      <tr><td class="m">C5b</td><td>Job agendado ajusta severidade</td><td class="m">severity</td><td>Job agendado</td><td><span class="g">CONFIRMADO 70</span></td><td class="ms">2050</td></tr>
      <tr><td class="m">C6</td><td>Flow Designer altera notificação</td><td class="m">notify</td><td>Flow</td><td><span class="g p">PROVÁVEL 50</span></td><td class="ms">1861</td></tr>
      <tr><td class="m">C8</td><td>UI action "Marcar perícia" escreve na descrição</td><td class="m">description</td><td>UI action</td><td><span class="g">CONFIRMADO 80</span></td><td class="ms">1922</td></tr>
      <tr><td class="m">C9</td><td>Gravação com setWorkflow(false), sem auditoria</td><td class="m">impact</td><td>Atualização sem auditoria</td><td><span class="g d">DETECTADO</span></td><td class="ms">1474</td></tr>
      <tr><td class="m">C2-ITIL</td><td>Caso C2 lido com perfil itil (sem acesso a transações)</td><td class="m">impact</td><td>BR before</td><td><span class="g d">CANDIDATO 30</span></td><td class="ms">1940</td></tr>
    </tbody></table></div>
  <p class="sub rv" style="margin-top:18px;font-size:14px;color:var(--mu)">Em fila para a próxima bateria: regra de atribuição, data lookup, import set + transform map, integração REST externa, client script/UI policy, duas automações em sequência, registro com mais de 50 mudanças e tabelas além de incident.</p>
'''

GAL = r'''
<section id="telas"><div class="wrap">
  <div class="rv"><span class="eyebrow">Em todo lugar</span><h2>Painel lateral, janela própria, popup e opções.</h2><p class="sub">Escuro por padrão, claro se quiser. Português por padrão, inglês num clique. Chrome e Edge.</p></div>
  <div class="gal rv">
    <div class="seg" id="galseg"><button class="on" data-i="img/sidepanel-light.png" data-c="Painel lateral · tema claro · mesma investigação">Painel · claro</button><button data-i="img/popup-dark.png" data-c="Popup da extensão · liga e desliga por instância, testa autenticação e acesso">Popup</button><button data-i="img/options-dark.png" data-c="Opções · instâncias permitidas, tema, idioma e janela de busca">Opções · escuro</button><button data-i="img/options-light.png" data-c="Opções · tema claro">Opções · claro</button></div>
    <div class="shot"><div class="chrome"><i></i><i></i><i></i><span id="galurl">chrome-extension://…/sidepanel</span></div><img id="galimg" src="img/sidepanel-light.png" alt="Tela da extensão" class="on" style="max-height:620px;object-fit:contain;object-position:top;background:#0b141b"></div>
    <div class="cap" id="galcap">Painel lateral · tema claro · mesma investigação</div>
  </div>
</div></section>
'''

WHO = r'''
<section id="quem"><div class="wrap">
  <div class="rv"><span class="eyebrow">Para quem</span><h2>Três pessoas, a mesma pergunta.</h2></div>
  <div class="who">
    <div class="rv"><h3>Dev ServiceNow</h3><q class="q">"Juro que não foi minha BR."</q><p>Prova em segundos qual artefato tocou o campo, com o <b>link direto para o script</b>. Serve pra debugar o que você escreveu e pra descobrir o que herdou de quem saiu.</p></div>
    <div class="rv"><h3>Admin da plataforma</h3><q class="q">"Quem está mexendo em prioridade sem passar pelo processo?"</q><p>Separa <b>ação de pessoa</b> de automação, detecta gravações sem auditoria e mostra quais fontes cada perfil consegue ler, com o papel <b>x_trail_reader</b> pronto para conceder leitura sem dar admin.</p></div>
    <div class="rv"><h3>Suporte N2 / gestor de incidentes</h3><q class="q">"Por que esse chamado voltou pra fila?"</q><p>Resposta em linguagem de gente, sem abrir tabela de sistema: <b>o que mudou, quando, por qual regra</b>. Dá pra colar no chamado como justificativa.</p></div>
  </div>
</div></section>
'''

FAQ = r'''
<section id="faq"><div class="wrap">
  <div class="rv"><span class="eyebrow">Perguntas</span><h2>O que todo mundo pergunta antes de instalar.</h2></div>
  <div class="faq rv">
    <details open><summary>Algum dado sai da instância?</summary><div class="a">Não. A extensão fala só com a instância que está aberta na aba, usando a sua própria sessão. Não há servidor do Trail, não há telemetria, não há conta. O código é MIT e dá pra auditar.</div></details>
    <details><summary>Ela escreve alguma coisa?</summary><div class="a">Nunca. Todas as chamadas são <code>GET</code> na Table API. O manifesto não pede permissão de escrita e o motor não tem um método que faça POST, PUT ou DELETE.</div></details>
    <details><summary>Preciso ser admin?</summary><div class="a">Não para usar. Precisa ler <code>sys_audit</code>, <code>syslog_transaction</code> e os artefatos. O repositório traz o papel <code>x_trail_reader</code>, só leitura em 11 tabelas, para o admin conceder. Sem ele, o painel mostra exatamente o que falta.</div></details>
    <details><summary>Funciona no Workspace e no Service Operations Workspace?</summary><div class="a">Sim. O content script percorre o shadow DOM dos componentes <code>sn-record-input-connected</code> e coloca o ícone ao lado do rótulo. UI16 clássico também, incluindo formulários em iframe.</div></details>
    <details><summary>Por que às vezes vem "provável" e não "confirmado"?</summary><div class="a">Porque o rastro não nomeia o artefato. Um script de fundo não registra o código; um flow deixa contexto, não a ação exata. O grau reflete a prova que existe, não um chute. Os fatos listados dizem o que pesou.</div></details>
    <details><summary>E mudanças antigas?</summary><div class="a">A auditoria fica, mas os rastros de execução expiram: transações em 56 dias, eventos em 7, flows em 14 (padrão do <code>sys_auto_flush</code>). O painel declara a lacuna e mantém os suspeitos estáticos. A fase 2 resolve isso gravando o contexto na hora da escrita.</div></details>
    <details><summary>Chrome e Edge?</summary><div class="a">Sim, mesmo pacote (Manifest V3). O painel pode abrir como painel lateral do navegador ou como janela separada, que funciona igual nos dois.</div></details>
    <details><summary>Como sei que não está inventando?</summary><div class="a">Cada fato aponta a tabela de origem e o registro. A bateria de regressão acima roda contra artefatos criados de propósito na PDI, com o resultado esperado declarado antes de rodar. 12 de 12.</div></details>
  </div>
</div></section>
'''

ROAD = r'''
<section id="roadmap"><div class="wrap">
  <div class="rv"><span class="eyebrow">Caminho</span><h2>Onde está e para onde vai.</h2></div>
  <div class="road rv">
    <div class="done"><div class="n">FASE 0 · FEITO</div><h3>Protótipo e prova</h3><ul><li>Motor de perícia em TypeScript, 29 testes</li><li>Modelo de pontuação com 13 tipos</li><li>12 casos reais na PDI, 12 acertos</li></ul></div>
    <div class="now"><div class="n">FASE 1 · AGORA</div><h3>Extensão pronta pra uso</h3><ul><li>Painel lateral e janela destacável</li><li>Escuro/claro, PT/EN</li><li>Bateria ampliada: atribuição, import, REST, encadeadas</li><li>Papel x_trail_reader e guia do admin</li></ul></div>
    <div><div class="n">FASE 2 · DEPOIS</div><h3>Trail dentro da instância</h3><ul><li>App escopado que grava o contexto na hora da escrita</li><li>Fim da lacuna de retenção</li><li>Histórico consultável por qualquer registro</li></ul></div>
  </div>
</div></section>
'''

JS = r'''
  // ---- conteúdo extra (B3.1)
  const tbl = $('#tbl'); if (tbl) { const tio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { $$('tbody tr', tbl).forEach((r, i) => r.style.transitionDelay = (i * 45) + 'ms'); tbl.classList.add('in'); tio.disconnect(); } }), { threshold: .2 }); tio.observe(tbl); }
  const insideImg = $('#inside-img'), insideShot = $('#inside-shot');
  if (insideImg) {
    const go = (co) => { $$('.co').forEach((c) => c.classList.toggle('on', c === co)); const pct = +co.dataset.y / 100; const over = Math.max(0, insideImg.getBoundingClientRect().height - insideShot.getBoundingClientRect().height + 40); insideImg.style.transform = `translateY(${-over * pct}px)`; };
    $$('.co').forEach((co) => co.addEventListener('click', () => go(co)));
    const cio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && matchMedia('(min-width:961px)').matches) go(e.target); }), { rootMargin: '-40% 0px -50% 0px' });
    $$('.co').forEach((co) => cio.observe(co));
  }
  const galimg = $('#galimg');
  if (galimg) $$('#galseg button').forEach((b) => b.addEventListener('click', () => { $$('#galseg button').forEach((x) => x.classList.toggle('on', x === b)); galimg.classList.remove('on'); setTimeout(() => { galimg.src = b.dataset.i; galimg.onload = () => galimg.classList.add('on'); $('#galcap').textContent = b.dataset.c; $('#galurl').textContent = 'chrome-extension://…/' + b.dataset.i.split('/').pop().replace('.png', ''); }, 200); }));
'''

# CSS before </style>
s = s.replace('</style>', CSS + '</style>', 1)
# storyboard after marquee block (before #metodo)
s = s.replace('<section id="metodo">', STORY + '\n<section id="metodo">', 1)
# inside panel after metodo section (before #tipos)
s = s.replace('<section id="tipos">', INSIDE + '\n<section id="tipos">', 1)
# before/after before numeros
s = s.replace('<section id="numeros">', BA + '\n<section id="numeros">', 1)
# cases table inside numeros: after .nums div close -> find '</div>\n</div></section>\n\n<section id="acesso">'
s = s.replace('</div>\n</div></section>\n\n<section id="acesso">', '</div>\n' + CASES + '</div></section>\n' + GAL + '\n<section id="acesso">', 1)
# who, faq, roadmap before install
s = s.replace('<div class="wrap end rv" id="instalar">', WHO + FAQ + ROAD + '\n<div class="wrap end rv" id="instalar">', 1)
# nav links
s = s.replace('<a href="#metodo">Método</a><a href="#tipos">O que detecta</a><a href="#numeros">Números</a><a href="#acesso">Acesso</a>', '<a href="#passos">Na prática</a><a href="#metodo">Método</a><a href="#tipos">Detecta</a><a href="#numeros">Provas</a><a href="#faq">Perguntas</a>', 1)
# JS before end
s = s.replace('\n})();\n</script>', JS + '})();\n</script>', 1)
# numeros heading tweak
s = s.replace('<h2>Numa instância de verdade.</h2>', '<h2>Doze casos, numa instância de verdade.</h2>', 1)
p.write_text(s)
print(len(s), s.count('<section'))
