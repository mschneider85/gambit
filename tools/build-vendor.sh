#!/usr/bin/env bash
# Holt die Fremdbibliotheken aus npm und legt sie fertig nach js/vendor/ (einmalig bzw. für Updates).
#   chess.js  → js/vendor/chess.js  (IIFE, globaler Name ChessLib)
#   stockfish → js/vendor/stockfish/ (Lite, ein Thread: läuft ohne besondere Server-Header)
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
(cd "$TMP" && npm init -y >/dev/null && npm i --silent chess.js@1 stockfish@19 esbuild)
echo "export { Chess, validateFen } from 'chess.js';" > "$TMP/entry.js"
"$TMP/node_modules/.bin/esbuild" "$TMP/entry.js" --bundle --format=iife --global-name=ChessLib --minify \
  --banner:js="/* chess.js $(node -p "require('$TMP/node_modules/chess.js/package.json').version") – BSD-2-Clause – https://github.com/jhlywa/chess.js */" \
  --footer:js="if(typeof module!=='undefined')module.exports=ChessLib;" --outfile=js/vendor/chess.js
mkdir -p js/vendor/stockfish
cp "$TMP/node_modules/stockfish/bin/stockfish-19-lite-single.js" js/vendor/stockfish/stockfish.js
cp "$TMP/node_modules/stockfish/bin/stockfish-19-lite-single.wasm" js/vendor/stockfish/stockfish.wasm
cp "$TMP/node_modules/stockfish/Copying.txt" js/vendor/stockfish/COPYING.txt
echo "fertig"
