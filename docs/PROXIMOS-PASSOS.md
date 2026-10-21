# Próximos passos (passagem de 21/10/2026: Claude → Codex no comando)

O Claude saiu por limite de tokens. O **Codex #2 coordena** a partir daqui: passa tarefas ao Antigravity #2, integra, testa e faz o commit.
Antes de tudo, leia `docs/DIARIO.md` (registro contínuo) e `docs/PASSAGEM.md`.

## Regras que não mudam
- Nunca digitar senhas. A extensão é somente leitura.
- No PDI (`dev457034`), só itens com prefixo **[PT]**. Nunca alterar ou apagar o que não foi criado por teste. Pode impersonar usuários e criar registros [PT].
- Não mudar propriedades do sistema da instância. Não instalar app nem role na instância do usuário (a Fase 2 está arquivada; não propor de novo).
- Não publicar o e-mail do dono em lugar nenhum. O git local usa `iiFoox <45541089+iiFoox@users.noreply.github.com>`: confira com `git config user.email` antes de cada commit.
- Envio às lojas (Edge e Chrome) e aceite de termos: só o dono faz.
- Não criar tarefas agendadas. Nada deste projeto pode afetar outros projetos do dono.
- Interface em português, com inglês completo em `extension/src/shared/i18n.ts`. Linguagem simples.
- Toda versão nova: subir a versão em `extension/public/manifest.json`, rodar `bash tools/atualizar-extensao.sh` (atualiza `../trail-extensao`, que recarrega sozinha, e gera o zip).
- Toda funcionalidade nova vai também para o site (`site/b3`, deploy automático na Vercel `trail-sn` a cada push), no estilo do site.
- Anotar tudo em `docs/DIARIO.md` e fazer commit e push com frequência (repo público `iiFoox/trail-sn`, branch master).
- Testar antes de dizer que está pronto: `npm test` (vitest), `npm run build` e a cadeia e2e (`npm run e2e`).

## Tarefa em andamento (deixada pela metade)
**Subflows na aba Flows.** No PDI, a execução de um subflow (`sys_flow_context`) tem `source_table=sys_flow_context` e `source_record` = sys_id da execução do flow pai, e não o registro. Hoje `recordFlows` (`packages/core/src/flows.ts`) só busca `source_record=<registro>`, então o subflow some.
1. O teste já foi escrito e está **vermelho** de propósito: `packages/core/test/flows.test.ts` (espera o subflow logo abaixo do pai, com `parentSysId: 'c1'`). Rode na raiz: `npx vitest run packages/core/test/flows.test.ts`.
2. Em `flows.ts`: adicionar `parentSysId?: string` em `FlowRun`; depois da primeira consulta, buscar `source_recordIN<ids das execuções>` (campos iguais e mais `source_record`) por até 3 níveis; inserir cada filho logo depois do pai.
3. Em `extension/src/sidepanel/Flows.tsx`: recuar as linhas com `parentSysId` (ex.: classe `fl-run sub`, `padding-left` maior e um traço à esquerda em `ui.css`). Atualizar `demoFlows` para o c2 ter `parentSysId: 'c1'`.
4. Validar no PDI: o incidente `d0d544b9c3c893101cbdb8e1b4013171` tem o "[PT] F14 flow chama subflow", que chama "[PT] F14 subflow descricao" (contexto `0dd544b953c89310cce665d6ce09f19f`). Procedimento: `npx vite build -c tests/regression/browser/vite.config.ts`, depois `node -e "import('./tests/regression/bateria2000/injetar.mjs').then(m=>m.injectBundle())"` com o portal `dev457034.service-now.com #2` numa página que tenha `g_ck` (ex.: `/now/nav/ui/home`; o `incident_list.do` deu erro 500 hoje), e então `TrailRegression.flows({table:'incident',sysId:'...'})`.
5. Versão 0.14.6, zip, site (mencionar subflows no passo de Flows), diário, commit.

## Validação já feita hoje (registrar no diário junto)
`TrailRegression.flows` e `TrailRegression.automations` (novos em `tests/regression/browser/entry.ts`) rodaram como admin em incidentes reais [PT] (F14, F7). O flow que rodou aparece marcado "rodou aqui"; o resto: 4 definições de flow, 226 regras de negócio, 23 script includes, 46 client scripts, 23 UI policies, 63 UI actions, 2 data lookups, 6 regras de atribuição e 13 jobs. Acesso "ok" em todas as fontes. Cerca de 2,4 s e 20 chamadas. "Copy State to Incident State" sem campos gravados é correto (o script está vazio na instância).

## Fila depois disso (em ordem)
1. Repetir a validação acima como itil (impersonar `pt.trail.itil`, sys_id `3fc011fdc3c4d3101cbdb8e1b401311c`) e como um usuário de escopo. Conferir que as fontes negadas aparecem como "–" / "Seus papéis não mostram…" e que nada é inventado. Voltar ao admin no fim.
2. Rodar os 441 casos da bateria como itil (antes só como admin) e registrar as diferenças.
3. Textos neutros para o Chrome ("painel lateral do Edge" → "painel lateral do navegador") em `i18n.ts` e no site.
4. Preparar o pacote 1.0.0 para as lojas (Edge e Chrome): `docs/loja-edge.md`, capturas e descrição. **Quem envia é o dono.**
5. Site em inglês (`site/b3`, alternador PT/EN).
6. Lacunas conhecidas: flows escopados (o Flow Designer do PDI dá erro 500) e o papel de desenvolvedor delegado não foram testados.
7. Se a sessão do portal ainda estiver com `security_admin` elevado, tirar a elevação (menu do usuário).

## Testes manuais que o dono faz no Edge e no Chrome
PiP "Sempre visível", recarga automática com reinjeção, aviso de acesso por capacidade, rótulos em pt-BR, aba Flows e "O que roda neste registro" (busca, "Só o que rodou aqui", grupos recolhidos, links abrindo).
