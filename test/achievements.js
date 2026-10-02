/*
 * Erfolge: Bekannte Partien müssen die erwarteten Erfolge auslösen (und keine falschen).
 *   node test/achievements.js
 */
const CG = require('../js/game.js');
require('../js/progress.js');
require('../js/training/campaign.js');
require('../js/achievements.js');

const mem = () => { let d = null; return { load: () => d, save: (s) => { d = JSON.parse(JSON.stringify(s)); } }; };
let errors = 0;

function game(sans) {
  const g = new CG.Game();
  for (const s of sans.split(' ')) if (!g.move(s)) throw new Error(`Zug ${s}`);
  return g;
}
function expect(name, events, want, notWant = []) {
  const p = new CG.Progress(mem());
  const got = new Set();
  for (const e of events) for (const a of CG.Achievements.check(e, p)) got.add(a.id);
  const miss = want.filter((w) => !got.has(w));
  const extra = notWant.filter((w) => got.has(w));
  if (miss.length || extra.length) { errors++; console.log(`✗ ${name}: fehlt ${miss.join(', ') || '–'}, zu viel ${extra.join(', ') || '–'}`); }
  else console.log(`✓ ${name}: ${[...got].join(', ')}`);
}

const scholar = game('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');
expect('Schäfermatt gegen 1200', [{ type: 'game-end', mode: 'pvc', outcome: 'win', elo: 1200, game: scholar, me: 'w', assisted: false }],
  ['first-win', 'beat-800', 'beat-1200', 'flawless', 'scholar', 'blitz'], ['beat-1600', 'smothered', 'pawn-mate']);
expect('Schäfermatt mit Tipp', [{ type: 'game-end', mode: 'pvc', outcome: 'win', elo: 1200, game: scholar, me: 'w', assisted: true }],
  ['first-win', 'scholar'], ['beat-800', 'beat-1200', 'flawless']);
const smother = game('e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#');
expect('Ersticktes Matt (Schwarz)', [{ type: 'game-end', mode: 'online', outcome: 'win', game: smother, me: 'b' }],
  ['smothered', 'knight-mate', 'online-win', 'online-first'], ['scholar']);
// Normaler Abtausch (Damentausch) ist kein Comeback
const trade = game('e4 e5 Nf3 d6 d4 exd4 Qxd4 Nc6 Qd2 Be7 Qxd6 Qxd6');
expect('Abtausch ist kein Comeback', [{ type: 'game-end', mode: 'pvc', outcome: 'win', elo: 800, game: trade, me: 'b', assisted: false }], ['first-win'], ['comeback']);
const ep = game('e4 a6 e5 d5 exd6');
expect('En passant', [{ type: 'move', move: ep.history[4], mode: 'pvc' }], ['en-passant'], ['promote']);
expect('Lokale Partie zählt nicht', [{ type: 'game-end', mode: 'local', outcome: 'win', game: scholar, me: 'w' }], [], ['first-win', 'scholar']);
expect('Rätselserie', Array.from({ length: 10 }, () => ({ type: 'puzzle', ok: true })).map((e) => e), [], ['puzzle-streak-10']);

// Mit Fortschritt: 10 gelöste Rätsel in Folge
{
  const p = new CG.Progress(mem());
  let unlocked = false;
  for (let i = 0; i < 10; i++) { p.puzzle(true); if (CG.Achievements.check({ type: 'puzzle', ok: true }, p).some((a) => a.id === 'puzzle-streak-10')) unlocked = true; }
  if (!unlocked) { errors++; console.log('✗ Rätselserie mit Fortschritt'); } else console.log('✓ Rätselserie mit Fortschritt');
  const before = p.state.xp;
  const r = p.levelResult('figuren/turm', 2);
  const r2 = p.levelResult('figuren/turm', 3);
  if (r.xp !== 80 || r2.xp !== 20 || p.stars('figuren/turm') !== 3) { errors++; console.log('✗ Level-XP', r, r2); } else console.log('✓ Level-XP und Sterne');
  void before;
  const code = p.exportCode();
  const q = new CG.Progress(mem());
  q.importCode(code);
  if (q.stars('figuren/turm') !== 3) { errors++; console.log('✗ Export/Import'); } else console.log('✓ Export/Import');
}
console.log(errors ? `FEHLER: ${errors}` : 'OK');
process.exit(errors ? 1 : 0);
