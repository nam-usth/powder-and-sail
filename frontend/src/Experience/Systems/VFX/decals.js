import * as THREE from 'three';
import { ENV } from './env.js';
import { GLSL_HASH, GLSL_FOG } from './glsl.js';

// ── WaterDecalField — flat effects on the sea surface (one draw call) ─
// Replaces the per-spawn Mesh + Material allocations of the old
// ShockwaveSystem / WaterRippleSystem with one instanced quad buffer.
//   kind 0  splash ring   — thin white ring, noise-broken, expands + fades
//   kind 1  foam patch    — noisy white blotch that dissolves (splash, sinking)
//   kind 2  shock ring    — hot additive ring of an explosion
//   kind 3  slick         — dark oil / ash slick left where a ship went down
// Premultiplied-alpha blending lets additive (kind 2) and alpha-blended kinds
// share the draw call: additive fragments output alpha = 0.

const CAP = 128;
const STRIDE = 12;

const VERT = GLSL_FOG + /* glsl */`
uniform float uTime, uFogDensity;
attribute vec4 aC;   // x, y, z, t0
attribute vec4 aP;   // life, r0, r1, kind
attribute vec4 aS;   // alpha, width, seed, -
varying vec2 vUv;
varying vec4 vInfo;  // age frac, kind, alpha, fog
varying vec2 vS;     // width, seed
void main(){
  float age = uTime - aC.w, life = aP.x;
  if (age < 0.0 || age >= life) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float x = age / life;
  float ease = aP.w > 1.5 && aP.w < 2.5 ? 1.0 - pow(1.0 - x, 3.0) : 1.0 - pow(1.0 - x, 2.0);
  float r = mix(aP.y, aP.z, ease);
  vec3 wp = aC.xyz + vec3(position.x * r, 0.0, position.z * r);
  vUv = position.xz;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vInfo = vec4(x, aP.w, aS.x, vfxFog(-mv.z, uFogDensity));
  vS = aS.yz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = GLSL_HASH + /* glsl */`
uniform vec3 uSunCol, uAmbCol, uFogCol;
varying vec2 vUv;
varying vec4 vInfo;
varying vec2 vS;
void main(){
  float r = length(vUv);
  if (r > 1.0) discard;
  float x = vInfo.x, kind = vInfo.y, seed = vS.y;
  float ang = atan(vUv.y, vUv.x);
  vec3 foamCol = vec3(0.90, 0.95, 1.0) * (uAmbCol * 1.0 + uSunCol * 0.62);
  vec3 col; float a; float add = 0.0;
  if (kind < 0.5) {
    float w = vS.x;
    float band = 1.0 - smoothstep(0.0, w, abs(r - 0.86));
    float n = vfxNoise(vec2(ang * 5.0 + seed * 17.0, r * 6.0 - x * 2.0));
    a = band * (0.45 + 0.55 * n) * pow(1.0 - x, 1.4);
    col = foamCol;
  } else if (kind < 1.5) {
    float n = vfxFbm(vUv * 3.2 + seed * 13.0) * 0.75 + vfxNoise(vUv * 9.0 - seed * 5.0) * 0.25;
    float fall = 1.0 - smoothstep(0.35, 1.0, r);
    float thr = 0.30 + x * 0.55;
    a = smoothstep(thr, thr + 0.18, n * (0.55 + 0.6 * fall)) * (1.0 - smoothstep(0.7, 1.0, x));
    a *= 0.9;
    col = foamCol;
  } else if (kind < 2.5) {
    // blast wave ruffling the water: a soft bright band, warm only at birth
    float band = 1.0 - smoothstep(0.0, 0.06 + 0.12 * x, abs(r - 0.9));
    float n = vfxNoise(vec2(ang * 9.0 + seed * 11.0, x * 3.0));
    a = band * (0.6 + 0.4 * n) * (1.0 - x) * (1.0 - x);
    col = mix(vec3(1.0, 0.75, 0.45), vec3(0.85, 0.92, 1.0), smoothstep(0.0, 0.25, x)) * 1.2;
    add = 1.0 - smoothstep(0.0, 0.3, x);   // additive flash first, then plain white water
  } else {
    float n = vfxFbm(vUv * 2.2 + seed * 7.0);
    a = smoothstep(0.25, 0.6, n * (1.0 - r * r)) * 0.55 * (1.0 - smoothstep(0.6, 1.0, x)) * smoothstep(0.0, 0.08, x);
    col = vec3(0.035, 0.04, 0.045) + vec3(0.10, 0.06, 0.12) * vfxNoise(vUv * 14.0);   // faint oily sheen
  }
  a *= vInfo.z;
  if (a < 0.004) discard;
  col = mix(col, uFogCol, vInfo.w);
#if defined( TONE_MAPPING )
  col = toneMapping(col);
#endif
  // premultiplied: additive kinds keep alpha 0 so they only add light
  gl_FragColor = vec4(col * a, a * (1.0 - add));
}`;

/** Instanced decals on the water surface. */
export class WaterDecalField {
  constructor(scene) {
    this._scene = scene;
    this._limit = CAP; this._head = 0; this._aliveUntil = -1;
    const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
    plane.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    this.data = new Float32Array(CAP * STRIDE);
    for (let i = 0; i < CAP; i++) this.data[i * STRIDE + 3] = -1e6;
    this._ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aC', new THREE.InterleavedBufferAttribute(this._ib, 4, 0));
    geo.setAttribute('aP', new THREE.InterleavedBufferAttribute(this._ib, 4, 4));
    geo.setAttribute('aS', new THREE.InterleavedBufferAttribute(this._ib, 4, 8));
    geo.instanceCount = CAP;
    this.geometry = geo;
    this._dMin = -1; this._dMax = -1;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: ENV.uTime, uFogDensity: ENV.uFogDensity, uFogCol: ENV.uFogCol, uSunCol: ENV.uSunCol, uAmbCol: ENV.uAmbCol },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'vfx-decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;          // after ocean (0) and wakes (2), before particles
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setBudget(frac) {
    this._limit = Math.max(16, Math.floor(CAP * frac));
    if (this._head >= this._limit) this._head = 0;
    this.geometry.instanceCount = this._limit;
  }

  /**
   * @param {number} kind  0 ring · 1 foam · 2 shock · 3 slick
   * @param {number} width ring band width (kind 0), in unit-radius space
   */
  emit(x, y, z, kind, r0, r1, life, alpha = 1, width = 0.08, delay = 0) {
    const i = this._head; this._head = (i + 1) % this._limit;
    const d = this.data, o = i * STRIDE, t0 = ENV.uTime.value + delay;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t0;
    d[o + 4] = life; d[o + 5] = r0; d[o + 6] = r1; d[o + 7] = kind;
    d[o + 8] = alpha; d[o + 9] = width; d[o + 10] = Math.random(); d[o + 11] = 0;
    if (t0 + life > this._aliveUntil) this._aliveUntil = t0 + life;
    const ur = this._ib.updateRange;
    if (ur.count === -1 || this._dMin < 0) { this._dMin = i; this._dMax = i; }
    else { if (i < this._dMin) this._dMin = i; if (i > this._dMax) this._dMax = i; }
    ur.offset = this._dMin * STRIDE; ur.count = (this._dMax - this._dMin + 1) * STRIDE;
    this._ib.needsUpdate = true;
    this.mesh.visible = true;
  }

  tick(now) { if (this.mesh.visible && now > this._aliveUntil + 0.05) this.mesh.visible = false; }

  destroy() {
    this._scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
