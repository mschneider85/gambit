/*
 * Gemeinsame Oberflächen-Bausteine: Speicher, Einstellungen, Bildschirme, Dialoge, Toasts,
 * Fortschritt/Erfolge verdrahten, Geräte-Leistung beobachten.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`gambit-${k}`); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`gambit-${k}`, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } },
    del(k) { try { localStorage.removeItem(`gambit-${k}`); } catch (e) { /* egal */ } },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Element aus HTML-Text */
  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ------------------------------------------------------------ Einstellungen */
  const settings = {
    pieceSet: store.get('pieceSet', 'tatiana'),
    boardTheme: store.get('boardTheme', 'green'),
    coords: store.get('coords', true),
    showDests: store.get('showDests', true),
    germanSan: store.get('germanSan', true),
    name: store.get('name', ''),
  };
  function setSetting(k, v) {
    settings[k] = v;
    store.set(k, v);
    document.dispatchEvent(new CustomEvent('settings', { detail: { k, v } }));
  }
  const PIECE_SETS = [['tatiana', 'Tatiana'], ['governor', 'Governor'], ['celtic', 'Keltisch'], ['cburnett', 'Klassisch']];
  // Entfernte Sätze (gambit, modern, fantasy) aus älteren Einstellungen fallen auf den Standard zurück
  if (!PIECE_SETS.some(([id]) => id === settings.pieceSet)) settings.pieceSet = 'tatiana';
  const BOARD_THEMES = [['green', 'Grün'], ['walnut', 'Walnuss'], ['moon', 'Mondstein'], ['emerald', 'Smaragd'], ['classic', 'Turnier']];
  if (!BOARD_THEMES.some(([id]) => id === settings.boardTheme)) settings.boardTheme = 'green'; // z. B. entferntes „obsidian“

  /* ------------------------------------------------------------ Bildschirme */
  let current = 'menu';
  function show(id) {
    for (const s of $$('.screen')) s.hidden = s.id !== id;
    current = id;
    document.dispatchEvent(new CustomEvent('screen', { detail: id }));
  }

  /* ------------------------------------------------------------ Dialoge */
  const stack = [];
  /**
   * Dialog öffnen. html: Inhalt des .modal. opts: { cls, dismiss (Klick daneben/Esc schließt), onClose }
   * Liefert { el, close }.
   */
  function modal(html, opts = {}) {
    const ov = h(`<div class="overlay"><div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div></div>`);
    const m = ov.firstElementChild;
    const close = (v) => {
      if (!ov.isConnected) return;
      ov.remove();
      stack.splice(stack.indexOf(api), 1);
      if (opts.onClose) opts.onClose(v);
    };
    const api = { el: m, close, opts };
    if (opts.dismiss !== false) ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    $('#overlays').appendChild(ov);
    stack.push(api);
    m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(b.dataset.close)));
    const first = m.querySelector('[autofocus], .btn-primary');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
    return api;
  }
  /** Frage mit Knöpfen → Promise mit dem Wert des Knopfs */
  function ask(title, text, buttons) {
    return new Promise((resolve) => {
      const btns = buttons.map((b, i) => `<button class="btn ${b.primary ? 'btn-primary' : 'btn-secondary'}" data-i="${i}">${esc(b.label)}</button>`).join('');
      const d = modal(`<h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}<div class="buttons">${btns}</div>`, { onClose: (v) => resolve(v === undefined ? null : v) });
      d.el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => d.close(buttons[+b.dataset.i].value)));
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      const top = stack[stack.length - 1];
      if (top.opts.dismiss !== false) top.close();
    }
  });

  /* ------------------------------------------------------------ Toasts */
  function toast(text, opts = {}) {
    const t = h(`<div class="toast ${opts.cls || ''}">${opts.icon ? `<span class="t-icon">${opts.icon}</span>` : ''}<div class="t-text">${opts.title ? `<b>${esc(opts.title)}</b>` : ''}<span>${text}</span></div>${opts.badge ? `<span class="t-xp">${esc(opts.badge)}</span>` : ''}</div>`);
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, opts.ms || 2600);
  }

  /* ------------------------------------------------------------ Fortschritt & Erfolge */
  const progress = new CG.Progress();
  // Toasts für Erfolge kommen gestaffelt, damit mehrere gleichzeitige nicht übereinanderliegen
  let achQueue = Promise.resolve();
  progress.on('achievement', (a) => {
    achievementToast(a);
  });
  function achievementToast(a) {
    achQueue = achQueue.then(() => new Promise((r) => {
      CG.Audio.play('achievement');
      toast(esc(a.desc), { title: `Erfolg: ${a.name}`, icon: a.icon, cls: 'achievement', ms: 4200, badge: a.xp ? `+${a.xp} XP` : null });
      setTimeout(r, 900);
    }));
  }
  let pendingRank = null;
  progress.on('rank', (r) => { pendingRank = r; });
  /** Rangaufstieg anzeigen, falls einer anliegt (nach Ergebnisdialogen aufrufen). */
  function showRankUp() {
    if (!pendingRank) return Promise.resolve();
    const r = pendingRank;
    pendingRank = null;
    return rankUpDialog(r);
  }
  /** Feier für einen erreichten Rang (r wie progress.rank()); demo: ohne Erfolg „Rang erreicht“ (Effekt-Labor). */
  function rankUpDialog(r, demo = false) {
    CG.Audio.play('levelup');
    return new Promise((resolve) => {
      const letters = [...r.name].map((c, i) => `<span style="--i:${i}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
      let stop = () => {};
      const d = modal(`<div class="rays"></div><div class="rays rays-back"></div>
        <p class="rankup-kicker">Neuer Rang!</p>
        <div class="rankup-badge"><div class="levelup-rank rank-badge">${r.icon}</div></div>
        <div class="result-title rankup-name">${letters}</div>
        <p class="rankup-next">${r.next ? `Nächster Rang: ${esc(r.next.name)} bei ${r.next.xp} XP` : 'Du hast den höchsten Rang erreicht!'}</p>
        <div class="buttons rankup-buttons"><button class="btn btn-primary" data-close>Weiter</button></div>`,
      { cls: 'celebrate rankup', onClose: () => { stop(); resolve(); } });
      const ov = d.el.parentElement;
      ov.classList.add('rankup-overlay');
      ov.prepend(h('<div class="rankup-flash"></div>'));
      stop = fireworks(ov, 1 + r.index * 0.25, !r.next);
      if (!demo) achieve({ type: 'rank', index: r.index });
    });
  }

  /**
   * Feuerwerk auf einer Leinwand hinter dem Dialog: erst ein dichter Auftakt, dann ruhigere Raketen, solange
   * der Dialog offen ist. intensity skaliert den Auftakt (höhere Ränge feiern länger), finale = höchster Rang.
   * → Funktion zum Beenden.
   */
  function fireworks(host, intensity = 1, finale = false) {
    if (G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
    const cv = h('<canvas class="fireworks" aria-hidden="true"></canvas>');
    host.prepend(cv);
    const cx = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const size = () => {
      dpr = Math.min(2, G.devicePixelRatio || 1);
      W = host.clientWidth; H = host.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    G.addEventListener('resize', size);
    const COLORS = [[45, 100, 62], [8, 95, 60], [130, 80, 55], [200, 95, 62], [280, 85, 68], [330, 90, 65], [50, 30, 92]];
    const rockets = [], sparks = [];
    let running = true, raf = 0, last = performance.now();
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const pan = (x) => (x / W - .5) * 1.2;

    function launch(x = rand(.15, .85) * W) {
      const ty = rand(.12, .45) * H;
      const vy = Math.sqrt(2 * 520 * (H + 10 - ty));
      rockets.push({ x, y: H + 10, vx: rand(-40, 40), vy: -vy, ty, col: pick(COLORS) });
    }
    function burst(x, y, col) {
      const kind = pick(['peony', 'peony', 'ring', 'willow', 'double']);
      const n = Math.round(rand(70, 120) * (W < 600 ? .7 : 1));
      const speed = rand(170, 260) * Math.min(1.3, Math.max(.7, W / 1000));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-.05, .05);
        const v = kind === 'ring' ? speed : speed * Math.sqrt(Math.random());
        const c = kind === 'double' && i % 2 ? pick(COLORS) : kind === 'willow' ? [42, 90, 60] : col;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: kind === 'willow' ? rand(.28, .4) : rand(.5, .85),
          drag: kind === 'willow' ? .965 : .985, col: c, glitter: kind === 'willow' || Math.random() < .25, px: x, py: y });
      }
      sparks.push({ x, y, vx: 0, vy: 0, life: 1, decay: 4, drag: 1, col: [50, 100, 95], flash: speed * .45 });
      CG.Audio.play('firework', pan(x));
    }

    // Auftakt: eine Salve gleichzeitig, dann dichte Folge; danach ruhig weiter
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(() => running && fn(), ms));
    [.25, .5, .75].forEach((f, i) => later(150 + i * 120, () => launch(f * W)));
    const opening = Math.round(6 * intensity) + (finale ? 10 : 0);
    for (let i = 0; i < opening; i++) later(700 + i * rand(220, 380), () => launch());
    if (finale) later(700 + opening * 300, () => { for (let i = 0; i < 7; i++) setTimeout(() => running && launch(((i + .5) / 7) * W), i * 70); });
    const idle = setInterval(() => running && Math.random() < .8 && launch(), 1400);

    function frame(now) {
      if (!running || !cv.isConnected) return;
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      // Spuren ausblenden statt hart löschen
      cx.globalCompositeOperation = 'destination-out';
      cx.fillStyle = 'rgba(0,0,0,.28)';
      cx.fillRect(0, 0, W, H);
      cx.globalCompositeOperation = 'lighter';
      for (let i = rockets.length - 1; i >= 0; i--) {
        const k = rockets[i];
        k.vy += 520 * dt;
        k.x += k.vx * dt; k.y += k.vy * dt;
        cx.fillStyle = 'hsla(40, 100%, 75%, .9)';
        cx.beginPath(); cx.arc(k.x, k.y, 2.2, 0, Math.PI * 2); cx.fill();
        if (Math.random() < .8) sparks.push({ x: k.x, y: k.y, vx: rand(-20, 20), vy: rand(20, 60), life: .6, decay: 2.2, drag: .95, col: [38, 100, 65], px: k.x, py: k.y });
        if (k.vy >= -30 || k.y <= k.ty) { rockets.splice(i, 1); burst(k.x, k.y, k.col); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life -= p.decay * dt;
        if (p.life <= 0) { sparks.splice(i, 1); continue; }
        if (p.flash) {
          const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.flash);
          g.addColorStop(0, `rgba(255,245,210,${.5 * p.life})`); g.addColorStop(1, 'rgba(255,245,210,0)');
          cx.fillStyle = g; cx.fillRect(p.x - p.flash, p.y - p.flash, p.flash * 2, p.flash * 2);
          continue;
        }
        p.px = p.x; p.py = p.y;
        p.vx *= p.drag; p.vy = p.vy * p.drag + 90 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const a = p.glitter ? p.life * (Math.random() < .5 ? 1 : .25) : p.life;
        const [hh, ss, ll] = p.col;
        cx.strokeStyle = `hsla(${hh}, ${ss}%, ${ll}%, ${a})`;
        cx.lineWidth = 2;
        cx.beginPath(); cx.moveTo(p.px, p.py); cx.lineTo(p.x, p.y); cx.stroke();
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      clearInterval(idle);
      G.removeEventListener('resize', size);
      cv.remove();
    };
  }
  /** Ereignis an die Erfolge melden. */
  function achieve(event) { return CG.Achievements.check(event, progress); }
  function touchDay() {
    const d = progress.touchDay();
    achieve({ type: 'day', streak: d.streak });
    achieve({ type: 'session', hour: new Date().getHours() });
  }

  function rankHTML(big) {
    const r = progress.rank();
    return `<span class="rank-badge">${r.icon}</span><span><b>${esc(r.name)}</b><small>${progress.state.xp} XP${r.next ? ` · noch ${r.toNext} bis ${esc(r.next.name)}` : ''}</small>${big ? '' : `<span class="xpbar"><i style="width:${Math.round(r.progress * 100)}%"></i></span>`}</span>`;
  }

  /* ------------------------------------------------------------ Leistung */
  // Ruckelt es (viele lange Frames), schalten wir Partikel und Nebel ab
  (function watchFrames() {
    if (store.get('lowFx', false)) document.documentElement.classList.add('low-fx');
    let last = performance.now();
    let long = 0;
    let total = 0;
    let bad = 0;
    const tick = (t) => {
      const dt = t - last;
      last = t;
      if (!document.hidden && dt < 1000) { total += dt; if (dt > 45) long += dt; }
      if (total > 3000) {
        bad = long / total > 0.25 ? bad + 1 : 0;
        if (bad >= 3 && !document.documentElement.classList.contains('low-fx')) {
          document.documentElement.classList.add('low-fx');
          store.set('lowFx', true);
        }
        long = total = 0;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();

  /* ------------------------------------------------------------ Ton-Knöpfe */
  function syncAudioButtons() {
    for (const b of $$('.sfx-toggle')) { b.classList.toggle('off', !CG.Audio.settings.sfx); b.textContent = CG.Audio.settings.sfx ? '🔊' : '🔇'; }
    for (const b of $$('.music-toggle')) b.classList.toggle('off', !CG.Audio.settings.music);
  }
  document.addEventListener('click', (e) => {
    const s = e.target.closest('.sfx-toggle');
    const m = e.target.closest('.music-toggle');
    if (s) { CG.Audio.setSfx(!CG.Audio.settings.sfx); syncAudioButtons(); }
    if (m) { CG.Audio.setMusic(!CG.Audio.settings.music); syncAudioButtons(); }
  });
  // Jeder Knopf klickt hörbar (auch Menükacheln, Level, Auswahlschalter, Häkchen). Gesperrte Level spielen
  // stattdessen ihren eigenen Ton; Züge auf dem Brett haben eigene Geräusche.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, input[type=checkbox], summary');
    if (!t || t.disabled || t.closest('.level-node.locked')) return;
    CG.Audio.play('click');
  }, { capture: true });

  // Ton erst nach der ersten Berührung (Browser-Regel)
  const unlock = () => CG.Audio.unlock();
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  /*
   * Höhe der App vom Homescreen (iOS): Die Statusleiste liegt durchsichtig über dem Inhalt, die Seite darf also
   * den ganzen Bildschirm füllen. Gemeldet wird das aber unterschiedlich falsch – auf dem iPhone sind 100 %/dvh
   * um die Statusleiste zu kurz, auf dem iPad ist 100lvh zu lang (die untere Leiste wurde abgeschnitten).
   * Deshalb hier die Bildschirmhöhe in der aktuellen Ausrichtung; in Split View/Stage Manager (Fenster schmaler
   * als der Bildschirm) die echte Fensterhöhe.
   */
  function fitStandaloneHeight() {
    if (!navigator.standalone) return;
    const landscape = G.matchMedia('(orientation: landscape)').matches;
    const sw = landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const sh = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    const h = Math.abs(G.innerWidth - sw) > 2 ? G.innerHeight : sh;
    const root = document.documentElement;
    root.style.setProperty('--vh', `${h}px`);
    root.style.height = document.body.style.height = `${h}px`;
  }
  fitStandaloneHeight();
  G.addEventListener('resize', fitStandaloneHeight);
  G.addEventListener('orientationchange', () => setTimeout(fitStandaloneHeight, 300));

  // Kein Zoom per Geste (iOS ignoriert user-scalable=no)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** In die Zwischenablage, sonst Text zum Kopieren zeigen. */
  async function copy(text, label = 'Kopiert') {
    try { await navigator.clipboard.writeText(text); toast(label); return true; } catch (e) {
      modal(`<h2>Zum Kopieren</h2><div class="field"><textarea readonly>${esc(text)}</textarea></div><div class="buttons"><button class="btn btn-primary" data-close>Fertig</button></div>`);
      return false;
    }
  }

  CG.UI = {
    store, $, $$, esc, h, settings, setSetting, PIECE_SETS, BOARD_THEMES, show, get screen() { return current; },
    modal, ask, toast, achievementToast, progress, achieve, touchDay, showRankUp, rankUpDialog, rankHTML, syncAudioButtons, sleep, copy,
    get modalOpen() { return stack.length > 0; },
  };
})(globalThis);
