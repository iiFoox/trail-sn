#!/bin/bash
# Copia extension/dist (sem .map) para a pasta fixa que fica carregada no navegador e gera o zip da versão.
# Pasta: $TRAIL_EXT_DIR ou ../trail-extensao (ao lado do repositório). Zip: ../trail-edge-<versão>.zip
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/extension/dist"; OUT="${TRAIL_EXT_DIR:-$(dirname "$ROOT")/trail-extensao}"
[ -f "$DIST/manifest.json" ] || { echo "rode npm run build antes"; exit 1; }
[ -f "$DIST/build.txt" ] || { echo "build.txt ausente; rode npm run build antes"; exit 1; }
VER=$(grep -o '"version": *"[^"]*"' "$DIST/manifest.json" | grep -o '[0-9][0-9.]*')
mkdir -p "$OUT"; find "$OUT" -mindepth 1 -delete
(cd "$DIST" && find . -type f ! -name '*.map' ! -name 'build.txt' | while read -r f; do mkdir -p "$OUT/$(dirname "$f")"; cp "$f" "$OUT/$f"; done)
# Publica o ID por último: o worker só recarrega quando todos os arquivos novos já foram copiados.
cp "$DIST/build.txt" "$OUT/build.txt.tmp"; mv -f "$OUT/build.txt.tmp" "$OUT/build.txt"
ZIP="$(dirname "$ROOT")/trail-edge-$VER.zip"; rm -f "$ZIP"
powershell.exe -NoProfile -Command "Compress-Archive -Path '$(cygpath -w "$OUT")\*' -DestinationPath '$(cygpath -w "$ZIP")'" 2>/dev/null || (cd "$OUT" && zip -qr "$ZIP" .)
echo "pasta: $OUT"; echo "zip:   $ZIP"; echo "versão $VER"
