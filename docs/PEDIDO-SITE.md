# Pedido para a IA que vai mexer no site do Trail

Este pedido vale sozinho, sem depender de outra conversa.

O Trail é uma extensão gratuita de navegador (Chrome/Edge, MV3) para ServiceNow. Ela responde **"quem mudou este campo, quando, como e por quê"** e é só leitura. O site é estático e fica em `site/` do repositório `iiFoox/trail-sn`. Partes dele:

- Página principal: `site/b3/` (`index.html`, `app.js`, `style.css`, `i18n.js` e `img/`).
- Demonstrações embutidas: `site/demo/`. São iframes que rodam o painel de verdade em modo demo, e os bundles ficam em `site/assets/`.
- Política de privacidade: `site/privacidade/index.html`.
- Configuração da Vercel: `site/vercel.json`.

O deploy é feito pela Vercel do dono. O dono revisa antes de publicar.

## 0. Como pegar o código mais novo

O trabalho recente está no arquivo `trail.bundle`, que vai junto com este pedido. Ele contém dois branches:

- `master`: a extensão até a 1.4.4, mais os documentos.
- `site-perf`: as correções de desempenho do site, todas num único commit `bb915d4`.

```bash
git clone https://github.com/iiFoox/trail-sn.git && cd trail-sn
git pull ../trail.bundle master          # traz a extensão e os documentos
git fetch ../trail.bundle site-perf:site-perf
git cherry-pick bb915d4                   # aplica as correções de desempenho (itens A–F da seção 3)
npm ci && npm run build                   # gera extension/dist
bash tests/e2e/_sync-site.sh              # copia o painel novo para site/assets e atualiza site/demo/*.html
```

**Ferramentas de conferência:**
- `node tests/e2e/_site-demo.mjs`: verifica erros, imagens quebradas e estouro de largura em 1280 e 390 px.
- `node tests/e2e/_site-perf.mjs saida.json [--font=slow]`: mede desempenho.
- `site/tools/shots.mjs`: refaz os prints do painel usados em `site/b3/img/`.

Para o Playwright, use o Chromium do sistema com `channel: 'chromium'`.

## 1. Regras do dono

- **Menos informação, mais clareza.** O dono achou o site e a extensão "cheios demais". Tudo o que entrar deve ser curto e fácil de entender.
- **Não mudar o visual sem necessidade.** Cores, fontes e layout continuam. O fundo animado continua, mas tem que se mover suave também durante a rolagem.
- **Português primeiro.** Os textos são em pt-BR e ficam em `site/b3/i18n.js`, com chaves em pt e en. Mude os dois idiomas.
- **Linguagem simples.** Nada de jargão sem explicação. "BR" vira "regra automática"; "sys_audit" vira "auditoria".
- **Só o necessário.** Não invente funcionalidade que a extensão não tem.

## 2. O que mudar, em ordem

### 2.1 Tabela de casos: no máximo 10 linhas
Fica na seção `#numeros`, tabela `#tbl`.

- Mostrar **no máximo 10 linhas**, com casos variados e fáceis de entender, por exemplo:
  - caso base (C1, state);
  - regra before (C2);
  - script include (C3);
  - evento + script action (C4);
  - job agendado (C5b);
  - Flow Designer (C6);
  - pelo formulário (C2-FORM);
  - várias mudanças em sequência (F1-SEQ);
  - pela API REST (F2-REST);
  - item de requisição ou tabela customizada (F7-RITM / F7-CUSTOM).
- **Remover** os botões "Ver mais"/"Ver menos" (`#tbl-more` e `#tbl-less`) e o contador "Mostrando 30 de 441" (`#tbl-count`). Os números grandes do topo da seção ("441/441" etc.) ficam.
- Apagar de `app.js` o que só servia à tabela longa: `EXTRA_DATA`, `TYPE_MAP`, `PHASE_MAP`, `ALL_EXTRA`, `updateTblUi` e os handlers dos botões. Isso também deixa o site mais leve: são 36,6 KB a menos, cerca de 8 KB comprimidos.
- Ajustar as chaves `tbl_*` em `i18n.js`.
- Atualizar `tests/e2e/_site-demo.mjs`, que hoje espera 30 linhas, 60 depois do "Ver mais" e o texto "Mostrando 30 de 441".

### 2.2 Política de privacidade (exigência da Chrome Web Store)
Arquivo: `site/privacidade/index.html`. Mudar o texto em pt e en.

- Dizer que as preferências e a lista de instâncias ficam em `storage.sync`, que passa pela sincronização da conta Google/Microsoft do navegador.
- Dizer que os textos da "diferença lado a lado" e do relatório PDF ficam em `storage.session` até o navegador fechar.
- Pôr um link no "Contato": `https://github.com/iiFoox/trail-sn/issues`.
- Atualizar:
  - O balão de boas-vindas guarda só um resumo SHA-256 dos últimos 200 registros, não um histórico.
  - Usar "Nada vai para fora da sua instância".
  - Usar "Conectar/Desconectar", e não "Ativar/Desativar".
  - A detecção automática vale só para `*.service-now.com` e `*.servicenowservices.com`. Domínio próprio se adiciona pelas Opções, e a permissão é pedida só para o domínio digitado.
  - O menu "Trail" aparece só nas instâncias conectadas.
  - Mínimo: Chrome/Edge 120.
  - Só faz leituras (GET).

### 2.3 Desempenho (a queixa do dono: lento no celular e na primeira visita no PC)
Os itens A–F já estão no commit `bb915d4`. Basta aplicar com o cherry-pick e conferir.

**Causas medidas:**
- **A página trabalhava o tempo todo, mesmo parada.** Gastava 19–23% da CPU no celular, contra 2% sem animações. Três coisas pesavam:
  - o fundo em canvas, em tela cheia, a 30 quadros/s com 140 partículas;
  - as animações CSS infinitas;
  - o laço `stepLoop` do `#painel`, que pedia um quadro a cada 16 ms.
- **Os 4 iframes da demonstração** custam cerca de 80 KB e 450 ms de CPU cada no celular, o que trava a rolagem.
- **A fonte do Google bloqueava a primeira pintura.**
- **No PC, as camadas fixas pesam:** `.glow` com `blur(90px)`, `.grid-bg` com máscara e `nav` com `backdrop-filter`.
- **Imagens PNG pesadas** (294 KB).
- **Sem cabeçalhos de cache.**

**Já feito no `bb915d4`:**
- **A.** A fonte não bloqueia mais a pintura: `preconnect`, depois `media="print" onload="this.media='all'"` e `<noscript>`.
- **B.** As imagens viraram WebP sem perdas, com `width`/`height` (de 294 KB para 163 KB).
- **C.** O fundo **não para mais ao rolar** e ficou mais barato:
  - o canvas vai até ~520 mil pixels no PC e ~140 mil no celular, e o CSS estica;
  - 48 partículas no celular;
  - 30 fps contados pelo relógio;
  - pausa só quando a aba fica escondida (`visibilitychange`);
  - com `prefers-reduced-motion`, fica desligado.
  - A pausa antiga, de propósito, era `scrolling` + `setTimeout(…,140)`.
- **D.** O `stepLoop` só roda com o `#painel` na tela.
- **E.** Um `IntersectionObserver` põe `.offscreen` nas seções fora da tela, e o CSS pausa as animações delas.
- **F.** No `vercel.json`:
  - cache longo só para `/assets/*-HASH.(js|css)`;
  - 1 dia para `/b3/img/*`;
  - **nunca** para o HTML nem para `sidepanel.js`/`options.js`/`popup.js`/`report.js`/`diff.js`, que não têm hash.

**Medido depois (PC 2040 px, CPU 2×):**
- Parado: de 34% para 18% de CPU.
- Rolando: de 37% para 25%, **com o fundo se mexendo**.
- No celular rolando: de cerca de 46% para cerca de 37%.
- Peso da página: de 633 KB para 501 KB.

**Ainda a fazer (opcional, conferindo o visual):**
- **H.** Tirar o `filter: blur(90px)` de `.glow i`. Se precisar, estender o `radial-gradient` até `transparent 70%`. No celular (`max-width: 700px`), trocar o `backdrop-filter` da `nav` por um fundo `rgba(7,26,36,.88)`.
- **I.** Apagar a rotina que pré-carrega iframes depois do `load`. É código morto, porque trava no primeiro iframe por causa do `loading="lazy"`.
- **I, só com aprovação do dono:** no celular, carregar `#inside-frame` e `#galimg` só quando estiverem a cerca de 150 px da tela.
- **Opcional:** hospedar as fontes em `site/b3/fonts/` com `font-display: swap`. Isso tira 2 servidores de terceiros.

**Se a rolagem piorar no Edge real:**
- desenhar a 24 fps no celular (`STEP=1000/24`);
- e/ou baixar o limite do canvas do PC para 300 mil pixels.

### 2.4 Mostrar o que a extensão faz hoje (versão 1.4.4)
Primeiro, atualize os bundles com `tests/e2e/_sync-site.sh`. Assim as demos já mostram o painel novo. Depois, refaça os prints de `site/b3/img/` com `site/tools/shots.mjs`, em WebP sem perdas, e ajuste os textos.

- **Rastro:** agora vai **do mais recente para o mais antigo**. O item do topo fica destacado, com a bolinha verde. A causa leva a etiqueta "Causa". Corrija os textos que dizem "em ordem", como o `co4_p`.
- **Caminho do campo** (novo, no cabeçalho): quando o campo mudou várias vezes, aparece "Mudança 2 de 3" e os valores em sequência, por exemplo `Inquiry → Access & Password → Inquiry → Security`. Clicar num valor abre a mudança que o gravou.
- **Listas recolhidas:** em todas as abas, menos o Rastro, as listas começam fechadas, com a contagem à direita e uma seta para abrir.
- **Modo avançado** (desligado por padrão, nas Opções): reúne as ferramentas para administradores. Mencionar como opcional, em poucas linhas:
  - "Por que este campo está bloqueado, obrigatório ou escondido?";
  - Quem grava / Quem depende;
  - Simular valor;
  - Comparar instâncias;
  - Tempo do salvamento;
  - Quem enxerga o registro.
- **Mensagens de erro em linguagem simples:** por exemplo, "a instância não respondeu" e "sem permissão".

### 2.5 Números
Depois da bateria escopada v2 (`tests/regression/escopo/RELATORIO-v2.md`, quando existir), atualize os números da seção `#numeros`.

## 3. Como entregar
1. Um commit por item (2.1, 2.2, 2.3, 2.4), com mensagens em português.
2. Rode `node tests/e2e/_site-demo.mjs` e garanta `errs: []`, sem imagem quebrada e sem estouro de largura em 1280 e 390 px.
3. Mande ao dono, antes de publicar:
   - prints de antes e depois no celular e no PC;
   - os números do `_site-perf.mjs`.
4. Depois de publicar, peça ao dono para conferir no Edge:
   - se a rolagem está lisa;
   - se o fundo se mexe ao rolar;
   - se o texto não "pula" quando a fonte carrega.
