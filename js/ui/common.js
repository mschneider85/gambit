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
    achQueue = achQueue.then(() => new Promise((r) => {
      CG.Audio.play('achievement');
      toast(esc(a.desc), { title: `Erfolg: ${a.name}`, icon: a.icon, cls: 'achievement', ms: 4200, badge: a.xp ? `+${a.xp} XP` : null });
      setTimeout(r, 900);
    }));
  });
  let pendingRank = null;
  progress.on('rank', (r) => { pendingRank = r; });
  /** Rangaufstieg anzeigen, falls einer anliegt (nach Ergebnisdialogen aufrufen). */
  function showRankUp() {
    if (!pendingRank) return Promise.resolve();
    const r = pendingRank;
    pendingRank = null;
    CG.Audio.play('levelup');
    return new Promise((resolve) => {
      const d = modal(`<div class="rays"></div><p class="muted">Neuer Rang</p><div class="levelup-rank rank-badge">${r.icon}</div>
        <div class="result-title">${esc(r.name)}</div><p>${r.next ? `Nächster Rang: ${esc(r.next.name)} bei ${r.next.xp} XP` : 'Du hast den höchsten Rang erreicht!'}</p>
        <div class="buttons"><button class="btn btn-primary" data-close>Weiter</button></div>`, { cls: 'celebrate', onClose: resolve });
      void d;
      achieve({ type: 'rank', index: r.index });
    });
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
    modal, ask, toast, progress, achieve, touchDay, showRankUp, rankHTML, syncAudioButtons, sleep, copy,
    get modalOpen() { return stack.length > 0; },
  };
})(globalThis);
