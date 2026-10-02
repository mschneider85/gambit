/*
 * Online-Lobby und Online-Partie: Raum eröffnen (Link, QR-Code, Raumcode) oder beitreten, Notlösung mit
 * Codes von Hand. Die Partie selbst führt CG.PvpSession; hier wird sie mit Brett und Knöpfen verbunden.
 * Reißt die Verbindung ab, warten beide bis zu DROP_WAIT_S Sekunden und betreten den Raum ab und zu neu.
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});
  const { $, esc, store, settings, setSetting, modal, toast, progress, achieve, sleep, show } = CG.UI;
  const Net = CG.Net;
  const { other } = CG.chessUtil;

  const DROP_WAIT_S = 120;
  const TCS = [[null, 'Ohne'], [[3, 2], '3+2'], [[5, 3], '5+3'], [[10, 0], '10+0'], [[15, 10], '15+10']];
  const EMOTES = ['👍', '😮', '😅', '🔥', '🤝', '👑'];

  let net = null; // { host, session, opts, drop, peerName, token }
  let view = null;
  const V = () => (view = view || CG.PvC.view());
  const myName = () => settings.name || 'Spieler';

  function setLobby(html) { $('#lobby-body').innerHTML = html; }
  function status(text, error) {
    const el = $('#lobby-body .status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!error);
  }

  /* ------------------------------------------------------------ Lobby */
  function open(o = {}) {
    leaveNet();
    show('lobby');
    $('#lobby-back').onclick = () => { leaveNet(); CG.Menu.open(); };
    if (o.join) { roomJoin(o.join); return; }
    const last = store.get('online-setup', { color: 'r', tc: 0 });
    setLobby(`<h2>Online spielen</h2>
      <p>Spiele direkt gegen Freunde – per Link, QR-Code oder Raumcode. Ohne Anmeldung, die Züge gehen direkt von Gerät zu Gerät.</p>
      <div class="field"><label for="on-name">Dein Name</label><input type="text" id="on-name" maxlength="20" value="${esc(settings.name)}" placeholder="Spieler"></div>
      <div class="field"><span class="label">Wenn du eröffnest: deine Farbe</span>
        <div class="seg" id="on-color"><button data-v="w">♔ Weiß</button><button data-v="r">🎲 Zufall</button><button data-v="b">♚ Schwarz</button></div></div>
      <div class="field"><span class="label">Bedenkzeit</span>
        <div class="seg" id="on-tc">${TCS.map(([, l], i) => `<button data-v="${i}">${l}</button>`).join('')}</div></div>
      <div class="row"><button class="btn btn-primary" id="on-host">🏰 Partie eröffnen</button><button class="btn btn-primary" id="on-join">🗝️ Beitreten</button></div>
      <p><button class="link-btn" id="on-manual">Klappt nicht? Ohne Vermittlung verbinden</button></p>
      <p class="status"></p>`);
    const state = { ...last };
    const seg = (id, key) => {
      const box = $(id);
      const mark = () => box.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === String(state[key])));
      box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state[key] = key === 'tc' ? +b.dataset.v : b.dataset.v; mark(); store.set('online-setup', state); } });
      mark();
    };
    seg('#on-color', 'color');
    seg('#on-tc', 'tc');
    const saveName = () => setSetting('name', $('#on-name').value.trim().slice(0, 20));
    $('#on-host').addEventListener('click', () => { saveName(); roomHost(state); });
    $('#on-join').addEventListener('click', () => { saveName(); roomJoin(null); });
    $('#on-manual').addEventListener('click', () => { saveName(); manual(state); });
  }

  function bindNet(host, opts) {
    Net.close();
    net = { host, opts, session: null, token: {}, drop: null, peerName: '' };
    const n = net;
    Net.on('message', (m) => { if (net === n && n.session) n.session.receive(m); });
    Net.on('open', () => {
      if (net !== n) return;
      if (n.session && n.session.game) { // nach einem Abriss wieder da
        n.drop = null;
        n.session.hello();
        n.session.sendState();
        updateBars();
        toast('Wieder verbunden');
        return;
      }
      status('Verbunden! Die Partie beginnt …');
      n.session = makeSession(n);
      n.session.hello();
    });
    Net.on('close', (wasOpen) => {
      if (net !== n) return;
      if (wasOpen && n.session && n.session.game) lost(`Die Verbindung zu ${n.peerName || 'deinem Gegner'} ist abgerissen.`);
      else status('Die Verbindung kam nicht zustande. Seid ihr beide online? In manchen Mobilfunknetzen klappt es nicht – dann hilft ein WLAN.', true);
    });
    Net.on('error', (text) => { if (net === n) status(text, true); });
    Net.on('drop', () => onDrop(n));
  }

  /** Gastgeber: Raum eröffnen, Link + QR + Code zeigen. */
  async function roomHost(opts) {
    bindNet(true, opts);
    const code = Net.newCode();
    const url = Net.link(code);
    setLobby('<h2>Partie eröffnen</h2><div class="spinner"></div><p class="status">Raum wird eröffnet …</p>');
    let qr = null;
    net.code = code;
    try { [qr] = await Promise.all([Net.linkUsable() ? Net.qrSVG(url) : null, Net.enterRoom(code)]); } catch (e) { status(e.message, true); return; }
    if (!net || !net.host) return;
    const share = navigator.share ? '<button class="btn btn-secondary" id="share">📤 Link teilen</button>' : '';
    const intro = qr ? '<p>Schick den Link – oder lass den QR-Code mit der Handykamera scannen.</p>'
      : `<p class="muted">⚠️ Diese Adresse (<b>${esc(location.host || 'lokale Datei')}</b>) kann kein anderes Gerät öffnen, deshalb gibt es keinen QR-Code.
         Auf diesem Rechner klappt der Raumcode in einem zweiten Browserfenster; für andere Geräte muss das Spiel über HTTPS laufen.</p>`;
    setLobby(`<h2>Partie eröffnen</h2>${intro}${qr ? `<div class="qr">${qr}</div>` : ''}
      <p class="muted">Raumcode</p><div class="code-big">${Net.prettyCode(code)}</div>
      <div class="row">${share}<button class="btn btn-secondary" id="copy">📋 Link kopieren</button></div>
      <div class="spinner"></div><p class="status">⏳ Warte auf deinen Gegner …</p>`);
    if (share) $('#share').addEventListener('click', () => navigator.share({ title: 'Gambit', text: 'Spielst du eine Partie Schach mit mir?', url }).catch(() => {}));
    $('#copy').addEventListener('click', () => CG.UI.copy(url, 'Link kopiert'));
  }

  /** Gast: Raumcode eingeben (aus dem Link vorausgefüllt) und beitreten. */
  function roomJoin(code) {
    show('lobby');
    $('#lobby-back').onclick = () => { leaveNet(); CG.Menu.open(); };
    setLobby(`<h2>Beitreten</h2>
      <div class="field"><label for="j-code">Raumcode</label><input type="text" id="j-code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" value="${code ? Net.prettyCode(code) : ''}"></div>
      <div class="field"><label for="j-name">Dein Name</label><input type="text" id="j-name" maxlength="20" value="${esc(settings.name)}" placeholder="Spieler"></div>
      <div class="row"><button class="btn btn-primary" id="j-go">Beitreten</button></div><p class="status"></p>`);
    const go = async () => {
      const c = Net.cleanCode($('#j-code').value);
      if (!c) { status('Der Raumcode hat 6 Zeichen, z. B. K7M-Q2P.', true); return; }
      setSetting('name', $('#j-name').value.trim().slice(0, 20));
      bindNet(false, null);
      net.code = c;
      $('#j-go').disabled = true;
      status('🔎 Suche die Partie …');
      try { await Net.enterRoom(c); } catch (e) { status(e.message, true); $('#j-go').disabled = false; return; }
      setTimeout(() => { if (net && !Net.connected && net.session === null) status('🔎 Noch nicht gefunden – ist der Raum beim Gastgeber offen? Es wird weiter gesucht …'); }, 20000);
    };
    $('#j-go').addEventListener('click', go);
    $('#lobby-body').onkeydown = (e) => { if (e.key === 'Enter' && $('#j-go') && !$('#j-go').disabled) go(); };
    (code ? $('#j-name') : $('#j-code')).focus();
  }

  /** Notlösung: zwei lange Codes von Hand tauschen. */
  function manual(opts) {
    setLobby(`<h2>Ohne Vermittlung</h2><p>Ihr tauscht zwei lange Codes selbst aus, z. B. per Messenger.</p>
      <div class="row"><button class="btn btn-primary" id="m-host">🏰 Eröffnen</button><button class="btn btn-primary" id="m-join">🗝️ Einladung annehmen</button></div><p class="status"></p>`);
    $('#m-host').addEventListener('click', async () => {
      bindNet(true, opts);
      setLobby('<h2>Eröffnen</h2><div class="spinner"></div><p class="status">Einladung wird vorbereitet …</p>');
      let code;
      try { code = await Net.host(); } catch (e) { status(e.message, true); return; }
      setLobby(`<h2>Eröffnen</h2><p><b>1.</b> Schick diesen Einladungscode deinem Gegner:</p>
        <div class="field"><textarea readonly>${esc(code)}</textarea></div><div class="row"><button class="btn btn-secondary" id="m-copy">📋 Kopieren</button></div>
        <p><b>2.</b> Füge hier seinen Antwortcode ein:</p><div class="field"><textarea id="m-answer" placeholder="GAMBIT1-…"></textarea></div>
        <div class="row"><button class="btn btn-primary" id="m-connect">Verbinden</button></div><p class="status"></p>`);
      $('#m-copy').addEventListener('click', () => CG.UI.copy(code));
      $('#m-connect').addEventListener('click', async () => {
        status('Verbinde …');
        try { await Net.accept($('#m-answer').value); } catch (e) { status(e.message, true); }
      });
    });
    $('#m-join').addEventListener('click', () => {
      bindNet(false, null);
      setLobby(`<h2>Einladung annehmen</h2><p><b>1.</b> Füge den Einladungscode ein:</p><div class="field"><textarea id="m-offer" placeholder="GAMBIT1-…"></textarea></div>
        <div class="row"><button class="btn btn-primary" id="m-next">Weiter</button></div><p class="status"></p>`);
      $('#m-next').addEventListener('click', async () => {
        status('Antwort wird vorbereitet …');
        let code;
        try { code = await Net.join($('#m-offer').value); } catch (e) { status(e.message, true); return; }
        setLobby(`<h2>Einladung annehmen</h2><p><b>2.</b> Schick diesen Antwortcode zurück:</p><div class="field"><textarea readonly>${esc(code)}</textarea></div>
          <div class="row"><button class="btn btn-secondary" id="m-copy2">📋 Kopieren</button></div><div class="spinner"></div><p class="status">Warte, bis der Gastgeber deinen Code eingibt …</p>`);
        $('#m-copy2').addEventListener('click', () => CG.UI.copy(code));
      });
    });
  }

  /* ------------------------------------------------------------ Sitzung */
  function makeSession(n) {
    const s = new CG.PvpSession({ role: n.host ? 'host' : 'guest', send: (m) => Net.send(m), name: myName(), build: Net.BUILD });
    s.on('hello', (h) => {
      n.peerName = h.name || 'Gegner';
      if (!h.sameBuild) {
        modal(`<h2>Unterschiedliche Versionen</h2><p>Ihr habt verschiedene Spielversionen geladen. Ladet bitte beide die Seite neu, damit alles zusammenpasst.</p>
          <div class="buttons"><button class="btn btn-primary" data-close>Verstanden</button></div>`);
      }
      if (n.host && !s.game) {
        const o = n.opts || { color: 'r', tc: 0 };
        const color = o.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : o.color;
        s.startGame(color, TCS[o.tc] ? TCS[o.tc][0] : null);
      } else if (s.game) updateBars();
    });
    s.on('start', () => { startView(n); remember(n); });
    s.on('move', (mv) => { if (V().game === s.game) { V().afterMove(mv); n.flagSeen = null; } remember(n); });
    s.on('sync', (g) => { remember(n); V().game = g; V().clock = s.clock; V().endedFor = null; V().sync(); if (g.over) V().ended(); });
    s.on('end', () => { if (V().game === s.game) V().ended(); });
    s.on('draw-offer', async () => {
      CG.Audio.play('select');
      const yes = await CG.UI.ask('Remis?', `${esc(n.peerName)} bietet ein Remis an.`, [{ label: 'Ablehnen', value: false }, { label: 'Annehmen', value: true, primary: true }]);
      s.answerDraw(!!yes);
    });
    s.on('draw-declined', () => toast(`${esc(n.peerName)} lehnt das Remis ab.`));
    s.on('takeback-ask', async (k) => {
      const yes = await CG.UI.ask('Zug zurücknehmen?', `${esc(n.peerName)} möchte ${k === 1 ? 'den letzten Zug' : 'die letzten zwei Halbzüge'} zurücknehmen.`, [{ label: 'Nein', value: false }, { label: 'Ja', value: true, primary: true }]);
      s.answerTakeback(!!yes);
    });
    s.on('takeback-no', () => toast(`${esc(n.peerName)} möchte nicht zurücknehmen.`));
    s.on('rematch-ask', () => { if (!s.pending.rematchMe) toast(`${esc(n.peerName)} möchte eine Revanche.`, { icon: '⚔️' }); });
    s.on('emote', (e) => { V().emote(e); CG.Audio.play('select'); });
    s.on('bye', () => {
      if (s.game && !s.game.over) { s.game.finish(s.me, 'abandon'); V().ended(); }
      else toast(`${esc(n.peerName)} hat die Partie verlassen.`);
      n.gone = true;
      Net.close();
    });
    return s;
  }

  function startView(n) {
    const s = n.session;
    CG.UI.touchDay();
    const players = {
      [s.me]: { name: myName(), icon: '🧝' },
      [other(s.me)]: { name: n.peerName || 'Gegner', icon: '🧙' },
    };
    n.players = players;
    n.flagSeen = null;
    V().start({
      mode: 'online', title: `⚔️ Online gegen ${n.peerName || 'Gegner'}`, sub: s.tc ? `Bedenkzeit ${s.tc[0]}+${s.tc[1]}` : 'Ohne Uhr',
      game: s.game, me: s.me, players, clock: s.clock, manageClock: false, emotes: EMOTES,
      canMove: () => s.myTurn && !n.drop,
      onUserMove: (mv) => { s.moved(mv); remember(n); },
      onEmote: (e) => s.emote(e),
      onFlag: (c) => {
        if (c === s.me) { s.flag(); return; }
        // Gegneruhr bei null: kurz warten (Laufzeit der Nachricht), dann Sieg beanspruchen
        if (!n.flagSeen) n.flagSeen = Date.now();
        else if (Date.now() - n.flagSeen > 3000) s.claimFlag();
      },
      actions: [
        { id: 'draw', label: '½ Remis', onClick: () => { if (!s.game.over) { s.offerDraw(); toast('Remis angeboten'); } } },
        { id: 'undo', label: '↶ Zurück', title: 'Rücknahme erbitten', onClick: () => { if (s.askTakeback()) toast('Rücknahme erbeten …'); } },
        { id: 'resign', label: '🏳️ Aufgeben', cls: 'btn-secondary btn-danger', onClick: async () => {
          const ok = await CG.UI.ask('Aufgeben?', '', [{ label: 'Weiterspielen', value: false }, { label: 'Aufgeben', value: true, primary: true }]);
          if (ok) s.resign();
        } },
      ],
      onBack: () => backFromGame(),
      onEnd: (r) => ended(n, r),
    });
  }

  function updateBars() {
    if (!net || !net.players || !net.session) return;
    const opp = net.players[other(net.session.me)];
    if (net.drop) { opp.status = `📡 Verbindung unterbrochen – warte (${Math.max(0, DROP_WAIT_S - Math.floor((Date.now() - net.drop.since) / 1000))} s)`; opp.statusBad = true; }
    else { delete opp.status; delete opp.statusBad; }
    V().renderBars();
  }

  function onDrop(n) {
    if (!n.session || !n.session.game || n.gone) return false;
    const drop = (n.drop = { since: Date.now() });
    updateBars();
    onDropLoop(n, drop);
    return true;
  }

  function onDropLoop(n, drop) {
    (async () => {
      for (let tries = 0; ;) {
        await sleep(1000);
        if (net !== n || n.drop !== drop) return;
        const secs = Math.floor((Date.now() - drop.since) / 1000);
        if (secs >= DROP_WAIT_S) { Net.close(); lost(`Die Verbindung zu ${n.peerName || 'deinem Gegner'} kam nicht wieder zustande.`); return; }
        // Gastgeber und Gast versetzt, damit sie sich nicht ständig verpassen
        if (secs >= (n.host ? 6 : 12) + tries * 15) { tries++; Net.rejoin(); }
        updateBars();
      }
    })();
  }

  function lost(text) {
    const n = net;
    if (!n) return;
    n.drop = null;
    n.gone = true;
    updateBars();
    const s = n.session;
    const running = s && s.game && !s.game.over;
    const d = modal(`<h2>Verbindung verloren</h2><p>${esc(text)}</p>${running ? '<p class="muted">Die Partie wird nicht gewertet.</p>' : ''}
      <div class="buttons"><button class="btn btn-secondary" data-close>Brett ansehen</button><button class="btn btn-primary" id="lost-menu">Zum Menü</button></div>`);
    d.el.querySelector('#lost-menu').addEventListener('click', () => { d.close(); leaveNet(); CG.Menu.open(); });
  }

  function ended(n, r) {
    const s = n.session;
    if (!s || n.counted === s.gid) return;
    n.counted = s.gid;
    store.del('online-resume');
    const outcome = r.winner === s.me ? 'win' : r.winner ? 'loss' : 'draw';
    CG.Audio.play(outcome === 'win' ? 'victory' : outcome === 'loss' ? 'defeat' : 'tie');
    if (r.reason !== 'abandon' || outcome === 'win') {
      const xp = progress.gameResult({ mode: 'online', outcome });
      achieve({ type: 'game-end', mode: 'online', outcome, game: s.game, me: s.me });
      progress.addXp(xp, 'Online-Partie');
    }
    V().setActions([
      { id: 'again', label: '⚔️ Revanche', cls: 'btn-primary', onClick: () => { if (n.gone) { toast('Dein Gegner ist nicht mehr da.'); return; } s.rematch(); toast(s.pending.rematchPeer ? 'Revanche!' : 'Revanche angefragt …'); } },
      { id: 'analyse', label: '🔍 Analyse', onClick: () => CG.PvC.analyse({ game: s.game, me: s.me, analysed: null }) },
      { id: 'pgn', label: '📋 PGN', onClick: () => CG.UI.copy(s.game.pgn({ White: s.me === 'w' ? myName() : n.peerName, Black: s.me === 'b' ? myName() : n.peerName }), 'PGN kopiert') },
    ]);
    const title = { win: 'Sieg!', loss: 'Niederlage', draw: 'Remis' }[outcome];
    setTimeout(() => modal(`<div class="big">${{ win: '🏆', loss: '🥀', draw: '🤝' }[outcome]}</div><div class="result-title">${title}</div><p class="muted">${esc(r.text)}</p>
      <div class="buttons"><button class="btn btn-primary" data-close>Brett ansehen</button></div>`, { onClose: () => CG.UI.showRankUp() }), r.reason === 'checkmate' ? 900 : 300);
  }

  async function backFromGame() {
    const n = net;
    const s = n && n.session;
    if (s && s.game && !s.game.over && !n.gone) {
      const ok = await CG.UI.ask('Partie verlassen?', 'Die Partie zählt dann als verloren.', [{ label: 'Weiterspielen', value: false }, { label: 'Verlassen', value: true, primary: true }]);
      if (!ok) return;
      s.resign();
    }
    leaveNet();
    V().stop();
    CG.Menu.open();
  }

  function leaveNet() {
    store.del('online-resume');
    if (!net) { Net.close(); return; }
    const n = net;
    net = null;
    if (n.session && !n.gone) Net.bye({ k: 'bye' });
    else Net.close();
  }

  /* ------------------------------------------------------------ Fortsetzen nach Neuladen */
  // Laufende Partie samt Raumcode merken: Lädt jemand die Seite neu, betritt er den Raum wieder und gleicht ab
  function remember(n) {
    const s = n && n.session;
    if (!s || !s.game || !n.code) return;
    if (s.game.over) { store.del('online-resume'); return; }
    store.set('online-resume', { code: n.code, host: n.host, peerName: n.peerName, s: s.snapshot(), at: Date.now() });
  }
  function resumable() {
    const r = store.get('online-resume', null);
    if (!r || Date.now() - r.at > 10 * 60000) return null;
    return r;
  }
  async function resume() {
    const r = resumable();
    if (!r) return;
    bindNet(r.host, null);
    const n = net;
    n.code = r.code;
    n.peerName = r.peerName;
    n.session = makeSession(n);
    n.session.restore(r.s);
    startView(n);
    n.drop = { since: Date.now() };
    updateBars();
    onDropLoop(n, n.drop);
    try { await Net.enterRoom(r.code); } catch (e) { lost(e.message); }
  }

  CG.Lobby = { open, resumable, resume, forget: () => store.del('online-resume') };
})(globalThis);
