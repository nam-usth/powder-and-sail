import * as THREE from 'three';
import { atmosphere, dayPhaseAt, DAY_RATE, SUN_MAX_ELEV, SUN_MIN_ELEV, CLOUD_TILE } from './Atmosphere.js';
import { getNoiseTexture } from './OceanTextures.js';
import { gfx, SKY_LAYER } from '../Render/GfxQuality.js';
import '../Render/ShaderPatches.js';   // tone-curve chunk installed before any compile

// ── SKY ─────────────────────────────────────────────────────────
// Physically-inspired sky dome driven by the shared Atmosphere palette:
//   • zenith → horizon gradient, a warm sunward band low on the horizon,
//     Mie halo + HDR sun disc (it blooms in the reflection on HIGH)
//   • below the horizon: the far-sea haze colour, so sea and sky meet with
//     no seam (the ocean fogs to the same colour)
//   • HIGH: drifting fbm clouds lit from the sun's side, stars and a moon
//
// Rendered at infinity: the dome is centred on the camera in the vertex
// shader (view rotation only, z = w), so it never clips at the far plane and
// needs no per-frame transform. It lives on SKY_LAYER: the RTS camera never
// sees above the horizon, so Renderer only lets the main camera draw it when
// the horizon is in view (and then AFTER the opaque sea, which writes depth,
// so only true sky pixels shade). The planar reflection always draws it.
//
// The sun path: GameApp's day cycle (dayPhase = sin(t·0.035 + π/2)·½ + ½)
// sets the elevation (SUN_MIN_ELEV … SUN_MAX_ELEV, crossing the horizon as the
// lanterns light). The azimuth swings with the cycle, from the north-east in
// the morning through the north-north-west at noon to the west at dusk —
// always in front of the RTS camera (which looks north), so the glitter path
// lies on screen and shadows fall toward the viewer.

const DEG = Math.PI / 180;

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * vec4( ( viewMatrix * vec4( position, 0.0 ) ).xyz, 1.0 );
    gl_Position = vec4( p.xy, p.w * 0.99999, p.w );   // at infinity (behind the sea's far ring)
  }
`;

const FRAG = /* glsl */`
  uniform vec3  uSunDir, uMoonDir, uZenith, uHorizon, uGlow, uSunColor, uFog;
  uniform float uSunVis, uNight, uTime;
  uniform sampler2D uNoise;
  uniform vec2  uCloudDrift;
  varying vec3  vDir;

  float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }

  void main() {
    vec3  d  = normalize( vDir );
    float y  = d.y;
    float h  = clamp( y, 0.0, 1.0 );
    float mu = dot( d, uSunDir );

    // Rayleigh-ish gradient + warm sunward band low on the horizon
    vec3 col = mix( uHorizon, uZenith, sqrt( h ) );
    float sunward = pow( clamp( 0.5 + 0.5 * mu, 0.0, 1.0 ), 4.0 );
    col = mix( col, uGlow, clamp( sunward * pow( 1.0 - h, 5.0 ) * 1.2, 0.0, 1.0 ) );

    #ifdef HQ
    // Clouds: fbm on a flattened dome, lit from the sun's side
    vec2 cuv = d.xz / ( h + 0.16 ) * 0.22 + uCloudDrift * ${(1 / CLOUD_TILE).toFixed(6)};
    float n  = texture2D( uNoise, cuv ).r * 0.65 + texture2D( uNoise, cuv * 2.0 + 0.37 ).g * 0.35;
    float cover = smoothstep( 0.50, 0.78, n ) * smoothstep( 0.02, 0.16, h );
    vec3 cloud = mix( uHorizon * 0.85 + 0.08, uSunColor * 1.05, 0.35 + 0.45 * sunward ) * ( 1.0 - 0.65 * uNight );
    col = mix( col, cloud, cover * 0.8 );

    // Stars + moon (night)
    if ( uNight > 0.01 ) {
      vec2 g  = d.xz / ( h + 0.35 ) * 90.0;
      vec2 ci = floor( g ), cf = fract( g ) - 0.5;
      float r = hash12( ci );
      vec2 jit = vec2( hash12( ci + 7.1 ), hash12( ci + 3.7 ) ) - 0.5;
      float star = step( 0.93, r ) * smoothstep( 0.16, 0.0, length( cf - jit * 0.6 ) );
      star *= 0.6 + 0.4 * sin( uTime * ( 1.5 + 3.0 * r ) + r * 40.0 );
      col += vec3( 0.85, 0.9, 1.0 ) * star * uNight * smoothstep( 0.04, 0.25, h ) * ( 1.0 - cover );
      float mm = dot( d, uMoonDir );
      col += vec3( 0.9, 0.93, 1.0 ) * smoothstep( 0.99925, 0.9996, mm ) * uNight * 2.2;
      col += vec3( 0.25, 0.32, 0.55 ) * pow( max( mm, 0.0 ), 48.0 ) * 0.35 * uNight;
    }
    #endif

    // Sun: Mie halo + HDR disc
    float m = max( mu, 0.0 );
    col += uSunColor * uSunVis * ( 0.10 * pow( m, 12.0 ) + 0.40 * pow( m, 380.0 ) );
    col += uSunColor * uSunVis * smoothstep( 0.99940, 0.99968, mu ) * 6.0;

    // Below the horizon: the far-sea haze, so sea and sky meet without a seam
    col = mix( col, uFog, 1.0 - smoothstep( -0.07, 0.015, y ) );

    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <encodings_fragment>
  }
`;

export class Sky {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    const A = atmosphere;
    this._sun = new THREE.Vector3();
    this._uniforms = {
      uTime:       { value: 0 },
      uSunDir:     { value: A.sunDir },        // shared objects: no per-frame copies
      uMoonDir:    { value: A.moonDir },
      uZenith:     { value: A.skyZenith },
      uHorizon:    { value: A.skyHorizon },
      uGlow:       { value: A.skyGlow },
      uSunColor:   { value: A.sunColor },
      uFog:        { value: A.fogColor },
      uSunVis:     { value: 1 },
      uNight:      { value: 0 },
      uNoise:      { value: getNoiseTexture() },
      uCloudDrift: { value: A.cloudDrift },
    };
    this._mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this._uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      defines: gfx.high ? { HQ: 1 } : {},
    });
    this._mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this._mat);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder   = 2;          // after the opaque sea (renderOrder 1): depth-rejected under it
    this._mesh.layers.set(SKY_LAYER);      // main camera draws it only with the horizon in view (Renderer)
    scene.add(this._mesh);
    gfx.on('change.sky', () => this._applyTier());
    this.update(0);
  }

  _applyTier() {
    const want = gfx.high;
    if (!!this._mat.defines.HQ === want) return;
    if (want) this._mat.defines.HQ = 1; else delete this._mat.defines.HQ;
    this._mat.needsUpdate = true;
  }

  /** Current TRUE sun direction (may be below the horizon at night). */
  getSunDir() { return atmosphere.sunDir; }

  /** Dominant light direction (sun by day, moon by night). */
  getLightDir() { return atmosphere.keyDir; }

  /** GameApp's day phase for the last update (0 midnight … 1 noon). */
  get dayPhase() { return atmosphere.dayPhase; }

  /**
   * Advance the sky to elapsed time t (seconds): sun path + the shared
   * atmosphere palette every other system reads this frame.
   */
  update(t) {
    const dp   = dayPhaseAt(t);
    const elev = (SUN_MIN_ELEV + (SUN_MAX_ELEV - SUN_MIN_ELEV) * dp) * DEG;
    const az   = (25 + 45 * Math.sin(t * DAY_RATE)) * DEG;      // from north (−z) toward west (−x)
    this._sun.set(-Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));
    atmosphere.update(this._sun, dp, t);
    const u = this._uniforms;
    u.uTime.value   = t;
    u.uSunVis.value = atmosphere.sunVis;
    u.uNight.value  = atmosphere.night;
  }

  destroy() {
    gfx.off('change.sky');
    this._mesh.parent?.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
  }
}
