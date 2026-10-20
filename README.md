# Trail

**O que mudou este campo no ServiceNow, quando e por quê?**

O **Trail** é uma extensão MV3 para Microsoft Edge e Google Chrome que investiga alterações em registros do ServiceNow e responde, em linguagem simples e com provas verificáveis, quem ou qual automação mudou um campo, em que momento e com qual grau de certeza.

- **Somente leitura:** a extensão nunca grava, altera ou apaga nada na instância. Ela faz apenas consultas `GET` na Table API usando a sessão já autenticada do navegador e o token `X-UserToken`.
- **Sem telemetria nem servidor próprio:** tudo roda localmente no navegador. Nenhum dado da instância sai da sua máquina.
- **Permissão por instância:** nenhuma permissão de host é exigida na instalação; você escolhe em qual instância conectar.

---

## O que o Trail faz

Ao abrir um formulário ou lista no ServiceNow (UI16, Next Experience Workspace ou Service Portal), o Trail coloca um ícone discreto ao lado de cada campo:

1. **Resposta direta e grau de certeza:** cruza a auditoria (`sys_audit`) com os rastros de execução (`syslog_transaction`, `sysevent`, contextos de Flow Designer e Workflow, importações, contexto gravado) e com os metadados ativos da tabela (Business Rules `before`/`after`/`async`, Script Includes, Client Scripts, UI Policies, UI Actions, Data Lookups, regras de atribuição e Scheduled Jobs). Classifica cada causa com **Certeza alta**, **Certeza média** ou **Certeza baixa**, exibindo os fatos que somaram ou tiraram pontos.
2. **Rastro segundo a segundo:** mostra tudo que aconteceu no registro nos segundos em torno da mudança e quais outros campos foram gravados junto.
3. **Histórico do campo e do registro inteiro:** analisa todas as mudanças de um campo, todos os campos alterados num registro ou o mesmo campo em vários registros de uma lista (com exportação para CSV).
4. **O que mudou entre dois momentos:** na linha do tempo do registro, permite escolher dois momentos quaisquer e ver apenas os campos que ficaram diferentes entre eles.
5. **"E se?" (simulação somente leitura):** prevê quais regras e scripts reagiriam se o campo mudasse para outro valor, sem gravar nada.
6. **Mapa de automações e conflitos:** lista tudo que pode gravar no campo na ordem de execução do ServiceNow e alerta quando duas regras ativas gravam valores diferentes na mesma condição.
7. **Resumo para chamado e PDF:** gera uma frase pronta sem jargão técnico para colar no chamado e um relatório completo pronto para salvar em PDF.

---

## Como instalar no Edge ou Chrome

### A partir do pacote `.zip` ou da pasta compilada

1. Se recebeu o `.zip` da versão, extraia o conteúdo em uma pasta local. Se estiver com o código-fonte, compile antes com `npm run build` (a saída fica em `extension/dist`).
2. Abra `edge://extensions` (no Edge) ou `chrome://extensions` (no Chrome).
3. Ative a chave **Modo de desenvolvedor** (*Developer mode*).
4. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta extraída (ou `extension/dist`).
5. Abra um registro na sua instância ServiceNow, clique no ícone do **Trail** na barra do navegador e clique em **Conectar nesta instância**.

Por padrão, o Trail abre como um **painel flutuante** encostado na direita da página (pode ser arrastado, minimizado numa bolinha ou aberto no painel lateral / em janela separada pelas Opções).

---

## Como compilar e testar

Pré-requisitos: Node.js 20+ e npm.

```bash
npm install
npx playwright install chromium

npm run typecheck          # verificação de tipos (tsc -b)
npm test                   # 133 testes unitários (vitest)
npm run build              # compila o motor e a extensão em extension/dist
npm run e2e                # 7 suítes e2e no Chromium (smoke, UI16, lista, portal, workspace, preferências/janela, painel flutuante)
```

### Modo demonstração (sem instância)

Depois de compilar (ou rodando o servidor de desenvolvimento da extensão), você pode abrir o painel em modo demonstração sem precisar de uma instância ServiceNow:

- `src/sidepanel/index.html?demo=1` — investigação de um campo (com troca entre um campo e o registro inteiro na gaveta **Investigar**)
- `src/sidepanel/index.html?demo=1&batch=1` — análise em lote de vários registros
- `src/sidepanel/index.html?demo=1&batch=rec` — análise do registro inteiro (`&wait=1` mostra o estado em andamento)
- `src/sidepanel/index.html?demo=1&tab=whatif` — aba **"E se?"**

---

## Estrutura do repositório

```text
packages/core/        motor de investigação em TypeScript puro (sem dependência de navegador)
  src/investigate.ts  pipeline: auditoria → rastros → metadados → assinaturas → pontuação
  src/signatures/     uma assinatura por mecanismo do ServiceNow (puras, sem chamadas de rede)
  src/scoring.ts      pesos dos fatos verificáveis e faixas de certeza
  src/preview.ts      simulador "E se eu mudar?" (somente leitura)
  src/batch.ts        análise em lote e do registro inteiro + exportação CSV
  src/timeline.ts     linha do tempo do registro e comparador entre dois momentos
  src/fieldMap.ts     mapa de automações que gravam no campo
  src/conflicts.ts    detecção de regras em conflito
  src/display.ts      resolução de rótulos (sys_documentation / sys_dictionary), choices e referências
  src/access.ts       detector de nível de acesso às tabelas de rastro
  src/client/         RestClient, FetchRestClient (sessão + X-UserToken) e FakeRestClient
  test/               131 testes unitários do motor
extension/            extensão MV3 (Preact + Vite)
  public/manifest.json permissões mínimas e optional_host_permissions por instância
  src/background/     service worker (executa o motor e guarda o estado em chrome.storage.session)
  src/content/        ícones nos campos (UI16, Workspace, Portal, listas), painel flutuante e diff lado a lado
  src/page/           leitura de g_ck e contexto do formulário no mundo MAIN
  src/sidepanel/      interface do painel (App, Result, Batch, Timeline, WhatIf, FieldMap)
  src/options/        preferências de tema, idioma e modo de abertura do painel
  src/shared/         traduções (pt e en), estilos (ui.css), modo demonstração e mensagens
site/                 site de apresentação com demonstração interativa embutida
tests/e2e/            testes ponta a ponta com Playwright e a extensão carregada no Chromium
tests/regression/     bateria de regressão e casos de teste cegos
docs/                 decisões técnicas, papel mínimo de leitura (x_trail_reader), Fase 2 e passagem
```

---

## English

**Trail** is a read-only MV3 browser extension for Microsoft Edge and Google Chrome that answers a single question for any field on a ServiceNow record: **what changed this field, when, and why?**

- **Strictly read-only & private:** Trail only issues `GET` requests to the ServiceNow Table API using your existing browser session and `X-UserToken`. It never writes to the instance, has no backend server, and collects no telemetry.
- **Evidence-based forensics:** cross-checks `sys_audit` with execution traces (`syslog_transaction`, `sysevent`, Flow Designer and Workflow contexts, imports) and active metadata (Business Rules, Script Includes, Client Scripts, UI Policies, UI Actions, Data Lookups, Assignment Rules, Scheduled Jobs). Each candidate is scored with verifiable facts and graded as **High**, **Medium**, or **Low certainty**.
- **Full toolkit:** includes a second-by-second execution trace, whole-record and list-column batch analysis (with CSV export), a record timeline with a **"What changed between two moments"** comparator, a read-only **"What if?"** change simulator, an automation & rule-conflict map, a plain-language summary for tickets, and a printable PDF report. Full UI available in **Portuguese** and **English**.

### Load unpacked in Edge or Chrome

1. Run `npm install && npm run build` (or extract a release `.zip`).
2. Open `edge://extensions` or `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select `extension/dist`.
4. Open a ServiceNow record, click the Trail icon, and click **Connect to this instance**.

### Build and test

```bash
npm install
npx playwright install chromium
npm run typecheck && npm test && npm run build && npm run e2e
```

---

## Licença / License

[MIT](LICENSE).
