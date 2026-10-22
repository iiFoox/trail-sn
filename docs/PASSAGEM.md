# Trail: passagem do projeto

Estado em 21/10/2026 (22h), versão **1.4.0** — o resumo mais atual está no topo de `docs/PROXIMOS-PASSOS.md` (painel da 1.0.0 como padrão + Modo avançado desligado por padrão; módulos novos do motor `fieldState`, `fieldDeps`, `saveTiming`, `visibility`, `compare`). As seções abaixo descrevem a base até a 0.13.0. Documento para quem continua o projeto, seja outra sessão do Claude, outro agente ou outra pessoa. Leia este arquivo inteiro junto com `docs/DIARIO.md` (o registro contínuo de trabalho) antes de mexer em qualquer coisa.

---

## 1. O que é

O Trail é uma extensão MV3 para Edge e Chrome que responde, para qualquer campo de um registro do ServiceNow: **o que mudou este campo, quando e por quê**. A extensão não grava nada na instância. Ela só lê usando a sessão de quem está logado e o token `X-UserToken`. Não tem telemetria nem servidor próprio.

A pergunta que o produto responde, com detalhes **claros** e que **qualquer pessoa entenda** (mesmo um desenvolvedor), é sempre esta: o que aconteceu, o que está acontecendo, quem ou o quê fez, e com que certeza. Toda mudança de interface deve ser julgada por esse critério. O dono do produto pediu explicitamente que seja simples de usar e de entender, e que **funcione também para quem não é admin**, sem instalar nada na instância e sem criar papel novo (`docs/sem-admin.md`).

## 2. Estrutura do repositório

```
packages/core/              motor (TypeScript puro, sem navegador; roda em Node e no navegador)
  src/investigate.ts        pipeline: registro + auditoria (ou histórico do formulário) → rastros (transações,
                            eventos, flows, workflows, import sets, contexto gravado) → artefatos → assinaturas → pontuação
  src/history.ts            leitura do histórico do formulário quando sys_audit é negada (modo sem admin)
  src/signatures/           uma assinatura por arquivo; recebem dados já carregados, não chamam a rede
  src/scoring.ts            pesos dos fatos (FactKind) e faixas de certeza (confirmed / probable / candidate)
  src/preview.ts            "E se eu mudar?": simula o que roda se o campo for para outro valor (só leitura)
  src/batch.ts              lote (mesmo campo em vários registros) e registro inteiro (vários campos), grupos e CSV
  src/timeline.ts           linha do tempo do registro inteiro e comparação entre dois momentos
  src/fieldMap.ts           mapa de automações que podem gravar um campo
  src/pingpong.ts           duas automações trocando o valor entre si
  src/display.ts            nomes do formulário: rótulo do campo (sys_documentation + sys_dictionary), texto do choice, nome do registro referenciado
  src/conflicts.ts          regras que gravam o mesmo campo com valores diferentes
  src/access.ts             detector de acesso e capacidades (completo / parcial / sem acesso + aviso de lentidão)
  src/client/               RestClient (interface), FetchRestClient, FakeRestClient (testes)
  test/                     138 testes unitários do motor (vitest; 144 no total com extension/test)
extension/                  MV3 (Preact + Vite)
  public/manifest.json      versão, permissões (host só opcional, por instância)
  src/background/           service worker: roda o motor, guarda estado por aba (float:<tabId> em storage.local), abre o painel, vigia build.txt em modo descompactado e reinjeta abas conectadas
  src/content/main.ts       ícones nos campos (UI16, Workspace, Service Portal, colunas da lista), contexto da página, atalho de teclado e limpeza quando o script fica órfão após reload
  src/content/floatPanel.ts bolinha-assistente (#trail-assistant) e painel flutuante (#trail-float, padrão desde a 0.12)
  src/content/diffWindow.ts janela "lado a lado" da diferença de textos longos
  src/page/                 mundo MAIN: lê g_ck, idioma da sessão e o contexto do formulário
  src/sidepanel/            o painel: App, Result (5 abas), Batch, Timeline, WhatIf, FieldMap, Settings (configurações no painel), Loading (trilha com lupa), Val (valor com link)
  src/options/              opções completas (tema, idioma, animações, atalho, onde abrir o painel, ícones, bolinha-assistente)
  src/shared/               i18n (pt e en; toda chave nova nas DUAS línguas), ui.css (tokens), demo, prefs, mensagens
  test/                     6 testes unitários da extensão (i18n, preferências, diff e idioma)
site/                       site de apresentação (site/b3) com o painel em modo demonstração (sincronizado por tests/e2e/_sync-site.sh)
tools/                      atualizar-extensao.sh: copia extension/dist para ../trail-extensao (auto-reload) e gera ../trail-edge-<versão>.zip
tests/e2e/                  9 suítes Playwright com a extensão carregada no Chromium (smoke, ui16, list, portal, workspace, prefs-window, float, reload, settings)
tests/regression/           bateria contra o PDI de testes: cases.json (441 casos), scripts de montagem, testes cegos
  browser/                  bundle IIFE (TrailRegression) para rodar a bateria dentro de uma aba logada
  results/                  relatórios das rodadas (fora do git, no .gitignore)
docs/                       DIARIO.md (registro contínuo), sem-admin.md (modo sem admin), decisões, papel opcional (papel-leitura.md), fase 2 (app escopado), loja do Edge, esta passagem
```

## 3. Como compilar, testar e atualizar a extensão

```bash
npm install
npx playwright install chromium
npm run typecheck                  # tsc -b
npm test                           # 144 testes unitários (138 do motor + 6 da extensão)
npm run build                      # core + extensão → extension/dist (inclui dist/build.txt)
npm run e2e                        # 9 scripts: smoke, ui16, list, portal, workspace, prefs-window, float, reload e settings
bash tools/atualizar-extensao.sh   # copia para ../trail-extensao (sem .map) e gera ../trail-edge-<versão>.zip
```

- **Carregar no navegador e auto-reload:** abra `edge://extensions` (ou `chrome://extensions`), ligue o modo de desenvolvedor, clique em "Carregar sem compactação" e escolha `../trail-extensao` (gerada por `bash tools/atualizar-extensao.sh`). Quando carregada sem compactação (sem `update_url`), o service worker confere `build.txt` a cada 3 s, recarrega a extensão sozinho quando um novo build é copiado e reinjeta `page.js` e `content.js` em todos os frames das abas conectadas.
- **Nota para Windows + Node 24:** `fs.cpSync` derruba o processo sem mensagem (código 127) no Node 24 para Windows; nos scripts de build/sync use cópia manual arquivo a arquivo.
- **Ver o painel sem instância (modo demonstração):**
  - `src/sidepanel/index.html?demo=1&float=1` (cabeçalho de janela flutuante; na gaveta "Investigar", funciona tanto "Um campo" quanto "O registro inteiro", além de `⚙ Configurações`)
  - `&batch=1` mostra o lote.
  - `&batch=rec` mostra o registro inteiro; `&batch=rec&wait=1` mostra a trilha animada com a lupa em andamento.
  - `&tab=whatif` abre na aba "E se?".
- **Prints do site e da loja:** `node site/tools/shots.mjs` gera as imagens de `site/b3/img/*.png` e as capturas `1280×800` de `docs/store/shot-*.png`; `node tests/e2e/_site-demo.mjs` valida todo o site `site/b3`.

### Bateria no PDI de testes

A bateria roda dentro de uma aba já logada no PDI de testes (por exemplo via portal do Maestri ou console do navegador). Assim nenhuma senha passa pelo código.

1. Compile o bundle: `npx vite build -c tests/regression/browser/vite.config.ts`. A saída é `tests/regression/browser/dist/regression.js`.
2. Injete o bundle numa aba logada do PDI de testes.
3. No console, rode:
   - `await TrailRegression.runRegression()` para todos os casos;
   - `TrailRegression.runOne({table, number, field})` para um caso só.

A alternativa em Node com usuário e senha (`npm run regression`) existe, mas **não foi usada**: a regra é nunca digitar senhas.

## 4. Estado atual (0.13.0)

| Item | Situação |
|---|---|
| Versão atual | **0.13.0** |
| Bateria do PDI | **441/441** com o motor da 0.12.1 (mediana de **2,5 s** e **26 chamadas** por investigação; será atualizada na rodada da 0.13.0) |
| Testes cegos | blind5: 35/35. blind6: 27/27 alvos válidos (8 excluídos porque os campos não estão no formulário) |
| Unitários | **144** passando (138 do motor + 6 da extensão) |
| e2e | **9 de 9** passando (`smoke`, `ui16`, `list`, `portal`, `workspace`, `prefs-window`, `float`, `reload`, `settings`) |
| Fase 2 (app escopado) | **Arquivada** (decisão do dono, 2026-10-21): o Trail fica só no navegador, como o SN Utils, sem nada instalado na instância. Histórico em `docs/fase2-app-escopado.md` |

### O que entrou da 0.12.8 à 0.13.0

- **Perícia para quem não é admin (`0.13.0`, detalhes em `docs/sem-admin.md`):**
  - **Nada instalado na instância e nenhum papel novo:** o Trail usa a sessão de quem está logado e pede cada fonte; as ACLs do servidor decidem o que vem e o que fica negado. Não há lógica por papel no código.
  - **Histórico do formulário quando `sys_audit` é negada (`packages/core/src/history.ts`, `RestClient.history`):** lê `/angular.do?sysparm_type=list_history` (o Activity Stream do formulário, com as ACLs do usuário), converte rótulos de lista de volta para o valor interno usando `/api/now/ui/meta/<tabela>` e resolve o autor em `sys_user` pelo `user_id`. Vale também para a linha do tempo do registro inteiro. Quando o campo investigado não está no Activity Stream da tabela, marca `fieldNotInHistory` e o painel informa isso em vez de dizer que não houve mudança.
  - **Correção de falso processo de fundo (`ChangeContext.txDenied`):** quando `syslog_transaction` é negada (403), o motor não interpreta mais "sem transação" como prova de execução em segundo plano; se nenhuma outra fonte explicar a mudança, apresenta o autor da gravação em grau candidato, explicando a lacuna.
  - **Aviso de acesso por capacidade ("O que os seus papéis deixam o Trail ver"):** mostra em linguagem simples o que entrou e o que ficou de fora por capacidade (*quem mudou e quando*, *regras automáticas*, *flows*, *jobs*, *eventos*, *botões* e *transações*, cada um com `✓`, `◐` ou `–`), deixando os nomes técnicos das tabelas recolhidos em "detalhes técnicos".
- **Cabeçalho novo e configurações dentro do painel (`0.12.8–0.12.9`, `extension/src/sidepanel/Settings.tsx`):**
  - Cabeçalho limpo (sem as bolinhas coloridas do Mac): marca, nome e instância à esquerda; à direita, nesta ordem: `⚙` configurações, painel lateral do Edge, alternância de tema e `✕` (que esconde na bolinha com animação de minimizar).
  - Folha **⚙ Configurações** dentro do próprio painel: tema, idioma, animações liga/desliga (`motion`), atalho para abrir e fechar (`panelKey`, grava a combinação apertada, padrão `Alt+Shift+P` e funciona mesmo com o foco dentro do iframe do formulário via `postMessage`), ícones nos campos, bolinha-assistente, onde o painel abre, **Sempre visível** (Document Picture-in-Picture) e link para todas as opções.
  - Suíte `tests/e2e/settings.mjs` cobre a folha de configurações inteira.
- **Fim do falso "sem acesso" em instâncias lentas (`0.12.8`):**
  - O prazo por consulta subiu de 3 s para 8 s e as tabelas que estouram tempo são consultadas uma segunda vez.
  - `AccessReport.slow` fica separado de `denied` (que só registra 401/403 reais), exibindo aviso leve *"A instância demorou a responder"* sem guardar resultado incompleto em cache.
- **Persistência do painel flutuante e reinjeção em todos os frames (`0.12.9`):**
  - O estado aberto ou minimizado por aba (`float:<tabId>`) passou de `chrome.storage.session` para `chrome.storage.local` (limpo no `runtime.onStartup` por `clearFloatStates()`), de modo que um painel aberto não volta mais como bolinha após recarregar a extensão.
  - Quando a sondagem falha, a reinjeção de reserva aplica `page.js` (MAIN) e `content.js` em todos os frames (`allFrames: true`), e não apenas no frame 0.
- **Inspeção visual e polimento nos temas escuro e claro (`0.13.0`):**
  - 8 ajustes em `extension/src/shared/ui.css` após inspeção em `340 px`, `380 px` e `420 px` nos dois temas (tokens `--teal-2`, `--ok`, `--bad` e `--warn` no escuro, tons pastel e `--muted` no claro, `.dot` sem amassar, cabeçalhos do registro inteiro com elipse, pontinho de "Provas", botão `×` da comparação, filtros em `340 px` e recuo de "Outras regras").
- **Site (`site/b3`) mais leve e atualizado para a 0.13.0:**
  - Miniaturas de "Quatro passos" em imagens estáticas, carregamento ocioso (`data-src` + `IntersectionObserver`) dos 4 iframes interativos, `content-visibility: auto` e otimizações no canvas e no cursor (reduzindo o p95 de rolagem com CPU 4× mais lenta de `34,7 ms` para `20,9 ms`).
  - Seção `#acesso` reescrita por capacidade (como no painel) com os perfis **Admin**, **ITIL (sem admin)**, **ITIL + Flow Designer** e **Usuário básico**, FAQ com *"Preciso ser admin?"* no topo e item novo na Fase 1 do roadmap.

### O que entrou da 0.12.0 à 0.12.7

- **0.12.6–0.12.7:** bolinha-assistente no canto da página (`#trail-assistant`, arrastável, boas-vindas uma vez por registro e dica só no hover); trilha animada com lupa (`Loading.tsx`) também no registro inteiro e no lote; auto-reload em modo descompactado (`build.txt` + `tools/atualizar-extensao.sh`) e suíte `tests/e2e/reload.mjs`.
- **0.12.2–0.12.5:** painel flutuante redimensionável por qualquer borda/canto, botão **Sempre visível** (Document Picture-in-Picture), agrupamento de "Tudo que mudou" por momento (*"admin salvou 4 campos"*) e leitura do idioma da sessão do ServiceNow no mundo MAIN.
- **0.12.0–0.12.1:** painel flutuante como padrão; rótulos por `sys_documentation` e display values com links em referências; comparador **"O que mudou entre dois momentos"**; ícones em campos de referência do UI16; site dentro do repositório em `site/`.

## 5. Pendências abertas (conforme `docs/DIARIO.md`)

1. **Bateria no PDI de testes para a 0.13.0:**
   - Atualizar a rodada completa como admin e medir uma amostra personificando `pt.trail.itil` (histórico do formulário).
2. **Testes no navegador Edge real (fora do alcance do Chromium headless):**
   - Confirmar no navegador real que o painel aberto continua aberto após um auto-reload (`chrome.runtime.reload()` encerra a extensão no Playwright).
   - Testar o modo **"Sempre visível"** (Document Picture-in-Picture) e a tecla `Esc` dentro da janela PiP (o Chromium headless não abre PiP).
   - Testar no Edge real com o PDI de testes: painel flutuante sobre UI16 / Workspace / Portal e rótulos em português (`pb`).
3. **Nada instalado na instância:** a Fase 2 (app escopado) foi arquivada. Próximos passos: testes manuais no Edge, textos neutros para o Chrome, publicação nas lojas (o dono envia), uso em instância real.
4. **Publicação na Edge Add-ons:** textos e capturas `1280×800` prontos em `docs/loja-edge.md` e `docs/store/`. **O envio e o aceite dos termos são ação exclusiva do dono.**

## 6. PDI de testes e itens criados nele

- **Instância:** o PDI de testes. As baterias rodaram numa aba já logada (no Edge ou no portal do Maestri).
- **Regra para itens de teste:**
  - todo item de teste leva o prefixo **[PT]** e fica restrito aos próprios registros (filtros por `short_description` que começa com "[PT] ...");
  - nunca alterar nem apagar registros que não foram criados pelos testes.

Itens criados e ainda presentes no PDI de testes:

- **Usuários de teste `[PT]` sem senha (para personificação na 0.13.0, veja `docs/sem-admin.md`):**
  - `pt.trail.itil` (papel `itil`) e `pt.trail.aes` (`sn_app_eng_studio.user` + `flow_designer`), criados sem senha.
  - Uso exclusivamente por personificação (`/api/now/ui/impersonate/<sys_id>`) na aba já logada, **voltando sempre ao admin no fim**.
- Conta de integração de teste: criada sem senha e restrita a web service, com autorização do dono.
- **Fase 13:** UI policies (a reversa está restrita aos registros de teste), transform map e tabela de staging `u_pt_f13_import`, data policy.
- **Fase 14:** flow e subflow, ativos e restritos ao registro "[PT] F14-SUB1".
- **Fase 16:** definição de SLA (inativa) e os itens do blind6.
- **Fase 17:** as BRs do pingue-pongue.
- **Fase 18:** as BRs do contexto gravado e a tabela `u_pt_trail_contexto` (protótipo da Fase 2).
- Tabela `u_pt_trail_teste` e um registro em `sys_email` marcado como ignorado.

Os scripts de montagem estão em `tests/regression/pdi-setup-*.js` e `tests/regression/blind*/setup.js`.

## 7. Regras combinadas com o dono (valem para todos os agentes)

- **Nada deste projeto pode afetar outros projetos dele:** nem outros repositórios (por exemplo `painel-rh`), nem outros projetos da Vercel (por exemplo `paineis-difal` ou `estudio-ia-ensaios`), nem tarefas agendadas.
- **Não criar tarefas agendadas.**
- **Nunca digitar senhas.**
- **Não mudar propriedades do sistema da instância.**
- **Itens de teste no PDI:** só com o prefixo [PT] e restritos aos próprios registros (seção 6).
- **Não publicar o e-mail do dono nem URL/nome da instância PDI em lugar nenhum** (site, repositório, loja).
- **Envio para a loja do Edge e aceite de termos:** só o dono faz.
- **Interface:** em português simples, com o inglês completo no `i18n.ts`. Linguagem de gente, sem jargão quando houver alternativa.
- **A extensão é somente leitura.** Nenhum código da extensão grava na instância.
- **Sempre que houver uma versão nova, atualizar a pasta descompactada e o zip** com `bash tools/atualizar-extensao.sh`.

## 8. Site e Vercel

- **Arquivos no repositório:** o site fica na pasta `site/` na raiz do repositório (página principal em `site/b3/`; a raiz `/` redireciona para `/b3/`).
- **Painel embutido:** o site mostra o painel em modo demonstração. Os arquivos da extensão compilada são copiados para `site/` por `tests/e2e/_sync-site.sh` e verificados por `tests/e2e/_site-demo.mjs`.
- **Projeto na Vercel:** `trail-sn` (`prj_tHmuUpt91BSX0C89iUfAmgIAAtGN`), diretório raiz `site/`, sem build e sem proteção de login, publicado automaticamente a cada push no GitHub em https://trail-sn.vercel.app/b3/. O projeto antigo `trail-site` não é mais atualizado.

## 9. Git e GitHub

- **Repositório remoto (público):** `https://github.com/iiFoox/trail-sn`, branch `master`.
- **Padronização de linha:** `.gitattributes` força `LF` nos arquivos de texto do repositório.
- **Fora do git (veja o `.gitignore`):**
  - `extension/dist/` e `extension/dist-types/`;
  - `tests/regression/results/`: relatórios das rodadas no PDI de testes;
  - `tests/regression/.env`.

## 10. Como os agentes trabalham (`docs/DIARIO.md` e divisão de áreas)

- **`docs/DIARIO.md` é o registro contínuo do projeto:**
  - Toda sessão ou rodada registra no topo de `docs/DIARIO.md` (com data absoluta) o que foi feito, por qual agente e o que ficou em aberto no final da entrada.
  - Quem retoma o projeto lê `docs/PASSAGEM.md` para a visão geral e `docs/DIARIO.md` de cima para baixo para o histórico recente e pendências imediatas.
- **Coordenação em equipe no Maestri:**
  - **Claude Code:** coordenação, integração, commits/push no GitHub, publicação na Vercel e execução da bateria no PDI de testes.
  - **Codex:** motor (`packages/core`), service worker (`extension/src/background`), scripts de página/conteúdo (`extension/src/content`, `extension/src/page`) e suítes e2e da extensão.
  - **Antigravity:** interface do painel (`extension/src/sidepanel`, `extension/src/shared`), site (`site/b3`, `site/tools`, `tests/e2e/_site-demo.mjs`) e documentação (`README.md`, `docs/`).
- **Convenções de trabalho em paralelo:**
  - **Toda funcionalidade nova da extensão entra também no site (`site/b3`)**, mantendo o estilo visual dele (motion, revelação ao rolar, textos curtos); quem coordena revisa o visual antes de publicar.
  - Cada agente mexe **somente** nos arquivos da sua tarefa; quem integra e faz `git commit` / `git push` é o agente coordenador.
  - `i18n.ts` e `ui.css` são compartilhados: acrescente chaves no fim do bloco certo nas duas línguas (`pt` e `en`) e evite reordenar.
  - **Antes de entregar qualquer tarefa:** rode `npm run typecheck && npm test && npm run build` (e `npm run e2e` se mexer na extensão, ou `node tests/e2e/_site-demo.mjs` se mexer no site).
