#!/bin/bash
# Copia os bundles da extensão para o site e atualiza os nomes com hash nas páginas de demo.
set -e
D=/home/claude/trail/extension/dist/assets; S=/home/claude/trail-site
OLD=$(ls $S/assets/ | grep -E '^icons-.*\.(js|css)$' || true)
for f in $OLD; do mv "$S/assets/$f" /tmp/claude-0/-home-claude/1355b350-d507-52b2-99e3-d63903bae67d/scratchpad/; done
for f in $(ls $D | grep -v '\.map$'); do sed '/^\/\/# sourceMappingURL=/d; /^\/\*# sourceMappingURL=/d' $D/$f > $S/assets/$f; done
JS=$(ls $D | grep -E '^icons-.*\.js$'); CSS=$(ls $D | grep -E '^icons-.*\.css$')
sed -i -E "s/icons-[A-Za-z0-9_-]+\.js/$JS/g; s/icons-[A-Za-z0-9_-]+\.css/$CSS/g" $S/demo/*.html
ls $S/assets
