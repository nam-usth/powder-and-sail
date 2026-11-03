// ── ISLAND TRAITS (AP) ──────────────────────────────────────────
// Each island may carry ONE trait that specialises it. Traits turn
// "which island do I capture next?" into a strategic decision and
// give every island a distinct identity on the chart.
//
// Wiring:
//   • maps.js        — assigns `trait` per ISLAND_DEF
//   • IslandEntity   — bastion: fort HP/dmg ×fortMult at construction
//   • BuildSystem    — woodMult/goldMult applied in production fns
//   • GameApp        — haven: friendly-ship regen aura when player-owned
//   • IslandPanel / EmpirePanel / CaptureSystem toast — display
//
// Adding a trait = add an entry here + assign in maps.js. Display
// surfaces read icon/name/desc generically.

export const ISLAND_TRAITS = {
  timber: {
    icon: '🌲', name: 'Timberland',
    desc: '+50% wood production on this island',
    woodMult: 1.5,
  },
  goldvein: {
    icon: '⛏', name: 'Goldvein',
    desc: '+50% gold production on this island',
    goldMult: 1.5,
  },
  bastion: {
    icon: '🛡', name: 'Bastion',
    desc: '+25% fort HP & cannon damage',
    fortMult: 1.25,
  },
  haven: {
    icon: '⚓', name: 'Haven',
    desc: 'Friendly ships near this island repair 2 HP/s',
    repairRate: 2,
    repairRange: 16,   // added to isl.r
  },
};

/** Safe lookup — returns null for islands without a trait. */
export function getTrait(isl) {
  return ISLAND_TRAITS[isl?.def?.trait] || null;
}
