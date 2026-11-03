// ── data/music.js ───────────────────────────────────────────────────
// Score + mix data for the procedural MusicDirector (Experience/Utils/
// MusicDirector.js). Pure data — no logic, no imports.
//
// Every tune here is ORIGINAL, written for Isles of War. Melodies are
// [midi, steps] pairs per bar (0 = rest); a "step" is the track's grid unit
// (an eighth in 6/8 harbor/calm, an eighth in the chart, a sixteenth in
// battle). Each bar's steps must sum to `stepsPerBar`.
// Chord symbols: root + quality ('', m, 7, m7, maj7, sus2, sus4, m9, add9, 6)
// with optional /bass.
//
// Channel strip keys: gain, pan (-1..1), hp/lp (Hz), peak [Hz, dB, Q],
// send (reverb), trem [rateHz, depth] (bellows), lfo [rateHz, cutoffDepthHz].
// Design rationale: design/audio-direction.md

/** Global music mix + scheduler settings. */
export const MUSIC_MIX = {
  defaultVolume:      0.7,    // user music volume (0..1) when nothing is stored
  crossfadeSec:       2.0,    // track → track
  stingerFadeSec:     1.0,    // how fast the old track gets out of a stinger's way
  afterStingerFadeSec: 3.0,   // stinger → calm bed
  lookaheadSec:       0.30,   // schedule this far ahead of AudioContext.currentTime
  tickMs:             50,     // scheduler wake-up period
  maxVoices:          72,     // music voice budget (oscillators/sources alive)
  intensitySlewSec:   1.6,    // battle intensity smoothing time constant
  intenseFloor:       0.85,   // 'battle_intense' = battle score with this intensity floor
  reverb: { seconds: 2.8, rt60: 2.3, preDelay: 0.016, highpass: 240, ret: 0.55 },
  compressor: { threshold: -20, knee: 12, ratio: 3, attack: 0.02, release: 0.35 },
  trim: 0.42,   // post-compressor trim — calibrated against the compressor's automatic makeup gain
};

/** Ambience beds (routed to the SFX bus — not affected by music mute). */
export const AMBIENCE_MIX = {
  fadeSec: 2.5,
  level: 1.0,
  harbor: {
    waves: 0.11, lap: 0.05, gulls: 0.045, hammer: 0.05, creak: 0.04, saw: 0.018,
    swellEvery: [4.5, 7.5], lapEvery: [0.6, 2.0], gullEvery: [5, 13],
    hammerEvery: [7, 16], creakEvery: [4, 10], sawEvery: [24, 50],
  },
  sea: {
    wind: 0.075, whistle: 0.012, waves: 0.15, crest: 0.05, creak: 0.03,
    swellEvery: [5, 9], crestEvery: [2.5, 7], creakEvery: [7, 16],
  },
};

// ── HARBOR — "Home Port" · D mixolydian/major · 6/8 lilt ────────────
const HARBOR_A_HEAD = [
  [[69, 2], [74, 1], [78, 2], [76, 1]],   // D
  [[74, 2], [71, 1], [67, 2], [71, 1]],   // G/D
  [[72, 2], [76, 1], [79, 2], [76, 1]],   // C   (the salty flat-seven)
  [[74, 3], [69, 3]],                     // D
  [[71, 2], [73, 1], [74, 2], [78, 1]],   // Bm
  [[79, 2], [78, 1], [76, 2], [74, 1]],   // G
];

export const HARBOR = {
  bpm: 66, beatSteps: 3, stepsPerBar: 6,           // dotted-quarter = 66
  scale: [2, 4, 6, 7, 9, 11, 1],                   // D major (C natural enters via chords)
  channels: {
    fiddle:  { gain: 1.00, pan:  0.16, hp: 220, lp: 6000, peak: [2700, 3, 1.1], send: 0.30 },
    whistle: { gain: 0.55, pan: -0.12, hp: 500, lp: 8000, send: 0.32 },
    lead:    { gain: 1.00, pan: -0.05, hp: 160, lp: 4200, peak: [1400, 3, 1.0], send: 0.28 },
    reed:    { gain: 0.85, pan: -0.26, hp: 140, lp: 3400, peak: [1250, 2.5, 0.9], send: 0.22, trem: [4.4, 0.06] },
    guitar:  { gain: 0.95, pan:  0.34, hp: 100, lp: 6500, send: 0.16 },
    mando:   { gain: 0.90, pan: -0.38, hp: 250, lp: 8000, send: 0.24 },
    bass:    { gain: 1.00, pan:  0.00, hp: 35,  lp: 1500, send: 0.04 },
    drum:    { gain: 1.00, pan: -0.10, send: 0.12 },
    shaker:  { gain: 0.55, pan:  0.45, hp: 4800, send: 0.08 },
    clave:   { gain: 0.45, pan: -0.42, send: 0.14 },
  },
  sections: {
    intro: { chords: ['D', 'D'] },
    A:     { chords: ['D', 'G/D', 'C', 'D', 'Bm', 'G', 'A', 'D'],  mel: 'A' },
    A2:    { chords: ['D', 'G/D', 'C', 'D', 'Bm', 'G', 'A7', 'D'], mel: 'A2' },
    B:     { chords: ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'C', 'A'],   mel: 'B' },
    A3:    { chords: ['D', 'G/D', 'C', 'D', 'Bm', 'G', 'A7', 'D'], mel: 'A3' },
    inter: { chords: ['D', 'C', 'G', 'D'], mel: 'frag' },
    rest:  { chords: ['D', 'C', 'G', 'D', 'Bm', 'C', 'A', 'D'] },   // breather, no tune
  },
  melodies: {
    A: [...HARBOR_A_HEAD,
      [[73, 2], [76, 1], [69, 2], [73, 1]],   // A
      [[74, 5], [0, 1]]],                     // D
    A2: [...HARBOR_A_HEAD,
      [[76, 2], [73, 1], [71, 2], [69, 1]],   // A7
      [[74, 2], [73, 1], [71, 2], [73, 1]]],  // D — lead-in to B
    A3: [...HARBOR_A_HEAD,
      [[76, 2], [73, 1], [71, 2], [69, 1]],
      [[74, 6]]],
    B: [
      [[78, 3], [76, 2], [74, 1]],            // Bm
      [[74, 2], [71, 1], [67, 3]],            // G
      [[69, 2], [74, 1], [78, 2], [81, 1]],   // D
      [[79, 2], [78, 1], [76, 3]],            // A
      [[78, 2], [74, 1], [71, 2], [74, 1]],   // Bm
      [[76, 2], [74, 1], [71, 2], [67, 1]],   // G
      [[72, 2], [74, 1], [76, 2], [79, 1]],   // C
      [[76, 3], [73, 3]],                     // A
    ],
    frag: [
      [[69, 2], [74, 1], [78, 3]],
      [[0, 6]],
      [[71, 2], [74, 1], [79, 3]],
      [[0, 6]],
    ],
  },
  // Who carries the tune, rotated per pass through the form so loops don't repeat.
  plan: [
    { A: 'fiddle', A2: 'whistle', B: 'fiddle',  A3: 'both' },
    { A: 'lead',   A2: 'fiddle',  B: 'whistle', A3: 'both' },
    { A: 'mando',  A2: 'fiddle',  B: 'lead',    A3: 'both' },
  ],
};

// ── CALM — post-victory / evening bed · D major · slow 6/8 ──────────
export const CALM = {
  bpm: 50, beatSteps: 3, stepsPerBar: 6,
  scale: [2, 4, 6, 7, 9, 11, 1],
  channels: {
    reed:    { gain: 0.80, pan: -0.22, hp: 140, lp: 2600, peak: [1100, 2, 0.9], send: 0.32, trem: [3.6, 0.05] },
    guitar:  { gain: 0.95, pan:  0.30, hp: 100, lp: 5200, send: 0.26 },
    bass:    { gain: 0.80, pan:  0.00, hp: 35,  lp: 1200, send: 0.06 },
    whistle: { gain: 0.45, pan: -0.08, hp: 500, lp: 7000, send: 0.40 },
  },
  sections: { main: { chords: ['D', 'G/D', 'D', 'A', 'Bm', 'G', 'A', 'D'] } },
  melodies: { frag: HARBOR.melodies.frag },
};

// ── CHART — "Uncharted" · D dorian · 4/4, slow & mysterious ─────────
export const CHART = {
  bpm: 64, beatSteps: 2, stepsPerBar: 8,
  scale: [2, 4, 5, 7, 9, 11, 0],                   // D dorian (B natural = the "open sky" note)
  channels: {
    drone: { gain: 1.00, pan:  0.00, hp: 30,  lp: 420, lfo: [0.07, 160], send: 0.25 },
    pad:   { gain: 0.90, pan: -0.15, hp: 180, lp: 2600, send: 0.50 },
    harp:  { gain: 0.80, pan:  0.30, hp: 120, lp: 5500, send: 0.45 },
    bell:  { gain: 0.80, pan: -0.25, hp: 300, lp: 7000, send: 0.60 },
    horn:  { gain: 0.70, pan:  0.20, hp: 60,  lp: 900,  send: 0.50 },
    pulse: { gain: 0.80, pan:  0.00, send: 0.25 },
  },
  sections: {
    main: { chords: ['Dm9', 'Dm9', 'Em/D', 'Em/D', 'Bbmaj7', 'Bbmaj7', 'Csus2', 'Csus2',
                     'Dm9', 'Dm9', 'Gm/D', 'Gm/D', 'Bbmaj7', 'Bbmaj7', 'Asus4', 'A'] },
  },
  // Small motif bank for the bell; notes get snapped to the bar's chord/scale.
  motifs: [
    [[69, 2], [74, 2], [76, 4]],
    [[77, 2], [76, 1], [74, 1], [69, 4]],
    [[65, 2], [69, 2], [71, 4]],
    [[74, 1], [72, 1], [69, 2], [64, 2], [65, 2]],
    [[81, 3], [79, 1], [76, 4]],
    [[72, 2], [74, 2], [69, 4]],
  ],
};

// ── BATTLE — "Broadside" · E minor · 4/4 drive, 3+3+2 accents ───────
export const BATTLE = {
  bpm: 126, beatSteps: 4, stepsPerBar: 16,
  scale: [4, 6, 7, 9, 11, 0, 2],                   // E aeolian (D# arrives with the B chord)
  channels: {
    low:    { gain: 1.00, pan: -0.10, hp: 38,  lp: 2400, send: 0.10 },
    pad:    { gain: 0.80, pan:  0.22, hp: 150, lp: 2600, send: 0.35 },
    brass:  { gain: 0.90, pan:  0.12, hp: 90,  lp: 5000, send: 0.25 },
    horn:   { gain: 1.00, pan: -0.18, hp: 120, lp: 3800, send: 0.30 },
    timp:   { gain: 1.00, pan: -0.25, hp: 30,  send: 0.25 },
    taiko:  { gain: 1.00, pan:  0.05, hp: 28,  send: 0.18 },
    snare:  { gain: 0.65, pan:  0.28, hp: 180, send: 0.15 },
    cym:    { gain: 0.55, pan:  0.35, hp: 4000, send: 0.25 },
  },
  sections: {
    intro:  { chords: ['Em', 'Em'] },
    A:      { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B'],  mel: 'A' },
    B:      { chords: ['C', 'D', 'Em', 'Em', 'C', 'D', 'B', 'B'],    mel: 'B' },
    A2:     { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B'],  mel: 'A' },
    bridge: { chords: ['Am', 'Am', 'C', 'B'] },
  },
  melodies: {
    A: [
      [[64, 6], [71, 2], [71, 4], [72, 2], [71, 2]],   // Em
      [[69, 4], [67, 4], [64, 8]],                     // Em
      [[64, 6], [67, 2], [72, 4], [71, 2], [72, 2]],   // C
      [[74, 8], [69, 4], [66, 4]],                     // D
      [[76, 6], [74, 2], [71, 4], [67, 2], [71, 2]],   // Em
      [[69, 4], [71, 4], [67, 8]],                     // Em
      [[72, 6], [71, 2], [69, 4], [67, 2], [69, 2]],   // C
      [[71, 12], [0, 4]],                              // B
    ],
    B: [
      [[67, 4], [72, 4], [76, 8]],                     // C
      [[78, 6], [76, 2], [74, 8]],                     // D
      [[71, 4], [74, 4], [79, 8]],                     // Em
      [[78, 6], [76, 2], [71, 8]],                     // Em
      [[72, 4], [76, 4], [79, 6], [78, 2]],            // C
      [[81, 8], [78, 4], [74, 4]],                     // D
      [[75, 8], [78, 8]],                              // B
      [[71, 12], [0, 4]],                              // B
    ],
  },
  // Low-string ostinato, semitone offsets from the chord root per eighth note.
  ostinato:     [0, 0, 0, 7, 0, 0, 12, 7],
  ostinatoTurn: [0, 12, 0, 12, 7, 12, 7, 5],
  ostinatoVel:  [1.0, 0.55, 0.6, 0.92, 0.55, 0.6, 0.95, 0.7],
};

// ── STINGERS (seconds) ──────────────────────────────────────────────
const STINGER_CHANNELS = {
  brass: { gain: 0.90, pan:  0.12, hp: 80,  lp: 5000, send: 0.32 },
  horn:  { gain: 1.00, pan: -0.15, hp: 100, lp: 4200, send: 0.36 },
  pad:   { gain: 0.90, pan:  0.20, hp: 90,  lp: 2800, send: 0.40 },
  timp:  { gain: 1.00, pan: -0.25, hp: 30,  send: 0.30 },
  taiko: { gain: 0.90, pan:  0.05, hp: 28,  send: 0.22 },
  cym:   { gain: 0.60, pan:  0.35, hp: 4000, send: 0.30 },
};

/** Victory: original D-major fanfare, then falls to the CALM bed. */
export const VICTORY = {
  channels: STINGER_CHANNELS, length: 6.6, thenAt: 5.4, then: 'calm',
  events: [
    { i: 'timpRoll', t: 0.00, m: 45, d: 0.90, v: 0.25, v1: 0.85 },
    { i: 'cymSwell', t: 0.05, d: 0.90, v: 0.5 },
    { i: 'crash',    t: 0.95, v: 0.75 },
    { i: 'taiko',    t: 0.95, v: 0.95 },
    { i: 'brass',    t: 0.95, m: [50, 57, 62, 66], d: 0.30, v: 0.85 },
    { i: 'horn', t: 0.95, m: 69, d: 0.15, v: 0.85 },
    { i: 'horn', t: 1.11, m: 74, d: 0.15, v: 0.88 },
    { i: 'horn', t: 1.27, m: 78, d: 0.15, v: 0.92 },
    { i: 'horn', t: 1.43, m: 81, d: 0.92, v: 1.00 },
    { i: 'horn', t: 2.40, m: 79, d: 0.19, v: 0.85 },
    { i: 'horn', t: 2.60, m: 78, d: 0.19, v: 0.85 },
    { i: 'horn', t: 2.80, m: 76, d: 0.19, v: 0.85 },
    { i: 'horn', t: 3.00, m: 78, d: 0.33, v: 0.92 },
    { i: 'horn', t: 3.35, m: 76, d: 0.24, v: 0.88 },
    { i: 'horn', t: 3.62, m: 74, d: 2.20, v: 1.00 },
    { i: 'pad', t: 1.43, m: [62, 66, 69, 74], d: 0.95, v: 0.7 },
    { i: 'pad', t: 2.40, m: [59, 62, 67, 71], d: 0.58, v: 0.7 },
    { i: 'pad', t: 3.00, m: [57, 61, 64, 67], d: 0.60, v: 0.7 },
    { i: 'pad', t: 3.62, m: [50, 57, 62, 66, 69], d: 2.60, v: 0.8 },
    { i: 'brass', t: 2.40, m: [55, 62, 67, 71], d: 0.50, v: 0.6 },
    { i: 'brass', t: 3.00, m: [57, 61, 64, 69], d: 0.55, v: 0.7 },
    { i: 'brass', t: 3.62, m: [50, 57, 62, 66], d: 2.10, v: 0.9 },
    { i: 'timp', t: 1.43, m: 50, v: 0.8 },
    { i: 'timp', t: 2.40, m: 43, v: 0.6 },
    { i: 'timp', t: 3.00, m: 45, v: 0.7 },
    { i: 'timp', t: 3.62, m: 38, v: 1.0 },
    { i: 'timpRoll', t: 3.90, m: 38, d: 1.30, v: 0.45, v1: 0.08 },
    { i: 'crash', t: 3.62, v: 0.85 },
    { i: 'taiko', t: 3.62, v: 0.9 },
  ],
};

/** Defeat: slow descending low brass in D minor, then silence. */
export const DEFEAT = {
  channels: STINGER_CHANNELS, length: 6.8, thenAt: 6.6, then: null,
  events: [
    { i: 'pad', t: 0.00, m: [38, 45], d: 6.0, v: 0.55, a: 0.6 },
    { i: 'timp', t: 0.00, m: 38, v: 0.7 },
    { i: 'timp', t: 0.32, m: 38, v: 0.42 },
    { i: 'horn', t: 0.30, m: 57, d: 0.85, v: 0.85 },
    { i: 'horn', t: 1.20, m: 55, d: 0.45, v: 0.75 },
    { i: 'horn', t: 1.70, m: 53, d: 0.85, v: 0.82 },
    { i: 'horn', t: 2.60, m: 52, d: 0.45, v: 0.72 },
    { i: 'horn', t: 3.10, m: 50, d: 2.60, v: 0.85 },
    { i: 'pad', t: 0.00, m: [50, 53, 57], d: 1.70, v: 0.55, a: 0.4 },
    { i: 'pad', t: 1.70, m: [46, 50, 53], d: 0.90, v: 0.55 },
    { i: 'pad', t: 2.60, m: [45, 49, 52], d: 0.50, v: 0.55 },
    { i: 'pad', t: 3.10, m: [50, 53, 57], d: 3.00, v: 0.6 },
    { i: 'brass', t: 3.10, m: [38, 45, 50, 53], d: 2.40, v: 0.45 },
    { i: 'timp', t: 1.70, m: 38, v: 0.5 },
    { i: 'timp', t: 3.10, m: 38, v: 0.75 },
    { i: 'timpRoll', t: 3.35, m: 38, d: 1.30, v: 0.4, v1: 0.05 },
    { i: 'taiko', t: 3.10, v: 0.6 },
  ],
};

/** Lookup used by the director. */
export const SCORES = { harbor: HARBOR, calm: CALM, chart: CHART, battle: BATTLE, victory: VICTORY, defeat: DEFEAT };
