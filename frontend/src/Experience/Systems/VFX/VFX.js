import * as THREE from 'three';
import { audio }                              from '../../Utils/Audio.js';
import { createParticlePools }                from './particles.js';
import { ShockwaveSystem, WaterRippleSystem, ShipExplosionPool } from './explosions.js';
import { MuzzleFlashPool }                    from './muzzleFlash.js';
import { FireSource, SinkSequence }           from './fire.js';
import { CameraShake }                        from './cameraShake.js';
import { FloatTextLayer }                     from './floatText.js';

// Re-export CameraShake so existing import paths still work.
export { CameraShake };

const CANNON_SOUND = {
  default:   { pitch: 1.00, body: 0.68, maxDistance: 300 },
  swivel:    { pitch: 1.16, body: 0.46, maxDistance: 240 },
  falconet:  { pitch: 1.18, body: 0.50, maxDistance: 260 },
  long9:     { pitch: 1.10, body: 0.58, maxDistance: 300 },
  demi_culv: { pitch: 1.08, body: 0.60, maxDistance: 300 },
  carronade: { pitch: 0.92, body: 0.72, maxDistance: 280 },
  demi_can:  { pitch: 1.00, body: 0.74, maxDistance: 300 },
  mortar1:   { pitch: 0.78, body: 0.86, maxDistance: 340 },
  fort:      { pitch: 0.88, body: 0.72, maxDistance: 320 },
  defense:   { pitch: 1.04, body: 0.56, maxDistance: 280 },
  chain_shot: { pitch: 0.86, body: 0.62, maxDistance: 260 },
  grapeshot:  { pitch: 1.22, body: 0.58, maxDistance: 220 },
};

function cannonAudioOpts(cannon) {
  const id = typeof cannon === 'string' ? cannon : cannon?.id;
  const p = CANNON_SOUND[id] || CANNON_SOUND.default;
  return {
    volume: p.body,
    playbackRate: p.pitch * (0.95 + Math.random() * 0.10),
    maxDistance: p.maxDistance,
  };
}

const HIT_EXPLOSIONS = {
  ship: ['explosion_01', 'explosion_02', 'explosion_03'],
  fort: ['explosion_01', 'explosion_02', 'explosion_01', 'explosion_02', 'explosion_03'],
  building: ['explosion_01', 'explosion_02', 'explosion_01', 'explosion_02', 'explosion_03'],
};

function pickHitExplosion(type) {
  const list = HIT_EXPLOSIONS[type] || HIT_EXPLOSIONS.ship;
  return list[Math.floor(Math.random() * list.length)];
}

// ── VFX Facade ────────────────────────────────────────────────────
// Public API is unchanged — all game systems interact only with this class.
export class VFX {
  constructor(scene, camera) {
    this._scene  = scene;
    this._camera = camera;
    this._balls  = [];
    this._floatText = new FloatTextLayer(camera);   // AN: damage numbers / income ticks

    // Cannonball instanced pool (16 slots, zero GC)
    const BALL_POOL    = 16;
    this._ballGeo      = new THREE.SphereGeometry(0.16, 6, 6);
    this._ballMat      = new THREE.MeshBasicMaterial({ vertexColors: true });
    this._ballInst     = new THREE.InstancedMesh(this._ballGeo, this._ballMat, BALL_POOL);
    this._ballInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const _bc = new Float32Array(BALL_POOL * 3);
    this._ballInst.instanceColor = new THREE.InstancedBufferAttribute(_bc, 3);
    this._ballInst.count = 0;
    this._ballDummy = new THREE.Object3D();
    this._ballFree  = Array.from({ length: BALL_POOL }, (_, i) => i);
    scene.add(this._ballInst);

    // Particle pools (fire, smoke, misc)
    const pools    = createParticlePools(scene);
    this._fire     = pools.fire;
    this._smoke    = pools.smoke;
    this._misc     = pools.misc;

    // FX systems
    this._shock    = new ShockwaveSystem(scene);
    this._ripple   = new WaterRippleSystem(scene);
    this._flash    = new MuzzleFlashPool(scene);
    this._explPool = new ShipExplosionPool(scene, this._shock);
    this._sink     = new SinkSequence(scene, this._fire, this._smoke, this._misc);
    this.shake     = new CameraShake();
    this._miniExpl = [];  // deferred gunpowder mini-blasts
  }

  // ── Public API ────────────────────────────────────────────────

  spawnPart(x, y, z, col, n = 8) {
    this._misc.spawn(x, y, z, col || 0xff4400, n);
  }

  spawnSmoke(x, y, z) {
    this._smoke.spawn(x, y + 0.3, z, { n: 2, speed: 1.2, life: 0.85, size: 18, spread: 0.3 });
  }

  spawnHit(x, y, z, _team, type = 'ship') {
    this._fire.spawn(x, y, z, { n: 5, speed: 3.0, life: 0.5, size: 12, spread: 0.3 });
    this._smoke.spawn(x, y + 0.5, z, { n: 1, speed: 1.0, life: 0.60, size: 12, spread: 0.2 });
    this._misc.spawn(x, y, z, 0x8b5a2b, 4);
    if (type !== 'ground') {
      const isStructure = type === 'fort' || type === 'building';
      this.play3D(pickHitExplosion(type), x, y, z, {
        volume: isStructure ? 0.74 : 0.66,
        playbackRate: 0.95 + Math.random() * 0.10,
        maxDistance: isStructure ? 150 : 130,
      });
    }
  }

  spawnSplash(x, y, z) {
    this._misc.spawn(x, y, z, 0xaaddff, 6, { speed: 5.5, life: 0.50, upward: true });
    this._misc.spawn(x, y, z, 0x88ccee, 5, { speed: 2.2, life: 0.38 });
    this._ripple.spawn(x, z, 2);
    this.play3D('water_splash', x, y, z, {
      volume: 0.62,
      playbackRate: 0.94 + Math.random() * 0.12,
      maxDistance: 120,
    });
  }

  spawnExplosion(x, y, z) {
    this._fire.spawn(x, y, z, { n: 30, speed: 5.0, life: 1.2, size: 32, spread: 1.2 });
    this._smoke.spawn(x, y + 0.5, z, { n: 10, speed: 2.5, life: 1.6, size: 30, spread: 1.5 });
    this._misc.spawn(x, y, z, 0xccaa80, 10);
    this._shock.spawn(x, y + 0.2, z, 6.0);
    this.shake.trigger(0.7);
    this.playSound('explosion');
  }

  // Ship destruction: fireball + radial smoke/sparks + staggered secondary blasts
  spawnShipExplosion(x, y, z) {
    this._explPool.spawn(x, y + 0.5, z);
    this.shake.trigger(1.2);
    this.playSound('explosion');
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const delay = 0.12 + Math.random() * 0.90;
      const ox    = (Math.random() - 0.5) * 3.5;
      const oz    = (Math.random() - 0.5) * 3.5;
      this._miniExpl.push({ timer: delay, x: x + ox, y: y + 0.3, z: z + oz });
    }
  }

  spawnMuzzleFlash(x, y, z, dirX = 0, dirZ = 1) {
    this._flash.fire({
      position:  new THREE.Vector3(x, y, z),
      direction: new THREE.Vector3(dirX, 0, dirZ),
    });
  }

  startSink(ship, onRemoved) {
    this._sink.start(ship, onRemoved);
    this._shock.spawn(ship.x, 0.3, ship.z, 4.0);
    this.shake.trigger(0.4);
    this.playSound('sink');
  }

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
    return new FireSource(x, y, z, intensity, sounds);
  }

  // ── Cannonball ballistic trajectory ──────────────────────────
  fireBall(sx, sy, sz, tx, tz, col, _spd, onImpact, cannon = null) {
    const GRAVITY   = 18;
    const HORIZ_SPD = 28;
    const dx   = tx - sx, dz = tz - sz;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const tof  = dist / HORIZ_SPD;
    const vy0  = (0.3 - sy + 0.5 * GRAVITY * tof * tof) / tof;

    if (!this._ballFree.length) { onImpact?.(); return; }
    const slot = this._ballFree.pop();
    const ic   = this._ballInst.instanceColor;
    ic.array[slot * 3]     = ((col >> 16) & 0xff) / 255;
    ic.array[slot * 3 + 1] = ((col >>  8) & 0xff) / 255;
    ic.array[slot * 3 + 2] = ( col        & 0xff) / 255;
    ic.needsUpdate = true;
    this._balls.push({ slot, x: sx, y: sy, z: sz, vx: dx/tof, vy: vy0, vz: dz/tof, tof, elapsed: 0, cb: onImpact, done: false });
    this._ballInst.count = Math.max(this._ballInst.count, slot + 1);

    this._flash.fire({
      position:  new THREE.Vector3(sx, sy, sz),
      direction: new THREE.Vector3(dx / dist, 0, dz / dist),
    });
    this.play3D('cannon', sx, sy, sz, cannonAudioOpts(cannon));
  }

  // ── Floating damage numbers ───────────────────────────────────
  spawnDmg(wx, wy, wz, dmg, col = '#ff5050') {
    // AN: now routed through the pooled, world-anchored FloatTextLayer —
    // numbers track the target while it (and the camera) moves, and combat
    // spam no longer allocates a DOM node per hit.
    this._floatText.spawn(
      wx + (Math.random() - 0.5) * 1.2, wy, wz,
      '-' + Math.round(dmg),
      { col, size: 13, life: 1.1, rise: 2.6 });
  }

  // ── Audio ─────────────────────────────────────────────────────
  playSound(type)              { audio.play(type); }
  play3D(type, x, y, z, opts) { audio.play(type, { x, y, z }, opts); }

  // ── Frame update ──────────────────────────────────────────────
  // AN: world-anchored floating text (damage numbers, +income, pickups)
  floatText(x, y, z, text, opts) { this._floatText.spawn(x, y, z, text, opts); }

  update(dt) {
    const GRAVITY = 18;
    const bd = this._ballDummy;

    // Cannonball physics
    for (let i = this._balls.length - 1; i >= 0; i--) {
      const b = this._balls[i];
      if (b.done) {
        bd.scale.setScalar(0); bd.position.set(0, -999, 0); bd.updateMatrix();
        this._ballInst.setMatrixAt(b.slot, bd.matrix);
        this._ballFree.push(b.slot);
        this._balls.splice(i, 1);
        continue;
      }
      b.elapsed += dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.vy -= GRAVITY * dt;
      const hspd = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
      bd.position.set(b.x, b.y, b.z);
      bd.scale.setScalar(1);
      bd.rotation.set(Math.atan2(-b.vy, hspd), Math.atan2(b.vx, b.vz), 0);
      bd.updateMatrix();
      this._ballInst.setMatrixAt(b.slot, bd.matrix);
      if (b.elapsed >= b.tof) { b.done = true; b.cb?.(); }
    }
    this._ballInst.instanceMatrix.needsUpdate = true;

    // Deferred gunpowder mini-blasts
    for (let i = this._miniExpl.length - 1; i >= 0; i--) {
      const m = this._miniExpl[i];
      m.timer -= dt;
      if (m.timer <= 0) {
        this._fire.spawn(m.x, m.y, m.z, { n: 14, speed: 5.5, life: 0.80, size: 26, spread: 0.70 });
        this._smoke.spawn(m.x, m.y + 0.3, m.z, { n: 3, speed: 2.2, life: 1.1, size: 24, spread: 0.55 });
        this._shock.spawn(m.x, m.y, m.z, 2.8);
        this._misc.spawn(m.x, m.y, m.z, 0xcc9966, 8);
        this.shake.trigger(0.25);
        this._miniExpl.splice(i, 1);
      }
    }

    this._fire.update(dt);
    this._smoke.update(dt);
    this._misc.update(dt);
    this._shock.update(dt);
    this._ripple.update(dt);
    this._flash.update(dt);
    this._explPool.update(dt);
    this._sink.update(dt);
    this._floatText.update(dt);
  }

  destroy() {
    this._fire.destroy(this._scene);
    this._smoke.destroy(this._scene);
    this._misc.destroy(this._scene);
    this._shock.destroy();
    this._ripple.destroy();
    this._flash.destroy();
    this._explPool.destroy();
    this._scene.remove(this._ballInst);
    this._ballGeo.dispose();
    this._ballMat.dispose();
  }
}
