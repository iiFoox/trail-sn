# Ficha de preenchimento das lojas (Trail 1.4.6)

Tudo pronto para copiar e colar, campo por campo. Os textos estão em texto puro, porque as lojas não aceitam markdown.
Arquivos: pacote de loja `packages/trail-chrome-1.4.6.zip` (serve para Chrome e Edge); pacote da pasta carregada manualmente `packages/trail-extensao-1.4.6.zip`; imagens nesta pasta (`docs/store/`).

| Campo | Arquivo | Tamanho | Chrome | Edge |
|---|---|---|---|---|
| Pacote da loja | `packages/trail-chrome-1.4.6.zip` | 282.183 bytes | obrigatório | obrigatório |
| Pasta empacotada para instalação manual | `packages/trail-extensao-1.4.6.zip` | 284.859 bytes | não enviar | não enviar |
| Logo da loja | `logo-300.png` | 300×300 | — (usa o ícone do pacote) | obrigatório |
| Capturas de tela | `shot-1-resposta.png` … `shot-5-flows.png` | 1280×800 | 1 a 5 | 1 a 6 |
| Bloco promocional pequeno | `tile-440x280.png` | 440×280 | obrigatório | opcional |

O nome localizado (`Trail — Perícia de registros ServiceNow` / `Trail — ServiceNow Record Forensics`) e a descrição curta vêm do próprio pacote no Chrome. No Edge, use os campos abaixo.

## Notas da versão 1.4.6
PT: Mais seguro e mais leve em instâncias de produção: o Trail confere antes o que o seu perfil pode filtrar e não deixa mensagens de acesso na sua sessão; faz no máximo 2 consultas por vez; ao clicar em outro campo, a investigação anterior para na hora; e lê só os script includes que as regras chamam (muito menos dados em instâncias grandes). Usa o histórico do formulário quando a auditoria não responde, identifica importações com mais precisão e se recupera melhor de instâncias instáveis: quando parte da instância não responde, o painel avisa que o resultado pode estar incompleto. Nova aba Versões: as versões salvas de scripts e regras, com o que mudou em cada uma. Reconhece a regra do registro pai que gravou no filho, regras e client scripts desligados depois da mudança e textos longos salvos pelo formulário; no Rastro, a causa vem primeiro. O "E se?" passou para o modo avançado.

EN: Safer and lighter on production instances: Trail checks first what your user may filter, so it leaves no access messages in your session; it makes at most 2 requests at a time; clicking another field stops the previous investigation right away; and it reads only the script includes your rules call (far less data on large instances). It uses the form history when the audit log does not answer, detects imports more accurately and recovers better from unstable instances: when part of the instance does not answer, the panel says the result may be incomplete. New Versions tab: the saved versions of scripts and rules, with what changed in each one. Recognizes a parent record's rule writing to the child, rules and client scripts turned off after the change and long texts saved from the form; in the Trace, the cause comes first. "What if?" moved to advanced mode.

## Descrição curta (Edge pede; até 132 caracteres)
PT: Descubra o que mudou qualquer campo do ServiceNow e por quê. Funciona sem admin, sem instalar nada nem criar papel. Só leitura.
EN: Find out what changed any ServiceNow field and why. Works without admin, nothing to install, no new role needed. Read-only.

## Descrição longa (PT)
```
Um campo de um incidente, mudança ou tarefa apareceu com outro valor e ninguém sabe se foi uma pessoa, uma integração, uma regra de negócio, um script, um job agendado ou um flow. O Trail responde: o que mudou este campo, quando e por quê.

FUNCIONA SEM SER ADMIN
O Trail usa o que o seu próprio login já vê na instância. Não instala nada no ServiceNow e não cria papel nenhum. Quando a auditoria completa é restrita para o seu perfil, ele usa o histórico que você já enxerga no formulário e diz, em palavras simples, o que os seus papéis deixam ver.

PRINCIPAIS RECURSOS
• Ícone ao lado de cada campo: um clique mostra quem mudou, quando, de qual valor para qual, com os rótulos do formulário e o grau de certeza (alta, média ou baixa), mais um resumo pronto para colar no chamado.
• Provas verificáveis: os fatos que sustentam a conclusão, por que as outras hipóteses foram descartadas e alertas de regras em conflito.
• Rastro segundo a segundo: salvamento do formulário, regras de negócio, eventos, flows e jobs na janela da alteração.
• Aba Flows: os flows que rodaram no registro (com subflows logo abaixo do flow pai) e os flows configurados para a tabela, com o gatilho em palavras e os campos que gravam.
• O que roda neste registro: regras de negócio em ordem de execução, script includes, client scripts, UI policies, botões e jobs, com busca e o filtro "Só o que rodou aqui".
• Tudo que mudou: alterações agrupadas por momento de salvamento, investigação do registro inteiro ou de colunas pela lista, com exportação em CSV, texto ou PDF.
• Versões de scripts e regras: quem salvou, quando, de qual update set e o que mudou em cada uma. Comparar dois momentos do registro.
• Bolinha-assistente que pode ser arrastada para qualquer lugar e painel flutuante redimensionável, com modo Sempre visível, tema claro ou escuro, atalho configurável (Alt+Shift+P) e painel lateral do navegador.
• Acompanha a navegação: ao trocar de registro, o painel se atualiza sozinho.

PRIVACIDADE E SEGURANÇA
• Somente leitura: só faz consultas GET. Não cria, não altera e não apaga nada na instância.
• Respeita as ACLs: usa a sua sessão e nunca vê além do que o ServiceNow permite ao seu usuário.
• Sem telemetria e sem servidores de terceiros: as consultas vão direto do navegador para a sua instância.
• Permissão por instância: você autoriza só as instâncias que quiser conectar.

Política de privacidade: https://trail-sn.vercel.app/privacidade/
```

## Long description (EN)
```
A field on an incident, change or task suddenly shows a different value and nobody knows whether it was a person, an integration, a business rule, a script, a scheduled job or a flow. Trail answers: what changed this field, when and why.

WORKS WITHOUT ADMIN
Trail uses what your own login already sees on the instance. Nothing is installed on ServiceNow and no role is created. When full audit access is restricted for your user, it uses the form history you already see and tells you, in plain words, what your roles let it see.

KEY FEATURES
• Icon next to every field: one click shows who changed it, when, from which value to which, with the form's own labels and a certainty level (high, medium or low), plus a summary ready to paste into the ticket.
• Verifiable proof: the facts behind the conclusion, why other causes were ruled out and warnings about conflicting rules.
• Second-by-second trace: form save, business rules, events, flows and jobs around the change.
• Flows tab: flows that ran on the record (subflows shown under their parent flow) and flows configured for the table, with the trigger in plain words and the fields they write.
• What runs on this record: business rules in execution order, script includes, client scripts, UI policies, buttons and jobs, with search and a "Only what ran here" filter.
• Everything that changed: changes grouped by save, whole-record or column investigation from lists, export to CSV, text or PDF.
• Versions of scripts and rules: who saved, when, from which update set and what changed in each one. Compare two moments of the record.
• Draggable assistant bubble and resizable floating panel, with Always on top mode, light or dark theme, configurable shortcut (Alt+Shift+P) and the browser side panel.
• Follows navigation: when you open another record, the panel updates by itself.

PRIVACY AND SECURITY
• Read-only: GET requests only. It never creates, changes or deletes anything on the instance.
• ACL-bound: uses your session and never sees beyond what ServiceNow allows your user.
• No telemetry, no third-party servers: queries go straight from the browser to your instance.
• Per-instance permission: you authorize only the instances you choose to connect.

Privacy policy: https://trail-sn.vercel.app/privacidade/
```

## Chrome: aba "Listagem da loja"
- Categoria: Ferramentas para desenvolvedores (Developer Tools)
- Idioma: Português (Brasil)
- Site oficial / página inicial: https://trail-sn.vercel.app/b3/
- URL de suporte: https://github.com/iiFoox/trail-sn/issues
- Vídeo do YouTube: deixar em branco

## Chrome: aba "Práticas de privacidade"
Finalidade única:
```
Investigar alterações em registros do ServiceNow: mostrar o que mudou um campo, quando e por quê, lendo a auditoria, o histórico e as automações da instância com a sessão do próprio usuário. Somente leitura.
```
Justificativas das permissões:
- storage:
```
Guarda as preferências do usuário (tema, idioma, atalho, modo do painel, posição da bolinha), a lista de instâncias que ele conectou e o estado da investigação de cada aba.
```
- sidePanel:
```
Mostra o painel do Trail no painel lateral do navegador quando o usuário escolhe esse modo.
```
- activeTab:
```
Lê o contexto do registro do ServiceNow aberto na aba atual (tabela e sys_id) quando o usuário clica no ícone da extensão.
```
- scripting:
```
Insere os ícones ao lado dos campos, a bolinha-assistente e o painel flutuante nas abas das instâncias que o usuário conectou.
```
- contextMenus:
```
Adiciona a entrada "Trail" ao menu de clique direito da página e atalhos no menu do ícone da extensão (abrir painel flutuante, lateral ou janela, mostrar/ocultar ícones, opções).
```
- Permissão de host:
```
Pedida só quando o usuário clica em "Conectar esta instância", e apenas para a instância ServiceNow dele (ex.: https://empresa.service-now.com). Serve para consultar, com a sessão do próprio usuário e só por GET, o registro, a auditoria e as automações. Nada é pedido na instalação.
```
Código remoto: **Não, não estou usando código remoto.**

Uso de dados (marcar):
- [x] Informações de identificação pessoal (nomes de usuários que aparecem nos registros do ServiceNow)
- [x] Informações de autenticação (o token da sessão do ServiceNow, usado só para consultar a própria instância)
- [x] Conteúdo do site (os registros e o histórico lidos da instância)
- [ ] todas as outras

Certificações (marcar as três):
- [x] Não vendo nem transfiro dados a terceiros fora dos casos de uso aprovados
- [x] Não uso nem transfiro dados para finalidades não relacionadas à função principal
- [x] Não uso nem transfiro dados para determinar crédito ou conceder empréstimos

URL da política de privacidade: https://trail-sn.vercel.app/privacidade/

## Chrome: aba "Distribuição"
- Pagamento: Gratuito
- Visibilidade: Público
- Regiões: Todas

## Chrome: instruções de teste para o revisor (se pedir)
```
Trail needs a ServiceNow instance to run live. To review without one:
1) Interactive demo of the full UI (same code, demo data): https://trail-sn.vercel.app/b3/
2) After installing, open chrome-extension://<extension-id>/src/sidepanel/index.html?demo=1 to see the panel with demo data.
A free ServiceNow developer instance can be requested at https://developer.servicenow.com. Open any incident, click the extension icon, choose "Connect this instance", then click the Trail icon next to any field.
The extension is read-only: it only sends GET requests to the instance the user connects.
```

## Edge: Partner Center
- Availability: Public, todos os mercados
- Properties:
  - Category: Developer tools
  - Privacy policy URL: https://trail-sn.vercel.app/privacidade/
  - Website: https://trail-sn.vercel.app/b3/
  - Support: https://github.com/iiFoox/trail-sn/issues
  - Mature content: Não
  - "Does your extension access, collect, or transmit personal information?": Sim
- Store listings: adicionar Portuguese (Brazil) e English. Em cada um: descrição longa (acima), descrição curta (acima), logo `logo-300.png`, as 5 capturas e, opcionalmente, o tile `tile-440x280.png`. Search terms: ServiceNow, audit, forensics, business rule, flow designer
- Notes for certification: o mesmo texto das instruções de teste acima.
