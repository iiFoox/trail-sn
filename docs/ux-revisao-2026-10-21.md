# Revisão de UX — 21/10/2026

Aprovada pelo dono: os 14 ajustes rápidos, os 6 médios, abas de 6 para 4 (E1) e frase-resposta no topo (E2). E3 e E4 ficam como ideias. As capturas ficaram fora do repositório.

## Revisão de UX do Trail 1.0.0: painel em modo demonstração

**Como fiz:** copiei o repositório para `(scratchpad)/ux/repo` (com symlink para os `node_modules` originais) e rodei `npm run build` lá. As capturas foram feitas com Playwright e a extensão carregada, pelo script `(scratchpad)/ux/shoot.mjs`. São 120 capturas: 30 telas × 340/420 px × escuro/claro, todas em `(scratchpad)/ux/shots/`.

O aviso de acesso, o erro, o carregando e o estado vazio não aparecem no modo demonstração original. Para capturá-los, criei na minha cópia de `App.tsx` as chaves `&access=1`, `&err=1`, `&run=1` e `&empty=1`. Elas existem só na cópia e podem virar chaves oficiais da demonstração, se quiserem.

Duas coisas para saber antes de reusar o script:
- `colorScheme` do Playwright não muda o tema, porque o padrão em `prefs.ts` é `dark` e não "seguir o sistema". As capturas claras usam `&theme=light`.
- A barra "Investigar" é fixa no rodapé. Nas capturas de página inteira ela aparece no meio da imagem, mas é artefato da captura e não sobreposição real.

Nada foi alterado em `/home/claude/iifoox/trail-sn`.

---

## 1. Melhorias priorizadas (alto impacto e baixo esforço primeiro)

### A. Alto impacto, esforço P

1. **O texto de acesso contradiz a regra "sem papel novo".**
   - **Onde:** `i18n.ts`, chaves `p.deniedHint`, `p.request`, `accessPartial` e `accessNoneHint`.
   - **Problema:** em Provas aparece "O administrador pode conceder o papel de leitura x_trail_reader" (proof-420-dark), e o "Copiar pedido ao admin" sugere esse papel. Mas a Fase 2 foi arquivada e o produto promete não exigir papel nenhum.
   - **Proposta para `deniedHint`:** "Seus papéis não deixam ler essas fontes. Se precisar, peça ao administrador leitura nestas tabelas; o Trail não exige papel próprio."
   - **Proposta para `request`:** tirar a frase "Sugestão: o papel x_trail_reader…".
   - **Proposta para `accessPartial` e `accessNoneHint`:** tirar "papel de leitura do Trail".

2. **As abas Flows e "E se?" ficam escondidas em 340 px.**
   - **Onde:** `ui.css` `.seg-tabs` e `Result.tsx`.
   - **Problema:** em answer-340-dark e category-340-dark só cabem Resposta/Rastro/Provas/Histórico. As outras duas ficam fora da tela, sem nenhum sinal de que a barra rola.
   - **Proposta:** colocar um degradê e uma seta "›" na borda direita quando houver overflow. Melhor ainda: reduzir as abas para 4, como na proposta estrutural E1.

3. **O aviso "A resposta pode estar incompleta" aparece duas vezes e empurra a resposta para baixo.**
   - **Onde:** `Result.tsx`, `Answer`.
   - **Problema:** em category-340-dark, um aviso amarelo de 6 linhas sobre flows e workflows vem acima de "Quem mudou". A mesma informação se repete na barra amarela do fim ("2 fontes sem acesso").
   - **Proposta:** mostrar o aviso no topo só se a fonte negada puder ser a causa provável (certeza média ou baixa e o tipo da fonte compatível com o que faltou). Fora isso, deixar só a `warnbar`.
   - **Texto da `warnbar`:** "Pode faltar algo: 2 fontes sem acesso · 1 gravação sem auditoria → Ver o que falta".

4. **"Por que não foi admin" esconde o motivo bom.**
   - **Onde:** `Result.tsx`, `lossReason` e `Other`.
   - **Problema:** proof-420-dark diz só "Tem menos provas que a resposta principal". O motivo real ("O formulário que ele salvou às 22:37:01 enviou State = In Progress, não Resolved") só aparece ao abrir o bloco.
   - **Proposta:** quando não houver fato negativo, usar `e.gaps[0]` como motivo, com os horários localizados.

5. **O estado de erro mostra ao mesmo tempo "falhou" e "Nenhuma investigação nesta aba", sem ação.**
   - **Onde:** `App.tsx`.
   - **Problema:** ver error-340-dark.
   - **Proposta:** esconder o vazio quando `status==='error'` e incluir um botão "Tentar de novo".
   - **Mensagem para 401/403:** "Sua sessão do ServiceNow expirou. Entre de novo na instância e clique em Tentar de novo."

6. **"Vazio" é escrito de quatro jeitos.**
   - **Onde:** chaves `P.empty` "(vazio)", `tlEmptyValue` "Vazio", `btEmpty` "vazio" e `plain.empty`.
   - **Problema:** as grafias variam entre whatif-420-dark, history-record-420-dark e record-groups-420-dark.
   - **Proposta:** usar uma chave só, "vazio", em itálico e na cor `--muted`.

7. **Rodapé técnico e duplicado.**
   - **Onde:** `Result.tsx`, `.footer`, e `Timeline.tsx`.
   - **Problema:** "11 chamadas em 1840 ms" aparece em todas as abas. Em history-record aparecem dois rodapés seguidos ("9 chamadas em 1240 ms" e "11 chamadas…").
   - **Proposta:** trocar pela forma "Analisado em 1,8 s" e mostrar só uma vez. Tirar o rodapé da linha do tempo. As chamadas podem ir para o title.

8. **"Nenhuma mudança auditada para este campo" é jargão.**
   - **Onde:** `i18n` `noChanges` e `History`.
   - **Problema:** ver nochange-420-dark. Também aparece "Outras regras que mexem em Number 0", um bloco inútil quando é 0.
   - **Texto:** "Este campo não mudou desde que o registro foi criado."
   - **Comportamento:** esconder o bloco de regras quando tiver 0 itens.

9. **"Gravação sem auditoria · Atenção" não explica nada.**
   - **Onde:** linha do `History` (`unauditedRow`).
   - **Problema:** ver history-420-dark e nochange-420-dark.
   - **Texto:** "Alguém salvou sem deixar histórico (admin)". O tooltip ou detalhe usa `unauditedText`.
   - **Etiqueta:** trocar "Atenção" por "Sem histórico".

10. **O resumo do diff mostra só a linha removida.**
    - **Onde:** `DiffSummary`.
    - **Problema:** em diff-340-dark aparece "+2 −1 linhas" com a prévia "− Já reiniciada pelo usuário.". A pessoa vê o que saiu, não o que entrou.
    - **Proposta:** mostrar primeiro a primeira linha adicionada (quando houver).
    - **Texto:** "2 linhas novas, 1 removida".

11. **O campo aparece com o nome técnico onde o resto do painel usa rótulos.**
    - **Onde:** `content/main.ts:249`, `Flows.tsx` e `RecordRuns.tsx` (`fl-writes`).
    - **Problema:** o tooltip do ícone é "Por que mudou? · state", e a lista de gravados mostra `state` e `close_notes` (flows-420-dark, record-runs-420-dark).
    - **Proposta:** usar o rótulo do formulário. O nome técnico vai para o `title`.
    - **Junto:** `floatPanel.ts:499` tem "Esconder o painel" fixo em pt. Precisa entrar no i18n.

12. **No lote aparecem valores crus.**
    - **Onde:** `Batch.tsx`, `Row`, e o lote no core.
    - **Problema:** em batch-open-420-dark aparece "inquiry → network", enquanto o resto do painel mostra "Inquiry / Help → Network".
    - **Proposta:** preencher `oldDisplay`/`newDisplay` no lote, como já é feito no registro inteiro.

13. **"Para o usuário" engana.**
    - **Onde:** `plainTitle`.
    - **Problema:** o analista pode ler como instrução, quando o bloco é um texto para copiar (answer-*).
    - **Texto:** "Em uma frase (para colar no chamado)". Tirar o subtítulo repetido.

14. **O carimbo "CERTEZA ALTA" parece decoração.**
    - **Onde:** `.cert`, `ui.css`.
    - **Problema:** os três pontinhos soltos à esquerda e o efeito de carimbo inclinado competem com o nome da causa (answer-420-dark). O "Certeza média" (category) usa outro estilo, sem carimbo, e isso fica inconsistente.
    - **Proposta:** um selo único e alinhado ("●●● Certeza alta"), igual nas três faixas, com a frase da prova ao lado.

### B. Alto impacto, esforço M

15. **Abrir os grupos no registro inteiro e no lote.**
    - **Onde:** `Batch.tsx`, `details.bt-group`.
    - **Problema:** em record-420-dark e batch-420-light o conteúdo útil (campo e de → para) fica fechado. A tela mostra só "20/10 19:21 · admin salvou 4 campos".
    - **Proposta:** abrir por padrão os 3 primeiros grupos, ou todos quando forem até 10 linhas.

16. **O lote agrupa por minuto e repete a mesma causa 5 vezes.**
    - **Onde:** `Batch.tsx`, `groupSaves`.
    - **Problema:** em batch-open-420-dark, "Regra automática: Categoria pelo grupo de suporte" aparece em 5 grupos separados. A pergunta do lote é "por quê?", então o agrupamento natural é pela causa.
    - **Proposta:** no lote, agrupar por causa e ordenar pela contagem. Abrir com uma frase de resumo:
      "7 de 11 mudaram pela regra 'Categoria pelo grupo de suporte'; 3 por beth.anglin; 1 pela importação 'Chamados do parceiro'."
    - **Chips:** os filtros de hoje ficam truncados ("Categoria pelo grupo de su…") e podem sair.

17. **O formulário "Investigar" pede nome técnico.**
    - **Onde:** `App.tsx`, `ManualDrawer`.
    - **Problema:** os campos "Tabela: incident / Campo: state" não fazem sentido para o analista (empty-340-dark).
    - **Proposta:** pedir só "Número do registro (ex.: INC0010001)", deduzindo a tabela pelo prefixo, e oferecer "Campo" como lista com os rótulos. Tabela e campo técnicos ficam num link "Avançado".
    - **Texto do estado vazio:** "Abra um registro e clique no ícone do Trail ao lado de um campo. Ou digite o número abaixo."

18. **Separar ferramentas de provas.**
    - **Onde:** `Result.tsx`, `Proof`.
    - **Problema:** "Tudo que pode gravar State" e "Conflitos em toda a tabela incident" não são provas desta mudança e alongam a aba (proof-expanded-420-dark, 2.300 px). "Detalhe técnico do acesso", com nomes de tabelas, também fica ali.
    - **Proposta:** levar o mapa e a varredura para uma aba ou seção "Automações" (ver E1). Deixar em Provas só "Por que esta resposta", "Por que não foi X" e "O que pode faltar".

19. **O carregando não diz o que está sendo analisado.**
    - **Onde:** `Loading.tsx`.
    - **Problema:** em loading-340-dark o texto do passo some no fade e não há registro nem campo na tela.
    - **Proposta:** uma linha fixa acima da trilha, "INC0010001 · State", e o passo com contraste total.

20. **O aviso de acesso é uma lista, não uma orientação.**
    - **Onde:** `App.tsx`, `AccessNotice`.
    - **Problema:** em access-340-light, "seus papéis não mostram" se repete 5 vezes, e o ◐ é pequeno, laranja e ilegível.
    - **Proposta:** começar com uma frase sobre o que ainda dá para fazer:
      "Dá para ver quem mudou os campos do histórico e as regras; não dá para ver flows, jobs e eventos."
    - **Lista:** mostrar duas colunas, "Vejo" e "Não vejo", sem repetir o motivo em cada item.

### C. Médio impacto, esforço P/M

21. **Ícones e texto pequenos demais.** Os ícones do cabeçalho são 26 px (`.icon-btn`), as abas usam 12 px e os detalhes usam mono 11 px. Proposta: ícones de 32 px e detalhes de fato em fonte normal de 12 px, em vez de monoespaçada. Exemplo do problema: "Job ASYNC "[PERICIA-TESTE] Resolve incidente por pa"" parece log cru.
22. **O valor antigo riscado tem pouco contraste**, principalmente no claro (history-record-340-light). Proposta: tirar o risco e usar "de X → para Y" com o `X` em `--fg-2`.
23. **Tema duplicado.** O cabeçalho tem a alternância de tema e Configurações tem "Tema" de novo. Proposta: tirar o ☀/☾ do cabeçalho, que ganha espaço para o nome da instância (que hoje fica truncado: "sua-instancia.servic…"). "Desligar atalho" aparece solto fora do cartão (settings-420-dark) e deveria ficar dentro do item "Atalho".
24. **O bolinha amarelo de acesso no cabeçalho é ambíguo.** Hoje o `title` mostra só "partial". Proposta: trocar por um chip com texto, "Acesso parcial", que leva à explicação.
25. **A ação principal fica escondida no mesmo peso das outras.** Na Resposta há 5 ações (Copiar frase, Abrir a regra, Copiar resumo, Copiar relatório completo, Salvar em PDF). Proposta: um botão "Copiar para o chamado", com menu Frase / Resumo / Relatório completo / PDF, e "Abrir a regra" como link junto do nome da causa.
26. **O demo dos Flows tem horário incoerente.** Os flows aparecem às 19:37, mas a mudança foi às 22:37 (flows-420-dark), e o site usa esse demo. Corrigir em `demoFlows` usando o horário da mudança.

---

## 2. Propostas estruturais

**E1. Reorganizar as abas de 6 para 4: "Resposta · Como aconteceu · Histórico · Automações".**
- **Como aconteceu:** junta Rastro e Provas. A linha do tempo vem em cima; "por que esta resposta" e "o que pode faltar" vêm embaixo.
- **Automações:** junta Flows, "E se?", "Tudo que pode gravar" e "Conflitos na tabela".
- **Prós:**
  - Cabe em 340 px.
  - Cada aba responde a uma pergunta clara.
  - Provas fica só com provas.
  - Ferramentas de análise ficam juntas.
  - Flows deixa de ser uma aba de "registro" no meio de abas de "campo".
- **Contras:**
  - Muda o que o site e as capturas da loja mostram.
  - "Como aconteceu" fica longa.
  - "E se?" perde visibilidade, mas hoje já está escondida.

**E2. Uma frase-resposta no topo, no cartão do cabeçalho.**
- **Ideia:** o cartão fixo ganha a frase de `plainSummary` em linguagem simples (ex.: "Uma regra automática mudou para Resolved logo depois que admin salvou · certeza alta"). Isso substitui os três blocos de hoje ("Quem mudou", o carimbo e "Para o usuário").
- **Prós:** responde em 2 segundos e em qualquer aba. Tira repetição, porque nome, tipo e frase hoje aparecem três vezes.
- **Contras:** o cartão fixo cresce em telas baixas, então é preciso recolher ao rolar. Para certeza baixa, o texto precisa ser bem cuidadoso.

**E3. Navegação entre campos e mudanças sem sair da análise.**
- **Ideia:** no cabeçalho, um seletor "Campo: State ▾" com os campos que mudaram no registro, e setas ‹ › entre as mudanças do campo ("mudança 1 de 3").
- **Por quê:** hoje, trocar de campo exige ir em Histórico → Registro inteiro, e trocar de mudança exige ir em Histórico.
- **Prós:** deixa claro qual mudança está na tela. Hoje o cabeçalho sempre mostra a mudança selecionada sem dizer que existem outras.
- **Contras:** precisa da linha do tempo carregada (é mais uma chamada) e aumenta a complexidade do cabeçalho.

**E4. Unificar as duas visões de "registro inteiro".**
- **Situação de hoje:** existem duas telas diferentes para "registro inteiro". Uma é a linha do tempo dentro de Histórico (history-record), com filtros, comparação entre momentos e "via". A outra é a análise em lote de campos pela gaveta (record-*), com certeza por campo, CSV e "O que roda neste registro".
- **Proposta:** uma visão só, que é a linha do tempo com a certeza de cada campo carregando aos poucos, mais "O que roda neste registro" como seção recolhida.
- **Prós:** um modelo mental só e menos código duplicado.
- **Contras:** analisar todos os campos custa mais chamadas. Isso exige carregamento progressivo e cuidado com instâncias lentas.

---

## 3. Funcionalidades pouco descobertas ou pouco úteis

- **"E se?"** é útil para quem configura, mas fica escondida em 340 px e o resultado é bom. **Mover** para "Automações" (E1). Também pode ganhar um atalho a partir de Resposta: "Simular outro valor".
- **"O que mudou entre dois momentos"** é uma comparação poderosa, enterrada em Histórico → Registro inteiro → botão. **Manter**, mas com destaque na visão unificada (E4), e mostrar a comparação em cima da lista, não no meio dela.
- **Mapa "Tudo que pode gravar {campo}" e "Outras regras que mexem em {campo}"** se sobrepõem: os dois listam o que pode gravar o campo. O primeiro fica em Provas, o segundo em Histórico. **Juntar** num só lugar (Automações), já ordenado por fase.
- **"Conflitos em toda a tabela"** é uma ferramenta de admin e não responde "por que este campo mudou". **Mover** para Automações, ou para a página de opções como diagnóstico da tabela.
- **"Detalhe técnico do acesso" e "Verificar acesso de novo"** só interessam a desenvolvedores. **Mover** para Configurações ou Diagnóstico e deixar em Provas só um link.
- **O alerta de pingue-pongue e o "Rastro some em N dias"** são valiosos e quase nunca aparecem. **Manter**. O "Rastro some" merece um botão "Salvar PDF agora" ao lado.
- **Flows (aba)** é útil, mas é sobre o registro e não sobre o campo. Destacar flows "que gravam este campo" e "que rodaram na janela da mudança". O resto vai para Automações.
- **CSV no registro inteiro e no lote** está OK. "Copiar relatório completo" e "Salvar em PDF" entram no menu único "Copiar para o chamado" (item 25).
- **Atalhos de teclado (← → ↑ ↓)** não aparecem em lugar nenhum do painel. Dica para Configurações: "No painel: ← → trocam de aba; ↑ ↓ andam pelas mudanças."

---

## 4. Capturas mais relevantes

Todas em `(scratchpad)/ux/shots/`:

1. `answer-340-dark.png`: abas cortadas, três blocos repetindo a causa, carimbo de certeza e excesso de ações.
2. `category-340-dark.png`: aviso de incompleto empurrando a resposta e duplicado no fim; jargão "script include".
3. `proof-expanded-420-dark.png`: Provas misturada com ferramentas, nomes de tabelas, x_trail_reader e "Por que não foi admin" fraco.
4. `batch-open-420-dark.png`: a mesma causa repetida por minuto, valores crus e chips truncados.
5. `record-420-dark.png`: grupos fechados escondendo o conteúdo e a lista "O que roda" longa.
6. `history-record-420-dark.png`: a segunda visão de "registro inteiro", rodapé duplicado e "Vazio" com outra grafia.
7. `error-340-dark.png`: erro e estado vazio ao mesmo tempo, sem botão para tentar de novo.
8. `access-340-light.png`: aviso de acesso repetitivo, gaveta técnica (incident/state) e ◐ ilegível.
9. `nochange-420-dark.png`: "auditada", "Gravação sem auditoria · Atenção" e bloco com 0 regras.
10. `flows-420-dark.png`: nomes técnicos de campo e horário incoerente no demo.

Também úteis: `diff-340-dark.png` (prévia do diff mostra só a remoção), `whatif-420-dark.png`, `settings-420-dark.png` e `loading-340-dark.png`.

