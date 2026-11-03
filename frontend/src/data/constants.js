// ── GAME CONSTANTS ─────────────────────────────────────────────
export const MAP          = 300;
export const WING         = Math.PI * 0.55;   // vision arc half-angle
export const RANGE_U      = { 1: 8, 2: 20, 3: 40 };

// Test mode — set to 1.0 for production pacing, 0.1 for fast testing
export const BUILD_TIME_MULT = 0.12;

// Economy
export const WOOD_START   = 200;
export const GOLD_START   = 100;
export const WOOD_CAP     = 800;
export const GOLD_CAP     = 600;
export const WOOD_RATE    = 2;
export const GOLD_RATE    = 1.5;
export const LOOT_WIN     = 1000;

// Raid
export const RAID_DUR     = 30;
export const LOOT_W_RATE  = 8;
export const LOOT_G_RATE  = 6;
export const CARGO_MAX    = 120;
export const ptPerW       = 1 / 5;
export const ptPerG       = 1 / 4;
export const ptPerFort    = 50;

// Revive
export const REVIVE_TIME  = 30;  // base revive (wave-scaled: +5s per wave number, max 90s)

// Fleets — multiple groups of ships, each with own leader and target
export const FLEET_MAX_SHIPS = 5;     // hard cap per fleet
export const FLEET_LINE_GAP   = 5.5;  // distance between ships in line-ahead formation

// Build grid — AF8: 10×10 grid, shape-masked to island type
export const BUILD_GRID_SIZE  = 10;      // 10×10 = 100 cells max (≥50 valid per shape)
export const BUILD_CELL_WORLD = 2.4;     // tighter cell spacing for larger grid

// Wave system
export const WAVE_INT = 120; // seconds between waves (2 min — gives time to rebuild)

// Aura upgrade table
export const AURA_LEVELS = [
  { range: 20, regen: 4,  auraUpgCost: 80,  regenUpgCost: 60  },
  { range: 26, regen: 6,  auraUpgCost: 140, regenUpgCost: 100 },
  { range: 34, regen: 9,  auraUpgCost: 220, regenUpgCost: 160 },
  { range: 44, regen: 13, auraUpgCost: 340, regenUpgCost: 240 },
  { range: 56, regen: 18, auraUpgCost: null,regenUpgCost: null },
];
