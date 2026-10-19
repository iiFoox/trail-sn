# Trail

**PT** · Perícia de registros para ServiceNow: *o que alterou este campo, quando e por quê?*
Extensão de navegador, somente leitura, sem telemetria. Nome provisório.

**EN** · Record forensics for ServiceNow: *what changed this field, when and why?*
Browser extension, read-only, no telemetry. Working name.

---

## O que faz / What it does

Ao lado de cada campo de um formulário, um ícone "?" abre o painel lateral com a linha do tempo das mudanças daquele campo. Para cada mudança, o motor cruza a auditoria (`sys_audit`) com rastros de execução (transações, eventos, contextos de flow e workflow) e com os metadados da tabela (business rules, script includes, UI actions, jobs), e devolve **evidências pontuadas**: CONFIRMADO, PROVÁVEL ou CANDIDATO, cada uma com os fatos verificáveis e um link para o artefato.

Next to each form field, a "?" icon opens the side panel with the field's change timeline. For each change, the engine joins the audit (`sys_audit`) with execution traces (transactions, events, flow and workflow contexts) and table metadata (business rules, script includes, UI actions, jobs), returning **scored evidence**: CONFIRMED, PROBABLE or CANDIDATE, each with verifiable facts and a link to the artifact.

Tipos detectados / Detected types: BR async, BR before, BR after, BR → script include, script action, UI action, scheduled job (with or without transaction), flow, workflow, background script, direct user action, server-side change on save, unknown background process, and **updates without audit** (`setWorkflow(false)`, imports).

## Estrutura / Layout

```
packages/core/      motor da perícia (TypeScript puro, sem navegador)
  src/client/       RestClient (interface), FetchRestClient (sessão + X-UserToken), FakeRestClient (testes)
  src/signatures/   uma assinatura por arquivo; recebem dados carregados, nunca chamam a rede
  src/scoring.ts    pesos dos fatos e faixas de grau
  src/investigate.ts pipeline em 3 rodadas paralelas + cache de metadados
  src/access.ts     detector de acesso (completo / parcial / sem perícia)
  test/             25 testes, incluindo os 12 casos da Fase 0 em fixtures sintéticas
extension/          MV3: page/ (world MAIN), content/, background/ (service worker), sidepanel/, popup/, options/
tests/regression/   bateria contra a PDI (Node com basic auth, ou bundle para rodar na aba logada)
tests/e2e/          smoke test: carrega a extensão num Chromium e abre popup, painel e opções
docs/               papel de leitura mínimo e decisões técnicas
```

## Desenvolvimento / Development

```bash
npm install
npm test                 # unitários (vitest)
npm run typecheck        # tsc -b
npm run build            # core + extensão -> extension/dist
npm run e2e              # carrega extension/dist num Chromium; ícone no UI16 e no Workspace (fixtures)
```

Carregar no Chrome: `chrome://extensions` → modo do desenvolvedor → "Carregar sem compactação" → pasta `extension/dist`.
Abra uma instância, clique no ícone do Trail → **Ativar nesta instância** (concede a permissão de host só para aquela origem). O popup também tem o **probe de autenticação** e o **verificador de acesso**.

Load in Chrome: `chrome://extensions` → Developer mode → "Load unpacked" → `extension/dist`. Open an instance, click the Trail icon → **Enable on this instance**.

### Regressão na PDI / PDI regression

```bash
TRAIL_INSTANCE=https://devXXXXXX.service-now.com TRAIL_USER=admin TRAIL_PASS=... npm run regression
```

Ou, sem senha: `npx vite build -c tests/regression/browser/vite.config.ts` e cole `tests/regression/browser/dist/regression.js` no console de uma aba logada, depois `await TrailRegression.runRegression()`. Resultado da última execução em `tests/regression/results/`.

## Autenticação / Authentication

Confirmado na PDI (2026-10-19): `GET /api/now/table/...` via `fetch` com o cookie da sessão e **sem** `X-UserToken` devolve **401**. O token `g_ck` é obrigatório mesmo para leitura. O `page/` repassa `window.g_ck` quando existe; o service worker obtém o token sozinho a partir do HTML de `/navpage.do` quando não recebe um (Workspace, painel manual) ou após um 401. Ver `docs/decisoes.md`.

## Privacidade / Privacy

Só `GET`, só na instância ativada, só com a sessão do usuário. Nada sai do navegador. Cache de metadados em `chrome.storage.session` (some ao fechar). Nenhuma permissão de host na instalação.

## Licença / License

MIT.
