// ── SHIPYARD — roster rules (design/gdd/campaign-meta.md) ─────────
// Pure JS. All timers are wall-clock epoch ms so they resolve offline too.

import {
  HULLS, FLEET_CAP_BASE, FLEET_CAP_MAX, REPAIR_GOLD_FULL, REPAIR_SEC_FULL,
  SALVAGE_COST_FRAC, SALVAGE_SEC,
} from '../data/harbor.js';
import { getBarracksShipCapBonus } from '../Experience/Utils/ShipCapacity.js';
import { makeRosterShip, pickShipName } from './Profile.js';

const ready = b => !b.state || b.state === 'active';

/** Highest level among built shipyards (0 = none). */
export function shipyardLevel(profile) {
  return profile.harbor.buildings.reduce((m, b) =>
    b.buildingId === 'shipyard' && ready(b) ? Math.max(m, b.level || 1) : m, 0);
}

/** Number of built shipyards = parallel ship builds allowed. */
export function shipyardSlots(profile) {
  return profile.harbor.buildings.filter(b => b.buildingId === 'shipyard' && ready(b)).length;
}

/** Max ships that may sail into one battle. */
export function fleetCap(profile) {
  const barracks = profile.harbor.buildings.reduce((s, b) =>
    b.buildingId === 'barracks' && ready(b) ? s + getBarracksShipCapBonus(b.level || 1) : s, 0);
  return Math.min(FLEET_CAP_MAX, FLEET_CAP_BASE + Math.max(0, shipyardLevel(profile) - 1) + barracks);
}

/** Max ships the harbor can berth (roster size). */
export function rosterCap(profile) { return fleetCap(profile) + 3; }

/** Resolve finished builds/repairs/salvages. Returns ships that became ready. */
export function tickRoster(profile, now = Date.now()) {
  const done = [];
  for (const s of profile.fleet) {
    if ((s.status === 'building' || s.status === 'repairing') && s.readyAt <= now) {
      s.status = 'ready'; s.hpFrac = 1; s.readyAt = 0;
      done.push(s);
    }
  }
  return done;
}

export const hullOf = s => HULLS[s.hullId] || HULLS.sloop;
const afford = (res, c) => res.wood >= (c.wood || 0) && res.gold >= (c.gold || 0);
const pay = (res, c) => { res.wood -= c.wood || 0; res.gold -= c.gold || 0; };

/** Can the player start building this hull right now? → {ok, reason} */
export function canBuild(profile, hullId) {
  const h = HULLS[hullId];
  if (!h || h.enemyOnly) return { ok: false, reason: 'unknown_hull' };   // enemy-only flavour hulls are never built
  const lv = shipyardLevel(profile);
  if (lv < 1) return { ok: false, reason: 'no_shipyard' };
  if (lv < h.shipyardLevel) return { ok: false, reason: 'shipyard_level', need: h.shipyardLevel };
  const busy = profile.fleet.filter(s => s.status === 'building').length;
  if (busy >= shipyardSlots(profile)) return { ok: false, reason: 'slipway_busy' };
  if (profile.fleet.length >= rosterCap(profile)) return { ok: false, reason: 'roster_full' };
  if (!afford(profile.res, h.cost)) return { ok: false, reason: 'resources' };
  return { ok: true };
}

/** Lay down a new hull. Returns the roster ship or null. */
export function startBuild(profile, hullId, now = Date.now()) {
  if (!canBuild(profile, hullId).ok) return null;
  const h = HULLS[hullId];
  pay(profile.res, h.cost);
  const s = makeRosterShip(hullId, { status: 'building', readyAt: now + h.buildSec * 1000 }, now);
  s.nm = pickShipName(profile, hullId);
  profile.fleet.push(s);
  return s;
}

/** Repair price for an afloat, damaged ship. */
export function repairQuote(ship) {
  const h = hullOf(ship);
  const miss = Math.max(0, 1 - (ship.hpFrac ?? 1));
  return { gold: Math.ceil(miss * REPAIR_GOLD_FULL[h.hull]), sec: Math.ceil(miss * REPAIR_SEC_FULL[h.hull]) };
}

export function startRepair(profile, shipUid, now = Date.now()) {
  const s = profile.fleet.find(x => x.uid === shipUid);
  if (!s || s.status !== 'ready' || (s.hpFrac ?? 1) >= 0.999) return false;
  const q = repairQuote(s);
  if (profile.res.gold < q.gold) return false;
  profile.res.gold -= q.gold;
  s.status = 'repairing'; s.readyAt = now + q.sec * 1000;
  return true;
}

/** Salvage price for a wreck. */
export function salvageQuote(ship) {
  const h = hullOf(ship);
  return {
    wood: Math.ceil(h.cost.wood * SALVAGE_COST_FRAC),
    gold: Math.ceil(h.cost.gold * SALVAGE_COST_FRAC),
    sec: SALVAGE_SEC[h.hull],
  };
}

export function startSalvage(profile, shipUid, now = Date.now()) {
  const s = profile.fleet.find(x => x.uid === shipUid);
  if (!s || s.status !== 'wreck') return false;
  const q = salvageQuote(s);
  if (!afford(profile.res, q)) return false;
  pay(profile.res, q);
  s.status = 'repairing'; s.readyAt = now + q.sec * 1000;
  return true;
}

/** Gold to finish a timer instantly: 1 gold per 2 s remaining (min 5). */
export function rushQuote(ship, now = Date.now()) {
  const sec = Math.max(0, (ship.readyAt - now) / 1000);
  return Math.max(5, Math.ceil(sec / 2));
}

export function rush(profile, shipUid, now = Date.now()) {
  const s = profile.fleet.find(x => x.uid === shipUid);
  if (!s || (s.status !== 'building' && s.status !== 'repairing')) return false;
  const g = rushQuote(s, now);
  if (profile.res.gold < g) return false;
  profile.res.gold -= g;
  s.readyAt = now;
  tickRoster(profile, now);
  return true;
}

/** Scrap a ship for 30% of its hull cost. The last ship can never be scrapped. */
export function scrapShip(profile, shipUid) {
  if (profile.fleet.length <= 1) return false;
  const i = profile.fleet.findIndex(x => x.uid === shipUid);
  if (i < 0 || profile.fleet[i].status === 'building') return false;
  const h = hullOf(profile.fleet[i]);
  profile.res.wood += Math.floor(h.cost.wood * 0.3);
  profile.res.gold += Math.floor(h.cost.gold * 0.3);
  profile.fleet.splice(i, 1);
  return true;
}

/** Ships that may sail now (afloat, not in a yard). */
export function sailableShips(profile) {
  return profile.fleet.filter(s => s.status === 'ready');
}
