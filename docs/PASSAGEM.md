# Trail: passagem do projeto

Estado em 20/10/2026, versão **0.12.1**. Documento para quem continua o projeto, seja outra sessão do Claude, outro agente ou outra pessoa. Leia este arquivo inteiro antes de mexer em qualquer coisa.

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
  src/batch.ts              lote (mesmo campo em vários registros) e registro inteiro (vários campos), CSV
  src/timeline.ts           linha do tempo do registro inteiro e comparação entre dois momentos
  src/fieldMap.ts           mapa de automações que podem gravar um campo
  src/pingpong.ts           duas automações trocando o valor entre si
  src/display.ts            nomes do formulário: rótulo do campo (sys_documentation + sys_dictionary), texto do choice, nome do registro referenciado
  src/conflicts.ts          regras que gravam o mesmo campo com valores diferentes
  src/access.ts             detector de acesso (completo / parcial / sem acesso)
  src/client/               RestClient (interface), FetchRestClient, FakeRestClient (testes)
  test/                     131 testes unitários do motor (vitest; 133 no total com extension/test)
extension/                  MV3 (Preact + Vite)
  public/manifest.json      versão, permissões (host só opcional, por instância)
  src/background/           service worker: roda o motor, guarda estado por aba em chrome.storage.session, abre o painel
  src/content/main.ts       ícones nos campos (UI16, Workspace, Service Portal, colunas da lista), contexto da página
  src/content/floatPanel.ts painel flutuante dentro da página (padrão desde a 0.12)
  src/content/diffWindow.ts janela "lado a lado" da diferença de textos longos
  src/page/                 mundo MAIN: lê g_ck e o contexto do formulário
  src/sidepanel/            o painel: App, Result (5 abas), Batch, Timeline, WhatIf, FieldMap, Val (valor com link)
  src/options/              opções (tema, idioma, onde abrir o painel, ícones)
  src/shared/               i18n (pt e en; toda chave nova nas DUAS línguas), ui.css (tokens), demo, prefs, mensagens
  test/                     2 testes unitários de diff
site/                       site de apresentação com o painel em modo demonstração (sincronizado por tests/e2e/_sync-site.sh)
tests/e2e/                  Playwright com a extensão carregada num Chromium (fixtures offline, sem instância)
tests/regression/           bateria contra o PDI de testes: cases.json (441 casos), scripts de montagem, testes cegos
  browser/                  bundle IIFE (TrailRegression) para rodar a bateria dentro de uma aba logada
  results/                  relatórios das rodadas (fora do git, no .gitignore)
docs/                       decisões, papel de leitura mínimo, fase 2 (app escopado), loja do Edge, esta passagem
```

## 3. Como compilar e testar

```bash
npm install
npx playwright install chromium
npm run typecheck          # tsc -b
npm test                   # 133 testes unitários (131 do motor + 2 da extensão)
npm run build              # core + extensão → extension/dist
npm run e2e                # 7 scripts: smoke, UI16, lista, portal, workspace, preferências/janela, painel flutuante
```

- **Carregar no navegador:** abra `edge://extensions` (ou `chrome://extensions`), ligue o modo de desenvolvedor, clique em "Carregar sem compactação" e escolha `extension/dist`.
- **Zip para a loja ou para o usuário:** é a pasta `extension/dist` sem os arquivos `.map`.
- **Ver o painel sem instância (modo demonstração):**
  - `src/sidepanel/index.html?demo=1` (na gaveta "Investigar", funciona tanto "Um campo" quanto "O registro inteiro")
  - `&batch=1` mostra o lote.
  - `&batch=rec` mostra o registro inteiro; `&batch=rec&wait=1` mostra a análise em andamento.
  - `&tab=whatif` abre na aba "E se?".
- **Prints:** os scripts `tests/e2e/_*.mjs` são de rascunho e geram imagens (ex.: `node tests/e2e/_batch.mjs <pasta> dark rec`).

### Bateria no PDI de testes

A forma usada até agora é rodar a bateria dentro de uma aba já logada no PDI de testes. Assim nenhuma senha passa pelo código.

1. Compile o bundle: `npx vite build -c tests/regression/browser/vite.config.ts`. A saída é `tests/regression/browser/dist/regression.js`.
2. Injete o bundle numa aba logada do PDI de testes.
3. No console, rode:
   - `await TrailRegression.runRegression()` para todos os casos;
   - `TrailRegression.runOne({table, number, field})` para um caso só.

A alternativa em Node com usuário e senha (`npm run regression`) existe, mas **não foi usada**: a regra é nunca digitar senhas.

## 4. Estado atual

| Item | Situação |
|---|---|
| Bateria do PDI | **441/441** na 0.11.0 (mediana de 2,3 s e 23 chamadas por investigação) |
| Testes cegos | blind5: 35/35. blind6: 27/27 alvos válidos (8 excluídos porque os campos não estão no formulário) |
| Unitários | 133 passando (131 do motor + 2 da extensão) |
| e2e | 7 de 7 passando |
| Fase 2 (app escopado) | Protótipo funcionando no PDI de testes (fase 18, 5/5 com certeza alta). Desenho em `docs/fase2-app-escopado.md` |

### O que entrou na 0.12.1

- **Rótulos por `sys_documentation` em paralelo à auditoria:**
  - Quando uma tabela filha muda o rótulo de um campo herdado da tabela pai (ou há rótulo por idioma), `sys_documentation` tem prioridade sobre `sys_dictionary.column_label`.
  - A consulta a `sys_documentation` roda em paralelo à leitura da auditoria / dicionário em `investigate`, `preview` e `timeline`.
- **Comparador da linha do tempo ("O que mudou entre dois momentos"):**
  - O botão antes chamado "Comparar duas gravações" virou **"O que mudou entre dois momentos"** (en: *"What changed between two moments"*).
  - Ao entrar no modo, aparece uma frase curta de explicação visível ("Escolha dois momentos na linha do tempo e veja só o que ficou diferente no registro entre eles."), todos os textos `cmp*` foram revisados para linguagem simples coerente com "momentos", e clicar no cabeçalho de qualquer momento seleciona o ponto.
- **Registro inteiro no modo demonstração:**
  - Na gaveta **"Investigar"**, escolher **"O registro inteiro"** em `?demo=1` fecha a gaveta e leva ao `demoRecord` (o mesmo de `&batch=rec`), exibindo a animação de andamento antes do resultado final, sem chamar a rede. Clicar numa mudança da lista abre a análise de demonstração daquele campo.
- **Site dentro do repositório (`site/`):**
  - O site de apresentação passou a morar em `site/` dentro do repositório e é sincronizado com os bundles compilados da extensão por `tests/e2e/_sync-site.sh`.
- **Repositório público e higiene do git:**
  - `extension/dist-types/` ignorado no `.gitignore` (fora do git) e `.gitattributes` garantindo finais de linha `LF`.

### O que entrou na 0.12.0

- **Painel flutuante na página como padrão** (`content/floatPanel.ts`):
  - Abre sempre do tamanho do painel lateral: 420 px de largura, altura toda, encostado na direita.
  - Só fecha no X. Minimizar vira uma bolinha no canto.
  - Arrastar pelo cabeçalho solta o painel; perto da borda ele encosta de novo; duplo clique encosta na direita. A borda muda a largura.
  - Sobrevive a recarregar a página: o worker guarda `float:<tabId>` na sessão.
  - Se a instância bloquear o iframe da extensão, em 6 s ele cai para a janela separada.
  - O painel lateral do Edge e a janela separada continuam disponíveis nas opções e no botão direito do ícone.
  - Quem tinha o padrão antigo ("lateral") gravado passa para o flutuante. A versão da escolha fica em `modeV: 2` nas preferências.
- **Nomes como no formulário** em todo o painel:
  - O rótulo do campo aparece no lugar do nome técnico (`business_service` vira "Service").
  - O valor aparece no lugar do sys_id (o sys_id vira "SAP Enterprise Services"), e referências viram links para o registro.
  - No motor: `Investigation.fieldLabel`, `refTable` e `display`; `ChangePreview.fieldLabels`, `valueLabels` e `refTables`; `TimelineField.ref`; `BatchItem.label`, `oldDisplay`, `newDisplay` e `refTable`.
- **Registro inteiro e lote redesenhados** no estilo do histórico do campo:
  - Uma linha por mudança, com data, campo, antes → depois, quem ou o quê mudou e a certeza.
  - Filtros por causa e animações: linhas pendentes pulsando, entrada escalonada, barra de progresso viva.
- **"E se?"**: o seletor nativo do navegador foi trocado por uma caixa no estilo da extensão, que mostra "Hoje está: X" e textos com nomes do formulário.
- **"Investigar um campo" virou "Investigar"**, com a escolha entre um campo e o registro inteiro.
- **Ícone faltando em campos de referência**:
  - No UI16 os rótulos têm prefixos: `sys_display.`, `sys_readonly.`, `ni.` e `select_0`. Antes eles não eram reconhecidos.
  - Agora Caller, Service, Assignment group e os demais têm o ícone.

## 5. O que falta ou o que fazer em seguida

1. **Confirmar a bateria completa (441/441) no PDI de testes com a 0.12.1.**
   - A 0.12 acrescentou consultas de rótulo (`resolveDisplay` / `sys_documentation`), sem mexer na pontuação, mas convém registrar a rodada completa e a mediana de chamadas.
2. **Testar o painel flutuante no Edge real com o PDI de testes**, com a extensão carregada:
   - UI16 (`/now/nav/ui/classic/...` e `incident.do`), Workspace e portal;
   - se a política de segurança da instância bloqueia o iframe (quando bloqueia, o painel cai para a janela separada);
   - arrastar por cima do formulário;
   - recarregar a página.
3. **Fase 2 (app escopado `x_trail`):** os próximos passos estão em `docs/fase2-app-escopado.md`.
4. **Publicação na Edge Add-ons:** o material está em `docs/loja-edge.md` e `docs/store/`. **O envio e o aceite dos termos são ação do dono, não do agente.**

## 6. PDI de testes e itens criados nele

- **Instância:** o PDI de testes. Os testes rodaram no Edge do dono, numa aba logada, pela extensão Claude in Chrome.
- **Regra para itens de teste:**
  - todo item de teste leva o prefixo **[PT]** e fica restrito aos próprios registros (filtros por `short_description` que começa com "[PT] ...");
  - nunca alterar nem apagar registros que não foram criados pelos testes.

Itens criados e ainda presentes no PDI de testes:

- Conta de integração de teste: criada sem senha e restrita a web service, com autorização do dono.
- **Fase 13:**
  - UI policies (a reversa está restrita aos registros de teste);
  - transform map e tabela de staging `u_pt_f13_import`;
  - data policy.
- **Fase 14:** flow e subflow, ativos e restritos ao registro "[PT] F14-SUB1".
- **Fase 16:** definição de SLA (inativa) e os itens do blind6.
- **Fase 17:** as BRs do pingue-pongue.
- **Fase 18:** as BRs do contexto gravado e a tabela `u_pt_trail_contexto` (protótipo da Fase 2).
- Tabela `u_pt_trail_teste`.
- Um registro em `sys_email` marcado como ignorado.

Os scripts de montagem estão em `tests/regression/pdi-setup-*.js` e `tests/regression/blind*/setup.js`.

## 7. Regras combinadas com o dono (valem para todos os agentes)

- **Nada deste projeto pode afetar outros projetos dele:** nem outros repositórios (por exemplo `painel-rh`), nem outros projetos da Vercel (por exemplo `paineis-difal` ou `estudio-ia-ensaios`), nem tarefas agendadas.
- **Não criar tarefas agendadas.**
- **Nunca digitar senhas.**
- **Não mudar propriedades do sistema da instância.** Por exemplo, a leitura de e-mail recebido continua desligada no PDI de testes; por isso o caso de e-mail recebido não foi testado.
- **Itens de teste no PDI:** só com o prefixo [PT] e restritos aos próprios registros (seção 6).
- **Não publicar o e-mail do dono em lugar nenhum** (site, repositório, loja).
- **Envio para a loja do Edge e aceite de termos:** só o dono faz.
- **Interface:** em português, com o inglês completo no `i18n.ts`. Linguagem de gente, sem jargão quando houver alternativa.
- **A extensão é somente leitura.** Nenhum código da extensão grava na instância. Gravações só nos scripts de teste do PDI.
- **Sempre que houver uma versão nova, gerar o zip da extensão** (`extension/dist` sem os `.map`) e entregar ao dono.

## 8. Site e Vercel

- **Arquivos no repositório:** o site fica na pasta `site/` na raiz do repositório (página principal em `site/b3/`).
- **Painel embutido:** o site mostra o painel em modo demonstração. Os arquivos da extensão compilada são copiados para `site/` por `tests/e2e/_sync-site.sh` e verificados por `tests/e2e/_site-demo.mjs`.
- **Projeto na Vercel:** `trail-sn` (`prj_tHmuUpt91BSX0C89iUfAmgIAAtGN`), diretório raiz `site/`, sem build e sem proteção de login. Endereço: https://trail-sn.vercel.app/b3/. Depois de mudar o painel, rode `bash tests/e2e/_sync-site.sh` e faça o push. O projeto antigo `trail-site` não é mais atualizado.

## 9. Git e GitHub

- **Repositório remoto (público):** `https://github.com/iiFoox/trail-sn`, branch `master`.
- **Fluxo normal:** não usa mais `trail.bundle`; o histórico completo está publicado diretamente no repositório remoto do GitHub (`origin`).
- **Padronização de linha:** `.gitattributes` força `LF` nos arquivos de texto do repositório.
- **Fora do git (veja o `.gitignore`):**
  - `extension/dist/` e `extension/dist-types/`;
  - `tests/regression/results/`: relatórios das rodadas no PDI de testes;
  - `tests/regression/.env`.

## 10. Dicas para vários agentes trabalhando juntos

- **Áreas que quase não se cruzam:**
  - o motor (`packages/core`);
  - a interface do painel (`extension/src/sidepanel` e `shared/ui.css`);
  - o que roda dentro da página (`extension/src/content`);
  - a bateria (`tests/regression`).
- **`i18n.ts` e `ui.css` são compartilhados e dão conflito fácil:** acrescente no fim do bloco certo e evite reordenar.
- **Mudou o tipo `Investigation`?** Rode `npx tsc -b`: o painel, o export e a bateria dependem dele.
- **Antes de entregar:** `npm run typecheck && npm test && npm run build && npm run e2e` (e `bash tests/e2e/_sync-site.sh` se mudar o painel que aparece no site).
- **Mudanças no motor que afetam a pontuação:** rode também a bateria no PDI de testes e registre o resultado em `tests/regression/results/`.
