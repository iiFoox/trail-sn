# Diário de trabalho

Registro contínuo do que foi feito, por quem e o que ficou pendente. Quem continuar o projeto (outra sessão do Claude, outro agente ou outra pessoa) lê daqui para baixo, junto com `docs/PASSAGEM.md`. Entrada nova sempre no topo; cada entrada termina com o que está em aberto.

Convenções:
- Datas absolutas. Commit e push depois de cada bloco de trabalho.
- Nada de e-mail, senha ou dado pessoal aqui: o repositório é público.
- Resultados completos da bateria ficam em `tests/regression/results/` (fora do git); aqui vai só o resumo.

---

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
