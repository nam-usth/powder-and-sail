// ── CAMPAIGN DATA — World Chart seas + missions ───────────────────
// design/gdd/sea-battle.md, design/gdd/campaign-meta.md
// Balance values: design/balance/report.md (every number + rationale),
// targets: design/balance/targets.md. Setting: c. 1570–1720, factions in
// data/factions.js (FACTIONS / SEAS) — names are fictional analogues.
//
// Mission schema
//   id, region (sea id), faction, chart:{x,y} (0..1 on the world chart), nm, desc
//   objective: { type:'sink_all' }
//            | { type:'destroy_forts' }
//            | { type:'survive', seconds, waves:[{ at, ships:[EnemySpec] }] }
//            | { type:'capture', islands:[islandId] }
//   enemies:  [EnemySpec]  — EnemySpec = { hull, nm?, loadout?, x, z, hp?, faction? }
//             hull = HULLS id (data/harbor.js, incl. enemyOnly hulls) or a class
//             'light'|'standard'|'heavy'; faction overrides the mission faction
//   islands:  [IslandDef]  — data/maps.js format; `decor:true` = scenery only
//   spawn:    { x, z, angle? } — player fleet start
//   parTime:  seconds for ★★★ ; timeLimit?: seconds (defeat when exceeded)
//   reward:{wood,gold}, firstClear:{wood,gold}, renown, requires:[missionId]
//            | { type:'sink_target' }  — sink every EnemySpec with prize:true before it
//                                          reaches `escape` (defeat 'escaped'); escorts optional
//   aggro?:   radius at which guarding enemies engage (default BATTLE.aggro)
//   fortRegen?: fort HP regained per repair tick (fraction of max, default BATTLE.fortRegen)
//   escape?:  { x, z, r?, route?:[{x,z}] } — where prizes and `fleeHp` runners sail;
//             an enemy that gets there leaves the battle (no plunder)
//   ai?:      fleet behaviour (Systems/AI/EnemyAI battle tactics, MissionSystem.enemyAi):
//             { aggro?, tactic?, leash?, fleeHp?, kiteFrac?, byHull?:{ <hullId>: {…} } }
//   EnemySpec extras: prize?:true, spdMult? (laden prize), ai?:{ tactic, leash, fleeHp,
//             route:[{x,z}] (patrol loop until engaged), kiteDist }
//   tactic:   'engage' (wolfpack, default) · 'kite' (circle at ¾ gun range) ·
//             'guard' (engage, never chase past `leash` from its post) · 'hold' (stay on post)
// Variety map (design/gdd/sea-battle.md §Mission roster): each mission pairs an
// objective with an enemy behaviour so no two play alike.
// Coordinates: world units, map is ±150. Player spawns west.

/** Sea regions in campaign order (= data/factions.js SEAS). minRenown gates entry. */
export const REGIONS = [
  { id: 'caribbean',  nm: 'The Caribbean',       vi: 'Biển Caribe',          minRenown: 0,   col: '#5cc8a8',
    factions: ['buccaneers', 'spain', 'france'],
    desc: 'Warm shoals and coral cays where buccaneers, Spanish guarda-costas and French corsairs prey on free traders.' },
  { id: 'atlantic',   nm: 'The Atlantic Lanes',  vi: 'Hải lộ Đại Tây Dương', minRenown: 30,  col: '#6f9fd8',
    factions: ['england', 'france'],
    desc: 'The open trade lanes, policed by the armed Indiamen and coastal batteries of the Honourable Saltwind Company.' },
  { id: 'indian',     nm: 'The Indian Ocean',    vi: 'Ấn Độ Dương',          minRenown: 80,  col: '#e8b840',
    factions: ['portugal', 'malabar'],
    desc: 'Monsoon seas of the pepper trade: Portuguese carracks out of Goa and the swift ghurabs of the Malabar corsairs.' },
  { id: 'spice',      nm: 'The Spice Straits',   vi: 'Eo biển Hương liệu',   minRenown: 160, col: '#c97c3a',
    factions: ['netherlands', 'malay'],
    desc: 'Clove and nutmeg islands held by the Spice Company castles, and the lanong war-praus of the Orang Laut.' },
  { id: 'southchina', nm: 'The South China Sea', vi: 'Biển Đông',            minRenown: 260, col: '#cc5566',
    factions: ['chinese', 'vietnamese', 'portugal'],
    desc: 'Typhoon waters ruled by the war junks of the Red Banner Fleet and the raiders of the Gulf of Tonkin.' },
];

const rock = (id, x, z, r = 7, seed = 11, shape = 'SPRAWL') =>
  ({ id, x, z, r, hp: 60, nm: 'Rocks', own: 'neutral', tdmg: 0, trof: 99, shape, seed, decor: true });

// Faction gun fits (flavour + counters, see design/balance/report.md §Enemy fits)
const FIT = {
  pirateL:  { L: 'swivel', R: 'carronade' },
  falcL:    { L: 'falconet', R: 'carronade' },
  culvL:    { L: 'demi_culv', R: 'demi_culv' },
  grapeL:   { L: 'grapeshot', R: 'falconet' },
  chainL:   { L: 'chain_shot', R: 'falconet' },
  culvS:    { L: 'demi_culv', R: 'demi_culv', B: 'swivel' },
  longS:    { L: 'demi_culv', R: 'demi_culv', B: 'long9' },
  canS:     { L: 'demi_can', R: 'demi_culv', B: 'swivel' },
  junkS:    { L: 'demi_can', R: 'grapeshot', B: 'swivel' },
  galH:     { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'swivel' },
  lineH:    { L: 'demi_can', R: 'demi_culv', B: 'long9', S: 'swivel' },
  junkH:    { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'grapeshot' },
  // tier III–V fits (cannon tier ≤ hull tier, data/cannons.js)
  frigS3:   { L: 'demi_can', R: 'demi_culv', B: 'long12' },
  heavyS4:  { L: 'culverin', R: 'culverin', B: 'long12' },
  lineH4:   { L: 'culverin', R: 'carronade32', B: 'mortar2', S: 'swivel' },
  junkH4:   { L: 'carronade32', R: 'culverin', B: 'mortar2', S: 'grapeshot' },
  lineH5:   { L: 'cannon_royal', R: 'long24', B: 'mortar2', S: 'long12' },
};

export const MISSIONS = [
  // ── The Caribbean — buccaneers, Spain, France (tiers I–II) ─────────
  {
    id: 'reef_1', region: 'caribbean', faction: 'buccaneers', chart: { x: .133, y: .374 },
    nm: "Smugglers' Cove",
    desc: 'Two buccaneer sloops run contraband through our waters. Send them to the bottom.',
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
    id: 'reef_2', region: 'caribbean', faction: 'spain', chart: { x: .070, y: .337 },
    nm: 'The San Telmo Battery',
    desc: 'A Spanish battery on a coral cay fires on every free trader that passes. Silence its guns.',
    objective: { type: 'destroy_forts' },
    ai: { tactic: 'guard', leash: 40 },          // guard-costas never stray far from their battery
    enemies: [
      { hull: 'sloop', nm: 'Santa Catalina', x: 40, z: 18, loadout: { L: 'carronade', R: 'swivel' } },
    ],
    islands: [
      { id: 'lantern', x: 60, z: 0, r: 10, hp: 170, nm: 'Batería de San Telmo', own: 'enemy', tdmg: 7, trof: 8, shape: 'FORTRESS', seed: 3131 },
      rock('r3', -10, 46, 7, 303),
    ],
    spawn: { x: -70, z: 10 }, parTime: 200,
    reward: { wood: 160, gold: 120 }, firstClear: { wood: 140, gold: 100 }, renown: 14, requires: ['reef_1'],
  },
  {
    id: 'reef_3', region: 'caribbean', faction: 'france', chart: { x: .198, y: .448 },
    nm: 'Hold the Windward Channel',
    desc: 'Corsairs of Saint-Domingue come at us in waves. Keep a ship afloat until the tide turns.',
    ai: { byHull: { schooner: { tactic: 'kite' } } },   // La Licorne skirmishes with her falconets
    objective: {
      type: 'survive', seconds: 150,
      waves: [
        { at: 4,   ships: [{ hull: 'sloop', nm: 'Le Faucon', x: 90, z: -30, loadout: FIT.pirateL }, { hull: 'sloop', nm: 'La Railleuse', x: 92, z: 30, loadout: FIT.pirateL }] },
        { at: 55,  ships: [{ hull: 'schooner', nm: 'La Licorne', x: 95, z: 0, loadout: FIT.falcL }, { hull: 'sloop', nm: 'Le Hardi', x: 90, z: -45, loadout: FIT.pirateL }, { hull: 'sloop', nm: 'La Mouette', x: 92, z: 45, loadout: FIT.falcL }] },
        { at: 115, ships: [{ hull: 'brigantine', nm: 'La Belle Étoile', x: 95, z: 10, loadout: { L: 'carronade', R: 'swivel', B: 'swivel' } }, { hull: 'sloop', nm: 'Le Saint-Malo', x: 90, z: 45, loadout: FIT.pirateL }] },   // QA-002: winnable with the starter fleet
      ],
    },
    enemies: [],
    islands: [rock('r4', 0, -30, 9, 404), rock('r5', 0, 30, 9, 505, 'ATOLL')],
    spawn: { x: -60, z: 0 }, parTime: 150,
    reward: { wood: 180, gold: 110 }, firstClear: { wood: 120, gold: 100 }, renown: 14, requires: ['reef_1'],
  },

  // ── The Atlantic Lanes — the Saltwind Company, France (tiers II–III) ──
  {
    id: 'straits_1', region: 'atlantic', faction: 'england', chart: { x: .265, y: .332 },
    nm: 'The Saltwind Convoy',
    desc: 'A Saltwind Company merchantman carries powder and shot to our rivals. She will run for the northern lanes the moment she sees us — sink her before she slips away. Her escorts are fair game.',
    objective: { type: 'sink_target' },
    escape: { route: [{ x: 110, z: 30 }, { x: 132, z: 100 }, { x: 60, z: 136 }, { x: -30, z: 138 }, { x: -110, z: 132 }] },
    enemies: [
      { hull: 'brigantine', nm: 'Saltwind Merchant', x: 100, z: 10, loadout: FIT.culvS, hp: 220, prize: true, spdMult: 0.5 },   // laden: half speed, head start behind her escorts
      { hull: 'sloop',      nm: 'Good Hope',         x: 66, z: -16, loadout: { L: 'carronade', R: 'carronade' } },
      { hull: 'sloop',      nm: 'Hector',            x: 66, z: 16,  loadout: FIT.falcL },
      { hull: 'sloop',      nm: 'Merlin',            x: 74, z: 26,  loadout: FIT.pirateL },
    ],
    islands: [rock('s1', 5, -55, 12, 606, 'CRESCENT'), rock('s2', 5, 55, 12, 707)],
    spawn: { x: -72, z: 0 }, parTime: 220,
    reward: { wood: 240, gold: 180 }, firstClear: { wood: 200, gold: 160 }, renown: 18, requires: ['reef_2'],
  },
  {
    id: 'straits_2', region: 'atlantic', faction: 'france', chart: { x: .388, y: .117 },
    nm: 'Seize Gullhaven',
    desc: 'Saint-Malo corsairs have taken Gullhaven and its fine anchorage. Knock out their battery, then raise your flag over the island.',
    objective: { type: 'capture', islands: ['gullhaven'] },
    enemies: [
      { hull: 'brigantine', nm: 'Le Hardi',   x: 44, z: -22, loadout: { L: 'demi_culv', R: 'carronade', B: 'swivel' }, hp: 170, ai: { tactic: 'hold' } },   // anchored under the battery (h-pass)
      { hull: 'schooner',   nm: 'La Licorne', x: 48, z: 22,  loadout: FIT.falcL, ai: { tactic: 'kite' } },
      { hull: 'sloop',      nm: 'Le Furet',   x: 62, z: 26,  loadout: FIT.pirateL },
    ],
    islands: [
      { id: 'gullhaven', x: 55, z: 0, r: 10, hp: 300, nm: 'Gullhaven', own: 'enemy', tdmg: 18, trof: 8, shape: 'ATOLL', seed: 8181, trait: 'haven' },
      rock('s3', -20, -50, 8, 808),
    ],
    spawn: { x: -70, z: 0 }, parTime: 240,
    reward: { wood: 260, gold: 200 }, firstClear: { wood: 220, gold: 180 }, renown: 18, requires: ['reef_3'],
  },
  {
    id: 'straits_3', region: 'atlantic', faction: 'england', chart: { x: .345, y: .468 },
    nm: 'The Twin Batteries',
    desc: 'Two Company batteries guard the Saltwind narrows, with a frigate on patrol between them. Bring both down.',
    objective: { type: 'destroy_forts' },
    enemies: [
      { hull: 'frigate', nm: 'Red Dragon', x: 50, z: 0, loadout: FIT.longS,
        ai: { route: [{ x: 48, z: -24 }, { x: 48, z: 24 }] } },           // beats up and down between the batteries
      { hull: 'brigantine', nm: 'Sparrowhawk', x: 58, z: -14, loadout: FIT.culvS, ai: { tactic: 'guard', leash: 50 } },
    ],
    islands: [
      { id: 'tw_n', x: 65, z: -32, r: 10, hp: 320, nm: 'North Battery', own: 'enemy', tdmg: 20, trof: 7, shape: 'FORTRESS', seed: 9191 },
      { id: 'tw_s', x: 65, z: 32,  r: 10, hp: 320, nm: 'South Battery', own: 'enemy', tdmg: 20, trof: 7, shape: 'FORTRESS', seed: 9292 },
    ],
    spawn: { x: -70, z: 0 }, parTime: 300,
    reward: { wood: 320, gold: 260 }, firstClear: { wood: 260, gold: 220 }, renown: 24, requires: ['straits_1', 'straits_2'],
  },

  // ── The Indian Ocean — Estado da Índia, Malabar corsairs (tier III) ──
  {
    id: 'indian_1', region: 'indian', faction: 'malabar', chart: { x: .711, y: .498 },
    nm: 'Monsoon Raiders',
    desc: 'The monsoon has turned and the Malabar ghurabs ride it in. Hold your anchorage until the squall passes.',
    objective: {
      type: 'survive', seconds: 180,
      waves: [
        { at: 4,   ships: [{ hull: 'ghurab', nm: 'Monsoon Hawk', x: 90, z: -20, loadout: FIT.grapeL }, { hull: 'dhow', nm: 'Pepper Wind', x: 90, z: 25, loadout: FIT.falcL }] },
        { at: 50,  ships: [{ hull: 'ghurab', nm: 'Calicut Star', x: 95, z: 0, loadout: FIT.grapeL }, { hull: 'dhow', x: 20, z: -95, loadout: FIT.falcL }, { hull: 'dhow', x: 20, z: 95, loadout: FIT.falcL }, { hull: 'ghurab', nm: 'Kozhikode', x: 95, z: 30, loadout: FIT.grapeL }] },
        { at: 105, ships: [{ hull: 'ghurab', nm: 'Tiger of Kannur', x: 95, z: 15, loadout: FIT.grapeL }, { hull: 'ghurab', nm: "Kunjali's Wrath", x: 95, z: -15, loadout: FIT.grapeL }, { hull: 'frigate', nm: 'São Bento', faction: 'portugal', x: 100, z: 0, loadout: FIT.canS }, { hull: 'frigate', nm: 'São Cristóvão', faction: 'portugal', x: 100, z: 30, loadout: FIT.canS }, { hull: 'dhow', nm: 'Mappila', x: 95, z: -40, loadout: FIT.falcL }] },
      ],
    },
    ai: { byHull: { dhow: { tactic: 'kite' } } },      // dhows dart in and out with falconets
    enemies: [],
    islands: [rock('i1', 10, -28, 9, 1101, 'ATOLL'), rock('i2', 15, 32, 8, 1102)],
    spawn: { x: -55, z: 0 }, parTime: 180,
    reward: { wood: 360, gold: 280 }, firstClear: { wood: 300, gold: 240 }, renown: 26, requires: ['straits_3'],
  },
  {
    id: 'indian_2', region: 'indian', faction: 'portugal', chart: { x: .679, y: .388 },
    nm: 'The Carracks of Goa',
    desc: 'Three carracks of the Estado da Índia sail from Goa under escort. Break the squadron — a battered ship will run for the Goa roads, and takes her cargo with her.',
    objective: { type: 'sink_all' },
    ai: { fleeHp: 0.3 },                              // crippled ships run for home (escaped = no plunder)
    escape: { x: 140, z: -60, r: 10 },
    enemies: [
      { hull: 'galleon',    nm: 'Madre de Deus', x: 70, z: 0,   loadout: FIT.galH, hp: 290 },
      { hull: 'frigate',    nm: 'São Gabriel',   x: 62, z: -22, loadout: FIT.longS },
      { hull: 'brigantine', nm: 'Santa Cruz',    x: 62, z: 22,  loadout: FIT.longS },
      { hull: 'frigate',    nm: 'São Rafael',    x: 82, z: -28, loadout: FIT.longS },
      { hull: 'ghurab',     nm: 'Pepper Wind', faction: 'malabar', x: 78, z: 30, loadout: FIT.grapeL },
    ],
    islands: [rock('i3', 0, -60, 12, 1203, 'CRESCENT'), rock('i4', 0, 60, 12, 1204, 'ATOLL')],
    spawn: { x: -75, z: 0 }, parTime: 300,
    reward: { wood: 400, gold: 320 }, firstClear: { wood: 340, gold: 280 }, renown: 28, requires: ['indian_1'],
  },
  {
    id: 'indian_3', region: 'indian', faction: 'portugal', chart: { x: .734, y: .564 },
    nm: 'The Pepper Fort',
    desc: 'The Portuguese pepper fort at Kannur taxes every cargo on the coast. Batter down its walls and raise your flag over it.',
    objective: { type: 'capture', islands: ['pepper_fort'] },
    enemies: [
      { hull: 'frigate', nm: 'Flor de la Mar', x: 45, z: -18, loadout: FIT.longS },
      { hull: 'ghurab',  nm: 'Monsoon Hawk', faction: 'malabar', x: 50, z: 20, loadout: FIT.grapeL },
      { hull: 'frigate', nm: 'Santo António', x: 55, z: 30, loadout: FIT.canS },
      { hull: 'brigantine', nm: 'São Jorge', x: 52, z: -32, loadout: FIT.longS },
      { hull: 'galleon',    nm: 'São Mateus', x: 72, z: -14, loadout: FIT.galH, ai: { tactic: 'hold' } },   // anchored under the walls
    ],
    ai: { tactic: 'guard', leash: 55 },
    islands: [
      { id: 'pepper_fort', x: 62, z: 0, r: 11, hp: 450, nm: 'Fortaleza de Kannur', own: 'enemy', tdmg: 21, trof: 7, shape: 'FORTRESS', seed: 1313 },
      rock('i5', 10, 40, 8, 1305), rock('i6', 20, -45, 7, 1306, 'CRESCENT'),
    ],
    spawn: { x: -70, z: 0 }, parTime: 330,
    reward: { wood: 440, gold: 360 }, firstClear: { wood: 380, gold: 320 }, renown: 32, requires: ['indian_2'],
  },

  // ── The Spice Straits — the Spice Company, Orang Laut (tier IV) ─────
  {
    id: 'spice_1', region: 'spice', faction: 'malay', chart: { x: .839, y: .586 },
    nm: 'Lanong Ambush',
    desc: 'Orang Laut lanongs lie in wait among the islets of Singapura. Keep a ship afloat until the tide carries you clear.',
    objective: {
      type: 'survive', seconds: 200,
      waves: [
        { at: 4,   ships: [{ hull: 'lanong', nm: 'Lanong Merah', x: 90, z: -20, loadout: FIT.grapeL }, { hull: 'lanong', nm: 'Naga Laut', x: 90, z: 20, loadout: FIT.grapeL }] },
        { at: 50,  ships: [{ hull: 'lanong', nm: 'Angin Selatan', x: 10, z: -95, loadout: FIT.grapeL }, { hull: 'lanong', nm: 'Penjajap Hitam', x: 10, z: 95, loadout: FIT.grapeL }, { hull: 'ghurab', x: 95, z: 0, loadout: FIT.falcL }, { hull: 'lanong', nm: 'Ular Besi', x: 95, z: 30, loadout: FIT.grapeL }] },
        { at: 110, ships: [{ hull: 'heavy_frigate', nm: 'Witte Valk', faction: 'netherlands', x: 100, z: 0, loadout: FIT.heavyS4 }, { hull: 'heavy_frigate', nm: 'Zeeland', faction: 'netherlands', x: 100, z: -30, loadout: FIT.heavyS4 }, { hull: 'lanong', nm: 'Bintang Temasek', x: -20, z: -95, loadout: FIT.grapeL }, { hull: 'lanong', x: -20, z: 95, loadout: FIT.grapeL }, { hull: 'lanong', nm: 'Raja Laut', x: 100, z: 30, loadout: FIT.grapeL }] },
      ],
    },
    enemies: [],
    islands: [rock('p1', 5, -22, 8, 1401, 'ATOLL'), rock('p2', 15, 30, 9, 1402), rock('p3', -35, 45, 6, 1403, 'CRESCENT')],
    spawn: { x: -50, z: 0 }, parTime: 200,
    reward: { wood: 480, gold: 380 }, firstClear: { wood: 400, gold: 340 }, renown: 32, requires: ['indian_3'],
  },
  {
    id: 'spice_2', region: 'spice', faction: 'netherlands', chart: { x: .869, y: .671 },
    nm: 'The Homeward Fleet',
    desc: "The Gouden Leeuw carries a year of nutmeg home, and she will crowd on sail the moment she sights you. Her heavy frigates will hang off at long range and pound you. Sink the treasure galleon before she reaches the open sea.",
    objective: { type: 'sink_target' },
    escape: { route: [{ x: 110, z: -30 }, { x: 132, z: -100 }, { x: 60, z: -136 }, { x: -30, z: -138 }, { x: -110, z: -132 }] },
    enemies: [
      { hull: 'war_galleon',   nm: 'Gouden Leeuw', x: 100, z: 0,  loadout: FIT.lineH4, prize: true, spdMult: 0.5, hp: 520 },   // laden treasure ship
      { hull: 'heavy_frigate', nm: 'Witte Valk',   x: 62, z: -22, loadout: FIT.heavyS4, ai: { tactic: 'kite' } },
      { hull: 'frigate',       nm: 'Zeerob',       x: 62, z: 22,  loadout: FIT.frigS3, ai: { tactic: 'kite' } },
      { hull: 'frigate',       nm: 'De Hoop',      x: 80, z: -30, loadout: FIT.canS },
      { hull: 'lanong',        nm: 'Naga Laut', faction: 'malay', x: 80, z: 30, loadout: FIT.grapeL },
    ],
    islands: [rock('p4', 0, -62, 12, 1504, 'CRESCENT'), rock('p5', 0, 62, 12, 1505, 'ATOLL')],
    spawn: { x: -78, z: 0 }, parTime: 330,
    reward: { wood: 540, gold: 420 }, firstClear: { wood: 460, gold: 380 }, renown: 36, requires: ['spice_1'],
  },
  {
    id: 'spice_3', region: 'spice', faction: 'netherlands', chart: { x: .974, y: .670 },
    nm: 'Kasteel Amboina',
    desc: 'The Company castle at Amboina chokes the clove trade with two bastions. Reduce them both.',
    objective: { type: 'destroy_forts' },
    ai: { tactic: 'guard', leash: 50 },
    enemies: [
      { hull: 'heavy_frigate', nm: 'Nieuw Batavia', x: 48, z: -10, loadout: FIT.heavyS4 },
      { hull: 'frigate',       nm: 'Amboina',       x: 52, z: 14,  loadout: FIT.frigS3 },
      { hull: 'lanong',        nm: 'Bintang Temasek', faction: 'malay', x: 40, z: 30, loadout: FIT.grapeL },
      { hull: 'war_galleon',   nm: 'Oranje',        x: 60, z: 0,   loadout: FIT.lineH4, ai: { tactic: 'hold' } },   // the castle's guardship
      { hull: 'heavy_frigate', nm: 'Middelburg',    x: 50, z: -38, loadout: FIT.heavyS4 },
    ],
    islands: [
      { id: 'amb_w', x: 62, z: -30, r: 11, hp: 650, nm: 'Bastion Zeeland', own: 'enemy', tdmg: 48, trof: 5, shape: 'FORTRESS', seed: 1515 },
      { id: 'amb_e', x: 70, z: 30,  r: 11, hp: 650, nm: 'Bastion Holland', own: 'enemy', tdmg: 48, trof: 5, shape: 'FORTRESS', seed: 1516 },
      rock('p6', 0, 0, 7, 1506, 'ATOLL'),
    ],
    spawn: { x: -72, z: 0 }, parTime: 360,
    reward: { wood: 600, gold: 480 }, firstClear: { wood: 500, gold: 420 }, renown: 40, requires: ['spice_2'],
  },

  // ── The South China Sea — Red Banner Fleet, Tonkin raiders (tier V) ──
  {
    id: 'storm_1', region: 'southchina', faction: 'vietnamese', chart: { x: .876, y: .387 },
    nm: 'Typhoon Season',
    desc: 'A typhoon drives you onto the Tonkin raiders’ coast. Keep a ship afloat until the storm blows itself out.',
    ai: { byHull: { ghe_bau: { tactic: 'kite' } } },    // chain-shot boats cripple your rigging from range
    objective: {
      type: 'survive', seconds: 210,
      waves: [
        { at: 4,   ships: [{ hull: 'junk', nm: 'Sóng Bạc', x: 90, z: 0, loadout: FIT.junkS }, { hull: 'ghe_bau', nm: 'Phong Ba', x: 0, z: -95, loadout: FIT.chainL }, { hull: 'junk', nm: 'Hắc Phong', x: 90, z: 30, loadout: FIT.junkS }] },
        { at: 45,  ships: [{ hull: 'war_junk', nm: 'Hải Long', x: 95, z: -30, loadout: FIT.junkH4 }, { hull: 'junk', nm: 'Cá Kình', x: 0, z: 95, loadout: FIT.junkS }, { hull: 'war_junk', nm: 'Thủy Tiên', x: 95, z: 30, loadout: FIT.junkH4 }, { hull: 'ghe_bau', nm: 'Sấm Sét', x: 0, z: -95, loadout: FIT.chainL }, { hull: 'war_junk', nm: 'Mãnh Hổ', x: 100, z: 0, loadout: FIT.junkH4 }] },
        { at: 90,  ships: [{ hull: 'war_junk', nm: 'Bạch Đằng Gió', x: 95, z: 25, loadout: FIT.junkH4 }, { hull: 'junk', nm: 'Jade Tide', faction: 'chinese', x: -20, z: -95, loadout: FIT.junkS }, { hull: 'ghe_bau', x: -20, z: 95, loadout: FIT.chainL }, { hull: 'war_junk', nm: 'Long Vương', x: 100, z: -25, loadout: FIT.junkH4 }, { hull: 'war_junk', nm: 'Hổ Biển', x: 100, z: 45, loadout: FIT.junkH4 }] },
      ],
    },
    enemies: [],
    islands: [rock('t1', 20, -20, 10, 1212, 'FORTRESS'), rock('t2', 20, 30, 8, 1313)],
    spawn: { x: -40, z: 0 }, parTime: 210,
    reward: { wood: 640, gold: 520 }, firstClear: { wood: 540, gold: 460 }, renown: 40, requires: ['spice_3'],
  },
  {
    id: 'storm_2', region: 'southchina', faction: 'chinese', chart: { x: .917, y: .367 },
    nm: 'The Red Banner Fleet',
    desc: 'The Red Banner Fleet gathers off Amoy — war junks with painted eyes and a hundred guns. A typhoon is an hour behind it: sink the whole fleet before the storm breaks.',
    objective: { type: 'sink_all' },
    timeLimit: 330,                                   // the typhoon (defeat 'time'); par 240
    ai: { byHull: { junk: { tactic: 'kite' }, ghe_bau: { tactic: 'kite' } } },
    enemies: [
      { hull: 'war_junk', nm: 'Golden Carp',  x: 70, z: 0,   loadout: FIT.junkH4, hp: 480 },
      { hull: 'war_junk', nm: 'Vermilion Bird', x: 96, z: 28, loadout: FIT.junkH4 },
      { hull: 'war_junk', nm: 'Red Kite',     x: 64, z: -24, loadout: FIT.junkH4 },
      { hull: 'junk',     nm: 'Jade Tide',    x: 62, z: 24,  loadout: FIT.junkS },
      { hull: 'junk',     nm: "Dragon's Whisker", x: 80, z: -34, loadout: FIT.junkS },
      { hull: 'ghe_bau',  nm: 'Hải Long', faction: 'vietnamese', x: 80, z: 34, loadout: FIT.chainL },
      { hull: 'war_junk', nm: 'Black Tortoise', x: 88, z: 12, loadout: FIT.junkH4 },
      { hull: 'war_junk', nm: 'White Tiger',    x: 90, z: -12, loadout: FIT.junkH4 },
    ],
    islands: [rock('t3', 0, -60, 12, 1414, 'CRESCENT'), rock('t4', 0, 60, 12, 1515, 'ATOLL')],
    spawn: { x: -78, z: 0 }, parTime: 240,
    reward: { wood: 700, gold: 580 }, firstClear: { wood: 600, gold: 500 }, renown: 45, requires: ['storm_1'],
  },
  {
    id: 'storm_3', region: 'southchina', faction: 'chinese', chart: { x: .948, y: .329 },
    nm: 'Citadel of Storms',
    desc: "The Red Banner's island citadel commands the South China Sea. Its walls, its war junks and its admiral's flagship must fall.",
    objective: { type: 'destroy_forts' },
    enemies: [
      { hull: 'war_junk',  nm: 'Thunder of Amoy', x: 55, z: -14, loadout: FIT.junkH4 },
      { hull: 'war_junk',  nm: 'Golden Carp',     x: 55, z: 16,  loadout: FIT.junkH4 },
      { hull: 'man_o_war', nm: 'Nossa Senhora da Graça', faction: 'portugal', x: 65, z: 0, loadout: FIT.lineH5, hp: 560, ai: { tactic: 'guard', leash: 45 } },
      { hull: 'junk',      nm: 'Azure Dragon',    x: 70, z: -30, loadout: FIT.junkS, ai: { route: [{ x: 40, z: -45 }, { x: 40, z: 45 }] } },
      { hull: 'junk',      nm: 'Jade Tide',       x: 62, z: 32,  loadout: FIT.junkS, ai: { route: [{ x: 40, z: 45 }, { x: 40, z: -45 }] } },
      { hull: 'war_junk',  nm: 'Iron Turtle',     x: 92, z: -22, loadout: FIT.junkH4, ai: { tactic: 'hold' } },
    ],
    islands: [
      { id: 'citadel', x: 80, z: 0, r: 14, hp: 1050, nm: 'Citadel of Storms', own: 'enemy', tdmg: 50, trof: 5, shape: 'FORTRESS', seed: 1616, trait: 'bastion' },
      rock('t5', 10, -50, 9, 1717), rock('t6', 10, 50, 9, 1818, 'CRESCENT'),
    ],
    spawn: { x: -75, z: 0 }, parTime: 420,
    reward: { wood: 900, gold: 760 }, firstClear: { wood: 800, gold: 700 }, renown: 60, requires: ['storm_2'],
  },
];

// ── Repeatable patrol (generated by Meta/Campaign.makePatrol) ─────────
// Enemies come from the furthest unlocked sea (its factions + hull pool) and
// are sized to the fleet that sails: Σ strength(enemies) ≤ strengthRatio ×
// Σ strength(your ships), strength = hp × gun slots. Reward scales with the
// enemy strength actually met, so a small fleet meets (and earns) less —
// a wiped player can always win a patrol with what was salvaged.
export const PATROL = {
  id: 'patrol', chart: { x: .147, y: .440 }, nm: 'Pirate Patrol',
  desc: 'Sweep the nearby waters for raiders. Repeatable; the enemy is sized to the fleet you bring.',
  /** Enemy hull pools by sea (campaign order), strongest first. */
  pools: {
    caribbean:  ['brigantine', 'schooner', 'sloop', 'sloop', 'cutter'],
    atlantic:   ['frigate', 'brigantine', 'brigantine', 'schooner', 'sloop'],
    indian:     ['galleon', 'frigate', 'ghurab', 'ghurab', 'dhow', 'dhow'],
    spice:      ['war_galleon', 'heavy_frigate', 'lanong', 'lanong', 'frigate', 'lanong'],
    southchina: ['war_junk', 'war_junk', 'junk', 'junk', 'ghe_bau', 'ghe_bau'],
  },
  strengthRatio: 0.45,
  /** Size-aware budget: fleet size → ratio (a lone wiped hull meets a lone, trimmed foe). Larger fleets use strengthRatio. */
  ratioBySize: { 1: 0.3, 2: 0.38 },
  maxShips: 5,
  /** Enemy ships ≤ ships that sail (fleets of 1–2); from 3 ships up, + this many. */
  maxExtraShips: 2,
  /** Hull of the lone trimmed foe when even the smallest pool hull is over budget, and its (tier-I) guns. */
  minFoe: 'cutter',
  loneLoadout: { L: 'carronade', R: 'swivel' },
  reward: { base: { wood: 40, gold: 30 }, perStrength: { wood: 0.10, gold: 0.075 } },
  renown: 4,
  loadouts: {
    light:    { L: 'carronade', R: 'swivel' },
    standard: { L: 'demi_culv', R: 'demi_culv', B: 'swivel' },
    heavy:    { L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'swivel' },
  },
  /** Class → hull tier overrides (cannon tier ≤ hull tier); falls back to `loadouts`. */
  loadoutsByTier: {
    light:    { 2: { L: 'grapeshot', R: 'falconet' }, 3: { L: 'demi_culv', R: 'grapeshot' } },
    standard: { 3: { L: 'demi_can', R: 'demi_culv', B: 'long12' }, 4: { L: 'culverin', R: 'culverin', B: 'long12' } },
    heavy:    { 4: { L: 'culverin', R: 'carronade32', B: 'mortar2', S: 'swivel' } },
  },
};

/** Winning this mission wins the campaign (rank-independent). */
export const FINAL_MISSION = 'storm_3';

/** Open War = the classic full match (mode=skirmish). */
export const OPEN_WAR = { id: 'open_war', chart: { x: .363, y: .792 }, nm: 'Open War' };

/** The player's home port on the World Chart (Port Royal). */
export const HOME = { chart: { x: .105, y: .407 } };
