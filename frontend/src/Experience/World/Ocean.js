import * as THREE from 'three';
import { MAP } from '../../data/constants.js';

// ── WAVE TABLE (shared JS ↔ GLSL) ─────────────────────────────────
// Ported from threejs_ocean_buoy_fixed.html, scaled for MAP ~200u world.
// [dirX, dirZ, amplitude, frequency, phase, timeScale]
// Directions normalised below. Frequencies scaled × 0.25 vs the 50u demo.
const _WT = [
  [ 0.8,  0.6,  0.28, 0.140, 0.00, 1.00],
  [-0.5,  0.9,  0.18, 0.250, 1.30, 0.90],
  [ 0.6, -0.8,  0.12, 0.400, 2.60, 1.10],
  [-0.9,  0.2,  0.08, 0.575, 0.90, 0.70],
  [ 0.3,  1.0,  0.05, 0.775, 3.70, 1.30],
  [-0.7, -0.5,  0.03, 1.125, 1.80, 0.85],
];
const _WD = _WT.map(w => {
  const l = Math.sqrt(w[0]*w[0]+w[1]*w[1]);
  return [w[0]/l, w[1]/l, w[2], w[3], w[4], w[5]];
});
export const WAVE_SPEED = 0.50;
export const TOTAL_AMP  = 0.74;  // Σ amplitudes (used by buoyancy + tests)

// ── CPU helpers — mirror GLSL exactly ────────────────────────────
function _hash(x, z) {
  return ((Math.sin(x*127.1 + z*311.7) * 43758.5453) % 1 + 1) % 1;
}
function _vnoise(px, pz) {
  const ix = Math.floor(px), iz = Math.floor(pz);
  const fx = px-ix, fz = pz-iz;
  const ux = fx*fx*(3-2*fx), uz = fz*fz*(3-2*fz);
  return _hash(ix,iz)*(1-ux)*(1-uz) + _hash(ix+1,iz)*ux*(1-uz)
       + _hash(ix,iz+1)*(1-ux)*uz   + _hash(ix+1,iz+1)*ux*uz;
}
function _fbm(px, pz) {
  let v=0, a=0.5;
  for(let i=0; i<5; i++) {
    v += a * _vnoise(px, pz);
    const nx=px*2.1+1.7, nz=pz*2.1+9.2;
    px=nx; pz=nz; a*=0.48;
  }
  return v;
}
function _turbulence(x, z, t) {
  return _fbm(x*0.25+t*0.08, z*0.25+t*0.06) * 0.20
       + _fbm(x*0.60+t*0.15, z*0.60+t*0.12) * 0.09
       + _fbm(x*1.40+t*0.25, z*1.40+t*0.20) * 0.035;
}

export function getWaveHeight(x, z, t) {
  const ts = t * WAVE_SPEED;
  let h = 0;
  for (const [dx, dz, amp, freq, phase, tscale] of _WD) {
    h += Math.sin((dx*x + dz*z) * freq + ts * tscale + phase) * amp;
  }
  h += _turbulence(x, z, ts);
  return h;
}

// ── Vertex shader ─────────────────────────────────────────────────
const VERT = /* glsl */`
  uniform float uTime;
  uniform vec3  uSunDir;

  uniform mat4  uReflProjView;   // reflection camera PV matrix (high-graphics only)

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vWaveH;
  varying float vFoam;
  varying float vDepth;
  varying vec4  vReflCoord;     // projective coords for reflection lookup

  // fBm — mirrors JS _fbm / _turbulence exactly
  float hsh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float ns(vec2 p){
    vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
    return mix(mix(hsh(i),hsh(i+vec2(1,0)),u.x),
               mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),u.x),u.y);
  }
  float fbm(vec2 p){
    float v=0.,a=.5;
    for(int i=0;i<5;i++){v+=a*ns(p);p=p*2.1+vec2(1.7,9.2);a*=.48;}
    return v;
  }
  float turb(vec2 xz,float t){
    return fbm(xz*.25+vec2(t*.08,t*.06))*.20
          +fbm(xz*.60+vec2(t*.15,t*.12))*.09
          +fbm(xz*1.4+vec2(t*.25,t*.20))*.035;
  }

  // 6 Gerstner waves — mirrors JS _WD table
  float gH(vec2 xz,float t){
    float h=0.;
    h+=sin(dot(normalize(vec2( .80, .60)),xz)*.140+t*1.00+0.00)*.28;
    h+=sin(dot(normalize(vec2(-.50, .90)),xz)*.250+t*0.90+1.30)*.18;
    h+=sin(dot(normalize(vec2( .60,-.80)),xz)*.400+t*1.10+2.60)*.12;
    h+=sin(dot(normalize(vec2(-.90, .20)),xz)*.575+t*0.70+0.90)*.08;
    h+=sin(dot(normalize(vec2( .30,1.00)),xz)*.775+t*1.30+3.70)*.05;
    h+=sin(dot(normalize(vec2(-.70,-.50)),xz)*1.125+t*0.85+1.80)*.03;
    return h;
  }

  void main(){
    vec3  pos = position;
    float t   = uTime * 0.50;
    float h   = gH(pos.xz, t) + turb(pos.xz, t);
    pos.y     = h;

    // Normal via finite differences (same as buoy reference)
    float e   = 0.8;
    float dxp = gH(pos.xz+vec2(e,0.),t)+turb(pos.xz+vec2(e,0.),t);
    float dxm = gH(pos.xz-vec2(e,0.),t)+turb(pos.xz-vec2(e,0.),t);
    float dzp = gH(pos.xz+vec2(0.,e),t)+turb(pos.xz+vec2(0.,e),t);
    float dzm = gH(pos.xz-vec2(0.,e),t)+turb(pos.xz-vec2(0.,e),t);
    vNormal   = normalize(vec3(-(dxp-dxm)/(2.*e), 1., -(dzp-dzm)/(2.*e)));

    vWorldPos   = pos;
    vWaveH      = h;
    vReflCoord  = uReflProjView * vec4(pos, 1.0);

    // Foam: based on wave height + noise (ported from buoy reference)
    float fn = ns(pos.xz*2.0+vec2(t*.30))*.5 + ns(pos.xz*5.0+vec2(t*.70))*.3;
    vFoam  = smoothstep(.22,.92, h/0.74) * smoothstep(.15,.80, fn);
    vDepth = clamp((h + 0.74) / 1.48, 0., 1.);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.);
  }
`;

// ── Fragment shader ───────────────────────────────────────────────
const FRAG = /* glsl */`
  uniform float     uTime;
  uniform vec3      uCamPos;
  uniform vec3      uSunDir;
  uniform float     uFoamStr;     // 0.05 (calm) → 0.55 (storm)
  uniform sampler2D uReflTex;     // planar reflection texture (high graphics)
  uniform float     uReflEnabled; // 1.0 = high graphics, 0.0 = off

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vWaveH;
  varying float vFoam;
  varying float vDepth;
  varying vec4  vReflCoord;

  float hsh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float ns(vec2 p){
    vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
    return mix(mix(hsh(i),hsh(i+vec2(1,0)),u.x),
               mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),u.x),u.y);
  }

  void main(){
    vec3  N = normalize(vNormal);
    vec3  V = normalize(uCamPos - vWorldPos);
    vec3  L = normalize(uSunDir);
    vec3  H = normalize(L + V);

    // Fresnel
    float fr = pow(1.0 - max(dot(N,V), 0.0), 3.5);

    // Water colour — deep blue → shallow turquoise
    const vec3 DEEP    = vec3(0.010, 0.060, 0.175);
    const vec3 SHALLOW = vec3(0.055, 0.260, 0.420);
    vec3 wc = mix(DEEP, SHALLOW, vDepth * 0.7);

    // Fresnel pushes toward sky reflection
    vec3 skyRef = mix(vec3(0.20, 0.38, 0.72), vec3(0.65, 0.80, 0.95), fr);
    wc = mix(wc, skyRef, fr * 0.40);

    // Diffuse + specular (sun)
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 110.0) * 0.75;
    wc += diff * 0.09 + spec * vec3(1.0, 0.97, 0.88);

    // Sub-surface scatter glow through wave crests
    float sss = pow(max(dot(L, -V), 0.0), 4.0) * max(0.0, vWaveH + 0.1) * 1.8;
    wc += vec3(0.03, 0.14, 0.12) * sss;

    // Subtle under-surface light variation
    wc += ns(vWorldPos.xz * 1.5 + vec2(uTime * 0.05)) * 0.04 * SHALLOW;

    // Planar reflection (high-graphics only): projective texture lookup distorted by normal
    if (uReflEnabled > 0.5) {
      vec2 reflUV = vReflCoord.xy / vReflCoord.w * 0.5 + 0.5;
      // Distort by surface normal — wave crests bend the reflected image
      reflUV += N.xz * 0.04 * fr;
      reflUV = clamp(reflUV, 0.01, 0.99);
      vec3 reflColor = texture2D(uReflTex, reflUV).rgb;
      // Blend driven by Fresnel: grazing angles show most reflection
      wc = mix(wc, reflColor, fr * 0.55);
    }

    // Foam (vertex-computed vFoam × fragment noise for texture)
    float fn2 = ns(vWorldPos.xz*3.0+vec2(uTime*.20))*.5
              + ns(vWorldPos.xz*8.0+vec2(uTime*.50))*.3;
    float fm  = smoothstep(.32 - uFoamStr*.22, .92, vFoam)
              * smoothstep(.18, .82, fn2);
    wc = mix(wc, vec3(0.93, 0.97, 1.00), fm * uFoamStr);

    gl_FragColor = vec4(wc, 0.88 + fr * 0.10);
  }
`;

export class Ocean {
  constructor(scene) {
    this._geo = new THREE.PlaneGeometry(MAP + 80, MAP + 80, 128, 128);
    this._geo.rotateX(-Math.PI / 2);
    this._uniforms = {
      uTime:        { value: 0 },
      uCamPos:      { value: new THREE.Vector3() },
      uSunDir:      { value: new THREE.Vector3(0.55, 0.85, 0.42) },
      uFoamStr:     { value: 0.18 },
      uReflTex:     { value: null },
      uReflEnabled: { value: 0 },
      uReflProjView:{ value: new THREE.Matrix4() },
    };
    this._mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms:       this._uniforms,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(this._geo, this._mat);
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(t, camera, sunDir) {
    this._uniforms.uTime.value = t;
    if (camera) this._uniforms.uCamPos.value.copy(camera.position);
    if (sunDir) this._uniforms.uSunDir.value.copy(sunDir);
  }

  // Called by PlanarReflection each frame when high-graphics is on
  setReflection(texture, projViewMatrix) {
    this._uniforms.uReflTex.value      = texture;
    this._uniforms.uReflEnabled.value  = texture ? 1 : 0;
    if (projViewMatrix) this._uniforms.uReflProjView.value.copy(projViewMatrix);
  }

  destroy() { this._geo.dispose(); this._mat.dispose(); }
}
