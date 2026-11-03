// ── PROFILE — persistent player save (design/gdd/campaign-meta.md) ──
// Pure JS: no DOM, no Three.js. Storage is injected so tests run in Node.

import {
  PROFILE_KEY, PROFILE_VERSION, START_RES, STARTER_FLEET, STARTER_BUILDINGS,
  HULLS, SHIP_NAMES,
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

/** Default cannon fit for a fresh hull of the given class. */
export function defaultLoadout(hullClass) {
  if (hullClass === 'heavy')    return { L: 'carronade', R: 'carronade', B: 'swivel', S: 'swivel' };
  if (hullClass === 'standard') return { L: 'carronade', R: 'carronade', B: 'swivel' };
  return { L: 'swivel', R: 'carronade' };
}

/**
 * Create a roster ship record.
 * @param {string} hullId key of HULLS
 * @param {object} [o] overrides (nm, status, readyAt, hpFrac, loadout)
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
    loadout: o.loadout || defaultLoadout(h.hull),
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
  };
  STARTER_FLEET.forEach(hid => {
    const s = makeRosterShip(hid, {}, now);
    s.nm = pickShipName(p, hid);
    p.fleet.push(s);
  });
  return p;
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
    ? raw.fleet.filter(s => s && HULLS[s.hullId]).map(s => ({ ...makeRosterShip(s.hullId, {}, now), ...s }))
    : base.fleet;
  if (!p.fleet.length) p.fleet = base.fleet;
  if (typeof p.lastSeen !== 'number' || !isFinite(p.lastSeen)) p.lastSeen = now;
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
