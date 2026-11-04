// ── VFX quality budgets (GFX HIGH / LOW) ───────────────────────────
// Two fixed budgets, modelled on "Defense of the Dominion" (see
// design/art-reference/README.md): HIGH draws the full battle — lingering
// broadside smoke banks, soft water contact, floating wreckage — while LOW
// halves every particle budget, shortens lingering smoke and drops the purely
// atmospheric extras. Hit feedback (flash, splinters, splash column, damage
// numbers) stays readable on both tiers.
//
// Pools are allocated ONCE at HIGH capacity; LOW simply runs each ring
// buffer over the first half of it (and draws only that half). Switching tier
// at runtime therefore never reallocates GPU buffers or recompiles shaders.
//
// API
//   setVfxQuality('high' | 'low')   — global; applies to every live VFX
//   getVfxQuality()                 — current tier name
//   vfxBudget()                     — the active budget table (read-only)
//   onVfxQualityChange(fn) → unsub  — subscription used by VFX instances
//
// Init + live sync: follows the renderer's shared tier (Render/GfxQuality.js
// `gfx.level`, 'change' event) automatically; `window._gfxQuality` is honoured
// at load when set. setVfxQuality() can still override at any time.
import { gfx } from '../../Render/GfxQuality.js';

/** @typedef {{
 *   name:string, poolFrac:number, emit:number, smokeLife:number,
 *   lingerSmoke:boolean, softParticles:boolean, debrisFloat:boolean,
 *   trails:boolean, damageSmoke:boolean, maxPointPx:number, ripple:number
 * }} VfxBudget */

/** @type {Record<'high'|'low', VfxBudget>} */
export const VFX_BUDGETS = Object.freeze({
  high: Object.freeze({
    name: 'high',
    poolFrac:      1.0,   // fraction of each ring buffer in use
    emit:          1.0,   // multiplier on every spawn count
    smokeLife:     1.0,   // multiplier on lingering-smoke lifetimes
    lingerSmoke:   true,  // broadside smoke banks hang and drift
    softParticles: true,  // water-contact + near-camera soft fades
    debrisFloat:   true,  // planks/barrels float and drift after a sinking
    trails:        true,  // cannonball smoke trails
    damageSmoke:   true,  // light-damage smoke wisps (fires always show)
    maxPointPx:    420,   // clamp for point-sprite size (fill-rate guard)
    ripple:        1.0,   // broadside ripple: guns flashing per volley
  }),
  low: Object.freeze({
    name: 'low',
    poolFrac:      0.5,
    emit:          0.5,
    smokeLife:     0.45,
    lingerSmoke:   false,
    softParticles: false,
    debrisFloat:   false,
    trails:        false,
    damageSmoke:   false,
    maxPointPx:    260,
    ripple:        0.5,
  }),
});

let _current = VFX_BUDGETS[gfx?.level === 'low' ? 'low' : 'high'];
const _subs = new Set();

try {
  const q = typeof window !== 'undefined' ? window._gfxQuality : null;
  if (q === 'low' || q === 'high') _current = VFX_BUDGETS[q];
} catch { /* non-browser */ }
gfx?.on?.('change.vfxBudget', () => setVfxQuality(gfx.level));

/**
 * Switch every VFX pool to the given budget tier.
 * @param {'high'|'low'} q
 * @returns {'high'|'low'} the tier now active
 */
export function setVfxQuality(q) {
  const next = VFX_BUDGETS[q === 'low' ? 'low' : 'high'];
  if (next === _current) return _current.name;
  _current = next;
  _subs.forEach(fn => { try { fn(_current); } catch (e) { console.warn('[VFX] quality listener', e); } });
  return _current.name;
}

/** @returns {'high'|'low'} */
export function getVfxQuality() { return _current.name; }

/** @returns {VfxBudget} the active budget table */
export function vfxBudget() { return _current; }

/**
 * Subscribe to tier changes. Returns an unsubscribe function.
 * @param {(b:VfxBudget)=>void} fn
 */
export function onVfxQualityChange(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

/** Scale an integer spawn count by the active budget (never below `min`). */
export function budgetCount(n, min = 1) {
  return Math.max(min, Math.round(n * _current.emit));
}
