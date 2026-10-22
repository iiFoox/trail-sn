# Diário de trabalho

Registro contínuo do que foi feito, por quem e o que ficou pendente. Quem continuar o projeto (outra sessão do Claude, outro agente ou outra pessoa) lê daqui para baixo, junto com `docs/PASSAGEM.md`. Entrada nova sempre no topo; cada entrada termina com o que está em aberto.

Convenções:
- **Toda funcionalidade nova da extensão entra também no site** (`site/b3`), no estilo dele: motion, animações, texto curto. Quem coordena revisa o que outro agente fizer no site antes de publicar.
- Datas absolutas. Commit e push depois de cada bloco de trabalho.
- Nada de e-mail, senha ou dado pessoal aqui: o repositório é público.
- Resultados completos da bateria ficam em `tests/regression/results/` (fora do git); aqui vai só o resumo.

---

## 2026-10-21 (22h) — Claude (coordenação): de 1.2.0 a 1.3.1 e a volta ao simples (1.4.0)

- **1.2.0–1.3.1 (entregues ao dono para teste):** painel reorganizado em 4 abas (Resposta, Como foi, Histórico, Regras) com frase-resposta no topo; telas dos motores novos (Simular, Comparar, Quem enxerga, Tempo do salvamento, Quem grava/Quem depende); correções dos motores achadas no PDI (P1–P7: `^OR`/`^NQ` em `evalCondition`, obrigatório vazio não trava, campos de diário não "escondidos", SLAs anexadas via `task_sla`, `recordSaveTimes` por janelas `^NQ` e mediana com prazo próprio, quem enxerga pela própria sessão, `compare` para cedo o lado sem sessão, sem retentativa em 500); registro aberto preenchido na gaveta "Investigar" (número lido do `g_form`, 1.2.2); seções com mais de um item recolhidas com seta única e clique no título (1.3.0); "Quem enxerga" com busca por nome (`find-users`); contagem só à direita e "Simular e comparar" como seção (1.3.1).
- **Decisão do dono (21h49):** "enchemos de informação demais; o simples que era funcional deixou de ser". Decidido: o painel volta a ser **igual ao da 1.0.0** como padrão; as correções invisíveis ficam; as ferramentas novas vão para um **Modo avançado** desligado por padrão (aba "Avançado", tudo recolhido). Versão **1.4.0**, que o dono vai enviar à Chrome Web Store.
- **PDI:** validação dos motores feita (relatório `tests/regression/VALIDACAO-MOTORES-2026-10-21.md`, 6 bugs corrigidos). A rodada seguinte (bateria 441 com o motor novo, reconferência P1–P7, escopada v2) foi interrompida pelo dono às 21h28: só a v2 de admin e usuário do app A rodou (`tests/regression/escopo/results-v2/`). Sessão do PDI conferida às 22h: admin, sem `security_admin`, sem personificação; abas extras fechadas.
- **Lições para a próxima rodada:** (1) mostrar ao dono cada funcionalidade nova numa tela antes de empilhar a próxima; (2) o modo padrão tem de continuar respondendo em uma tela "o que mudou, quem, quando, por quê"; o resto é opcional.
- **Em aberto:** ver `docs/PROXIMOS-PASSOS.md` (topo, 22h).

---

## 2026-10-21 (noite, 2) — Claude (coordenação): 1.1.0 com "Por que está bloqueado?", correções de loja e quatro motores novos

- **"Por que este campo está bloqueado, obrigatório ou escondido?"** (`packages/core/src/fieldState.ts`, `extension/src/sidepanel/FieldLock.tsx`, `page/main.ts`): aba "Bloqueio?", cartão no topo quando o formulário mostra o campo travado, gaveta "Investigar › Um campo" com sugestões, e lista "Campos bloqueados, obrigatórios ou escondidos agora" no registro inteiro (a única entrada para campos escondidos). Graus Confirmado/Pode ser; ACL nunca avaliada e sempre avisada; sem acesso, só o estado observado + "Seus papéis não deixam ver as regras do formulário". e2e `fieldlock.mjs`.
- **Correções da revisão de loja (15 itens)**: idioma padrão segue o navegador; boas-vindas sem histórico de navegação (SHA-256, últimos 200); nome localizado na loja (`__MSG_name__`); textos sem "papel do Trail"; "registro indisponível" separado de "sem permissão" (`RecordUnavailableError`); erros técnicos em texto simples com "Detalhes técnicos"; runner da bateria com erro claro; janela separada grava na aba que o painel acompanha (`requestTab`); `page.js` fora do WAR e `https://*/*` no lugar de `<all_urls>` (`use_dynamic_url` testado e descartado: quebra `windows.create`); textos fixos em pt → i18n; termos coerentes (Conectar/Desconectar, Clique, "Nada vai para fora da sua instância"); menu "Trail" só nas instâncias conectadas; detecção só `*.service-now.com`/`*.servicenowservices.com` + domínio próprio pelas Opções; `minimum_chrome_version` 120; ganchos de teste só em páginas `chrome-extension:`.
- **Motores novos (só motor + testes; a tela vem na reorganização em 4 abas):** `fieldDeps.ts` (Mapa do campo: quem grava + quem depende + Simular um valor, com `SharedClient` para não repetir consultas), `saveTiming.ts` (salvamento lento), `visibility.ts` (Quem enxerga este registro), `compare.ts` (Comparar instâncias DEV × PROD, sem inventar diferença quando um lado não lê).
- **Validação:** typecheck ok; **249 testes**; build ok; **11 suítes e2e** passando. Versão **1.1.0** (zip entregue ao dono).
- **PDI:** a bateria escopada v2 foi interrompida a meio (artefatos [PT] v2 nos 3 apps, restritos aos próprios registros; scripts em `tests/regression/escopo/*-v2.js`); a sessão tinha ficado personificada como `pt.trail.escopo.user` e foi devolvida ao admin pelo menu "End impersonation" (o POST de impersonate para o admin deu 500 a partir desse usuário). Validação dos motores novos no PDI em andamento.
- **Em aberto:** validação dos motores no PDI; reorganização em 4 abas + ajustes de UX aprovados (`docs/ux-revisao-2026-10-21.md`) + telas dos motores novos; bateria escopada v2; ajustes do site anotados em PROXIMOS-PASSOS.

---

## 2026-10-21 (noite) — Claude (coordenação com subagentes): e2e completo, 11 erros do itil explicados, correção da janela separada

- **e2e completo passando (item 4 da fila):** a cadeia `npm run e2e` (10 suítes) passou inteira no Linux. Causa real da falha do `prefs-window`: não era "headless sem janela". O Chromium headless simula tela 800×600 e `panelWindowBounds()` alinhava a janela destacada à borda direita da janela normal (1280 px), quase toda fora da tela; `chrome.windows.create` recusava ("Bounds must be at least 50% within visible screen space"). O teste agora usa `--screen-info={1920x1080}`, espera o evento de página e falha se `open-panel` devolver erro.
- **Bug de produto corrigido (`background/index.ts`, `openWindow`):** a mesma recusa acontece com usuários reais (janela do navegador maior que o monitor, segundo monitor desligado) e o "Abrir em janela separada" não fazia nada. Agora tenta de novo sem posição. O teste antigo, sem `--screen-info`, também passa com a correção.
- **Os 11 "Record not found or not readable" da rodada itil (item 3 da fila): todos são negação esperada, nenhum é falha do Trail.** Refeito só leitura (2 POSTs de impersonate, sessão devolvida ao admin): F3-SCRIPT (`sys_ui_action`, ACL de tabela), F7-CUSTOM-* ×6 (`u_pt_trail_teste`, tabela [PT] sem ACL que o itil satisfaça) e F16-X32..X35 ×4 (`kb_knowledge`, permissão do artigo). Em todos o itil também não abre o formulário ("Security constraints…"). As 294 demais chaves resolveram para o mesmo registro que o admin vê, inclusive as 186 por `short_description`.
- **Problema latente visto nessa rodada:** HTTP 500 passageiros na Table API com 6 consultas em paralelo (5 em 608). Um 500/timeout persistente na consulta do registro vira "Record not found or not readable", escondendo a causa técnica. Correção em andamento (erro próprio "a instância não respondeu").
- **Commits:** a partir daqui os commits do Claude saem como `Claude <noreply@anthropic.com>` (como os 36 anteriores do Claude no histórico). Este ambiente não tem permissão de push no `iiFoox/trail-sn`: os commits vão para o dono num git bundle.
- **Em andamento (subagentes):** recurso "Por que este campo está bloqueado, obrigatório ou escondido?" (branch `dev-bloqueado`); correções da revisão de loja (branch `fix-revisao`); bateria escopada v2 para não admin (corpus diverso, vários perfis); revisão de UX.

---

## 2026-10-21 — rechecagem das lacunas de escopo e retirada de `security_admin`

- A sessão autenticada do PDI estava em `admin` com `security_admin` elevado. Removi a elevação pelo menu do usuário e confirmei que a caixa `security_admin` ficou desmarcada. Ao final, `g_user.roles` e `g_user.allRoles` não contêm `security_admin`; o usuário é `admin` e o seletor de aplicativo voltou a `Global`.
- **Flows escopados:** a lista clássica `/sys_hub_flow_list.do` agora abre (373 registros), ao contrário do erro 500 da bateria anterior. O Workflow Studio abre a lista de Flows e o editor do flow global `[PT] F14 flow chama subflow`, com gatilho, subflow e Update Record visíveis. A rota antiga `/now/flow-designer` continua em “Page not found”. Um aviso de atualização cobria “New”; depois de dispensá-lo, “New → Flow” abriu o formulário com o app A selecionado. Preenchi `[PT] Escopo A flow cria pedido`, mas “Build flow” não avançou nem mostrou erro visível. Confirmei por consulta de leitura que o flow não foi gravado e fechei o rascunho. Criação e execução em escopos seguem sem cobertura.
- **Desenvolvedor delegado:** no app `[PT] Trail Escopo A`, localizei “Manage Collaborators”. A busca encontra a conta de teste pelo nome `[PT] Escopo dev`, embora não a encontre pelo `user_name`. O modal oferece o descritor “Editor”. Não enviei convite nem gravei delegação, portanto as investigações anteriores dessa conta continuam sendo de um usuário sem papel. A documentação oficial indica esse fluxo no registro do app: [Delegate permissions](https://www.servicenow.com/docs/r/application-development/delegated-development-and-deployment/t_AddADeveloper.html).
- Reabri o modal com o app A selecionado e tentei escolher o resultado tanto pelo teclado quanto pelo clique. O teclado não concluiu a seleção; o clique fechou o modal sem habilitar “Send”. Ao reabrir, mostrava “No collaborators have been added yet”. A associação segue ausente. Não elevei `security_admin` para essa tentativa, pois o app permitiu abrir a gestão e a documentação indica `admin` como suficiente.
- **Continuação:** a seleção pela coordenada do resultado visível habilitou “Send”. Enviei o convite “Editor” para `[PT] Escopo dev`; ele apareceu em “Pending Collaborators”. Localizei a tarefa gerada `DEV0001001` e salvei “Closed - Approved” como admin, seguindo [Approve collaboration requests](https://www.servicenow.com/docs/r/application-development/creator-studio/approve-collaboration-request.html). A API confirmou `state=2` e `active=false`, porém o app A voltou a mostrar zero colaboradores e as consultas a `sys_appcollab_user` e `sys_user_has_role` não encontraram associação para essa conta. O convite foi aprovado no registro, mas os direitos não se efetivaram; não chamei a bateria de delegado de concluída.
- Foram criados somente o convite e a tarefa de colaboração do app `[PT]` já existente; atualizei apenas o estado dessa tarefa. Nenhum flow, registro de negócio ou tarefa agendada foi criado, alterado ou apagado. A sessão terminou como `admin`, aplicativo `Global`, sem `security_admin` elevado.
- **Validação local:** `npm run typecheck` passou. `npm test` e `npm run build` pararam no carregamento das configurações do esbuild por leitura negada acima do workspace (`Acesso negado`). `npm run e2e` passou por smoke, content-ui16, content-list, content-portal e content-workspace; parou em `prefs-window.mjs` porque o Chromium headless não abriu a janela destacada (`windowOpened: false`). Não houve mudança de código nesta rodada.
- **Integração:** commit local de documentação criado no `master`. O e-mail Git foi conferido como noreply do iiFoox. `git push origin master` falhou por falta de conexão com `github.com:443`; os commits locais continuam pendentes de envio.
- **Em aberto:** investigar por que a tarefa aprovada não gerou colaborador/papel, verificar direitos efetivos antes de executar cenários do app A e de outro escopo; criar flows escopados pelo Workflow Studio quando “Build flow” avançar e testar o motor. Não contar essas lacunas como cobertura concluída.

---

## 2026-10-21 — Site bilíngue PT/EN (item 5 da fila)

- **Site (`site/b3`, Antigravity #2; revisão e integração, Codex #2):** adicionado seletor acessível PT/EN na navegação. O idioma troca os textos, descrições, título, conteúdo dinâmico da demonstração, capacidades, contagem da tabela e legendas da galeria; salva em `localStorage` e na URL (`?lang=en`). O roadmap inteiro da Fase 1 (29 itens) tem chaves `road_p1_l1` a `road_p1_l29` nos dicionários PT e EN. Na revisão, também associei as chaves que já existiam mas ainda não eram aplicadas aos passos da seção "Antes e depois", à introdução dos resultados e à introdução da galeria.
- **Layout e teste:** estilos do seletor adaptados para telas pequenas. `tests/e2e/_site-demo.mjs` verifica alternância, textos do roadmap, comparação, resultados e galeria em inglês, acesso direto via `?lang=en`, idioma após recarga, retorno para PT e overflow em 1280 px e 390 px.
- **Validação reportada pelo Antigravity #2:** `node --check` passou nos dois scripts; `npm run typecheck` passou; `npm test` passou (18 arquivos, 150 testes); `_site-demo.mjs` terminou com código 0, sem erros, imagens quebradas ou overflow.
- **Validação neste ambiente:** `npm run typecheck` passou. `npm test` e `npm run build` foram bloqueados pelo esbuild ao ler diretórios acima do workspace (`Acesso negado`). A cadeia `npm run e2e` passou pelos testes iniciais e parou em `prefs-window.mjs`, pois o Chromium headless não abriu janela destacada (`windowOpened: false`). A execução local de `_site-demo.mjs` verificou idioma, conteúdo, imagens e overflow, mas terminou com código 1 porque o sandbox bloqueou a fonte externa do Google (`ERR_NETWORK_ACCESS_DENIED`); não apontou erro funcional ou overflow.
- **Integração:** commit local de integração criado no ramo `master`; o e-mail Git foi verificado como noreply do iiFoox. A tentativa de `git push origin master` falhou: não foi possível conectar a `github.com:443`; o commit ficou local.
- **Em aberto:** item 6 da fila — lacunas conhecidas de flows escopados e teste do papel de desenvolvedor delegado. Itens manuais de Edge e pendências de loja seguem descritos abaixo.

---

## 2026-10-21 — bateria de regressão como `pt.trail.itil` concluída

- Execução somente de leitura dos **441 casos**, no mesmo registro [PT] `INC0010156`, como `pt.trail.itil`; mediana reportada pelo runner: **1.773 ms**. Foram encontrados 2 resultados com a causa esperada; 439 diferiram da causa de referência.
- Categorias das diferenças: **317 sem evidência**, **111 apenas com causa candidata** e **11 erros “Record not found or not readable”**. O runner marcou como negadas `sys_audit`, `syslog_transaction`, `sysevent`, `sysevent_script_action`, `wf_context`, `sys_script`, `sys_script_include` e `sys_ui_action`. Isso explica a maior parte das lacunas: como ITIL, a API restringiu os dados de auditoria e automação usados para atribuir as causas; em alguns casos o registro base também não era legível. O Trail não deve inferir a automação esperada quando as fontes não estão disponíveis.
- A bateria concluiu sem interromper/recarregar a página. Ao final, a impersonação foi removida pelo endpoint de impersonação; após recarga, confirmei `g_user.userName === 'admin'` e `g_user.hasRole('admin') === true`. Nenhum registro foi gravado ou alterado.
- Os 441 detalhes ficaram apenas na memória da aba do portal; não foram persistidos como artefato. O diário guarda somente contagens, fontes negadas e conclusão agregada, sem dados pessoais.
- **Item 3 da fila — texto neutro para navegadores:** em `extension/src/shared/i18n.ts`, substituí o rótulo do painel lateral e o caminho `edge://extensions/shortcuts` por instruções genéricas em PT/EN. Atualizei as menções correspondentes em `site/b3/index.html`, `site/assets/icons-BktSENMu.js` e `site/demo/content.js`, além da expectativa em `tests/e2e/float.mjs`. O Antigravity #2 iniciou o trabalho, mas atingiu a cota durante os checks; revisei e completei a integração.
- **Validação desta rodada:** `npm run typecheck` passou; os testes via Vitest programático passaram (18 arquivos, 150 testes). O build Vite programático (`configLoader: runner`) das páginas e scripts content/page passou. Os comandos padrão `npm test` e `npm run build` foram bloqueados pelo esbuild ao tentar ler diretórios acima do workspace (`Acesso negado`). `float.mjs`, `reload.mjs`, `flows.mjs` e `settings.mjs` passaram isoladamente. `npm run e2e` parou em `prefs-window.mjs` porque a janela destacada não abriu no Chromium headless (`windowOpened: false`). `_site-demo.mjs` validou conteúdo, imagens e overflow, mas retornou 1 porque o sandbox bloqueou Google Fonts (`ERR_NETWORK_ACCESS_DENIED`).
- Próximo passo: item 4 da fila — preparar materiais de loja para 1.0.0; o dono continua responsável por enviar às lojas. Push dos commits locais ainda depende de conectividade com `github.com:443` neste ambiente.

---

## 2026-10-21 — 0.14.6: subflows aninhados na aba Flows (Codex #2 + Antigravity #2)

- **Motor (`packages/core/src/flows.ts`):** além das execuções ligadas ao registro, busca os contextos-filhos com `source_recordIN<sys_ids dos flows pais>`, em lotes e por até três níveis. Insere cada subflow logo após o flow que o chamou e expõe `parentSysId`; o teste unitário verifica três níveis encadeados.
- **Detecção:** no incidente `[PT] F14-SUB1 Flow com subflow`, a API não retornou `flow.sys_class_name`; o motor marca a execução como subflow pela relação com o contexto pai. O teste unitário cobre essa ausência.
- **Painel e demonstração (`extension/src/sidepanel/Flows.tsx`, `extension/src/shared/ui.css`):** filhos ficam recuados e com um traço lateral; a demonstração usa o mesmo formato. `tests/e2e/flows.mjs` verifica a hierarquia em 340 e 420 px.
- **Site (Antigravity #2):** `site/b3/index.html` explica a hierarquia; assets da demonstração sincronizados; `tests/e2e/_site-demo.mjs` verifica a linha recuada.
- **Teste no PDI:** bundle de regressão compilado e executado, só leitura, no registro `[PT]` `INC0010156`. O flow `[PT] F14 flow chama subflow` (contexto `0dd544b953c89310cce665d6ce09f19f`, estado `COMPLETE`) aparece primeiro; `[PT] F14 subflow descricao` (contexto `a9d584b9fdc89310f69a99b0c3ed21f8`, `source_record` do pai, estado `COMPLETE`) aparece em seguida, com `parentSysId` correto e `subflow: true`. Definições e execuções: acesso `ok`; 10 chamadas, ~1,8 s. Nenhum registro foi alterado, nenhum papel foi criado e não foi preciso elevar `security_admin`; a sessão permaneceu no admin e no app Global.
- **Validação local:** `npm run typecheck` passou. A suíte unitária completa passou pelo Vitest programático (150/150). O carregador padrão de `npm test` e `npm run build` falha neste sandbox ao tentar ler diretórios acima do workspace (`Acesso negado`); com Vite `configLoader: runner` e `__dirname` global, os três builds da extensão e o bundle de regressão compilaram. `float.mjs`, `reload.mjs`, `flows.mjs` e `settings.mjs` passaram. A cadeia `npm run e2e` para em `prefs-window.mjs`: o Chromium headless não abriu a janela destacada (`windowOpened: false`); o teste isolado do painel flutuante passou. `_site-demo.mjs` completou as verificações de conteúdo, imagens e overflow, mas retorna 1 porque o sandbox bloqueou a fonte remota do Google (`ERR_NETWORK_ACCESS_DENIED`); Antigravity #2 registrou a execução sem esse erro como aprovada.
- **Versão/pacote:** manifest `0.14.6`; pasta `../trail-extensao` atualizada manualmente arquivo a arquivo (o serviço Bash bloqueou a execução do script `tools/atualizar-extensao.sh`) e zip `../trail-edge-0.14.6.zip` gerado.
- **Fila, item 1 (perfis):** impersonação de `pt.trail.itil` e `pt.trail.escopo.user` apenas para leitura dos mesmos casos F14/F7; ambos foram restaurados para admin após cada rodada. ITIL: `sys_flow_context` veio vazio, definições de flow negadas, `sys_db_object` ok e fontes de automações negadas; 0 execuções/definições listadas. Usuário de escopo A: `sys_db_object` e definições de flow negados, contextos vazios e demais automações negadas; 0 itens. O motor não inventou causas. Nenhum papel foi criado nem houve elevação de `security_admin`.
- **Integração:** commit local `917d3e8` (`0.14.6: exibe subflows sob flows pais`); `git push origin master` não conectou a `github.com:443` neste sandbox. O perfil atual no portal foi confirmado como admin; nenhum dado de registro foi alterado. Próximo passo: item 2 da fila, executar os 441 casos como ITIL e registrar os resultados.
- **Fila, item 2 (em andamento):** ITIL está personificado na aba `dev457034.service-now.com #2`; os 10 primeiros dos 441 casos terminaram 0/10 conforme esperado pelas fontes negadas, e os outros 431 estão rodando sequencialmente. O total será registrado depois da conclusão; não recarregue a aba nem a extensão enquanto o teste estiver ativo.

---

## 2026-10-21 — bateria de escopos e 0.14.5

**Bateria de escopos (Codex, `tests/regression/escopo/RELATORIO.md`):**
- Três apps de teste no PDI:
  - A: `x_2270630_pttrail_`, como `sys_app`;
  - B: `x_2270630_pttrailb`, como `sys_scope`;
  - C: `x_2270630_pttrailc`, como `sys_scope`, com uma tabela que estende uma tabela do B.
- Regras, script includes, chamadas entre escopos, eventos, jobs, UI actions, policies e client scripts. 300 cenários (`cases-escopo.json`) × 10 perfis = 3000 investigações.
- **Admin: a causa esperada aparece nos 300.** B-BR-001 e C-BR-001 mostravam primeiro a gravação do admin (2→4) e depois a da regra (4→2), no mesmo segundo. **Corrigido:** a auditoria agora é ordenada por horário e por `record_checkpoint`, na consulta e no código. Teste novo em `history.test.ts`.
- **Perfis sem admin:**
  - na primeira rodada nenhum leu nada, porque as tabelas escopadas estavam **sem ACL** (os papéis já estavam atribuídos);
  - o Claude Code elevou `security_admin` na sessão (menu do usuário → Elevate role) e criou 24 ACLs [PT] (leitura, escrita e criação por tabela, exigindo o papel `.user` do escopo dono e criadas dentro desse escopo), com `tests/regression/escopo/criar-acls.js`;
  - na segunda rodada, os usuários de cada app leem só o próprio escopo: 900 legíveis, sem erro. Sem `sys_audit`, o motor usa o histórico do formulário; sem `sys_script`, a causa fica "candidato: quem gravou", sem inventar a regra;
  - itil, usuário sem papel e desenvolvedor sem delegação: "não legível", sem erro técnico.
- **Não testado:**
  - flows escopados (o Flow Designer do PDI dá página 500);
  - desenvolvedor delegado (a tabela de delegação não aparece no PDI).
- **Resultados brutos** em `tests/regression/escopo/results/`, fora do git.

**0.14.5:**
- espaçamento da aba Flows e das 6 abas (os dois cartões não ficam mais colados; as abas cabem de 370 a 420 px e rolam abaixo de 360);
- desempate por checkpoint.

## 2026-10-21 — 0.14.3 e 0.14.4: busca e grupos recolhidos

- **0.14.3:** busca em "O que roda neste registro" (procura em nome, quando roda, tabela, escopo e **campos que grava**, sem acento; "priority" acha tudo que mexe na prioridade) e o filtro "Só o que rodou aqui". Com busca, os grupos com resultado abrem e as partes vazias somem. Testado no e2e `flows.mjs`.
- **0.14.4** (pedido do dono, "pra não ficar muito poluído"): os grupos do registro inteiro (por momento) e os de "O que roda neste registro" começam **todos recolhidos**. O `smoke.mjs` confere isso.
- **0.14.2:** de 370 a 420 px as 6 abas cabem; abaixo disso rolam.

## 2026-10-21 — 0.14.1: "O que roda neste registro"

Pedido do dono: no registro inteiro, ver tudo o que roda para aquele registro (flows, BRs etc.), com link clicável.
- Motor: `core/src/automations.ts`, `tableAutomations(client, { table, sysId })`. Lê a tabela e as tabelas-pai:
  - regras de negócio em ordem de execução (display → before → after → async), com os campos que gravam (`writtenFields`) e o escopo;
  - script includes chamados por elas;
  - client scripts, UI policies, botões, data lookups, regras de atribuição e jobs que citam a tabela;
  - os flows de `recordFlows`;

  Cada fonte negada fica em `access`. Teste em `automations.test.ts`.
- Painel: seção no fim do registro inteiro (`sidepanel/RecordRuns.tsx`), com um grupo recolhível por tipo. A etiqueta "rodou aqui" vem das causas encontradas nos campos do registro. Cada nome é link para o registro na instância (no modo demonstração, texto). Os flows usam o mesmo desenho da aba Flows (`FlowsView`).
- e2e `flows.mjs` confere os grupos. Agora são 149 testes unitários e 10 e2e.

## 2026-10-21 — 0.14.0: aba Flows; 0.13.3: bolinha livre

- **Aba "Flows"** (pedido do dono: "não vi uma aba mostrando quais flows rodam naquele registro/tabela"):
  - motor: `core/src/flows.ts`, `recordFlows(client, { table, sysId })`;
  - **rodaram neste registro:** `sys_flow_context` com `source_record` = registro, com estado, horário e se é subflow;
  - **configurados para a tabela:** gatilhos de registro (`sys_hub_trigger_instance_v2`) na tabela ou nas tabelas-pai, com gatilho em palavras, condição, campos que as ações gravam (`sys_hub_action_instance_v2`), escopo e se já rodou aqui;
  - painel: aba entre Histórico e "E se?" (destaca os flows que gravam o campo investigado) e uma seção no fim do registro inteiro; links para a execução e para o Flow Designer;
  - sem leitura das execuções ou das definições, a aba diz isso;
  - em painel estreito as 6 abas rolam para o lado e a aba ativa fica à vista;
  - testes: `flows.test.ts` e o e2e `tests/e2e/flows.mjs` (agora 10 e2e).
  - **Falta validar no PDI** com flows reais. O Codex está montando flows nos apps escopados.
- **0.13.3:** a bolinha fica onde for solta, em qualquer lugar da tela (posição x e y proporcional, sem grudar nas laterais).

## 2026-10-21 — testes em aplicações escopadas (em andamento, Codex)

A bateria só cobria tabelas globais. O dono pediu testes em apps escopados (o dia a dia do App Engine).
- **Já criado no PDI pelo Claude Code:**
  - app **[PT] Trail Escopo A**: `sys_app` `3def6f75c3cc17101cbdb8e1b40131cf`, escopo `x_2270630_pttrail_` (o ServiceNow corta em 18 caracteres; o prefixo de empresa do PDI é 2270630);
  - tabelas `x_2270630_pttrail__pedido` (estende `task`) e `x_2270630_pttrail__item`.
- **Truques da API:**
  - `PUT /api/now/ui/concoursepicker/application {app_id}` troca o app da sessão (o que for criado vai para esse escopo); voltar com `{app_id: "global"}`;
  - tabela nova: mandar o nome curto, porque o ServiceNow põe o prefixo.
- **Tarefa do Codex:** `tests/regression/ESCOPO-TAREFA.md`. Ele monta campos, regras, script include, job, UI action, app B com regra de outro escopo, papéis e usuários (`escopo.user`, `escopo.admin`, `escopo.dev`), e roda o motor por perfil. Resultado esperado em `tests/regression/escopo/RELATORIO.md`.
- **Atenção:** se a aba ficar no app A ou personificada, voltar ao admin e ao global.

## 2026-10-21 — 0.13.2: o painel acompanha o registro aberto

- **Problema relatado:** o dono testou numa UI page (erro "registro não encontrado") e depois abriu um incidente. O painel só percebeu a troca depois de um clique num campo.
- **Causa:**
  - a troca de registro só era vista quando o DOM de cima mudava (no shell novo a URL muda sem isso);
  - a URL antiga ganhava do `g_form`;
  - o painel guardava o resultado ou o erro do registro anterior.
- **Correção:**
  - content: vigia de URL a cada 0,7 s e no `popstate`; o registro é substituído (não misturado) e o `g_form` ganha da URL;
  - worker: quando o registro da aba muda e nada está rodando, o resultado anterior sai de cena; se era o "registro inteiro", ele é refeito para o registro novo;
  - a mensagem de erro do registro inteiro ganhou espaçamento.
- **Permissão "ler e alterar seus dados":** é o texto fixo do Chrome e do Edge para qualquer acesso a site, mesmo só leitura. O dono decidiu deixar como está.
- **Teste no navegador real com o Claude in Chrome não serve para o painel:** a extensão Claude in Chrome não convive com iframes de outra extensão (recusa com "Cannot access a chrome-extension:// URL of different extension"), e o painel fica vazio enquanto ela controla a aba. O painel funciona no Chrome do dono sem ela. Testes de painel: e2e com Playwright ou o dono, à mão.

## 2026-10-21 — decisão: só no navegador

O dono não quer nada instalado na instância de quem usa ("igual o SN Utils"). A **Fase 2 (app escopado) está arquivada**: o documento ficou só como histórico, e o roteiro do site trocou "Trail dentro da instância" por "nas lojas e no dia a dia". A extensão continua usando a sessão e as ACLs de quem está logado.

## 2026-10-21 — bateria de 2000 e 0.13.1

- **Bateria de 2000** (Antigravity, `tests/regression/bateria2000/RELATORIO.md`):
  - admin 1000/1000 sem erro, mediana de 2,6 s;
  - itil 952 ok e 48 sem leitura do registro (esperado), zero erros, zero "segundo plano" inventado e zero artefato de fonte negada;
  - 461 divergências do itil contra o admin (I2).
- **0.13.1 corrige as quatro causas do I2** no histórico do formulário:
  - a gravação da criação fica de fora;
  - "System" vira `system`;
  - referência por nome volta ao sys_id;
  - datas voltam para UTC pelo fuso com nome do usuário (`g_user_timezone`, passado pela página → content → worker → `FetchRestClient.getTimeZone`, com horário de verão por data, `localToUtc`).
- **Rodada de novo como itil nos 479 alvos que divergiam: 437 batem.** Os 42 que sobram são casos de borda aceitos e descritos no relatório.
- **Ferramental da bateria no git:** `gerar-alvos.mjs`, `executar-bateria.mjs`, `analisar.mjs`, `refazer-i2.mjs`. Os resultados `res-*.json` ficam fora do git.

## 2026-10-20 (23h30) — bateria de 2000 em andamento

Pedido do dono: 1000 investigações como admin e as mesmas 1000 como sem admin (`pt.trail.itil`), para achar tudo que falta. O Antigravity roda pela aba do Maestri (conectada a ele pelo dono), seguindo `tests/regression/BATERIA2000-TAREFA.md`: alvos, invariantes A1–A4 e I1–I6, regras de segurança. Só mede e reporta; não corrige código. **Resultado esperado em `tests/regression/bateria2000/RELATORIO.md`.** Quem pegar o projeto depois: ler o relatório e corrigir os achados, rodar de novo o que falhou e confirmar que a aba do PDI voltou ao admin.

## 2026-10-20 (noite) — 0.13.0: perícia para quem não é admin

Pedido do dono: quem trabalha com App Engine ou sustentação muitas vezes não tem admin. **Decisão:** nada instalado na instância, nenhum papel ou app novo. O Trail usa a sessão de quem está logado, pede cada fonte, e a instância aplica as ACLs; o que vier entra, o que for negado fica de fora e é dito. **Não há lógica por papel no código.** Detalhes e medições em `docs/sem-admin.md`.
- **Medição no PDI** com usuários de teste sem senha, `pt.trail.itil` (itil) e `pt.trail.aes` (App Engine + flow_designer), por personificação (`/api/now/ui/impersonate/<sys_id>`), voltando ao admin no fim:
  - o itil recebe 403 em `sys_audit`, nas transações, nos eventos e nos scripts;
  - o App Engine vê os flows.
- **Histórico do formulário:** quando `sys_audit` é negada, o motor lê `/angular.do?sysparm_type=list_history` (o Activity Stream do formulário, com as ACLs do usuário).
  - Os valores de lista voltam ao valor interno pelas opções de `/api/now/ui/meta/<tabela>`: o itil só lê o `label` de `sys_choice`.
  - O usuário vem de `sys_user` pelo `user_id`.
  - Só cobre os campos configurados no Activity Stream; fora deles, a investigação marca `fieldNotInHistory` e o painel diz isso.
  - Vale também para a linha do tempo do registro inteiro.

  Código: `RestClient.history`, `FetchRestClient.history` / `parseHistory` / `parseMetaChoices`, `core/src/history.ts`. Testes em `history.test.ts`.
- **Fato falso corrigido:** com `syslog_transaction` negada, o motor tomava "sem transação" como prova de processo em segundo plano. Agora, se nada mais explicar a mudança, a evidência é o autor da gravação (candidato), com a lacuna dita (`ChangeContext.txDenied`).
- **No PDI como itil:** INC0010172 impacto 3 → 1 e prioridade 4 → 1, por admin, em grau candidato; urgência: "o histórico do formulário não mostra este campo". Antes, o itil não via nada.
- **Aviso de acesso por capacidade:** "quem mudou e quando", regras automáticas, flows, jobs, eventos, botões e transações, cada um com ✓, ◐ ou –. As tabelas ficam em "detalhes técnicos".
- **Bateria com o motor da 0.13.0, como admin: 440/441.** O F1-MANY passou na análise mas estourou o limite de 3 s (10,5 s) num momento em que o PDI estava lento (mediana de 4,0 s, contra 2,5 s antes, com as mesmas 26 chamadas). Rodado de novo três vezes: 2,4 a 2,8 s, passa. Para o admin, nada muda no caminho de consultas.
- **Site:** FAQ "Preciso ser admin?", "Funciona sem admin" nas fases e simulador de acesso por capacidade, com os dados medidos (itil, itil + Flow Designer). README, PASSAGEM e textos da loja atualizados (Antigravity, revisado).
- **Inspeção visual do Antigravity** (60 prints em 340–420 px, nos dois temas), 8 achados corrigidos:
  - tokens `--teal-2`, `--ok`, `--bad` e `--warn` que faltavam no escuro;
  - tons pastel trocados no tema claro;
  - `--muted` do claro mais escuro;
  - bolinha de status amassada, cabeçalhos do registro inteiro estourando, pontinho de "Provas", X da comparação, filtros em 340 px e recuo de "Outras regras".

## 2026-10-20 (noite) — 0.12.9

- **Estado do painel flutuante** (aberto ou minimizado, por aba) foi do `storage.session` para o `storage.local`, com a chave `float:<tabId>`. O session é apagado quando a extensão recarrega, e o painel aberto voltava como bolinha (achado médio do Codex). Os ids de aba só valem enquanto o navegador está aberto: `clearFloatStates()` limpa tudo no `onStartup`.
- **Reinjeção:** se a sondagem em todos os frames falhar, injeta direto `page.js` (MAIN) e `content.js` em todos os frames (antes era só o frame 0). O content descarta cópias antigas, então não duplica (outro achado médio do Codex).
- **Configurações:** o botão "Desligar atalho" sumia quando o atalho era o padrão. Achado pelo e2e novo `tests/e2e/settings.mjs` (Antigravity), que cobre a folha, animações, atalho, onde abrir e tema. Agora são 9 e2e.
- **Site:** a galeria saiu de "Popup" e "Painel · claro" e abre no painel escuro (pedido do dono).
- **Ainda sem teste automático:** o painel continuar aberto depois de um reload. No Playwright a extensão não volta do `chrome.runtime.reload()`.

## 2026-10-20 (noite) — site mais leve

O dono achou o site pesado. Medido com `tests/e2e/.tmp/site-perf.mjs` (fora do git): rolagem pela página inteira com a CPU 4× mais lenta, contando quadros pelo rAF e tarefas longas.
- **Culpado principal: os 8 iframes do painel** (cada um é o painel inteiro rodando, e por serem da mesma origem o navegador não os desacelera fora da tela). Sem eles, os quadros lentos caíam de ~45 para 10. Desfoque, faixa e canvas pesavam pouco.
- **O que mudou:**
  - as 4 miniaturas de "Quatro passos" viraram imagens capturadas da própria demonstração (`b3/img/passo-1..4.png`);
  - os 4 iframes interativos usam `data-src`: carregam um por vez no tempo ocioso depois do `load`, ou antes, se a pessoa chegar perto (IntersectionObserver com 600 px de folga);
  - `content-visibility: auto` nos contêineres dos iframes;
  - canvas de partículas em densidade 1, um traço por cor, 30 fps e pausa durante a rolagem;
  - o cursor próprio só roda o loop enquanto está se movendo.
- **Resultado, nas mesmas condições:** p95 de 34,7 → 20,9 ms por quadro; quadros lentos de 37–45 → 12–17; quadros na rolagem de ~520 → ~630.
- Textos do site atualizados para o cabeçalho novo (sem bolinhas do Mac; engrenagem de configurações).
- Testes novos (Antigravity): `extension/test/i18n.test.ts` (mesmas chaves e placeholders em pt e en, nenhum texto vazio) e `extension/test/prefs.test.ts` (`motion`, `panelKey`, `comboFromEvent`). Total de 140 testes.

## 2026-10-20 (noite) — 0.12.8: cabeçalho novo, configurações no painel, falso "sem acesso"

- **Cabeçalho do painel (pedido do dono):**
  - sem as bolinhas do Mac; marca, nome e instância à esquerda;
  - à direita, nesta ordem: ⚙ configurações, painel lateral do Edge, tema e ✕ (esconde na bolinha, com a animação de minimizar).
- **Configurações dentro do painel** (`sidepanel/Settings.tsx`):
  - tema, idioma, animações liga/desliga, atalho para abrir e fechar (grava a combinação apertada; padrão `Alt+Shift+P`), ícones nos campos, bolinha, onde o painel abre, "Sempre visível" e o link "Todas as opções";
  - preferências novas `motion` e `panelKey`;
  - animações desligadas: `data-motion="off"` nas páginas e `:host([data-motion=off])` no painel e na bolinha;
  - o atalho apertado dentro do iframe do formulário chega ao quadro de cima por `postMessage` (mesma origem).
- **Falso "sem acesso" (o dono, como admin, viu `sysevent`, `sys_flow_context`, `wf_context`… como negados):** pela aba do PDI as 8 tabelas respondem 200 para o admin. A causa era o prazo de 3 s contando a fila (cerca de 14 consultas, 6 por vez); com o PDI lento, as últimas estouravam e viravam "negado". Agora:
  - o prazo é de 8 s e as que estouram são consultadas de novo;
  - `AccessReport.slow` fica separado de `denied` (só 401/403);
  - aviso leve "A instância demorou a responder", e o resultado com `slow` não fica guardado.

  Teste novo em `fetchClient.test.ts`.
- **Sobre acessos:** o Trail usa a sessão e os papéis de quem está logado e não tem conta própria. O papel `x_trail_reader` (`docs/papel-leitura.md`) só existe para quem não é admin, e o dono prefere atribuí-lo a poucas pessoas (admin ou papéis com bastante acesso), nunca a todos.
- README e PASSAGEM atualizados para a 0.12.7 (Antigravity).

## 2026-10-20 (noite) — 0.12.7

- **Registro inteiro e lote** usam a mesma animação da investigação de um campo: `sidepanel/Loading.tsx`, a trilha com a lupa, com etapas próprias. Ela fica durante toda a análise e os grupos entram embaixo.
- **Balão da bolinha** (Codex, pedido do dono): a dica só aparece com o mouse em cima e some 150 ms depois que ele sai. As boas-vindas aparecem uma vez por origem + tabela + sys_id e duram 6 s.
- **Revisão do fluxo de abrir e recarregar** (Codex). Corrigido:
  - a corrida do toggle depois da reinjeção (agora abre);
  - o descarte da cópia antiga e a guarda no init assíncrono;
  - a sondagem do mundo MAIN por frame, para não duplicar o `page.js`;
  - a conferência de conexão e permissão antes de abrir;
  - a limpeza quando a permissão é revogada.

  O `reload.mjs` agora também simula a aba sem resposta e comprova a reinjeção sem duplicar ícones.
- **Achados em aberto (médios):**
  - `background/index.ts` ~130: se a injeção em todos os frames falhar, a reserva reinjeta só no frame 0;
  - depois do reload o `storage.session` é limpo, então um painel aberto ou minimizado volta como bolinha. Para mudar, falta decidir como guardar esse estado.
- PiP e Esc dentro do PiP não foram testados (o headless não abre PiP).

## 2026-10-20 (noite) — site: ajustes do dono

Antigravity, na página b3:
- fases com no máximo 5 itens e "Ver mais (+N)" / "Ver menos";
- FAQ começando fechado;
- tabela da bateria com 30 linhas e "Ver mais (+30)": os outros 411 casos ficam compactados no `app.js`, sem dados do PDI;
- seção do painel sem rolagem presa: o painel fica parado e troca de passo sozinho a cada 5 s (pausa com o mouse em cima, clique vai direto ao passo, sem autoplay com `prefers-reduced-motion`), e os 9 passos viram uma linha do tempo vertical.

`_site-demo.mjs` confere tudo isso: sem erros, sem rolagem horizontal em 1280 e 390 px.

## 2026-10-20 (noite) — 0.12.6: bolinha-assistente e conserto do auto-reload

- **Problema que o dono viu:** depois do auto-reload, o clique no ícone não fazia nada. A aba ficava com o script de conteúdo órfão (sem ligação com a extensão nova). O F5 resolvia.
- **Conserto (Codex):** o script órfão percebe que ficou sem extensão, desliga observers e listeners e tira da página os ícones, o painel e a bolinha. O worker reinjeta `page.js` e `content.js` nas abas conectadas ao subir ou atualizar e quando a aba não responde ao pedido de painel, e tenta de novo antes de cair na janela.
- **Teste novo `tests/e2e/reload.mjs`** (no `npm run e2e`): cobre a metade do órfão (ícones e bolinha somem e a página continua funcionando). A reinjeção não dá para testar no Playwright, porque lá a extensão carregada por linha de comando não volta depois do `chrome.runtime.reload()`. Só se vê no Edge de verdade.
- **Bolinha-assistente (Codex, pedido do dono):**
  - sempre visível nas páginas da instância conectada; clique abre o painel; X, Esc e minimizar voltam para a bolinha;
  - dá para arrastar (mouse e toque); ao soltar, encosta na borda mais próxima; posição guardada por instância;
  - balão de boas-vindas e dica ao passar o mouse; o aviso "Trail conectado" agora sai da bolinha e não a cobre mais;
  - opção para desligar a bolinha.
- Abas do resultado com o tamanho do texto; o realce acompanha a aba ativa.
- `cpSync` derruba o processo no Node 24 para Windows (sai sem mensagem, código 127). Nos scripts, usar cópia manual.

## 2026-10-20 (noite) — 0.12.5 e site

- A setinha da lateral agora esconde o painel na bolinha do Trail, com a mesma animação de minimizar (pedido do dono). O estado "recolhido na borda" foi retirado.
- O aviso "Trail conectado" fica no mesmo canto da bolinha e cobre o clique nela. No e2e ele é fechado antes; o certo é o aviso virar balão da bolinha (tarefa do Codex).
- Site (Antigravity):
  - página b3 com as novidades da 0.12 e mais telas na galeria (Registro inteiro, Lote, E se?);
  - as 10 imagens refeitas a partir da demonstração em português, sem URL de instância;
  - `site/tools` com caminhos relativos.
- Protótipos antigos `site/a`, `b`, `b2` e `c` removidos a pedido do dono (citavam a URL do PDI). A raiz `/` redireciona para `/b3/` (`site/vercel.json` e `site/index.html` como reserva).

## 2026-10-20 (noite) — 0.12.4

- Correção: a setinha da lateral não recolhia o painel. A animação de abrir usava `fill-mode: both` e prendia `transform: none`, anulando a classe `.shut`. Agora é `backwards`. O Codex achou o mesmo problema pelos testes novos.
- O botão ↗ do painel lateral do Edge agora volta para o painel flutuante na página (antes abria uma janela separada).
- Testes e2e (Codex): `float.mjs` cobre a borda de baixo, o canto com mínimos de 340×260, a setinha, o Esc (página, campo da página e iframe), as bolinhas e o botão do painel lateral. `smoke.mjs` cobre os grupos do registro inteiro, recolher e expandir, e o filtro Pessoas.

## 2026-10-20 (noite) — 0.12.3

Pedidos do dono depois de testar a 0.12.2 no Edge:
- **Feito:**
  - o painel flutuante muda de tamanho por qualquer borda ou canto (encostado: a borda de dentro, a de baixo e o canto entre elas);
  - setinha na lateral para recolher e abrir;
  - Esc fecha o painel, a não ser que algo dentro dele já tenha usado a tecla (diferença em tela cheia, lista do "E se?") ou que a pessoa esteja num campo ou diálogo da página;
  - animação de abrir e fechar (deslizar com leve zoom e desfoque);
  - setinha no cabeçalho para passar para o painel lateral do Edge (`chrome.sidePanel.open` direto no clique).
- **Codex:** a janela separada abre encostada à direita do navegador. Clicar no ícone numa aba do ServiceNow ainda não conectada pede a permissão no próprio clique e abre o painel flutuante.
- **Codex:** "Tudo que mudou" separado em grupos por momento (quem salvou, quantos campos), que podem recolher.

- **Bateria no PDI com o motor da 0.12.1: 441/441**, mediana de 2,5 s e 26 chamadas por investigação (antes 2,3 s e 24). As duas chamadas a mais são as de rótulo do `sys_documentation`.

## 2026-10-20 (noite) — 0.12.1 e 0.12.2

**Feito**
- Idioma da sessão do ServiceNow chega ao motor (Codex). O mundo MAIN lê `g_user_lang`, `NOW.language`, `g_lang` ou `<html lang>`; `pt-BR`, `pt` e `pb` viram `pb` (o código do `sys_documentation`). No PDI o admin está em `en`, então o caso `pb` não foi testado na instância.
- **0.12.2**:
  - Painel flutuante com visual de janela do Mac: cantos arredondados, margem de 8 px da borda e bolinhas vermelha (fechar), amarela (minimizar) e verde (sempre visível).
  - "Sempre visível" usa Document Picture-in-Picture: o painel vai para uma janela que fica por cima de tudo, até de outros programas. Fechar essa janela devolve o painel para a página.
  - Recarregar sozinho (Codex): no build o vite gera `build.txt`. Quando a extensão está carregada sem compactação (sem `update_url`), o worker confere esse arquivo a cada 3 s e chama `chrome.runtime.reload()` quando ele muda. Na versão da loja isso não roda.
- O dono carregou `trail-extensao` no Edge e, ao clicar no ícone, abriu a janela separada. Causa: pasta nova é instalação nova (outro ID), a instância ainda não estava conectada, e sem Trail na aba o código cai de propósito para a janela.
- O site se publica sozinho a cada push (Vercel ligada ao GitHub, confirmado).

**Em andamento**
- Codex: janela separada encostada à direita do navegador; instância não conectada pede a conexão em vez de abrir a janela.
- Antigravity: página b3 com as novidades da 0.12. Depois, os ajustes pedidos pelo dono:
  - fases com no máximo 5 itens e "Ver mais";
  - FAQ começando fechado;
  - tabela de casos com 30 linhas e "Ver mais";
  - seção do painel sem acompanhar a rolagem, trocando de aba sozinha, com os passos numa linha do tempo à direita.
- Bateria do PDI com o motor da 0.12.1.

## 2026-10-20 — retomada a partir do pacote 0.12.0

**Quem:** Claude Code (coordenação, integração, bateria no PDI, GitHub e Vercel), com dois agentes no Maestri: Codex (motor) e Antigravity (interface e documentação).

**Feito**
- Código restaurado do `trail.bundle` (41 commits). Verificação inicial: typecheck ok, 126 testes, build ok, 7/7 e2e (foi preciso `npx playwright install chromium`).
- **Bateria no PDI com a 0.12.0: 441/441**, acesso completo, mediana de 2,3 s e 24 chamadas por investigação. Rodada pelo portal do Maestri, numa aba já logada (bundle injetado em pedaços pelo `maestri portal evaluate`, sem senha).
- **0.12.1** (commit "0.12.1: ..."):
  - Motor (Codex): rótulo do campo vem de `sys_documentation`: tabela mais específica, depois idioma pedido, depois `en`, por fim `sys_dictionary.column_label`. Consulta feita junto com a auditoria, sem rodada a mais (ajuste da integração). `resolveDisplay` faz a sua própria consulta em paralelo. Novos testes: 133 no total, 131 do motor.
  - Interface (Antigravity): "Comparar duas gravações" virou **"O que mudou entre dois momentos"**, com explicação visível. No modo demonstração, "O registro inteiro" na gaveta Investigar roda o registro de exemplo com animação, sem rede.
  - Site movido para dentro do repositório, em `site/`, e sincronizado com o painel da 0.12.1 por `tests/e2e/_sync-site.sh`, agora com caminhos relativos. O `_site-demo.mjs` serve só de `site/`.
  - `extension/dist-types` saiu do git (é gerado pelo tsc). `.gitattributes` força LF.
- **GitHub:** https://github.com/iiFoox/trail-sn, público, branch `master`. A identidade git deste repositório é o noreply do GitHub.
- **Vercel:** projeto novo `trail-sn`, raiz `site/`, sem build, sem proteção de login. No ar em https://trail-sn.vercel.app/b3/. O projeto antigo `trail-site` não foi mexido.
- **Pasta fixa da extensão:** `tools/atualizar-extensao.sh` copia `extension/dist` (sem `.map`) para `../trail-extensao`, a pasta que fica carregada no Edge, e gera `../trail-edge-<versão>.zip`. Rodar depois de todo `npm run build`.

**Em andamento**
- Bateria no PDI com o motor da 0.12.1.
- Codex: idioma do usuário da instância até o motor (`opts.language`), hoje sempre `en`.
- Antigravity: README para o GitHub e `docs/PASSAGEM.md` atualizado.
- A seguir: recarregar a extensão sozinha quando ela é carregada sem compactação e a pasta muda.

**Em aberto (da passagem 0.12.0)**
- Testar o painel flutuante no Edge real com o PDI. Precisa da extensão carregada no Edge do dono; o portal do Maestri não carrega extensões.
- Fase 2 (app escopado): `docs/fase2-app-escopado.md`.
- Loja do Edge: só o dono envia.

## 21/10/2026: validação de Flows com dados reais e passagem ao Codex
- `entry.ts` agora expõe `flows` e `automations` no bundle de regressão. Rodaram no PDI em incidentes [PT] reais: o flow que rodou aparece como "rodou aqui", e as fontes vêm todas com acesso "ok" (detalhes em `docs/PROXIMOS-PASSOS.md`).
- Encontrado: subflows não aparecem, porque o contexto deles aponta para a execução pai. O teste foi escrito (vermelho) e a correção ficou para o Codex.
- O Claude saiu por limite de tokens; o **Codex #2 coordena** a partir daqui. Roteiro completo em `docs/PROXIMOS-PASSOS.md`.

## 21/10/2026: materiais das lojas para 1.0.0
- Preparados os textos de listagem em português e inglês, notas 1.0.0, justificativas para revisão e instruções exclusivas do proprietário em `docs/loja-edge.md`.
- `docs/store/` contém cinco capturas (todas 1280×800 px), incluindo `shot-5-flows.png`, e `logo-300.png` (300×300 px). Revisão conferiu dimensões e corrigiu links de arquivos locais.
- Conferidas as especificações oficiais: Edge aceita até 6 capturas (640×480 ou 1280×800); Chrome aceita até 5 capturas e exige tile promocional 440×280. Esse tile ainda não foi preparado; fica pendente antes do envio pelo dono.
- Verificação local do coordenador: `npm run typecheck` passou; `npm test` e `npm run build` foram bloqueados quando esbuild tentou ler diretórios fora do workspace (`Acesso negado`). O relatório do Gemini diz Vitest 150/150 e `_site-demo.mjs` sem erros/overflow; confirmei dimensões PNG e `git diff --check`.
- A orientação de privacidade agora informa que o Trail processa localmente conteúdo do ServiceNow e envia as consultas diretamente à instância escolhida. Removida a instrução imprecisa de declarar “não coleta dados”; o dono deve confirmar as categorias no painel conforme a política vigente.
- Pendência identificada na revisão: `site/privacidade/index.html` ainda afirma que não há tratamento de dados pessoais. Atualizar a política publicada para refletir leitura/processamento local de conteúdo do ServiceNow e consultas à instância antes de enviar a listagem.
- Próximo item da fila: site em inglês com alternador PT/EN (`site/b3`). Nenhum envio às lojas foi feito.

## 21/10/2026, 17h: fechamento da rodada e 1.0.0 pronta para as lojas
- O Codex e o Antigravity pararam por limite de uso. O Claude integrou o que estava pendente: o tile `docs/store/tile-440x280.png` e a política revisada.
- Política conferida contra o código e corrigida: acrescentado o token de sessão (`g_ck`) em `chrome.storage.session`; trocado `sys_documentation` (que o motor não lê) por `/api/now/ui/meta`.
- Versão **1.0.0**: `npm test` com 150/150, build ok, zip `../trail-edge-1.0.0.zip` (cópia `../trail-chrome-1.0.0.zip`).
- Corrigido `tools/atualizar-extensao.sh`: o Compress-Archive gravava caminhos com `\` dentro do zip (todos os zips anteriores vinham assim); agora usa o `tar` do Windows, com `/`.
- Os 8 commits locais do Codex (o sandbox dele não tinha rede) foram enviados ao GitHub junto com este.
- Pendências e ordem de trabalho para a próxima IA: topo de `docs/PROXIMOS-PASSOS.md`.

## 21/10/2026, 22h50 — 1.4.2
- Rastro agora vai do mais recente para o mais antigo; o primeiro da lista sempre tem a bolinha verde (pedido do Gabriel).
- O motor não conta mais como "Gravação via API" as consultas que só citam o sys_id na query (ex.: wf_context, sysevent lidos pelo próprio Trail). Só conta a chamada no caminho do registro (`/api/now/table/<tabela>/<sys_id>`). Teste novo em cases.test.ts.

## 21/10/2026, 23h — 1.4.3
- Rastro: o destaque (borda e brilho) e a bolinha verde ficam sempre no item do topo. A causa mantém a etiqueta "Causa" e a bolinha azul-esverdeada, sem brilho.
- Linha do Rastro refeita: em vez de uma linha só na lista inteira (que passava 1 px fora do centro das bolinhas e descia além da última), cada item desenha o trecho da sua bolinha até a seguinte. Bolinhas com 12 px e `box-sizing: border-box`; centro medido igual (x e y) em todas. A linha usa `--line-2` para aparecer no tema claro.
- O e2e `recolhido.mjs` agora confere a ordem decrescente e que o destaque e a bolinha verde só aparecem no topo.
- Ordem lógica, não só pelo relógio: a transação que causou a mudança é gravada no log no fim da requisição (até 3 s depois), então pode aparecer com horário 1 s maior logo abaixo da mudança. É de propósito (o motor já ordenava assim).
- Lição: mudar ordem/destaque de lista visual pede print e medida antes de entregar, nos dois temas.
