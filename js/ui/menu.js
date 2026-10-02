/*
 * Hauptmenü und App-Start: Modus-Kacheln, Fortsetzen, Einstellungen, Erfolge, Über; Einladungslinks (#spiel=…).
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { $, $$, esc, settings, setSetting, PIECE_SETS, BOARD_THEMES, modal, toast, progress, rankHTML, show, syncAudioButtons } = CG.UI;

  function open() {
    show('menu');
    CG.Audio.setMood('menu');
    render();
  }

  function render() {
    $('#menu-rank').innerHTML = rankHTML();
    const sv = CG.PvC.savedGame();
    const btn = $('#btn-resume');
    btn.hidden = !sv;
    if (sv) {
      const l = CG.Strength.level(sv.elo);
      btn.textContent = `Partie fortsetzen: ${l.icon} ${l.name} (${sv.elo}), Zug ${Math.floor(sv.game.moves.length / 2) + 1}`;
    }
    syncAudioButtons();
  }

  /* ------------------------------------------------------------ Einstellungen */
  // Vorschau: kleines Brett nach 1. e4 e5 2. Sf3 Sc6 3. Lc4 Sf6 mit markiertem letzten Zug
  const PREVIEW_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R';
  function previewBoard() {
    const pos = CG.boardUtil.parseFen(PREVIEW_FEN);
    const theme = `theme-${settings.boardTheme}`;
    let sq = '';
    let pcs = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const name = CG.boardUtil.sqName(col, 7 - row);
        const last = name === 'g8' || name === 'f6' ? ' last' : '';
        sq += `<div class="sq ${(col + 7 - row) % 2 ? 'light' : 'dark'}${last}" style="--pos:${CG.boardUtil.texturePos(col, 7 - row)}"></div>`;
        if (pos[name]) pcs += `<div class="piece" style="transform:translate(${col * 100}%,${row * 100}%);background-image:url('art/pieces/${settings.pieceSet}/${pos[name]}.svg')"></div>`;
      }
    }
    return `<div class="board ${theme}"><div class="squares">${sq}</div><div class="pieces">${pcs}</div></div>`;
  }

  function settingsDialog() {
    const segs = (id, list, cur) => `<div class="seg" id="${id}">${list.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const d = modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>Einstellungen</h2>
      <div class="field"><label for="set-name">Dein Name</label><input type="text" id="set-name" maxlength="20" placeholder="z. B. Lancelot" value="${esc(settings.name)}"></div>
      <div class="field"><span class="label">Figuren</span>${segs('set-pieces', PIECE_SETS, settings.pieceSet)}</div>
      <div class="field"><span class="label">Brett</span>${segs('set-theme', BOARD_THEMES, settings.boardTheme)}</div>
      <div class="board-preview" id="board-preview" aria-label="Vorschau von Brett und Figuren"></div>
      <label class="check-row"><input type="checkbox" id="set-coords" ${settings.coords ? 'checked' : ''}> Koordinaten am Brett</label>
      <label class="check-row"><input type="checkbox" id="set-dests" ${settings.showDests ? 'checked' : ''}> Mögliche Züge anzeigen</label>
      <label class="check-row"><input type="checkbox" id="set-san" ${settings.germanSan ? 'checked' : ''}> Deutsche Zugnotation (S, L, T, D statt N, B, R, Q)</label>
      <label class="check-row"><input type="checkbox" id="set-sfx" ${CG.Audio.settings.sfx ? 'checked' : ''}> Soundeffekte</label>
      <label class="check-row"><input type="checkbox" id="set-music" ${CG.Audio.settings.music ? 'checked' : ''}> Musik</label>
      <label class="check-row"><input type="checkbox" id="set-lowfx" ${document.documentElement.classList.contains('low-fx') ? 'checked' : ''}> Weniger Effekte (für langsame Geräte)</label>
      <h3>Spielstand</h3>
      <p class="muted">Alles wird nur in diesem Browser gespeichert. Mit dem Code nimmst du deinen Fortschritt auf ein anderes Gerät mit.</p>
      <div class="buttons"><button class="btn btn-secondary" id="set-export">📤 Exportieren</button><button class="btn btn-secondary" id="set-import">📥 Importieren</button><button class="btn btn-secondary btn-danger" id="set-reset">🗑️ Zurücksetzen</button></div>`, { cls: 'wide', onClose: () => render() });
    const el = d.el;
    const preview = () => { el.querySelector('#board-preview').innerHTML = previewBoard(); };
    preview();
    const segBind = (id, key, after) => el.querySelector(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll(`${id} button`).forEach((x) => x.classList.toggle('active', x === b));
      setSetting(key, b.dataset.v);
      if (after) after();
    });
    segBind('#set-pieces', 'pieceSet', preview);
    segBind('#set-theme', 'boardTheme', preview);
    el.querySelector('#set-name').addEventListener('change', (e) => setSetting('name', e.target.value.trim().slice(0, 20)));
    el.querySelector('#set-coords').addEventListener('change', (e) => setSetting('coords', e.target.checked));
    el.querySelector('#set-san').addEventListener('change', (e) => setSetting('germanSan', e.target.checked));
    el.querySelector('#set-dests').addEventListener('change', (e) => setSetting('showDests', e.target.checked));
    el.querySelector('#set-sfx').addEventListener('change', (e) => { CG.Audio.setSfx(e.target.checked); syncAudioButtons(); });
    el.querySelector('#set-music').addEventListener('change', (e) => { CG.Audio.setMusic(e.target.checked); syncAudioButtons(); });
    el.querySelector('#set-lowfx').addEventListener('change', (e) => { document.documentElement.classList.toggle('low-fx', e.target.checked); CG.UI.store.set('lowFx', e.target.checked); });
    el.querySelector('#set-export').addEventListener('click', () => {
      const code = progress.exportCode();
      modal(`<h2>Spielstand exportieren</h2><p class="muted">Kopiere diesen Code und füge ihn auf dem anderen Gerät unter „Importieren“ ein.</p>
        <div class="field"><textarea readonly id="exp-code">${esc(code)}</textarea></div>
        <div class="buttons"><button class="btn btn-primary" id="exp-copy">📋 Kopieren</button><button class="btn btn-secondary" id="exp-file">💾 Als Datei</button></div>`)
        .el.addEventListener('click', (e) => {
          if (e.target.id === 'exp-copy') CG.UI.copy(code, 'Code kopiert');
          if (e.target.id === 'exp-file') {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
            a.download = `gambit-spielstand-${CG.progressUtil.today()}.txt`;
            a.click();
          }
        });
    });
    el.querySelector('#set-import').addEventListener('click', () => {
      const m = modal(`<h2>Spielstand importieren</h2><p class="muted">Achtung: Der aktuelle Fortschritt auf diesem Gerät wird ersetzt.</p>
        <div class="field"><textarea id="imp-code" placeholder="GAMBIT1:…"></textarea></div>
        <div class="field"><input type="file" id="imp-file" accept=".txt,text/plain"></div>
        <div class="buttons"><button class="btn btn-primary" id="imp-go">Importieren</button></div>`);
      m.el.querySelector('#imp-file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (f) m.el.querySelector('#imp-code').value = (await f.text()).trim();
      });
      m.el.querySelector('#imp-go').addEventListener('click', () => {
        try {
          progress.importCode(m.el.querySelector('#imp-code').value);
          m.close();
          toast('Spielstand übernommen');
          render();
        } catch (err) { toast(esc(err.message), { cls: 'error' }); }
      });
    });
    el.querySelector('#set-reset').addEventListener('click', async () => {
      const ok = await CG.UI.ask('Alles zurücksetzen?', 'Rang, Sterne, Erfolge und Statistik werden gelöscht.', [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, primary: true }]);
      if (ok) { progress.reset(); toast('Fortschritt gelöscht'); render(); }
    });
  }

  /* ------------------------------------------------------------ Erfolge */
  function achievementsDialog() {
    const list = CG.Achievements.list();
    const st = progress.state;
    const got = list.filter((a) => st.ach[a.id]).length;
    const items = list.map((a) => {
      const has = !!st.ach[a.id];
      const pr = CG.Achievements.progressOf(a, st);
      const hidden = a.secret && !has;
      return `<div class="ach ${has ? '' : 'locked'}"><span class="a-icon">${hidden ? '❔' : a.icon}</span><div><b>${hidden ? 'Geheim' : esc(a.name)}</b>
        <small>${hidden ? 'Wird verraten, sobald du ihn hast.' : esc(a.desc)}</small>
        ${pr && !has ? `<div class="a-bar"><i style="width:${Math.round((pr[0] / pr[1]) * 100)}%"></i></div><small>${pr[0]} / ${pr[1]}</small>` : ''}
        ${has ? `<small>✓ ${new Date(st.ach[a.id]).toLocaleDateString('de-DE')}</small>` : ''}</div></div>`;
    }).join('');
    const s = st.stats;
    modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>🏆 Erfolge</h2>
      <p class="ach-summary">${got} von ${list.length} freigeschaltet</p>
      <div class="stat-row"><div><b>${s.games}</b><small>Partien</small></div><div><b>${s.wins}</b><small>Siege</small></div><div><b>${s.bestWin || '–'}</b><small>beste besiegte ELO</small></div><div><b>${s.puzzles.solved}</b><small>Rätsel gelöst</small></div></div>
      <div class="ach-grid">${items}</div>`, { cls: 'wide' });
  }

  function rankDialog() {
    const r = progress.rank();
    const ranks = CG.progressUtil.RANKS.map((x, i) => `<div class="ach ${i <= r.index ? '' : 'locked'}"><span class="a-icon">${x.icon}</span><div><b>${esc(x.name)}</b><small>ab ${x.xp} XP</small></div></div>`).join('');
    const d = modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>Dein Rang</h2>
      <div class="rank-card" style="margin:0 0 10px">${rankHTML(true)}</div>
      <div class="xpbar" style="height:10px"><i style="width:${Math.round(r.progress * 100)}%"></i></div>
      <p class="muted">XP gibt es für Trainingslevel (je Stern), Siege gegen den Computer (je stärker, desto mehr), Online-Partien und Erfolge.</p>
      <div class="ach-grid">${ranks}</div>
      <div class="buttons"><button class="btn btn-primary" id="rank-train">📜 Zum Training</button></div>`, { cls: 'wide' });
    d.el.querySelector('#rank-train').addEventListener('click', () => { d.close(); CG.Training.open(); });
  }

  function aboutDialog() {
    modal(`<button class="icon-btn modal-close" data-close aria-label="Schließen">✕</button><h2>Über Gambit</h2>
      <p>Schach im Browser – ohne Server, ohne Konto. Läuft auch offline und lässt sich als App installieren
      (iPhone/iPad: Teilen → „Zum Home-Bildschirm“; Chrome/Edge: „App installieren“).</p>
      <h3>Mit Dank an</h3>
      <p class="muted" style="text-align:left">
      <b>Stockfish 19</b> (GPLv3) – das Stockfish-Team, WASM-Fassung von Nathan Rugg / Chess.com<br>
      <b>chess.js</b> (BSD) – Jeff Hlywa<br>
      <b>Figuren</b> „Tatiana“ von sadsnake1 (CC BY-NC-SA 4.0), „Governor“ von lichess.org (AGPLv3+), „Celtic“ und das Wappen-Pferd („Fantasy“) von Maurizio Monge (MIT), „cburnett“ von Colin M.L. Burnett (GPLv2+)<br>
      <b>Rätsel</b> aus der Lichess-Puzzle-Datenbank (CC0)<br>
      <b>Trystero</b> (MIT) für die Direktverbindung, <b>QR Code Generator</b> von Kazuhiko Arase (MIT)<br>
      <b>Schriften</b> Cinzel und Alegreya (SIL OFL), <b>Texturen</b> von ambientCG (CC0)</p>
      <div class="buttons"><button class="btn btn-primary" data-close>Schließen</button></div>`);
  }

  /* ------------------------------------------------------------ Start */
  function boot() {
    $$('.mode-tile').forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'pvc') CG.PvC.setupDialog();
      else if (m === 'online') CG.Lobby.open();
      else if (m === 'training') CG.Training.open();
    }));
    $('#btn-resume').addEventListener('click', () => CG.PvC.resume());
    $('#btn-settings').addEventListener('click', settingsDialog);
    $('#btn-achievements').addEventListener('click', achievementsDialog);
    $('#training-achievements').addEventListener('click', achievementsDialog);
    $('#btn-local').addEventListener('click', () => CG.PvC.startLocal());
    $('#btn-about').addEventListener('click', aboutDialog);
    $('#menu-rank').addEventListener('click', rankDialog);
    progress.on('xp', () => { if (CG.UI.screen === 'menu') render(); });
    open();
    CG.UI.touchDay();
    // Einladungslink: direkt dem Raum beitreten
    // Online-Partie lief beim Neuladen noch: wieder in den Raum
    if (CG.Lobby.resumable()) { CG.Lobby.resume(); return; }
    const code = CG.Net.codeFromLink();
    if (code) CG.Lobby.open({ join: code });
  }

  CG.Menu = { open, render, settingsDialog, achievementsDialog, rankDialog };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis);
