# Diário de trabalho

Registro contínuo do que foi feito, por quem e o que ficou pendente. Quem continuar o projeto (outra sessão do Claude, outro agente ou outra pessoa) lê daqui para baixo, junto com `docs/PASSAGEM.md`. Entrada nova sempre no topo; cada entrada termina com o que está em aberto.

Convenções:
- Datas absolutas. Commit e push depois de cada bloco de trabalho.
- Nada de e-mail, senha ou dado pessoal aqui: o repositório é público.
- Resultados completos da bateria ficam em `tests/regression/results/` (fora do git); aqui vai só o resumo.

---

## 2026-10-20 (noite) — 0.12.5 e site

- A setinha da lateral agora esconde o painel na bolinha do Trail, com a mesma animação de minimizar (pedido do dono). O estado "recolhido na borda" foi retirado.
- O aviso "Trail conectado" fica no mesmo canto da bolinha e cobre o clique nela. No e2e ele é fechado antes; o certo é o aviso virar balão da bolinha (tarefa do Codex).
- Site (Antigravity):
  - página b3 com as novidades da 0.12 e mais telas na galeria (Registro inteiro, Lote, E se?);
  - as 10 imagens refeitas a partir da demonstração em português, sem URL de instância;
  - `site/tools` com caminhos relativos.
- Os protótipos antigos `site/a`, `b`, `b2` e `c` ainda citam a URL do PDI. Já citavam no site antigo; o dono decide se remove.

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
