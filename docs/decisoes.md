# Decisões técnicas (etapa 1.2)

Registro curto das decisões tomadas durante a implementação, com a evidência que as sustenta.

## 1. `g_ck` é obrigatório; o service worker obtém o token sozinho

**Teste** (PDI dev457034, 2026-10-18 23:40 BRT, aba logada como admin), `GET /api/now/table/sys_properties?sysparm_limit=1` via `fetch`:

| Cenário | Status |
| --- | --- |
| Cookie da sessão, sem `X-UserToken` | 401 "User is not authenticated" |
| Cookie + `X-UserToken: g_ck` | 200 |
| Sem cookie | 401 |

`GET /navpage.do` com cookie devolve o HTML da sessão; o `g_ck` aparece nele e é idêntico ao `window.g_ck` da página.

**Decisão.** `FetchRestClient` sempre envia `X-UserToken`. O token vem do `page/` quando a página expõe `g_ck` (caminho rápido); senão, ou após um 401, o `background/` chama `fetchTokenFromHtml(origin)`. Isso elimina a dependência do `page/` para o Workspace e para o painel manual.

**Pendência.** Se a ServiceNow aceita o token vindo de `Origin: chrome-extension://…`. Só é testável com a extensão carregada: popup → **Testar autenticação (probe)**. O probe faz três `GET` (sem token, com token da página, com token do HTML) e grava a conclusão em `chrome.storage.session`.

## 2. Motor em `packages/core`, assinaturas puras, pontuação por fatos

Pesos em `scoring.ts`. Reproduzem os 12 casos da Fase 0 em fixtures (`test/cases.test.ts`) e na PDI viva (`tests/regression/results/`). Diferenças deliberadas em relação ao protótipo: script action sem referência ao campo fica PROVÁVEL (antes CANDIDATO); job com transação que referencia o campo mas não a tabela fica PROVÁVEL (antes CONFIRMADO). Empate entre evidências do mesmo tipo e mesma pontuação rebaixa cada uma em 15 pontos.

## 3. Content scripts registrados dinamicamente

Para não pedir permissão de host na instalação, `content.js` e `page.js` (este em `world: MAIN`) são registrados por `chrome.scripting.registerContentScripts` quando o usuário ativa a instância no popup, que concede `optional_host_permissions` só para aquela origem. Os dois scripts são IIFE (build separado em `vite.scripts.config.ts`) porque não podem importar módulos em tempo de execução.

## 4. Nenhum estado em memória no service worker

Contexto por aba, token por origem, cache de metadados (10 min) e resultados ficam em `chrome.storage.session`. O painel lateral observa `chrome.storage.onChanged`. O worker pode ser encerrado a qualquer momento sem perda.

## 5. Bug encontrado na regressão: `this.fetchImpl = fetch`

Guardar o `fetch` global como propriedade e chamá-lo como método lança "Illegal invocation" no navegador (não no Node). O erro era engolido pelo `withTimeout`, e o detector de acesso reportava "completo" com todas as fontes em `timeout`. Correções: embrulhar o fetch numa arrow function; o detector só considera `ok` e `empty` como leitura. Testes em `test/fetchClient.test.ts`.

## 6. Tempo

Na PDI, a frio e sem cache: mediana 2,05 s, 11–12 chamadas por investigação (meta: < 3 s). Com cache de metadados a expectativa é < 1 s; medir na etapa seguinte.

## 7. Nome

"Trail" é provisório. O código não depende do nome fora de `manifest.json`, `_locales/` e dos títulos das páginas; trocar depois custa minutos.

## 8. Retenção dos rastros (PDI dev457034, `sys_auto_flush`, 2026-10-19)

| Tabela | Retenção | Condição |
| --- | --- | --- |
| `syslog_transaction` | 56 dias | — |
| `sysevent` | 7 dias | — |
| `syslog` | 90 dias | — |
| `sys_flow_context` | 14 dias (COMPLETE), 42 dias (ERROR/CANCELLED), 2 dias (PAUSED_IN_DEBUG) | por estado |
| `wf_context` | 180 dias após `ended` | inativos |
| `sys_history_set` | 30 dias | — |

Em produção os valores podem ser menores. O motor lê `sys_auto_flush` (`fetchRetention`) e marca cada mudança mais antiga que a retenção com `notes: ['traces_expired:<tabela>']`; o painel mostra "rastros de execução já expiraram para esta data". Eventos expiram em 7 dias: script actions só são detectáveis em mudanças da última semana. Propriedades vistas: `glide.security.use_csrf_token=true`, `glide.security.csrf.strict.validation.mode=true` (reforça a necessidade do `X-UserToken`).

## 9. Atribuição de transações de job à mudança mais próxima

Com duas automações em sequência no mesmo campo (before e depois async), a janela da primeira mudança (−3 s / +15 s) continha a transação `JOB: ASYNC` da segunda, e a BR assíncrona era creditada às duas. Regra: transações `JOB:` são atribuídas apenas à mudança do campo mais próxima no tempo (empate → a mudança gravada antes do fim do job). Transações comuns continuam por janela. Teste em `cases.test.ts` ("duas automações em sequência").

## 10. Regras de atribuição

Para `assignment_group` e `assigned_to`, quando o formulário enviou outro valor e o servidor gravou um diferente, o motor consulta `sysrule_assignment` (ativas, na hierarquia) e nomeia a regra; +20 se o grupo/usuário da regra é exatamente o valor gravado. A condição da regra não é avaliada (lacuna declarada). Casos para a PDI em `tests/regression/pdi-setup-fase1.js` (rodar manualmente, como admin).
