#!/usr/bin/env bash
# Cache-Version in index.html hochzählen (alle ?v=N): Danach lädt der Service Worker beim nächsten Besuch alles neu.
set -euo pipefail
cd "$(dirname "$0")/.."
cur=$(grep -o 'sw.js?v=[0-9]*' index.html | grep -o '[0-9]*$')
next=$((cur + 1))
sed -i "s/?v=$cur\"/?v=$next\"/g; s/sw.js?v=$cur'/sw.js?v=$next'/" index.html
echo "Cache-Version $cur → $next"
