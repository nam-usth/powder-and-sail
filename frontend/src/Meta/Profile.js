import { CANNON_BY_ID, canMountCannon, cannonTechId, fallbackCannon } from '../data/cannons.js';
import { techWithPrereqs } from '../data/upgrades.js';
import { normalizeFitProfiles } from './FitProfiles.js';
// ── PROFILE — persistent player save (design/gdd/campaign-meta.md) ──
// Pure JS: no DOM, no Three.js. Storage is injected so tests run in Node.

import {
  PROFILE_KEY, PROFILE_VERSION, START_RES, STARTER_FLEET, STARTER_BUILDINGS,
  HULLS, SHIP_NAMES, DEFAULT_LOADOUT,
} from '../data/harbor.js';

/**
 * Wrap a Web-Storage-like backend (getItem/setItem) — or nothing — into a
 * tolerant JSON store. Missing/blocked storage degrades to memory.
 * @param {Storage|{getItem:Function,setItem:Function}|null} backend
 */
export function makeStore(backend) {
  const mem = new Map();
  let ok = !!backend;
  return {
    get persistent() { return ok; },
    getRaw(k) {
      if (ok) { try { return backend.getItem(k); } catch { ok = false; } }
      return mem.has(k) ? mem.get(k) : null;
    },
    setRaw(k, v) {
      if (ok) { try { backend.setItem(k, v); return true; } catch { ok = false; } }
      mem.set(k, v); return false;
    },
  };
}

let _uidN = 0;
/** Short unique id (deterministic counter + time; no crypto needed). */
export function uid(prefix = 's', now = Date.now()) {
  _uidN = (_uidN + 1) % 1e6;
  return `${prefix}_${now.toString(36)}${_uidN.toString(36)}`;
}

/**
 * Default cannon fit for a fresh hull: data/harbor.js DEFAULT_LOADOUT by
 * combat class and hull tier (the best entry at or below `tier`), so every
 * fit respects the cannon-tier rule (data/cannons.js canMountCannon) and a
 * new tier-N hull arrives with tier-N guns. Every fit has a range-20 gun on
 * each broadside (reaches a fort from outside its shore line).
 * Rationale: design/balance/report.md §Default loadout.
 * @param {string} hullClass 'light'|'standard'|'heavy'
 * @param {number} [tier=1] hull tier I..V
 * @param {Set|string[]|null} [known] researched tech ids (harbor/battle); null =
 *   unrestricted (tools, Open War). Unresearched guns fall back along their
 *   research line (data/cannons.js fallbackCannon) to a known gun.
 */
export function defaultLoadout(hullClass, tier = 1, known = null) {
  const byTier = DEFAULT_LOADOUT[hullClass] || DEFAULT_LOADOUT.light;
  let fit = null;
  for (let t = tier; t >= 1 && !fit; t--) if (byTier[t]) fit = { ...byTier[t] };
  if (!fit) fit = { ...byTier[Math.min(...Object.keys(byTier).map(Number))] };
  if (known == null) return fit;
  // Cannon research (harbor/battle): an unresearched gun falls back along its line.
  const ok = id => canMountCannon(CANNON_BY_ID.get(id), { hullTier: tier }, known);
  for (const sl of Object.keys(fit)) if (fit[sl] && !ok(fit[sl])) fit[sl] = fallbackCannon(fit[sl], ok);
  return fit;
}

/**
 * Create a roster ship record.
 * @param {string} hullId key of HULLS
 * @param {object} [o] overrides (nm, status, readyAt, hpFrac, loadout,
 *   known = researched tech ids for the default fit; omitted = unrestricted)
 */
export function makeRosterShip(hullId, o = {}, now = Date.now()) {
  const h = HULLS[hullId] || HULLS.sloop;
  return {
    uid: o.uid || uid('s', now),
    hullId: h.id,
    nm: o.nm || h.nm,
    hpFrac: o.hpFrac ?? 1,
    status: o.status || 'ready',       // ready | building | repairing | wreck
    readyAt: o.readyAt || 0,           // epoch ms when building/repairing finishes
    loadout: o.loadout || defaultLoadout(h.hull, h.tier, o.known ?? null),
    upgrades: o.upgrades || { spd: 0, hp: 0, rof: 0 },
    battles: 0, sinks: 0,
  };
}

/** Pick a ship name not yet used in the roster. */
export function pickShipName(profile, hullId) {
  const used = new Set(profile.fleet.map(s => s.nm));
  const free = SHIP_NAMES.filter(n => !used.has(n));
  if (free.length) return free[(profile.fleet.length * 7) % free.length];
  return `${HULLS[hullId]?.nm || 'Ship'} ${profile.fleet.length + 1}`;
}

/** A brand-new profile. */
export function newProfile(now = Date.now()) {
  const p = {
    v: PROFILE_VERSION,
    createdAt: now,
    lastSeen: now,
    res: { ...START_RES },
    renown: 0,
    harbor: {
      buildings: STARTER_BUILDINGS.map(b => ({ buildingId: b.buildingId, gridKey: b.gridKey, level: 1, state: 'active' })),
      researched: [],
      fresh: true,                     // HarborSession places starters on first boot
    },
    fleet: [],
    campaign: { won: {}, stars: {}, attempts: {}, patrolsWon: 0 },
    battle: null,                      // pending battle {missionId, shipUids, startedAt, snapshot}
    lastResult: null,                  // last battle result for the harbor report
    stats: { battles: 0, wins: 0, sinks: 0, shipsLost: 0 },
    settings: {},
    fitProfiles: normalizeFitProfiles(null),   // 2 saved whole-fleet cannon fits (Meta/FitProfiles)
  };
  STARTER_FLEET.forEach(hid => {
    const s = makeRosterShip(hid, { known: p.harbor.researched }, now);   // tier-I guns only
    s.nm = pickShipName(p, hid);
    p.fleet.push(s);
  });
  return p;
}

/**
 * Replace cannons a hull may not carry: above its tier (saves from before
 * cannon tiers) or not researched. Falls back along the gun's research line.
 */
function legalizeLoadout(s, known) {
  const h = HULLS[s.hullId]; if (!h || !s.loadout) return;
  const ok = id => canMountCannon(CANNON_BY_ID.get(id), { hullTier: h.tier }, known);
  const def = defaultLoadout(h.hull, h.tier, known);
  for (const sl of Object.keys(s.loadout)) {
    const id = s.loadout[sl];
    if (id && !ok(id)) s.loadout[sl] = (CANNON_BY_ID.has(id) && fallbackCannon(id, ok)) || def[sl] || null;
  }
}

/**
 * Saves from before cannon research (v < 2): grant the Gunnery tech (and its
 * prerequisites) of every gun already mounted on a roster ship within its
 * hull tier, so nobody loses equipment. Returns the tech ids added.
 */
export function grantMountedGunResearch(rawFleet, researched) {
  const added = [];
  for (const s of rawFleet || []) {
    const h = HULLS[s?.hullId]; if (!h || !s.loadout || typeof s.loadout !== 'object') continue;
    for (const id of Object.values(s.loadout)) {
      const cn = CANNON_BY_ID.get(id), t = cannonTechId(id);
      if (!cn || !t || !canMountCannon(cn, { hullTier: h.tier })) continue;
      for (const r of techWithPrereqs(t)) if (!researched.includes(r)) { researched.push(r); added.push(r); }
    }
  }
  return added;
}

/** Fill fields missing from older/partial saves. Never throws. */
export function migrate(raw, now = Date.now()) {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...raw };
  p.v = PROFILE_VERSION;
  p.res = { ...base.res, ...(raw.res || {}) };
  p.harbor = { ...base.harbor, fresh: false, ...(raw.harbor || {}) };
  if (!Array.isArray(p.harbor.buildings)) p.harbor.buildings = [];
  if (!Array.isArray(p.harbor.researched)) p.harbor.researched = [];
  p.campaign = { ...base.campaign, ...(raw.campaign || {}) };
  p.stats = { ...base.stats, ...(raw.stats || {}) };
  p.fleet = Array.isArray(raw.fleet) && raw.fleet.length
    ? raw.fleet.filter(s => s && HULLS[s.hullId] && !HULLS[s.hullId].enemyOnly).map(s => ({ ...makeRosterShip(s.hullId, {}, now), ...s }))
    : base.fleet;
  if (!p.fleet.length) p.fleet = base.fleet;
  p.harbor.researched = p.harbor.researched.filter(id => typeof id === 'string');
  if (!(Number(raw.v) >= 2)) grantMountedGunResearch(raw.fleet, p.harbor.researched);
  p.fleet.forEach(s => legalizeLoadout(s, p.harbor.researched));
  p.fitProfiles = normalizeFitProfiles(raw.fitProfiles);   // older saves: two empty slots
  if (typeof p.lastSeen !== 'number' || !isFinite(p.lastSeen)) p.lastSeen = now;
  // QA-010: coerce numeric fields (a string renown made `renown += n` concatenate)
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  p.renown = Math.max(0, num(p.renown));
  p.res.wood = Math.max(0, num(p.res.wood, base.res.wood));
  p.res.gold = Math.max(0, num(p.res.gold, base.res.gold));
  for (const k of Object.keys(base.stats)) p.stats[k] = Math.max(0, num(p.stats[k]));
  p.campaign.patrolsWon = Math.max(0, num(p.campaign.patrolsWon));
  p.fleet.forEach(s => {
    s.hpFrac = Math.min(1, Math.max(0, num(s.hpFrac, 1)));
    s.readyAt = num(s.readyAt); s.battles = num(s.battles); s.sinks = num(s.sinks);
  });
  p.harbor.buildings.forEach(b => { b.level = Math.min(10, Math.max(1, Math.round(num(b.level, 1)))); });
  return p;
}

/** Load (or create) the profile. Corrupt saves are backed up, not lost. */
export function loadProfile(store, now = Date.now()) {
  const raw = store.getRaw(PROFILE_KEY);
  if (!raw) return newProfile(now);
  try {
    return migrate(JSON.parse(raw), now);
  } catch {
    store.setRaw(PROFILE_KEY + '_bad', raw);
    return newProfile(now);
  }
}

/** Persist the profile (stamps lastSeen). */
export function saveProfile(store, profile, now = Date.now()) {
  profile.lastSeen = now;
  return store.setRaw(PROFILE_KEY, JSON.stringify(profile));
}
