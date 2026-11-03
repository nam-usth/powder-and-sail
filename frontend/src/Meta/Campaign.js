// ── CAMPAIGN — World Chart rules + battle results (pure JS) ───────
// design/gdd/campaign-meta.md, design/gdd/sea-battle.md

import { MISSIONS, REGIONS, PATROL } from '../data/campaign.js';
import {
  RANKS, PLUNDER_BY_HULL, PLUNDER_FORT, DEFEAT_PLUNDER_KEEP, RENOWN_PER_SINK,
  HULLS, HULL_BY_CLASS, MIN_AFLOAT_FRAC,
} from '../data/harbor.js';
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
 * Build the repeatable patrol mission for the current rank. Deterministic per seed.
 */
export function makePatrol(profile, seed = 1) {
  const rk = rankIndex(profile.renown);
  const pool = PATROL.pools[Math.min(rk, PATROL.pools.length - 1)];
  const rnd = makePrng(seed >>> 0 || 1);
  const enemies = pool.map((hid, i) => {
    const h = resolveHull(hid);
    return {
      hull: h.id, x: 55 + rnd() * 25, z: (i - (pool.length - 1) / 2) * 18 + (rnd() - .5) * 8,
      loadout: { ...PATROL.loadouts[h.hull] },
    };
  });
  const islands = [0, 1].map(k => ({
    id: 'p_rock' + k, x: -10 + rnd() * 30, z: (k ? 1 : -1) * (35 + rnd() * 20), r: 7 + Math.round(rnd() * 4),
    hp: 60, nm: 'Rocks', own: 'neutral', tdmg: 0, trof: 99,
    shape: ['SPRAWL', 'CRESCENT', 'ATOLL'][Math.floor(rnd() * 3)], seed: 100 + Math.floor(rnd() * 9000), decor: true,
  }));
  return {
    id: PATROL.id, region: 'reef', nm: PATROL.nm, desc: PATROL.desc,
    objective: { type: 'sink_all' }, enemies, islands,
    spawn: { x: -70, z: 0 }, parTime: 120 + pool.length * 40,
    reward: {
      wood: PATROL.baseReward.wood + rk * PATROL.rewardPerRank.wood,
      gold: PATROL.baseReward.gold + rk * PATROL.rewardPerRank.gold,
    },
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
  const summary = {
    missionId: mission.id, nm: mission.nm, won: !!result.won, retreated: !!result.retreated,
    stars, firstClear, reward, plunder, renown, lost, timeSec: result.timeSec,
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
