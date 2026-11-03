// ── DEFENSE PLATFORM DATA ───────────────────────────────────────
// GDD-aligned defense structures for island placement.
// Stats use integer tables (not percentage formulas).
// Level 1–10 per defense type.
//
// TODO (CDN note): Three.js currently loaded via CDN (prototype-only).
// Later milestone: vendor locally or use Vite.

export const DEFENSES = [

  {
    id:   'watchtower',
    name: 'Watchtower',
    icon: '🗼',
    desc: 'General-purpose defense. Medium range, balanced accuracy.',
    footprint: { w:1, h:1 },
    isDefense: true,
    trajectory: 'flat',
    arcDeg: 270,
    triggerRadius: null,
    bonusDamage: { light:1.1, standard:1.0, heavy:0.9 },
    cost: { wood:80, gold:40 },
    buildTime: 12,
    upgradeTime: 15,
    // Integer stat tables [lv1..lv10]
    hpByLevel:       [120,145,175,210,255,305,365,435,520,620],
    damageByLevel:   [20, 24, 28, 34, 40, 48, 57, 68, 80, 96],
    rangeByLevel:    [22, 22, 23, 23, 24, 25, 25, 26, 26, 28],
    accuracyByLevel: [78, 79, 80, 81, 82, 83, 84, 86, 88, 90],
    reloadSecByLevel:[4,  4,  3.8,3.8,3.5,3.5,3.2,3.0,2.8,2.5],
    unlock: null,
    model: 'cylinder', color: 0x888888,
  },

  {
    id:   'bunker',
    name: 'Bunker',
    icon: '🧱',
    desc: 'Armored close-range defense. Strong vs Light ships and raiders.',
    footprint: { w:2, h:2 },
    isDefense: true,
    trajectory: 'flat',
    arcDeg: 120,
    triggerRadius: null,
    bonusDamage: { light:1.4, standard:1.0, heavy:0.75 },
    cost: { wood:120, gold:60 },
    buildTime: 20,
    upgradeTime: 25,
    hpByLevel:       [350,430,520,630,760,910,1090,1300,1540,1820],
    damageByLevel:   [22, 26, 31, 37, 44, 52, 61,  71,  83,  96 ],
    rangeByLevel:    [12, 12, 13, 13, 14, 14, 15,  15,  16,  16 ],
    accuracyByLevel: [65, 66, 67, 68, 69, 70, 71,  73,  75,  78 ],
    reloadSecByLevel:[5,  5,  5,  4.8,4.8,4.5,4.5, 4.3, 4.2, 4.0],
    unlock: { requiredLabLevel: 2, requiredResearch: "for1" },
    model: 'box', color: 0x6b5a4a,
  },

  {
    id:   'mortar_platform',
    name: 'Mortar Platform',
    icon: '💣',
    desc: 'Arc trajectory, long range. Strong vs Heavy / clustered fleets.',
    footprint: { w:2, h:2 },
    isDefense: true,
    trajectory: 'arc',
    arcDeg: 360,
    triggerRadius: null,
    bonusDamage: { light:0.8, standard:1.1, heavy:1.5 },
    cost: { wood:150, gold:100 },
    buildTime: 25,
    upgradeTime: 30,
    hpByLevel:       [200,240,290,350,420,505,605,725,870,1040],
    damageByLevel:   [40, 48, 57, 68, 81, 97, 116,139,167,200],
    rangeByLevel:    [25, 25, 26, 27, 28, 29, 30, 31, 32, 34],
    accuracyByLevel: [45, 46, 47, 48, 50, 52, 54, 57, 60, 64],
    reloadSecByLevel:[10, 10, 9.5,9.5,9,  9,  8.5,8.5,8,  7.5],
    unlock: { requiredLabLevel: 3, requiredResearch: "bal3" },
    model: 'cylinder', color: 0x4a4a4a,
  },

  {
    id:   'culverin_battery',
    name: 'Culverin Battery',
    icon: '🎯',
    desc: 'Narrow arc, long range. Effective vs Standard ships.',
    footprint: { w:2, h:1 },
    isDefense: true,
    trajectory: 'flat',
    arcDeg: 70,
    triggerRadius: null,
    bonusDamage: { light:0.9, standard:1.4, heavy:0.8 },
    cost: { wood:100, gold:80 },
    buildTime: 18,
    upgradeTime: 22,
    hpByLevel:       [160,195,235,285,345,415,500,600,720,865],
    damageByLevel:   [28, 34, 40, 48, 58, 69, 83, 99, 119,142],
    rangeByLevel:    [28, 29, 30, 31, 32, 33, 34, 35, 36, 38],
    accuracyByLevel: [75, 76, 77, 78, 79, 80, 81, 83, 85, 88],
    reloadSecByLevel:[7,  7,  6.8,6.8,6.5,6.5,6.2,6.0,5.8,5.5],
    unlock: { requiredLabLevel: 3, requiredResearch: "bal2" },
    model: 'box', color: 0x5a6a7a,
  },

  {
    id:   'deadmans_lure',
    name: "Deadman's Lure",
    icon: '💀',
    desc: 'Trap defense. Arms when enemy enters trigger radius, then detonates after warning delay. AoE blast.',
    footprint: { w:1, h:1 },
    isDefense: true,
    trajectory: 'aoe',
    arcDeg: 360,
    triggerRadius: 15,    // world units — enemy must enter to arm
    bonusDamage: { light:1.2, standard:1.2, heavy:1.2 },
    cost: { wood:60, gold:120 },
    buildTime: 15,
    upgradeTime: 20,
    hpByLevel:       [80, 95, 115,140,170,205,245,295,355,425],
    damageByLevel:   [50, 60, 72, 86, 103,124,148,178,214,256],
    rangeByLevel:    [12, 12, 13, 13, 14, 14, 15, 15, 16, 16],
    accuracyByLevel: [100,100,100,100,100,100,100,100,100,100], // AoE always hits
    reloadSecByLevel:[120,115,110,105,100,95, 90, 85, 80, 75],  // cooldown after detonation
    // State machine: inactive → armed → warning (3s) → detonated → cooldown
    unlock: { requiredLabLevel: 4, requiredResearch: "for2" },
    model: 'cylinder', color: 0x3a1a3a,
  },

];

/** Get stats for a defense at a given level (1-indexed) */
export function getDefenseStats(defDef, level=1){
  const lv = Math.max(1, Math.min(10, level)) - 1; // 0-indexed
  return {
    hp:        defDef.hpByLevel[lv],
    damage:    defDef.damageByLevel[lv],
    range:     defDef.rangeByLevel[lv],
    accuracy:  defDef.accuracyByLevel[lv],
    reloadSec: defDef.reloadSecByLevel[lv],
    bonusDamage: defDef.bonusDamage,
    arcDeg:    defDef.arcDeg,
    trajectory:defDef.trajectory,
    triggerRadius: defDef.triggerRadius,
  };
}
