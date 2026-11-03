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
  id, nm, tier, hull, shipyardLevel: tier,
  icon: hull === 'heavy' ? '🛳' : hull === 'standard' ? '🚢' : '⛵', ...o,
});

export const HULLS = {
  // Tier I — coastal craft
  sloop:      H('sloop',      'Sloop',      1, 'light',    { col: 0xb87040, spd: .16, sc: .85, disp: 200,  hp: 100, cost: { wood: 100, gold: 60 },  buildSec: 40 }),
  cutter:     H('cutter',     'Cutter',     1, 'light',    { col: 0x9a8060, spd: .19, sc: .74, disp: 140,  hp: 80,  cost: { wood: 80,  gold: 50 },  buildSec: 30 }),
  schooner:   H('schooner',   'Schooner',   1, 'light',    { col: 0x80c060, spd: .20, sc: .78, disp: 170,  hp: 90,  cost: { wood: 110, gold: 80 },  buildSec: 45 }),
  // Tier II — brigs
  brigantine: H('brigantine', 'Brigantine', 2, 'standard', { col: 0xd49030, spd: .14, sc: 1.0, disp: 450,  hp: 140, cost: { wood: 180, gold: 120 }, buildSec: 90 }),
  brig:       H('brig',       'War Brig',   2, 'standard', { col: 0xa06030, spd: .13, sc: 1.04, disp: 500, hp: 160, cost: { wood: 210, gold: 130 }, buildSec: 100 }),
  corvette:   H('corvette',   'Corvette',   2, 'light',    { col: 0x60a0a0, spd: .19, sc: .9,  disp: 260,  hp: 125, cost: { wood: 170, gold: 140 }, buildSec: 80 }),
  // Tier III — frigates
  frigate:    H('frigate',    'Frigate',    3, 'standard', { col: 0x5c9ce0, spd: .15, sc: 1.1, disp: 520,  hp: 190, cost: { wood: 280, gold: 200 }, buildSec: 140 }),
  xebec:      H('xebec',      'Xebec',      3, 'light',    { col: 0xc0a040, spd: .21, sc: .95, disp: 300,  hp: 150, cost: { wood: 240, gold: 220 }, buildSec: 120 }),
  galleon:    H('galleon',    'Galleon',    3, 'heavy',    { col: 0xe8c040, spd: .12, sc: 1.25, disp: 900, hp: 240, cost: { wood: 340, gold: 230 }, buildSec: 200 }),
  // Tier IV — heavy frigates & war galleons
  heavy_frigate: H('heavy_frigate', 'Heavy Frigate', 4, 'standard', { col: 0x4070c0, spd: .15, sc: 1.18, disp: 650, hp: 260, cost: { wood: 430, gold: 320 }, buildSec: 220 }),
  war_galleon:   H('war_galleon',   'War Galleon',   4, 'heavy',    { col: 0xc89030, spd: .12, sc: 1.35, disp: 1100, hp: 330, cost: { wood: 520, gold: 360 }, buildSec: 260 }),
  // Tier V — ships of the line
  man_o_war:        H('man_o_war',        'Man-o-War',        5, 'heavy', { col: 0xd4a020, spd: .11, sc: 1.5,  disp: 1400, hp: 430, cost: { wood: 720, gold: 520 }, buildSec: 340 }),
  ship_of_the_line: H('ship_of_the_line', 'Ship of the Line', 5, 'heavy', { col: 0xf0d070, spd: .10, sc: 1.62, disp: 1700, hp: 500, cost: { wood: 860, gold: 640 }, buildSec: 400 }),
};
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
