import * as THREE from 'three';
import { SHIP_REF, setShipDamageLook } from './shipModel.js';
import { vfxBudget } from './quality.js';

// ── ShipTracker — VFX that follow live ships ───────────────────────
// Discovers ship roots among the scene's direct children (makeShip tags them
// with userData[SHIP_REF] → ship) — no GameApp wiring needed:
//   • damage look: hull soot + torn sails scale with lost HP
//   • damage FX: smoke wisps (light damage), deck fires + a dark smoke column
//     (heavy), more hotspots + embers when crippled. Emitted in WORLD space,
//     so a burning ship under way trails its smoke down-wind.
//   • death: when a tracked ship's root leaves the scene with ship.alive ===
//     false, its last transform is handed to WreckSystem (sinking clone).
//   • gun positions: VFX.fireBall asks findAt(x, z) to place broadside muzzles.
// Fog of war: hidden (mesh.visible === false) ships emit nothing and leave
// no wreck, so effects never reveal an unseen enemy.

const R = Math.random;
const SCAN_EVERY = 0.25;     // s between full scene scans (new ships appear within this)
const _v = new THREE.Vector3();

export class ShipTracker {
  constructor(scene, fx, wrecks) {
    this._scene = scene;
    this._fx = fx;
    this._wrecks = wrecks;
    this._map = new Map();        // root → entry
    this._scanT = 0;
  }

  /** Entry for the ship standing exactly at (x, z) (a gun origin), or null. */
  findAt(x, z) {
    for (const e of this._map.values()) {
      const s = e.ship;
      if (Math.abs(s.x - x) < 0.05 && Math.abs(s.z - z) < 0.05) return e;
    }
    return null;
  }

  _scan() {
    const ch = this._scene?.children;
    if (!Array.isArray(ch)) return;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      const ship = c.userData?.[SHIP_REF];
      if (!ship || this._map.has(c)) continue;
      const k = (ship.rank ?? 0) * 0.37 + (String(ship.nm || '').length * 0.13);
      this._map.set(c, {
        root: c, ship, wasVisible: c.visible,
        smokeT: R(), fireT: R(), emberT: R(), dmgVis: 0,
        // deterministic deck hotspots (fractions of half-beam / half-length)
        hot: [[Math.sin(k * 7.1) * 0.35, 0.25 + 0.2 * Math.cos(k * 3.3)],
              [Math.cos(k * 5.3) * 0.35, -0.35 + 0.15 * Math.sin(k * 2.1)],
              [Math.sin(k * 2.9) * 0.3, 0.6 * Math.cos(k * 4.4)]],
      });
    }
  }

  update(dt) {
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = SCAN_EVERY; this._scan(); }
    for (const [root, e] of this._map) {
      const ship = e.ship;
      if (root.parent !== this._scene) {
        // left the scene: sunk (→ wreck) or swapped (GLB) / culled (→ forget)
        if (!ship.alive && e.wasVisible && ship.mesh !== undefined) this._spawnWreck(e);
        this._map.delete(root);
        continue;
      }
      if (ship.mesh !== root && ship.mesh) { this._map.delete(root); continue; }
      e.wasVisible = root.visible;
      if (!ship.alive) continue;
      const frac = ship.maxHp > 0 ? Math.max(0, Math.min(1, ship.hp / ship.maxHp)) : 1;
      const dmg = 1 - frac;
      e.dmgVis += (dmg - e.dmgVis) * Math.min(1, dt * 3);
      setShipDamageLook(root, Math.max(0, (e.dmgVis - 0.15) / 0.85));
      if (root.visible && dmg > 0.25) this._emit(e, dt, dmg);
    }
  }

  _emit(e, dt, dmg) {
    const fx = this._fx, B = vfxBudget();
    const root = e.root, hi = root.userData.hullInfo, sc = e.ship.sc || 1;
    const hl = hi?.hl ?? 2.3 * sc, hb = hi?.hb ?? 0.75 * sc, deckY = hi?.deckY ?? 0.2 * sc;
    const fireLevel = dmg < 0.5 ? 0 : dmg < 0.78 ? 1 : 2;
    // smoke wisps (light damage: HIGH only) / smoke column (fires: always)
    if (fireLevel > 0 || B.damageSmoke) {
      e.smokeT -= dt;
      if (e.smokeT <= 0) {
        e.smokeT = (fireLevel ? 0.11 : 0.22) / B.emit;
        const h = e.hot[(R() * (fireLevel + 1)) | 0];
        _v.set(h[0] * hb, deckY + 0.25, h[1] * hl); root.localToWorld(_v);
        const dark = fireLevel ? 0.12 + R() * 0.1 : 0.42 + R() * 0.15;
        fx.smoke.emit(_v.x, _v.y, _v.z, (R() - 0.5) * 0.4, 1.0 + R() * 0.8, (R() - 0.5) * 0.4,
          (fireLevel ? 4.5 + R() * 2.5 : 2.6 + R() * 1.2) * B.smokeLife,
          0.45 * sc, (fireLevel ? 3.2 : 2.0) * sc * (0.8 + R() * 0.4), 1.2, 0.85, dark, fireLevel ? 0.5 : 0.3, fireLevel ? 0.85 : 0);
      }
    }
    if (!fireLevel) return;
    e.fireT -= dt;
    if (e.fireT <= 0) {
      e.fireT = (fireLevel === 1 ? 0.07 : 0.045) / B.emit;
      const nh = fireLevel === 1 ? 1 : 3;
      for (let k = 0; k < nh; k++) {
        if (k === 2 && R() < 0.5) continue;
        const h = e.hot[k];
        _v.set(h[0] * hb + (R() - 0.5) * 0.25 * sc, deckY + 0.05, h[1] * hl + (R() - 0.5) * 0.3 * sc); root.localToWorld(_v);
        const big = fireLevel === 2 ? 1.25 : 1.0;
        fx.flame.emit(_v.x, _v.y, _v.z, (R() - 0.5) * 0.5, 1.4 + R() * 1.2, (R() - 0.5) * 0.5,
          0.45 + R() * 0.35, 0.35 * sc * big, (0.9 + R() * 0.5) * sc * big, 2.2, 2.2, 0.92, 0.85, 1.0);
      }
    }
    e.emberT -= dt;
    if (e.emberT <= 0) {
      e.emberT = (fireLevel === 2 ? 0.12 : 0.3) / B.emit;
      const h = e.hot[0];
      _v.set(h[0] * hb, deckY + 0.3, h[1] * hl); root.localToWorld(_v);
      fx.spark.emit(_v.x, _v.y, _v.z, (R() - 0.5) * 1.2, 2.2 + R() * 2.2, (R() - 0.5) * 1.2,
        1.0 + R() * 1.2, 0.03, 0.05, 0.8, 0.5, 1.0, 0.52, 0.16, 1.3);
    }
  }

  _spawnWreck(e) {
    const root = e.root, ship = e.ship, hi = root.userData.hullInfo, sc = ship.sc || 1;
    this._wrecks.spawn(root, {
      x: root.position.x, z: root.position.z, y: root.position.y,
      angle: ship.angle ?? root.rotation.y, roll: root.rotation.z, pitch: root.rotation.x, sc,
      hl: hi?.hl ?? 2.3 * sc, hb: hi?.hb ?? 0.75 * sc, deckY: hi?.deckY ?? 0.2 * sc,
    });
  }

  destroy() { this._map.clear(); }
}
