# Gambit

Schach im Fantasy-Gewand für den Browser – gegen den Computer (400–3000 ELO), zu zweit online von Gerät zu Gerät
oder im Training mit Kampagne, Rängen und Erfolgen. Ohne Server, ohne Konto, läuft offline und lässt sich als App installieren.

## Starten

Keine Installation und kein Build nötig:

```bash
tools/serve.sh                # oder: python3 -m http.server 8766 – dann http://localhost:8766
```

**Als App und offline:** Über HTTPS (z. B. GitHub Pages) lässt sich das Spiel auf den Homescreen legen
(iPhone/iPad: Teilen → „Zum Home-Bildschirm“, Chrome/Edge: „App installieren“). Der Service Worker (`sw.js`) hält
alle Dateien samt Stockfish bereit – Computer, Training und „zu zweit an einem Gerät“ laufen danach ohne Netz.
Auf `localhost` ist er nur mit `?sw` in der Adresse aktiv, damit beim Entwickeln keine alten Dateien aus dem Cache kommen.
Nach Änderungen `tools/bump.sh` ausführen: Das zählt die Cache-Version (`?v=N` in `index.html`) hoch, dann lädt der
Service Worker beim nächsten Besuch alles neu.

## Spielmodi

- **Gegen den Computer:** Stärke per Regler 400–3000 (Lehrling, Knappe, Ritter, Magier, Meister, Drache, Unbezwingbar),
  Farbe, Bedenkzeit, Hilfen (Tipp, Zug zurück). Ab 1320 drosselt sich Stockfish selbst (`UCI_LimitStrength`/`UCI_Elo`),
  darunter wählt `js/strength.js` gewichtet zufällig unter mehreren flach gesuchten Kandidaten und streut Fehler ein.
  Eine unterbrochene Partie lässt sich im Menü fortsetzen. Nach der Partie: Analyse mit Bewertungskurve,
  Patzer/Fehler/Ungenauigkeiten und dem besten Zug als Pfeil; PGN kopieren.
- **Zu zweit online:** „Partie eröffnen“ zeigt Link, QR-Code und Raumcode (z. B. `K7M-Q2P`); die Verbindung läuft direkt
  per WebRTC, zusammengeführt über öffentliche Nostr-Relays (Trystero). Notlösung ohne Relays: zwei Codes von Hand tauschen.
  Uhren, Remis, Rücknahme (mit Zustimmung), Aufgabe, Revanche mit Farbwechsel und Emotes. Reißt die Verbindung ab, warten
  beide bis zu zwei Minuten; auch nach dem Neuladen der Seite geht es im selben Raum weiter.
- **Training:** 10 Kapitel, 75 Level, streng der Reihe nach freigeschaltet, je Level 1–3 Sterne:
  Figuren (Sterne einsammeln) → Sonderregeln → Mattbilder → Eröffnungsprinzipien → Taktik I → Endspiele gegen Stockfish →
  Taktik II → Bauernendspiele → Taktik III → Meisterprüfung (Partien bis 1800). Jedes Kapitel endet mit einer Prüfung.
- **Zu zweit an einem Gerät:** abwechselnd ziehen, ohne Computer.

**Fortschritt:** XP für Level (je Stern), Siege (je stärker der Gegner, desto mehr), Online-Partien und Erfolge ergeben
den Rang (Bauer → Knappe → Ritter → Burgherr → Magier → Großmeister → Drachenkönig). 47 Erfolge gelten in allen Modi.
Alles liegt im `localStorage` des Browsers; unter Einstellungen gibt es Export/Import als Code oder Datei für den Gerätewechsel.

Bedienung: Ziehen & Ablegen oder Tippen–Tippen. Tastatur: `←`/`→` blättern in der Partie, `F` dreht das Brett, `Esc` schließt Dialoge.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/game.js` | Partie (chess.js), Partieende, Schachuhr – ohne DOM, läuft auch in Node |
| `js/engine.js` | Stockfish per UCI im Web Worker (im Test über Node), Warteschlange für Suchen |
| `js/strength.js` | ELO-Stufen und Zugwahl des Computers |
| `js/board.js` | Brett: Figuren, Animationen, Markierungen, Pfeile, Ziehen/Tippen, Umwandlung |
| `js/pvp.js` | Online-Protokoll (Züge, Abgleich nach Abriss, Rücknahme, Remis, Revanche) – ohne DOM |
| `js/net.js` | Verbindung (aus dem Kartenspiel Eldoria): Raum über Nostr-Relays, Codes von Hand, WebRTC |
| `js/progress.js`, `js/achievements.js` | XP, Ränge, Sterne, Statistik, Erfolge – ohne DOM |
| `js/training/campaign.js` | Kapitel und Level (hier lässt sich die Kampagne erweitern; Format oben in der Datei) |
| `js/training/puzzles.js` | ~500 Rätsel aus der Lichess-Datenbank, erzeugt mit `tools/build-puzzles.js` |
| `js/training/runner.js` | Trainingslogik: Aufgaben prüfen, Sterne, Endspielziele |
| `js/audio.js` | Klänge und Musik, live mit Web Audio erzeugt (aus dem Kartenspiel Eldoria, mit Schachklängen) |
| `js/ui/*.js` | Oberfläche: `common` (Dialoge, Toasts, Einstellungen), `play` (Spielansicht), `pvc`, `lobby`, `training`, `menu`, `debug` (Effekt-Labor) |
| `art/pieces/` | Figurensätze Tatiana (Standard), Governor, Keltisch, Klassisch (`LIZENZ.md`) |
| `tools/` | `build-vendor.sh` (chess.js + Stockfish aus npm), `build-puzzles.js`, `make-icons.py`, `emoji-font.py`, `bump.sh` |

## Effekt-Labor

Mit `#debug` in der Adresse (z. B. `http://localhost:8000/#debug`) öffnet sich in der normalen App ein Dialog, der
Rangaufstieg, Erfolge, Level- und Partie-Ergebnisse, Toasts und alle Töne auslöst – ohne den Spielstand zu verändern.

## Tests

```bash
node test/campaign.js        # alle Level: Stellungen, Lösungen, Matt-Aufgaben, Sterne erreichbar
node test/achievements.js    # Erfolge, XP, Export/Import
node test/pvp.js 500         # Online-Partien über einen unzuverlässigen Kanal müssen gleich enden
node test/endgames.js        # Endspiel-Level mit Stockfish: gewonnen und im Zuglimit machbar
node test/strength.js 6      # ELO-Leiter: jede Stufe schlägt die darunter (dauert einige Minuten)
```

## Lizenzen

Stockfish steht unter der GPLv3, das Spiel als Ganzes daher ebenfalls. **Wichtig:** Der Standard-Figurensatz „Tatiana“ (sadsnake1) steht unter CC BY-NC-SA 4.0 – mit ihm darf das Spiel nicht kommerziell genutzt werden. Für eine kommerzielle Fassung einen der anderen Sätze als Standard nehmen. Fremdteile: `js/vendor/LIZENZ.md`,
`art/pieces/LIZENZ.md`, `art/fonts/LIZENZ.md`, `art/textures/LIZENZ.md`. Rätsel: Lichess-Puzzle-Datenbank (CC0).
