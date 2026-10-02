/*
 * Die Trainingskampagne: Kapitel mit Leveln, die der Reihe nach freigeschaltet werden.
 * Leveltypen (ausgeführt von training/runner.js):
 *   stars    – Lektion: mit einer Figur alle ★ einsammeln (nur eine Seite zieht, keine Könige nötig).
 *              { fen, stars: [sq…] } – Sterne für wenige Züge (Bestwert wird ausgerechnet)
 *   steps    – Aufgaben nacheinander: Zug auf dem Brett finden oder Frage beantworten.
 *              items: [{ fen, pre?: uci (Zug des Gegners vorab), line: [uci…] (eigene und Gegenzüge abwechselnd),
 *                        alt?: [uci…] (gleichwertige erste Züge), mate?: true (jedes Matt zählt), text,
 *                        ask?: { q, choices: [{ t, ok, why }] } }]
 *              puzzles: { group, from, n } holt Rätsel aus CG.PUZZLES dazu. lives: n = Prüfung mit Leben.
 *   endgame  – gegen Stockfish (volle Stärke): { fen, goal: 'mate'|'promote'|'hold', moves: Zuglimit, par }
 *   boss     – ganze Partie gegen den Computer: { elo, color, fen? }
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const P = (group, from, n) => ({ group, from, n });

  const chapters = [
    /* ------------------------------------------------------------------ 1 */
    {
      id: 'figuren', icon: '♟️', title: 'Die Figuren', badge: 'Figurenkenner',
      text: 'Wie ziehen Turm, Läufer, Dame, König, Springer und Bauer?',
      levels: [
        { id: 'turm', type: 'stars', icon: '♖', title: 'Der Turm',
          intro: 'Der <b>Turm</b> zieht geradeaus – waagerecht oder senkrecht, so weit er will. Sammle alle Sterne ein!',
          fen: '8/8/8/8/8/8/8/R7 w - - 0 1', stars: ['a6', 'f6', 'f2', 'h2'] },
        { id: 'laeufer', type: 'stars', icon: '♗', title: 'Der Läufer',
          intro: 'Der <b>Läufer</b> zieht schräg, so weit er will. Er bleibt dabei immer auf Feldern seiner Farbe.',
          fen: '8/8/8/8/8/8/8/2B5 w - - 0 1', stars: ['e3', 'g5', 'd8', 'a5', 'b4'] },
        { id: 'dame', type: 'stars', icon: '♕', title: 'Die Dame',
          intro: 'Die <b>Dame</b> ist die stärkste Figur: Sie zieht wie Turm <i>und</i> Läufer zusammen.',
          fen: '8/8/8/8/8/8/8/3Q4 w - - 0 1', stars: ['d6', 'h2', 'b8', 'a3', 'g7', 'e4'] },
        { id: 'koenig', type: 'stars', icon: '♔', title: 'Der König',
          intro: 'Der <b>König</b> ist die wichtigste Figur, aber langsam: Er zieht nur ein Feld weit – in jede Richtung.',
          fen: '8/8/8/8/8/8/8/4K3 w - - 0 1', stars: ['e3', 'f4', 'g3', 'g5', 'e6'] },
        { id: 'springer', type: 'stars', icon: '♘', title: 'Der Springer',
          intro: 'Der <b>Springer</b> springt im „L“: zwei Felder geradeaus und eins zur Seite. Als einzige Figur darf er über andere hinwegspringen.',
          fen: '8/8/8/8/8/8/8/1N6 w - - 0 1', stars: ['c3', 'e4', 'g5', 'e6', 'd8'] },
        { id: 'bauer', type: 'stars', icon: '♙', title: 'Der Bauer',
          intro: 'Der <b>Bauer</b> zieht ein Feld vorwärts – von seiner Grundstellung aus darf er auch zwei Felder ziehen. Rückwärts geht es nie!',
          fen: '8/8/8/8/8/8/4P3/8 w - - 0 1', stars: ['e4', 'e6', 'e8'] },
        { id: 'bauer-schlagen', type: 'stars', icon: '⚔️', title: 'Der Bauer schlägt',
          intro: 'Der Bauer schlägt anders, als er zieht: <b>schräg nach vorn</b>, ein Feld weit. Schlage alle schwarzen Figuren!',
          fen: '8/8/2p5/3n4/2b5/3p4/2P5/8 w - - 0 1', stars: ['d3', 'c4', 'd5', 'c6'] },
        { id: 'schlagen', type: 'stars', icon: '🗡️', title: 'Schlagen',
          intro: 'Jede Figur schlägt, indem sie auf das Feld einer gegnerischen Figur zieht. Erobere mit der Dame alle schwarzen Figuren!',
          fen: '8/1n4r1/8/8/4b3/8/1p6/4Q3 w - - 0 1', stars: ['b2', 'e4', 'g7', 'b7'] },
        { id: 'figuren-boss', type: 'stars', icon: '🏇', title: 'Der Parcours', boss: true,
          intro: 'Die Meisterprüfung der Figuren: Führe den Springer über den Parcours – an den eigenen Bauern vorbei!',
          fen: '8/8/3P4/2P1P3/3P4/8/8/N7 w - - 0 1', stars: ['b3', 'c6', 'e7', 'g6', 'h8'] },
      ],
    },
    /* ------------------------------------------------------------------ 2 */
    {
      id: 'regeln', icon: '📜', title: 'Sonderregeln', badge: 'Regelkundig',
      text: 'Rochade, en passant, Umwandlung, Schach, Matt und Patt.',
      levels: [
        { id: 'rochade-kurz', type: 'steps', icon: '🏰', title: 'Kurze Rochade',
          intro: 'Bei der <b>Rochade</b> zieht der König zwei Felder Richtung Turm, und der Turm springt über ihn. Das bringt den König in Sicherheit.',
          items: [
            { fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', line: ['e1g1'], text: 'Rochiere kurz: Ziehe den König von e1 nach g1.' },
            { fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 4', line: ['e8g8'], text: 'Auch Schwarz darf rochieren. Bringe den schwarzen König in Sicherheit.' },
          ] },
        { id: 'rochade-lang', type: 'steps', icon: '🏯', title: 'Lange Rochade',
          intro: 'Zur Damenseite heißt sie <b>lange Rochade</b>: Der König zieht zwei Felder nach links, der Turm landet neben ihm.',
          items: [
            { fen: 'r3kb1r/ppp1pppp/2nq1n2/3p1b2/3P1B2/2NQ1N2/PPP1PPPP/R3KB1R w KQkq - 6 6', line: ['e1c1'], text: 'Rochiere lang: König von e1 nach c1.' },
            { fen: '4k3/8/8/8/2b5/8/8/4K2R w K - 0 1', text: 'Darf Weiß hier kurz rochieren?',
              ask: { q: 'Darf Weiß kurz rochieren?', choices: [
                { t: 'Ja, König und Turm haben noch nicht gezogen.', ok: false, why: 'Der König würde über f1 ziehen – und das greift der Läufer an.' },
                { t: 'Nein, der König müsste über ein angegriffenes Feld ziehen.', ok: true, why: 'Genau: Der König darf nicht durch Schach rochieren – f1 steht unter Beschuss.' },
              ] } },
            { fen: '4k3/8/8/8/8/8/4r3/R3K3 w Q - 0 1', text: 'Und jetzt?',
              ask: { q: 'Darf Weiß lang rochieren?', choices: [
                { t: 'Ja.', ok: false, why: 'Der König steht im Schach – aus dem Schach heraus darf man nie rochieren.' },
                { t: 'Nein, der König steht im Schach.', ok: true, why: 'Richtig. Im Schach ist die Rochade verboten.' },
              ] } },
          ] },
        { id: 'en-passant', type: 'steps', icon: '👻', title: 'En passant',
          intro: 'Zieht ein Bauer zwei Felder vor und landet neben deinem Bauern, darfst du ihn <b>im Vorbeigehen</b> (en passant) schlagen – so, als hätte er nur ein Feld gezogen. Aber nur sofort!',
          items: [
            { fen: 'rnbqkbnr/pppppppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2', pre: 'd7d5', line: ['e5d6'], text: 'Schwarz zieht seinen Bauern zwei Felder vor. Schlage ihn en passant!' },
            { fen: 'rnbqkbnr/ppppp1pp/8/8/4Pp2/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', pre: 'g2g4', line: ['f4g3'], text: 'Jetzt bist du Schwarz: Weiß zieht g2–g4. Schlage en passant!' },
          ] },
        { id: 'umwandlung', type: 'steps', icon: '👸', title: 'Umwandlung',
          intro: 'Erreicht ein Bauer die letzte Reihe, wird er <b>umgewandelt</b> – meistens in eine Dame.',
          items: [
            { fen: '8/4P3/8/8/k7/8/8/K7 w - - 0 1', line: ['e7e8q'], text: 'Ziehe den Bauern nach vorn und mach ihn zur Dame.' },
            { fen: '8/4P1k1/3q4/8/8/8/8/K7 w - - 0 1', line: ['e7e8n'], text: 'Manchmal ist ein <b>Springer</b> besser: Wandle so um, dass du Schach gibst und gleichzeitig die Dame angreifst!' },
          ] },
        { id: 'schach', type: 'steps', icon: '⚠️', title: 'Schach!',
          intro: 'Wird der König angegriffen, steht er im <b>Schach</b>. Du musst es sofort abwehren: wegziehen, dazwischenstellen oder den Angreifer schlagen.',
          items: [
            { fen: 'k7/8/8/8/8/8/4q3/R3K3 w - - 0 1', line: ['e1e2'], text: 'Die Dame gibt Schach – aber sie ist ungedeckt. Schlage sie!' },
            { fen: '4k3/8/8/8/8/8/1B1PPP2/r3K3 w - - 0 1', line: ['b2c1'], text: 'Der König kann nicht weg. Stelle eine Figur dazwischen!' },
            { fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', line: ['e1e2'], alt: ['e1d2', 'e1f2'], text: 'Nichts kann schlagen oder dazwischen: Zieh den König aus dem Schach!' },
          ] },
        { id: 'matt-patt', type: 'steps', icon: '⚖️', title: 'Matt oder Patt?',
          intro: '<b>Schachmatt</b>: Der König steht im Schach und kann sich nicht retten – die Partie ist verloren. <b>Patt</b>: Wer am Zug ist, hat keinen legalen Zug, steht aber nicht im Schach – dann ist es Remis!',
          items: [
            { fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', text: 'Schwarz ist am Zug.',
              ask: { q: 'Was ist das?', choices: [{ t: 'Schachmatt', ok: true, why: 'Der König steht im Schach, die Dame ist gedeckt – kein Ausweg.' }, { t: 'Patt', ok: false, why: 'Der König steht im Schach – also kein Patt.' }, { t: 'Nur Schach', ok: false, why: 'Schwarz kann das Schach nicht abwehren.' }] } },
            { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', text: 'Schwarz ist am Zug.',
              ask: { q: 'Was ist das?', choices: [{ t: 'Schachmatt', ok: false, why: 'Der König steht nicht im Schach.' }, { t: 'Patt', ok: true, why: 'Kein Schach, aber auch kein legaler Zug: Patt – Remis!' }, { t: 'Schwarz kann weiterspielen', ok: false, why: 'g8, g7 und h7 sind alle bedroht.' }] } },
            { fen: 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1', text: 'Schwarz ist am Zug.',
              ask: { q: 'Was ist das?', choices: [{ t: 'Schachmatt', ok: false, why: 'Kein Schach auf a8.' }, { t: 'Patt', ok: true, why: 'Kein Schach, kein Zug – Patt.' }] } },
          ] },
        { id: 'patt-vermeiden', type: 'steps', icon: '🎯', title: 'Matt statt Patt',
          intro: 'Mit viel Übermacht passiert schnell ein Patt. Finde jeweils den Zug, der <b>mattsetzt</b>!',
          items: [
            { fen: '7k/8/5QK1/8/8/8/8/8 w - - 0 1', line: ['f6f8'], mate: true, text: 'Setze matt – aber nicht patt!' },
            { fen: 'k7/8/1K6/8/8/8/8/2Q5 w - - 0 1', line: ['c1c8'], mate: true, text: 'Setze matt!' },
            { fen: '6k1/8/6K1/8/8/8/8/R7 w - - 0 1', line: ['a1a8'], mate: true, text: 'Setze mit dem Turm matt!' },
          ] },
        { id: 'regeln-boss', type: 'steps', icon: '📜', title: 'Regelprüfung', boss: true, lives: 3,
          intro: 'Zeig, dass du alle Regeln kennst! Du hast drei Leben.',
          items: [
            { fen: 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1', line: ['e1g1'], text: 'Bring deinen König mit einem Zug in Sicherheit.' },
            { fen: 'rnbqkbnr/pp1ppppp/8/8/2pPP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 3', line: ['c4d3'], text: 'Schwarz am Zug: Weiß hat gerade d2–d4 gezogen. Schlage!' },
            { fen: '8/3r1P1k/8/8/8/8/8/K7 w - - 0 1', line: ['f7f8n'], text: 'Wandle so um, dass du Schach gibst und den Turm angreifst!' },
            { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', line: ['d1d8'], mate: true, text: 'Setze matt!' },
            { fen: 'k7/8/2K5/8/8/8/8/1Q6 b - - 0 1', text: 'Schwarz ist am Zug.',
              ask: { q: 'Wie steht es?', choices: [{ t: 'Schachmatt', ok: false, why: 'Der König steht gar nicht im Schach.' }, { t: 'Patt', ok: false, why: 'Schwarz hat noch einen Zug: Ka7.' }, { t: 'Schwarz kann ziehen', ok: true, why: 'Richtig: b7 und b8 sind bedroht, aber Ka7 geht.' }] } },
          ] },
      ],
    },
    /* ------------------------------------------------------------------ 3 */
    {
      id: 'mattbilder', icon: '👑', title: 'Erste Mattbilder', badge: 'Mattkünstler',
      text: 'Grundreihenmatt, Dame und König, ersticktes Matt – und viele Matt-in-1-Rätsel.',
      levels: [
        { id: 'grundreihe', type: 'steps', icon: '🧱', title: 'Grundreihenmatt',
          intro: 'Steht der König hinter seinen eigenen Bauern eingesperrt, reicht oft ein Turm oder die Dame auf der Grundreihe.',
          items: [
            { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', line: ['a1a8'], mate: true, text: 'Setze matt auf der Grundreihe!' },
            { fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1', line: ['e2e8', 'a8e8', 'e1e8'], mate: true, text: 'Der schwarze Turm verteidigt die Grundreihe – aber nicht gegen zwei! Matt in 2.' },
          ], puzzles: P('mate1b', 0, 4) },
        { id: 'dame-koenig', type: 'steps', icon: '♕', title: 'Dame und König',
          intro: 'Die Dame setzt matt, wenn ihr eigener König sie deckt oder dem gegnerischen König die Fluchtfelder nimmt.',
          items: [
            { fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', line: ['a1a8'], mate: true, text: 'Setze matt!' },
            { fen: '6Q1/8/8/8/8/8/5K2/7k w - - 0 1', line: ['g8g2'], mate: true, text: 'Die Dame wird vom König gedeckt – setze matt!' },
            { fen: '3k4/8/3K4/8/8/8/8/7Q w - - 0 1', line: ['h1h8'], mate: true, text: 'Setze matt!' },
          ] },
        { id: 'zwei-tuerme', type: 'steps', icon: '🪜', title: 'Zwei Türme',
          intro: 'Zwei Türme arbeiten wie eine Leiter: Einer sperrt eine Reihe, der andere setzt auf der nächsten matt.',
          items: [
            { fen: '6k1/R7/8/8/8/8/8/1R5K w - - 0 1', line: ['b1b8'], mate: true, text: 'Setze matt!' },
            { fen: 'k7/7R/8/8/8/8/8/6RK w - - 0 1', line: ['g1g8'], mate: true, text: 'Ein Turm sperrt die 7. Reihe – setze mit dem anderen matt!' },
          ] },
        { id: 'erstickt', type: 'steps', icon: '🫢', title: 'Ersticktes Matt',
          intro: 'Beim <b>erstickten Matt</b> ist der König von seinen eigenen Figuren eingemauert – ein Springer genügt!',
          items: [
            { fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1', line: ['h6f7'], mate: true, text: 'Setze mit dem Springer matt!' },
          ], puzzles: P('mate1s', 0, 4) },
        { id: 'matt1-a', type: 'steps', icon: '🧩', title: 'Matt in 1 – I', intro: 'Finde jeweils den Zug, der sofort mattsetzt.', puzzles: P('mate1', 0, 6) },
        { id: 'matt1-b', type: 'steps', icon: '🧩', title: 'Matt in 1 – II', intro: 'Finde jeweils den Zug, der sofort mattsetzt.', puzzles: P('mate1', 6, 6) },
        { id: 'matt1-c', type: 'steps', icon: '🧩', title: 'Matt in 1 – III', intro: 'Finde jeweils den Zug, der sofort mattsetzt.', puzzles: P('mate1', 12, 6) },
        { id: 'mattbilder-boss', type: 'steps', icon: '👑', title: 'Mattprüfung', boss: true, lives: 3,
          intro: 'Acht Mattaufgaben, drei Leben. Viel Glück!', puzzles: P('mate1', 18, 8) },
      ],
    },
    /* ------------------------------------------------------------------ 4 */
    {
      id: 'eroeffnung', icon: '🌅', title: 'Eröffnungsprinzipien', badge: 'Eröffnungsweise',
      text: 'Zentrum, Entwicklung, Königssicherheit – und berühmte Fallen.',
      levels: [
        { id: 'zentrum', type: 'steps', icon: '🎯', title: 'Das Zentrum',
          intro: 'Die vier Felder d4, e4, d5 und e5 sind das <b>Zentrum</b>. Wer es beherrscht, hat Platz für seine Figuren.',
          items: [
            { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', line: ['e2e4'], alt: ['d2d4'], text: 'Besetze mit einem Bauern das Zentrum!' },
            { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', line: ['e7e5'], alt: ['d7d5', 'c7c5'], text: 'Du spielst Schwarz: Kämpfe ebenfalls um das Zentrum.' },
            { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', text: 'Was ist hier ein guter Plan?',
              ask: { q: 'Welcher Zug ist am besten?', choices: [
                { t: 'Sf3 – greift e5 an und entwickelt', ok: true, why: 'Genau: Eine Figur kommt ins Spiel und greift gleichzeitig den Zentrumsbauern an.' },
                { t: 'h4 – Raum am Rand', ok: false, why: 'Randbauern helfen in der Eröffnung kaum.' },
                { t: 'Dh5 – sofort angreifen', ok: false, why: 'Die Dame früh herauszubringen ist riskant – sie wird gejagt.' },
              ] } },
          ] },
        { id: 'entwicklung', type: 'steps', icon: '🐎', title: 'Entwicklung',
          intro: '<b>Entwickeln</b> heißt: Springer und Läufer von der Grundreihe holen – möglichst Richtung Zentrum, jede Figur einmal.',
          items: [
            { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', line: ['f1c4'], alt: ['f1b5', 'b1c3', 'd2d4'], text: 'Entwickle eine weitere Figur!' },
            { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', text: 'Was jetzt?',
              ask: { q: 'Welcher Zug folgt den Prinzipien am besten?', choices: [
                { t: 'O-O – König in Sicherheit', ok: true, why: 'Die Rochade sichert den König und bringt den Turm ins Spiel.' },
                { t: 'a3 – ein Bauernzug am Rand', ok: false, why: 'Kostet Zeit und entwickelt nichts.' },
                { t: 'Lc4–b5–a4 – der Läufer wandert', ok: false, why: 'Dieselbe Figur mehrmals zu ziehen verliert Zeit.' },
              ] } },
            { fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3', line: ['g1f3'], alt: ['f1c4', 'f2f4', 'd2d3', 'f1b5', 'g2g3'], text: 'Entwickle eine Figur!' },
          ] },
        { id: 'narrenmatt', type: 'steps', icon: '🃏', title: 'Das Narrenmatt',
          intro: 'Das kürzeste Matt der Welt: Wer die Bauern vor seinem König gedankenlos zieht, kann nach zwei Zügen verloren haben.',
          items: [
            { fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2', line: ['d8h4'], mate: true, text: 'Du spielst Schwarz. Weiß hat f3 und g4 gezogen – bestrafe es!' },
          ] },
        { id: 'schaefermatt', type: 'steps', icon: '🐑', title: 'Das Schäfermatt',
          intro: 'Dame und Läufer greifen gemeinsam f7 an – das Feld wird nur vom König gedeckt. Lerne den Angriff und die Verteidigung!',
          items: [
            { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', line: ['h5f7'], mate: true, text: 'Schwarz hat nicht aufgepasst. Setze matt!' },
            { fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', line: ['g7g6'], alt: ['d8e7', 'd8f6'], text: 'Jetzt bist du Schwarz: Weiß droht Dxf7#. Verteidige dich!' },
            { fen: 'r1bqkbnr/pppp1p1p/2n3p1/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 1 4', line: ['g8f6'], alt: ['d8f6', 'd8e7'], text: 'Die Dame kommt wieder und droht erneut Dxf7#. Verteidige f7 und entwickle dabei!' },
          ] },
        { id: 'dame-frueh', type: 'steps', icon: '🏃', title: 'Die Dame nicht zu früh',
          intro: 'Kommt die Dame früh ins Spiel, kann der Gegner sie mit Tempo jagen und dabei seine Figuren entwickeln.',
          items: [
            { fen: 'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3', line: ['b1c3'], text: 'Die schwarze Dame steht mitten im Brett. Entwickle eine Figur und greife sie dabei an!' },
            { fen: 'rnb1kbnr/ppp1pppp/8/q7/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 4', line: ['d2d4'], alt: ['g1f3', 'f1c4'], text: 'Die Dame musste fliehen. Nutze die gewonnene Zeit: Besetze das Zentrum oder entwickle.' },
          ] },
        { id: 'fallen', type: 'steps', icon: '🪤', title: 'Eröffnungsfallen',
          intro: 'Ein paar Fallen, die immer wieder vorkommen – einmal gesehen, nie wieder hineingetappt.',
          items: [
            { fen: 'r2qkbnr/ppp2ppp/2np4/4p2b/2B1P3/2N2N1P/PPPP1PP1/R1BQK2R w KQkq - 1 6', line: ['f3e5', 'h5d1', 'c4f7', 'e8e7', 'c3d5'], mate: true,
              text: '<b>Légals Matt</b>: Opfere die Dame! Schlage auf e5 – nimmt Schwarz die Dame, folgt Matt.' },
            { fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', line: ['f3e5'], alt: ['b1c3', 'd2d4', 'f1c4', 'd2d3'], text: 'Russische Verteidigung: Schlage den ungeschützten Bauern e5!' },
            { fen: 'rnbqkb1r/pppp1ppp/8/4N3/4n3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4', line: ['d1e2'], text: 'Schwarz hat zurückgeschlagen (…Sxe4?). Greife den Springer an – und fessle ihn an den König!' },
          ] },
        { id: 'eroeffnung-boss', type: 'boss', icon: '🕯️', title: 'Der Lehrling', boss: true, elo: 500, color: 'w',
          intro: 'Spiele eine ganze Partie gegen den Lehrling (500). Halte dich an die Prinzipien: Zentrum, Entwicklung, Rochade!' },
      ],
    },
    /* ------------------------------------------------------------------ 5 */
    {
      id: 'taktik1', icon: '⚔️', title: 'Taktik I', badge: 'Taktiker',
      text: 'Hängende Figuren, Gabel, Fesselung und Spieß.',
      levels: [
        { id: 'haengend-a', type: 'steps', icon: '🎁', title: 'Hängende Figuren', intro: 'Eine Figur „hängt“, wenn sie angegriffen und nicht gedeckt ist. Schlag zu!', puzzles: P('hanging', 0, 6) },
        { id: 'gabel-a', type: 'steps', icon: '🍴', title: 'Die Gabel',
          intro: 'Bei einer <b>Gabel</b> greift eine Figur zwei gegnerische gleichzeitig an – nur eine kann sich retten.',
          puzzles: P('fork', 0, 6) },
        { id: 'gabel-b', type: 'steps', icon: '🍴', title: 'Noch mehr Gabeln', intro: 'Springer, Bauern, Damen – jede Figur kann gabeln.', puzzles: P('fork', 6, 6) },
        { id: 'fesselung-a', type: 'steps', icon: '📌', title: 'Die Fesselung',
          intro: 'Bei einer <b>Fesselung</b> kann eine Figur nicht ziehen, weil dahinter eine wertvollere steht (oder der König).',
          puzzles: P('pin', 0, 6) },
        { id: 'fesselung-b', type: 'steps', icon: '📌', title: 'Fesselungen nutzen', intro: 'Eine gefesselte Figur ist ein Ziel: Greife sie noch einmal an!', puzzles: P('pin', 6, 6) },
        { id: 'spiess-a', type: 'steps', icon: '🍢', title: 'Der Spieß',
          intro: 'Der <b>Spieß</b> ist die umgekehrte Fesselung: Die wertvollere Figur steht vorn, muss weichen – und die dahinter fällt.',
          puzzles: P('skewer', 0, 6) },
        { id: 'haengend-b', type: 'steps', icon: '🎁', title: 'Augen auf!', intro: 'Gemischte Aufgaben: Wo hängt etwas, wo gibt es eine Gabel?', puzzles: P('hanging', 6, 6) },
        { id: 'taktik1-boss', type: 'steps', icon: '⚔️', title: 'Taktikprüfung I', boss: true, lives: 3,
          intro: 'Gabel, Fesselung, Spieß – gemischt. Drei Leben!', puzzles: [P('fork', 12, 3), P('pin', 12, 3), P('skewer', 6, 3)] },
      ],
    },
    /* ------------------------------------------------------------------ 6 */
    {
      id: 'endspiel1', icon: '🏁', title: 'Endspiele I', badge: 'Endspielkenner',
      text: 'Mattsetzen mit Dame, Turm und zwei Türmen – gegen echte Verteidigung.',
      levels: [
        { id: 'ktk-2t', type: 'endgame', icon: '🪜', title: 'Treppenmatt',
          intro: 'Zwei Türme treiben den König Reihe für Reihe an den Rand: Einer sperrt, der andere gibt Schach. Setze matt!',
          fen: '8/8/8/4k3/8/8/8/R3K2R w - - 0 1', goal: 'mate', moves: 20 },
        { id: 'kdk', type: 'endgame', icon: '♕', title: 'Dame gegen König',
          intro: 'Dränge den König mit der Dame an den Rand (immer einen Springerzug Abstand halten!), hole deinen König heran und setze matt. Achtung: kein Patt!',
          fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', goal: 'mate', moves: 20 },
        { id: 'kdk-2', type: 'endgame', icon: '♕', title: 'Dame aus der Ecke',
          intro: 'Diesmal steht dein König weit weg. Gleiches Prinzip: einsperren, König holen, mattsetzen.',
          fen: '8/8/8/3k4/8/8/8/Q6K w - - 0 1', goal: 'mate', moves: 22 },
        { id: 'ktk', type: 'endgame', icon: '♖', title: 'Turm gegen König',
          intro: 'Mit einem Turm brauchst du die Hilfe des Königs: Die Könige stehen sich gegenüber, der Turm gibt Schach am Rand. Das dauert – bleib geduldig!',
          fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', goal: 'mate', moves: 32 },
        { id: 'endspiel1-umwandeln', type: 'endgame', icon: '👸', title: 'Der Weg zur Dame',
          intro: 'Bring deinen Bauern sicher zur Dame – der schwarze König wird versuchen, ihn aufzuhalten. Dein König muss vorangehen!',
          fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', goal: 'promote', moves: 15 },
        { id: 'endspiel1-boss', type: 'endgame', icon: '🏁', title: 'Endspielprüfung', boss: true,
          intro: 'Dame gegen König aus schwieriger Lage – mit knappem Zuglimit.',
          fen: '7K/8/8/8/3k4/8/8/7Q w - - 0 1', goal: 'mate', moves: 16 },
      ],
    },
    /* ------------------------------------------------------------------ 7 */
    {
      id: 'taktik2', icon: '🔥', title: 'Taktik II', badge: 'Kombinationskünstler',
      text: 'Abzug, Doppelschach, Ablenkung, Hinlenkung, gefangene Figuren und Matt in 2.',
      levels: [
        { id: 'abzug', type: 'steps', icon: '🎭', title: 'Abzugsangriff', intro: 'Zieht eine Figur weg und gibt dabei die Linie für eine andere frei, entstehen zwei Drohungen auf einmal.', puzzles: P('discovered', 0, 6) },
        { id: 'doppelschach', type: 'steps', icon: '💥', title: 'Doppelschach', intro: 'Beim <b>Doppelschach</b> geben zwei Figuren gleichzeitig Schach – dann hilft nur noch ein Königszug.', puzzles: P('double', 0, 6) },
        { id: 'ablenkung', type: 'steps', icon: '🧲', title: 'Ablenkung', intro: 'Lenke einen Verteidiger von seiner Aufgabe ab – dann bricht die Stellung zusammen.', puzzles: P('deflection', 0, 6) },
        { id: 'hinlenkung', type: 'steps', icon: '🪝', title: 'Hinlenkung', intro: 'Locke eine gegnerische Figur (oft den König) auf ein Feld, wo sie einer Taktik zum Opfer fällt.', puzzles: P('attraction', 0, 6) },
        { id: 'gefangen', type: 'steps', icon: '🕸️', title: 'Gefangene Figuren', intro: 'Hat eine Figur kein sicheres Feld mehr, kann man sie einfangen.', puzzles: P('trapped', 0, 6) },
        { id: 'matt2-a', type: 'steps', icon: '🧩', title: 'Matt in 2 – I', intro: 'Zwei Züge bis zum Matt. Der Gegner verteidigt sich bestmöglich.', puzzles: P('mate2', 0, 6) },
        { id: 'matt2-b', type: 'steps', icon: '🧩', title: 'Matt in 2 – II', intro: 'Zwei Züge bis zum Matt.', puzzles: P('mate2', 6, 6) },
        { id: 'abzug-b', type: 'steps', icon: '🎭', title: 'Abzug und Ablenkung', intro: 'Gemischte Aufgaben.', puzzles: [P('discovered', 6, 3), P('deflection', 6, 3)] },
        { id: 'taktik2-boss', type: 'steps', icon: '🔥', title: 'Taktikprüfung II', boss: true, lives: 3,
          intro: 'Acht Aufgaben aus allen Themen des Kapitels. Drei Leben!', puzzles: [P('double', 6, 2), P('attraction', 6, 2), P('trapped', 6, 2), P('mate2', 12, 2)] },
      ],
    },
    /* ------------------------------------------------------------------ 8 */
    {
      id: 'bauern', icon: '🌾', title: 'Bauernendspiele', badge: 'Bauernstratege',
      text: 'Quadratregel, Opposition, Durchbruch und Umwandlung.',
      levels: [
        { id: 'quadrat', type: 'endgame', icon: '⬛', title: 'Die Quadratregel',
          intro: 'Steht der König außerhalb des „Quadrats“ des Bauern, holt er ihn nicht mehr ein. Lauf los!',
          fen: '8/8/8/P7/8/8/5k2/K7 w - - 0 1', goal: 'promote', moves: 6 },
        { id: 'opposition', type: 'endgame', icon: '🤺', title: 'Die Opposition',
          intro: 'Stehen sich die Könige mit einem Feld Abstand gegenüber, muss der am Zug weichen. Nutze das, um deinen Bauern durchzubringen.',
          fen: '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1', goal: 'promote', moves: 20 },
        { id: 'durchbruch', type: 'endgame', icon: '💣', title: 'Der Durchbruch',
          intro: 'Drei gegen drei – und doch gewinnt Weiß! Ein Bauernopfer reißt eine Lücke.',
          fen: '7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1', goal: 'promote', moves: 8 },
        { id: 'koenig-vorn', type: 'endgame', icon: '🛡️', title: 'Der König geht voran',
          intro: 'Der eigene König muss vor den Bauern. Dann ist der Weg frei.',
          fen: '8/8/3k4/8/8/3K4/3P4/8 w - - 0 1', goal: 'promote', moves: 20 },
        { id: 'bauern-a', type: 'steps', icon: '🧩', title: 'Bauernrätsel I', intro: 'Rätsel aus echten Partien: Bauernendspiele.', puzzles: P('pawnEnd', 0, 6) },
        { id: 'bauern-b', type: 'steps', icon: '🧩', title: 'Bauernrätsel II', intro: 'Umwandlung erzwingen!', puzzles: P('promotion', 0, 6) },
        { id: 'bauern-boss', type: 'steps', icon: '🌾', title: 'Bauernprüfung', boss: true, lives: 3,
          intro: 'Acht Endspielaufgaben, drei Leben.', puzzles: [P('pawnEnd', 6, 5), P('promotion', 6, 3)] },
      ],
    },
    /* ------------------------------------------------------------------ 9 */
    {
      id: 'taktik3', icon: '🔮', title: 'Taktik III', badge: 'Meistertaktiker',
      text: 'Matt in 3 und gemischte Rätsel bis 1900.',
      levels: [
        { id: 'matt3-a', type: 'steps', icon: '🧩', title: 'Matt in 3 – I', intro: 'Drei Züge bis zum Matt – rechne genau!', puzzles: P('mate3', 0, 5) },
        { id: 'matt3-b', type: 'steps', icon: '🧩', title: 'Matt in 3 – II', intro: 'Drei Züge bis zum Matt.', puzzles: P('mate3', 5, 5) },
        { id: 'mix-a', type: 'steps', icon: '🎲', title: 'Gemischt 1200+', intro: 'Alles ist möglich. Was ist hier die Pointe?', puzzles: P('mixA', 0, 6) },
        { id: 'mix-b', type: 'steps', icon: '🎲', title: 'Gemischt 1300+', intro: 'Gemischte Rätsel.', puzzles: P('mixA', 6, 6) },
        { id: 'mix-c', type: 'steps', icon: '🎲', title: 'Gemischt 1450+', intro: 'Es wird kniffliger.', puzzles: P('mixB', 0, 6) },
        { id: 'mix-d', type: 'steps', icon: '🎲', title: 'Gemischt 1650+', intro: 'Für Fortgeschrittene.', puzzles: P('mixC', 0, 6) },
        { id: 'taktik3-boss', type: 'steps', icon: '🔮', title: 'Großes Rätselturnier', boss: true, lives: 3,
          intro: 'Zehn schwere Rätsel, drei Leben. Wer hier besteht, ist bereit für die Meisterprüfung.', puzzles: [P('mate3', 10, 3), P('mixB', 6, 4), P('mixC', 6, 3)] },
      ],
    },
    /* ------------------------------------------------------------------ 10 */
    {
      id: 'meister', icon: '🐉', title: 'Meisterprüfung', badge: 'Gambit-Meister',
      text: 'Ganze Partien gegen immer stärkere Gegner – bis zum Drachen.',
      levels: [
        { id: 'boss-800', type: 'boss', icon: '🛡️', title: 'Der Knappe', elo: 800, color: 'w', intro: 'Besiege den Knappen (800) mit Weiß.' },
        { id: 'boss-1000', type: 'boss', icon: '🛡️', title: 'Der Knappe mit Schwarz', elo: 1000, color: 'b', intro: 'Diesmal mit Schwarz gegen einen stärkeren Knappen (1000).' },
        { id: 'boss-1200', type: 'boss', icon: '⚔️', title: 'Der Ritter', elo: 1200, color: 'w', intro: 'Der Ritter (1200) spielt solide. Kannst du ihn bezwingen?' },
        { id: 'boss-1400', type: 'boss', icon: '⚔️', title: 'Der Hauptmann', elo: 1400, color: 'b', intro: 'Mit Schwarz gegen den Hauptmann (1400).' },
        { id: 'boss-1600', type: 'boss', icon: '🔮', title: 'Der Magier', elo: 1600, color: 'w', intro: 'Der Magier (1600) sieht viele Tricks.' },
        { id: 'boss-1800', type: 'boss', icon: '🐉', title: 'Der Drache', elo: 1800, color: 'b', boss: true, intro: 'Die letzte Prüfung: Besiege den Drachen (1800) – mit Schwarz!' },
      ],
    },
  ];

  // Level-IDs eindeutig machen und Rückverweise setzen
  const all = [];
  chapters.forEach((c, ci) => c.levels.forEach((l, li) => {
    l.chapter = c.id;
    l.ci = ci;
    l.li = li;
    l.key = `${c.id}/${l.id}`;
    all.push(l);
  }));

  /** Ist ein Level freigeschaltet? Der Reihe nach: das vorige muss geschafft sein. */
  function unlocked(level, progress) {
    const i = all.indexOf(level);
    return i === 0 || progress.done(all[i - 1].key);
  }
  /** Das erste noch nicht geschaffte Level. */
  function next(progress) { return all.find((l) => !progress.done(l.key)) || null; }
  function chapterDone(c, progress) { return c.levels.every((l) => progress.done(l.key)); }
  function chapterStars(c, progress) { return c.levels.reduce((a, l) => a + progress.stars(l.key), 0); }

  CG.Campaign = { chapters, all, unlocked, next, chapterDone, chapterStars, byKey: (k) => all.find((l) => l.key === k) };
  if (typeof module !== 'undefined') module.exports = CG;
})(globalThis);
