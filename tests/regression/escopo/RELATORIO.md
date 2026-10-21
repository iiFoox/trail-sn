# Relatório de regressão: aplicações escopadas

Data da execução: 21/10/2026 (PDI `dev457034.service-now.com`, sessão autenticada já aberta no portal Maestri). Nesta continuação não alterei código de produção; a correção de ordenação em `investigate.ts` e seu teste em `history.test.ts` foram mantidos por Claude Code #2 e incluídos no bundle atualizado que rodei no PDI. Nenhuma senha foi digitada. Os objetos com prefixo `[PT]` e registros criados durante a bateria são os únicos artefatos usados; tabelas/registros preexistentes foram preservados. As regras de teste criadas foram desativadas quando não eram necessárias para a prova, e o script de regra C usado no teste final foi restaurado.

## Resumo de execução

O arquivo [`cases-escopo.json`](./cases-escopo.json) contém 300 registros de teste concretos (100 por app A/B/C). O motor foi executado sobre os mesmos 300 casos em dez perfis, totalizando **3.000 investigações**, todos com o bundle atualizado para desempatar auditoria por `record_checkpoint`. Admin: 300/300 sem erro e causa/tipo esperados presentes em 300/300, inclusive B-BR-001 e C-BR-001 após o desempate. Os seis perfis com papéis de app leram os 100 registros do próprio escopo por perfil e tiveram 200/300 registros de outros escopos recusados. Nos 600 registros legíveis, `sys_audit` foi negada e o motor usou o histórico do formulário; `priority` estava nos campos do Activity Stream. Como `sys_script` também ficou negada, a evidência apresentada foi `user_action`/`candidate` (autor admin), sem atribuir falsamente a BR. Os três perfis de controle sem papel/delegação real tiveram 300/300 respostas `Record not found or not readable` (900 tentativas), sem erro técnico.

Os 300 casos do arquivo são todos focados na regra before de prioridade, em registros distintos de cada tabela. As outras fontes (cross-scope, include, evento, job, UI action, UI policy e client script) foram sondadas em registros identificados abaixo, mas não fazem parte dos 300 casos fixos executados nos dez perfis. Isso limita a cobertura por tipo de automação: a quantidade atende ao volume pedido, porém o corpus não representa 300 causas diferentes.

| Perfil executado | Casos | Legíveis / sem erro | Histórico fallback | Mediana | P95 | Máximo | Resultado |
|---|---:|---:|---:|---:|---:|---:|---|
| Admin | 300 | 300 / 300 identificações esperadas | 0 (sys_audit liberada) | 3.516 ms | 4.836 ms | 6.721 ms | Acesso completo |
| Admin do app A | 300 | 100 / 300 | 100 / 100 legíveis | 678 ms | 2.967 ms | 5.327 ms | 100 A lidos; 200 B/C sem leitura |
| Usuário do app A | 300 | 100 / 300 | 100 / 100 legíveis | 673 ms | 3.405 ms | 5.760 ms | 100 A lidos; 200 B/C sem leitura |
| Developer pretendido (conta sem delegação/papel) | 300 | 0 / 300 | 0 | 665 ms | 699 ms | 1.432 ms | 300 sem leitura; não é delegated developer real |
| Admin do app B | 300 | 100 / 300 | 100 / 100 legíveis | 673 ms | 3.729 ms | 4.938 ms | 100 B lidos; 200 A/C sem leitura |
| Usuário do app B | 300 | 100 / 300 | 100 / 100 legíveis | 692 ms | 3.281 ms | 5.176 ms | 100 B lidos; 200 A/C sem leitura |
| Admin do app C | 300 | 100 / 300 | 100 / 100 legíveis | 668 ms | 3.664 ms | 4.457 ms | 100 C lidos; 200 A/B sem leitura |
| Usuário do app C | 300 | 100 / 300 | 100 / 100 legíveis | 671 ms | 3.712 ms | 4.490 ms | 100 C lidos; 200 A/B sem leitura |
| `pt.trail.itil` | 300 | 0 / 300 | 0 | 751 ms | 1.020 ms | 1.504 ms | 300 sem leitura |
| Sem papel | 300 | 0 / 300 | 0 | 664 ms | 721 ms | 2.199 ms | 300 sem leitura |

Os resultados brutos estão em [`results/`](./results/), um JSON por perfil, gerados novamente após recompilar o bundle de regressão com o código atualizado. Foram 900 execuções legíveis sem erro (300 admin + 600 dentro do escopo de cada papel) e 2.100 recusas de leitura controladas. Os tempos são do `runDifferential` no navegador do portal; todos ficaram abaixo de 10 segundos por investigação, inclusive o máximo do admin.

## Aplicativos e objetos de teste

| App | `sys_app` | Escopo | Tabelas de teste |
|---|---|---|---|
| `[PT] Trail Escopo A` (preexistente) | `3def6f75c3cc17101cbdb8e1b40131cf` | `x_2270630_pttrail_` | Tabelas preexistentes `x_2270630_pttrail__pedido` (`7100fbb5c3cc17101cbdb8e1b4013104`) e `x_2270630_pttrail__item`; não alterei essas tabelas. Criei `x_2270630_pttrail__pedido_audit` (`74c673f5c30057101cbdb8e1b4013156`), filha de Pedido, para habilitar auditoria sem mudar a tabela original. |
| `[PT] Trail Escopo B` | `b021f379c3cc17101cbdb8e1b401316a` | `x_2270630_pttrailb` | `x_2270630_pttrailb_pedido` (`b731f379c3cc17101cbdb8e1b4013173`, estende `task`); `x_2270630_pttrailb_item` (`0c413f39c3cc17101cbdb8e1b4013148`, tabela solta). |
| `[PT] Trail Escopo C` | `c921f379c3cc17101cbdb8e1b401316e` | `x_2270630_pttrailc` | `x_2270630_pttrailc_pedido` (`4341f779c3cc17101cbdb8e1b4013116`, estende `task`); `x_2270630_pttrailc_item` (`5f413b79c3cc17101cbdb8e1b40131a5`, tabela solta); `x_2270630_pttrailc_pedido_b` (`57413b79c3cc17101cbdb8e1b40131f4`, estende a tabela Pedido de B). |

Foram criados campos de teste `[PT]` com rótulos conferidos em `sys_documentation` e escolhas Hardware/Software/Acesso. A auditoria foi ligada apenas nas tabelas novas B/C e na filha auditável de A. A tabela original A e o Item original A não foram alterados para habilitar auditoria.

## Automação e provas realizadas

### Regras, includes e acesso entre escopos

- **A before:** `[PT] BR A hardware priority` (`02e1b3b9c3cc17101cbdb8e1b40131ad`) definiu priority 2 em Hardware. O corpus final cobre 100 registros A; a evidência da regra aparece com grau `provável`.
- **A after:** `[PT] BR A after aprova` (`83e2fb3dc3cc17101cbdb8e1b401312d`) foi testada, mas na sonda da tabela filha não preencheu `u_aprovador` após `u_valor > 1000`. Não atribuo uma causa definitiva; a regra grava via tabela pai e a observação na filha não confirmou o efeito.
- **A async:** `[PT] BR A async data limite` (`5be2ff3dc3cc17101cbdb8e1b401317d`): ao mudar `state` para resolvido e aguardar, `u_data_limite` continuou vazio. O PDI normalizou o tipo para `async_always`. A tentativa não confirmou o efeito esperado.
- **Include de A chamado por regra em A:** `PTTrailScopeHelper` (`87e2fb3dc3cc17101cbdb8e1b4013125`, API `x_2270630_pttrail_.PTTrailScopeHelper`) foi chamado pela `[PT] BR A include descricao` (`1be2ff3dc3cc17101cbdb8e1b4013187`). No registro `TASK0020712`, a descrição mudou para `[PT] Script Include A` e foi auditada.
- **B escreve tabela A:** `[PT] BR B escreve tabela A` (`7b23ff3dc3cc17101cbdb8e1b40131d4`) não alterou `u_valor` na sonda isolada (`TASK0020703`) mesmo com o privilégio B→A de escrita `468ffbb5c38057101cbdb8e1b40131ab` em `allowed`. O resultado observado foi categoria atualizada e `u_valor` ainda 700. Não foi encontrado erro de runtime conclusivo; a chamada cross-scope permanece não confirmada.
- **C chama include A:** a primeira versão da regra C falhou com `RhinoEcmaError: "PTTrailScopeHelper" is not defined`; corrigida para usar o nome qualificado `x_2270630_pttrail_.PTTrailScopeHelper`. Com privilégio C→A de execução e escrita permitidos, `TASK0020717` mudou a descrição para `[PT] Script Include A`.
- **C sem privilégio explícito:** um segundo include público de A, `PTTrailScopeHelperSemPrivilege`, também foi chamado de C sem linha explícita de cross-scope privilege; `TASK0020719` recebeu `[PT] Include sem privilégio executado`.
- **C com privilégio negado antes da primeira chamada:** prova adicional isolada: include público `PTTrailScopeHelperDeniedFresh` (`x_2270630_pttrail_.PTTrailScopeHelperDeniedFresh`), privilégio C→A `execute` criado com status `denied` antes de invocar a regra. Ainda assim `TASK0020720` recebeu short description `[PT] Include negado bloqueado`; a API não retornou erro e syslog não mostrou mensagem para a regra. O script da BR C foi restaurado para o include normal após a sonda. O resultado sugere que o bloqueio não foi aplicado nessa combinação de include público/BR, mas não prova que a configuração de privilégio foi ignorada em todas as situações.
- **Regra global escreve tabela escopada:** `[PT] BR global escreve pedido A` (`d033373dc3cc17101cbdb8e1b40131ee`) foi isolada; valor 333 apareceu na tabela escopada (ex.: `TASK0020704`).
- **Regra A escreve incidente global:** `[PT] BR A escreve incidente global` (`4833f77dc3cc17101cbdb8e1b40131fc`) criou/alterou `INC0010176` (`8420c04ac38057101cbdb8e1b401313f`), com urgency 1.

### Eventos, jobs, UI e tabelas

- **Eventos e Script Actions A/B/C:** foram criados eventos `[PT] escopo.a.pedido.changed`, `[PT] escopo.b.pedido.changed` e `[PT] escopo.c.pedido.changed`, BRs que os disparam e Script Actions de cada app. As filas A/B/C registraram eventos processados; exemplos B `TASK0020715` e C `TASK0020716`. A Script Action B/C foi identificada pelo motor como `script_action`, grau confirmado, nota 85. Em alguns registros a BR disparou duas entradas (insert e update), com valor final idempotente.
- **Jobs agendados:** jobs `[PT] Job estoque A/B/C` (`sysauto_script`) foram executados uma vez e desativados depois. B/C mudaram estoque 20→99 em `sys_audit`; o Trail identificou as duas como `scheduled_job`, confirmado, nota 70. O item original A não tinha auditoria e não foi alterado para habilitá-la.
- **UI Actions:** foram criadas `[PT] UI Action categoria A/B/C`; os botões apareceram e foram acionados em formulários próprios. A ação A mudou categoria e chamou o include; B/C também foram exercitadas.
- **UI Policies e Client Scripts:** criados nos três escopos. Em B/C, a escolha Acesso acionou o script cliente e definiu `u_valor=808`; a UI Policy tornou o campo obrigatório (`isMandatory=true`/`aria-required=true`).
- **Escolhas e rótulos:** as opções Hardware/Software/Acesso foram exibidas e convertidas para os valores `1/2/3`; B/C mostraram rótulos `[PT] Categoria` e `[PT] Valor`. O layout inserido para A child não exibiu os campos no formulário, apesar de `sys_ui_section` e `sys_ui_element` retornarem sucesso. Não alterei layout preexistente da tabela A.

### Flow Designer e workflow legado

Flow Designer não permitiu montar os flows/subflows escopados solicitados. `/now/flow-designer` retornou Page not found, `/sys_hub_flow_list.do` retornou 500, e a rota de edição de flow existente também retornou 500 em `/now/workflow-studio/builder`. Não criei registros incompletos para simular flows. Não foram encontrados flows ou workflows legados escopados a A/B/C; `wf_context` `[PT]` estava vazio. Já havia flows globais `[PT]` e contexts concluídos na instância (`[PT] C6 flow altera notificacao`, `[PT] F7 flow varios campos`, `[PT] F14 flow chama subflow`, `[PT] F14 subflow descricao`), mas são preexistentes e não foram modificados. Assim, criação/atualização/agendamento de flows, subflow cross-scope, Update Record, ação de script e flow com falha ficaram **fora da execução**.

**Rechecagem em 21/10/2026, após a bateria:** `/sys_hub_flow_list.do` agora abre a lista clássica (200, 373 registros); `/now/workflow-studio/home/flow` abre a lista de flows, e o editor de `[PT] F14 flow chama subflow` abre com gatilho, subflow e ação Update Record. O endereço antigo `/now/flow-designer` ainda mostra “Page not found”. Os botões “New” e “Create” do Workflow Studio não apresentaram formulário ou menu no portal nesta tentativa. Não se pode mais descrever o editor inteiro como indisponível; a criação dos flows A/B/C e sua execução continuam sem teste. Nenhum flow foi criado ou alterado nessa rechecagem.

## Perfis e ACLs

Foram criadas contas sem senha: `pt.trail.escopo.user`, `pt.trail.escopo.admin`, `pt.trail.escopo.userb`, `pt.trail.escopo.adminb`, `pt.trail.escopo.userc`, `pt.trail.escopo.adminc`, `pt.trail.escopo.dev` e `pt.trail.escopo.sem_papel`; também foi usado o perfil existente `pt.trail.itil` e o admin.

As tentativas de criar 20 ACLs customizadas retornaram 403 em `sys_security_acl`. Porém, as seis associações de papel de app estavam de fato gravadas: consultei `sys_user_has_role` por usuário e papel (200, uma linha por associação), e os perfis A/B/C leram os 100 registros do próprio app. O `PUT /api/now/ui/concoursepicker/application` para entrar no app retornou 403 para usuário A, mas isso não impediu a leitura direta dos registros permitidos. Não foi necessário elevar `security_admin`: os papéis e associações já existiam e nenhuma nova role foi criada nesta continuação.

Nas 600 investigações legíveis dos seis perfis com papel, `sys_audit` e `sys_script` foram negadas. O endpoint `angular.do?sysparm_type=list_history` forneceu as mudanças, com `auditFrom: history`; o campo `priority` estava em `historyFields`. O Trail apresentou `user_action` de grau `candidate` com o autor `admin`, sem atribuir o nome da BR que o perfil não podia consultar. Uma sonda adicional em `u_valor` retornou `auditFrom: history`, `fieldNotInHistory: true` e zero mudanças, sem erro técnico (detalhe em `probe-campo-fora-historico.json`). Os 200 registros de outros escopos por perfil e os controles sem papel retornaram `Record not found or not readable`.

O PDI não expôs `sys_user_delegated_developer` em `sys_db_object`; a conta `pt.trail.escopo.dev` foi criada sem papel e sem associação de developer delegado. Seu resultado não deve ser interpretado como teste de delegated developer.

**Rechecagem em 21/10/2026:** a documentação atual do ServiceNow orienta atribuir desenvolvimento delegado pelo link “Manage Developers” ou “Manage Collaborators” no registro do aplicativo, e não por uma tabela presumida. O app A apresenta “Manage Collaborators”; com o app A selecionado, a busca localizou a conta de teste pelo nome de exibição `[PT] Escopo dev` (a busca pelo `user_name` não encontrou resultado). O modal mostrou o descritor “Editor”. O teclado não concluiu a seleção; o clique no resultado fechou o modal sem habilitar “Send”. Ao reabrir, seguia “No collaborators have been added yet”. Nenhuma associação foi enviada ou salva. O teste de desenvolvedor delegado permanece pendente; a conta não deve ser tratada como delegada nas 3.000 investigações anteriores.

## Achados por critério E1–E8

| Critério | Resultado |
|---|---|
| **E1 Admin** | 300/300 registros legíveis e investigações sem erro; tipo e nome esperados presentes em 300/300. Após recompilar com a correção, `B-BR-001` e `C-BR-001` agora mostram a BR como primeira evidência (4→2), seguida da ação administrativa (2→4), usando `record_checkpoint` para desempatar o mesmo timestamp. |
| **E2 Automação escopada/cross-scope** | BR A e Script Action B/C foram identificadas em sondas. A chamada B→A não foi confirmada. C→A funcionou com privilégio allowed e também nas duas sondas sem privilégio explícito/privilege denied. Global→A e A→Incident global funcionaram. A after/async não produziram o campo esperado nas sondas. |
| **E3 Rótulos `u_*`** | Choice values converteram corretamente; documentação B/C apareceu nos formulários. A tabela filha auditável não exibiu o layout custom no formulário, embora os registros de layout tenham sido aceitos. |
| **E4 Papel do app / histórico** | Avaliado para seis perfis. Cada usuário/admin A/B/C leu 100/100 registros do próprio app; `sys_audit` negada foi substituída pelo histórico do formulário em 600/600 casos legíveis, e `priority` constava em `historyFields`. A sonda de `u_valor` produziu `fieldNotInHistory: true`, zero mudanças e nenhum erro técnico. Como `sys_script` estava negada, a causa apareceu como `user_action`/`candidate`, sem nomear a BR. Os 200 registros fora do app ficaram sem leitura para cada perfil. |
| **E5 Delegated developer** | Não avaliável: tabela/associação de delegated developer indisponível ao usuário da sessão; a conta de teste ficou sem papel. |
| **E6 Sem acesso ao app** | `pt.trail.itil` e usuário sem papel tiveram 300/300 respostas “Record not found or not readable”, sem erro técnico. |
| **E7 Sem evidência inventada** | Os 2.100 casos fora do acesso do perfil terminaram como não legíveis. Nas 600 leituras permitidas, o motor mostrou apenas o autor como candidato quando os metadados `sys_script` estavam negados; não inventou o nome/causa da BR. O acesso parcial e as fontes negadas estão nos resultados por perfil. |
| **E8 Tempo** | Admin: mediana 3,516 s; p95 4,836 s; máximo 6,721 s. Máximo dos seis perfis com papel de app: 5,760 s. Máximo geral: 6,721 s, abaixo de 10 s. |

## Sessão final e artefatos

Após a execução final, confirmei `GET /api/now/ui/user/current_user` como `admin` (`6816f79cc0a8016401c5a33be04be441`) e `GET /api/now/ui/concoursepicker/current` como aplicativo `Global` (`sysId: global`).

- Cenários: [`cases-escopo.json`](./cases-escopo.json), 300 registros conhecidos, 100 por escopo A/B/C.
- Resultados das 3.000 investigações: [`results/`](./results/).
- Provas pontuais de automação/cross-scope/eventos/jobs/layout e do campo fora do Activity Stream: arquivos `probe-*.json`, `probes-motor.json`, `eventos-bc.json`, `jobs-reagendados.json`, `layouts.json` e `probe-campo-fora-historico.json` nesta pasta.
- Nenhum commit foi feito. Recompilei `tests/regression/browser/dist/regression.js` com Vite programático e usei esse bundle atualizado no PDI. A tentativa de rodar Vitest local falhou ao carregar `vitest.config.ts` porque o sandbox negou a leitura do diretório `../../../..`; não alterei o arquivo de configuração. A validação unitária anterior do teste novo foi reportada por Claude Code #2.
