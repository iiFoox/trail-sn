# Materiais e instruções para as lojas (Edge Add-ons & Chrome Web Store)

Guia completo, textos de listagem (PT e EN), notas da versão 1.4.4, justificativas de permissões para revisores, especificações de assets e instruções passo a passo para publicação do **Trail 1.4.4**. A ficha pronta para copiar e colar fica em `docs/store/FICHA-PREENCHIMENTO.md`.

> [!IMPORTANT]
> **Ação exclusiva do proprietário:** a submissão dos pacotes, o aceite dos termos legais e o gerenciamento das contas nas lojas Microsoft Edge Partner Center e Chrome Web Store Developer Dashboard são realizados exclusivamente pelo dono do projeto. Nenhum agente automatizado realiza envios ou aceites de termos.

---

## 1. Identificação e nome da extensão

- **Nome em português:** `Trail — Perícia de registros ServiceNow`
- **Nome em inglês:** `Trail — ServiceNow Record Forensics`
- **Nome curto (manifest / abas):** `Trail`
- **Categoria recomendada:**
  - Edge Partner Center: **Developer tools** (Ferramentas para desenvolvedores) ou **Productivity** (Produtividade)
  - Chrome Web Store: **Developer Tools** (Ferramentas para desenvolvedores) ou **Workflow & Planning** (Fluxo de trabalho e planejamento)

---

## 2. Descrição curta (limite oficial: até 132 caracteres)

### Português (127 caracteres)
> Descubra o que mudou qualquer campo do ServiceNow e por quê. Funciona sem admin, sem instalar nada nem criar papel. Só leitura.

### English (123 characters)
> Find out what changed any ServiceNow field and why. Works without admin, nothing to install, no new role needed. Read-only.

---

## 3. Descrição longa (Português)

Um campo de um incidente, mudança, tarefa ou item de catálogo apareceu com outro valor e ninguém sabe dizer se foi uma pessoa, uma integração, uma regra de negócio, um script de cliente, um job agendado ou um flow.

**Funciona sem ser admin:** o **Trail** usa o que o seu próprio login já vê na instância, sem instalar nenhum app no ServiceNow e sem criar nenhum papel de sistema. Quando a auditoria completa (`sys_audit`) é restrita para o seu perfil, ele reconstrói a linha do tempo a partir do histórico que você já enxerga no formulário (Activity Stream) e explica, em palavras simples e sem jargões, **o que os seus papéis deixam o Trail ver**.

Ao abrir qualquer formulário ou lista no ServiceNow (UI16 clássico, Workspace, Service Operations Workspace e Service Portal), o Trail coloca um ícone discreto ao lado de cada campo e uma **bolinha-assistente** sempre à mão:

### Principais recursos

- **Funciona com ou sem admin (sem instalar nada):** conversa com o servidor usando a sua sessão já autenticada no navegador e respeita rigorosamente as ACLs da instância. Com admin, cruza auditoria, transações, eventos, flows, jobs e scripts; sem admin (como perfil `itil` ou `Flow Designer`), utiliza o histórico do formulário e todas as fontes legíveis, com transparência total sobre o que entrou na análise e o que ficou de fora.
- **Bolinha-assistente e painel flutuante livre:** a bolinha pode ser arrastada e solta em qualquer lugar da tela (lembra a posição exata), dá boas-vindas uma vez por registro e exibe a dica apenas ao passar o mouse. Um clique abre o painel flutuante com cantos arredondados, redimensionável por qualquer borda ou canto.
- **Configurações rápidas e modo Sempre Visível:** o cabeçalho conta com acesso direto a **⚙ Configurações** dentro do próprio painel (ligar/desligar animações, gravar atalho de teclado customizado — padrão `Alt+Shift+P`, alternar tema claro/escuro, idioma, modo de abertura e controle dos ícones), botão para enviar ao painel lateral do navegador, e modo **Sempre visível** (Document Picture-in-Picture) que mantém o painel flutuando por cima de tudo, inclusive de outros programas.
- **Resposta clara com nomes e rótulos do formulário:** informa quem mudou o campo, quando, de qual valor para qual (com os rótulos reais do formulário, valores legíveis em vez de `sys_id` e links clicáveis nas referências) e o grau de certeza (alta, média ou baixa), acompanhado de um resumo pronto para colar no chamado.
- **Rastro segundo a segundo e provas verificáveis:** reconstrói a janela temporal da alteração (salvamento do formulário, regras disparadas, eventos, execuções de flow e jobs agendados), listando os fatos concretos que sustentam a conclusão, o motivo do descarte de outras hipóteses e alertas quando há regras em conflito.
- **Aba Flows com subflows aninhados:** visualização das execuções de flows que rodaram no registro (com hierarquia visual de subflows recuados logo abaixo do flow pai, horário, status e links para a execução) e dos flows configurados para a tabela (com gatilhos descritos em linguagem natural e indicação dos campos que gravam).
- **"O que roda neste registro":** mapa completo no fim da visualização do registro com as regras de negócio em ordem de execução (display → before → after → async) e indicação dos campos gravados, script includes chamados, client scripts, UI policies, botões e jobs, com busca por texto ou campos gravados, grupos recolhíveis e filtro "Só o que rodou aqui".
- **"Tudo que mudou" em grupos por momento:** agrupa as alterações por instante de salvamento (*"admin salvou 4 campos"*), exibe a trilha animada com a lupa em etapas compreensíveis e permite investigar o registro inteiro ou colunas inteiras em lote pela lista, com filtros por pessoa, API ou automação e exportação em CSV, texto ou PDF.
- **Comparador entre dois momentos e simulação "E se?":** escolha dois pontos quaisquer na linha do tempo para comparar exatamente o que mudou no registro entre eles, ou simule na aba **E se?** quais regras e scripts seriam acionados antes de salvar um novo valor.
- **Acompanhamento automático:** ao trocar de chamado ou registro na mesma aba, o painel atualiza automaticamente o contexto sem necessidade de recarregar a página.

### Privacidade e segurança

- **Estritamente somente leitura:** o cliente do motor emite exclusivamente requisições `GET`. Não existe código capaz de criar, alterar ou excluir registros na instância.
- **Respeito absoluto às ACLs do usuário:** a extensão utiliza a sessão do navegador e nunca enxerga além das permissões que o servidor ServiceNow concede ao usuário conectado.
- **Sem telemetria nem terceiros:** não há envio para servidores de terceiros; as consultas e os dados necessários seguem diretamente do navegador à instância ServiceNow escolhida pelo usuário.
- **Permissão por instância:** você autoriza apenas os domínios de instâncias em que deseja conectar o Trail; a extensão não solicita acesso irrestrito a todos os sites.

---

## 4. Long description (English)

A field on an incident, change request, task, or catalog item suddenly shows an unexpected value, and nobody can tell whether it was changed by a person, an API integration, a business rule, a client script, a scheduled job, or a flow.

**Works without admin:** **Trail** uses what your existing login already sees on the instance — nothing to install on ServiceNow and no custom role required. When full audit access (`sys_audit`) is restricted for your user, Trail reconstructs the timeline from the form history you already see on the record (Activity Stream) and explains in plain language **what your roles let Trail see**.

When opening any form or list in ServiceNow (classic UI16, Workspace, Service Operations Workspace, or Service Portal), Trail places a discreet icon next to each field and a handy **assistant bubble** on the page:

### Key Features

- **Works with or without admin (zero installation):** communicates with the ServiceNow instance using your existing authenticated browser session, strictly following server-enforced ACLs. With admin rights, it inspects audit logs, transactions, events, flows, jobs, and scripts; without admin (such as `itil` or `Flow Designer` roles), it uses the form history and all readable sources, providing full transparency on which capabilities were evaluated.
- **Free-floating assistant bubble & panel:** the assistant bubble can be dragged and placed anywhere on the screen (retains its proportional position across reloads), welcomes you once per record, and displays its tip balloon only on hover. A single click opens the floating panel with rounded corners, resizable from any edge or corner.
- **Quick settings & Always on Top mode:** the header includes immediate access to in-panel **⚙ Settings** (toggle animations, record custom keyboard shortcuts — default `Alt+Shift+P`, switch light/dark theme, choose language, select open mode, and toggle field icons), a button to dock into the browser's side panel, and **Always on top** (Document Picture-in-Picture) to keep the forensic panel floating above all application windows.
- **Clear verdict with native form labels:** reveals who changed the field, when, from which value to which (using the form's own field labels, human-readable display values instead of technical `sys_id`s, and clickable reference links), accompanied by certainty scoring (high, medium, or low) and a plain-text summary ready to paste into work notes.
- **Second-by-second trace & verifiable proofs:** reconstructs the time window around the change (form save, business rules, events, flow executions, and scheduled jobs), detailing the facts supporting the conclusion, why alternative causes were ruled out, and warnings for conflicting rules.
- **Flows tab with nested subflows:** inspects flows that executed on the record (with nested subflows indented under their parent flow, execution status, timestamps, and direct execution links) as well as flows configured for the table (with human-readable triggers and fields written).
- **"What runs on this record":** comprehensive automation map at the bottom of the whole-record view, displaying business rules in execution sequence (display → before → after → async) with written fields, called script includes, client scripts, UI policies, form buttons, and jobs, complete with text/field search, collapsible groups, and a "Ran here only" filter.
- **"Everything that changed" grouped by save event:** groups all field changes by saving moment (*"admin saved 4 fields"*), with an animated magnifying-glass progress trail, whole-record analysis, list batch investigations with CSV export, and filtering by author, API, or automation.
- **Two-moment comparator & "What if?" simulation:** select any two checkpoints on the record timeline to view the diff between them, or simulate in the **What if?** tab which rules and scripts would run before committing a new value.
- **Automatic record tracking:** navigating between records or tickets in the same browser tab smoothly refreshes the forensic context without requiring a manual page reload.

### Privacy and Security

- **Strictly read-only:** all engine requests are HTTP `GET` only. There is no code path capable of creating, modifying, or deleting records on the instance.
- **ACL-bound:** Trail operates within the logged-in user's existing browser session and never sees beyond the permissions granted by the ServiceNow server.
- **No telemetry or third-party servers:** required queries and data go directly from the browser to the ServiceNow instance selected by the user.
- **Per-instance host permission:** the broad host pattern exists only as an optional permission so custom ServiceNow domains can work. At runtime, Trail requests only the exact origin the user chooses to connect.

---

## 5. Novidades da versão 1.4.4 (Release Notes)

### Português (Versão 1.4.4)
- **Perícia completa com ou sem admin:** funciona usando o que o seu login já vê. Quando a auditoria completa não está acessível, o Trail utiliza o histórico do formulário (Activity Stream) e exibe de forma transparente o que os seus papéis permitem ver, sem precisar instalar nada na instância e sem criar papéis adicionais.
- **Aba Flows com subflows aninhados:** visualize os flows executados no registro com subflows recuados logo abaixo do flow pai, status, horário e links diretos, além dos flows configurados para a tabela com gatilhos em linguagem natural e campos gravados.
- **Mapa "O que roda neste registro":** visualização completa no histórico do registro com regras de negócio em ordem de execução, script includes, client scripts, UI policies, botões e jobs, incluindo busca por campo gravado e filtro de automações que rodaram no chamado.
- **Bolinha-assistente e painel flutuante aprimorados:** arraste a bolinha para qualquer lugar da tela com memória de posição, acesse configurações rápidas dentro do painel (animações, atalho customizável `Alt+Shift+P`, temas, idioma) e use o modo Sempre Visível (Picture-in-Picture).
- **Compatibilidade universal Chromium:** experiência idêntica no Microsoft Edge e no Google Chrome, com envio ao painel lateral do navegador ou janela própria e acompanhamento automático de navegação entre registros.
- **Somente leitura:** sem servidores intermediários; as consultas GET respeitam as ACLs do usuário.

### English (Version 1.4.4)
- **Full forensics with or without admin:** works with your existing login. When full audit access is unavailable, Trail seamlessly falls back to form history (Activity Stream) and transparently reports role capabilities without installing server apps or creating new roles.
- **Flows tab with nested subflows:** view flows executed on the record with nested subflows indented under their parent execution, status, timestamps, and direct links, plus configured table flows with plain-language triggers and written fields.
- **"What runs on this record" automation map:** whole-record view showing business rules in execution order, script includes, client scripts, UI policies, UI actions, and jobs, with search by modified field and a "Ran here only" filter.
- **Enhanced assistant bubble & floating panel:** freely drag the bubble anywhere with persistent position, access in-panel quick settings (animations toggle, custom `Alt+Shift+P` shortcut, themes, language), and use Always on Top (Picture-in-Picture) mode.
- **Universal Chromium support:** identical smooth experience on Microsoft Edge and Google Chrome, supporting native side panel docking, standalone window mode, and automatic record switching.
- **Strictly read-only & private:** zero telemetry, no third-party servers, and GET-only requests strictly governed by the user's ServiceNow ACLs.

---

## 6. Requisitos oficiais de assets visuais por loja

### Microsoft Edge Add-ons (Partner Center)

| Asset | Requisito / Formato | Dimensões | Arquivo no repositório |
|---|---|---|---|
| **Ícone da extensão** | PNG obrigatório (fundo transparente ou preenchido) | **300 × 300 px** | [`docs/store/logo-300.png`](store/logo-300.png) |
| **Captura 1 (Resposta)** | PNG ou JPEG (sem dados privados, alta fidelidade) | **1280 × 800 px** | [`docs/store/shot-1-resposta.png`](store/shot-1-resposta.png) |
| **Captura 2 (Provas)** | PNG ou JPEG | **1280 × 800 px** | [`docs/store/shot-2-provas.png`](store/shot-2-provas.png) |
| **Captura 3 (Rastro/Lote)** | PNG ou JPEG | **1280 × 800 px** | [`docs/store/shot-3-rastro.png`](store/shot-3-rastro.png) |
| **Captura 4 (Comparador)** | PNG ou JPEG | **1280 × 800 px** | [`docs/store/shot-4-comparar.png`](store/shot-4-comparar.png) |
| **Captura 5 (Flows)** | PNG ou JPEG | **1280 × 800 px** | [`docs/store/shot-5-flows.png`](store/shot-5-flows.png) |
| **Tile promocional pequeno** | PNG ou JPEG (opcional) | **440 × 280 px** | [`docs/store/tile-440x280.png`](store/tile-440x280.png) |
| **Tile promocional grande** | PNG ou JPEG (opcional) | **1400 × 560 px** | Opcional |

*Nota Edge:* Até 6 capturas; tamanhos aceitos: 640×480 ou 1280×800 px. As 5 capturas preparadas em docs/store estão no segundo formato. Tiles promocionais são opcionais. [Requisitos oficiais do Edge Add-ons](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

### Google Chrome Web Store (Developer Dashboard)

| Asset | Requisito / Formato | Dimensões | Arquivo no repositório |
|---|---|---|---|
| **Ícone da extensão** | PNG (embutido no pacote) | **128 × 128 px** | [`extension/public/icons/icon128.png`](../extension/public/icons/icon128.png) |
| **Capturas de tela** | PNG ou JPEG (mínimo 1, máximo 5) | **1280 × 800 px** (ou 640×400) | [`docs/store/shot-1-resposta.png`](store/shot-1-resposta.png) a `shot-5-flows.png` |
| **Tile promocional pequeno** | PNG ou JPEG (obrigatório) | **440 × 280 px** | [`docs/store/tile-440x280.png`](store/tile-440x280.png) |
| **Tile promocional marquee** | PNG ou JPEG (opcional) | **1400 × 560 px** | Opcional |

*Nota Chrome:* são aceitas de 1 a 5 capturas de 1280×800 ou 640×400 px. O tile promocional pequeno de 440×280 px é obrigatório; o marquee de 1400×560 px é opcional. [Requisitos oficiais de imagens](https://developer.chrome.com/docs/webstore/images) e [campos da listagem](https://developer.chrome.com/docs/webstore/cws-dashboard-listing).

---

## 7. Informações de privacidade e justificativas para revisores

### Texto para "Notes for certification / Notes for reviewers" (Inglês)

```
Trail is a strictly read-only forensic assistant for ServiceNow records and changes.

Single Purpose:
Enable ServiceNow developers, administrators, and support analysts to inspect what modified any given field or record, when the change occurred, which automation or user caused it, and with what level of certainty.

Permissions Justification:
- storage: Saves preferences (theme, language, shortcut, panel mode, field icon visibility), connected instance domains and temporary per-tab investigation state. Bubble and panel position stay in local storage; investigation results and the ServiceNow session token stay in session storage.
- contextMenus: Adds a "Trail" entry to the page right-click menu and right-click entries on the toolbar icon (open floating panel, side panel or window, show/hide field icons, options).
- sidePanel: Provides side panel integration when the user selects browser side panel mode.
- activeTab: Reads the active ServiceNow record context (table and sys_id) when the user clicks the extension icon.
- scripting: Renders the field icons, floating assistant bubble and panel on tabs for connected instances, and restores the content script after a development reload.
- optional_host_permissions (https://*.service-now.com/* and https://*/*): Nothing is granted at installation. When the user clicks "Connect this instance", chrome.permissions.request asks only for that instance's exact origin. The broad optional pattern is needed for custom ServiceNow domains.

Read-only & ACL Integrity:
The extension issues exclusively HTTP GET queries using the user's active browser session. It never writes to the instance, requires no server-side application or role, never bypasses server ACLs, and transmits zero data to third-party endpoints.

Reviewer Testing Without a ServiceNow Account:
Reviewers can verify the interface without ServiceNow credentials at https://trail-sn.vercel.app/b3/ or by opening chrome-extension://<id>/src/sidepanel/index.html?demo=1 after installation. For a live test, open any incident in a ServiceNow developer instance, click the extension icon, choose "Connect this instance", and click a Trail icon next to a field.
```

### Declaração de privacidade nas lojas

- **Declaração de dados:** não marque que a extensão não trata dados. Marque informações de identificação pessoal (nomes presentes nos registros), informações de autenticação (token temporário da sessão ServiceNow) e conteúdo do site (registros e histórico). Não marque as demais categorias sem evidência. O processamento local não elimina a obrigação de declarar ([FAQ oficial](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)).
- **Certificações do Chrome:** confirmar que os dados não são vendidos ou transferidos fora dos casos aprovados, não são usados para finalidade alheia à função principal e não são usados para crédito ou empréstimos.
- **Uso único (Single Purpose):** *"Investigação pericial e leitura de auditoria e automações em registros do ServiceNow diretamente pelo navegador."*
- **URL da Política de Privacidade:**
  `https://trail-sn.vercel.app/privacidade/`
- **URL de suporte / site oficial:**
  `https://trail-sn.vercel.app/b3/`

---

## 8. Passo a passo para o envio (Exclusivo do Dono)

### A. Publicação no Microsoft Edge Add-ons (Partner Center)

1. Acesse o [Partner Center do Microsoft Edge](https://partner.microsoft.com/dashboard/microsoftedge/overview) e entre com sua conta Microsoft.
2. No painel de extensões, clique em **Create new extension** (ou selecione a extensão existente se já iniciada).
3. Envie `docs/store/packages/trail-chrome-1.4.4.zip`. O mesmo pacote, com `manifest.json` na raiz, serve para Edge e Chrome. Não envie `trail-extensao-1.4.4.zip`, que contém a pasta para instalação manual.
4. Na aba **Availability**, defina **Public** (visível a todos na loja).
5. Na aba **Properties**:
   - Categoria principal: **Developer tools** (Ferramentas para desenvolvedores).
   - Política de privacidade: `https://trail-sn.vercel.app/privacidade/`.
   - Site / suporte: `https://trail-sn.vercel.app/b3/`.
6. Na aba **Store listings**:
   - Adicione os idiomas **Portuguese (Brazil)** e **English**.
   - Preencha a descrição curta (seção 2 deste guia).
   - Preencha a descrição longa formatada (seções 3 e 4).
   - Cole as notas da versão 1.4.4 (seção 5).
   - Faça o upload do logotipo `docs/store/logo-300.png` (`300×300 px`).
   - Faça o upload das 5 capturas `1280×800 px` (`docs/store/shot-1-resposta.png` a `shot-5-flows.png`). O tile promocional pequeno de 440×280 px é opcional no Edge.
7. Na aba **Submit your extension**:
   - Cole o texto em inglês de justificativas para os revisores (seção 7) no campo **Notes for certification**.
   - Revise os dados e clique em **Publish**.

### B. Publicação na Google Chrome Web Store (Developer Dashboard)

1. Acesse o [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) com a sua conta Google de desenvolvedor.
2. Clique em **Novo item** (ou selecione o rascunho existente).
3. Faça o upload de `docs/store/packages/trail-chrome-1.4.4.zip` (o `manifest.json` está na raiz do arquivo).
4. Em **Detalhes do item**:
   - Nome: `Trail — Perícia de registros ServiceNow` (ou configurado pelo manifest em `_locales`).
   - Descrição curta e descrição longa: copie os textos das seções 2 e 4.
   - Categoria: **Ferramentas para desenvolvedores**.
   - Envie as 5 capturas `1280×800 px` (`docs/store/shot-1-resposta.png` a `shot-5-flows.png`). Adicione também o tile promocional obrigatório `docs/store/tile-440x280.png`.
   - Ícone: o Chrome extrai automaticamente o ícone `128×128 px` do manifest.
5. Em **Privacidade**:
   - Justificativa do propósito único (Single Purpose): copie da seção 7.
   - Justificativa de permissões: cole a explicação de cada permissão (`storage`, `sidePanel`, `activeTab`, `scripting`, `contextMenus`, `optional_host_permissions`) conforme a seção 7.
   - Declaração de uso de dados: declare que os dados do ServiceNow e da navegação são processados para a função anunciada, localmente e em consultas à instância escolhida. Revise cada categoria conforme a tela atual; não use a opção “não coleta dados”. Confirme compartilhamento e finalidade com a política de privacidade vigente.
   - Política de privacidade: `https://trail-sn.vercel.app/privacidade/`.
6. Em **Instruções para a equipe de revisão**:
   - Cole as instruções para teste sem conta ServiceNow (seção 7).
7. Clique em **Enviar para revisão**.
