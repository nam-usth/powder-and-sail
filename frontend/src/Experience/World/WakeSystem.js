import * as THREE from 'three';
// ── WAKE SYSTEM ──────────────────────────────────────────────────
// V-shaped foam wake behind every moving ship.
// AW upgrade: ShaderMaterial with procedural noise foam —
//   - Bright white prop-wash core along hull centerline
//   - Hash-noise foam patches on V-arms
//   - Time-animated foam drifting backward from ship
//   - Proper V-wake geometry: narrow at stern, spreads outward

import { getWaveHeight } from './Ocean.js';

const WAKE_SEGS  = 30;    // cross-sections along trail
const WAKE_WIDTH = 2.4;   // max V half-width (world units)
const WAKE_LIFE  = 2.6;   // seconds to fully fade
const MIN_SPEED  = 0.008; // skip wake if barely moving

// ── Vertex shader ─────────────────────────────────────────────────
const WAKE_VERT = /* glsl */`
attribute vec3 color;   // .r = per-vertex fade factor
attribute vec2 aUv;     // (u=trail progress 0→1, v=side 0=left→1=right)

varying vec2  vUv;
varying float vFade;

void main() {
  vUv   = aUv;
  vFade = color.r;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ── Fragment shader — procedural foam ────────────────────────────
const WAKE_FRAG = /* glsl */`
uniform float uTime;

varying vec2  vUv;
varying float vFade;

// ── Value noise ──────────────────────────────────────────────────
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 17.5);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),               hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  float u = vUv.x;        // 0 = fresh (stern), 1 = old (tip)
  float v = vUv.y;        // 0 = left edge, 0.5 = center, 1 = right edge

  // Age-based fade (non-linear — keep stern white, tip vanishes quickly)
  float ageFade = pow(1.0 - u, 1.3) * vFade;

  // ── Prop-wash core ────────────────────────────────────────────
  // Bright white strip along the hull center-line (prop turbulence)
  float center  = 1.0 - abs(v - 0.5) * 2.0;   // 1.0 at v=0.5, 0 at edges
  float propCore = pow(center, 1.8);

  // ── Animated foam noise ───────────────────────────────────────
  // Pattern drifts backward (increasing u) over time — foam moves away from ship
  float nu = u * 7.0 - uTime * 0.45;
  float nv = (v - 0.5) * 5.0;

  float n1 = vnoise(vec2(nu,              nv));
  float n2 = vnoise(vec2(nu * 1.8 + 3.1, nv * 1.4 + 2.0));
  float n3 = vnoise(vec2(nu * 0.6 - 1.4, nv * 2.1 + 0.7));
  float foam = n1 * 0.50 + n2 * 0.30 + n3 * 0.20;

  // ── V-arm spray ───────────────────────────────────────────────
  // Foam patches concentrated on the V-wake arms (away from center)
  float armMask  = smoothstep(0.25, 0.65, abs(v - 0.5) * 2.0);
  float armFoam  = smoothstep(0.38, 0.68, foam) * armMask;

  // ── Center foam texture ───────────────────────────────────────
  float centreFoam = smoothstep(0.28, 0.55, foam) * propCore;

  // ── Combine ───────────────────────────────────────────────────
  float finalFoam = max(propCore * 0.85 + centreFoam * 0.35, armFoam * 0.80);
  finalFoam *= ageFade;

  // Discard nearly-invisible fragments (saves fillrate)
  if (finalFoam < 0.006) discard;

  // Color: pure white foam with faint blue ocean reflection
  vec3 col = mix(vec3(0.72, 0.88, 1.00), vec3(1.0, 1.0, 1.0), clamp(finalFoam * 1.5, 0.0, 1.0));

  gl_FragColor = vec4(col, finalFoam * 0.88);
}
`;

// ─────────────────────────────────────────────────────────────────
export class WakeSystem {
  constructor(scene) {
    this._scene  = scene;
    this._trails = new Map();
  }

  addShip(ship) {
    if (this._trails.has(ship)) return;
    this._trails.set(ship, new WakeTrail(this._scene, WAKE_SEGS, WAKE_WIDTH));
  }

  removeShip(ship) {
    const trail = this._trails.get(ship);
    if (trail) { trail.destroy(this._scene); this._trails.delete(ship); }
  }

  update(dt, t) {
    for (const [ship, trail] of this._trails) {
      if (!ship.alive) { trail.clear(); continue; }
      trail.update(ship, dt, t, (ship.speed || 0) > MIN_SPEED);
    }
  }

  destroy() {
    for (const [, trail] of this._trails) trail.destroy(this._scene);
    this._trails.clear();
  }
}

// ── Single ship foam ribbon ───────────────────────────────────────
class WakeTrail {
  constructor(scene, segs, baseWidth) {
    this._segs      = segs;
    this._baseWidth = baseWidth;
    this._points    = [];
    this._age       = [];
    this._timer     = 0;

    const vCount = segs * 2;
    const geo    = new THREE.BufferGeometry();
    this._pos    = new Float32Array(vCount * 3);
    this._col    = new Float32Array(vCount * 3);  // .r = fade factor
    this._uv     = new Float32Array(vCount * 2);  // (u, v)

    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(this._col, 3));
    geo.setAttribute('aUv',      new THREE.BufferAttribute(this._uv,  2));

    // Triangle strip
    const idx = [];
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c,  b, d, c);
    }
    geo.setIndex(idx);

    this._uTime = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms:       { uTime: this._uTime },
      vertexShader:   WAKE_VERT,
      fragmentShader: WAKE_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      fog:            false,
    });

    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.renderOrder = 2;
    scene.add(this._mesh);
    this._geo = geo;
  }

  update(ship, dt, t, moving) {
    this._uTime.value = t;

    // Sample ship position every 0.07s while moving
    this._timer += dt;
    if (moving && this._timer > 0.07) {
      this._timer = 0;
      this._points.unshift({ x: ship.x, z: ship.z, angle: ship.angle });
      this._age.unshift(0);
      if (this._points.length > this._segs) {
        this._points.pop();
        this._age.pop();
      }
    }

    this._mesh.visible = this._points.length >= 3;

    // Age all stored points
    for (let i = 0; i < this._age.length; i++) this._age[i] += dt;

    const n   = this._points.length;
    const pos = this._pos;
    const col = this._col;
    const uv  = this._uv;

    for (let i = 0; i < this._segs; i++) {
      const vi = i * 6;   // position buffer offset (2 verts × 3 floats)
      const ci = i * 6;   // color buffer offset
      const ui = i * 4;   // uv buffer offset (2 verts × 2 floats)
      const u  = i / (this._segs - 1);   // 0=stern(newest) → 1=tip(oldest)

      if (i >= n) {
        // No data yet — collapse to ship position (avoids fan from origin)
        const sy = getWaveHeight(ship.x, ship.z, t) + 0.04;
        pos[vi]   = ship.x; pos[vi+1] = sy; pos[vi+2] = ship.z;
        pos[vi+3] = ship.x; pos[vi+4] = sy; pos[vi+5] = ship.z;
        col[ci] = col[ci+1] = col[ci+2] = 0;
        col[ci+3] = col[ci+4] = col[ci+5] = 0;
        uv[ui]   = u; uv[ui+1] = 0.0;
        uv[ui+2] = u; uv[ui+3] = 1.0;
        continue;
      }

      const p        = this._points[i];
      const lifeFrac = Math.max(0, 1 - this._age[i] / WAKE_LIFE);

      // V-wake geometry: narrow at stern (hull beam), spreads wider behind.
      // At i=0: only prop-wash width (~35% base). At i=segs-1: full V spread.
      const spread = this._baseWidth * (0.35 + 0.65 * (i / this._segs));

      // Perpendicular arms
      const perp = p.angle + Math.PI / 2;
      const lx   = p.x + Math.sin(perp) * spread;
      const lz   = p.z + Math.cos(perp) * spread;
      const rx   = p.x - Math.sin(perp) * spread;
      const rz   = p.z - Math.cos(perp) * spread;

      // Follow wave surface
      const ly = getWaveHeight(lx, lz, t) + 0.04;
      const ry = getWaveHeight(rx, rz, t) + 0.04;

      pos[vi]   = lx; pos[vi+1] = ly; pos[vi+2] = lz;
      pos[vi+3] = rx; pos[vi+4] = ry; pos[vi+5] = rz;

      // Fade factor carried via color.r (shader reads it as vFade)
      col[ci]   = lifeFrac; col[ci+1] = 0; col[ci+2] = 0;
      col[ci+3] = lifeFrac; col[ci+4] = 0; col[ci+5] = 0;

      // UV: u along trail, v = 0 (left) or 1 (right)
      uv[ui]   = u; uv[ui+1] = 0.0;
      uv[ui+2] = u; uv[ui+3] = 1.0;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate    = true;
    this._geo.attributes.aUv.needsUpdate      = true;
    this._geo.computeBoundingSphere();
  }

  clear() {
    this._points.length = 0;
    this._age.length    = 0;
    this._pos.fill(0);
    this._col.fill(0);
    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.color.needsUpdate    = true;
    this._geo.attributes.aUv.needsUpdate      = true;
  }

  destroy(scene) {
    scene.remove(this._mesh);
    this._geo.dispose();
    this._mesh.material.dispose();
  }
}
