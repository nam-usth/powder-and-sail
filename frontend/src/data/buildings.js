// ── BUILDING DEFINITIONS ─────────────────────────────────────────
// Instance-based: multiple buildings of same type allowed per island.
// Stats use integer/authored tables — no percentage formulas.
// Level 1–10 supported in data; UI shows levels as implemented.

export const BUILDINGS = [

  // ── Resource Buildings ─────────────────────────────────────────
  {
    id: 'lumber_mill', name: 'Lumber Mill', icon: '🪵',
    category: 'resource', tier: 1,
    desc: 'Produces Wood per second. Multiple allowed.',
    footprint: { w:1, h:1 },
    cost: { wood:60, gold:0 },
    buildTime: 15,
    upgradeTime: 20,
    isDefense: false,
    unlock: null,
    model: 'cylinder', color: 0x8b6347,
    // Wood production per second by level [lv1..lv10]
    productionByLevel: [2, 3, 4, 5, 6, 7, 8, 9, 10, 12],
    hpByLevel:         [60,70,82,96,112,130,152,177,206,240],
  },

  {
    id: 'gold_mine', name: 'Gold Mine', icon: '🪙',
    category: 'resource', tier: 1,
    desc: 'Produces Gold per second. Multiple allowed.',
    footprint: { w:1, h:1 },
    cost: { wood:40, gold:40 },
    buildTime: 15,
    upgradeTime: 20,
    isDefense: false,
    unlock: null,
    model: 'box', color: 0xc8a030,
    productionByLevel: [1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
    hpByLevel:         [60,70,82,96,112,130,152,177,206,240],
  },

  {
    id: 'warehouse', name: 'Warehouse', icon: '🏛',
    category: 'resource', tier: 1,
    desc: 'Increases resource cap. Protects resources from being looted.',
    footprint: { w:2, h:1 },
    cost: { wood:100, gold:0 },
    buildTime: 25,
    upgradeTime: 30,
    isDefense: false,
    unlock: null,
    model: 'box', color: 0x7a6a5a,
    // Resource cap bonus by level (added to base cap)
    capacityByLevel:         [100,150,210,280,360,450,550,660,780,910],
    // Protected amount by level (cannot be looted)
    protectedByLevel:        [50, 80, 120,170,230,300,380,470,570,680],
    hpByLevel:               [80, 95, 115,140,170,205,245,295,355,425],
    productionByLevel:       [0,  0,  0,  0,  0,  0,  0,  0,  0,  0 ],
  },

  // ── Military Buildings ─────────────────────────────────────────
  {
    id: 'research_lab', name: 'Research Lab', icon: '🔬',
    category: 'utility', tier: 2,
    desc: 'Unlocks higher-tier research. Higher level = more advanced tech.',
    footprint: { w:2, h:1 }, cost: { wood:120, gold:80 }, buildTime: 45, upgradeTime: 50, isDefense: false,
    model: 'box', color: 0x3a4a6a, unlock: null,
    labLevelByLevel:  [1,2,3,4,5,6,7,8,9,10],
    hpByLevel:        [80,95,115,140,170,205,245,295,355,425],
    productionByLevel:[0, 0, 0,  0,  0,  0,  0,  0,  0,  0 ],
  },

  {
    id: 'barracks', name: 'Barracks', icon: '⚔',
    category: 'military', tier: 2,
    desc: 'Increases fleet HP. Higher levels allow larger fleet.',
    footprint: { w:2, h:2 },
    cost: { wood:120, gold:80 },
    buildTime: 30, upgradeTime: 40,
    isDefense: false,
    unlock: { requiredLabLevel: 2 },
    model: 'box', color: 0x5a7a5a,
    // HP bonus % applied to fleet (additive per barracks)
    fleetHpBonusByLevel: [10,13,16,20,24,29,34,40,47,55],
    hpByLevel:           [120,145,175,210,255,305,365,435,520,620],
    productionByLevel:   [0,0,0,0,0,0,0,0,0,0],
  },

  {
    id: 'shipyard', name: 'Shipyard', icon: '⚓',
    category: 'military', tier: 2,
    desc: 'Increases repair speed near home. Higher levels unlock ship upgrades.',
    footprint: { w:2, h:2 },
    cost: { wood:150, gold:100 },
    buildTime: 40, upgradeTime: 50,
    isDefense: false,
    unlock: { requiredLabLevel: 2 },
    model: 'box', color: 0x4a6080,
    // Repair HP/s bonus
    repairRateByLevel: [2,3,4,5,6,7,8,9,10,12],
    hpByLevel:         [100,120,145,175,210,255,305,365,435,520],
    productionByLevel: [0,0,0,0,0,0,0,0,0,0],
  },

  {
    id: 'lighthouse', name: 'Lighthouse', icon: '💡',
    category: 'military', tier: 3,
    desc: 'Extends vision range. Reveals enemies on minimap.',
    footprint: { w:1, h:1 },
    cost: { wood:100, gold:150 },
    buildTime: 20, upgradeTime: 25,
    isDefense: false,
    unlock: { requiredLabLevel: 3 },
    model: 'cylinder', color: 0xd0d0b0,
    // Vision range multiplier by level
    visionMultByLevel: [1.5,1.6,1.7,1.8,1.9,2.0,2.1,2.2,2.3,2.5],
    hpByLevel:         [60, 70, 82, 96, 112,130,152,177,206,240],
    productionByLevel: [0,  0,  0,  0,  0,  0,  0,  0,  0,  0 ],
  },

  {
    id: 'fortress_wall', name: 'Fortress Wall', icon: '🏰',
    category: 'military', tier: 2,
    desc: 'Boosts island fort HP and tower damage.',
    footprint: { w:3, h:1 },
    cost: { wood:200, gold:0 },
    buildTime: 60, upgradeTime: 70,
    isDefense: false,
    unlock: { requiredLabLevel: 2 },
    model: 'box', color: 0x7a6050,
    fortHpBonusByLevel:  [150,180,215,260,310,375,450,540,650,780],
    towerDmgBonusByLevel:[15, 18, 22, 26, 31, 37, 44, 53, 64, 76],
    hpByLevel:           [300,360,430,515,620,740,890,1065,1280,1535],
    productionByLevel:   [0,0,0,0,0,0,0,0,0,0],
  },

];

/** Get the production rate for a building instance at a given level */
export function getBuildingProduction(bldDef, level=1){
  const lv=Math.max(1,Math.min(10,level))-1;
  return bldDef.productionByLevel ? (bldDef.productionByLevel[lv] || 0) : 0;
}

/** Create a new building instance object */
export function createBuildingInstance(bldDef, gridKey, worldX, worldZ){
  const lv=1;
  return {
    instanceId:  'bld_' + Math.random().toString(36).slice(2,9),
    buildingId:  bldDef.id,
    level:       lv,
    hp:          bldDef.hpByLevel[0],
    maxHp:       bldDef.hpByLevel[0],
    gridKey,
    worldX,
    worldZ,
    state:       'active',
    isDefense:   bldDef.isDefense != null ? bldDef.isDefense : false,
    mesh:        null,   // set by BuildSystem after 3D mesh created
  };
}
