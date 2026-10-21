# Submissão na loja Microsoft Edge Add-ons

Textos, notas de versão, respostas de revisão e instruções para publicar o **Trail** (v0.13.0) no Partner Center.

## Nome
**Trail — Perícia de registros ServiceNow** (ou, em inglês: **Trail — ServiceNow Record Forensics**)

## Descrição curta (até 132 caracteres)
> Descubra o que mudou qualquer campo do ServiceNow e por quê. Funciona sem admin, sem instalar nada nem criar papel. Só leitura.

*(127 caracteres — em inglês, 123 caracteres:)*
> Find out what changed any ServiceNow field and why. Works without admin, nothing to install, no new role needed. Read-only.

## Descrição longa (Português)

Um campo de um incidente, mudança ou item de catálogo apareceu com outro valor e ninguém sabe dizer se foi uma pessoa, uma integração, uma business rule, um client script, um job agendado ou um flow.

**Funciona sem ser admin:** o **Trail** usa o que o seu próprio login já vê na instância, sem instalar nenhum app e sem criar papel novo. Quando a auditoria completa (`sys_audit`) é negada para quem não é admin, ele reconstrói a linha do tempo a partir do histórico que você já enxerga no formulário e mostra, em palavras simples, **o que os seus papéis deixam o Trail ver**.

Ao abrir um formulário ou lista no ServiceNow (UI16, Workspace e Service Portal), o Trail coloca um ícone discreto ao lado de cada campo e uma **bolinha-assistente** sempre à mão no canto da página:

- **Funciona com ou sem admin (sem instalar nada):** conversa com o servidor usando a sua sessão já aberta no navegador e respeita as ACLs da instância. Com admin, cruza todas as tabelas de auditoria, transações, eventos, flows, jobs e scripts; sem admin (como `itil` ou `Flow Designer`), usa o histórico do formulário e tudo mais que os seus papéis puderem ler, listando com transparência o que entrou na análise e o que ficou de fora.
- **Bolinha-assistente na página:** fica no canto da instância conectada, pode ser arrastada para qualquer altura (encosta na borda e lembra a posição), dá boas-vindas uma vez por registro e exibe o balão de dica só ao passar o mouse; um clique abre o painel flutuante.
- **Painel flutuante, cabeçalho novo e configurações rápidas:** abre dentro da própria página (ou pelo atalho configurável `Alt+Shift+P`), redimensionável por qualquer borda ou canto. O cabeçalho traz marca, nome e instância à esquerda e, à direita, **⚙ Configurações** (ligar ou desligar animações, gravar atalho para abrir e fechar, escolher tema, idioma, onde abrir o painel, ícones nos campos, bolinha e modo **Sempre visível** em Picture-in-Picture que fica por cima de tudo), botão para enviar ao painel lateral do Edge, alternância de tema e `✕` (ou `Esc`) para recolher na bolinha.
- **Resposta e nomes como no formulário:** mostra quem mudou o campo, quando, de qual valor para qual (com o rótulo certo por tabela via `sys_documentation`, valor legível em vez de `sys_id` e links nas referências) e se a certeza é alta, média ou baixa, com texto pronto sem jargão técnico para colar no chamado.
- **Rastro segundo a segundo e provas:** reconstrói a janela da mudança (formulário salvo, regras, eventos, flows e jobs) e lista cada fato verificável, por que outros candidatos foram descartados e se há regras em conflito gravando o mesmo campo.
- **"Tudo que mudou" em grupos por momento:** ao investigar o registro inteiro ou vários registros em lote pela lista, usa a animação da trilha com a lupa e etapas próprias (*"Lendo a auditoria do registro..."*, *"Separando os campos que mudaram..."*) e agrupa as alterações por salvamento (*"admin salvou 4 campos"*), com filtros por pessoa, API ou automação e exportação em CSV, texto ou PDF.
- **O que mudou entre dois momentos e "E se?":** escolha dois momentos na linha do tempo para ver só o que ficou diferente no registro entre eles, ou simule na aba **E se?** o que mudaria antes de salvar outro valor.

**Privacidade e segurança**
- **Somente leitura:** o cliente REST do motor faz apenas consultas de leitura (`GET`). Não há código capaz de criar, alterar ou apagar registros na instância.
- **Respeito total às ACLs do usuário:** a extensão usa a sessão autenticada do navegador e nunca vê além do que as ACLs do próprio usuário permitem no servidor.
- **Sem servidores externos:** todas as chamadas vão direto do navegador para a instância aberta na aba. Não há telemetria, conta própria nem coleta de dados.
- **Permissão por instância:** você escolhe em quais instâncias conectar o Trail; a extensão não pede acesso a todos os sites.

## Long description (English)

A field on an incident, change request or catalog item has a value nobody recognizes, and nobody can tell whether it came from a person, an integration, a business rule, a client script, a scheduled job or a flow.

**Works without admin:** **Trail** uses what your own login already sees on the instance — nothing to install on ServiceNow and no custom role to create. When full `sys_audit` is denied for non-admin users, Trail rebuilds the timeline from the form history you already see on the record and explains in plain words **what your roles let Trail see**.

When you open a ServiceNow form or list (UI16, Workspace and Service Portal), Trail places a discreet icon next to each field and a persistent **assistant bubble** in the corner of connected pages:

- **Works with or without admin (nothing to install):** talks to the instance using your existing browser session and respects server-enforced ACLs. With admin, it cross-checks all audit, transaction, event, flow, job and script tables; without admin (such as `itil` or `Flow Designer`), it uses the form history and whatever else your roles can read, clearly showing which capabilities are available.
- **Assistant bubble on the page:** stays in the corner of connected instances, drags and snaps to the left or right edge (remembering its position), greets you once per record and shows the tip balloon only on hover; click to open the floating panel.
- **Floating panel, clean header & built-in settings:** opens right inside the page (or with the configurable `Alt+Shift+P` shortcut) and resizes from any edge or corner. The header shows the brand, name and instance on the left and, on the right, **⚙ Settings** (toggle animations on/off, record a custom shortcut to open and close the panel, pick theme, language, where the panel opens, field icons, bubble, and **Always on top** Document Picture-in-Picture), a button to dock into the Edge side panel, theme toggle, and `✕` (or `Esc`) to fold back into the bubble.
- **Verdict with form labels and values:** shows what changed the field, when, from which value to which (using table-specific labels from `sys_documentation`, display values instead of raw `sys_id`s, and clickable reference links), whether certainty is high, medium or low, and a plain-language summary ready to paste into a ticket.
- **Second-by-second trace & proofs:** rebuilds the execution window around the change and lists every verifiable fact, why other candidates were ruled out, and whether conflicting rules write to the same field.
- **"Everything that changed" grouped by moment:** whole-record and list-column batch investigations use the animated trail-and-magnifying-glass loader with dedicated steps (*"Reading record audit..."*, *"Picking out the fields that changed..."*) and group changes by save (*"admin saved 4 fields"*), with filters by person, API or automation and CSV, text or PDF export.
- **What changed between two moments & "What if?":** pick two moments on the timeline to see only what differs between them, or simulate another value in the **What if?** tab before saving.

**Privacy and security**
- **Strictly read-only:** the client only issues read (`GET`) requests. It cannot create, update or delete records on the instance.
- **Never sees beyond the user's ACLs:** Trail uses the logged-in user's browser session and never bypasses or exceeds the permissions enforced by the ServiceNow server for that user.
- **No external servers:** every request goes straight from your browser to the ServiceNow instance open in the tab. No telemetry, no accounts, no analytics.
- **Per-instance permission:** you choose which instances to connect; Trail never asks for access to all websites.

## Novidades da versão 0.13.0 (Português)
- **Funciona sem ser admin (sem instalar nada nem criar papel):** usa o que o seu login já enxerga na instância. Quando `sys_audit` é negado, reconstrói a linha do tempo pelo histórico do formulário (Activity Stream) e mostra em linguagem simples **o que os seus papéis deixam o Trail ver** (quem mudou e quando, regras automáticas, flows, jobs, eventos, botões e transações).
- **Cabeçalho novo e ⚙ Configurações dentro do painel:** controle animações (liga/desliga), grave um atalho de teclado para abrir e fechar o painel (padrão `Alt+Shift+P`), alterne tema, idioma, onde abrir o painel e o modo **Sempre visível** (Picture-in-Picture) sem sair da investigação.
- **Bolinha-assistente e painel flutuante aprimorados:** boas-vindas uma única vez por registro, balão de dica só ao passar o mouse, trilha animada com lupa também no registro inteiro e no lote, e tratamento separado para instâncias lentas sem falso aviso de acesso negado.

## What's new in 0.13.0 (English)
- **Works without admin (nothing to install, no new role needed):** uses what your login already sees on the instance. When `sys_audit` is denied, Trail rebuilds the timeline from the form history (Activity Stream) and shows in plain words **what your roles let Trail see** (who changed and when, business rules, flows, jobs, events, UI actions and transactions).
- **New header & built-in ⚙ Settings sheet:** toggle animations on or off, record a custom keyboard shortcut to open and close the panel (default `Alt+Shift+P`), switch theme, language, where the panel opens, and **Always on top** (Picture-in-Picture) right inside the panel.
- **Refined assistant bubble & floating panel:** per-record welcome balloon, hover-only tip balloon, animated trail-and-magnifying-glass loader for whole-record and batch views, and separate handling for slow responses without false access-denied warnings.

## Categoria sugerida
**Developer Tools** (Ferramentas para desenvolvedores) ou **Productivity** (Produtividade).

## Permissões justificadas (para o campo "Notes for reviewers")

```
Trail is a strictly read-only forensic assistant for ServiceNow records.

Permissions used:
- storage: saves user preferences (theme, language, animations, keyboard shortcut, panel mode, bubble/float position) and the list of ServiceNow instances the user explicitly connected.
- sidePanel: displays the investigation report in the browser side panel when the user chooses side panel mode.
- activeTab + scripting: reads the current ServiceNow record context (table, sys_id, session token g_ck) and injects the field icons, assistant bubble, and floating panel on instances the user connected.
- optional_host_permissions (https://*/*): requested at runtime via chrome.permissions.request ONLY for the specific ServiceNow origin the user clicks "Connect this instance" on.

Read-only & ACL-bound:
The extension issues only read (GET) requests to the connected ServiceNow instance using the user's existing browser session. It never writes to the instance, requires no app or role on the server, never sees beyond the logged-in user's server-enforced ACLs, and never sends data to any third-party server.

Testing without a ServiceNow account:
Open chrome-extension://<id>/src/sidepanel/index.html?demo=1&float=1 (or https://trail-sn.vercel.app/b3/) to inspect the full UI with built-in demonstration data.
```

## URL da política de privacidade
Publique `docs/PRIVACIDADE.md` (ou a página equivalente do site):
- Site: `https://trail-sn.vercel.app/privacidade/`
- Repositório público: `https://github.com/iiFoox/trail-sn/blob/master/docs/PRIVACIDADE.md`

No Partner Center, marque **"This extension does not collect any personal data"**.

## Site e suporte
- Site oficial com demonstração interativa: `https://trail-sn.vercel.app/b3/`
- Repositório e suporte (issues): `https://github.com/iiFoox/trail-sn`

## Passo a passo no Partner Center (1ª submissão — exige login Microsoft)

1. Acesse <https://partner.microsoft.com/dashboard/microsoftedge/overview> e entre com a sua conta Microsoft.
2. Caso ainda não tenha cadastro no programa **Microsoft Edge Add-ons**, conclua o registro gratuito de desenvolvedor individual.
3. Clique em **Create new extension** e envie o arquivo `trail-edge-0.13.0.zip` (gerado por `bash tools/atualizar-extensao.sh`).
4. Em **Availability**, escolha **Public** (ou **Hidden** se quiser testar só por link direto antes).
5. Em **Properties**:
   - Categoria: **Developer tools**.
   - Cole a URL da política de privacidade (`https://trail-sn.vercel.app/privacidade/`).
   - Cole a URL do site (`https://trail-sn.vercel.app/b3/`).
6. Em **Store listings**, adicione **Portuguese (Brazil)** e **English**:
   - Cole a descrição curta e a descrição longa acima.
   - Cole as notas da versão 0.13.0 no campo de novidades da versão.
   - Envie o ícone `300×300` (`docs/store/logo-300.png`) e as capturas `1280×800` (`docs/store/shot-*.png`).
7. Em **Submit your extension**, cole o texto de **Notes for reviewers** acima e clique em **Publish**.
