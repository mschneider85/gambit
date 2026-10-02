# Fremdbibliotheken

| Datei | Bibliothek | Quelle | Lizenz |
|---|---|---|---|
| `chess.js` | chess.js 1.4 (Jeff Hlywa) – Zugregeln, FEN, PGN | https://github.com/jhlywa/chess.js | BSD-2-Clause |
| `stockfish/` | Stockfish 19 Lite (Stockfish-Team; WASM-Fassung Nathan Rugg / Chess.com) | https://github.com/nmrugg/stockfish.js | GPLv3 (`stockfish/COPYING.txt`) |
| `trystero.js` | Trystero 0.25.4 (Nostr-Vermittlung, mit noble-secp256k1) | https://github.com/dmotz/trystero | MIT |
| `qrcode.js` | QR Code Generator 2.0.4 (Kazuhiko Arase) | https://github.com/kazuhikoarase/qrcode-generator | MIT |

`chess.js` und `stockfish/` werden mit `tools/build-vendor.sh` aus npm geholt. `trystero.js` ist mit esbuild gebündelt
(`export { joinRoom, selfId } from 'trystero'`, Format IIFE, globaler Name `TrysteroLib`).
Trystero und QR-Code werden erst in der Online-Lobby geladen, Stockfish erst beim ersten Spiel gegen den Computer.
„QR Code“ ist eine eingetragene Marke der DENSO WAVE INCORPORATED.
