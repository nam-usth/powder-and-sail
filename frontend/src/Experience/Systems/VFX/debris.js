import * as THREE from 'three';
import { ENV } from './env.js';
import { GLSL_FOG, GLSL_WAVE } from './glsl.js';

// ── DebrisField — wood splinters, planks, barrels (one draw call) ──
// Instanced unit boxes, fully GPU-driven like the particle fields: each
// instance is a spawn record (p0, t0, v0, life, spin axis/rate, dimensions,
// colour). The vertex shader flies it ballistically, tumbling, until the
// analytic water-impact time; after that FLOATING pieces lie flat, bob on the
// mirrored swell (glsl.js vfxWaveH) and drift with the wind, while SINKING
// pieces (splinters) slip under. Opaque, depth-writing, lit by the shared sun.

const CAP = 512;
const STRIDE = 20;
const R = Math.random;
const _hit = { t: 0, x: 0, z: 0 };   // reused by DebrisField.impact()

const VERT = GLSL_FOG + GLSL_WAVE + /* glsl */`
uniform float uTime, uOceanTime, uFogDensity;
uniform vec3  uSunDir, uSunCol, uAmbCol, uWind;
attribute vec4 aP0;     // x, y, z, t0
attribute vec4 aV0;     // vx, vy, vz, life
attribute vec4 aSpin;   // axis xyz, rad/s
attribute vec4 aDims;   // sx, sy, sz, floats (1 float · 0 sink)
attribute vec4 aCol;    // rgb, char
varying vec3 vCol;
varying float vFog;
mat3 rotAxis(vec3 a, float ang){
  float s = sin(ang), c = cos(ang), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c,     oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c,     oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}
void main(){
  float age = uTime - aP0.w, life = aV0.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  const float G = 13.0;
  vec3 p0 = aP0.xyz, v0 = aV0.xyz;
  float c = max(p0.y - 0.05, 0.0);
  float tHit = (v0.y + sqrt(v0.y * v0.y + 2.0 * G * c)) / G;
  vec3 p; mat3 Rm;
  float shrink = 1.0;
  if (age < tHit) {
    p = p0 + v0 * age; p.y -= 0.5 * G * age * age;
    Rm = rotAxis(aSpin.xyz, aSpin.w * age);
  } else {
    float ta = age - tHit;
    vec2 ph = p0.xz + v0.xz * tHit;
    vec2 drift = v0.xz * 0.22 * (1.0 - exp(-ta * 1.4)) / 1.4 + uWind.xz * 0.10 * ta;
    p = vec3(ph.x + drift.x, 0.0, ph.y + drift.y);
    float wh = vfxWaveH(p.xz, uOceanTime);
    if (aDims.w > 0.5) {
      // floating: lie flat (yaw only), gentle roll on the swell, sink at end of life
      float yaw = aSpin.w * 0.37 + ta * 0.05 * sign(aSpin.w);
      float rock = sin(uOceanTime * 1.3 + p.x * 0.7) * 0.10;
      Rm = rotAxis(vec3(0.0, 1.0, 0.0), yaw) * rotAxis(vec3(1.0, 0.0, 0.0), rock);
      p.y = wh + 0.03 - smoothstep(0.78, 1.0, age / life) * 0.9;
    } else {
      Rm = rotAxis(aSpin.xyz, aSpin.w * (tHit + ta * 0.25));
      p.y = wh - ta * 1.6;
      shrink = 1.0 - smoothstep(0.0, 0.6, ta);
    }
  }
  vec3 wp = p + Rm * (position * aDims.xyz * shrink);
  vec3 n = normalize(Rm * normal);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 alb = aCol.rgb * (1.0 - aCol.w * 0.75);
  vCol = alb * (uAmbCol * 1.15 + uSunCol * diff * 0.85);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vFog = vfxFog(-mv.z, uFogDensity);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform vec3 uFogCol;
varying vec3 vCol;
varying float vFog;
void main(){
  vec3 c = mix(vCol, uFogCol, vFog);
#if defined( TONE_MAPPING )
  c = toneMapping(c);
#endif
  gl_FragColor = vec4(c, 1.0);
}`;

// Wood palette (tarred hull planks, raw splinters, deck planking, barrel staves)
const WOOD = [
  [0.36, 0.24, 0.15], [0.48, 0.33, 0.20], [0.62, 0.46, 0.30], [0.27, 0.19, 0.13], [0.55, 0.38, 0.22],
];

/** Instanced, GPU-integrated wreckage. */
export class DebrisField {
  constructor(scene) {
    this._scene = scene;
    this.capacity = CAP;
    this._limit = CAP;
    this._head = 0;
    this._aliveUntil = -1;
    this.oceanTime = { value: 0 };

    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.attributes.position);
    geo.setAttribute('normal', box.attributes.normal);
    this.data = new Float32Array(CAP * STRIDE);
    for (let i = 0; i < CAP; i++) this.data[i * STRIDE + 3] = -1e6;
    this._ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP0',   new THREE.InterleavedBufferAttribute(this._ib, 4, 0));
    geo.setAttribute('aV0',   new THREE.InterleavedBufferAttribute(this._ib, 4, 4));
    geo.setAttribute('aSpin', new THREE.InterleavedBufferAttribute(this._ib, 4, 8));
    geo.setAttribute('aDims', new THREE.InterleavedBufferAttribute(this._ib, 4, 12));
    geo.setAttribute('aCol',  new THREE.InterleavedBufferAttribute(this._ib, 4, 16));
    geo.instanceCount = CAP;
    this._dMin = -1; this._dMax = -1;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: ENV.uTime, uOceanTime: this.oceanTime, uFogDensity: ENV.uFogDensity, uFogCol: ENV.uFogCol,
        uSunDir: ENV.uSunDir, uSunCol: ENV.uSunCol, uAmbCol: ENV.uAmbCol, uWind: ENV.uWind,
      },
      vertexShader: VERT, fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'vfx-debris';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setBudget(frac) {
    this._limit = Math.max(16, Math.floor(CAP * frac));
    if (this._head >= this._limit) this._head = 0;
    this.geometry.instanceCount = this._limit;
  }

  /**
   * One piece of wreckage.
   * @param {number} kind 0 splinter (sinks) · 1 plank (floats) · 2 barrel (floats)
   * @param {number} [rgb] colour override (0xRRGGBB, e.g. stone chips); -1 = wood
   */
  emit(x, y, z, vx, vy, vz, life, kind, scale = 1, charred = 0, delay = 0, rgb = -1) {
    const i = this._head; this._head = (i + 1) % this._limit;
    const d = this.data, o = i * STRIDE, t0 = ENV.uTime.value + delay;
    let sx, sy, sz;
    if (kind === 0)      { sx = 0.05 + R() * 0.05; sy = 0.04 + R() * 0.03; sz = 0.22 + R() * 0.30; }
    else if (kind === 1) { sx = 0.16 + R() * 0.12; sy = 0.05;               sz = 0.7 + R() * 0.9; }
    else                 { sx = 0.30; sy = 0.36; sz = 0.30; }
    let ax = R() - 0.5, ay = R() - 0.5, az = R() - 0.5;
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const w = rgb >= 0 ? [((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]
                       : WOOD[(R() * WOOD.length) | 0];
    const tint = 0.85 + R() * 0.3;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = ax; d[o + 9] = ay; d[o + 10] = az; d[o + 11] = (R() < 0.5 ? -1 : 1) * (4 + R() * 9);
    d[o + 12] = sx * scale; d[o + 13] = sy * scale; d[o + 14] = sz * scale; d[o + 15] = kind === 0 ? 0 : 1;
    d[o + 16] = w[0] * tint; d[o + 17] = w[1] * tint; d[o + 18] = w[2] * tint; d[o + 19] = charred;
    if (t0 + life > this._aliveUntil) this._aliveUntil = t0 + life;
    const ur = this._ib.updateRange;
    if (ur.count === -1 || this._dMin < 0) { this._dMin = i; this._dMax = i; }
    else { if (i < this._dMin) this._dMin = i; if (i > this._dMax) this._dMax = i; }
    ur.offset = this._dMin * STRIDE; ur.count = (this._dMax - this._dMin + 1) * STRIDE;
    this._ib.needsUpdate = true;
    this.mesh.visible = true;
  }

  /**
   * Water-impact time + landing point for a spawn (CPU mirror of the shader,
   * used to schedule a tiny splash when a big plank lands).
   * @returns {{t:number,x:number,z:number}}
   */
  static impact(x, y, z, vx, vy, vz) {
    const G = 13, c = Math.max(y - 0.05, 0);
    const t = (vy + Math.sqrt(vy * vy + 2 * G * c)) / G;
    _hit.t = t; _hit.x = x + vx * t; _hit.z = z + vz * t;
    return _hit;
  }

  tick(now, oceanTime) {
    this.oceanTime.value = oceanTime;
    if (this.mesh.visible && now > this._aliveUntil + 0.05) this.mesh.visible = false;
  }

  destroy() {
    this._scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
