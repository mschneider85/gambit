/*
 * Fortschritt des Spielers (ohne DOM): Erfahrung (XP) und Rang, Sterne je Trainingslevel, Freischaltung,
 * Erfolge und Statistik. Alles liegt im Browser (localStorage) – zum Gerätewechsel gibt es Export/Import
 * als Code. Ereignisse ('xp', 'rank', 'achievement') gehen an die Oberfläche (Toasts, Fanfaren).
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const KEY = 'gambit-progress';
  const VERSION = 1;

  const RANKS = [
    { xp: 0, name: 'Bauer', icon: '♟️' },
    { xp: 300, name: 'Knappe', icon: '🛡️' },
    { xp: 1000, name: 'Ritter', icon: '⚔️' },
    { xp: 2500, name: 'Burgherr', icon: '🏰' },
    { xp: 4500, name: 'Magier', icon: '🔮' },
    { xp: 7000, name: 'Großmeister', icon: '👑' },
    { xp: 12000, name: 'Drachenkönig', icon: '🐉' },
  ];

  const XP = {
    levelBase: 20, perStar: 10, // erstes Abschließen: 20 + 10 je Stern; mehr Sterne später: 10 je neuem Stern – jeweils × chapterFactor
    chapterFactor: (ci) => 1 + 0.3 * ci, // spätere Kapitel sind schwerer und zählen mehr (Kapitel 1: ×1, Kapitel 10: ×3,7)
    win: (elo) => Math.round(Math.max(20, elo / 10)), draw: (elo) => Math.round(Math.max(10, elo / 25)), loss: 8,
    onlineWin: 100, onlineDraw: 50, onlineLoss: 20,
  };

  const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function fresh() {
    return {
      v: VERSION, xp: 0, name: '',
      levels: {}, // id → { stars, tries, at }
      ach: {}, // id → Zeitstempel
      stats: {
        games: 0, wins: 0, draws: 0, losses: 0,
        pvc: {}, // Stufen-ELO → { w, d, l }
        bestWin: 0, // höchste besiegte ELO
        online: { w: 0, d: 0, l: 0 },
        puzzles: { solved: 0, failed: 0, streak: 0, best: 0 },
        days: { last: null, streak: 0, best: 0 },
      },
    };
  }

  const defaultStorage = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ohne Speicher weiter */ } },
  };

  /** Ältere oder unvollständige Stände auf die aktuelle Form bringen. */
  function migrate(s) {
    const base = fresh();
    if (!s || typeof s !== 'object') return base;
    const out = { ...base, ...s, stats: { ...base.stats, ...(s.stats || {}) } };
    for (const k of ['online', 'puzzles', 'days']) out.stats[k] = { ...base.stats[k], ...((s.stats || {})[k] || {}) };
    out.levels = s.levels || {};
    out.ach = s.ach || {};
    out.v = VERSION;
    return out;
  }

  class Progress {
    constructor(storage = defaultStorage) {
      this.storage = storage;
      this.s = migrate(storage.load());
      this.listeners = {};
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    emit(ev, d) { for (const fn of this.listeners[ev] || []) fn(d); }
    save() { this.storage.save(this.s); }

    get state() { return this.s; }

    /* ---------------------------------------------------------- Rang */
    rankIndex(xp = this.s.xp) { let i = 0; RANKS.forEach((r, k) => { if (xp >= r.xp) i = k; }); return i; }
    rank(xp = this.s.xp) {
      const i = this.rankIndex(xp);
      const r = RANKS[i];
      const next = RANKS[i + 1] || null;
      return { ...r, index: i, next, progress: next ? (xp - r.xp) / (next.xp - r.xp) : 1, toNext: next ? next.xp - xp : 0 };
    }

    addXp(n, reason) {
      if (!n) return null;
      const before = this.rankIndex();
      this.s.xp += n;
      this.save();
      this.emit('xp', { amount: n, reason, total: this.s.xp });
      const after = this.rankIndex();
      if (after > before) { const r = this.rank(); this.emit('rank', r); return r; }
      return null;
    }

    /* ---------------------------------------------------------- Training */
    stars(id) { return (this.s.levels[id] && this.s.levels[id].stars) || 0; }
    done(id) { return !!this.s.levels[id] && this.s.levels[id].stars > 0; }

    /** Level abgeschlossen (stars 1–3; 0 = nicht geschafft, zählt nur den Versuch). → { first, gained, xp }
     *  factor: XP-Multiplikator des Kapitels (XP.chapterFactor). */
    levelResult(id, stars, factor = 1) {
      const old = this.s.levels[id] || { stars: 0, tries: 0 };
      const rec = { ...old, tries: (old.tries || 0) + 1 };
      let xp = 0;
      const first = stars > 0 && !old.stars;
      if (stars > old.stars) {
        xp = Math.round(factor * (first ? XP.levelBase + XP.perStar * stars : XP.perStar * (stars - old.stars)));
        rec.stars = stars;
        rec.at = Date.now();
      }
      this.s.levels[id] = rec;
      this.save();
      return { first, gained: Math.max(0, stars - old.stars), xp };
    }

    puzzle(ok) {
      const p = this.s.stats.puzzles;
      if (ok) { p.solved++; p.streak++; p.best = Math.max(p.best, p.streak); } else { p.failed++; p.streak = 0; }
      this.save();
      return p;
    }

    /* ---------------------------------------------------------- Partien */
    /** r: { mode: 'pvc'|'online'|'local', outcome: 'win'|'draw'|'loss', elo } → XP */
    gameResult(r) {
      const st = this.s.stats;
      if (r.mode === 'local') { st.games++; this.save(); return 0; }
      st.games++;
      if (r.outcome === 'win') st.wins++; else if (r.outcome === 'draw') st.draws++; else st.losses++;
      let xp = 0;
      if (r.mode === 'pvc') {
        const b = (st.pvc[r.elo] = st.pvc[r.elo] || { w: 0, d: 0, l: 0 });
        b[r.outcome[0]]++;
        if (r.outcome === 'win') st.bestWin = Math.max(st.bestWin, r.elo);
        xp = r.outcome === 'win' ? XP.win(r.elo) : r.outcome === 'draw' ? XP.draw(r.elo) : XP.loss;
      } else if (r.mode === 'online') {
        st.online[r.outcome[0]]++;
        xp = r.outcome === 'win' ? XP.onlineWin : r.outcome === 'draw' ? XP.onlineDraw : XP.onlineLoss;
      }
      this.save();
      return xp;
    }

    /** Einmal am Tag beim Spielen: Serie aufeinanderfolgender Tage. */
    touchDay(now = new Date()) {
      const d = this.s.stats.days;
      const t = today(now);
      if (d.last === t) return d;
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      d.streak = d.last === today(y) ? d.streak + 1 : 1;
      d.best = Math.max(d.best, d.streak);
      d.last = t;
      this.save();
      return d;
    }

    /* ---------------------------------------------------------- Erfolge */
    hasAch(id) { return !!this.s.ach[id]; }
    unlockAch(a) {
      if (this.s.ach[a.id]) return false;
      this.s.ach[a.id] = Date.now();
      this.save();
      this.emit('achievement', a);
      if (a.xp) this.addXp(a.xp, `Erfolg: ${a.name}`);
      return true;
    }

    /* ---------------------------------------------------------- Export / Import */
    exportCode() {
      const json = JSON.stringify(this.s);
      const b64 = btoa(unescape(encodeURIComponent(json)));
      return `GAMBIT1:${b64}`;
    }
    importCode(code) {
      const m = String(code).trim().match(/^GAMBIT1:([A-Za-z0-9+/=\s]+)$/);
      if (!m) throw new Error('Das ist kein gültiger Spielstand-Code.');
      let data;
      try { data = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/\s+/g, ''))))); } catch (e) { throw new Error('Der Code ist beschädigt.'); }
      if (!data || typeof data.xp !== 'number') throw new Error('Der Code enthält keinen Spielstand.');
      this.s = migrate(data);
      this.save();
      return this.s;
    }
    reset() { this.s = fresh(); this.save(); }
  }

  CG.Progress = Progress;
  CG.progressUtil = { RANKS, XP, today, fresh, migrate };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
