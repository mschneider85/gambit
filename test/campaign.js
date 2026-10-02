/*
 * Prüft die Trainingskampagne: gültige Stellungen, legale Lösungszüge, Matt-Aufgaben setzen wirklich matt,
 * alle Sterne sind erreichbar, IDs eindeutig, jedes Kapitel endet mit einem Bosslevel.
 *   node test/campaign.js
 */
const CG = require('../js/game.js');
require('../js/training/puzzles.js');
require('../js/training/campaign.js');
require('../js/training/runner.js');
require('../js/progress.js');
require('../js/achievements.js');
const { Chess } = CG;

let errors = 0;
const fail = (where, msg) => { errors++; console.log(`✗ ${where}: ${msg}`); };
const keys = new Set();
let nItems = 0;

for (const c of CG.Campaign.chapters) {
  if (!c.levels[c.levels.length - 1].boss) fail(c.id, 'letztes Level ist kein Boss');
  for (const l of c.levels) {
    const where = l.key;
    if (keys.has(l.key)) fail(where, 'doppelte ID');
    keys.add(l.key);
    if (!l.intro) fail(where, 'kein Einführungstext');
    if (l.type === 'stars') {
      const par = CG.Runner.starsPar(l.fen, l.stars);
      if (!par) fail(where, 'Sterne nicht erreichbar');
      else l._par = par;
      continue;
    }
    if (l.type === 'endgame') {
      try { new Chess(l.fen); } catch (e) { fail(where, `FEN: ${e.message}`); }
      if (!['mate', 'promote', 'hold'].includes(l.goal)) fail(where, 'unbekanntes Ziel');
      continue;
    }
    if (l.type === 'boss') { if (!l.elo) fail(where, 'keine ELO'); continue; }
    const items = CG.Runner.items(l);
    if (!items.length) fail(where, 'keine Aufgaben');
    const want = (Array.isArray(l.puzzles) ? l.puzzles : l.puzzles ? [l.puzzles] : []).reduce((a, p) => a + p.n, 0) + (l.items || []).length;
    if (items.length !== want) fail(where, `nur ${items.length} von ${want} Aufgaben (zu wenige Rätsel?)`);
    items.forEach((it, i) => {
      nItems++;
      const w = `${where}#${i + 1}`;
      let c2;
      try { c2 = new Chess(it.fen); } catch (e) { fail(w, `FEN: ${e.message}`); return; }
      const mv = (u) => { try { return c2.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch (e) { return null; } };
      if (it.pre && !mv(it.pre)) { fail(w, `Vorzug ${it.pre} illegal`); return; }
      if (it.ask) {
        if (!it.ask.choices.some((x) => x.ok)) fail(w, 'keine richtige Antwort');
        return;
      }
      const start = c2.fen();
      for (const a of it.alt || []) {
        const t = new Chess(start);
        try { t.move({ from: a.slice(0, 2), to: a.slice(2, 4), promotion: a[4] }); } catch (e) { fail(w, `Alternative ${a} illegal`); }
      }
      for (const u of it.line) if (!mv(u)) { fail(w, `Zug ${u} illegal in ${c2.fen()}`); return; }
      // Eigene Matt-Aufgaben: Der letzte eigene Zug muss mattsetzen
      if (!it.id && it.mate && it.line.length % 2 === 1 && !c2.isCheckmate()) fail(w, 'endet nicht mit Matt');
      // Rätsel mit Matt-Thema
      if (it.id && /^mate/.test(it.group) && !c2.isCheckmate()) fail(w, `Rätsel ${it.id} endet nicht mit Matt`);
    });
  }
}

// Erfolge: Kapitel-Erfolge vorhanden, IDs eindeutig
const ach = CG.Achievements.list();
const aIds = new Set(ach.map((a) => a.id));
if (aIds.size !== ach.length) fail('Erfolge', 'doppelte IDs');
for (const c of CG.Campaign.chapters) if (!aIds.has(`chapter-${c.id}`)) fail('Erfolge', `kein Erfolg für Kapitel ${c.id}`);

console.log(`${CG.Campaign.all.length} Level in ${CG.Campaign.chapters.length} Kapiteln, ${nItems} Aufgaben, ${ach.length} Erfolge`);
console.log(CG.Campaign.all.filter((l) => l._par).map((l) => `${l.id}: ${l._par} Züge`).join(', '));
console.log(errors ? `FEHLER: ${errors}` : 'OK');
process.exit(errors ? 1 : 0);
