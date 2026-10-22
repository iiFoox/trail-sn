# Próximos passos

## Estado em 21/10/2026, 22h (leia isto primeiro) — Claude (coordenação com subagentes nesta conversa)

**Versão para a loja: 1.4.0** = painel **igual ao da 1.0.0** (o dono achou que a extensão ficou cheia de informação e decidiu voltar ao simples) + correções invisíveis + **Modo avançado** (chave nas Configurações, **desligado por padrão**) com as ferramentas novas numa aba "Avançado", tudo recolhido.
- O dono vai enviar a 1.4.0 à **Chrome Web Store** (só o dono envia e aceita termos).
- Este ambiente **não tem push** para `iiFoox/trail-sn`: os commits desta rodada vão num **git bundle** entregue ao dono (ver "Como subir os commits" abaixo).

### O que entrou desde a 1.0.0 (detalhes em `docs/DIARIO.md`)
- **Correções de comportamento (visíveis só como "funciona"):** idioma padrão pelo navegador; nome localizado na loja (`__MSG_name__`); erros em texto simples com "Detalhes técnicos"; "registro indisponível" separado de "sem permissão"; janela separada abre mesmo quando o navegador recusa a posição e o "Investigar" nela grava na aba certa; ícone do Trail em campos de referência/caixas/listas do UI16 (prefixos `sys_display.`, `sys_readonly.`, `ni.`, `select_0`); registro aberto já preenchido na gaveta "Investigar"; menu "Trail" só nas instâncias conectadas; detecção só `*.service-now.com`/`*.servicenowservices.com` (domínio próprio pelas Opções); `minimum_chrome_version` 120; WAR só `https://*/*`, sem `page.js`; boas-vindas sem histórico de navegação (SHA-256, últimos 200).
- **Motor (`packages/core`):** `evalCondition` com `^OR`/`^NQ`; gêmeos `state`/`incident_state`; `fd-scripted` dos flows; papel `public`; e os módulos novos `fieldState`, `fieldDeps` (quem grava/quem depende/simular), `saveTiming`, `visibility`, `compare` — validados no PDI (`tests/regression/VALIDACAO-MOTORES-2026-10-21.md`).
- **Modo avançado (desligado por padrão):** aba "Avançado" com Por que está bloqueado, Quem grava, Quem depende, Simular um valor, Comparar com outra instância, Tempo do salvamento, Quem enxerga este registro.
- Testes: ~289 unitários; suíte e2e completa passando no Linux (a falha antiga do `prefs-window` era tela simulada 800×600 do headless + bug real da janela fora da tela, ambos corrigidos).

### Pendências, em ordem (para a próxima IA)
1. **Dono:** enviar a 1.4.0 à Chrome Web Store (depois Edge). Antes, conferir a ficha: o **nome mudou** para `Trail — Perícia de registros ServiceNow` / `Trail — ServiceNow Record Forensics` (vem do manifest); requisito mínimo Chrome 120; textos "Conectar/Desconectar"; justificativa de `https://*/*` = "pedida só para o domínio que o usuário digitar nas Opções (instância com domínio próprio)"; o menu de contexto só aparece em instâncias conectadas. As capturas de `docs/store/` são da 1.0.0 e continuam valendo (o painel padrão voltou a ser o da 1.0.0); se o revisor pedir o Modo avançado, gerar capturas novas.
2. **Site / política de privacidade (outra IA, outra conta Vercel)** — obrigatório antes ou logo depois do envio, porque a loja confere: ver a seção "Ajustes pendentes no SITE" abaixo (itens 1 a 3). Atenção: o item 2 de lá ("funcionalidades novas no site") passa a ser **só para o Modo avançado**, apresentado como opcional para administradores.
3. **PDI (QA):** a rodada de 21/10 à noite foi **interrompida pelo dono** antes de terminar:
   - **bateria de 441 casos com o motor novo (`^OR`) NÃO foi rodada** — rodar e comparar com 441/441;
   - reconferir P1–P7 (lista no relatório do agente de correções no `DIARIO.md`): `saveTiming` < 4 s, SLAs anexadas, `^OR` na policy "Make fields read-only on close", quem enxerga pela sessão, compare A×sem sessão ~7 chamadas;
   - **bateria escopada v2:** corpus de 302 casos pronto (`tests/regression/escopo/cases-escopo-v2.json`, scripts `rodar-v2.js`/`casos-v2.js`); rodaram só os perfis admin do app A e usuário do app A (`results-v2/`). Faltam: admin geral, B, C, itil, sem papel; depois o `RELATORIO-v2.md` com melhorias para não admin em escopo.
   - Artefatos `[PT] v2 …` no PDI: 33 BRs ativas restritas a registros "[PT] v2 …" (desativar quando a bateria terminar).
4. **Testes manuais do dono** (lista no fim deste arquivo) com a 1.4.0.
5. Backlog de ideias (abaixo) — só com o dono escolhendo; lembrar que ele pediu **simplicidade**: nada novo no modo padrão sem aprovação explícita.

### Como subir os commits (bundle)
```bash
git clone trail.bundle trail-sn-local    # ou, num clone existente: git fetch /caminho/trail.bundle master:trail-claude
cd trail-sn-local
git remote set-url origin https://github.com/iiFoox/trail-sn.git
git push origin master                    # com o login do iiFoox
```
Os commits desta rodada saem como `Claude <noreply@anthropic.com>` (como os 36 anteriores do Claude no histórico); nenhum e-mail pessoal.

## Estado anterior: 21/10/2026, 17h
O Codex #2 e o Antigravity #2 pararam por limite de uso; o Claude fechou a rodada. **A próxima IA assume a coordenação.** Leia também `docs/DIARIO.md` (registro contínuo) e as regras logo abaixo.

**Versão atual: 1.0.0**, pronta para as lojas.
- Zip: `../trail-edge-1.0.0.zip` (cópia idêntica em `../trail-chrome-1.0.0.zip`), gerado por `bash tools/atualizar-extensao.sh`. O script agora usa o `tar` do Windows: o Compress-Archive gravava caminhos com `\` e a loja do Chrome recusa. `npm test` deu 150/150, e o build passou.
- Materiais: `docs/loja-edge.md` (textos PT/EN, notas 1.0.0, justificativas de permissões, passo a passo) e `docs/store/` (5 capturas 1280×800, logo 300×300, tile 440×280 do Chrome).
- Política de privacidade revisada (PT/EN) em `site/privacidade/index.html`, publicada em `https://trail-sn.vercel.app/privacidade/`. Foi conferida contra o código: só GET; token `g_ck` em `storage.session`; estado da aba apagado em `tabs.onRemoved`; preferências e instâncias em `storage.sync`; painel e bolinha em `storage.local`.

### Pendências, em ordem
1. **Dono:** enviar a 1.0.0 às lojas (Chrome Web Store e Edge Add-ons) com o zip, os materiais de `docs/store/` e a URL da política. Só o dono envia e aceita termos.
2. **Dono:** testes manuais no Edge e no Chrome (lista no fim deste arquivo), de preferência com a 1.0.0 instalada pela pasta `../trail-extensao`.
3. **Investigar os 11 "erros de leitura"** da rodada dos 441 casos como `pt.trail.itil` (ver `docs/DIARIO.md`, 21/10). Separar o que é negação esperada do perfil do que é falha real (timeout, parse). Corrigir se for falha do motor.
4. **e2e:** a cadeia `npm run e2e` parou em `prefs-window` no ambiente do Codex (limitação de janela do Chromium headless). Rodar aqui no Windows; se falhar de novo, tornar o teste tolerante ao headless ou marcá-lo como manual.
5. **Em aberto:** flows escopados e o papel de desenvolvedor delegado (item 6 abaixo). O Flow Designer do PDI não grava flows novos, e o convite de colaborador foi aprovado mas não aplicou papéis. Só retomar se o PDI melhorar; não insistir.
6. Depois da publicação: acompanhar a revisão das lojas e responder às perguntas dos revisores com as justificativas de `docs/loja-edge.md`. Mudanças pedidas pela loja viram 1.0.1.

### Estado dos agentes
- Codex #2: limite de uso até cerca de 19h47 de 21/10. Estava conferindo a política com o código, conferência que o Claude terminou.
- Antigravity #2: livre. Entregou o tile 440×280 e a política revisada.
- O sandbox do Codex não alcança o GitHub nem roda esbuild. Por isso a integração final (build, zip, push) deve ser feita por quem tiver acesso: Claude ou o dono.

## Fila de funcionalidades escolhida pelo dono (21/10/2026, 18h18) — nesta ordem, depois de "Por que está bloqueado?"
1. **Mapa do campo** — "Quem grava" (o atual "Outras regras que mexem em X") + **"Quem depende"** (raio de impacto). Fica na aba "Automações" da reorganização 6→4.
2. **Por que este salvamento foi lento?** — tempos da transação (regras, SQL, navegador) e as regras que rodaram no save.
3. **Quem vê este registro?** (nome provisório; o dono pediu outro nome que não "Por que fulano não vê") — regras que filtram a consulta (before query), condições e papéis; limite honesto: ACL com script não é avaliada.
4. **Comparar instâncias (DEV × PROD).**
Implementação: motor primeiro (módulos em `packages/core/src` com testes), interface depois da reorganização das abas (UX aprovada em `docs/ux-revisao-2026-10-21.md`).

**Reorganização aprovada pelo dono (21/10, 18h29): 4 abas.**
1. **Resposta** — frase-resposta no topo, causa, certeza, "Copiar para o chamado".
2. **Como aconteceu** — Rastro + Provas; o "salvamento lento" entra aqui (tempos de cada save).
3. **Histórico** — campo + registro inteiro numa visão só; "O que rodou neste registro" (flows do registro, sai a aba Flows); "Quem enxerga este registro" (nome escolhido no lugar de "Por que fulano não vê").
4. **Regras do campo** — Estado agora (o "Bloqueio?"); Quem grava (o atual "Outras regras" + mapa de automações); Quem depende, com o botão **"Simular um valor"** (o antigo "E se?" deixa de ser aba); botão "Comparar com outra instância".

## Ideias de funcionalidades guardadas (backlog, 21/10/2026 — não implementar sem o dono escolher)
- **Comparar instâncias (DEV × PROD)** — o dono pediu para NÃO perder esta ideia. Para o mesmo campo/tabela, lado a lado o que pode gravá-lo em cada instância conectada (regras, policies, flows, data lookups, client scripts): o que só existe numa, o que está diferente (condição, ordem, script). Responde "por que funciona em DEV e não em PROD?". Precisa estar logado nas duas; só leitura.
- Novidades no registro (desde a última visita + aviso quando alguém salva com o formulário aberto).
- O que está esperando neste registro (aprovações, SLA, flows parados) — medir leitura sem admin antes.
- Ícone do Trail em cada entrada do Activity Stream do formulário.
- "A regra foi alterada?" (versões da automação via `sys_update_version`).
- E-mails do registro (`sys_email`) — exige ajuste na política de privacidade.
- **Para admin (ordem sugerida pelo Claude):**
  1. **Mapa do campo** = "Quem grava" (o atual "Outras regras que mexem em X") + **"Quem depende"** (raio de impacto: condições de BR, scripts que leem o campo, client scripts onChange, UI/data policies condicionadas, flows disparados, notificações, SLAs, regras de atribuição, tabelas que referenciam). Fica na aba "Automações".
  2. **Por que este salvamento foi lento?** (tempos de `syslog_transaction`: regras, SQL, cliente; regras que rodaram no save).
  3. **Rastro reverso: o que esta regra/flow/job fez** nos últimos dias (registros e campos que ela realmente mudou).
  4. Comparar instâncias (acima).
  5. Rastro de um usuário/integração; "Por que fulano não vê este registro?" (com limite honesto de ACL); leitor de regra em linguagem simples; "O que mudou na instância ontem?"; detector de más práticas; mapa de calor da tabela; automações fantasmas.

## Ajustes pendentes no SITE (anotados em 21/10/2026, noite — o dono pediu para não mexer no site agora)
Quem for mexer no site (`site/`, deploy Vercel do dono) deve fazer, nesta ordem:
1. **Política de privacidade** (`site/privacidade/index.html`), exigência da loja (revisão de 21/10):
   - dizer que `storage.sync` (preferências e lista de instâncias) passa pela sincronização da conta Google/Microsoft do navegador;
   - dizer que os textos da "diferença lado a lado" e do relatório PDF ficam em `storage.session` até o navegador fechar;
   - "Contato" com link (`https://github.com/iiFoox/trail-sn/issues`);
   - mudanças da 1.1.0 que afetam a política/ficha: boas-vindas guardam só um resumo SHA-256 dos últimos 200 registros (não o histórico); "Nada vai para fora da sua instância"; Conectar/Desconectar (não Ativar/Desativar) em textos e capturas; detecção automática só em `*.service-now.com`/`*.servicenowservices.com`, domínio próprio pelas Opções (justificativa de `https://*/*`: pedida só para o domínio digitado); menu "Trail" só nas instâncias conectadas; mínimo Chrome/Edge 120; recursos acessíveis só em páginas https e `page.js` não exposto; teste de autenticação traduzido (só GET).
2. **Funcionalidades novas da extensão que precisam entrar no site** (regra do projeto: toda funcionalidade nova vai para `site/b3`):
   - (só no **Modo avançado**, opcional para administradores) "Por que este campo está bloqueado, obrigatório ou escondido?", Quem grava/Quem depende, Simular, Comparar instâncias, Tempo do salvamento, Quem enxerga;
   - janela separada que abre mesmo quando o navegador recusa a posição (só nota de versão);
   - mensagens de erro em linguagem simples ("a instância não respondeu", "sem permissão").
3. Atualizar números da página (`site/b3`) depois da bateria escopada v2 (`tests/regression/escopo/RELATORIO-v2.md`).

## Passagem anterior (21/10/2026, manhã: Claude → Codex)

O Claude saiu por limite de tokens. O **Codex #2 coordena** a partir daqui: passa tarefas ao Antigravity #2, integra, testa e faz o commit.
Antes de tudo, leia `docs/DIARIO.md` (registro contínuo) e `docs/PASSAGEM.md`.

## Regras que não mudam
- Nunca digitar senhas. A extensão é somente leitura.
- No PDI (`dev457034`), só itens com prefixo **[PT]**. Nunca alterar ou apagar o que não foi criado por teste. Pode impersonar usuários e criar registros [PT].
- Não mudar propriedades do sistema da instância. Não instalar app nem role na instância do usuário (a Fase 2 está arquivada; não propor de novo).
- Não publicar o e-mail do dono em lugar nenhum. O git local usa `iiFoox <45541089+iiFoox@users.noreply.github.com>`: confira com `git config user.email` antes de cada commit.
- Envio às lojas (Edge e Chrome) e aceite de termos: só o dono faz.
- Não criar tarefas agendadas. Nada deste projeto pode afetar outros projetos do dono.
- Interface em português, com inglês completo em `extension/src/shared/i18n.ts`. Linguagem simples.
- Toda versão nova: subir a versão em `extension/public/manifest.json`, rodar `bash tools/atualizar-extensao.sh` (atualiza `../trail-extensao`, que recarrega sozinha, e gera o zip).
- Toda funcionalidade nova vai também para o site (`site/b3`, deploy automático na Vercel `trail-sn` a cada push), no estilo do site.
- Anotar tudo em `docs/DIARIO.md` e fazer commit e push com frequência (repo público `iiFoox/trail-sn`, branch master).
- Testar antes de dizer que está pronto: `npm test` (vitest), `npm run build` e a cadeia e2e (`npm run e2e`).

## Tarefa em andamento
**Subflows na aba Flows — implementada para a versão 0.14.6.** `recordFlows` busca contextos-filhos por `source_recordIN` em lotes e até três níveis, mostra cada filho logo abaixo do pai e marca o vínculo em `parentSysId`. O painel recua a linha; a demonstração e os testes do site/extensão cobrem o comportamento. A API do PDI não devolveu `flow.sys_class_name` para o subflow, então ele é classificado pela relação com o contexto pai.

Validação no PDI: o flow `[PT] F14 flow chama subflow` foi retornado com o contexto do subflow `[PT] F14 subflow descricao` logo abaixo, ambos em `COMPLETE`; `parentSysId` e `subflow: true` corretos. Consulte a entrada `2026-10-21 — 0.14.6` em `docs/DIARIO.md` para métricas e validação detalhada.

Validação local: typecheck passou e Vitest programático passou 150/150. `npm test` e `npm run build` no caminho padrão são bloqueados pelo sandbox ao ler diretórios acima do workspace; o build foi concluído com Vite `configLoader: runner`. O e2e completo para em `prefs-window.mjs` porque o Chromium headless não abriu janela separada; os testes `float`, `reload`, `flows` e `settings` passaram isoladamente. O teste do site só apontou bloqueio de rede na fonte externa, sem erros de conteúdo ou overflow.

O pacote `0.14.6` foi copiado para `../trail-extensao` e zipado manualmente (a execução do script Bash foi bloqueada pelo sandbox). Commit local `917d3e8`; push não conectou a `github.com:443`. Item 1 da fila concluído: sob `pt.trail.itil` e `pt.trail.escopo.user`, execuções ficaram vazias e fontes negadas sem exibir dados; a sessão voltou ao admin. Item 2 em andamento: os 10 primeiros dos 441 casos como ITIL terminaram (0/10 causas esperadas visíveis) e os 431 restantes continuam sequencialmente na aba já personificada; não recarregue essa aba.

## Validação já feita hoje (registrar no diário junto)
`TrailRegression.flows` e `TrailRegression.automations` (novos em `tests/regression/browser/entry.ts`) rodaram como admin em incidentes reais [PT] (F14, F7). O flow que rodou aparece marcado "rodou aqui"; o resto: 4 definições de flow, 226 regras de negócio, 23 script includes, 46 client scripts, 23 UI policies, 63 UI actions, 2 data lookups, 6 regras de atribuição e 13 jobs. Acesso "ok" em todas as fontes. Cerca de 2,4 s e 20 chamadas. "Copy State to Incident State" sem campos gravados é correto (o script está vazio na instância).

## Fila depois disso (em ordem)
1. **Concluído em 21/10/2026** (ver DIARIO): repetir a validação acima como itil (impersonar `pt.trail.itil`, sys_id `3fc011fdc3c4d3101cbdb8e1b401311c`) e como um usuário de escopo. Conferir que as fontes negadas aparecem como "–" / "Seus papéis não mostram…" e que nada é inventado. Voltar ao admin no fim.
2. **Concluído em 21/10/2026:** rodar os 441 casos como `pt.trail.itil`. Resultado: 2 causas esperadas; 317 casos sem evidência, 111 com causa candidata e 11 erros de leitura. Fontes negadas incluem `sys_audit`, logs/eventos, workflows, regras, script includes e UI actions. A leitura é compatível com as restrições desse perfil; conferir os números e a análise em `docs/DIARIO.md`. Sessão restaurada e confirmada como admin.
3. **Concluído em 21/10/2026:** texto neutro para navegadores em `extension/src/shared/i18n.ts` (PT/EN), `site/b3/index.html`, bundles de demonstração `site/assets/icons-BktSENMu.js` e `site/demo/content.js`; expectativa ajustada em `tests/e2e/float.mjs`. Teste `float.mjs` passou. Checks completos e limitações em `docs/DIARIO.md`.
4. **Concluído em 21/10/2026 (tile e política entregues depois; falta só o envio pelo dono):** materiais da loja 1.0.0 em `docs/loja-edge.md` e `docs/store/` (5 capturas 1280×800, logo 300×300, textos PT/EN e instruções). Revisão corrigiu o limite do Edge (6 capturas), links locais e declaração de dados. Antes do envio, criar o tile 440×280 obrigatório no Chrome e atualizar `site/privacidade/index.html`, que ainda diz que a extensão não trata dados pessoais. **Quem envia é o dono.**
5. **Concluído em 21/10/2026:** site bilíngue PT/EN em `site/b3`, com seletor acessível, persistência em URL e `localStorage`, dicionário de conteúdo completo incluindo os 29 itens do roadmap da Fase 1, e2e de idioma/recarga e layout responsivo. O Antigravity reportou `typecheck`, 150 testes e `_site-demo` aprovados. Na verificação local, `typecheck` passou; `npm test` e `build` foram bloqueados por leitura externa do esbuild, a cadeia e2e parou em `prefs-window` por limitação de janela do Chromium headless, e `_site-demo` só registrou a fonte Google Fonts bloqueada pela rede do sandbox (conteúdo, imagens e overflow passaram). Detalhes em `docs/DIARIO.md`.
6. **Em aberto, rechecado em 21/10/2026:** flows escopados e o perfil de desenvolvedor delegado continuam sem teste. O Workflow Studio abre a lista e o editor do flow global `[PT] F14`. Após fechar um aviso que cobria “New”, o formulário de criação abriu com o app A selecionado; “Build flow” não avançou e nenhum flow foi gravado. `/now/flow-designer` ainda mostra “Page not found”. O convite “Editor” de `[PT] Escopo dev` para o app A gerou a tarefa `DEV0001001`, salva como “Closed - Approved”; mesmo assim o app mostra zero colaboradores e a conta continua sem papéis. Consultar a rechecagem em `docs/DIARIO.md` e `tests/regression/escopo/RELATORIO.md` antes de retomar.
7. **Concluído em 21/10/2026:** removida pelo menu do usuário a elevação `security_admin` que estava ativa. Confirmados usuário `admin`, ausência de `security_admin` na lista de papéis da sessão e aplicativo `Global` ao final.

## Testes manuais que o dono faz no Edge e no Chrome
PiP "Sempre visível", recarga automática com reinjeção, aviso de acesso por capacidade, rótulos em pt-BR, aba Flows e "O que roda neste registro" (busca, "Só o que rodou aqui", grupos recolhidos, links abrindo).
