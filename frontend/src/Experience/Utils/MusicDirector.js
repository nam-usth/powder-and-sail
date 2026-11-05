// ── MusicDirector.js ────────────────────────────────────────────────
// Procedural, adaptive music + ambience for Powder & Sail (Web Audio API).
// Every note is generated at runtime from the ORIGINAL scores in
// data/music.js — no audio files, no borrowed melodies.
//
//   import { music } from './Utils/MusicDirector.js';
//   music.play('harbor');              // ~2 s equal-power crossfade from whatever plays
//   music.ambience('harbor');          // gulls, gentle waves, distant hammering, creaking wood
//   music.play('battle');              // or 'battle_intense'
//   music.setIntensity(0.8);           // 0..1 — more drums/brass as it rises
//   music.play('victory');             // stinger → falls to a calm bed ('defeat' → silence)
//   music.setVolume(0.6); music.mute(true);   // persisted in localStorage 'iow_music'
//
// Autoplay policy: nothing sounds before the first user gesture. The director
// auto-unlocks on the first pointerdown/keydown (or call music.unlock() from
// your own gesture handler). Calls made before that are remembered.
//
// Engine: lookahead scheduler (setTimeout + AudioContext.currentTime) that
// asks a per-track "arranger" for one bar of events at a time; seeded RNG per
// bar/cycle varies ornaments, fills and lead instrument so loops don't repeat.
// Mix: per-instrument channel strips → track fader → master bus (compressor +
// soft clip) with one procedural convolution reverb; output feeds the music bus
// of Audio.js (shared AudioContext, music volume, ducking). Ambience feeds the
// SFX bus. Scheduling stops while the tab is hidden; a voice budget caps CPU.
// Design: design/audio-direction.md

import { audio, noiseBuffer } from './Audio.js';
import { MUSIC_MIX, AMBIENCE_MIX, SCORES, REGIONS } from '../../data/music.js';

/** Track ids accepted by music.play(). 'calm' is the post-victory bed. */
export const MUSIC_TRACKS = Object.freeze(['harbor', 'chart', 'battle', 'battle_intense', 'victory', 'defeat', 'calm']);
/** Ambience kinds accepted by music.ambience(). */
export const AMBIENCE_KINDS = Object.freeze(['harbor', 'sea']);
/** Sea regions accepted by music.setRegion() (data/factions.js SEAS ids). */
export const MUSIC_REGIONS = Object.freeze(Object.keys(REGIONS));

const STINGERS = new Set(['victory', 'defeat']);
const STORAGE_KEY = 'iow_music';
const TAIL_SEC = 3.2;             // reverb/release tail kept alive after a fade-out

// ── Small helpers ───────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (e0, e1, x) => { const k = clamp((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k); };
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Deterministic PRNG (mulberry32) → () => [0,1). */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(...xs) {
  let h = 2166136261;
  for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return h >>> 0;
}

// ── Harmony helpers ─────────────────────────────────────────────────
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7], sus4: [0, 5, 7], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14], 6: [0, 4, 7, 9],
};
const _chords = new Map();
/** Parse 'Bbmaj7', 'G/D', 'Em' … → { sym, root, pcs, bass, third }. */
function chord(sym) {
  let c = _chords.get(sym);
  if (c) return c;
  const [main, slash] = sym.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main);
  const root = PC[m[1]], iv = QUALITY[m[2]] ?? QUALITY[''];
  const pcs = [...new Set(iv.map((x) => (root + x) % 12))];
  c = { sym, root, pcs, bass: slash ? PC[slash] : root, third: (root + iv[1]) % 12 };
  _chords.set(sym, c);
  return c;
}
const pcOf = (m) => ((m % 12) + 12) % 12;
/** Lowest MIDI note ≥ lo with pitch class pc. */
const lowest = (pc, lo) => lo + (((pc - lo) % 12) + 12) % 12;
/** MIDI note with pitch class pc nearest to center, kept inside [lo, hi]. */
function nearest(pc, center, lo, hi) {
  let best = null;
  for (let m = lo; m <= hi; m++) if (pcOf(m) === pc && (best === null || Math.abs(m - center) < Math.abs(best - center))) best = m;
  return best ?? lowest(pc, lo);
}
/** Chord tones in [lo, hi], ascending. */
function tones(c, lo, hi) { const out = []; for (let m = lo; m <= hi; m++) if (c.pcs.includes(pcOf(m))) out.push(m); return out; }
/** Close voicing: n distinct chord tones nearest `center` (the third is always kept). */
function voicing(c, center, n) {
  const cand = tones(c, center - 9, center + 9).sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
  const out = [], used = new Set();
  for (const m of cand) { if (out.length < n && !used.has(pcOf(m))) { out.push(m); used.add(pcOf(m)); } }
  if (n >= 3 && !used.has(c.third)) out[out.length - 1] = nearest(c.third, center, center - 9, center + 9);
  for (const m of cand) if (out.length < n && !out.includes(m)) out.push(m);   // octave doublings
  return out.sort((a, b) => a - b);
}
/** Open voicing for pads: ascending chord tones from `lo`, ≥ `gap` semitones apart, new pitch classes first. */
function spread(c, lo, n, gap = 3) {
  const all = tones(c, lo, lo + 26), out = [], used = new Set();
  let floor = lo;
  while (out.length < n) {
    const fresh = all.find((m) => m >= floor && !used.has(pcOf(m)));
    const m = fresh ?? all.find((x) => x >= floor);
    if (m == null) break;
    out.push(m); used.add(pcOf(m)); floor = m + gap;
  }
  return out;
}
/** Scale adjusted to the chord: a scale tone a semitone away from a foreign chord tone is replaced by it. */
function scaleFor(c, base) {
  return base.map((pc) => {
    for (const t of c.pcs) if (!base.includes(t) && (t === (pc + 1) % 12 || t === (pc + 11) % 12)) return t;
    return pc;
  });
}
/** Next scale tone above (dir=1) or below (dir=-1). */
function stepScale(m, dir, scale) {
  for (let n = m + dir, k = 0; k < 3; k++, n += dir) if (scale.includes(pcOf(n))) return n;
  return m + 2 * dir;
}
function snapScale(m, scale) {
  for (let d = 0; d < 3; d++) { if (scale.includes(pcOf(m - d))) return m - d; if (scale.includes(pcOf(m + d))) return m + d; }
  return m;
}
function snapChord(m, c) {
  for (let d = 0; d < 4; d++) { if (c.pcs.includes(pcOf(m + d))) return m + d; if (c.pcs.includes(pcOf(m - d))) return m - d; }
  return m;
}

// ── Envelopes / fades ───────────────────────────────────────────────
/** ADSR on an AudioParam. Returns the time the release has died away. */
function adsr(p, t, dur, a, d, s, r, peak) {
  const rel = t + Math.max(dur, a + 0.005);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (s < 1) p.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
  p.setTargetAtTime(0, rel, Math.max(0.004, r / 5));
  return rel + r;
}
/** Percussive exponential envelope. */
function perc(p, t, peak, a, d) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, 0.001));
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(a, 0.001) + d);
}

/**
 * Gain fader with equal-power crossfade shapes. Keeps its own model of the
 * ramp so the start value is exact even inside an OfflineAudioContext.
 */
class Fader {
  constructor(param, v = 0) { this.p = param; this.v0 = this.v1 = v; this.t0 = this.t1 = 0; param.value = v; }
  _shape(x, up) { return up ? Math.sin(x * Math.PI / 2) : 1 - Math.cos(x * Math.PI / 2); }
  valueAt(t) {
    if (t >= this.t1) return this.v1;
    if (t <= this.t0) return this.v0;
    const x = (t - this.t0) / (this.t1 - this.t0);
    return this.v0 + (this.v1 - this.v0) * this._shape(x, this.v1 > this.v0);
  }
  to(v, t, dur) {
    const p = this.p, from = this.valueAt(t);
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
    p.setValueAtTime(from, t);
    dur = Math.max(dur, 0.01);
    for (let k = 1; k <= 4; k++) p.linearRampToValueAtTime(from + (v - from) * this._shape(k / 4, v > from), t + dur * k / 4);
    this.v0 = from; this.v1 = v; this.t0 = t; this.t1 = t + dur;
  }
}

// ── Procedural impulse response (stereo hall with damped tail) ───────
function makeImpulse(ctx, { seconds, rt60, preDelay }, seed) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr), rnd = rng32(seed);
  const k = Math.log(1000) / rt60;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = Math.floor(preDelay * sr); i < len; i++) {
      const tt = i / sr - preDelay;
      const coef = 0.7 - 0.62 * Math.min(1, tt / rt60);     // later = darker
      lp += coef * ((rnd() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-k * tt) * Math.min(1, tt / 0.006);
    }
    for (const [ms, a] of [[9, 0.6], [17, 0.42], [23, 0.35], [37, 0.26], [49, 0.2], [61, 0.15], [79, 0.1]]) {
      const i = Math.floor((preDelay + (ms + ch * 1.7) / 1000) * sr);
      if (i < len) d[i] += a * (rnd() < 0.5 ? -1 : 1);
    }
  }
  return buf;
}

function softClipCurve(n = 2048, knee = 0.8) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1, a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

// ── Instrument timbres (period-plausible: no synth pads) ────────────
const WAVES = {
  reed:     [1, 0.75, 0.62, 0.5, 0.42, 0.33, 0.24, 0.18, 0.13, 0.1, 0.07, 0.05, 0.04, 0.03],   // concertina / musette
  whistle:  [1, 0.06, 0.12, 0.02, 0.015],                                                     // tin whistle
  recorder: [1, 0.04, 0.08, 0.012, 0.01],                                                     // recorder (softer, rounder)
  horn:     [1, 0.62, 0.42, 0.28, 0.18, 0.11, 0.07, 0.045, 0.03],                             // natural horn
  oboe:     [0.55, 1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.22, 0.15, 0.1, 0.07, 0.05],              // baroque oboe (nasal)
  shehnai:  [0.7, 1, 0.9, 0.8, 0.65, 0.55, 0.45, 0.36, 0.28, 0.2, 0.15, 0.1],                 // shehnai (piercing double reed)
  dizi:     [1, 0.35, 0.28, 0.12, 0.1, 0.05, 0.03],                                           // dizi (bright bamboo flute)
  danbau:   [1, 0.12, 0.04, 0.015],                                                           // đàn bầu (pure harmonic tone)
};
// Expressive regional leads: envelope, vibrato (cents), glide (s), breath/buzz, plucked decay.
const LEADS = {
  shehnai: { wave: 'shehnai',  a: 0.03,  s: 0.9,  r: 0.10, peak: 0.12,  vib: 22, onset: 0.25, glide: 0.12, breath: 0.03 },
  bansuri: { wave: 'recorder', a: 0.07,  s: 0.9,  r: 0.14, peak: 0.085, vib: 14, onset: 0.3,  glide: 0.16, breath: 0.16 },
  suling:  { wave: 'recorder', a: 0.04,  s: 0.88, r: 0.10, peak: 0.075, vib: 10, onset: 0.25, glide: 0.06, breath: 0.12 },
  dizi:    { wave: 'dizi',     a: 0.03,  s: 0.9,  r: 0.10, peak: 0.075, vib: 16, onset: 0.3,  glide: 0.05, breath: 0.08, buzz: 0.18 },
  danbau:  { wave: 'danbau',   a: 0.008, s: 0.35, r: 0.25, peak: 0.09,  vib: 38, onset: 0.2,  glide: 0.22, bendFrom: -3, pluck: 1.8 },
};
// Karplus–Strong plucked strings: brightness, T60 at 220 Hz, buffer seconds, output gain.
const KS = {
  lute:    { bright: 0.5,  t60: 1.5, sec: 1.4, gain: 0.30 },   // lute / baroque guitar
  cittern: { bright: 0.85, t60: 1.0, sec: 1.0, gain: 0.22 },   // wire-strung, double course
  harp:    { bright: 0.32, t60: 3.0, sec: 2.6, gain: 0.30 },
  theorbo: { bright: 0.22, t60: 2.4, sec: 1.8, gain: 0.55 },   // plucked bass
  tanpura: { bright: 0.95, t60: 4.5, sec: 3.0, gain: 0.24 },   // buzzing drone strings (jawari)
  zheng:   { bright: 0.75, t60: 2.2, sec: 2.0, gain: 0.26 },   // zither (guzheng-like) / santoor-like
};
const KS_RATE = 22050;

/**
 * The band: every instrument is a small voice built from oscillators /
 * buffer sources + envelopes, played into a persistent Channel. Voices
 * disconnect themselves when they end; `dir._alloc` enforces the voice budget.
 */
class Band {
  constructor(dir) { this.dir = dir; this.ctx = dir.ctx; this._waves = {}; this._ks = new Map(); }

  _wave(name) {
    if (!this._waves[name]) {
      const h = WAVES[name], re = new Float32Array(h.length + 1), im = new Float32Array(h.length + 1);
      h.forEach((a, k) => { im[k + 1] = a; });
      this._waves[name] = this.ctx.createPeriodicWave(re, im);
    }
    return this._waves[name];
  }
  _osc(type, f, t, end, det = 0) {
    const o = this.ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.setValueAtTime(f, t);
    if (det) o.detune.value = det;
    o.start(t); o.stop(end);
    return o;
  }
  _noise(t, dur) {
    const s = this.ctx.createBufferSource(), b = noiseBuffer(this.ctx);
    s.buffer = b;
    if (dur > b.duration - 0.05) { s.loop = true; s.start(t, 0); } else s.start(t, this.dir._rng() * (b.duration - dur - 0.02));
    s.stop(t + dur);
    return s;
  }
  _gain(dest, v = 0) { const g = this.ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  _filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _done(src, ...nodes) { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } }; }
  /** Per-voice vibrato depth (cents) fed by one of the director's free-running LFOs. */
  _vibrato(t, dur, cents, onset = 0.35) {
    const lfo = this.dir._vib(), vg = this._gain(null);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(cents, t + Math.min(onset, dur * 0.6) + 0.05);
    lfo.connect(vg);
    return { vg, release: () => { try { lfo.disconnect(vg); } catch (e) { /* gone */ } vg.disconnect(); } };
  }

  /** Karplus–Strong buffer for (kind, midi), generated once and cached. */
  _ksBuf(kind, m) {
    const key = kind + m;
    let e = this._ks.get(key);
    if (e) return e;
    const P = KS[kind], f = mtof(m), sr = KS_RATE;
    const N = Math.max(2, Math.floor(sr / f - 0.5));
    const fAct = sr / (N + 0.5);
    const t60 = P.t60 * Math.pow(220 / f, 0.4);
    const rho = Math.pow(0.001, 1 / (f * t60));
    const len = Math.floor(sr * P.sec);
    const buf = this.ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
    const ring = new Float32Array(N), rnd = this.dir._rng;
    let lp = 0, mean = 0, pk = 0;
    for (let i = 0; i < N; i++) { lp += P.bright * ((rnd() * 2 - 1) - lp); ring[i] = lp; mean += lp; }
    mean /= N;
    for (let i = 0; i < N; i++) { ring[i] -= mean; pk = Math.max(pk, Math.abs(ring[i])); }
    for (let i = 0; i < N; i++) ring[i] /= pk || 1;
    for (let i = 0, j = 0; i < len; i++) {
      const nx = j + 1 === N ? 0 : j + 1, cur = ring[j];
      out[i] = cur;
      ring[j] = rho * 0.5 * (cur + ring[nx]);
      j = nx;
    }
    const rate = f / fAct;
    e = { buf, rate, len: P.sec / rate };
    this._ks.set(key, e);
    return e;
  }

  // ── Plucked strings ────────────────────────────────────────────
  pluck(ch, t, m, vel = 0.8, kind = 'lute', o = {}) {
    const e = this._ksBuf(kind, m), len = Math.min(o.dur ?? e.len, e.len), end = t + len;
    if (!this.dir._alloc(1, t, end, o.prio ?? 1)) return;
    const s = this.ctx.createBufferSource();
    s.buffer = e.buf;
    s.playbackRate.value = e.rate * (o.detune ? Math.pow(2, o.detune / 1200) : 1);
    const g = this._gain(ch.input), pk = vel * KS[kind].gain;
    g.gain.setValueAtTime(pk, t);
    if (len < e.len) { g.gain.setValueAtTime(pk, Math.max(t, end - 0.08)); g.gain.linearRampToValueAtTime(0, end); }
    s.connect(g); s.start(t); s.stop(end + 0.01);
    this._done(s, g);
  }
  strum(ch, t, notes, vel, up, dur, kind = 'lute', prio) {
    const ns = up ? [...notes].reverse() : notes;
    ns.forEach((m, k) => this.pluck(ch, t + k * (up ? 0.008 : 0.012), m, vel * (1 - k * 0.05), kind, { dur, prio: prio ?? (up ? 0 : 1) }));
  }
  /** Baroque-guitar rasgueado: a four-finger flourish into a full strum (Spanish colour). */
  rasgueado(ch, t, notes, vel, dur) {
    for (let k = 0; k < 4; k++) this.strum(ch, t + k * 0.024, notes, vel * (0.3 + k * 0.1), k % 2 === 1, 0.16, 'lute', 0);
    this.strum(ch, t + 0.1, notes, vel, false, dur, 'lute', 1);
  }
  /** Cittern: tremolo-picked double course. */
  cittern(ch, t, m, dur, vel, sd) {
    const n = Math.max(1, Math.round(dur / (sd * 0.5)));
    for (let k = 0; k < n; k++) {
      const tt = t + k * sd * 0.5, v = vel * (k ? 0.6 : 0.9) * (k % 2 ? 0.85 : 1);
      this.pluck(ch, tt, m, v, 'cittern', { dur: sd * 0.7, prio: k ? 0 : 3 });
      this.pluck(ch, tt + 0.006, m, v * 0.7, 'cittern', { dur: sd * 0.7, detune: 6, prio: 0 });
    }
  }

  // ── Bowed / blown ──────────────────────────────────────────────
  /** Concertina / musette: two reeds 12 cents apart (beating). */
  reed(ch, t, m, dur, vel = 0.7, o = {}) {
    const r = o.r ?? 0.16, end = t + dur + r + 0.05, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 1)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, o.a ?? 0.05, 0.25, 0.8, r, vel * 0.075);
    const w = this._wave('reed');
    let last;
    for (const det of [-6, 6]) { const s = this._osc(w, f, t, end, det); s.connect(g); last = s; }
    this._done(last, g);
  }
  /** Hurdy-gurdy drone string: steady wheel-bowed saw (the channel adds body + wheel wobble). */
  gurdy(ch, t, m, dur, vel = 0.6, o = {}) {
    const r = o.r ?? 0.35, end = t + dur + r + 0.05, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 2)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, o.a ?? 0.25, 0.3, 0.95, r, vel * 0.05);
    let last;
    for (const det of [0, 4]) { const s = this._osc('sawtooth', f, t, end, det); s.connect(g); last = s; }
    this._done(last, g);
  }
  /** Hurdy-gurdy trompette buzz: the rattling "chien" kicked on the beat by the wheel hand. */
  buzz(ch, t, m, vel = 0.5, dur = 0.14) {
    const end = t + dur + 0.05;
    if (!this.dir._alloc(2, t, end, 1)) return;
    const s = this._osc('sawtooth', mtof(m), t, end);
    const am = this._gain(null, 0.5), lfo = this._osc('square', 52 + this.dir._rng() * 8, t, end), lg = this._gain(am.gain, 0.5);
    lfo.connect(lg);
    const bp = this._filter('bandpass', 2300, 1.3), g = this._gain(ch.input);
    perc(g.gain, t, vel * 0.12, 0.008, dur);
    s.connect(am); am.connect(bp); bp.connect(g);
    this._done(s, am, lg, bp, g);
  }
  /** Fiddle (also the hurdy-gurdy chanter with vib 0): two bowed saws, bow attack, delayed vibrato, grace notes. */
  fiddle(ch, t, m, dur, vel = 0.8, o = {}) {
    const end = t + dur + 0.2, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, o.a ?? 0.045, 0.2, 0.82, 0.14, vel * 0.06);
    const v = (o.vib ?? 16) > 0 ? this._vibrato(t, dur, o.vib ?? 16, 0.4) : null;
    let last;
    for (const det of [-4, 5]) {
      const s = this._osc('sawtooth', o.grace ? mtof(o.grace) : f, t, end, det);
      if (o.grace) s.frequency.setValueAtTime(f, t + 0.055);
      if (v) v.vg.connect(s.detune);
      s.connect(g); last = s;
    }
    last.onended = () => { v?.release(); g.disconnect(); };
  }
  /** Violin section (battle tune / stingers): three saws, independent-ish vibrato. */
  violins(ch, t, m, dur, vel = 0.8, o = {}) {
    const end = t + dur + 0.2, f = mtof(m);
    if (!this.dir._alloc(3, t, end, o.prio ?? 3)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, o.a ?? 0.05, 0.25, 0.85, 0.16, vel * 0.04);
    const vs = [];
    let last;
    for (const det of [-9, 2, 11]) {
      const v = this._vibrato(t, dur, o.vib ?? 13, 0.3);
      const s = this._osc('sawtooth', o.grace ? mtof(o.grace) : f, t, end, det);
      if (o.grace) s.frequency.setValueAtTime(f, t + 0.05);
      v.vg.connect(s.detune); s.connect(g); vs.push(v); last = s;
    }
    last.onended = () => { vs.forEach((v) => v.release()); g.disconnect(); };
  }
  /** Baroque oboe: nasal double reed doubling the violins. */
  oboe(ch, t, m, dur, vel = 0.7, o = {}) {
    const end = t + dur + 0.12, f = mtof(m);
    if (!this.dir._alloc(1, t, end, o.prio ?? 2)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, 0.03, 0.2, 0.88, 0.09, vel * 0.06);
    const v = this._vibrato(t, dur, 9, 0.4);
    const s = this._osc(this._wave('oboe'), f, t, end);
    v.vg.connect(s.detune); s.connect(g);
    s.onended = () => { v.release(); g.disconnect(); };
  }
  /** Tin whistle: near-sine with a breathy chiff (played an octave up by the arrangers). */
  whistle(ch, t, m, dur, vel = 0.8, o = {}) {
    const end = t + dur + 0.15, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, 0.025, 0.15, 0.85, 0.09, vel * 0.11);
    const s = this._osc(this._wave('whistle'), o.grace ? mtof(o.grace) : f, t, end);
    if (o.grace) s.frequency.setValueAtTime(f, t + 0.045);
    const v = this._vibrato(t, dur, 11, 0.4);
    v.vg.connect(s.detune);
    s.connect(g);
    const n = this._noise(t, 0.06), bp = this._filter('bandpass', f * 2, 3), ng = this._gain(ch.input);
    perc(ng.gain, t, vel * 0.02, 0.004, 0.05);
    n.connect(bp); bp.connect(ng);
    s.onended = () => { v.release(); g.disconnect(); bp.disconnect(); ng.disconnect(); };
  }
  /** Recorder: rounder and breathier than the whistle; plays at written pitch. */
  recorder(ch, t, m, dur, vel = 0.7, o = {}) {
    const end = t + dur + 0.12, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, 0.04, 0.2, 0.9, 0.08, vel * 0.12);
    const s = this._osc(this._wave('recorder'), o.grace ? mtof(o.grace) : f, t, end);
    if (o.grace) s.frequency.setValueAtTime(f, t + 0.05);
    s.connect(g);
    const n = this._noise(t, dur + 0.1), bp = this._filter('bandpass', f, 5), ng = this._gain(g, 0.12);
    n.connect(bp); bp.connect(ng);
    const c = this._noise(t, 0.05), cb = this._filter('bandpass', f * 3, 2), cg = this._gain(ch.input);
    perc(cg.gain, t, vel * 0.025, 0.004, 0.04);
    c.connect(cb); cb.connect(cg);
    this._done(s, g, bp, ng, cb, cg);
  }
  /** Natural trumpet: bright brass, lip-up into the note, snapping filter. */
  trumpet(ch, t, m, dur, vel = 0.8, o = {}) {
    const end = t + dur + 0.16, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const lp = this._filter('lowpass', 500, 1.0);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(900 + 4200 * vel, t + 0.035);
    lp.frequency.setTargetAtTime(700 + 2300 * vel, t + 0.04, 0.2);
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, 0.018, 0.15, 0.75, 0.1, vel * 0.055);
    let last;
    for (const det of [-4, 4]) {
      const s = this._osc('sawtooth', f * 0.977, t, end, det);
      s.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      s.connect(lp); last = s;
    }
    lp.connect(g);
    this._done(last, lp, g);
  }
  /** Trumpets & horns stab (open fifths, as natural brass plays in minor keys). */
  trumpets(ch, t, notes, dur, vel, o = {}) { for (const m of notes) this.trumpet(ch, t, m, dur, vel, { prio: o.prio ?? 2 }); }
  /** Natural horn: mellow, distant calls. */
  horn(ch, t, m, dur, vel = 0.8, o = {}) {
    const r = o.r ?? 0.18, end = t + dur + r + 0.05, f = mtof(m), a = o.a ?? 0.06;
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const lp = this._filter('lowpass', 380, 0.9);
    lp.frequency.setValueAtTime(380, t);
    lp.frequency.linearRampToValueAtTime(700 + 1700 * vel, t + a + 0.04);
    lp.frequency.setTargetAtTime(600 + 900 * vel, t + a + 0.05, 0.25);
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, a, 0.3, 0.85, r, vel * 0.1);
    const s1 = this._osc(this._wave('horn'), f * 0.99, t, end);
    s1.frequency.linearRampToValueAtTime(f, t + 0.04);
    const s2 = this._osc('sawtooth', f, t, end, 5);
    const sg = this._gain(lp, 0.35);
    s1.connect(lp); s2.connect(sg); lp.connect(g);
    this._done(s1, lp, g, sg);
  }
  /** Cellos + violone ostinato: spiccato with a bright bite (`o.sustain` for held bass notes). */
  lowStr(ch, t, m, dur, vel = 0.8, o = {}) {
    const end = t + dur + 0.14, f = mtof(m), sub = m >= 40;
    if (!this.dir._alloc(sub ? 3 : 2, t, end, o.prio ?? 2)) return;
    const lp = this._filter('lowpass', 2600, 0.8);
    lp.frequency.setValueAtTime(2800, t);
    lp.frequency.exponentialRampToValueAtTime(o.sustain ? 1200 : 850, t + 0.12);
    const g = this._gain(ch.input);
    if (o.sustain) adsr(g.gain, t, dur, 0.06, 0.3, 0.85, 0.3, vel * 0.07);
    else adsr(g.gain, t, dur, 0.008, 0.1, 0.5, 0.08, vel * 0.07);
    let last;
    for (const det of [-7, 8]) { const s = this._osc('sawtooth', f, t, end, det); s.connect(lp); last = s; }
    if (sub) { const s = this._osc('sawtooth', f / 2, t, end); const sg = this._gain(lp, 0.6); s.connect(sg); }
    lp.connect(g);
    this._done(last, lp, g);
  }
  /** Sustained strings / viol consort, with gentle per-voice vibrato. */
  strPad(ch, t, m, dur, vel = 0.5, o = {}) {
    const r = o.r ?? 0.6, end = t + dur + r + 0.05, f = mtof(m);
    if (!this.dir._alloc(2, t, end, o.prio ?? 1)) return;
    const g = this._gain(ch.input);
    adsr(g.gain, t, dur, o.a ?? 0.3, 0.6, 0.9, r, vel * 0.035);
    const vs = [];
    let last;
    for (const det of [-9, 9]) {
      const v = this._vibrato(t, dur, 7, 0.5);
      const s = this._osc('sawtooth', f, t, end, det);
      v.vg.connect(s.detune); s.connect(g); vs.push(v); last = s;
    }
    last.onended = () => { vs.forEach((v) => v.release()); g.disconnect(); };
  }

  // ── Percussion ─────────────────────────────────────────────────
  /** Bodhrán / frame drum: 'doom' = centre stroke, 'tak' = rim. */
  frame(ch, t, kind, vel = 0.7) {
    if (!this.dir._alloc(2, t, t + 0.5, 2)) return;
    if (kind === 'doom') {
      const s = this._osc('sine', 125, t, t + 0.5);
      s.frequency.exponentialRampToValueAtTime(70, t + 0.12);
      const g = this._gain(ch.input); perc(g.gain, t, vel * 0.5, 0.004, 0.42); s.connect(g);
      const n = this._noise(t, 0.08), lp = this._filter('lowpass', 380), ng = this._gain(ch.input);
      perc(ng.gain, t, vel * 0.22, 0.002, 0.05); n.connect(lp); lp.connect(ng);
      this._done(s, g, lp, ng);
    } else {
      const n = this._noise(t, 0.1), bp = this._filter('bandpass', 1900, 1.3), g = this._gain(ch.input);
      perc(g.gain, t, vel * 0.32, 0.001, 0.07); n.connect(bp); bp.connect(g);
      const s = this._osc('sine', 360, t, t + 0.08), sg = this._gain(ch.input);
      perc(sg.gain, t, vel * 0.1, 0.001, 0.05); s.connect(sg);
      this._done(n, bp, g, sg);
    }
  }
  /** Maracas (Caribbean). */
  shaker(ch, t, vel = 0.5) {
    if (!this.dir._alloc(1, t, t + 0.1, 0)) return;
    const n = this._noise(t, 0.1), g = this._gain(ch.input);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.12, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(g);
    this._done(n, g);
  }
  /** Castanets: a hard double click (hi = hembra, lo = macho). */
  castanets(ch, t, vel = 0.7, hi = true) {
    if (!this.dir._alloc(2, t, t + 0.05, 1)) return;
    const n = this._noise(t, 0.03), bp = this._filter('bandpass', hi ? 3300 : 2500, 3.5), g = this._gain(ch.input);
    perc(g.gain, t, vel * 0.55, 0.0008, 0.018); n.connect(bp); bp.connect(g);
    const s = this._osc('sine', hi ? 2900 : 2250, t, t + 0.04), sg = this._gain(ch.input);
    perc(sg.gain, t, vel * 0.09, 0.0008, 0.025); s.connect(sg);
    this._done(n, bp, g, sg);
  }
  /** Castanet roll ("ria"): four quick clicks leading into the next accent. */
  castRoll(ch, t, vel = 0.5) {
    for (let k = 0; k < 4; k++) this.castanets(ch, t + k * 0.027, vel * (0.45 + k * 0.12), k % 2 === 0);
  }
  /** Field drums: 'bass' (rope-tension bass drum), 'tenor' (snares off), 'muffled' (cloth-covered, funeral). */
  drum(ch, t, vel = 0.8, kind = 'bass') {
    if (!this.dir._alloc(2, t, t + 0.7, 2)) return;
    if (kind === 'bass') {
      const s = this._osc('sine', 72, t, t + 0.7);
      s.frequency.exponentialRampToValueAtTime(47, t + 0.12);
      const g = this._gain(ch.input); perc(g.gain, t, vel * 0.7, 0.003, 0.55); s.connect(g);
      const n = this._noise(t, 0.2), lp = this._filter('lowpass', 900), ng = this._gain(ch.input);
      perc(ng.gain, t, vel * 0.3, 0.002, 0.06); n.connect(lp); lp.connect(ng);
      const sh = this._filter('bandpass', 180, 2), sg = this._gain(ch.input);
      perc(sg.gain, t, vel * 0.25, 0.002, 0.15); n.connect(sh); sh.connect(sg);
      this._done(s, g, lp, ng, sh, sg);
    } else {
      const muff = kind === 'muffled';
      const s = this._osc('sine', muff ? 130 : 155, t, t + 0.4);
      s.frequency.exponentialRampToValueAtTime(muff ? 110 : 128, t + 0.08);
      const g = this._gain(ch.input); perc(g.gain, t, vel * 0.45, 0.002, muff ? 0.22 : 0.32); s.connect(g);
      const n = this._noise(t, 0.2), f = this._filter(muff ? 'lowpass' : 'bandpass', muff ? 600 : 950, muff ? 0.7 : 1.2), ng = this._gain(ch.input);
      perc(ng.gain, t, vel * 0.25, 0.002, muff ? 0.08 : 0.12); n.connect(f); f.connect(ng);
      this._done(s, g, f, ng);
    }
  }
  /** Kettledrums (tuned; baroque pairs on tonic and dominant). */
  timp(ch, t, m, vel = 0.8, light = false) {
    const f = mtof(m), parts = light ? [[1, 1, 1.4], [1.5, 0.4, 0.8]] : [[1, 1, 1.7], [1.5, 0.45, 1.0], [1.98, 0.3, 0.7], [2.44, 0.15, 0.45]];
    if (!this.dir._alloc(parts.length, t, t + 1.8, 2)) return;
    let last;
    const outs = [];
    for (const [ratio, amp, dec] of parts) {
      const s = this._osc('sine', f * ratio * 1.015, t, t + dec + 0.05);
      s.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.08);
      const g = this._gain(ch.input); perc(g.gain, t, vel * 0.24 * amp, 0.004, dec); s.connect(g);
      outs.push(g); last = s;
    }
    if (!light) {
      const n = this._noise(t, 0.05), lp = this._filter('lowpass', 900), ng = this._gain(ch.input);
      perc(ng.gain, t, vel * 0.12, 0.001, 0.03); n.connect(lp); lp.connect(ng); outs.push(lp, ng);
    }
    this._done(last, ...outs);
  }
  timpRoll(ch, t, m, dur, v0 = 0.2, v1 = 0.8) {
    const gap = 0.058, n = Math.max(2, Math.floor(dur / gap));
    for (let k = 0; k < n; k++) this.timp(ch, t + k * gap + (k % 2) * 0.004, m, v0 + (v1 - v0) * (k / (n - 1)), true);
  }
  /** Side drum (snares on). */
  snare(ch, t, vel = 0.5) {
    if (!this.dir._alloc(2, t, t + 0.18, 1)) return;
    const n = this._noise(t, 0.18), bp = this._filter('bandpass', 2800, 0.8), g = this._gain(ch.input);
    perc(g.gain, t, vel * 0.3, 0.001, 0.14); n.connect(bp); bp.connect(g);
    const s = this._osc('triangle', 195, t, t + 0.09); s.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    const sg = this._gain(ch.input); perc(sg.gain, t, vel * 0.12, 0.001, 0.06); s.connect(sg);
    this._done(n, bp, g, sg);
  }
  /** Side-drum roll: one noise source gated into strokes (cheap). */
  snareRoll(ch, t, dur, v0 = 0.1, v1 = 0.6) {
    if (!this.dir._alloc(1, t, t + dur + 0.1, 1)) return;
    const n = this._noise(t, dur + 0.1), bp = this._filter('bandpass', 2900, 0.8), g = this._gain(ch.input);
    const gap = 0.045, k = Math.max(2, Math.floor(dur / gap));
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < k; i++) {
      const tt = t + i * gap, v = (v0 + (v1 - v0) * i / (k - 1)) * (i % 2 ? 0.8 : 1);
      g.gain.setValueAtTime(v * 0.3, tt);
      g.gain.setTargetAtTime(0.0001, tt + 0.002, 0.012);
    }
    n.connect(bp); bp.connect(g);
    this._done(n, bp, g);
  }
  /** A ship's bell struck in the distance (bronze-bell partials). */
  shipBell(ch, t, f, vel = 0.5) {
    const parts = [[0.5, 0.35, 3.5], [1, 0.55, 2.8], [1.19, 0.4, 2.2], [1.5, 0.22, 1.5], [2, 0.6, 2.0], [2.52, 0.22, 1.1], [3.01, 0.16, 0.8], [4.17, 0.08, 0.5]];
    if (!this.dir._alloc(parts.length, t, t + 3.5, 1)) return;
    for (const [ratio, a, d] of parts) {
      const s = this._osc('sine', f * ratio, t, t + d + 0.05), g = this._gain(ch.input);
      perc(g.gain, t, vel * 0.1 * a, 0.002, d); s.connect(g);
      this._done(s, g);
    }
  }

  // ── Regional colours (music.setRegion) ─────────────────────────
  /** Expressive lead with meend/glides and deep vibrato: shehnai, bansuri, suling, dizi, đàn bầu. */
  glide(ch, t, m, dur, vel, kind, o = {}) {
    const L = LEADS[kind], f = mtof(m), end = t + dur + L.r + 0.06;
    if (!this.dir._alloc(2, t, end, o.prio ?? 3)) return;
    const g = this._gain(ch.input), pk = vel * L.peak;
    if (L.pluck) {   // plucked, then a singing decay (đàn bầu)
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(pk, t + L.a);
      g.gain.setTargetAtTime(pk * L.s, t + L.a, L.pluck / 4);
      g.gain.setTargetAtTime(0, t + Math.max(dur, L.a + 0.01), L.r / 5);
    } else adsr(g.gain, t, dur, L.a, 0.2, L.s, L.r, pk);
    const s = this._osc(this._wave(L.wave), f, t, end);
    const from = o.from ?? (L.bendFrom ? m + L.bendFrom : null);
    if (o.grace) { s.frequency.setValueAtTime(mtof(o.grace), t); s.frequency.setValueAtTime(f, t + 0.05); }
    else if (from != null && from !== m && dur > 0.12) {
      s.frequency.setValueAtTime(mtof(from), t);
      s.frequency.exponentialRampToValueAtTime(f, t + Math.min(L.glide, dur * 0.4));
    }
    if (kind === 'danbau' && dur > 0.6 && this.dir._rng() < 0.5) {   // the rod pushes the note up and lets it fall back
      s.frequency.setValueAtTime(f, t + dur * 0.55);
      s.frequency.linearRampToValueAtTime(f * 1.06, t + dur * 0.7);
      s.frequency.linearRampToValueAtTime(f, t + dur * 0.9);
    }
    const v = dur > 0.25 ? this._vibrato(t, dur, L.vib, L.onset) : null;
    if (v) v.vg.connect(s.detune);
    s.connect(g);
    const extra = [g];
    if (L.breath) {
      const n = this._noise(t, dur + 0.1), bp = this._filter('bandpass', f * 1.5, 3), ng = this._gain(g, L.breath);
      n.connect(bp); bp.connect(ng); extra.push(bp, ng);
    }
    if (L.buzz) {   // dizi membrane: a thin buzzy edge on the tone
      const z = this._osc('sawtooth', f, t, end), zb = this._filter('bandpass', Math.min(9000, f * 4), 6), zg = this._gain(g, L.buzz);
      if (v) v.vg.connect(z.detune);
      z.connect(zb); zb.connect(zg); extra.push(zb, zg);
    }
    if (L.pluck) {
      const n = this._noise(t, 0.03), bp = this._filter('bandpass', f * 2, 2), ng = this._gain(ch.input);
      perc(ng.gain, t, vel * 0.04, 0.001, 0.025); n.connect(bp); bp.connect(ng); extra.push(bp, ng);
    }
    s.onended = () => { v?.release(); for (const n of extra) { try { n.disconnect(); } catch (e) { /* gone */ } } };
  }
  /** Tabla-like / kendang-like hand drum strokes. `tune` = dayan pitch (MIDI). */
  hand(ch, t, stroke, vel = 0.7, tune = 64) {
    if (!this.dir._alloc(3, t, t + 0.8, 2)) return;
    const c = ch.input;
    if (stroke === 'ghe' || stroke === 'dha') {   // bass head, pitch pushed up by the palm
      const s = this._osc('sine', 92, t, t + 0.6);
      s.frequency.exponentialRampToValueAtTime(135, t + 0.18);
      s.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      const g = this._gain(c); perc(g.gain, t, vel * 0.5, 0.004, 0.5); s.connect(g);
      this._done(s, g);
    }
    if (stroke === 'na' || stroke === 'dha' || stroke === 'tin') {   // ringing treble head (harmonic partials)
      const f = mtof(tune), open = stroke === 'tin';
      const parts = [[1, 1, open ? 0.7 : 0.45], [2, 0.5, 0.3], [3, 0.32, 0.2], [4, 0.18, 0.12]];
      let last;
      const gs = [];
      for (const [k, a, d] of parts) {
        const s = this._osc('sine', f * k, t, t + d + 0.05), g = this._gain(c);
        perc(g.gain, t, vel * 0.16 * a * (open ? 0.8 : 1), 0.001, d); s.connect(g); gs.push(g); last = s;
      }
      this._done(last, ...gs);
    }
    if (stroke === 'ta' || stroke === 'te' || stroke === 'na') {   // dry slap / rim click
      const n = this._noise(t, 0.05), bp = this._filter('bandpass', stroke === 'te' ? 1100 : 2600, 1.5), g = this._gain(c);
      perc(g.gain, t, vel * (stroke === 'na' ? 0.12 : 0.3), 0.001, stroke === 'te' ? 0.03 : 0.04); n.connect(bp); bp.connect(g);
      this._done(n, bp, g);
    }
  }
  /** Gamelan metallophone: 'saron' (bar) or 'bonang' (kettle gong), with ombak beating. */
  metal(ch, t, m, vel = 0.7, kind = 'saron') {
    const f = mtof(m), parts = kind === 'saron' ? [[1, 1, 1.3], [1.006, 0.6, 1.3], [2.76, 0.28, 0.4], [5.4, 0.1, 0.15]]
                                                : [[1, 1, 0.9], [1.005, 0.6, 0.9], [1.98, 0.4, 0.45], [4.1, 0.12, 0.15]];
    if (!this.dir._alloc(parts.length, t, t + 1.4, 1)) return;
    let last;
    const gs = [];
    for (const [k, a, d] of parts) {
      const s = this._osc('sine', f * k, t, t + d + 0.05), g = this._gain(ch.input);
      perc(g.gain, t, vel * 0.09 * a, 0.002, d); s.connect(g); gs.push(g); last = s;
    }
    this._done(last, ...gs);
  }
  /** Gongs: 'ageng' (great gamelan gong), 'kempul', 'luo' (Chinese, falling pitch), 'xiaoluo' (small, rising). */
  gong(ch, t, kind = 'ageng', vel = 0.8) {
    const G = {
      ageng:   { f: 55,  parts: [[1, 1, 5], [1.004, 0.8, 5], [2.02, 0.4, 2.5], [2.92, 0.25, 1.5], [4.1, 0.1, 0.8]], bend: 1 },
      kempul:  { f: 196, parts: [[1, 1, 2.2], [1.005, 0.7, 2.2], [2.1, 0.3, 0.9], [3.3, 0.12, 0.4]], bend: 1 },
      luo:     { f: 180, parts: [[1, 1, 2.4], [1.52, 0.5, 1.6], [2.35, 0.35, 1.2], [3.6, 0.2, 0.8]], bend: 0.83, wash: 1 },
      xiaoluo: { f: 620, parts: [[1, 1, 0.7], [1.48, 0.4, 0.4], [2.6, 0.2, 0.25]], bend: 1.12 },
    }[kind];
    const long = Math.max(...G.parts.map((q) => q[2]));
    if (!this.dir._alloc(G.parts.length + (G.wash ? 1 : 0), t, t + long, 2)) return;
    let last;
    const gs = [];
    for (const [k, a, d] of G.parts) {
      const s = this._osc('sine', G.f * k, t, t + d + 0.05);
      if (G.bend !== 1) s.frequency.exponentialRampToValueAtTime(G.f * k * G.bend, t + (G.bend < 1 ? 0.6 : 0.15));
      const g = this._gain(ch.input);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vel * 0.2 * a, t + (kind === 'ageng' ? 0.03 : 0.005));
      g.gain.setTargetAtTime(0, t + 0.04, d / 5);
      s.connect(g); gs.push(g); last = s;
    }
    if (G.wash) {   // tam-tam shimmer
      const n = this._noise(t, 2.0), hp = this._filter('highpass', 900, 0.7), g = this._gain(ch.input);
      perc(g.gain, t, vel * 0.06, 0.05, 1.8); n.connect(hp); hp.connect(g); gs.push(hp, g);
    }
    this._done(last, ...gs);
  }
  /** Woodblock (bangzi-like click). */
  woodblock(ch, t, vel = 0.6, hi = true) {
    if (!this.dir._alloc(2, t, t + 0.08, 1)) return;
    const s = this._osc('sine', hi ? 1500 : 1050, t, t + 0.08), g = this._gain(ch.input);
    perc(g.gain, t, vel * 0.22, 0.001, 0.06); s.connect(g);
    const n = this._noise(t, 0.02), bp = this._filter('bandpass', hi ? 3000 : 2200, 2), ng = this._gain(ch.input);
    perc(ng.gain, t, vel * 0.1, 0.001, 0.012); n.connect(bp); bp.connect(ng);
    this._done(s, g, bp, ng);
  }
  /** Bo — small Chinese cymbals: bright, short crash. */
  bo(ch, t, vel = 0.6) {
    if (!this.dir._alloc(1, t, t + 0.5, 1)) return;
    const n = this._noise(t, 0.5), bp = this._filter('bandpass', 4200, 0.6), g = this._gain(ch.input);
    perc(g.gain, t, vel * 0.22, 0.002, 0.4); n.connect(bp); bp.connect(g);
    this._done(n, bp, g);
  }
}
// ── Channel strip (persistent per track) ────────────────────────────
class Channel {
  constructor(dir, name, out, sendOut, cfg) {
    const c = dir.ctx;
    this.nodes = []; this.oscs = [];
    this.input = c.createGain();
    this.nodes.push(this.input);
    let n = this.input;
    const add = (node) => { n.connect(node); this.nodes.push(node); n = node; return node; };
    const biq = (type, f, q, g = 0) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return add(b); };
    if (cfg.hp) biq('highpass', cfg.hp, 0.7);
    if (cfg.lp) this.lp = biq('lowpass', cfg.lp, 0.7);
    if (cfg.peak) biq('peaking', cfg.peak[0], cfg.peak[2] ?? 1, cfg.peak[1]);
    this.base = (cfg.gain ?? 1) * (dir._solo && !dir._solo.includes(name) ? 0 : 1);
    this.level = add(c.createGain());
    this.level.gain.value = this.base;
    if (cfg.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = cfg.pan; add(p); }
    n.connect(out);
    if (cfg.send) { this.send = c.createGain(); this.send.gain.value = cfg.send; n.connect(this.send); this.send.connect(sendOut); this.nodes.push(this.send); }
    const lfo = (rate, depth, param) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = rate; g.gain.value = depth;
      o.connect(g); g.connect(param); o.start();
      this.oscs.push(o); this.nodes.push(g);
    };
    if (cfg.trem) lfo(cfg.trem[0], cfg.trem[1] * this.base, this.level.gain);
  }
  /** Smoothly set the layer level (0..1 of the channel's base gain). */
  set(v, t) { this.level.gain.setTargetAtTime(this.base * v, t, 0.4); }
  dispose() {
    for (const o of this.oscs) { try { o.stop(); } catch (e) { /* stopped */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
  }
}

// ── Melody helpers ──────────────────────────────────────────────────
/** Seeded folk-style variation: passing notes, rolls, grace notes. Keeps bar length. */
function varyBar(bar, rnd, scale, amt) {
  const out = [];
  for (let k = 0; k < bar.length; k++) {
    const [m, len] = bar[k], nx = bar[k + 1];
    if (m > 0 && len === 2 && nx && nx[0] > 0 && nx[1] === 1 && Math.abs(nx[0] - m) >= 3 && rnd() < amt * 0.4) {
      out.push([m, 1, 0], [stepScale(m, nx[0] > m ? 1 : -1, scale), 1, 0]);
      continue;
    }
    if (m > 0 && len === 3 && rnd() < amt * 0.22) {
      out.push([m, 1, 0], [stepScale(m, 1, scale), 1, 0], [m, 1, 0]);
      continue;
    }
    out.push([m, len, m > 0 && len >= 2 && rnd() < amt * 0.3 ? stepScale(m, 1, scale) : 0]);
  }
  return out;
}
/**
 * Schedule one bar of melody through `play(t, midi, durSec, vel, grace, prevMidi)`.
 * `o.map` re-maps pitches (regional scales); `o.tr` transposes.
 */
function playMelody(p, x, bar, play, scale, vary, o = {}) {
  const notes = vary ? varyBar(bar, x.rng, scale, vary) : bar.map(([m, l]) => [m, l, 0]);
  let s = 0, prev = p.mem.lastNote ?? null;
  for (const [m0, len, g0] of notes) {
    if (m0 > 0) {
      const m = (o.map ? o.map(m0) : m0) + (o.tr || 0);
      const grace = g0 ? (o.map ? o.map(g0) : g0) + (o.tr || 0) : 0;
      const strong = s % p.beatSteps === 0;
      const vel = (o.vel ?? 0.85) * (strong ? 1 : 0.84) * (0.93 + x.rng() * 0.1);
      const d = len * p.stepDur * (o.legato ?? 0.93), from = prev;
      p.at(s, (t) => play(t + 0.004, m, d, vel, grace, from));
      prev = m;
    }
    s += len;
  }
  p.mem.lastNote = prev;
}
const jitter = (rnd, ms = 6) => (rnd() - 0.5) * ms / 500;
/** A short phrase from a motif bank, snapped to the scale (and to chord tones on strong beats). */
function phrase(p, x, motifs, scale, c, play, start = 0, up = 0) {
  const r = x.rng, mot = motifs[Math.floor(r() * motifs.length)];
  let s = start, prev = p.mem.lastNote ?? null;
  for (const [m0, len] of mot) {
    let m = snapScale(m0 + up, scale);
    if (s % 4 === 0) { const sc = snapChord(m, c); if (scale.includes(pcOf(sc))) m = sc; }
    const vel = 0.6 + r() * 0.2, d = len * p.stepDur * 0.95, from = prev;
    p.at(s, (t) => play(t, m, d, vel, from));
    prev = m; s += len;
  }
  p.mem.lastNote = prev;
}

// ── Arrangers: one bar of events at a time ─────────────────────────
const ARRANGERS = {
  harbor: {
    form: (p, cycle) => [...(cycle === 0 ? ['intro'] : []), 'A', 'A2', 'B', 'A3', cycle % 2 ? 'rest' : 'inter'],
    bar(p, x) {
      const { b, ch, score: S } = p, sd = p.stepDur, r = x.rng, c = x.chord, sec = x.sec;
      const sparse = sec === 'intro' || sec === 'inter' || sec === 'rest';
      const full = sec === 'B' || sec === 'A3' || (sec === 'A2' && x.cycle > 0);
      const lead = S.plan[x.cycle % S.plan.length][sec];
      const scale = scaleFor(c, S.scale);

      // Theorbo bass: root on 1, fifth on 4, a walking approach into the next chord.
      if (!(sec === 'intro' && x.secBar === 0)) {
        const root = lowest(c.bass, 38);
        let pc2 = (c.root + 7) % 12;
        if (pc2 === c.bass) pc2 = c.root;
        let n2 = lowest(pc2, root + 1);
        if (n2 - root > 9) n2 -= 12;
        const approach = !sparse && x.next && x.next.bass !== c.bass && r() < 0.4;
        p.at(0, (t) => b.pluck(ch.bass, t, root, 0.9, 'theorbo', { dur: sd * 2.8, prio: 2 }));
        p.at(3, (t) => b.pluck(ch.bass, t, n2, 0.68, 'theorbo', { dur: sd * (approach ? 1.8 : 2.8), prio: 2 }));
        if (approach) {
          const ap = stepScale(lowest(x.next.bass, 38), r() < 0.6 ? -1 : 1, scale);
          p.at(5, (t) => b.pluck(ch.bass, t, ap, 0.55, 'theorbo', { dur: sd * 0.95 }));
        }
      }
      // Hurdy-gurdy: D–A drones held through each tune section, trompette buzz on the beat.
      if (!sparse) {
        if (x.secBar === 0) {
          const v = sec === 'B' ? 0.38 : 0.55, len = x.bars * sd * p.spb - 0.25;
          p.at(0, (t) => { b.gurdy(ch.gurdy, t, 50, len, v); b.gurdy(ch.gurdy, t, 57, len, v * 0.75); });
        }
        if (sec !== 'B') {
          p.at(0, (t) => b.buzz(ch.gurdy, t, 62, 0.55));
          p.at(3, (t) => b.buzz(ch.gurdy, t, 62, 0.38));
          if (full) p.at(5, (t) => b.buzz(ch.gurdy, t, 62, 0.22, 0.08));
        }
      }
      // Lute: broken chords when sparse, else the 6/8 "chk" on 3 and 6.
      const gv = voicing(c, 57, 4);
      if (sparse) {
        const arp = tones(c, 50, 74);
        [0, 2, 3, 4, 3, 2].forEach((k, s) => {
          const m = arp[Math.min(k, arp.length - 1)], j = jitter(r);
          p.at(s, (t) => b.pluck(ch.lute, t + j, m, s ? 0.42 : 0.52, 'lute', { dur: sd * 4 }));
        });
      } else {
        p.at(2, (t) => b.strum(ch.lute, t, gv, 0.6, false, sd * 2.4));
        p.at(5, (t) => b.strum(ch.lute, t, gv, 0.64, false, sd * 2.4));
        if (r() < 0.35) p.at(1, (t) => b.strum(ch.lute, t, gv, 0.3, true, sd * 0.9));
        if (r() < 0.35) p.at(4, (t) => b.strum(ch.lute, t, gv, 0.3, true, sd * 0.9));
      }
      // Concertina / musette chords: B section, the sparse passages, softly under A3.
      if (sparse || sec === 'B' || sec === 'A3') {
        const rv = voicing(c, 64, 3), v = sec === 'A3' ? 0.36 : 0.5;
        if (sec === 'A3') {
          p.at(0, (t) => rv.forEach((m) => b.reed(ch.reed, t, m, sd * 2.85, v)));
          p.at(3, (t) => rv.forEach((m) => b.reed(ch.reed, t, m, sd * 2.85, v * 0.85)));
        } else p.at(0, (t) => rv.forEach((m) => b.reed(ch.reed, t, m, sd * 5.8, v, { a: 0.14 })));
      }
      // Tune.
      const melId = S.sections[sec].mel;
      if (melId && (lead || sec === 'inter')) {
        const who = sec === 'inter' ? 'whistle' : lead;
        const vary = sec === 'inter' ? 0 : 0.55 + 0.45 * Math.min(1, x.cycle / 2);
        playMelody(p, x, S.melodies[melId][x.secBar], harborVoice(p, who), scale, vary);
      }
      // Hand percussion: bodhrán, maracas, castanets (12/8 bell pattern over two bars).
      if (!sparse && (x.cycle > 0 || sec !== 'A' || x.secBar >= 4)) {
        const j = [jitter(r), jitter(r)];
        p.at(0, (t) => b.frame(ch.drum, t + j[0], 'doom', 0.85));
        p.at(3, (t) => b.frame(ch.drum, t + j[1], 'doom', 0.55));
        if (full || r() < 0.65) { p.at(2, (t) => b.frame(ch.drum, t, 'tak', 0.36)); p.at(5, (t) => b.frame(ch.drum, t, 'tak', 0.44)); }
        if (r() < 0.3) p.at(1, (t) => b.frame(ch.drum, t, 'tak', 0.16));
        if (r() < 0.3) p.at(4, (t) => b.frame(ch.drum, t, 'tak', 0.16));
        if (x.last && r() < 0.5) [4, 4.5, 5.5].forEach((s, k) => p.at(s, (t) => b.frame(ch.drum, t, 'tak', 0.22 + k * 0.08)));
      }
      if (full) {
        [0.5, 0.2, 0.32, 0.45, 0.2, 0.32].forEach((v, s) => {
          const j = jitter(r, 8), vv = v * (0.85 + r() * 0.3);
          p.at(s, (t) => b.shaker(ch.shaker, t + j, vv));
        });
      }
      if (sec === 'B' || sec === 'A3') {
        const base = (x.secBar % 2) * 6;
        for (const s of [0, 2, 4, 5, 7, 9, 11]) if (s >= base && s < base + 6) p.at(s - base, (t) => b.castanets(ch.cast, t, s === 0 ? 0.7 : 0.48, s % 2 === 0));
      }
    },
  },

  calm: {
    form: () => ['main'],
    bar(p, x) {
      const { b, ch, score: S } = p, sd = p.stepDur, r = x.rng, c = x.chord;
      const rv = voicing(c, 62, 3);
      p.at(0, (t) => rv.forEach((m) => b.reed(ch.reed, t, m, sd * 5.9, 0.42, { a: 0.5, r: 0.5 })));
      p.at(0, (t) => b.pluck(ch.bass, t, lowest(c.bass, 38), 0.5, 'theorbo', { dur: sd * 5.5, prio: 2 }));
      const arp = tones(c, 50, 76);
      [0, 2, 3, 4, 5, 3].forEach((k, s) => {
        if (s && r() < 0.15) return;
        const m = arp[Math.min(k, arp.length - 1)];
        p.at(s, (t) => b.pluck(ch.lute, t, m, s ? 0.3 : 0.38, 'lute', { dur: sd * 5 }));
      });
      if (x.cycle % 2 === 1 && x.secBar < 4) {
        playMelody(p, x, S.melodies.frag[x.secBar], (t, m, d, v) => b.recorder(ch.recorder, t, m, d, v * 0.8, { prio: 2 }), scaleFor(c, S.scale), 0);
      }
    },
  },

  chart: {
    form: () => ['main'],
    bar(p, x) {
      const { b, ch, score: S } = p, sd = p.stepDur, bar = sd * S.stepsPerBar, r = x.rng, R = p.region;
      const drone = R.harmony === 'drone';
      const c = drone ? chord(R.chartDrone) : x.chord;
      const scale = drone ? R.chartScale : scaleFor(c, S.scale);
      const leadPlay = chartLead(p, R.chartLead);
      const even = x.secBar % 2 === 0;
      if (!drone) {
        // Old-world: hurdy-gurdy drone, viol consort, harp, recorder, ship's bell, natural horn.
        if (even) {
          const root = lowest(c.bass, 43);
          p.at(0, (t) => { b.gurdy(ch.drone, t, root, bar * 2 + 0.6, 0.6, { a: 1.2, r: 1.4 }); b.gurdy(ch.drone, t + 0.3, root + 7, bar * 2 + 0.3, 0.38, { a: 1.2, r: 1.4 }); });
          const pv = spread(c, 57, 4);
          p.at(0, (t) => pv.forEach((m, k) => b.strPad(ch.viols, t + 0.2 + k * 0.15, m, bar * 2 - 0.2, 0.55, { a: 1.4, r: 1.6 })));
          if (r() < 0.72) phrase(p, x, S.motifs, scale, c, leadPlay, r() < 0.5 ? 0 : 2, r() < 0.25 ? 12 : 0);
        }
        if (r() < (even ? 0.3 : 0.5)) {
          const arp = tones(c, 50, 79), upward = r() < 0.6;
          const seq = upward ? arp.slice(0, 8) : arp.slice(-8).reverse();
          seq.forEach((m, k) => { if (r() < 0.85) p.at(k, (t) => b.pluck(ch.harp, t, m, 0.42 - k * 0.02, 'harp')); });
        }
        if (x.secBar % 8 === 4 && r() < 0.65) {   // natural horn call: harmonics 2 → 3 of a horn in D
          p.at(0, (t) => b.horn(ch.horn, t, 50, bar * 0.45, 0.42, { a: 0.25, r: 0.6, prio: 1 }));
          p.at(4, (t) => b.horn(ch.horn, t, 57, bar * 0.9, 0.38, { a: 0.3, r: 1.0, prio: 1 }));
        }
        if (x.secBar % 16 === 0 && r() < 0.6) { p.at(4, (t) => b.shipBell(ch.bell, t, 587.3, 0.55)); p.at(5, (t) => b.shipBell(ch.bell, t, 587.3, 0.45)); }
        p.at(0, (t) => b.frame(ch.pulse, t, 'doom', 0.32));
        if (r() < 0.4) p.at(5, (t) => b.frame(ch.pulse, t, 'doom', 0.14));
        return;
      }
      const reg = p.regionId;
      if (reg === 'indian') {
        // Tanpura cycle (Pa Sa Sa Sa) under a bansuri raga-like line, soft tabla.
        [[0, 57, 0.5], [2, 62, 0.42], [4, 62, 0.42], [6, 50, 0.55]].forEach(([s, m, v]) => p.at(s, (t) => b.pluck(ch.tanpura, t, m, v, 'tanpura', { prio: 2 })));
        if (even && r() < 0.78) phrase(p, x, S.motifs, scale, c, leadPlay, r() < 0.5 ? 0 : 2);
        p.at(0, (t) => b.hand(ch.hand, t, 'ghe', 0.4, 62));
        if (r() < 0.6) p.at(3, (t) => b.hand(ch.hand, t, 'na', 0.22, 62));
        if (r() < 0.5) p.at(6, (t) => b.hand(ch.hand, t, 'tin', 0.2, 62));
        if (!even && r() < 0.3) tones(chord('Dm'), 62, 81).filter((m) => scale.includes(pcOf(m))).slice(0, 6)
          .forEach((m, k) => p.at(k * 0.5 + 2, (t) => b.pluck(ch.zheng, t, m, 0.3, 'zheng')));
      } else if (reg === 'spice') {
        // Gamelan-like: slow bonang ostinato on a pelog-like set, gong cycle, suling phrases.
        if (x.secBar % 8 === 0) p.at(0, (t) => b.gong(ch.gong, t, 'ageng', 0.55));
        if (even) p.at(4, (t) => b.gong(ch.gong, t, 'kempul', 0.3));
        const pel = tones({ pcs: scale }, 69, 84), k0 = Math.floor(x.secBar / 2) % Math.max(1, pel.length - 1);
        for (let s = 0; s < 8; s++) { const m = pel[(k0 + (s % 2)) % pel.length]; p.at(s, (t) => b.metal(ch.metal, t, m, s % 2 ? 0.32 : 0.42, 'bonang')); }
        if (even && r() < 0.65) phrase(p, x, S.motifs, scale, c, leadPlay, 2);
        p.at(0, (t) => b.hand(ch.hand, t, 'ghe', 0.3, 67));
        if (r() < 0.5) p.at(5, (t) => b.hand(ch.hand, t, 'te', 0.2, 67));
      } else {
        // South China Sea: đàn bầu over a soft open-fifth string drone, zither arpeggios, gongs and woodblock.
        if (even) p.at(0, (t) => [50, 57].forEach((m) => b.strPad(ch.viols, t, m, bar * 2 - 0.2, 0.45, { a: 1.4, r: 1.6 })));
        if (even && r() < 0.78) phrase(p, x, S.motifs, scale, c, leadPlay, r() < 0.5 ? 0 : 2);
        if (r() < 0.45) {
          const zs = tones({ pcs: scale }, 62, 86), upward = r() < 0.5, seq = upward ? zs.slice(0, 6) : zs.slice(-6).reverse();
          seq.forEach((m, k) => p.at(k * 0.5 + (even ? 4 : 0), (t) => b.pluck(ch.zheng, t, m, 0.32 - k * 0.02, 'zheng')));
        }
        if (x.secBar % 8 === 0) p.at(0, (t) => b.gong(ch.gong, t, 'luo', 0.32));
        if (x.secBar % 4 === 2 && r() < 0.6) p.at(6, (t) => b.gong(ch.gong, t, 'xiaoluo', 0.25));
        p.at(0, (t) => b.woodblock(ch.wood, t, 0.3, false));
        if (r() < 0.5) p.at(4, (t) => b.woodblock(ch.wood, t, 0.2, true));
      }
    },
  },

  battle: {
    form: (p, cycle) => [...(cycle === 0 ? ['intro'] : []), 'A', 'B', 'A2', 'bridge'],
    bar(p, x) {
      const { b, ch, score: S } = p, sd = p.stepDur, r = x.rng, sec = x.sec, i = x.i, R = p.region, reg = p.regionId;
      const drone = R.harmony === 'drone', euro = !drone;
      const c = drone ? chord(R.battleDrone) : x.chord;
      const barDur = sd * S.stepsPerBar, t0 = x.t;
      const intro = sec === 'intro', bridge = sec === 'bridge', mid = !intro && !bridge;
      const spanish = R.spanish ?? 0;
      // Layers fade with intensity (continuous), patterns thicken past thresholds (discrete).
      p.layer('drum', (drone ? 0.2 : 0.3) + 0.7 * smooth(0.1, 0.5, i), t0);
      p.layer('trumpet', 0.35 + 0.65 * smooth(0.25, 0.75, i), t0);
      p.layer('violins', 0.7 + 0.3 * smooth(0.3, 0.7, i), t0);
      p.layer('lead', 0.7 + 0.3 * smooth(0.3, 0.7, i), t0);
      p.layer('oboe', smooth(0.35, 0.65, i), t0);
      p.layer('snare', 0.2 + 0.8 * smooth(0.35, 0.65, i), t0);
      p.layer('strings', 0.75 + 0.25 * i, t0);
      p.layer('cast', 0.4 + 0.6 * smooth(0.2, 0.6, i), t0);
      p.layer('hand', 0.5 + 0.5 * smooth(0.1, 0.55, i), t0);
      p.layer('metal', 0.55 + 0.45 * i, t0);

      // Low strings ostinato (3+3+2 accents), doubled to sixteenths when hot.
      const root = nearest(c.root, 40, 34, 46);
      if (bridge) {
        for (const s of [0, 4, 8, 12]) p.at(s, (t) => b.lowStr(ch.low, t, root, sd * 3.2, s ? 0.6 : 0.85));
      } else {
        const pat = x.secBar % 4 === 3 ? S.ostinatoTurn : S.ostinato;
        const dbl = i >= 0.72 || (sec === 'B' && i >= 0.55);
        pat.forEach((off, e) => {
          const m = root + off, v = S.ostinatoVel[e] * (0.94 + r() * 0.1);
          if (dbl) {
            p.at(e * 2, (t) => b.lowStr(ch.low, t, m, sd * 0.85, v));
            p.at(e * 2 + 1, (t) => b.lowStr(ch.low, t, m, sd * 0.75, v * 0.62));
          } else p.at(e * 2, (t) => b.lowStr(ch.low, t, m, sd * 1.5, v));
        });
      }
      // Harmony bed: string band (European) · tanpura (Indian) · open-fifth strings (Spice / South China).
      if (euro) {
        const pv = voicing(c, 62, 3);
        p.at(0, (t) => pv.forEach((m) => b.strPad(ch.strings, t, m, barDur * 0.97, bridge ? 0.7 : 0.5)));
      } else if (reg === 'indian') {
        [[0, 59, 0.5], [4, 64, 0.42], [8, 64, 0.42], [12, 52, 0.55]].forEach(([s, m, v]) => p.at(s, (t) => b.pluck(ch.tanpura, t, m, v, 'tanpura', { prio: 2 })));
      } else {
        p.at(0, (t) => [52, 59].forEach((m) => b.strPad(ch.strings, t, m, barDur * 0.97, 0.5)));
      }
      // Kettledrums (also the naqqara of a Mughal naubat): downbeat + rolls into phrase ends.
      const tp = nearest(c.root, 43, 38, 50);
      if (!intro || x.secBar === 0) p.at(0, (t) => b.timp(ch.timp, t, tp, (0.55 + 0.4 * i) * (euro ? 1 : 0.8)));
      if ((x.last && i >= 0.3) || (intro && x.secBar === 1)) p.at(8, (t) => b.timpRoll(ch.timp, t, tp, barDur * 0.48, 0.2, 0.8));
      // Field drums 3+3+2.
      if (!intro && i >= 0.12) {
        p.at(0, (t) => b.drum(ch.drum, t, 1.0));
        if (!bridge || i >= 0.5) { p.at(6, (t) => b.drum(ch.drum, t, 0.8)); p.at(12, (t) => b.drum(ch.drum, t, 0.9)); }
        if (euro && mid && i >= 0.5) { p.at(10, (t) => b.drum(ch.drum, t, 0.5, 'tenor')); p.at(14, (t) => b.drum(ch.drum, t, 0.6, 'tenor')); }
        if (euro && mid && i >= 0.75) { p.at(3, (t) => b.drum(ch.drum, t, 0.38, 'tenor')); p.at(7, (t) => b.drum(ch.drum, t, 0.38, 'tenor')); }
        if (euro && mid && x.last && i >= 0.6) for (let s = 9; s < 16; s++) p.at(s, (t) => b.drum(ch.drum, t, 0.4 + (s - 9) * 0.08, 'tenor'));
      }
      // Side drum (European navies; the Atlantic crowns march harder).
      if (euro && mid && i >= 0.4) {
        p.at(4, (t) => b.snare(ch.snare, t, 0.5));
        p.at(12, (t) => b.snare(ch.snare, t, 0.55));
        if (i >= 0.6 || reg === 'atlantic') { p.at(14, (t) => b.snare(ch.snare, t, 0.26)); p.at(15, (t) => b.snare(ch.snare, t, 0.34)); }
        if (reg === 'atlantic' && i >= 0.55) { p.at(6, (t) => b.snare(ch.snare, t, 0.22)); p.at(7, (t) => b.snare(ch.snare, t, 0.3)); }
      }
      if (euro && ((mid && x.last && i >= 0.55) || (bridge && x.last && i >= 0.35))) p.at(8, (t) => b.snareRoll(ch.snare, t, barDur * 0.5, 0.15, 0.7));
      // Regional hand drums / gongs.
      if (reg === 'indian' && !intro) {
        const lvl = i >= 0.5 ? 2 : i >= 0.3 ? 1 : 0;
        S.tabla.forEach((st, s) => {
          if (!st || (lvl === 0 && s % 4) || (lvl === 1 && s % 2)) return;
          const v = S.tablaVel[s] * (bridge && x.last ? 0.7 + s / 30 : 1);
          p.at(s, (t) => b.hand(ch.hand, t, st, v, 64));
        });
      } else if (reg === 'spice' && !intro) {
        S.kendang.forEach((st, s) => { if (st && (i >= 0.55 || s % 2 === 0)) p.at(s, (t) => b.hand(ch.hand, t, st, st === 'te' ? 0.35 : 0.7, 67)); });
        if (x.secBar === 0) p.at(0, (t) => b.gong(ch.gong, t, 'ageng', 0.7));
        if (x.secBar % 2 === 1) p.at(8, (t) => b.gong(ch.gong, t, 'kempul', 0.45));
        // bonang interlocking eighths (kotekan-like) on the pelog-like set
        const pel = tones({ pcs: R.battleScale }, 74, 86), k0 = (x.secBar * 2) % Math.max(1, pel.length - 1);
        for (let s = 0; s < 16; s += 2) p.at(s, (t) => b.metal(ch.metal, t, pel[(k0 + (s / 2) % 2) % pel.length], 0.4, 'bonang'));
        if (i >= 0.6) for (let s = 1; s < 16; s += 2) p.at(s, (t) => b.metal(ch.metal, t, pel[(k0 + 1 + ((s - 1) / 2) % 2) % pel.length], 0.28, 'bonang'));
      } else if (reg === 'southchina' && !intro) {
        if (i >= 0.3) [2, 6, 10, 14].forEach((s) => p.at(s, (t) => b.woodblock(ch.wood, t, 0.4, s % 4 === 2)));
        if (x.secBar === 0) p.at(0, (t) => b.gong(ch.gong, t, 'luo', 0.75));
        if (mid && i >= 0.55) { p.at(4, (t) => b.bo(ch.gong, t, 0.45)); p.at(12, (t) => b.bo(ch.gong, t, 0.5)); }
        if (mid && i >= 0.5) p.at(14, (t) => b.gong(ch.gong, t, 'xiaoluo', 0.4));
        if (mid && i >= 0.72 && x.secBar % 4 === 3) p.at(0, (t) => b.gong(ch.gong, t, 'luo', 0.55));
      }
      // Trumpets & horns: open-fifth stabs (Europe, and the karnay of the Indian naubat).
      if (mid && (euro || reg === 'indian')) {
        const tr = nearest(c.root, 60, 55, 66), notes = i >= 0.7 ? [tr - 12, tr, tr + 7, tr + 12] : [tr, tr + 7, tr + 12];
        const changed = x.secBar === 0 || !x.prev || x.prev.sym !== c.sym || drone;
        if (i >= 0.25 && (changed || i >= 0.8) && (euro || x.secBar % 2 === 0)) p.at(0, (t) => b.trumpets(ch.trumpet, t, notes, 0.22, 0.65));
        if (i >= 0.55 && (x.secBar >= x.bars - 2 || i >= 0.8)) {
          p.at(6, (t) => b.trumpets(ch.trumpet, t, notes, 0.18, 0.68));
          p.at(12, (t) => b.trumpets(ch.trumpet, t, notes, 0.2, 0.75));
        }
      }
      // Natural-trumpet calls ("to arms") over E-minor bars.
      if (euro && intro && x.secBar === 1) playMelody(p, x, S.melodies.callIntro, (t, m, d, v) => b.trumpet(ch.trumpet, t, m, d, v), S.scale, 0, { vel: 0.85, legato: 0.9 });
      if (euro && sec === 'A2' && (x.secBar === 1 || x.secBar === 5) && i >= 0.5) {
        const call = S.melodies.call;
        let s = 8;
        for (const [m, len] of call) { const s0 = s; p.at(s0, (t) => b.trumpet(ch.trumpet, t, m, len * sd * 0.9, 0.8)); s += len; }
      }
      // Castanets + baroque-guitar rasgueado: the Iberian colour.
      if (spanish > 0 && !intro && i >= 0.2 && (bridge || (sec === 'B' && spanish >= 1))) {
        for (const [s, v, roll] of S.castanets) {
          if (roll && i >= 0.5) p.at(s - 0.45, (t) => b.castRoll(ch.cast, t, v * 0.8));
          p.at(s, (t) => b.castanets(ch.cast, t, v, s % 4 === 0));
        }
      }
      if (spanish > 0 && bridge) {
        const gv = voicing(c, 57, 5);
        p.at(0, (t) => b.rasgueado(ch.lute, t, gv, 0.7, sd * 5));
        p.at(6, (t) => b.strum(ch.lute, t, gv, 0.55, false, sd * 5));
        p.at(12, (t) => b.strum(ch.lute, t, gv, 0.6, true, sd * 3));
      }
      // The tune.
      const melId = S.sections[sec].mel;
      if (melId && i >= 0.25) {
        const bar = S.melodies[melId][x.secBar];
        if (euro) {
          const scale = scaleFor(c, S.scale);
          playMelody(p, x, bar, (t, m, d, v, g) => b.violins(ch.violins, t, m, d, v, { grace: g }), scale, 0.15, { vel: 0.9, legato: 0.96 });
          if (i >= 0.45) playMelody(p, x, bar, (t, m, d, v) => b.oboe(ch.oboe, t, m, d, v * 0.8, { prio: 2 }), scale, 0, { vel: 0.85, legato: 0.96 });
          if (sec === 'A2' && i >= 0.65) playMelody(p, x, bar, (t, m, d, v) => b.violins(ch.violins, t, m + 12, d, v * 0.55, { prio: 1 }), scale, 0, { vel: 0.85, legato: 0.96 });
          if (reg === 'atlantic' && sec === 'A2' && i >= 0.5) playMelody(p, x, bar, (t, m, d, v) => b.whistle(ch.fife, t, m + 12, d, v * 0.7, { prio: 1 }), scale, 0, { vel: 0.85, legato: 0.9 });
        } else {
          const map = (m) => snapScale(m, R.battleScale);
          const kind = reg === 'southchina' && sec === 'B' ? 'danbau' : R.battleLead;
          playMelody(p, x, bar, (t, m, d, v, g, from) => b.glide(ch.lead, t, m, d, v, kind, { grace: g, from }), R.battleScale, 0.15, { vel: 0.9, legato: 0.96, map });
          if (reg === 'spice') playMelody(p, x, bar.filter(([, l]) => l >= 4), (t, m, d, v) => b.metal(ch.metal, t, m - 12, v * 0.8, 'saron'), R.battleScale, 0, { map });
        }
      } else if (euro && bridge && i >= 0.25) {
        // a falling line over the phrygian cadence: C – B – A – G#
        const line = [72, 71, 69, 68][x.secBar % 4];
        p.at(0, (t) => b.violins(ch.violins, t, line, barDur * 0.95, 0.7, { a: 0.15 }));
        if (i >= 0.45) p.at(0, (t) => b.oboe(ch.oboe, t, line, barDur * 0.95, 0.55));
      }
    },
  },
};

/** Lead-instrument dispatch for the harbor tune. */
function harborVoice(p, who) {
  const { b, ch } = p;
  switch (who) {
    case 'whistle': return (t, m, d, v, g) => b.whistle(ch.whistle, t, m + 12, d, v, { grace: g && g + 12 });
    case 'gurdy':   return (t, m, d, v, g) => b.fiddle(ch.gurdy, t, m, d, v * 1.1, { grace: g, vib: 0, a: 0.012 });
    case 'cittern': return (t, m, d, v) => b.cittern(ch.cittern, t, m, d, v, p.stepDur);
    case 'both':    return (t, m, d, v, g) => { b.fiddle(ch.fiddle, t, m, d, v, { grace: g }); b.whistle(ch.whistle, t, m + 12, d, v * 0.6, { prio: 1 }); };
    default:        return (t, m, d, v, g) => b.fiddle(ch.fiddle, t, m, d, v, { grace: g });
  }
}
/** Lead-instrument dispatch for the chart phrases. */
function chartLead(p, who) {
  const { b, ch } = p;
  if (who === 'recorder') return (t, m, d, v) => b.recorder(ch.recorder, t, m, d, v * 0.8, { prio: 2 });
  return (t, m, d, v, from) => b.glide(ch.lead, t, m, d, v, who, { from, prio: 2 });
}

// ── Players ─────────────────────────────────────────────────────────
class BasePlayer {
  constructor(dir, id, score) {
    const c = dir.ctx;
    this.dir = dir; this.id = id; this.score = score; this.b = dir.band;
    this.state = 'idle'; this.stopAt = null;
    const fg = c.createGain(), sg = c.createGain(), tr = c.createGain(), trs = c.createGain();
    fg.connect(tr); tr.connect(dir.mix); sg.connect(trs); trs.connect(dir.revIn);   // tr/trs: per-region loudness trim
    this._trim = [tr, trs];
    this.fader = new Fader(fg.gain, 0); this.sendFader = new Fader(sg.gain, 0);
    this._fg = fg; this._sg = sg;
    this.ch = {};
    for (const [name, cfg] of Object.entries(score.channels)) this.ch[name] = new Channel(dir, name, fg, sg, cfg);
  }
  start(t, fade) { this.state = 'playing'; this.fader.to(1, t, fade); this.sendFader.to(1, t, fade); }
  fadeOut(t, fade) { this.state = 'stopping'; this.stopAt = t + fade; this.fader.to(0, t, fade); this.sendFader.to(0, t, fade); }
  fadeIn(t, fade) { this.state = 'playing'; this.stopAt = null; this.fader.to(1, t, fade); this.sendFader.to(1, t, fade); }
  isDone(now) { return this.state === 'stopping' && now > this.stopAt + TAIL_SEC; }
  dispose() {
    for (const c of Object.values(this.ch)) c.dispose();
    try { this._fg.disconnect(); this._sg.disconnect(); this._trim.forEach((g) => g.disconnect()); } catch (e) { /* gone */ }
  }
}

/** Loops a bar-based score, asking its arranger for one bar of events at a time. */
class TrackPlayer extends BasePlayer {
  constructor(dir, id, opts = {}) {
    const scoreId = id === 'battle_intense' ? 'battle' : id;
    super(dir, id, SCORES[scoreId]);
    const S = this.score;
    this.scoreId = scoreId;
    this.arr = ARRANGERS[scoreId];
    this.floor = id === 'battle_intense' ? MUSIC_MIX.intenseFloor : 0;
    this.beatSteps = S.beatSteps;
    this.spb = S.stepsPerBar;
    this.stepDur = 60 / S.bpm / S.beatSteps;
    this.seed = (opts.seed ?? dir._seedFor(id)) >>> 0;
    this.form = { idx: 0, secBar: 0, cycle: 0, list: this.arr.form(this, 0) };
    this.step = 0; this.barCount = 0; this.nextTime = 0;
    this.byStep = []; this.carry = [];
    this.intensity = Math.max(this.floor, dir._targetIntensity);
    this.prevChord = null;
    this.mem = {};
    this._setRegion(dir._region);
  }
  _setRegion(id) {
    this.regionId = REGIONS[id] ? id : 'caribbean'; this.region = REGIONS[this.regionId];
    // loudness trim per region × score (data/music.js REGIONS[*].trim, dB) — calibrated offline (±2 dB target)
    const db = this.region.trim?.[this.scoreId] ?? 0, g = Math.pow(10, db / 20), c = this.dir.ctx;
    for (const n of this._trim) { if (this.dir._offline || !c) n.gain.value = g; else n.gain.setTargetAtTime(g, c.currentTime, 0.5); }
  }
  start(t, fade) { this.nextTime = t; super.start(t, fade); }
  /** Register `fn(t)` at `step` of the bar being built (fractional steps ok; ≥ bar length spills over). */
  at(step, fn) {
    if (step >= this.spb) { this.carry.push([step - this.spb, fn]); return; }
    const s = Math.floor(step), off = (step - s) * this.stepDur;
    (this.byStep[s] ||= []).push(off ? (t) => fn(t + off) : fn);
  }
  layer(name, v, t) { this.ch[name]?.set(v, t); }
  reanchor(t) { if (this.nextTime < t) this.nextTime = t; }
  scheduleUntil(horizon, now) {
    if (this.state !== 'playing' && this.state !== 'stopping') return;
    while (this.nextTime < horizon) {
      if (this.state === 'stopping' && this.nextTime >= this.stopAt) return;
      if (this.nextTime < now - 0.1) this.nextTime = now + 0.03;   // main-thread stall: re-anchor, keep the musical position
      if (this.step === 0) this._bar(this.nextTime);
      const evs = this.byStep[this.step];
      if (evs) for (const fn of evs) fn(this.nextTime);
      this.nextTime += this.stepDur;
      if (++this.step >= this.spb) { this.step = 0; this.barCount++; }
    }
  }
  _secDef(k = this.form.idx) { return this.score.sections[this.form.list[k]]; }
  _bar(t) {
    const f = this.form, S = this.score, sec = f.list[f.idx], def = this._secDef();
    if (this.regionId !== this.dir._region && f.secBar % 4 === 0) this._setRegion(this.dir._region);   // recolour on a phrase boundary
    // Intensity slews toward the director's target (with the track's floor).
    const target = Math.max(this.floor, this.dir._targetIntensity);
    this.intensity += (target - this.intensity) * (1 - Math.exp(-(this.spb * this.stepDur) / MUSIC_MIX.intensitySlewSec));
    const c = chord(def.chords[f.secBar]);
    let nextSym;
    if (f.secBar + 1 < def.chords.length) nextSym = def.chords[f.secBar + 1];
    else {
      const ns = f.list[f.idx + 1] ?? this.arr.form(this, f.cycle + 1)[0];
      nextSym = S.sections[ns].chords[0];
    }
    this.byStep = new Array(this.spb);
    const carry = this.carry;
    this.carry = [];
    for (const [s, fn] of carry) this.at(s, fn);
    const x = {
      t, sec, secBar: f.secBar, bars: def.chords.length, cycle: f.cycle,
      chord: c, next: chord(nextSym), prev: this.prevChord,
      last: f.secBar === def.chords.length - 1, i: this.intensity,
      rng: rng32(hash(this.seed, f.cycle, f.idx, f.secBar)),
    };
    this.arr.bar(this, x);
    this.prevChord = c;
    // advance the form pointer for the next bar
    if (++f.secBar >= def.chords.length) {
      f.secBar = 0;
      if (++f.idx >= f.list.length) { f.idx = 0; f.cycle++; f.list = this.arr.form(this, f.cycle); }
    }
  }
}

/** One-shot stinger: schedules its whole event list at start, then hands over to `then`. */
class StingerPlayer extends BasePlayer {
  constructor(dir, id, opts = {}) {
    super(dir, id, SCORES[id]);
    this.isStinger = true;
    this.then = opts.then !== undefined ? opts.then : this.score.then;
    this.thenFired = false;
  }
  start(t, fade) {
    super.start(t, fade);
    this.t0 = t;
    this.thenTime = t + this.score.thenAt;
    for (const e of this.score.events) this._event(e, t + e.t);
  }
  _event(e, t) {
    const b = this.b, ch = this.ch;
    switch (e.i) {
      case 'trumpet':  b.trumpet(ch.trumpet, t, e.m, e.d, e.v, { prio: 3 }); break;
      case 'horn':     b.horn(ch.horn, t, e.m, e.d, e.v, { prio: 3 }); break;
      case 'strings':  e.m.forEach((m) => b.strPad(ch.strings, t, m, e.d, e.v, { a: e.a ?? 0.2, prio: 3 })); break;
      case 'violins':  b.violins(ch.violins, t, e.m, e.d, e.v, { prio: 3 }); if (e.dbl) b.oboe(ch.oboe, t, e.m, e.d, e.v * 0.8, { prio: 3 }); break;
      case 'low':      b.lowStr(ch.low, t, e.m, e.d, e.v, { prio: 3, sustain: true }); break;
      case 'timp':     b.timp(ch.timp, t, e.m, e.v); break;
      case 'timpRoll': b.timpRoll(ch.timp, t, e.m, e.d, e.v, e.v1); break;
      case 'drum':     b.drum(ch.drum, t, e.v, 'bass'); break;
      case 'muffled':  b.drum(ch.drum, t, e.v, 'muffled'); break;
      default: break;
    }
  }
  scheduleUntil() { /* everything was scheduled at start */ }
  reanchor() {}
  isDone(now) {
    if (this.state === 'stopping') return now > this.stopAt + TAIL_SEC;
    return now > this.t0 + this.score.length + TAIL_SEC && this.thenFired;
  }
}

// ── Ambience ────────────────────────────────────────────────────────
class Ambience {
  constructor(dir, kind) {
    const c = this.ctx = dir.ctx;
    this.dir = dir; this.kind = kind; this.cfg = AMBIENCE_MIX[kind]; this.rnd = dir._rng;
    this.state = 'idle'; this.stopAt = null;
    this.nodes = []; this.srcs = [];
    const og = c.createGain();
    og.connect(dir.ambOut);
    this.fader = new Fader(og.gain, 0); this.out = og; this.nodes.push(og);
    const pan = (v) => { if (!c.createStereoPanner) return og; const p = c.createStereoPanner(); p.pan.value = v; p.connect(og); this.nodes.push(p); return p; };
    this.L = pan(-0.55); this.R = pan(0.5);
    // Shore echo for distant sounds (hammering, gulls): feedback delay, darkened.
    this.echo = c.createGain(); this.echo.gain.value = 1;
    const dl = c.createDelay(1), fb = c.createGain(), elp = c.createBiquadFilter(), eo = c.createGain();
    dl.delayTime.value = 0.19; fb.gain.value = 0.3; elp.type = 'lowpass'; elp.frequency.value = 1700; eo.gain.value = 0.35;
    this.echo.connect(dl); dl.connect(elp); elp.connect(fb); fb.connect(dl); elp.connect(eo); eo.connect(og);
    this.nodes.push(this.echo, dl, fb, elp, eo);
    this.next = {};
  }
  _side() { return this.rnd() < 0.5 ? this.L : this.R; }
  _every(key, t) { const [a, b] = this.cfg[key + 'Every']; this.next[key] = t + a + this.rnd() * (b - a); }
  _bed(type, f, q, level) {
    const c = this.ctx, s = c.createBufferSource();
    s.buffer = this.dir._longNoise(); s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = level;
    s.connect(fl); fl.connect(g); g.connect(this.out);
    s.start(this.dir._now(), this.rnd() * 5);
    this.srcs.push(s); this.nodes.push(fl, g);
    return { f: fl, g };
  }
  _lfo(rate, depth, param) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = rate; g.gain.value = depth;
    o.connect(g); g.connect(param); o.start(this.dir._now());
    this.srcs.push(o); this.nodes.push(g);
  }
  start(t, fade) {
    const cfg = this.cfg, r = this.rnd;
    this.state = 'playing';
    this.fader.to(AMBIENCE_MIX.level, t, fade);
    if (this.kind === 'harbor') {
      this.swells = [this._bed('lowpass', 320, 0.5, cfg.waves * 0.15), this._bed('lowpass', 320, 0.5, cfg.waves * 0.15)];
      this.next = { swell: t + 0.2, lap: t + 0.5, gull: t + 2 + r() * 4, hammer: t + 4 + r() * 6, creak: t + 2 + r() * 5, saw: t + 15 + r() * 20 };
    } else {
      const w = this._bed('bandpass', 650, 0.8, cfg.wind);
      this._lfo(0.05 + r() * 0.03, 320, w.f.frequency);
      this._lfo(0.13, cfg.wind * 0.45, w.g.gain);
      const wh = this._bed('bandpass', 1250, 14, cfg.whistle);
      this._lfo(0.037, 180, wh.f.frequency);
      this._lfo(0.09, cfg.whistle * 0.8, wh.g.gain);
      this.swells = [this._bed('lowpass', 300, 0.5, cfg.waves * 0.18), this._bed('lowpass', 300, 0.5, cfg.waves * 0.18)];
      this.next = { swell: t + 0.1, crest: t + 2 + r() * 3, creak: t + 5 + r() * 6 };
    }
    this.si = 0;
  }
  fadeOut(t, fade) { this.state = 'stopping'; this.stopAt = t + fade; this.fader.to(0, t, fade); }
  fadeIn(t, fade) { this.state = 'playing'; this.stopAt = null; this.fader.to(AMBIENCE_MIX.level, t, fade); }
  isDone(now) { return this.state === 'stopping' && now > this.stopAt + 1; }
  reanchor(t) { for (const k in this.next) if (this.next[k] < t) this.next[k] = t + this.rnd() * 2; }
  scheduleUntil(horizon, now) {
    if (this.state !== 'playing') return;
    for (const key of Object.keys(this.next)) {
      while (this.next[key] < horizon) {
        const t = Math.max(this.next[key], now + 0.02);
        this['_' + key](t);
        this._every(key, t);
      }
    }
  }
  dispose() {
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* stopped */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
  }

  // ── events ──
  _swell(t) {
    const v = this.swells[this.si++ % this.swells.length], r = this.rnd, lvl = this.cfg.waves;
    const up = 1.3 + r() * 1.3, down = 2.2 + r() * 2.0, pk = lvl * (0.55 + r() * 0.45);
    const bright = this.kind === 'sea' ? 900 + r() * 900 : 650 + r() * 650;
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(pk, t, up / 3);
    v.g.gain.setTargetAtTime(lvl * 0.15, t + up, down / 3);
    v.f.frequency.cancelScheduledValues(t);
    v.f.frequency.setTargetAtTime(bright, t, up / 3);
    v.f.frequency.setTargetAtTime(300, t + up, down / 3);
  }
  _noiseHit(t, dest, type, f, q, peak, a, d) {
    const c = this.ctx, s = c.createBufferSource(), b = noiseBuffer(c);
    s.buffer = b;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0, t + a, d / 4);
    s.connect(fl); fl.connect(g); g.connect(dest);
    const room = b.duration - a - d - 0.1;
    if (room > 0) s.start(t, this.rnd() * room); else { s.loop = true; s.start(t, 0); }
    s.stop(t + a + d + 0.05);
    s.onended = () => { fl.disconnect(); g.disconnect(); };
    return g;
  }
  _lap(t) {
    const r = this.rnd, d = 0.12 + r() * 0.2;
    this._noiseHit(t, this._side(), 'bandpass', 800 + r() * 1100, 1.3, this.cfg.lap * (0.35 + r() * 0.65), d * 0.35, d * 1.6);
  }
  _crest(t) {
    const r = this.rnd;
    this._noiseHit(t, this._side(), 'highpass', 2000 + r() * 1500, 0.6, this.cfg.crest * (0.5 + r() * 0.5), 0.25 + r() * 0.2, 0.9 + r() * 0.6);
  }
  _gull(t) {
    const c = this.ctx, r = this.rnd, n = 2 + Math.floor(r() * 4), far = r(), dest = this._side();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500 - far * 3500;
    const send = c.createGain(); send.gain.value = 0.2 + far * 0.5;
    lp.connect(dest); lp.connect(send); send.connect(this.echo);
    let tt = t, last = null;
    const f0 = 1150 + r() * 400;
    for (let k = 0; k < n; k++) {
      const d = 0.2 + r() * 0.2, f = f0 * (1 - k * 0.035);
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.78, tt);
      o.frequency.linearRampToValueAtTime(f * 1.12, tt + d * 0.3);
      o.frequency.linearRampToValueAtTime(f * 0.74, tt + d);
      const rasp = c.createOscillator(), rg = c.createGain();
      rasp.type = 'square'; rasp.frequency.value = 28 + r() * 14; rg.gain.value = f * 0.05;
      rasp.connect(rg); rg.connect(o.frequency);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.7; bp.Q.value = 2.2;
      const g = c.createGain(), pk = this.cfg.gulls * (1 - far * 0.6) * (0.7 + r() * 0.3);
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(pk, tt + 0.03);
      g.gain.setValueAtTime(pk * 0.8, tt + d - 0.06);
      g.gain.linearRampToValueAtTime(0, tt + d);
      o.connect(bp); bp.connect(g); g.connect(lp);
      o.start(tt); o.stop(tt + d + 0.02); rasp.start(tt); rasp.stop(tt + d + 0.02);
      o.onended = () => { g.disconnect(); bp.disconnect(); rg.disconnect(); };
      last = o; tt += d + 0.1 + r() * 0.22;
    }
    const prev = last.onended;
    last.onended = () => { prev(); lp.disconnect(); send.disconnect(); };
  }
  _hammer(t) {
    const c = this.ctx, r = this.rnd, n = 3 + Math.floor(r() * 5), gap = 0.36 + r() * 0.16;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const send = c.createGain(); send.gain.value = 0.6;
    lp.connect(this._side()); lp.connect(send); send.connect(this.echo);
    let last = null;
    for (let k = 0; k < n; k++) {
      const tt = t + k * gap + (r() - 0.5) * 0.04, v = this.cfg.hammer * (0.7 + r() * 0.3);
      const o = c.createOscillator(); o.frequency.setValueAtTime(820 + r() * 120, tt); o.frequency.exponentialRampToValueAtTime(560, tt + 0.03);
      const og = c.createGain(); perc(og.gain, tt, v * 0.6, 0.001, 0.05);
      o.connect(og); og.connect(lp); o.start(tt); o.stop(tt + 0.08);
      this._noiseHit(tt, lp, 'bandpass', 1900, 1.5, v, 0.001, 0.035);
      o.onended = () => og.disconnect();
      last = o;
    }
    const prev = last.onended;
    last.onended = () => { prev(); setTimeout(() => { try { lp.disconnect(); send.disconnect(); } catch (e) { /* gone */ } }, 1500); };
  }
  _saw(t) {   // a distant shipwright sawing a plank
    const r = this.rnd, strokes = 4 + Math.floor(r() * 5), per = 0.42 + r() * 0.1, dest = this._side();
    for (let k = 0; k < strokes; k++) {
      const tt = t + k * per;
      this._noiseHit(tt, dest, 'bandpass', (k % 2 ? 2300 : 1700) + r() * 300, 2.5, this.cfg.saw, per * 0.45, per * 0.5);
    }
  }
  _creak(t) {
    const c = this.ctx, r = this.rnd, d = 0.4 + r() * 0.8, f0 = 22 + r() * 25;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.3 + r() * 0.8), t + d);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700 + r() * 700; bp.Q.value = 7;
    const g = c.createGain(), pk = this.cfg.creak * (0.6 + r() * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + d * 0.3);
    g.gain.setValueAtTime(pk, t + d * 0.75);
    g.gain.linearRampToValueAtTime(0, t + d);
    o.connect(bp); bp.connect(g); g.connect(this._side());
    o.start(t); o.stop(t + d + 0.02);
    o.onended = () => { bp.disconnect(); g.disconnect(); };
  }
}

// ── Director ────────────────────────────────────────────────────────
function safeStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }

/**
 * Adaptive music + ambience director. Use the `music` singleton in the game;
 * construct your own only for offline rendering/tests (pass `context` and
 * `destination`).
 */
export class MusicDirector {
  /**
   * @param {object} [opts]
   * @param {BaseAudioContext} [opts.context]     render into this context instead of Audio.js's
   * @param {AudioNode}        [opts.destination] output node (default: Audio.js music bus)
   * @param {Storage|null}     [opts.storage]     volume persistence (default localStorage; null = none)
   * @param {boolean}          [opts.autoUnlock]  unlock on the first pointerdown/keydown (default true)
   * @param {number}           [opts.seed]        variation seed (default: random per session)
   * @param {() => number}     [opts.now]         clock override (offline rendering)
   * @param {string[]}         [opts.solo]        only these channel names sound (mix calibration)
   */
  constructor(opts = {}) {
    this._opts = opts;
    this._custom = !!opts.context;
    this._ctx = null;
    this._players = []; this._current = null;
    this._amb = []; this._ambCurrent = null;
    this._targetIntensity = 0.35;
    this._region = 'caribbean';
    this._pending = null; this._pendingAmb = undefined;
    this._unlocked = false; this._hidden = false; this._timer = null;
    this._voices = [];
    this._retired = [];
    this._dropped = 0;
    this._solo = opts.solo || null;
    const seed = opts.seed ?? ((Math.random() * 4294967296) >>> 0);
    this._seed = seed >>> 0;
    this._rng = rng32(hash(this._seed, 0x5eed));
    this._storage = opts.storage === undefined ? safeStorage() : opts.storage;
    const saved = this._load();
    this._volume = saved.v; this._muted = saved.m;
    if (!this._custom) {
      audio.musicVolume = this._volume;   // one music-volume knob shared with Audio.js
      audio.setStingerHandler?.((type) => this._takeStinger(type));
      if (typeof document !== 'undefined') {
        this._onVis = () => this._visibility();
        document.addEventListener('visibilitychange', this._onVis);
      }
    }
    if (opts.autoUnlock !== false && !this._custom && typeof window !== 'undefined') this._installUnlock();
  }

  // ── Public API ───────────────────────────────────────────────────
  /**
   * Crossfade to a track. `null` fades to silence.
   * @param {'harbor'|'chart'|'battle'|'battle_intense'|'victory'|'defeat'|'calm'|null} track
   * @param {{fade?: number, then?: string|null, seed?: number}} [opts]
   *        fade: seconds (default 2, stingers 1); then: what a stinger falls to
   *        (victory → 'calm', defeat → null by default).
   */
  play(track, opts = {}) {
    if (track != null && !MUSIC_TRACKS.includes(track)) { console.warn(`[music] unknown track "${track}"`); return; }
    if (!this._ready()) { this._pending = { track, opts, at: perfNow() }; return; }
    const now = this._now(), sting = STINGERS.has(track);
    const fade = opts.fade ?? (sting ? MUSIC_MIX.stingerFadeSec : MUSIC_MIX.crossfadeSec);
    const cur = this._current;
    if (cur && cur.state === 'playing') {
      if (cur.id === track && (!sting || now - cur.t0 < 3)) return;   // already playing / duplicate stinger call
      // battle ↔ battle_intense: same score, change the intensity floor in place
      if (cur.scoreId === 'battle' && (track === 'battle' || track === 'battle_intense')) {
        cur.id = track; cur.floor = track === 'battle_intense' ? MUSIC_MIX.intenseFloor : 0;
        return;
      }
    }
    for (const p of this._players) if (p.state === 'playing') p.fadeOut(now, fade);
    this._current = null;
    if (track == null) return;
    let p = sting ? null : this._players.find((q) => q.id === track && q.state === 'stopping');
    if (p) p.fadeIn(now, fade);
    else {
      p = sting ? new StingerPlayer(this, track, opts) : new TrackPlayer(this, track, opts);
      this._players.push(p);
      p.start(now + 0.05, sting ? 0.02 : fade);
    }
    this._current = p;
    this._kick();
  }
  /** Fade the music out. */
  stop(fade = MUSIC_MIX.crossfadeSec) { this.play(null, { fade }); }
  /**
   * Battle intensity 0..1: percussion, brass and the horn theme build as it rises.
   * Smoothed over ~1.5 s unless `immediate`.
   */
  setIntensity(v, immediate = false) {
    this._targetIntensity = clamp(+v || 0);
    if (immediate) for (const p of this._players) if (p.intensity != null) p.intensity = Math.max(p.floor || 0, this._targetIntensity);
  }
  /**
   * Colour the battle and chart themes for a sea region (data/factions.js SEAS id):
   * 'caribbean' | 'atlantic' (shanty & Iberian) · 'indian' (drone, raga-like line, tabla-like drums)
   * · 'spice' (gong-chime ostinato) · 'southchina' (pentatonic, gongs, dizi, đàn bầu bends).
   * A playing battle/chart recolours itself on its next 4-bar phrase.
   */
  setRegion(seaId) {
    if (seaId != null && !REGIONS[seaId]) { console.warn(`[music] unknown region "${seaId}"`); return; }
    this._region = seaId ?? 'caribbean';
  }
  /** Music volume 0..1 (persisted). */
  setVolume(v) {
    this._volume = clamp(+v || 0);
    if (!this._custom) audio.musicVolume = this._volume;
    this._applyOut(0.05);
    this._save();
  }
  /** Mute/unmute the music (persisted). Ambience is not affected. */
  mute(on = true) { this._muted = !!on; this._applyOut(0.08); this._save(); }
  /** Ambience bed: 'harbor' | 'sea' | null (crossfades ~2.5 s). Routed to the SFX bus. */
  ambience(kind) {
    if (kind != null && !AMBIENCE_KINDS.includes(kind)) { console.warn(`[music] unknown ambience "${kind}"`); return; }
    if (!this._ready()) { this._pendingAmb = kind; return; }
    if ((this._ambCurrent?.kind ?? null) === (kind ?? null)) return;
    const now = this._now(), fade = AMBIENCE_MIX.fadeSec;
    this._ambCurrent?.fadeOut(now, fade);
    this._ambCurrent = null;
    if (kind) {
      let a = this._amb.find((q) => q.kind === kind && q.state === 'stopping');
      if (a) a.fadeIn(now, fade);
      else { a = new Ambience(this, kind); this._amb.push(a); a.start(now + 0.05, fade); }
      this._ambCurrent = a;
    }
    this._kick();
  }
  /**
   * Start audio from a user gesture (also done automatically on the first
   * pointerdown/keydown). Resolves true once the context is running.
   */
  unlock() {
    try {
      const ctx = this._ensureGraph();
      if (!ctx) return Promise.resolve(false);
      const go = () => {
        if (this._unlocked) return true;
        if (!this._offline && ctx.state !== 'running') return false;
        this._unlocked = true;
        this._removeUnlock();
        this._applyOut(0.05);
        this._flushPending();
        this._kick();
        return true;
      };
      if (this._offline || ctx.state === 'running') return Promise.resolve(go());
      return ctx.resume().then(go, () => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  }
  get volume() { return this._volume; }
  get muted() { return this._muted; }
  get track() { return this._current?.id ?? (this._pending?.track ?? null); }
  get intensity() { return this._targetIntensity; }
  get region() { return this._region; }
  get unlocked() { return this._unlocked; }
  /** Debug snapshot (QA / console). */
  status() {
    const now = this._ctx ? this._now() : 0;
    return {
      unlocked: this._unlocked, ctx: this._ctx?.state ?? 'none', hidden: this._hidden,
      track: this.track, region: this._region, ambience: this._ambCurrent?.kind ?? null, intensity: +this._targetIntensity.toFixed(2),
      volume: this._volume, muted: this._muted,
      players: this._players.map((p) => `${p.id}:${p.state}`), voices: this._voices.filter((v) => v[0] <= now + 0.05 && v[1] > now).length,
      dropped: this._dropped,
    };
  }
  /** Tear everything down (tests / hot reload). */
  destroy() {
    this._removeUnlock();
    if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
    clearTimeout(this._timer); this._timer = null;
    for (const x of [...this._players, ...this._amb, ...this._retired]) x.dispose();
    this._players = []; this._amb = []; this._retired = []; this._current = null; this._ambCurrent = null;
    if (this._ctx) {
      for (const o of this._vibOscs) { try { o.stop(); } catch (e) { /* stopped */ } }
      for (const n of [this.mix, this.revIn, this.revHp, this.reverb, this.revOut, this.comp, this.trim, this.clip, this.out, this.ambOut, ...this._vibs, ...this._vibOscs]) { try { n?.disconnect(); } catch (e) { /* gone */ } }
    }
    if (!this._custom) audio.setStingerHandler?.(null);
  }

  // ── Internals ────────────────────────────────────────────────────
  /** The AudioContext in use (null before unlock). */
  get ctx() { return this._ctx; }
  _ready() { return this._unlocked && !!this._ctx; }
  _vib() { return this._vibs[this._vibK++ % this._vibs.length]; }
  _now() { return this._opts.now ? this._opts.now() : this._ctx.currentTime; }
  _seedFor(id) { return hash(this._seed, id.length * 131 + id.charCodeAt(0)); }
  _load() {
    const def = { v: MUSIC_MIX.defaultVolume, m: false };
    try {
      const raw = this._storage?.getItem(STORAGE_KEY);
      if (raw == null) return def;
      const j = JSON.parse(raw);
      if (typeof j === 'number') return { v: clamp(j), m: false };
      return { v: clamp(Number.isFinite(+j.v) ? +j.v : def.v), m: !!j.m };
    } catch (e) { return def; }
  }
  _save() {
    try { this._storage?.setItem(STORAGE_KEY, JSON.stringify({ v: Math.round(this._volume * 1000) / 1000, m: this._muted ? 1 : 0 })); } catch (e) { /* private mode */ }
  }
  _takeStinger(type) {
    if (!this._unlocked || this._muted || this._volume < 0.02) return false;
    this.play(type);
    return true;
  }
  _installUnlock() {
    this._unlockFn = () => { this.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, this._unlockFn, { capture: true, passive: true });
  }
  _removeUnlock() {
    if (!this._unlockFn || typeof window === 'undefined') return;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.removeEventListener(ev, this._unlockFn, { capture: true });
    this._unlockFn = null;
  }
  _flushPending() {
    if (this._pending) {
      const { track, opts, at } = this._pending;
      this._pending = null;
      if (STINGERS.has(track) && perfNow() - at > 2500) {
        const then = opts.then !== undefined ? opts.then : SCORES[track].then;   // stale stinger → go straight to its bed
        if (then) this.play(then, { fade: 1.5 });
      } else this.play(track, { ...opts, fade: Math.min(opts.fade ?? 1.5, 1.5) });
    }
    if (this._pendingAmb !== undefined) { const k = this._pendingAmb; this._pendingAmb = undefined; this.ambience(k); }
  }
  _ensureGraph() {
    if (this._ctx) return this._ctx;
    const ctx = this._opts.context || audio.context;
    if (!ctx) return null;
    this._ctx = ctx;
    this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    const M = MUSIC_MIX, dest = this._opts.destination;
    this.band = new Band(this);
    // master: mix → compressor → trim → soft clip → out (mute/visibility) → music bus
    this.mix = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = M.compressor.threshold;
    this.comp.knee.value = M.compressor.knee;
    this.comp.ratio.value = M.compressor.ratio;
    this.comp.attack.value = M.compressor.attack;
    this.comp.release.value = M.compressor.release;
    this.trim = ctx.createGain(); this.trim.gain.value = M.trim;
    this.clip = ctx.createWaveShaper(); this.clip.curve = softClipCurve();
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.mix.connect(this.comp); this.comp.connect(this.trim); this.trim.connect(this.clip); this.clip.connect(this.out);
    this.out.connect(dest || audio.musicBus);
    // shared reverb: send → highpass → convolver → return → mix
    this.revIn = ctx.createGain();
    this.revHp = ctx.createBiquadFilter(); this.revHp.type = 'highpass'; this.revHp.frequency.value = M.reverb.highpass;
    this.reverb = ctx.createConvolver(); this.reverb.buffer = makeImpulse(ctx, M.reverb, hash(this._seed, 77));
    this.revOut = ctx.createGain(); this.revOut.gain.value = M.reverb.ret;
    this.revIn.connect(this.revHp); this.revHp.connect(this.reverb); this.reverb.connect(this.revOut); this.revOut.connect(this.mix);
    // ambience bus (SFX side: not affected by music volume/mute)
    this.ambOut = ctx.createGain(); this.ambOut.gain.value = 1;
    this.ambOut.connect(dest || audio.sfxBus);
    // shared vibrato LFO (cents)
    // three free-running vibrato LFOs at different rates; each voice taps one (±1 → cents per voice)
    this._vibOscs = []; this._vibs = []; this._vibK = 0;
    for (const rate of [4.9, 5.4, 5.9]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = rate; g.gain.value = 1; o.connect(g); o.start();
      this._vibOscs.push(o); this._vibs.push(g);
    }
    return ctx;
  }
  _longNoise() {
    if (!this._ln) {
      const c = this._ctx, len = Math.floor(c.sampleRate * 7), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0), r = rng32(hash(this._seed, 91));
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
      this._ln = b;
    }
    return this._ln;
  }
  _applyOut(tc = 0.08) {
    if (!this._ctx) return;
    const silent = this._muted || this._hidden || !this._unlocked;
    const v = silent ? 0 : (this._custom ? this._volume : 1);
    const t = this._now();
    this.out.gain.setTargetAtTime(v, t, tc);
    this.ambOut.gain.setTargetAtTime(this._hidden ? 0 : 1, t, tc);
  }
  /** Voice budget: reserve n voices for [start, end]. Low-priority notes are dropped when full. */
  _alloc(n, start, end, prio = 1) {
    if (prio < 2) {
      let busy = 0;
      for (const v of this._voices) if (v[0] <= start + 0.02 && v[1] > start) busy++;
      if (busy + n > MUSIC_MIX.maxVoices) { this._dropped++; return false; }
    }
    for (let k = 0; k < n; k++) this._voices.push([start, end]);
    return true;
  }
  _tick(now) {
    const horizon = now + MUSIC_MIX.lookaheadSec;
    for (const p of this._players) p.scheduleUntil(horizon, now);
    for (const a of this._amb) a.scheduleUntil(horizon, now);
    for (const p of this._players) {
      if (p.isStinger && !p.thenFired && now >= p.thenTime) {
        p.thenFired = true;
        if (this._current === p) this.play(p.then ?? null, { fade: MUSIC_MIX.afterStingerFadeSec });
      }
    }
    // Retire finished players. Offline, the virtual clock runs ahead of the render and a
    // disconnect can't be scheduled, so their teardown waits for destroy().
    const retire = (x) => { if (!x.isDone(now)) return true; if (this._offline) this._retired.push(x); else x.dispose(); return false; };
    this._players = this._players.filter(retire);
    this._amb = this._amb.filter(retire);
    let w = 0;
    const v = this._voices;
    for (let k = 0; k < v.length; k++) if (v[k][1] > now) v[w++] = v[k];
    v.length = w;
  }
  _kick() {
    if (this._offline || this._timer || this._hidden || !this._unlocked) return;
    const loop = () => {
      this._timer = null;
      if (this._hidden) return;
      try { this._tick(this._now()); } catch (e) { console.warn('[music] scheduler error', e); }
      if (this._players.length || this._amb.length) this._timer = setTimeout(loop, MUSIC_MIX.tickMs);
    };
    loop();
  }
  _visibility() {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden === this._hidden) return;
    this._hidden = hidden;
    if (!this._ctx) return;
    this._applyOut(hidden ? 0.08 : 0.4);
    if (hidden) { clearTimeout(this._timer); this._timer = null; return; }
    const t = this._now() + 0.1;
    for (const p of this._players) p.reanchor?.(t);
    for (const a of this._amb) a.reanchor(t);
    this._kick();
  }
  /** Offline helper: advance a virtual clock in scheduler-sized steps up to `until`. */
  _runUntil(from, until, setNow) {
    for (let t = from; t < until; t += MUSIC_MIX.tickMs / 1000) { setNow(t); this._tick(t); }
    setNow(until);
  }
}

/** The game's music director (shares Audio.js's AudioContext and buses). */
export const music = new MusicDirector();

/**
 * Render music/ambience into an AudioBuffer with an OfflineAudioContext
 * (tests, level checks, WAV export). Timeline entries call director methods
 * at virtual times, e.g. [{ at: 6, call: ['play', 'battle'] }, { at: 8, call: ['setIntensity', 1] }].
 * @returns {Promise<AudioBuffer>}
 */
export async function renderMusicOffline({ track = 'harbor', seconds = 20, sampleRate = 44100, intensity = 0.5, seed = 1234, ambience = null, region = 'caribbean', timeline = [], solo = null, volume = 1 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  let now = 0;
  const md = new MusicDirector({ context: ctx, destination: ctx.destination, storage: null, autoUnlock: false, seed, now: () => now, solo });
  await md.unlock();
  md.setVolume(volume);
  md.setRegion(region);
  md.setIntensity(intensity, true);
  if (track) md.play(track, { fade: 0.05 });
  if (ambience) md.ambience(ambience);
  let t = 0;
  for (const ev of [...timeline].sort((a, b) => a.at - b.at)) {
    md._runUntil(t, ev.at, (v) => { now = v; });
    t = ev.at;
    md[ev.call[0]](...ev.call.slice(1));
  }
  md._runUntil(t, seconds, (v) => { now = v; });
  const buf = await ctx.startRendering();
  md.destroy();
  return buf;
}
