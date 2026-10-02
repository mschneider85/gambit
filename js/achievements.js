/*
 * Erfolge (ohne DOM). Gelten in allen Modi: Die Oberfläche meldet Ereignisse, check() schaltet frei.
 * Ereignisse:
 *   { type: 'move', move, mode }                       – eigener Zug in einer Partie oder im Training
 *   { type: 'game-end', mode, outcome, elo, game, me, assisted }
 *   { type: 'puzzle', ok }
 *   { type: 'level', level, chapter, stars, chapterDone, chapterAllStars, campaignDone, campaignAllStars }
 *   { type: 'rank', index }   { type: 'day', streak }   { type: 'session', hour }
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  /** Materialbilanz (Weiß − Schwarz) aus einer FEN. */
  function material(fen) {
    let d = 0;
    for (const ch of fen.split(' ')[0]) {
      const v = VALUE[ch.toLowerCase()];
      if (v === undefined) continue;
      d += ch === ch.toUpperCase() ? v : -v;
    }
    return d;
  }

  /** Ersticktes Matt: Springer setzt matt, alle Nachbarfelder des Königs sind von eigenen Figuren belegt. */
  function smothered(game) {
    const last = game.lastMove;
    if (!last || last.piece !== 'n' || !game.result || game.result.reason !== 'checkmate') return false;
    const board = game.chess.board(); // [rank8 … rank1][a … h]
    const loser = game.turn;
    let kr = -1;
    let kf = -1;
    board.forEach((row, r) => row.forEach((sq, f) => { if (sq && sq.type === 'k' && sq.color === loser) { kr = r; kf = f; } }));
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const r = kr + dr;
        const f = kf + df;
        if (r < 0 || r > 7 || f < 0 || f > 7) continue;
        const sq = board[r][f];
        if (!sq || sq.color !== loser) return false;
      }
    }
    return true;
  }

  /**
   * Schlechteste Materialbilanz aus Sicht von me, die länger anhielt: gezählt wird nur nach eigenen Zügen,
   * und der Rückstand muss zwei eigene Züge in Folge bestehen – ein normaler Abtausch (Schlagen, Zurückschlagen)
   * zählt so nicht.
   */
  function worstMaterial(game, me) {
    let worst = 0;
    let prev = 0;
    for (const m of game.history) {
      if (m.color !== me) continue;
      const d = material(m.after) * (me === 'w' ? 1 : -1);
      worst = Math.min(worst, Math.max(d, prev));
      prev = d;
    }
    return worst;
  }

  const won = (e) => e.type === 'game-end' && e.outcome === 'win';
  const realGame = (e) => e.mode === 'pvc' || e.mode === 'online' || e.mode === 'boss';
  const mated = (e) => won(e) && e.game.result.reason === 'checkmate';

  const BASE = [
    // ---------------------------------------------------------------- Partien
    { id: 'first-win', icon: '🏅', name: 'Erster Sieg', desc: 'Gewinne eine Partie gegen den Computer oder online.', xp: 50,
      check: (e) => won(e) && realGame(e) },
    ...[[800, 'Knappenbezwinger', '🛡️'], [1200, 'Ritterschlag', '⚔️'], [1600, 'Magierjäger', '🔮'], [2000, 'Meisterstück', '👑'],
      [2500, 'Drachentöter', '🐉'], [3000, 'Das Unmögliche', '🌋']].map(([elo, name, icon]) => ({
      id: `beat-${elo}`, icon, name, desc: `Besiege den Computer mit mindestens ${elo} ELO – ohne Tipp und ohne Zugrücknahme.`, xp: Math.round(elo / 8),
      check: (e) => won(e) && e.mode === 'pvc' && e.elo >= elo && !e.assisted,
    })),
    { id: 'flawless', icon: '💎', name: 'Makellos', desc: 'Besiege den Computer (ab 1200) ohne Hilfen und ohne eine Figur zu verlieren – nur Bauern dürfen fallen.', xp: 150,
      check: (e) => won(e) && e.mode === 'pvc' && e.elo >= 1200 && !e.assisted
        && !e.game.history.some((m) => m.color !== e.me && m.captured && m.captured !== 'p') },
    { id: 'comeback', icon: '🔥', name: 'Wider alle Hoffnung', desc: 'Gewinne eine Partie, in der du zwischendurch mindestens 5 Punkte Material zurücklagst.', xp: 100,
      check: (e) => won(e) && realGame(e) && worstMaterial(e.game, e.me) <= -5 },
    { id: 'scholar', icon: '🐑', name: 'Schäfermatt', desc: 'Setze in höchstens vier Zügen matt.', xp: 60,
      check: (e) => mated(e) && realGame(e) && e.game.history.filter((m) => m.color === e.me).length <= 4 },
    { id: 'blitz', icon: '⚡', name: 'Blitzangriff', desc: 'Setze in höchstens 20 Zügen matt.', xp: 50,
      check: (e) => mated(e) && realGame(e) && e.game.history.filter((m) => m.color === e.me).length <= 20 },
    { id: 'smothered', icon: '🫢', name: 'Erstickt', desc: 'Setze mit einem Springer matt, während der König von eigenen Figuren eingemauert ist.', xp: 120,
      check: (e) => mated(e) && smothered(e.game) },
    { id: 'pawn-mate', icon: '♟️', name: 'Die Macht des Kleinen', desc: 'Setze mit einem Bauernzug matt.', xp: 80,
      check: (e) => mated(e) && e.game.lastMove.piece === 'p' },
    { id: 'castle-mate', icon: '🏰', name: 'Burgtor-Matt', desc: 'Setze mit einer Rochade matt.', xp: 150,
      check: (e) => mated(e) && /[kq]/.test(e.game.lastMove.flags) },
    { id: 'knight-mate', icon: '🐴', name: 'Rösselsprung', desc: 'Setze mit einem Springer matt.', xp: 40,
      check: (e) => mated(e) && e.game.lastMove.piece === 'n' },
    { id: 'en-passant', icon: '👻', name: 'En passant', desc: 'Schlage einen Bauern im Vorbeigehen.', xp: 30,
      check: (e) => e.type === 'move' && e.move.flags.includes('e') },
    { id: 'promote', icon: '👸', name: 'Krönung', desc: 'Wandle einen Bauern in eine Dame um.', xp: 30,
      check: (e) => e.type === 'move' && e.move.promotion === 'q' },
    { id: 'underpromote', icon: '🎭', name: 'Bescheidenheit', desc: 'Wandle einen Bauern in etwas anderes als eine Dame um.', xp: 50,
      check: (e) => e.type === 'move' && e.move.promotion && e.move.promotion !== 'q' },
    { id: 'stalemate-save', icon: '🪤', name: 'Rettung im Patt', desc: 'Erreiche ein Patt, obwohl du klar im Nachteil warst.', xp: 80,
      check: (e) => e.type === 'game-end' && realGame(e) && e.game.result.reason === 'stalemate' && material(e.game.fen) * (e.me === 'w' ? 1 : -1) <= -3 },
    { id: 'marathon', icon: '🏃', name: 'Marathon', desc: 'Spiele eine Partie mit mindestens 80 Zügen zu Ende.', xp: 60,
      check: (e) => e.type === 'game-end' && realGame(e) && e.game.ply >= 160 },
    { id: 'games-10', icon: '🍺', name: 'Stammgast', desc: 'Spiele 10 Partien.', xp: 60, goal: 10,
      count: (s) => s.stats.games, check: (e, s) => e.type === 'game-end' && s.stats.games >= 10 },
    { id: 'games-50', icon: '🎖️', name: 'Veteran', desc: 'Spiele 50 Partien.', xp: 150, goal: 50,
      count: (s) => s.stats.games, check: (e, s) => e.type === 'game-end' && s.stats.games >= 50 },
    // ---------------------------------------------------------------- Online
    { id: 'online-first', icon: '🤝', name: 'Freundschaftsspiel', desc: 'Spiele eine Online-Partie zu Ende.', xp: 40,
      check: (e) => e.type === 'game-end' && e.mode === 'online' },
    { id: 'online-win', icon: '🏹', name: 'Sieg in der Ferne', desc: 'Gewinne eine Online-Partie.', xp: 60,
      check: (e) => won(e) && e.mode === 'online' },
    { id: 'online-5', icon: '🏆', name: 'Turnierkämpfer', desc: 'Gewinne 5 Online-Partien.', xp: 150, goal: 5,
      count: (s) => s.stats.online.w, check: (e, s) => won(e) && e.mode === 'online' && s.stats.online.w >= 5 },
    // ---------------------------------------------------------------- Rätsel
    { id: 'puzzle-streak-10', icon: '👁️', name: 'Scharfer Blick', desc: 'Löse 10 Rätsel in Folge ohne Fehler.', xp: 100, goal: 10,
      count: (s) => s.stats.puzzles.best, check: (e, s) => e.type === 'puzzle' && s.stats.puzzles.streak >= 10 },
    { id: 'puzzles-50', icon: '🧩', name: 'Rätselfreund', desc: 'Löse 50 Rätsel.', xp: 80, goal: 50,
      count: (s) => s.stats.puzzles.solved, check: (e, s) => e.type === 'puzzle' && s.stats.puzzles.solved >= 50 },
    { id: 'puzzles-200', icon: '🧠', name: 'Rätselmeister', desc: 'Löse 200 Rätsel.', xp: 200, goal: 200,
      count: (s) => s.stats.puzzles.solved, check: (e, s) => e.type === 'puzzle' && s.stats.puzzles.solved >= 200 },
    // ---------------------------------------------------------------- Training
    { id: 'first-level', icon: '👣', name: 'Erste Schritte', desc: 'Schließe dein erstes Trainingslevel ab.', xp: 20,
      check: (e) => e.type === 'level' && e.stars > 0 },
    { id: 'three-stars', icon: '🌟', name: 'Glanzleistung', desc: 'Schließe ein Level mit drei Sternen ab.', xp: 20,
      check: (e) => e.type === 'level' && e.stars === 3 },
    { id: 'chapter-stars', icon: '✨', name: 'Sternensammler', desc: 'Hole alle Sterne eines Kapitels.', xp: 100,
      check: (e) => e.type === 'level' && e.chapterAllStars },
    { id: 'campaign-stars', icon: '🌌', name: 'Sternenhimmel', desc: 'Hole alle Sterne der ganzen Kampagne.', xp: 500,
      check: (e) => e.type === 'level' && e.campaignAllStars },
    // ---------------------------------------------------------------- Rang & Treue
    { id: 'rank-knight', icon: '⚔️', name: 'Zum Ritter geschlagen', desc: 'Erreiche den Rang Ritter.', xp: 0,
      check: (e, s) => CG.Progress && new CG.Progress({ load: () => s, save() {} }).rankIndex() >= 2 },
    { id: 'rank-dragon', icon: '🐲', name: 'Drachenkönig', desc: 'Erreiche den höchsten Rang.', xp: 0,
      check: (e, s) => CG.Progress && new CG.Progress({ load: () => s, save() {} }).rankIndex() >= 6 },
    { id: 'days-3', icon: '📅', name: 'Dranbleiben', desc: 'Spiele an 3 Tagen in Folge.', xp: 40, goal: 3,
      count: (s) => s.stats.days.best, check: (e, s) => e.type === 'day' && s.stats.days.streak >= 3 },
    { id: 'days-7', icon: '🗓️', name: 'Treue Seele', desc: 'Spiele an 7 Tagen in Folge.', xp: 120, goal: 7,
      count: (s) => s.stats.days.best, check: (e, s) => e.type === 'day' && s.stats.days.streak >= 7 },
    { id: 'night-owl', icon: '🦉', name: 'Nachteule', desc: 'Spiele zwischen Mitternacht und vier Uhr morgens.', xp: 20, secret: true,
      check: (e) => e.type === 'session' && e.hour >= 0 && e.hour < 4 },
  ];

  let cache = null;
  /** Alle Erfolge: feste plus je einer pro Trainingskapitel. */
  function list() {
    if (cache) return cache;
    const chapters = (CG.Campaign && CG.Campaign.chapters) || [];
    const factor = (CG.progressUtil && CG.progressUtil.XP.chapterFactor) || (() => 1);
    const perChapter = chapters.map((c, ci) => ({
      id: `chapter-${c.id}`, icon: c.icon, name: c.badge || c.title, desc: `Schließe das Kapitel „${c.title}“ ab.`, xp: Math.round(80 * factor(ci)),
      check: (e) => e.type === 'level' && e.chapter === c.id && e.chapterDone,
    }));
    const at = BASE.findIndex((a) => a.id === 'campaign-stars') + 1; // nach den Trainings-Erfolgen
    cache = [...BASE.slice(0, at), ...perChapter, ...BASE.slice(at)];
    return cache;
  }

  /** Ereignis prüfen; neu freigeschaltete Erfolge werden in progress eingetragen und zurückgegeben. */
  function check(event, progress) {
    const out = [];
    for (const a of list()) {
      if (progress.hasAch(a.id)) continue;
      let hit = false;
      try { hit = a.check(event, progress.state); } catch (err) { hit = false; }
      if (hit && progress.unlockAch(a)) out.push(a);
    }
    return out;
  }

  /** Fortschrittsbalken für zählbare Erfolge: [aktuell, Ziel] oder null. */
  function progressOf(a, state) {
    if (!a.goal || !a.count) return null;
    return [Math.min(a.goal, a.count(state)), a.goal];
  }

  CG.Achievements = { list, check, progressOf, util: { material, smothered, worstMaterial } };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
