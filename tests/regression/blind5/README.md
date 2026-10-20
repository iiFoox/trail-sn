# Teste às cegas 5 (F15)

Cenários mistos para o Trail: regras de negócio before/after/async, script include chamado por regra, client script, UI policy (ramo verdadeiro e ramo "senão"), UI action, regra de atribuição, importação por transform map, Table API, Batch API, formulário, data policy e job run once, com iscas. Tudo leva o prefixo `[PT] F15` e só afeta os registros `[PT] F15-NN`.

## Como rodar

Na aba da PDI logada como admin (UI16 clássica), cole `setup.js` no console e rode:

```js
window.F15S = await f15Setup();             // artefatos + registros (idempotente)
window.F15C = await f15Check(F15S);         // opcional: campos e botões que faltam nos formulários
window.F15L = []; await f15Run(F15S, F15L); // 3 rodadas; leva de 10 a 15 min; acompanhe F15L
window.F15A = await f15Audit(F15S);         // sys_audit de todos os registros
```

- `f15Run` deve rodar **uma vez** sobre registros novos. Se rodar de novo, os valores já estão gravados e as checagens não vão bater.
- Cada linha de `F15L` diz `ok` ou `NAO CONFERIU`. Se aparecer `NAO CONFERIU` ou `ERRO`, o alvo correspondente fica inválido.
- Depois, rode o Trail em cada alvo (registro `S.recs[key]`, campo, `changeIndex`, onde 0 é a mudança mais recente) sem olhar `plan.json`, e só no fim compare com `plan.json`.

## Arquivos

- `setup.js`: funções `f15Setup`, `f15Check`, `f15Run`, `f15Audit`, `f15Form`.
- `plan.json`: alvos e respostas esperadas. Não abra antes de terminar as previsões.
