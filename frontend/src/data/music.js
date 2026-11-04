// ── data/music.js ───────────────────────────────────────────────────
// Score + mix data for the procedural MusicDirector (Experience/Utils/
// MusicDirector.js). Pure data — no logic, no imports.
//
// Setting: 16th–early 18th century (pirates, a chartered trading company,
// the Spanish navy). Instruments are period-plausible: fiddle, hurdy-gurdy,
// concertina/musette, lute & baroque guitar, cittern, theorbo, recorder &
// tin whistle, bodhrán, castanets, side & field drums, kettledrums, natural
// trumpets & horns, a string band and oboe. No synth pads.
//
// Every tune here is ORIGINAL, written for Isles of War. Melodies are
// [midi, steps] pairs per bar (0 = rest); a "step" is the track's grid unit
// (an eighth in 6/8 harbor/calm, an eighth in the chart, a sixteenth in
// battle). Each bar's steps must sum to `stepsPerBar`.
// Chord symbols: root + quality ('', m, 7, m7, maj7, sus2, sus4, m9, add9, 6)
// with optional /bass.
//
// Channel strip keys: gain, pan (-1..1), hp/lp (Hz), peak [Hz, dB, Q],
// send (reverb), trem [rateHz, depth] (bellows / wheel wobble).
// Design rationale: design/audio-direction.md

/** Global music mix + scheduler settings. */
export const MUSIC_MIX = {
  defaultVolume:       0.7,    // user music volume (0..1) when nothing is stored
  crossfadeSec:        2.0,    // track → track
  stingerFadeSec:      1.0,    // how fast the old track gets out of a stinger's way
  afterStingerFadeSec: 3.0,    // stinger → calm bed
  lookaheadSec:        0.30,   // schedule this far ahead of AudioContext.currentTime
  tickMs:              50,     // scheduler wake-up period
  maxVoices:           72,     // music voice budget (oscillators/sources alive)
  intensitySlewSec:    1.6,    // battle intensity smoothing time constant
  intenseFloor:        0.85,   // 'battle_intense' = battle score with this intensity floor
  reverb: { seconds: 2.6, rt60: 2.0, preDelay: 0.014, highpass: 240, ret: 0.55 },
  compressor: { threshold: -26, knee: 10, ratio: 3, attack: 0.01, release: 0.25 },
  // Post-compressor trim. Calibrated offline (tools/audio_check.mjs) against the compressor's
  // automatic makeup gain: full-band tracks land at ~0.09–0.12 RMS, peaks ≤ 0.75 at volume 1.
  trim: 1.0,
};

/** Ambience beds (routed to the SFX bus — not affected by music mute). */
export const AMBIENCE_MIX = {
  fadeSec: 2.5,
  level: 1.0,
  harbor: {
    waves: 0.30, lap: 0.12, gulls: 0.07, hammer: 0.08, creak: 0.06, saw: 0.035,
    swellEvery: [4.5, 7.5], lapEvery: [0.6, 2.0], gullEvery: [5, 13],
    hammerEvery: [7, 16], creakEvery: [4, 10], sawEvery: [24, 50],
  },
  sea: {
    wind: 0.20, whistle: 0.03, waves: 0.36, crest: 0.12, creak: 0.05,
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
    fiddle:  { gain: 1.25, pan:  0.16, hp: 220, lp: 6000, peak: [2700, 3, 1.1], send: 0.30 },
    whistle: { gain: 0.55, pan: -0.12, hp: 500, lp: 8000, send: 0.32 },
    gurdy:   { gain: 0.80, pan: -0.20, hp: 110, lp: 3800, peak: [1500, 4, 1.2], send: 0.22, trem: [1.1, 0.04] },
    reed:    { gain: 0.80, pan: -0.28, hp: 140, lp: 3400, peak: [1250, 2.5, 0.9], send: 0.22, trem: [4.4, 0.06] },
    lute:    { gain: 0.95, pan:  0.34, hp: 100, lp: 6500, send: 0.16 },
    cittern: { gain: 0.90, pan: -0.38, hp: 250, lp: 8000, send: 0.24 },
    bass:    { gain: 0.48, pan:  0.00, hp: 35,  lp: 1500, send: 0.04 },
    drum:    { gain: 1.00, pan: -0.10, send: 0.12 },
    shaker:  { gain: 0.50, pan:  0.45, hp: 4800, send: 0.08 },
    cast:    { gain: 0.50, pan: -0.42, hp: 1200, send: 0.14 },
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
  // gurdy = hurdy-gurdy chanter, cittern = tremolo-picked cittern, both = fiddle + whistle.
  plan: [
    { A: 'fiddle',  A2: 'whistle', B: 'fiddle',  A3: 'both' },
    { A: 'gurdy',   A2: 'fiddle',  B: 'whistle', A3: 'both' },
    { A: 'cittern', A2: 'fiddle',  B: 'gurdy',   A3: 'both' },
  ],
};

// ── CALM — post-victory / evening bed · D major · slow 6/8 ──────────
export const CALM = {
  bpm: 50, beatSteps: 3, stepsPerBar: 6,
  scale: [2, 4, 6, 7, 9, 11, 1],
  channels: {
    reed:     { gain: 0.80, pan: -0.22, hp: 140, lp: 2600, peak: [1100, 2, 0.9], send: 0.32, trem: [3.6, 0.05] },
    lute:     { gain: 0.95, pan:  0.30, hp: 100, lp: 5200, send: 0.26 },
    bass:     { gain: 0.45, pan:  0.00, hp: 35,  lp: 1200, send: 0.06 },
    recorder: { gain: 0.80, pan: -0.08, hp: 300, lp: 7000, send: 0.40 },
  },
  sections: { main: { chords: ['D', 'G/D', 'D', 'A', 'Bm', 'G', 'A', 'D'] } },
  // A slowed echo of the harbor tune's opening, over the first four bars.
  melodies: {
    frag: [
      [[69, 2], [74, 1], [78, 3]],   // D
      [[0, 6]],                      // G/D
      [[78, 2], [76, 1], [74, 3]],   // D
      [[0, 6]],                      // A
    ],
  },
};

// ── CHART — "Uncharted" · D dorian · 4/4, slow & mysterious ─────────
export const CHART = {
  bpm: 64, beatSteps: 2, stepsPerBar: 8,
  scale: [2, 4, 5, 7, 9, 11, 0],                   // D dorian (B natural = the "open sky" note)
  channels: {
    drone:    { gain: 0.45, pan:  0.00, hp: 45,  lp: 2000, peak: [650, 3, 1.0], send: 0.30, trem: [0.8, 0.03] },
    viols:    { gain: 0.75, pan: -0.15, hp: 140, lp: 3000, send: 0.45 },
    harp:     { gain: 1.00, pan:  0.30, hp: 120, lp: 5500, send: 0.45 },
    recorder: { gain: 0.75, pan: -0.22, hp: 300, lp: 7000, send: 0.50 },
    bell:     { gain: 0.45, pan:  0.40, hp: 300, lp: 5000, send: 0.65 },
    horn:     { gain: 0.70, pan:  0.20, hp: 60,  lp: 1500, send: 0.50 },
    pulse:    { gain: 0.80, pan:  0.00, send: 0.25 },
    // regional colours (music.setRegion)
    lead:     { gain: 0.80, pan: -0.15, hp: 200, lp: 7500, send: 0.50 },
    tanpura:  { gain: 0.80, pan:  0.20, hp: 90,  lp: 6000, peak: [2400, 4, 1.0], send: 0.35 },
    zheng:    { gain: 1.00, pan:  0.35, hp: 150, lp: 7000, send: 0.45 },
    hand:     { gain: 0.80, pan: -0.10, hp: 50,  send: 0.20 },
    metal:    { gain: 0.70, pan:  0.25, hp: 200, lp: 8000, send: 0.45 },
    gong:     { gain: 1.00, pan: -0.20, hp: 30,  send: 0.50 },
    wood:     { gain: 1.00, pan:  0.30, hp: 400, send: 0.25 },
  },
  sections: {
    main: { chords: ['Dm9', 'Dm9', 'Em/D', 'Em/D', 'Bbmaj7', 'Bbmaj7', 'Csus2', 'Csus2',
                     'Dm9', 'Dm9', 'Gm/D', 'Gm/D', 'Bbmaj7', 'Bbmaj7', 'Asus4', 'A'] },
  },
  // Recorder phrase bank; notes get snapped to the bar's chord/scale.
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
// Spanish colour: the B section walks the Andalusian cadence (Em–D–C–B) with
// castanets; the bridge turns phrygian (Am–G–F–E) under baroque-guitar rasgueado.
export const BATTLE = {
  bpm: 126, beatSteps: 4, stepsPerBar: 16,
  scale: [4, 6, 7, 9, 11, 0, 2],                   // E aeolian (D# arrives with the B chord)
  channels: {
    low:     { gain: 1.00, pan: -0.10, hp: 38,  lp: 2400, send: 0.10 },
    strings: { gain: 0.80, pan:  0.22, hp: 150, lp: 2800, send: 0.35 },
    violins: { gain: 1.30, pan: -0.18, hp: 200, lp: 6500, peak: [2600, 2.5, 1.0], send: 0.30 },
    oboe:    { gain: 0.80, pan:  0.10, hp: 300, lp: 5500, send: 0.25 },
    trumpet: { gain: 0.85, pan:  0.12, hp: 150, lp: 7000, send: 0.28 },
    timp:    { gain: 0.80, pan: -0.25, hp: 30,  send: 0.25 },
    drum:    { gain: 0.50, pan:  0.05, hp: 28,  send: 0.18 },
    snare:   { gain: 1.50, pan:  0.28, hp: 180, send: 0.15 },
    cast:    { gain: 0.55, pan: -0.35, hp: 1200, send: 0.18 },
    lute:    { gain: 0.80, pan:  0.40, hp: 100, lp: 6000, send: 0.20 },
    fife:    { gain: 0.45, pan: -0.30, hp: 600, lp: 9000, send: 0.22 },
    // regional colours (music.setRegion)
    lead:    { gain: 0.90, pan: -0.15, hp: 200, lp: 8000, send: 0.30 },
    tanpura: { gain: 0.75, pan:  0.25, hp: 90,  lp: 6000, peak: [2400, 4, 1.0], send: 0.25 },
    hand:    { gain: 0.55, pan: -0.05, hp: 50,  send: 0.15 },
    metal:   { gain: 1.40, pan:  0.30, hp: 200, lp: 8000, send: 0.30 },
    gong:    { gain: 0.80, pan: -0.20, hp: 30,  send: 0.35 },
    wood:    { gain: 1.10, pan:  0.35, hp: 400, send: 0.18 },
  },
  sections: {
    intro:  { chords: ['Em', 'Em'] },
    A:      { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B'],  mel: 'A' },
    B:      { chords: ['Em', 'D', 'C', 'B', 'Em', 'D', 'C', 'B'],    mel: 'B' },
    A2:     { chords: ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B'],  mel: 'A' },
    bridge: { chords: ['Am', 'G', 'F', 'E'] },
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
      [[71, 4], [76, 4], [79, 6], [78, 2]],            // Em
      [[78, 4], [74, 4], [69, 8]],                     // D
      [[72, 4], [76, 4], [79, 6], [76, 2]],            // C
      [[75, 8], [72, 4], [71, 4]],                     // B  (D#–C–B: the Spanish augmented second)
      [[76, 6], [79, 2], [78, 4], [76, 4]],            // Em
      [[74, 6], [78, 2], [76, 4], [74, 4]],            // D
      [[72, 6], [76, 2], [74, 4], [72, 4]],            // C
      [[71, 12], [0, 4]],                              // B
    ],
    // Natural-trumpet calls (harmonic-series notes of a trumpet in E: E, B).
    callIntro: [[71, 2], [76, 2], [76, 1], [76, 1], [76, 2], [83, 6], [0, 2]],
    call:      [[76, 1], [76, 1], [76, 2], [83, 4]],
  },
  // Low-string ostinato, semitone offsets from the chord root per eighth note.
  ostinato:     [0, 0, 0, 7, 0, 0, 12, 7],
  ostinatoTurn: [0, 12, 0, 12, 7, 12, 7, 5],
  ostinatoVel:  [1.0, 0.55, 0.6, 0.92, 0.55, 0.6, 0.95, 0.7],
  // Castanets per bar: [step, velocity, roll-into?]
  castanets: [[0, 0.9], [3, 0.45], [6, 0.85, 1], [8, 0.5], [10, 0.45], [12, 0.9, 1], [14, 0.5]],
  // Hand-drum cycles per bar of sixteenths (original patterns; strokes: dha ghe na tin ta te).
  tabla:    ['dha', null, 'na', 'ta', 'dha', null, 'na', 'te', 'ghe', 'na', 'ta', 'na', 'dha', 'te', 'na', 'ta'],
  tablaVel: [1.0, 0, 0.5, 0.4, 0.8, 0, 0.5, 0.35, 0.7, 0.45, 0.4, 0.45, 0.9, 0.35, 0.5, 0.45],
  kendang:  ['ghe', null, null, 'te', 'ta', null, 'ghe', null, 'te', null, 'ta', 'te', 'ghe', null, 'ta', 'te'],
};

// ── REGIONS — music.setRegion(seaId) colours the battle + chart themes ──
// Scales are pitch-class sets (battle in E, chart in D). harmony 'european'
// follows the score's chords; 'drone' holds the tonic so modal lines can float.
export const REGIONS = {
  // Shanty & Iberian colours: string band, oboe, trumpets, castanets, baroque guitar.
  caribbean:  { harmony: 'european', spanish: 1.0, chartLead: 'recorder' },
  // The Atlantic crowns: same palette, more fife-and-drum, less Spain.
  atlantic:   { harmony: 'european', spanish: 0.5, chartLead: 'recorder' },
  // Indian Ocean: tanpura drone, shehnai/bansuri raga-like lines with meend, tabla-like drums, naubat trumpets & kettledrums.
  indian:     { harmony: 'drone', battleDrone: 'Em', chartDrone: 'Dm', battleLead: 'shehnai', chartLead: 'bansuri',
                battleScale: [4, 5, 7, 9, 11, 0, 2],   // E with flat 2nd & 6th (Bhairavi-like)
                chartScale:  [2, 4, 5, 7, 9, 11, 0] }, // D Kafi-like (dorian)
  // Spice Straits: gong cycle, bonang/saron interlocking ostinato on a pelog-like set, suling flute.
  spice:      { harmony: 'drone', battleDrone: 'Em', chartDrone: 'Dm', battleLead: 'suling', chartLead: 'suling',
                battleScale: [4, 5, 7, 11, 0],         // E F G B C (pelog-like)
                chartScale:  [2, 3, 5, 9, 10] },       // D Eb F A Bb
  // South China Sea: pentatonic dizi, đàn bầu pitch-bends, luo gongs, bo cymbals, woodblock.
  southchina: { harmony: 'drone', battleDrone: 'Em', chartDrone: 'Dm', battleLead: 'dizi', chartLead: 'danbau',
                battleScale: [4, 7, 9, 11, 2],         // E minor pentatonic
                chartScale:  [2, 5, 7, 9, 0] },        // D yu-mode pentatonic
};

// ── STINGERS (seconds) ──────────────────────────────────────────────
const STINGER_CHANNELS = {
  trumpet: { gain: 0.85, pan:  0.12, hp: 150, lp: 7000, send: 0.32 },
  horn:    { gain: 0.80, pan: -0.25, hp: 60,  lp: 1600, send: 0.45 },
  strings: { gain: 0.90, pan:  0.20, hp: 90,  lp: 2800, send: 0.40 },
  violins: { gain: 0.90, pan: -0.15, hp: 200, lp: 6500, peak: [2600, 2.5, 1.0], send: 0.38 },
  oboe:    { gain: 0.55, pan:  0.08, hp: 300, lp: 5500, send: 0.35 },
  low:     { gain: 0.90, pan: -0.05, hp: 35,  lp: 2000, send: 0.20 },
  timp:    { gain: 1.00, pan: -0.25, hp: 30,  send: 0.30 },
  drum:    { gain: 0.90, pan:  0.05, hp: 28,  send: 0.22 },
};

/** Victory: original baroque trumpets-and-kettledrums fanfare in D, then the CALM bed.
 *  Trumpet lines use only natural-harmonic notes of a D trumpet (D A D F# A D). */
export const VICTORY = {
  channels: STINGER_CHANNELS, length: 6.4, thenAt: 5.4, then: 'calm',
  events: [
    { i: 'timpRoll', t: 0.00, m: 45, d: 0.90, v: 0.25, v1: 0.9 },
    { i: 'drum', t: 0.95, v: 0.9 },
    { i: 'timp', t: 0.95, m: 50, v: 0.9 },
    // Trumpet I
    { i: 'trumpet', t: 0.95, m: 69, d: 0.14, v: 0.85 },
    { i: 'trumpet', t: 1.10, m: 74, d: 0.14, v: 0.88 },
    { i: 'trumpet', t: 1.25, m: 78, d: 0.14, v: 0.92 },
    { i: 'trumpet', t: 1.40, m: 81, d: 0.80, v: 1.00 },
    { i: 'trumpet', t: 2.30, m: 81, d: 0.15, v: 0.85 },
    { i: 'trumpet', t: 2.47, m: 78, d: 0.15, v: 0.85 },
    { i: 'trumpet', t: 2.64, m: 74, d: 0.15, v: 0.85 },
    { i: 'trumpet', t: 2.81, m: 78, d: 0.15, v: 0.88 },
    { i: 'trumpet', t: 2.98, m: 81, d: 0.30, v: 0.92 },
    { i: 'trumpet', t: 3.32, m: 86, d: 2.10, v: 1.00 },
    // Trumpet II
    { i: 'trumpet', t: 0.95, m: 62, d: 0.14, v: 0.70 },
    { i: 'trumpet', t: 1.10, m: 69, d: 0.14, v: 0.72 },
    { i: 'trumpet', t: 1.25, m: 74, d: 0.14, v: 0.75 },
    { i: 'trumpet', t: 1.40, m: 78, d: 0.80, v: 0.80 },
    { i: 'trumpet', t: 2.30, m: 78, d: 0.15, v: 0.70 },
    { i: 'trumpet', t: 2.47, m: 74, d: 0.15, v: 0.70 },
    { i: 'trumpet', t: 2.64, m: 69, d: 0.15, v: 0.70 },
    { i: 'trumpet', t: 2.81, m: 74, d: 0.15, v: 0.72 },
    { i: 'trumpet', t: 2.98, m: 69, d: 0.30, v: 0.75 },
    { i: 'trumpet', t: 3.32, m: 81, d: 2.10, v: 0.85 },
    // Strings: D … A … D
    { i: 'strings', t: 0.95, m: [50, 57, 62, 66], d: 1.95, v: 0.7 },
    { i: 'violins', t: 2.30, m: 78, d: 0.15, v: 0.6 },
    { i: 'violins', t: 2.47, m: 76, d: 0.15, v: 0.6 },
    { i: 'violins', t: 2.64, m: 74, d: 0.15, v: 0.6 },
    { i: 'violins', t: 2.81, m: 76, d: 0.15, v: 0.62 },
    { i: 'strings', t: 2.98, m: [57, 61, 64, 69], d: 0.32, v: 0.75 },
    { i: 'violins', t: 2.98, m: 73, d: 0.30, v: 0.65 },
    { i: 'strings', t: 3.32, m: [50, 57, 62, 66, 69], d: 2.3, v: 0.8 },
    { i: 'low', t: 3.32, m: 38, d: 2.3, v: 0.7 },
    // Kettledrums on tonic and dominant, as in the period
    { i: 'timp', t: 2.30, m: 50, v: 0.6 },
    { i: 'timp', t: 2.98, m: 45, v: 0.8 },
    { i: 'timp', t: 3.32, m: 50, v: 1.0 },
    { i: 'drum', t: 3.32, v: 0.85 },
    { i: 'timpRoll', t: 3.55, m: 50, d: 1.4, v: 0.5, v1: 0.06 },
  ],
};

/** Defeat: a lament over the descending tetrachord D–C–Bb–A, muffled drums, then silence. */
export const DEFEAT = {
  channels: STINGER_CHANNELS, length: 6.4, thenAt: 6.2, then: null,
  events: [
    { i: 'strings', t: 0.00, m: [53, 57, 62], d: 0.80, v: 0.55, a: 0.3 },   // Dm
    { i: 'low',     t: 0.00, m: 50, d: 0.80, v: 0.7 },
    { i: 'strings', t: 0.80, m: [52, 57, 60], d: 0.80, v: 0.55 },            // Am/C
    { i: 'low',     t: 0.80, m: 48, d: 0.80, v: 0.68 },
    { i: 'strings', t: 1.60, m: [50, 53, 58], d: 0.80, v: 0.55 },            // Bb
    { i: 'low',     t: 1.60, m: 46, d: 0.80, v: 0.66 },
    { i: 'strings', t: 2.40, m: [49, 52, 57], d: 0.90, v: 0.58 },            // A
    { i: 'low',     t: 2.40, m: 45, d: 0.90, v: 0.66 },
    { i: 'strings', t: 3.30, m: [50, 53, 57, 62], d: 2.70, v: 0.55 },        // Dm
    { i: 'low',     t: 3.30, m: 38, d: 2.70, v: 0.6 },
    { i: 'violins', t: 0.05, m: 69, d: 0.72, v: 0.66, dbl: 1 },
    { i: 'violins', t: 0.80, m: 67, d: 0.38, v: 0.6,  dbl: 1 },
    { i: 'violins', t: 1.20, m: 64, d: 0.38, v: 0.58, dbl: 1 },
    { i: 'violins', t: 1.60, m: 65, d: 0.38, v: 0.6,  dbl: 1 },
    { i: 'violins', t: 2.00, m: 62, d: 0.38, v: 0.56, dbl: 1 },
    { i: 'violins', t: 2.40, m: 64, d: 0.42, v: 0.6,  dbl: 1 },
    { i: 'violins', t: 2.85, m: 61, d: 0.42, v: 0.56, dbl: 1 },
    { i: 'violins', t: 3.30, m: 62, d: 2.50, v: 0.58, dbl: 1 },
    { i: 'horn', t: 0.20, m: 62, d: 0.35, v: 0.42 },                         // distant retreat call
    { i: 'horn', t: 0.60, m: 57, d: 0.90, v: 0.4 },
    { i: 'muffled', t: 0.00, v: 0.55 },
    { i: 'muffled', t: 0.80, v: 0.42 },
    { i: 'muffled', t: 1.60, v: 0.45 },
    { i: 'muffled', t: 2.40, v: 0.48 },
    { i: 'muffled', t: 3.30, v: 0.6 },
    { i: 'timpRoll', t: 3.30, m: 38, d: 1.60, v: 0.35, v1: 0.04 },
  ],
};

/** Lookup used by the director. */
export const SCORES = { harbor: HARBOR, calm: CALM, chart: CHART, battle: BATTLE, victory: VICTORY, defeat: DEFEAT };
