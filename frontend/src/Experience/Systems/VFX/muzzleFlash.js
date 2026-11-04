import * as THREE from 'three';
import { ENV } from './env.js';
import { GLSL_HASH, GLSL_FIRE_RAMP } from './glsl.js';
import { vfxBudget, budgetCount } from './quality.js';

// ── Muzzle flashes ─────────────────────────────────────────────────
// MuzzleFlashSystem.discharge() is ONE gun firing:
//   • a directional flame jet (instanced crossed planes — one draw call for
//     every flash on screen, replacing 4 per-slot meshes + materials)
//   • a white-hot core puff + a fan of sparks
//   • the lingering gun-smoke: puffs blasted out of the port that decelerate
//     hard (drag), swell, rise a little and then drift down-wind for several
//     seconds — a full broadside leaves the classic smoke bank along the hull
// Point lights are NOT per gun: the caller fires one FlashLights flash per
// volley (see VFX.fireBall).

const CAP = 48;
const STRIDE = 8;
const DUR = 0.2;
const R = Math.random;

const VERT = /* glsl */`
uniform float uTime;
attribute vec3 aUVA;   // axial 0..1, across 0..1, plane (0 vertical · 1 horizontal)
attribute vec4 aO;     // origin xyz, t0
attribute vec4 aD;     // dir x/z, length, spread
varying vec2 vUv;
varying float vProg;
varying float vSeed;
void main(){
  float age = uTime - aO.w;
  if (age < 0.0 || age >= ${DUR.toFixed(3)}) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float prog = age / ${DUR.toFixed(3)};
  float axial = aUVA.x, across = aUVA.y * 2.0 - 1.0;
  float len = aD.z * (0.55 + 0.55 * smoothstep(0.0, 0.18, prog));
  float wid = axial * aD.w * len * (1.0 - prog * 0.35);
  vec3 f = vec3(aD.x, 0.0, aD.y);
  vec3 dirAcross = aUVA.z < 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(-aD.y, 0.0, aD.x);
  float wob = sin(axial * 9.0 + age * 55.0 + aO.x * 3.1) * 0.10 * axial * (1.0 - axial);
  vec3 wp = aO.xyz + f * (axial * len) + dirAcross * (across * wid + wob * len);
  wp.y += axial * axial * len * 0.06;          // hot gas lifts a touch
  vUv = vec2(axial, aUVA.y); vProg = prog; vSeed = fract(aO.x * 0.37 + aO.z * 0.91);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = GLSL_HASH + GLSL_FIRE_RAMP + /* glsl */`
varying vec2 vUv;
varying float vProg;
varying float vSeed;
void main(){
  float axial = vUv.x, crossN = abs(vUv.y - 0.5) * 2.0;
  float cone = 1.0 - smoothstep(0.35, 1.0, crossN);
  float tip  = 1.0 - smoothstep(0.55, 1.0, axial);
  float n = vfxNoise(vec2(axial * 7.0 - vProg * 16.0, vUv.y * 6.0 + vSeed * 20.0));
  float flame = cone * tip * (0.5 + 0.5 * n) * (1.0 - smoothstep(0.3, 1.0, vProg));
  flame *= 1.0 + (1.0 - smoothstep(0.0, 0.22, vProg)) * 0.9;
  if (flame < 0.02) discard;
  float heat = flame * (1.15 - axial * 0.55) * (1.0 - crossN * 0.4);
  vec3 col = vfxFireRamp(heat) * (1.35 + heat);
  gl_FragColor = vec4(col, clamp(flame, 0.0, 1.0));
}`;

function buildConeGeometry() {
  const AX = 12, AC = 4;
  const uva = [], idx = [];
  for (let plane = 0; plane < 2; plane++) {
    const base = uva.length / 3;
    for (let i = 0; i <= AX; i++) for (let j = 0; j <= AC; j++) uva.push(i / AX, j / AC, plane);
    for (let i = 0; i < AX; i++) for (let j = 0; j < AC; j++) {
      const a = base + i * (AC + 1) + j, b = a + AC + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  const arr = new Float32Array(uva);
  g.setAttribute('aUVA', new THREE.BufferAttribute(arr, 3));
  // three.js needs a `position` attribute to size the draw; aUVA doubles as it
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.setIndex(idx);
  return g;
}

/** Instanced flame jets + per-gun discharge recipe. */
export class MuzzleFlashSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {{flame, smoke, spark, spray, decals}} fx particle fields
   */
  constructor(scene, fx) {
    this._scene = scene;
    this._fx = fx;
    this._head = 0;
    this._aliveUntil = -1;
    const geo = buildConeGeometry();
    this.data = new Float32Array(CAP * STRIDE);
    for (let i = 0; i < CAP; i++) this.data[i * STRIDE + 3] = -1e6;
    this._ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aO', new THREE.InterleavedBufferAttribute(this._ib, 4, 0));
    geo.setAttribute('aD', new THREE.InterleavedBufferAttribute(this._ib, 4, 4));
    geo.instanceCount = CAP;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: ENV.uTime },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'vfx-muzzle';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 28;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._dMin = -1; this._dMax = -1;
  }

  /** Flame jet only. */
  cone(x, y, z, dx, dz, length = 2.6, spread = 0.42, delay = 0) {
    const i = this._head; this._head = (i + 1) % CAP;
    const d = this.data, o = i * STRIDE, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = dx; d[o + 5] = dz; d[o + 6] = length; d[o + 7] = spread;
    if (t0 + DUR > this._aliveUntil) this._aliveUntil = t0 + DUR;
    const ur = this._ib.updateRange;
    if (ur.count === -1 || this._dMin < 0) { this._dMin = i; this._dMax = i; }
    else { if (i < this._dMin) this._dMin = i; if (i > this._dMax) this._dMax = i; }
    ur.offset = this._dMin * STRIDE; ur.count = (this._dMax - this._dMin + 1) * STRIDE;
    this._ib.needsUpdate = true;
    this.mesh.visible = true;
  }

  /**
   * One gun discharging. (dx, dz) must be a unit vector.
   * @param {number} scale 1 = ship gun, >1 = fort / heavy gun
   * @param {number} delay seconds (broadside ripple)
   */
  discharge(x, y, z, dx, dz, scale = 1, delay = 0) {
    const fx = this._fx, B = vfxBudget();
    const sx = -dz, sz = dx;                         // horizontal side vector
    this.cone(x, y, z, dx, dz, 2.5 * scale, 0.40, delay);
    // white-hot core
    fx.flame.emit(x + dx * 0.25, y, z + dz * 0.25, dx * 5, 0.4, dz * 5, 0.13, 0.7 * scale, 1.5 * scale, 6, 0, 1.0, 0.95, 0, delay);
    fx.flame.emit(x + dx * 0.8, y + 0.05, z + dz * 0.8, dx * 7, 0.6, dz * 7, 0.17, 0.5 * scale, 1.2 * scale, 5, 0.5, 0.85, 0.8, 0, delay);
    // sparks / burning wadding
    const ns = budgetCount(6, 2);
    for (let k = 0; k < ns; k++) {
      const s = 9 + R() * 9, side = (R() - 0.5) * 0.5, up = (R() - 0.2) * 0.25;
      fx.spark.emit(x, y, z, (dx + sx * side) * s, up * s, (dz + sz * side) * s,
        0.22 + R() * 0.25, 0.045, 0.035, 1.4, -6, 1.0, 0.72, 0.32, 1.6, delay);
    }
    // gun smoke — the lingering broadside bank: a thick white cloud bursts
    // from the port, decelerates hard, swells, then drifts down-wind
    const linger = B.lingerSmoke;
    const nb = budgetCount(6, 3);
    for (let k = 0; k < nb; k++) {
      const s = 4 + R() * 10, side = (R() - 0.5) * 0.6, up = 0.04 + R() * 0.22;
      const life = linger ? (6.0 + R() * 4.0) * B.smokeLife : 3.0 + R() * 1.2;
      fx.smoke.emit(x + dx * 0.3, y + (R() - 0.5) * 0.15, z + dz * 0.3,
        (dx + sx * side) * s, up * s, (dz + sz * side) * s,
        life, 0.9 * scale, (3.6 + R() * 2.0) * scale, 3.0, 0.10, 0.86 + R() * 0.1, 0.62, 0.35, delay + R() * 0.03);
    }
    // slow cloud hanging along the hull at the port
    fx.smoke.emit(x + dx * 0.6, y + 0.1, z + dz * 0.6, dx * 1.6 + sx * (R() - 0.5), 0.4, dz * 1.6 + sz * (R() - 0.5),
      linger ? (8.0 + R() * 3.0) * B.smokeLife : 3.6, 1.2 * scale, 5.2 * scale, 1.4, 0.08, 0.92, 0.48, 0.25, delay + 0.04);
    // pressure ring flattening the water under the port (HIGH only)
    if (B.softParticles && fx.decals && y < 3) fx.decals.emit(x + dx * 0.9, 0.08, z + dz * 0.9, 0, 0.3, 2.2 * scale, 0.55, 0.5, 0.10, delay);
  }

  /** Back-compat: legacy MuzzleFlashPool.fire({ position, direction }). */
  fire(opts = {}) {
    const p = opts.position, d = opts.direction;
    let dx = d ? d.x : 0, dz = d ? d.z : 1;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    this.discharge(p ? p.x : 0, p ? p.y : 1, p ? p.z : 0, dx, dz, (opts.length || 2.6) / 2.6);
  }

  tick(now) { if (this.mesh.visible && now > this._aliveUntil + 0.05) this.mesh.visible = false; }

  destroy() {
    this._scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** @deprecated name kept for imports — use MuzzleFlashSystem. */
export const MuzzleFlashPool = MuzzleFlashSystem;
