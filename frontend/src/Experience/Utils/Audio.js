// ── Audio.js ────────────────────────────────────────────────────────
// Spatial audio manager inspired by Bruno Simon / Three.js Journey.
//
// Features:
//   • Master, music and sfx volume controls
//   • Spatial/3D attenuation: sounds diminish with distance from camera
//   • Procedural synthesis (Web Audio API oscillators) — no files needed
//   • Optional file-based sounds via AudioBuffer (drop-in when assets exist)
//   • Simple music loop management with fade-in/fade-out
//
// Usage:
//   import { audio } from './Utils/Audio.js';
//   audio.play('cannon', { x: 10, y: 0, z: -20 });  // spatial sfx
//   audio.playMusic('ambient');
//   audio.masterVolume = 0.6;

import * as THREE from 'three';

// ── Synthetic sound recipes ──────────────────────────────────────────
// Each entry is a function (ctx, gainNode, at) that programs oscillator(s).
const SYNTH = {
  cannon(ctx, g, t) {
    const osc  = ctx.createOscillator();
    const dist = ctx.createWaveShaper();
    osc.connect(dist); dist.connect(g);
    // Overdrive curve for punch
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i * 2) / 256 - 1; curve[i] = (Math.PI + 350) * x / (Math.PI + 350 * Math.abs(x)); }
    dist.curve = curve;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(18, t + 0.28);
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.start(t); osc.stop(t + 0.34);
  },
  explosion(ctx, g, t) {
    // White-noise burst via AudioBufferSourceNode
    const bufLen = ctx.sampleRate * 0.8;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    src.start(t); src.stop(t + 0.8);
  },
  splash(ctx, g, t) {
    const osc = ctx.createOscillator();
    osc.connect(g);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.22);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.start(t); osc.stop(t + 0.26);
  },
  impact(ctx, g, t) {
    const osc = ctx.createOscillator();
    osc.connect(g);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.16);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.start(t); osc.stop(t + 0.20);
  },
  sink(ctx, g, t) {
    const osc = ctx.createOscillator();
    osc.connect(g);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 1.0);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    osc.start(t); osc.stop(t + 1.15);
  },
  build(ctx, g, t) {
    [440, 550, 660].forEach((freq, i) => {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.connect(g2); g2.connect(g.context.destination);
      o2.type = 'sine'; o2.frequency.value = freq;
      g2.gain.setValueAtTime(0.10, t + i * 0.1);
      g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.1 + 0.28);
      o2.start(t + i * 0.1); o2.stop(t + i * 0.1 + 0.30);
    });
  },
  // AN/AW: event-cue recipes — research done, win/lose, wave warning, coin
  research(ctx, g, t) {
    [523, 659, 784].forEach((f, i) => {
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.connect(g2); g2.connect(g);
      o.type = 'sine'; o.frequency.value = f;
      g2.gain.setValueAtTime(0.0001, t + i * 0.09);
      g2.gain.exponentialRampToValueAtTime(0.16, t + i * 0.09 + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.34);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.36);
    });
    g.gain.setValueAtTime(1, t);
  },
  victory(ctx, g, t) {
    [[392,0],[523,.14],[659,.28],[784,.42]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.connect(g2); g2.connect(g);
      o.type = 'sawtooth'; o.frequency.value = f;
      g2.gain.setValueAtTime(0.0001, t + d);
      g2.gain.exponentialRampToValueAtTime(0.14, t + d + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.001, t + d + (d > .4 ? 0.8 : 0.30));
      o.start(t + d); o.stop(t + d + 0.85);
    });
    g.gain.setValueAtTime(1, t);
  },
  defeat(ctx, g, t) {
    const o = ctx.createOscillator();
    o.connect(g);
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 1.6);
    g.gain.setValueAtTime(0.26, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
    o.start(t); o.stop(t + 1.75);
  },
  warning(ctx, g, t) {
    [0, 0.22].forEach(d => {
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.connect(g2); g2.connect(g);
      o.type = 'square';
      o.frequency.setValueAtTime(440, t + d);
      o.frequency.setValueAtTime(310, t + d + 0.10);
      g2.gain.setValueAtTime(0.085, t + d);
      g2.gain.exponentialRampToValueAtTime(0.001, t + d + 0.20);
      o.start(t + d); o.stop(t + d + 0.21);
    });
    g.gain.setValueAtTime(1, t);
  },
  coin(ctx, g, t) {
    [1318, 1976].forEach((f, i) => {
      const o = ctx.createOscillator(), g2 = ctx.createGain();
      o.connect(g2); g2.connect(g);
      o.type = 'triangle'; o.frequency.value = f;
      g2.gain.setValueAtTime(i ? 0.07 : 0.12, t + i * 0.03);
      g2.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.24);
      o.start(t + i * 0.03); o.stop(t + i * 0.03 + 0.26);
    });
    g.gain.setValueAtTime(1, t);
  },
  fire(ctx, g, t) {
    const osc = ctx.createOscillator();
    osc.connect(g);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88, t);
    osc.frequency.exponentialRampToValueAtTime(16, t + 0.24);
    g.gain.setValueAtTime(0.20, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.start(t); osc.stop(t + 0.28);
  },
};

// ── Audio class ──────────────────────────────────────────────────────
export class Audio {
  constructor() {
    this._ctx          = null;
    this._masterGain   = null;
    this._musicGain    = null;
    this._sfxGain      = null;

    this._masterVol    = 0.75;
    this._musicVol     = 0.40;
    this._sfxVol       = 1.00;

    // Camera position — set each frame from outside (audio.setCameraPos)
    this._camPos       = new THREE.Vector3();
    this._tmpPos       = new THREE.Vector3();

    // Spatial attenuation parameters
    this._maxDist      = 80;   // beyond this distance sound is inaudible
    this._refDist      = 12;   // within this distance — full volume

    // Loaded AudioBuffers (optional file-based sounds)
    this._buffers      = new Map();
    this._activeLoops  = new Set();

    // Active music source
    this._musicSrc     = null;
    this._musicFadeId  = null;
  }

  // ── Lazy init (must be triggered by user gesture) ──────────────────
  _getCtx() {
    if (!this._ctx) {
      this._ctx        = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._sfxGain    = this._ctx.createGain();
      this._musicGain  = this._ctx.createGain();

      this._sfxGain.connect(this._masterGain);
      this._musicGain.connect(this._masterGain);
      this._masterGain.connect(this._ctx.destination);

      this._masterGain.gain.value = this._masterVol;
      this._sfxGain.gain.value    = this._sfxVol;
      this._musicGain.gain.value  = this._musicVol;
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  // ── Volume controls ────────────────────────────────────────────────
  set masterVolume(v) {
    this._masterVol = Math.max(0, Math.min(1, v));
    if (this._masterGain) this._masterGain.gain.value = this._masterVol;
  }
  get masterVolume() { return this._masterVol; }

  set sfxVolume(v) {
    this._sfxVol = Math.max(0, Math.min(1, v));
    if (this._sfxGain) this._sfxGain.gain.value = this._sfxVol;
  }
  get sfxVolume() { return this._sfxVol; }

  set musicVolume(v) {
    this._musicVol = Math.max(0, Math.min(1, v));
    if (this._musicGain) this._musicGain.gain.value = this._musicVol;
  }
  get musicVolume() { return this._musicVol; }

  // ── Called each frame from GameApp to keep camera position synced ─
  setCameraPos(x, y, z) {
    this._camPos.set(x, y, z);
    this._updateSpatialLoops();
  }

  // ── Spatial attenuation: 1.0 at refDist, 0 at maxDist ────────────
  _spatialGain(wx, wy, wz, maxDist = this._maxDist) {
    const dist = this._camPos.distanceTo(this._tmpPos.set(wx, wy, wz));
    if (dist >= maxDist) return 0;
    if (dist <= this._refDist) return 1;
    // Inverse-square-like rolloff
    return Math.pow(1 - (dist - this._refDist) / (maxDist - this._refDist), 2);
  }

  // ── Play a named sound (optionally spatial if x/y/z provided) ─────
  play(type, pos = null, opts = {}) {
    try {
      const ctx = this._getCtx();
      if (!ctx) return;

      if (this._buffers.has(type)) {
        return this.playBuffer(type, pos, false, opts);
      }

      const fn = SYNTH[type];
      if (!fn) return;

      // Spatial gain node sits between synthesiser and sfx bus
      let targetNode = this._sfxGain;
      let spatGain = null;
      if (pos) {
        const spat = this._spatialGain(pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2], opts.maxDistance);
        if (spat <= 0.001) return;  // inaudible — skip synthesis entirely
        spatGain = ctx.createGain();
        spatGain.gain.value = spat;
        spatGain.connect(this._sfxGain);
        targetNode = spatGain;
      }

      const g = ctx.createGain();
      g.connect(targetNode);
      fn(ctx, g, ctx.currentTime);
      setTimeout(() => {
        try { g.disconnect(); } catch (e) {}
        try { spatGain?.disconnect(); } catch (e) {}
      }, opts.cleanupDelayMs ?? 2000);
    } catch (e) { /* audio context may not exist in test env */ }
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

      const src  = ctx.createBufferSource();
      src.buffer = buf;
      src.loop   = loop;
      if (opts.playbackRate != null) src.playbackRate.value = opts.playbackRate;

      const outGain = ctx.createGain();
      outGain.gain.value = opts.volume ?? 1;
      src.connect(outGain);
      outGain.connect(targetNode);
      src.onended = () => {
        try { src.disconnect(); } catch (e) {}
        try { outGain.disconnect(); } catch (e) {}
        try { spatGain?.disconnect(); } catch (e) {}
      };
      const offset = buf.duration > 0 ? (opts.offset ?? 0) % buf.duration : 0;
      src.start(ctx.currentTime, offset);
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
