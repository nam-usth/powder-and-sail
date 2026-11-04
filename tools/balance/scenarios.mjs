// ── BALANCE SCENARIOS — "the fleet a player realistically owns by then" ──
// Shared by tools/balance/sim_battle.mjs (browser battle sim) and
// tools/balance/sim_economy.mjs (pure-Node economy sim).
// Rationale: design/balance/targets.md §Progression model.
//
// Ship spec: { hull, loadout?, upgrades?, hpFrac? }
//   loadout: omitted → Meta/Profile.defaultLoadout(hull class) of the served game
//            'broadside' → the LoadoutPanel "Broadside" preset (what a novice
//            clicks when told to "refit"): L/R demi-culverin, B long 9, S swivel
//            or an explicit { L, R, B?, S? } object
//   upgrades: { spd, hp, rof } levels 0..3 (LoadoutPanel upgrade tracks)
// Scenario: { mission, label, ships, research?, renown? (patrol sea), note? }

import { HULL_SLOTS } from '../../frontend/src/data/ships.js';

/** LoadoutPanel "Broadside" preset (Experience/UI/LoadoutPanel.js PRESETS[0]). */
export function broadside(hullClass) {
  const lo = {};
  (HULL_SLOTS[hullClass] || []).forEach(s => { lo[s] = s === 'L' || s === 'R' ? 'demi_culv' : s === 'B' ? 'long9' : 'swivel'; });
  return lo;
}

const S = (hull, o = {}) => ({ hull, ...o });
const B = (hull, o = {}) => ({ hull, loadout: 'broadside', ...o });

// Progression model (targets.md): sea k ≈ tier k. Fleet cap = 3 + (shipyard
// level − 1), so the roster grows by one ship per shipyard level:
//   Caribbean T1–II cap 3–4 · Atlantic T2–III cap 4–5 · Indian T3–IV cap 5–6 ·
//   Spice T4–V cap 6–7 · South China T5 cap 7.
// Each mission's roster = the previous roster + the ship(s) the economy sim
// says are affordable by then, refitted with one click.
export const STARTER = [S('brigantine'), S('sloop'), S('sloop')];

export const SCENARIOS = {
  // ── The Caribbean ──
  reef_1: { mission: 'reef_1', label: 'starter fleet (default guns)', ships: STARTER },
  reef_2: { mission: 'reef_2', label: 'starter fleet (default guns)', ships: STARTER },
  reef_3: { mission: 'reef_3', label: 'starter + 1 brig (T2)', ships: [S('brigantine'), S('brig'), S('sloop'), S('sloop')] },
  // ── The Atlantic Lanes ──
  straits_1: { mission: 'straits_1', label: '3×T2 + sloop', ships: [B('brigantine'), B('brig'), B('corvette'), S('sloop')] },
  straits_2: { mission: 'straits_2', label: '4×T2', ships: [B('brigantine'), B('brig'), B('brig'), B('corvette')] },
  straits_3: { mission: 'straits_3', label: '1×T3 + 4×T2, Powder Charge',
    ships: [B('frigate'), B('brigantine'), B('brig'), B('brig'), B('corvette')], research: ['bal1'] },
  // ── The Indian Ocean ──
  indian_1: { mission: 'indian_1', label: '2×T3 + 3×T2, bal1',
    ships: [B('frigate'), B('frigate'), B('brigantine'), B('brig'), B('brig')], research: ['bal1'] },
  indian_2: { mission: 'indian_2', label: '3×T3 + 2×T2, bal1+nav1',
    ships: [B('frigate'), B('frigate'), B('galleon'), B('brig'), B('brig')], research: ['bal1', 'nav1'] },
  indian_3: { mission: 'indian_3', label: '1×T4 + 3×T3 + 2×T2, bal1+nav1',
    ships: [B('heavy_frigate'), B('frigate'), B('frigate'), B('galleon'), B('brig'), B('brig')], research: ['bal1', 'nav1'] },
  // ── The Spice Straits ──
  spice_1: { mission: 'spice_1', label: '1×T4 + 4×T3 + brig, bal1+nav1',
    ships: [B('heavy_frigate'), B('frigate'), B('frigate'), B('galleon'), B('xebec'), B('brig')], research: ['bal1', 'nav1'] },
  spice_2: { mission: 'spice_2', label: '2×T4 + 4×T3, bal1+nav1+bal2',
    ships: [B('heavy_frigate'), B('heavy_frigate'), B('frigate'), B('frigate'), B('galleon'), B('xebec')], research: ['bal1', 'nav1', 'bal2'] },
  spice_3: { mission: 'spice_3', label: '1×T5 + 2×T4 + 4×T3, bal1+nav1+bal2',
    ships: [B('man_o_war'), B('heavy_frigate'), B('heavy_frigate'), B('frigate'), B('frigate'), B('galleon'), B('xebec')], research: ['bal1', 'nav1', 'bal2'] },
  // ── The South China Sea ──
  storm_1: { mission: 'storm_1', label: '1×T5 + 3×T4 + 3×T3, bal1+nav1+bal2',
    ships: [B('man_o_war'), B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate'), B('galleon')], research: ['bal1', 'nav1', 'bal2'] },
  storm_2: { mission: 'storm_2', label: '2×T5 + 3×T4 + 2×T3, bal1+nav1+bal2',
    ships: [B('man_o_war'), B('ship_of_the_line'), B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate')], research: ['bal1', 'nav1', 'bal2'] },
  storm_3: { mission: 'storm_3', label: '2×T5 + 4×T4 + 1×T3, bal1+nav1+bal2',
    ships: [B('man_o_war'), B('ship_of_the_line'), B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('war_galleon'), B('frigate')],
    research: ['bal1', 'nav1', 'bal2'] },
};

/** Gate checks: the final mission must need tier IV/V (targets.md T6). */
export const GATE_SCENARIOS = {
  storm_3_T3only: { mission: 'storm_3', label: 'GATE: 7×T3 (no T4/T5), bal1+nav1+bal2',
    ships: [B('frigate'), B('frigate'), B('frigate'), B('galleon'), B('galleon'), B('xebec'), B('xebec')],
    research: ['bal1', 'nav1', 'bal2'] },
  storm_3_T4: { mission: 'storm_3', label: 'GATE: 4×T4 + 3×T3 (no T5), bal1+nav1+bal2',
    ships: [B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('war_galleon'), B('frigate'), B('frigate'), B('galleon')],
    research: ['bal1', 'nav1', 'bal2'] },
};

/** Patrol at each sea vs the fleet one has there, plus wipe-recovery fleets. */
export const PATROL_SCENARIOS = {
  patrol_caribbean:  { mission: 'patrol', renown: 0,   label: 'Caribbean · starter fleet', ships: STARTER },
  patrol_atlantic:   { mission: 'patrol', renown: 30,  label: 'Atlantic · straits_1 fleet', ships: SCENARIOS.straits_1.ships },
  patrol_indian:     { mission: 'patrol', renown: 100, label: 'Indian · indian_1 fleet', ships: SCENARIOS.indian_1.ships, research: ['bal1'] },
  patrol_spice:      { mission: 'patrol', renown: 200, label: 'Spice · spice_1 fleet', ships: SCENARIOS.spice_1.ships, research: ['bal1', 'nav1'] },
  patrol_southchina: { mission: 'patrol', renown: 330, label: 'South China · storm_1 fleet', ships: SCENARIOS.storm_1.ships, research: ['bal1', 'nav1', 'bal2'] },
  // Death-spiral checks: everything was wrecked, one or two cheap hulls salvaged.
  wipe_1sloop:  { mission: 'patrol', renown: 330, label: 'WIPE · 1 salvaged sloop (South China)', ships: [S('sloop')] },
  wipe_2ships:  { mission: 'patrol', renown: 200, label: 'WIPE · sloop + brigantine (Spice)', ships: [S('sloop'), S('brigantine')] },
  wipe_1frig:   { mission: 'patrol', renown: 330, label: 'WIPE · 1 salvaged frigate (South China)', ships: [B('frigate')], research: ['bal1', 'nav1'] },
};

/** Pre-balance campaign (git HEAD): 9 missions, rank-scaled patrol. Used for the "before" table only. */
export const BEFORE_SCENARIOS = {
  reef_1: SCENARIOS.reef_1, reef_2: SCENARIOS.reef_2, reef_3: SCENARIOS.reef_3,
  straits_1: { ...SCENARIOS.straits_1 }, straits_2: { mission: 'straits_2', label: '1×T3 + 3×T2 + sloop', ships: [B('frigate'), B('brigantine'), B('brig'), B('corvette'), S('sloop')] },
  straits_3: { mission: 'straits_3', label: '2×T3 + 3×T2, bal1', ships: [B('frigate'), B('frigate'), B('brigantine'), B('brig'), B('corvette')], research: ['bal1'] },
  storm_1: { mission: 'storm_1', label: '1×T4 + 4×T3 + brig, bal1+nav1', ships: [B('heavy_frigate'), B('frigate'), B('frigate'), B('galleon'), B('xebec'), B('brig')], research: ['bal1', 'nav1'] },
  storm_2: { mission: 'storm_2', label: '3×T4 + 3×T3, bal1+nav1', ships: [B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate'), B('galleon')], research: ['bal1', 'nav1'] },
  storm_3: { mission: 'storm_3', label: '2×T5 + 3×T4 + 2×T3, bal1+nav1+bal2', ships: [B('man_o_war'), B('ship_of_the_line'), B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate')], research: ['bal1', 'nav1', 'bal2'] },
  storm_3_T3only: { mission: 'storm_3', label: 'GATE: 7×T3 (no T4/T5)', ships: [B('frigate'), B('frigate'), B('frigate'), B('galleon'), B('galleon'), B('xebec'), B('xebec')], research: ['bal1', 'nav1', 'bal2'] },
  storm_2_T3only: { mission: 'storm_2', label: 'GATE: 6×T3', ships: [B('frigate'), B('frigate'), B('galleon'), B('galleon'), B('xebec'), B('xebec')], research: ['bal1', 'nav1'] },
  // old rank-scaled patrol (renown → rank pool)
  patrol_r0: { mission: 'patrol', renown: 0,   label: 'rank 0 · starter fleet', ships: STARTER },
  patrol_r1: { mission: 'patrol', renown: 40,  label: 'rank 1 · reef_3 fleet', ships: [S('brigantine'), S('brig'), S('sloop'), S('sloop')] },
  patrol_r2: { mission: 'patrol', renown: 110, label: 'rank 2 · straits_3 fleet', ships: [B('frigate'), B('frigate'), B('brigantine'), B('brig'), B('corvette')], research: ['bal1'] },
  patrol_r3: { mission: 'patrol', renown: 220, label: 'rank 3 · storm_2 fleet', ships: [B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate'), B('galleon')], research: ['bal1', 'nav1'] },
  patrol_r4: { mission: 'patrol', renown: 400, label: 'rank 4 · storm_3 fleet', ships: [B('man_o_war'), B('ship_of_the_line'), B('heavy_frigate'), B('heavy_frigate'), B('war_galleon'), B('frigate'), B('frigate')], research: ['bal1', 'nav1', 'bal2'] },
  wipe_r2_1sloop: { mission: 'patrol', renown: 110, label: 'WIPE rank 2 · 1 salvaged sloop', ships: [S('sloop')] },
  wipe_r3_2ships: { mission: 'patrol', renown: 220, label: 'WIPE rank 3 · sloop + brigantine', ships: [S('sloop'), S('brigantine')] },
  wipe_r4_1frig:  { mission: 'patrol', renown: 400, label: 'WIPE rank 4 · 1 salvaged frigate', ships: [B('frigate')], research: ['bal1', 'nav1'] },
};

export const ALL_SCENARIOS = { ...SCENARIOS, ...GATE_SCENARIOS, ...PATROL_SCENARIOS };
