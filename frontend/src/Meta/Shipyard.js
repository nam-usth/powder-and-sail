// ── SHIPYARD — roster rules (design/gdd/campaign-meta.md) ─────────
// Pure JS. All timers are wall-clock epoch ms so they resolve offline too.

import {
  HULLS, FLEET_CAP_BASE, FLEET_CAP_MAX, REPAIR_GOLD_FULL, REPAIR_SEC_FULL,
  SALVAGE_COST_FRAC, SALVAGE_SEC, REPAIR_GOLD_PER_GUN_TIER, SALVAGE_WOOD_PER_GUN_TIER,
} from '../data/harbor.js';
import { CANNON_BY_ID } from '../data/cannons.js';
import { HULL_SLOTS } from '../data/ships.js';
import { getBarracksShipCapBonus } from '../Experience/Utils/ShipCapacity.js';
import { BUILDINGS } from '../data/buildings.js';
import { DEFENSES } from '../data/defenses.js';
import { makeRosterShip, pickShipName } from './Profile.js';

const BLD_BY_ID = Object.fromEntries([...BUILDINGS, ...DEFENSES].map(b => [b.id, b]));
/** Barracks levels that add +1 fleet cap (Experience/Utils/ShipCapacity.getBarracksShipCapBonus). */
const BARRACKS_CAP_LEVELS = [1, 3, 5, 7];

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

/** Research Lab level of the harbor (0 = no ready lab) — gates buildings and research. */
export function labLevel(profile) {
  const lab = BLD_BY_ID.research_lab;
  return profile.harbor.buildings.reduce((m, b) => {
    if (b.buildingId !== 'research_lab' || !ready(b)) return m;
    const lv = b.level || 1;
    return Math.max(m, lab?.labLevelByLevel?.[lv - 1] || lv);
  }, 0);
}

/**
 * What a harbor building still needs before it can be placed (the BuildPanel
 * hides locked buildings; this says why). Same rule as BuildPanel._isUnlocked.
 * @returns {{ok:boolean, missing:Array<{kind:'lab_level', need:number, have:number}
 *            |{kind:'research', id:string}|{kind:'unknown'}>}}
 */
export function buildingRequirements(profile, buildingId) {
  const d = BLD_BY_ID[buildingId];
  if (!d) return { ok: false, missing: [{ kind: 'unknown' }] };
  const u = d.unlock || {}, missing = [];
  const have = labLevel(profile);
  if (u.requiredLabLevel && have < u.requiredLabLevel) missing.push({ kind: 'lab_level', need: u.requiredLabLevel, have });
  if (u.requiredResearch && !(profile.harbor.researched || []).includes(u.requiredResearch)) missing.push({ kind: 'research', id: u.requiredResearch });
  return { ok: !missing.length, missing };
}

/**
 * Fleet cap explained, for the Shipyard / Set Sail UI (design/gdd/campaign-meta.md §5):
 * total = min(max, base + (shipyard level − 1) + Σ barracks bonus).
 * `next` lists the concrete steps that raise the cap by one, each with what
 * blocks it (e.g. a Barracks needs Research Lab Lv 2).
 * @returns {{
 *   total:number, max:number, base:number, capped:boolean,
 *   shipyard:{level:number, bonus:number},
 *   barracks:{count:number, bonus:number, levels:number[]},
 *   next:Array<{kind:'upgrade_shipyard', from:number, to:number, gain:1}
 *            | {kind:'build_shipyard', gain:0}
 *            | {kind:'build_barracks', gain:1, ok:boolean, missing:object[]}
 *            | {kind:'upgrade_barracks', from:number, to:number, gain:1}>
 * }}
 */
export function fleetCapBreakdown(profile) {
  const yl = shipyardLevel(profile);
  const bars = profile.harbor.buildings.filter(b => b.buildingId === 'barracks' && ready(b));
  const barracksBonus = bars.reduce((s, b) => s + getBarracksShipCapBonus(b.level || 1), 0);
  const raw = FLEET_CAP_BASE + Math.max(0, yl - 1) + barracksBonus;
  const total = Math.min(FLEET_CAP_MAX, raw);
  const next = [];
  if (total < FLEET_CAP_MAX) {
    if (yl < 1) next.push({ kind: 'build_shipyard', gain: 0 });
    else if (yl < 10) next.push({ kind: 'upgrade_shipyard', from: yl, to: yl + 1, gain: 1 });
    const upg = bars.map(b => ({ b, to: BARRACKS_CAP_LEVELS.find(l => l > (b.level || 1)) })).filter(x => x.to)
      .sort((x, y) => x.to - y.to)[0];
    if (upg) next.push({ kind: 'upgrade_barracks', from: upg.b.level || 1, to: upg.to, gain: 1 });
    const req = buildingRequirements(profile, 'barracks');
    next.push({ kind: 'build_barracks', gain: 1, ok: req.ok, missing: req.missing });
  }
  return {
    total, max: FLEET_CAP_MAX, base: FLEET_CAP_BASE, capped: raw >= FLEET_CAP_MAX,
    shipyard: { level: yl, bonus: Math.max(0, yl - 1) },
    barracks: { count: bars.length, bonus: barracksBonus, levels: bars.map(b => b.level || 1) },
    next,
  };
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

/**
 * Everything that stops this hull being laid down now, in priority order
 * (empty = buildable). Each entry: {reason, ...detail}
 *   unknown_hull · no_shipyard
 *   shipyard_level {need, have}         — upgrade the Shipyard
 *   slipway_busy   {busy, slots}        — wait, or build another Shipyard
 *   roster_full    {have, cap, fleetCap}— scrap a ship, or raise the fleet cap (fleetCapBreakdown)
 *   resources      {short:{wood,gold}}  — stock missing
 */
export function buildBlockers(profile, hullId) {
  const h = HULLS[hullId];
  if (!h || h.enemyOnly) return [{ reason: 'unknown_hull' }];   // enemy-only flavour hulls are never built
  const out = [];
  const lv = shipyardLevel(profile);
  if (lv < 1) out.push({ reason: 'no_shipyard' });
  else if (lv < h.shipyardLevel) out.push({ reason: 'shipyard_level', need: h.shipyardLevel, have: lv });
  const busy = profile.fleet.filter(s => s.status === 'building').length, slots = shipyardSlots(profile);
  if (lv >= 1 && busy >= slots) out.push({ reason: 'slipway_busy', busy, slots });
  const cap = rosterCap(profile);
  if (profile.fleet.length >= cap) out.push({ reason: 'roster_full', have: profile.fleet.length, cap, fleetCap: fleetCap(profile) });
  if (!afford(profile.res, h.cost)) {
    out.push({ reason: 'resources', short: {
      wood: Math.max(0, Math.ceil((h.cost.wood || 0) - profile.res.wood)),
      gold: Math.max(0, Math.ceil((h.cost.gold || 0) - profile.res.gold)) } });
  }
  return out;
}

/**
 * Can the player start building this hull right now? → {ok, reason, ...detail}
 * (the first of buildBlockers; `blockers` carries the full list for the UI).
 */
export function canBuild(profile, hullId) {
  const blockers = buildBlockers(profile, hullId);
  if (!blockers.length) return { ok: true, blockers };
  return { ok: false, ...blockers[0], blockers };
}

/** Lay down a new hull. Returns the roster ship or null. */
export function startBuild(profile, hullId, now = Date.now()) {
  if (!canBuild(profile, hullId).ok) return null;
  const h = HULLS[hullId];
  pay(profile.res, h.cost);
  // Default fit uses researched guns only (cannon research, data/cannons.js).
  const s = makeRosterShip(hullId, { status: 'building', readyAt: now + h.buildSec * 1000, known: profile.harbor.researched || [] }, now);
  s.nm = pickShipName(profile, hullId);
  profile.fleet.push(s);
  return s;
}

/** Guns mounted on a roster ship (only slots its hull has). */
export function mountedGuns(ship) {
  const h = hullOf(ship);
  return (HULL_SLOTS[h.hull] || Object.keys(ship.loadout || {}))
    .map(sl => CANNON_BY_ID.get(ship.loadout?.[sl])).filter(Boolean);
}

/** Gold to re-fit the mounted guns from 0 → full: Σ REPAIR_GOLD_PER_GUN_TIER[cannon tier]. */
export function gunRepairGoldFull(ship) {
  return mountedGuns(ship).reduce((a, cn) => a + (REPAIR_GOLD_PER_GUN_TIER[cn.tier || 1] || 0), 0);
}

/**
 * Repair price for an afloat, damaged ship. Hull base + a per-gun term by
 * cannon tier (equipping is free; repairing big guns is not), both scaled by
 * the missing HP fraction. → {gold, sec, hullGold, gunGold}
 */
export function repairQuote(ship) {
  const h = hullOf(ship);
  const miss = Math.max(0, 1 - (ship.hpFrac ?? 1));
  const hullGold = miss * REPAIR_GOLD_FULL[h.hull], gunGold = miss * gunRepairGoldFull(ship);
  const gold = Math.ceil(hullGold + gunGold);
  const hg = Math.min(gold, Math.ceil(hullGold));
  return { gold, sec: Math.ceil(miss * REPAIR_SEC_FULL[h.hull]), hullGold: hg, gunGold: gold - hg };
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

/**
 * Salvage price for a wreck: SALVAGE_COST_FRAC of the hull cost, plus the
 * guns re-cast (full gun repair gold + SALVAGE_WOOD_PER_GUN_TIER wood).
 * → {wood, gold, sec, hull:{wood,gold}, guns:{wood,gold}}
 */
export function salvageQuote(ship) {
  const h = hullOf(ship);
  const hull = { wood: Math.ceil(h.cost.wood * SALVAGE_COST_FRAC), gold: Math.ceil(h.cost.gold * SALVAGE_COST_FRAC) };
  const guns = {
    wood: mountedGuns(ship).reduce((a, cn) => a + (SALVAGE_WOOD_PER_GUN_TIER[cn.tier || 1] || 0), 0),
    gold: gunRepairGoldFull(ship),
  };
  return { wood: hull.wood + guns.wood, gold: hull.gold + guns.gold, sec: SALVAGE_SEC[h.hull], hull, guns };
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
