// ── RESEARCH TREE ───────────────────────────────────────────────
// effect() closures are bound in ResearchSystem after state exists
export const TECH_TREE = [
  { id:'bal1', nm:'Powder Charge T1', icon:'💥', br:'Ballistics',   desc:'+15% cannon dmg',       cost:{gold:80},          req:[] },
  { id:'bal2', nm:'Rifled Barrel',    icon:'🎯', br:'Ballistics',   desc:'+20% hit chance',        cost:{gold:150},         req:['bal1'] },
  { id:'bal3', nm:'Explosive Shell',  icon:'💣', br:'Ballistics',   desc:'Mortar AoE ×2',          cost:{gold:220},         req:['bal2'], requiredLabLevel:3 },
  { id:'nav1', nm:'Hull Caulking',    icon:'⚓', br:'Navigation',   desc:'+20% fleet HP',          cost:{wood:100},         req:[] },
  { id:'nav2', nm:'Lateen Sails',     icon:'⛵', br:'Navigation',   desc:'+15% fleet speed',       cost:{wood:150},         req:['nav1'], requiredLabLevel:2 },
  { id:'nav3', nm:'Copper Sheathing', icon:'🛡', br:'Navigation',   desc:'-30% tower damage',      cost:{wood:200,gold:80}, req:['nav2'], requiredLabLevel:3 },
  { id:'for1', nm:'Garrison Drill',   icon:'🏰', br:'Fortification',desc:'+30% fort HP',           cost:{wood:120},         req:[] },
  { id:'for2', nm:'Heated Shot',      icon:'🔥', br:'Fortification',desc:'Tower shots burn 3s',    cost:{gold:120},         req:['for1'] },
  { id:'for3', nm:'Chain Shot',       icon:'⛓', br:'Fortification',desc:'Side cannons slow -20%', cost:{gold:180,wood:80}, req:['for2'], requiredLabLevel:4 },
];

// ── SHIP UPGRADE TRACKS ─────────────────────────────────────────
export const UPGRADE_DEFS = [
  { id:'spd', nm:'Engine Sails', icon:'⛵', base:{wood:60, gold:30}, perLv:.10, max:3 },
  { id:'hp',  nm:'Armour Plate', icon:'🛡', base:{wood:80, gold:40}, perLv:.15, max:3 },
  { id:'rof', nm:'Gun Drill',    icon:'🎯', base:{wood:50, gold:50}, perLv:.12, max:3 },
];
