/*
 * Klang: alle Soundeffekte und die Hintergrundmusik werden live mit der Web-Audio-API erzeugt –
 * keine Audiodateien nötig. Browser erlauben Ton erst nach einer Nutzeraktion, daher unlock().
 */
(function (G) {
  'use strict';
  const CG = (G.CG = G.CG || {});

  const store = {
    get(k, d) { try { const v = localStorage.getItem(`gambit-${k}`); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(`gambit-${k}`, JSON.stringify(v)); } catch (e) { /* ohne Speicher weiter */ } },
  };
  const settings = { sfx: store.get('sfx', true), music: store.get('music', true) };
  const SFX_VOL = 0.8;
  const MUSIC_VOL = 0.3;

  // Zwei Kontexte: Effekte mit kleinstem Puffer (Klicks sofort hörbar), Musik mit großem Puffer –
  // die vielen gleichzeitig klingenden Stimmen und Hallräume reißen sonst bei Lastspitzen kurz ab (Knistern).
  let sfxCtx = null;
  let musicCtx = null;
  let ctx = null; // Kontext, in dem gerade Klänge entstehen: sfxCtx, innerhalb von inMusic() musicCtx
  let musicMaster;
  let sfxBus;
  let dryBus; // Effekte ganz ohne Hall (Bedienklicks)
  let master;
  let musicBus;
  let musicOut; // Lautstärke/Stummschaltung der Musik, hinter Hall und Echo
  let musicNodes = []; // alle Knoten der aktuellen Musikkette – beim Ausschalten werden sie abgehängt
  let hallBuf;
  let ambBus; // Naturgeräusche: laufen am Tiefpass der Musik vorbei, damit Vögel hell bleiben
  let farBus; // ferne Naturgeräusche (Waldkauz): wenig Direktschall, viel Hall
  let reverb;
  let noiseBuf;

  function init() {
    if (sfxCtx) return sfxCtx;
    const AC = G.AudioContext || G.webkitAudioContext;
    if (!AC) return null;
    sfxCtx = new AC({ latencyHint: 'interactive' });
    // Als Zahl, denn 'balanced' ist in Chrome oft nicht größer als 'interactive' (~10 ms)
    musicCtx = new AC({ latencyHint: 0.04 });
    ctx = sfxCtx;
    buildGraph();
    return sfxCtx;
  }

  /** Musikknoten entstehen im Musik-Kontext: fn läuft mit ctx = musicCtx. */
  function inMusic(fn) {
    const prev = ctx;
    ctx = musicCtx;
    try { return fn(); } finally { ctx = prev; }
  }

  /** Kompressor vor dem Ausgang des aktuellen Kontexts. */
  function compressor() {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    return comp;
  }

  /** Signalweg: Effekte und Musik → je ein Kompressor → Ausgang, jeweils mit Hallanteil. */
  function buildGraph() {
    const comp = compressor();
    master = comp;

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(3.4, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet);
    wet.connect(comp);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? SFX_VOL : 0;
    sfxBus.connect(comp);
    dryBus = ctx.createGain();
    dryBus.gain.value = settings.sfx ? SFX_VOL : 0;
    dryBus.connect(comp);
    // Hall-Anteil (hinter dem Bus, damit Stummschalten auch den Hall stumm schaltet)
    send(sfxBus, 0.22);
    // AudioBuffer gehören keinem Kontext – Hall und Rauschen teilen sich beide
    hallBuf = impulse(6.5, 2.4, 0.12);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    inMusic(() => { musicMaster = compressor(); buildMusic(); });
  }

  /**
   * Frische Musikkette. Beim Ausschalten wird die alte abgehängt – so verstummen auch Hall, Echo
   * und schon geplante Töne sofort und kommen beim Wiedereinschalten nicht zurück.
   */
  function buildMusic() {
    musicOut = ctx.createGain();
    musicOut.gain.value = settings.music ? MUSIC_VOL : 0;
    musicOut.connect(musicMaster);
    musicBus = ctx.createGain();
    musicNodes = [musicOut, musicBus, ...musicChain(musicOut)];
  }

  /**
   * Musik: weich abgerundet, wenig Direktsignal, langer dunkler Hall und ein breites Stereo-Echo –
   * so klingt sie nach Raum statt nach einzelnen Oszillatoren.
   */
  function musicChain(dest) {
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 3600;
    warm.Q.value = 0.5;
    musicBus.connect(warm);
    const dry = ctx.createGain();
    dry.gain.value = 0.2;
    warm.connect(dry);
    dry.connect(dest);

    const hall = ctx.createConvolver();
    hall.buffer = hallBuf;
    const hallWet = ctx.createGain();
    hallWet.gain.value = 0.34;
    warm.connect(hall);
    hall.connect(hallWet);
    hallWet.connect(dest);

    ambBus = ctx.createGain();
    ambBus.gain.value = 1 / MUSIC_VOL; // Naturgeräusche sind schon leise ausgesteuert, die Musiklautstärke gilt für sie nicht
    const ambHall = ctx.createGain();
    ambHall.gain.value = 0.35;
    ambBus.connect(dest);
    ambBus.connect(ambHall);
    ambHall.connect(hall);
    farBus = ctx.createGain();
    farBus.gain.value = 1 / MUSIC_VOL;
    const farDry = ctx.createGain();
    farDry.gain.value = 0.5;
    const farWet = ctx.createGain();
    farWet.gain.value = 0.9;
    farBus.connect(farDry);
    farDry.connect(dest);
    farBus.connect(farWet);
    farWet.connect(hall);

    // Ping-Pong-Echo mit krummen Zeiten, jede Wiederholung dunkler
    const input = ctx.createGain();
    input.gain.value = 0.08;
    const l = ctx.createDelay(2);
    const r = ctx.createDelay(2);
    l.delayTime.value = 0.47;
    r.delayTime.value = 0.71;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = fbR.gain.value = 0.34;
    warm.connect(input);
    input.connect(l);
    l.connect(fbL);
    fbL.connect(r);
    r.connect(fbR);
    fbR.connect(damp);
    damp.connect(l);
    const merge = ctx.createChannelMerger(2);
    l.connect(merge, 0, 0);
    r.connect(merge, 0, 1);
    merge.connect(dest);
    return [warm, dry, hall, hallWet, ambBus, ambHall, farBus, farDry, farWet, input, l, r, damp, fbL, fbR, merge];
  }

  function send(bus, amount) {
    const g = ctx.createGain();
    g.gain.value = amount;
    bus.connect(g);
    g.connect(reverb);
  }

  /** Künstlicher Raumhall: abklingendes Stereo-Rauschen; dark < 1 dämpft die Höhen (Tiefpass erster Ordnung). */
  function impulse(seconds, decay, dark = 1) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      for (let i = 0; i < len; i++) {
        y += dark * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------ Bausteine */
  function envelope(param, t, attack, peak, dur, curve = 'exp', hold = 0) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold) param.setValueAtTime(peak, t + attack + hold);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
    else param.linearRampToValueAtTime(0.0001, t + attack + hold + dur);
  }

  /** Ausgang eines Klangs, bei o.pan über ein Stereo-Panorama. */
  function output(node, o) {
    const bus = o.bus || sfxBus;
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node.connect(p);
      p.connect(bus);
    } else node.connect(bus);
  }

  /** Filter mit optionaler Frequenzfahrt. f: { type, freq, to, time, q } */
  function filterNode(t, f, dur) {
    const n = ctx.createBiquadFilter();
    n.type = f.type || 'lowpass';
    n.frequency.setValueAtTime(f.freq, t);
    if (f.to) n.frequency.exponentialRampToValueAtTime(f.to, t + (f.time || dur));
    n.Q.value = f.q ?? 0.7;
    return n;
  }
  /**
   * Ein Filter für mehrere Stimmen mit derselben Filterfahrt (als bus an tone() übergeben): ein Filter
   * mit laufender Frequenzfahrt ist teuer, ein gemeinsamer klingt gleich und spart viel Rechenzeit.
   */
  function sharedFilter(t, f, dur) {
    const n = filterNode(t, f, dur);
    n.connect(MB());
    return n;
  }

  /** Einzelner Ton. o: { t, freq, type, attack, hold, dur, peak, to (Zielfrequenz), bus, filter, detune, pan } */
  function tone(o) {
    const t = o.t ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || o.dur));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    envelope(g.gain, t, o.attack ?? 0.005, o.peak ?? 0.3, o.dur ?? 0.3, o.curve, o.hold);
    let node = osc;
    if (o.filter) {
      const f = filterNode(t, o.filter, o.dur);
      node.connect(f);
      node = f;
    }
    node.connect(g);
    output(g, o);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.005) + (o.hold || 0) + (o.dur ?? 0.3) + 0.05);
    return osc;
  }

  /** Gefiltertes Rauschen (Wischen, Rascheln, Aufprall). */
  function noise(o) {
    const t = o.t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    envelope(g.gain, t, o.attack ?? 0.01, o.peak ?? 0.3, o.dur, o.curve);
    src.connect(f);
    f.connect(g);
    output(g, o);
    src.start(t, Math.random() * 1.5);
    src.stop(t + (o.attack ?? 0.01) + o.dur + 0.05);
  }

  /** Gezupfte Saite (Harfe): Grundton + Oberton, schnell abklingend. */
  function pluck(freq, t, peak = 0.12, bus, dur = 1.6) {
    tone({ t, freq, type: 'triangle', attack: 0.004, peak, dur, bus });
    tone({ t, freq: freq * 2, type: 'sine', attack: 0.004, peak: peak * 0.35, dur: dur * 0.5, bus });
  }

  /** Glocke: unharmonische Teiltöne. */
  function bell(freq, t, peak = 0.12) {
    [1, 2.76, 5.4].forEach((m, i) => tone({ t, freq: freq * m, type: 'sine', attack: 0.003, peak: peak / (i + 1), dur: 1.8 / (i + 1) }));
  }

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI-Nummer → Hz

  /* ------------------------------------------------------------ Soundeffekte */
  const SOUNDS = {
    select() {
      const t = ctx.currentTime;
      tone({ t, freq: 1250, type: 'triangle', dur: 0.05, peak: 0.22 });
      noise({ t, f0: 3000, type: 'highpass', dur: 0.03, peak: 0.2 });
    },
    // Klick für alle Knöpfe wie ein aufgeschlagenes Buch: dumpfer Klapp des Einbands, kurzer
    // Papierhauch, kaum Ton – so klingt nichts nach
    click() {
      const t = ctx.currentTime;
      noise({ t, f0: 420, f1: 220, type: 'lowpass', q: 0.7, attack: 0.001, dur: 0.035, peak: 0.42, bus: dryBus });
      tone({ t, freq: 100, to: 65, type: 'sine', attack: 0.001, dur: 0.02, peak: 0.2, bus: dryBus });
      noise({ t: t + 0.004, f0: 1800, type: 'bandpass', q: 0.6, attack: 0.002, dur: 0.018, peak: 0.02, bus: dryBus });
    },
    flip() {
      const t = ctx.currentTime;
      noise({ t, f0: 1400, f1: 4800, q: 1.4, dur: 0.12, peak: 0.35 });
      noise({ t: t + 0.1, f0: 5000, type: 'highpass', dur: 0.02, peak: 0.12 });
    },
    // Münze landet: heller Metallklang mit kurzem Nachhüpfen
    coin() {
      const t = ctx.currentTime;
      tone({ t, freq: 2350, type: 'sine', attack: 0.001, dur: 0.35, peak: 0.16 });
      tone({ t, freq: 3520, type: 'sine', attack: 0.001, dur: 0.22, peak: 0.08 });
      tone({ t: t + 0.11, freq: 2350, type: 'sine', attack: 0.001, dur: 0.18, peak: 0.07 });
    },
    whoosh() { noise({ f0: 350, f1: 1900, q: 0.9, attack: 0.08, dur: 0.32, peak: 0.28, curve: 'lin' }); },
    place() {
      const t = ctx.currentTime;
      tone({ t, freq: 170, to: 60, dur: 0.16, peak: 0.45 });
      noise({ t, f0: 900, type: 'lowpass', dur: 0.06, peak: 0.25 });
    },
    draw() {
      const t = ctx.currentTime;
      noise({ t, f0: 2600, f1: 900, q: 1.2, attack: 0.02, dur: 0.18, peak: 0.22 });
      noise({ t: t + 0.17, f0: 4000, type: 'highpass', dur: 0.02, peak: 0.1 });
    },
    terrain() {
      const t = ctx.currentTime;
      tone({ t, freq: 80, to: 48, dur: 0.9, peak: 0.45 });
      [62, 69, 74].forEach((n, i) => pluck(NOTE(n), t + 0.12 + i * 0.09, 0.07));
    },
    reveal() {
      const t = ctx.currentTime;
      tone({ t, freq: 95, to: 38, dur: 0.8, peak: 0.8 });
      noise({ t, f0: 500, type: 'lowpass', dur: 0.45, peak: 0.35 });
      [50, 57, 62].forEach((n) => tone({ t: t + 0.02, freq: NOTE(n), type: 'sawtooth', attack: 0.02, dur: 1.2, peak: 0.05, filter: { freq: 1400, to: 300, time: 1.2 } }));
    },
    win() {
      const t = ctx.currentTime;
      [74, 78, 81, 86].forEach((n, i) => pluck(NOTE(n), t + i * 0.09, 0.11));
    },
    lose() {
      const t = ctx.currentTime;
      [69, 65, 62].forEach((n, i) => pluck(NOTE(n), t + i * 0.14, 0.09, undefined, 1.2));
    },
    tie() {
      const t = ctx.currentTime;
      pluck(NOTE(69), t, 0.09);
      pluck(NOTE(69), t + 0.2, 0.07);
    },
    horn() {
      const t = ctx.currentTime;
      [55, 82.5, 110].forEach((f, i) => {
        const osc = tone({ t, freq: f, type: 'sawtooth', attack: 0.25, dur: 1.1, peak: 0.16 / (i + 1), curve: 'lin',
          filter: { freq: 250, to: 1600, time: 0.4, q: 1.2 } });
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5;
        depth.gain.value = f * 0.012;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + 1.5);
      });
    },
    magic() {
      const t = ctx.currentTime;
      for (let i = 0; i < 7; i++) tone({ t: t + i * 0.05, freq: 1400 + Math.random() * 1800, type: 'sine', attack: 0.01, dur: 0.5, peak: 0.035 });
    },
    quartet() {
      const t = ctx.currentTime;
      [74, 78, 81, 86, 90, 93].forEach((n, i) => bell(NOTE(n), t + i * 0.08, 0.1));
      SOUNDS.magic();
    },
    // ---- Schach: Figur setzt auf (Holz auf Holz), Schlagen, Schach, Rochade, Umwandlung
    move() {
      const t = ctx.currentTime;
      tone({ t, freq: 230 + Math.random() * 30, to: 120, dur: 0.07, peak: 0.42, bus: dryBus });
      noise({ t, f0: 1700, type: 'bandpass', q: 1.4, attack: 0.001, dur: 0.035, peak: 0.32, bus: dryBus });
      noise({ t, f0: 500, type: 'lowpass', attack: 0.001, dur: 0.06, peak: 0.18 });
    },
    capture() {
      const t = ctx.currentTime;
      tone({ t, freq: 180, to: 70, dur: 0.12, peak: 0.5, bus: dryBus });
      noise({ t, f0: 2400, type: 'bandpass', q: 1.1, attack: 0.001, dur: 0.05, peak: 0.4, bus: dryBus });
      noise({ t: t + 0.05, f0: 1300, type: 'bandpass', q: 1.6, attack: 0.001, dur: 0.04, peak: 0.25, bus: dryBus });
      tone({ t: t + 0.01, freq: 3100, type: 'sine', attack: 0.001, dur: 0.25, peak: 0.04 });
    },
    check() {
      const t = ctx.currentTime;
      SOUNDS.move();
      [81, 88].forEach((n, i) => bell(NOTE(n), t + 0.04 + i * 0.07, 0.09));
    },
    castle() {
      const t = ctx.currentTime;
      SOUNDS.move();
      setTimeout(() => play('move'), 120);
      tone({ t: t + 0.1, freq: NOTE(62), type: 'triangle', attack: 0.01, dur: 0.4, peak: 0.05 });
    },
    promote() {
      const t = ctx.currentTime;
      SOUNDS.move();
      [74, 79, 83, 86].forEach((n, i) => bell(NOTE(n), t + 0.05 + i * 0.06, 0.08));
    },
    illegal() {
      const t = ctx.currentTime;
      tone({ t, freq: 140, to: 110, type: 'square', attack: 0.005, dur: 0.12, peak: 0.06, filter: { freq: 700 } , bus: dryBus });
    },
    lowtime() {
      const t = ctx.currentTime;
      tone({ t, freq: 1760, type: 'sine', attack: 0.002, dur: 0.08, peak: 0.08, bus: dryBus });
    },
    correct() {
      const t = ctx.currentTime;
      [76, 83].forEach((n, i) => bell(NOTE(n), t + i * 0.09, 0.1));
    },
    wrong() {
      const t = ctx.currentTime;
      [62, 61].forEach((n, i) => tone({ t: t + i * 0.12, freq: NOTE(n), type: 'triangle', attack: 0.01, dur: 0.25, peak: 0.08 }));
    },
    star() {
      const t = ctx.currentTime;
      bell(NOTE(91 + Math.floor(Math.random() * 3) * 2), t, 0.07);
    },
    achievement() {
      const t = ctx.currentTime;
      [69, 74, 78, 81].forEach((n, i) => pluck(NOTE(n), t + i * 0.07, 0.1));
      [86, 93].forEach((n, i) => bell(NOTE(n), t + 0.3 + i * 0.1, 0.09));
      SOUNDS.magic();
    },
    levelup() {
      SOUNDS.victory();
      SOUNDS.magic();
    },
    victory() {
      const t = ctx.currentTime;
      const chord = (notes, at, dur) => notes.forEach((n) => tone({ t: at, freq: NOTE(n), type: 'sawtooth', attack: 0.03, dur, peak: 0.07,
        filter: { freq: 2400, to: 900, time: dur } }));
      chord([62, 66, 69], t, 0.35);
      chord([62, 66, 69], t + 0.38, 0.2);
      chord([64, 67, 71], t + 0.6, 0.2);
      chord([66, 69, 74], t + 0.82, 1.6);
      tone({ t: t + 0.82, freq: 73, to: 36, dur: 1, peak: 0.5 });
    },
    // ---- Feuerwerk: Knall mit Nachknistern
    firework(pan = 0) {
      const t = ctx.currentTime;
      noise({ t, f0: 260, f1: 60, type: 'lowpass', q: 0.8, attack: 0.002, dur: 0.6, peak: 0.45, pan });
      tone({ t, freq: 70, to: 32, dur: 0.5, peak: 0.25, pan });
      for (let i = 0; i < 14; i++) noise({ t: t + 0.18 + Math.random() * 0.9, f0: 3000 + Math.random() * 4000, type: 'highpass', attack: 0.001, dur: 0.02, peak: 0.05 + Math.random() * 0.05, pan });
    },
    defeat() {
      const t = ctx.currentTime;
      [50, 53, 57].forEach((n) => tone({ t, freq: NOTE(n), type: 'sawtooth', attack: 0.4, dur: 2.4, peak: 0.06, curve: 'lin', filter: { freq: 800, to: 250, time: 2.4 } }));
      tone({ t, freq: 60, to: 40, dur: 1.2, peak: 0.4 });
    },
  };

  function play(name, ...args) {
    if (!settings.sfx || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
    try { SOUNDS[name](...args); } catch (e) { /* Ton ist nie spielentscheidend */ }
  }

  /* ------------------------------------------------------------ Hintergrundmusik */
  /*
   * Ruhige Ambient-Musik: eine weiche, langsam atmende Klangfläche, ein tiefer Grundton und ein Klavier,
   * das sparsam über die Akkorde improvisiert (Akkordtöne und Pentatonik, viel Pause, wechselnde Anschläge).
   * Jeder Takt gehört zu einem Akkord (MIDI-Nummern, tiefster Ton = Grundton); ein Akkord trägt BARS_PER_CHORD Takte.
   * Die Stimmung bestimmt Tempo, Dichte des Klaviers und Helligkeit – ein Wechsel greift am nächsten Takt.
   */
  const PROGS = [
    // Cmaj9 – Am9 – Fmaj9 – G6sus
    [[36, 52, 55, 59, 62], [33, 52, 55, 59, 60], [29, 52, 57, 60, 64], [31, 50, 55, 57, 62]],
    // Fmaj7 – Em7 – Dm9 – Cmaj7/G
    [[29, 53, 57, 60, 64], [28, 52, 55, 59, 62], [26, 53, 57, 60, 64], [31, 52, 55, 59, 60]],
    // Am7 – Fmaj7#11 – Cmaj9 – Gsus2
    [[33, 52, 55, 60, 64], [29, 53, 57, 59, 64], [36, 52, 55, 59, 62], [31, 50, 55, 57, 62]],
  ];
  const SCALE = [0, 2, 4, 7, 9, 11]; // C-Dur-Pentatonik plus Septime
  const MOODS = {
    menu: { beat: 1.35, progs: PROGS, piano: 0.55, pad: 0.028, bright: 1400 },
    game: { beat: 1.5, progs: PROGS, piano: 0.32, pad: 0.022, bright: 1100 }, // beim Spielen zurückhaltend
    training: { beat: 1.4, progs: [PROGS[1], PROGS[0]], piano: 0.45, pad: 0.025, bright: 1500 },
  };
  MOODS.neutral = MOODS.game;
  const TERRAIN_MOODS = { arcane: 'training' };
  let music = null;

  const MB = () => musicBus;
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Klangfläche: je Akkordton zwei leicht verstimmte Stimmen, sehr langsam ein- und ausblendend. */
  function padLayer(t, chord, len, m) {
    const bus = sharedFilter(t, { freq: m.bright * 0.6, to: m.bright, time: len * 0.5, q: 0.3 });
    chord.slice(1).forEach((n, i) => {
      const pan = (i / (chord.length - 2)) * 1.2 - 0.6;
      [-5, 5].forEach((cents) => tone({ t, freq: NOTE(n), type: i % 2 ? 'triangle' : 'sine', detune: cents + rnd(-2, 2),
        attack: len * 0.45, hold: len * 0.45, dur: len * 0.6, peak: m.pad * 0.6, curve: 'lin', bus, pan }));
    });
  }

  /** Tiefer, weicher Grundton über den ganzen Akkord. */
  function bassLayer(t, chord, len, gain = 0.07) {
    tone({ t, freq: NOTE(chord[0]), type: 'sine', attack: len * 0.3, hold: len * 0.5, dur: len * 0.5, peak: gain, curve: 'lin', bus: MB() });
  }

  /**
   * Klavierton: angeschlagene Saite – einige leicht gestreckte Obertöne, die hohen klingen schneller ab,
   * dazu ein kaum hörbarer Hammeranschlag. Tiefe Töne klingen länger nach als hohe.
   */
  function pianoNote(n, t, vel = 0.7, pan = 0) {
    const f = NOTE(n);
    const sustain = Math.max(1.6, 5.5 - (n - 48) * 0.09);
    const peak = 0.085 * vel;
    [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]].forEach(([k, a]) => {
      const stretch = 1 + 0.0004 * k * k;
      tone({ t, freq: f * k * stretch, type: 'sine', attack: 0.004, dur: sustain / (0.6 + k * 0.5), peak: peak * a * (0.6 + vel * 0.4),
        bus: MB(), pan, filter: { freq: 900 + vel * 3500, q: 0.4 } });
    });
    noise({ t, f0: 1800, type: 'bandpass', q: 0.8, attack: 0.001, dur: 0.03, peak: 0.004 * vel, bus: MB(), pan });
  }

  /** Klavier: sparsame Melodie über dem Akkord, am Akkordbeginn manchmal ein gebrochener Akkord. */
  function pianoLayer(t, chord, beat, m, fresh) {
    const tones = [];
    for (let n = 60; n <= 84; n++) {
      const inChord = chord.slice(1).some((c) => c % 12 === n % 12);
      if (inChord || SCALE.includes(n % 12)) tones.push({ n, w: inChord ? 3 : 1 });
    }
    const weighted = tones.flatMap((x) => Array(x.w).fill(x.n));
    if (fresh && Math.random() < 0.6) {
      // Gebrochener Akkord, tief und leise
      chord.slice(1, 4).forEach((n, i) => pianoNote(n + 12, t + i * rnd(0.09, 0.16), rnd(0.35, 0.5), -0.3 + i * 0.25));
    }
    let last = pick(weighted);
    for (let step = 0; step < 8; step++) {
      if (Math.random() > m.piano * (step % 2 ? 0.45 : 0.85)) continue;
      // Kleine Schritte bevorzugt: nächste Note in der Nähe der letzten
      const near = weighted.filter((n) => Math.abs(n - last) <= 5);
      const n = pick(near.length ? near : weighted);
      last = n;
      const at = t + step * (beat / 2) + rnd(0, 0.04);
      pianoNote(n, at, rnd(0.45, 0.9), rnd(-0.4, 0.4));
      if (Math.random() < 0.15) pianoNote(n - pick([3, 4, 5, 7]), at + 0.01, rnd(0.3, 0.5), rnd(-0.3, 0.3));
    }
  }

  /** Ab und zu ein ferner, glockenheller Ton ganz oben. */
  function shimmerLayer(t, chord, beat) {
    if (Math.random() > 0.18) return;
    const n = pick(chord.slice(1)) + 24;
    tone({ t: t + rnd(0, beat * 3), freq: NOTE(n), type: 'sine', attack: 0.6, dur: 4, peak: 0.012, bus: farBus || MB(), pan: rnd(-0.7, 0.7) });
  }

  const BARS_PER_CHORD = 2;

  /**
   * Einen Takt in der gegebenen Stimmung planen; liefert die Taktlänge.
   * Fläche und Grundton setzen nur zu Beginn eines Akkords ein (fresh) und tragen über alle seine Takte.
   */
  function scheduleBar(t, chord, mood, fresh) {
    const m = MOODS[mood] || MOODS.neutral;
    const len = 4 * m.beat;
    if (fresh) {
      const chordLen = len * BARS_PER_CHORD;
      padLayer(t, chord, chordLen, m);
      bassLayer(t, chord, chordLen);
    }
    pianoLayer(t, chord, m.beat, m, fresh);
    shimmerLayer(t, chord, m.beat);
    return len;
  }

  function startMusic() {
    if (!settings.music || !init() || music) return;
    music = { next: musicCtx.currentTime + 0.2, bar: 0, prog: 0, mood: pendingMood };
    const tick = () => inMusic(() => {
      // Hing der Takt hinterher (Tab gedrosselt, Kontext angehalten): nicht alles Verpasste auf einmal nachspielen
      if (music && music.next < ctx.currentTime) music.next = ctx.currentTime + 0.05;
      while (music && music.next < ctx.currentTime + 1.5) {
        // Stimmungswechsel am Beginn einer Akkordfolge oder spätestens am nächsten Takt
        if (music.mood !== pendingMood) { music.mood = pendingMood; music.bar = 0; music.prog = 0; }
        const progs = (MOODS[music.mood] || MOODS.neutral).progs;
        const prog = progs[music.prog % progs.length];
        const step = music.bar % (4 * BARS_PER_CHORD);
        music.next += scheduleBar(music.next, prog[Math.floor(step / BARS_PER_CHORD)], music.mood, step % BARS_PER_CHORD === 0);
        music.bar++;
        if (music.bar % (4 * BARS_PER_CHORD) === 0 && progs.length > 1) music.prog = Math.random() < 0.6 ? music.prog + 1 : music.prog;
      }
    });
    tick();
    music.timer = setInterval(tick, 400);
  }

  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    music = null;
  }

  let pendingMood = 'menu';
  /** Stimmung: 'menu', 'game' oder 'training'. */
  function setMood(name) {
    pendingMood = TERRAIN_MOODS[name] || (MOODS[name] ? name : 'neutral');
  }

  /* ------------------------------------------------------------ Steuerung */
  function unlock() {
    if (!init()) return;
    // iOS meldet nach einem Anruf oder Siri 'interrupted' statt 'suspended'
    if (!document.hidden) [sfxCtx, musicCtx].forEach((c) => { if (c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); });
    if (settings.music) startMusic();
  }

  // Im Hintergrund-Tab schweigen (spart Akku): anhalten und beim Zurückkehren weitermachen
  if (G.document) {
    document.addEventListener('visibilitychange', () => {
      if (!sfxCtx) return;
      if (document.hidden) [sfxCtx, musicCtx].forEach((c) => { if (c.state === 'running') c.suspend().catch(() => {}); });
      else unlock();
    });
  }

  function fade(bus, value) {
    const t = bus.context.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(value, t, 0.15);
  }

  function setSfx(on) {
    settings.sfx = on;
    store.set('sfx', on);
    if (sfxCtx) { fade(sfxBus, on ? SFX_VOL : 0); fade(dryBus, on ? SFX_VOL : 0); }
  }

  function setMusic(on) {
    settings.music = on;
    store.set('music', on);
    if (!musicCtx) return;
    if (on) {
      fade(musicOut, MUSIC_VOL);
      startMusic();
      return;
    }
    // Sofort aus: 20 ms Blende gegen Knacken, dann die alte Kette samt Hall abhängen
    stopMusic();
    const old = musicOut;
    const t = musicCtx.currentTime;
    old.gain.cancelScheduledValues(t);
    old.gain.setValueAtTime(old.gain.value, t);
    old.gain.linearRampToValueAtTime(0, t + 0.02);
    const oldNodes = musicNodes;
    setTimeout(() => oldNodes.forEach((n) => n.disconnect()), 100); // samt Hall und Echo-Rückkopplung
    inMusic(buildMusic);
  }

  /**
   * Nur für Tests: berechnet einen Klang (oder 'music' = 8 Takte Musik) offline und liefert Pegel.
   * Rückgabe: { peak, rms } in dBFS.
   */
  async function measure(name, seconds = 3) {
    const saved = { ctx, sfxCtx, musicCtx, master, musicMaster, sfxBus, dryBus, musicBus, musicOut, musicNodes, hallBuf, ambBus, farBus, reverb, noiseBuf, sfx: settings.sfx, music: settings.music };
    const len = name.startsWith('music') ? 8 * 4 * 1.6 + 8 : seconds;
    const off = new OfflineAudioContext(2, Math.ceil(44100 * len), 44100);
    ctx = sfxCtx = musicCtx = off;
    settings.sfx = true;
    settings.music = true;
    // Nur das Planen läuft mit dem Offline-Kontext; vor dem Rendern ist alles zurückgetauscht,
    // sonst plante die laufende Musik ihre nächsten Takte in die Messung hinein
    try {
      buildGraph();
      if (name.startsWith('music')) {
        const mood = name.split(':')[1] || 'neutral';
        let t = 0.05;
        for (let bar = 0; bar < 8; bar++) t += scheduleBar(t, MOODS[mood].progs[0][Math.floor(bar / BARS_PER_CHORD) % 4], mood, bar % BARS_PER_CHORD === 0);
      } else SOUNDS[name]();
    } finally {
      Object.assign(settings, { sfx: saved.sfx, music: saved.music });
      ({ ctx, sfxCtx, musicCtx, master, musicMaster, sfxBus, dryBus, musicBus, musicOut, musicNodes, hallBuf, ambBus, farBus, reverb, noiseBuf } = saved);
    }
    const buf = await off.startRendering();
    let peak = 0;
    let sum = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    }
    const db = (x) => Math.round(20 * Math.log10(Math.max(x, 1e-9)) * 10) / 10;
    // Klangcharakter: Helligkeit (Nulldurchgänge pro Sekunde) und Rhythmik (Schwankung der Lautstärke in 50-ms-Fenstern)
    const d0 = buf.getChannelData(0);
    let zc = 0;
    for (let i = 1; i < d0.length; i++) if ((d0[i - 1] < 0) !== (d0[i] < 0)) zc++;
    const win = Math.floor(buf.sampleRate * 0.05);
    const env = [];
    for (let i = 0; i + win < d0.length; i += win) { let e = 0; for (let k = i; k < i + win; k++) e += d0[k] * d0[k]; env.push(Math.sqrt(e / win)); }
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    const sd = Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / env.length);
    return { peak: db(peak), rms: db(Math.sqrt(sum / (buf.length * buf.numberOfChannels))),
      brightness: Math.round(zc / buf.duration), rhythm: Math.round((sd / mean) * 100) / 100 };
  }

  CG.Audio = { unlock, play, setSfx, setMusic, setMood, settings, measure, sounds: () => Object.keys(SOUNDS), moods: () => Object.keys(MOODS), currentMood: () => (music ? music.mood : null), pendingMood: () => pendingMood };
})(globalThis);
