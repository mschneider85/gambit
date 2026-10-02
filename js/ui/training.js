/*
 * Training: Kampagnenkarte (Kapitel, Level, Sterne, Rang) und die Ausführung der Level –
 * Sterne-Lektionen, Aufgaben/Rätsel, Endspiele gegen Stockfish und Bosspartien.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { $, esc, modal, toast, progress, achieve, sleep, show, rankHTML, settings } = CG.UI;
  const C = CG.Campaign;
  const R = CG.Runner;
  const { other } = CG.chessUtil;

  const V = () => CG.PvC.view();
  let run = null; // laufendes Level { level, token, … }
  const starStr = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

  /* ------------------------------------------------------------ Karte */
  function open() {
    run = null;
    show('training');
    CG.Audio.setMood('arcane');
    $('#training-back').onclick = () => CG.Menu.open();
    render();
  }

  function render() {
    const total = C.all.length * 3;
    const got = C.all.reduce((a, l) => a + progress.stars(l.key), 0);
    const done = C.all.filter((l) => progress.done(l.key)).length;
    const ach = CG.Achievements.list();
    const achGot = ach.filter((a) => progress.state.ach[a.id]).length;
    const r = progress.rank();
    $('#rank-card').innerHTML = `<span class="rank-badge">${r.icon}</span>
      <div class="ri"><b>${esc(r.name)}</b><div class="xpbar"><i style="width:${Math.round(r.progress * 100)}%"></i></div>
      <small>${progress.state.xp} XP${r.next ? ` · noch ${r.toNext} XP bis ${esc(r.next.name)} ${r.next.icon}` : ' · höchster Rang!'}</small></div>
      <div class="totals"><div><b>${got}</b><small>von ${total} ★</small></div><div><b>${done}</b><small>von ${C.all.length} Level</small></div><div><b>${achGot}</b><small>Erfolge</small></div></div>`;
    const next = C.next(progress);
    $('#campaign').innerHTML = C.chapters.map((c, ci) => {
      const open = C.unlocked(c.levels[0], progress);
      const stars = C.chapterStars(c, progress);
      const nodes = c.levels.map((l, li) => {
        const un = C.unlocked(l, progress);
        const st = progress.stars(l.key);
        const cls = [un ? '' : 'locked', l === next ? 'next' : '', st ? 'done' : '', l.boss ? 'boss' : ''].join(' ');
        return `<button class="level-node ${cls}" data-key="${l.key}" title="${esc(l.title)}" aria-label="${esc(l.title)}${un ? '' : ' (gesperrt)'}">
          <span class="ln-icon">${un ? l.icon : '🔒'}</span><span class="ln-num">${l.boss ? 'Prüfung' : `${ci + 1}.${li + 1}`}</span><span class="ln-stars">${un ? starStr(st) : ''}</span></button>`;
      }).join('');
      return `<section class="chapter ${open ? '' : 'locked'}"><div class="chapter-head"><span class="ch-icon">${c.icon}</span>
        <div><h2>Kapitel ${ci + 1}: ${esc(c.title)}</h2><p>${esc(c.text)}</p></div><span class="ch-stars">${stars}/${c.levels.length * 3} ★</span></div>
        <div class="levels">${nodes}</div></section>`;
    }).join('');
    $('#campaign').onclick = (e) => {
      const b = e.target.closest('[data-key]');
      if (!b) return;
      const l = C.byKey(b.dataset.key);
      if (!C.unlocked(l, progress)) { CG.Audio.play('illegal'); toast('Schaffe zuerst das vorige Level.', { icon: '🔒' }); return; }
      intro(l);
    };
    const nx = next && document.querySelector(`[data-key="${next.key}"]`);
    if (nx) setTimeout(() => nx.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
  }

  const TYPE_NAME = { stars: 'Lektion', steps: 'Aufgaben', endgame: 'Endspiel', boss: 'Partie' };

  function intro(l) {
    const st = progress.stars(l.key);
    const c = C.chapters[l.ci];
    let meta = '';
    if (l.type === 'steps') {
      const n = R.items(l).length;
      meta = `${n} Aufgabe${n === 1 ? '' : 'n'}${l.lives ? ` · ${l.lives} Leben ❤️` : ''}`;
    } else if (l.type === 'endgame') meta = `Höchstens ${l.moves} Züge`;
    else if (l.type === 'boss') meta = `Gegner: ${CG.Strength.level(l.elo).name} (${l.elo}) · du spielst ${l.color === 'w' ? 'Weiß' : 'Schwarz'}`;
    else if (l.type === 'stars') meta = `${l.stars.length} Sterne einsammeln`;
    const d = modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button>
      <div class="big">${l.icon}</div><p class="muted">Kapitel ${l.ci + 1} · ${esc(c.title)} · ${TYPE_NAME[l.type]}</p>
      <h2>${esc(l.title)}</h2><p>${l.intro}</p><p class="muted">${meta}</p>
      ${st ? `<p>Bisher: <span style="color:var(--gold)">${starStr(st)}</span></p>` : ''}
      <div class="buttons"><button class="btn btn-primary" id="lv-go">Los geht’s</button></div>`);
    d.el.querySelector('#lv-go').addEventListener('click', () => { d.close(); start(l); });
  }

  function start(l) {
    CG.UI.touchDay();
    if (l.type === 'stars') startStars(l);
    else if (l.type === 'steps') startSteps(l);
    else if (l.type === 'endgame') startEndgame(l);
    else if (l.type === 'boss') startBoss(l);
  }

  function backToMap() {
    if (run) run.token++;
    run = null;
    CG.engine().stop();
    V().stop();
    open();
  }

  const baseActions = (l) => [
    { id: 'restart', label: '↺ Neu', onClick: () => start(l) },
    { id: 'map', label: '🗺️ Karte', onClick: () => backToMap() },
  ];

  /* ------------------------------------------------------------ Sterne-Lektion */
  function startStars(l) {
    const game = new CG.Game({ fen: l.fen, free: true });
    const left = new Set(l.stars);
    const r = (run = { level: l, token: 1, game, moves: 0, par: R.starsPar(l.fen, l.stars) });
    const coach = () => `<h3>${l.icon} ${esc(l.title)}</h3><p class="extra">${l.intro}</p>
      <p><b>★ ${l.stars.length - left.size} / ${l.stars.length}</b> · Züge: ${r.moves}${r.par ? ` · Bestwert: ${r.par}` : ''}</p>`;
    V().start({
      mode: 'training', title: `${l.icon} ${l.title}`, sub: 'Sammle alle Sterne', game, me: 'w', forceDests: true,
      players: { w: { name: settings.name || 'Du', icon: '🧝' }, b: { name: 'Sterne', icon: '★', status: 'Lande auf jedem Stern' } },
      captures: false, coach: coach(), moveList: false, nav: false, emptyMoves: '',
      actions: baseActions(l), onBack: () => backToMap(),
      onUserMove: (mv) => {
        r.moves++;
        if (left.has(mv.to)) {
          left.delete(mv.to);
          V().board.burst(mv.to, 'star');
          CG.Audio.play('star');
        }
        V().board.setMarks({ stars: [...left] });
        V().setCoach(coach());
        if (!left.size) setTimeout(() => finish(l, R.starsLessonStars(r.moves, r.par || r.moves)), 500);
      },
    });
    V().board.setMarks({ stars: [...left] });
  }

  /* ------------------------------------------------------------ Aufgaben & Rätsel */
  function puzzleTitle(it) {
    if (it.text) return it.text;
    const g = it.group || '';
    const n = { mate1: 1, mate1b: 1, mate1s: 1, mate2: 2, mate3: 3 }[g];
    const side = R.sideText(new CG.Game({ fen: it.fen, moves: it.pre ? [it.pre] : [] }).fen);
    return n ? `${side} am Zug: <b>Matt in ${n}</b>.` : `${side} am Zug: Finde den besten Zug!`;
  }

  function startSteps(l) {
    const list = R.items(l);
    const r = (run = { level: l, token: 1, list, i: 0, mistakes: 0, hints: 0, lives: l.lives || null, results: [] });
    nextItem(r);
  }

  function stepsCoach(r, feedback) {
    const l = r.level;
    const it = r.list[r.i];
    const dots = r.list.map((x, k) => `<i class="${k < r.i ? (r.results[k] ? 'done' : 'fail') : ''} ${k === r.i ? 'now' : ''}"></i>`).join('');
    const lives = r.lives !== null ? ` · ${'❤️'.repeat(Math.max(0, r.lives))}${'🖤'.repeat(Math.max(0, l.lives - r.lives))}` : '';
    let ask = '';
    if (it.ask) {
      ask = `<p><b>${esc(it.ask.q)}</b></p><div class="choices">${it.ask.choices.map((c, k) => `<button data-choice="${k}">${esc(c.t)}</button>`).join('')}</div>`;
    }
    const rating = it.rating ? ` <small>(Wertung ${it.rating})</small>` : '';
    return `<h3>${l.icon} ${esc(l.title)} – ${r.i + 1}/${r.list.length}${lives}</h3>
      <p>${puzzleTitle(it)}${rating}</p>${ask}
      <div class="coach-foot"><div class="progress-dots">${dots}</div><p class="feedback ${feedback ? feedback.cls : ''}">${feedback ? feedback.text : ''}</p></div>`;
  }

  async function nextItem(r) {
    if (run !== r) return;
    if (r.i >= r.list.length) { finish(r.level, R.stepsStars(r.mistakes, r.hints)); return; }
    const it = r.list[r.i];
    const token = ++r.token;
    r.ex = new R.Exercise(it);
    r.itemMistake = false;
    r.hintStage = 0;
    const game = new CG.Game({ fen: it.fen });
    const me = it.pre ? other(game.turn) : game.turn;
    r.me = me;
    r.busy = !!it.pre;
    const v = V();
    v.start({
      mode: 'training', title: `${r.level.icon} ${r.level.title}`, sub: `Aufgabe ${r.i + 1} von ${r.list.length}`,
      game, me: it.ask ? null : me, orientation: me,
      players: { [me]: { name: settings.name || 'Du', icon: '🧝' }, [other(me)]: { name: it.id ? 'Lichess-Rätsel' : 'Gegner', icon: '🧩' } },
      coach: stepsCoach(r), nav: false, captures: false, emptyMoves: it.pre ? '' : 'Du bist am Zug',
      actions: [
        ...(it.ask ? [] : [{ id: 'hint', label: '💡 Tipp', onClick: () => stepHint(r) }]),
        { id: 'map', label: '🗺️ Karte', onClick: () => backToMap() },
      ],
      canMove: () => run === r && !r.busy,
      validate: (uci) => stepValidate(r, uci),
      onUserMove: (mv) => stepMoved(r, mv),
      onBack: () => backToMap(),
    });
    bindChoices(r);
    if (it.pre) {
      await sleep(650);
      if (run !== r || token !== r.token) return;
      v.play(it.pre);
      r.busy = false;
    }
  }

  function bindChoices(r) {
    const it = r.list[r.i];
    if (!it.ask) return;
    $('#coach').onclick = (e) => {
      const b = e.target.closest('[data-choice]');
      if (!b || r.answered) return;
      r.answered = true;
      const c = it.ask.choices[+b.dataset.choice];
      $$choices().forEach((x, k) => { if (it.ask.choices[k].ok) x.classList.add('right'); });
      if (!c.ok) {
        b.classList.add('wrong');
        r.mistakes++;
        if (r.lives !== null) r.lives--;
        CG.Audio.play('wrong');
      } else CG.Audio.play('correct');
      r.results[r.i] = c.ok;
      const fb = document.querySelector('#coach .feedback');
      fb.className = `feedback ${c.ok ? 'ok' : 'no'}`;
      fb.innerHTML = `${c.ok ? '✓ Richtig! ' : '✗ '}${esc(c.why || '')}`;
      V().setActions([{ id: 'next', label: 'Weiter →', cls: 'btn-primary', onClick: () => { r.answered = false; if (!livesOut(r)) { r.i++; nextItem(r); } } },
        { id: 'map', label: '🗺️ Karte', onClick: () => backToMap() }]);
    };
  }
  const $$choices = () => [...document.querySelectorAll('#coach [data-choice]')];

  function livesOut(r) {
    if (r.lives === null || r.lives > 0) return false;
    failed(r.level, 'Keine Leben mehr.');
    return true;
  }

  function stepValidate(r, uci) {
    const res = r.ex.check(V().game.fen, uci);
    if (res.ok) { r.pendingReply = res; return true; }
    r.mistakes++;
    if (!r.itemMistake && r.list[r.i].id) progress.puzzle(false);
    r.itemMistake = true;
    if (r.lives !== null) r.lives--;
    V().board.shake();
    CG.Audio.play('wrong');
    V().setCoach(stepsCoach(r, { cls: 'no', text: '✗ Nicht ganz – nochmal!' }));
    setTimeout(() => livesOut(r), 600);
    return false;
  }

  async function stepMoved(r, mv) {
    void mv;
    const res = r.pendingReply;
    r.pendingReply = null;
    V().board.setArrows([]);
    V().board.setMarks({ hint: null });
    if (res.done) {
      r.results[r.i] = !r.itemMistake;
      if (r.list[r.i].id && !r.itemMistake) { progress.puzzle(true); achieve({ type: 'puzzle', ok: true }); }
      CG.Audio.play('correct');
      V().setCoach(stepsCoach(r, { cls: 'ok', text: r.itemMistake ? '✓ Geschafft!' : '✓ Richtig!' }));
      r.busy = true;
      const token = r.token;
      await sleep(1000);
      if (run !== r || token !== r.token) return;
      r.i++;
      nextItem(r);
      return;
    }
    r.busy = true;
    V().setCoach(stepsCoach(r, { cls: 'ok', text: '✓ Gut! Weiter …' }));
    const token = r.token;
    await sleep(550);
    if (run !== r || token !== r.token) return;
    V().play(res.reply);
    r.busy = false;
    r.hintStage = 0;
  }

  /** Tipp: erst die richtige Figur markieren, beim zweiten Mal den ganzen Zug als Pfeil zeigen. */
  function stepHint(r, tries = 0) {
    if (run !== r) return;
    // Läuft gerade noch der Zug des Gegners, kurz warten statt den Tipp zu verschlucken
    if (r.busy) { if (tries < 30) setTimeout(() => stepHint(r, tries + 1), 100); return; }
    const exp = r.ex.expected;
    if (!exp || r.hintStage >= 2) return;
    r.hints++;
    const m = CG.chessUtil.parseUci(exp);
    if (r.hintStage === 0) {
      V().board.setMarks({ hint: [m.from] });
      r.hintStage = 1;
      V().setCoach(stepsCoach(r, { cls: 'hint', text: '💡 Diese Figur zieht. Noch einmal Tipp zeigt den Zug.' }));
    } else {
      V().board.setArrows([{ from: m.from, to: m.to, color: 'green' }]);
      r.hintStage = 2;
      V().setCoach(stepsCoach(r, { cls: 'hint', text: '💡 Der Pfeil zeigt den Zug.' }));
    }
    CG.Audio.play('select');
  }

  /* ------------------------------------------------------------ Endspiel */
  function startEndgame(l) {
    const game = new CG.Game({ fen: l.fen });
    const me = game.turn;
    const r = (run = { level: l, token: 1, game, me, used: 0, hints: 0, par: null, busy: false });
    const engine = CG.engine();
    engine.newGame();
    const goalText = { mate: `Setze matt – in höchstens ${l.moves} Zügen.`, promote: `Wandle einen Bauern um – in höchstens ${l.moves} Zügen.`, hold: `Halte ${l.moves} Züge durch.` }[l.goal];
    const coach = (fb) => `<h3>${l.icon} ${esc(l.title)}</h3><p class="extra">${l.intro}</p><p><b>${goalText}</b></p>
      <p>Zug ${r.used} / ${l.moves}${r.par ? ` · Matt in ${r.par} möglich` : ''}</p>${fb ? `<p class="feedback ${fb.cls}">${fb.text}</p>` : ''}`;
    V().start({
      mode: 'training', title: `${l.icon} ${l.title}`, sub: 'Endspiel gegen Stockfish', game, me, orientation: me,
      players: { [me]: { name: settings.name || 'Du', icon: '🧝' }, [other(me)]: { name: 'Stockfish', sub: 'volle Stärke', icon: '🐟' } },
      coach: coach(), nav: false, captures: false,
      actions: [{ id: 'hint', label: '💡 Tipp', onClick: () => endgameHint(r) }, ...baseActions(l)],
      canMove: () => run === r && !r.busy,
      onUserMove: async () => {
        r.used++;
        V().board.setArrows([]);
        V().setCoach(coach());
        if (check()) return;
        r.busy = true;
        V().setThinking(other(me));
        const token = r.token;
        const res = await engine.search({ fen: game.fen, movetime: 450, options: { UCI_LimitStrength: false, 'Skill Level': 20 } });
        await sleep(250);
        if (run !== r || token !== r.token) return;
        V().setThinking(null);
        if (res.bestmove) V().play(res.bestmove);
        r.busy = false;
        check();
      },
      onEnd: () => {},
      onBack: () => backToMap(),
    });
    // Mattdistanz für die Sterne
    if (l.goal === 'mate') {
      engine.search({ fen: l.fen, depth: 20, options: { UCI_LimitStrength: false, 'Skill Level': 20 } }).then((res) => {
        const s = res.lines[0] && res.lines[0].score;
        if (run === r && s && s.mate > 0) { r.par = s.mate; V().setCoach(coach()); }
      });
    }
    function check() {
      const st = R.endgameStatus(l, game, me, r.used);
      if (st === 'win') {
        r.busy = true;
        CG.Audio.play('correct');
        let stars = R.endgameStars(r.used, l.moves, r.par);
        if (r.hints) stars = Math.min(stars, r.hints > 2 ? 1 : 2);
        setTimeout(() => { if (run === r) finish(l, stars); }, 900);
        return true;
      }
      if (st === 'fail') {
        r.busy = true;
        const why = game.result && game.result.reason === 'stalemate' ? 'Patt! Das ist nur ein Remis.' : game.result ? game.result.text : 'Das Zuglimit ist erreicht.';
        setTimeout(() => { if (run === r) failed(l, why); }, 700);
        return true;
      }
      return false;
    }
  }

  async function endgameHint(r) {
    if (r.busy || r.game.turn !== r.me) return;
    r.hints++;
    const res = await CG.Strength.bestMove(CG.engine(), r.game.fen, 700);
    if (run !== r || !res.bestmove) return;
    const m = CG.chessUtil.parseUci(res.bestmove);
    V().board.setArrows([{ from: m.from, to: m.to, color: 'green' }]);
  }

  /* ------------------------------------------------------------ Bosspartie */
  function startBoss(l) {
    const game = new CG.Game(l.fen ? { fen: l.fen } : {});
    const me = l.color;
    const cpu = other(me);
    const lv = CG.Strength.level(l.elo);
    const r = (run = { level: l, token: 1, game, me, assists: 0, busy: false });
    const engine = CG.engine();
    engine.newGame();
    const cpuMove = async () => {
      if (run !== r || game.over || game.turn !== cpu) return;
      r.busy = true;
      V().setThinking(cpu);
      const token = r.token;
      const t0 = Date.now();
      const uci = await CG.Strength.chooseMove({ engine, fen: game.fen, elo: l.elo, legal: game.legal().map(CG.uciOf) });
      const wait = 600 + Math.random() * 800 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      if (run !== r || token !== r.token || game.over) return;
      V().setThinking(null);
      V().play(uci);
      r.busy = false;
    };
    V().start({
      mode: 'boss', title: `${l.icon} ${l.title}`, sub: `${lv.name} · ${l.elo}`, game, me,
      players: { [me]: { name: settings.name || 'Du', icon: '🧝' }, [cpu]: { name: lv.name, sub: String(l.elo), icon: lv.icon } },
      coach: `<h3>${l.icon} ${esc(l.title)}</h3><p class="extra">${l.intro}</p><p>Gewinne die Partie. Tipps und Rücknahmen kosten Sterne.</p>`,
      actions: [
        { id: 'hint', label: '💡 Tipp', onClick: async () => {
          if (r.busy || game.turn !== me || game.over) return;
          r.assists++;
          const res = await CG.Strength.bestMove(engine, game.fen, 800);
          if (run === r && res.bestmove) { const m = CG.chessUtil.parseUci(res.bestmove); V().board.setArrows([{ from: m.from, to: m.to, color: 'green' }]); }
        } },
        { id: 'undo', label: '↶ Zurück', onClick: () => {
          if (r.busy || game.over) return;
          const n = game.turn === me ? 2 : 1;
          if (game.ply < n) return;
          r.assists++;
          r.token++;
          V().undo(n);
          cpuMove();
        } },
        { id: 'resign', label: '🏳️ Aufgeben', onClick: async () => {
          const ok = await CG.UI.ask('Aufgeben?', '', [{ label: 'Weiterspielen', value: false }, { label: 'Aufgeben', value: true, primary: true }]);
          if (ok && !game.over) { game.finish(cpu, 'resign'); V().ended(); }
        } },
        { id: 'map', label: '🗺️ Karte', onClick: () => backToMap() },
      ],
      canMove: () => run === r && !r.busy,
      onUserMove: () => { V().board.setArrows([]); cpuMove(); },
      onEnd: (res) => {
        const outcome = res.winner === me ? 'win' : res.winner ? 'loss' : 'draw';
        progress.gameResult({ mode: 'pvc', outcome, elo: l.elo });
        achieve({ type: 'game-end', mode: 'boss', outcome, elo: l.elo, game, me, assisted: r.assists > 0 });
        if (outcome === 'win') { CG.Audio.play('victory'); setTimeout(() => finish(l, R.bossStars(r.assists)), 1000); }
        else { CG.Audio.play(outcome === 'loss' ? 'defeat' : 'tie'); setTimeout(() => failed(l, outcome === 'draw' ? `Remis (${res.text}) – du musst gewinnen.` : res.text), 900); }
      },
      onBack: () => backToMap(),
    });
    cpuMove();
  }

  /* ------------------------------------------------------------ Ergebnis */
  function finish(l, stars) {
    if (!run || run.level !== l) return;
    run.token++;
    const chapter = C.chapters[l.ci];
    const wasDone = C.chapterDone(chapter, progress);
    const res = progress.levelResult(l.key, stars, CG.progressUtil.XP.chapterFactor(l.ci));
    const chapterDone = !wasDone && C.chapterDone(chapter, progress);
    const chapterAllStars = C.chapterStars(chapter, progress) === chapter.levels.length * 3;
    const campaignDone = C.all.every((x) => progress.done(x.key));
    const campaignAllStars = C.all.every((x) => progress.stars(x.key) === 3);
    progress.addXp(res.xp, `Level ${l.title}`);
    achieve({ type: 'level', level: l.key, chapter: chapter.id, stars, chapterDone: C.chapterDone(chapter, progress), chapterAllStars, campaignDone, campaignAllStars });
    const next = C.all[C.all.indexOf(l) + 1];
    const d = modal(`<div class="rays"></div><p class="muted">${esc(l.title)}</p><div class="result-title">${stars === 3 ? 'Meisterhaft!' : stars === 2 ? 'Gut gemacht!' : 'Geschafft!'}</div>
      <div class="stars-big"><span>⭐</span><span>⭐</span><span>⭐</span></div>
      ${res.xp ? `<div class="xp-gain">+${res.xp} XP</div>` : `<p class="muted">${progress.stars(l.key) > stars ? `Dein Bestwert bleibt ${starStr(progress.stars(l.key))}` : 'Keine neuen Sterne'}</p>`}
      ${chapterDone ? `<p><b>🎉 Kapitel „${esc(chapter.title)}“ gemeistert!</b></p>` : ''}
      ${!next && campaignDone ? '<p><b>🐉 Du hast die ganze Kampagne geschafft!</b></p>' : ''}
      <div class="buttons">${next ? '<button class="btn btn-primary" data-v="next">Weiter →</button>' : ''}
        <button class="btn btn-secondary" data-v="again">↺ Nochmal</button><button class="btn btn-secondary" data-v="map">🗺️ Karte</button></div>`,
    { cls: 'celebrate', dismiss: false, onClose: () => CG.UI.showRankUp() });
    const spans = d.el.querySelectorAll('.stars-big span');
    spans.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('on'); CG.Audio.play('star'); }, 300 + i * 320); });
    d.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      d.close();
      const v = b.dataset.v;
      if (v === 'next') intro(next);
      else if (v === 'again') start(l);
      else backToMap();
    }));
  }

  function failed(l, why) {
    if (!run || run.level !== l) return;
    run.token++;
    progress.levelResult(l.key, 0);
    CG.Audio.play('lose');
    const d = modal(`<div class="big">🥀</div><div class="result-title">Nicht geschafft</div><p>${esc(why)}</p>
      <div class="buttons"><button class="btn btn-primary" data-v="again">↺ Nochmal</button><button class="btn btn-secondary" data-v="map">🗺️ Karte</button></div>`, { dismiss: false });
    d.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      d.close();
      if (b.dataset.v === 'again') start(l);
      else backToMap();
    }));
  }

  CG.Training = { open, start, intro };
})(globalThis);
