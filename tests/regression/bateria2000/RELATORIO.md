# Relatório da Bateria 2000 (Admin x Sem Admin)

Realizada em: **2026-10-21T03:44:13.878Z**  
Ambiente: PDI de testes ServiceNow  
Usuários testados: **admin** e **pt.trail.itil** (personificação)  
Arquivo de dados brutos: `tests/regression/results/bateria2000-2026-10-21T03-44-13-862Z.json`

---

## 1. Totais e Métricas de Performance

| Métrica | Modo Admin (1000 alvos) | Modo Sem Admin / ITIL (1000 alvos) |
|---|---|---|
| **Investigações com sucesso** | **1000** (100.0%) | **952** (95.2%) |
| **Sem leitura do registro (ACL)** | 0 (0%) | **48** (4.8%) |
| **Erros de JavaScript / Falhas** | **0** | **0** |
| **Tempo Mediano** | **2628 ms** | **2098 ms** |
| **Tempo p95** | **3184 ms** | **3089 ms** |
| **Chamadas de Rede Medianas** | **55** | **45** |

> **Nota:** No modo sem admin (`pt.trail.itil`), registros de tabelas às quais o papel ITIL não tem leitura por ACL (ex.: certas tabelas CMDB ou módulos administrativos) resultam em `RecordNotFoundError`, o que é o comportamento esperado de proteção de acesso (não é falha de código).

---

## 2. Achados por Invariante — Modo Admin (1000 testes)

### A1. Não lança erro de JavaScript
Nenhuma violação encontrada (100% aderente).


### A2. Número de mudanças bate com as linhas de auditoria
**Total de ocorrências:** 32

| Tabela | sys_id | Campo | Esperado | Obtido |
|---|---|---|---|---|
| `incident` | `0c5ba719...` | `contact_type` | 2 mudança(s) (sys_audit count) | 1 mudança(s) no resultado |
| `incident` | `264be319...` | `contact_type` | 2 mudança(s) (sys_audit count) | 1 mudança(s) no resultado |
| `incident` | `2781fe9d...` | `contact_type` | 2 mudança(s) (sys_audit count) | 1 mudança(s) no resultado |
| `incident` | `2a998c39...` | `category` | 2 mudança(s) (sys_audit count) | 1 mudança(s) no resultado |
| `incident` | `2a998c39...` | `correlation_display` | 2 mudança(s) (sys_audit count) | 1 mudança(s) no resultado |

*... e mais 27 ocorrências adicionais.*


### A3. Tempo de resposta abaixo de 10 s
Nenhuma violação encontrada (100% aderente).


### A4. Toda mudança possui evidência (e nunca unknown_background se há transação de usuário)
Nenhuma violação encontrada (100% aderente).


---

## 3. Achados por Invariante — Modo Sem Admin / ITIL (1000 testes)

### I1. Não lança erro inesperado (fora RecordNotFoundError por ACL)
Nenhuma violação encontrada (100% aderente).


### I2. Mudanças do histórico batem com a auditoria do admin (quando o campo está no histórico)
**Total de ocorrências:** 461

| Tabela | sys_id | Campo | Esperado | Obtido |
|---|---|---|---|---|
| `incident` | `010c2f99...` | `priority` | Mesma contagem de mudanças do admin (1) | 2 mudanças no ITIL |
| `incident` | `021d90b9...` | `cmdb_ci` | Valores brutos: '' → 'b4fd7c8437201000deeabfc8bcbe5dc1' | Valores no ITIL: '' → '*ANNIE-IBM' |
| `incident` | `021d90b9...` | `impact` | Mesma contagem de mudanças do admin (1) | 2 mudanças no ITIL |
| `incident` | `021d90b9...` | `priority` | Mesma contagem de mudanças do admin (1) | 2 mudanças no ITIL |
| `incident` | `024be319...` | `close_notes` | Mesma contagem de mudanças do admin (1) | 2 mudanças no ITIL |

*... e mais 456 ocorrências adicionais.*


### I3. Campos fora do histórico marcam `fieldNotInHistory: true` e zero mudanças
**Total de ocorrências:** 1

| Tabela | sys_id | Campo | Esperado | Obtido |
|---|---|---|---|---|
| `cmdb_ci_computer` | `02a9604d...` | `warranty_expiration` | fieldNotInHistory = true e 0 mudanças | fieldNotInHistory = undefined, 0 mudanças |



### I4. Com transações negadas, nunca atribui o fato falso `no_user_transaction`
Nenhuma violação encontrada (100% aderente).


### I5. Nunca nomeia artefatos provenientes de tabelas negadas (ex.: regras de `sys_script`)
Nenhuma violação encontrada (100% aderente).


### I6. Tempo de resposta abaixo de 10 s
Nenhuma violação encontrada (100% aderente).


---

## 4. Campos e Tabelas Fora do Activity Stream (Histórico do Formulário)

Quando o usuário não é admin, o Trail utiliza o histórico do formulário (`/angular.do?sysparm_type=list_history`). Abaixo estão os campos encontrados nas investigações que não estão configurados no Activity Stream da respectiva tabela:

- **`incident`**: `description`, `contact_type`, `urgency`, `work_notes`, `activity_due`, `business_service`, `subcategory`, `order`, `assignment_group`, `reassignment_count`, `follow_up`, `active`, `business_duration`, `business_stc`, `calendar_duration`, `calendar_stc`, `closed_at`, `closed_by`, `comments`, `hold_reason`, `resolved_at`, `resolved_by`, `state`, `category`, `correlation_display`, `correlation_id`, `knowledge`, `notify`, `severity`
- **`problem`**: `cause_notes`, `work_notes`, `description`, `problem_state`, `due_date`, `known_error`, `reassignment_count`, `workaround`, `workaround_applied`, `major_problem`, `fix_notes`
- **`change_request`**: `assignment_group`, `reassignment_count`, `cab_required`, `justification`, `description`, `implementation_plan`, `risk`, `test_plan`, `expected_start`, `order`, `category`, `production_system`, `backout_plan`, `end_date`, `start_date`, `close_notes`, `risk_impact_analysis`
- **`sc_req_item`**: `close_notes`, `description`, `correlation_id`, `correlation_display`, `assignment_group`, `reassignment_count`, `backordered`, `quantity`, `order`, `urgency`, `estimated_delivery`
- **`sc_task`**: `assignment_group`, `reassignment_count`, `urgency`, `due_date`, `description`, `knowledge`
- **`change_task`**: `description`, `assignment_group`, `on_hold`, `reassignment_count`, `change_task_type`, `planned_end_date`, `planned_start_date`, `close_code`, `close_notes`
- **`cmdb_ci_database`**: `Connected by`, `type`, `Used by`, `version`
- **`cmdb_ci_service`**: `Applicative Flow From`, `service_classification`, `used_for`, `version`
- **`alm_consumable`**: `display_name`
- **`alm_hardware`**: `serial_number`
- **`cmdb_ci_computer`**: `warranty_expiration`


---

## 5. Registros e Usuários no PDI

- **Usuários personificados:**
  - `admin` (`6816f79cc0a8016401c5a33be04be441`)
  - `pt.trail.itil` (`3fc011fdc3c4d3101cbdb8e1b401311c`)
- **Status da sessão ao final:** **ADMIN** (confirmado retorno obrigatório).
- **Registros criados no PDI:** Nenhum registro novo foi necessário criar (os 1000 alvos foram selecionados a partir das mudanças reais já auditadas em 18 tabelas da instância).
- **Registros alterados ou excluídos:** **Zero**. Regra estrita de somente leitura mantida.

---

## 6. Correções depois da bateria (Claude Code, 2026-10-21, versão 0.13.1)

As 461 diferenças do I2 tinham quatro causas, todas no histórico do formulário → linhas de auditoria (`core/src/history.ts`):

| Causa | Casos | Correção |
|---|---|---|
| O histórico traz a gravação da criação do registro (a auditoria não registra inserção) | 312 | essa gravação fica de fora |
| "System" em vez do usuário `system` | 133 | sem `user_id`, "System" vira `system` |
| Referência com o nome em vez do sys_id | 29 | o nome vira sys_id quando acha um registro só (`name`, `number`, `display_name`) |
| Data no fuso de quem está logado | 72 | volta para UTC pelo fuso com nome do usuário (`g_user_timezone`), com o horário de verão da própria data |

O I3 (`cmdb_ci_computer.warranty_expiration`) não era defeito: o campo está no histórico daquela tabela; a mudança a mais era a criação (primeira causa).

**Rodada de novo, como itil, só nos 479 alvos que divergiam** (`refazer-i2.mjs`): 437 batem com o admin. Sobram 42 casos de borda, aceitos:
- 25 em `cab_meeting`: a auditoria dessa tabela registra a criação, e o histórico não tem como saber disso;
- 15 referências que não resolvem: o nome acha vários registros ("Unknown") ou o itil não lê a tabela referenciada;
- 2 com duas mudanças do mesmo campo no mesmo segundo, em ordem ambígua.

O A2 (32 casos de admin com menos mudanças que linhas de auditoria) é a remoção de cópias que o motor já faz: a mesma mudança regravada pela BR after no checkpoint seguinte.
