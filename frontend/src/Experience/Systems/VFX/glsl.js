// ── Shared GLSL chunks for the VFX shaders ─────────────────────────
// Cheap hash/value-noise (no simplex in fragment shaders — the old smoke
// paid two simplex octaves per pixel of every overlapping puff), a CPU-mirrored
// wave height for floating debris, and the fire colour ramp.
import { WAVE_SPEED } from '../../World/Ocean.js';

export const GLSL_HASH = /* glsl */`
float vfxHash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vfxHash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vfxNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vfxHash21(i), vfxHash21(i + vec2(1.0, 0.0)), f.x),
             mix(vfxHash21(i + vec2(0.0, 1.0)), vfxHash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float vfxFbm(vec2 p){ return vfxNoise(p) * 0.55 + vfxNoise(p * 2.03 + 7.1) * 0.30 + vfxNoise(p * 4.1 + 3.3) * 0.15; }
`;

// Mirror of Ocean.js _WT (read-only dependency — Ocean.js is owned elsewhere).
// Only the six swell terms; the fBm chop adds ≈ +0.15 on average, folded in
// as a constant. Used for debris that floats; accuracy ±0.2 u is plenty.
const _WT = [
  [ 0.8,  0.6,  0.28, 0.140, 0.00, 1.00],
  [-0.5,  0.9,  0.18, 0.250, 1.30, 0.90],
  [ 0.6, -0.8,  0.12, 0.400, 2.60, 1.10],
  [-0.9,  0.2,  0.08, 0.575, 0.90, 0.70],
  [ 0.3,  1.0,  0.05, 0.775, 3.70, 1.30],
  [-0.7, -0.5,  0.03, 1.125, 1.80, 0.85],
];
const f = n => (Math.round(n * 1e5) / 1e5).toFixed(5);
const _terms = _WT.map(([dx, dz, a, fr, ph, ts]) => {
  const l = Math.hypot(dx, dz);
  return `h += sin(dot(vec2(${f(dx / l)}, ${f(dz / l)}), p) * ${f(fr)} + ts * ${f(ts)} + ${f(ph)}) * ${f(a)};`;
}).join('\n  ');

export const GLSL_WAVE = /* glsl */`
float vfxWaveH(vec2 p, float t){
  float ts = t * ${f(WAVE_SPEED)};
  float h = 0.15;
  ${_terms}
  return h;
}
`;

// Black-body-ish ramp: 0 = cold soot red, 1 = white-hot core.
export const GLSL_FIRE_RAMP = /* glsl */`
vec3 vfxFireRamp(float T){
  T = clamp(T, 0.0, 1.0);
  vec3 c = mix(vec3(0.20, 0.02, 0.00), vec3(0.85, 0.16, 0.02), smoothstep(0.00, 0.30, T));
  c = mix(c, vec3(1.00, 0.48, 0.06), smoothstep(0.25, 0.55, T));
  c = mix(c, vec3(1.00, 0.80, 0.30), smoothstep(0.50, 0.80, T));
  c = mix(c, vec3(1.00, 0.97, 0.86), smoothstep(0.78, 1.00, T));
  return c;
}
`;

// Exp² fog factor matching THREE.FogExp2.
export const GLSL_FOG = /* glsl */`
float vfxFog(float depth, float density){ float d = density * depth; return 1.0 - exp(-d * d); }
`;
