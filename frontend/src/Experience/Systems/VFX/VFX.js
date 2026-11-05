import * as THREE from 'three';
import { audio }                              from '../../Utils/Audio.js';
import { time }                               from '../../Time.js';
import { getWaveHeight }                      from '../../World/Ocean.js';
import { createParticlePools }                from './particles.js';
import { DebrisField }                        from './debris.js';
import { WaterDecalField }                    from './decals.js';
import { FlashLights }                        from './flashLights.js';
import { FireballPool, ShockwaveSystem, WaterRippleSystem } from './explosions.js';
import { MuzzleFlashSystem }                  from './muzzleFlash.js';
import { FireSource, SinkSequence, WreckSystem } from './fire.js';
import { ShipTracker }                        from './shipFx.js';
import { CameraShake }                        from './cameraShake.js';
import { FloatTextLayer }                     from './floatText.js';
import { ENV, syncEnvFromScene }              from './env.js';
import * as FX                                from './recipes.js';
import { vfxBudget, onVfxQualityChange, setVfxQuality, getVfxQuality } from './quality.js';

// Re-export so existing import paths keep working + the quality API.
export { CameraShake, setVfxQuality, getVfxQuality };

// Gun + impact sounds: per-cannon recipes in data/cannonSounds.js (audio.playCannon / playImpact).

const BALL_POOL  = 32;
const GRAVITY    = 18;
const HORIZ_SPD  = 28;
const R = Math.random;
const _vfxLive = new Set();

// ── VFX Facade ────────────────────────────────────────────────────
// Public API unchanged — every game system talks only to this class:
//   spawnPart · spawnSmoke · spawnHit · spawnSplash · spawnExplosion ·
//   spawnShipExplosion · spawnMuzzleFlash · startSink · startBurning ·
//   fireBall · spawnDmg · floatText · playSound · play3D · update · destroy
//   · shake (CameraShake) · _fire / _smoke (legacy pools for fort fires)
// New: setQuality(q) and the module-level setVfxQuality / getVfxQuality.
//
// Rendering budget (all effects on screen at once): smoke, flame, spark,
// spray = 4 point draws · debris, decals, muzzle jets = 3 instanced draws ·
// cannonballs 1 · fireballs ≤ 4 · 3 fixed flash lights. Zero per-frame
// allocation; spawns write into fixed ring buffers.
export class VFX {
  constructor(scene, camera) {
    this._scene  = scene;
    this._camera = camera;
    this._balls  = [];
    this._time   = 0;
    this._floatText = new FloatTextLayer(camera);

    // Cannonballs: dark cast-iron shot (instanced, recycled slots)
    this._ballGeo  = new THREE.SphereGeometry(0.13, 8, 6);
    this._ballMat  = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.45, metalness: 0.6 });
    this._ballInst = new THREE.InstancedMesh(this._ballGeo, this._ballMat, BALL_POOL);
    this._ballInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._ballInst.count = 0;
    this._ballInst.frustumCulled = false;
    this._ballDummy = new THREE.Object3D();
    this._ballFree  = Array.from({ length: BALL_POOL }, (_, i) => BALL_POOL - 1 - i);
    scene.add(this._ballInst);

    // Shared GPU fields
    const pools  = createParticlePools(scene);
    this._fire   = pools.fire;     // FlameField — legacy name (IslandEntity)
    this._smoke  = pools.smoke;    // SmokeField — legacy name (IslandEntity)
    this._spark  = pools.spark;
    this._spray  = pools.spray;
    this._misc   = pools.spark;    // legacy alias (coloured bits)
    this._debris = new DebrisField(scene);
    this._decals = new WaterDecalField(scene);
    this._lights = new FlashLights(scene);
    this._fireball = new FireballPool(scene);
    this._fx = {
      smoke: this._smoke, flame: this._fire, spark: this._spark, spray: this._spray,
      debris: this._debris, decals: this._decals, lights: this._lights, fireball: this._fireball,
    };
    this._muzzle  = new MuzzleFlashSystem(scene, this._fx);
    this._flash   = this._muzzle;  // legacy alias
    this._shock   = new ShockwaveSystem(scene, this._decals);
    this._ripple  = new WaterRippleSystem(scene, this._decals);
    this._wrecks  = new WreckSystem(scene, this._fx);
    this._sink    = new SinkSequence(scene, this._wrecks);
    this._ships   = new ShipTracker(scene, this._fx, this._wrecks);
    this.shake    = new CameraShake();
    this._shakes  = [];            // delayed shake impulses [{t, a}]
    this._trailT  = 0;

    this._applyBudget(vfxBudget());
    this._unsubQ = onVfxQualityChange(b => this._applyBudget(b));
    _vfxLive.add(this);
  }

  /** Switch this (and every) VFX instance between 'high' and 'low' budgets. */
  setQuality(q) { return setVfxQuality(q); }

  _applyBudget(b) {
    [this._smoke, this._fire, this._spark, this._spray, this._debris, this._decals].forEach(f => f.setBudget(b.poolFrac));
    ENV.uSoft.value  = b.softParticles ? 1 : 0;
    ENV.uMaxPx.value = b.maxPointPx;
  }

  // ── helpers ───────────────────────────────────────────────────
  _waterY(x, z) { return getWaveHeight(x, z, time.elapsed); }

  /** Camera-distance attenuated shake (far explosions barely nudge the view). */
  _shakeAt(x, z, amount, delay = 0) {
    const c = this._camera?.position;
    let k = 1;
    if (c && typeof c.x === 'number') {
      const d = Math.hypot(x - c.x, z - c.z);
      k = Math.max(0.15, Math.min(1, 1.25 - d / 140));
    }
    if (delay > 0) this._shakes.push({ t: delay, a: amount * k });
    else this.shake.trigger(amount * k);
  }

  // ── Public API ────────────────────────────────────────────────

  /** Coloured burst of bits (ability / aura feedback). */
  spawnPart(x, y, z, col, n = 8) {
    this._spark.spawn(x, y, z, col || 0xff4400, Math.max(2, Math.round(n * vfxBudget().emit)));
  }

  /** Small grey smoke puff. */
  spawnSmoke(x, y, z) {
    for (let i = 0; i < 2; i++) {
      this._smoke.emit(x + (R() - 0.5) * 0.3, y + 0.3, z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.6, 1.0 + R() * 0.6, (R() - 0.5) * 0.6,
        1.8 + R(), 0.4, 1.8, 1.4, 0.4, 0.6, 0.4, 0);
    }
  }

  /** Shot striking a target: splinters on ships, chips + dust on stone/earth. */
  spawnHit(x, y, z, _team, type = 'ship') {
    if (type === 'ship') FX.hitShip(this._fx, x, y, z);
    else FX.hitStone(this._fx, x, y, z, type === 'fort' || type === 'building');
    audio.playImpact(this._shotCannon, type, x, y, z);   // per-gun impact sound (data/cannonSounds.js)
  }

  /** Cannonball into the sea: water column, droplets, mist, rings + foam. */
  spawnSplash(x, y, z) {
    FX.splash(this._fx, x, this._waterY(x, z), z, 1);
    audio.playImpact(this._shotCannon, 'water', x, y, z);
  }

  /** Generic blast (mines, Deadman's Lure). */
  spawnExplosion(x, y, z) {
    const wy = this._waterY(x, z);
    FX.blast(this._fx, x, y, z, 1.2, wy);
    if (y < wy + 3) FX.splash(this._fx, x, wy, z, 1.6);
    this._shakeAt(x, z, 0.7);
    this.playSound('explosion');
  }

  /** Ship destruction: fireball, secondary powder blasts, wreckage, spray. */
  spawnShipExplosion(x, y, z) {
    const delays = FX.shipExplosion(this._fx, x, y, z, 1, this._waterY(x, z));
    this._shakeAt(x, z, 1.2);
    for (const d of delays) this._shakeAt(x, z, 0.22, d);
    this.playSound('explosion');
  }

  /** One gun discharging at (x, y, z) towards (dirX, dirZ). */
  spawnMuzzleFlash(x, y, z, dirX = 0, dirZ = 1) {
    const l = Math.hypot(dirX, dirZ) || 1;
    this._muzzle.discharge(x, y, z, dirX / l, dirZ / l, 1);
    this._lights.flash(x, y, z, 6, 0.08);
  }

  /** Legacy: sink a ship's own mesh (a charred clone goes down in its place). */
  startSink(ship, onRemoved) {
    this._sink.start(ship, onRemoved);
    this._decals.emit(ship.x, this._waterY(ship.x, ship.z) + 0.06, ship.z, 0, 0.5, 4.0, 0.7, 0.8);
    this._shakeAt(ship.x, ship.z, 0.4);
    this.playSound('sink');
  }

  /** Persistent fire (forts); caller ticks it with update(dt, vfx._fire, vfx._smoke). */
  startBurning(x, y, z, intensity = 1.0) {
    const baseVol = Math.min(0.82, 0.36 + intensity * 0.18);
    const sounds = [
      audio.playSpatialLoop('fire_burning', { x, y, z }, {
        volume: baseVol,
        maxDistance: 86,
        playbackRate: 0.88 + Math.random() * 0.05,
        offset: Math.random() * 4,
      }),
      audio.playSpatialLoop('fire_burning', { x, y: y + 0.8, z }, {
        volume: baseVol * 0.55,
        maxDistance: 42,
        playbackRate: 1.18 + Math.random() * 0.10,
        offset: 1.2 + Math.random() * 4,
      }),
    ];
    return new FireSource(x, y, z, intensity, sounds, { spark: this._spark });
  }

  // ── Cannonball ballistic trajectory ──────────────────────────
  /**
   * Fire one shot. Visual only: the impact callback still fires after the
   * same time of flight as before (dist / 28 u/s), so gameplay is unchanged.
   * When the origin is a ship, the volley ripples along its broadside —
   * several guns flash in sequence from the hull side facing the target.
   */
  fireBall(sx, sy, sz, tx, tz, _col, _spd, onImpact, cannon = null) {
    const dx0 = tx - sx, dz0 = tz - sz;
    const dist = Math.sqrt(dx0 * dx0 + dz0 * dz0) || 0.01;
    const dirX = dx0 / dist, dirZ = dz0 / dist;
    let ox = sx, oy = sy, oz = sz;
    const e = this._ships.findAt(sx, sz);
    if (e) {
      const o = this._broadside(e, dirX, dirZ, cannon);
      ox = o.x; oy = o.y; oz = o.z;
    } else {
      // forts / shore batteries: one heavy gun at the battery
      this._muzzle.discharge(sx, sy, sz, dirX, dirZ, 1.3);
      this._lights.flash(sx, sy, sz, 8, 0.09);
    }
    audio.playCannon(cannon, sx, sy, sz, tx, tz, dist / HORIZ_SPD);   // per-gun recipe (data/cannonSounds.js)
    if (onImpact) { const cb = onImpact; onImpact = () => { this._shotCannon = cannon; try { cb(); } finally { this._shotCannon = null; } }; }

    const dx = tx - ox, dz = tz - oz;
    const d2 = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const tof = dist / HORIZ_SPD;
    const vy0 = (0.3 - oy + 0.5 * GRAVITY * tof * tof) / tof;
    if (!this._ballFree.length) { this._balls.push({ slot: -1, x: ox, y: oy, z: oz, vx: dx / tof, vy: vy0, vz: dz / tof, tof, elapsed: 0, cb: onImpact, done: false }); return; }
    const slot = this._ballFree.pop();
    this._balls.push({ slot, x: ox, y: oy, z: oz, vx: dx / tof, vy: vy0, vz: dz / tof, tof, elapsed: 0, cb: onImpact, done: false, trail: 0 });
    if (slot + 1 > this._ballInst.count) this._ballInst.count = slot + 1;
    void d2;
  }

  /** Ripple of gun flashes along the engaged side; returns the shot origin. */
  _broadside(e, dirX, dirZ, cannon) {
    const ship = e.ship, root = e.root, hi = root.userData.hullInfo || null, sc = ship.sc || 1;
    const a = ship.angle || 0, fx = Math.sin(a), fz = Math.cos(a);   // bow direction
    const px = Math.cos(a), pz = -Math.sin(a);                        // starboard
    const hl = hi?.hl ?? 2.3 * sc, hb = hi?.hb ?? 0.75 * sc;
    const baseY = root.position.y;
    const gunY = baseY + (hi ? (R() < 0.5 ? hi.gunY : hi.lowGunY ?? hi.gunY) : 0.25 * sc);
    const dotF = dirX * fx + dirZ * fz;
    const out = this._origin;
    const heavy = typeof cannon === 'object' && cannon?.id && /mortar|demi_can|carronade/.test(cannon.id);
    const scale = (heavy ? 1.15 : 0.95) * Math.min(1.25, 0.75 + sc * 0.3);
    if (Math.abs(dotF) > 0.82) {
      // bow / stern chaser
      const s = Math.sign(dotF) || 1;
      out.x = ship.x + fx * hl * 1.02 * s; out.z = ship.z + fz * hl * 1.02 * s; out.y = baseY + (hi ? hi.deckY + 0.15 : 0.3);
      this._muzzle.discharge(out.x, out.y, out.z, dirX, dirZ, scale);
      this._lights.flash(out.x, out.y, out.z, 6, 0.08);
      return out;
    }
    const side = (dirX * px + dirZ * pz) >= 0 ? 1 : -1;
    const B = vfxBudget();
    const nGuns = Math.max(1, Math.round((hi?.guns ?? 3) * B.ripple));
    const ddx = px * side * 0.72 + dirX * 0.28, ddz = pz * side * 0.72 + dirZ * 0.28;
    const dl = Math.hypot(ddx, ddz) || 1;
    for (let i = 0; i < nGuns; i++) {
      const f = nGuns === 1 ? 0 : (i / (nGuns - 1) - 0.5) * 2;
      const along = f * hl * 0.55;
      const mx = ship.x + fx * along + px * side * (hb + 0.08);
      const mz = ship.z + fz * along + pz * side * (hb + 0.08);
      const delay = i * (0.06 + R() * 0.05);
      this._muzzle.discharge(mx, gunY + (R() - 0.5) * 0.06, mz, ddx / dl, ddz / dl, scale, delay);
      if (i === (nGuns >> 1)) { out.x = mx; out.y = gunY; out.z = mz; }
    }
    this._lights.flash(out.x, out.y + 0.3, out.z, 7, 0.10);
    return out;
  }

  // ── Floating damage numbers ───────────────────────────────────
  spawnDmg(wx, wy, wz, dmg, col = '#ff5050') {
    this._floatText.spawn(
      wx + (Math.random() - 0.5) * 1.2, wy, wz,
      '-' + Math.round(dmg),
      { col, size: 13, life: 1.1, rise: 2.6 });
  }

  // ── Audio ─────────────────────────────────────────────────────
  playSound(type)              { audio.play(type); }
  play3D(type, x, y, z, opts) { audio.play(type, { x, y, z }, opts); }

  /** World-anchored floating text (damage numbers, +income, pickups). */
  floatText(x, y, z, text, opts) { this._floatText.spawn(x, y, z, text, opts); }

  // ── Frame update ──────────────────────────────────────────────
  update(dt) {
    this._time += dt;
    ENV.uTime.value = this._time;
    syncEnvFromScene(this._scene, dt);
    const B = vfxBudget();

    // Cannonballs
    const bd = this._ballDummy;
    let anyBall = false;
    this._trailT += dt;
    const trailNow = B.trails && this._trailT >= 0.035;
    if (trailNow) this._trailT = 0;
    for (let i = this._balls.length - 1; i >= 0; i--) {
      const b = this._balls[i];
      b.elapsed += dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.vy -= GRAVITY * dt;
      if (b.slot >= 0) {
        if (trailNow) FX.trailPuff(this._fx, b.x, b.y, b.z, b.vx, b.vy, b.vz);
        bd.position.set(b.x, b.y, b.z);
        bd.scale.setScalar(1);
        bd.updateMatrix();
        this._ballInst.setMatrixAt(b.slot, bd.matrix);
        anyBall = true;
      }
      if (b.elapsed >= b.tof) {
        if (b.slot >= 0) {
          bd.position.set(0, -999, 0); bd.scale.setScalar(0); bd.updateMatrix();
          this._ballInst.setMatrixAt(b.slot, bd.matrix);
          this._ballFree.push(b.slot);
        }
        this._balls.splice(i, 1);
        b.cb?.();
      }
    }
    if (anyBall || this._balls.length === 0) this._ballInst.instanceMatrix.needsUpdate = true;

    // Delayed shake impulses (secondary blasts)
    for (let i = this._shakes.length - 1; i >= 0; i--) {
      const s = this._shakes[i];
      s.t -= dt;
      if (s.t <= 0) { this.shake.trigger(s.a); this._shakes.splice(i, 1); }
    }

    this._lights.update(dt);
    this._fireball.update(dt);
    this._ships.update(dt);
    this._wrecks.update(dt, time.elapsed);
    const now = this._time;
    this._smoke.tick(now); this._fire.tick(now); this._spark.tick(now); this._spray.tick(now);
    this._debris.tick(now, time.elapsed); this._decals.tick(now); this._muzzle.tick(now);
    this._floatText.update(dt);
  }

  destroy() {
    _vfxLive.delete(this);
    this._unsubQ?.();
    [this._fire, this._smoke, this._spark, this._spray].forEach(f => f.destroy());
    this._debris.destroy();
    this._decals.destroy();
    this._muzzle.destroy();
    this._fireball.destroy();
    this._lights.destroy();
    this._wrecks.destroy();
    this._ships.destroy();
    this._floatText.clear?.();
    this._scene.remove(this._ballInst);
    this._ballGeo.dispose();
    this._ballMat.dispose();
  }
}

// reusable shot-origin object (no per-shot allocation)
VFX.prototype._origin = null;
Object.defineProperty(VFX.prototype, '_origin', {
  get() { return this.__o || (this.__o = { x: 0, y: 0, z: 0 }); },
});
