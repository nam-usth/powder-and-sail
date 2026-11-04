import * as THREE from 'three';
import { GpuParticleField, getPuffTexture, sharedPointUniforms } from './gpuParticles.js';
import { ENV } from './env.js';
import { GLSL_HASH, GLSL_FIRE_RAMP, GLSL_FOG } from './glsl.js';

// ── Particle fields (one draw call each) ───────────────────────────
//   SmokeField  — lit, normal-blended billows: gun smoke banks, fire smoke,
//                 explosion columns, cannonball trails. Puff atlas + baked
//                 normals → volumetric look for one texture fetch per pixel.
//   FlameField  — additive fire tongues / fireball cores (black-body ramp).
//   SparkField  — additive velocity-stretched streaks: sparks, embers,
//                 coloured ability bits (spawnPart).
//   SprayField  — white water: splash columns, droplets, mist, bubbles.
//
// All are stateless GPU ring buffers (see gpuParticles.js). Every emit call
// writes one 16-float record; nothing is touched per frame afterwards.

export const POOL_FIRE  = 2048;   // kept for backward-compatible imports
export const POOL_SMOKE = 3072;
const POOL_SPARK = 2048;
const POOL_SPRAY = 2048;

const R = Math.random;

// ═══ SMOKE ═════════════════════════════════════════════════════════
const SMOKE_VERT = GLSL_FOG + /* glsl */`
uniform float uTime, uPxScale, uMaxPx, uSoft, uFogDensity;
uniform vec3  uWind, uSunDir, uSunCol, uAmbCol, uFlashCol;
uniform vec4  uFlashPos[3];
attribute float aT0;
attribute vec4  aVel;    // v0.xyz, life
attribute vec4  aShape;  // size0, size1, drag k, rise g
attribute vec4  aLook;   // seed, albedo, alpha, warm
varying vec4 vCellRot;   // atlas cell offset (xy), rotation cos/sin (zw)
varying vec4 vInfo;      // age frac, alpha, fog, heat
varying vec3 vAmb, vSun, vL, vGlow;
void main(){
  float age = uTime - aT0, life = aVel.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float x = age / life, seed = aLook.x;
  float k = max(aShape.z, 0.02);
  vec3 term = uWind + vec3(0.0, aShape.w / k, 0.0);       // drift = wind + buoyant terminal speed
  vec3 p = position + term * age + (aVel.xyz - term) * ((1.0 - exp(-k * age)) / k);
  p.x += sin(age * 0.71 + seed * 40.0) * 0.30 * x;          // slow curl so banks are not rigid sheets
  p.z += cos(age * 0.57 + seed * 23.0) * 0.30 * x;
  float size = mix(aShape.x, aShape.y, 1.0 - pow(1.0 - x, 2.4));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = min(size * uPxScale / max(depth, 0.1), uMaxPx);
  float a = aLook.z * smoothstep(0.0, min(0.08 / life, 0.5), x) * (1.0 - smoothstep(0.35, 1.0, x));
  if (uSoft > 0.5) {
    a *= smoothstep(-0.35, 0.45 * size, p.y);   // soft contact with the sea surface
    a *= smoothstep(1.0, 5.0, depth);           // fade before it fills the lens
  }
  vL   = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vAmb = aLook.y * uAmbCol * 1.05;
  vSun = aLook.y * uSunCol * 0.62;
  vec3 g = vec3(0.0);
  for (int i = 0; i < 3; i++) { vec3 d = uFlashPos[i].xyz - p; g += uFlashCol * (uFlashPos[i].w / (1.0 + dot(d, d) * 0.30)); }
  vGlow = g * 0.05;
  vInfo = vec4(x, a, vfxFog(depth, uFogDensity), aLook.w * (1.0 - smoothstep(0.0, 0.32, x)));
  float cell = floor(fract(seed * 7.13) * 4.0);
  float rot  = seed * 6.2831 + age * (fract(seed * 3.7) - 0.5) * 0.5;
  vCellRot = vec4(mod(cell, 2.0) * 0.5, floor(cell * 0.5) * 0.5, cos(rot), sin(rot));
}`;

const SMOKE_FRAG = /* glsl */`
uniform sampler2D uPuff;
uniform vec3 uFogCol;
varying vec4 vCellRot, vInfo;
varying vec3 vAmb, vSun, vL, vGlow;
void main(){
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  vec2 q = vec2(vCellRot.z * pc.x - vCellRot.w * pc.y, vCellRot.w * pc.x + vCellRot.z * pc.y);
  if (dot(q, q) > 0.25) discard;
  vec4 t = texture2D(uPuff, vCellRot.xy + (q + 0.5) * 0.5);
  float er = vInfo.x * vInfo.x * 0.85;                        // edges erode, late in life
  float d = clamp((t.a - er * (1.2 - t.b)) / max(1.0 - er * 0.9, 0.15), 0.0, 1.0);
  float alpha = d * vInfo.y;
  if (alpha < 0.004) discard;
  vec2 n2 = t.rg * 2.0 - 1.0;
  n2 = vec2(vCellRot.z * n2.x + vCellRot.w * n2.y, -vCellRot.w * n2.x + vCellRot.z * n2.y);
  vec3 n = normalize(vec3(n2, 0.7));
  float diff = clamp(dot(n, vL) * 0.55 + 0.45, 0.0, 1.0);
  vec3 col = (vAmb + vSun * diff) * mix(1.0, 0.74, d) + vGlow * (0.5 + d);
  col += vec3(1.0, 0.42, 0.10) * vInfo.w * (0.55 + 0.9 * (1.0 - d));   // lit from the fire below
  col = mix(col, uFogCol, vInfo.z);
#if defined( TONE_MAPPING )
  col = toneMapping(col);
#endif
  gl_FragColor = vec4(col, alpha);
}`;

/** Lit billowing smoke. */
export class SmokeField extends GpuParticleField {
  constructor(scene, capacity = POOL_SMOKE) {
    const mat = new THREE.ShaderMaterial({
      uniforms: sharedPointUniforms({
        uPuff: { value: getPuffTexture() },
        uFlashPos: ENV.uFlashPos, uFlashCol: ENV.uFlashCol,
      }),
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    super({ scene, capacity, material: mat, renderOrder: 20, name: 'vfx-smoke',
      layout: [['position', 3], ['aT0', 1], ['aVel', 4], ['aShape', 4], ['aLook', 4]] });
  }

  /**
   * Emit one smoke puff.
   * @param {number} shade albedo 0 (soot) … 1 (white powder smoke)
   * @param {number} warm  0…1 orange under-glow while young (born in fire)
   */
  emit(x, y, z, vx, vy, vz, life, size0, size1, drag, rise, shade, alpha, warm = 0, delay = 0) {
    const i = this._next(), d = this.data, o = i * 16, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = size0; d[o + 9] = size1; d[o + 10] = drag; d[o + 11] = rise;
    d[o + 12] = R(); d[o + 13] = shade; d[o + 14] = alpha; d[o + 15] = warm;
    this._commit(i, t0 + life);
  }

  /**
   * Legacy pool signature (FireSource / IslandEntity forts):
   * spawn(x, y, z, { n, speed, life, size, spread }).
   */
  spawn(x, y, z, opts = {}) {
    const n = opts.n || 6, speed = opts.speed || 2.5, life = opts.life || 1.2;
    const size = opts.size || 18, spread = opts.spread || 0.5;
    for (let k = 0; k < n; k++) {
      const l = life * (1.6 + R() * 1.4);
      this.emit(x + (R() - 0.5) * spread, y + R() * 0.2, z + (R() - 0.5) * spread,
        (R() - 0.5) * speed * 0.4, speed * (0.4 + R() * 0.6), (R() - 0.5) * speed * 0.4,
        l, size * 0.05, size * (0.18 + R() * 0.08), 1.4, 0.55, 0.30 + R() * 0.12, 0.42, 0.65);
    }
  }
}

// ═══ FLAME ═════════════════════════════════════════════════════════
const FLAME_VERT = GLSL_FOG + /* glsl */`
uniform float uTime, uPxScale, uMaxPx, uFogDensity;
uniform vec3  uWind;
attribute float aT0;
attribute vec4  aVel;    // v0, life
attribute vec4  aShape;  // size0, size1, drag, rise
attribute vec4  aLook;   // seed, heat, alpha, tongue (0 round … 1 flame tongue)
varying vec4 vCellRot;
varying vec4 vInfo;      // age frac, alpha, fog fade, heat
varying float vTongue;
void main(){
  float age = uTime - aT0, life = aVel.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float x = age / life, seed = aLook.x;
  float k = max(aShape.z, 0.02);
  vec3 term = uWind * 0.35 + vec3(0.0, aShape.w / k, 0.0);
  vec3 p = position + term * age + (aVel.xyz - term) * ((1.0 - exp(-k * age)) / k);
  p.x += sin(age * 9.0 + seed * 30.0) * 0.05 * x;                 // licking flicker
  float size = mix(aShape.x, aShape.y, sin(min(x * 1.7, 1.0) * 1.5708)) * (1.0 - 0.5 * smoothstep(0.55, 1.0, x));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = min(size * uPxScale / max(depth, 0.1), uMaxPx);
  float a = aLook.z * smoothstep(0.0, 0.04, x) * (1.0 - smoothstep(0.5, 1.0, x));
  a *= smoothstep(-0.1, 0.25, p.y) * smoothstep(0.6, 2.5, depth);
  vInfo = vec4(x, a, 1.0 - vfxFog(depth, uFogDensity), aLook.y * pow(1.0 - x, 1.15));
  vTongue = aLook.w;
  float cell = floor(fract(seed * 5.31) * 4.0);
  float rot  = (seed - 0.5) * mix(6.2831, 0.5, aLook.w) + age * (seed - 0.5) * 1.5;
  vCellRot = vec4(mod(cell, 2.0) * 0.5, floor(cell * 0.5) * 0.5, cos(rot), sin(rot));
}`;

const FLAME_FRAG = GLSL_FIRE_RAMP + /* glsl */`
uniform sampler2D uPuff;
uniform float uTime;
varying vec4 vCellRot, vInfo;
varying float vTongue;
void main(){
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  vec2 q = vec2(vCellRot.z * pc.x - vCellRot.w * pc.y, vCellRot.w * pc.x + vCellRot.z * pc.y);
  // flame tongue: stretch upward + taper toward the tip
  q.y = mix(q.y, q.y * 0.62 - 0.10, vTongue);
  q.x *= mix(1.0, 1.0 + max(q.y + 0.1, 0.0) * 2.2, vTongue);
  if (dot(q, q) > 0.25) discard;
  vec2 fl = vec2(sin(uTime * 7.0 + vCellRot.z * 9.0), cos(uTime * 5.3 + vCellRot.w * 7.0)) * 0.025;
  vec4 t = texture2D(uPuff, vCellRot.xy + (clamp(q + fl, -0.5, 0.5) + 0.5) * 0.5);
  float d = t.a * (0.75 + 0.5 * t.b);
  float heat = vInfo.w * (0.30 + 0.75 * d);                     // hot core, cooler licking edges
  vec3 col = vfxFireRamp(heat) * (0.85 + heat * 0.9);
  float a = smoothstep(0.06, 0.55, d) * vInfo.y * vInfo.z;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

/** Additive flames / fireball cores. */
export class FlameField extends GpuParticleField {
  constructor(scene, capacity = POOL_FIRE) {
    const mat = new THREE.ShaderMaterial({
      uniforms: sharedPointUniforms({ uPuff: { value: getPuffTexture() } }),
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    super({ scene, capacity, material: mat, renderOrder: 24, name: 'vfx-flame',
      layout: [['position', 3], ['aT0', 1], ['aVel', 4], ['aShape', 4], ['aLook', 4]] });
  }

  /** @param {number} heat 0…1 start temperature  @param {number} tongue 0 round … 1 flame */
  emit(x, y, z, vx, vy, vz, life, size0, size1, drag, rise, heat, alpha, tongue, delay = 0) {
    const i = this._next(), d = this.data, o = i * 16, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = size0; d[o + 9] = size1; d[o + 10] = drag; d[o + 11] = rise;
    d[o + 12] = R(); d[o + 13] = heat; d[o + 14] = alpha; d[o + 15] = tongue;
    this._commit(i, t0 + life);
  }

  /** Legacy pool signature: spawn(x, y, z, { n, speed, life, size, spread }). */
  spawn(x, y, z, opts = {}) {
    const n = opts.n || 6, speed = opts.speed || 2.5, life = opts.life || 1.2;
    const size = opts.size || 18, spread = opts.spread || 0.5;
    for (let k = 0; k < n; k++) {
      const s = size * 0.06 * (0.6 + R() * 0.8);
      this.emit(x + (R() - 0.5) * spread, y + R() * 0.2, z + (R() - 0.5) * spread,
        (R() - 0.5) * speed * 0.4, speed * (0.4 + R() * 0.6), (R() - 0.5) * speed * 0.4,
        life * (0.7 + R() * 0.6), s, s * 1.5, 1.6, 1.6, 0.95, 0.8, 1.0);
    }
  }
}

// ═══ SPARKS (velocity-stretched streaks) ═══════════════════════════
const STREAK_VERT_BODY = /* glsl */`
  float k = max(aPhys.z, 0.02);
  vec3 term = vec3(0.0, aPhys.w / k, 0.0) + uWind * WINDF;
  float ek = exp(-k * age);
  vec3 p = position + term * age + (aVel.xyz - term) * ((1.0 - ek) / k);
  vec3 v = term + (aVel.xyz - term) * ek;
  vec4 mv1 = modelViewMatrix * vec4(p, 1.0);
  vec4 mv2 = modelViewMatrix * vec4(p - v * aPhys.y, 1.0);
  if (mv1.z > -0.3 || mv2.z > -0.3) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 c1 = projectionMatrix * mv1, c2 = projectionMatrix * mv2;
  vec2 dpx = (c1.xy / c1.w - c2.xy / c2.w) * 0.5 * uViewport;
  float len = length(dpx);
  float w = max(aPhys.x * uPxScale / -mv1.z, 1.6);
  float sz = min(len + w * 2.0, uMaxPx);
  gl_Position  = projectionMatrix * ((mv1 + mv2) * 0.5);
  gl_PointSize = sz;
  vSeg = vec4(len > 0.001 ? dpx / len : vec2(1.0, 0.0), 0.5 * min(len, sz - w) / sz, 0.5 * w / sz);
`;

const STREAK_FRAG_FN = /* glsl */`
float vfxStreak(vec4 seg){
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  float along = dot(pc, seg.xy), across = dot(pc, vec2(-seg.y, seg.x));
  float da = max(abs(along) - seg.z, 0.0);
  float d = length(vec2(da, across)) / max(seg.w, 1e-3);
  float head = 0.55 + 0.45 * smoothstep(-seg.z - 0.001, seg.z + 0.001, along);
  return (1.0 - smoothstep(0.25, 1.0, d)) * head;
}`;

const SPARK_VERT = GLSL_FOG + /* glsl */`
#define WINDF 0.3
uniform float uTime, uPxScale, uMaxPx, uFogDensity;
uniform vec2  uViewport;
uniform vec3  uWind;
attribute float aT0;
attribute vec4  aVel;    // v0, life
attribute vec4  aPhys;   // width, stretch (s), drag, gravity
attribute vec4  aCol;    // rgb, brightness
varying vec4 vSeg;
varying vec4 vCol;
void main(){
  float age = uTime - aT0, life = aVel.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float x = age / life;
  ${STREAK_VERT_BODY}
  float a = (1.0 - smoothstep(0.5, 1.0, x)) * smoothstep(-0.05, 0.2, p.y);
  vCol = vec4(aCol.rgb * aCol.w * mix(1.7, 0.7, x), a * (1.0 - vfxFog(-mv1.z, uFogDensity)));
}`;

const SPARK_FRAG = STREAK_FRAG_FN + /* glsl */`
varying vec4 vSeg;
varying vec4 vCol;
void main(){
  float a = vfxStreak(vSeg) * vCol.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

/** Additive streak sparks / embers / coloured bits. */
export class SparkField extends GpuParticleField {
  constructor(scene, capacity = POOL_SPARK) {
    const mat = new THREE.ShaderMaterial({
      uniforms: sharedPointUniforms(),
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    super({ scene, capacity, material: mat, renderOrder: 26, name: 'vfx-spark',
      layout: [['position', 3], ['aT0', 1], ['aVel', 4], ['aPhys', 4], ['aCol', 4]] });
  }

  /** @param {number} stretch streak length in seconds of travel */
  emit(x, y, z, vx, vy, vz, life, width, stretch, drag, gravity, r, g, b, bright, delay = 0) {
    const i = this._next(), d = this.data, o = i * 16, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = width; d[o + 9] = stretch; d[o + 10] = drag; d[o + 11] = gravity;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = bright;
    this._commit(i, t0 + life);
  }

  /**
   * Legacy MiscParticlePool signature (spawnPart / ability bursts):
   * spawn(x, y, z, hexCol, n, { speed, life, upward }).
   */
  spawn(x, y, z, hexCol, n = 8, opts = {}) {
    const r = ((hexCol >> 16) & 255) / 255, g = ((hexCol >> 8) & 255) / 255, b = (hexCol & 255) / 255;
    const speed = opts.speed || 4.5, life = opts.life || 0.85;
    const phiMax = opts.upward ? Math.PI * 0.42 : Math.PI;
    for (let k = 0; k < n; k++) {
      const th = R() * Math.PI * 2, ph = R() * phiMax, s = speed * (0.5 + R() * 0.5);
      this.emit(x, y, z, Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s + 1.5, Math.sin(ph) * Math.sin(th) * s,
        life * (0.8 + R() * 0.5), 0.09, 0.05, 0.6, -9.0, r, g, b, 1.1);
    }
  }
}

// ═══ SPRAY (white water) ═══════════════════════════════════════════
const SPRAY_VERT = GLSL_FOG + GLSL_HASH + /* glsl */`
#define WINDF 0.25
uniform float uTime, uPxScale, uMaxPx, uFogDensity, uSoft;
uniform vec2  uViewport;
uniform vec3  uWind, uSunDir, uSunCol, uAmbCol;
attribute float aT0;
attribute vec4  aVel;    // v0, life
attribute vec4  aPhys;   // size0, size1/stretch, drag, gravity
attribute vec4  aLook;   // seed, kind (0 puff · 1 droplet · 2 bubble), alpha, stretch(s)
varying vec4 vSeg;       // droplet streak OR puff cell/rot
varying vec4 vInfo;      // kind, alpha, fog, age frac
varying vec3 vLight;
varying vec3 vL;
void main(){
  float age = uTime - aT0, life = aVel.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float x = age / life, seed = aLook.x, kind = aLook.y;
  vec3 sunL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vL = sunL;
  vLight = uAmbCol * 1.0 + uSunCol * 0.62;
  if (kind > 0.5 && kind < 1.5) {
    // droplet streak — reuses the spark integrator (aPhys = width, stretch, drag, g)
    vec4 aPhysS = vec4(aPhys.x, aLook.w, aPhys.z, aPhys.w);
    #define aPhys aPhysS
    ${STREAK_VERT_BODY}
    #undef aPhys
    float a = aLook.z * (1.0 - smoothstep(0.6, 1.0, x)) * smoothstep(-0.25, 0.05, p.y);
    vInfo = vec4(1.0, a, vfxFog(-mv1.z, uFogDensity), x);
    return;
  }
  vec3 p;
  float size;
  if (kind > 1.5) {
    // bubble / foam fleck riding the surface
    p = position + vec3(sin(seed * 50.0 + age * 2.1), 0.0, cos(seed * 31.0 + age * 1.7)) * 0.10 * age;
    size = mix(aPhys.x, aPhys.y, sqrt(x));
  } else {
    float k = max(aPhys.z, 0.02);
    vec3 term = vec3(0.0, aPhys.w / k, 0.0) + uWind * WINDF;
    p = position + term * age + (aVel.xyz - term) * ((1.0 - exp(-k * age)) / k);
    size = mix(aPhys.x, aPhys.y, 1.0 - pow(1.0 - x, 2.0));
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = min(size * uPxScale / max(depth, 0.1), uMaxPx);
  float a = aLook.z * smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.45, 1.0, x));
  if (kind < 0.5) {
    a *= smoothstep(-0.45, 0.1, p.y);          // falling water rejoins the sea
    if (uSoft > 0.5) a *= smoothstep(1.0, 4.0, depth);
  }
  float rot = seed * 6.2831;
  float cell = floor(fract(seed * 3.77) * 4.0);
  vSeg  = vec4(mod(cell, 2.0) * 0.5, floor(cell * 0.5) * 0.5, cos(rot), sin(rot));
  vInfo = vec4(kind, a, vfxFog(depth, uFogDensity), x);
}`;

const SPRAY_FRAG = STREAK_FRAG_FN + /* glsl */`
uniform sampler2D uPuff;
uniform vec3 uFogCol;
varying vec4 vSeg, vInfo;
varying vec3 vLight, vL;
void main(){
  vec3 water = vec3(0.86, 0.93, 1.0);
  if (vInfo.x > 0.5 && vInfo.x < 1.5) {
    float a = vfxStreak(vSeg) * vInfo.y;
    if (a < 0.01) discard;
    vec3 dc = mix(water * vLight * 0.95, uFogCol, vInfo.z);
#if defined( TONE_MAPPING )
  dc = toneMapping(dc);
#endif
    gl_FragColor = vec4(dc, a);
    return;
  }
  vec2 pc = gl_PointCoord - 0.5; pc.y = -pc.y;
  if (vInfo.x > 1.5) {
    // bubble: bright rim + faint fill, pops (rim thins) at the end of life
    float r = length(pc) * 2.0;
    float rim = (1.0 - smoothstep(0.0, 0.16, abs(r - 0.78))) * (1.0 - vInfo.w * 0.6);
    float a = (rim * 0.9 + (1.0 - smoothstep(0.5, 0.9, r)) * 0.18) * vInfo.y;
    if (a < 0.01) discard;
    vec3 bc = mix(water * vLight, uFogCol, vInfo.z);
#if defined( TONE_MAPPING )
  bc = toneMapping(bc);
#endif
    gl_FragColor = vec4(bc, a);
    return;
  }
  vec2 q = vec2(vSeg.z * pc.x - vSeg.w * pc.y, vSeg.w * pc.x + vSeg.z * pc.y);
  if (dot(q, q) > 0.25) discard;
  vec4 t = texture2D(uPuff, vSeg.xy + (q + 0.5) * 0.5);
  float er = vInfo.w * 0.65;
  float d = clamp((t.a - er * (1.2 - t.b)) / max(1.0 - er * 0.9, 0.15), 0.0, 1.0);
  float a = d * vInfo.y;
  if (a < 0.004) discard;
  vec2 n2 = t.rg * 2.0 - 1.0;
  n2 = vec2(vSeg.z * n2.x + vSeg.w * n2.y, -vSeg.w * n2.x + vSeg.z * n2.y);
  float diff = clamp(dot(normalize(vec3(n2, 0.75)), vL) * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = water * vLight * mix(0.62, 1.05, diff);
  col = mix(col, uFogCol, vInfo.z);
#if defined( TONE_MAPPING )
  col = toneMapping(col);
#endif
  gl_FragColor = vec4(col, a);
}`;

/** White water: splash columns (puffs), droplets (streaks), bubbles. */
export class SprayField extends GpuParticleField {
  constructor(scene, capacity = POOL_SPRAY) {
    const mat = new THREE.ShaderMaterial({
      uniforms: sharedPointUniforms({ uPuff: { value: getPuffTexture() } }),
      vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    super({ scene, capacity, material: mat, renderOrder: 22, name: 'vfx-spray',
      layout: [['position', 3], ['aT0', 1], ['aVel', 4], ['aPhys', 4], ['aLook', 4]] });
  }

  /** White-water puff (column chunk / mist). gravity < 0 falls. */
  puff(x, y, z, vx, vy, vz, life, size0, size1, drag, gravity, alpha, delay = 0) {
    this._rec(x, y, z, vx, vy, vz, life, size0, size1, drag, gravity, 0, alpha, 0, delay);
  }

  /** Droplet streak. */
  droplet(x, y, z, vx, vy, vz, life, width, alpha, delay = 0) {
    this._rec(x, y, z, vx, vy, vz, life, width, 0, 0.25, -14.0, 1, alpha, 0.045, delay);
  }

  /** Bubble / foam fleck on the surface at height y. */
  bubble(x, y, z, life, size0, size1, alpha, delay = 0) {
    this._rec(x, y, z, 0, 0, 0, life, size0, size1, 1, 0, 2, alpha, 0, delay);
  }

  _rec(x, y, z, vx, vy, vz, life, s0, s1, drag, g, kind, alpha, stretch, delay) {
    const i = this._next(), d = this.data, o = i * 16, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1; d[o + 10] = drag; d[o + 11] = g;
    d[o + 12] = R(); d[o + 13] = kind; d[o + 14] = alpha; d[o + 15] = stretch;
    this._commit(i, t0 + life);
  }
}

/**
 * Build the standard field set. `fire`/`smoke` keep the legacy pool names
 * (IslandEntity reads vfx._fire / vfx._smoke for fort fires).
 */
export function createParticlePools(scene) {
  return {
    fire:  new FlameField(scene),
    smoke: new SmokeField(scene),
    spark: new SparkField(scene),
    spray: new SprayField(scene),
  };
}
