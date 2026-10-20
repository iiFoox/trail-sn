# Teste às cegas 6 (F16)

Cenários de administrador ServiceNow em tabelas ainda pouco testadas: `sc_task`, `sc_req_item`, `cmdb_ci_computer`, `cmdb_ci_server` e `kb_knowledge`. Mistura regras de negócio before/after/async, script include chamado por regra, client script, UI policy (ramo verdadeiro e iscas), UI action, regra de atribuição, importação por transform map para o CMDB (coalesce no `name`), Table API, Batch API, formulário e job run once, com iscas. Tudo leva o prefixo `[PT] F16` e só afeta os registros `[PT] F16-NN` / CIs `[PT] F16-...`.

## Auditoria

`f16Setup` lê o registro da coleção no `sys_dictionary` de cada tabela usada. Se a auditoria da tabela estiver desligada em `cmdb_ci_computer`, `cmdb_ci_server` ou `kb_knowledge`, ele LIGA e registra em `F16S.audit` / `F16S.auditReport` (e no `localStorage`, chave `pt_f16_audit`). Em `sc_task` e `sc_req_item` só avisa. Também avisa campos com `no_audit`. Para desfazer: `await f16Undo(F16S)`.

## Como rodar

Na aba da PDI logada como admin (UI16 clássica), cole `setup.js` no console e rode:

```js
window.F16S = await f16Setup();             // auditoria + artefatos + registros (idempotente)
F16S.auditReport                            // o que foi ligado / avisos
window.F16C = await f16Check(F16S);         // opcional: campos e botões que faltam nos formulários
window.F16L = []; await f16Run(F16S, F16L); // 3 rodadas; leva de 10 a 15 min; acompanhe F16L
window.F16A = await f16Audit(F16S);         // sys_audit de todos os registros
await f16Undo(F16S);                        // no fim: desliga as auditorias que o setup ligou
```

- `f16Run` deve rodar **uma vez** sobre registros novos. Se rodar de novo, os valores já estão gravados e as checagens não vão bater.
- Cada linha de `F16L` diz `ok` ou `NAO CONFERIU`. Se aparecer `NAO CONFERIU` ou `ERRO`, os alvos daquele registro ficam inválidos (ex.: campo fora do layout do formulário, ou a instância exigir IRE em transform map para o CMDB).
- Depois, rode o Trail em cada alvo (registro `S.recs[key]`, campo, `changeIndex`, onde 0 é a mudança mais recente) sem olhar `plan.json`, e só no fim compare.

## Arquivos

- `setup.js`: `f16Setup`, `f16Check`, `f16Form`, `f16Run`, `f16Audit`, `f16Undo`.
- `plan.json`: alvos e respostas esperadas. Não abra antes de terminar as previsões.
