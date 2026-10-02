/*
 * Partie ohne DOM (läuft auch in Node): Züge über chess.js, Partieende, Uhren, geschlagene Figuren.
 * Alle Modi (Computer, Online, Training) bauen darauf auf; Ereignisse 'move', 'undo', 'end' gehen
 * an die Oberfläche und an die Achievements.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const Lib = G.ChessLib || (typeof require === 'function' ? require('./vendor/chess.js') : null);
  const { Chess } = Lib;

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const NAMES = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const colorName = (c) => (c === 'w' ? 'Weiß' : 'Schwarz');

  const REASONS = {
    checkmate: 'Schachmatt', stalemate: 'Patt', insufficient: 'Zu wenig Material', threefold: 'Dreifache Wiederholung',
    fifty: '50-Züge-Regel', timeout: 'Zeit abgelaufen', resign: 'Aufgabe', agreement: 'Remis vereinbart',
    abandon: 'Gegner hat die Partie verlassen', timeoutDraw: 'Zeit abgelaufen, aber kein Mattmaterial',
  };

  /** 'e7e8q' → { from, to, promotion } */
  function parseUci(uci) {
    if (!uci || uci.length < 4) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
  }
  const toUci = (m) => m.from + m.to + (m.promotion || '');

  /** Kann diese Seite mit ihrem Material überhaupt noch mattsetzen? (für Zeitüberschreitung) */
  function canMate(chess, color) {
    const pieces = [];
    for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color && sq.type !== 'k') pieces.push(sq.type);
    if (pieces.some((p) => p === 'p' || p === 'r' || p === 'q')) return true;
    return pieces.length >= 2; // zwei Leichtfiguren können (theoretisch) mattsetzen
  }

  class Game {
    /** opts: { fen, moves: ['e2e4', …], free: true für Stellungen ohne Könige (Lektionen) } */
    constructor(opts = {}) {
      this.startFen = opts.fen || START;
      this.free = !!opts.free;
      this.chess = new Chess(this.startFen, { skipValidation: this.free });
      this.history = []; // verbose Züge von chess.js
      this.result = null; // { winner: 'w'|'b'|null, reason }
      this.listeners = {};
      for (const u of opts.moves || []) this.move(parseUci(u), { silent: true });
    }

    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, data) { for (const fn of this.listeners[ev] || []) fn(data, this); }

    get fen() { return this.chess.fen(); }
    get turn() { return this.chess.turn(); }
    get ply() { return this.history.length; }
    get over() { return !!this.result; }
    get lastMove() { return this.history[this.history.length - 1] || null; }
    inCheck() { return this.chess.inCheck(); }
    piece(sq) { return this.chess.get(sq) || null; }

    /** Legale Züge (verbose), optional nur von einem Feld. */
    legal(square) {
      if (this.result) return [];
      return this.chess.moves(square ? { square, verbose: true } : { verbose: true });
    }

    /** Muss bei diesem Zug umgewandelt werden? */
    needsPromotion(from, to) {
      return this.legal(from).some((m) => m.to === to && m.promotion);
    }

    /** Zug ausführen ({from,to,promotion}, UCI oder SAN). Liefert den Zug oder null, wenn er nicht geht. */
    move(m, { silent = false } = {}) {
      if (this.result || !m) return null;
      if (typeof m === 'string') m = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m) ? parseUci(m) : m;
      let mv;
      try { mv = this.chess.move(m); } catch (e) { return null; }
      if (!mv) return null;
      if (this.free) this.chess.setTurn(mv.color); // Lektion: nur eine Seite zieht
      this.history.push(mv);
      if (!silent) this.emit('move', mv);
      if (!this.free) this.checkEnd(silent);
      return mv;
    }

    /** Letzte n Züge zurücknehmen (hebt auch ein Partieende auf). */
    undo(n = 1) {
      let done = 0;
      while (done < n && this.history.length) {
        this.chess.undo();
        this.history.pop();
        done++;
      }
      if (done) { this.result = null; this.emit('undo', done); }
      return done;
    }

    checkEnd(silent) {
      const c = this.chess;
      let r = null;
      if (c.isCheckmate()) r = { winner: other(c.turn()), reason: 'checkmate' };
      else if (c.isStalemate()) r = { winner: null, reason: 'stalemate' };
      else if (c.isInsufficientMaterial()) r = { winner: null, reason: 'insufficient' };
      else if (c.isThreefoldRepetition()) r = { winner: null, reason: 'threefold' };
      else if (c.isDrawByFiftyMoves()) r = { winner: null, reason: 'fifty' };
      if (r) this.finish(r.winner, r.reason, silent);
      return r;
    }

    /** Partie beenden (Aufgabe, Zeit, Remis …). Bei Zeitüberschreitung ohne Mattmaterial des Gegners: Remis. */
    finish(winner, reason, silent) {
      if (this.result) return this.result;
      if (reason === 'timeout' && winner && !canMate(this.chess, winner)) { winner = null; reason = 'timeoutDraw'; }
      this.result = { winner, reason, text: REASONS[reason] || reason };
      if (!silent) this.emit('end', this.result);
      return this.result;
    }

    /** FEN nach ply Halbzügen (0 = Start). */
    fenAt(ply) {
      if (ply >= this.history.length) return this.fen;
      return ply <= 0 ? this.startFen : this.history[ply - 1].after;
    }

    uciMoves() { return this.history.map(toUci); }

    /** Geschlagene Figuren je Farbe (die Farbe, der sie gehörten) und Materialbilanz aus Sicht von Weiß. */
    captured() {
      const out = { w: [], b: [] };
      for (const m of this.history) {
        if (m.captured) out[other(m.color)].push(m.captured);
        if (m.promotion) out[m.color].push('p'); // der Bauer „verschwindet“
      }
      const sort = (a, b) => VALUE[b] - VALUE[a];
      out.w.sort(sort);
      out.b.sort(sort);
      let w = 0;
      let b = 0;
      for (const row of this.chess.board()) for (const sq of row) if (sq) { if (sq.color === 'w') w += VALUE[sq.type]; else b += VALUE[sq.type]; }
      return { ...out, diff: w - b };
    }

    pgn(headers = {}) {
      const c = new Chess(this.startFen, { skipValidation: this.free });
      const res = this.result ? (this.result.winner === 'w' ? '1-0' : this.result.winner === 'b' ? '0-1' : '1/2-1/2') : '*';
      const h = { Event: 'Gambit', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), ...headers, Result: res };
      if (this.startFen !== START) { h.SetUp = '1'; h.FEN = this.startFen; }
      for (const [k, v] of Object.entries(h)) c.setHeader(k, String(v));
      for (const m of this.history) c.move({ from: m.from, to: m.to, promotion: m.promotion });
      return c.pgn();
    }

    /** Zum Speichern/Übertragen: Startstellung + Züge. */
    serialize() { return { fen: this.startFen, moves: this.uciMoves(), result: this.result }; }
    static from(data) {
      const g = new Game({ fen: data.fen, moves: data.moves });
      if (data.result && !g.result) g.result = data.result;
      return g;
    }
  }

  /*
   * Schachuhr: Zeit in ms, Inkrement pro Zug. Läuft nach Systemzeit (nicht nach Timer-Ticks), damit
   * gedrosselte Hintergrund-Tabs nichts verfälschen.
   */
  class Clock {
    constructor({ base, inc = 0 }) {
      this.base = base;
      this.inc = inc;
      this.left = { w: base, b: base };
      this.running = null; // Farbe, deren Uhr läuft
      this.since = 0;
    }
    now() { return Date.now(); }
    time(c) { return Math.max(0, this.left[c] - (this.running === c ? this.now() - this.since : 0)); }
    start(c) { this.stop(); this.running = c; this.since = this.now(); }
    stop() {
      if (this.running) this.left[this.running] = this.time(this.running);
      this.running = null;
    }
    /** Zug gemacht: Inkrement für den Ziehenden, Uhr des Gegners startet. */
    press(c) {
      const was = this.running === c;
      this.stop();
      if (was || this.running === null) this.left[c] += this.inc;
      this.start(other(c));
    }
    set(c, ms) { if (this.running === c) this.since = this.now(); this.left[c] = ms; }
    flagged() { return ['w', 'b'].find((c) => this.time(c) <= 0) || null; }
    serialize() { return { base: this.base, inc: this.inc, w: this.time('w'), b: this.time('b'), running: this.running }; }
    static from(d) {
      const c = new Clock(d);
      c.left = { w: d.w, b: d.b };
      return c;
    }
  }

  /** Züge in deutscher Kurzschrift anzeigen: Sf3, Lb5, Txe1, Dh5, e8=D (PGN bleibt international) */
  const DE = { K: 'K', Q: 'D', R: 'T', B: 'L', N: 'S' };
  const deSan = (san) => san.replace(/[KQRBN]/g, (ch) => DE[ch]);

  /** 1:05 / 0:09.4 (unter 10 s mit Zehnteln) */
  function formatClock(ms) {
    if (ms < 10000) return `0:${(Math.floor(ms / 100) / 10).toFixed(1).padStart(4, '0')}`;
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  CG.Chess = Chess;
  CG.Game = Game;
  CG.Clock = Clock;
  CG.chessUtil = { START, VALUE, NAMES, REASONS, other, colorName, parseUci, toUci, canMate, formatClock, deSan };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
