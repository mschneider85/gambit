/*
 * Trainingslogik ohne DOM (testbar): Aufgaben eines Levels zusammenstellen, Züge prüfen, Sterne vergeben.
 * Die Oberfläche (ui/training.js) führt die Level damit aus.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { Chess } = CG;

  /** Lichess-Rätsel → Aufgabe: Der erste Zug ist der des Gegners, danach abwechselnd. */
  function fromPuzzle(p) {
    const [id, fen, moves, rating] = p;
    const m = moves.split(' ');
    return { fen, pre: m[0], line: m.slice(1), mate: true, id, rating, text: null };
  }

  /** Alle Aufgaben eines steps-Levels (eigene + Rätsel aus der Datenbank). */
  function items(level) {
    const out = [...(level.items || [])];
    const refs = level.puzzles ? (Array.isArray(level.puzzles) ? level.puzzles : [level.puzzles]) : [];
    for (const r of refs) {
      const list = (CG.PUZZLES && CG.PUZZLES[r.group]) || [];
      for (const p of list.slice(r.from, r.from + r.n)) out.push({ ...fromPuzzle(p), group: r.group });
    }
    return out;
  }

  /** Setzt der Zug in dieser Stellung matt? */
  function givesMate(fen, uci) {
    const c = new Chess(fen);
    try { c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch (e) { return false; }
    return c.isCheckmate();
  }

  /** Text zur Aufgabe: Wer zieht? */
  function sideText(fen) { return fen.split(' ')[1] === 'w' ? 'Weiß' : 'Schwarz'; }

  /*
   * Ablauf einer Aufgabe (steps): k zeigt auf den erwarteten eigenen Zug in line.
   * check(fen, uci) → { ok, done, reply } – reply: Gegenzug, der danach automatisch kommt.
   */
  class Exercise {
    constructor(item) {
      this.item = item;
      this.k = 0;
    }
    get expected() { return this.item.line ? this.item.line[this.k] : null; }
    check(fen, uci) {
      const it = this.item;
      const exp = this.expected;
      const isExp = uci === exp;
      const alt = this.k === 0 && it.alt && it.alt.includes(uci);
      const mate = it.mate !== false && givesMate(fen, uci);
      if (!isExp && !alt && !mate) return { ok: false };
      if (mate || alt) return { ok: true, done: true };
      const reply = it.line[this.k + 1];
      this.k += 2;
      if (!reply || this.k >= it.line.length) return { ok: true, done: true, reply: reply || null };
      return { ok: true, done: false, reply };
    }
  }

  /** Sterne für Aufgaben-Level: Fehler + benutzte Tipps. */
  function stepsStars(mistakes, hints) {
    const m = mistakes + hints;
    return m === 0 ? 3 : m <= 2 ? 2 : 1;
  }

  /*
   * Sterne-Lektion: kürzeste Zugzahl, um alle Sterne einzusammeln (Breitensuche; nur die weißen Figuren ziehen,
   * gegnerische Figuren stehen still und werden geschlagen, wenn man auf ihr Feld zieht).
   */
  function starsPar(fen, stars, maxDepth = 30) {
    const idx = Object.fromEntries(stars.map((s, i) => [s, i]));
    const all = (1 << stars.length) - 1;
    const start = new Chess(fen, { skipValidation: true });
    const key = (c, mask) => `${c.fen().split(' ')[0]}|${mask}`;
    let frontier = [{ fen: start.fen(), mask: 0 }];
    const seen = new Set([key(start, 0)]);
    for (let d = 1; d <= maxDepth; d++) {
      const next = [];
      for (const st of frontier) {
        const c = new Chess(st.fen, { skipValidation: true });
        for (const m of c.moves({ verbose: true })) {
          if (m.promotion && m.promotion !== 'q') continue;
          const c2 = new Chess(st.fen, { skipValidation: true });
          c2.move(m);
          c2.setTurn('w');
          let mask = st.mask;
          if (idx[m.to] !== undefined) mask |= 1 << idx[m.to];
          if (mask === all) return d;
          const k = key(c2, mask);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ fen: c2.fen(), mask });
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return null;
  }

  function starsLessonStars(moves, par) { return moves <= par ? 3 : moves <= par + 2 ? 2 : 1; }

  /** Endspiel: Sterne nach benötigten Zügen im Verhältnis zum Zuglimit (bzw. zur Mattdistanz par). */
  function endgameStars(used, limit, par) {
    if (par) return used <= par + 1 ? 3 : used <= par + 5 ? 2 : 1;
    return used <= Math.ceil(limit * 0.6) ? 3 : used <= Math.ceil(limit * 0.85) ? 2 : 1;
  }

  /** Bosspartie: Hilfen kosten Sterne. */
  function bossStars(assists) { return assists === 0 ? 3 : assists <= 2 ? 2 : 1; }

  /**
   * Endspiel-Ziel erreicht? game: CG.Game, me: Farbe. → 'win' | 'fail' | null (läuft weiter)
   * mate: mattsetzen; promote: umwandeln, ohne dass die neue Figur sofort geschlagen werden kann; hold: Remis halten.
   */
  function endgameStatus(level, game, me, usedMoves) {
    const r = game.result;
    if (level.goal === 'mate') {
      if (r) return r.winner === me && r.reason === 'checkmate' ? 'win' : 'fail';
      if (usedMoves >= level.moves && game.turn === me) return 'fail';
      return null;
    }
    if (level.goal === 'promote') {
      if (r) return r.winner === me ? 'win' : 'fail';
      const last = game.lastMove;
      if (last && last.color === me && last.promotion) {
        const safe = !game.legal().some((m) => m.to === last.to);
        return safe ? 'win' : null;
      }
      // Bauer verloren → gescheitert
      const pawns = game.chess.board().flat().filter((sq) => sq && sq.color === me && sq.type === 'p').length;
      const queens = game.chess.board().flat().filter((sq) => sq && sq.color === me && sq.type === 'q').length;
      if (!pawns && !queens) return 'fail';
      if (usedMoves >= level.moves && game.turn === me) return 'fail';
      return null;
    }
    if (level.goal === 'hold') {
      if (r) return r.winner && r.winner !== me ? 'fail' : 'win';
      if (usedMoves >= level.moves && game.turn === me) return 'win';
      return null;
    }
    return null;
  }

  CG.Runner = { items, fromPuzzle, givesMate, sideText, Exercise, stepsStars, starsPar, starsLessonStars, endgameStars, bossStars, endgameStatus };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
