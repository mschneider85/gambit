/*
 * Endspiel-Level mit Stockfish prüfen: Die Stellung muss für den Spieler gewonnen sein, und bei Matt-Zielen
 * muss das Zuglimit über der Mattdistanz liegen.   node test/endgames.js
 */
const { load, CG } = require('./sf-node');
require('../js/training/campaign.js');

(async () => {
  const engine = await load();
  let errors = 0;
  for (const l of CG.Campaign.all.filter((x) => x.type === 'endgame')) {
    const r = await engine.search({ fen: l.fen, depth: 22, options: { UCI_LimitStrength: false, 'Skill Level': 20 } });
    const s = r.lines[0].score;
    let ok;
    let info;
    if (s.mate !== undefined) { ok = s.mate > 0 && (l.goal !== 'mate' || s.mate <= l.moves); info = `Matt in ${s.mate}`; }
    else { ok = s.cp > (l.goal === 'mate' ? 500 : 300); info = `${s.cp} cp`; }
    console.log(`${ok ? '✓' : '✗'} ${l.key}: ${info} (Limit ${l.moves})`);
    if (!ok) errors++;
  }
  console.log(errors ? `FEHLER: ${errors}` : 'OK');
  process.exit(errors ? 1 : 0);
})();
