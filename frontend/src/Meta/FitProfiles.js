// ── FLEET FIT PROFILES (design/gdd/campaign-meta.md §Detailed Rules 4d) ──
// Pure JS: no DOM, no Three.js. A fit profile is a named snapshot of the
// cannon loadout of every roster ship (profile.fitProfiles[slot].fits[uid]).
// Loading one re-validates every gun against the hull's tier and the current
// research (a hull could have been scrapped/rebuilt, research reset, a slot set
// changed) and falls back along the research line like doctrines do.

import { FIT_PROFILE_SLOTS, FIT_PROFILE_NAME_MAX, FIT_PROFILE_DEFAULT_NAMES, HULLS } from '../data/harbor.js';
import { CANNON_BY_ID, canMountCannon, fallbackCannon } from '../data/cannons.js';
import { HULL_SLOTS } from '../data/ships.js';

/** Prefix of a pre-sail choice that loads a fit profile ('fit:0', 'fit:1'). */
export const FIT_CHOICE = 'fit:';
/** 'fit:N' → N, or -1 when the value is not a fit-profile choice. */
export function fitChoiceSlot(v) {
  if (typeof v !== 'string' || !v.startsWith(FIT_CHOICE)) return -1;
  const n = Number(v.slice(FIT_CHOICE.length));
  return Number.isInteger(n) && n >= 0 && n < FIT_PROFILE_SLOTS ? n : -1;
}

/** Default name of a slot ("Profile I"). */
export const defaultFitName = slot => FIT_PROFILE_DEFAULT_NAMES[slot] || `Profile ${slot + 1}`;

/** An empty slot. */
export const emptyFitProfile = slot => ({ name: defaultFitName(slot), savedAt: 0, fits: {} });

/** Clean a player-typed name: trimmed, control chars removed, ≤ 20 chars. */
export function cleanFitName(name, slot = 0) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, FIT_PROFILE_NAME_MAX);
  return s || defaultFitName(slot);
}

/**
 * Coerce whatever a save holds into exactly FIT_PROFILE_SLOTS well-formed slots
 * (Profile.migrate). Fits keep only string/null gun ids.
 */
export function normalizeFitProfiles(raw) {
  const out = [];
  for (let i = 0; i < FIT_PROFILE_SLOTS; i++) {
    const r = Array.isArray(raw) ? raw[i] : null;
    const fp = emptyFitProfile(i);
    if (r && typeof r === 'object') {
      fp.name = cleanFitName(r.name, i);
      fp.savedAt = Number.isFinite(Number(r.savedAt)) ? Number(r.savedAt) : 0;
      for (const [uid, lo] of Object.entries(r.fits && typeof r.fits === 'object' ? r.fits : {})) {
        if (!lo || typeof lo !== 'object') continue;
        const clean = {};
        for (const [sl, id] of Object.entries(lo)) if (id === null || typeof id === 'string') clean[sl] = id;
        fp.fits[uid] = clean;
      }
      if (r.doctrineOf && typeof r.doctrineOf === 'object') {
        fp.doctrineOf = {};
        for (const [uid, id] of Object.entries(r.doctrineOf)) if (typeof id === 'string') fp.doctrineOf[uid] = id;
      }
    }
    out.push(fp);
  }
  return out;
}

/** The profile's slots, creating them if missing. */
export function fitProfilesOf(profile) {
  if (!Array.isArray(profile.fitProfiles) || profile.fitProfiles.length !== FIT_PROFILE_SLOTS) {
    profile.fitProfiles = normalizeFitProfiles(profile.fitProfiles);
  }
  return profile.fitProfiles;
}

/** Number of ships with a saved fit in a slot (0 = empty slot). */
export const fitProfileSize = (profile, slot) => Object.keys(profile?.fitProfiles?.[slot]?.fits || {}).length;
/** Does the slot hold a fit for this ship? */
export const fitProfileHas = (profile, slot, uid) => !!profile?.fitProfiles?.[slot]?.fits?.[uid];

/** Rename a slot (≤ 20 chars; blank → default name). @returns the stored name */
export function renameFitProfile(profile, slot, name) {
  const fp = fitProfilesOf(profile)[slot];
  if (!fp) return null;
  fp.name = cleanFitName(name, slot);
  return fp.name;
}

/**
 * Snapshot current roster loadouts into a slot: every non-wreck ship, or only
 * `shipUids`. A full save replaces the slot's fits; a subset save merges.
 * @returns {number} ships saved (-1 for a bad slot)
 */
export function saveFitProfile(profile, slot, shipUids = null, now = Date.now()) {
  const fp = fitProfilesOf(profile)[slot];
  if (!fp) return -1;
  const want = shipUids ? new Set(shipUids) : null;
  if (!want) { fp.fits = {}; delete fp.doctrineOf; }
  let n = 0;
  for (const rs of profile.fleet || []) {
    if (rs.status === 'wreck' || !rs.loadout) continue;
    if (want && !want.has(rs.uid)) continue;
    fp.fits[rs.uid] = { ...rs.loadout };
    if (rs.doctrine) (fp.doctrineOf ||= {})[rs.uid] = rs.doctrine;
    else if (fp.doctrineOf) delete fp.doctrineOf[rs.uid];
    n++;
  }
  fp.savedAt = now;
  return n;
}

/**
 * Re-validate one saved fit for a roster ship's CURRENT hull: slots the hull
 * no longer has are dropped, slots the fit lacks keep the current gun, and
 * every gun must pass canMountCannon (hull tier + research) or falls back along
 * its research line (data/cannons.js fallbackCannon).
 * @returns {{loadout:object, fellBack:{slot:string, want:string, got:string}[]}}
 */
export function legalFit(saved, rs, known = null) {
  const h = HULLS[rs.hullId] || HULLS.sloop;
  const ok = id => canMountCannon(CANNON_BY_ID.get(id), { hullTier: h.tier }, known);
  const loadout = {}, fellBack = [];
  for (const sl of HULL_SLOTS[h.hull] || HULL_SLOTS.light) {
    const id = sl in saved ? saved[sl] : (rs.loadout?.[sl] ?? null);
    if (id == null) { loadout[sl] = null; continue; }
    if (ok(id)) { loadout[sl] = id; continue; }
    const got = fallbackCannon(CANNON_BY_ID.has(id) ? id : 'swivel', ok);
    loadout[sl] = got;
    fellBack.push({ slot: sl, want: id, got });
  }
  return { loadout, fellBack };
}

/**
 * Load a slot onto the roster (all ships, or only `shipUids`). Ships with a
 * saved fit are refit (re-validated, see legalFit); ships without one keep
 * their guns and are reported as skipped; wrecks are ignored.
 * A changed ship loses its doctrine label unless the profile recorded one and
 * nothing fell back (then the label is restored).
 * @param {Set|string[]|null} [knownSet] researched tech ids; default = profile.harbor.researched
 * @returns {{changed:string[], skipped:string[], fellBack:{uid,slot,want,got}[], loaded:number}}
 *   loaded = ships that had a fit (changed or already matching)
 */
export function applyFitProfile(profile, slot, shipUids = null, knownSet = undefined) {
  const out = { changed: [], skipped: [], fellBack: [], loaded: 0 };
  const fp = profile?.fitProfiles?.[slot];
  if (!fp) return out;
  const known = knownSet === undefined ? (profile.harbor?.researched || []) : knownSet;
  const want = shipUids ? new Set(shipUids) : null;
  for (const rs of profile.fleet || []) {
    if (want && !want.has(rs.uid)) continue;
    if (rs.status === 'wreck') continue;
    const saved = fp.fits?.[rs.uid];
    if (!saved) { out.skipped.push(rs.uid); continue; }
    out.loaded++;
    const r = legalFit(saved, rs, known);
    r.fellBack.forEach(f => out.fellBack.push({ uid: rs.uid, ...f }));
    const doc = !r.fellBack.length && fp.doctrineOf?.[rs.uid];
    if (JSON.stringify(r.loadout) === JSON.stringify(rs.loadout || {}) && (rs.doctrine || null) === (doc || null)) continue;
    rs.loadout = r.loadout;
    if (doc) rs.doctrine = doc; else delete rs.doctrine;
    out.changed.push(rs.uid);
  }
  return out;
}

/**
 * Set Sail: apply the 'fit:N' choices of {uid: choice} (ships listed with
 * any other value are left for Meta/Doctrine.applySailDoctrines). The choice
 * is remembered on the ship (`rs.sailFit`) so the briefing offers it again;
 * a non-fit choice clears it.
 * @returns {{changed:string[], skipped:string[], fellBack:object[], rest:object}}
 *   rest = the non-fit choices
 */
export function applySailFits(profile, choices) {
  const out = { changed: [], skipped: [], fellBack: [], rest: {} };
  if (!choices || !profile?.fleet) return out;
  for (const [uid, v] of Object.entries(choices)) {
    const rs = profile.fleet.find(s => s.uid === uid);
    if (!rs) continue;
    const slot = fitChoiceSlot(v);
    if (slot < 0) { delete rs.sailFit; out.rest[uid] = v; continue; }
    rs.sailFit = v;
    const r = applyFitProfile(profile, slot, [uid]);
    out.changed.push(...r.changed); out.skipped.push(...r.skipped); out.fellBack.push(...r.fellBack);
  }
  return out;
}
