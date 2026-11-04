// ── Effect recipes ─────────────────────────────────────────────────
// Composite effects written as data-light functions over the shared fields:
//   fx = { smoke, flame, spark, spray, debris, decals, lights, fireball }
// Every count goes through budgetCount() (LOW halves it); extras that only
// add atmosphere are gated on the budget flags. Delayed records (future birth
// time) replace timers for secondary blasts and splash follow-ups.
import { vfxBudget, budgetCount } from './quality.js';
import { DebrisField } from './debris.js';

const R = Math.random;
const TAU = Math.PI * 2;

/**
 * Cannonball into the sea: tall white column that collapses, crown droplets,
 * drifting mist, ring + foam on the surface.
 * @param {number} wy water surface height at (x, z)
 */
export function splash(fx, x, wy, z, scale = 1) {
  const B = vfxBudget();
  const nc = budgetCount(14, 7);
  for (let i = 0; i < nc; i++) {
    const a = R() * TAU, r = R() * 0.22 * scale, out = 0.2 + R() * 0.8;
    const lift = i < nc * 0.6 ? 9.0 + R() * 4.5 : 4.5 + R() * 3.0;     // a tall core + a lower skirt
    fx.spray.puff(x + Math.cos(a) * r, wy + 0.1, z + Math.sin(a) * r,
      Math.cos(a) * out, lift * Math.sqrt(scale), Math.sin(a) * out,
      1.05 + R() * 0.5, 0.45 * scale, (1.5 + R() * 0.9) * scale, 0.45, -15, 0.85, R() * 0.07);
  }
  const nd = budgetCount(14, 6);
  for (let i = 0; i < nd; i++) {
    const a = R() * TAU, h = 2.5 + R() * 3.0;
    fx.spray.droplet(x, wy + 0.2, z, Math.cos(a) * h, 4.0 + R() * 5.0, Math.sin(a) * h,
      0.9 + R() * 0.5, 0.05 + R() * 0.03, 0.9, R() * 0.12);
  }
  const nm = budgetCount(3, 1);
  for (let i = 0; i < nm; i++) {
    const a = R() * TAU;
    fx.spray.puff(x, wy + 0.25, z, Math.cos(a) * 1.2, 0.6 + R() * 0.6, Math.sin(a) * 1.2,
      1.8 + R() * 1.0, 0.9 * scale, (3.0 + R() * 1.2) * scale, 1.2, 0.15, 0.42, 0.35 + R() * 0.2);
  }
  fx.decals.emit(x, wy + 0.05, z, 0, 0.2, 3.0 * scale, 0.95, 0.9, 0.09);
  fx.decals.emit(x, wy + 0.05, z, 0, 0.2, 4.6 * scale, 1.25, 0.6, 0.06, 0.16);
  fx.decals.emit(x, wy + 0.04, z, 1, 0.5, 1.9 * scale, 2.4, 0.85, 0.1, 0.25);
  if (B.softParticles) {
    for (let i = 0; i < 6; i++) {
      const a = R() * TAU, r = 0.3 + R() * 1.4;
      fx.spray.bubble(x + Math.cos(a) * r, wy + 0.06, z + Math.sin(a) * r, 1.0 + R() * 1.2, 0.08, 0.22, 0.8, 0.3 + R() * 0.6);
    }
  }
}

/** Shot striking a hull: splinters, a puff of fire and smoke, sparks. */
export function hitShip(fx, x, y, z) {
  const B = vfxBudget();
  const ns = budgetCount(12, 6);
  for (let i = 0; i < ns; i++) {
    const a = R() * TAU, h = 2.5 + R() * 5.0;
    fx.debris.emit(x, y + 0.2, z, Math.cos(a) * h, 2.5 + R() * 5.5, Math.sin(a) * h, 2.2 + R() * 1.2, 0, 1.0, R() * 0.3);
  }
  if (B.debrisFloat) {
    for (let i = 0; i < 2; i++) {
      const a = R() * TAU, h = 1.5 + R() * 2.5;
      fx.debris.emit(x, y + 0.3, z, Math.cos(a) * h, 3 + R() * 3, Math.sin(a) * h, 9 + R() * 5, 1, 0.75, R() * 0.4);
    }
  }
  const nk = budgetCount(10, 5);
  for (let i = 0; i < nk; i++) {
    const a = R() * TAU, h = 3 + R() * 7;
    fx.spark.emit(x, y + 0.3, z, Math.cos(a) * h, 2 + R() * 6, Math.sin(a) * h, 0.3 + R() * 0.4, 0.05, 0.03, 1.2, -9, 1.0, 0.62, 0.22, 1.5);
  }
  for (let i = 0; i < 4; i++) {
    fx.flame.emit(x + (R() - 0.5) * 0.4, y + 0.3, z + (R() - 0.5) * 0.4, (R() - 0.5) * 2, 1.5 + R() * 1.5, (R() - 0.5) * 2,
      0.22 + R() * 0.12, 0.35, 1.05, 3, 1, 0.95, 0.9, 0);
  }
  const nsm = budgetCount(3, 1);
  for (let i = 0; i < nsm; i++) {
    fx.smoke.emit(x + (R() - 0.5) * 0.4, y + 0.4, z + (R() - 0.5) * 0.4, (R() - 0.5) * 1.5, 1.0 + R(), (R() - 0.5) * 1.5,
      (2.2 + R() * 1.4) * (B.lingerSmoke ? 1 : 0.6), 0.5, 2.0 + R() * 0.8, 1.6, 0.35, i ? 0.6 : 0.32, 0.42, 0.5, 0.02);
  }
  fx.lights.flash(x, y + 0.6, z, 3.5, 0.07);
}

/** Shot striking stone/earth (forts, buildings, ground): chips + dust. */
export function hitStone(fx, x, y, z, big = false) {
  const nc = budgetCount(big ? 12 : 7, 3);
  for (let i = 0; i < nc; i++) {
    const a = R() * TAU, h = 2 + R() * 4;
    fx.debris.emit(x, y + 0.2, z, Math.cos(a) * h, 3 + R() * 4, Math.sin(a) * h, 0.55 + R() * 0.35, 0, 1.2, 0, 0, 0x8a8478);
  }
  const nd = budgetCount(big ? 4 : 2, 1);
  for (let i = 0; i < nd; i++) {
    fx.smoke.emit(x + (R() - 0.5) * 0.8, y + 0.2, z + (R() - 0.5) * 0.8, (R() - 0.5) * 2, 0.8 + R(), (R() - 0.5) * 2,
      2.2 + R() * 1.5, 0.6, 2.6 + R(), 1.8, 0.25, 0.66, 0.40, 0.0);
  }
  const nk = budgetCount(8, 4);
  for (let i = 0; i < nk; i++) {
    const a = R() * TAU, h = 2 + R() * 6;
    fx.spark.emit(x, y + 0.3, z, Math.cos(a) * h, 2 + R() * 5, Math.sin(a) * h, 0.25 + R() * 0.3, 0.045, 0.03, 1.2, -9, 1.0, 0.68, 0.3, 1.4);
  }
  for (let i = 0; i < 3; i++) {
    fx.flame.emit(x, y + 0.3, z, (R() - 0.5) * 2, 1 + R() * 2, (R() - 0.5) * 2, 0.2 + R() * 0.1, 0.4, 1.1, 3, 1, 0.9, 0.8, 0);
  }
  fx.lights.flash(x, y + 0.8, z, big ? 5 : 3, 0.07);
}

/** Generic blast (mines, Deadman's Lure, magazine): fire, smoke column, debris. */
export function blast(fx, x, y, z, scale = 1, wy = 0) {
  const nf = budgetCount(22, 10);
  for (let i = 0; i < nf; i++) {
    const a = R() * TAU, e = R() * 1.2, s = (3 + R() * 5) * scale;
    fx.flame.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1.5, Math.sin(a) * Math.cos(e) * s,
      0.5 + R() * 0.5, 0.8 * scale, (2.0 + R() * 1.2) * scale, 3.0, 1.6, 1.0, 0.85, 0);
  }
  const nk = budgetCount(28, 12);
  for (let i = 0; i < nk; i++) {
    const a = R() * TAU, s = 8 + R() * 12;
    fx.spark.emit(x, y, z, Math.cos(a) * s * 0.8, 3 + R() * 9, Math.sin(a) * s * 0.8, 0.7 + R() * 0.8, 0.06, 0.04, 0.7, -9, 1.0, 0.7, 0.3, 1.7);
  }
  const nsm = budgetCount(10, 5);
  for (let i = 0; i < nsm; i++) {
    const a = R() * TAU, s = 1 + R() * 2.5;
    fx.smoke.emit(x + Math.cos(a) * 0.5, y + 0.3, z + Math.sin(a) * 0.5, Math.cos(a) * s, 1.5 + R() * 2.5, Math.sin(a) * s,
      (4 + R() * 3) * vfxBudget().smokeLife, 1.0 * scale, (3.6 + R() * 2) * scale, 1.2, 0.7, 0.18 + R() * 0.2, 0.55, 1.0, R() * 0.15);
  }
  fx.decals.emit(x, wy + 0.08, z, 2, 0.4, 6 * scale, 0.45, 0.55);
  fx.lights.flash(x, y + 1, z, 9 * scale, 0.18, 0, 0xff8a30);
}

/**
 * Ship blowing up: fireball, flash, staggered secondary blasts (delayed
 * records — no timers), wreckage flung out, a dark column, spray and a shock
 * ring. Returns the secondary blast times so the caller can schedule shakes.
 * @returns {number[]} delays (s) of the secondary blasts
 */
export function shipExplosion(fx, x, y, z, scale = 1, wy = 0) {
  const B = vfxBudget();
  fx.fireball.spawn(x, y + 0.5, z, 0.9 * scale);
  fx.lights.flash(x, y + 1.2, z, 11, 0.20, 0, 0xff8a30);
  blast(fx, x, y + 0.4, z, 1.0 * scale, wy);
  // secondary powder blasts along the hull
  const delays = [];
  const n2 = Math.max(2, Math.round((5 + R() * 3) * B.emit));
  for (let i = 0; i < n2; i++) {
    const d = 0.12 + R() * 0.9, ox = (R() - 0.5) * 3.2 * scale, oz = (R() - 0.5) * 3.2 * scale;
    delays.push(d);
    const nf = budgetCount(9, 4);
    for (let k = 0; k < nf; k++) {
      const a = R() * TAU, s = 2 + R() * 4;
      fx.flame.emit(x + ox, y + 0.3, z + oz, Math.cos(a) * s, 1.5 + R() * 3, Math.sin(a) * s, 0.35 + R() * 0.4, 0.5, 1.5 + R(), 3, 1.5, 1.0, 0.85, 0, d);
    }
    const nk = budgetCount(10, 4);
    for (let k = 0; k < nk; k++) {
      const a = R() * TAU, s = 6 + R() * 10;
      fx.spark.emit(x + ox, y + 0.3, z + oz, Math.cos(a) * s * 0.7, 2 + R() * 7, Math.sin(a) * s * 0.7, 0.5 + R() * 0.6, 0.05, 0.04, 0.8, -9, 1.0, 0.68, 0.28, 1.6, d);
    }
    fx.smoke.emit(x + ox, y + 0.6, z + oz, 0, 1.2, 0, (3.5 + R() * 2) * B.smokeLife, 0.9, 3.2, 1.5, 0.6, 0.22, 0.5, 1.0, d);
    fx.lights.flash(x + ox, y + 1, z + oz, 4.5, 0.10, d);
  }
  // wreckage
  const np = budgetCount(14, 6);
  for (let i = 0; i < np; i++) {
    const a = R() * TAU, h = (2 + R() * 6) * scale, vy = 4 + R() * 8;
    const kind = R() < 0.12 ? 2 : 1;
    const life = B.debrisFloat ? 12 + R() * 8 : 3 + R() * 2;
    fx.debris.emit(x, y + 0.6, z, Math.cos(a) * h, vy, Math.sin(a) * h, life, kind, 0.85 + R() * 0.5, 0.35 + R() * 0.5);
    if (i < 6) {
      const hit = DebrisField.impact(x, y + 0.6, z, Math.cos(a) * h, vy, Math.sin(a) * h);
      fx.spray.puff(hit.x, wy + 0.1, hit.z, 0, 3.5, 0, 0.6, 0.25, 0.8, 0.5, -14, 0.6, hit.t);
      fx.decals.emit(hit.x, wy + 0.05, hit.z, 0, 0.1, 1.4, 0.7, 0.7, 0.1, hit.t);
    }
  }
  const nsp = budgetCount(16, 8);
  for (let i = 0; i < nsp; i++) {
    const a = R() * TAU, h = 3 + R() * 6;
    fx.debris.emit(x, y + 0.5, z, Math.cos(a) * h, 3 + R() * 7, Math.sin(a) * h, 2 + R(), 0, 1.0, 0.6);
  }
  // water thrown up around the hull
  const nw = budgetCount(8, 4);
  for (let i = 0; i < nw; i++) {
    const a = R() * TAU, r = 1.2 * scale;
    fx.spray.puff(x + Math.cos(a) * r, wy + 0.1, z + Math.sin(a) * r, Math.cos(a) * 2, 6 + R() * 4, Math.sin(a) * 2,
      1.1 + R() * 0.4, 0.5, 1.6 + R() * 0.6, 0.5, -14, 0.7);
  }
  fx.decals.emit(x, wy + 0.06, z, 2, 0.5, 9 * scale, 0.45, 0.55);
  fx.decals.emit(x, wy + 0.05, z, 0, 0.5, 8 * scale, 1.6, 0.8, 0.05, 0.1);
  fx.decals.emit(x, wy + 0.04, z, 1, 1.0, 4.5 * scale, 7.0, 0.9);
  return delays;
}

/** Thin smoke wisp left by a flying cannonball. */
export function trailPuff(fx, x, y, z, vx, vy, vz) {
  fx.smoke.emit(x, y, z, vx * 0.04, 0.15, vz * 0.04, 0.6 + R() * 0.4, 0.14, 0.6 + R() * 0.25, 2.0, 0.2, 0.92, 0.26, 0.15);
}

/**
 * Bubbles + foam boiling up around a sinking hull (ellipse aligned to the
 * hull: half-length hl, half-beam hb, heading angle).
 */
export function sinkBubbles(fx, x, wy, z, angle, hl, hb, n = 3) {
  const s = Math.sin(angle), c = Math.cos(angle);
  for (let i = 0; i < n; i++) {
    const u = (R() * 2 - 1) * hl, v = (R() * 2 - 1) * hb * 1.4;
    const bx = x + s * u + c * v, bz = z + c * u - s * v;
    fx.spray.bubble(bx, wy + 0.07, bz, 0.8 + R() * 1.4, 0.10 + R() * 0.1, 0.28 + R() * 0.3, 0.85);
    if (R() < 0.25) fx.spray.droplet(bx, wy + 0.1, bz, (R() - 0.5) * 1.5, 1.5 + R() * 2, (R() - 0.5) * 1.5, 0.5, 0.04, 0.7);
  }
}
