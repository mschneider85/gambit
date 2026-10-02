#!/usr/bin/env node
/*
 * Holt Rätsel aus der freien Lichess-Puzzle-Datenbank (CC0, https://database.lichess.org/#puzzles)
 * und schreibt eine Auswahl nach js/training/puzzles.js. Die Datenbank wird gestreamt und nur so weit
 * gelesen, bis jede Gruppe genug Rätsel hat (die Reihenfolge der Datenbank ist zufällig).
 *
 *   node tools/build-puzzles.js        (braucht npm für den zstd-Entpacker fzstd, wird temporär installiert)
 *
 * Gruppen: Thema + Wertungsbereich. Pro Gruppe N Rätsel, nur beliebte und oft gespielte.
 * Format pro Rätsel: [id, fen, züge (uci, durch Leerzeichen), wertung]. Der erste Zug ist der des Gegners.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const GROUPS = {
  mate1: { themes: ['mateIn1'], rating: [400, 1100], n: 40 },
  mate1b: { themes: ['mateIn1', 'backRankMate'], rating: [400, 1300], n: 12 },
  mate1s: { themes: ['mateIn1', 'smotheredMate'], rating: [400, 1500], n: 10 },
  mate2: { themes: ['mateIn2'], rating: [800, 1500], n: 40 },
  mate3: { themes: ['mateIn3'], rating: [1100, 1800], n: 30 },
  fork: { themes: ['fork'], rating: [600, 1300], n: 30, short: true },
  pin: { themes: ['pin'], rating: [600, 1400], n: 30, short: true },
  skewer: { themes: ['skewer'], rating: [600, 1400], n: 30, short: true },
  hanging: { themes: ['hangingPiece'], rating: [400, 1000], n: 30, short: true },
  discovered: { themes: ['discoveredAttack'], rating: [800, 1600], n: 30 },
  double: { themes: ['doubleCheck'], rating: [800, 1700], n: 20 },
  deflection: { themes: ['deflection'], rating: [900, 1700], n: 25 },
  attraction: { themes: ['attraction'], rating: [900, 1700], n: 20 },
  trapped: { themes: ['trappedPiece'], rating: [800, 1600], n: 20 },
  promotion: { themes: ['promotion', 'endgame'], rating: [700, 1500], n: 20 },
  pawnEnd: { themes: ['pawnEndgame'], rating: [700, 1500], n: 25 },
  mixA: { themes: [], rating: [1200, 1450], n: 30 },
  mixB: { themes: [], rating: [1450, 1650], n: 30 },
  mixC: { themes: [], rating: [1650, 1900], n: 30 },
};
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'puz-'));
  execSync('npm init -y >/dev/null && npm i --silent fzstd', { cwd: tmp });
  const fzstd = require(path.join(tmp, 'node_modules/fzstd'));
  const out = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, []]));
  const used = new Set();
  const full = () => Object.entries(GROUPS).every(([k, g]) => out[k].length >= g.n);
  let rest = '';
  let lines = 0;
  let done = false;
  const handle = (line) => {
    lines++;
    const [id, fen, moves, rating, dev, pop, plays, themes] = line.split(',');
    if (id === 'PuzzleId' || used.has(id)) return;
    const r = +rating;
    if (+dev > 85 || +pop < 88 || +plays < 800) return;
    const th = themes.split(' ');
    const nMoves = moves.split(' ').length;
    for (const [k, g] of Object.entries(GROUPS)) {
      if (out[k].length >= g.n) continue;
      if (r < g.rating[0] || r > g.rating[1]) continue;
      if (!g.themes.every((t) => th.includes(t))) continue;
      if (g.short && nMoves > 4) continue;
      if (!g.themes.length && nMoves > 8) continue;
      out[k].push([id, fen, moves, r]);
      used.add(id);
      return;
    }
  };
  const dec = new fzstd.Decompress((chunk, final) => {
    if (done) return;
    const text = rest + Buffer.from(chunk).toString('utf8');
    const parts = text.split('\n');
    rest = final ? '' : parts.pop();
    for (const l of parts) if (l) handle(l);
    if (full()) done = true;
  });
  const res = await fetch(URL);
  const reader = res.body.getReader();
  let bytes = 0;
  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) break;
    bytes += value.length;
    dec.push(value);
    if (bytes % (20 << 20) < value.length) process.stderr.write(`${(bytes / 1e6).toFixed(0)} MB, ${lines} Zeilen\n`);
  }
  reader.cancel().catch(() => {});
  for (const k of Object.keys(out)) out[k].sort((a, b) => a[3] - b[3]);
  const body = Object.entries(out).map(([k, list]) => `  ${k}: [\n${list.map((p) => `    ${JSON.stringify(p)},`).join('\n')}\n  ],`).join('\n');
  const js = `/* Rätsel aus der Lichess-Puzzle-Datenbank (CC0, https://database.lichess.org/#puzzles), erzeugt mit tools/build-puzzles.js.
   Pro Rätsel: [Lichess-ID, FEN, Züge (UCI; der erste ist der Zug des Gegners), Wertung]. */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  CG.PUZZLES = {
${body}
  };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
`;
  fs.writeFileSync(path.join(__dirname, '../js/training/puzzles.js'), js);
  console.log(Object.entries(out).map(([k, l]) => `${k}: ${l.length}`).join(', '));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})();
