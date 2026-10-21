# Testes em aplicações escopadas: tarefa

Objetivo: verificar se o Trail funciona em **aplicações escopadas**, o dia a dia de quem trabalha com App Engine. Isso inclui tabelas `x_*` com ACLs próprias, regras e script includes dentro do escopo, chamadas entre escopos, usuários que só têm os papéis do app (sem itil, sem admin) e desenvolvedores delegados. Até agora a bateria (441 cenários + 2000 investigações) cobriu só tabelas globais.

**Não corrija código de produção:** monte os cenários no PDI, rode o Trail, meça e reporte. Quem corrige depois é o Claude Code.

## Regras
- Use a aba do Maestri `dev457034.service-now.com #2` (logada como admin). Se ela não estiver conectada a você em `maestri list`, peça ao dono para conectar no canvas.
- Nunca digite senha. Usuários de teste são criados **sem senha** e usados por personificação (`POST /api/now/ui/impersonate/<sys_id>` com `X-UserToken`). **Volte ao admin no fim** (`6816f79cc0a8016401c5a33be04be441`) e confira com `GET /api/now/ui/user/current_user`.
- Tudo que criar leva **[PT]** no nome ou na descrição. Nunca altere nem apague o que já existia. Nunca mude propriedades do sistema.
- **Escopo da sessão:** troque o app atual com `PUT /api/now/ui/concoursepicker/application` `{ "app_id": "<sys_id do sys_app>" }`. **No fim, volte para o global** (`{ "app_id": "global" }`) e confira em `GET /api/now/ui/concoursepicker/current`.
- Não faça commit. Pode criar arquivos em `tests/regression/escopo/` (scripts e relatório) e mudar `tests/regression/browser/entry.ts` se precisar de um executor novo.

## Já existe no PDI (feito pelo Claude Code)
- App **[PT] Trail Escopo A**: `sys_app` `3def6f75c3cc17101cbdb8e1b40131cf`, escopo `x_2270630_pttrail_` (o ServiceNow corta em 18 caracteres).
- Tabelas no escopo:
  - `x_2270630_pttrail__pedido` ("[PT] Pedido", estende `task`, com ACLs criadas pelo `create_access_controls`);
  - `x_2270630_pttrail__item` ("[PT] Item", solta).
- **A sessão do admin na aba está dentro do app A.** Para criar registros no escopo A, continue nele. Para criar no B ou no global, troque antes.
- Dica: ao criar tabela pela API, mande o nome curto (`name: "pedido"`); o ServiceNow põe o prefixo do escopo sozinho.

## Montar no PDI
1. **Campos:**
   - em `pedido`: `u_categoria` (choice: hardware, software, acesso), `u_valor` (decimal), `u_aprovador` (referência a `sys_user`), `u_data_limite` (glide_date_time);
   - em `item`: `u_nome`, `u_estoque` (inteiro), `u_status` (choice).

   Use `sys_dictionary` pela API, no escopo A. Confira se os rótulos aparecem em `sys_documentation`.
2. **Automações no escopo A** (todas com [PT] no nome; cada uma grava um campo diferente, para dar para saber a causa):
   - BR **before** em `pedido`: quando `u_categoria` = hardware, `priority` = 2;
   - BR **after** em `pedido`: quando `u_valor` > 1000, preenche `u_aprovador` (com `current.update()` ou numa gravação separada);
   - BR **async** em `pedido`: quando `state` muda para resolvido, grava `u_data_limite`;
   - **Script include** do escopo, chamado por uma BR before, que grava `short_description`;
   - **Job agendado** do escopo (Scheduled Script Execution), rodado uma vez, que altera `u_estoque` em `item`;
   - **UI action** no formulário de `pedido` que grava `u_categoria`;
   - se possível, um **flow** do escopo que grava um campo (se não der pela API, registre que ficou de fora).
3. **App B** ("[PT] Trail Escopo B", escopo próprio) com uma BR em `pedido` (tabela do app A), para testar **regra de outro escopo**. Se o ServiceNow pedir cross-scope privilege, crie o registro em `sys_scope_privilege` e anote.
4. **Papéis e usuários (sem senha):**
   - papéis do app A: `x_2270630_pttrail_.user` (lê e escreve `pedido` e `item`) e `x_2270630_pttrail_.admin`;
   - `pt.trail.escopo.user`: só o papel `.user` do app A (sem itil);
   - `pt.trail.escopo.admin`: o papel `.admin` do app A;
   - `pt.trail.escopo.dev`: desenvolvedor delegado do app A (`sys_user_delegated_developer` ou equivalente), sem admin;
   - os já existentes `pt.trail.itil` (sem acesso ao app) e `admin`.
5. **Registros e mudanças:** crie uns 15 registros em `pedido` e 10 em `item` e faça mudanças de vários jeitos:
   - pela API como `pt.trail.escopo.user` (personificado);
   - pela API como admin;
   - disparando cada automação acima (uma mudança por causa, anotando a causa esperada);
   - rodando o job.

   Monte uma lista de **cenários com a causa conhecida** (como em `tests/regression/cases.json`: tabela, sys_id ou número, campo, tipo esperado, nome esperado).

## Rodar o Trail
Use o mesmo jeito da bateria de 2000 (`tests/regression/bateria2000/`: injetar o bundle, `runDifferential`, personificar). Para cada cenário, rode o motor como:
- `admin`;
- `pt.trail.escopo.admin`;
- `pt.trail.escopo.user`;
- `pt.trail.escopo.dev`;
- `pt.trail.itil`.

Registre: ok ou erro, tipo e nome da 1ª evidência, nota (confirmado / provável / candidato), `auditFrom`, `fieldNotInHistory`, lacunas (`gaps`), rótulo do campo (`fieldLabel`) e tempo.

## O que verificar (cada falha é um achado)
- **E1. Admin:** acerta a causa em todos os cenários do escopo, como no global (tipo e nome esperados).
- **E2.** Regras e script includes do escopo aparecem com o nome certo para o admin; a regra do **app B** sobre a tabela do app A também.
- **E3.** Rótulos dos campos `u_*` aparecem como no formulário (`sys_documentation` do escopo).
- **E4. Usuário só com o papel do app:** não quebra; vê o que as ACLs dele deixam ver; histórico do formulário funciona ou o aviso "este campo não aparece no histórico" sai. Tabela `x_*` sem Activity Stream configurado: o que acontece?
- **E5. Desenvolvedor delegado:** enxerga as regras do próprio escopo? O Trail nomeia essas regras para ele?
- **E6. Usuário sem acesso ao app** (`pt.trail.itil`): recebe "registro não encontrado / sem leitura", não erro técnico.
- **E7.** Nenhuma resposta inventada: sem "segundo plano" quando as transações são negadas; nenhum artefato vindo de fonte negada.
- **E8.** Tempo abaixo de 10 s.

## Entregar
- `tests/regression/escopo/RELATORIO.md`:
  - o que foi criado (tabela, sys_id, escopo);
  - a lista de cenários;
  - resultado por perfil (tabela);
  - achados agrupados por item E1–E8, com exemplos;
  - o que não deu para montar e por quê.
- Os cenários em `tests/regression/escopo/cases-escopo.json`, para entrar na bateria fixa depois.
- No fim: sessão de volta ao **admin** e ao app **global**. Mande o resumo com `maestri ask "Claude Code #2" "<resumo>"`.
