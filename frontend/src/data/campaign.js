// ── CAMPAIGN DATA — World Chart regions + missions ─────────────────
// design/gdd/sea-battle.md, design/gdd/campaign-meta.md
//
// Mission schema
//   id, region, chart:{x,y} (0..1 on the chart image), nm, desc
//   objective: { type:'sink_all' }
//            | { type:'destroy_forts' }
//            | { type:'survive', seconds, waves:[{ at, ships:[EnemySpec] }] }
//            | { type:'capture', islands:[islandId] }
//   enemies:  [EnemySpec]  — EnemySpec = { hull, nm?, loadout?, x, z, hp? }
//             hull = HULLS id (data/harbor.js) or class 'light'|'standard'|'heavy'
//   islands:  [IslandDef]  — data/maps.js format; `decor:true` = scenery only
//   spawn:    { x, z, angle? } — player fleet start
//   parTime:  seconds for ★★★ ; timeLimit?: seconds (defeat when exceeded)
//   reward:{wood,gold}, firstClear:{wood,gold}, renown, requires:[missionId]
//   aggro?: radius at which guarding enemies engage (default 70)
// Coordinates: world units, map is ±150. Player usually spawns west.

export const REGIONS = [
  { id: 'reef',    nm: 'Coral Shallows',   minRenown: 0,  col: '#5cc8a8', desc: 'Warm shoals where smugglers hide among the reefs.' },
  { id: 'straits', nm: 'Saltwind Straits', minRenown: 30, col: '#e8b840', desc: 'A narrow passage held by corsair captains and their batteries.' },
  { id: 'storm',   nm: 'Stormreach',       minRenown: 90, col: '#cc6688', desc: 'Black water, iron fleets and the Citadel of Storms.' },
];

const rock = (id, x, z, r = 7, seed = 11, shape = 'SPRAWL') =>
  ({ id, x, z, r, hp: 60, nm: 'Rocks', own: 'neutral', tdmg: 0, trof: 99, shape, seed, decor: true });

export const MISSIONS = [
  // ── Coral Shallows ───────────────────────────────────────────
  {
    id: 'reef_1', region: 'reef', chart: { x: .16, y: .70 },
    nm: "Smugglers' Cove",
    desc: 'Two smuggler sloops are running contraband past our waters. Sink them.',
    objective: { type: 'sink_all' },
    enemies: [
      { hull: 'sloop', nm: 'Quiet Eel',   x: 55, z: -12, loadout: { L: 'swivel', R: 'swivel' } },
      { hull: 'sloop', nm: 'Night Heron', x: 62, z: 14,  loadout: { L: 'swivel', R: 'falconet' } },
    ],
    islands: [rock('r1', 10, -40, 8, 101), rock('r2', 18, 42, 7, 202, 'CRESCENT')],
    spawn: { x: -70, z: 0 }, parTime: 150,
    reward: { wood: 120, gold: 80 }, firstClear: { wood: 100, gold: 80 }, renown: 10, requires: [],
  },
  {
    id: 'reef_2', region: 'reef', chart: { x: .27, y: .55 },
    nm: 'Lantern Rock Battery',
    desc: 'A smuggler battery on Lantern Rock fires on every merchant. Silence its fort.',
    objective: { type: 'destroy_forts' },
    enemies: [
      { hull: 'sloop', nm: 'Rock Guard', x: 40, z: 18, loadout: { L: 'carronade', R: 'swivel' } },
    ],
    islands: [
      { id: 'lantern', x: 60, z: 0, r: 11, hp: 170, nm: 'Lantern Rock', own: 'enemy', tdmg: 9, trof: 8, shape: 'FORTRESS', seed: 3131 },
      rock('r3', -10, 46, 7, 303),
    ],
    spawn: { x: -70, z: 10 }, parTime: 200,
    reward: { wood: 160, gold: 120 }, firstClear: { wood: 140, gold: 100 }, renown: 14, requires: ['reef_1'],
  },
  {
    id: 'reef_3', region: 'reef', chart: { x: .12, y: .40 },
    nm: 'Hold the Channel',
    desc: 'Raiders are coming in waves. Keep at least one ship afloat until the tide turns.',
    objective: {
      type: 'survive', seconds: 150,
      waves: [
        { at: 4,   ships: [{ hull: 'sloop', x: 90, z: -30 }, { hull: 'sloop', x: 92, z: 30 }] },
        { at: 55,  ships: [{ hull: 'schooner', x: 95, z: 0 }, { hull: 'sloop', x: 90, z: -45 }] },
        { at: 100, ships: [{ hull: 'brigantine', x: 95, z: 10, loadout: { L: 'carronade', R: 'carronade' } }, { hull: 'sloop', x: 90, z: 45 }] },
      ],
    },
    enemies: [],
    islands: [rock('r4', 0, -30, 9, 404), rock('r5', 0, 30, 9, 505, 'ATOLL')],
    spawn: { x: -60, z: 0 }, parTime: 150,
    reward: { wood: 180, gold: 110 }, firstClear: { wood: 120, gold: 100 }, renown: 14, requires: ['reef_1'],
  },

  // ── Saltwind Straits ─────────────────────────────────────────
  {
    id: 'straits_1', region: 'straits', chart: { x: .45, y: .48 },
    nm: 'Corsair Squadron',
    desc: 'Captain Vey leads a brigantine and two sloops through the straits. Break the squadron.',
    objective: { type: 'sink_all' },
    enemies: [
      { hull: 'brigantine', nm: 'Red Vixen', x: 60, z: 0,   loadout: { L: 'demi_culv', R: 'demi_culv', B: 'swivel' } },
      { hull: 'sloop',      nm: 'Barb',      x: 66, z: -16, loadout: { L: 'carronade', R: 'carronade' } },
      { hull: 'sloop',      nm: 'Hook',      x: 66, z: 16,  loadout: { L: 'falconet', R: 'carronade' } },
    ],
    islands: [rock('s1', 5, -55, 12, 606, 'CRESCENT'), rock('s2', 5, 55, 12, 707)],
    spawn: { x: -72, z: 0 }, parTime: 220,
    reward: { wood: 240, gold: 180 }, firstClear: { wood: 200, gold: 160 }, renown: 18, requires: ['reef_2'],
  },
  {
    id: 'straits_2', region: 'straits', chart: { x: .56, y: .32 },
    nm: 'Seize Gullhaven',
    desc: 'Gullhaven has a fine harbor and no master. Claim it before the corsairs do.',
    objective: { type: 'capture', islands: ['gullhaven'] },
    enemies: [
      { hull: 'brigantine', nm: 'Saltjack', x: 40, z: -24, loadout: { L: 'demi_culv', R: 'carronade', B: 'swivel' } },
      { hull: 'schooner',   nm: 'Skua',     x: 44, z: 24,  loadout: { L: 'carronade', R: 'carronade' } },
    ],
    islands: [
      { id: 'gullhaven', x: 30, z: 0, r: 10, hp: 120, nm: 'Gullhaven', own: 'neutral', tdmg: 0, trof: 99, shape: 'ATOLL', seed: 8181, trait: 'haven' },
      rock('s3', -20, -50, 8, 808),
    ],
    spawn: { x: -70, z: 0 }, parTime: 200,
    reward: { wood: 260, gold: 200 }, firstClear: { wood: 220, gold: 180 }, renown: 18, requires: ['reef_3'],
  },
  {
    id: 'straits_3', region: 'straits', chart: { x: .66, y: .52 },
    nm: 'The Twin Batteries',
    desc: 'Two batteries guard the Saltwind narrows, with a frigate on patrol. Bring them down.',
    objective: { type: 'destroy_forts' },
    enemies: [
      { hull: 'frigate', nm: 'Grey Warden', x: 50, z: 0, loadout: { L: 'demi_culv', R: 'demi_culv', B: 'long9' } },
    ],
    islands: [
      { id: 'tw_n', x: 65, z: -32, r: 10, hp: 190, nm: 'North Battery', own: 'enemy', tdmg: 12, trof: 7, shape: 'FORTRESS', seed: 9191 },
      { id: 'tw_s', x: 65, z: 32,  r: 10, hp: 190, nm: 'South Battery', own: 'enemy', tdmg: 12, trof: 7, shape: 'FORTRESS', seed: 9292 },
    ],
    spawn: { x: -70, z: 0 }, parTime: 300,
    reward: { wood: 320, gold: 260 }, firstClear: { wood: 260, gold: 220 }, renown: 24, requires: ['straits_1', 'straits_2'],
  },

  // ── Stormreach ───────────────────────────────────────────────
  {
    id: 'storm_1', region: 'storm', chart: { x: .76, y: .74 },
    nm: 'Black Squall',
    desc: 'Caught in the squall with raiders on every side. Survive until the storm breaks.',
    objective: {
      type: 'survive', seconds: 200,
      waves: [
        { at: 4,   ships: [{ hull: 'brigantine', x: 90, z: 0, loadout: { L: 'demi_culv', R: 'demi_culv' } }, { hull: 'sloop', x: 0, z: -95 }] },
        { at: 60,  ships: [{ hull: 'frigate', x: 95, z: -30, loadout: { L: 'demi_culv', R: 'demi_culv', B: 'long9' } }, { hull: 'schooner', x: 0, z: 95 }] },
        { at: 120, ships: [{ hull: 'galleon', x: 95, z: 25, loadout: { L: 'demi_can', R: 'demi_can', B: 'mortar1' } }, { hull: 'sloop', x: -20, z: -95 }, { hull: 'sloop', x: -20, z: 95 }] },
      ],
    },
    enemies: [],
    islands: [rock('t1', 20, -20, 10, 1212, 'FORTRESS'), rock('t2', 20, 30, 8, 1313)],
    spawn: { x: -40, z: 0 }, parTime: 200,
    reward: { wood: 380, gold: 300 }, firstClear: { wood: 300, gold: 260 }, renown: 28, requires: ['straits_3'],
  },
  {
    id: 'storm_2', region: 'storm', chart: { x: .86, y: .55 },
    nm: 'Iron Armada',
    desc: 'The Iron Armada sails to blockade our ports. Meet it at sea and send it to the bottom.',
    objective: { type: 'sink_all' },
    enemies: [
      { hull: 'galleon',    nm: 'Ironclad Maw', x: 70, z: 0,   loadout: { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'long9' } },
      { hull: 'frigate',    nm: 'Grim Tern',    x: 62, z: -22, loadout: { L: 'demi_culv', R: 'demi_culv', B: 'long9' } },
      { hull: 'brigantine', nm: 'Ash Rook',     x: 62, z: 22,  loadout: { L: 'chain_shot', R: 'demi_culv', B: 'swivel' } },
      { hull: 'sloop',      nm: 'Cinder',       x: 78, z: 30,  loadout: { L: 'grapeshot', R: 'carronade' } },
    ],
    islands: [rock('t3', 0, -60, 12, 1414, 'CRESCENT'), rock('t4', 0, 60, 12, 1515, 'ATOLL')],
    spawn: { x: -75, z: 0 }, parTime: 300,
    reward: { wood: 460, gold: 380 }, firstClear: { wood: 400, gold: 320 }, renown: 32, requires: ['storm_1'],
  },
  {
    id: 'storm_3', region: 'storm', chart: { x: .90, y: .28 },
    nm: 'Citadel of Storms',
    desc: 'The Citadel commands Stormreach. Its walls, its galleon and its man-o-war must fall.',
    objective: { type: 'destroy_forts' },
    enemies: [
      { hull: 'man_o_war', nm: 'Leviathan', x: 55, z: -14, loadout: { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'demi_culv' } },
      { hull: 'galleon',   nm: 'Dread Gull', x: 55, z: 16, loadout: { L: 'demi_culv', R: 'demi_can', B: 'long9', S: 'swivel' } },
    ],
    islands: [
      { id: 'citadel', x: 80, z: 0, r: 14, hp: 420, nm: 'Citadel of Storms', own: 'enemy', tdmg: 18, trof: 5, shape: 'FORTRESS', seed: 1616, trait: 'bastion' },
      rock('t5', 10, -50, 9, 1717), rock('t6', 10, 50, 9, 1818, 'CRESCENT'),
    ],
    spawn: { x: -75, z: 0 }, parTime: 420,
    reward: { wood: 700, gold: 600 }, firstClear: { wood: 600, gold: 500 }, renown: 45, requires: ['storm_2'],
  },
];

// ── Repeatable patrol (generated from rank, see Meta/Campaign.makePatrol) ──
export const PATROL = {
  id: 'patrol', chart: { x: .34, y: .80 }, nm: 'Pirate Patrol',
  desc: 'Sweep the nearby waters for pirates. Repeatable; grows tougher with your rank.',
  baseReward: { wood: 70, gold: 50 }, rewardPerRank: { wood: 40, gold: 30 },
  renown: 4,
  /** Enemy hull pools by rank index (0 = Captain). */
  pools: [
    ['sloop', 'sloop'],
    ['sloop', 'schooner', 'sloop'],
    ['brigantine', 'sloop', 'schooner'],
    ['frigate', 'brigantine', 'sloop'],
    ['galleon', 'frigate', 'brigantine', 'sloop'],
  ],
  loadouts: {
    light:    { L: 'carronade', R: 'swivel' },
    standard: { L: 'demi_culv', R: 'demi_culv', B: 'swivel' },
    heavy:    { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'swivel' },
  },
};

/** Open War = the classic full match (mode=skirmish). */
export const OPEN_WAR = { id: 'open_war', chart: { x: .50, y: .84 }, nm: 'Open War' };
