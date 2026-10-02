/*
 * Schachbrett als DOM-Komponente: 64 Felder (für Markierungen), darüber die Figuren (absolut positioniert,
 * gleiten per CSS-Transition), darüber Pfeile (SVG). Bedienung mit Maus, Finger oder Stift:
 * Ziehen & Ablegen oder Tippen–Tippen. Die Regeln kennt das Brett nicht – es fragt über dests(sq) nach
 * Zielfeldern und meldet Züge über onMove(from, to).
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const FILES = 'abcdefgh';
  const sqName = (f, r) => FILES[f] + (r + 1);
  const sqXY = (sq) => [FILES.indexOf(sq[0]), +sq[1] - 1];

  /** Figurenstellung aus FEN: { e1: 'wK', … } */
  function parseFen(fen) {
    const out = {};
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        out[sqName(f, 7 - i)] = color + ch.toUpperCase();
        f++;
      }
    });
    return out;
  }

  /** Ausschnitt der Brett-Textur für ein Feld: durcheinander, damit jedes Feld wie einzeln zugeschnitten wirkt. */
  const texturePos = (f, r) => `${((f * 5 + r * 3) % 8) * (100 / 7)}% ${((f * 3 + r * 7 + 2) % 8) * (100 / 7)}%`;

  const pieceUrl = (set, code) => `art/pieces/${set}/${code}.svg`;

  class Board {
    /**
     * opts: { orientation, pieceSet, coords, movable(sq) → bool, dests(sq) → [{ to, capture }],
     *         onMove(from, to), onSelect(sq) }
     */
    constructor(el, opts = {}) {
      this.el = el;
      this.o = { orientation: 'w', pieceSet: 'tatiana', coords: true, movable: () => false, dests: () => [], onMove: () => {}, onSelect: () => {}, ...opts };
      this.pos = {};
      this.pieces = new Map(); // sq → Element
      this.selected = null;
      this.marks = {};
      this.build();
    }

    build() {
      const el = this.el;
      el.classList.add('board');
      el.innerHTML = '';
      el.setAttribute('role', 'grid');
      el.setAttribute('aria-label', 'Schachbrett');
      this.sqLayer = document.createElement('div');
      this.sqLayer.className = 'squares';
      this.squares = {};
      for (let i = 0; i < 64; i++) {
        const d = document.createElement('div');
        this.sqLayer.appendChild(d);
      }
      this.pieceLayer = document.createElement('div');
      this.pieceLayer.className = 'pieces';
      this.arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.arrowLayer.setAttribute('class', 'arrows');
      this.arrowLayer.setAttribute('viewBox', '0 0 8 8');
      this.fxLayer = document.createElement('div');
      this.fxLayer.className = 'board-fx';
      // Beschriftung liegt über den Figuren, damit sie nie verdeckt wird
      this.coordLayer = document.createElement('div');
      this.coordLayer.className = 'coords';
      for (let i = 0; i < 64; i++) this.coordLayer.appendChild(document.createElement('div'));
      el.append(this.sqLayer, this.pieceLayer, this.coordLayer, this.arrowLayer, this.fxLayer);
      this.layoutSquares();
      el.addEventListener('pointerdown', (e) => this.down(e));
      el.addEventListener('pointermove', (e) => this.moveDrag(e));
      el.addEventListener('pointerup', (e) => this.up(e));
      el.addEventListener('pointercancel', () => this.cancelDrag());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('lostpointercapture', () => { if (this.drag) this.cancelDrag(); });
    }

    /** Felder nach Ausrichtung beschriften und zuordnen. */
    layoutSquares() {
      const flip = this.o.orientation === 'b';
      const divs = this.sqLayer.children;
      const cells = this.coordLayer.children;
      this.squares = {};
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const f = flip ? 7 - col : col;
          const r = flip ? row : 7 - row;
          const sq = sqName(f, r);
          const d = divs[row * 8 + col];
          d.className = `sq ${(f + r) % 2 ? 'light' : 'dark'}`;
          d.dataset.sq = sq;
          d.style.setProperty('--pos', texturePos(f, r));
          const cell = cells[row * 8 + col];
          cell.className = (f + r) % 2 ? 'light' : 'dark';
          cell.innerHTML = '';
          if (this.o.coords) {
            if (col === 0) cell.insertAdjacentHTML('beforeend', `<span class="coord rank">${r + 1}</span>`);
            if (row === 7) cell.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[f]}</span>`);
          }
          this.squares[sq] = d;
        }
      }
      this.applyMarks();
    }

    /** Bildschirmposition (in Feldern) eines Felds je nach Ausrichtung. */
    xy(sq) {
      const [f, r] = sqXY(sq);
      return this.o.orientation === 'b' ? [7 - f, r] : [f, 7 - r];
    }

    place(elm, sq) {
      const [x, y] = this.xy(sq);
      elm.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
    }

    makePiece(code, sq) {
      const p = document.createElement('div');
      p.className = `piece ${code}`;
      p.dataset.code = code;
      p.style.backgroundImage = `url("${pieceUrl(this.o.pieceSet, code)}")`;
      this.place(p, sq);
      this.pieceLayer.appendChild(p);
      return p;
    }

    /**
     * Stellung setzen (FEN oder {sq: code}). Figuren, die sich bewegt haben, gleiten an ihr neues Feld:
     * Erst bleiben unveränderte stehen, dann wird jede neue Figur der nächstgelegenen frei gewordenen
     * gleichen Figur zugeordnet (deckt Rochade, en passant, Zurückblättern ab); der Rest erscheint/verschwindet.
     */
    setPosition(fen, { animate = true } = {}) {
      const next = typeof fen === 'string' ? parseFen(fen) : fen;
      const old = this.pieces;
      const keep = new Map();
      const free = [];
      for (const [sq, elm] of old) {
        if (next[sq] === elm.dataset.code) keep.set(sq, elm);
        else free.push({ sq, elm });
      }
      const need = Object.keys(next).filter((sq) => !keep.has(sq));
      const dist = (a, b) => { const [x1, y1] = sqXY(a); const [x2, y2] = sqXY(b); return Math.abs(x1 - x2) + Math.abs(y1 - y2); };
      this.pieceLayer.classList.toggle('instant', !animate);
      for (const sq of need) {
        let bestI = -1;
        for (let i = 0; i < free.length; i++) {
          if (free[i].elm.dataset.code !== next[sq]) continue;
          if (bestI < 0 || dist(free[i].sq, sq) < dist(free[bestI].sq, sq)) bestI = i;
        }
        if (bestI >= 0) {
          const { elm } = free.splice(bestI, 1)[0];
          elm.classList.add('moving');
          this.place(elm, sq);
          setTimeout(() => elm.classList.remove('moving'), 260);
          keep.set(sq, elm);
        } else {
          // Neue Figur (Umwandlung, Rücknahme eines Schlagzugs): wenn möglich vom Bauern übernehmen
          let promoFrom = -1;
          if (animate) promoFrom = free.findIndex((x) => x.elm.dataset.code[1] === 'P' && x.elm.dataset.code[0] === next[sq][0]);
          const elm = this.makePiece(next[sq], promoFrom >= 0 ? free[promoFrom].sq : sq);
          if (promoFrom >= 0) {
            const gone = free.splice(promoFrom, 1)[0];
            gone.elm.remove();
            void elm.offsetWidth;
            elm.classList.add('moving');
            this.place(elm, sq);
          } else if (animate) elm.classList.add('appear');
          keep.set(sq, elm);
        }
      }
      for (const { elm } of free) {
        if (animate) {
          elm.classList.add('captured');
          setTimeout(() => elm.remove(), 300);
        } else elm.remove();
      }
      this.pieces = keep;
      this.pos = next;
      if (this.selected && !next[this.selected]) this.select(null);
      if (!animate) requestAnimationFrame(() => this.pieceLayer.classList.remove('instant'));
    }

    setOrientation(c) {
      if (this.o.orientation === c) return;
      this.o.orientation = c;
      this.layoutSquares();
      this.pieceLayer.classList.add('instant');
      for (const [sq, elm] of this.pieces) this.place(elm, sq);
      requestAnimationFrame(() => this.pieceLayer.classList.remove('instant'));
      this.drawArrows();
    }
    flip() { this.setOrientation(this.o.orientation === 'w' ? 'b' : 'w'); }

    setPieceSet(set) {
      this.o.pieceSet = set;
      for (const elm of this.pieces.values()) elm.style.backgroundImage = `url("${pieceUrl(set, elm.dataset.code)}")`;
    }

    /* ------------------------------------------------------------ Markierungen */
    /**
     * marks: { last: [from, to], check: sq, hint: [sq…], stars: [sq…], good: sq, bad: sq, targets: [sq…] }
     * Die Auswahl (selected + Zielfelder) verwaltet das Brett selbst.
     */
    setMarks(m) { this.marks = { ...this.marks, ...m }; this.applyMarks(); }
    clearMarks() { this.marks = {}; this.applyMarks(); }

    applyMarks() {
      const m = this.marks;
      const dests = this.selected ? this.o.dests(this.selected) : [];
      for (const [sq, d] of Object.entries(this.squares)) {
        const c = d.classList;
        c.toggle('last', !!(m.last && m.last.includes(sq)));
        c.toggle('check', m.check === sq);
        c.toggle('hint', !!(m.hint && m.hint.includes(sq)));
        c.toggle('star', !!(m.stars && m.stars.includes(sq)));
        c.toggle('target', !!(m.targets && m.targets.includes(sq)));
        c.toggle('good', m.good === sq);
        c.toggle('bad', m.bad === sq);
        c.toggle('selected', this.selected === sq);
        const dest = dests.find((x) => x.to === sq && !x.hidden);
        c.toggle('dest', !!dest && !dest.capture);
        c.toggle('dest-capture', !!dest && !!dest.capture);
      }
    }

    select(sq) {
      this.selected = sq;
      this.applyMarks();
      this.o.onSelect(sq);
    }

    /* ------------------------------------------------------------ Pfeile */
    /** arrows: [{ from, to, color: 'gold'|'green'|'red'|'blue' }] */
    setArrows(arrows) { this.arrows = arrows || []; this.drawArrows(); }

    drawArrows() {
      const svg = this.arrowLayer;
      const list = this.arrows || [];
      const c = (sq) => { const [x, y] = this.xy(sq); return [x + 0.5, y + 0.5]; };
      let html = '<defs>';
      for (const col of ['gold', 'green', 'red', 'blue']) {
        html += `<marker id="ah-${col}" viewBox="0 0 10 10" refX="3" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ah ${col}"/></marker>`;
      }
      html += '</defs>';
      for (const a of list) {
        const [x1, y1] = c(a.from);
        const [x2, y2] = c(a.to);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const k = (len - 0.42) / len; // Spitze endet vor der Feldmitte
        const col = a.color || 'gold';
        html += `<line class="arrow ${col}" x1="${x1}" y1="${y1}" x2="${x1 + (x2 - x1) * k}" y2="${y1 + (y2 - y1) * k}" marker-end="url(#ah-${col})"/>`;
      }
      svg.innerHTML = html;
    }

    /* ------------------------------------------------------------ Bedienung */
    squareAt(clientX, clientY) {
      const r = this.el.getBoundingClientRect();
      const x = Math.floor(((clientX - r.left) / r.width) * 8);
      const y = Math.floor(((clientY - r.top) / r.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return null;
      return this.o.orientation === 'b' ? sqName(7 - x, y) : sqName(x, 7 - y);
    }

    isDest(from, to) { return this.o.dests(from).some((d) => d.to === to); }

    down(e) {
      if (e.button !== undefined && e.button !== 0) return;
      const sq = this.squareAt(e.clientX, e.clientY);
      if (!sq) return;
      // Zweiter Tipp auf ein Zielfeld: ziehen
      if (this.selected && sq !== this.selected && this.isDest(this.selected, sq)) {
        const from = this.selected;
        this.select(null);
        this.o.onMove(from, sq);
        return;
      }
      if (this.o.movable(sq) && this.pos[sq]) {
        e.preventDefault();
        const wasSelected = this.selected === sq;
        this.select(sq);
        const elm = this.pieces.get(sq);
        const r = this.el.getBoundingClientRect();
        this.drag = { from: sq, elm, x0: e.clientX, y0: e.clientY, rect: r, moved: false, wasSelected };
        try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
        return;
      }
      if (this.selected) this.select(null);
      this.o.onEmptyTap && this.o.onEmptyTap(sq);
    }

    moveDrag(e) {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      if (!d.moved) { d.moved = true; d.elm.classList.add('dragging'); }
      const s = d.rect.width / 8;
      const x = (e.clientX - d.rect.left) / s - 0.5;
      const y = (e.clientY - d.rect.top) / s - 0.5;
      d.elm.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(1.15)`;
      const over = this.squareAt(e.clientX, e.clientY);
      if (over !== d.over) {
        if (d.over && this.squares[d.over]) this.squares[d.over].classList.remove('hover');
        d.over = over;
        if (over && this.squares[over]) this.squares[over].classList.add('hover');
      }
    }

    up(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (d.over && this.squares[d.over]) this.squares[d.over].classList.remove('hover');
      d.elm.classList.remove('dragging');
      if (!d.moved) {
        // Tippen auf die schon gewählte Figur hebt die Auswahl auf
        if (d.wasSelected) this.select(null);
        return;
      }
      const to = this.squareAt(e.clientX, e.clientY);
      if (to && to !== d.from && this.isDest(d.from, to)) {
        this.pieceLayer.classList.add('instant');
        this.place(d.elm, to);
        requestAnimationFrame(() => requestAnimationFrame(() => this.pieceLayer.classList.remove('instant')));
        this.select(null);
        this.o.onMove(d.from, to);
      } else {
        this.place(d.elm, d.from);
        if (to && to !== d.from && this.o.onIllegal) this.o.onIllegal(d.from, to);
      }
    }

    cancelDrag() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      d.elm.classList.remove('dragging');
      this.place(d.elm, d.from);
    }

    /* ------------------------------------------------------------ Umwandlung */
    /** Auswahl der Umwandlungsfigur über dem Zielfeld. → Promise<'q'|'r'|'b'|'n'|null> */
    askPromotion(color, to) {
      return new Promise((resolve) => {
        const [x, y] = this.xy(to);
        const down = y === 0; // Liste läuft vom Rand ins Brett hinein
        const box = document.createElement('div');
        box.className = 'promo';
        const close = (v) => { box.remove(); resolve(v); };
        ['q', 'n', 'r', 'b'].forEach((p, i) => {
          const b = document.createElement('button');
          b.className = 'promo-piece';
          b.style.left = `${x * 12.5}%`;
          b.style.top = `${(down ? y + i : y - i) * 12.5}%`;
          b.style.backgroundImage = `url("${pieceUrl(this.o.pieceSet, color + p.toUpperCase())}")`;
          b.setAttribute('aria-label', CG.chessUtil.NAMES[p]);
          b.addEventListener('pointerdown', (e) => { e.stopPropagation(); close(p); });
          box.appendChild(b);
        });
        box.addEventListener('pointerdown', (e) => { e.stopPropagation(); close(null); });
        this.el.appendChild(box);
      });
    }

    /* ------------------------------------------------------------ Effekte */
    /** Funken auf einem Feld (Schlagen, Stern eingesammelt, Matt). kind: 'capture'|'star'|'mate' */
    burst(sq, kind = 'capture') {
      if (document.documentElement.classList.contains('low-fx')) return;
      const [x, y] = this.xy(sq);
      const n = kind === 'mate' ? 26 : kind === 'star' ? 12 : 10;
      const box = document.createElement('div');
      box.className = `burst ${kind}`;
      box.style.left = `${(x + 0.5) * 12.5}%`;
      box.style.top = `${(y + 0.5) * 12.5}%`;
      for (let i = 0; i < n; i++) {
        const s = document.createElement('i');
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const d = (this.el.clientWidth / 8) * (kind === 'mate' ? 1.6 : 0.8) * (0.6 + Math.random() * 0.6);
        s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
        s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
        s.style.animationDelay = `${Math.random() * 60}ms`;
        box.appendChild(s);
      }
      this.fxLayer.appendChild(box);
      setTimeout(() => box.remove(), 1100);
    }

    /** Kurzes Wackeln (falscher Zug im Training). */
    shake() {
      this.el.classList.remove('shake');
      void this.el.offsetWidth;
      this.el.classList.add('shake');
    }
  }

  CG.Board = Board;
  CG.boardUtil = { parseFen, sqName, sqXY, FILES, texturePos };
})(globalThis);
