# Publicação na loja do Edge (Microsoft Edge Add-ons) como extensão oculta

Status: material pronto. A submissão é feita por você, logado no Partner Center, porque exige aceitar o
contrato de desenvolvedor da Microsoft e enviar o formulário em nome da sua conta.

## O que "oculta" significa no Edge

No Partner Center, em **Availability → Visibility**, escolha **Hidden**. A extensão não aparece na
busca nem nas listas da loja; só quem tem o link direto instala. Ela passa pela mesma revisão de uma
extensão pública e recebe **atualização automática**: cada nova versão aprovada chega sozinha a todos
que instalaram, sem baixar zip nem ativar modo de desenvolvedor.

## Passo a passo (uma vez)

1. Entrar em https://partner.microsoft.com/dashboard/microsoftedge/overview com a conta Microsoft que
   vai ser a dona da extensão e concluir o cadastro de desenvolvedor (gratuito).
2. **Create new extension** → enviar `trail-edge-<versão>.zip` (o mesmo zip que eu mando aqui).
3. **Availability**: Visibility = *Hidden*; Markets = todos (ou só Brasil).
4. **Properties**: categoria *Developer tools*; site `https://trail-site-lime.vercel.app/b3/`;
   política de privacidade `https://trail-site-lime.vercel.app/privacidade/`; e-mail de suporte.
5. **Store listing** (Português do Brasil e Inglês): textos abaixo, ícone 300×300
   (`docs/store/logo-300.png`) e as capturas 1280×800 (`docs/store/shot-*.png`).
6. **Submit**. A revisão costuma levar de 3 a 7 dias úteis. Depois de aprovada, copie o link da
   página da extensão e compartilhe com quem deve instalar.

## Atualizações

Subir a versão em `manifest.json` (ex.: 0.8.0 → 0.8.1), gerar o zip e, no Partner Center,
**Update** → enviar o zip novo → **Publish**. Quem já instalou recebe a nova versão em algumas horas.

## Textos da página

### Nome
Trail

### Descrição curta (até 132 caracteres)
PT: Descubra o que mudou um campo no ServiceNow: qual regra, flow, job ou pessoa, quando e com que prova. Só leitura.
EN: Find out what changed a field in ServiceNow: which rule, flow, job or person, when, and with what evidence. Read-only.

### Descrição longa (PT)
O Trail responde a pergunta que todo administrador de ServiceNow faz: "quem mudou este campo, e por quê?".

Clique no ícone ao lado de qualquer campo do formulário e o Trail cruza a auditoria do registro com os
rastros de execução da instância (transações, eventos, contextos de flow e workflow, jobs) e com as
regras que gravam aquele campo (business rules, client scripts, UI actions, flows, data lookups,
regras de atribuição, importações). O resultado é uma resposta com grau de certeza e as provas que
sustentam a conclusão.

- Veredito em uma linha, com a regra ou pessoa responsável e o link para abrir no ServiceNow.
- Provas verificáveis e o motivo de cada candidato descartado.
- Rastro do que rodou em volta da mudança, segundo a segundo.
- Linha do tempo do registro, com filtro por pessoa, API e automação, e comparação entre duas gravações.
- Alerta de regras em conflito que gravam o mesmo campo com valores diferentes.
- Frase sem termos técnicos para colar no chamado.
- Relatório em PDF e diferença lado a lado para textos e scripts.

Somente leitura: o Trail usa a sua própria sessão e só faz consultas GET na API de tabelas. Não grava,
não executa scripts na instância e não envia dados para nenhum servidor externo.

### Long description (EN)
Trail answers the question every ServiceNow admin asks: "who changed this field, and why?".

Click the icon next to any form field and Trail cross-checks the record's audit with the instance's
execution traces (transactions, events, flow and workflow contexts, jobs) and with the rules that write
that field (business rules, client scripts, UI actions, flows, data lookups, assignment rules, imports).
You get an answer with a certainty grade and the evidence behind it.

- One-line verdict with the responsible rule or person and a link to open it in ServiceNow.
- Verifiable evidence and why each other candidate was discarded.
- What ran around the change, second by second.
- Record timeline with people / API / automation filters and a compare-two-saves view.
- Warning for conflicting rules that write the same field with different values.
- A plain-language sentence to paste in the ticket.
- PDF report and side-by-side diff for texts and scripts.

Read-only: Trail uses your own session and only issues GET requests to the Table API. It never writes,
never runs scripts on the instance and never sends data to any external server.

## Justificativa das permissões (campo "Notes for certification")

- `storage`: preferências (idioma, tema, atalhos) e cache dos metadados da tabela.
- `sidePanel`: o resultado aparece no painel lateral do navegador.
- `activeTab` e `scripting`: inserir o ícone ao lado dos campos só na aba da instância que o usuário
  autorizou.
- `contextMenus`: item "Trail" no clique direito da página, que abre o painel.
- `optional_host_permissions` (`https://*.service-now.com/*` e `https://*/*` para domínios próprios):
  pedidas em tempo de uso, por instância, quando o usuário conecta o Trail a ela. Sem isso a extensão
  não acessa nenhum site.
- `web_accessible_resources`: a página da diferença lado a lado abre num iframe dentro da instância.

Para testar: qualquer instância de desenvolvedor gratuita (developer.servicenow.com). Abrir um
incidente, clicar no ícone ao lado de "State" e ver a resposta no painel.

## Privacidade (resumo para o formulário)

- Não coleta dados pessoais nem de uso.
- Não há servidor do Trail: tudo roda no navegador, com a sessão do usuário na instância dele.
- Dados lidos da instância ficam na memória do navegador e, por pouco tempo, no armazenamento local
  da extensão (cache de metadados). Nada é vendido, compartilhado ou transferido.
