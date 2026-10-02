/*
 * Gegen den Computer: Einstellungen (Farbe, ELO, Bedenkzeit, Hilfen), Partie, Fortsetzen nach Neuladen,
 * Ergebnis und Analyse. Außerdem „zu zweit an einem Gerät“ (ohne Computer).
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { $, esc, store, settings, modal, toast, progress, achieve, sleep } = CG.UI;
  const { other, colorName } = CG.chessUtil;
  const S = CG.Strength;

  const TCS = [[0, 0, 'Ohne'], [5, 3, '5+3'], [10, 0, '10+0'], [15, 10, '15+10'], [30, 0, '30+0']];
  const ME_ICON = '🧝';

  let view = null;
  const V = () => (view = view || new CG.GameView());

  /* ------------------------------------------------------------ Einstellungsdialog */
  function setupDialog() {
    const last = store.get('pvc-setup', { elo: 800, color: 'w', tc: 0, assists: true });
    const d = modal(`
      <button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button>
      <h2>Gegen den Computer</h2>
      <div class="field"><span class="label">Gegner</span>
        <div class="elo-pick"><span class="elo-icon" id="elo-icon"></span>
          <div class="elo-info"><span class="elo-num" id="elo-num"></span><b id="elo-name"></b><small id="elo-text"></small></div></div>
        <input type="range" id="elo" min="${S.MIN}" max="${S.MAX}" step="50" value="${last.elo}" aria-label="ELO des Computers">
        <div class="elo-stops">${S.LEVELS.map((l) => `<button data-elo="${l.elo}" title="${esc(l.name)} (${l.elo})">${l.icon}</button>`).join('')}</div>
      </div>
      <div class="field"><span class="label">Deine Farbe</span>
        <div class="seg" id="pick-color"><button data-v="w">♔ Weiß</button><button data-v="r">🎲 Zufall</button><button data-v="b">♚ Schwarz</button></div></div>
      <div class="field"><span class="label">Bedenkzeit</span>
        <div class="seg" id="pick-tc">${TCS.map(([m, i, l], k) => `<button data-v="${k}">${l}</button>`).join('')}</div></div>
      <label class="check-row"><input type="checkbox" id="assists" ${last.assists ? 'checked' : ''}> Hilfen erlauben (Tipp, Zug zurück)</label>
      <div class="buttons"><button class="btn btn-primary" id="pvc-go">Partie beginnen</button></div>`);
    const el = d.el;
    const state = { ...last };
    const showElo = () => {
      const elo = +el.querySelector('#elo').value;
      const l = S.level(elo);
      el.querySelector('#elo-icon').textContent = l.icon;
      el.querySelector('#elo-name').textContent = l.name;
      el.querySelector('#elo-num').textContent = elo;
      el.querySelector('#elo-text').textContent = l.text;
      state.elo = elo;
    };
    el.querySelector('#elo').addEventListener('input', showElo);
    el.querySelectorAll('[data-elo]').forEach((b) => b.addEventListener('click', () => { el.querySelector('#elo').value = b.dataset.elo; showElo(); }));
    const seg = (id, key, conv) => {
      const box = el.querySelector(id);
      const mark = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('active', conv(b.dataset.v) === state[key]));
      box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state[key] = conv(b.dataset.v); mark(); } });
      mark();
    };
    seg('#pick-color', 'color', (v) => v);
    seg('#pick-tc', 'tc', (v) => +v);
    showElo();
    el.querySelector('#pvc-go').addEventListener('click', () => {
      state.assists = el.querySelector('#assists').checked;
      store.set('pvc-setup', state);
      d.close();
      const color = state.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : state.color;
      startPvC({ elo: state.elo, color, tc: state.tc, assists: state.assists });
    });
  }

  /* ------------------------------------------------------------ Partie */
  let session = null;

  /** o: { elo, color, tc (Index in TCS), assists, saved? } */
  function startPvC(o) {
    const level = S.level(o.elo);
    const game = o.saved ? CG.Game.from(o.saved.game) : new CG.Game();
    const [min, inc] = TCS[o.tc] || TCS[0];
    let clock = null;
    if (min) clock = o.saved && o.saved.clock ? CG.Clock.from(o.saved.clock) : new CG.Clock({ base: min * 60000, inc: inc * 1000 });
    const me = o.color;
    const cpu = other(me);
    const s = (session = { ...o, game, clock, me, cpu, level, assisted: !!(o.saved && o.saved.assisted), token: 0, analysed: null });
    const engine = CG.engine();
    const players = {
      [me]: { name: settings.name || 'Du', icon: ME_ICON },
      [cpu]: { name: level.name, sub: String(o.elo), icon: level.icon },
    };
    const actions = [];
    if (o.assists) {
      actions.push({ id: 'hint', label: '💡 Tipp', onClick: () => hint() });
      actions.push({ id: 'undo', label: '↶ Zurück', onClick: () => takeback() });
    }
    actions.push({ id: 'draw', label: '½ Remis', title: 'Remis anbieten', onClick: () => offerDraw() });
    actions.push({ id: 'resign', label: '🏳️ Aufgeben', cls: 'btn-secondary btn-danger', onClick: () => resign() });
    V().start({
      mode: 'pvc', title: `${level.icon} ${level.name} · ${o.elo}`, sub: clock ? `Bedenkzeit ${TCS[o.tc][2]}` : 'Ohne Uhr',
      game, me, players, clock, actions, clockFromStart: false,
      canMove: () => session === s && !s.thinking,
      onUserMove: () => { V().board.setArrows([]); save(); cpuTurn(); },
      onFlag: (c) => { game.finish(other(c), 'timeout'); V().ended(); },
      onBack: () => leave(),
      onEnd: (r) => finished(r),
    });
    CG.UI.touchDay();
    if (!o.saved) engine.newGame();
    if (clock && o.saved && !game.over && game.ply > 0) clock.start(game.turn);
    cpuTurn();
  }

  function save() {
    const s = session;
    if (!s || s.game.over) return;
    store.set('pvc-save', { elo: s.elo, color: s.me, tc: s.tc, assists: s.assists, assisted: s.assisted, game: s.game.serialize(), clock: s.clock ? s.clock.serialize() : null, at: Date.now() });
  }

  async function cpuTurn() {
    const s = session;
    if (!s || s.game.over || s.game.turn !== s.cpu) return;
    const token = ++s.token;
    s.thinking = true;
    V().setThinking(s.cpu);
    const t0 = Date.now();
    let uci = null;
    try {
      uci = await S.chooseMove({ engine: CG.engine(), fen: s.game.fen, elo: s.elo, legal: s.game.legal().map(CG.uciOf) });
    } catch (e) { console.warn(e); }
    // Natürlich wirkende Bedenkzeit: nie sofort, bei Uhr etwas kürzer
    const want = (s.clock ? 350 : 650) + Math.random() * (s.clock ? 500 : 900);
    const wait = want - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (session !== s || token !== s.token || s.game.over) return;
    s.thinking = false;
    V().setThinking(null);
    if (!uci || !V().play(uci)) {
      // Sollte nie passieren – zur Sicherheit ein beliebiger legaler Zug
      const any = s.game.legal()[0];
      if (any) V().play(CG.uciOf(any));
    }
    save();
  }

  async function hint() {
    const s = session;
    if (!s || s.game.over || s.thinking || s.game.turn !== s.me) return;
    s.assisted = true;
    V().setAction('hint', { disabled: true });
    const r = await S.bestMove(CG.engine(), s.game.fen, 900);
    V().setAction('hint', { disabled: false });
    if (session !== s || !r.bestmove || s.game.turn !== s.me) return;
    const m = CG.chessUtil.parseUci(r.bestmove);
    V().board.setArrows([{ from: m.from, to: m.to, color: 'green' }]);
  }

  function takeback() {
    const s = session;
    if (!s || s.thinking || s.game.over) return;
    const n = s.game.turn === s.me ? 2 : 1;
    if (s.game.ply < n) return;
    s.assisted = true;
    s.token++;
    V().undo(n);
    V().board.setArrows([]);
    save();
    cpuTurn();
  }

  async function offerDraw() {
    const s = session;
    if (!s || s.game.over || s.thinking) return;
    if (s.game.ply < 20) { toast(`${s.level.name} lehnt ab – die Partie hat ja gerade erst begonnen.`); return; }
    const ply = s.game.ply;
    const turn = s.game.turn;
    const r = await S.bestMove(CG.engine(), s.game.fen, 500);
    // Inzwischen gezogen? Dann gilt die Bewertung nicht mehr – das Angebot verfällt
    if (session !== s || s.game.over || s.game.ply !== ply) return;
    const sc = r.lines[0] ? CG.engineUtil.scoreValue(r.lines[0].score) : 0;
    const forCpu = turn === s.cpu ? sc : -sc;
    if (forCpu < -60 || (Math.abs(forCpu) < 25 && s.game.ply > 60)) {
      toast(`${s.level.name} nimmt das Remis an.`);
      s.game.finish(null, 'agreement');
      V().ended();
    } else toast(`${s.level.name} lehnt das Remis ab.`);
  }

  async function resign() {
    const s = session;
    if (!s || s.game.over) return;
    const ok = await CG.UI.ask('Aufgeben?', 'Die Partie zählt dann als verloren.', [{ label: 'Weiterspielen', value: false }, { label: 'Aufgeben', value: true, primary: true }]);
    if (!ok || session !== s || s.game.over) return;
    s.game.finish(s.cpu, 'resign');
    V().ended();
  }

  async function leave() {
    const s = session;
    if (s && !s.game.over && s.game.ply > 0) {
      const v = await CG.UI.ask('Partie unterbrechen?', 'Du kannst sie später im Menü fortsetzen.', [{ label: 'Weiterspielen', value: 'stay' }, { label: 'Zum Menü', value: 'leave', primary: true }]);
      if (v !== 'leave') return;
      save();
    }
    if (s) { s.token++; s.thinking = false; CG.engine().stop(); }
    session = null;
    V().stop();
    CG.Menu.open();
  }

  function finished(r) {
    const s = session;
    if (!s) return;
    store.del('pvc-save');
    s.token++;
    V().setThinking(null);
    const outcome = r.winner === s.me ? 'win' : r.winner === s.cpu ? 'loss' : 'draw';
    CG.Audio.play(outcome === 'win' ? 'victory' : outcome === 'loss' ? 'defeat' : 'tie');
    // Mit Tipp oder Zugrücknahme gibt es nur die halbe XP
    const full = progress.gameResult({ mode: 'pvc', outcome, elo: s.elo });
    const xp = s.assisted ? Math.round(full / 2) : full;
    achieve({ type: 'game-end', mode: 'pvc', outcome, elo: s.elo, game: s.game, me: s.me, assisted: s.assisted });
    progress.addXp(xp, 'Partie');
    V().setActions([
      { id: 'again', label: '⚔️ Revanche', cls: 'btn-primary', onClick: () => startPvC({ elo: s.elo, color: other(s.me), tc: s.tc, assists: s.assists }) },
      { id: 'analyse', label: '🔍 Analyse', onClick: () => analyse() },
      { id: 'pgn', label: '📋 PGN', onClick: () => CG.UI.copy(s.game.pgn(pgnHeaders(s)), 'PGN kopiert') },
    ]);
    setTimeout(() => resultDialog(s, r, outcome, xp, s.assisted && full > 0), r.reason === 'checkmate' ? 900 : 300);
  }

  function pgnHeaders(s) {
    const me = settings.name || 'Spieler';
    const cpu = `Computer ${s.level.name} (${s.elo})`;
    return { White: s.me === 'w' ? me : cpu, Black: s.me === 'b' ? me : cpu };
  }

  function resultDialog(s, r, outcome, xp, halved) {
    const title = { win: 'Sieg!', loss: 'Niederlage', draw: 'Remis' }[outcome];
    const icon = { win: '🏆', loss: '🥀', draw: '🤝' }[outcome];
    const d = modal(`<div class="big">${icon}</div><div class="result-title">${title}</div>
      <p class="muted">${esc(r.text)} · ${s.game.history.filter((m) => m.color === s.me).length} Züge</p>
      ${xp ? `<div class="xp-gain">+${xp} XP</div>` : ''}
      ${halved ? '<p class="muted">Halbe XP, weil du Tipps oder Zugrücknahmen benutzt hast. Erfolge für Siege gegen starke Gegner gibt es nur ohne Hilfen.</p>' : ''}
      <div class="buttons">
        <button class="btn btn-primary" data-v="again">⚔️ Revanche</button>
        <button class="btn btn-secondary" data-v="analyse">🔍 Analyse</button>
        <button class="btn btn-secondary" data-v="board">Brett ansehen</button>
        <button class="btn btn-secondary" data-v="menu">Menü</button>
      </div>`, { cls: outcome === 'win' ? 'celebrate' : '', onClose: () => CG.UI.showRankUp() });
    if (outcome === 'win') d.el.insertAdjacentHTML('afterbegin', '<div class="rays"></div>');
    d.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.v;
      d.close();
      if (s.demo) return; // Effekt-Labor: nur ansehen
      if (v === 'again') startPvC({ elo: s.elo, color: other(s.me), tc: s.tc, assists: s.assists });
      else if (v === 'analyse') analyse();
      else if (v === 'menu') { session = null; CG.Menu.open(); }
    }));
  }

  /* ------------------------------------------------------------ Analyse */
  /**
   * Bewertet jede Stellung (Stockfish, feste Tiefe) und markiert eigene Fehler:
   * Verlust ≥ 300 = Patzer (??), ≥ 150 = Fehler (?), ≥ 70 = Ungenauigkeit (?!). Beim Blättern zeigt ein Pfeil den besten Zug.
   */
  async function analyse(target) {
    const s = target || session;
    if (!s) return;
    if (s.analysed) { showAnalysis(s); return; }
    const g = s.game;
    const d = modal(`<h2>Analyse</h2><p class="muted">Stockfish prüft die Partie …</p><div class="spinner"></div><p id="an-prog">0 / ${g.ply + 1}</p>`, { dismiss: false });
    const engine = CG.engine();
    const evals = [];
    for (let p = 0; p <= g.ply; p++) {
      const fen = g.fenAt(p);
      const turn = fen.split(' ')[1];
      let ev;
      if (p === g.ply && g.result && g.result.reason === 'checkmate') ev = { white: g.result.winner === 'w' ? 100000 : -100000, mate: 0, best: null };
      else if (p === g.ply && g.result && ['stalemate', 'insufficient', 'threefold', 'fifty'].includes(g.result.reason)) ev = { white: 0, best: null };
      else {
        const r = await engine.search({ fen, depth: 11, multipv: 1, options: { UCI_LimitStrength: false, 'Skill Level': 20 } });
        const line = r.lines[0];
        const v = line ? CG.engineUtil.scoreValue(line.score) : 0;
        ev = { white: turn === 'w' ? v : -v, mate: line && line.score.mate !== undefined ? (turn === 'w' ? line.score.mate : -line.score.mate) : null, best: r.bestmove };
      }
      evals.push(ev);
      const pr = d.el.querySelector('#an-prog');
      if (pr) pr.textContent = `${p + 1} / ${g.ply + 1}`;
    }
    d.close();
    const clampCp = (v) => Math.max(-1000, Math.min(1000, v));
    const tags = {};
    const stats = { blunder: 0, mistake: 0, inaccuracy: 0 };
    const me = s.me;
    for (let p = 1; p <= g.ply; p++) {
      const mover = g.history[p - 1].color;
      if (me !== 'both' && mover !== me) continue;
      const sign = mover === 'w' ? 1 : -1;
      const loss = (clampCp(evals[p - 1].white) - clampCp(evals[p].white)) * sign;
      if (loss >= 300) { tags[p] = { cls: 'blunder', mark: '??' }; stats.blunder++; }
      else if (loss >= 150) { tags[p] = { cls: 'mistake', mark: '?' }; stats.mistake++; }
      else if (loss >= 70) { tags[p] = { cls: 'mistake', mark: '?!' }; stats.inaccuracy++; }
    }
    s.analysed = { evals, tags, stats };
    showAnalysis(s);
  }

  function showAnalysis(s) {
    const { evals, tags, stats } = s.analysed;
    const v = V();
    v.cfg.tags = tags;
    v.cfg.evalBar = true;
    document.querySelector('#eval').hidden = false;
    const upd = () => {
      const ply = v.viewPly ?? v.game.ply;
      const e = evals[ply];
      if (!e) return;
      v.setEval(Math.max(-1000, Math.min(1000, e.white)), e.mate);
      if (e.best) { const m = CG.chessUtil.parseUci(e.best); v.board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]); } else v.board.setArrows([]);
    };
    v.cfg.onBrowse = upd;
    v.renderMoves();
    upd();
    // Bewertungskurve im Dialog
    const W = 600;
    const H = 110;
    const pts = evals.map((e, i) => {
      const share = e.mate !== null && e.mate !== undefined ? (e.white > 0 ? 1 : 0) : 1 / (1 + Math.exp(-Math.max(-1000, Math.min(1000, e.white)) / 250));
      return `${(i / Math.max(1, evals.length - 1)) * W},${H - share * H}`;
    });
    const area = `0,${H} ${pts.join(' ')} ${W},${H}`;
    const d = modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>Analyse</h2>
      <svg class="analysis-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${area}" fill="#e8d6b0" opacity=".9"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#8a6a2a" stroke-dasharray="4 4"/></svg>
      <div class="stat-row"><div><b>${stats.blunder}</b><small>Patzer ??</small></div><div><b>${stats.mistake}</b><small>Fehler ?</small></div><div><b>${stats.inaccuracy}</b><small>Ungenau ?!</small></div></div>
      <p class="muted">Blättere mit den Pfeiltasten oder tippe auf einen Zug: Der blaue Pfeil zeigt den besten Zug in der Stellung.</p>
      <div class="buttons"><button class="btn btn-primary" data-close>Zum Brett</button></div>`);
    void d;
    const first = Object.keys(tags).map(Number).sort((a, b) => a - b)[0];
    if (first) v.browse(first - 1);
  }

  /* ------------------------------------------------------------ Zu zweit an einem Gerät */
  function startLocal() {
    const game = new CG.Game();
    const lsess = { game };
    session = null;
    V().start({
      mode: 'local', title: '♟️ Zu zweit am Gerät', sub: 'Abwechselnd ziehen', game, me: 'both',
      players: { w: { name: 'Weiß', icon: '♔' }, b: { name: 'Schwarz', icon: '♚' } },
      actions: [
        { id: 'undo', label: '↶ Zurück', onClick: () => { if (game.ply) V().undo(1); } },
        { id: 'draw', label: '½ Remis', onClick: async () => {
          const ok = await CG.UI.ask('Remis?', 'Beide einverstanden?', [{ label: 'Nein', value: false }, { label: 'Remis', value: true, primary: true }]);
          if (ok && !game.over) { game.finish(null, 'agreement'); V().ended(); }
        } },
        { id: 'resign', label: '🏳️ Aufgeben', onClick: async () => {
          const c = game.turn;
          const ok = await CG.UI.ask(`${colorName(c)} gibt auf?`, '', [{ label: 'Nein', value: false }, { label: 'Aufgeben', value: true, primary: true }]);
          if (ok && !game.over) { game.finish(other(c), 'resign'); V().ended(); }
        } },
      ],
      onBack: () => { V().stop(); CG.Menu.open(); },
      onEnd: (r) => {
        CG.Audio.play(r.winner ? 'victory' : 'tie');
        progress.gameResult({ mode: 'local' });
        V().setActions([
          { id: 'again', label: '♻️ Neue Partie', cls: 'btn-primary', onClick: () => startLocal() },
          { id: 'analyse', label: '🔍 Analyse', onClick: () => analyse({ game, me: 'both', analysed: null }) },
          { id: 'pgn', label: '📋 PGN', onClick: () => CG.UI.copy(game.pgn({ White: 'Weiß', Black: 'Schwarz' }), 'PGN kopiert') },
        ]);
        setTimeout(() => modal(`<div class="big">${r.winner ? '🏆' : '🤝'}</div><div class="result-title">${r.winner ? `${colorName(r.winner)} gewinnt` : 'Remis'}</div>
          <p class="muted">${esc(r.text)}</p><div class="buttons"><button class="btn btn-primary" data-close>Brett ansehen</button></div>`), 700);
      },
    });
    void lsess;
  }

  function savedGame() { return store.get('pvc-save', null); }
  function resume() {
    const sv = savedGame();
    if (!sv) return;
    startPvC({ elo: sv.elo, color: sv.color, tc: sv.tc, assists: sv.assists, saved: sv });
  }

  CG.PvC = { setupDialog, start: startPvC, resume, savedGame, startLocal, analyse, view: V, resultDialog };
})(globalThis);
