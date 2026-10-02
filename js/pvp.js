/*
 * Online-Partie zwischen zwei Geräten (ohne DOM, testbar). Beide Seiten führen die Partie mit chess.js
 * und prüfen jeden Zug; über das Netz gehen nur Nachrichten:
 *   hello  { build, name }                       – nach dem Verbinden, Versionsprüfung
 *   start  { gid, hostColor, tc, ver: 0 }         – Gastgeber startet eine Partie (auch Revanche)
 *   move   { gid, ver, ply, uci, time }           – ply = Anzahl Halbzüge nach dem Zug, time = Restzeit des Ziehenden
 *   state  { gid, ver, moves, result, clock, hostColor, tc } – kompletter Stand (nach Wiederverbinden oder bei Lücken)
 *   want   { gid }                                – bitte schick deinen Stand
 *   resign / flag / draw (offer|accept|decline) / takeback (ask|yes|no) / rematch / emote / bye
 * Regeln für den Abgleich: Jede Seite hängt nur eigene Züge an, deshalb ist bei gleicher Version (ver,
 * steigt mit jeder vereinbarten Rücknahme) der längere Zugverlauf der richtige – sofern er den eigenen
 * als Anfang enthält. Doppelte Nachrichten werden über ply erkannt und ignoriert.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { Game, Clock, chessUtil } = CG;
  const { other } = chessUtil;

  class PvpSession {
    /** o: { role: 'host'|'guest', send(msg), name, build, now() } */
    constructor(o) {
      this.role = o.role;
      this.send = o.send;
      this.name = o.name || '';
      this.build = o.build || 'dev';
      this.now = o.now || (() => Date.now());
      this.peerName = '';
      this.listeners = {};
      this.gid = null;
      this.game = null;
      this.ver = 0;
      this.me = null;
      this.clock = null;
      this.tc = null;
      this.pending = { draw: false, takeback: false, rematchMe: false, rematchPeer: false };
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
    emit(ev, d) { for (const fn of this.listeners[ev] || []) fn(d); }

    hello() { this.send({ k: 'hello', build: this.build, name: this.name }); }

    /** Gastgeber: neue Partie. hostColor 'w'|'b', tc [Minuten, Inkrement] oder null */
    startGame(hostColor, tc) {
      if (this.role !== 'host') return;
      const gid = Math.random().toString(36).slice(2, 10);
      const msg = { k: 'start', gid, hostColor, tc };
      this.begin(msg);
      this.send(msg);
    }

    begin(msg) {
      this.gid = msg.gid;
      this.hostColor = msg.hostColor;
      this.tc = msg.tc || null;
      this.ver = 0;
      this.me = this.role === 'host' ? msg.hostColor : other(msg.hostColor);
      this.game = new Game();
      this.clock = this.tc ? this.makeClock() : null;
      this.pending = { draw: false, takeback: false, rematchMe: false, rematchPeer: false };
      this.emit('start', { me: this.me, tc: this.tc });
    }

    /** Gespeicherten Stand wiederherstellen (nach Neuladen der Seite). */
    restore(d) {
      this.gid = d.gid;
      this.hostColor = d.hostColor;
      this.tc = d.tc || null;
      this.ver = d.ver || 0;
      this.me = this.role === 'host' ? d.hostColor : other(d.hostColor);
      this.game = new Game({ moves: d.moves || [] });
      this.clock = this.tc ? (d.clock ? CG.Clock.from(d.clock) : this.makeClock()) : null;
      if (this.clock) { this.clock.now = this.now; this.clock.running = null; if (!this.game.over && this.game.ply >= 2) this.clock.start(this.game.turn); }
    }
    snapshot() {
      return { gid: this.gid, hostColor: this.hostColor, tc: this.tc, ver: this.ver, moves: this.game ? this.game.uciMoves() : [], clock: this.clock ? this.clock.serialize() : null };
    }

    makeClock() {
      const c = new Clock({ base: this.tc[0] * 60000, inc: this.tc[1] * 1000 });
      c.now = this.now;
      return c;
    }

    get myTurn() { return !!this.game && !this.game.over && this.game.turn === this.me && !this.pending.takeback; }

    /** Eigener Zug (bereits legal geprüft vom Brett). → Zug oder null */
    move(uci) {
      if (!this.myTurn) return null;
      const mv = this.game.move(uci);
      if (!mv) return null;
      this.moved(mv);
      return mv;
    }

    /** Eigener Zug ist schon in this.game ausgeführt (von der Oberfläche): Uhr drücken und senden. */
    moved(mv) {
      const uci = mv.from + mv.to + (mv.promotion || '');
      this.pressClock(this.me);
      this.send({ k: 'move', gid: this.gid, ver: this.ver, ply: this.game.ply, uci, time: this.clock ? this.clock.time(this.me) : null });
      this.pending.draw = false;
      if (this.game.over) this.emit('end', this.game.result);
    }

    pressClock(mover) {
      const c = this.clock;
      if (!c || this.game.over) { if (c) c.stop(); return; }
      // Die Uhr läuft erst nach dem ersten Zug von Schwarz los (wie üblich online)
      if (this.game.ply === 1) return;
      if (this.game.ply === 2) { c.left[mover] += c.inc; c.start(other(mover)); return; }
      c.press(mover);
    }

    /* ------------------------------------------------------------ Empfang */
    receive(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.k) {
        case 'hello':
          this.peerName = String(m.name || '').slice(0, 20);
          this.emit('hello', { build: m.build, name: this.peerName, sameBuild: m.build === this.build });
          break;
        case 'start':
          if (this.role === 'guest' && m.gid !== this.gid) this.begin(m);
          break;
        case 'move': this.onMove(m); break;
        case 'want': if (this.game && m.gid === this.gid) this.sendState(); break;
        case 'state': this.onState(m); break;
        case 'resign':
          if (this.live(m)) { this.game.finish(this.me, 'resign'); this.emit('end', this.game.result); }
          break;
        case 'flag':
          // Gegner meldet: Seine Zeit ist abgelaufen
          if (this.live(m)) { this.game.finish(this.me, 'timeout'); this.clockStop(); this.emit('end', this.game.result); }
          break;
        case 'claim':
          // Gegner meldet: Ich habe die Zeit überschritten (seine Uhr sieht das so) – wir übernehmen
          if (this.live(m) && this.clock) { this.game.finish(other(this.me), 'timeout'); this.clockStop(); this.emit('end', this.game.result); }
          break;
        case 'draw':
          if (!this.live(m)) break;
          if (m.a === 'offer') { this.pending.drawPeer = true; this.emit('draw-offer'); }
          else if (m.a === 'accept' && this.pending.draw) { this.game.finish(null, 'agreement'); this.clockStop(); this.emit('end', this.game.result); }
          else if (m.a === 'decline') { this.pending.draw = false; this.emit('draw-declined'); }
          break;
        case 'takeback':
          if (!this.live(m, true)) break;
          if (m.a === 'ask') {
            if (m.ply !== this.game.ply || this.game.over) { this.send({ k: 'takeback', gid: this.gid, a: 'no' }); break; }
            this.pending.takebackPeer = { to: m.to, ply: m.ply };
            this.emit('takeback-ask', m.ply - m.to);
          } else if (m.a === 'yes' && this.pending.takeback) { this.pending.takeback = false; this.doTakeback(m.to, m.ver); }
          else if (m.a === 'no') { this.pending.takeback = false; this.emit('takeback-no'); }
          break;
        case 'rematch':
          if (m.gid !== this.gid) break;
          this.pending.rematchPeer = true;
          this.emit('rematch-ask');
          this.maybeRematch();
          break;
        case 'emote': this.emit('emote', String(m.e || '').slice(0, 4)); break;
        case 'bye': this.emit('bye'); break;
        default: break;
      }
    }

    live(m, evenOver) { return this.game && m.gid === this.gid && (evenOver || !this.game.over); }
    clockStop() { if (this.clock) this.clock.stop(); }

    onMove(m) {
      if (!this.game || m.gid !== this.gid) return;
      if (m.ver !== this.ver) { if (m.ver > this.ver) this.send({ k: 'want', gid: this.gid }); return; }
      if (m.ply <= this.game.ply) return; // doppelt
      if (m.ply > this.game.ply + 1) { this.send({ k: 'want', gid: this.gid }); return; } // Lücke
      if (this.game.over || this.game.turn === this.me) { this.send({ k: 'want', gid: this.gid }); return; }
      const mover = this.game.turn;
      const mv = this.game.move(m.uci);
      if (!mv) { this.send({ k: 'want', gid: this.gid }); return; }
      this.pressClock(mover);
      if (this.clock && typeof m.time === 'number' && this.game.ply > 2) this.clock.set(mover, m.time);
      this.pending.drawPeer = false;
      this.emit('move', mv);
      if (this.game.over) this.emit('end', this.game.result);
    }

    sendState() {
      if (!this.game) return;
      this.send({ k: 'state', gid: this.gid, ver: this.ver, moves: this.game.uciMoves(), result: this.game.result, clock: this.clock ? this.clock.serialize() : null, hostColor: this.hostColor, tc: this.tc });
    }

    /** Stand der Gegenseite übernehmen, wenn er neuer ist; sonst den eigenen zurückschicken. */
    onState(m) {
      if (m.gid !== this.gid) {
        // Wir kennen die Partie (noch) nicht – z. B. Gast nach Neuladen: übernehmen
        if (this.role === 'guest' && m.gid) { this.begin({ gid: m.gid, hostColor: m.hostColor, tc: m.tc }); } else return;
      }
      const mine = this.game.uciMoves();
      const theirs = m.moves || [];
      const prefix = (a, b) => a.every((x, i) => b[i] === x);
      const newer = m.ver > this.ver || (m.ver === this.ver && theirs.length > mine.length && prefix(mine, theirs));
      const sameEnd = m.ver === this.ver && theirs.length === mine.length && prefix(mine, theirs);
      if (newer) {
        const g = new Game({ moves: theirs });
        if (g.ply !== theirs.length) return; // ungültig
        this.game = g;
        this.ver = m.ver;
        // Offene Bitten beziehen sich auf den alten Stand (Antwort ging evtl. beim Abriss verloren)
        this.pending.takeback = false;
        this.pending.takebackPeer = null;
        this.pending.draw = false;
        this.pending.drawPeer = false;
        if (m.result && !g.result) g.result = m.result;
        if (this.clock && m.clock) { this.clock = CG.Clock.from(m.clock); this.clock.now = this.now; if (!g.over && g.ply >= 2) this.clock.start(g.turn); }
        this.emit('sync', this.game);
        if (g.over) this.emit('end', g.result);
      } else if (sameEnd) {
        if (m.result && !this.game.result) { this.game.result = m.result; this.emit('end', m.result); }
      } else if (m.ver === this.ver && !prefix(theirs, mine)) {
        // Auseinandergelaufen (sollte nicht vorkommen): Der Stand des Gastgebers gilt
        if (this.role === 'guest') {
          const g = new Game({ moves: theirs });
          if (g.ply !== theirs.length) return;
          this.game = g;
          if (m.result && !g.result) g.result = m.result;
          this.emit('sync', g);
        } else this.sendState();
      } else if (m.ver < this.ver || theirs.length < mine.length) {
        this.sendState();
      }
    }

    /* ------------------------------------------------------------ Aktionen */
    resign() {
      if (!this.game || this.game.over) return;
      this.send({ k: 'resign', gid: this.gid });
      this.game.finish(other(this.me), 'resign');
      this.clockStop();
      this.emit('end', this.game.result);
    }
    /** Eigene Uhr abgelaufen. */
    flag() {
      if (!this.game || this.game.over) return;
      this.send({ k: 'flag', gid: this.gid });
      this.game.finish(other(this.me), 'timeout');
      this.clockStop();
      this.emit('end', this.game.result);
    }
    /** Uhr des Gegners steht deutlich unter null (er meldet sich nicht): Sieg beanspruchen. */
    claimFlag() {
      if (!this.game || this.game.over || !this.clock) return;
      this.send({ k: 'claim', gid: this.gid });
      this.game.finish(this.me, 'timeout');
      this.clockStop();
      this.emit('end', this.game.result);
    }
    offerDraw() {
      if (!this.game || this.game.over) return;
      if (this.pending.drawPeer) { this.answerDraw(true); return; }
      this.pending.draw = true;
      this.send({ k: 'draw', gid: this.gid, a: 'offer' });
    }
    answerDraw(yes) {
      if (!this.game || this.game.over) return;
      this.pending.drawPeer = false;
      this.send({ k: 'draw', gid: this.gid, a: yes ? 'accept' : 'decline' });
      if (yes) { this.game.finish(null, 'agreement'); this.clockStop(); this.emit('end', this.game.result); }
    }
    /** Rücknahme des eigenen letzten Zugs (bzw. bis zum eigenen Zug zurück) erbitten. */
    askTakeback() {
      if (!this.game || this.game.over) return false;
      const myMoves = this.game.history.filter((m) => m.color === this.me).length;
      if (!myMoves) return false;
      if (this.pending.takeback) return false;
      const n = this.game.turn === this.me ? 2 : 1;
      this.pending.takeback = true;
      this.send({ k: 'takeback', gid: this.gid, a: 'ask', ply: this.game.ply, to: this.game.ply - n });
      return true;
    }
    answerTakeback(yes) {
      const t = this.pending.takebackPeer;
      this.pending.takebackPeer = null;
      if (!t || !this.game) return;
      // Inzwischen weitergezogen? Dann gilt die Bitte nicht mehr
      if (!yes || t.ply !== this.game.ply || this.game.over) { this.send({ k: 'takeback', gid: this.gid, a: 'no' }); return; }
      const ver = this.ver + 1;
      this.send({ k: 'takeback', gid: this.gid, a: 'yes', to: t.to, ver });
      this.doTakeback(t.to, ver);
    }
    doTakeback(to, ver) {
      if (ver <= this.ver) return;
      this.game.undo(this.game.ply - to);
      this.ver = ver;
      // Vor dem zweiten Halbzug läuft keine Uhr (wie beim Start)
      if (this.clock) { if (!this.game.over && this.game.ply >= 2) this.clock.start(this.game.turn); else this.clock.stop(); }
      this.emit('sync', this.game);
    }
    rematch() {
      this.pending.rematchMe = true;
      this.send({ k: 'rematch', gid: this.gid });
      this.maybeRematch();
    }
    maybeRematch() {
      if (this.pending.rematchMe && this.pending.rematchPeer && this.role === 'host') this.startGame(other(this.hostColor), this.tc);
    }
    emote(e) { this.send({ k: 'emote', e }); }
  }

  CG.PvpSession = PvpSession;
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
