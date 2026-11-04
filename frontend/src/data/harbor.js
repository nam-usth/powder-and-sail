// ── HARBOR / CAMPAIGN META DATA ──────────────────────────────────
// Every number the meta layer uses lives here (design/gdd/harbor.md,
// design/gdd/campaign-meta.md, design/gdd/sea-battle.md).

export const PROFILE_KEY      = 'iow_profile_v1';
export const PROFILE_VERSION  = 1;

/** Offline production/timer catch-up is capped at 8 hours. */
export const OFFLINE_MAX_SEC  = 8 * 3600;
/** Harbor writes live state back into the profile this often. */
export const SAVE_INTERVAL_SEC = 2;
/** Minimum offline time before the "while you were away" report shows. */
export const OFFLINE_REPORT_MIN_SEC = 60;

export const START_RES = { wood: 260, gold: 160 };

// ── Harbor economy (harbor mode only) ─────────────────────────
// Open War keeps the match pacing of data/constants.js + data/buildings.js;
// the persistent harbor runs the SAME buildings on a slower clock so a
// campaign lasts hours, not minutes (design/balance/report.md §Economy).
// rateMult scales base income AND building production, live and offline.
export const HARBOR_ECONOMY = { rateMult: 1 };
/** The harbor keeps producing while the fleet is at sea (offline rules, capped). */
export const PRODUCE_AT_SEA = true;

// ── Hull catalog (Shipyard) — five tiers ───────────────────────
// hull  = combat class used by cannons/handling ('light'|'standard'|'heavy')
//         → gun slots (data/ships.js HULL_SLOTS: 2 / 3 / 4).
// tier  = I..V, gated by the shipyard level (shipyardLevel). Also passed
//         to the ship mesh as cfg.tier for visual distinction (trim, masts).
// hp    = max HP in battle. spd = world units per 1/60 s (see HULL_HANDLING).
// Tier curve (rationale, design/gdd/campaign-meta.md): each tier ≈ +35 % HP
// and ≈ +55 % cost over the previous at the same class; speed trades off.
export const SHIP_TIERS = [
  { tier: 1, nm: 'I',   shipyardLevel: 1, col: '#b0b0b0' },
  { tier: 2, nm: 'II',  shipyardLevel: 2, col: '#6b9c4a' },
  { tier: 3, nm: 'III', shipyardLevel: 3, col: '#5c9ce0' },
  { tier: 4, nm: 'IV',  shipyardLevel: 4, col: '#9c80d6' },
  { tier: 5, nm: 'V',   shipyardLevel: 5, col: '#e8b840' },
];

const H = (id, nm, tier, hull, o) => ({
  id, nm, tier, hull, shipyardLevel: tier, style: 'european',
  icon: hull === 'heavy' ? '🛳' : hull === 'standard' ? '🚢' : '⛵', ...o,
});
/** Enemy-only hull (never offered by the Shipyard): flavour hulls of the Asian seas. */
const E = (id, nm, tier, hull, style, o) => H(id, nm, tier, hull, { style, enemyOnly: true, ...o });

export const HULLS = {
  // Tier I — coastal craft
  sloop:      H('sloop',      'Sloop',      1, 'light',    { col: 0xb87040, spd: .16, sc: .85, disp: 200,  hp: 100, cost: { wood: 140, gold: 80 },  buildSec: 60 }),
  cutter:     H('cutter',     'Cutter',     1, 'light',    { col: 0x9a8060, spd: .19, sc: .74, disp: 140,  hp: 80,  cost: { wood: 110,  gold: 70 },  buildSec: 45 }),
  schooner:   H('schooner',   'Schooner',   1, 'light',    { col: 0x80c060, spd: .20, sc: .78, disp: 170,  hp: 90,  cost: { wood: 160, gold: 110 },  buildSec: 60 }),
  // Tier II — brigs
  brigantine: H('brigantine', 'Brigantine', 2, 'standard', { col: 0xd49030, spd: .14, sc: 1.0, disp: 450,  hp: 140, cost: { wood: 380, gold: 250 }, buildSec: 150 }),
  brig:       H('brig',       'War Brig',   2, 'standard', { col: 0xa06030, spd: .13, sc: 1.04, disp: 500, hp: 160, cost: { wood: 440, gold: 280 }, buildSec: 165 }),
  corvette:   H('corvette',   'Corvette',   2, 'light',    { col: 0x60a0a0, spd: .19, sc: .9,  disp: 260,  hp: 125, cost: { wood: 360, gold: 300 }, buildSec: 140 }),
  // Tier III — frigates
  frigate:    H('frigate',    'Frigate',    3, 'standard', { col: 0x5c9ce0, spd: .15, sc: 1.1, disp: 520,  hp: 190, cost: { wood: 760, gold: 520 }, buildSec: 270 }),
  xebec:      H('xebec',      'Xebec',      3, 'light',    { col: 0xc0a040, spd: .21, sc: .95, disp: 300,  hp: 150, cost: { wood: 660, gold: 600 }, buildSec: 240 }),
  galleon:    H('galleon',    'Galleon',    3, 'heavy',    { col: 0xe8c040, spd: .12, sc: 1.25, disp: 900, hp: 240, cost: { wood: 900, gold: 620 }, buildSec: 330 }),
  // Tier IV — heavy frigates & war galleons
  heavy_frigate: H('heavy_frigate', 'Heavy Frigate', 4, 'standard', { col: 0x4070c0, spd: .15, sc: 1.18, disp: 650, hp: 260, cost: { wood: 1250, gold: 900 }, buildSec: 420 }),
  war_galleon:   H('war_galleon',   'War Galleon',   4, 'heavy',    { col: 0xc89030, spd: .12, sc: 1.35, disp: 1100, hp: 330, cost: { wood: 1500, gold: 1050 }, buildSec: 480 }),
  // Tier V — ships of the line
  man_o_war:        H('man_o_war',        'Man-o-War',        5, 'heavy', { col: 0xd4a020, spd: .11, sc: 1.5,  disp: 1400, hp: 430, cost: { wood: 1900, gold: 1400 }, buildSec: 600 }),
  ship_of_the_line: H('ship_of_the_line', 'Ship of the Line', 5, 'heavy', { col: 0xf0d070, spd: .10, sc: 1.62, disp: 1700, hp: 500, cost: { wood: 2200, gold: 1650 }, buildSec: 720 }),

  // Enemy-only (style = mesh family, data/factions.js). Same combat classes as
  // the player's hulls; stats sit between the player tiers they meet.
  dhow:     E('dhow',     'Dhow',     1, 'light',    'dhow', { col: 0xb89060, spd: .18, sc: .80, disp: 160, hp: 90,  cost: { wood: 90,  gold: 60 },  buildSec: 40 }),
  ghurab:   E('ghurab',   'Ghurab',   2, 'light',    'dhow', { col: 0x9a6a3a, spd: .21, sc: .92, disp: 240, hp: 130, cost: { wood: 170, gold: 130 }, buildSec: 80 }),
  ghe_bau:  E('ghe_bau',  'Ghe Bầu',  2, 'light',    'junk', { col: 0x8a6a3a, spd: .20, sc: .90, disp: 230, hp: 125, cost: { wood: 160, gold: 130 }, buildSec: 80 }),
  lanong:   E('lanong',   'Lanong',   3, 'light',    'prau', { col: 0x7a5a30, spd: .17, sc: 1.0, disp: 300, hp: 170, cost: { wood: 230, gold: 190 }, buildSec: 110 }),
  junk:     E('junk',     'War Junk', 3, 'standard', 'junk', { col: 0x8a4a2a, spd: .13, sc: 1.1, disp: 560, hp: 210, cost: { wood: 300, gold: 210 }, buildSec: 150 }),
  war_junk: E('war_junk', 'Great War Junk', 4, 'heavy', 'junk', { col: 0x7a2a1a, spd: .11, sc: 1.4, disp: 1150, hp: 350, cost: { wood: 540, gold: 380 }, buildSec: 270 }),
};
/** Hulls the Shipyard may build (enemy-only flavour hulls excluded). */
export const PLAYER_HULLS = Object.values(HULLS).filter(h => !h.enemyOnly).map(h => h.id);
/** Fallback hull by combat class (missions may name a class instead of a hull id). */
export const HULL_BY_CLASS = { light: 'sloop', standard: 'brigantine', heavy: 'galleon' };

export const SHIP_NAMES = [
  'Sea Wren', 'Gull\'s Wake', 'Saltwind', 'Coral Dancer', 'Brine Hawk', 'Morning Tide',
  'Copper Kestrel', 'Tidecaller', 'Lantern Reef', 'Driftwood Queen', 'Sable Petrel',
  'Starling', 'Albatross', 'Wavecutter', 'Golden Heron', 'Stormpetrel', 'Mariner\'s Hope',
  'Amber Swallow', 'Iron Pelican', 'Cutlass Moon',
];

// ── Starter profile ───────────────────────────────────────────
export const STARTER_FLEET = ['brigantine', 'sloop', 'sloop'];
/** Pre-built on a fresh harbor: id + preferred grid cell (falls back to any free cell). */
export const STARTER_BUILDINGS = [
  { buildingId: 'shipyard',    gridKey: '6_4' },
  { buildingId: 'lumber_mill', gridKey: '3_3' },
  { buildingId: 'gold_mine',   gridKey: '3_6' },
];

// ── Fleet cap / repairs / salvage ─────────────────────────────
export const FLEET_CAP_BASE = 3;
export const FLEET_CAP_MAX  = 8;
/** Gold to repair a hull from 0 → full (scaled by missing fraction). */
export const REPAIR_GOLD_FULL = { light: 40, standard: 80, heavy: 140 };
/** Seconds to repair a hull from 0 → full (scaled by missing fraction). */
export const REPAIR_SEC_FULL  = { light: 30, standard: 50, heavy: 80 };
export const SALVAGE_COST_FRAC = 0.5;
export const SALVAGE_SEC       = { light: 45, standard: 80, heavy: 120 };
/** Harbor moorings slowly mend afloat ships (HP fraction per second). */
export const MOORING_REGEN_FRAC = 0.004;
/** Ships launched from a shipyard never reach the harbor below this HP fraction. */
export const MIN_AFLOAT_FRAC = 0.05;

// ── Sea Battle knobs (battle mode only — Open War untouched) ──
export const BATTLE = {
  /** Guards engage once the player comes this close (mission.aggro overrides). */
  aggro: 70,
  /** Fort HP regained per enemy repair tick (~5.5 s), fraction of max (mission.fortRegen overrides). */
  fortRegen: 0.02,
  /** Destroyed forts are rebuilt by the enemy during the battle? */
  fortRebuild: false,
  /** HP/s enemy ships regain in their fort's harbor aura (AuraSystem 'enemy home'). */
  fortShipRegen: 3,
};

// ── Battle economy ────────────────────────────────────────────
export const PLUNDER_BY_HULL = {
  light:    { wood: 30, gold: 20 },
  standard: { wood: 55, gold: 40 },
  heavy:    { wood: 90, gold: 70 },
};
export const PLUNDER_FORT        = { wood: 80, gold: 80 };
export const DEFEAT_PLUNDER_KEEP = 0.5;
export const RENOWN_PER_SINK     = 2;

// ── Admiral ranks ─────────────────────────────────────────────
export const RANKS = [
  { id: 'captain',      renown: 0,   nm: 'Captain' },
  { id: 'commodore',    renown: 40,  nm: 'Commodore' },
  { id: 'rear_admiral', renown: 110, nm: 'Rear Admiral' },
  { id: 'vice_admiral', renown: 220, nm: 'Vice Admiral' },
  { id: 'admiral',      renown: 400, nm: 'Admiral of the Isles' },
];
