import * as THREE from 'three';

// ── Shared VFX environment uniforms ────────────────────────────────
// Every VFX shader reads lighting, fog, wind and time from these SHARED
// uniform objects instead of `lights:true`. Two reasons:
//   • no dependency on the scene's light COUNT → GameApp's night lanterns
//     (PointLights added/removed at dusk) never force VFX shader recompiles
//   • one JS write per frame feeds every particle field / decal / debris
//
// `syncEnvFromScene(scene)` copies the sun (shadow-casting DirectionalLight),
// ambient light and fog into the uniforms once per frame, so smoke darkens
// at night and sits in the same haze as the ships.

export const ENV = {
  uTime:       { value: 0 },                                         // VFX clock (s)
  uSunDir:     { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() }, // world, towards sun
  uSunCol:     { value: new THREE.Color(1.45, 1.35, 1.15) },        // colour × intensity
  uAmbCol:     { value: new THREE.Color(0.30, 0.40, 0.62) },
  uFogCol:     { value: new THREE.Color(0x6688aa) },
  uFogDensity: { value: 0.0032 },
  uWind:       { value: new THREE.Vector3(1.05, 0, 0.45) },          // drift velocity (u/s)
  uPxScale:    { value: 800 },   // viewportHeightPx * P[1][1] / 2 (set per render pass)
  uViewport:   { value: new THREE.Vector2(1440, 810) },
  uMaxPx:      { value: 420 },
  uSoft:       { value: 1 },     // 1 = soft water/camera fades (HIGH)
  // Up to 3 transient flash lights (muzzle / explosion) that tint nearby smoke
  uFlashPos:   { value: [new THREE.Vector4(0, -999, 0, 0), new THREE.Vector4(0, -999, 0, 0), new THREE.Vector4(0, -999, 0, 0)] },
  uFlashCol:   { value: new THREE.Color(1.0, 0.55, 0.18) },
};

let _sun = null, _amb = null, _hemi = null, _scanT = 0;
const _tmp = new THREE.Vector3();
const _hc = new THREE.Color();

/** Find the scene's sun, ambient and hemisphere lights (direct children only — cheap). */
function _findLights(scene) {
  _sun = null; _amb = null; _hemi = null;
  const ch = scene?.children;
  if (!Array.isArray(ch)) return;
  for (const c of ch) {
    if (c.isDirectionalLight && (c.castShadow || !_sun)) _sun = c;
    else if (c.isAmbientLight && !_amb) _amb = c;
    else if (c.isHemisphereLight && !_hemi) _hemi = c;
  }
}

/**
 * Copy sun / ambient / fog from the scene into ENV. Call once per frame.
 * Safe with stub scenes (unit tests): missing lights keep the defaults.
 * @param {THREE.Scene} scene
 * @param {number} dt
 */
export function syncEnvFromScene(scene, dt = 0) {
  _scanT -= dt;
  if (_scanT <= 0 || (_sun && !_sun.parent) || (_amb && !_amb.parent) || (_hemi && !_hemi.parent)) { _findLights(scene); _scanT = 2.0; }
  if (_sun) {
    _tmp.copy(_sun.position);
    if (_sun.target) _tmp.sub(_sun.target.position);
    if (_tmp.lengthSq() > 1e-6) ENV.uSunDir.value.copy(_tmp.normalize());
    ENV.uSunCol.value.copy(_sun.color).multiplyScalar(_sun.intensity);
  }
  if (_amb || _hemi) {
    // fill light for particles: ambient + the hemisphere's sky-weighted average
    const a = ENV.uAmbCol.value.setRGB(0, 0, 0);
    if (_amb) a.copy(_amb.color).multiplyScalar(_amb.intensity);
    if (_hemi) a.add(_hc.copy(_hemi.groundColor).lerp(_hemi.color, 0.65).multiplyScalar(_hemi.intensity));
  }
  const fog = scene?.fog;
  if (fog && fog.color) {
    ENV.uFogCol.value.copy(fog.color);
    ENV.uFogDensity.value = fog.density ?? 0.0;
  }
}

const _vp = new THREE.Vector4();
/**
 * onBeforeRender hook for point-sprite fields: converts world sizes to pixels
 * for the CURRENT render pass (main canvas, bloom target or the half-res
 * planar-reflection target all get the right scale).
 */
export function updatePointScale(renderer, camera) {
  renderer.getCurrentViewport(_vp);
  const h = _vp.w || 1;
  ENV.uPxScale.value  = h * camera.projectionMatrix.elements[5] * 0.5;
  ENV.uViewport.value.set(_vp.z || 1, h);
}

/** Nightness 0 (noon) … 1 (deep night) derived from the live sun colour. */
export function nightFactor() {
  const c = ENV.uSunCol.value;
  const lum = (c.r + c.g + c.b) / 3;
  return 1 - Math.min(1, Math.max(0, (lum - 0.35) / 0.9));
}
