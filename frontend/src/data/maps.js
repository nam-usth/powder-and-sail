// ── MAP DEFINITIONS ─────────────────────────────────────────────
// AF8: each island now carries `shape` (type) + `seed` (int).
//
// Player home → shape + seed determine build grid layout.
// Enemy home  → mirrors player home shape (mirrorShape() in IslandEntity).
// Neutral isles have their own independent shapes.
//
// Shape types: CRESCENT | ATOLL | FORTRESS | SPRAWL
// All guarantee ≥50 valid 1×1 build slots.

export const ISLAND_DEFS = [
  {
    id:'home_a', x:-95, z: 0, r:14, hp:200, nm:'Home Port', own:'player',
    tdmg:12, trof:8,
    shape:'SPRAWL',   seed:4242,   // large flat area — good for beginners
  },
  {
    id:'home_b', x: 95, z: 0, r:14, hp:200, nm:'Enemy Citadel', own:'enemy',
    tdmg:18, trof:5,
    shape:'MIRROR',   seed:4242,   // mirrors home_a — same seed, flip col
    trait:'bastion',               // AP: enemy home is the hard nut — thematic + balance
  },
  {
    id:'neu_n',  x:  0, z:-58, r:10, hp:130, nm:'North Shoal', own:'neutral',
    tdmg:12, trof:8,
    shape:'CRESCENT', seed:1337,
    trait:'timber',                // AP: wood-rush expansion target
  },
  {
    id:'neu_s',  x:  0, z: 58, r:10, hp:130, nm:'South Shoal', own:'neutral',
    tdmg:12, trof:8,
    shape:'ATOLL',    seed:9999,
    trait:'goldvein',              // AP: economy expansion target
  },
  {
    id:'neu_c',  x: 18, z: -8, r: 9, hp:100, nm:'Central Isle', own:'neutral',
    tdmg:14, trof:7,
    shape:'FORTRESS', seed:7777,
    trait:'haven',                 // AP: forward repair base — frontline value
  },
];

// ── Shape assigned to enemy home when ownership changes (capture) ──
// When a neutral island is captured, it keeps its own shape.
// The enemy home always mirrors whatever the player home is.
