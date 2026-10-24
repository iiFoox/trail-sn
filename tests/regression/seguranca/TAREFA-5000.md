# Bateria de segurança: 5.000 testes (1.4.5)

**Para:** Codex #2 (Antigravity #2 pode ajudar). **Quem integra e faz commit de código:** o Claude.
**Objetivo do dono:** "não pode haver erros em produção nem em ambientes reais, com vários campos customizados". Nenhum risco.

## O que mudou na 1.4.5 (o que esta bateria precisa provar)
Leia `docs/DIARIO.md`, entradas de 23/10 e 24/10 ("revisão de segurança"). Em resumo, no `packages/core/src/client/FetchRestClient.ts`:
1. `sysparm_no_count=true` em toda consulta (antes a Table API fazia COUNT(*) a cada chamada).
2. No máximo **2** chamadas simultâneas por instância, somando todos os clientes (antes 6 por cliente). Medido: a sessão do usuário atende em fila, e consultas do Trail em paralelo travavam a página do próprio usuário.
3. Antes de filtrar qualquer tabela, confere no `/api/now/ui/meta/<tabela>` se o usuário pode filtrar cada coluna (`canmatch`). Tabela sem colunas → "negado"; coluna sem permissão → a consulta não sai. Motivo: cada consulta barrada por **Query ACL** deixa mensagens vermelhas na sessão do usuário ("Part of the query on X has been ignored because of insufficient access for 'query_match'..."). Foi o que o dono viu numa instância real.
4. Rótulos, tipos e opções vêm do `ui/meta` da tabela, e não de `sys_dictionary`, `sys_choice` e `sys_documentation`.
5. Recusas guardadas por formato de consulta (tabela + campos do filtro), por sessão, por 10 min.
6. Resposta 200 que não é JSON (SSO, proxy) vira "desconhecido", não "vazio".
7. Nomes de tabela e campo fora de `^[a-z0-9_]+$` não saem; valores livres com `,` `^` ou quebra de linha saem das listas `IN`.

8. Prazo de cada fonte conta a partir de quando a consulta sai, não da fila (`QueryRequest.timeoutMs`, `timedQuery`). Verificar que nenhuma pista some ao acaso: rodar o mesmo alvo 3 vezes deve dar o mesmo resultado.

Em `investigate.ts`: import sets em duas etapas (cabeçalho `sys_import_set` perto das mudanças, depois só as tabelas de staging; nunca a base `sys_import_set_row`); edição na lista com janela de 30 min por mudança. Em `history.ts`: referência pelo `reference_display_field` do `ui/meta`, sem chutar `name`/`number` (na instância, filtro com campo inexistente é **ignorado** e devolve linhas quaisquer). Em `saveTiming.ts`: histórico de job limitado a 6 h. Na extensão: lote de no máximo 50 registros; observador da página agrupado a cada 250 ms.

9. 500 que não é JSON (página do balanceador `snow_adc`) é repetido uma vez; 500 em JSON (erro da API) não.

## O que as baterias do Claude já mostraram (24/10)
- 441 casos como admin, três rodadas da 1.4.5 durante as correções: 416 → 437 → 435. Os casos que falham **mudam de rodada para rodada** (F13-IMP2-correlation_id-2, F11-H6, F11-H17, F15-T33), e rodados isolados passam. C4 e F5-EVENT-sev falham igual na 1.4.4 (eventos fora da retenção do PDI).
- Hipóteses: 500 aleatório do balanceador do PDI (agora repetido uma vez) e fontes no limite de 3 s. **A 1.4.4 nunca foi medida no mesmo dia, com o PDI instável.** No bloco B, rode a bateria de 441 **duas vezes em cada versão**, alternando (1.4.4, 1.4.5, 1.4.4, 1.4.5), e compare a variação de cada uma. Um caso só conta como regressão se falhar nas duas rodadas da 1.4.5 e passar nas duas da 1.4.4.
- A 1.4.5 é mais lenta: cerca de 3,5 s por caso contra 2,5 s na 1.4.4 (2 chamadas simultâneas e conferência do `ui/meta`). F1-MANY falha só pelo limite de tempo do caso. Meça e informe a mediana e o pior caso das duas versões.

## Regras (sem exceção)
- Nunca digitar senhas. Só leitura no produto. No PDI, criar/alterar **somente** registros com prefixo **[PT]**; nunca tocar no que não foi criado por teste. Pode impersonar qualquer usuário. **Sempre voltar ao admin** no fim (`6816f79cc0a8016401c5a33be04be441`).
- Não mudar propriedades do sistema. Não instalar nada. Não criar tarefas agendadas.
- **Não alterar código do produto** (`packages/core/src`, `extension/src`). Achou defeito: registre com passo a passo para reproduzir; o Claude corrige. Pode criar scripts e relatórios em `tests/regression/seguranca/`.
- Não fazer commit; o Claude integra.
- Portal: `dev457034.service-now.com` (veja `maestri list`). O balanceador do PDI devolve 500 de vez em quando (`snow_adc`), em qualquer página e mesmo sem login: **não é defeito do Trail**, tente de novo (o `nav()` de `portal.mjs` já tenta 8 vezes).
- Use variáveis de página com prefixo próprio (`window._cx...`). Duas rodadas usando a mesma variável no mesmo portal se atrapalham (aconteceu: a bateria leu o resultado de outro script). Uma rodada por vez no portal: navegar mata o que estiver rodando na página.

## Ferramentas prontas
- `tests/regression/seguranca/portal.mjs`: impersona, abre a página, injeta o bundle, roda um corpo JS, recarrega a página e **lê as mensagens vermelhas na tela** (o único jeito confiável: o HTML baixado por fetch não mostra), volta ao admin. Exporta `nav`, `run`, `banners`, `impersonate`, `inject`.
- `tests/regression/seguranca/bateria441.mjs`: os 441 casos de `tests/regression/cases.json`.
- Bundle: `npx vite build -c tests/regression/browser/vite.config.ts` gera `tests/regression/browser/dist/regression.js` com `TrailRegression.runOne`, `timeline`, `automations`, `flows`, `fieldStates`, `fieldRules`, `fieldDeps`, `saveTiming`, `visibility`, `runRegression`, `runDifferential`.
- **Referência 1.4.4** para comparar: `git worktree add ../trail-144 26a92a5` e construa o bundle lá (`npm ci` se precisar). Compare sempre 1.4.4 × 1.4.5 nos mesmos alvos.
- Alvos: `tests/regression/bateria2000/gerar-alvos.mjs` e `alvos.json` (registros [PT] com auditoria), as 3 apps escopadas (`x_2270630_pttrail_`, `x_2270630_pttrailb`, `x_2270630_pttrailc`, 8 tabelas) e os usuários `pt.trail.*`:
  - admin; `pt.trail.itil` (`3fc011fdc3c4d3101cbdb8e1b401311c`); `pt.trail.aes` (`84d0d1fdc3c4d3101cbdb8e1b4013159`);
  - `pt.trail.escopo.user` (`bb523ff9c3cc17101cbdb8e1b401318f`), `.admin` (`04623ff9c3cc17101cbdb8e1b40131d4`), `.dev`, `.sem_papel`, `.userb`, `.userc`, `.adminb`, `.adminc` (sys_ids em `sys_user`, `user_nameSTARTSWITHpt.trail.escopo`).
- Atenção: o que o usuário de escopo enxerga em `sys_script` muda com o **aplicativo atual da sessão** (dentro do app escopado ele vê as regras do app; no Global, 403). É do ServiceNow; registre em qual app a sessão estava.

## As 5.000 execuções
| Bloco | O quê | Quantas |
|---|---|---|
| A. Sessão limpa | 11 perfis × ~45 registros (incidentes [PT] + registros das 3 apps escopadas) × 6 ferramentas (`runOne` em 2 campos, `timeline`, `automations`, `flows`, `fieldStates`). Ler as mensagens na tela a cada **10 execuções** por perfil; se aparecer alguma, repetir uma a uma para achar a consulta. | ~3.000 |
| B. Mesma perícia (admin) | 441 casos + 1.000 alvos da bateria2000 como admin, 1.4.4 × 1.4.5: o tipo e o nome da causa principal têm que ser iguais. | ~1.440 |
| C. Sem admin | 300 alvos como `pt.trail.itil` e 100 como `pt.trail.escopo.user`, 1.4.4 × 1.4.5: nada que a 1.4.4 achava pode sumir sem motivo explicado. | ~400 |
| D. Carga | Registro inteiro (25 campos) de 20 registros, por 3 perfis: durante a execução, abrir uma página do ServiceNow a cada 2 s e medir o tempo. Embrulhar `window.fetch` para contar chamadas em andamento ao `/api/now/`. | ~60 + medições |
| E. Dados difíceis | Criar registros **[PT]** com valores com `^`, `,`, quebra de linha, aspas, acentos e emoji; referência para tabela customizada sem campo `name`; 10 mudanças espalhadas em semanas diferentes. Rodar todas as ferramentas como admin, itil e escopo. | ~100 |

## Critérios de aprovação (todos)
1. **Zero** mensagens vermelhas novas na sessão, em qualquer perfil e ferramenta.
2. **Zero** exceções ou "ERR" nas ferramentas (fora "registro não encontrado" para quem não lê o registro).
3. Bloco B: 100% da causa principal igual à 1.4.4; cada diferença explicada.
4. Bloco C: nenhuma pista perdida sem explicação.
5. Bloco D: nunca mais de **2** chamadas `/api/now/` em andamento ao mesmo tempo; página do usuário abaixo de 3 s em 95% das medições.
6. Nenhuma consulta com nome de tabela ou campo inválido (registrar as URLs pedidas por amostragem).

## Entrega
`tests/regression/seguranca/RELATORIO-5000.md`:
- números por bloco e por perfil, tempo total, falhas com o passo a passo para reproduzir;
- os resultados brutos em `tests/regression/seguranca/results/` (fica fora do git);
- uma linha no `docs/DIARIO.md`.

Ao terminar, avise o Claude com `maestri ask "Claude Code #2" "<resumo>"`.
