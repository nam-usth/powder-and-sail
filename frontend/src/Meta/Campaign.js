// ── CAMPAIGN — World Chart rules + battle results (pure JS) ───────
// design/gdd/campaign-meta.md, design/gdd/sea-battle.md

import { MISSIONS, REGIONS, PATROL, FINAL_MISSION } from '../data/campaign.js';
import {
  RANKS, PLUNDER_BY_HULL, PLUNDER_FORT, DEFEAT_PLUNDER_KEEP, RENOWN_PER_SINK,
  HULLS, HULL_BY_CLASS, MIN_AFLOAT_FRAC,
} from '../data/harbor.js';
import { HULL_SLOTS } from '../data/ships.js';
import { FACTIONS } from '../data/factions.js';
import { makePrng } from '../data/islandShapes.js';

export const getMission = id => (id === PATROL.id ? null : MISSIONS.find(m => m.id === id) || null);

/** Rank index for a renown total. */
export function rankIndex(renown) {
  let i = 0;
  RANKS.forEach((r, k) => { if (renown >= r.renown) i = k; });
  return i;
}
export const rankOf = renown => RANKS[rankIndex(renown)];
export function nextRank(renown) {
  const i = rankIndex(renown);
  return RANKS[i + 1] || null;
}

export function regionUnlocked(profile, regionId) {
  const r = REGIONS.find(x => x.id === regionId);
  return !!r && profile.renown >= r.minRenown;
}

/** 'locked' | 'open' | 'won' */
export function missionState(profile, m) {
  if (profile.campaign.won[m.id]) return 'won';
  if (!regionUnlocked(profile, m.region)) return 'locked';
  if (!(m.requires || []).every(id => profile.campaign.won[id])) return 'locked';
  return 'open';
}

/** Resolve a hull id or class name to a HULLS entry. */
export function resolveHull(h) {
  return HULLS[h] || HULLS[HULL_BY_CLASS[h]] || HULLS.brigantine;
}

/**
 * Combat strength of a hull: hp × gun slots — an HP × firepower proxy used to
 * size patrols to the fleet that sails (design/balance/report.md §Patrol).
 */
export function hullStrength(hullOrId) {
  const h = typeof hullOrId === 'string' ? resolveHull(hullOrId) : hullOrId;
  return h.hp * ((HULL_SLOTS[h.hull] || []).length || 2);
}

/** The furthest sea the player's renown has opened (campaign order). */
export function frontierSea(profile) {
  let sea = REGIONS[0];
  for (const r of REGIONS) if (profile.renown >= r.minRenown) sea = r;
  return sea;
}

/** Faction of `sea` whose ship style matches the hull (junk → Red Banner, …). */
function factionFor(sea, hull) {
  const fs = sea.factions || [];
  return fs.find(f => FACTIONS[f]?.style === hull.style) || fs.find(f => FACTIONS[f]?.style === 'european') || fs[0] || 'buccaneers';
}

/**
 * Build the repeatable patrol. Enemies come from the frontier sea (its hull
 * pool and factions) and are sized to the ships that sail: the strongest pool
 * hulls that fit in PATROL.strengthRatio × Σ hullStrength(fleet). When even
 * the smallest foe is too strong (a wiped player with one salvaged sloop), a
 * lone cutter is sent with its hull trimmed to the budget, so a patrol is
 * always winnable. Reward scales with the strength actually met.
 * Deterministic per seed and fleet.
 * @param {object} profile
 * @param {number} [seed]
 * @param {string[]|null} [shipUids] the sailing ships; default = the strongest
 *        ready ships up to the fleet cap (briefing preview)
 */
export function makePatrol(profile, seed = 1, shipUids = null) {
  const sea = frontierSea(profile);
  const pool = (PATROL.pools[sea.id] || Object.values(PATROL.pools)[0]).map(resolveHull)
    .sort((a, b) => hullStrength(b) - hullStrength(a));
  const rnd = makePrng(seed >>> 0 || 1);
  let fleet = (shipUids || []).map(u => profile.fleet.find(s => s.uid === u)).filter(Boolean);
  if (!fleet.length) {
    fleet = profile.fleet.filter(s => s.status === 'ready')
      .sort((a, b) => hullStrength(b.hullId) - hullStrength(a.hullId))
      .slice(0, PATROL.previewShips || 5);
  }
  const budget = PATROL.strengthRatio * fleet.reduce((a, s) => a + hullStrength(s.hullId), 0);
  const picks = [];
  let used = 0;
  for (const h of pool) {
    if (picks.length >= PATROL.maxShips) break;
    const st = hullStrength(h);
    if (used + st <= budget) { picks.push({ h }); used += st; }
  }
  if (!picks.length) {                                   // lone small foe, trimmed to the budget
    const h = resolveHull(PATROL.minFoe || 'cutter');
    const slots = (HULL_SLOTS[h.hull] || []).length || 2;
    const hp = Math.max(25, Math.min(h.hp, Math.floor(budget / slots)));
    picks.push({ h, hp });
    used = hp * slots;
  }
  const names = new Map();
  const enemies = picks.map(({ h, hp }, i) => {
    const faction = factionFor(sea, h);
    const pool2 = FACTIONS[faction]?.shipNames || [];
    const taken = names.get(faction) || new Set();
    const free = pool2.filter(n => !taken.has(n));
    const nm = free.length ? free[Math.floor(rnd() * free.length)] : undefined;
    if (nm) { taken.add(nm); names.set(faction, taken); }
    const e = {
      hull: h.id, faction, x: 55 + rnd() * 25, z: (i - (picks.length - 1) / 2) * 18 + (rnd() - .5) * 8,
      loadout: { ...(PATROL.loadoutsByTier?.[h.hull]?.[h.tier] || PATROL.loadouts[h.hull]) },   // tier-legal fit (data/campaign.js)
    };
    if (nm) e.nm = nm;
    if (hp) e.hp = hp;
    return e;
  });
  const islands = [0, 1].map(k => ({
    id: 'p_rock' + k, x: -10 + rnd() * 30, z: (k ? 1 : -1) * (35 + rnd() * 20), r: 7 + Math.round(rnd() * 4),
    hp: 60, nm: 'Rocks', own: 'neutral', tdmg: 0, trof: 99,
    shape: ['SPRAWL', 'CRESCENT', 'ATOLL'][Math.floor(rnd() * 3)], seed: 100 + Math.floor(rnd() * 9000), decor: true,
  }));
  const R = PATROL.reward;
  return {
    id: PATROL.id, region: sea.id, faction: enemies[0]?.faction || sea.factions?.[0], nm: PATROL.nm, desc: PATROL.desc,
    objective: { type: 'sink_all' }, enemies, islands,
    spawn: { x: -70, z: 0 }, parTime: 120 + enemies.length * 40,
    reward: {
      wood: Math.round(R.base.wood + R.perStrength.wood * used),
      gold: Math.round(R.base.gold + R.perStrength.gold * used),
    },
    strength: { fleet: Math.round(budget / PATROL.strengthRatio), enemy: Math.round(used) },
    firstClear: { wood: 0, gold: 0 }, renown: PATROL.renown, requires: [], repeatable: true, seed,
  };
}

/** Stars for a won battle: ★ win · ★★ no losses · ★★★ also under par. */
export function starsFor(result, mission) {
  if (!result.won) return 0;
  let s = 1;
  if (!result.lost.length) s++;
  if (s === 2 && result.timeSec <= (mission.parTime || Infinity)) s++;
  return s;
}

/** Plunder from sinks and forts. */
export function plunderFor(sunkHullClasses, fortsDestroyed) {
  const p = { wood: 0, gold: 0 };
  sunkHullClasses.forEach(c => { const v = PLUNDER_BY_HULL[c] || PLUNDER_BY_HULL.light; p.wood += v.wood; p.gold += v.gold; });
  p.wood += fortsDestroyed * PLUNDER_FORT.wood;
  p.gold += fortsDestroyed * PLUNDER_FORT.gold;
  return p;
}

/**
 * Bank a battle outcome into the profile.
 * @param {object} profile
 * @param {object} mission  mission def (from getMission or makePatrol)
 * @param {object} result {
 *    won:boolean, retreated?:boolean, timeSec:number,
 *    ships:[{uid, hpFrac, sunk:boolean, sinks:number}],
 *    sunkEnemyClasses:string[], fortsDestroyed:number }
 * @returns summary {won, stars, firstClear, reward:{wood,gold}, plunder, renown, lost:[uid]}
 */
export function applyBattleResult(profile, mission, result) {
  const lost = result.ships.filter(s => s.sunk).map(s => s.uid);
  const plunder = plunderFor(result.sunkEnemyClasses || [], result.fortsDestroyed || 0);
  const firstClear = !!result.won && !profile.campaign.won[mission.id] && !mission.repeatable;
  const reward = { wood: 0, gold: 0 };
  if (result.won) {
    reward.wood = mission.reward.wood + plunder.wood + (firstClear ? mission.firstClear.wood : 0);
    reward.gold = mission.reward.gold + plunder.gold + (firstClear ? mission.firstClear.gold : 0);
  } else {
    reward.wood = Math.floor(plunder.wood * DEFEAT_PLUNDER_KEEP);
    reward.gold = Math.floor(plunder.gold * DEFEAT_PLUNDER_KEEP);
  }
  const sinks = (result.sunkEnemyClasses || []).length;
  const renown = (result.won ? mission.renown : 0) + sinks * RENOWN_PER_SINK;
  const stars = starsFor({ ...result, lost }, mission);

  profile.res.wood += reward.wood;
  profile.res.gold += reward.gold;
  profile.renown += renown;
  const c = profile.campaign;
  c.attempts[mission.id] = (c.attempts[mission.id] || 0) + 1;
  if (result.won) {
    if (mission.repeatable) c.patrolsWon = (c.patrolsWon || 0) + 1;
    else { c.won[mission.id] = true; c.stars[mission.id] = Math.max(c.stars[mission.id] || 0, stars); }
  }

  // Ships come home with their damage; sunk ones are wrecks.
  for (const r of result.ships) {
    const s = profile.fleet.find(x => x.uid === r.uid);
    if (!s) continue;
    s.battles = (s.battles || 0) + 1;
    s.sinks = (s.sinks || 0) + (r.sinks || 0);
    if (r.sunk) { s.status = 'wreck'; s.hpFrac = 0; }
    else { s.status = 'ready'; s.hpFrac = Math.max(MIN_AFLOAT_FRAC, Math.min(1, r.hpFrac)); }
    if (r.loadout) s.loadout = { ...r.loadout };
  }

  profile.stats.battles++;
  if (result.won) profile.stats.wins++;
  profile.stats.sinks += sinks;
  profile.stats.shipsLost += lost.length;
  profile.battle = null;
  const campaignComplete = firstClear && mission.id === FINAL_MISSION;
  if (campaignComplete) profile.campaign.completedAt = profile.campaign.completedAt || Date.now();
  const summary = {
    missionId: mission.id, nm: mission.nm, won: !!result.won, retreated: !!result.retreated,
    stars, firstClear, reward, plunder, renown, lost, timeSec: result.timeSec, campaignComplete,
  };
  profile.lastResult = summary;
  return summary;
}

/**
 * A battle that was started but never reported (tab closed / crash): forfeit
 * with no rewards, ships return with their pre-battle state (GDD edge case).
 */
export function abandonPendingBattle(profile) {
  if (!profile.battle) return false;
  profile.battle = null;
  return true;
}

/** Campaign progress: missions won / total, stars earned / max, complete flag. */
export function campaignProgress(profile) {
  const won = MISSIONS.filter(m => profile.campaign.won[m.id]).length;
  const stars = MISSIONS.reduce((a, m) => a + (profile.campaign.stars[m.id] || 0), 0);
  return { won, total: MISSIONS.length, stars, maxStars: MISSIONS.length * 3, complete: !!profile.campaign.won[FINAL_MISSION] };
}
