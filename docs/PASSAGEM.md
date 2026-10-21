# Trail: passagem do projeto

Estado em 20/10/2026, versão **0.12.7**. Documento para quem continua o projeto, seja outra sessão do Claude, outro agente ou outra pessoa. Leia este arquivo inteiro junto com `docs/DIARIO.md` (o registro contínuo de trabalho) antes de mexer em qualquer coisa.

---

## 1. O que é

O Trail é uma extensão MV3 para Edge e Chrome que responde, para qualquer campo de um registro do ServiceNow: **o que mudou este campo, quando e por quê**. A extensão não grava nada na instância. Ela só lê pela Table API, usando a sessão de quem está logado e o token `X-UserToken`. Não tem telemetria nem servidor próprio.

A pergunta que o produto responde, com detalhes **claros** e que **qualquer pessoa entenda** (mesmo um desenvolvedor), é sempre esta: o que aconteceu, o que está acontecendo, quem ou o quê fez, e com que certeza. Toda mudança de interface deve ser julgada por esse critério. O dono do produto pediu explicitamente que seja simples de usar e de entender.

## 2. Estrutura do repositório

```
packages/core/              motor (TypeScript puro, sem navegador; roda em Node e no navegador)
  src/investigate.ts        pipeline: registro + auditoria → rastros (transações, eventos, flows, workflows,
                            import sets, contexto gravado) → artefatos → assinaturas → pontuação
  src/signatures/           uma assinatura por arquivo; recebem dados já carregados, não chamam a rede
  src/scoring.ts            pesos dos fatos (FactKind) e faixas de certeza (confirmed / probable / candidate)
  src/preview.ts            "E se eu mudar?": simula o que roda se o campo for para outro valor (só leitura)
  src/batch.ts              lote (mesmo campo em vários registros) e registro inteiro (vários campos), grupos e CSV
  src/timeline.ts           linha do tempo do registro inteiro e comparação entre dois momentos
  src/fieldMap.ts           mapa de automações que podem gravar um campo
  src/pingpong.ts           duas automações trocando o valor entre si
  src/display.ts            nomes do formulário: rótulo do campo (sys_documentation + sys_dictionary), texto do choice, nome do registro referenciado
  src/conflicts.ts          regras que gravam o mesmo campo com valores diferentes
  src/access.ts             detector de acesso (completo / parcial / sem acesso)
  src/client/               RestClient (interface), FetchRestClient, FakeRestClient (testes)
  test/                     133 testes unitários do motor (vitest; 135 no total com extension/test)
extension/                  MV3 (Preact + Vite)
  public/manifest.json      versão, permissões (host só opcional, por instância)
  src/background/           service worker: roda o motor, guarda estado por aba em chrome.storage.session, abre o painel, vigia build.txt em modo descompactado e reinjeta abas conectadas
  src/content/main.ts       ícones nos campos (UI16, Workspace, Service Portal, colunas da lista), contexto da página e limpeza quando o script fica órfão após reload
  src/content/floatPanel.ts bolinha-assistente (#trail-assistant) e painel flutuante estilo janela do Mac (#trail-float, padrão desde a 0.12)
  src/content/diffWindow.ts janela "lado a lado" da diferença de textos longos
  src/page/                 mundo MAIN: lê g_ck, idioma da sessão e o contexto do formulário
  src/sidepanel/            o painel: App, Result (5 abas), Batch, Timeline, WhatIf, FieldMap, Loading (trilha com lupa), Val (valor com link)
  src/options/              opções (tema, idioma, onde abrir o painel, ícones, bolinha-assistente)
  src/shared/               i18n (pt e en; toda chave nova nas DUAS línguas), ui.css (tokens), demo, prefs, mensagens
  test/                     2 testes unitários de diff e idioma
site/                       site de apresentação (site/b3) com o painel em modo demonstração (sincronizado por tests/e2e/_sync-site.sh)
tools/                      atualizar-extensao.sh: copia extension/dist para ../trail-extensao (auto-reload) e gera ../trail-edge-<versão>.zip
tests/e2e/                  8 suítes Playwright com a extensão carregada no Chromium (smoke, ui16, list, portal, workspace, prefs-window, float, reload)
tests/regression/           bateria contra o PDI de testes: cases.json (441 casos), scripts de montagem, testes cegos
  browser/                  bundle IIFE (TrailRegression) para rodar a bateria dentro de uma aba logada
  results/                  relatórios das rodadas (fora do git, no .gitignore)
docs/                       DIARIO.md (registro contínuo), decisões, papel de leitura mínimo, fase 2 (app escopado), loja do Edge, esta passagem
```

## 3. Como compilar, testar e atualizar a extensão

```bash
npm install
npx playwright install chromium
npm run typecheck                  # tsc -b
npm test                           # 135 testes unitários (133 do motor + 2 da extensão)
npm run build                      # core + extensão → extension/dist (inclui dist/build.txt)
npm run e2e                        # 8 scripts: smoke, ui16, list, portal, workspace, prefs-window, float e reload
bash tools/atualizar-extensao.sh   # copia para ../trail-extensao (sem .map) e gera ../trail-edge-<versão>.zip
```

- **Carregar no navegador e auto-reload:** abra `edge://extensions` (ou `chrome://extensions`), ligue o modo de desenvolvedor, clique em "Carregar sem compactação" e escolha `../trail-extensao` (gerada por `bash tools/atualizar-extensao.sh`). Quando carregada sem compactação (sem `update_url`), o service worker confere `build.txt` a cada 3 s, recarrega a extensão sozinho quando um novo build é copiado e reinjeta `page.js` e `content.js` nas abas conectadas.
- **Nota para Windows + Node 24:** `fs.cpSync` derruba o processo sem mensagem (código 127) no Node 24 para Windows; nos scripts de build/sync use cópia manual arquivo a arquivo.
- **Ver o painel sem instância (modo demonstração):**
  - `src/sidepanel/index.html?demo=1&float=1` (cabeçalho de janela flutuante; na gaveta "Investigar", funciona tanto "Um campo" quanto "O registro inteiro")
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

## 4. Estado atual (0.12.7)

| Item | Situação |
|---|---|
| Versão atual | **0.12.7** |
| Bateria do PDI | **441/441** com o motor da 0.12.1 (mediana de **2,5 s** e **26 chamadas** por investigação; as 2 chamadas extras vêm de `sys_documentation`) |
| Testes cegos | blind5: 35/35. blind6: 27/27 alvos válidos (8 excluídos porque os campos não estão no formulário) |
| Unitários | **135** passando (133 do motor + 2 da extensão) |
| e2e | **8 de 8** passando (`smoke`, `ui16`, `list`, `portal`, `workspace`, `prefs-window`, `float`, `reload`) |
| Fase 2 (app escopado) | Protótipo funcionando no PDI de testes (fase 18, 5/5 com certeza alta). Desenho em `docs/fase2-app-escopado.md` |

### O que entrou da 0.12.2 à 0.12.7

- **Bolinha-assistente no canto da página (`#trail-assistant`, 0.12.6–0.12.7):**
  - Fica sempre visível nas páginas da instância conectada (pode ser desligada nas Opções).
  - Pode ser arrastada (mouse e toque); ao soltar, encosta na borda mais próxima e lembra a posição por instância.
  - **Boas-vindas e dica (0.12.7):** o balão de boas-vindas aparece uma única vez por registro (`origem + tabela + sys_id`) e fecha após 6 s; a dica rápida só aparece ao passar o mouse sobre a bolinha (`pointerenter`) e some 150 ms depois que o mouse sai. O aviso "Trail conectado" também sai como balão da bolinha, sem cobrir o clique.
  - Clicar na bolinha abre o painel flutuante; fechar no `X`, apertar `Esc`, clicar na setinha lateral ou minimizar escondem o painel de volta na bolinha.
- **Painel flutuante estilo janela do Mac (`0.12.2–0.12.7`):**
  - Cantos arredondados (`12 px`), margem de `8 px` da borda e botões no cabeçalho para fechar, minimizar na bolinha, manter **sempre visível** e enviar para o painel lateral do Edge (`chrome.sidePanel.open` direto no clique; no painel lateral, o botão `↗` traz de volta para o painel flutuante na página).
  - **Sempre visível (Document Picture-in-Picture):** destaca o painel numa janela que o navegador mantém por cima de tudo, até de outros programas; fechar a janela devolve o painel para a página.
  - Redimensionável por qualquer borda ou canto (quando encostado: borda interna, borda inferior e canto entre elas, respeitando mínimo de `340×260`).
  - Clicar no ícone da extensão numa aba ServiceNow ainda não conectada pede a permissão no próprio clique e já abre o painel flutuante; quando abre em janela separada, ela nasce encostada à direita do navegador.
- **"Tudo que mudou" em grupos por momento e trilha animada com lupa (`0.12.3–0.12.7`):**
  - A investigação do registro inteiro e o lote agrupam os campos salvos no mesmo minuto pelo mesmo autor/causa (*"admin salvou 4 campos"*), em blocos recolhíveis.
  - Na **0.12.7**, o registro inteiro e o lote usam a mesma animação da investigação de um campo (`sidepanel/Loading.tsx`: a trilha que se desenha com a lupa), com etapas próprias (*"Lendo a auditoria do registro…"*, *"Separando os campos que mudaram…"*), permanecendo visível enquanto os grupos entram embaixo.
- **Auto-reload e reinjeção sem F5 (`0.12.2, 0.12.6, 0.12.7`):**
  - O build gera `dist/build.txt` e `tools/atualizar-extensao.sh` publica esse arquivo por último em `../trail-extensao`.
  - Quando a extensão recarrega, o content script antigo detecta que ficou órfão, desliga observers/listeners e remove ícones, painel e bolinha antigos; o worker novo reinjeta `page.js` (sondando o mundo MAIN por frame para não duplicar) e `content.js` nas abas conectadas, ou quando uma aba não responde ao abrir o painel.
  - Suíte `tests/e2e/reload.mjs` testa a limpeza do script órfão e simula aba sem resposta para comprovar a reinjeção sem duplicar ícones.
- **Idioma da sessão do ServiceNow no motor (`0.12.2`):**
  - O mundo MAIN lê `g_user_lang`, `NOW.language`, `g_lang` ou `<html lang>` e passa ao motor (`pt-BR`, `pt` e `pb` mapeiam para `pb` no `sys_documentation`).
- **Site (`site/b3`) e loja (`docs/loja-edge.md`, `docs/store/`):**
  - Página `site/b3` atualizada até a 0.12.7: demonstração do formulário com a bolinha-assistente interativa + balão (boas-vindas uma vez + dica no hover), trilha com lupa, seção `#painel` sem sticky com linha do tempo vertical e autoplay de 5 s, roadmap com 5 itens visíveis + "Ver mais", FAQ começando fechado e tabela de 441 casos exibindo 30 linhas + "Ver mais (+30)".
  - Textos da loja (PT/EN) e capturas `1280×800` (`docs/store/shot-*.png`) atualizados para a 0.12.6/0.12.7.

### O que entrou na 0.12.0 e na 0.12.1

- **0.12.1:** rótulos por `sys_documentation` em paralelo à auditoria; comparador da linha do tempo renomeado para **"O que mudou entre dois momentos"** com frase explicativa; opção "O registro inteiro" funcionando no modo demonstração; site dentro do repositório em `site/`.
- **0.12.0:** painel flutuante na página como padrão; nomes e valores como no formulário em todo o painel (rótulos, display values no lugar de `sys_id` e links em referências); ícone em campos de referência do UI16 (`sys_display.`, `sys_readonly.`, `ni.`, `select_0`); seletor customizado na aba "E se?".

## 5. Pendências abertas (conforme `docs/DIARIO.md`)

1. **Achados médios do fluxo de recarga e injeção (`0.12.7`):**
   - `extension/src/background/index.ts` (~linha 130): se a injeção em todos os frames (`allFrames: true`) falhar, a reserva hoje reinjeta apenas no frame 0.
   - Depois de um auto-reload, `chrome.storage.session` é limpo, de modo que um painel que estava aberto ou minimizado volta como bolinha. Para mudar isso, falta decidir onde guardar esse estado entre reloads.
2. **Testes no navegador Edge real (fora do alcance do Chromium headless):**
   - Testar o modo **"Sempre visível"** (Document Picture-in-Picture) e a tecla `Esc` dentro da janela PiP (o Chromium headless não abre PiP).
   - Testar no Edge real com o PDI de testes: auto-reload completo após `tools/atualizar-extensao.sh`, painel flutuante sobre UI16 / Workspace / Portal, e rótulos em português (`pb`) numa sessão com idioma da instância em português.
3. **Fase 2 (app escopado `x_trail`):** os próximos passos estão em `docs/fase2-app-escopado.md`.
4. **Publicação na Edge Add-ons:** textos e capturas `1280×800` prontos em `docs/loja-edge.md` e `docs/store/`. **O envio e o aceite dos termos são ação exclusiva do dono.**

## 6. PDI de testes e itens criados nele

- **Instância:** o PDI de testes. As baterias rodaram numa aba já logada (no Edge ou no portal do Maestri).
- **Regra para itens de teste:**
  - todo item de teste leva o prefixo **[PT]** e fica restrito aos próprios registros (filtros por `short_description` que começa com "[PT] ...");
  - nunca alterar nem apagar registros que não foram criados pelos testes.

Itens criados e ainda presentes no PDI de testes:

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
- **Não publicar o e-mail do dono nem URL/nome da instância PDI ou usuários de teste em lugar nenhum** (site, repositório, loja).
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
