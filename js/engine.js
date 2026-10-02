/*
 * Stockfish über UCI. Im Browser läuft die Engine in einem Web Worker (js/vendor/stockfish/, erst beim
 * ersten Gebrauch geladen), in Node-Tests über das npm-Paket – beides über denselben Transport
 * { post(cmd), onLine(fn) }. Suchen laufen nacheinander (Warteschlange), Optionen werden nur bei Änderung gesetzt.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const BUILD = (G.document && document.currentScript && new URL(document.currentScript.src).searchParams.get('v')) || 'dev';

  /** "info depth 12 … multipv 2 score cp -31 … pv e2e4 e7e5" → Objekt */
  function parseInfo(line) {
    const t = line.split(' ');
    const o = { multipv: 1 };
    for (let i = 1; i < t.length; i++) {
      const k = t[i];
      if (k === 'depth') o.depth = +t[++i];
      else if (k === 'multipv') o.multipv = +t[++i];
      else if (k === 'score') { const kind = t[++i]; const v = +t[++i]; o.score = kind === 'mate' ? { mate: v } : { cp: v }; }
      else if (k === 'nodes') o.nodes = +t[++i];
      else if (k === 'pv') { o.pv = t.slice(i + 1); break; }
    }
    return o;
  }

  /** Bewertung als Zahl in Bauerneinheiten×100 aus Sicht der ziehenden Seite (Matt = ±100000 − Abstand). */
  function scoreValue(s) {
    if (!s) return 0;
    if (s.mate !== undefined) return s.mate > 0 ? 100000 - s.mate : -100000 - s.mate;
    return s.cp;
  }

  class Engine {
    constructor(transport) {
      this.t = transport;
      this.waiters = [];
      this.options = {};
      this.queue = Promise.resolve();
      this.job = null;
      this.t.onLine((line) => this.line(String(line)));
      this.ready = this.cmd('uci', 'uciok').then(() => this.cmd('isready', 'readyok'));
    }

    static browser() {
      const w = new Worker(`js/vendor/stockfish/stockfish.js?v=${BUILD}`);
      const fns = [];
      w.onmessage = (e) => fns.forEach((f) => f(e.data));
      w.onerror = (e) => console.warn('Stockfish:', e.message || e);
      return new Engine({ post: (c) => w.postMessage(c), onLine: (f) => fns.push(f), terminate: () => w.terminate() });
    }

    line(line) {
      for (const w of this.waiters.slice()) {
        if (line.startsWith(w.token)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(line); }
      }
      const j = this.job;
      if (!j) return;
      if (line.startsWith('info') && line.includes(' pv ')) {
        const info = parseInfo(line);
        j.lines[info.multipv - 1] = info;
        if (j.onInfo) j.onInfo(info);
      } else if (line.startsWith('bestmove')) {
        this.job = null;
        const best = line.split(' ')[1];
        j.resolve({ bestmove: best === '(none)' ? null : best, lines: j.lines.filter(Boolean) });
      }
    }

    cmd(c, token) {
      const p = token ? new Promise((resolve) => this.waiters.push({ token, resolve })) : Promise.resolve();
      this.t.post(c);
      return p;
    }

    async setOptions(opts) {
      let changed = false;
      for (const [k, v] of Object.entries(opts)) {
        if (this.options[k] === v) continue;
        this.options[k] = v;
        this.t.post(`setoption name ${k} value ${v}`);
        changed = true;
      }
      if (changed) await this.cmd('isready', 'readyok');
    }

    /**
     * Suche: { fen, moves: [uci…], movetime | depth | nodes, multipv, options, onInfo }
     * → { bestmove, lines: [{ multipv, depth, score, pv }] } (Bewertung aus Sicht der ziehenden Seite)
     */
    search(o) {
      const run = async () => {
        await this.ready;
        await this.setOptions({ MultiPV: o.multipv || 1, ...(o.options || {}) });
        const pos = `position fen ${o.fen}${o.moves && o.moves.length ? ` moves ${o.moves.join(' ')}` : ''}`;
        this.t.post(pos);
        const limits = o.depth ? `depth ${o.depth}` : o.nodes ? `nodes ${o.nodes}` : `movetime ${o.movetime || 500}`;
        return new Promise((resolve) => {
          this.job = { resolve, lines: [], onInfo: o.onInfo };
          this.t.post(`go ${limits}`);
        });
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }

    /** Laufende Suche abbrechen (liefert trotzdem ein bestmove). */
    stop() { if (this.job) this.t.post('stop'); }

    /** Neue Partie: Hash leeren. */
    newGame() { this.queue = this.queue.then(() => this.cmd('ucinewgame').then(() => this.cmd('isready', 'readyok'))); return this.queue; }

    terminate() { if (this.t.terminate) this.t.terminate(); }
  }

  let shared = null;
  /** Die eine Engine der Seite (lazy). */
  function get() {
    if (!shared) shared = Engine.browser();
    return shared;
  }

  CG.Engine = Engine;
  CG.engine = get;
  CG.engineUtil = { parseInfo, scoreValue };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
