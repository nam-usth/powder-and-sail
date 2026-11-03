import * as THREE from 'three';
// ── SKY ─────────────────────────────────────────────────────────
// AF6 upgrade: Dynamic sun disc + animated god rays + sunset palette.
//
//  AF6-Sky.1  Sun disc — crisp solar disc with limb darkening
//  AF6-Sky.2  God rays — 6 radial light shafts from sun
//  AF6-Sky.3  Sunset color grading — sky transitions by uTime
//             (slow cycle: noon blue → golden hour → dusk purple)
//  AF6-Sky.4  Horizon glow — warm band above ocean surface
//  AF6-Sky.5  Stars — twinkling points appear as sky darkens

const VERT = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vDir;

  void main() {
    vWorldPos = position;
    vDir      = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  varying vec3 vWorldPos;
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3  uSunDir;   // world-space sun direction (normalised)

  // ── Hash helpers ─────────────────────────────────────────────
  float hash1(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p)  {
    p = fract(p * vec2(127.1, 311.7));
    return fract(dot(p, p + 19.19));
  }

  // ── Star field ───────────────────────────────────────────────
  float stars(vec3 dir) {
    // Project onto upper hemisphere; no stars below horizon
    if (dir.y < 0.05) return 0.0;
    // Tile sphere into cells, place a star per cell
    vec2 uv   = vec2(atan(dir.z, dir.x) / 6.28318, dir.y);
    uv       *= 80.0;
    vec2 cell = floor(uv);
    vec2 lc   = fract(uv) - 0.5;
    // Star position within cell
    vec2 starPos = vec2(hash2(cell) - 0.5, hash2(cell + 31.7) - 0.5) * 0.8;
    float d   = length(lc - starPos);
    float s   = smoothstep(0.08, 0.0, d);
    // Twinkle
    float twinkle = 0.6 + 0.4 * sin(uTime * (2.0 + hash1(hash2(cell) * 7.3)) + hash2(cell) * 6.28);
    return s * twinkle;
  }

  // ── God rays ─────────────────────────────────────────────────
  float godRays(vec3 dir, vec3 sunDir) {
    // Project dir onto plane perpendicular to sunDir
    vec3 perp = normalize(dir - dot(dir, sunDir) * sunDir);
    float angle = atan(perp.y, perp.x);

    // 6 radial spokes
    float rays = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472 + uTime * 0.04;  // 60° apart, slow rotate
      float diff = mod(abs(angle - a), 3.14159);
      diff = min(diff, 3.14159 - diff);
      float w = smoothstep(0.18, 0.0, diff);
      rays = max(rays, w);
    }

    // Only near sun; fade with distance from sun
    float cosSun = max(dot(dir, sunDir), 0.0);
    float halo   = smoothstep(0.6, 0.95, cosSun);

    // AT: cloud mask — drifting pseudo-clouds occlude individual shafts so
    // rays fade in/out over time instead of being permanently visible.
    float cloud = 0.5
                + 0.35 * sin(angle * 3.0 + uTime * 0.13)
                + 0.25 * sin(angle * 7.0 - uTime * 0.07 + 1.7);
    cloud = smoothstep(0.15, 0.75, cloud);

    return rays * halo * cloud * 0.18;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h  = clamp(dir.y, 0.0, 1.0);  // 0=horizon, 1=zenith

    // ── AF6-Sky.3: Slow day cycle (period ~180s) ─────────────
    float dayPhase = sin(uTime * 0.035 + 1.5708) * 0.5 + 0.5;  // 0=night, 1=noon; +π/2 so game starts at noon

    // Noon sky
    vec3 horizonNoon  = vec3(0.38, 0.60, 0.82);
    vec3 midNoon      = vec3(0.18, 0.40, 0.72);
    vec3 zenithNoon   = vec3(0.06, 0.14, 0.38);

    // Sunset sky
    vec3 horizonSet   = vec3(0.92, 0.38, 0.08);
    vec3 midSet       = vec3(0.45, 0.22, 0.52);
    vec3 zenithSet    = vec3(0.08, 0.06, 0.28);

    // Night sky
    vec3 horizonNight = vec3(0.04, 0.05, 0.14);
    vec3 midNight     = vec3(0.02, 0.03, 0.10);
    vec3 zenithNight  = vec3(0.005,0.006,0.025);

    // Blend noon ↔ sunset ↔ night based on dayPhase
    float sunsetPhase = smoothstep(0.3, 0.6, dayPhase) * (1.0 - smoothstep(0.6, 1.0, dayPhase)) * 2.0;
    sunsetPhase       = clamp(sunsetPhase, 0.0, 1.0);
    float noonPhase   = smoothstep(0.55, 0.80, dayPhase);
    float nightPhase  = 1.0 - smoothstep(0.0, 0.25, dayPhase);

    vec3 horizon = mix(mix(horizonNight, horizonSet, min(sunsetPhase + dayPhase*0.5, 1.0)), horizonNoon, noonPhase);
    vec3 mid     = mix(mix(midNight,     midSet,     sunsetPhase * 0.8), midNoon, noonPhase);
    vec3 zenith  = mix(mix(zenithNight,  zenithSet,  sunsetPhase * 0.6), zenithNoon, noonPhase);

    vec3 col = mix(horizon, mid,    smoothstep(0.0, 0.30, h));
    col      = mix(col,     zenith, smoothstep(0.20, 1.0,  h));

    // ── AF6-Sky.4: Horizon warm glow ─────────────────────────
    float horizonGlow = pow(1.0 - h, 4.0) * 0.6 * (0.4 + 0.6 * dayPhase);
    col += vec3(0.55, 0.28, 0.06) * horizonGlow;

    // ── AF6-Sky.1: Sun disc ──────────────────────────────────
    float cosSun = dot(dir, uSunDir);
    // Sharp disc edge
    float disc   = smoothstep(0.9982, 0.9990, cosSun);
    // Limb darkening: sun is brighter at center
    float limb   = 1.0 - (1.0 - smoothstep(0.9990, 1.0, cosSun)) * 0.3;
    vec3  sunCol = mix(vec3(1.0, 0.85, 0.55), vec3(1.0, 0.97, 0.88), noonPhase);
    col = mix(col, sunCol * limb, disc);

    // Solar corona / halo
    float corona = smoothstep(0.994, 0.9982, cosSun) * 0.25 * (0.5 + 0.5 * dayPhase);
    col += sunCol * corona * 0.4;

    // ── AF6-Sky.2: God rays ──────────────────────────────────
    float rays  = godRays(dir, uSunDir) * (0.3 + 0.7 * (1.0 - noonPhase));
    col += sunCol * rays;

    // ── AF6-Sky.5: Stars (visible when dark) ─────────────────
    float starVis = 1.0 - smoothstep(0.15, 0.45, dayPhase);
    float starVal = stars(dir);
    col = mix(col, col + vec3(0.85, 0.88, 0.95) * starVal, starVis * 0.9);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(500, 32, 16);
    this._uniforms = {
      uTime:   { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms:       this._uniforms,
      side:           THREE.BackSide,
      depthWrite:     false,
    });
    this._mesh = new THREE.Mesh(geo, mat);
    this._mat  = mat;
    scene.add(this._mesh);
  }

  // Returns current sun direction (used by Ocean for specular matching)
  getSunDir() { return this._uniforms.uSunDir.value; }

  update(t) {
    this._uniforms.uTime.value = t;
    // Slowly orbit sun direction (synced with day cycle in shader)
    const phase = Math.sin(t * 0.035 + 1.5708) * 0.5 + 0.5;
    const elev  = Math.PI * 0.05 + phase * Math.PI * 0.35;  // 9°→72° elevation
    const az    = t * 0.008;  // slow azimuth rotation
    this._uniforms.uSunDir.value.set(
      Math.cos(az) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(az) * Math.cos(elev)
    ).normalize();
  }

  destroy() {
    this._mesh.geometry.dispose();
    this._mat.dispose();
  }
}
