// ── data/cannonSounds.js ────────────────────────────────────────────
// Per-gun sound design for the procedural `gun` recipe in
// Experience/Utils/Audio.js (audio.playCannon / audio.playImpact).
// Pure data — no logic, no imports. Ids match data/cannons.js, plus the
// non-ship shooters 'fort' (island battery) and 'defense' (built towers).
//
// Every gun is built from the same small set of layers; what makes them
// sound different is which layers are present and how they are tuned:
//
//   vol      overall gain (calibrated offline: tools/audio-lab.html?auto=cannons)
//   maxDist  audible radius (world units from the camera focus)
//   crack    [highpassHz, level, decaySec]       muzzle report (supersonic gas)
//   pops     [count, gapSec]                     repeat the report (falconet double-shot)
//   boom     [startHz, endHz, level, decaySec]   pitch-dropping fundamental — calibre
//   grit     [startHz, level]                    driven saw: the "bark" of the charge
//   body     [lpStartHz, lpEndHz, level, decay]  powder blast noise
//   thud     [hz, level]                         sub "chest thud" (big guns only)
//   tail     [seconds, level, lpHz]              rolling echo over open water
//   echo     n                                   slaps back off the shore
//   whistle  [startHz, endHz, level, seconds]    roundshot leaving the muzzle
//   rattle   level                               carriage recoil, tackle + debris rattle
//   hollow   [hz, level]                         mortar tube resonance ("thoomp")
//   scatter  level                               grapeshot: hiss + spray of balls
//   flight   'chain' | 'shell' | null            in-flight sound scheduled until impact
//   mp3      [gain, rate]                        layer the recorded cannon body (optional)
//   impact   key into IMPACT_PROFILES
//   duck     [dB, hold, release]                 dip the music under the shot
//   vary     random pitch variation per shot (± vary/2)
//
// Design notes (period: 1570–1720): small guns (swivel, falconet) are bronze
// breech-loaders and petards — sharp and dry; carronades are short and fat —
// low, short, no long tail; long guns ring out with a long rolling echo, the
// pitch dropping with calibre (9 → 12 → 24-pdr); culverins whistle; the
// demi-cannon and cannon royal are the biggest muzzle-loaders afloat — a
// chest thud and a rattle of tackle; mortars are a hollow "thoomp" and the
// shell whistles down before it bursts.

export const CANNON_SOUNDS = {
  swivel: {
    vol: 0.85, maxDist: 150, vary: 0.10,
    crack: [2600, 0.55, 0.05], boom: [190, 70, 0.32, 0.22], grit: [260, 0.10],
    body: [2600, 400, 0.22, 0.22], tail: [0.8, 0.10, 360], echo: 0,
    impact: 'light',
  },
  falconet: {
    vol: 0.75, maxDist: 170, vary: 0.08,
    crack: [2200, 0.5, 0.045], pops: [2, 0.085], boom: [160, 60, 0.38, 0.26], grit: [230, 0.10],
    body: [2200, 340, 0.24, 0.26], tail: [1.0, 0.12, 320], echo: 1,
    impact: 'light',
  },
  carronade: {
    vol: 0.72, maxDist: 230, vary: 0.06,
    crack: [1100, 0.22, 0.05], boom: [92, 34, 0.95, 0.42], grit: [120, 0.14],
    body: [900, 120, 0.55, 0.38], thud: [52, 0.35], tail: [0.9, 0.18, 200], echo: 0,
    impact: 'medium', duck: [2, 0.2, 0.6],
  },
  carronade32: {
    vol: 0.82, maxDist: 260, vary: 0.05,
    crack: [950, 0.22, 0.06], boom: [74, 28, 1.0, 0.52], grit: [100, 0.16],
    body: [800, 100, 0.6, 0.46], thud: [44, 0.55], tail: [1.1, 0.22, 170], echo: 0, rattle: 0.06,
    impact: 'heavy', duck: [3, 0.3, 0.8],
  },
  long9: {
    vol: 0.66, maxDist: 280, vary: 0.05,
    crack: [2400, 0.58, 0.09], boom: [140, 44, 0.55, 0.55], grit: [190, 0.12],
    body: [1700, 180, 0.35, 0.7], tail: [2.6, 0.36, 300], echo: 2,
    impact: 'medium',
  },
  long12: {
    vol: 0.70, maxDist: 300, vary: 0.05,
    crack: [2100, 0.55, 0.1], boom: [122, 38, 0.65, 0.65], grit: [170, 0.13],
    body: [1500, 160, 0.4, 0.75], tail: [2.9, 0.40, 270], echo: 2,
    impact: 'medium',
  },
  long24: {
    vol: 0.78, maxDist: 340, vary: 0.04,
    crack: [1800, 0.5, 0.12], boom: [100, 31, 0.8, 0.8], grit: [150, 0.15],
    body: [1300, 130, 0.45, 0.85], thud: [48, 0.3], tail: [3.4, 0.46, 240], echo: 3,
    impact: 'heavy', duck: [2, 0.4, 1.0],
  },
  demi_culv: {
    vol: 0.66, maxDist: 280, vary: 0.05,
    crack: [1700, 0.42, 0.07], boom: [128, 40, 0.7, 0.6], grit: [175, 0.13],
    body: [1400, 160, 0.4, 0.6], tail: [1.9, 0.28, 280], echo: 1,
    whistle: [2300, 1500, 0.05, 0.7],
    impact: 'medium',
  },
  culverin: {
    vol: 0.72, maxDist: 320, vary: 0.05,
    crack: [1600, 0.45, 0.08], boom: [112, 36, 0.8, 0.7], grit: [160, 0.14],
    body: [1300, 150, 0.45, 0.7], tail: [2.4, 0.34, 260], echo: 2,
    whistle: [2000, 1250, 0.07, 0.95],
    impact: 'medium',
  },
  demi_can: {
    vol: 0.80, maxDist: 320, vary: 0.04,
    crack: [1300, 0.36, 0.08], boom: [84, 28, 1.0, 0.9], grit: [120, 0.16],
    body: [1100, 110, 0.55, 0.9], thud: [42, 0.6], tail: [2.6, 0.42, 200], echo: 2, rattle: 0.08,
    mp3: [0.35, 0.82],
    impact: 'heavy', duck: [3, 0.4, 1.1],
  },
  cannon_royal: {
    vol: 0.88, maxDist: 380, vary: 0.035,
    crack: [1100, 0.34, 0.1], boom: [68, 24, 1.0, 1.15], grit: [96, 0.18],
    body: [950, 90, 0.6, 1.1], thud: [36, 0.85], tail: [3.4, 0.5, 170], echo: 3, rattle: 0.13,
    mp3: [0.45, 0.72],
    impact: 'heavy', duck: [4, 0.6, 1.4],
  },
  chain_shot: {
    vol: 0.66, maxDist: 260, vary: 0.05,
    crack: [1500, 0.38, 0.07], boom: [118, 40, 0.65, 0.5], grit: [160, 0.12],
    body: [1300, 160, 0.38, 0.5], tail: [1.4, 0.22, 260], echo: 1,
    flight: 'chain',
    impact: 'chain',
  },
  grapeshot: {
    vol: 0.74, maxDist: 220, vary: 0.06,
    crack: [1900, 0.5, 0.07], boom: [130, 46, 0.55, 0.4], grit: [180, 0.12],
    body: [2400, 260, 0.36, 0.4], tail: [1.0, 0.16, 300], echo: 0, scatter: 0.22,
    impact: 'grape',
  },
  mortar1: {
    vol: 0.74, maxDist: 320, vary: 0.05,
    crack: [900, 0.12, 0.05], boom: [70, 34, 0.75, 0.55], body: [700, 120, 0.32, 0.5],
    hollow: [175, 0.42], thud: [46, 0.45], tail: [1.4, 0.2, 180], echo: 1,
    flight: 'shell',
    impact: 'mortar', duck: [2, 0.3, 0.8],
  },
  mortar2: {
    vol: 0.82, maxDist: 360, vary: 0.045,
    crack: [800, 0.12, 0.06], boom: [58, 28, 0.85, 0.65], body: [600, 100, 0.36, 0.6],
    hollow: [140, 0.5], thud: [38, 0.6], tail: [1.8, 0.26, 160], echo: 1, rattle: 0.05,
    flight: 'shell',
    impact: 'mortar_heavy', duck: [3, 0.4, 1.0],
  },
  // island battery (the fort's own gun) — a heavy shore gun with stone slap-back
  fort: {
    vol: 0.78, maxDist: 320, vary: 0.05,
    crack: [1500, 0.4, 0.08], boom: [90, 30, 0.9, 0.8], grit: [130, 0.15],
    body: [1200, 120, 0.5, 0.8], thud: [46, 0.4], tail: [2.2, 0.36, 220], echo: 3,
    mp3: [0.3, 0.86],
    impact: 'medium',
  },
  // built defence towers
  defense: {
    vol: 0.68, maxDist: 280, vary: 0.06,
    crack: [2000, 0.48, 0.08], boom: [120, 40, 0.65, 0.55], grit: [170, 0.13],
    body: [1500, 170, 0.38, 0.55], tail: [1.8, 0.28, 280], echo: 2,
    impact: 'medium',
  },
};
CANNON_SOUNDS.default = CANNON_SOUNDS.demi_culv;

/**
 * What a shot sounds like where it lands. Per surface ('ship' | 'fort' |
 * 'building' | 'ground' | 'water'): [layer, gain, rate] entries. A layer is a
 * loaded file ('explosion_*' picks one of the three blast recordings,
 * 'water_splash') or an Audio.js recipe. `maxDist` is the audible radius.
 */
export const IMPACT_PROFILES = {
  light: {
    maxDist: 110,
    ship:     [['wood_knock', 1.3, 1.0]],
    fort:     [['stone_chip', 1.1, 1.0]],
    building: [['stone_chip', 1.1, 1.0]],
    ground:   [['impact', 0.9, 1.35]],
    water:    [['splash', 0.85, 1.4]],
  },
  medium: {
    maxDist: 140,
    ship:     [['explosion_*', 0.36, 1.0], ['wood_crunch', 0.55, 1.0]],
    fort:     [['explosion_*', 0.38, 0.95], ['stone_chip', 0.6, 0.85]],
    building: [['explosion_*', 0.38, 0.95], ['stone_chip', 0.6, 0.85]],
    ground:   [['impact', 1.2, 1.0]],
    water:    [['water_splash', 0.6, 1.0], ['splash', 0.25, 1.0]],
  },
  heavy: {
    maxDist: 170,
    ship:     [['explosion_*', 0.46, 0.86], ['wood_crunch', 0.75, 0.8], ['heavy_thud', 0.45, 1.0]],
    fort:     [['explosion_*', 0.48, 0.84], ['stone_chip', 0.7, 0.7], ['heavy_thud', 0.45, 1.0]],
    building: [['explosion_*', 0.48, 0.84], ['stone_chip', 0.7, 0.7], ['heavy_thud', 0.45, 1.0]],
    ground:   [['impact', 1.0, 0.8], ['heavy_thud', 0.6, 1.0]],
    water:    [['water_splash', 0.72, 0.82], ['splash', 0.4, 0.7], ['heavy_thud', 0.35, 1.2]],
  },
  chain: {
    maxDist: 150,
    ship:     [['rig_tear', 1.1, 1.0], ['wood_crunch', 0.45, 1.15]],
    fort:     [['stone_chip', 0.65, 1.0], ['chain_clank', 0.6, 1.0]],
    building: [['stone_chip', 0.65, 1.0], ['chain_clank', 0.6, 1.0]],
    ground:   [['impact', 0.6, 1.1], ['chain_clank', 0.6, 1.0]],
    water:    [['splash', 0.5, 1.1], ['splash', 0.45, 1.25]],
  },
  grape: {
    maxDist: 130,
    ship:     [['pepper', 1.4, 1.0]],
    fort:     [['pepper', 1.2, 1.25]],
    building: [['pepper', 1.2, 1.25]],
    ground:   [['pepper', 1.1, 1.4]],
    water:    [['pepper_splash', 0.85, 1.0]],
  },
  mortar: {
    maxDist: 200,
    ship:     [['explosion', 0.62, 1.05], ['explosion_*', 0.3, 0.9]],
    fort:     [['explosion', 0.62, 1.05], ['explosion_*', 0.34, 0.85]],
    building: [['explosion', 0.62, 1.05], ['explosion_*', 0.34, 0.85]],
    ground:   [['explosion', 0.6, 1.1], ['impact', 0.6, 0.8]],
    water:    [['mortar_splash', 0.9, 1.0]],
  },
  mortar_heavy: {
    maxDist: 230,
    ship:     [['explosion', 0.72, 0.92], ['explosion_*', 0.34, 0.8], ['heavy_thud', 0.5, 0.9]],
    fort:     [['explosion', 0.72, 0.92], ['explosion_*', 0.36, 0.78], ['heavy_thud', 0.5, 0.9]],
    building: [['explosion', 0.72, 0.92], ['explosion_*', 0.36, 0.78], ['heavy_thud', 0.5, 0.9]],
    ground:   [['explosion', 0.7, 0.95], ['impact', 0.7, 0.7]],
    water:    [['mortar_splash', 1.0, 0.88]],
  },
};

/** Gunfire bus behaviour (voice limiting / density compensation). */
export const GUNFIRE_MIX = {
  windowSec: 0.09,        // voice-limit window
  perGun: 2,              // starts of one gun type per window
  allGuns: 5,             // starts of any gun per window (8-ship broadside → 5 voices + compensation)
  densityWindowSec: 0.5,  // shots counted for density compensation
  densityFree: 3,         // shots in the window before compensation starts
  // gain = min(1, sqrt(densityFree / n)) — keeps a fleet-wide broadside near one big gun's loudness
};
