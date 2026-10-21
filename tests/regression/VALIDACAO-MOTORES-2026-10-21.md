# Validação dos motores novos no PDI (21/10/2026)

Rodada do agente de QA no PDI de testes. Ele usou o bundle de regressão (`tests/regression/browser/entry.ts`, agora com
`fieldState`, `fieldStates`, `fieldRules`, `fieldDeps`, `simulateValue`, `saveTiming`, `recordSaveTimes`,
`timingFields`, `visibility`, `readQueryScript`, `compareInstances` e `probe`), numa aba logada como admin e personificando
`pt.trail.itil`, `pt.trail.escopo.user` e `pt.trail.escopo.admin`. O bundle foi injetado em partes (gzip + base64,
conferido por SHA-256) e roda o motor do commit `dbbf88a`, de antes das correções abaixo. As correções têm testes
unitários que usam os formatos reais vistos no PDI.

Os números estão em `tests/regression/results/validacao-motores-2026-10-21.json` (fora do git).

## Itens [PT] criados ou alterados no PDI

- Incidente `[PT] VAL-FS1 Estado do campo` (INC0010187). Foi salvo uma vez pelo formulário para gerar a transação, com
  `contact_type=email` e caller = admin.
- Três UI policies `[PT] VAL-FS A/B/R` restritas a esse registro, **desativadas no fim**: A (ordem 100) bloqueia, obriga
  e esconde por script; B (ordem 200) libera `impact`; R (ordem 300, condição falsa, reversa) libera `contact_type`.
- Sete `sys_ui_policy_action` `[PT]` ficaram sem `ui_policy`. Nem a Table API nem o formulário gravaram a referência
  (ver "Achados do PDI"). Elas são órfãs e não têm efeito. Não foram apagadas.
- O `localStorage` da origem do PDI usado pelo bundle foi limpo.

## 1. fieldState: "Por que este campo está bloqueado, obrigatório ou escondido?"

**O que confere**
- `sys_data_policy_rule` usa `disabled` (string true/false/ignore). `read_only` não existe nessa tabela.
- `sys_ui_policy_action` aceita `ui_policy.table` e `ui_policy.active` na consulta: 39 de 5285 linhas.
- `sys_data_policy_rule` aceita `sys_data_policy.model_table`: 4 de 319.
- Os campos de `sys_dictionary_override` existem e são boolean (`read_only_override`, `read_only`, `mandatory_override`,
  `mandatory`).
- Ações de UI policy OOB lidas certo: `hold_reason` escondido pela reversa "When state is On Hold…" e `route_reason`
  (dicionário somente leitura e escondido pela reversa).
- Com as policies [PT] (por script), o resultado bate com o formulário. A trava de A em `impact` perde para B (ordem
  maior vence, `overriddenBy`). A trava de A em `contact_type` perde para R (`cond_false_reverse`). `subcategory` deixa
  de ser obrigatório pela reversa. `cmdb_ci` (referência, `sys_display`) e `description` aparecem bloqueados. `category`
  some por `setDisplay(false)` e `business_service` por `setVisible(false)`.
- A listagem do formulário (`formStates`) inclui os campos escondidos.

**O que não confere**
- **[corrigido] `page/main.ts`: todos os campos davam somente leitura no UI16.** O `g_form.isReadOnly` do UI16 é
  `function(ge, control) { if (!control) return true; … }`. Chamado só com o nome do campo, devolvia true para
  **29 de 29** campos.
- **[proposto] `^OR` não é avaliado** (`packages/core/src/util.ts:77`). A policy OOB "Make fields read-only on close"
  (`incident_state=7^ORincident_state=8^EQ`) vira "pode ser" em quase todo campo do incidente. Ver P1.
- **[proposto] Obrigatório e vazio não fica somente leitura.** `g_form.setReadOnly('caller_id', true)` não teve efeito com
  o Caller obrigatório e vazio, e depois de preenchido travou. O motor dá `read_only` confirmado e o formulário mostra
  editável. Ver P2.
- **[proposto] `comments`/`work_notes` aparecem "escondidos sem regra"** (`unexplained` + `mismatch`). O UI16 esconde o
  elemento porque usa o campo combinado de notas. Ver P3.
- **Não testado:** "dicionário prevalece". Nenhum campo do incidente fica visível e somente leitura ou obrigatório pelo
  dicionário, e não alterei dicionário de tabela que não é [PT].

## 2. fieldDeps, fieldRules e simulateValue

**O que confere**
- `contract_sla` tem `start/pause/resume/stop/reset/cancel_condition` (tipo conditions) e `collection`.
- `sysevent_email_action` (estende `sysrule`) tem `condition`, `advanced_condition`, `generation_type`, `event_name`,
  `action_insert/update`, `order` (herdado), `weight` e `collection`.
- `dl_definition_rel_match.source_table_field` é a entrada da busca e `rel_set.source_table_field` é o campo gravado.
- `trigger_inputs` vem sempre em gzip+base64, como um array de `{name, value, …}` (`table`, `condition`). A pílula real
  é `{{trigger.current}}` / `{{trigger.current.campo}}` (minúsculo), e a regex do motor cobre.
- `sys_script.action_query` existe. Não há BR `when=display` em incident/task. Aparece `when=before_display` em outras
  tabelas, que o `brLane` classifica como `br_after/other` (menor).
- Nenhuma consulta dos motores usa campo inexistente. Isso importa porque **o PDI ignora campo inválido e devolve tudo**:
  `ui_policy.nao_existe=…` devolveu 5285 de 5285.
- `fieldRules(incident.state)` como admin: 3,4 s, 25 chamadas, 29 dependentes, 14 "quem grava", 18,6 KB. Não é ruído:
  os dependentes são reais (10 BR before, 5 after, 4 client scripts…).

**O que não confere**
- **[corrigido] No incidente, `state` e `incident_state` são gêmeos.** Para `incident.state` o mapa mostrava 3 de 13
  SLAs e 1 de 3 notificações. As SLAs P1 a P4 param e pausam por `incident_state`, e "Incident resolved/closed" usa
  `incident_stateCHANGESTO6`/`=7`.
- **[corrigido] `fd-scripted`.** A ação do flow OOB "Incident Management Auto Strike Rule" grava
  `close_notes=fd-scripted^comments=fd-scripted`, o marcador de valor calculado por script. O motor mostrava
  "grava close_notes = fd-scripted", e a assinatura de flow podia contar "grava outro valor".
- **simulateValue (INC0010187, state→6) contra o PDI.** Bate: `mark_resolved` (resolved_by/at, durações), a data policy
  "Make close info mandatory when resolved" (close_code/close_notes) e "Copy State to Incident State".
  Não bate:
  - a SLA que de fato roda no registro ("Priority 3 resolution (1 day)", em `task_sla`) não aparecia, por causa do gêmeo
    (já corrigido);
  - "Incident resolved" não aparecia, também pelo gêmeo (já corrigido);
  - **[proposto]** as duas SLAs "ATF – …" aparecem como "SLA para", mas não estão anexadas ao registro (a condição de
    início é falsa). Ver P4.

## 3. saveTiming: "Por que este salvamento foi lento?"

**O que confere**
- Campos de tempo de `syslog_transaction` no dicionário (66 campos): `response_time`, `client_response_time`,
  `business_rule_time`, `business_rule_count`, `sql_time`, `sql_count`, `acl_time`, `browser_time`,
  `client_network_time`, `network_time`, `semaphore_wait_time`, `session_wait_time`, `total_wait_time`,
  `output_length`, `additional_info` (todos integer, menos `additional_info`, que é string).
  - Também existem, mas não são usados: `client_script_time`, `ui_policy_time`, `ui_action_time`, `cpu_time`,
    `transaction_processing_time`, `total_page_load_time`, `phase1/2_form_time`, `activity_stream_time`, `table`,
    `start_process_at(_ms)`.
  - **Não existe** `additional_debug_count` (existe `additional_debug_info`).
- No save real pelo formulário, a "url" é o POST serializado (4859 caracteres) e contém `sys_uniqueValue=<sys_id>` e
  `sys_action=sysverb_update`. O motor achou a transação certa: 199 ms, 11 regras, 30 ms em regras, 97 ms de SQL,
  veredito normal.
- No POST os tempos do cliente vêm **vazios** (`browser_time`, `client_response_time` = ""), porque eles ficam na
  carga seguinte do formulário. O campo `table` também vem vazio.
- A Table API **omite** campo inexistente em `sysparm_fields`, então o modo sondagem funciona.
- Não existe `sys_business_rule_metrics` nem outra tabela de tempo por regra. `additional_info` veio vazio. `syslog`
  com `sourceIN<regras>` não achou nada, só `notification.provider`.
- itil, escopo.user e escopo.admin recebem **403** em `syslog_transaction`, e o motor responde `sem_dado` com
  `tx_denied` sem inventar nada.

**O que não confere**
- **[parcialmente corrigido] Mediana.** A consulta por `url` em `syslog_transaction` não usa índice: 11 s para 24 h.
  Ela estourava os dois prazos de 8 s, gastava 16 s e dizia "poucos salvamentos (0)". Agora a nota é `baseline_slow`
  com texto próprio. O tempo perdido continua. Ver P5.
- **[proposto] `recordSaveTimes` não funciona no PDI.** `urlLIKE<sys_id>` em 7 dias levou 16,5 s, então dava timeout,
  0 salvamentos e 16 s gastos, apesar de haver um save real. Medidas para comparar:
  - janela por `sys_created_on`: 188 ms;
  - duas janelas com `^NQ`: 184 ms;
  - `type=form^table=incident` em 24 h: 196 ms, mas só pega cargas de formulário, porque o POST tem `table` vazio.

  Ver P5.

## 4. visibility: "Quem enxerga este registro"

**O que confere**
- `sys_security_acl` tem `operation.name`, `type.name`, `decision_type`, `admin_overrides`, `advanced`, `condition` e
  `script`. O filtro `nameIN…,*,*.*` funciona.
- `sys_security_acl_role` tem `sys_user_role.name`. `sys_user_has_role` tem `role.name`, `inherited` e `state`.
- A BR "incident query" é lida com `readable: 'full'`: a guarda é `!itil && !sn_incident_read && isInteractive()` e o
  filtro é caller/opened_by/watch_list = eu. O mesmo vale para a "user query" (`sys_user`): guarda
  `isInteractive() && !(admin || user_admin)`, filtro `active=true`.
- Os filtros dinâmicos existem: "Me" (`90d1921e5f510100a9ad2572f2b477fe`, `gs.getUserID()`) e "One of My Groups"
  (`d6435e965f510100a9ad2572f2b47744`, `gs.getUser().getMyGroups()`).
- `incident.sys_domain` = global.
- Conferência com a realidade:
  - INC0010187 com `user=pt.trail.itil`: o motor diz **vê** e o GET como itil deu 200;
  - registro do app escopado: `escopo.user` vê, `escopo.admin` vê, `escopo.sem_papel` não vê e itil não vê. O GET como
    itil deu 404 e como escopo.user deu 200.

**O que não confere**
- **[corrigido] Papel `public`.** O artigo F16-X32 (KB0010002, rascunho na base IT) tem ACLs de leitura que pedem o papel
  `public`, que ninguém tem em `sys_user_has_role`. O motor dava **não vê com certeza** (`table_fail`). Agora `public`
  conta para todos. Pela lógica e pelo teste, o veredito do itil passa a ser "provavelmente não vê": as ACLs têm
  script e o artigo está em rascunho e é de outro autor. Isso bate com a realidade (GET 404). Não reexecutei no PDI com
  o bundle novo.
- Sem admin (itil, escopo.*), `sys_security_acl`, `sys_script` e, no escopo, `sys_user_has_role`/`sys_user_grmember` dão
  403. O veredito é sempre "não dá para afirmar", e o motor é honesto nisso. Sugestão (P6): quando a pessoa pedida é a
  própria sessão, o GET do registro já responde.

## 5. compareInstances: "Comparar instâncias"

- A×A (incident.state): 40 regras iguais, 0 diferenças, dicionário, rótulos e opções iguais. 9,9 s e 46+48 chamadas.
- A×(sem sessão: cookies omitidos, sem token): `unreachable: ['b']`, 0 diferenças, 40 regras "unknown", 18 categorias
  em `notCompared`. 4,0 s e 43+39 chamadas. Melhoria possível: parar o lado B depois que a hierarquia e o dicionário
  voltarem negados (39 chamadas inúteis).

## Acesso por tabela e perfil

ok = 200 com linhas, vazio = 200 sem linhas.

| Tabela | admin | itil | escopo.user | escopo.admin |
|---|---|---|---|---|
| sys_db_object | ok | ok | 403 | 403 |
| sys_dictionary | ok | 403 (no_filter) | 403 | 403 |
| sys_dictionary_override | ok | 403 | 403 | 403 |
| sys_documentation | ok | ok | 403 | 403 |
| sys_choice | ok | 403 (no_filter) | **500** | 403 |
| sys_ui_policy / _action | ok | 403 | 403 | 403 |
| sys_data_policy2 / _rule | ok | 403 | 403 | 403 |
| sys_script_client, sys_script, sys_script_include, sys_ui_action | ok | 403 | 403 | 403 |
| sysrule_assignment | ok | 403 | 403 | 403 |
| sys_hub_flow | ok | ok | 403 | 403 |
| sys_hub_trigger_instance_v2 / sys_hub_action_instance_v2 | ok | 403 | 403 | 403 |
| sysevent_email_action | ok | **ok** | **ok** | **ok** |
| contract_sla | ok | 403 | 403 | 403 |
| task_sla | ok | ok | 403 | 403 |
| dl_definition / dl_definition_rel_match | ok | vazio | vazio | vazio |
| dl_definition_rel_set | ok | 403 | 403 | 403 |
| sysauto_script, sys_transform_entry, sys_transform_map | ok | 403 | 403 | 403 |
| syslog_transaction, sys_audit, syslog, sysevent | ok | 403 | 403 | 403 |
| sys_flow_context | ok | vazio | vazio | vazio |
| sys_security_acl / _acl_role | ok | 403 | 403 | 403 |
| sys_user | ok | ok | ok | ok |
| sys_user_has_role / sys_user_grmember | ok | ok | 403 | 403 |
| kb_knowledge (F16-X32) / kb_knowledge_base | ok | vazio | vazio | vazio |
| kb_uc_can_read_mtom / kb_uc_cannot_read_mtom | ok | 403 | 403 | 403 |
| user_criteria | ok | ok | 403 | 403 |
| sys_update_version | ok | 403 | 403 | 403 |
| sys_filter_option_dynamic | ok | vazio | vazio | vazio |
| incident (INC0010187) | ok | ok | vazio | vazio |
| x_2270630_pttrail__pedido_audit | ok | 403 | ok | ok |

O "vazio" de `dl_definition_rel_match` para o itil pode ser uma ACL de linha. Nesse caso "nenhum data lookup depende"
não é certo para quem não é admin.

## Tempos e chamadas

| Motor | admin | itil | escopo.user |
|---|---|---|---|
| fieldStates (7 a 16 campos) | 1,1 s / 13 | 0,9 s / 12 | 0,8 s / 11 |
| fieldRules incident.state | 3,4 s / 25 | 1,3 s / 19 | 1,0 s / 18 |
| simulateValue state→6 | 3,4 s / 34 | 1,3 s / 23 | 1,0 s / 22 |
| saveTiming | **16,6 s** / 14 (mediana) | 1,2 s / 9 | 1,4 s / 9 |
| recordSaveTimes | **16,2 s** / 3 (timeout) | 0,4 s / 2 | — |
| visibility | 1,5 a 4,1 s / 13 a 17 | 1,0 a 1,7 s / 10 a 12 | 1,4 s / 10 |
| compareInstances A×A / A×sem sessão | 9,9 s / 94 · 4,0 s / 82 | — | — |

## Commits (branch `pdi-validacao`)

1. `ed376d6` Bundle de regressão expõe os motores novos e `probe`.
2. `238ed28` `page/main.ts`: `isReadOnly(ge, control)` do UI16, mais `writeaccess=false`. O e2e `content-ui16` imita o
   g_form do UI16.
3. `0cfebbe` fieldDeps: gêmeos `state`/`incident_state` (`twinFields`), com teste.
4. `d814ef6` `isDynamicFlowValue` (`{{…}}` e `fd-scripted`) em fieldDeps, fieldMap, preview e na assinatura de flow,
   com teste.
5. `fe076f3` visibility: papel `public` implícito, com teste.
6. `0b7c327` fieldState: `aclNote` só quando as regras do formulário são legíveis, com teste.
7. `59e5ed8` saveTiming: `baseline_slow`, com teste.

`npm run typecheck && npm test && npm run build` passaram (239 testes). Os e2e `content-ui16` e `fieldlock` também.

## Propostas (correções maiores, não feitas)

- **P1. `^OR` em `evalCondition`** (`packages/core/src/util.ts:77`). Avaliar grupos: separar por `^`; termo começando com
  `OR` entra no grupo anterior; resultado = E dos grupos, OU dentro de cada um. `visibility.parseEncoded` já faz isso.
  Afeta `investigate` (pontuação) e precisa rodar a bateria de 441 casos antes de entrar.
- **P2. Obrigatório e vazio não fica somente leitura** (`fieldState.ts`, veredito por aspecto, perto da linha 366).
  Quando o aspecto `mandatory` resolve true e o valor do registro está vazio, uma regra `read_only=true` vira
  `maybe`/`why: 'mandatory_empty'` em vez de confirmada.
- **P3. Notas no UI16** (`extension/src/page/main.ts`, `stateOf`). Para campos journal (`comments`, `work_notes`) com o
  campo combinado de notas na página (`#activity-stream-textarea` / `multiple-input-journal`), não marcar
  `visible=false`.
- **P4. SLA em simulateValue** (`fieldDeps.ts`, `case 'sla'`). Ler `task_sla` do registro (`task=<id>^active=true`,
  campo `sla`): para stop/pause/resume/cancel/reset, só "roda" se a SLA estiver anexada; start só se não estiver. Sem
  leitura de `task_sla`, fica em "pode rodar". O itil lê `task_sla`.
- **P5. syslog_transaction sem filtro por url** (`saveTiming.ts`, `baselineScope` e `recordSaveTimes`, linha ~515):
  - `recordSaveTimes`: pegar os instantes de gravação da auditoria ou do histórico nos últimos N dias (até ~20) e
    consultar janelas `[at-5 s, at+60 s]` unidas por `^NQ` (184 ms para duas janelas), filtrando `isRecordWrite` no
    cliente;
  - mediana: janelas em torno de gravações recentes da mesma tabela (`sys_audit tablename=<t>` nas últimas 24 h,
    `checkpoint` distintos, até 20).

  Opcional: usar `client_script_time` e `ui_policy_time` no "navegador" e `start_process_at` para o início exato.
- **P6. visibility para a própria sessão.** Se `user` for a sessão atual, o GET do registro já é a resposta (200 = vê;
  404/403 = não vê). Hoje o itil sempre recebe "não dá para afirmar".
- **P7 (menor).**
  - `brLane` deve tratar `when=before_display` como before;
  - `TIMING_FIELDS.debugCount` deve usar `additional_debug_info` ou sair;
  - compare deve parar o lado inalcançável cedo;
  - `sys_choice` dá 500 para escopo.user, e o cliente repete 5xx duas vezes à toa.

## Achados do PDI (não são bugs do Trail)

- Campo inexistente na consulta da Table API é ignorado: devolve a tabela inteira.
- `sys_ui_policy_action.ui_policy` não grava pela Table API nem pelo formulário (fica vazio). As ações `[PT]` da Fase 13 e
  dos blinds também estão sem policy. Por isso UI policies de teste devem usar script.
- `g_form.setReadOnly` não trava campo obrigatório vazio.
- O POST do formulário em `syslog_transaction` não tem `table` nem tempos do cliente.

## Estado final

Sessão de volta ao **admin** (conferido em `/api/now/ui/user/current_user`), aplicativo **global**
(`concoursepicker`), **sem security_admin** (`g_user.hasRoleExactly('security_admin') = false`). A aba criada foi
fechada. As policies `[PT] VAL-FS A/B/R` estão inativas.
