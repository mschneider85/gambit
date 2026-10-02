/*
 * Spielstärke des Computers nach ELO (400–3000).
 *  - Ab 1320 drosselt Stockfish sich selbst (UCI_LimitStrength + UCI_Elo).
 *  - Darunter kann Stockfish nicht schwächer spielen: Er sucht flach mehrere Kandidaten (MultiPV),
 *    wir wählen gewichtet zufällig (je schwächer, desto gleichgültiger gegenüber der Bewertung)
 *    und streuen ab und zu einen beliebigen Zug ein – so entstehen menschlich wirkende Fehler.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const scoreValue = (s) => CG.engineUtil.scoreValue(s);

  const LEVELS = [
    { elo: 400, name: 'Lehrling', icon: '🕯️', text: 'Kennt die Regeln, mehr nicht.' },
    { elo: 800, name: 'Knappe', icon: '🛡️', text: 'Übersieht oft Drohungen.' },
    { elo: 1200, name: 'Ritter', icon: '⚔️', text: 'Solider Vereinsanfänger.' },
    { elo: 1600, name: 'Magier', icon: '🔮', text: 'Starker Vereinsspieler.' },
    { elo: 2000, name: 'Meister', icon: '👑', text: 'Taktisch scharf, kaum Fehler.' },
    { elo: 2500, name: 'Drache', icon: '🐉', text: 'Großmeisterniveau.' },
    { elo: 3000, name: 'Unbezwingbar', icon: '🌋', text: 'Stockfish fast ohne Bremse.' },
  ];
  const MIN = 400;
  const MAX = 3000;
  const SF_MIN = 1320;

  /** Name der Stufe, in der eine ELO liegt. */
  function level(elo) {
    let l = LEVELS[0];
    for (const x of LEVELS) if (elo >= x.elo) l = x;
    return l;
  }

  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

  /** Parameter für schwache Stufen (unter 1320). */
  function weakParams(elo) {
    const t = (elo - MIN) / (SF_MIN - MIN); // 0 bei 400, 1 bei 1320
    return {
      depth: Math.round(lerp(1, 4, t)),
      multipv: Math.round(lerp(10, 5, t)),
      temperature: lerp(350, 90, t), // Zentibauern: wie stark schlechtere Züge noch gewählt werden
      random: lerp(0.22, 0.04, t), // Anteil „beliebiger“ Züge
    };
  }

  /** Zug nach Gewichten exp(-Verlust/Temperatur) wählen. rnd: Zufallsfunktion (für Tests einstellbar). */
  function pick(lines, temperature, rnd) {
    const best = scoreValue(lines[0].score);
    const w = lines.map((l) => Math.exp(-Math.min(3000, best - scoreValue(l.score)) / temperature));
    const sum = w.reduce((a, b) => a + b, 0);
    let r = rnd() * sum;
    for (let i = 0; i < lines.length; i++) { r -= w[i]; if (r <= 0) return lines[i]; }
    return lines[0];
  }

  /**
   * Zug des Computers. o: { engine, fen, elo, legal: [uci…] (für Zufallszüge), rnd }
   * → uci-String
   */
  async function chooseMove(o) {
    const rnd = o.rnd || Math.random;
    const elo = Math.max(MIN, Math.min(MAX, o.elo));
    if (elo >= SF_MIN) {
      const r = await o.engine.search({
        fen: o.fen, multipv: 1,
        movetime: Math.round(lerp(500, 1500, (elo - SF_MIN) / (MAX - SF_MIN))),
        options: elo >= MAX ? { UCI_LimitStrength: false, 'Skill Level': 20 } : { UCI_LimitStrength: true, UCI_Elo: elo, 'Skill Level': 20 },
      });
      return r.bestmove;
    }
    const p = weakParams(elo);
    if (o.legal && o.legal.length && rnd() < p.random) return o.legal[Math.floor(rnd() * o.legal.length)];
    const r = await o.engine.search({
      fen: o.fen, multipv: p.multipv, depth: p.depth,
      options: { UCI_LimitStrength: false, 'Skill Level': 0 },
    });
    if (!r.lines.length) return r.bestmove;
    // Ein Matt in 1 sieht auch der Knappe meistens
    const first = r.lines[0];
    if (first.score && first.score.mate === 1 && rnd() < lerp(0.4, 0.95, (elo - MIN) / (SF_MIN - MIN))) return first.pv[0];
    const chosen = pick(r.lines.filter((l) => l.pv && l.pv.length), p.temperature, rnd);
    return chosen.pv[0];
  }

  /** Bester Zug in voller Stärke (Tipps, Endspiel-Training, Analyse). */
  async function bestMove(engine, fen, movetime = 800) {
    const r = await engine.search({ fen, movetime, multipv: 1, options: { UCI_LimitStrength: false, 'Skill Level': 20 } });
    return r;
  }

  CG.Strength = { LEVELS, MIN, MAX, level, weakParams, chooseMove, bestMove };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
