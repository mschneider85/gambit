/*
 * Spielansicht (#game): verbindet eine Partie (CG.Game) mit Brett, Spielerleisten, Uhren und Zugliste.
 * Die Modi (Computer, Online, Training, zu zweit am Gerät) steuern sie über eine Konfiguration und Rückrufe:
 *   view.start({ mode, title, sub, game, me, players, clock, orientation, actions, coach, emotes,
 *                canMove(), onUserMove(move), onFlag(color), onBack(), onEnd(result) })
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { $, esc, settings } = CG.UI;
  const { other, toUci } = CG.chessUtil;

  class GameView {
    constructor() {
      this.root = $('#game');
      this.board = new CG.Board($('#board'), {
        pieceSet: settings.pieceSet,
        coords: settings.coords,
        movable: (sq) => this.movable(sq),
        dests: (sq) => this.dests(sq),
        onMove: (from, to) => this.userMove(from, to),
        onIllegal: () => CG.Audio.play('illegal'),
      });
      this.applyTheme();
      document.addEventListener('settings', (e) => {
        const { k, v } = e.detail;
        if (k === 'pieceSet') this.board.setPieceSet(v);
        if (k === 'boardTheme') this.applyTheme();
        if (k === 'coords') { this.board.o.coords = v; this.board.layoutSquares(); }
        if (k === 'showDests') this.board.applyMarks();
        if (k === 'germanSan' && this.game) this.renderMoves();
      });
      $('#game-back').addEventListener('click', () => this.cfg && this.cfg.onBack && this.cfg.onBack());
      $('#game-flip').addEventListener('click', () => this.flip());
      $('#moves').addEventListener('click', (e) => {
        const mv = e.target.closest('[data-ply]');
        if (mv) this.browse(+mv.dataset.ply);
      });
      $('#nav').addEventListener('click', (e) => {
        const b = e.target.closest('[data-nav]');
        if (!b || !this.game) return;
        const live = this.game.ply;
        const cur = this.viewPly ?? live;
        const target = { start: 0, prev: cur - 1, next: cur + 1, end: live }[b.dataset.nav];
        this.browse(target);
      });
      document.addEventListener('keydown', (e) => {
        if (CG.UI.screen !== 'game' || CG.UI.modalOpen || !this.game || e.target.closest('input, textarea')) return;
        const cur = this.viewPly ?? this.game.ply;
        if (e.key === 'ArrowLeft') { this.browse(cur - 1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { this.browse(cur + 1); e.preventDefault(); }
        else if (e.key === 'ArrowUp' || e.key === 'Home') { this.browse(0); e.preventDefault(); }
        else if (e.key === 'ArrowDown' || e.key === 'End') { this.browse(this.game.ply); e.preventDefault(); }
        else if (e.key === 'f' || e.key === 'F') this.flip();
      });
      this.timer = null;
      // Hochformat: Brett so groß wie möglich, Bedienleiste direkt darunter
      const fit = () => this.fit();
      if (G.ResizeObserver) new ResizeObserver(fit).observe($('#game .game-layout'));
      if (G.ResizeObserver) new ResizeObserver(fit).observe($('#game .side'));
      G.addEventListener('resize', fit);
    }

    /** Im Hochformat die Brettbreite aus der freien Höhe (abzüglich Bedienleiste) und der Breite bestimmen. */
    fit() {
      const layout = $('#game .game-layout');
      const stack = $('#game .board-stack');
      const portrait = G.matchMedia('(orientation: portrait), (max-aspect-ratio: 1/1)').matches;
      if (!portrait || !layout.clientHeight) { stack.style.removeProperty('--bw'); layout.style.removeProperty('--fit-w'); return; }
      const cs = getComputedStyle(layout);
      const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.rowGap) || 0;
      const barH = $('#bar-top').offsetHeight;
      const stackGap = parseFloat(getComputedStyle(stack).rowGap) || 0;
      const side = $('#game .side').offsetHeight;
      const h = layout.clientHeight - padV - side - gap - 2 * barH - 2 * stackGap;
      const w = layout.clientWidth - padH;
      const bw = Math.max(160, Math.floor(Math.min(w, h)));
      stack.style.setProperty('--bw', `${bw}px`);
      // Auf breiten Hochformaten (iPad) nicht breiter als das Brett
      layout.style.setProperty('--fit-w', `${Math.max(bw, Math.min(w, 520))}px`);
    }

    applyTheme() {
      const el = $('#board');
      el.className = el.className.replace(/\btheme-\S+/g, '').trim();
      el.classList.add(`theme-${settings.boardTheme}`);
    }

    /* ------------------------------------------------------------ Start */
    start(cfg) {
      this.stop();
      this.cfg = cfg;
      this.game = cfg.game;
      this.viewPly = null;
      this.thinking = null;
      this.clock = cfg.clock || null;
      this.lowWarned = {};
      $('#game-title').textContent = cfg.title || '';
      $('#game-sub').textContent = cfg.sub || '';
      const orient = cfg.orientation || (cfg.me === 'b' ? 'b' : 'w');
      this.board.setOrientation(orient);
      this.board.clearMarks();
      this.board.setArrows([]);
      this.board.select(null);
      this.board.setPosition(this.game.fen, { animate: false });
      this.setCoach(cfg.coach || null);
      this.setActions(cfg.actions || []);
      $('#eval').hidden = !cfg.evalBar;
      $('#nav').hidden = cfg.nav === false;
      $('#moves').hidden = cfg.moveList === false;
      const em = $('#emotes');
      em.hidden = !cfg.emotes;
      if (cfg.emotes) {
        em.innerHTML = cfg.emotes.map((e) => `<button data-emote="${e}" aria-label="${e}">${e}</button>`).join('');
        em.onclick = (ev) => { const b = ev.target.closest('[data-emote]'); if (b && cfg.onEmote) { cfg.onEmote(b.dataset.emote); this.emote(b.dataset.emote); } };
      }
      this.renderBars();
      this.renderMoves();
      this.refreshMarks();
      CG.UI.show('game');
      requestAnimationFrame(() => this.fit());
      CG.Audio.setMood(cfg.mode === 'training' || cfg.mode === 'boss' ? 'training' : 'game');
      if (this.clock) this.timer = setInterval(() => this.tick(), 100);
    }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }

    /* ------------------------------------------------------------ Bedienung */
    /** Darf der Nutzer gerade die Figur auf sq ziehen? */
    movable(sq) {
      const g = this.game;
      const c = this.cfg;
      if (!g || !c || g.over || this.viewPly !== null) return false;
      const p = g.piece(sq);
      if (!p || p.color !== g.turn) return false;
      if (c.me !== 'both' && c.me !== g.turn) return false;
      if (c.canMove && !c.canMove()) return false;
      return true;
    }

    dests(sq) {
      if (!this.movable(sq)) return [];
      const seen = new Set();
      const out = [];
      for (const m of this.game.legal(sq)) {
        if (seen.has(m.to)) continue;
        seen.add(m.to);
        out.push({ to: m.to, capture: !!m.captured });
      }
      return settings.showDests || this.cfg.forceDests ? out : out.map((d) => ({ ...d, hidden: true }));
    }

    async userMove(from, to) {
      const g = this.game;
      let promotion;
      if (g.needsPromotion(from, to)) {
        this.board.setPosition(g.fen, { animate: false }); // Bauer zurück, bis gewählt ist
        promotion = await this.board.askPromotion(g.turn, to);
        if (!promotion) return;
      }
      const uci = from + to + (promotion || '');
      if (this.cfg.validate) {
        // Training: erst prüfen, dann erst ausführen (oder zurückweisen)
        const ok = await this.cfg.validate(uci);
        if (!ok) { this.board.setPosition(g.fen); return; }
      }
      const mv = this.play(uci, { byUser: true });
      if (mv && this.cfg.onUserMove) this.cfg.onUserMove(mv);
    }

    /** Zug ausführen und alles nachziehen. Liefert den Zug oder null. */
    play(uci, { byUser = false, sound = true } = {}) {
      const g = this.game;
      const mover = g.turn;
      const mv = g.move(uci);
      if (!mv) { this.board.setPosition(g.fen); return null; }
      if (this.clock && this.cfg.manageClock !== false) {
        if (g.over) this.clock.stop();
        else if (g.ply === 1 && !this.clock.running) this.clock.start(other(mover));
        else this.clock.press(mover);
      }
      this.afterMove(mv, { byUser, sound });
      return mv;
    }

    /** Nach einem Zug (hier oder schon in der Partie ausgeführt, z. B. vom Gegner online): alles nachziehen. */
    afterMove(mv, { byUser = false, sound = true } = {}) {
      const g = this.game;
      this.viewPly = null;
      this.board.setPosition(g.fen);
      if (mv.captured) this.board.burst(mv.to, 'capture');
      if (sound) this.moveSound(mv);
      this.refreshMarks();
      this.renderMoves();
      this.renderBars();
      if (byUser && this.cfg.mode !== 'local') CG.UI.achieve({ type: 'move', move: mv, mode: this.cfg.mode });
      if (g.over) this.ended();
    }

    moveSound(mv) {
      const A = CG.Audio;
      if (this.game.over && this.game.result.reason === 'checkmate') return; // Matt hat eigene Fanfare
      if (mv.san.includes('+')) A.play('check');
      else if (mv.promotion) A.play('promote');
      else if (/[kq]/.test(mv.flags)) A.play('castle');
      else if (mv.captured) A.play('capture');
      else A.play('move');
    }

    ended() {
      if (this.endedFor === this.game) return;
      this.endedFor = this.game;
      const r = this.game.result;
      if (this.clock) this.clock.stop();
      this.stop();
      this.renderBars();
      if (r.reason === 'checkmate') {
        const loserKing = this.kingSquare(other(r.winner));
        if (loserKing) this.board.burst(loserKing, 'mate');
      }
      if (this.cfg.onEnd) this.cfg.onEnd(r);
    }

    kingSquare(color) {
      for (const [sq, code] of Object.entries(CG.boardUtil.parseFen(this.game.fen))) if (code === `${color}K`) return sq;
      return null;
    }

    refreshMarks() {
      const g = this.game;
      const ply = this.viewPly ?? g.ply;
      const mv = ply > 0 ? g.history[ply - 1] : null;
      let check = null;
      const fen = g.fenAt(ply);
      if (!g.free && mv && /[+#]/.test(mv.san)) {
        const turn = fen.split(' ')[1];
        for (const [sq, code] of Object.entries(CG.boardUtil.parseFen(fen))) if (code === `${turn}K`) check = sq;
      }
      this.board.setMarks({ last: mv ? [mv.from, mv.to] : null, check });
    }

    /** In der Partie blättern (null/Endstand = live). */
    browse(ply) {
      const g = this.game;
      if (!g || this.cfg.nav === false) return;
      ply = Math.max(0, Math.min(g.ply, ply));
      this.viewPly = ply === g.ply ? null : ply;
      this.board.select(null);
      this.board.setPosition(g.fenAt(ply));
      this.refreshMarks();
      this.renderMoves();
      CG.Audio.play('move');
      if (this.cfg.onBrowse) this.cfg.onBrowse(ply);
    }

    flip() {
      this.board.flip();
      this.renderBars();
    }

    /** Position frisch setzen (nach Rücknahme o. Ä.). */
    sync() {
      this.viewPly = null;
      this.board.select(null);
      this.board.setPosition(this.game.fen);
      this.refreshMarks();
      this.renderMoves();
      this.renderBars();
    }

    /* ------------------------------------------------------------ Anzeige */
    setThinking(color) { this.thinking = color; this.renderBars(); }

    renderBars() {
      const g = this.game;
      const c = this.cfg;
      if (!g || !c) return;
      const bottom = this.board.o.orientation;
      const cap = g.free ? null : g.captured();
      const bar = (el, color) => {
        const p = (c.players && c.players[color]) || { name: CG.chessUtil.colorName(color) };
        let caps = '';
        if (cap && c.captures !== false) {
          // Geschlagen hat diese Seite die Figuren der anderen Farbe
          const list = cap[other(color)].map((t) => `<img src="art/pieces/${settings.pieceSet}/${other(color)}${t.toUpperCase()}.svg" alt="">`).join('');
          const adv = color === 'w' ? cap.diff : -cap.diff;
          caps = `<span class="captures">${list}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</span>`;
        }
        const clock = this.clock ? `<div class="clock ${this.clock.running === color ? 'running' : ''} ${this.clock.time(color) < 20000 ? 'low' : ''}" data-clock="${color}">${CG.chessUtil.formatClock(this.clock.time(color))}</div>` : '';
        const think = this.thinking === color ? '<span class="thinking"><i></i><i></i><i></i></span>' : '';
        el.className = `player-bar ${!g.over && g.turn === color ? 'turn' : ''}`;
        el.innerHTML = `<div class="avatar ${color === 'w' ? 'white' : 'black'}">${p.icon || ''}</div>
          <div class="pinfo"><b>${esc(p.name)}${p.sub ? ` <small class="muted">${esc(p.sub)}</small>` : ''}${think}</b>${caps || (p.status ? `<span class="peer-status ${p.statusBad ? 'bad' : ''}">${esc(p.status)}</span>` : '<span class="captures"></span>')}</div>${clock}`;
      };
      bar($('#bar-bottom'), bottom);
      bar($('#bar-top'), other(bottom));
    }

    tick() {
      const ck = this.clock;
      if (!ck || !this.game) return;
      for (const el of document.querySelectorAll('[data-clock]')) {
        const c = el.dataset.clock;
        const t = ck.time(c);
        el.textContent = CG.chessUtil.formatClock(t);
        el.classList.toggle('running', ck.running === c);
        el.classList.toggle('low', t < 20000);
        if (ck.running === c && t < 10000 && !this.lowWarned[c] && (this.cfg.me === c || this.cfg.me === 'both')) {
          this.lowWarned[c] = true;
          CG.Audio.play('lowtime');
        }
      }
      const f = ck.flagged();
      if (f && !this.game.over && this.cfg.onFlag) this.cfg.onFlag(f);
    }

    renderMoves() {
      const g = this.game;
      const el = $('#moves');
      const cur = this.viewPly ?? g.ply;
      if (!g.history.length) { el.innerHTML = `<div class="empty">${esc(this.cfg.emptyMoves || 'Noch keine Züge')}</div>`; return; }
      const startBlack = g.startFen.split(' ')[1] === 'b';
      let n = +g.startFen.split(' ')[5] || 1;
      let html = '';
      const tags = this.cfg.tags || {};
      const cell = (m, i) => {
        const ply = i + 1;
        const tag = tags[ply];
        const san = settings.germanSan ? CG.chessUtil.deSan(m.san) : m.san;
        return `<span class="mv ${ply === cur ? 'current' : ''} ${tag ? tag.cls : ''}" data-ply="${ply}">${esc(san)}${tag ? `<span class="tag">${tag.mark}</span>` : ''}</span>`;
      };
      let i = 0;
      if (startBlack) { html += `<span class="num">${n}.</span><span class="mv">…</span>${cell(g.history[0], 0)}`; i = 1; n++; }
      for (; i < g.history.length; i += 2) {
        html += `<span class="num">${n}.</span>${cell(g.history[i], i)}${g.history[i + 1] ? cell(g.history[i + 1], i + 1) : '<span></span>'}`;
        n++;
      }
      el.innerHTML = html;
      const curEl = el.querySelector('.current');
      if (curEl) {
        // Den aktuellen Zug ganz zeigen: waagerecht (Hochformat) mittig, sonst senkrecht
        if (el.scrollWidth > el.clientWidth) el.scrollLeft = curEl.offsetLeft - el.clientWidth / 2 + curEl.offsetWidth / 2;
        else curEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    setCoach(html) {
      const el = $('#coach');
      el.hidden = !html;
      if (html) el.innerHTML = html;
    }

    /** Knöpfe: [{ id, label, cls, onClick, disabled }] */
    setActions(list) {
      this.actions = list;
      const el = $('#actions');
      el.innerHTML = list.map((a, i) => `<button class="btn ${a.cls || 'btn-secondary'}" data-a="${i}" ${a.disabled ? 'disabled' : ''} ${a.title ? `title="${esc(a.title)}"` : ''}>${a.label}</button>`).join('');
      el.onclick = (e) => {
        const b = e.target.closest('[data-a]');
        if (b && !b.disabled) this.actions[+b.dataset.a].onClick();
      };
    }
    setAction(id, patch) {
      const a = this.actions.find((x) => x.id === id);
      if (!a) return;
      Object.assign(a, patch);
      this.setActions(this.actions);
    }

    setEval(cp, mate) {
      // cp/mate aus Sicht von Weiß
      const el = $('#eval');
      let share;
      let text;
      if (mate !== undefined && mate !== null) {
        // mate 0 = schon matt: Die Bewertung (cp) sagt, wer gewonnen hat
        const whiteWins = mate > 0 || (mate === 0 && cp > 0);
        share = whiteWins ? 1 : 0;
        text = mate === 0 ? (whiteWins ? '1–0' : '0–1') : `#${Math.abs(mate)}`;
      }
      else { share = 1 / (1 + Math.exp(-cp / 250)); text = `${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(1)}`; }
      el.querySelector('.eval-fill').style.width = `${Math.round(share * 100)}%`;
      el.querySelector('.eval-text').textContent = text;
    }

    emote(e) {
      const el = document.createElement('div');
      el.className = 'emote-pop';
      el.textContent = e;
      $('.board-frame').appendChild(el);
      setTimeout(() => el.remove(), 1900);
    }

    /** Rücknahme von n Halbzügen. */
    undo(n) {
      this.game.undo(n);
      if (!this.game.over) this.endedFor = null;
      this.sync();
    }
  }

  CG.GameView = GameView;
  CG.uciOf = toUci;
})(globalThis);
