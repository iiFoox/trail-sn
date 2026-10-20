#!/bin/bash
# Copia os bundles da extensão para o site (site/) e atualiza os nomes com hash nas páginas de demo.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
D="$ROOT/extension/dist/assets"; S="$ROOT/site"
rm -f "$S"/assets/*
for f in "$D"/*; do case "$f" in *.map) continue;; esac; sed '/^\/\/# sourceMappingURL=/d; /^\/\*# sourceMappingURL=/d' "$f" > "$S/assets/$(basename "$f")"; done
JS=$(ls "$D" | grep -E '^icons-.*\.js$'); CSS=$(ls "$D" | grep -E '^icons-.*\.css$')
sed -i -E "s/icons-[A-Za-z0-9_-]+\.js/$JS/g; s/icons-[A-Za-z0-9_-]+\.css/$CSS/g" "$S"/demo/*.html
ls "$S/assets"
