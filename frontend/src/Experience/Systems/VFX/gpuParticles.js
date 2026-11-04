import * as THREE from 'three';
import { ENV, updatePointScale } from './env.js';

// ── Stateless GPU particle fields ──────────────────────────────────
// Every particle is fully described by its SPAWN record (position, birth
// time, velocity, life, size curve, drag, buoyancy, look). The vertex shader
// integrates the closed-form motion
//     v' = g − k (v − w)      →   p(t) = p0 + (g/k + w) t + (v0 − g/k − w)(1 − e^{−kt}) / k
// so the CPU never touches a live particle again: no per-frame loop, no
// per-frame upload, no allocation. Spawning writes one record into a fixed
// ring buffer (oldest record is overwritten when full) and widens a dirty
// range; three.js uploads only that range (bufferSubData) at the next render.
//
// One THREE.Points (one draw call) per field. Dead / unborn records are
// clipped in the vertex shader. A field hides itself when nothing is alive.
//
// Spawn records may carry a FUTURE birth time — staggered broadside ripples
// and secondary blasts are just delayed records, no timers needed.

/** Puff atlas (2×2 cells of 128²): RG = normal.xy, B = erosion noise, A = density. */
let _puffTex = null;
export function getPuffTexture() {
  if (_puffTex) return _puffTex;
  const CELL = 128, SIZE = CELL * 2;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const dens = new Float32Array(CELL * CELL);
  const hash = (x, y, s) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const vnoise = (x, y, s) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y, s) => vnoise(x, y, s) * 0.5 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.28
                          + vnoise(x * 4.3, y * 4.3, s + 2) * 0.14 + vnoise(x * 8.7, y * 8.7, s + 3) * 0.08;
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * CELL, oy = (cell >> 1) * CELL, seed = cell * 13 + 3;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const px = (x + 0.5) / CELL * 2 - 1, py = (y + 0.5) / CELL * 2 - 1;
        const r = Math.hypot(px, py);
        const n = fbm(px * 2.2 + 5, py * 2.2 + 9, seed);
        // lumpy cauliflower silhouette: noise pushes the edge in/out
        const edge = 1 - smooth(0.42, 1.0, r + (n - 0.5) * 0.62);
        const body = 0.55 + 0.45 * fbm(px * 3.7 + 1, py * 3.7 + 4, seed + 7);
        dens[y * CELL + x] = Math.max(0, Math.min(1, edge * body * 1.25));
      }
    }
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const d = (xx, yy) => dens[Math.min(CELL - 1, Math.max(0, yy)) * CELL + Math.min(CELL - 1, Math.max(0, xx))];
        const gx = (d(x + 2, y) - d(x - 2, y)) * 2.0, gy = (d(x, y + 2) - d(x, y - 2)) * 2.0;
        const px = (x + 0.5) / CELL * 2 - 1, py = (y + 0.5) / CELL * 2 - 1;
        // billow normal = sphere bulge + density relief
        let nx = px * 0.75 - gx, ny = py * 0.75 - gy, nz = 0.8;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l;
        const i = ((oy + y) * SIZE + ox + x) * 4;
        data[i]     = Math.round((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round(fbm(px * 3.1 + 11, py * 3.1 + 2, seed + 21) * 255);
        data[i + 3] = Math.round(dens[y * CELL + x] * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _puffTex = tex;
  return tex;
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Base class: a ring buffer of spawn records rendered as one THREE.Points.
 *
 * @param {object}   o
 * @param {THREE.Scene} o.scene
 * @param {number}   o.capacity   max records (fixed for the field's lifetime)
 * @param {Array<[string, number]>} o.layout  [attrName, itemSize] in record
 *                   order; must start with ['position', 3], ['aT0', 1]
 *                   (birth time lives at float offset 3 of every record).
 * @param {THREE.ShaderMaterial} o.material
 * @param {number}   o.renderOrder
 */
export class GpuParticleField {
  constructor({ scene, capacity, layout, material, renderOrder = 10, name = 'vfx' }) {
    this._scene    = scene;
    this.capacity  = capacity;
    this._limit    = capacity;          // active ring length (quality budget)
    this._head     = 0;
    this._aliveUntil = -1;              // VFX time when the last record dies
    let stride = 0;
    layout.forEach(([, n]) => { stride += n; });
    this.stride    = stride;
    this.data      = new Float32Array(capacity * stride);
    // park every record in the past so nothing renders before it is written
    for (let i = 0; i < capacity; i++) this.data[i * stride + 3] = -1e6;

    this._ib = new THREE.InterleavedBuffer(this.data, stride).setUsage(THREE.DynamicDrawUsage);
    this._dMin = -1; this._dMax = -1;
    const geo = new THREE.BufferGeometry();
    let off = 0;
    for (const [nm, n] of layout) {
      geo.setAttribute(nm, new THREE.InterleavedBufferAttribute(this._ib, n, off));
      off += n;
    }
    geo.setDrawRange(0, capacity);
    this.geometry = geo;
    this.material = material;
    this.points = new THREE.Points(geo, material);
    this.points.name = name;
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _scene, camera) => updatePointScale(renderer, camera);
    scene.add(this.points);
  }

  /** Use only the first `frac` of the ring (LOW budget). */
  setBudget(frac) {
    this._limit = Math.max(16, Math.floor(this.capacity * Math.min(1, Math.max(0.05, frac))));
    if (this._head >= this._limit) this._head = 0;
    this.geometry.setDrawRange(0, this._limit);
  }

  /**
   * Reserve the next ring slot and return its float offset into `data`.
   * Caller writes `stride` floats, then calls `_commit(i, deathTime)`.
   */
  _next() {
    const i = this._head;
    this._head = (i + 1) % this._limit;
    return i;
  }

  _commit(i, death) {
    if (death > this._aliveUntil) this._aliveUntil = death;
    const ur = this._ib.updateRange;
    // three.js resets count to -1 after a ranged upload → start a new range
    if (ur.count === -1 || this._dMin < 0) { this._dMin = i; this._dMax = i; }
    else { if (i < this._dMin) this._dMin = i; if (i > this._dMax) this._dMax = i; }
    ur.offset = this._dMin * this.stride;
    ur.count  = (this._dMax - this._dMin + 1) * this.stride;
    this._ib.needsUpdate = true;
    this.points.visible = true;
  }

  /** Per-frame: hide the draw call once every record is dead. */
  tick(now) {
    if (this.points.visible && now > this._aliveUntil + 0.05) this.points.visible = false;
  }

  /** Kill every record (scene reset). */
  clear() {
    for (let i = 0; i < this.capacity; i++) this.data[i * this.stride + 3] = -1e6;
    this._ib.updateRange.offset = 0; this._ib.updateRange.count = -1;
    this._ib.needsUpdate = true;
    this._aliveUntil = -1;
  }

  destroy() {
    this._scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Common uniforms every point field shares (by reference → one write/frame). */
export function sharedPointUniforms(extra = {}) {
  return {
    uTime: ENV.uTime, uPxScale: ENV.uPxScale, uViewport: ENV.uViewport, uMaxPx: ENV.uMaxPx,
    uSunDir: ENV.uSunDir, uSunCol: ENV.uSunCol, uAmbCol: ENV.uAmbCol,
    uFogCol: ENV.uFogCol, uFogDensity: ENV.uFogDensity, uWind: ENV.uWind, uSoft: ENV.uSoft,
    ...extra,
  };
}
