// ── FORMATIONS (AU) ─────────────────────────────────────────────
// Pure slot math for group orders. Slots live in a local frame centred on
// the formation anchor: +z = forward (direction of travel), +x = starboard.
// World conversion uses the game heading convention: forward = (sin h, cos h),
// starboard = (cos h, -sin h).

import { FORMATIONS } from '../../../data/commands.js';

/** Local slot offsets for `n` ships, centred on the formation anchor. */
export function formationSlots(type, n) {
  const sp = (FORMATIONS[type] || FORMATIONS.column).spacing;
  const slots = [];
  if (type === 'line') {
    for (let i = 0; i < n; i++) slots.push({ x: (i - (n - 1) / 2) * sp, z: 0 });
  } else if (type === 'wedge') {
    // 0 at the point, then alternating starboard/port pairs stepping back
    for (let i = 0; i < n; i++) {
      const rank = Math.ceil(i / 2);
      const side = i === 0 ? 0 : (i % 2 ? 1 : -1);
      slots.push({ x: side * rank * sp, z: -rank * sp });
    }
    const depth = Math.ceil((n - 1) / 2) * sp;           // re-centre front-to-back
    slots.forEach(s => { s.z += depth / 2; });
  } else {
    for (let i = 0; i < n; i++) slots.push({ x: 0, z: ((n - 1) / 2 - i) * sp });
  }
  return slots;
}

/** Half of the formation's lateral width (used to widen path clearance). */
export function formationHalfWidth(slots) {
  return slots.reduce((m, s) => Math.max(m, Math.abs(s.x)), 0);
}

export function slotToWorld(ax, az, heading, slot) {
  const s = Math.sin(heading), c = Math.cos(heading);
  return { x: ax + s * slot.z + c * slot.x, z: az + c * slot.z - s * slot.x };
}

/**
 * Assign ships to slots so that nobody crosses the formation to reach a slot:
 * all (ship, slot) pairs are sorted by distance and taken greedily.
 * Returns a Map ship → slot.
 */
export function assignSlots(ships, slots, ax, az, heading) {
  const world = slots.map(sl => slotToWorld(ax, az, heading, sl));
  const pairs = [];
  ships.forEach((sh, i) => world.forEach((w, j) => {
    pairs.push({ i, j, d: (sh.x - w.x) ** 2 + (sh.z - w.z) ** 2 });
  }));
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const usedShip = new Set(), usedSlot = new Set(), out = new Map();
  for (const p of pairs) {
    if (usedShip.has(p.i) || usedSlot.has(p.j)) continue;
    usedShip.add(p.i); usedSlot.add(p.j);
    out.set(ships[p.i], slots[p.j]);
  }
  return out;
}
