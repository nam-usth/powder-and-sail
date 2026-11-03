// ── HARBOR ECONOMY — offline progress (design/gdd/harbor.md §Formulas) ──
// Pure JS. Live production while the harbor is open is EconomySystem's job;
// this module only answers "what happened while the game was closed".

import { BUILDINGS } from '../data/buildings.js';
import { WOOD_CAP, GOLD_CAP, WOOD_RATE, GOLD_RATE } from '../data/constants.js';
import { OFFLINE_MAX_SEC } from '../data/harbor.js';

const BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));

/** Seconds elapsed since lastSeen, clamped to [0, OFFLINE_MAX_SEC]. */
export function offlineSeconds(profile, now = Date.now()) {
  const s = (now - (profile.lastSeen || now)) / 1000;
  if (!isFinite(s) || s <= 0) return 0;
  return Math.min(OFFLINE_MAX_SEC, s);
}

/** Is a saved building producing (built, not destroyed/moving)? */
const isReady = b => !b.state || b.state === 'active';

/** Storage caps from ready warehouses (same rule as BuildSystem.recalcWarehouse). */
export function harborCaps(buildings) {
  const wh = BY_ID.warehouse;
  let bonus = 0;
  for (const b of buildings) {
    if (b.buildingId !== 'warehouse' || !isReady(b)) continue;
    bonus += wh.capacityByLevel[(b.level || 1) - 1] || 0;
  }
  return { wood: WOOD_CAP + bonus, gold: GOLD_CAP + bonus };
}

/** Wood/gold per second from base income + ready producers (no adjacency/traits). */
export function harborRates(buildings) {
  let wood = WOOD_RATE, gold = GOLD_RATE;
  for (const b of buildings) {
    if (!isReady(b)) continue;
    const def = BY_ID[b.buildingId];
    if (!def?.productionByLevel) continue;
    const p = def.productionByLevel[(b.level || 1) - 1] || 0;
    if (b.buildingId === 'lumber_mill') wood += p;
    else if (b.buildingId === 'gold_mine') gold += p;
  }
  return { wood, gold };
}

/**
 * Apply offline progress to the profile in place.
 * - resources grow by rate × elapsed, clamped to caps (never reduced if over cap)
 * - building/upgrade timers (stored as remaining seconds) advance by elapsed;
 *   buildings that finish produce only for the remainder (conservative: we
 *   simply let them finish without retro-production).
 * @returns {{seconds:number, wood:number, gold:number, finished:string[]}}
 */
export function applyOffline(profile, now = Date.now()) {
  const seconds = offlineSeconds(profile, now);
  const report = { seconds, wood: 0, gold: 0, finished: [] };
  if (seconds <= 0) return report;
  const blds = profile.harbor.buildings;
  const rates = harborRates(blds);
  const caps  = harborCaps(blds);
  const res   = profile.res;
  const add = (k, amt) => {
    if (res[k] >= caps[k]) return 0;
    const v = Math.min(caps[k] - res[k], amt);
    res[k] += v; return v;
  };
  report.wood = add('wood', rates.wood * seconds);
  report.gold = add('gold', rates.gold * seconds);

  for (const b of blds) {
    if (b.state === 'building' && b.buildTimer > 0) {
      b.buildTimer = Math.max(0.01, b.buildTimer - seconds);
      if (b.buildTimer <= 0.01) report.finished.push(b.buildingId);
    }
    if (b.upgradeTimer > 0) {
      b.upgradeTimer = Math.max(0.01, b.upgradeTimer - seconds);
      if (b.upgradeTimer <= 0.01) report.finished.push(b.buildingId);
    }
  }
  return report;
}
