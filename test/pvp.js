/*
 * Online-Partien im Gleichschritt: Zwei Sitzungen über einen unzuverlässigen Kanal (Verlust, Verdopplung,
 * Vertauschung, Abrisse mit Neuabgleich). Am Ende müssen beide denselben Zugverlauf und dasselbe Ergebnis haben.
 *   node test/pvp.js [Partien]
 */
const CG = require('../js/game.js');
require('../js/pvp.js');

const N = +(process.argv[2] || 200);
let fails = 0;

function run(seed) {
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const queues = { host: [], guest: [] }; // Nachrichten an …
  let online = true;
  const chan = (to) => (m) => {
    if (!online || rnd() < 0.05) return; // verloren
    const copy = JSON.parse(JSON.stringify(m));
    queues[to].push(copy);
    if (rnd() < 0.05) queues[to].push(copy); // doppelt
  };
  const host = new CG.PvpSession({ role: 'host', send: chan('guest'), build: 't' });
  const guest = new CG.PvpSession({ role: 'guest', send: chan('host'), build: 't' });
  const peers = { host, guest };
  host.startGame(rnd() < 0.5 ? 'w' : 'b', null);
  // Start sicher zustellen (in der App wartet der Gastgeber auf hello)
  if (!guest.game) guest.receive(JSON.parse(JSON.stringify({ k: 'start', gid: host.gid, hostColor: host.hostColor, tc: null })));
  const deliver = () => {
    for (const to of ['host', 'guest']) {
      const q = queues[to];
      if (!q.length) continue;
      const i = rnd() < 0.15 && q.length > 1 ? 1 : 0; // manchmal vertauscht
      peers[to].receive(q.splice(i, 1)[0]);
    }
  };
  for (let step = 0; step < 3000; step++) {
    if (host.game.over && guest.game.over) break;
    const x = rnd();
    if (x < 0.02) { online = false; } // Abriss
    else if (x < 0.06 && !online) { online = true; host.sendState(); guest.sendState(); } // wieder da
    else if (x < 0.07) { const p = rnd() < 0.5 ? host : guest; if (p.askTakeback()) { /* Antwort folgt */ } }
    for (const p of [host, guest]) {
      if (p.pending.takebackPeer && rnd() < 0.5) p.answerTakeback(rnd() < 0.7);
      if (p.myTurn && rnd() < 0.5) {
        const legal = p.game.legal();
        const m = legal[Math.floor(rnd() * legal.length)];
        p.move(m.from + m.to + (m.promotion || ''));
      }
    }
    if (rnd() < 0.002) { const p = rnd() < 0.5 ? host : guest; p.resign(); }
    deliver();
    if (step % 50 === 0 && online) { host.sendState(); }
  }
  // Ruhe: Netz an, alles zustellen, Stände abgleichen
  online = true;
  for (let i = 0; i < 20; i++) {
    host.sendState(); guest.sendState();
    while (queues.host.length || queues.guest.length) deliver();
  }
  const a = host.game.uciMoves().join(' ');
  const b = guest.game.uciMoves().join(' ');
  const ra = JSON.stringify(host.game.result && host.game.result.winner);
  const rb = JSON.stringify(guest.game.result && guest.game.result.winner);
  if (a !== b || ra !== rb || host.ver !== guest.ver) {
    fails++;
    if (fails < 4) console.log(`Abweichung (Seed ${seed}):\n host ${host.ver} ${ra} ${a}\n gast ${guest.ver} ${rb} ${b}`);
  }
}

for (let i = 1; i <= N; i++) run(i * 7919);

// Einzelfälle aus dem Review
function pair(tc) {
  const q = { host: [], guest: [] };
  let up = true;
  const host = new CG.PvpSession({ role: 'host', send: (m) => up && q.guest.push(JSON.parse(JSON.stringify(m))), build: 't' });
  const guest = new CG.PvpSession({ role: 'guest', send: (m) => up && q.host.push(JSON.parse(JSON.stringify(m))), build: 't' });
  const flush = () => { while (q.host.length || q.guest.length) { if (q.guest.length) guest.receive(q.guest.shift()); if (q.host.length) host.receive(q.host.shift()); } };
  host.startGame('w', tc);
  flush();
  return { host, guest, flush, net: (v) => { up = v; } };
}
{
  // Rücknahme zurück vor den zweiten Halbzug: keine Uhr darf laufen
  const { host, guest, flush } = pair([5, 0]);
  host.move('e2e4'); flush(); guest.move('e7e5'); flush();
  host.askTakeback(); flush(); guest.answerTakeback(true); flush();
  if (host.game.ply !== 0 || host.clock.running || guest.clock.running) { fails++; console.log('Fehler: Uhr läuft nach Rücknahme auf Zug 0', host.game.ply, host.clock.running, guest.clock.running); }
}
{
  // Antwort auf eine Rücknahme geht beim Abriss verloren: nach dem Abgleich darf man wieder ziehen
  const { host, guest, flush, net } = pair(null);
  host.move('e2e4'); flush(); guest.move('e7e5'); flush(); host.move('g1f3'); flush();
  host.askTakeback(); flush();
  net(false); guest.answerTakeback(true); net(true);
  host.sendState(); guest.sendState(); flush();
  if (host.pending.takeback || host.game.ply !== guest.game.ply) { fails++; console.log('Fehler: Rücknahme hängt nach Abriss', host.pending.takeback, host.game.ply, guest.game.ply); }
  else if (!host.myTurn) { fails++; console.log('Fehler: Gastgeber kann nach Abgleich nicht ziehen'); }
}
console.log(fails ? `FEHLER: ${fails} von ${N} Partien weichen ab` : `OK: ${N} Partien gleich`);
process.exit(fails ? 1 : 0);
