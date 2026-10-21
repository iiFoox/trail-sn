# Diário de trabalho

Registro contínuo do que foi feito, por quem e o que ficou pendente. Quem continuar o projeto (outra sessão do Claude, outro agente ou outra pessoa) lê daqui para baixo, junto com `docs/PASSAGEM.md`. Entrada nova sempre no topo; cada entrada termina com o que está em aberto.

Convenções:
- **Toda funcionalidade nova da extensão entra também no site** (`site/b3`), no estilo dele: motion, animações, texto curto. Quem coordena revisa o que outro agente fizer no site antes de publicar.
- Datas absolutas. Commit e push depois de cada bloco de trabalho.
- Nada de e-mail, senha ou dado pessoal aqui: o repositório é público.
- Resultados completos da bateria ficam em `tests/regression/results/` (fora do git); aqui vai só o resumo.

---

## 2026-10-20 (noite) — site mais leve

O dono achou o site pesado. Medido com `tests/e2e/.tmp/site-perf.mjs` (fora do git): rolagem pela página inteira com a CPU 4× mais lenta, contando quadros pelo rAF e tarefas longas.
- **Culpado principal: os 8 iframes do painel** (cada um é o painel inteiro rodando, e por serem da mesma origem o navegador não os desacelera fora da tela). Sem eles, os quadros lentos caíam de ~45 para 10. Desfoque, faixa e canvas pesavam pouco.
- **O que mudou:**
  - as 4 miniaturas de "Quatro passos" viraram imagens capturadas da própria demonstração (`b3/img/passo-1..4.png`);
  - os 4 iframes interativos usam `data-src`: carregam um por vez no tempo ocioso depois do `load`, ou antes, se a pessoa chegar perto (IntersectionObserver com 600 px de folga);
  - `content-visibility: auto` nos contêineres dos iframes;
  - canvas de partículas em densidade 1, um traço por cor, 30 fps e pausa durante a rolagem;
  - o cursor próprio só roda o loop enquanto está se movendo.
- **Resultado, nas mesmas condições:** p95 de 34,7 → 20,9 ms por quadro; quadros lentos de 37–45 → 12–17; quadros na rolagem de ~520 → ~630.
- Textos do site atualizados para o cabeçalho novo (sem bolinhas do Mac; engrenagem de configurações).
- Testes novos (Antigravity): `extension/test/i18n.test.ts` (mesmas chaves e placeholders em pt e en, nenhum texto vazio) e `extension/test/prefs.test.ts` (`motion`, `panelKey`, `comboFromEvent`). Total de 140 testes.

## 2026-10-20 (noite) — 0.12.8: cabeçalho novo, configurações no painel, falso "sem acesso"

- **Cabeçalho do painel (pedido do dono):**
  - sem as bolinhas do Mac; marca, nome e instância à esquerda;
  - à direita, nesta ordem: ⚙ configurações, painel lateral do Edge, tema e ✕ (esconde na bolinha, com a animação de minimizar).
- **Configurações dentro do painel** (`sidepanel/Settings.tsx`):
  - tema, idioma, animações liga/desliga, atalho para abrir e fechar (grava a combinação apertada; padrão `Alt+Shift+P`), ícones nos campos, bolinha, onde o painel abre, "Sempre visível" e o link "Todas as opções";
  - preferências novas `motion` e `panelKey`;
  - animações desligadas: `data-motion="off"` nas páginas e `:host([data-motion=off])` no painel e na bolinha;
  - o atalho apertado dentro do iframe do formulário chega ao quadro de cima por `postMessage` (mesma origem).
- **Falso "sem acesso" (o dono, como admin, viu `sysevent`, `sys_flow_context`, `wf_context`… como negados):** pela aba do PDI as 8 tabelas respondem 200 para o admin. A causa era o prazo de 3 s contando a fila (cerca de 14 consultas, 6 por vez); com o PDI lento, as últimas estouravam e viravam "negado". Agora:
  - o prazo é de 8 s e as que estouram são consultadas de novo;
  - `AccessReport.slow` fica separado de `denied` (só 401/403);
  - aviso leve "A instância demorou a responder", e o resultado com `slow` não fica guardado.

  Teste novo em `fetchClient.test.ts`.
- **Sobre acessos:** o Trail usa a sessão e os papéis de quem está logado e não tem conta própria. O papel `x_trail_reader` (`docs/papel-leitura.md`) só existe para quem não é admin, e o dono prefere atribuí-lo a poucas pessoas (admin ou papéis com bastante acesso), nunca a todos.
- README e PASSAGEM atualizados para a 0.12.7 (Antigravity).

## 2026-10-20 (noite) — 0.12.7

- **Registro inteiro e lote** usam a mesma animação da investigação de um campo: `sidepanel/Loading.tsx`, a trilha com a lupa, com etapas próprias. Ela fica durante toda a análise e os grupos entram embaixo.
- **Balão da bolinha** (Codex, pedido do dono): a dica só aparece com o mouse em cima e some 150 ms depois que ele sai. As boas-vindas aparecem uma vez por origem + tabela + sys_id e duram 6 s.
- **Revisão do fluxo de abrir e recarregar** (Codex). Corrigido:
  - a corrida do toggle depois da reinjeção (agora abre);
  - o descarte da cópia antiga e a guarda no init assíncrono;
  - a sondagem do mundo MAIN por frame, para não duplicar o `page.js`;
  - a conferência de conexão e permissão antes de abrir;
  - a limpeza quando a permissão é revogada.

  O `reload.mjs` agora também simula a aba sem resposta e comprova a reinjeção sem duplicar ícones.
- **Achados em aberto (médios):**
  - `background/index.ts` ~130: se a injeção em todos os frames falhar, a reserva reinjeta só no frame 0;
  - depois do reload o `storage.session` é limpo, então um painel aberto ou minimizado volta como bolinha. Para mudar, falta decidir como guardar esse estado.
- PiP e Esc dentro do PiP não foram testados (o headless não abre PiP).

## 2026-10-20 (noite) — site: ajustes do dono

Antigravity, na página b3:
- fases com no máximo 5 itens e "Ver mais (+N)" / "Ver menos";
- FAQ começando fechado;
- tabela da bateria com 30 linhas e "Ver mais (+30)": os outros 411 casos ficam compactados no `app.js`, sem dados do PDI;
- seção do painel sem rolagem presa: o painel fica parado e troca de passo sozinho a cada 5 s (pausa com o mouse em cima, clique vai direto ao passo, sem autoplay com `prefers-reduced-motion`), e os 9 passos viram uma linha do tempo vertical.

`_site-demo.mjs` confere tudo isso: sem erros, sem rolagem horizontal em 1280 e 390 px.

## 2026-10-20 (noite) — 0.12.6: bolinha-assistente e conserto do auto-reload

- **Problema que o dono viu:** depois do auto-reload, o clique no ícone não fazia nada. A aba ficava com o script de conteúdo órfão (sem ligação com a extensão nova). O F5 resolvia.
- **Conserto (Codex):** o script órfão percebe que ficou sem extensão, desliga observers e listeners e tira da página os ícones, o painel e a bolinha. O worker reinjeta `page.js` e `content.js` nas abas conectadas ao subir ou atualizar e quando a aba não responde ao pedido de painel, e tenta de novo antes de cair na janela.
- **Teste novo `tests/e2e/reload.mjs`** (no `npm run e2e`): cobre a metade do órfão (ícones e bolinha somem e a página continua funcionando). A reinjeção não dá para testar no Playwright, porque lá a extensão carregada por linha de comando não volta depois do `chrome.runtime.reload()`. Só se vê no Edge de verdade.
- **Bolinha-assistente (Codex, pedido do dono):**
  - sempre visível nas páginas da instância conectada; clique abre o painel; X, Esc e minimizar voltam para a bolinha;
  - dá para arrastar (mouse e toque); ao soltar, encosta na borda mais próxima; posição guardada por instância;
  - balão de boas-vindas e dica ao passar o mouse; o aviso "Trail conectado" agora sai da bolinha e não a cobre mais;
  - opção para desligar a bolinha.
- Abas do resultado com o tamanho do texto; o realce acompanha a aba ativa.
- `cpSync` derruba o processo no Node 24 para Windows (sai sem mensagem, código 127). Nos scripts, usar cópia manual.

## 2026-10-20 (noite) — 0.12.5 e site

- A setinha da lateral agora esconde o painel na bolinha do Trail, com a mesma animação de minimizar (pedido do dono). O estado "recolhido na borda" foi retirado.
- O aviso "Trail conectado" fica no mesmo canto da bolinha e cobre o clique nela. No e2e ele é fechado antes; o certo é o aviso virar balão da bolinha (tarefa do Codex).
- Site (Antigravity):
  - página b3 com as novidades da 0.12 e mais telas na galeria (Registro inteiro, Lote, E se?);
  - as 10 imagens refeitas a partir da demonstração em português, sem URL de instância;
  - `site/tools` com caminhos relativos.
- Protótipos antigos `site/a`, `b`, `b2` e `c` removidos a pedido do dono (citavam a URL do PDI). A raiz `/` redireciona para `/b3/` (`site/vercel.json` e `site/index.html` como reserva).

## 2026-10-20 (noite) — 0.12.4

- Correção: a setinha da lateral não recolhia o painel. A animação de abrir usava `fill-mode: both` e prendia `transform: none`, anulando a classe `.shut`. Agora é `backwards`. O Codex achou o mesmo problema pelos testes novos.
- O botão ↗ do painel lateral do Edge agora volta para o painel flutuante na página (antes abria uma janela separada).
- Testes e2e (Codex): `float.mjs` cobre a borda de baixo, o canto com mínimos de 340×260, a setinha, o Esc (página, campo da página e iframe), as bolinhas e o botão do painel lateral. `smoke.mjs` cobre os grupos do registro inteiro, recolher e expandir, e o filtro Pessoas.

## 2026-10-20 (noite) — 0.12.3

Pedidos do dono depois de testar a 0.12.2 no Edge:
- **Feito:**
  - o painel flutuante muda de tamanho por qualquer borda ou canto (encostado: a borda de dentro, a de baixo e o canto entre elas);
  - setinha na lateral para recolher e abrir;
  - Esc fecha o painel, a não ser que algo dentro dele já tenha usado a tecla (diferença em tela cheia, lista do "E se?") ou que a pessoa esteja num campo ou diálogo da página;
  - animação de abrir e fechar (deslizar com leve zoom e desfoque);
  - setinha no cabeçalho para passar para o painel lateral do Edge (`chrome.sidePanel.open` direto no clique).
- **Codex:** a janela separada abre encostada à direita do navegador. Clicar no ícone numa aba do ServiceNow ainda não conectada pede a permissão no próprio clique e abre o painel flutuante.
- **Codex:** "Tudo que mudou" separado em grupos por momento (quem salvou, quantos campos), que podem recolher.

- **Bateria no PDI com o motor da 0.12.1: 441/441**, mediana de 2,5 s e 26 chamadas por investigação (antes 2,3 s e 24). As duas chamadas a mais são as de rótulo do `sys_documentation`.

## 2026-10-20 (noite) — 0.12.1 e 0.12.2

**Feito**
- Idioma da sessão do ServiceNow chega ao motor (Codex). O mundo MAIN lê `g_user_lang`, `NOW.language`, `g_lang` ou `<html lang>`; `pt-BR`, `pt` e `pb` viram `pb` (o código do `sys_documentation`). No PDI o admin está em `en`, então o caso `pb` não foi testado na instância.
- **0.12.2**:
  - Painel flutuante com visual de janela do Mac: cantos arredondados, margem de 8 px da borda e bolinhas vermelha (fechar), amarela (minimizar) e verde (sempre visível).
  - "Sempre visível" usa Document Picture-in-Picture: o painel vai para uma janela que fica por cima de tudo, até de outros programas. Fechar essa janela devolve o painel para a página.
  - Recarregar sozinho (Codex): no build o vite gera `build.txt`. Quando a extensão está carregada sem compactação (sem `update_url`), o worker confere esse arquivo a cada 3 s e chama `chrome.runtime.reload()` quando ele muda. Na versão da loja isso não roda.
- O dono carregou `trail-extensao` no Edge e, ao clicar no ícone, abriu a janela separada. Causa: pasta nova é instalação nova (outro ID), a instância ainda não estava conectada, e sem Trail na aba o código cai de propósito para a janela.
- O site se publica sozinho a cada push (Vercel ligada ao GitHub, confirmado).

**Em andamento**
- Codex: janela separada encostada à direita do navegador; instância não conectada pede a conexão em vez de abrir a janela.
- Antigravity: página b3 com as novidades da 0.12. Depois, os ajustes pedidos pelo dono:
  - fases com no máximo 5 itens e "Ver mais";
  - FAQ começando fechado;
  - tabela de casos com 30 linhas e "Ver mais";
  - seção do painel sem acompanhar a rolagem, trocando de aba sozinha, com os passos numa linha do tempo à direita.
- Bateria do PDI com o motor da 0.12.1.

## 2026-10-20 — retomada a partir do pacote 0.12.0

**Quem:** Claude Code (coordenação, integração, bateria no PDI, GitHub e Vercel), com dois agentes no Maestri: Codex (motor) e Antigravity (interface e documentação).

**Feito**
- Código restaurado do `trail.bundle` (41 commits). Verificação inicial: typecheck ok, 126 testes, build ok, 7/7 e2e (foi preciso `npx playwright install chromium`).
- **Bateria no PDI com a 0.12.0: 441/441**, acesso completo, mediana de 2,3 s e 24 chamadas por investigação. Rodada pelo portal do Maestri, numa aba já logada (bundle injetado em pedaços pelo `maestri portal evaluate`, sem senha).
- **0.12.1** (commit "0.12.1: ..."):
  - Motor (Codex): rótulo do campo vem de `sys_documentation`: tabela mais específica, depois idioma pedido, depois `en`, por fim `sys_dictionary.column_label`. Consulta feita junto com a auditoria, sem rodada a mais (ajuste da integração). `resolveDisplay` faz a sua própria consulta em paralelo. Novos testes: 133 no total, 131 do motor.
  - Interface (Antigravity): "Comparar duas gravações" virou **"O que mudou entre dois momentos"**, com explicação visível. No modo demonstração, "O registro inteiro" na gaveta Investigar roda o registro de exemplo com animação, sem rede.
  - Site movido para dentro do repositório, em `site/`, e sincronizado com o painel da 0.12.1 por `tests/e2e/_sync-site.sh`, agora com caminhos relativos. O `_site-demo.mjs` serve só de `site/`.
  - `extension/dist-types` saiu do git (é gerado pelo tsc). `.gitattributes` força LF.
- **GitHub:** https://github.com/iiFoox/trail-sn, público, branch `master`. A identidade git deste repositório é o noreply do GitHub.
- **Vercel:** projeto novo `trail-sn`, raiz `site/`, sem build, sem proteção de login. No ar em https://trail-sn.vercel.app/b3/. O projeto antigo `trail-site` não foi mexido.
- **Pasta fixa da extensão:** `tools/atualizar-extensao.sh` copia `extension/dist` (sem `.map`) para `../trail-extensao`, a pasta que fica carregada no Edge, e gera `../trail-edge-<versão>.zip`. Rodar depois de todo `npm run build`.

**Em andamento**
- Bateria no PDI com o motor da 0.12.1.
- Codex: idioma do usuário da instância até o motor (`opts.language`), hoje sempre `en`.
- Antigravity: README para o GitHub e `docs/PASSAGEM.md` atualizado.
- A seguir: recarregar a extensão sozinha quando ela é carregada sem compactação e a pasta muda.

**Em aberto (da passagem 0.12.0)**
- Testar o painel flutuante no Edge real com o PDI. Precisa da extensão carregada no Edge do dono; o portal do Maestri não carrega extensões.
- Fase 2 (app escopado): `docs/fase2-app-escopado.md`.
- Loja do Edge: só o dono envia.
