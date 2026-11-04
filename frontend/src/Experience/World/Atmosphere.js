import * as THREE from 'three';

// ── ATMOSPHERE — the time-of-day model ───────────────────────────
// One place that turns the sun's position into every colour the frame
// needs, so sky, sea, lights, fog and the post grade can never disagree:
//
//   Sky.update(t)            → computes the sun path, calls atmosphere.update()
//   SceneController          → key light (sun / moon), hemisphere, fog colour
//   Ocean                    → sky reflection colours, key light, cloud drift
//   Renderer (post grade)    → exposure + white balance for the hour
//
// Colours are display-referred hex values (the project's materials are
// authored that way — see Render/ShaderPatches.js). Keyframes are indexed by
// sun elevation in degrees and interpolated; a palette is easier to art-direct
// than a scattering model and costs nothing per frame (no allocations: every
// output is a preallocated Vector3 / Color written in place).
//
// Day cycle: GameApp derives dayPhase = sin(t·0.035 + π/2)·½ + ½ (0 midnight,
// 1 noon) and lights ship lanterns / fort torches below 0.42. The sun's
// elevation maps linearly from dayPhase so it touches the sea at 0.417: the
// lamps come on as the sun sets.

const DEG = Math.PI / 180;

/** Sun elevation (deg) at noon / midnight. */
export const SUN_MAX_ELEV = 42;
export const SUN_MIN_ELEV = -30;

/** Day-cycle angular speed (rad/s) — MUST match GameApp's dayPhase formula. */
export const DAY_RATE = 0.035;

/**
 * GameApp's day phase for elapsed time t (0 = midnight, 1 = noon).
 * @param {number} t seconds
 */
export function dayPhaseAt(t) { return Math.sin(t * DAY_RATE + 1.5708) * 0.5 + 0.5; }

// Elevation-indexed palette. zen/hor: sky zenith + horizon away from the sun;
// glow: horizon toward the sun; fog: distant haze (= far sea, = below-horizon
// sky); sun: key colour + intensity when the sun is the key; hemiSky/hemiGnd:
// ambient from above / sea bounce from below; tint: post white balance.
const KEYS = [
  { e: -30, zen: 0x050a1c, hor: 0x0f1c38, glow: 0x0f1c38, fog: 0x0f1d38, sun: 0xff6a30, sunI: 0.00,
    hemiSky: 0x5d78b4, hemiGnd: 0x0f1d31, hemiI: 0.62, tint: [0.93, 0.98, 1.07] },
  { e: -12, zen: 0x0b1636, hor: 0x202e5a, glow: 0x2c2e5c, fog: 0x1e2c55, sun: 0xff6a30, sunI: 0.00,
    hemiSky: 0x5f72aa, hemiGnd: 0x152036, hemiI: 0.62, tint: [0.95, 0.98, 1.05] },
  { e: -4,  zen: 0x18285c, hor: 0x4c4c80, glow: 0x9c5c6c, fog: 0x3f4775, sun: 0xff6a30, sunI: 0.00,
    hemiSky: 0x6c76aa, hemiGnd: 0x1f2539, hemiI: 0.58, tint: [1.00, 0.97, 1.00] },
  { e: 1,   zen: 0x2a4686, hor: 0xc98c78, glow: 0xff9a5a, fog: 0x8e7f8e, sun: 0xff8a3c, sunI: 0.85,
    hemiSky: 0x9095bd, hemiGnd: 0x3b3742, hemiI: 0.52, tint: [1.05, 0.99, 0.93] },
  { e: 7,   zen: 0x3464ac, hor: 0xebb690, glow: 0xffc276, fog: 0xbab0a8, sun: 0xffb466, sunI: 1.10,
    hemiSky: 0x9fb5d9, hemiGnd: 0x4c5251, hemiI: 0.52, tint: [1.04, 1.00, 0.94] },
  { e: 16,  zen: 0x2f6bbf, hor: 0xc5d7e7, glow: 0xffe3b6, fog: 0xafc5d5, sun: 0xffd9a8, sunI: 1.18,
    hemiSky: 0xadccea, hemiGnd: 0x516763, hemiI: 0.56, tint: [1.02, 1.00, 0.97] },
  { e: 42,  zen: 0x2462c6, hor: 0xaacdec, glow: 0xfff3de, fog: 0xa5c5e0, sun: 0xfff0dc, sunI: 1.22,
    hemiSky: 0xbad5f0, hemiGnd: 0x5a716c, hemiI: 0.58, tint: [1.01, 1.00, 0.99] },
];
for (const k of KEYS) for (const f of ['zen', 'hor', 'glow', 'fog', 'sun', 'hemiSky', 'hemiGnd'])
  k[f] = new THREE.Color(k[f]);

const MOON_COLOR = new THREE.Color(0xa9c0ff);
const MOON_INT   = 0.46;
// Moon parked high in the north-east: its glitter path lands upper-right.
const MOON_DIR   = new THREE.Vector3(0.37, 0.77, -0.53).normalize();
// Trade wind (world u/s): waves run west, clouds drift west-south-west.
const CLOUD_WIND = new THREE.Vector2(-3.2, 1.3);
/** Cloud-shadow texture tile (world units). The drift wraps at this period. */
export const CLOUD_TILE = 300;

const _sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Shared, per-frame atmosphere state. Read-only for everyone but Sky. */
export const atmosphere = {
  /** Frames update() ran (consumers can detect a fresh state). */
  version:    0,
  dayPhase:   1,
  /** Sun elevation in degrees (negative below the horizon). */
  sunElev:    SUN_MAX_ELEV,
  sunDir:     new THREE.Vector3(0, 1, 0),
  moonDir:    MOON_DIR.clone(),
  /** Dominant light: the sun by day, the moon by night (casts the shadows). */
  keyDir:     new THREE.Vector3(0, 1, 0),
  keyColor:   new THREE.Color(1, 1, 1),
  keyIntensity: 1,
  /** 1 while the sun is the key light, 0 once the moon took over. */
  sunKey:     1,
  /** 0 day … 1 full night. */
  night:      0,
  /** Sun disc visibility (0 below the horizon). */
  sunVis:     1,
  skyZenith:  new THREE.Color(),
  skyHorizon: new THREE.Color(),
  skyGlow:    new THREE.Color(),
  sunColor:   new THREE.Color(),
  fogColor:   new THREE.Color(),
  hemiSky:    new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0.6,
  ambientIntensity: 0.12,
  /** Post grade: exposure multiplier (eyes adapt at night) + white balance. */
  exposure:   1,
  tint:       new THREE.Vector3(1, 1, 1),
  /** Cloud shadows: drift offset (world units, wrapped) and strength 0..1. */
  cloudDrift: new THREE.Vector2(),
  cloudShadow: 0.24,
  /** Light used for shadows — registered by SceneController (Ocean reads its map). */
  shadowLight: null,

  /**
   * Recompute every output from the sun direction. Called once per frame by
   * Sky.update(); cheap (a few lerps), allocation-free.
   * @param {THREE.Vector3} sunDir  normalised, world space, towards the sun
   * @param {number} dayPhase       0 midnight … 1 noon
   * @param {number} t              elapsed seconds (cloud drift)
   */
  update(sunDir, dayPhase, t) {
    this.version++;
    this.dayPhase = dayPhase;
    this.sunDir.copy(sunDir);
    const e = Math.asin(Math.max(-1, Math.min(1, sunDir.y))) / DEG;
    this.sunElev = e;

    // Palette lookup
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const f = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e)));
    this.skyZenith.copy(a.zen).lerp(b.zen, f);
    this.skyHorizon.copy(a.hor).lerp(b.hor, f);
    this.skyGlow.copy(a.glow).lerp(b.glow, f);
    this.fogColor.copy(a.fog).lerp(b.fog, f);
    this.sunColor.copy(a.sun).lerp(b.sun, f);
    this.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, f);
    this.hemiGround.copy(a.hemiGnd).lerp(b.hemiGnd, f);
    this.hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * f;
    this.tint.set(a.tint[0] + (b.tint[0] - a.tint[0]) * f,
                  a.tint[1] + (b.tint[1] - a.tint[1]) * f,
                  a.tint[2] + (b.tint[2] - a.tint[2]) * f);
    const sunI = (a.sunI + (b.sunI - a.sunI) * f) * _sm(-3, 4, e);

    // Night / moon
    this.night  = 1 - _sm(-14, 1, e);
    this.sunVis = _sm(-2.5, 0.5, e);
    const moonI = MOON_INT * (1 - _sm(-9, 1, e));
    if (sunI >= moonI) {
      this.sunKey = 1;
      this.keyDir.copy(sunDir);
      this.keyColor.copy(this.sunColor);
      this.keyIntensity = sunI;
    } else {
      this.sunKey = 0;
      this.keyDir.copy(this.moonDir);
      this.keyColor.copy(MOON_COLOR);
      this.keyIntensity = moonI;
    }
    this.ambientIntensity = 0.12 + 0.05 * this.night;
    this.exposure    = 1 + 0.22 * this.night;
    this.cloudShadow = 0.24 * this.sunKey + 0.10 * (1 - this.sunKey);

    // Cloud drift, wrapped to the tile so float precision never degrades
    const w = CLOUD_TILE;
    this.cloudDrift.set(((CLOUD_WIND.x * t) % w + w) % w, ((CLOUD_WIND.y * t) % w + w) % w);
  },
};

// A sane state before the first Sky.update() (e.g. a tool that renders once).
atmosphere.update(new THREE.Vector3(-0.42, Math.sin(SUN_MAX_ELEV * DEG), -0.6).normalize(), 1, 0);
