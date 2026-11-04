// ── CANNON DATA (GDD Section 4) ────────────────────────────────
// arc.m: 'all'|'side'|'bow'|'stern'|'b_s'
// rt: range tier (1=8u 2=20u 3=40u)
export const CANNONS = [
  { id:'swivel',    nm:'Swivel Gun',    t:0, cls:'general',       rt:1, dmg:8,  rof:8,  wt:5,  arc:{m:'all',  d:360}, desc:'Free. Omnidirectional.' },
  { id:'carronade', nm:'Carronade',     t:1, cls:'anti-light',    rt:1, dmg:28, rof:16, wt:12, arc:{m:'side', d:120}, ctr:{t:'light',   b:.6}, sp:'dodge_ig',   desc:'+60% vs Light · ignores 10% dodge.' },
  { id:'long9',     nm:'Long 9',        t:1, cls:'anti-light',    rt:3, dmg:18, rof:22, wt:10, arc:{m:'b_s',  d:70 }, ctr:{t:'light',   b:.6},                  desc:'+60% vs Light · Range 3 sniper.' },
  { id:'demi_culv', nm:'Demi-culverin', t:1, cls:'anti-standard', rt:2, dmg:35, rof:19, wt:14, arc:{m:'side', d:140}, ctr:{t:'standard',b:.5},                  desc:'+50% vs Standard · wide arc.' },
  { id:'demi_can',  nm:'Demi-cannon',   t:1, cls:'anti-heavy',    rt:2, dmg:45, rof:26, wt:18, arc:{m:'side', d:120}, ctr:{t:'heavy',   b:.7}, sp:'arm_pierce', desc:'+70% vs Heavy · armor pierce.' },
  { id:'mortar1',   nm:'Mortar Mk.I',   t:1, cls:'siege',         rt:2, dmg:50, rof:32, wt:20, arc:{m:'all',  d:360}, ctr:{t:'tower',   b:.8}, sp:'aoe',        desc:'+80% vs Tower · arc fire · AoE.' },
  { id:'falconet',  nm:'Falconet',      t:1, cls:'rapid-fire',    rt:2, dmg:12, rof:5,  wt:8,  arc:{m:'side', d:110}, ctr:{t:'light',   b:.4}, sp:'debuff',     desc:'+40% vs Light · dodge debuff.' },
];

// Per-cannon overlay colours (Milestone E design)
export const CANNON_FILL_COL = {
  swivel: 0xe87820, carronade: 0x30a060, long9: 0x2060cc,
  demi_culv: 0xb04040, demi_can: 0xaa3380, mortar1: 0xcc8020, falconet: 0x20a0a0,
};
export const CANNON_LINE_COL = {
  swivel: 0xff9940, carronade: 0x50e890, long9: 0x4488ff,
  demi_culv: 0xff6060, demi_can: 0xee55cc, mortar1: 0xffcc44, falconet: 0x40dddd,
};

export function getCannonFillCol(cid){ return CANNON_FILL_COL[cid] != null ? CANNON_FILL_COL[cid] : 0x8888ff; }
export function getCannonLineCol(cid){ return CANNON_LINE_COL[cid] != null ? CANNON_LINE_COL[cid] : 0xaaaaff; }

// Milestone AK additions
CANNONS.push(
  { id:'chain_shot', nm:'Chain Shot', t:1, cls:'debuff',    rt:2, dmg:18, rof:20, wt:12, arc:{m:'side',d:110}, sp:'speed_cut', desc:'-40% speed for 8s · vs rigging.' },
  { id:'grapeshot',  nm:'Grapeshot',  t:1, cls:'aoe',       rt:1, dmg:22, rof:18, wt:11, arc:{m:'side',d:120}, sp:'aoe',       desc:'AoE burst · damages nearby ships.' }
);

// AK overlay colours
CANNON_FILL_COL.chain_shot = 0x4080cc;
CANNON_FILL_COL.grapeshot  = 0xc06020;
CANNON_LINE_COL.chain_shot = 0x80c0ff;
CANNON_LINE_COL.grapeshot  = 0xff9050;

// ── AW: cannon tiers I–V ─────────────────────────────────────────
// A hull of tier N (data/harbor.js HULLS.tier) can mount cannons of tier ≤ N.
// Ships without a hull tier (classic Open War fleets) are unrestricted.
// Heavier guns also slow the ship (wt → applySpeed), so a big gun on a small
// hull is a trade-off even where it is allowed.
const TIER_OF = {
  swivel: 1, carronade: 1, falconet: 1,
  long9: 2, demi_culv: 2, chain_shot: 2, grapeshot: 2,
  demi_can: 3, mortar1: 3,
};
CANNONS.push(
  { id:'long12',       nm:'Long 12',            t:1, cls:'anti-standard', rt:3, dmg:27, rof:21, wt:14, arc:{m:'b_s',  d:80 }, ctr:{t:'standard',b:.4},                  desc:'+40% vs Standard · long-range chaser.' },
  { id:'carronade32',  nm:'32-pdr Carronade',   t:1, cls:'anti-heavy',    rt:1, dmg:58, rof:17, wt:20, arc:{m:'side', d:120}, ctr:{t:'heavy',   b:.5}, sp:'dodge_ig',   desc:'Smasher · +50% vs Heavy at close range.' },
  { id:'culverin',     nm:'Culverin',           t:1, cls:'anti-standard', rt:3, dmg:34, rof:21, wt:17, arc:{m:'side', d:110}, ctr:{t:'standard',b:.5},                  desc:'+50% vs Standard · long broadside.' },
  { id:'mortar2',      nm:'Mortar Mk.II',       t:1, cls:'siege',         rt:2, dmg:78, rof:30, wt:25, arc:{m:'all',  d:360}, ctr:{t:'tower',   b:1.0}, sp:'aoe',       desc:'+100% vs Tower · heavy arc fire · AoE.' },
  { id:'long24',       nm:'Long 24',            t:1, cls:'anti-heavy',    rt:3, dmg:44, rof:23, wt:22, arc:{m:'side', d:100}, ctr:{t:'heavy',   b:.5}, sp:'arm_pierce', desc:'+50% vs Heavy · armor pierce at long range.' },
  { id:'cannon_royal', nm:'Cannon Royal',       t:1, cls:'anti-heavy',    rt:2, dmg:82, rof:28, wt:30, arc:{m:'side', d:110}, ctr:{t:'heavy',   b:.7}, sp:'arm_pierce', desc:'42-pounder · +70% vs Heavy · armor pierce.' },
);
Object.assign(TIER_OF, { long12: 3, carronade32: 4, culverin: 4, mortar2: 4, long24: 5, cannon_royal: 5 });
CANNONS.forEach(c => { c.tier = TIER_OF[c.id] || 1; });
Object.assign(CANNON_FILL_COL, { long12: 0x3070b0, carronade32: 0x208050, culverin: 0x903030, mortar2: 0xb06010, long24: 0x602090, cannon_royal: 0x806010 });
Object.assign(CANNON_LINE_COL, { long12: 0x60a0ff, carronade32: 0x40d080, culverin: 0xff7070, mortar2: 0xffb040, long24: 0xc070ff, cannon_royal: 0xffd060 });

/** Highest cannon tier a ship may mount (Infinity when it has no hull tier). */
export const maxCannonTier = ship => (ship && ship.hullTier) ? ship.hullTier : Infinity;
/** Can this cannon go on this ship? */
export const canMountCannon = (cn, ship) => !!cn && (cn.tier || 1) <= maxCannonTier(ship);
export const ROMAN_TIER = ['', 'I', 'II', 'III', 'IV', 'V'];

// B1: O(1) lookup map — use CANNON_BY_ID.get(id) instead of CANNONS.find(x=>x.id===id)
export const CANNON_BY_ID = new Map(CANNONS.map(c => [c.id, c]));
