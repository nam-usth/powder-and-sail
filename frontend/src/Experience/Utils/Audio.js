// ── Audio.js ────────────────────────────────────────────────────────
// Spatial SFX manager + the game's shared AudioContext and mix buses.
//
// One AudioContext for the whole game:
//
//   SFX recipes / mp3 buffers ─► (spatial gain) ─► sfx bus ───────────┐
//   ambience beds (MusicDirector) ─────────────────► sfx bus           ├─► master ─► soft clip ─► speakers
//   MusicDirector ─► music bus (music volume) ─► duck ─────────────────┘
//
// Features:
//   • Master / music / sfx volume (smoothed)
//   • Spatial attenuation from the camera position (audio.setCameraPos)
//   • Procedural SFX recipes (no files needed) + file-based AudioBuffers
//   • Layering: procedural "sweeteners" on top of file sounds — a rolling
//     tail on the mp3 cannon, a wood crunch on hull hits (see LAYERS;
//     toggle with audio.layering)
//   • Voice limiting: a per-type start budget so broadsides don't pile up
//   • Music ducking under big events (explosion, sink, warning)
//   • 'victory' / 'defeat' hand over to the music stingers when the
//     MusicDirector is running (setStingerHandler)
//
// Usage:
//   import { audio } from './Utils/Audio.js';
//   audio.play('cannon', { x: 10, y: 0, z: -20 });  // spatial sfx
//   audio.play('ui_click');                          // 2D sfx
//   audio.masterVolume = 0.6;
// Music + ambience: MusicDirector.js (`music.play('harbor')`).
// Sound direction: design/audio-direction.md

import { CANNON_SOUNDS, IMPACT_PROFILES, GUNFIRE_MIX } from '../../data/cannonSounds.js';

// ── Shared DSP resources (one set per AudioContext) ──────────────────
const _dsp = new WeakMap();
function dsp(ctx) {
  let d = _dsp.get(ctx);
  if (!d) _dsp.set(ctx, (d = {}));
  return d;
}

/** 2 s of white noise (mono), generated once per AudioContext and shared by every SFX/music voice. */
export function noiseBuffer(ctx) {
  const d = dsp(ctx);
  if (!d.white) {
    const len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), x = buf.getChannelData(0);
    let s = 0x9e3779b9;   // deterministic LCG → offline renders are reproducible
    for (let i = 0; i < len; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; x[i] = s / 2147483648 - 1; }
    d.white = buf;
  }
  return d.white;
}

/** 2 s of brown (red) noise — deep rumbles. */
export function brownBuffer(ctx) {
  const d = dsp(ctx);
  if (!d.brown) {
    const w = noiseBuffer(ctx).getChannelData(0), buf = ctx.createBuffer(1, w.length, ctx.sampleRate), x = buf.getChannelData(0);
    let b = 0, pk = 0;
    for (let i = 0; i < w.length; i++) { b = (b + 0.02 * w[i]) / 1.02; x[i] = b; pk = Math.max(pk, Math.abs(b)); }
    for (let i = 0; i < x.length; i++) x[i] *= 0.95 / (pk || 1);
    d.brown = buf;
  }
  return d.brown;
}

// ── Tiny synthesis helpers shared by the recipes ─────────────────────
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
function wire(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
/** Noise source starting at a random offset; loops when longer than the buffer. */
function noise(ctx, t, dur, buf = noiseBuffer(ctx)) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const room = buf.duration - dur - 0.02;
  if (room > 0) s.start(t, Math.random() * room); else { s.loop = true; s.start(t, Math.random() * buf.duration * 0.5); }
  s.stop(t + dur);
  return s;
}
function tone(ctx, type, f, t, end) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(end); return o; }
function filt(ctx, type, f, q, t) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.setValueAtTime(f, t); b.Q.value = q; return b; }
function vca(ctx, out) { const g = ctx.createGain(); g.gain.value = 0; g.connect(out); return g; }
/** Exponential percussive envelope: ~0 → peak in `a` s → ~0 after another `d` s. */
function hit(p, t, peak, a, d) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, 0.001));
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(a, 0.001) + d);
}
/** A train of decaying clicks on a gain param (splinters, crackle, gravel). */
function burst(p, t, n, peak, gap0, gap1, decay = 0.01) {
  p.setValueAtTime(0, t);
  let tt = t;
  for (let i = 0; i < n; i++) {
    p.setValueAtTime(peak * (1 - i / n) * (0.45 + Math.random() * 0.55), tt);
    p.setTargetAtTime(0, tt + 0.001, decay * (0.6 + Math.random()));
    tt += gap0 + Math.random() * (gap1 - gap0);
  }
}
/** Drum roll gated out of one noise source. */
function roll(p, t, dur, gap, v0, v1) {
  const k = Math.max(2, Math.floor(dur / gap));
  p.setValueAtTime(0, t);
  for (let i = 0; i < k; i++) {
    const tt = t + i * gap;
    p.setValueAtTime((v0 + (v1 - v0) * i / (k - 1)) * (i % 2 ? 0.8 : 1), tt);
    p.setTargetAtTime(0.0001, tt + 0.002, 0.012);
  }
}
let _drive = null;
function driveCurve() {
  if (!_drive) {
    _drive = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; _drive[i] = (Math.PI + 60) * x / (Math.PI + 60 * Math.abs(x)); }
  }
  return _drive;
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
/** Natural trumpet / sackbut note: two saws through a snapping lowpass, lip-up into pitch. */
function brass(ctx, out, t, m, dur, peak, o = {}) {
  const f = midi(m), end = t + dur + 0.25, a = o.a ?? 0.025;
  const lp = filt(ctx, 'lowpass', 400, 1.1, t);
  lp.frequency.exponentialRampToValueAtTime(o.bright ?? 3600, t + a + 0.01);
  lp.frequency.setTargetAtTime(o.body ?? 1600, t + a + 0.02, 0.12);
  const g = vca(ctx, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * 0.75, t + a + 0.03, 0.1);
  g.gain.setTargetAtTime(0, t + dur, 0.06);
  for (const det of [-6, 6]) {
    const s = tone(ctx, 'sawtooth', f * 0.98, t, end);
    s.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    s.detune.value = det;
    s.connect(lp);
  }
  lp.connect(g);
}
/** Natural horn: mellow call with a slow swell. */
function horn(ctx, out, t, m, dur, peak) {
  const f = midi(m), end = t + dur + 0.35;
  const lp = filt(ctx, 'lowpass', 300, 0.9, t);
  lp.frequency.linearRampToValueAtTime(1100, t + 0.15);
  lp.frequency.setTargetAtTime(800, t + 0.2, 0.2);
  const g = vca(ctx, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.12);
  g.gain.setValueAtTime(peak, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.08);
  const a = tone(ctx, 'sawtooth', f * 0.985, t, end);
  a.frequency.linearRampToValueAtTime(f, t + 0.12);
  const b = tone(ctx, 'triangle', f, t, end);
  b.detune.value = 5;
  a.connect(lp); b.connect(lp); lp.connect(g);
}
/** Kettledrum stroke (tuned partials + mallet). */
function timp(ctx, out, t, f, peak) {
  for (const [r, a, d] of [[1, 1, 1.6], [1.5, 0.45, 0.9], [1.98, 0.3, 0.6]]) {
    const s = tone(ctx, 'sine', f * r * 1.015, t, t + d + 0.05);
    s.frequency.exponentialRampToValueAtTime(f * r, t + 0.08);
    const g = vca(ctx, out); hit(g.gain, t, peak * a, 0.004, d); s.connect(g);
  }
  const n = noise(ctx, t, 0.05), lp = filt(ctx, 'lowpass', 900, 0.7, t), g = vca(ctx, out);
  hit(g.gain, t, peak * 0.4, 0.001, 0.03); wire(n, lp, g);
}
/** Bronze bell (ship's bell / handbell): inharmonic partials with long decays. */
const BELL = [[0.5, 0.35, 3.2], [1, 0.55, 2.6], [1.19, 0.4, 2.0], [1.5, 0.22, 1.4], [2, 0.6, 1.8], [2.52, 0.22, 1.0], [3.01, 0.16, 0.8], [4.17, 0.08, 0.5]];
function bell(ctx, out, t, f, peak, decay = 1) {
  for (const [r, a, d] of BELL) {
    const s = tone(ctx, 'sine', f * r, t, t + d * decay + 0.05), g = vca(ctx, out);
    hit(g.gain, t, peak * a, 0.002, d * decay); s.connect(g);
  }
  const n = noise(ctx, t, 0.03), bp = filt(ctx, 'bandpass', 3800, 1.2, t), g = vca(ctx, out);
  hit(g.gain, t, peak * 0.5, 0.001, 0.02); wire(n, bp, g);
}
/** Coin / small metal clink. */
function clink(ctx, out, t, f, peak) {
  for (const [r, a, d] of [[1, 1, 0.28], [2.71, 0.45, 0.14], [4.95, 0.22, 0.07]]) {
    const s = tone(ctx, 'sine', f * r, t, t + d + 0.05), g = vca(ctx, out);
    hit(g.gain, t, peak * a, 0.001, d); s.connect(g);
  }
  const n = noise(ctx, t, 0.02), hp = filt(ctx, 'highpass', 6000, 0.7, t), g = vca(ctx, out);
  hit(g.gain, t, peak * 0.4, 0.001, 0.012); wire(n, hp, g);
}

// ── Synthetic sound recipes ──────────────────────────────────────────
// Each recipe is (ctx, out, t, o) → duration in seconds. `out` is a gain at
// the call's volume; `o.rate` scales pitch (playbackRate / random variation).
const SYNTH = {
  /** Cannon (used when the cannon mp3 isn't loaded): crack + grit + boom + body + rolling tail. */
  cannon(ctx, out, t, o) {
    const r = o.rate;
    const c = noise(ctx, t, 0.14), chp = filt(ctx, 'highpass', 1700 * r, 0.8, t), cg = vca(ctx, out);
    hit(cg.gain, t, 0.5, 0.001, 0.08); wire(c, chp, cg);
    const s = tone(ctx, 'sawtooth', 170 * r, t, t + 0.16);
    s.frequency.exponentialRampToValueAtTime(42 * r, t + 0.13);
    const ws = ctx.createWaveShaper(); ws.curve = driveCurve();
    const sg = vca(ctx, out); hit(sg.gain, t, 0.12, 0.002, 0.12); wire(s, ws, sg);
    const b = tone(ctx, 'sine', 105 * r, t, t + 0.95);
    b.frequency.exponentialRampToValueAtTime(33 * r, t + 0.5);
    const bg = vca(ctx, out); hit(bg.gain, t, 0.8, 0.003, 0.8); b.connect(bg);
    const n = noise(ctx, t, 1.0), lp = filt(ctx, 'lowpass', 1200 * r, 0.9, t);
    lp.frequency.exponentialRampToValueAtTime(130 * r, t + 0.7);
    const ng = vca(ctx, out); hit(ng.gain, t, 0.5, 0.003, 0.85); wire(n, lp, ng);
    return Math.max(1.0, SYNTH.cannon_tail(ctx, out, t + 0.03, o));
  },
  /** Rolling tail of a cannon over open water (layered on the mp3 cannon). */
  cannon_tail(ctx, out, t, o) {
    const r = o.rate;
    const n = noise(ctx, t, 2.6, brownBuffer(ctx)), lp = filt(ctx, 'lowpass', 280 * r, 0.7, t);
    lp.frequency.exponentialRampToValueAtTime(80 * r, t + 2.4);
    const g = vca(ctx, out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42, t + 0.14);
    g.gain.setTargetAtTime(0, t + 0.18, 0.5);
    wire(n, lp, g);
    for (const [d, v, f] of [[0.23, 0.08, 650], [0.52, 0.04, 520]]) {   // slaps back off the shore
      const e = noise(ctx, t + d, 0.3), bp = filt(ctx, 'bandpass', f * r, 0.8, t + d), eg = vca(ctx, out);
      hit(eg.gain, t + d, v, 0.008, 0.25); wire(e, bp, eg);
    }
    return 2.6;
  },
  /** Swivel-gun pop (legacy name). */
  fire(ctx, out, t, o) {
    const r = o.rate * 1.3;
    const c = noise(ctx, t, 0.1), chp = filt(ctx, 'highpass', 2000 * r, 0.8, t), cg = vca(ctx, out);
    hit(cg.gain, t, 0.4, 0.001, 0.06); wire(c, chp, cg);
    const b = tone(ctx, 'sine', 120 * r, t, t + 0.5);
    b.frequency.exponentialRampToValueAtTime(40 * r, t + 0.3);
    const bg = vca(ctx, out); hit(bg.gain, t, 0.5, 0.003, 0.4); b.connect(bg);
    const n = noise(ctx, t, 0.5), lp = filt(ctx, 'lowpass', 1500 * r, 0.8, t);
    lp.frequency.exponentialRampToValueAtTime(200 * r, t + 0.35);
    const ng = vca(ctx, out); hit(ng.gain, t, 0.3, 0.003, 0.4); wire(n, lp, ng);
    return 0.6;
  },
  /** Powder-magazine blast: thump + roaring noise + crackle + debris raining into the sea. */
  explosion(ctx, out, t, o) {
    const r = o.rate;
    const b = tone(ctx, 'sine', 92 * r, t, t + 1.4);
    b.frequency.exponentialRampToValueAtTime(27 * r, t + 0.9);
    const bg = vca(ctx, out); hit(bg.gain, t, 0.7, 0.004, 1.15); b.connect(bg);
    const n = noise(ctx, t, 1.9), lp = filt(ctx, 'lowpass', 5200 * r, 0.6, t);
    lp.frequency.exponentialRampToValueAtTime(240 * r, t + 1.3);
    const ng = vca(ctx, out); hit(ng.gain, t, 0.45, 0.003, 1.6); wire(n, lp, ng);
    const rb = noise(ctx, t, 2.2, brownBuffer(ctx)), rl = filt(ctx, 'lowpass', 160, 0.7, t), rg = vca(ctx, out);
    rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(0.35, t + 0.1); rg.gain.setTargetAtTime(0, t + 0.3, 0.45);
    wire(rb, rl, rg);
    const k = noise(ctx, t + 0.08, 1.5), kb = filt(ctx, 'bandpass', 2600 * r, 2.2, t), kg = vca(ctx, out);
    burst(kg.gain, t + 0.1, 12, 0.14, 0.025, 0.11, 0.012); wire(k, kb, kg);
    for (let i = 0; i < 3; i++) {
      const d = 0.75 + Math.random() * 0.8, e = noise(ctx, t + d, 0.3), bp = filt(ctx, 'bandpass', (1200 + Math.random() * 900) * r, 1.0, t + d), eg = vca(ctx, out);
      hit(eg.gain, t + d, 0.05, 0.01, 0.22); wire(e, bp, eg);
    }
    return 2.3;
  },
  /** Oak planking splintering under a ball (layered on hull hits). */
  wood_crunch(ctx, out, t, o) {
    const r = o.rate;
    const k = tone(ctx, 'triangle', 200 * r, t, t + 0.14);
    k.frequency.exponentialRampToValueAtTime(80 * r, t + 0.1);
    const kg = vca(ctx, out); hit(kg.gain, t, 0.42, 0.002, 0.1); k.connect(kg);
    const kn = noise(ctx, t, 0.08), kb = filt(ctx, 'bandpass', 950 * r, 1.3, t), kng = vca(ctx, out);
    hit(kng.gain, t, 0.32, 0.001, 0.06); wire(kn, kb, kng);
    const sp = noise(ctx, t, 0.45), sb = filt(ctx, 'bandpass', 3200 * r, 2.4, t);
    sb.frequency.exponentialRampToValueAtTime(1300 * r, t + 0.32);
    const sg = vca(ctx, out); burst(sg.gain, t + 0.006, 11 + ((Math.random() * 6) | 0), 0.34, 0.01, 0.035, 0.008); wire(sp, sb, sg);
    const c = tone(ctx, 'sawtooth', 96 * r, t + 0.03, t + 0.4);
    c.frequency.exponentialRampToValueAtTime(60 * r, t + 0.32);
    const cb = filt(ctx, 'bandpass', 640 * r, 4, t), cg = vca(ctx, out); hit(cg.gain, t + 0.03, 0.08, 0.02, 0.28); wire(c, cb, cg);
    return 0.6;
  },
  /** Shot falling into the sea: plunge + spray + bloop + droplets. */
  splash(ctx, out, t, o) {
    const r = o.rate;
    const n = noise(ctx, t, 0.5), bp = filt(ctx, 'bandpass', 380 * r, 1.1, t);
    bp.frequency.exponentialRampToValueAtTime(1900 * r, t + 0.16);
    const g1 = vca(ctx, out); hit(g1.gain, t, 0.36, 0.006, 0.36); wire(n, bp, g1);
    const n2 = noise(ctx, t + 0.02, 0.8), hp = filt(ctx, 'highpass', 3200 * r, 0.7, t), g2 = vca(ctx, out);
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.14, t + 0.06); g2.gain.setTargetAtTime(0, t + 0.1, 0.16);
    wire(n2, hp, g2);
    const s = tone(ctx, 'sine', 320 * r, t, t + 0.2);
    s.frequency.exponentialRampToValueAtTime(110 * r, t + 0.13);
    const g3 = vca(ctx, out); hit(g3.gain, t, 0.15, 0.004, 0.14); s.connect(g3);
    for (let i = 0; i < 6; i++) {
      const d = 0.12 + Math.random() * 0.55, f = (1300 + Math.random() * 1700) * r;
      const dr = tone(ctx, 'sine', f, t + d, t + d + 0.05);
      dr.frequency.exponentialRampToValueAtTime(f * 1.6, t + d + 0.035);
      const gd = vca(ctx, out); hit(gd.gain, t + d, 0.03 * (1 - d), 0.002, 0.03); dr.connect(gd);
    }
    return 1.0;
  },
  /** Shot thudding into an island: earth thump + dirt + gravel. */
  impact(ctx, out, t, o) {
    const r = o.rate;
    const s = tone(ctx, 'sine', 130 * r, t, t + 0.35);
    s.frequency.exponentialRampToValueAtTime(48 * r, t + 0.22);
    const g1 = vca(ctx, out); hit(g1.gain, t, 0.3, 0.003, 0.28); s.connect(g1);
    const n = noise(ctx, t, 0.4), lp = filt(ctx, 'lowpass', 900 * r, 0.8, t);
    lp.frequency.exponentialRampToValueAtTime(200 * r, t + 0.3);
    const g2 = vca(ctx, out); hit(g2.gain, t, 0.22, 0.003, 0.3); wire(n, lp, g2);
    const gr = noise(ctx, t + 0.04, 0.35), bp = filt(ctx, 'bandpass', 2400 * r, 1.2, t), g3 = vca(ctx, out);
    burst(g3.gain, t + 0.05, 8, 0.1, 0.015, 0.04, 0.008); wire(gr, bp, g3);
    return 0.6;
  },
  /** A ship going down: hull groan, rushing water, a falling sweep, bubbles. */
  sink(ctx, out, t, o) {
    const r = o.rate;
    const bp = filt(ctx, 'bandpass', 420 * r, 3.5, t);
    bp.frequency.linearRampToValueAtTime(260 * r, t + 2.4);
    const gg = vca(ctx, out);
    gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.22, t + 0.35); gg.gain.setTargetAtTime(0, t + 1.6, 0.35);
    bp.connect(gg);
    for (const det of [0, 14]) {
      const s = tone(ctx, 'sawtooth', 62 * r, t, t + 2.9);
      s.detune.value = det;
      s.frequency.linearRampToValueAtTime(41 * r, t + 2.4);
      s.connect(bp);
    }
    const n = noise(ctx, t, 3.2), lp = filt(ctx, 'lowpass', 500 * r, 0.7, t);
    lp.frequency.linearRampToValueAtTime(1300 * r, t + 0.9);
    lp.frequency.linearRampToValueAtTime(400 * r, t + 3.0);
    const gw = vca(ctx, out);
    gw.gain.setValueAtTime(0, t); gw.gain.linearRampToValueAtTime(0.26, t + 0.8); gw.gain.setTargetAtTime(0, t + 1.5, 0.5);
    wire(n, lp, gw);
    const sw = tone(ctx, 'sine', 300 * r, t, t + 1.3);
    sw.frequency.exponentialRampToValueAtTime(32 * r, t + 1.2);
    const gs = vca(ctx, out); hit(gs.gain, t, 0.22, 0.01, 1.15); sw.connect(gs);
    for (let i = 0; i < 14; i++) {
      const d = 0.5 + Math.random() * 2.3, f = (220 + Math.random() * 380) * r;
      const b = tone(ctx, 'sine', f, t + d, t + d + 0.09);
      b.frequency.exponentialRampToValueAtTime(f * 2.2, t + d + 0.07);
      const gb = vca(ctx, out); hit(gb.gain, t + d, 0.05 * (0.6 + Math.random() * 0.4), 0.004, 0.07); b.connect(gb);
    }
    return 3.3;
  },
  /** Construction complete: a natural-trumpet flourish (D-harmonic notes) + bell sparkle. */
  build(ctx, out, t) {
    [[69, 0.00, 0.1], [74, 0.085, 0.1], [78, 0.17, 0.11]].forEach(([m, d, l]) => brass(ctx, out, t + d, m, l, 0.055));
    brass(ctx, out, t + 0.26, 81, 0.48, 0.065, { body: 1900 });
    brass(ctx, out, t + 0.26, 74, 0.48, 0.03);
    brass(ctx, out, t + 0.26, 78, 0.48, 0.03);
    bell(ctx, out, t + 0.26, midi(93) / 2, 0.02, 0.5);
    return 1.2;
  },
  build_complete(ctx, out, t, o) { return SYNTH.build(ctx, out, t, o); },
  /** Hammer and nail: three blows, the nail ringing a little higher as it sinks. */
  build_hammer(ctx, out, t, o) {
    const r = o.rate;
    [[0, 0.8], [0.27, 0.9], [0.52, 1.0]].forEach(([d, v], i) => {
      const tt = t + d + Math.random() * 0.02;   // humanise forward only (start times can't be negative)
      const s = tone(ctx, 'sine', 210 * r, tt, tt + 0.12);
      s.frequency.exponentialRampToValueAtTime(120 * r, tt + 0.06);
      const sg = vca(ctx, out); hit(sg.gain, tt, 0.3 * v, 0.002, 0.08); s.connect(sg);
      const n = noise(ctx, tt, 0.06), bp = filt(ctx, 'bandpass', 1500 * r, 1.6, tt), ng = vca(ctx, out);
      hit(ng.gain, tt, 0.3 * v, 0.001, 0.045); wire(n, bp, ng);
      const pf = (2700 + i * 160) * r;
      for (const [k, a] of [[1, 0.06], [1.52, 0.03]]) {
        const p = tone(ctx, 'sine', pf * k, tt, tt + 0.14), pg = vca(ctx, out);
        hit(pg.gain, tt, a * v, 0.001, 0.12); p.connect(pg);
      }
    });
    return 0.8;
  },
  /** Research done: three handbells. */
  research(ctx, out, t) {
    [86, 90, 93].forEach((m, i) => bell(ctx, out, t + i * 0.1, midi(m) / 2, 0.06, 0.45));
    return 1.6;
  },
  /** Victory (SFX fallback when the music stinger isn't running): trumpets + kettledrums in D. */
  victory(ctx, out, t) {
    timp(ctx, out, t, midi(45), 0.35);
    [[69, 0.0], [74, 0.13], [78, 0.26]].forEach(([m, d]) => brass(ctx, out, t + d, m, 0.12, 0.065));
    brass(ctx, out, t + 0.4, 81, 0.9, 0.075, { body: 2000 });
    [62, 66, 69].forEach((m) => brass(ctx, out, t + 0.4, m, 0.9, 0.03));
    timp(ctx, out, t + 0.4, midi(50), 0.45);
    return 1.8;
  },
  /** Defeat (SFX fallback): descending sackbuts + muffled drum. */
  defeat(ctx, out, t) {
    [[57, 0.0, 0.42], [53, 0.45, 0.42], [50, 0.9, 1.1]].forEach(([m, d, l]) => brass(ctx, out, t + d, m, l, 0.07, { bright: 1400, body: 700 }));
    [38, 45].forEach((m) => brass(ctx, out, t + 0.9, m, 1.1, 0.04, { bright: 900, body: 500 }));
    timp(ctx, out, t, midi(38), 0.4); timp(ctx, out, t + 0.9, midi(38), 0.5);
    return 2.4;
  },
  /** Attack warning — "beat to quarters": side-drum roll + two urgent horn blasts. */
  warning(ctx, out, t) {
    const n = noise(ctx, t, 0.62), bp = filt(ctx, 'bandpass', 2700, 0.8, t), g = vca(ctx, out);
    roll(g.gain, t, 0.58, 0.045, 0.05, 0.22); wire(n, bp, g);
    for (const [d, len] of [[0.05, 0.26], [0.42, 0.4]]) {
      brass(ctx, out, t + d, 57, len, 0.06, { bright: 2400, body: 1300 });
      brass(ctx, out, t + d, 58, len, 0.05, { bright: 2400, body: 1300 });
    }
    return 1.0;
  },
  /** Gold: coins clinking onto the pile. */
  coin(ctx, out, t, o) {
    const r = o.rate;
    clink(ctx, out, t, 2350 * r, 0.15);
    clink(ctx, out, t + 0.075, 2950 * r, 0.1);
    if (Math.random() < 0.6) clink(ctx, out, t + 0.16, 2600 * r, 0.055);
    return 0.5;
  },
  /** UI click: a small wooden "tock". */
  ui_click(ctx, out, t, o) {
    const r = o.rate;
    const s = tone(ctx, 'sine', 1500 * r, t, t + 0.06);
    s.frequency.exponentialRampToValueAtTime(850 * r, t + 0.025);
    const g = vca(ctx, out); hit(g.gain, t, 0.15, 0.001, 0.04); s.connect(g);
    const n = noise(ctx, t, 0.02), bp = filt(ctx, 'bandpass', 3400 * r, 1.4, t), ng = vca(ctx, out);
    hit(ng.gain, t, 0.07, 0.001, 0.008); wire(n, bp, ng);
    return 0.08;
  },
  /** UI hover: the faintest tick. */
  ui_hover(ctx, out, t, o) {
    const s = tone(ctx, 'sine', 2400 * o.rate, t, t + 0.04), g = vca(ctx, out);
    hit(g.gain, t, 0.03, 0.003, 0.025); s.connect(g);
    return 0.05;
  },
  /** Set sail: bosun's pipe, a natural-horn call (harmonics 2-3-4 in D), canvas filling with wind. */
  set_sail(ctx, out, t) {
    const p = tone(ctx, 'sine', 1650, t, t + 0.62);
    p.frequency.linearRampToValueAtTime(2250, t + 0.28);
    p.frequency.setValueAtTime(2250, t + 0.42);
    p.frequency.linearRampToValueAtTime(1950, t + 0.6);
    const tr = tone(ctx, 'sine', 15, t, t + 0.62), tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(70, t + 0.3);
    tr.connect(tg); tg.connect(p.frequency);
    const pg = vca(ctx, out);
    pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(0.05, t + 0.05); pg.gain.setValueAtTime(0.05, t + 0.5); pg.gain.linearRampToValueAtTime(0, t + 0.6);
    p.connect(pg);
    horn(ctx, out, t + 0.6, 50, 0.3, 0.08);
    horn(ctx, out, t + 0.95, 57, 0.3, 0.08);
    horn(ctx, out, t + 1.3, 62, 0.95, 0.085);
    const n = noise(ctx, t + 0.5, 1.8), bp = filt(ctx, 'bandpass', 420, 0.7, t), am = ctx.createGain(), fg = vca(ctx, out);
    am.gain.value = 0.6;
    const lfo = tone(ctx, 'triangle', 7, t + 0.5, t + 2.3), lg = ctx.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(am.gain);
    fg.gain.setValueAtTime(0, t + 0.5); fg.gain.linearRampToValueAtTime(0.06, t + 0.9); fg.gain.setTargetAtTime(0, t + 1.6, 0.25);
    wire(n, bp, am, fg);
    return 2.6;
  },
  /**
   * Parametric gun (data/cannonSounds.js): report, calibre boom, bark, powder
   * blast, chest thud, rolling tail, shore slaps, ball whistle, tackle rattle,
   * mortar tube resonance, grapeshot scatter. `o.p` is the gun's profile.
   */
  gun(ctx, out, t, o) {
    const p = o.p || CANNON_SOUNDS.default, r = o.rate, J = () => 0.85 + Math.random() * 0.3;
    let dur = 0.6;
    const [nPops, gap] = p.pops || [1, 0];
    for (let k = 0; k < nPops; k++) {
      const tk = t + k * gap * (0.9 + Math.random() * 0.2), kv = k ? 0.8 : 1;
      if (p.crack) {
        const [hp, lv, dc] = p.crack;
        const c = noise(ctx, tk, dc + 0.1), f = filt(ctx, 'highpass', hp * r * J(), 0.8, tk), g = vca(ctx, out);
        hit(g.gain, tk, lv * kv * J(), 0.001, dc); wire(c, f, g);
      }
      if (p.boom) {
        const [f0, f1, lv, dc] = p.boom;
        const b = tone(ctx, 'sine', f0 * r, tk, tk + dc + 0.1);
        b.frequency.exponentialRampToValueAtTime(f1 * r, tk + dc * 0.6);
        const g = vca(ctx, out); hit(g.gain, tk, lv * kv, 0.003, dc); b.connect(g);
      }
      if (p.grit) {
        const [f0, lv] = p.grit;
        const s = tone(ctx, 'sawtooth', f0 * r, tk, tk + 0.18);
        s.frequency.exponentialRampToValueAtTime(f0 * 0.25 * r, tk + 0.14);
        const ws = ctx.createWaveShaper(); ws.curve = driveCurve();
        const g = vca(ctx, out); hit(g.gain, tk, lv * kv * J(), 0.002, 0.13); wire(s, ws, g);
      }
      if (p.body) {
        const [l0, l1, lv, dc] = p.body;
        const n = noise(ctx, tk, dc + 0.15), lp = filt(ctx, 'lowpass', l0 * r * J(), 0.9, tk);
        lp.frequency.exponentialRampToValueAtTime(l1 * r, tk + dc * 0.85);
        const g = vca(ctx, out); hit(g.gain, tk, lv * kv, 0.003, dc); wire(n, lp, g);
      }
    }
    if (p.thud) {
      const [f, lv] = p.thud;
      const s = tone(ctx, 'sine', f * 1.6 * r, t, t + 0.5);
      s.frequency.exponentialRampToValueAtTime(f * r, t + 0.06);
      const g = vca(ctx, out); hit(g.gain, t, lv, 0.002, 0.42); s.connect(g);
    }
    if (p.hollow) {   // mortar: the tube rings — a resonant, pitch-sagging "thoomp"
      const [f, lv] = p.hollow;
      const s = tone(ctx, 'sine', f * 1.25 * r, t, t + 0.5);
      s.frequency.exponentialRampToValueAtTime(f * 0.72 * r, t + 0.32);
      const g = vca(ctx, out); hit(g.gain, t, lv, 0.012, 0.36); s.connect(g);
      const n = noise(ctx, t, 0.5), bp = filt(ctx, 'bandpass', f * 2 * r, 7, t), ng = vca(ctx, out);
      bp.frequency.exponentialRampToValueAtTime(f * 1.3 * r, t + 0.3);
      hit(ng.gain, t, lv * 1.4, 0.01, 0.32); wire(n, bp, ng);
    }
    if (p.tail) {
      const [len, lv, lpf] = p.tail;
      const n = noise(ctx, t + 0.03, len, brownBuffer(ctx)), lp = filt(ctx, 'lowpass', lpf * r, 0.7, t);
      lp.frequency.exponentialRampToValueAtTime(70 * r, t + len * 0.9);
      const g = vca(ctx, out);
      g.gain.setValueAtTime(0, t + 0.03);
      g.gain.linearRampToValueAtTime(lv * J(), t + 0.17);
      g.gain.setTargetAtTime(0, t + 0.22, len / 5);
      wire(n, lp, g);
      dur = Math.max(dur, len + 0.1);
    }
    for (let i = 0; i < (p.echo || 0); i++) {   // slaps back off shore / hulls
      const d = 0.2 + i * 0.27 + Math.random() * 0.12, v = 0.09 / (1 + i * 0.7), f = (700 - i * 120) * r;
      const e = noise(ctx, t + d, 0.32), bp = filt(ctx, 'bandpass', f, 0.8, t + d), g = vca(ctx, out);
      hit(g.gain, t + d, v, 0.01, 0.26); wire(e, bp, g);
      dur = Math.max(dur, d + 0.4);
    }
    if (p.whistle) {   // roundshot tearing away from the muzzle (Doppler fall)
      const [f0, f1, lv, len] = p.whistle, t0 = t + 0.05;
      const s = tone(ctx, 'sine', f0 * r, t0, t0 + len + 0.05);
      s.frequency.exponentialRampToValueAtTime(f1 * r, t0 + len);
      const g = vca(ctx, out);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(lv, t0 + 0.06); g.gain.setTargetAtTime(0, t0 + len * 0.45, len / 4);
      s.connect(g);
      const n = noise(ctx, t0, len), bp = filt(ctx, 'bandpass', f0 * r, 9, t0), ng = vca(ctx, out);
      bp.frequency.exponentialRampToValueAtTime(f1 * r, t0 + len);
      ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(lv * 2.2, t0 + 0.06); ng.gain.setTargetAtTime(0, t0 + len * 0.45, len / 4);
      wire(n, bp, ng);
    }
    if (p.rattle) {   // carriage slams back on its breeching, tackle and loose gear rattle
      const n = noise(ctx, t + 0.09, 0.6), bp = filt(ctx, 'bandpass', 1700 * r, 1.6, t), g = vca(ctx, out);
      burst(g.gain, t + 0.1, 12 + ((Math.random() * 6) | 0), p.rattle * 2, 0.018, 0.05, 0.012); wire(n, bp, g);
      const k = tone(ctx, 'triangle', 150 * r, t + 0.14, t + 0.3);
      k.frequency.exponentialRampToValueAtTime(70 * r, t + 0.26);
      const kg = vca(ctx, out); hit(kg.gain, t + 0.14, p.rattle * 2.5, 0.002, 0.12); k.connect(kg);
    }
    if (p.scatter) {   // grapeshot: the charge spreads — a hiss and a spray of balls
      const n = noise(ctx, t + 0.02, 0.5), hp = filt(ctx, 'highpass', 3000 * r, 0.7, t), g = vca(ctx, out);
      g.gain.setValueAtTime(0, t + 0.02); g.gain.linearRampToValueAtTime(p.scatter, t + 0.05); g.gain.setTargetAtTime(0, t + 0.08, 0.11);
      wire(n, hp, g);
      for (let i = 0; i < 9; i++) {
        const d = 0.06 + Math.random() * 0.3, f = (2400 + Math.random() * 2600) * r;
        const s = tone(ctx, 'sine', f, t + d, t + d + 0.08);
        s.frequency.exponentialRampToValueAtTime(f * 0.7, t + d + 0.07);
        const sg = vca(ctx, out); hit(sg.gain, t + d, p.scatter * 0.12, 0.004, 0.06); s.connect(sg);
      }
    }
    return dur;
  },
  /** Chain shot in flight: two balls and a chain whirling — a pulsing whirr. `o.len` = time of flight. */
  chain_flight(ctx, out, t, o) {
    const len = Math.max(0.3, Math.min(3, o.len || 1)), r = o.rate, rot = (11 + Math.random() * 5) * r;
    const n = noise(ctx, t, len + 0.1), bp = filt(ctx, 'bandpass', 520 * r, 3, t), am = ctx.createGain(), g = vca(ctx, out);
    bp.frequency.linearRampToValueAtTime(380 * r, t + len);
    am.gain.value = 0.5;
    const lfo = tone(ctx, 'sine', rot, t, t + len + 0.1), lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + len * 0.7); g.gain.linearRampToValueAtTime(0.0, t + len);
    wire(n, bp, am, g);
    const s = tone(ctx, 'triangle', 210 * r, t, t + len + 0.05), sa = ctx.createGain(), sg = vca(ctx, out);
    sa.gain.value = 0.5; lg.connect(sa.gain);
    s.frequency.linearRampToValueAtTime(170 * r, t + len);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.05, t + len * 0.7); sg.gain.linearRampToValueAtTime(0, t + len);
    wire(s, sa, sg);
    return len + 0.1;
  },
  /** Mortar shell coming down: a falling whistle over the last ~1.2 s of flight. */
  shell_whistle(ctx, out, t, o) {
    const len = Math.max(0.4, Math.min(1.4, o.len || 1)), r = o.rate;
    const s = tone(ctx, 'sine', 1900 * r, t, t + len);
    s.frequency.exponentialRampToValueAtTime(620 * r, t + len);
    const g = vca(ctx, out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + len * 0.8); g.gain.linearRampToValueAtTime(0, t + len);
    s.connect(g);
    const n = noise(ctx, t, len), bp = filt(ctx, 'bandpass', 1900 * r, 6, t), ng = vca(ctx, out);
    bp.frequency.exponentialRampToValueAtTime(620 * r, t + len);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.16, t + len * 0.8); ng.gain.linearRampToValueAtTime(0, t + len);
    wire(n, bp, ng);
    return len;
  },
  /** Small shot on planking: a knock and a few splinters. */
  wood_knock(ctx, out, t, o) {
    const r = o.rate;
    const k = tone(ctx, 'triangle', 330 * r, t, t + 0.1);
    k.frequency.exponentialRampToValueAtTime(150 * r, t + 0.07);
    const kg = vca(ctx, out); hit(kg.gain, t, 0.36, 0.001, 0.07); k.connect(kg);
    const sp = noise(ctx, t, 0.22), sb = filt(ctx, 'bandpass', 3600 * r, 2.2, t), sg = vca(ctx, out);
    burst(sg.gain, t + 0.004, 5 + ((Math.random() * 3) | 0), 0.22, 0.01, 0.03, 0.006); wire(sp, sb, sg);
    return 0.3;
  },
  /** Shot on masonry: a hard crack and falling chips. */
  stone_chip(ctx, out, t, o) {
    const r = o.rate;
    const c = noise(ctx, t, 0.08), bp = filt(ctx, 'bandpass', 2200 * r, 1.4, t), cg = vca(ctx, out);
    hit(cg.gain, t, 0.4, 0.001, 0.05); wire(c, bp, cg);
    const s = tone(ctx, 'sine', 160 * r, t, t + 0.25);
    s.frequency.exponentialRampToValueAtTime(60 * r, t + 0.18);
    const sg = vca(ctx, out); hit(sg.gain, t, 0.3, 0.002, 0.2); s.connect(sg);
    const gr = noise(ctx, t + 0.05, 0.7), gb = filt(ctx, 'bandpass', 3000 * r, 1.4, t), gg = vca(ctx, out);
    burst(gg.gain, t + 0.08, 12, 0.12, 0.02, 0.06, 0.008); wire(gr, gb, gg);
    return 0.8;
  },
  /** Sub-bass chest thud under heavy impacts. */
  heavy_thud(ctx, out, t, o) {
    const r = o.rate;
    const s = tone(ctx, 'sine', 70 * r, t, t + 0.6);
    s.frequency.exponentialRampToValueAtTime(34 * r, t + 0.25);
    const g = vca(ctx, out); hit(g.gain, t, 0.6, 0.003, 0.5); s.connect(g);
    return 0.6;
  },
  /** Chain shot through the rigging: ropes parting, canvas ripping, a spar cracking. */
  rig_tear(ctx, out, t, o) {
    const r = o.rate;
    for (let i = 0; i < 3; i++) {   // ropes snapping
      const d = i * (0.03 + Math.random() * 0.05), c = noise(ctx, t + d, 0.04), hp = filt(ctx, 'highpass', 2800 * r, 1, t + d), g = vca(ctx, out);
      hit(g.gain, t + d, 0.3, 0.001, 0.025); wire(c, hp, g);
    }
    const n = noise(ctx, t + 0.02, 0.5), bp = filt(ctx, 'bandpass', 1400 * r, 1.4, t), am = ctx.createGain(), g = vca(ctx, out);
    bp.frequency.exponentialRampToValueAtTime(3600 * r, t + 0.4);   // canvas rip: rising, gritty
    am.gain.value = 0.5;
    const lfo = tone(ctx, 'square', 55 * r, t, t + 0.55), lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    g.gain.setValueAtTime(0, t + 0.02); g.gain.linearRampToValueAtTime(0.32, t + 0.08); g.gain.setTargetAtTime(0, t + 0.3, 0.06);
    wire(n, bp, am, g);
    const k = tone(ctx, 'triangle', 180 * r, t + 0.05, t + 0.25);   // spar crack
    k.frequency.exponentialRampToValueAtTime(70 * r, t + 0.2);
    const kg = vca(ctx, out); hit(kg.gain, t + 0.05, 0.3, 0.002, 0.14); k.connect(kg);
    return 0.7;
  },
  /** Chain links rattling on stone. */
  chain_clank(ctx, out, t, o) {
    const r = o.rate;
    for (let i = 0; i < 5; i++) clink(ctx, out, t + i * (0.03 + Math.random() * 0.04), (900 + Math.random() * 500) * r, 0.08 * (1 - i / 6));
    return 0.6;
  },
  /** Grapeshot peppering wood: a scatter of small knocks. */
  pepper(ctx, out, t, o) {
    const r = o.rate, n = 10 + ((Math.random() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const d = Math.random() * 0.22, f = (420 + Math.random() * 380) * r;
      const k = tone(ctx, 'triangle', f, t + d, t + d + 0.05);
      k.frequency.exponentialRampToValueAtTime(f * 0.5, t + d + 0.04);
      const kg = vca(ctx, out); hit(kg.gain, t + d, 0.16 * (0.5 + Math.random() * 0.5), 0.001, 0.035); k.connect(kg);
    }
    const sp = noise(ctx, t, 0.35), sb = filt(ctx, 'bandpass', 3300 * r, 2, t), sg = vca(ctx, out);
    burst(sg.gain, t + 0.01, 10, 0.18, 0.012, 0.03, 0.006); wire(sp, sb, sg);
    return 0.45;
  },
  /** Grapeshot into the sea: a fizz of small plops across the water. */
  pepper_splash(ctx, out, t, o) {
    const r = o.rate, n = 9 + ((Math.random() * 6) | 0);
    for (let i = 0; i < n; i++) {
      const d = Math.random() * 0.25, f = (600 + Math.random() * 700) * r;
      const s = tone(ctx, 'sine', f, t + d, t + d + 0.06);
      s.frequency.exponentialRampToValueAtTime(f * 1.8, t + d + 0.05);
      const g = vca(ctx, out); hit(g.gain, t + d, 0.06, 0.002, 0.045); s.connect(g);
    }
    const nn = noise(ctx, t, 0.6), bp = filt(ctx, 'highpass', 2500 * r, 0.7, t), g = vca(ctx, out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.05); g.gain.setTargetAtTime(0, t + 0.15, 0.12);
    wire(nn, bp, g);
    return 0.7;
  },
  /** Mortar shell bursting in the sea: underwater thump, a tall plume, water raining back. */
  mortar_splash(ctx, out, t, o) {
    const r = o.rate;
    SYNTH.heavy_thud(ctx, out, t, { rate: 0.8 * r });
    const n = noise(ctx, t, 0.9), lp = filt(ctx, 'lowpass', 300 * r, 0.8, t), g = vca(ctx, out);
    lp.frequency.exponentialRampToValueAtTime(2400 * r, t + 0.15);
    lp.frequency.exponentialRampToValueAtTime(500 * r, t + 0.8);
    hit(g.gain, t, 0.5, 0.01, 0.75); wire(n, lp, g);
    SYNTH.splash(ctx, out, t + 0.03, { rate: 0.65 * r });
    const rain = noise(ctx, t + 0.5, 1.4), hp = filt(ctx, 'highpass', 2000 * r, 0.7, t), rg = vca(ctx, out);
    rg.gain.setValueAtTime(0, t + 0.5); rg.gain.linearRampToValueAtTime(0.12, t + 0.8); rg.gain.setTargetAtTime(0, t + 1.1, 0.25);
    wire(rain, hp, rg);
    return 2.0;
  },
  /** Shipyard launch: three strikes of the yard bell and a cheer of the hull going down the ways (wood rumble + splash). */
  launch(ctx, out, t) {
    [0, 0.42, 0.84].forEach((d) => bell(ctx, out, t + d, 560, 0.1));
    const n = noise(ctx, t + 1.1, 1.4, brownBuffer(ctx)), lp = filt(ctx, 'lowpass', 260, 0.7, t), g = vca(ctx, out);
    g.gain.setValueAtTime(0, t + 1.1); g.gain.linearRampToValueAtTime(0.35, t + 2.0); g.gain.setTargetAtTime(0, t + 2.2, 0.15);
    wire(n, lp, g);
    SYNTH.splash(ctx, out, t + 2.3, { rate: 0.6 });
    return 3.6;
  },
  /** Building placed: a timber laid down and a mallet tap. */
  place(ctx, out, t, o) {
    const r = o.rate;
    const k = tone(ctx, 'triangle', 140 * r, t, t + 0.18);
    k.frequency.exponentialRampToValueAtTime(70 * r, t + 0.12);
    const kg = vca(ctx, out); hit(kg.gain, t, 0.34, 0.002, 0.14); k.connect(kg);
    const n = noise(ctx, t, 0.12), bp = filt(ctx, 'bandpass', 700 * r, 1.2, t), ng = vca(ctx, out);
    hit(ng.gain, t, 0.22, 0.002, 0.09); wire(n, bp, ng);
    const m = tone(ctx, 'sine', 900 * r, t + 0.16, t + 0.24), mg = vca(ctx, out);
    hit(mg.gain, t + 0.16, 0.09, 0.001, 0.05); m.connect(mg);
    return 0.35;
  },
  /** Fort / battery destroyed: powder magazine blast + masonry collapsing. */
  fort_down(ctx, out, t, o) {
    SYNTH.explosion(ctx, out, t, o);
    const n = noise(ctx, t + 0.35, 1.8, brownBuffer(ctx)), lp = filt(ctx, 'lowpass', 500, 0.7, t), g = vca(ctx, out);
    g.gain.setValueAtTime(0, t + 0.35); g.gain.linearRampToValueAtTime(0.4, t + 0.6); g.gain.setTargetAtTime(0, t + 0.9, 0.4);
    wire(n, lp, g);
    const gr = noise(ctx, t + 0.4, 1.4), gb = filt(ctx, 'bandpass', 1800, 1.2, t), gg = vca(ctx, out);
    burst(gg.gain, t + 0.45, 22, 0.16, 0.02, 0.07, 0.01); wire(gr, gb, gg);
    return 2.6;
  },
  /** UI: confirm (two rising wood tocks). */
  ui_confirm(ctx, out, t, o) { SYNTH.ui_click(ctx, out, t, o); SYNTH.ui_click(ctx, out, t + 0.07, { rate: o.rate * 1.25 }); return 0.16; },
  /** UI: back / cancel (a lower single tock). */
  ui_back(ctx, out, t, o) { return SYNTH.ui_click(ctx, out, t, { rate: o.rate * 0.72 }); },
  /** UI: denied / can't afford — a dull double knock. */
  ui_error(ctx, out, t, o) {
    for (const d of [0, 0.09]) {
      const s = tone(ctx, 'triangle', 190 * o.rate, t + d, t + d + 0.08), g = vca(ctx, out);
      hit(g.gain, t + d, 0.22, 0.002, 0.06); s.connect(g);
    }
    return 0.2;
  },
  /** UI: open a panel / page — a soft parchment rustle. */
  ui_open(ctx, out, t, o) {
    const n = noise(ctx, t, 0.22), bp = filt(ctx, 'bandpass', 2600 * o.rate, 0.9, t), g = vca(ctx, out);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.05); g.gain.setTargetAtTime(0, t + 0.09, 0.05);
    wire(n, bp, g);
    return 0.25;
  },
  /** Reinforcements / wave incoming: a distant signal gun and a horn call. */
  reinforce(ctx, out, t) {
    SYNTH.gun(ctx, out, t, { rate: 0.95, p: { crack: [1600, 0.12, 0.06], boom: [90, 32, 0.35, 0.6], body: [700, 100, 0.2, 0.6], tail: [2, 0.2, 200] } });
    horn(ctx, out, t + 0.5, 50, 0.35, 0.08);
    horn(ctx, out, t + 0.9, 57, 0.7, 0.085);
    return 2.2;
  },
  /** A single strike of the ship's bell. */
  bell(ctx, out, t, o) { bell(ctx, out, t, 620 * o.rate, 0.12); return 3.4; },
  /** Ship ready: "two bells" + a handbell answer. */
  ship_ready(ctx, out, t) {
    bell(ctx, out, t, 640, 0.11);
    bell(ctx, out, t + 0.34, 640, 0.1);
    bell(ctx, out, t + 0.72, midi(86) / 2, 0.035, 0.5);
    return 3.6;
  },
};
/** Every procedural recipe name (tests, audio lab). */
export const SFX_RECIPES = Object.freeze(Object.keys(SYNTH));

// Procedural sweeteners layered on top of file-based sounds: [recipe, gain].
const LAYERS = {
  cannon:       [['cannon_tail', 0.8]],
  explosion_01: [['wood_crunch', 0.7]],
  explosion_02: [['wood_crunch', 0.7]],
  explosion_03: [['wood_crunch', 0.85]],
};
// Max starts per type inside a 90 ms window (broadsides, hit storms, UI spam).
const LIMIT = {
  cannon: 3, fire: 3, explosion: 2, explosion_01: 2, explosion_02: 2, explosion_03: 2, water_splash: 3, splash: 3,
  wood_crunch: 3, impact: 2, sink: 2, ui_hover: 1, ui_click: 2, coin: 2, build: 1, build_complete: 1,
  build_hammer: 1, bell: 1, ship_ready: 1, set_sail: 1, warning: 1, research: 1, victory: 1, defeat: 1,
  wood_knock: 3, stone_chip: 2, heavy_thud: 2, rig_tear: 2, chain_clank: 2, pepper: 2, pepper_splash: 2,
  mortar_splash: 2, chain_flight: 2, shell_whistle: 2, launch: 1, place: 1, fort_down: 1,
  ui_confirm: 1, ui_back: 1, ui_error: 1, ui_open: 1, reinforce: 1,
};
// sink is triggered from several places for the same ship (GameApp + VFX.startSink) — one voice only.
LIMIT.sink = 1;
// Random pitch variation (± fraction / 2) for non-musical sounds.
const VARY = { place: 0.06, wood_knock: 0.14, stone_chip: 0.12, pepper: 0.1, rig_tear: 0.1, cannon: 0.06, fire: 0.08, explosion: 0.08, wood_crunch: 0.14, splash: 0.12, impact: 0.12, sink: 0.05, build_hammer: 0.05, coin: 0.06, ui_click: 0.03 };
// Music ducking [dB, hold s, release s] under big events.
const DUCK = { explosion: [4, 0.5, 1.4], sink: [5, 1.2, 2.0], warning: [3, 0.6, 1.0], fort_down: [5, 0.8, 1.6], reinforce: [3, 0.6, 1.0], launch: [3, 1.0, 1.4] };
const STORAGE_KEY = 'pas_audio';
function safeStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(+v) ? +v : 0));
const MAX_SYNTH_VOICES = 48;

// ── Audio class ──────────────────────────────────────────────────────
export class Audio {
  /**
   * @param {object} [opts]
   * @param {BaseAudioContext} [opts.context]     use this context (e.g. an OfflineAudioContext in tests)
   * @param {AudioNode}        [opts.destination] master output (default: context.destination)
   * @param {Storage|null}     [opts.storage]     settings persistence (default localStorage; null = none —
   *                                              custom-context instances never persist)
   */
  constructor(opts = {}) {
    this._ctxIn        = opts.context || null;
    this._destIn       = opts.destination || null;
    this._ctx          = null;
    this._offline      = false;
    this._masterGain   = null;
    this._musicGain    = null;
    this._musicDuck    = null;
    this._sfxGain      = null;
    this._clip         = null;

    this._masterVol    = 0.75;
    this._musicVol     = 0.40;
    this._sfxVol       = 1.00;
    this._muted        = false;
    this._storage      = opts.storage !== undefined ? opts.storage : (opts.context ? null : safeStorage());
    this._loadSettings();

    // Listener: the point on the sea the camera looks at (see setCameraPos) + zoom distance.
    this._camPos       = { x: 0, y: 0, z: 0 };
    this._ear          = { x: 0, z: 0, zoom: 0 };
    this._gunRecent    = [];

    // Spatial attenuation parameters
    this._maxDist      = 80;   // beyond this distance sound is inaudible
    this._refDist      = 12;   // within this distance — full volume

    // Loaded AudioBuffers (optional file-based sounds)
    this._buffers      = new Map();
    this._activeLoops  = new Set();

    // Active music source (legacy buffer music)
    this._musicSrc     = null;
    this._musicFadeId  = null;

    /** Play procedural sweeteners on top of file-based SFX (see LAYERS). */
    this.layering      = true;
    this._recent       = new Map();
    this._voices       = 0;
    this._stinger      = null;
  }

  // ── Lazy init (must be triggered by user gesture) ──────────────────
  _getCtx() {
    if (!this._ctx) {
      const ctx = this._ctxIn || new (window.AudioContext || window.webkitAudioContext)();
      this._ctx = ctx;
      this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
      this._masterGain = ctx.createGain();
      this._sfxGain    = ctx.createGain();
      this._musicGain  = ctx.createGain();
      this._musicDuck  = ctx.createGain();
      this._clip       = ctx.createWaveShaper();
      this._clip.curve = softClipCurve();   // transparent below 0.8, never reaches full scale
      // SFX bus safety compressor: fleet broadsides + blasts stack up; this keeps
      // the bus under the soft clip's knee without pumping single shots.
      this._sfxComp    = ctx.createDynamicsCompressor();
      this._sfxComp.threshold.value = -9; this._sfxComp.knee.value = 6; this._sfxComp.ratio.value = 6;
      this._sfxComp.attack.value = 0.003; this._sfxComp.release.value = 0.22;

      this._sfxGain.connect(this._sfxComp);
      this._sfxComp.connect(this._masterGain);
      this._musicGain.connect(this._musicDuck);
      this._musicDuck.connect(this._masterGain);
      this._masterGain.connect(this._clip);
      this._clip.connect(this._destIn || ctx.destination);

      this._masterGain.gain.value = this._muted ? 0 : this._masterVol;
      this._sfxGain.gain.value    = this._sfxVol;
      this._musicGain.gain.value  = this._musicVol;
    }
    if (this._ctx.state === 'suspended' && !this._offline) {
      const p = this._ctx.resume?.();
      if (p && p.catch) p.catch(() => {});
    }
    return this._ctx;
  }

  /** The shared AudioContext (created on first use; stays 'suspended' until a user gesture). */
  get context() { return this._getCtx(); }
  /** Input of the music bus — the MusicDirector connects here. */
  get musicBus() { this._getCtx(); return this._musicGain; }
  /** Input of the SFX bus — ambience beds connect here. */
  get sfxBus() { this._getCtx(); return this._sfxGain; }
  /** Resume the context from a user gesture. Resolves true when running. */
  unlock() {
    try {
      const ctx = this._getCtx();
      if (this._offline || ctx.state === 'running') return Promise.resolve(true);
      return ctx.resume().then(() => ctx.state === 'running', () => false);
    } catch (e) { return Promise.resolve(false); }
  }
  /** The MusicDirector registers here: 'victory'/'defeat' go to its stingers when fn(type) returns true. */
  setStingerHandler(fn) { this._stinger = typeof fn === 'function' ? fn : null; }

  // ── Volume controls ────────────────────────────────────────────────
  _setVol(node, v) {
    if (!node) return;
    if (this._offline || !this._ctx) { node.gain.value = v; return; }
    node.gain.setTargetAtTime(v, this._ctx.currentTime, 0.03);
  }
  set masterVolume(v) {
    this._masterVol = clamp01(v);
    this._setVol(this._masterGain, this._muted ? 0 : this._masterVol);
  }
  get masterVolume() { return this._masterVol; }

  set sfxVolume(v) {
    this._sfxVol = clamp01(v);
    this._setVol(this._sfxGain, this._sfxVol);
  }
  get sfxVolume() { return this._sfxVol; }

  set musicVolume(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    this._setVol(this._musicGain, this._musicVol);
  }
  get musicVolume() { return this._musicVol; }

  // ── Settings API (Settings UI) — persisted in localStorage 'pas_audio' ──
  // Safe before the first user gesture: no AudioContext is created here.
  /** SFX volume 0..1 (gunfire, impacts, UI, ambience beds). Persisted. */
  setSfxVolume(v) { this.sfxVolume = v; this._saveSettings(); }
  /** @returns {number} SFX volume 0..1 */
  getSfxVolume() { return this._sfxVol; }
  /** Master volume 0..1 (music + SFX). Persisted. */
  setMasterVolume(v) { this.masterVolume = v; this._saveSettings(); }
  /** @returns {number} master volume 0..1 */
  getMasterVolume() { return this._masterVol; }
  /** Silence everything (music + SFX) without losing the volumes. Persisted. */
  setMasterMute(on) {
    this._muted = !!on;
    this._setVol(this._masterGain, this._muted ? 0 : this._masterVol);
    this._saveSettings();
  }
  /** @returns {boolean} master mute state */
  isMasterMuted() { return this._muted; }
  /** @returns {{master:number, sfx:number, muted:boolean}} snapshot for the settings UI */
  getSettings() { return { master: this._masterVol, sfx: this._sfxVol, muted: this._muted }; }
  _loadSettings() {
    try {
      const raw = this._storage?.getItem(STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (j && Number.isFinite(+j.master)) this._masterVol = clamp01(j.master);
      if (j && Number.isFinite(+j.sfx)) this._sfxVol = clamp01(j.sfx);
      if (j) this._muted = !!j.muted;
    } catch (e) { /* corrupt / blocked storage → defaults */ }
  }
  _saveSettings() {
    try {
      this._storage?.setItem(STORAGE_KEY, JSON.stringify({
        master: Math.round(this._masterVol * 1000) / 1000, sfx: Math.round(this._sfxVol * 1000) / 1000, muted: this._muted ? 1 : 0,
      }));
    } catch (e) { /* private mode */ }
  }

  /** Briefly lower the music bus by `db` so a big event cuts through. */
  duckMusic(db = 4, hold = 0.5, release = 1.4) {
    const ctx = this._ctx;
    if (!ctx || !this._musicDuck) return;
    const p = this._musicDuck.gain, now = ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(Math.min(1, p.value), now);
    p.setTargetAtTime(Math.pow(10, -db / 20), now, 0.04);
    p.setTargetAtTime(1, now + hold, release / 4);
  }

  // ── Called each frame from GameApp to keep camera position synced ─
  // The battle/harbor camera rig sits at (focus.x, d·0.75, focus.z + d) looking at
  // the focus (CameraController). Distances are measured from that focus on the
  // sea plane, plus a quarter of the zoom distance — so what is on screen is
  // audible, zooming in gets louder, and the camera's height doesn't silence
  // everything (a raw 3-D distance from a camera 100 u away did).
  setCameraPos(x, y, z) {
    this._camPos.x = x; this._camPos.y = y; this._camPos.z = z;
    const d = Math.max(0, y) / 0.75;
    this.setListener(x, z - d, d);
  }
  /** Explicit listener: the ground point the player looks at + zoom distance (overrides setCameraPos' estimate until the next call). */
  setListener(x, z, zoom = 0) {
    this._ear.x = x; this._ear.z = z; this._ear.zoom = Math.max(0, zoom);
    this._updateSpatialLoops();
  }

  // ── Spatial attenuation: 1.0 at refDist, 0 at maxDist ────────────
  _spatialGain(wx, wy, wz, maxDist = this._maxDist) {
    const dist = Math.hypot(wx - this._ear.x, wz - this._ear.z) + this._ear.zoom * 0.25;
    if (dist >= maxDist) return 0;
    if (dist <= this._refDist) return 1;
    // Inverse-square-like rolloff
    return Math.pow(1 - (dist - this._refDist) / (maxDist - this._refDist), 2);
  }

  /** Voice limiting: per-type start budget inside a 90 ms window + a global synth cap. */
  _admit(type, t, limit = LIMIT[type] ?? 4) {
    let arr = this._recent.get(type);
    if (!arr) this._recent.set(type, (arr = []));
    while (arr.length && t - arr[0] > 0.09) arr.shift();
    if (arr.length >= limit) return false;
    if (!this._offline && this._voices >= MAX_SYNTH_VOICES && !this._buffers.has(type)) return false;
    arr.push(t);
    return true;
  }
  _later(sec, fn) { if (!this._offline) setTimeout(fn, sec * 1000); }

  // ── Play a named sound (optionally spatial if x/y/z provided) ─────
  /**
   * @param {string} type  recipe or loaded buffer name
   * @param {{x,y,z}|number[]|null} [pos]  world position → distance attenuation
   * @param {{volume?, playbackRate?, maxDistance?, delay?, cleanupDelayMs?, sfxOnly?}} [opts]
   */
  play(type, pos = null, opts = {}) {
    try {
      if (this._stinger && (type === 'victory' || type === 'defeat') && !opts.sfxOnly && this._stinger(type)) return;
      const ctx = this._getCtx();
      if (!ctx) return;
      const buf = this._buffers.get(type);
      if (!buf && !SYNTH[type]) return;
      const t = ctx.currentTime + Math.max(0, opts.delay || 0);
      if (!this._admit(type, t)) return;

      // Spatial gain node sits between the sound and the sfx bus
      let target = this._sfxGain, spatGain = null;
      if (pos) {
        const spat = this._spatialGain(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2], opts.maxDistance);
        if (spat <= 0.001) return;  // inaudible — skip synthesis entirely
        spatGain = ctx.createGain();
        spatGain.gain.value = spat;
        spatGain.connect(this._sfxGain);
        target = spatGain;
      }

      let dur, src;
      if (buf) {
        src = this._startBuffer(buf, target, t, false, opts);
        dur = buf.duration / (opts.playbackRate || 1);
        if (this.layering) for (const [name, g] of LAYERS[type] || []) dur = Math.max(dur, this._startSynth(name, target, t, { ...opts, volume: (opts.volume ?? 1) * g }));
      } else {
        dur = this._startSynth(type, target, t, opts);
      }
      if (DUCK[type]) this.duckMusic(...DUCK[type]);
      if (spatGain) this._later(Math.max(dur + (t - ctx.currentTime) + 0.3, (opts.cleanupDelayMs ?? 0) / 1000), () => { try { spatGain.disconnect(); } catch (e) {} });
      return src;
    } catch (e) { /* audio context may not exist in test env */ }
  }

  /** Spatial gain node feeding the SFX bus (null when inaudible). */
  _spatNode(pos, maxDist, life) {
    if (!pos) return this._sfxGain;
    const spat = this._spatialGain(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2], maxDist);
    if (spat <= 0.001) return null;
    const g = this._ctx.createGain();
    g.gain.value = spat;
    g.connect(this._sfxGain);
    this._later(life + 0.4, () => { try { g.disconnect(); } catch (e) {} });
    return g;
  }

  /**
   * A gun firing — each cannon id (data/cannons.js) has its own recipe in
   * data/cannonSounds.js ('fort' / 'defense' for shore guns). Schedules the
   * in-flight sound (chain whirr, mortar shell whistle) up to the impact.
   * Voice-limited per gun and across all guns, with density compensation so
   * an 8-ship broadside sounds big but doesn't clip.
   * @param {string|{id:string}|null} cannon  cannon id or cannon object
   * @param {number} x @param {number} y @param {number} z  muzzle position
   * @param {number} [tx] @param {number} [tz]  aim point (flight sounds)
   * @param {number} [tof]  time of flight in seconds
   */
  playCannon(cannon, x, y, z, tx = x, tz = z, tof = 1) {
    try {
      const id = (typeof cannon === 'string' ? cannon : cannon?.id) || 'default';
      const p = CANNON_SOUNDS[id] || CANNON_SOUNDS.default;
      const ctx = this._getCtx();
      if (!ctx) return;
      const t = ctx.currentTime, M = GUNFIRE_MIX;
      const flightAt = p.flight === 'shell' ? t + Math.max(0.05, tof - Math.min(1.2, tof * 0.7)) : t + 0.08;
      const flightLen = p.flight === 'shell' ? Math.min(1.2, tof * 0.7) : Math.max(0.2, tof - 0.1);
      const flight = p.flight === 'chain' ? 'chain_flight' : p.flight === 'shell' ? 'shell_whistle' : null;
      const fpos = p.flight === 'shell' ? { x: tx, y: 0, z: tz } : { x: (x + tx) / 2, y: 0, z: (z + tz) / 2 };
      // per-gun + all-guns start budget
      if (!this._admit('gun:' + id, t, M.perGun) || !this._admit('gun', t, M.allGuns)) {
        // the report is dropped but the in-flight sound of a lone chain/mortar is still worth hearing
        if (flight) this.play(flight, fpos, { delay: flightAt - t, len: flightLen, volume: 0.7, maxDistance: p.maxDist * 0.6 });
        return;
      }
      const recent = this._gunRecent;
      while (recent.length && t - recent[0] > M.densityWindowSec) recent.shift();
      recent.push(t);
      const density = Math.min(1, Math.sqrt(M.densityFree / Math.max(M.densityFree, recent.length)));
      const target = this._spatNode({ x, y, z }, p.maxDist, 4);
      if (!target) { if (flight) this.play(flight, fpos, { delay: flightAt - t, len: flightLen, maxDistance: p.maxDist * 0.6 }); return; }
      const vary = 1 + (Math.random() - 0.5) * (p.vary ?? 0.05);
      const vol = (p.vol ?? 0.7) * density * (0.9 + Math.random() * 0.2);
      this._startSynth('gun', target, t, { p, volume: vol, playbackRate: vary });
      const body = this._buffers.get('cannon');
      if (p.mp3 && body) this._startBuffer(body, target, t, false, { volume: vol * p.mp3[0], playbackRate: p.mp3[1] * vary });
      if (flight) this.play(flight, fpos, { delay: flightAt - t, len: flightLen, maxDistance: p.maxDist * 0.6 });
      if (p.duck && density > 0.7) this.duckMusic(...p.duck);
    } catch (e) { /* no audio in this environment */ }
  }

  /**
   * Where a shot lands. `surface`: 'ship' | 'fort' | 'building' | 'ground' | 'water'.
   * The sound depends on the gun (data/cannonSounds.js IMPACT_PROFILES):
   * light shot knocks, heavy shot thuds, chain tears rigging, grape peppers,
   * mortar shells burst.
   */
  playImpact(cannon, surface, x, y, z) {
    try {
      const id = (typeof cannon === 'string' ? cannon : cannon?.id) || 'default';
      const gun = CANNON_SOUNDS[id] || CANNON_SOUNDS.default;
      const prof = IMPACT_PROFILES[gun.impact] || IMPACT_PROFILES.medium;
      const layers = prof[surface] || prof.ship;
      const jitter = 0.95 + Math.random() * 0.1;
      for (const [name0, gain, rate] of layers) {
        const name = name0 === 'explosion_*' ? 'explosion_0' + (1 + ((Math.random() * 3) | 0)) : name0;
        if (name.startsWith('explosion_0') && !this._buffers.has(name)) {   // recordings not loaded → procedural crunch
          this.play('wood_crunch', { x, y, z }, { volume: gain, playbackRate: rate * jitter, maxDistance: prof.maxDist });
          continue;
        }
        if (name === 'water_splash' && !this._buffers.has(name)) {
          this.play('splash', { x, y, z }, { volume: gain, playbackRate: rate * jitter, maxDistance: prof.maxDist });
          continue;
        }
        this.play(name, { x, y, z }, { volume: gain, playbackRate: rate * jitter, maxDistance: prof.maxDist, sfxOnly: true });
      }
    } catch (e) { /* no audio */ }
  }

  _startSynth(name, target, t, opts) {
    const fn = SYNTH[name];
    if (!fn) return 0;
    const ctx = this._ctx;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    g.connect(target);
    const vary = VARY[name] ? 1 + (Math.random() - 0.5) * VARY[name] : 1;
    const dur = fn(ctx, g, t, { rate: (opts.playbackRate ?? 1) * vary, p: opts.p, len: opts.len }) || 2;
    this._voices++;
    this._later(Math.max(dur + (t - ctx.currentTime) + 0.25, (opts.cleanupDelayMs ?? 0) / 1000), () => { this._voices--; try { g.disconnect(); } catch (e) {} });
    return dur;
  }

  _startBuffer(buf, target, t, loop, opts) {
    const ctx = this._ctx;
    const src  = ctx.createBufferSource();
    src.buffer = buf;
    src.loop   = loop;
    if (opts.playbackRate != null) src.playbackRate.value = opts.playbackRate;
    const outGain = ctx.createGain();
    outGain.gain.value = opts.volume ?? 1;
    src.connect(outGain);
    outGain.connect(target);
    src.onended = () => {
      try { src.disconnect(); } catch (e) {}
      try { outGain.disconnect(); } catch (e) {}
    };
    const offset = buf.duration > 0 ? (opts.offset ?? 0) % buf.duration : 0;
    src.start(t, offset);
    return src;
  }

  // ── File-based sound loading ───────────────────────────────────────
  async load(name, url) {
    try {
      const ctx      = this._getCtx();
      const response = await fetch(url);
      const arrayBuf = await response.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      this._buffers.set(name, audioBuf);
    } catch (e) {
      console.warn(`[Audio] Failed to load "${name}" from ${url}:`, e);
    }
  }

  // Play a loaded AudioBuffer (spatial)
  playBuffer(name, pos = null, loop = false, opts = {}) {
    try {
      const ctx = this._getCtx();
      const buf = this._buffers.get(name);
      if (!buf) return;

      let targetNode = this._sfxGain;
      let spatGain = null;
      if (pos) {
        const spat = this._spatialGain(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2], opts.maxDistance);
        if (spat <= 0.001) return;
        spatGain = ctx.createGain();
        spatGain.gain.value = spat;
        spatGain.connect(this._sfxGain);
        targetNode = spatGain;
      }
      const src = this._startBuffer(buf, targetNode, ctx.currentTime, loop, opts);
      if (spatGain) {
        const prev = src.onended;
        src.onended = () => { prev(); try { spatGain.disconnect(); } catch (e) {} };
      }
      return src;
    } catch (e) {}
  }

  // ── Music management ───────────────────────────────────────────────
  playSpatialLoop(name, pos, opts = {}) {
    try {
      const ctx = this._getCtx();
      const buf = this._buffers.get(name);
      if (!ctx || !buf || !pos) return null;

      const src = ctx.createBufferSource();
      const outGain = ctx.createGain();
      const spatGain = ctx.createGain();
      const active = {
        src,
        outGain,
        spatGain,
        pos: { x: pos.x ?? pos[0], y: pos.y ?? pos[1], z: pos.z ?? pos[2] },
        volume: opts.volume ?? 1,
        maxDistance: opts.maxDistance ?? this._maxDist,
        stopped: false,
      };

      src.buffer = buf;
      src.loop = true;
      if (opts.playbackRate != null) src.playbackRate.value = opts.playbackRate;

      outGain.gain.value = active.volume;
      this._setLoopSpatialGain(active, true);
      if (spatGain.gain.value <= 0.001 && opts.skipIfInitiallySilent) return null;

      src.connect(outGain);
      outGain.connect(spatGain);
      spatGain.connect(this._sfxGain);
      src.onended = () => this._cleanupSpatialLoop(active);
      this._activeLoops.add(active);
      const offset = buf.duration > 0 ? (opts.offset ?? 0) % buf.duration : 0;
      src.start(ctx.currentTime, offset);

      return {
        stop: (fadeDuration = 0.35) => this._stopSpatialLoop(active, fadeDuration),
        setPosition: (x, y, z) => {
          active.pos.x = x; active.pos.y = y; active.pos.z = z;
          this._setLoopSpatialGain(active);
        },
      };
    } catch (e) { return null; }
  }

  _updateSpatialLoops() {
    this._activeLoops.forEach(loop => this._setLoopSpatialGain(loop));
  }

  _setLoopSpatialGain(loop, immediate = false) {
    const ctx = this._ctx;
    if (!ctx || !loop?.spatGain) return;
    const gain = this._spatialGain(loop.pos.x, loop.pos.y, loop.pos.z, loop.maxDistance);
    if (immediate) loop.spatGain.gain.value = gain;
    else loop.spatGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
  }

  _stopSpatialLoop(loop, fadeDuration = 0.35) {
    try {
      if (!loop || loop.stopped) return;
      loop.stopped = true;
      const ctx = this._getCtx();
      const now = ctx.currentTime;
      loop.outGain.gain.cancelScheduledValues(now);
      loop.outGain.gain.setValueAtTime(loop.outGain.gain.value, now);
      loop.outGain.gain.linearRampToValueAtTime(0, now + fadeDuration);
      loop.src.stop(now + fadeDuration + 0.03);
    } catch (e) {
      this._cleanupSpatialLoop(loop);
    }
  }

  _cleanupSpatialLoop(loop) {
    try { loop?.src?.disconnect(); } catch (e) {}
    try { loop?.outGain?.disconnect(); } catch (e) {}
    try { loop?.spatGain?.disconnect(); } catch (e) {}
    this._activeLoops.delete(loop);
  }

  /** Legacy file-based music loop (procedural music lives in MusicDirector). */
  playMusic(name, fadeDuration = 1.5) {
    try {
      const ctx = this._getCtx();
      const buf = this._buffers.get(name);
      if (!buf) return;

      this.stopMusic(fadeDuration * 0.5);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop   = true;
      src.connect(this._musicGain);

      // Fade in
      this._musicGain.gain.setValueAtTime(0, ctx.currentTime);
      this._musicGain.gain.linearRampToValueAtTime(this._musicVol, ctx.currentTime + fadeDuration);

      src.start(ctx.currentTime);
      this._musicSrc = src;
    } catch (e) {}
  }

  stopMusic(fadeDuration = 1.5) {
    try {
      const ctx = this._getCtx();
      if (!this._musicSrc) return;
      const src = this._musicSrc;
      this._musicSrc = null;

      this._musicGain.gain.setValueAtTime(this._musicGain.gain.value, ctx.currentTime);
      this._musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDuration);
      src.stop(ctx.currentTime + fadeDuration + 0.05);
    } catch (e) {}
  }

  destroy() {
    try { this._ctx?.close(); } catch (e) {}
  }
}

// ── Singleton export (Bruno Simon style) ─────────────────────────────
export const audio = new Audio();

/** The game's shared AudioContext (created lazily; resumes on a user gesture). */
export function getAudioContext() { return audio.context; }
