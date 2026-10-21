# Fase 2: o Trail dentro da instância (ARQUIVADO)

> **Arquivado em 2026-10-21 por decisão do dono:** o Trail fica só no navegador, como o SN Utils, sem nada instalado na instância. Este documento fica como histórico do protótipo. O motor ainda lê a tabela de contexto se ela existir (`x_trail_context` / `u_pt_trail_contexto`), o que não custa nada quando ela não existe.

Status: protótipo funcionando no PDI (fase 18 da bateria). O motor da extensão já lê o contexto gravado
quando a tabela existe.

## O problema que resolve

Hoje o Trail reconstrói a causa a partir de rastros que a instância guarda por pouco tempo e de forma
incompleta:

- o log de transações expira (56 dias por padrão), eventos em 7 dias e contextos de flow em 14;
- a requisição pela API não registra o corpo, então não dá para saber se o campo veio na requisição ou foi uma
  regra do servidor que mudou;
- a edição direto na célula da lista não deixa transação nenhuma.

Gravando o contexto **no momento da escrita**, a resposta deixa de depender desses rastros.

## Como funciona

Duas regras de negócio por tabela auditada (no app: uma configuração lista as tabelas):

1. **Começo da gravação** (`before`, order mais baixo possível): guarda os valores que chegaram na requisição
   (o que o formulário, a API ou o script mandou) na sessão, pela chave do registro.
2. **Fim da gravação** (`before`, order mais alto possível): compara o que chegou com o valor final e grava uma
   linha na tabela de contexto com:
   - campos que mudaram;
   - **campos mudados pelo servidor** (diferença entre o que chegou e o final): regra before, data lookup,
     regra de atribuição;
   - usuário, se a sessão é interativa;
   - **URL da transação** (`GlideTransaction`): formulário, endpoint da API, nome do job ou da BR assíncrona.

A tabela de contexto fica no escopo do app (`x_trail_context`), com retenção própria (ex.: 180 dias, via
`sys_auto_flush`), leitura pelo papel `x_trail_reader` e gravação só pelas regras do app.

## O que o motor faz com isso

Quando a tabela existe (`x_trail_context` ou o protótipo `u_pt_trail_contexto`), cada investigação lê as
linhas do registro e ajusta as evidências:

| O contexto diz | Efeito |
|---|---|
| O servidor mudou o campo nesta gravação | BR before / data lookup / atribuição ganham certeza; a pessoa e os scripts do navegador perdem |
| O campo chegou assim na requisição (API ou formulário) | A pessoa ganha certeza; regras do servidor perdem |
| A gravação veio de um job | O job com aquele nome ganha certeza; a pessoa perde |

Resultado no PDI: a regra before que muda a urgência pela API passou de "provável" para certeza alta
(110 pontos), a pessoa que mandou o impacto ficou com 105, a Priority Lookup com 95.

## Custos e cuidados

- Uma inserção por gravação auditada: medir antes de ligar em tabelas de volume alto (ex.: `sys_user`,
  `cmdb_ci`). A configuração do app escolhe as tabelas.
- As regras rodam em toda gravação das tabelas escolhidas; o código é curto e não consulta nada.
- `GlideTransaction` e a propriedade de sessão só existem no escopo global: o app precisa de um script include
  global de apoio (ou de acesso cruzado aprovado). O protótipo roda no global.
- Gravações feitas com `setWorkflow(false)` não rodam regras: elas continuam sem contexto (o motor segue
  usando os rastros normais).

## Próximos passos

1. Empacotar como app escopado (`x_trail`), com tabela, papel, configuração de tabelas e as duas regras.
2. Script include global de apoio para a URL da transação.
3. Página de saúde no app: quantas linhas por dia, tabelas ligadas, retenção.
4. Na extensão: mostrar "contexto gravado na hora" como prova própria e avisar quando a tabela está ausente.
