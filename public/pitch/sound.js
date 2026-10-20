// The pitch soundtrack, synthesised live in the browser (nothing recorded, nothing licensed). It follows the story:
//   calm     "It used to be simple": slow pads and a bell.
//   chaos    the problems arrive: action techno at 140 BPM that adds layers as the painting is defaced.
//   solved   REFLUENZ: a clean, modern groove at 112 BPM (soft kick, sub bass, electric-piano chords, a stereo pluck).
// setStory(progress 0..1) drives calm → chaos. setMode('chaos' | 'silent' | 'solved') handles the turning point:
// chaos cuts to silence, and after at least a second of it a hopeful burst plays before the solved groove comes in.

const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);
const LOOKAHEAD = 0.14;   // seconds of audio scheduled ahead
const TICK_MS = 25;

// calm
const PADS = [[48, 52, 55, 59, 62], [45, 52, 55, 60, 64], [41, 45, 48, 52, 55], [43, 50, 55, 59, 62]];
const BELLS = [72, 74, 76, 79, 81, 84];
const PAD_SECONDS = 7.5;

// chaos: A minor, 140 BPM, 16 steps per bar
const TECHNO_BPM = 140;
const ACID = [33, 33, 45, 33, 36, 33, 45, 33, 33, 40, 33, 45, 31, 33, 43, 33];          // rolling bass line (midi)
const ACID_CUTOFF = [.9, .3, .6, .3, .8, .3, .5, .3, 1, .4, .3, .7, .6, .3, .9, .4];   // filter accents
const STAB = [57, 60, 64];                                                              // A minor stab

// solved: F major / D minor colours, 112 BPM
const SMART_BPM = 112;
const KEYS = [[53, 57, 60, 64, 67], [50, 53, 57, 60, 64], [46, 50, 53, 57, 62], [48, 52, 55, 58, 62]]; // Fmaj9 Dm9 Bbmaj9 C9sus
const SUB = [29, 26, 34, 36];
const PLUCK = [0, 2, 4, 2, 3, 4, 2, 4];  // index into the current chord, one per 8th note

export function createSound() {
  let ctx, out, buses, reverb, delay, noiseBuffer, scheduler;
  let playing = false, story = 0, solved = false, hushed = false, mode = 'chaos', hushedAt = 0, pending = [];
  const seq = { techno: { next: 0, step: 0, on: false }, smart: { next: 0, step: 0, on: false } };
  let padTimer, bellTimer, padIndex = 0;

  // --- graph ------------------------------------------------------------------------------------------------------
  function setup() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 6; limiter.ratio.value = 8; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    out = ctx.createGain(); out.gain.value = 0;
    out.connect(limiter).connect(ctx.destination);

    reverb = ctx.createConvolver(); reverb.buffer = impulse(3.2);
    const wet = ctx.createGain(); wet.gain.value = 0.5; reverb.connect(wet).connect(out);

    delay = ctx.createDelay(1); delay.delayTime.value = 60 / SMART_BPM * 0.75; // dotted 8th
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3200;
    delay.connect(dl).connect(fb).connect(delay);
    const dWet = ctx.createGain(); dWet.gain.value = 0.35; dl.connect(dWet).connect(out);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const bus = (level, send = 0) => {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(out);
      if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s).connect(reverb); }
      g.level = level; return g;
    };
    buses = { calm: bus(0.9, 0.9), techno: bus(0.85, 0.12), smart: bus(0.8, 0.25), fx: bus(1, 1.1) };
    buses.fx.gain.value = 1;

    // Techno gets grit as the painting falls apart.
    buses.drive = ctx.createWaveShaper(); buses.drive.curve = curve(0); buses.drive.oversample = '2x';
    buses.technoIn = ctx.createGain(); buses.technoIn.connect(buses.drive).connect(buses.techno);
  }

  function impulse(seconds) {
    const rate = ctx.sampleRate, length = rate * seconds, b = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6); }
    return b;
  }
  function curve(amount) {
    const k = amount * 60, n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = k ? (1 + k) * x / (1 + k * Math.abs(x)) : x; }
    return c;
  }
  const env = (param, t, peak, attack, decay, floor = 0.0001) => {
    param.cancelScheduledValues(t); param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + attack); param.exponentialRampToValueAtTime(floor, t + attack + decay);
  };
  const noise = (t, length, dest, type, freq, q, peak, decay) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g.gain, t, peak, 0.001, decay);
    src.connect(f).connect(g).connect(dest); src.start(t, Math.random()); src.stop(t + length);
  };

  // --- calm ---------------------------------------------------------------------------------------------------------
  function padVoice(midi, t, length, level) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 2.8);
    g.gain.setValueAtTime(level, t + length - 3); g.gain.linearRampToValueAtTime(0, t + length + 1.5);
    g.connect(buses.calm);
    for (const [type, detune] of [['triangle', -4], ['sine', 5]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = NOTE(midi); o.detune.value = detune;
      o.connect(g); o.start(t); o.stop(t + length + 2);
    }
  }
  function pad() {
    const t = ctx.currentTime + 0.05;
    PADS[padIndex++ % PADS.length].forEach((n, i) => padVoice(n, t + i * 0.12, PAD_SECONDS + 2, 0.05));
  }
  function bell() {
    if (!playing) return;
    const t = ctx.currentTime + 0.02, g = ctx.createGain();
    env(g.gain, t, 0.05, 0.02, 3.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = NOTE(BELLS[Math.floor(Math.random() * BELLS.length)]);
    o.connect(g).connect(buses.calm); o.start(t); o.stop(t + 3.6);
    bellTimer = setTimeout(bell, 2600 + Math.random() * 4200);
  }

  // --- chaos: action techno -------------------------------------------------------------------------------------------
  function kick(t, dest, { from = 155, to = 42, level = 1, decay = 0.42 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + 0.11);
    env(g.gain, t, level, 0.002, decay);
    o.connect(g).connect(dest); o.start(t); o.stop(t + decay + 0.05);
  }
  function technoStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16), i = intensity(), dest = buses.technoIn;
    if (s % 4 === 0) kick(t, dest, { level: 1 });
    if (i > 0.18 && s % 4 === 2) noise(t, 0.08, dest, 'highpass', 8000, 0.8, 0.22, 0.05);            // offbeat hat
    if (i > 0.32 && s % 2 === 1) noise(t, 0.04, dest, 'highpass', 10000, 0.7, 0.09, 0.025);          // 16th ticks
    if (i > 0.42) acid(ACID[s] + (bar % 4 === 3 && s > 11 ? 3 : 0), t, ACID_CUTOFF[s], i, dest);
    if (i > 0.58 && (s === 4 || s === 12)) for (const d of [0, 0.012, 0.024]) noise(t + d, 0.2, dest, 'bandpass', 1600, 1.2, 0.42, 0.13); // clap
    if (i > 0.72 && (s === 3 || s === 11 || (s === 14 && bar % 2))) stab(t, dest);
    if (i > 0.88 && s === 0 && bar % 2 === 0) riser(t, dest);
  }
  function acid(midi, t, accent, i, dest) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = NOTE(midi);
    f.type = 'lowpass'; f.Q.value = 9 + i * 8;
    const top = 400 + accent * (900 + i * 3200);
    f.frequency.setValueAtTime(top, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.14);
    env(g.gain, t, 0.24, 0.003, 0.13);
    o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + 0.2);
  }
  function stab(t, dest) {
    const g = ctx.createGain(); env(g.gain, t, 0.09, 0.004, 0.22);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
    g.connect(f).connect(dest);
    for (const n of STAB) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = NOTE(n); o.connect(g); o.start(t); o.stop(t + 0.3); }
  }
  function riser(t, dest) {
    const len = 60 / TECHNO_BPM * 8, src = ctx.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.05);
    src.connect(f).connect(g).connect(dest); src.start(t); src.stop(t + len + 0.1);
  }

  // --- solved: modern, smart groove ------------------------------------------------------------------------------------
  function smartStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16), chord = KEYS[bar % KEYS.length], dest = buses.smart;
    if (s % 4 === 0) kick(t, dest, { from: 110, to: 46, level: 0.8, decay: 0.32 });
    if (s % 4 === 2) noise(t, 0.06, dest, 'highpass', 7000, 0.6, 0.08, 0.04);                       // soft shaker
    if (s % 2 === 1) noise(t, 0.03, dest, 'highpass', 11000, 0.5, 0.03, 0.02);
    if (s === 8) for (const d of [0, 0.01]) noise(t + d, 0.18, dest, 'bandpass', 2200, 1.4, 0.12, 0.1); // light clap
    if (s === 0 || s === 10) sub(SUB[bar % SUB.length], t, s === 0 ? 0.9 : 0.5, dest);
    if (s === 0 || s === 7) keys(chord, t, s === 0 ? 1.6 : 0.7, dest);
    if (s % 2 === 0) pluck(chord[PLUCK[(s / 2) % PLUCK.length]] + 12, t, dest);
  }
  function sub(midi, t, length, dest) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = NOTE(midi);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.02); g.gain.setTargetAtTime(0.0001, t + length * 0.6, 0.12);
    o.connect(g).connect(dest); o.start(t); o.stop(t + length + 0.6);
  }
  function keys(chord, t, length, dest) {  // two-operator FM electric piano
    for (const n of chord) {
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), g = ctx.createGain();
      car.frequency.value = NOTE(n); mod.frequency.value = NOTE(n) * 2;
      modGain.gain.setValueAtTime(NOTE(n) * 1.6, t); modGain.gain.exponentialRampToValueAtTime(NOTE(n) * 0.05, t + 0.6);
      mod.connect(modGain).connect(car.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.01); g.gain.setTargetAtTime(0.0001, t + 0.05, length * 0.45);
      car.connect(g).connect(dest);
      for (const o of [car, mod]) { o.start(t); o.stop(t + length + 1.2); }
    }
  }
  function pluck(midi, t, dest) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    o.type = 'triangle'; o.frequency.value = NOTE(midi);
    f.type = 'lowpass'; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    env(g.gain, t, 0.07, 0.003, 0.28);
    pan.pan.value = Math.sin(t * 2.1) * 0.6;
    o.connect(f).connect(g).connect(pan); pan.connect(dest); pan.connect(delay);
    o.start(t); o.stop(t + 0.4);
  }

  // --- the turning point: a hopeful burst out of silence --------------------------------------------------------------
  function burst() {
    const t = ctx.currentTime + 0.02, dest = buses.fx;
    // a deep, soft boom
    const boom = ctx.createOscillator(), bg = ctx.createGain();
    boom.frequency.setValueAtTime(78, t); boom.frequency.exponentialRampToValueAtTime(36, t + 1.2);
    bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.85, t + 0.03); bg.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    boom.connect(bg).connect(dest); boom.start(t); boom.stop(t + 3.8);
    // a bright breath of air that opens up
    const air = ctx.createBufferSource(); air.buffer = noiseBuffer;
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.Q.value = 0.6;
    af.frequency.setValueAtTime(600, t); af.frequency.exponentialRampToValueAtTime(14000, t + 0.5); af.frequency.exponentialRampToValueAtTime(2200, t + 3);
    const ag = ctx.createGain(); ag.gain.setValueAtTime(0.0001, t); ag.gain.linearRampToValueAtTime(0.32, t + 0.04); ag.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    air.connect(af).connect(ag).connect(dest); air.start(t); air.stop(t + 3.4);
    // a wide major chord that blooms (F major add 9, spread across five octaves)
    [41, 53, 60, 64, 67, 69, 72, 76, 79, 84].forEach((n, i) => {
      for (const [type, detune] of [['sine', -6], ['triangle', 7]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = NOTE(n); o.detune.value = detune;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 - i * 0.003, t + 0.06 + i * 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
        o.connect(g).connect(dest); o.start(t); o.stop(t + 6.6);
      }
    });
    // shimmering bells falling like sparks
    const sparkle = [84, 88, 91, 93, 96, 91, 88, 93, 96, 100, 96, 91];
    sparkle.forEach((n, i) => {
      const at = t + 0.12 + i * 0.16 + Math.random() * 0.05, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = NOTE(n);
      env(g.gain, at, 0.05, 0.004, 1.6);
      o.connect(g).connect(dest); o.start(at); o.stop(at + 1.7);
    });
  }
  const later = (fn, ms) => pending.push(setTimeout(fn, ms));
  function clearPending() { pending.forEach(clearTimeout); pending = []; }
  function enter(next) {
    if (next === mode) return;
    mode = next;
    if (!ctx || !playing) { solved = next === 'solved'; hushed = next === 'silent'; return; }
    clearPending();
    if (next === 'chaos') { hushed = false; solved = false; mix(0.4); return; }
    if (next === 'silent') { if (!hushed) { hushed = true; hushedAt = ctx.currentTime; } solved = false; mix(0.06); return; }
    // solved: from chaos or silence, keep (at least) a second of silence, then the burst, then the groove.
    if (!hushed) { hushed = true; hushedAt = ctx.currentTime; mix(0.06); }
    const wait = Math.max(0, 1 - (ctx.currentTime - hushedAt)) * 1000;
    later(() => { burst(); later(() => { hushed = false; solved = true; mix(1.4); }, 2000); }, wait);
  }

  // --- mix and transport ------------------------------------------------------------------------------------------------
  const intensity = () => Math.min(1, Math.max(0, (story - 0.08) / 0.84));
  function targets() {
    if (hushed) return { calm: 0, techno: 0, smart: 0 };
    if (solved) return { calm: 0, techno: 0, smart: 1 };
    const chaos = intensity();
    return { calm: Math.max(0, 1 - (story - 0.03) / 0.08), techno: story > 0.07 ? 0.55 + chaos * 0.45 : 0, smart: 0 };
  }
  function mix(fade = 0.6) {
    if (!ctx) return;
    const now = ctx.currentTime, want = targets();
    for (const name of ['calm', 'techno', 'smart']) buses[name].gain.setTargetAtTime(want[name] * buses[name].level, now, fade);
    buses.drive.curve = curve(intensity() > 0.8 ? (intensity() - 0.8) * 2.5 : 0);
    for (const name of ['techno', 'smart']) {
      const s = seq[name];
      if (want[name] > 0 && !s.on) { s.on = true; s.next = now + 0.06; s.step = 0; }
      if (want[name] === 0 && s.on) setTimeout(() => { if (targets()[name] === 0) s.on = false; }, fade * 5000);
    }
  }
  function run() {
    const until = ctx.currentTime + LOOKAHEAD;
    for (const [name, bpm, fn] of [['techno', TECHNO_BPM, technoStep], ['smart', SMART_BPM, smartStep]]) {
      const s = seq[name];
      if (!s.on) continue;
      while (s.next < until) { fn(s.step, s.next); s.next += 60 / bpm / 4; s.step++; }
    }
  }

  return {
    get playing() { return playing; },
    async start() {
      if (!ctx) setup();
      await ctx.resume();
      playing = true;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0.95, ctx.currentTime + 1.8);
      pad(); padTimer = setInterval(pad, PAD_SECONDS * 1000);
      bellTimer = setTimeout(bell, 1800);
      scheduler = setInterval(run, TICK_MS);
      solved = mode === 'solved'; hushed = mode === 'silent';
      mix(0.3);
    },
    stop() {
      if (!ctx) return;
      playing = false;
      clearInterval(padTimer); clearTimeout(bellTimer); clearInterval(scheduler); clearPending();
      seq.techno.on = seq.smart.on = false;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
      setTimeout(() => { if (!playing) ctx.suspend(); }, 1200);
    },
    setStory(progress) { story = Math.min(1, Math.max(0, progress)); if (playing) mix(); },
    setMode: enter,
  };
}
