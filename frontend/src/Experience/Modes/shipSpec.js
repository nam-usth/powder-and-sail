// Roster ship / mission enemy → GameApp ship spec (see GameApp._makeFromSpec).
import { HULLS } from '../../data/harbor.js';
import { resolveHull } from '../../Meta/Campaign.js';

const ENEMY_TINT = { light: 0x902020, standard: 0xb02020, heavy: 0xcc3030 };

/** Spec for a player roster ship at (x, z) facing `angle`. */
export function shipSpec(rs, x, z, angle = 0) {
  const h = HULLS[rs.hullId] || HULLS.sloop;
  return {
    uid: rs.uid, hullId: h.id,
    cfg: { nm: rs.nm, col: h.col, spd: h.spd, sc: h.sc, hull: h.hull, disp: h.disp, tier: h.tier, hullId: h.id, faction: 'player' },
    x, z, angle,
    loadout: rs.loadout, hpFrac: rs.hpFrac ?? 1, maxHp: h.hp, upgrades: rs.upgrades,
  };
}

/** Spec for a mission enemy (data/campaign.js EnemySpec). */
export function enemySpec(e, i = 0, faction = 'pirates') {
  const h = resolveHull(e.hull);
  return {
    hullId: h.id,
    cfg: { nm: e.nm || h.nm, col: ENEMY_TINT[h.hull] || 0xa02020, spd: h.spd, sc: h.sc, hull: h.hull, disp: h.disp, tier: h.tier, hullId: h.id, faction: e.faction || faction },
    x: e.x ?? 80, z: e.z ?? (i * 10), angle: e.angle ?? -Math.PI / 2,
    loadout: e.loadout, hpFrac: 1, maxHp: e.hp || h.hp,
  };
}
