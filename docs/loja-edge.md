# Submissão na loja Microsoft Edge Add-ons

Textos, notas de versão, respostas de revisão e instruções para publicar o **Trail** (v0.12.6) no Partner Center.

## Nome
**Trail — Perícia de registros ServiceNow** (ou, em inglês: **Trail — ServiceNow Record Forensics**)

## Descrição curta (até 132 caracteres)
> Descubra o que alterou qualquer campo do ServiceNow, quando e por quê, na própria página. Somente leitura, sem telemetria.

*(122 caracteres — em inglês, 112 caracteres:)*
> Find out what changed any ServiceNow field, when and why, right on the page. Read-only, no servers or telemetry.

## Descrição longa (Português)

Um campo de um incidente, mudança ou item de catálogo apareceu com outro valor e ninguém sabe dizer se foi uma pessoa, uma integração, uma business rule, um client script, um job agendado ou um flow.

O **Trail** coloca um ícone ao lado de cada campo do ServiceNow (UI16, Workspace e Service Portal) e uma **bolinha-assistente** sempre à mão no canto da página. Clique no ícone de um campo ou na bolinha e o painel cruza a auditoria do registro com os rastros de execução da própria instância, usando a sua sessão já aberta no navegador:

- **Bolinha-assistente na página:** fica no canto da instância conectada, pode ser arrastada para qualquer altura (encosta na borda e lembra a posição), mostra as boas-vindas uma vez por registro e exibe o balão de dica só ao passar o mouse; um clique abre o painel.
- **Painel flutuante estilo janela do Mac:** abre dentro da própria página com cantos arredondados, bolinhas de fechar, minimizar na bolinha e **sempre visível** (Picture-in-Picture que fica por cima de tudo), redimensionável por qualquer borda, setinha lateral e tecla `Esc` para recolher, além de botão para enviar ao painel lateral do Edge ou abrir em janela separada.
- **Resposta e nomes como no formulário:** mostra quem mudou o campo, quando, de qual valor para qual (com o rótulo certo por tabela via `sys_documentation`, valor legível em vez de `sys_id` e links nas referências) e se a certeza é alta, média ou baixa, com texto pronto sem jargão técnico para colar no chamado.
- **Rastro segundo a segundo e provas:** reconstrói a janela da mudança (formulário salvo, regras, eventos, flows e jobs) e lista cada fato verificável, por que outros candidatos foram descartados e se há regras em conflito gravando o mesmo campo.
- **"Tudo que mudou" em grupos por momento:** ao investigar o registro inteiro ou vários registros em lote pela lista, usa a mesma animação da trilha com a lupa e etapas próprias (*"Lendo a auditoria do registro..."*, *"Separando os campos que mudaram..."*) e agrupa as alterações por salvamento (*"admin salvou 4 campos"*), com filtros por pessoa, API ou automação e exportação em CSV, texto ou PDF.
- **O que mudou entre dois momentos e "E se?":** escolha dois momentos na linha do tempo para ver só o que ficou diferente no registro entre eles, ou simule na aba **E se?** o que mudaria antes de salvar outro valor.

**Privacidade e segurança**
- **Somente leitura:** o cliente REST do motor só emite `GET` na Table API. Não há código capaz de criar, alterar ou apagar registros.
- **Sem servidores externos:** todas as chamadas vão direto do navegador para a instância aberta na aba. Não há telemetria, conta nem coleta de dados.
- **Permissão por instância:** você escolhe em quais instâncias conectar o Trail; a extensão não pede acesso a todos os sites.

## Long description (English)

A field on an incident, change request or catalog item has a value nobody recognizes, and nobody can tell whether it came from a person, an integration, a business rule, a client script, a scheduled job or a flow.

**Trail** adds a small icon next to every ServiceNow field (UI16, Workspace and Service Portal) and a persistent **assistant bubble** in the corner of connected pages. Click any field icon or the bubble and the panel cross-references the record's audit history with execution traces from your own instance, using the session already open in your browser:

- **Assistant bubble on the page:** stays in the corner of connected instances, drags and snaps to the left or right edge (remembering its position), greets you once per record and shows the tip balloon only on hover; click to open the floating panel.
- **Mac-style floating window:** opens right inside the page with rounded corners, close / minimize / **always on top** (Document Picture-in-Picture) window dots, resizing from any edge or corner, side arrow tab and `Esc` to hide back into the bubble, plus a button to send it to the Edge side panel or a separate window.
- **Verdict with form labels and values:** shows what changed the field, when, from which value to which (using table-specific labels from `sys_documentation`, display values instead of raw `sys_id`s, and clickable reference links), whether certainty is high, medium or low, and a plain-language summary ready to paste into a ticket.
- **Second-by-second trace & proofs:** rebuilds the execution window around the change and lists every verifiable fact, why other candidates were ruled out, and whether conflicting rules write to the same field.
- **"Everything that changed" grouped by moment:** whole-record and list-column batch investigations use the same animated trail-and-magnifying-glass loader with dedicated steps (*"Reading record audit..."*, *"Picking out the fields that changed..."*) and group changes by save (*"admin saved 4 fields"*), with filters by person, API or automation and CSV, text or PDF export.
- **What changed between two moments & "What if?":** pick two moments on the timeline to see only what differs between them, or simulate another value in the **What if?** tab before saving.

**Privacy and security**
- **Read-only:** the REST client only issues `GET` requests to the Table API. It cannot create, update or delete records.
- **No external servers:** every request goes straight from your browser to the ServiceNow instance open in the tab. No telemetry, no accounts, no analytics.
- **Per-instance permission:** you choose which instances to connect; Trail never asks for access to all websites.

## Novidades da versão 0.12.6 (Português)
- **Bolinha-assistente no canto da página:** fica visível nas páginas da instância conectada, pode ser arrastada (encosta na borda e lembra a posição), mostra as boas-vindas uma vez por registro e exibe o balão de dica só com o mouse em cima; um clique abre o painel flutuante.
- **Painel flutuante estilo janela do Mac:** cantos arredondados, bolinhas de fechar, minimizar na bolinha e **sempre visível** (fica por cima de tudo via Picture-in-Picture), redimensionável por qualquer borda, setinha lateral e tecla `Esc` para recolher, e botão para enviar ao painel lateral do Edge.
- **"Tudo que mudou" em grupos por momento e trilha com lupa:** a investigação do registro inteiro e o lote usam a mesma animação da trilha que se desenha com a lupa (com etapas próprias como *"Lendo a auditoria do registro..."* e *"Separando os campos que mudaram..."*) e agrupam os campos alterados no mesmo salvamento (*"admin salvou 4 campos"*).
- **O que mudou entre dois momentos:** comparador da linha do tempo renomeado e com explicação direta para comparar dois pontos do registro.

## What's new in 0.12.6 (English)
- **Assistant bubble in the page corner:** stays visible on connected instance pages, drags and snaps to either edge (remembering its position), greets once per record and shows the tip balloon only on hover; click to open the floating panel.
- **Mac-style floating panel:** rounded corners, close / minimize / **always on top** (Picture-in-Picture) window buttons, resizable from any edge, side arrow tab and `Esc` to hide into the bubble, plus a button to dock into the Edge side panel.
- **"Everything that changed" grouped by moment & trail loader:** whole-record and batch views share the animated trail-and-magnifying-glass loader with dedicated steps (*"Reading record audit..."*, *"Picking out the fields that changed..."*) and group fields modified in the same save (*"admin saved 4 fields"*).
- **What changed between two moments:** clearer timeline comparison mode showing only the fields that differ between two selected moments.

## Categoria sugerida
**Developer Tools** (Ferramentas para desenvolvedores) ou **Productivity** (Produtividade).

## Permissões justificadas (para o campo "Notes for reviewers")

```
Trail is a read-only forensic assistant for ServiceNow records.

Permissions used:
- storage: saves user preferences (theme, language, panel mode, bubble/float position) and the list of ServiceNow instances the user explicitly connected.
- sidePanel: displays the investigation report in the browser side panel when the user chooses side panel mode.
- activeTab + scripting: reads the current ServiceNow record context (table, sys_id, session token g_ck) and injects the field icons, assistant bubble, and floating panel on instances the user connected.
- optional_host_permissions (https://*/*): requested at runtime via chrome.permissions.request ONLY for the specific ServiceNow origin the user clicks "Connect this instance" on.

Testing without a ServiceNow account:
Open chrome-extension://<id>/sidepanel/index.html?demo=1&float=1 (or https://trail-sn.vercel.app/b3/) to inspect the full UI with built-in demonstration data.

The extension makes only GET requests to the connected ServiceNow instance and never sends data to any third-party server.
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
3. Clique em **Create new extension** e envie o arquivo `trail-0.12.6.zip` (gerado por `npm run pack`).
4. Em **Availability**, escolha **Public** (ou **Hidden** se quiser testar só por link direto antes).
5. Em **Properties**:
   - Categoria: **Developer tools**.
   - Cole a URL da política de privacidade (`https://trail-sn.vercel.app/privacidade/`).
   - Cole a URL do site (`https://trail-sn.vercel.app/b3/`).
6. Em **Store listings**, adicione **Portuguese (Brazil)** e **English**:
   - Cole a descrição curta e a descrição longa acima.
   - Cole as notas da versão 0.12.6 no campo de novidades da versão.
   - Envie o ícone `300×300` (`docs/store/logo-300.png`) e as capturas `1280×800` (`docs/store/shot-*.png`).
7. Em **Submit your extension**, cole o texto de **Notes for reviewers** acima e clique em **Publish**.
