/*
 * Effekt-Labor zum Testen: Rangaufstieg, Erfolge, Level- und Partie-Ergebnisse, Toasts und alle Töne – in der
 * echten App, aber ohne den Spielstand zu verändern. Öffnen mit #debug oder #/debug in der Adresse (z. B. index.html#debug).
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { esc, modal, toast, achievementToast, rankUpDialog } = CG.UI;

  const RANKS = CG.progressUtil.RANKS;
  const rankAt = (i) => ({ ...RANKS[i], index: i, next: RANKS[i + 1] || null });

  function open() {
    const achs = CG.Achievements.list();
    const levels = CG.Campaign.all;
    const btn = (act, label, extra = '') => `<button class="btn btn-secondary" data-act="${act}" ${extra}>${label}</button>`;
    const d = modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>🧪 Effekt-Labor</h2>
      <p class="muted">Alle Effekte wie in der App – der Spielstand bleibt unverändert.</p>
      <h3>Rangaufstieg</h3>
      <div class="buttons debug-row">${RANKS.map((r, i) => btn('rank', `${r.icon} ${esc(r.name)}`, `data-i="${i}"`)).join('')}</div>
      <h3>Erfolg</h3>
      <div class="field"><select id="dbg-ach">${achs.map((a, i) => `<option value="${i}">${a.icon} ${esc(a.name)}${a.xp ? ` (+${a.xp} XP)` : ''}</option>`).join('')}</select></div>
      <div class="buttons debug-row">${btn('ach', '🏅 Zeigen')}${btn('ach3', '🏅🏅🏅 Drei auf einmal')}</div>
      <h3>Level geschafft</h3>
      <div class="field"><select id="dbg-level">${levels.map((l, i) => `<option value="${i}">${esc(CG.Campaign.chapters[l.ci].title)} · ${esc(l.title)}</option>`).join('')}</select></div>
      <label class="check-row"><input type="checkbox" id="dbg-chapter"> Kapitel gemeistert</label>
      <div class="buttons debug-row">${[1, 2, 3].map((n) => btn('level', '⭐'.repeat(n), `data-n="${n}"`)).join('')}${btn('level-rank', '⭐⭐⭐ + Rangaufstieg')}</div>
      <h3>Partie gegen den Computer</h3>
      <div class="buttons debug-row">${btn('game', '🏆 Sieg', 'data-o="win"')}${btn('game', '🤝 Remis', 'data-o="draw"')}${btn('game', '🥀 Niederlage', 'data-o="loss"')}${btn('game-halved', '🏆 Sieg mit Hilfen')}</div>
      <h3>Toast</h3>
      <div class="buttons debug-row">${btn('toast', '💬 Hinweis')}</div>
      <h3>Töne</h3>
      <div class="buttons debug-row">${CG.Audio.sounds().map((n) => btn('sound', esc(n), `data-n="${esc(n)}"`)).join('')}</div>
      <p class="muted">Töne nur mit eingeschalteten Soundeffekten.</p>`,
    { cls: 'wide', onClose: () => { if (wanted()) history.replaceState(null, '', location.pathname + location.search); } });

    const lvl = () => levels[+d.el.querySelector('#dbg-level').value];
    const levelDialog = (stars, rank) => {
      const l = lvl();
      const dlg = CG.Training.finishDialog(l, stars, Math.round(CG.progressUtil.XP.chapterFactor(l.ci) * (20 + 10 * stars)),
        { chapterDone: d.el.querySelector('#dbg-chapter').checked, next: CG.Campaign.all[CG.Campaign.all.indexOf(l) + 1] || null });
      // Wie im Spiel: der Rangaufstieg folgt nach dem Schließen
      dlg.el.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { dlg.close(); if (rank) rankUpDialog(rankAt(Math.min(RANKS.length - 1, 2)), true); }));
    };
    const gameDialog = (outcome, halved) => {
      const xp = outcome === 'win' ? 120 : outcome === 'draw' ? 48 : 8;
      CG.PvC.resultDialog({ demo: true, me: 'w', game: { history: Array.from({ length: 64 }, (_, i) => ({ color: i % 2 ? 'b' : 'w' })) } },
        { text: outcome === 'win' ? 'Schachmatt' : outcome === 'draw' ? 'Remis durch dreifache Wiederholung' : 'Schachmatt' },
        outcome, halved ? xp / 2 : xp, halved);
    };

    d.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      CG.Audio.unlock();
      const act = b.dataset.act;
      if (act === 'rank') rankUpDialog(rankAt(+b.dataset.i), true);
      else if (act === 'ach') achievementToast(achs[+d.el.querySelector('#dbg-ach').value]);
      else if (act === 'ach3') for (let k = 0; k < 3; k++) achievementToast(achs[(+d.el.querySelector('#dbg-ach').value + k) % achs.length]);
      else if (act === 'level') levelDialog(+b.dataset.n, false);
      else if (act === 'level-rank') levelDialog(3, true);
      else if (act === 'game') gameDialog(b.dataset.o, false);
      else if (act === 'game-halved') gameDialog('win', true);
      else if (act === 'toast') toast('Das ist ein ganz normaler Hinweis.');
      else if (act === 'sound') CG.Audio.play(b.dataset.n);
    });
  }

  const wanted = () => /^#\/?debug$/i.test(location.hash); // #debug oder #/debug
  G.addEventListener('hashchange', () => { if (wanted()) open(); });
  if (wanted()) setTimeout(open, 0);

  CG.Debug = { open };
})(globalThis);
