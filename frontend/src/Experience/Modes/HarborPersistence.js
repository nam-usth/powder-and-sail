// ── HARBOR PERSISTENCE — buildings ⇄ profile (AW-S04) ─────────────
// Save format (profile.harbor.buildings[]):
//   { buildingId, gridKey, level, rotated, footprint, facingDeg, state,
//     buildTimer, buildDuration, upgradeTimer, upgradeDuration, pendingLevel, hp }
// Timers are remaining seconds; HarborEconomy.applyOffline advances them.

import { BUILDINGS, createBuildingInstance } from '../../data/buildings.js';
import { DEFENSES, getDefenseStats }        from '../../data/defenses.js';

const ALL = [...BUILDINGS, ...DEFENSES];
const defOf = id => ALL.find(d => d.id === id);

/** Snapshot every live building on an island into plain JSON. */
export function serializeBuildings(state, isl) {
  const list = state.islandBuildings[isl.def.id] || [];
  return list
    .filter(i => i.state !== 'destroyed')
    .map(i => {
      // a building being moved is saved where it came from
      const src = i.state === 'moving' && i.source ? i.source : i;
      const o = {
        buildingId: src.buildingId, gridKey: src.gridKey, level: src.level || 1,
        rotated: !!src.rotated, footprint: src.footprint || null,
        state: i.state === 'moving' ? (i.prevState || 'active') : src.state,
        hp: Math.round(src.hp ?? 0),
      };
      if (src.facingDeg != null) o.facingDeg = src.facingDeg;
      if (src.state === 'building') { o.buildTimer = src.buildTimer; o.buildDuration = src.buildDuration; }
      if (src.upgradeTimer > 0) { o.upgradeTimer = src.upgradeTimer; o.upgradeDuration = src.upgradeDuration; o.pendingLevel = src.pendingLevel; }
      return o;
    });
}

/**
 * Re-create saved buildings on the island through BuildSystem's own mesh
 * factory. Invalid/overlapping cells fall back to the first free cell that
 * fits (fresh starters) or are dropped (reported for a refund).
 * @returns {{placed:number, dropped:object[]}}
 */
export function restoreBuildings(game, isl, saved, { relocate = false } = {}) {
  const build = game._build, st = game._state;
  if (!Array.isArray(st.islandBuildings[isl.def.id])) st.islandBuildings[isl.def.id] = [];
  const cells = build._cells(isl);
  const cellByKey = new Map(cells.map(c => [c.key, c]));
  const dropped = [];
  let placed = 0;

  for (const b of saved) {
    const def = defOf(b.buildingId);
    if (!def) { dropped.push(b); continue; }
    const base = def.footprint || { w: 1, h: 1 };
    const fp = b.footprint || (b.rotated ? { w: base.h, h: base.w } : { ...base });
    let key = b.gridKey;
    if (!key || !cellByKey.has(key) || !build.canPlaceFootprint(isl, key, fp)) {
      if (!relocate) { dropped.push(b); continue; }
      const free = cells.find(c => build.canPlaceFootprint(isl, c.key, fp));
      if (!free) { dropped.push(b); continue; }
      key = free.key;
    }
    const cell = cellByKey.get(key);
    const inst = createBuildingInstance(def, key, cell.cx, cell.cz);
    const level = Math.max(1, Math.min(10, b.level || 1));
    inst.level = level;
    inst.footprint = { ...fp };
    inst.rotated = !!b.rotated;
    const [c, r] = key.split('_').map(Number);
    inst.gridX = c; inst.gridY = r; inst.armor = 0;
    inst.maxHp = def.hpByLevel?.[level - 1] ?? inst.maxHp;
    inst.hp = b.hp > 0 ? Math.min(b.hp, inst.maxHp) : inst.maxHp;

    if (def.isDefense) {
      Object.assign(inst, getDefenseStats(def, level));
      inst.hp = Math.min(b.hp > 0 ? b.hp : inst.maxHp, inst.maxHp ?? inst.hp);
      inst.isDefense = true;
      inst.fireTimer = inst.reloadSec || 6;
      inst.state = def.id === 'deadmans_lure' ? 'inactive' : 'active';
      inst.triggerRadius = def.triggerRadius || null;
      inst.armTimer = 2; inst.warnTimer = 3; inst.cooldownTimer = 0;
      inst.facingDeg = b.facingDeg ?? build._defaultFacing?.(isl) ?? 0;
    }
    if (b.state === 'building' && b.buildTimer > 0) {
      inst.state = 'building';
      inst.buildTimer = b.buildTimer;
      inst.buildDuration = b.buildDuration || b.buildTimer;
    } else if (!def.isDefense) {
      inst.state = 'active';
    }
    if (b.upgradeTimer > 0 && b.pendingLevel) {
      inst.upgradeTimer = b.upgradeTimer;
      inst.upgradeDuration = b.upgradeDuration || b.upgradeTimer;
      inst.pendingLevel = b.pendingLevel;
    }

    const pos = build.meshPosFor ? build.meshPosFor(def, key, fp, isl) : { x: cell.cx, z: cell.cz };
    inst.mesh = build._spawnMesh(def, pos, { level, rotated: inst.rotated });
    if (inst.state === 'building') inst.mesh.traverse(m => {
      if (!m.isMesh || !m.material) return;
      const fade = x => { const y = x.clone(); y.opacity = 0.45; y.transparent = true; return y; };
      m.material = Array.isArray(m.material) ? m.material.map(fade) : fade(m.material);
    });
    st.islandBuildings[isl.def.id].push(inst);
    placed++;
  }
  build.recalcWarehouse?.();
  return { placed, dropped };
}
