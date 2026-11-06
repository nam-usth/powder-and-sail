// ── FLEET DOCTRINE resolver (design/gdd/campaign-meta.md §Fleet doctrines) ──
// Pure JS: no DOM, no Three.js. Turns a doctrine (data/doctrines.js) into a
// legal cannon fit for one hull, applies doctrines to roster ships, and reads
// a mission's enemies/objective to suggest doctrines for the briefing.

import { DOCTRINE_BY_ID, DOCTRINE_KEEP, DOCTRINE_HINT } from '../data/doctrines.js';
import { CANNON_BY_ID, canMountCannon, fallbackCannon } from '../data/cannons.js';
import { HULL_SLOTS } from '../data/ships.js';
import { HULLS } from '../data/harbor.js';
import { resolveHull } from './Campaign.js';

/** Is `id` a real doctrine (not "keep", not unknown)? */
export const isDoctrine = id => !!id && id !== DOCTRINE_KEEP && DOCTRINE_BY_ID.has(id);

/**
 * Resolve a doctrine for one hull, with a report of slots that fell back.
 * @param {string} doctrineId
 * @param {{hull:string, tier?:number}} hull combat class + hull tier (I..V)
 * @param {Set|string[]|null} known researched tech ids; null = unrestricted
 * @returns {{loadout:object, fallbacks:{slot:string, want:string, got:string}[]}|null}
 *   null for an unknown doctrine. `want` = the doctrine's tier-allowed favourite
 *   that is not researched yet; `got` = the gun that went in instead.
 */
export function fitDoctrineReport(doctrineId, hull, known = null) {
  const d = DOCTRINE_BY_ID.get(doctrineId);
  if (!d || !hull) return null;
  const cls = HULL_SLOTS[hull.hull] ? hull.hull : 'light';
  const shipLike = { hullTier: hull.tier || 1 };
  const tierOk = id => canMountCannon(CANNON_BY_ID.get(id), shipLike);
  const ok = id => canMountCannon(CANNON_BY_ID.get(id), shipLike, known);
  const loadout = {}, fallbacks = [];
  for (const slot of HULL_SLOTS[cls]) {
    const prefs = (d.byHull?.[cls]?.[slot]) || d.slots[slot] || d.slots.L || [];
    const want = prefs.find(tierOk) || null;
    // first researched favourite; else walk the research line down from the
    // tier-allowed favourite (data/cannons.js fallbackCannon → ends on tier I)
    const got = prefs.find(ok) || fallbackCannon(want || prefs[prefs.length - 1] || 'swivel', ok);
    loadout[slot] = got;
    if (want && got !== want) fallbacks.push({ slot, want, got });
  }
  return { loadout, fallbacks };
}

/**
 * Best KNOWN gun allowed by tier for each slot of this hull.
 * @returns {object|null} loadout {L,R,(B),(S)} or null for an unknown doctrine
 */
export function fitDoctrine(doctrineId, hull, known = null) {
  return fitDoctrineReport(doctrineId, hull, known)?.loadout || null;
}

/** {hull, tier} of a roster ship record. */
export const rosterHull = rs => { const h = HULLS[rs?.hullId] || HULLS.sloop; return { hull: h.hull, tier: h.tier }; };

/**
 * Apply one doctrine to roster ships (all, or the listed uids) in a profile.
 * Remembers the choice on the ship (`rs.doctrine`).
 * @returns {{ships:number, fallbacks:object[]}} fallbacks carry {uid, slot, want, got}
 */
export function applyDoctrineToRoster(profile, doctrineId, uids = null) {
  const out = { ships: 0, fallbacks: [] };
  if (!isDoctrine(doctrineId) || !profile?.fleet) return out;
  const known = profile.harbor?.researched || [];
  const want = uids ? new Set(uids) : null;
  for (const rs of profile.fleet) {
    if (want && !want.has(rs.uid)) continue;
    if (rs.status === 'wreck') continue;
    const r = fitDoctrineReport(doctrineId, rosterHull(rs), known);
    if (!r) continue;
    rs.loadout = r.loadout;
    rs.doctrine = doctrineId;
    out.ships++;
    r.fallbacks.forEach(f => out.fallbacks.push({ uid: rs.uid, ...f }));
  }
  return out;
}

/**
 * Set Sail: apply each ship's chosen doctrine ({uid: doctrineId}) to the
 * roster. "keep" (or '') leaves the guns and clears the remembered doctrine;
 * an unknown id changes nothing; ships not listed are untouched.
 * @returns {{ships:number, fallbacks:object[]}}
 */
export function applySailDoctrines(profile, doctrines) {
  const out = { ships: 0, fallbacks: [] };
  if (!doctrines || !profile?.fleet) return out;
  for (const [uid, id] of Object.entries(doctrines)) {
    const rs = profile.fleet.find(s => s.uid === uid);
    if (!rs) continue;
    if (!id || id === DOCTRINE_KEEP) { delete rs.doctrine; continue; }
    if (!isDoctrine(id)) continue;
    const r = applyDoctrineToRoster(profile, id, [uid]);
    out.ships += r.ships; out.fallbacks.push(...r.fallbacks);
  }
  return out;
}

/**
 * Group fallbacks for a summary line: most common (want → got) first.
 * @returns {{n:number, want:string, got:string}[]}
 */
export function groupFallbacks(fallbacks = []) {
  const m = new Map();
  for (const f of fallbacks) {
    const k = f.want + '>' + f.got;
    const g = m.get(k) || { n: 0, want: f.want, got: f.got };
    g.n++; m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

/** Every enemy ship of a mission (fixed enemies + survive waves). */
function missionFoes(m) {
  const foes = [...(m?.enemies || [])];
  for (const w of m?.objective?.waves || []) foes.push(...(w.ships || []));
  return foes;
}

/**
 * Briefing hint: doctrines that suit a mission, read from its data alone.
 * Reasons: 'forts' (enemy forts / fort objective), 'prize' (sink_target chase),
 * 'heavy' (heavy hulls present, n = count), 'light' (mostly light hulls),
 * 'line' (fallback: a general fleet action).
 * @returns {{id:string, why:string, n?:number}[]}
 */
export function suggestDoctrines(m) {
  if (!m) return [];
  const out = [], add = (id, why, n) => { if (!out.some(x => x.id === id)) out.push(n != null ? { id, why, n } : { id, why }); };
  const type = m.objective?.type || 'sink_all';
  const forts = (m.islands || []).filter(i => i.own === 'enemy').length;
  if (type === 'destroy_forts' || forts) add('siege', 'forts', forts || 1);
  if (type === 'sink_target') { add('crippler', 'prize'); add('longrange', 'prize'); }
  const foes = missionFoes(m).map(e => resolveHull(e.hull));
  const heavy = foes.filter(h => h.hull === 'heavy').length;
  const light = foes.filter(h => h.hull === 'light').length;
  if (heavy >= DOCTRINE_HINT.heavyMin) add('antiheavy', 'heavy', heavy);
  if (foes.length && light / foes.length >= DOCTRINE_HINT.lightShare) add('antilight', 'light', light);
  if (!out.length) add('broadside', 'line');
  return out.slice(0, DOCTRINE_HINT.maxHints);
}
