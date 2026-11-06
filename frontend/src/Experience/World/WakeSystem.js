import * as THREE from 'three';
import { ENV } from '../Systems/VFX/env.js';
import { GLSL_HASH, GLSL_WAVE, GLSL_FOG } from '../Systems/VFX/glsl.js';
import { gfx } from '../Render/GfxQuality.js';

// ── WAKE SYSTEM ──────────────────────────────────────────────────
// Foam left by every ship under way, built like the real thing:
//   • Kelvin arms — two thin foam crests diverging from the hull at the
//     Kelvin angle (19.5°, tan ≈ 0.354): half-width = beam/2 + 0.354 · s,
//     s = distance sailed since that point of the wake was laid
//   • turbulent wash — the churned centre strip behind the stern, widening
//     and breaking into patches as it ages
//   • bow wave — a foam "moustache" pushed off the stem, scaled by speed
// Foam texture is sampled in WORLD space, so it stays where it was laid
// while the ship sails on (no sliding pattern).
//
//   • contact shadow (ships2) — a soft dark ellipse under the hull (water
//     AO), drawn FIRST in the same mesh, so it costs no extra draw call
// GFX LOW draws the shadow, the bow wave and the newest half of the trail
// (setDrawRange — same buffers, no reallocation).
//
// Cost model: the CPU only writes x/z + birth time per cross-section
// (≈ 1 KB per ship per frame, no allocation); the vertex shader computes the
// wave height (mirrored swell, glsl.js) and the fade from age. One small mesh
// per ship, frustum culling off (it spans the whole trail).

const SEGS       = 40;     // cross-sections in a trail (incl. the live head)
const SAMPLE_DT  = 0.08;   // s between committed samples → ≈ 3.1 s of wake
const WAKE_LIFE  = 3.2;    // s for a cross-section to fade out
const MIN_SPEED  = 0.008;  // below this the ship lays no new wake
const KELVIN_TAN = 0.354;
const BOW_SECTS  = 5;

const VERT = GLSL_FOG + GLSL_WAVE + /* glsl */`
uniform float uTime, uFogDensity;
attribute vec4 aW;      // across (-1..1), kind (0 wash · 1 arm · 2 bow · 3 shadow), birth t | along, strength
varying vec4 vW;        // across, kind, age frac, strength
varying vec2 vXZ;
varying float vFog;
void main(){
  float age = uTime - aW.z;
  float x = clamp(age / ${WAKE_LIFE.toFixed(2)}, 0.0, 1.0);
  vec3 p = position;
  p.y = vfxWaveH(p.xz, uTime) + (aW.y > 2.5 ? 0.07 : 0.05 + (aW.y > 1.5 ? 0.04 : 0.0));
  vW = vec4(aW.x, aW.y, aW.y > 2.5 ? aW.z : aW.y > 1.5 ? 0.0 : x, aW.w);
  vXZ = p.xz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFog = vfxFog(-mv.z, uFogDensity);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = GLSL_HASH + /* glsl */`
uniform float uTime;
uniform vec3 uSunCol, uAmbCol, uFogCol;
varying vec4 vW;
varying vec2 vXZ;
varying float vFog;
void main(){
  float x = vW.z, kind = vW.y, ac = abs(vW.x);
  if (kind > 2.5) {                                   // contact shadow / water AO under the hull
    float r = length(vec2(vW.x, vW.z));
    float s = 1.0 - smoothstep(0.45, 1.0, r);
    s *= vW.w * (1.0 - vFog);
    if (s < 0.01) discard;
    gl_FragColor = vec4(0.0, 0.025, 0.04, s * 0.5);
    return;
  }
  float n  = vfxFbm(vXZ * 1.15 + vec2(3.1, uTime * 0.04));
  float n2 = vfxNoise(vXZ * 4.2 + vec2(uTime * 0.11, -uTime * 0.07));
  float a;
  if (kind < 0.5) {                                   // churned centre wash
    float core = 1.0 - smoothstep(0.15, 1.0, ac);
    float thr = 0.20 + x * 0.62;
    a = smoothstep(thr, thr + 0.22, n * 0.65 + n2 * 0.35 + core * 0.30) * core * (1.0 - x * x);
    a = max(a, (1.0 - smoothstep(0.0, 0.35, x)) * core * 0.75);   // fresh prop-wash is solid white
  } else if (kind < 1.5) {                            // Kelvin arm crest
    float line = 1.0 - smoothstep(0.0, 1.0, ac);
    float thr = 0.30 + x * 0.55;
    a = line * smoothstep(thr, thr + 0.2, n2 * 0.55 + n * 0.45 + line * 0.3) * (1.0 - x) * 1.25;
  } else {                                            // bow wave
    float line = 1.0 - smoothstep(0.1, 1.0, ac);
    a = line * smoothstep(0.20, 0.55, n2 * 0.6 + n * 0.4 + line * 0.35) * 1.2;
  }
  a *= vW.w;
  if (a < 0.01) discard;
  vec3 foam = vec3(0.93, 0.97, 1.0) * (uAmbCol * 1.2 + uSunCol * 0.78);   // ships2: brighter foam
  foam = mix(foam, uFogCol, vFog);
#if defined( TONE_MAPPING )
  foam = toneMapping(foam);
#endif
  gl_FragColor = vec4(foam, min(a, 1.0) * 0.95);
}`;

let _material = null;
const _uTime = { value: 0 };
function wakeMaterial() {
  if (_material) return _material;
  _material = new THREE.ShaderMaterial({
    uniforms: { uTime: _uTime, uFogDensity: ENV.uFogDensity, uFogCol: ENV.uFogCol, uSunCol: ENV.uSunCol, uAmbCol: ENV.uAmbCol },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  return _material;
}

// ─────────────────────────────────────────────────────────────────
export class WakeSystem {
  constructor(scene) {
    this._scene  = scene;
    this._trails = new Map();
  }

  addShip(ship) {
    if (this._trails.has(ship)) return;
    this._trails.set(ship, new WakeTrail(this._scene));
  }

  removeShip(ship) {
    const trail = this._trails.get(ship);
    if (trail) { trail.destroy(this._scene); this._trails.delete(ship); }
  }

  update(dt, t) {
    _uTime.value = t;
    for (const [ship, trail] of this._trails) {
      if (!ship.alive) { trail.clear(); continue; }
      trail.update(ship, dt, t);
    }
  }

  destroy() {
    for (const [, trail] of this._trails) trail.destroy(this._scene);
    this._trails.clear();
  }
}

// ── One ship's foam (wash + two Kelvin arms + bow wave) ──────────
// Vertex layout per trail cross-section i (6 verts):
//   wash L/R · port arm in/out · starboard arm in/out
// followed by the bow wave: BOW_SECTS × 2 sides × 2 verts.
class WakeTrail {
  constructor(scene) {
    this._ring = new Float32Array(SEGS * 5);   // x, z, angle, t0, strength
    this._head = 0; this._count = 0; this._timer = 0;
    this._dist = new Float32Array(SEGS);

    const nTrail = SEGS * 6, nBow = BOW_SECTS * 4;
    this._nTrail = nTrail;
    this._vShadow = nTrail + nBow;
    this._pos = new Float32Array((nTrail + nBow + 4) * 3);
    this._w   = new Float32Array((nTrail + nBow + 4) * 4);
    // index order = draw order: contact shadow, bow wave, then the trail
    // newest → oldest (so LOW can cut the old half with a draw range)
    const idx = [];
    const sv = this._vShadow;
    idx.push(sv, sv + 1, sv + 2, sv, sv + 2, sv + 3);
    for (let s = 0; s < 2; s++) for (let i = 0; i < BOW_SECTS - 1; i++) {
      const a = nTrail + (s * BOW_SECTS + i) * 2, b = a + 2;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    this._idxHead = idx.length;
    for (let i = 0; i < SEGS - 1; i++) {
      const a = i * 6, b = (i + 1) * 6;
      for (const o of [0, 2, 4]) idx.push(a + o, a + o + 1, b + o + 1, a + o, b + o + 1, b + o);
    }
    this._idxAll = idx.length;
    this._idxLow = this._idxHead + Math.floor((SEGS - 1) * 0.5) * 18;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aW', new THREE.BufferAttribute(this._w, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this._geo = geo;
    this._mesh = new THREE.Mesh(geo, wakeMaterial());
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 2;          // after the ocean, before decals/particles
    this._mesh.visible = false;
    scene.add(this._mesh);
  }

  update(ship, dt, t) {
    this._geo.setDrawRange(0, gfx.high ? this._idxAll : this._idxLow);
    const hi = ship.mesh?.userData?.hullInfo;
    const sc = ship.sc || 1;
    const hl = hi?.hl ?? 2.3 * sc, hb = hi?.hb ?? 0.7 * sc;
    const a = ship.angle || 0, fx = Math.sin(a), fz = Math.cos(a);
    const maxS = Math.max(0.05, ship.maxSpeed || ship.baseSpd || 0.15);
    const strength = Math.min(1, Math.max(0, (ship.speed || 0) / maxS));
    const moving = (ship.speed || 0) > MIN_SPEED;
    const sx = ship.x - fx * hl * 0.82, sz = ship.z - fz * hl * 0.82;   // stern

    // commit a sample
    this._timer += dt;
    if (moving && this._timer >= SAMPLE_DT) {
      this._timer = 0;
      const r = this._ring, o = this._head * 5;
      r[o] = sx; r[o + 1] = sz; r[o + 2] = a; r[o + 3] = t; r[o + 4] = 0.35 + 0.65 * strength;
      this._head = (this._head + 1) % (SEGS - 1);
      if (this._count < SEGS - 1) this._count++;
    }
    const n = this._count;
    // fog of war: an unseen ship shows neither shadow nor foam
    if (!ship.mesh || ship.mesh.visible === false) { this._mesh.visible = false; return; }
    this._mesh.visible = true;

    // contact shadow: soft ellipse a little longer and wider than the hull
    {
      const rx = Math.cos(a), rz = -Math.sin(a);
      const L = hl * 1.12, Bw = hb * 1.7, v = this._vShadow;
      const cx = ship.x - fx * hl * 0.04, cz = ship.z - fz * hl * 0.04;
      const corner = (k, u, w) => this._put(v + k, cx + rx * Bw * u + fx * L * w, cz + rz * Bw * u + fz * L * w, u, 3, w, 1);
      corner(0, -1, -1); corner(1, 1, -1); corner(2, 1, 1); corner(3, -1, 1);
    }

    // chronological sections: 0 = live head at the stern, then newest → oldest
    const P = this._pos, W = this._w, beam = hb * 0.95;
    let px = sx, pz = sz, dist = 0;
    for (let i = 0; i < SEGS; i++) {
      let cx, cz, ca, t0, st;
      if (i === 0) { cx = sx; cz = sz; ca = a; t0 = t; st = moving ? 0.35 + 0.65 * strength : 0; }
      else if (i <= n) {
        const k = ((this._head - i) % (SEGS - 1) + (SEGS - 1)) % (SEGS - 1), o = k * 5, r = this._ring;
        cx = r[o]; cz = r[o + 1]; ca = r[o + 2]; t0 = r[o + 3]; st = r[o + 4];
      } else {   // unused tail: collapse onto the oldest point, invisible
        cx = px; cz = pz; ca = a; t0 = -1e4; st = 0;
      }
      dist += Math.hypot(cx - px, cz - pz); px = cx; pz = cz;
      const rx = Math.cos(ca), rz = -Math.sin(ca);          // starboard unit vector
      const wash = beam * (0.55 + 0.10 * dist);
      const arm = beam + KELVIN_TAN * dist;
      const aw = 0.08 + hb * 0.10 + 0.03 * dist;
      const v = i * 6;
      this._put(v,     cx - rx * wash, cz - rz * wash, -1, 0, t0, st);
      this._put(v + 1, cx + rx * wash, cz + rz * wash,  1, 0, t0, st);
      this._put(v + 2, cx - rx * (arm - aw), cz - rz * (arm - aw), -1, 1, t0, st);
      this._put(v + 3, cx - rx * (arm + aw), cz - rz * (arm + aw),  1, 1, t0, st);
      this._put(v + 4, cx + rx * (arm - aw), cz + rz * (arm - aw), -1, 1, t0, st);
      this._put(v + 5, cx + rx * (arm + aw), cz + rz * (arm + aw),  1, 1, t0, st);
    }
    // bow wave: hugging the hull from the stem aft, pushed out with speed
    const bowSt = moving ? strength : 0;
    const rx = Math.cos(a), rz = -Math.sin(a);
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1;
      for (let i = 0; i < BOW_SECTS; i++) {
        const f = i / (BOW_SECTS - 1);                     // 0 at the stem … 1 amidships
        const along = hl * (0.98 - 0.75 * f);
        const half = hb * Math.sqrt(Math.min(1, f * 1.25)) * 0.95;
        const out = hb * (0.22 + 0.75 * f * (0.35 + strength));     // pushed out with speed, sized to the beam
        const bx = ship.x + fx * along, bz = ship.z + fz * along;
        const v = this._nTrail + (s * BOW_SECTS + i) * 2;
        const st = Math.min(1, bowSt * 1.15) * (1 - f * 0.5);
        this._put(v,     bx + rx * side * half,         bz + rz * side * half,         -1, 2, t, st);
        this._put(v + 1, bx + rx * side * (half + out), bz + rz * side * (half + out),  1, 2, t, st);
      }
    }
    this._geo.attributes.position.needsUpdate = true;
    this._geo.attributes.aW.needsUpdate = true;
  }

  _put(v, x, z, across, kind, t0, st) {
    const p = v * 3, w = v * 4;
    this._pos[p] = x; this._pos[p + 1] = 0; this._pos[p + 2] = z;
    this._w[w] = across; this._w[w + 1] = kind; this._w[w + 2] = t0; this._w[w + 3] = st;
  }

  clear() {
    this._count = 0; this._head = 0; this._timer = 0;
    this._mesh.visible = false;
  }

  destroy(scene) {
    scene.remove(this._mesh);
    this._geo.dispose();          // material is shared by every trail
  }
}
