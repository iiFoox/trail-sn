# Bateria 2000 (admin x sem admin) — tarefa do Antigravity

Objetivo: 1000 investigações como **admin** e as mesmas 1000 como **sem admin** (`pt.trail.itil`), no PDI, e um relatório de tudo que der errado, para o Claude Code corrigir depois. **Não corrija código de produção**: só meça e reporte.

## Regras (obrigatórias)
- Nunca digite senha. Use só a aba do Maestri já logada (`dev457034.service-now.com #2`). Se ela não estiver conectada a você em `maestri list`, peça ao dono para conectá-la no canvas e espere.
- **Nada de gravar no PDI**: nenhum registro novo, nenhuma alteração. A única ação permitida é personificar (POST `/api/now/ui/impersonate/<sys_id>`) e **voltar ao admin no fim** (admin sys_id `6816f79cc0a8016401c5a33be04be441`; itil `3fc011fdc3c4d3101cbdb8e1b401311c`). Confira com GET `/api/now/ui/user/current_user`.
- Não faça commit. Arquivos que pode criar ou mudar: `tests/regression/browser/entry.ts`, `tests/regression/bateria2000/*` (novo) e `tests/regression/results/*` (fora do git).

## Como rodar no PDI (o mesmo jeito que o Claude usa)
1. Build do bundle: `npx vite build -c tests/regression/browser/vite.config.ts` gera `tests/regression/browser/dist/regression.js`.
2. Injete na aba em pedaços de base64 de ~24 KB: `maestri portal evaluate "<aba>" "window._trailB64='';1"`, depois um evaluate por pedaço `window._trailB64+='<pedaço>';1`, e no fim `(0,eval)(new TextDecoder().decode(Uint8Array.from(atob(window._trailB64),c=>c.charCodeAt(0))))`. Depois de navegar ou personificar, injete de novo.
3. Personificar troca a sessão: depois do POST, navegue a aba (`maestri portal navigate` para `/incident_list.do`), espere uns 6 s e injete de novo.
4. Corridas longas: rode em segundo plano na página (`window._run = ...; promessa.then(r => window._res = r)`) e acompanhe pelo `globalThis._progress`. Salve o parcial em arquivo a cada 100 (`maestri portal evaluate ... "JSON.stringify(...)" > arquivo`).

## Alvos (1000 diferentes)
Como **admin**, monte 1000 alvos `(tabela, sys_id, campo)` que tenham mudança auditada, variando:
- tabelas: `incident`, `problem`, `change_request`, `sc_req_item`, `sc_task`, `task`, `kb_knowledge`, `cmdb_ci*` e as tabelas `[PT]` (`u_pt_*`), o que existir;
- campos: escolha, referência, texto, data, journal, booleano;
- registros de demonstração do PDI (OOTB) e os registros `[PT]`.

Fonte: `sys_audit` (GROUP BY `documentkey` + `fieldname`, pelo `/api/now/stats` ou paginando a Table API). Salve a lista em `tests/regression/bateria2000/alvos.json`.

## O que medir em cada investigação (crie `runDifferential(alvos)` em `entry.ts`)
Para cada alvo, `investigate(...)` com o `FetchRestClient` da página (como no `runOne`), guardando:
`ok`/erro (mensagem), `ms`, `calls`, `auditFrom`, `fieldNotInHistory`, número de mudanças, e para cada mudança: `at`, `oldvalue`/`newvalue` brutos, `user`, a 1ª evidência (tipo, nota, pontos, nome do artefato) e os fatos.

## Invariantes (cada violação é um achado)
**Admin:**
- A1. Não lança erro.
- A2. Número de mudanças = número de linhas de auditoria do campo (descontando a cópia duplicada de BR after, que o motor já descarta).
- A3. Tempo abaixo de 10 s.
- A4. Toda mudança tem ao menos uma evidência, e nunca `unknown_background` quando há transação do usuário no registro.

**Sem admin (itil), comparando com o admin no mesmo alvo:**
- I1. Não lança erro (registro que o itil não lê dá `RecordNotFoundError`: classificar como "sem leitura do registro", não é falha).
- I2. Se o campo está em `historyFields`: as mudanças do itil batem com as do admin (mesmos horários com tolerância de 2 s, mesmo `user`, mesmo `oldvalue`/`newvalue` brutos). Diferença de valor (ex.: rótulo em vez de valor interno) é achado.
- I3. Se o campo não está em `historyFields`: `fieldNotInHistory` = true e zero mudanças.
- I4. Com `syslog_transaction` negada, nunca evidência com o fato `no_user_transaction`.
- I5. Nunca nomeia artefato que veio de fonte negada.
- I6. Tempo abaixo de 10 s.

## Relatório (entregar ao Claude Code)
- `tests/regression/results/bateria2000-<data>.json` (tudo) e `tests/regression/bateria2000/RELATORIO.md`:
  - totais: admin ok/falha, itil ok/falha/sem leitura, tempo mediano e p95, chamadas medianas;
  - achados agrupados por invariante, com contagem e até 5 exemplos cada (tabela, sys_id, campo, o que veio, o que era esperado);
  - campos e tabelas onde o histórico do formulário não cobre;
  - qualquer erro de JavaScript.
- Ao terminar, volte ao admin e mande o resumo com `maestri ask "Claude Code #2" "<resumo>"`. Se o Claude não responder (sem cota até ~00:40), deixe o relatório no arquivo e espere.
