/*
 * Spielstärke: Partien zwischen ELO-Stufen (Stockfish in Node). Erwartung: die stärkere Stufe holt mehr Punkte.
 *   node test/strength.js [Partien je Paarung]
 */
const { load, CG } = require('./sf-node');

const N = +(process.argv[2] || 6);
const PAIRS = (process.argv[3] ? JSON.parse(process.argv[3]) : [[400, 'random'], [800, 400], [1200, 800], [1320, 1200], [1600, 1320], [2000, 1600]]);

async function play(engine, white, black) {
  const g = new CG.Game();
  while (!g.over && g.ply < 200) {
    const side = g.turn === 'w' ? white : black;
    const legal = g.legal().map(CG.chessUtil.toUci);
    const uci = side === 'random' ? legal[Math.floor(Math.random() * legal.length)]
      : await CG.Strength.chooseMove({ engine, fen: g.fen, elo: side, legal });
    if (!g.move(uci)) throw new Error(`Ungültiger Zug ${uci} in ${g.fen}`);
  }
  if (!g.over) return 0.5;
  return g.result.winner === 'w' ? 1 : g.result.winner === 'b' ? 0 : 0.5;
}

(async () => {
  const engine = await load();
  let ok = true;
  for (const [strong, weak] of PAIRS) {
    let pts = 0;
    for (let i = 0; i < N; i++) {
      pts += i % 2 ? 1 - (await play(engine, weak, strong)) : await play(engine, strong, weak);
    }
    const share = pts / N;
    console.log(`${strong} gegen ${weak}: ${pts}/${N} (${Math.round(share * 100)} %)`);
    if (share < 0.5) ok = false;
  }
  console.log(ok ? 'OK' : 'FEHLER: eine stärkere Stufe hat verloren');
  process.exit(ok ? 0 : 1);
})();
