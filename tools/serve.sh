#!/usr/bin/env bash
# Startet einen lokalen Webserver für das Spiel (Standard-Port 8766) und zeigt die Adressen an.
# Ohne Server (Datei per Doppelklick) läuft Stockfish nicht – Browser blockieren Worker unter file://.
#   tools/serve.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8766}"
echo "Gambit läuft auf:"
echo "  dieser Rechner:  http://localhost:$PORT"
for ip in $(hostname -I 2>/dev/null); do echo "  im Netz:         http://$ip:$PORT"; done
echo "Beenden mit Strg+C"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
