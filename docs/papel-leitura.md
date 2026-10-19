# Papel de leitura mínimo (`x_trail_reader`)

O Trail não cria papéis nem ACLs. Este documento é o que o usuário entrega ao administrador da instância para que a perícia funcione sem `admin`. Todas as operações são **read**; nenhuma é write.

## Por que é necessário

Na PDI (Fase 0), um usuário `itil` recebe **403** em `sys_audit`, `syslog_transaction` e `sys_script`, e **200 vazio** em `syslog`, `sys_flow_context` e `sysauto_script`. Sem `sys_audit` a perícia não funciona; sem `syslog_transaction` BRs assíncronas, UI actions e scripts de fundo caem para CANDIDATO ou somem. O detector de acesso da extensão mostra exatamente quais fontes estão negadas, por nome técnico, para o usuário copiar no chamado.

## Tabelas e operações

| Tabela | Operação | O que habilita | Observação |
| --- | --- | --- | --- |
| `sys_audit` | read | A linha do tempo inteira | Pode restringir por `tablename` às tabelas de negócio, se a empresa preferir |
| `syslog_transaction` | read | BR assíncrona, UI action, script de fundo, prova do formulário | A URL de transações de formulário contém valores digitados; avaliar com segurança. O Trail lê só o parâmetro do campo investigado e nunca persiste a URL |
| `sysevent`, `sysevent_script_action` | read | Script actions | |
| `sys_flow_context`, `wf_context` | read | Flows e workflows | |
| `sys_script`, `sys_script_include`, `sys_ui_action`, `sysauto_script` | read | Nomear o artefato e checar se referencia o campo | A maioria das empresas já concede ao time de desenvolvimento |
| `sys_db_object`, `sys_dictionary` | read | Hierarquia de tabelas e rótulos | Normalmente já disponíveis |

## O que o papel **não** inclui

`sys_user`, `sys_user_has_role`, qualquer tabela de negócio além das que o usuário já vê, e nenhuma operação de escrita.

## Passo a passo para o administrador

1. **User Administration → Roles → New**: nome `x_trail_reader`, descrição "Leitura para perícia de registros (Trail)".
2. Para cada tabela acima, **System Security → Access Control (ACL) → New**: tipo `record`, operação `read`, nome = tabela (sem campo), e em *Requires role* adicionar `x_trail_reader`. Se já existir uma ACL de leitura na tabela, basta acrescentar o papel a ela.
3. Em `syslog_transaction`, se a política de segurança exigir, restrinja com condição `type=form` ou com um script que limite a janela de tempo; a perícia continua funcionando com menos cobertura.
4. Atribuir `x_trail_reader` ao grupo de desenvolvedores/sustentação.
5. Validar com o próprio Trail: popup → **Verificar acesso** deve mostrar "acesso completo".

## Verificação pela extensão

O detector faz um `GET` com `sysparm_limit=1` por tabela e classifica: `ok` (lê), `empty` (tabela acessível, sem linhas visíveis), `denied` (403/401), `no_filter` (403 "Field(s) present in the query": lê a tabela, mas não pode filtrar pelo campo), `timeout`. Só `ok` e `empty` contam como leitura.
