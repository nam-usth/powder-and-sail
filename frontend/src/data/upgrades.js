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

// ── GUNNERY — cannon research (harbor + Sea Battle only) ─────────
// Each tech unlocks one cannon (data/cannons.js cannonTechId: 'gun_<id>');
// the tier-I swivel, carronade and falconet are known from the start.
// Equipping a researched gun is free; repairing it is not (data/harbor.js
// REPAIR_GOLD_PER_GUN_TIER). Research Lab level = cannon tier − 1 (a tier-II gun needs any lab); cost scales with tier
// (GUN_RESEARCH_COST). Lines: long 9 → long 12 → long 24 · demi-culverin →
// culverin · demi-culverin → demi-cannon → cannon royal · carronade →
// 32-pdr carronade · mortar Mk.I → Mk.II · chain / grape shot as specials.
// Rationale + timeline: design/balance/report.md §0c.
export const GUN_RESEARCH_COST = {
  2: { wood: 60,  gold: 100 },
  3: { wood: 150, gold: 220 },
  4: { wood: 280, gold: 380 },
  5: { wood: 450, gold: 600 },
};
const G = (cannon, tier, nm, icon, req = [], o = {}) => ({
  id: `gun_${cannon}`, nm, icon, br: 'Gunnery', cannon, tier,
  desc: `Unlocks the ${o.gun || nm} (tier ${['', 'I', 'II', 'III', 'IV', 'V'][tier]})`,
  cost: { ...GUN_RESEARCH_COST[tier], ...(o.cost || {}) },
  req: req.map(r => `gun_${r}`), requiredLabLevel: tier - 1,
  effect: () => {},
});
TECH_TREE.push(
  G('long9',        2, 'Long Nines',            '🔭', [],            { gun: 'Long 9' }),
  G('demi_culv',    2, 'Demi-Culverin Casting', '🔥', [],            { gun: 'Demi-culverin' }),
  G('grapeshot',    2, 'Grape & Canister',      '🍇', [],            { gun: 'Grapeshot', cost: { wood: 80, gold: 120 } }),
  G('chain_shot',   2, 'Bar & Chain Shot',      '⛓', ['long9'],     { gun: 'Chain Shot', cost: { wood: 80, gold: 120 } }),
  G('long12',       3, 'Long Twelves',          '🎯', ['long9'],     { gun: 'Long 12' }),
  G('demi_can',     3, 'Demi-Cannon Foundry',   '⚒', ['demi_culv'], { gun: 'Demi-cannon' }),
  G('mortar1',      3, 'Sea Mortar',            '💣', [],            { gun: 'Mortar Mk.I' }),
  G('culverin',     4, 'Culverin Bore',         '🏹', ['demi_culv'], { gun: 'Culverin' }),
  G('carronade32',  4, 'The Smasher',           '🔨', [],            { gun: '32-pdr Carronade' }),
  G('mortar2',      4, 'Bomb-Ketch Mortar',     '🌋', ['mortar1'],   { gun: 'Mortar Mk.II' }),
  G('long24',       5, 'Long Twenty-Fours',     '🗼', ['long12'],    { gun: 'Long 24' }),
  G('cannon_royal', 5, 'Cannon Royal',          '👑', ['demi_can'],  { gun: 'Cannon Royal' }),
);
/** Gunnery tech by id. */
export const GUN_TECHS = TECH_TREE.filter(t => t.br === 'Gunnery');
/** A tech id plus all its prerequisites (prereqs first). */
export function techWithPrereqs(id, out = []) {
  const t = TECH_TREE.find(x => x.id === id);
  if (!t || out.includes(id)) return out;
  for (const r of t.req || []) techWithPrereqs(r, out);
  out.push(id);
  return out;
}

// ── SHIP UPGRADE TRACKS ─────────────────────────────────────────
export const UPGRADE_DEFS = [
  { id:'spd', nm:'Engine Sails', icon:'⛵', base:{wood:60, gold:30}, perLv:.10, max:3 },
  { id:'hp',  nm:'Armour Plate', icon:'🛡', base:{wood:80, gold:40}, perLv:.15, max:3 },
  { id:'rof', nm:'Gun Drill',    icon:'🎯', base:{wood:50, gold:50}, perLv:.12, max:3 },
];
