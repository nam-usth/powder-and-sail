// ── PHYSICS ──────────────────────────────────────────────────────
// AC milestone: Rapier3D WASM physics world.
//
// Architecture:
//   - Fixed timestep 1/60s with accumulator (decoupled from render)
//   - Ships: dynamic Box bodies + buoyancy force from getWaveHeight()
//   - Islands: fixed Cuboid colliders — ships can't pass through
//   - Cannonballs: NOT physics bodies — we use the custom ballistic
//     trajectory from AA.1 (cheaper, more controllable arc feel)
//
// Usage:
//   const physics = new Physics()
//   await physics.init()                   // load WASM
//   physics.addShip(ship)                  // register ship
//   physics.addIsland(island)              // register island collider
//   physics.update(dt, t)                  // step + apply buoyancy
//   const { x, y, z } = physics.getShipPos(ship)  // interpolated pos

import { getWaveHeight } from './World/Ocean.js';

const FIXED_DT     = 1 / 60;
// BUOY_POINTS / BUOY_FORCE removed — replaced by PD controller in _applyBuoyancy
const LINEAR_DAMP  = 2.2;      // resist drift
const ANGULAR_DAMP = 5.0;      // resist spin — ships shouldn't roll wildly
const GRAVITY      = -9.81;

// Hull mass by type (kg)
const HULL_MASS = { light: 180, standard: 480, heavy: 1100 };

export class Physics {
  constructor() {
    this._RAPIER     = null;
    this._world      = null;
    this._accumulator= 0;
    this._bodies     = new Map();   // ship → { body, halfL, halfB }
    this._islands    = [];          // static collider handles
    this._ready      = false;
  }

  async init() {
    try {
      const RAPIER = await import('../../vendor/rapier/rapier.es.js');
      await RAPIER.init();
      this._RAPIER = RAPIER;
      this._world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
      this._world.timestep = FIXED_DT;
      this._ready = true;
      console.log('[Physics] Rapier3D ready');
    } catch(err) {
      console.warn('[Physics] Rapier3D failed to load — physics disabled:', err.message);
      this._ready = false;
    }
  }

  get ready() { return this._ready; }

  // ── Ship registration ────────────────────────────────────────
  addShip(ship) {
    if(!this._ready || this._bodies.has(ship)) return;
    const R = this._RAPIER;
    const sc      = ship.sc || 1;
    const halfL   = sc * 1.9;
    const halfB   = sc * 0.75;
    const halfH   = sc * 0.28;
    const mass    = HULL_MASS[ship.hull] || 480;

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(ship.x, 0.35, ship.z)
      .setLinearDamping(LINEAR_DAMP)
      .setAngularDamping(ANGULAR_DAMP)
      .setAdditionalMass(mass)
      .setGravityScale(0.0);   // we handle vertical forces manually via buoyancy

    const body = this._world.createRigidBody(bodyDesc);

    const collDesc = R.ColliderDesc.cuboid(halfB, halfH, halfL)
      .setRestitution(0.1)
      .setFriction(0.8);
    this._world.createCollider(collDesc, body);

    this._bodies.set(ship, { body, halfL, halfB });
  }

  removeShip(ship) {
    const entry = this._bodies.get(ship);
    if(!entry) return;
    this._world.removeRigidBody(entry.body);
    this._bodies.delete(ship);
  }

  // ── Island colliders (static) ────────────────────────────────
  addIsland(island) {
    if(!this._ready) return;
    const R = this._RAPIER;
    // Approximate island as a cylinder → use a flat cuboid for simplicity
    // (Rapier doesn't have cylinder in compat build — use 8-sided approximation)
    const r = island.r * 0.85;  // slightly smaller than visual to feel fair
    const bodyDesc = R.RigidBodyDesc.fixed()
      .setTranslation(island.x, 0, island.z);
    const body = this._world.createRigidBody(bodyDesc);
    const collDesc = R.ColliderDesc.ball(r);
    this._world.createCollider(collDesc, body);
    this._islands.push(body);
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(dt, t) {
    if(!this._ready) return;

    this._accumulator += Math.min(dt, 0.1);

    while(this._accumulator >= FIXED_DT) {
      this._applyBuoyancy(t);
      this._world.step();
      this._accumulator -= FIXED_DT;
    }

    // Write physics position + CLAMPED rotation to ship meshes
    // IMPORTANT: never apply Rapier quaternion directly — it can flip ships upside down.
    // Instead: extract only roll/pitch (X/Z axes), clamp hard to MAX_TILT, keep Y from game logic.
    const MAX_VISUAL_TILT = 0.18;  // hard visual clamp ~10° — tighter than torque clamp
    for(const [ship, { body }] of this._bodies) {
      if(!ship.alive) continue;
      const pos = body.translation();
      const rot = body.rotation();

      ship.mesh.position.x = pos.x;
      ship.mesh.position.y = pos.y;
      ship.mesh.position.z = pos.z;

      // Extract roll and pitch from Rapier quaternion (ZXY decomposition)
      // Using standard quaternion-to-euler formulas — no Three.js Euler object needed
      const sinPitch = 2*(rot.w*rot.x - rot.y*rot.z);
      const sinRoll  = 2*(rot.w*rot.z + rot.x*rot.y);

      // Hard clamp — prevent flip even if torque accumulates
      const pitch = Math.max(-MAX_VISUAL_TILT, Math.min(MAX_VISUAL_TILT, sinPitch));
      const roll  = Math.max(-MAX_VISUAL_TILT, Math.min(MAX_VISUAL_TILT, sinRoll));

      // Reconstruct rotation: Y = ship.angle (game logic authority), X/Z = physics
      // This is safer than quaternion.set() which could encode arbitrary orientation
      ship.mesh.rotation.order = 'YXZ';
      ship.mesh.rotation.y = ship.angle;
      ship.mesh.rotation.x = pitch;
      ship.mesh.rotation.z = roll;
    }
  }

  // ── Buoyancy — 4-point sampling ─────────────────────────────
  _applyBuoyancy(t) {
    for(const [ship, { body, halfL, halfB }] of this._bodies) {
      if(!ship.alive) continue;

      const pos  = body.translation();
      const vel  = body.linvel();
      const angle= ship.angle;
      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);

      // Target Y: wave height at centre + small freeboard
      const targetY = getWaveHeight(pos.x, pos.z, t) + 0.35;

      // PD controller for vertical position — fast, stable, no sinking
      // P term: position error, D term: damp vertical velocity
      const errY  = targetY - pos.y;
      const forceY = errY * 380 - vel.y * 28;
      body.applyImpulse({ x: 0, y: forceY * FIXED_DT, z: 0 }, true);

      // Torque for roll/pitch from 4-point wave sampling
      const pts = [
        { x: pos.x + sinA * halfL,  z: pos.z + cosA * halfL  },  // bow
        { x: pos.x - sinA * halfL,  z: pos.z - cosA * halfL  },  // stern
        { x: pos.x + cosA * halfB,  z: pos.z - sinA * halfB  },  // port
        { x: pos.x - cosA * halfB,  z: pos.z + sinA * halfB  },  // starboard
      ];

      const hBow    = getWaveHeight(pts[0].x, pts[0].z, t);
      const hStern  = getWaveHeight(pts[1].x, pts[1].z, t);
      const hPort   = getWaveHeight(pts[2].x, pts[2].z, t);
      const hStarbd = getWaveHeight(pts[3].x, pts[3].z, t);

      // Extract current roll/pitch from quaternion to clamp over-rotation
      const rot   = body.rotation();
      const sinRoll  = 2 * (rot.w * rot.z + rot.x * rot.y);
      const sinPitch = 2 * (rot.w * rot.x - rot.y * rot.z);
      const MAX_TILT = 0.26;  // ±15° in radians

      // Pitch torque — clamped: if already at max tilt, only allow corrective torque
      const pitchErr = (hBow - hStern) / (halfL * 2);
      const pitchTq  = pitchErr * 12 * FIXED_DT;
      if(Math.abs(sinPitch) < MAX_TILT || Math.sign(pitchTq) !== Math.sign(sinPitch))
        body.applyTorqueImpulse({ x: pitchTq, y: 0, z: 0 }, true);

      // Roll torque — same clamp
      const rollErr = (hStarbd - hPort) / (halfB * 2);
      const rollTq  = rollErr * 8 * FIXED_DT;
      if(Math.abs(sinRoll) < MAX_TILT || Math.sign(rollTq) !== Math.sign(sinRoll))
        body.applyTorqueImpulse({ x: 0, y: 0, z: rollTq }, true);
    }
  }

  // ── Sync ship.x / ship.z from physics body ──────────────────
  // Call AFTER MovementSystem has set ship.x, ship.z (movement wins)
  syncToShip(ship) {
    const entry = this._bodies.get(ship);
    if(!entry || !ship.alive) return;
    // Warp body to match game-logic position (MovementSystem is authoritative for XZ)
    entry.body.setTranslation({ x: ship.x, y: entry.body.translation().y, z: ship.z }, true);
    // Preserve game-logic rotation for heading
    // Physics handles Y (bob) and rotation around X/Z (roll/pitch)
  }

  destroy() {
    if(this._world) {
      this._world.free();
      this._world = null;
    }
    this._bodies.clear();
    this._ready = false;
  }
}
