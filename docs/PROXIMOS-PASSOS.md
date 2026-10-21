# Próximos passos (passagem de 21/10/2026: Claude → Codex no comando)

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
1. Repetir a validação acima como itil (impersonar `pt.trail.itil`, sys_id `3fc011fdc3c4d3101cbdb8e1b401311c`) e como um usuário de escopo. Conferir que as fontes negadas aparecem como "–" / "Seus papéis não mostram…" e que nada é inventado. Voltar ao admin no fim.
2. **Concluído em 21/10/2026:** rodar os 441 casos como `pt.trail.itil`. Resultado: 2 causas esperadas; 317 casos sem evidência, 111 com causa candidata e 11 erros de leitura. Fontes negadas incluem `sys_audit`, logs/eventos, workflows, regras, script includes e UI actions. A leitura é compatível com as restrições desse perfil; conferir os números e a análise em `docs/DIARIO.md`. Sessão restaurada e confirmada como admin.
3. **Concluído em 21/10/2026:** texto neutro para navegadores em `extension/src/shared/i18n.ts` (PT/EN), `site/b3/index.html`, bundles de demonstração `site/assets/icons-BktSENMu.js` e `site/demo/content.js`; expectativa ajustada em `tests/e2e/float.mjs`. Teste `float.mjs` passou. Checks completos e limitações em `docs/DIARIO.md`.
4. **Concluído com pendências de envio em 21/10/2026:** materiais da loja 1.0.0 em `docs/loja-edge.md` e `docs/store/` (5 capturas 1280×800, logo 300×300, textos PT/EN e instruções). Revisão corrigiu o limite do Edge (6 capturas), links locais e declaração de dados. Antes do envio, criar o tile 440×280 obrigatório no Chrome e atualizar `site/privacidade/index.html`, que ainda diz que a extensão não trata dados pessoais. **Quem envia é o dono.**
5. **Concluído em 21/10/2026:** site bilíngue PT/EN em `site/b3`, com seletor acessível, persistência em URL e `localStorage`, dicionário de conteúdo completo incluindo os 29 itens do roadmap da Fase 1, e2e de idioma/recarga e layout responsivo. O Antigravity reportou `typecheck`, 150 testes e `_site-demo` aprovados. Na verificação local, `typecheck` passou; `npm test` e `build` foram bloqueados por leitura externa do esbuild, a cadeia e2e parou em `prefs-window` por limitação de janela do Chromium headless, e `_site-demo` só registrou a fonte Google Fonts bloqueada pela rede do sandbox (conteúdo, imagens e overflow passaram). Detalhes em `docs/DIARIO.md`.
6. **Próximo:** lacunas conhecidas: flows escopados (o Flow Designer do PDI dá erro 500) e o papel de desenvolvedor delegado não foram testados.
7. Se a sessão do portal ainda estiver com `security_admin` elevado, tirar a elevação (menu do usuário).

## Testes manuais que o dono faz no Edge e no Chrome
PiP "Sempre visível", recarga automática com reinjeção, aviso de acesso por capacidade, rótulos em pt-BR, aba Flows e "O que roda neste registro" (busca, "Só o que rodou aqui", grupos recolhidos, links abrindo).
