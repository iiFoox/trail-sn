# Perícia para quem não é admin

Decisão do dono (2026-10-20): **nada instalado na instância**, nenhum app e nenhum papel novo. O Trail mostra a
perícia com o que o próprio usuário já enxerga, conversando com o servidor pela sessão dele, e diz com clareza o que
os papéis dele deixam ver e o que fica de fora.

Pelo navegador não há como forçar acesso: as ACLs valem no servidor. Se uma extensão passasse por cima delas, seria
uma falha de segurança do ServiceNow.

## O que cada perfil enxerga (medido no PDI, por personificação)

Usuários de teste sem senha: `pt.trail.itil` (papel `itil`) e `pt.trail.aes` (`sn_app_eng_studio.user` +
`flow_designer`). Personificação pela API `/api/now/ui/impersonate/<sys_id>` na aba do Maestri, voltando ao admin no fim.

| Fonte | itil | App Engine + flow_designer | Para que serve |
| --- | --- | --- | --- |
| `sys_audit` | 403 | 403 | quem mudou, quando, antes e depois |
| **histórico do formulário** (`/angular.do?sysparm_type=list_history`) | **200** | (sem leitura do incidente) | o mesmo que a auditoria, mas só nos campos configurados no Activity Stream da tabela |
| `sys_history_line` | 200, mas sem poder filtrar pelo registro | vazio | não serve: sem filtro, seria ler histórico de outros registros |
| `syslog_transaction` | 403 | 403 | formulário, API, job, BR assíncrona |
| `sysevent`, `sysevent_script_action` | 403 | 403 | ações por evento |
| `sys_flow_context`, `sys_hub_flow` | vazio / 200 | **200** | flows |
| `sys_script`, `sys_script_include`, `sys_ui_action` | 403 | 403 | regras automáticas, ações de botão |
| `sys_script_client`, `sys_ui_policy` | 403 | vazio | scripts do navegador |
| `sys_choice`, `sys_user` | 200 | 200 | nomes e usuários |
| `sys_dictionary` | vazio | vazio | rótulos (sobra o `sys_documentation`, 200 para o itil) |

O histórico do formulário traz, por gravação: quem gravou (`user_id`, nome), quando (`sys_timestamp` em ms) e cada
campo com valor antigo e novo (`field_name`, `old_value`/`new_value` como o formulário mostra). Só vêm os campos
configurados no Activity Stream (no incidente do PDI: estado, prioridade, impacto, responsável, item de configuração,
fechamento). Urgência e categoria, por exemplo, ficam de fora.

## O que a extensão faz

1. **Auditoria negada → histórico do formulário.** Quando `sys_audit` vem negada, o motor monta as mudanças a partir
   do histórico do formulário. Os valores de lista voltam ao valor interno pelo `sys_choice` (`1 - High` → `1`); o
   usuário vem do `user_id` (lendo `sys_user`). A investigação marca de onde veio (`auditFrom: 'history'`) e, se o
   campo investigado não estiver entre os do Activity Stream, diz isso em vez de "nenhuma mudança".
2. **Cada fonte é opcional.** O que a sessão lê entra como prova; o que é negado fica de fora e é explicado.
3. **Aviso em linguagem de gente**, por capacidade e não por tabela: "Com os seus papéis o Trail vê quem mudou e
   quando, e os flows; não vê as regras automáticas nem os jobs". A lista técnica de tabelas fica num "detalhes".
4. **Certeza honesta:** sem regras nem transações, a causa fica em "provável" ou "candidato", e o painel explica por
   quê.

## Próximos passos

- Implementar o histórico no motor (`RestClient.history`), com testes.
- Novo aviso de capacidades no painel e no popup.
- Rodar uma parte da bateria personificando `pt.trail.itil` e medir quanto da perícia volta.
