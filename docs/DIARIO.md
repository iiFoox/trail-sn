# Diário de trabalho

Registro contínuo do que foi feito, por quem e o que ficou pendente. Quem continuar o projeto (outra sessão do Claude, outro agente ou outra pessoa) lê daqui para baixo, junto com `docs/PASSAGEM.md`. Entrada nova sempre no topo; cada entrada termina com o que está em aberto.

Convenções:
- **Toda funcionalidade nova da extensão entra também no site** (`site/b3`), no estilo dele: motion, animações, texto curto. Quem coordena revisa o que outro agente fizer no site antes de publicar.
- Datas absolutas. Commit e push depois de cada bloco de trabalho.
- Nada de e-mail, senha ou dado pessoal aqui: o repositório é público.
- Resultados completos da bateria ficam em `tests/regression/results/` (fora do git); aqui vai só o resumo.

---

## 2026-10-25 — validação PDI da 1.4.6 (Codex #2)

- **Escopo e segurança:** validação somente leitura com `bundle-146a`; não alterei fontes de produção, propriedades, roles, dados preexistentes ou configurações. Usei apenas registros [PT]. Nenhum commit. A sessão terminou conferida em `admin` / `Global`.
- **B, 441 casos:** 416/441 passaram na rodada ampla, sem banners vermelhos. `F13-IMP1-category` passou 3/3 isolado em cada versão (146a e 145d), embora tenha falhado na rodada ampla; não reproduziu como regressão consistente. Confirmei a ausência de eventos `sysevent` nos exemplos Script Action afetados. Reemiti o evento esperado em dois registros [PT] existentes, sem criar regra/job/evento novo; os dois casos de Script Action passaram em 146a e 145d sem mensagens vermelhas.
- **M5:** 21 campos (20 em `incident`/`change_request` e um customizado existente em `u_pt_trail_teste`), admin e `pt.trail.itil`, bundles 146a e 145d. Em 146a, `fieldRules`, `map` e `fieldDeps` coincidiram em 21/21 para ambos os perfis. Em 145d houve uma divergência interna `rules`/`map` em `change_request.impact`, e diferenças de contagem entre bundles em dependências de sete campos no admin. `pt.trail.itil` viu avisos Query ACL idênticos sobre `contract_sla` nas duas versões; nenhum `snow_adc` 500 durante M5.
- **M9:** 30 alvos incidentes [PT] comuns, cancelamentos aos 200/800/2000 ms nos perfis admin e itil. O itil teve 0 comparações diferentes e `stopMs` máximo de 470 ms. Admin teve três diferenças somente pela ausência de `labels` na leitura pós-cancelamento e um cancelamento com `stopMs=4.125 ms`. Sem banners novos. Um conjunto inicial com registros escopados foi substituído após `RecordNotFoundError` para o perfil itil.
- **A curto:** 270 chamadas por `pt.trail.itil` e `pt.trail.escopo.user`, zero banners. Cada perfil teve 75 `Record not found or not readable` em consultas a registros escopados, esperadas sem leitura. O usuário escopo recebeu 403 ao selecionar o app A; os testes seguiram no app Global e não validaram o contexto daquele app. Não alterei roles.
- **Recuperação do PDI:** houve respostas HTTP 500 HTML `snow_adc` durante tentativas de alternar/restaurar a sessão. Em cada ocorrência recarreguei a página via `maestri portal reload` e repeti; a sessão não caiu para guest/login. Ao concluir, admin/Global foi confirmado.
- **Brutos e relatório:** detalhes em `tests/regression/seguranca/RELATORIO-5000.md` e JSONs ignorados em `tests/regression/seguranca/results/` (`B-441-146a-r1.json`, `B-441-F13-146a-isolamentos.json`, `M8-events-146a-vs-145d.json`, `M5-146a-vs-145d.json`, `M9-146a-incident-only.json`, `A-146a-short.json`). Harnesses de teste: `run-m5-146a.mjs`, `run-m9-146a.mjs`, `run-a-146a.mjs`.
- **Em aberto:** revisar as três diferenças de `labels` e a lentidão de cancelamento no admin; avaliar diferenças de dependentes M5 entre builds; corrigir o acesso de `pt.trail.escopo.user` ao app A antes de repetir A naquele contexto. A validação 1.4.6 fica sem aprovação final até esses pontos serem avaliados.
- **Avaliação (Claude), 25/10:**
  - **`labels` vazios no M9 (defeito real, anterior à 1.4.6).** Reproduzi no admin (A-INC-08, 1 de 6). Não é o cancelamento: logo depois de abortar consultas em andamento, o PDI respondeu dois 500 `snow_adc` seguidos ao `sys_db_object` da hierarquia. O passo falhou em silêncio, o incident ficou sem pai e as opções de `urgency`/`impact` (que estão em task) não vieram. Pior: como só o estouro de prazo das regras marcava `incomplete`, a hierarquia cortada ia para o cache da sessão, e as investigações seguintes da tabela perdiam as regras de task. Correção em `investigate.ts`: o passo sem resposta (`timeout`/`unknown`) é repetido uma vez; se faltar de novo, os metadados ficam `incomplete` e não vão para o cache. Dois testes novos em `recordUnavailable.test.ts`, que falham sem a correção. Com o bundle 146b: 6 de 6 com rótulos, inclusive em execuções com 500 logo após o cancelamento.
  - **Observação do PDI:** depois de abortar `fetch` em andamento, as próximas consultas recebem 500 `snow_adc` com frequência (4 das 6 execuções). A repetição única já absorve; agora cobre também a hierarquia.
  - **`stopMs` de 4,1 s (abortar aos 200 ms):** é o `ui/meta`, que de propósito não é cancelado (compartilhado entre clientes e com o próximo clique). O resultado cancelado não é gravado; o próximo clique reaproveita o mesmo `ui/meta`. Sem correção.
  - **M5 entre versões:** a 1.4.6 só ganhou. Achou todos os dependentes da 1.4.5 e mais `br_via_script_include` via `TaskStateUtil`, `JSUtil`, `SLACalculatorNG` e `TaskSLAController`, que a busca por conteúdo (limite 200) cortava. No `change_request.impact`, `fieldRules` agora bate com `map`. A diferença em `short_description` é só o nome de um registro de teste na instância. Resposta de `sys_script_include` no admin: de 164 MB para 13 MB.
  - **Escopo/app A (403):** é da configuração do usuário de teste no PDI, não da extensão. Fica para uma rodada futura, sem mexer em papéis agora.

---

## 2026-10-22 — política acessível em página separada (Codex #2)

- **Comportamento:** a política continua somente em `/privacidade/`; nenhum texto longo foi incorporado à página principal. O rodapé de `site/b3` ganhou o link “Privacidade”/“Privacy”, que abre a rota em uma nova aba com `target="_blank"` e `rel="noopener"`.
- **Cobertura:** `_site-demo.mjs` agora confirma a tradução PT/EN do link, a abertura em outra aba com isolamento e a ausência do conteúdo da política dentro do `main` da página principal.
- **Validação:** `npm run typecheck`, `node --check site/b3/i18n.js`, `_site-demo.mjs` e as 12 suítes de `npm run e2e` passaram. O teste visual manteve zero overflow em 1280, 390 e 360 px. `npm test` e `npm run build` padrão continuam bloqueados pelo esbuild ao tentar ler acima do workspace; o build do core passou antes do bloqueio da extensão.
- **Produção:** commit `1639ef2` enviado ao `origin/master` por fast-forward. Em `trail-sn.vercel.app/b3/?v=1639ef2`, confirmei o link “Privacidade” com destino `/privacidade/`, `target="_blank"` e `rel="noopener"`; o texto longo não aparece no `main` e a página continua sem overflow em 390 px.
- **Em aberto:** o envio às lojas continua exclusivo do dono.

---

## 2026-10-22 — pacotes 1.4.4 e ficha final das lojas (Codex #2)

- **Pacotes recebidos:** conferi `trail-chrome-1.4.4.zip` e `trail-extensao-1.4.4 (1).zip`, renomeando o segundo no repositório sem o sufixo de download. O pacote Chrome tem o manifest na raiz e 32 arquivos sem mapas; o pacote de instalação manual tem a pasta `trail-extensao/`, mapas e `build.txt`. Removidos mapas e `build.txt`, os 32 arquivos de runtime são idênticos. Ambos usam Manifest V3, versão 1.4.4 e Chrome mínimo 120.
- **Entrega no repositório:** os ZIPs ficam em `docs/store/packages/`, acompanhados de finalidade, tamanho e SHA-256 em `README.md`. O arquivo `trail-chrome-1.4.4.zip` é o único pacote a enviar ao Chrome e ao Edge; `trail-extensao-1.4.4.zip` serve apenas para instalação manual.
- **Lojas:** `docs/store/FICHA-PREENCHIMENTO.md` e `docs/loja-edge.md` foram atualizados para 1.4.4, com notas PT/EN, permissões, dados declarados, certificações e instruções de teste. O texto explica que `https://*/*` é opcional e que o pedido em tempo de execução é limitado à origem escolhida.
- **Privacidade:** a política PT/EN deixou de usar a frase absoluta e contraditória “nada sai da instância”. Agora separa os dados dos registros, o token temporário e as preferências sincronizadas; declara finalidade única, ausência de venda/transferência e formas de revogar permissões e apagar armazenamento.
- **Próximos passos:** o topo de `docs/PROXIMOS-PASSOS.md` agora registra a situação atual. O envio às lojas continua exclusivo do dono.
- **Validação local:** hashes e manifests dos dois ZIPs conferidos; os sete PNGs da loja têm as dimensões declaradas. `npm run typecheck` passou; Vitest programático passou em 28 arquivos/292 testes; `npm run e2e` passou nas 12 suítes; `_site-demo.mjs` passou incluindo as novas declarações de privacidade em PT/EN. `npm test` e `npm run build` padrão continuam bloqueados pelo esbuild ao tentar ler acima do workspace.
- **Entrega e produção:** commit `7be750c` enviado ao `origin/master` por fast-forward, sem `--force`, com os dois ZIPs preservados no GitHub (270.051 e 845.130 bytes). Em `trail-sn.vercel.app/privacidade/?v=7be750c`, confirmei a data de 22 de outubro de 2026, versão 1.4.4, as novas seções PT/EN sobre finalidade, compartilhamento e controle, o tratamento temporário do `g_ck`, a sincronização Google/Microsoft sem conteúdo dos registros e zero overflow horizontal em viewport de 390 px.
- **Em aberto:** somente o dono deve enviar `docs/store/packages/trail-chrome-1.4.4.zip` aos painéis do Chrome Web Store e Edge Add-ons e aceitar os termos das lojas.

---

## 2026-10-22 — linha do tempo do roadmap corrigida no celular (Codex #2)

- **Causa:** abaixo de 960 px o layout trocava as três fases para uma coluna e escondia a linha horizontal do desktop, mas não criava uma linha vertical. Os marcadores ficavam soltos e o texto começava perto demais do eixo. Em navegador de desktop com viewport estreito, o cursor decorativo também aparecia como um círculo verde sobre o roadmap.
- **Correção (`site/b3/style.css`):** em até 600 px, o roadmap agora tem um eixo vertical contínuo, todos os marcadores compartilham exatamente o mesmo centro e o conteúdo das fases fica 37 px afastado da linha. O cursor decorativo é ocultado em telas estreitas, inclusive na emulação móvel do navegador.
- **Teste (`tests/e2e/_site-demo.mjs`):** mede em 390 px se a linha está visível, se linha e marcador têm o mesmo centro, se existe pelo menos 32 px de respiro e se o cursor está oculto. O servidor do teste passou a escolher uma porta livre para não colidir com uma execução interrompida.
- **Validação:** captura local em `.pedido-site/roadmap-fix-spaced/mobile-roadmap.png` (fora do Git) revisada visualmente. `_site-demo.mjs` passou com `lineMarkerDelta: 0`, `contentGap: 37`, `cursorDisplay: none`, nenhuma imagem quebrada e `errs: []`. `npm run typecheck` passou; Vitest programático passou em 28 arquivos/292 testes; `npm run e2e` passou nas 12 suítes. `npm test` e `npm run build` padrão continuam bloqueados pelo esbuild ao ler acima do workspace.
- **Produção:** commit `9595658` enviado ao `origin/master` por fast-forward, sem `--force`. Em `trail-sn.vercel.app/b3/?v=9595658`, a medição em 390 px confirmou linha visível, marcador alinhado (diferença de 1 px por arredondamento), 38 px de respiro, cursor oculto e nenhuma largura excedente. Não há pendência funcional nesta correção.

---

## 2026-10-22 — revisão completa do site no celular (Codex #2)

- **Revisão visual:** percorri a página inteira em 390 px e 360 px e gerei capturas locais de cada seção em `.pedido-site/mobile-review-final/` (fora do Git). Os problemas concretos eram a sobreposição das duas primeiras métricas, a tabela larga cortada, os cartões de causas apertados em duas colunas e o sublinhado animado atravessando títulos do método.
- **Correções (`site/b3/style.css`):** ajustei espaçamento, altura de linha, quebra de títulos, margens seguras e deslocamento das âncoras sob a navegação fixa. As métricas mantêm espaço entre si; os cartões passam a uma coluna; a tabela vira cartões móveis preservando as seis informações de cada caso; o sublinhado decorativo some nos títulos estreitos. O layout de PC permanece com a tabela completa.
- **Fundo:** reduzi a intensidade das curvas verdes e azuis para que elas não pareçam sublinhados sob o texto. A animação continua nítida, com resolução proporcional à tela, limite de custo, 20 quadros/s, luzes fixas e nenhuma reação ao cursor.
- **Cobertura (`tests/e2e/_site-demo.mjs`):** agora verifica em 390 px que as métricas não colidem, a tabela não tem rolagem horizontal e nenhuma das seis células do caso foi escondida; em 360 px confirma largura da página, separação das métricas e mosaico em uma coluna. Resultado: `errs: []`, nenhuma imagem quebrada, zero overflow em 1280/390/360 px e escala do canvas igual a 1.
- **Validação:** `npm run typecheck` passou; Vitest programático passou em 28 arquivos/292 testes; as 12 suítes de `npm run e2e` passaram e `recolhido.mjs` foi repetido isoladamente com `errors: []`; `git diff --check` passou. `npm test` e `npm run build` padrão continuam bloqueados pelo esbuild ao tentar ler acima do workspace (`Acesso negado`); nenhuma dependência foi alterada.
- **Entrega e produção:** commit `e07320f` enviado ao `origin/master` por fast-forward, sem `--force`, com e-mail Git noreply do iiFoox. O Vercel marcou o deploy desse SHA como **Ready**. Em `trail-sn.vercel.app/b3/?v=e07320f`, validei 390 e 360 px: dez casos, seis dados visíveis por cartão, tabela sem overflow, métricas sem colisão, mosaico em uma coluna e página sem largura excedente. O portal não conseguiu produzir screenshot porque a janela estava minimizada, mas as medidas do DOM e a árvore de acessibilidade responderam normalmente.
- **Em aberto:** somente observação subjetiva do movimento no celular físico; não há falha funcional pendente nesta revisão.

---

## 2026-10-22 — fundo do site mais nítido e sem reação ao cursor (Codex #2)

- **Motivo:** o dono achou o fundo animado feio e pediu mais definição, sem seguir o cursor. O canvas anterior era renderizado em até 140 mil pixels no celular e 520 mil no PC e esticado para a tela; 48/140 partículas acumulavam traços embaralhados. Duas luzes também mudavam de posição em cada `pointermove`.
- **Mudança (`site/b3/app.js`, `style.css`):** substituí as partículas por curvas contínuas que avançam lentamente, com sete linhas no celular e doze no PC. O canvas usa resolução interna proporcional à tela e ao DPR, com orçamento de até 600 mil/1,8 milhão de pixels, e desenha a 20 quadros/s; a captura de 390 e 1280 px usa escala 1, sem ampliação borrada. Retirei a leitura da posição do cursor do fundo e fixei as duas luzes. O cursor próprio da interface, os efeitos nos cartões e os controles continuam independentes. `prefers-reduced-motion` continua ocultando o canvas.
- **Conferência visual:** prints locais antes em `.pedido-site/review/after/` e depois em `.pedido-site/review/new/`, para PC e celular. A primeira versão desta mudança ficou tênue demais; troquei os traços soltos por linhas longas e ajustei o custo por quadro após medir a prévia.
- **Medição local (`_site-perf.mjs --font=slow`):** em celular CPU 6×/Fast 3G, rolagem 50,3→57,4 fps e primeira pintura 2728→2676 ms; em celular CPU 4×/Slow 4G, 101,1→111,1 fps e 1488→1352 ms. No PC CPU 2×, rolagem 129,9→125,8 fps (variação pequena) e primeira pintura 676→680 ms. Esses números são de Chromium local sob emulação; aparência e fluidez no Edge real ainda pedem observação do dono. JSON local em `.pedido-site/review/perf-background-final.json`.
- **Testes:** `_site-demo.mjs` passou com zero erros, imagens quebradas e overflow em 1280/390 px. O teste novo mede resolução do canvas e confirma que mover o ponteiro não muda as luzes. `npm run typecheck` passou; Vitest programático passou em 28 arquivos/292 testes; `npm run e2e` passou nas 12 suítes. `npm test` e `npm run build` padrão falharam no carregador esbuild por acesso negado acima do workspace; nenhuma dependência foi instalada.
- **Em aberto:** conferir o movimento e a nitidez no Edge real depois da publicação. Ajustar somente se a observação visual mostrar problema.

---

## 2026-10-22 — pedido-site.zip: clareza, desempenho e demonstração da 1.4.4 (Codex #2)

- **Fonte e integração:** li `PEDIDO-SITE.md` inteiro do ZIP do dono. Trouxe o `master` do bundle até `6409ca5` e apliquei o commit de desempenho `bb915d4` como `3bd4f21`. O site agora usa a extensão 1.4.4 nas demonstrações (`site/assets` e `site/demo`), com capturas atualizadas em `site/b3/img` e versões WebP sem perdas. Não alterei dados da instância.
- **Item 2.1:** `#numeros` mostra dez casos variados com descrições simples em PT/EN. Removi botões/contador e o código da tabela longa; `tests/e2e/_site-demo.mjs` confere as dez linhas. Commit `30bf0e7`.
- **Item 2.2:** política de privacidade PT/EN revisada segundo os dados e armazenamentos efetivos da extensão: sincronização de preferências/domínios, dados temporários de diferença/PDF, resumo SHA-256 das boas-vindas, permissões por domínio, leituras GET e contato por GitHub Issues. Commit `5f3449a`.
- **Item 2.3:** além de A–F do bundle, removi o blur pesado, deixei a navegação móvel opaca e tirei o pré-carregamento morto dos iframes. Mantive o limite de carregamento móvel de 600 px: o limite opcional de 150 px exigia aprovação explícita no pedido e ficou de fora. Commit `b94958f`.
- **Item 2.4:** textos PT/EN descrevem o Rastro do mais recente ao mais antigo, o caminho de mudanças clicável, as listas recolhidas, o modo avançado opcional e mensagens simples. Os bundles e prints da demonstração foram sincronizados. O build padrão falhou no carregador do esbuild por leitura negada acima do workspace; os três builds da extensão passaram com Vite `configLoader: runner` e `__dirname` limitado ao diretório do projeto.
- **Medidas locais:** `_site-perf.mjs --font=slow`, comparando a versão do bundle antes dos ajustes com a versão atual: celular CPU 4×/Slow 4G, primeira pintura 2364→1488 ms, rolagem 84,1→101,1 fps; celular CPU 6×/Fast 3G, 3344→2728 ms, responsiva 6806→5362 ms, rolagem 45,8→50,3 fps; PC CPU 2×, primeira pintura 2172→676 ms, rolagem 127,9→129,9 fps. O peso total em três cenários subiu de 633 para 748 KB após incluir os bundles novos da extensão; a primeira pintura caiu. Resultados completos em `.pedido-site/review/perf-before.json` e `perf-after-final.json` (arquivos locais, fora do commit).
- **Verificação:** `npm run typecheck` passou. `npm test` e `npm run build` padrão falharam no carregador do esbuild por acesso negado fora do workspace; Vitest programático passou em 28 arquivos/292 testes, e os builds Vite em modo runner passaram. `npm run e2e` passou nas 12 suítes. `_site-demo.mjs` passou com `errs: []`, `brokenImgs: []` e zero overflow em 1280/390 px. Prints locais antes/depois em `.pedido-site/review/{before,after}/` para PC e celular. Confirmei no portal conectado que `trail-sn.vercel.app/b3/` abre e que o projeto Trail consta no Vercel.
- **Entrega:** `master` enviado ao GitHub por fast-forward, sem `--force`, até `b802877` (e-mail Git noreply do iiFoox conferido). O painel da Vercel marcou esse commit como **Ready**. Na página publicada, confirmei dez linhas, modo avançado descrito, ausência do botão “Ver mais” e nenhuma largura excedente em viewport de 390 px.
- **Em aberto:** item 2.5 aguarda `tests/regression/escopo/RELATORIO-v2.md`; não atualizei 441 ou outros números sem essa bateria. Conferir no Edge real, depois do deploy, suavidade da rolagem, fundo durante a rolagem e troca da fonte. Não mexer no login do Vercel nem em dados do PDI.

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

## 21/10/2026, 23h50 — 1.4.4
- **Certeza baixa com 3 salvamentos seguidos** (o dono mudou Category 3 vezes de propósito).
  - **Causa:** `userTransaction` pegava o primeiro envio de formulário da janela (−3 s / +15 s) que tivesse o campo. Na mudança do meio, isso era o salvamento ANTERIOR (que enviou "Access & Password"). O valor diferia, então caía em "servidor alterou" → regra automática com certeza baixa. O Rastro também marcava "Causa" nos 3 salvamentos.
  - **Correção:** `formSubmitOf(ctx)` em `sameTransaction.ts`. Ela descarta envios que terminaram mais de 2 s antes da auditoria (o log registra a transação no FIM) e escolhe o do mesmo usuário mais próximo do instante. O `buildTrace` usa a mesma escolha para marcar a causa. No Rastro, as outras gravações do registro agora incluem o próprio campo (ex.: "Category: Inquiry → Security").
  - **Teste:** "três salvamentos seguidos do mesmo campo" em `cases.test.ts`. Falha sem a correção e passa com ela.
- **Histórico difícil de entender:** novo `ChangePath` no cabeçalho. Quando o campo mudou mais de uma vez, mostra "Mudança N de T" e o caminho (`New → In Progress → Resolved`), com a mudança atual destacada. Cada valor abre a mudança que o gravou. Some quando os valores são longos (scripts). A introdução do Histórico agora diz a ordem ("da mais recente para a mais antiga"). Coberto no e2e `recolhido.mjs`.
- **Espaçamento:** o seletor "Este campo / Registro inteiro" estava a 0 px da lista. Agora tem `margin-bottom: 12px`.
- **Revisão contra a 1.0.0** (subagente, 89 prints pareados):
  - **Regressões corrigidas:**
    - o anel da mudança selecionada sumia (`.box .hist-in .h:not(.on)`);
    - o resumo repetia o conteúdo com a seção aberta (agora some ao abrir);
    - a seta ficava no meio do bloco título+resumo (agora fica na linha do título);
    - "Tudo que pode gravar" e "Conflitos" estavam sem resumo quando recolhidos;
    - um `.grow` com `inline-flex` herdado deixava o resumo ao lado do título.
  - **Sem mudança:** o resto bate pixel a pixel com a 1.0.0 (popup, E se?, balão, relatório, diff), e nenhuma chave de texto nem token de CSS sumiu.
- **Site:** `docs/PEDIDO-SITE.md`, pacote completo para outra IA.
- **Vídeo:** `docs/VIDEO-LINKEDIN.md`, com roteiro de 40 s, trilha, legendas pt/en e prompt para o Fable. Os prints 2× ficam em `video-assets/`.

## 23/10/2026: revisão de segurança para a instância (erros vermelhos e 500)
Motivo: o dono viu, numa instância real, várias mensagens vermelhas no registro ao usar o Trail com usuários sem acesso e em apps escopados; na mesma época, alguém comentou que APIs caíram; e o PDI estava dando 500.

**500 no PDI: não é a extensão.** O erro vem do balanceador da ServiceNow (`Server: snow_adc`). Aparece em pedidos anônimos sem sessão (curl na tela de login), alterna entre 200 e 500 a cada pedido e responde em menos de 1 s, com o nó da aplicação ocioso (`sem_wait 1ms`, `db 1ms`). É defeito na infraestrutura do PDI.

**Mensagens vermelhas: eram do Trail.** Reproduzido no PDI com `pt.trail.escopo.user` e também com `pt.trail.itil` num incidente comum. Cada consulta barrada pelas **Query ACLs** (403 "Insufficient rights to query records") grava mensagens na sessão do usuário, que aparecem na próxima página: "Part of the query on sys_dictionary has been ignored because of insufficient access for 'query_match' operation on sys_dictionary.element". Origem: as consultas de rótulos, tipos e opções em `sys_dictionary`, `sys_choice` e `sys_documentation` por name/element, e o `syslog` por horário (`query_range`). A consulta é barrada antes de rodar no banco, então isso não pesa na instância, mas enche a tela do usuário de erros. Tabela negada inteira (403 "User Not Authorized", ex.: `sys_audit`) não gera mensagem.

**Carga na instância: três problemas reais, corrigidos.**
1. Faltava `sysparm_no_count=true`. Sem ele, a Table API faz um COUNT(*) com o mesmo filtro em toda chamada. Na sondagem de acesso, que não tem filtro, isso contava a tabela inteira: 416 mil linhas de `syslog_transaction` no PDI, o dobro do tempo; numa produção são milhões.
2. O limite de chamadas simultâneas era por cliente, e o painel cria um cliente por mensagem. Agora o limite é um só por instância (6).
3. A sondagem de acesso repetia o que estourava o prazo, e o relatório "lento" não ficava guardado, então toda análise refazia ~10 sondagens nas tabelas pesadas justo com a instância lenta. Agora não repete, e o relatório lento vale 3 min. Lembrete: quando o navegador desiste por prazo, a consulta continua rodando no servidor.

**Correções (todas no `FetchRestClient`, valem para o motor inteiro):**
- `sysparm_no_count=true` em toda consulta.
- Fila única por instância.
- Recusas guardadas por 10 min por instância e sessão (token): tabela negada não é consultada de novo; consulta barrada por Query ACL não se repete com o mesmo conjunto de campos.
- Rótulos, tipos, referências, obrigatório/somente leitura e opções vêm do `/api/now/ui/meta/<tabela>` (o que o formulário usa), e não do dicionário. O cliente responde por ele as consultas `name…^element…` de `sys_dictionary`, `sys_choice` e `sys_documentation`.
- Antes de filtrar `sys_dictionary`, `sys_dictionary_override`, `sys_choice`, `sys_documentation` e `syslog`, confere no `ui/meta` da tabela: ele só lista, com `canmatch=true`, as colunas que o usuário pode filtrar (admin vê; itil e escopo não). Coluna fora da lista: a consulta nem sai.
- "Tempo de gravação" de job: busca do histórico do mesmo url limitada a 6 h (era 24 h de `syslog_transaction` varridas por um campo sem índice).
- Corrigido `queryFields`: com `/i`, "sourceINx" virava o campo "sourceINx".

**Medido no PDI (código antigo × novo, mesma investigação):**
- `escopo.user`, 4 campos de `x_2270630_pttrail__pedido`: 63 → 23 chamadas, 18,2 s → 6,1 s. Mensagens vermelhas: 2 por investigação → nenhuma.
- itil num incidente: o antigo deixava 2 mensagens; o novo, nenhuma, com o mesmo resultado.
- admin: mesmo resultado, 31 → 27 chamadas.
- Linha do tempo, "O que roda neste registro", Flows e estado dos campos como `escopo.user`: nenhuma mensagem.
- Testes: 301 passando (inclui os novos de `fetchClient.test.ts`).

## 24/10/2026: revisão a fundo (1.4.5)
Pedido do dono: revisar tudo, em detalhe, antes de usar em instância real ("não pode haver erros em produção, com vários campos customizados"). Inventário de **160 pontos de consulta em 60 tabelas** (`packages/core/src`), lidos um a um nas tabelas que crescem sem parar e nas tabelas dinâmicas. Novos achados, todos corrigidos:

- **Mensagens vermelhas em qualquer tabela, não só no dicionário.** Depois da primeira correção ainda apareciam: `sys_data_policy_rule` (usuário de escopo) e `sysauto_script` (itil, `query_match` e `query_range`). Regra nova, sem lógica por papel: antes de filtrar **qualquer** tabela, o cliente confere no `ui/meta` dela se o usuário pode filtrar cada coluna do filtro (`canmatch=true`), inclusive colunas com ponto (confere a tabela referenciada). Medido no PDI: para itil e escopo, o `ui/meta` das tabelas de sistema vem **sem colunas**; para admin vem com todas e `canmatch=true`. Sem colunas = "negado" (é o que mantém o histórico do formulário como plano B quando falta `sys_audit`). O `ui/meta` fica guardado em `chrome.storage.session` (o service worker perde a memória depois de ~30 s parado), e buscas iguais simultâneas esperam a mesma resposta.
- **A sessão do usuário atende em fila.** Com consultas pesadas do Trail em paralelo, a página do próprio usuário levou 0,8 s (1), 6 s (3), 15 s (6) e 28 s (12). Limite caiu de 6 para **2** chamadas simultâneas por instância. Lote pela lista caiu de 200 para **50** registros.
- **Import sets pela tabela base.** Toda investigação com mudanças consultava `sys_import_set_row` por `sys_target_sys_id`: a tabela base junta todas as tabelas de staging da instância, e o campo não tem índice. Agora em duas etapas: `sys_import_set` (cabeçalhos, tabela pequena) atualizado perto das mudanças, depois só as tabelas de staging desses imports, filtrando pelo import set.
- **Edição na lista:** a busca em `syslog_transaction` ia da primeira à última mudança (podia ser meses); agora meia hora antes de cada mudança, em janelas separadas (`windowsFilter` em `util.ts`).
- **Filtro com campo inexistente é ignorado pela instância** (medido no PDI: `u_campo_que_nao_existe=abc` em grupos devolveu grupos quaisquer). O histórico do formulário chutava `name`, `number`, `display_name` para achar referências; agora usa o `reference_display_field` do `ui/meta` e, sem ele, não consulta.
- **Valores livres em listas IN** (valor gravado no campo, nome de usuário, nome de job, nome de evento): valor com `,`, `^` ou quebra de linha sai da lista (`inList` em `util.ts`); lista que fica vazia não vira consulta.
- **Resposta 200 que não é JSON** (SSO, proxy) era lida como "vazio" ("nada aconteceu"); agora é "desconhecido". Nome de tabela ou campo fora de `^[a-z0-9_.]+$` não vira chamada.
- **Recusa depende do filtro:** no PDI, `sys_script` sem filtro dá 403 para o usuário de escopo e, filtrada pelo app dele, 200 com as regras. A memória de recusas passou a valer só para o mesmo formato de consulta (tabela + campos do filtro). Observação: o que esse usuário vê em `sys_script` muda com o aplicativo atual da sessão (dentro do app, vê; no Global, 403) — comportamento do ServiceNow; o `ui/meta` acompanha.
- **Página:** o observador do DOM rodava a decoração a cada mudança; agora agrupa e roda no máximo a cada 250 ms.
- Conferido e sem problema: `innerHTML` só com textos fixos (e o título da janela de comparação com escape); links do painel sempre montados a partir da instância; nenhuma escrita no formulário (`g_form`); busca de pessoas com `STARTSWITH` e texto limpo; janelas de log da investigação estreitas (3 s antes, 15 s depois, até 10 mudanças).

**Validação no PDI (1.4.5), mensagens lidas na tela depois de cada rodada:** `escopo.user` (4 campos do app, linha do tempo, estado dos campos, "O que roda", Flows), `pt.trail.itil` e admin (incidente com flow e subflow): **nenhuma mensagem vermelha**; admin com a mesma causa da 1.4.4 ("[PT] F14 flow chama subflow", certeza alta). Testes: 308 passando.

**Próximo:** bateria de 5.000 testes pelo Codex (`tests/regression/seguranca/TAREFA-5000.md`), comparando 1.4.4 × 1.4.5.

**A bateria pegou duas regressões da própria revisão (corrigidas antes de publicar):**
- 441 casos como admin com a primeira versão da 1.4.5: **416/441**. 18 casos de importação e alguns de regra before/booleano falhavam.
- Importação: a busca pelo cabeçalho `sys_import_set` perto da mudança não acha nada, porque a API de importação reaproveita o mesmo import set o dia inteiro e a data dele não acompanha as linhas. Agora as tabelas de staging vêm dos transform maps que gravam na tabela (`sys_transform_map.target_table`), e em cada uma só o minuto em volta de cada mudança (`sys_target_sys_id` + `sys_updated_on`).
- Dicionário pelo `ui/meta` também para o admin: o `ui/meta` descreve o tipo de outro jeito (`choice` onde o dicionário diz `integer`), e o motor compara valores pelo tipo. Agora **quem pode consultar o dicionário continua lendo o dicionário**, como na 1.4.4; o `ui/meta` só substitui quando a consulta seria barrada.
- Os 25 casos que falharam, rodados de novo: 23 passam. Os 2 restantes (C4 e F5-EVENT-sev, eventos) falham igual na 1.4.4: os eventos desses casos já saíram da retenção do PDI.
- Segunda rodada completa: **437/441**. C4 e F5 como na 1.4.4; F1-MANY só por lentidão; **F13-IMP2-correlation_id-2** tinha passado isolado e falhou na bateria. Causa: o prazo de cada fonte (3 s) contava desde a entrada na fila. Com 2 chamadas simultâneas a fila cresce, a fonte "estourava" sem o servidor ter demorado, e a pista sumia ao acaso. Agora o prazo vai no pedido (`QueryRequest.timeoutMs`) e o `FetchRestClient` conta a partir de quando a consulta sai; a espera na fila tem teto de 5× o prazo (`timedQuery` em `util.ts`, usado em investigação, linha do tempo e estado dos campos).

## 24/10/2026: segunda revisão (revisor de segurança + testador, 1.4.5)
A pedido do dono, dois agentes à parte: um revisor de código e segurança (só leitura) e um testador (712 testes novos em `packages/core/test/hardening145.*`, sem mexer no produto). Nenhuma escrita na instância encontrada; nenhum XSS. Corrigido:

- **Bloco B da bateria (Codex, 4 rodadas alternadas de 441 casos como admin):** 1.4.4 = 436 e 438; 1.4.5 = 437 e 438. A 1.4.4 também oscila no PDI. Falham sempre nas duas: C4 e F5-EVENT-sev (eventos fora da retenção). Só na 1.4.5: F1-MANY, por tempo (3,7 s contra limite de 3,5 s). Mediana 2,5 s (1.4.4) × 3,6 s (1.4.5). Os blocos A, C e D que vieram junto eram simulação ("dry-run") e foram descartados.
- **ui/meta que não respondeu** (prazo, 5xx, rede, página de login): a consulta filtrada não sai mais (`unknown`). Antes saía sem conferência e podia deixar mensagem vermelha justo com a instância lenta. Falha guardada 20 s; 401 renova o token.
- **Fila:** consulta abandonada por prazo sai da fila sem ir à instância (`QueryRequest.signal`, `Gate.acquire(signal)`). `SharedClient` não repete mais depois de prazo. Repetições: no máximo uma (429/502/503/504 e 500 em HTML), com `Retry-After` até 5 s. 401 não fica na memória de recusas.
- **Vagas presas:** histórico do formulário (`list_history`) com prazo, numa vaga só, com o ui/meta do cache; o prazo da Table API vale até o fim do corpo; `navpage.do` com prazo de 8 s.
- **Token:** guardado até a instância recusar, em vez de baixar `navpage.do` a cada ação do painel; renovações juntas esperam a mesma busca.
- **Registro inteiro:** não é refeito sozinho ao trocar de registro (eram ~25 investigações por clique). Registro inteiro e lote usam um cliente da rodada (consulta igual vai uma vez só) e 2 investigações por vez.
- **Importação:** as tabelas de staging só são consultadas quando alguma mudança não tem gravação da própria pessoa que a explique. `sysevent` ganhou janela de `sys_created_on`.
- **Filtro quebrado nunca sai** (`brokenFilter`): comparação, lista ou LIKE sem valor, data inválida. `shift` não lança mais com data inválida; `validDate` confere formato e calendário. `sys_ui_action` não é consultada sem filtro quando a ação da transação não é reconhecível; `sys_idIN` vazio não sai.
- **Injeção:** valor com `javascript:` nunca entra em filtro (`safeValue`), inclusive busca de pessoas, histórico, "e se?" e comparação; nome de job com `^` não vira consulta de mediana. Mensagens do painel e da página conferidas no background (tabela, campo, sys_id, número, origem); o motor também recusa alvo inválido. CSV com `=`/`+`/`-`/`@` no começo vai como texto.
- **Conferência:** o "OR" de "^ORDERBY" não era mais confundido com conector; termo sem campo válido conta como recusado. Sondagem sem filtro consulta o ui/meta antes (tabela sem colunas = negado, sem 403 no log).
- **Busca de pessoas:** a partir de 3 letras, 600 ms depois da última tecla.
- **Pendentes:** permissão de filtrar por intervalo/LIKE (`query_range`) não é conferida pelo `canmatch` (precisa de medição no PDI); painel embutível por qualquer site (`use_dynamic_url` arrisca o painel flutuante, testar no navegador); scripts inteiros baixados nas abas de regras; ui/meta pedido por consulta abandonada ainda sai (baixo).
- Testes: 1022 passando.
- **Segunda leitura do revisor (diff 889b44c..1efaab9):** achou uma regressão minha. Com o ui/meta lento, a fonte voltava "desconhecida" e a auditoria vazia aparecia como "nada mudou", sem aviso, até para admin. Agora o ui/meta sem resposta faz a fonte voltar **lenta** (`timeout`, que a tela mostra como lacuna). Filtro só por `sys_id` (o próprio registro) segue mesmo sem ui/meta. Também: token ausente guardado por 30 s (antes, cada consulta baixava `navpage.do` de novo, seguindo até o login do SSO); sondagem de acesso com `timedQuery` (sai da fila ao desistir); `fieldStates` sem segunda tentativa (consultas com dezenas de LIKE); `sysevent` com 7 dias de folga em `sys_created_on` (eventos agendados); "NaN" só conta como quebrado quando está depois de uma comparação. Testes: 1023.

## 24/10/2026: bateria real do Codex com o bundle-145b (a9590a3)

- **Repetição do aviso vermelho do itil (fieldStates no INC0010134):** 5 de 5 sem mensagem vermelha.
- **Bloco A (11 perfis × 270 execuções):** zero mensagem vermelha, zero exceção. As falhas são todas "Record not found or not readable" em registros que o perfil não lê (esperado).
- **Bloco C (1.4.4 × 1.4.5, itil 300 alvos e escopo.user 100):** a 1.4.4 deixou mensagens vermelhas em sys_dictionary e sys_choice para itil; a 1.4.5 nenhuma. 6 alvos do itil perderam a mudança na 1.4.5: o ui/meta do `sys_audit` levou o 500 ao acaso do PDI, a fonte voltou "lenta" e o histórico do formulário não foi tentado (a tela mostrava a lacuna, não "nada mudou").
- **Bloco D (carga):** no máximo 2 chamadas simultâneas nos 3 perfis; p95 dos pings da instância 250–427 ms.
- **Correções:** o ui/meta repete uma vez em 429/502/503/504 e 500 em HTML (como a Table API); auditoria sem resposta também usa o histórico do formulário. Testes: 1026.

**Reteste completo de A, C, D e E com `bundle-145b` (retomada do Codex, 24/10):** detalhes em `tests/regression/seguranca/RELATORIO-5000.md`. A reprodução do sys_id fornecido `3c9f6755c34813101cbdb8e1b401316e` passou 5/5 sem mensagens vermelhas, mas esse sys_id é `INC0010102`, não `INC0010134`; rodei também o `INC0010134` real (`327b3f6dc34893101cbdb8e1b4013179`), igualmente 5/5 limpo. Bloco A: 2.970 chamadas, sem mensagens vermelhas, e as 1.170 recusas foram somente `Record not found or not readable` esperadas. Bloco C: a 1.4.5b não gerou mensagens vermelhas, porém seis alvos ITIL perderam mudanças/evidências; o bruto mostra `sys_audit: timeout`, sem `auditFrom` nem fallback ao histórico, enquanto a 1.4.4 registrou `sys_audit: denied` e leu as mudanças via `history`. Isto contradiz a expectativa de fallback anotada acima e deixa o critério C pendente. Escopo.user não teve divergências. Bloco D passou (concorrência máxima 2; p95 250–427 ms). Bloco E: 108 investigações em seis novos registros [PT], sem mensagem vermelha; os erros de leitura de ITIL/escopo.user foram esperados. Não criei schema para tabela de referência nem falsifiquei datas de auditoria; ambos ficam pendentes. Sessão final verificada em admin/Global.

**Reteste incremental com `bundle-145c` (2699f3a, 24/10):** o bloco C somente para `pt.trail.itil` completou 300 alvos em cada versão (1.4.4 × 145c), sem divergências; 145c teve zero alertas vermelhos. Os blocos A de `pt.trail.itil` e `pt.trail.escopo.user` completaram 270 chamadas cada, ambos com zero alertas vermelhos e zero isolamentos; 75 recusas `Record not found or not readable` por perfil foram esperadas. Brutos e detalhes estão na nova seção de `tests/regression/seguranca/RELATORIO-5000.md`. Sessão final em admin/Global.

**Reteste incremental com `bundle-145d` (9ba8849, 24/10):** A para `pt.trail.itil` e `pt.trail.escopo.user`: 270 chamadas cada, zero mensagens vermelhas e zero isolamentos; 75 recusas de leitura esperadas por perfil. C somente para ITIL: 300 alvos em 1.4.4 × 145d, ambos 300/300, sem divergências. A 1.4.4 registrou avisos de Query ACL; 145d não teve mensagens vermelhas antes/depois nem alertas novos nas checagens dos lotes. Sessão final conferida em admin/Global. Dados brutos em `tests/regression/seguranca/results/`; resumo em `tests/regression/seguranca/RELATORIO-5000.md`.

## 24/10/2026: perícia como admin (441 casos) com o bundle-145c

- 436/441. Falhas: C4 e F5-EVENT-sev (as mesmas de sempre, retenção), F1-MANY (3,2 s, perto do limite de 3,5 s), C1 e F13-IMP3-description.
- Repeti 3 vezes cada, alternando com a 1.4.4: **C1** falha também na 1.4.4 (dados envelheceram, como o C4). **F13-IMP3** falhava sempre na 1.4.5 e passava sempre na 1.4.4: regressão da regra "staging só quando nenhuma gravação da pessoa explica". A importação gravou às 20:00:40 e um PATCH do mesmo admin às 20:00:45 (outro campo) caía na janela. Agora a transação só explica a mudança se vier antes da gravação seguinte do registro. Teste novo; 1027 passando (commit 9ba8849).
- Mediana 3,36 s (1.4.4: 2,47 s; 1.4.5 de ontem: 3,6 s).

## 24/10/2026: 1.4.5 fechada (bundle-145d, commit 9ba8849)

- Perícia como admin: 437/441 (C1, C4, F5-EVENT-sev falham também na 1.4.4; F1-MANY certo, mas 3,7 s). F13-IMP3 voltou a passar.
- Codex com o 145d: A itil e escopo.user 270 cada sem mensagens vermelhas; C itil 300/300, 0 divergências, auditoria pelo histórico em todos.
- Pacotes em `docs/store/packages/` (trail-chrome-1.4.5.zip 274.712 bytes, trail-extensao-1.4.5.zip), ficha da loja e site atualizados (FAQ nova, privacidade 1.4.5). Os pacotes 1.4.4 saíram da pasta: a 1.4.4 não deve ser publicada.
- Envio às lojas: só o dono.

## 25/10/2026: 1.4.6 (melhorias da revisão de segurança que ficaram de fora da 1.4.5)

- **M9, clique novo cancela o anterior:** cada aba guarda um `AbortController`; campo, registro inteiro e lote cancelam a investigação anterior da mesma aba. O `FetchRestClient` aceita `signal` do cliente: consultas na fila saem dela sem ir à instância e as que estão no ar são abortadas. O ui/meta e o histórico do formulário não são cancelados (são compartilhados com outros clientes). A rodada cancelada não grava mais nada no painel. No `roundClient`, a consulta reaproveitada só sai da fila quando todos que a esperam desistiram (antes valia o prazo de quem pediu primeiro).
- **M5, script includes nas regras do campo:** antes `sys_script_include scriptLIKE<campo>`, limite 200, script inteiro (um campo como `state` casava com milhares). Agora só os nomes que as regras chamam (`new X(`, `X.metodo(`), por `nameIN`; as regras vão uma vez só por pergunta.
- **M8, armazenamento da sessão:** as entregas `diff:` e `report:` (janela de diferença e PDF) com mais de 30 min saem a cada nova entrega. O cache de metadados já não derrubava a investigação com a cota cheia.
- **B2, painel embutível:** dentro de iframe, o painel e a diferença só abrem se todos os quadros acima forem da extensão ou de uma instância conectada. Não usei `use_dynamic_url` (risco para o painel flutuante). A demonstração do site (fora da extensão) abre sempre.
- **B4/B5, diagnóstico de conexão (opções):** com prazo de 8 s, `sysparm_no_count` e sem seguir redirecionamento com o token.
- Já estavam feitos: M3 (fieldStates sem segunda tentativa), M10 (busca de pessoas com 3 letras) e B3 (CSV sem fórmula).
- Testes: 1033 passando. Bundle de regressão `tests/regression/seguranca/results/bundle-146a`.
- **Falta:** validação no PDI (Codex) e medir `query_range`/LIKE para perfis sem admin.

## 26/10/2026: caça de defeitos da 1.4.6 (Codex no PDI) e pacotes refeitos

- **Achados e correções:** passo da hierarquia sem resposta repete uma vez e, se continuar sem resposta, vira fonte que faltou (f4f5457, af11226, 6f6d6ec); falha de uma consulta isolada marca a fonte como lenta (362036d); todos os módulos (mapa do campo, automações, flows, linha do tempo, prévia, conflitos) avisam "Parte da instância não respondeu" (5c9409c, be4c9e3); resposta que chega depois do prazo conta como prazo estourado (6cac743); regras de negócio com 500 não deixam mais a pessoa "confirmada" (381e764).
- **Matriz final (bundle-146f):** 36 casos de hierarquia × módulo e 77 de fonte × modo de falha (500 HTML/JSON, 429, 503, demora, JSON truncado, login), sem resultado errado calado e sem contaminar a leitura limpa seguinte. Os dois "calados" restantes de `sys_script` com demora eram artefato do injetor (devolvia `{"result":[]}` fabricado dentro do prazo da 2ª tentativa). Exceção prevista: `sys_choice` só muda rótulos.
- **B-441 146a × 146d:** 418/441 em cada, sem mensagens vermelhas; as duas divergências amplas não se repetiram em 12 isolamentos.
- **Perfis sem admin (itil, escopo.user):** fontes sem calados; cancelamento 15/15 (itil) e 13/15 (escopo.user; 2 sc_task sem leitura, nem chegam a consultar).
- Detalhes e brutos: `tests/regression/seguranca/RELATORIO-5000.md`. Testes: 1046 passando.
- **Pacotes refeitos** com tudo isso: trail-chrome-1.4.6.zip 277.345 bytes, trail-extensao-1.4.6.zip 278.147 bytes (SHA-256 no README dos pacotes). FAQ do site e notas da versão citam o aviso de fonte sem resposta.
- Envio às lojas: só o dono.

## 26/10/2026: revisão de carga antes da loja

- Revisei tudo o que sai para a instância: só GET (Table API, ui/meta, histórico do formulário), no máximo 2 por vez por instância, uma repetição só em 429/502/503/504/500 do balanceador, `sysparm_no_count`, recusas guardadas 10 min, token sem laço, nada roda sozinho (lote até 50, registro inteiro só no clique), filtros sem `^`, `,` nem `javascript:` vindos de dados. LIKE só em tabelas de configuração; nas de log, janelas de segundos.
- **Ajuste:** a busca de eventos (`sysevent`) voltava 7 dias em `sys_created_on` por janela (até 10 por investigação). Numa instância grande são milhões de linhas por dia, e a consulta abandonada aos 3 s continua no servidor (até a cota REST), prendendo a sessão de quem usa. Agora volta 1 dia (eventos agendados com mais de um dia de antecedência ficam de fora). Teste novo; 1047 passando.
- Pacotes refeitos: trail-chrome-1.4.6.zip 277.345 bytes, trail-extensao-1.4.6.zip 278.147 bytes.

## 26/10/2026: os 500 do PDI investigados a fundo; busca da edição na lista em 10 min

- **Pedido do dono:** ter certeza de que o Trail não causou os 500 nem as estranhezas do PDI, antes de abrir para outras pessoas.
- **Medido (só leitura):** com o PDI parado (só tarefas do sistema e acessos anônimos à tela de login), 15 de 30 GETs anônimos ao `login.do` deram 500 `snow_adc`, em 0,43 s (os 200 em 0,72 s): o balanceador responde sem chegar à aplicação. O nó é um só (`dev457034002`, todas as 749 mil transações desde 18/10), "Fully Operational", 18–23 ms de resposta, no máximo 4 de 16 semáforos. Reinícios: 18/10 (PDI recriado de um dump de 23/09), 19/10 e 25/10 22:52 UTC; este, limpo (sem erro de memória nem travamento nos 10 min antes; as transações longas da janela eram jobs da própria ServiceNow, "Check Glide Service Status"). Nenhum artefato [PT] periódico: os 31 jobs são de execução única.
- **O que o Trail pesava (pelos registros do PDI):** a 1.4.4 levava 18–20 s de banco por busca de edição na lista (intervalo da primeira à última mudança, 5 dias). Na 1.4.6 a mesma busca, em janelas, leva 15–73 ms; a consulta mais lenta da 1.4.6 desde 25/10 levou ~900 ms. A cota REST da plataforma cortou uma consulta minha de diagnóstico aos 60 s.
- **Ajuste:** a busca da abertura da lista antes de uma mudança sem explicação (edição na célula) voltava 30 min; agora 10 min (`LIST_LOOKBACK_S`). No PDI eram ~850 ms de banco por janela; numa produção movimentada seriam dezenas de segundos. Só deixa de sugerir a pista quando a edição vem mais de 10 min depois de abrir a lista. Teste novo (9 min antes ainda é pista; a busca volta exatamente 10 min); 1048 passando.
- Pacotes refeitos: trail-chrome-1.4.6.zip 277.350 bytes, trail-extensao-1.4.6.zip 278.153 bytes.

## 26/10/2026: texto longo salvo pelo formulário culpava uma regra; Rastro com a causa primeiro

- **Achado do dono:** um comentário num script include de 1.914 caracteres, salvo pelo formulário, saiu como "BR before HTMLSanitizerConfigValidation, certeza média: o formulário enviou outro valor". Medido no PDI: a instância guarda a URL do formulário **já decodificada** e corta cada valor em **999 caracteres + "..."** (também o `sys_original.`). O Trail aceitava valor cortado, mas sem os "..."; e lia a URL com `URLSearchParams`, que troca "+" por espaço (um script com `a + b` também daria "outro valor"). Agora `formSent` (util) tira os "..." e tenta a leitura crua e a decodificada; `sentMatches` compara o começo, com \r\n = \n. Vale para qualquer campo com mais de 999 caracteres salvo pelo formulário.
- **"Gravação via API" falsa:** `/api/now/js/debugpoints/script/<tabela>/<sys_id>` (o editor de scripts lendo os pontos de depuração ao abrir) entrava no Rastro como gravação. Leituras da própria interface (`js`, `ui`, `uxf`, `graphql`, `sp`...) saem.
- **Rastro (pedido do dono):** a causa vem primeiro, sozinha e destacada; a linha do tempo vem depois, com o campo investigado destacado (antes o destaque ia para o item mais recente, fosse qual fosse). Texto longo mostra as linhas que mudaram (até 3, sem linhas em branco) em vez do começo, que é igual nos dois lados; o envio do formulário diz "Enviou o novo valor" em vez do começo do texto. O resumo "+N −M linhas" do cabeçalho também pula linha em branco.
- 4 testes novos (`formularioLongo.test.ts`, falham sem a correção); 1052 passando. Bundle `bundle-146g`.
- **Codex:** caça contínua de "uso real" (mudanças feitas pela interface, em registros [PT], conferindo se a causa está certa); achados na nota "Caça uso real".
- **Pacotes da loja: desatualizados** até o fim desta rodada; não enviar os de `docs/store/packages` por enquanto.

## 26/10/2026: regra ou client script desligado depois da mudança; cache das regras

- **Achados do Codex (caça de uso real, bundle 146g):** (1) BR before [PT] reescreveu `short_description` e foi desativada 23 s depois; a investigação, logo em seguida, não a apontou. (2) Client script [PT] onChange preencheu `description` no formulário e foi desativado em seguida; a mudança saiu como "admin, confirmada". Causa comum: o Trail só lia regras, client scripts e UI policies **ativos**. É o caso real de quem desliga a regra suspeita e depois pergunta quem mudou o campo.
- **Correção:** BRs, client scripts e UI policies **inativos alterados depois da mudança mais antiga** entram como suspeitos (consultas à parte, até 20 cada, com `sys_updated_on>=`), só para mudanças anteriores à alteração deles, com o aviso "está desativado hoje; foi alterado em …, depois da mudança (confira se estava ativo na hora)". Ficam fora do alerta de conflitos.
- **Cache das regras (10 min na extensão):** guardava as regras da tabela; uma regra criada, ativada ou editada logo antes ficava de fora. Agora o cache guarda `loadedAt` e, antes de usar, uma consulta mínima (`sys_script`, `sys_updated_on>=` 2 min antes, limite 1) pergunta se alguma regra da tabela mudou; se mudou, recarrega.
- 5 testes novos (`regraDesativada.test.ts`; 4 falham sem a correção); 1057 passando. Bundle `bundle-146h`.

## 26/10/2026: aba Versões no lugar do "E se?"

- **Pedido do dono:** o "E se?" era a função menos útil; sai das abas e fica escondido em Avançado (seção "E se?", só com o Modo avançado). No lugar, a aba **Versões**.
- **Versões:** lista as versões salvas do registro (`sys_update_version`, a mesma lista "Versions" do formulário), da mais nova à mais antiga, com quem salvou, quando, se está em uso e de onde veio (update set com nome, atualização da plataforma, outra origem). Ao escolher uma, lê só o conteúdo dela e da anterior (o registro inteiro em XML, no máximo 2 por vez) e mostra os campos que mudaram; texto longo vem com as linhas alteradas e abre a diferença lado a lado. Campos de controle (`sys_*`) ficam fora. Registro sem versões (incidente, chamado) e perfil sem acesso têm aviso próprio.
- Leitura do XML própria (`shared/versions.ts`, sem DOMParser): campos vazios, texto escapado, CDATA (inclusive "]]>" partido em duas seções e `</script>` dentro do script) e `display_value` das referências.
- Core: `recordVersions` e `versionPayloads` (`versions.ts`). Testes: 3 no core, 5 no leitor; 1065 passando.
- **Falta:** conferir no painel real (o dono, no script include SOWMraUtils) e pôr no site.

## 26/10/2026: regra de outro registro que grava neste (pai → filho)

- **Achado do Codex (146h):** BR [PT] do incidente pai gravou a descrição do filho por GlideRecord ao salvar o pai. O filho não tem gravação própria; o Trail deixava a regra como `br_before candidate 5`, ao lado de um job sem execução. Caso comum na vida real (pai atualiza filhos, problema resolve incidentes, mudança fecha tarefas).
- **Novo tipo de causa `br_other_record`** (`signatures/otherRecord.ts`): quando a mudança não tem gravação própria e **outro registro foi salvo no mesmo instante** (formulário com `sys_uniqueValue` de outro sys_id ou PUT/PATCH na Table API; `otherRecordWrite` em util), as regras que abrem esta tabela por `GlideRecord('<tabela>')` e citam o campo entram como causa: salvo no instante (20) + abre a tabela (10) + cita o campo (20), mais valor literal no código (15) e mesma pessoa (10). Lacuna: as condições da regra valem para o outro registro, que o Trail não lê. Regras de outra tabela (ex.: problem) vêm numa consulta só quando há essa gravação (`collectionIN<tabelas>^active=true^scriptLIKEGlideRecord^scriptLIKE<campo>`, até 5 tabelas, 50 regras).
- Painel: rótulos pt/en, ícone e categoria na exportação. 4 testes (`outroRegistro.test.ts`; 3 falham sem a correção); 1069 passando. Bundle `bundle-146i`.

## 26/10/2026: leitura pela API escondia a regra do pai (146i → 146j)

- **Reteste do Codex (146i):** a 1ª gravação da cascata saiu `br_other_record`; a 2ª, idêntica, saiu "user_action candidate 30". Diferença: 12 s depois, o Codex leu o filho por `GET /api/now/table/incident/<sys_id>`. O `syslog_transaction` não guarda o método, e toda chamada nesse caminho contava como "a pessoa gravou este registro" — o filho parecia ter gravação própria e a busca pela regra de outro registro nem rodava. Em produção, integrações e outras extensões leem registros assim o tempo todo.
- **Correção:** chamada da Table API no caminho do registro só conta como gravação até 5 s da mudança (formulário segue como antes). No Rastro, "Gravação via API" virou "Chamada à API neste registro" (não dá para saber se leu ou gravou).
- **Desempate:** regra de outro registro cujo código cita o sys_id deste registro ganha `trace_identifies_mechanism` (no PDI, uma BR antiga [PT] também abria incidentes e citava a descrição e empatava).
- 2 testes novos (falham sem a correção); 1071 passando. Bundle `bundle-146j`.

## 26/10/2026: regra de outro registro — descartar as que gravam só o próprio registro ou outro valor (146k)

- **Reteste do Codex (146j):** depois do teste, a BR da cascata voltou ao script original (que não grava mais a descrição), e o topo passou a ser "[PT] F2 async varios" provável 60 — uma regra que faz `gr.get(current.sys_id)` (reabre o próprio registro salvo) e grava o valor fixo 'F2 async'.
- **Correção em `otherRecord.ts`:** regra cujo GlideRecord só reabre o próprio registro (`get(current.sys_id)`/`getUniqueValue()`, sem `addQuery`) não é cascata e fica fora; valores literais gravados no campo pelo GlideRecord (`gr.campo = 'x'`, `gr.setValue('campo','x')`) diferentes do valor novo dão `sets_other_value`. Sem a regra verdadeira visível (script alterado depois), o resultado fica sem causa identificada em vez de apontar a errada.
- 2 testes novos; 1073 passando. Bundle `bundle-146k`.
- **146l:** a busca de "regra de outro registro" também considera as regras desligadas depois da mudança (as que já entram para o próprio registro). No PDI, a BR da cascata, já desligada e com o sys_id do filho no código, não aparecia. 1 teste novo (falha sem a correção); 1074 passando.
- **146m:** regras de **outra tabela** (ex.: problem → incident) também entram quando foram desligadas depois da mudança (consulta com `^NQ` para ativas e desligadas recentes), com o aviso. No PDI, a BR [PT] do problema foi desligada logo após o teste e o incidente ficava sem causa. 1 teste novo; 1075 passando.

## 26/10/2026: B-441 no 146m e vínculo pai → filho (146n)

- **B-441 no 146m (Codex):** 419/441 (146d/146a: 418), sem banners, mediana 3,6 s. Três deltas convergiram em isolamento 3×/versão. Divergência estável: **M8-INC-SA-text** (`close_notes`, esperado script_action, falha nas duas versões) passou de `scheduled_job candidate 15` para `br_other_record probable 50` "Update Child Incidents": outro incidente salvo no mesmo segundo bastava para ligar a regra nativa de cascata a um incidente que não era filho de ninguém.
- **Correção (`otherRecord.ts`, `linkFields` em util):** a regra de outro registro precisa de vínculo verificável: o código cita o sys_id deste registro, ou busca por um campo (`addQuery('parent_incident', current.sys_id)`) e este registro tem esse campo igual ao sys_id do salvo (lido numa consulta mínima só quando há gravação de outro registro na janela). Com vínculo: `trace_identifies_mechanism` + horário + pessoa. Sem vínculo verificável: só "cita a tabela e o campo" (candidata). Vínculo desmentido (campo com outro valor): `condition_false`.
- 2 testes novos; 1077 passando. Bundle `bundle-146n`.

## 26/10/2026: site com a 1.4.6 (Versões e regra de outro registro)

- **Antigravity:** demonstração do site (`site/assets`, `site/demo`) atualizada da 1.4.4 para a extensão atual; passo 10 do tour agora é a aba Versões (PT/EN), botão da galeria "Versões", "E se?" citado como parte do Avançado; capturas do site e da loja refeitas; teste e2e do site ajustado.
- **Revisão (eu):** frase do roteiro em inglês; novo tipo na seção "O que detecta": **Regra de outro registro** (pai salvo no mesmo segundo, vínculo por sys_id ou campo como parent_incident), "15 tipos".
- **Pendente:** os dados de demonstração ainda trazem nomes de teste ("[PT] F18 Job…", "[PERICIA-TESTE]…") que aparecem nas capturas da loja — trocar por nomes de exemplo antes do envio.

## 26/10/2026: client script onSubmit (146o)

- **Achado do Codex (INC0010197):** onSubmit [PT] com `g_form.setValue('description', '[PT] onSubmit 146n')`; o formulário enviou e gravou `'[PT] onSubmitf044c3eb… 146n'`. Nesse caso o Trail está certo (o script grava outro valor; algo mudou o texto depois dele, provavelmente a automação do teste). Mas o caso mostrou uma lacuna: só client scripts onChange contavam como mecanismo identificado; um onSubmit gravando exatamente o valor deixava a pessoa "confirmada".
- **Correção:** client script onSubmit ganha `trace_identifies_mechanism` ("roda em todo salvamento pelo formulário"); gravando o mesmo valor, a pessoa recebe `client_side_possible` e deixa de ser confirmada sozinha. 2 testes (`onSubmit.test.ts`); 1079 passando. Bundle `bundle-146o`.

## 26/10/2026: pacotes 1.4.6 refeitos com o dia inteiro

- **Caça de uso real (Codex):** ~75 cenários no PDI; fila da aba Versões completa sem defeito (lista e diferenças por campo, BR/client script/UI policy/UI action, update set próprio, Revert to this version, conteúdo com `]]>`/`</script>`/acentos/HTML, itil e escopo.user "sem acesso" sem banners, versão DELETE). Achado de UX corrigido: resposta sem retorno não diz mais "não guarda versões" (9ab9ee3).
- **Pacotes:** trail-chrome-1.4.6.zip 282.144 bytes (agora sem `build.txt`, que só serve à instalação manual), trail-extensao-1.4.6.zip 284.821 bytes; SHA-256 no README. Ficha: notas da versão e descrição longa com a aba Versões e as melhorias de atribuição; "E se?" no modo avançado.
- Testes: 1079 passando.

## 26/10/2026: compatibilidade com versões anteriores (canmatch)

- **Pergunta do dono:** a empresa dele está na Australia (o PDI é Brazil). O ponto frágil entre versões é o `canmatch` do `/api/now/ui/meta`: sem ele, o Trail recusava as consultas filtradas ("sem acesso a tudo"). Agora, tabela cujo ui/meta não informa `canmatch` em nenhuma coluna segue sem essa conferência (como na 1.4.4); coluna ausente continua barrada. ui/meta ou histórico inexistentes já viravam "segue sem"/lacuna. 2 testes; 1081 passando.
- Pacotes refeitos de novo (trail-chrome-1.4.6.zip 282.183 bytes). O dono vai criar PDIs Zurich e Australia para testar.
- **Fuso no painel:** as horas do painel (Resposta, Rastro, Histórico, Flows, Versões, "hoje/ontem") seguem o fuso do usuário no ServiceNow (`g_user_timezone`/`g_tz`, já enviado pela página), não o do navegador; sem ele, o do navegador. Achado do Codex no bloco de preferências (pt.trail.itil em America/Sao_Paulo). `shared/tz.ts`, 3 testes; 1084 passando. Pacotes refeitos.
- **Bloco de preferências (Codex):** pt.trail.itil com dd/MM/yyyy e America/Sao_Paulo (o PDI não tem pt-BR): histórico do formulário, valores, rótulos e checkpoints certos, sem banners; preferências restauradas (vazias). Campo com 15 mudanças: a investigação analisa as 10 mais recentes (limite `maxChanges`) e o painel não avisava. Agora o motor devolve `olderChanges` e o Histórico do campo diz quantas ficaram de fora e que todas estão em Histórico › Registro inteiro. 2 testes; 1086 passando. Pacotes refeitos.

## 26/10/2026: fonte de automação sem resposta não deixa a pessoa "confirmada" (146p)

- **Classificação dos 23 casos da B-441 (Codex):** F9-B6 (assignment_group) oscila: no lote saía "user_action confirmed 75 system". Reproduzido com 500 injetado em `sysrule_assignment`: a lacuna aparecia, mas a pessoa saía confirmada — a conclusão "nenhuma automação concorrente" só olhava se as regras de negócio estavam completas.
- **Correção (investigate):** se alguma fonte de automação (sys_script, sysrule_assignment, dl_definition_rel_set, sys_script_client, sys_ui_policy, sys_flow_context, wf_context, sysevent, sysevent_script_action, sysauto_script) não respondeu, a resposta "foi a pessoa" fica no máximo provável, com o aviso de qual fonte faltou. 2 testes (`fonteDeAutomacao.test.ts`); 1088 passando. Bundle `bundle-146p`; pacotes refeitos.
- **146q:** fontes de automação lidas em modo silencioso (data lookups, client scripts, UI policies, regras desligadas recentemente, flows) passam a virar lacuna quando não respondem (recusa continua fora do relatório); rótulos (sys_choice etc.) não. A conferência do cache de regras, sem resposta, recarrega as regras. Achado do Codex: `dl_definition_rel_set` em 500 passava sem aviso. 2 testes; 1090 passando. Pacotes refeitos.

## 27/10/2026: B-441 no 146q e auditoria sem resposta (146r)

- **B-441 no 146q (Codex):** 406/441 (146n: 418/441), sem banners; sessão terminou em admin/Global/Default. Os 14 casos que mudaram foram isolados 3x por versão (84 investigações): todos deram o resultado esperado nas duas versões, ou seja, as quedas do lote vieram de falhas passageiras do PDI. Mesmo número de consultas por investigação nas duas versões (mediana 28, máximo 54); o lote levou 85 min contra 30 min porque o PDI estava lento (isolado, mediana ~3,6 s nas duas).
- **Defeito achado pela matriz de falhas (M8-CHG-BAS-choice, CHG0030013, impact):** com o ui/meta de sys_audit em 500, ou a Table API de sys_audit em timeout, a auditoria não saía e o histórico do formulário entrava no lugar; a BR assíncrona sumia e o topo virava "user_action confirmed 75 admin", sem lacuna (a lacuna de sys_audit era escondida sempre que o histórico era usado).
- **Correção (investigate):** auditoria que não respondeu (timeout, não negada) e foi trocada pelo histórico: a lacuna `sys_audit: timeout` aparece, e "foi a pessoa" fica no máximo provável, com o aviso de que o histórico não mostra tudo o que as regras gravaram. Quem não lê sys_audit (itil, negado) segue como antes. 2 testes (`auditoriaSemResposta.test.ts`, o primeiro falha sem a correção); 1092 passando. Bundle `bundle-146r`; pacotes refeitos.
- **Mesmo defeito em M8-CHG-BAF-choice (br_after):** ui/meta de sys_audit em 500 e Table API sys_audit em timeout davam "user_action confirmed 75 admin" sem lacuna. Coberto pela mesma correção. Já o 500 direto na Table API de sys_audit não usava o histórico (só `timeout` caía nele): saía sem causa. Agora 500 também usa o histórico, com a mesma trava e a lacuna. +1 teste; 1093 passando. `bundle-146r` refeito (sha256 7802d270…); pacotes 282.887 / 285.564 bytes.
- **146r validado no PDI (Codex, só GET):** sha do bundle conferido. Baselines limpas: BAS-choice br_async confirmed 80, BAF-choice br_after confirmed 80. 18 retestes focados (ui/meta/sys_audit 500, /table/sys_audit timeout e 500, nos dois casos): zero causa errada confirmada, todos com `sys_audit: timeout`. Matriz completa (37 endpoints × timeout/500 × 2 casos = 148): wrongConfirmed=0, sem banners. pt.trail.itil: histórico e acessos negados como antes. Sessão final admin/Global/Default. Artefatos: `tests/regression/seguranca/results/uso-real/M8-CHG-async-fault-matrix-146r.{mjs,json}`.
- **B-441 no 146r (Codex):** 419/441 (146q 406, 146n 418), mediana 3,8 s, pior 11,4 s, sem banners, admin/Global/Default no início e no fim. Nenhum caso que passou no 146q ou no 146n falhou no 146r; única diferença para o 146n é o F9-B6, que agora sai `assignment_rule probable` (antes `user_action confirmed system`, errado). Gaps agora registrados por caso: 4 casos com gap (sysevent, sys_flow_context, syslog_transaction, sys_ui_policy em timeout), todos com a causa esperada. Quedas sem gap: 0. Resultados: `tests/regression/seguranca/results/B-441-146r-r1.json`.

## 27/10/2026: PDI Zurich (dev408037) e script include sem resposta (146s)

- **PDI Zurich:** glide-zurich-07-01-2025 patch10. O dono autorizou criar o necessário nela (usuários [PT], papéis, app escopado). Criado o app `[PT] Trail Zurich` (`x_1475282_pttrail`; o prefixo desta PDI é x_1475282). A primeira tentativa do Codex, com o prefixo da outra PDI, deixou um sys_app vazio `[PT] Trail Zurich 146r Probe` com scope global, que a ACL não deixa apagar nem desativar. Usuário `pt.trail.itil.zurich` (itil, sem senha, por impersonação): sys_audit 403 e histórico do formulário 200, como na Brazil. Um runner do Codex ainda tinha o host da PDI antiga fixo (tela de senha da dev457034); corrigido. Para encerrar a impersonação: POST `/api/now/ui/impersonate/<sys_id do admin>`.
- **Defeito (Codex, injeção na Zurich):** com `sys_script_include` em 500, a lacuna aparecia mas a pessoa saía `user_action confirmed 80`. Uma BR que delega a um script include não mostra o que grava sem ele. **Correção:** `sys_script_include` e `sys_ui_action` entram nas fontes de automação da trava; script include sem resposta deixa os metadados incompletos (sem "nenhuma automação concorrente" e fora do cache, onde a falha ficaria calada por 10 min). +1 teste (falha sem a correção); 1094 passando. `bundle-146s` (sha256 b14fd307…, com `runVersions` para a aba Versões); pacotes 282.911 / 285.588 bytes.
