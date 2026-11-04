import * as THREE from 'three';
import { MAP } from '../../data/constants.js';
import { atmosphere, CLOUD_TILE } from './Atmosphere.js';
import { getWaveNormalTexture, getNoiseTexture } from './OceanTextures.js';
import { gfx } from '../Render/GfxQuality.js';
import { CLOUD_GLSL, SHARED_UNIFORMS } from '../Render/ShaderPatches.js';
import { bakeShoreField, sampleShoreField, normaliseIsland, FIELD_HALF, D_MIN, D_RANGE } from './ShoreField.js';

// ── OCEAN ───────────────────────────────────────────────────────
// Stylised-realistic Caribbean sea:
//   geometry  six sharpened swell waves (exp-sine "trochoid" profile: sharp
//             crests, broad troughs) displace a grid that runs to the horizon;
//             the same function runs on the CPU (getWaveHeight) for buoyancy,
//             wakes and physics, so ships ride exactly the drawn surface.
//   detail    an FFT-spectrum normal map (World/OceanTextures.js) scrolled at
//             two scales and speeds; HIGH adds the second layer.
//   colour    deep blue open sea with large slow patches → teal within ~60 u
//             of land → bright turquoise lagoon shelf (organic edge) → pale
//             sand-aqua shallows; caustics dance on the shelf (HIGH); a
//             stylised crest-streak texture keeps the wave pattern readable.
//   light     Fresnel sky reflection (analytic, the Sky's own palette; the
//             planar reflection on HIGH), sun / moon glitter path (HDR: it
//             blooms), subsurface glow through crests when looking sunward,
//             sun shadows from ships and islands (HIGH + shadows), drifting
//             cloud shadows (HIGH), fog into the horizon haze.
//   foam      lapping shoreline bands + a bright waterline edge, whitecaps on
//             the sharpest crests (more in a storm: SeaEvents' thick fog).
//
// Islands: setIslands(list) — waves calm and foam/shelf form along their
// shores. Circles (x, z, r, shapeType) are analytic; islands with a real
// outline (island.shore polygons or island.landAt(x, z)) — e.g. a harbour
// wrapped around a bay — are baked into a signed distance field
// (World/ShoreField.js) that the shader and getWaveHeight share. Until
// GameApp calls setIslands, the ocean picks up window._game._islands itself.
//
// Performance: one draw call; per-vertex waves + shore distance (the grid is
// fine where the camera can look, geometric beyond); 2-3 texture reads on
// LOW, ~9 on HIGH; no per-frame allocations. The sea is OPAQUE and writes
// depth: islands and hulls drawn first reject its fragments early, and the
// sky (drawn after) is rejected wherever the sea is — i.e. everywhere on the
// RTS view.

// ── Wave table (shared CPU ↔ GLSL) ───────────────────────────────
// [travel direction (deg, from +x toward +z), wavelength, amplitude, sharpness q, phase]
// Trade wind from the east: the swell runs west (180°) with ±60° spread.
const WAVE_DEFS = [
  [188, 64.0, 0.24, 0.9, 0.0],
  [165, 41.0, 0.19, 1.0, 1.3],
  [212, 27.0, 0.13, 1.1, 2.6],
  [146, 18.0, 0.09, 1.2, 0.9],
  [232, 12.5, 0.06, 1.3, 3.7],
  [124,  9.0, 0.03, 1.4, 1.8],
];
const NW = WAVE_DEFS.length;
const G_WAVE = 3.0;   // "gravity" in world units/s²: deep-water dispersion ω = √(g·k)

/** Global wave clock multiplier (CPU and GPU share it). */
export const WAVE_SPEED = 1.0;
/** Σ amplitudes — the crest bound of getWaveHeight (buoyancy + tests). */
export const TOTAL_AMP  = 0.74;

function besselI0(x) {           // modified Bessel I0 (series) — mean of exp(q·sinθ)
  let s = 1, t = 1;
  for (let j = 1; j < 25; j++) { t *= (x / 2) * (x / 2) / (j * j); s += t; }
  return s;
}

// Per wave: kx, kz, amp, omega, phase, q, norm, mean   (8 floats)
const _W = new Float64Array(NW * 8);
WAVE_DEFS.forEach(([deg, len, amp, q, ph], i) => {
  const k = 2 * Math.PI / len, a = deg * Math.PI / 180;
  const m = Math.exp(-q) * besselI0(q);          // mean of exp(q(sinθ−1)) → zero-mean profile
  _W.set([Math.cos(a) * k, Math.sin(a) * k, amp, Math.sqrt(G_WAVE * k), ph, q, amp / (1 - m), m], i * 8);
});

// Damping: calmer water near shores (no flooding of beaches), flat beyond the
// fine grid (no aliasing on the coarse horizon ring).
const SHORE_MIN = 0.3, SHORE_W = 20;
const INNER     = MAP / 2 + 50;            // half-size of the fine grid
const FAR0 = INNER + 5, FAR1 = INNER + 40;
const MAX_ISL = 16;

// Waterline radius / island r, per IslandEntity shore cylinder (radius at y=0).
const SHORE_K = { SPRAWL: 1.17, MIRROR: 1.17, CRESCENT: 1.11, ATOLL: 1.07, FORTRESS: 1.0 };

const _isl = new Float64Array(MAX_ISL * 4);
let _islN = 0;
let _field = null;          // Float32Array signed distance grid when any island has an outline
let _fieldTex = null;       // its texture (shared by every Ocean)

function _smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Signed distance (world u) from (x, z) to the nearest island waterline. */
export function shoreDistance(x, z) {
  if (_field) return sampleShoreField(_field, x, z);
  let d = 1e4;
  for (let i = 0; i < _islN; i++) {
    const o = i * 4, dx = x - _isl[o], dz = z - _isl[o + 1];
    d = Math.min(d, Math.sqrt(dx * dx + dz * dz) - _isl[o + 2]);
  }
  return d;
}

function _damp(x, z) {
  const d = shoreDistance(x, z);
  const shore = SHORE_MIN + (1 - SHORE_MIN) * _smooth(0, SHORE_W, d);
  return shore * (1 - _smooth(FAR0, FAR1, Math.max(Math.abs(x), Math.abs(z))));
}

/**
 * Sea-surface height at world (x, z) and time t (seconds) — exactly what the
 * vertex shader draws (bar float precision). Zero-mean, |h| ≤ TOTAL_AMP.
 */
export function getWaveHeight(x, z, t) {
  const tt = t * WAVE_SPEED;
  let h = 0;
  for (let i = 0; i < NW; i++) {
    const o = i * 8;
    const th = _W[o] * x + _W[o + 1] * z - _W[o + 3] * tt + _W[o + 4];
    h += _W[o + 6] * (Math.exp(_W[o + 5] * (Math.sin(th) - 1)) - _W[o + 7]);
  }
  return h * _damp(x, z);
}

/**
 * Register island shorelines (shared by every Ocean and getWaveHeight).
 * Each item: { x, z, r, shapeType? | def.shape?, shore?, landAt? } — see
 * World/ShoreField.js. Circles only → analytic; any outline → baked field.
 * @param {Array<object>} list  IslandEntity list or plain defs
 * @returns {number} islands registered
 */
export function setOceanIslands(list) {
  const norm = (list || []).map(i => normaliseIsland(i, SHORE_K)).filter(Boolean);
  _islN = 0;
  for (const n of norm) {
    if (_islN >= MAX_ISL) break;
    _isl.set([n.x, n.z, n.R, 0], _islN * 4);   // bounding circles: the WebGL1 fallback
    _islN++;
  }
  _fieldTex?.dispose();
  _field = null; _fieldTex = null;
  if (norm.some(n => n.polys || n.landAt) || norm.length > MAX_ISL) {
    const f = bakeShoreField(norm);
    _field = f.dist; _fieldTex = f.texture;
  }
  return norm.length;
}

// ── Shaders ──────────────────────────────────────────────────────
// Per-vertex where the signal is smooth (swell, shore distance, colour
// patches, shelf-edge warp, cloud shade on WebGL2); per-pixel only for what
// must be crisp (detail normal, glint, foam, ship shadows). Shore work and
// foam sit behind coherent branches, so the open sea skips them.
const SHORE_GLSL = /* glsl */`
  float shoreDist( vec2 p ) {
    vec2  c = clamp( p, vec2( -${FIELD_HALF.toFixed(1)} ), vec2( ${FIELD_HALF.toFixed(1)} ) );
    vec4  t = texture2D( uShoreTex, ( c + ${FIELD_HALF.toFixed(1)} ) * ${(1 / (2 * FIELD_HALF)).toFixed(8)} );
    float d = ( t.r * 65280.0 + t.g * 255.0 ) * ${(D_RANGE / 65535).toFixed(10)} + ${D_MIN.toFixed(1)};
    return min( d, ${(D_MIN + D_RANGE).toFixed(1)} ) + length( p - c );
  }
`;

const VERT = /* glsl */`
  #define NW ${NW}
  uniform float uTime;
  uniform vec4  uWA[ NW ];      // kx, kz, amp, omega
  uniform vec4  uWB[ NW ];      // phase, q, norm, mean
  uniform vec4  uIsl[ ISL_N ];  // x, z, waterline radius, - (circles; WebGL1 fallback)
  uniform mat4  uReflMatrix;
  #if defined( SHORE_TEX ) && __VERSION__ >= 300
  uniform sampler2D uShoreTex;
  ${SHORE_GLSL}
  #else
  float shoreDist( vec2 p ) {
    float d = 1e4;
    for ( int i = 0; i < ISL_N; i++ ) d = min( d, length( p - uIsl[ i ].xy ) - uIsl[ i ].z );
    return d;
  }
  #endif
  uniform mat4  uShadowMatrix;
  #if defined( HQ ) && __VERSION__ >= 300
  uniform sampler2D iowCloudTex;
  uniform vec3  iowCloud;
  ${CLOUD_GLSL}
  #endif

  varying vec3  vWorld;
  varying vec3  vGeo;           // xy: swell slope (dh/dx, dh/dz); z: crest factor 0..1
  varying vec3  vMisc;          // x: shore distance (world u); y: colour patch 0..1; z: shelf-edge warp ±0.5
  varying vec2  vFogLit;        // x: view depth (fog); y: cloud shade
  #ifdef USE_REFL
  varying vec4  vRefl;
  #endif
  #ifdef USE_SHADOW
  varying vec4  vShadow;
  #endif

  void main() {
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vec2 p  = wp.xz;

    float dS   = shoreDist( p );
    float far  = 1.0 - smoothstep( ${FAR0.toFixed(1)}, ${FAR1.toFixed(1)}, max( abs( p.x ), abs( p.y ) ) );
    float damp = mix( ${SHORE_MIN.toFixed(3)}, 1.0, smoothstep( 0.0, ${SHORE_W.toFixed(1)}, dS ) ) * far;

    float h = 0.0, crest = 0.0;
    vec2 g = vec2( 0.0 );
    for ( int i = 0; i < NW; i++ ) {
      vec4 a = uWA[ i ], b = uWB[ i ];
      float th = dot( a.xy, p ) - a.w * uTime + b.x;
      float s  = sin( th );
      float e  = exp( b.y * ( s - 1.0 ) );
      h     += b.z * ( e - b.w );
      g     += ( b.z * b.y * cos( th ) * e ) * a.xy;
      crest += a.z * e;
    }
    wp.y   = h * damp;
    vGeo   = vec3( g * damp, clamp( crest * ( 1.0 / ${TOTAL_AMP.toFixed(3)} ), 0.0, 1.0 ) * damp );
    vWorld = wp.xyz;

    // Slow organic fields: deep-colour patches (~250 u) and the shelf edge warp (~50 u)
    float pa = sin( p.x * 0.021 + 1.7 * sin( p.y * 0.017 ) ) + sin( p.y * 0.026 + 1.3 + 1.9 * sin( p.x * 0.013 ) );
    float pb = 0.6 * sin( p.x * 0.11 + 2.1 * sin( p.y * 0.083 ) + 0.7 ) + 0.4 * sin( p.y * 0.13 + 1.6 * sin( p.x * 0.07 ) );
    vMisc = vec3( dS, 0.5 + 0.25 * pa, 0.5 * pb );

    vec4 mv = viewMatrix * wp;
    vFogLit.x = -mv.z;
    #if defined( HQ ) && __VERSION__ >= 300
    vFogLit.y = iowCloudShade( p );
    #else
    vFogLit.y = 1.0;
    #endif
    gl_Position = projectionMatrix * mv;
    // the sea runs past the far plane to the horizon: pin it just inside
    if ( gl_Position.z > gl_Position.w ) gl_Position.z = gl_Position.w * 0.99995;
    #ifdef USE_REFL
    vRefl = uReflMatrix * wp;
    #endif
    #ifdef USE_SHADOW
    vShadow = uShadowMatrix * wp;
    #endif
  }
`;

const FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uKeyDir, uKeyColor, uSunDir;
  uniform vec2  uKeyH;                  // key light's horizontal direction (normalised)
  uniform float uKeyUp;                 // 0 when the key light is under the horizon
  uniform vec3  uSkyZen, uSkyHor, uSkyGlow;
  uniform vec3  uAmbSky, uAmbGnd;
  uniform sampler2D uWaveTex, uNoiseTex;
  uniform vec4  uL1, uL2;               // detail layers: xy scroll, z 1/tile, w strength
  uniform float uFoamStr, uStorm;
  uniform vec3  uDeep, uDeep2, uTeal, uShelf, uShallow, uFoamCol, uSSSCol;
  uniform vec3  fogColor;
  uniform float fogDensity, fogNear, fogFar;

  varying vec3  vWorld;
  varying vec3  vGeo;
  varying vec3  vMisc;
  varying vec2  vFogLit;

  #if defined( SHORE_TEX ) && defined( HQ ) && __VERSION__ >= 300
  uniform sampler2D uShoreTex;
  ${SHORE_GLSL}
  #endif
  #if defined( HQ ) && __VERSION__ < 300
  uniform sampler2D iowCloudTex;
  uniform vec3  iowCloud;
  ${CLOUD_GLSL}
  #endif
  #ifdef USE_REFL
  uniform sampler2D uReflTex;
  uniform float uReflOn;
  varying vec4  vRefl;
  #endif
  #ifdef USE_SHADOW
  #include <packing>
  uniform sampler2D uShadowMap;
  uniform vec2  uShadowTexel;
  uniform float uShadowOn;
  varying vec4  vShadow;
  float shadowAt( vec4 sc ) {
    vec3 c = sc.xyz / sc.w;
    if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
    float z = c.z - 0.0015;
    vec2 t = uShadowTexel, q = c.xy / t - 0.5, f = fract( q ), b = ( floor( q ) + 0.5 ) * t;
    float s00 = step( z, unpackRGBAToDepth( texture2D( uShadowMap, b ) ) );
    float s10 = step( z, unpackRGBAToDepth( texture2D( uShadowMap, b + vec2( t.x, 0.0 ) ) ) );
    float s01 = step( z, unpackRGBAToDepth( texture2D( uShadowMap, b + vec2( 0.0, t.y ) ) ) );
    float s11 = step( z, unpackRGBAToDepth( texture2D( uShadowMap, b + t ) ) );
    float s = mix( mix( s00, s10, f.x ), mix( s01, s11, f.x ), f.y );
    vec2 e = min( c.xy, 1.0 - c.xy );
    return mix( 1.0, s, smoothstep( 0.0, 0.04, min( e.x, e.y ) ) );
  }
  #endif

  vec3 skyColor( vec3 r ) {
    float h = clamp( r.y, 0.0, 1.0 );
    vec3  c = mix( uSkyHor, uSkyZen, sqrt( h ) );
    float s = clamp( 0.5 + 0.5 * dot( r, uSunDir ), 0.0, 1.0 ); s *= s; s *= s;
    float b = 1.0 - h, b2 = b * b;
    return mix( c, uSkyGlow, clamp( s * b2 * b2 * b * 1.2, 0.0, 1.0 ) );
  }

  void main() {
    vec3  toCam = cameraPosition - vWorld;
    float dist  = length( toCam );
    vec3  V     = toCam / dist;
    vec3  L     = uKeyDir;
    float dS    = vMisc.x;
    #if defined( SHORE_TEX ) && defined( HQ ) && __VERSION__ >= 300
    if ( dS < 30.0 ) dS = shoreDist( vWorld.xz );   // crisp outlines (bays, piers) on HIGH
    #endif

    // ── Normal: swell + FFT detail (2 layers on HIGH) ─────────────
    vec4 w1  = texture2D( uWaveTex, vWorld.xz * uL1.z + uL1.xy );
    vec2 det = ( w1.xy * 2.0 - 1.0 ) * uL1.w;
    #ifdef HQ
    vec2 p2 = mat2( 0.819, 0.574, -0.574, 0.819 ) * vWorld.xz;
    vec2 s2 = texture2D( uWaveTex, p2 * uL2.z + uL2.xy ).xy * 2.0 - 1.0;
    det += ( mat2( 0.819, -0.574, 0.574, 0.819 ) * s2 ) * uL2.w;
    #endif
    det *= mix( 0.45, 1.0, smoothstep( -2.0, 10.0, dS ) ) * ( 1.0 + 0.8 * uStorm ) / ( 1.0 + dist * 0.0025 );
    vec2 slope = vGeo.xy + det;
    vec3 N = normalize( vec3( -slope.x, 1.0, -slope.y ) );

    // ── Light visibility: cloud shade × sun shadow ────────────────
    #if defined( HQ ) && __VERSION__ < 300
    float lit = iowCloudShade( vWorld.xz );
    #else
    float lit = vFogLit.y;
    #endif
    #ifdef USE_SHADOW
    if ( uShadowOn > 0.5 ) lit *= shadowAt( vShadow );
    #endif

    // ── Water body: deep blue → teal near land → shelf → shallows ─
    vec3  body  = mix( uDeep, uDeep2, smoothstep( 0.25, 0.8, vMisc.y ) );
    body = mix( body, uTeal, 1.0 - smoothstep( 14.0, 72.0, dS + vMisc.z * 18.0 ) );
    float shelf = 0.0, shal = 0.0;
    if ( dS < 24.0 ) {
      float d = dS + vMisc.z * 7.0;
      shelf = 1.0 - smoothstep( 3.0, 17.0, d );
      shal  = 1.0 - smoothstep( -0.5, 5.5, d );
      body  = mix( mix( body, uShelf, shelf ), uShallow, shal );
    }
    float NdL = max( dot( N, L ), 0.0 );
    vec3  amb = mix( uAmbGnd, uAmbSky, 0.5 + 0.5 * N.y );
    vec3  bodyLit = body * ( amb + uKeyColor * ( 0.35 + 0.65 * NdL ) * lit * 0.55 );
    // Stylised wave texture: the detail crests catch the light as fine streaks
    float streak = smoothstep( 0.60, 0.92, w1.b ) * ( 1.0 - smoothstep( 80.0, 300.0, dist ) );
    bodyLit += ( amb * 0.5 + uKeyColor * lit * 0.35 ) * streak * 0.16 * ( 1.0 + uStorm );
    #ifdef HQ
    if ( shelf > 0.01 ) {   // caustics: two drifting cellular webs, brightest where they cross
      vec2  cuv = vWorld.xz * 0.15;
      float c1  = texture2D( uNoiseTex, cuv + vec2( uTime * 0.021, uTime * 0.013 ) ).a;
      float c2  = texture2D( uNoiseTex, cuv * 1.31 + vec2( -uTime * 0.017, uTime * 0.011 ) + 0.37 ).a;
      float cw  = 1.0 - min( c1, c2 ), cw2 = cw * cw;
      bodyLit  += uKeyColor * ( cw2 * cw2 * cw2 ) * shelf * ( 0.25 + 0.75 * shal ) * lit * 0.5;
    }
    #endif

    // ── Reflection (Fresnel) ──────────────────────────────────────
    float f1 = 1.0 - max( dot( N, V ), 0.0 ), f2 = f1 * f1;
    float F  = 0.02 + 0.98 * f2 * f2 * f1;
    vec3  R  = reflect( -V, N );
    R.y = abs( R.y );
    vec3 refl = skyColor( R );
    #ifdef USE_REFL
    if ( uReflOn > 0.5 ) refl = texture2D( uReflTex, clamp( vRefl.xy / vRefl.w * 0.5 + 0.5 + slope * 0.05, 0.002, 0.998 ) ).rgb;
    #endif
    vec3 col = mix( bodyLit, refl, F );

    // ── Key light glitter (HDR: blooms on HIGH) ───────────────────
    vec3  H    = normalize( L + V );
    float NdH  = max( dot( N, H ), 1e-4 );
    float far  = clamp( ( dist - 60.0 ) * ( 1.0 / 360.0 ), 0.0, 1.0 );
    float spec = exp2( mix( 700.0, 160.0, far ) * log2( NdH ) ) * mix( 3.2, 1.6, far );
    #ifdef HQ
    spec += exp2( 90.0 * log2( NdH ) ) * 0.22;
    #endif
    float vh = 1.0 - max( dot( V, H ), 0.0 ), vh2 = vh * vh;
    col += uKeyColor * min( spec * ( 0.3 + 2.5 * ( 0.02 + 0.98 * vh2 * vh2 * vh ) ), 7.0 ) * lit * uKeyUp;

    // ── Subsurface glow through crests, looking toward the light ──
    float tw  = clamp( dot( -V.xz, uKeyH ) / max( length( V.xz ), 1e-3 ), 0.0, 1.0 );
    float sss = tw * tw * tw * vGeo.z * vGeo.z * ( 1.0 - F ) * ( 1.15 - L.y );
    col += uSSSCol * uKeyColor * sss * lit * 0.9;

    // ── Foam: waterline edge + lapping bands + whitecaps ──────────
    float edge  = 1.0 - smoothstep( 0.2, 1.9, dS + vMisc.z * 1.2 );
    float bands = 0.0;
    if ( dS < 7.5 ) bands = smoothstep( 0.55, 1.0, sin( dS * 1.35 - uTime * 1.25 + vMisc.z * 10.0 ) ) * ( 1.0 - smoothstep( 0.5, 7.0, dS ) );
    float shoreF = clamp( edge + bands * 0.7, 0.0, 1.0 );
    float caps   = smoothstep( 0.80 - uFoamStr * 0.35 - uStorm * 0.25, 1.0, vGeo.z ) * ( 0.55 + 1.6 * uStorm );
    if ( max( shoreF, caps ) > 0.002 ) {
      #ifdef HQ
      float bub = texture2D( uNoiseTex, vWorld.xz * 0.21 + uL1.xy * 3.0 ).b * 0.6
                + texture2D( uNoiseTex, vWorld.xz * 0.57 - uL2.xy * 2.0 ).b * 0.4;
      #else
      float bub = texture2D( uNoiseTex, vWorld.xz * 0.21 + uL1.xy * 3.0 ).b;
      #endif
      float ftex = 1.0 - smoothstep( 0.28, 0.72, bub );
      float foam = clamp( max( shoreF * mix( ftex, 1.0, edge * 0.55 ), caps * ftex ), 0.0, 1.0 );
      vec3  foamLit = uFoamCol * ( amb + uKeyColor * ( 0.25 + 0.75 * NdL ) * lit * 0.8 );
      col = mix( col, foamLit, foam * 0.92 );
    }

    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <encodings_fragment>
    #ifdef USE_FOG
    // scene fog on view depth, after the curve — exactly as the islands and ships fog
    #ifdef FOG_EXP2
    float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogLit.x * vFogLit.x );
    #else
    float fogF = smoothstep( fogNear, fogFar, vFogLit.x );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogF );
    #endif
  }
`;

// ── Mesh: fine grid over the playable sea, geometric rings to the horizon ──
function buildGrid(segs, growth) {
  const step = (2 * INNER) / segs, coords = [];
  for (let i = 0; i <= segs; i++) coords.push(-INNER + i * step);
  const outer = [];
  for (let x = INNER, s = step; x < 3000;) { s *= growth; x += s; outer.push(Math.min(x, 3000)); }
  const c = [...outer.map(v => -v).reverse(), ...coords, ...outer];
  const n = c.length, pos = new Float32Array(n * n * 3);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k += 3) { pos[k] = c[i]; pos[k + 2] = c[j]; }
  const quads = (n - 1) * (n - 1), idx = n * n > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let j = 0, k = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++, k += 6) {
    const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
    idx[k] = a; idx[k + 1] = d; idx[k + 2] = b; idx[k + 3] = b; idx[k + 4] = d; idx[k + 5] = e;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4300);
  return geo;
}

const _wrapUV = (v, t, tile) => ((v * t / tile) % 1 + 1) % 1;

// Detail layers: tile size (world u), scroll velocity (u/s), strength
const L1 = { tile: 44, vx: -1.7, vz: 0.35, str: 0.27 };
const L2 = { tile: 13, vx: -0.9, vz: -0.55, str: 0.17 };

export class Ocean {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this._scene = scene;
    this._islandsSet = false;
    this._keyCol = new THREE.Color();
    this._ambSky = new THREE.Color();
    this._ambGnd = new THREE.Color();
    this._baseFog = 0;
    this._storm = 0;

    const wa = [], wb = [];
    for (let i = 0; i < NW; i++) {
      const o = i * 8;
      wa.push(new THREE.Vector4(_W[o], _W[o + 1], _W[o + 2], _W[o + 3]));
      wb.push(new THREE.Vector4(_W[o + 4], _W[o + 5], _W[o + 6], _W[o + 7]));
    }
    const A = atmosphere;
    this._uniforms = {
      uTime:      { value: 0 },
      uWA:        { value: wa },
      uWB:        { value: wb },
      uIsl:       { value: [new THREE.Vector4(1e5, 1e5, 1, 0)] },
      uShoreTex:  { value: null },
      uReflMatrix:{ value: new THREE.Matrix4() },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uKeyDir:    { value: A.keyDir },
      uKeyColor:  { value: this._keyCol },
      uSunDir:    { value: A.sunDir },
      uKeyH:      { value: new THREE.Vector2(0, -1) },
      uKeyUp:     { value: 1 },
      uSkyZen:    { value: A.skyZenith },
      uSkyHor:    { value: A.skyHorizon },
      uSkyGlow:   { value: A.skyGlow },
      uAmbSky:    { value: this._ambSky },
      uAmbGnd:    { value: this._ambGnd },
      uWaveTex:   { value: getWaveNormalTexture() },
      uNoiseTex:  { value: getNoiseTexture() },
      uL1:        { value: new THREE.Vector4(0, 0, 1 / L1.tile, L1.str) },
      uL2:        { value: new THREE.Vector4(0, 0, 1 / L2.tile, L2.str) },
      uFoamStr:   { value: 0.18 },     // 0.05 calm … 0.55 storm (whitecap coverage)
      uStorm:     { value: 0 },
      uDeep:      { value: new THREE.Color(0x0a4677) },   // open sea
      uDeep2:     { value: new THREE.Color(0x0c5686) },   // slow patches
      uTeal:      { value: new THREE.Color(0x0e6f93) },   // within ~60 u of land
      uShelf:     { value: new THREE.Color(0x17adb4) },   // lagoon shelf
      uShallow:   { value: new THREE.Color(0x72dccb) },   // sand showing through
      uFoamCol:   { value: new THREE.Color(0xf4fbff) },
      uSSSCol:    { value: new THREE.Color(0x2fd0a8) },
      uReflTex:   { value: null },
      uReflOn:    { value: 0 },
      uShadowMap: { value: null },
      uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
      uShadowOn:  { value: 0 },
      iowCloudTex: SHARED_UNIFORMS.iowCloudTex,
      iowCloud:    SHARED_UNIFORMS.iowCloud,
      fogColor:   { value: new THREE.Color() },
      fogDensity: { value: 0.0025 },
      fogNear:    { value: 1 },
      fogFar:     { value: 1000 },
    };
    this._mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this._uniforms,
      defines: { ISL_N: 1 }, fog: true, lights: false,
      transparent: false, depthWrite: true, depthTest: true, side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(buildGrid(gfx.high ? 160 : 80, gfx.high ? 1.3 : 1.45), this._mat);
    this._geoHigh = gfx.high;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder   = 1;            // after islands + hulls (they reject sea fragments early)
    this.mesh.receiveShadow = false;        // shadows are read by the shader itself (USE_SHADOW)
    this.mesh.userData.noReflect = true;    // never in the planar reflection pass
    scene.add(this.mesh);

    gfx.on('change.ocean', () => this._applyTier());
    this._applyTier();
  }

  // Tier → defines (HQ detail, reflection + shadow paths) and grid density.
  _applyTier() {
    const m = this._mat, def = m.defines, high = gfx.high;
    const want = { HQ: high, USE_REFL: high, USE_SHADOW: high && gfx.shadows };
    let dirty = false;
    for (const k in want) {
      if (!!def[k] === want[k]) continue;
      if (want[k]) def[k] = 1; else delete def[k];
      dirty = true;
    }
    if (dirty) m.needsUpdate = true;
    // Anisotropic filtering keeps the grazing far sea crisp on HIGH; LOW skips it.
    for (const [tex, a] of [[this._uniforms.uWaveTex.value, 8], [this._uniforms.uNoiseTex.value, 4]]) {
      const want = high ? a : 1;
      if (tex.anisotropy !== want) { tex.anisotropy = want; tex.needsUpdate = true; }
    }
    if (this._geoHigh !== high) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = buildGrid(high ? 160 : 80, high ? 1.3 : 1.45);
      this._geoHigh = high;
    }
  }

  /**
   * Register islands — shore calm, foam, lagoon shelf. Call after the islands
   * exist (and again if their outlines change). Items: { x, z, r,
   * shapeType? , shore? (world polygons), landAt?(x,z) } — see ShoreField.js.
   * @param {Array<object>} islands  IslandEntity list or plain defs
   */
  setIslands(islands) {
    setOceanIslands(islands);
    this._islandsSet = true;
    const n = _islN, arr = [];
    for (let i = 0; i < Math.max(1, n); i++) {
      arr.push(i < n ? new THREE.Vector4(_isl[i * 4], _isl[i * 4 + 1], _isl[i * 4 + 2], 0)
                     : new THREE.Vector4(1e5, 1e5, 1, 0));
    }
    this._uniforms.uIsl.value = arr;
    this._uniforms.uShoreTex.value = _fieldTex;
    const def = this._mat.defines;
    if (def.ISL_N !== arr.length || !!def.SHORE_TEX !== !!_fieldTex) {
      def.ISL_N = arr.length;
      if (_fieldTex) def.SHORE_TEX = 1; else delete def.SHORE_TEX;
      this._mat.needsUpdate = true;
    }
  }

  /**
   * Per-frame update.
   * @param {number} t            elapsed seconds
   * @param {THREE.Camera} camera (unused: the shader reads cameraPosition)
   * @param {THREE.Vector3} [sunDir] ignored when the shared atmosphere is live
   */
  update(t, camera, sunDir) {
    const u = this._uniforms, A = atmosphere;
    u.uTime.value = t * WAVE_SPEED;

    if (!this._islandsSet) {
      const isl = typeof window !== 'undefined' ? window._game?._islands : null;
      if (Array.isArray(isl) && isl.length) this.setIslands(isl);
    }

    // Key light + ambient (colour × intensity), from the shared atmosphere
    this._keyCol.copy(A.keyColor).multiplyScalar(A.keyIntensity);
    const kd = A.keyDir, kh = Math.hypot(kd.x, kd.z) || 1;
    u.uKeyH.value.set(kd.x / kh, kd.z / kh);
    u.uKeyUp.value = Math.min(1, Math.max(0, kd.y / 0.06));
    this._ambSky.copy(A.hemiSky).multiplyScalar(A.hemiIntensity * 0.95);
    this._ambGnd.copy(A.hemiGround).multiplyScalar(A.hemiIntensity * 0.95);

    // Detail scroll, wrapped to the tile (uv units)
    u.uL1.value.x = _wrapUV(-L1.vx, t, L1.tile); u.uL1.value.y = _wrapUV(-L1.vz, t, L1.tile);
    u.uL2.value.x = _wrapUV(-L2.vx, t, L2.tile); u.uL2.value.y = _wrapUV(-L2.vz, t, L2.tile);

    // Storm: SeaEvents thickens the fog ×3.5 — read it as rougher, foamier sea
    const fog = this._scene.fog;
    if (fog && fog.density) {
      if (!this._baseFog) this._baseFog = fog.density;
      const target = Math.min(1, Math.max(0, (fog.density / this._baseFog - 1) / 2.5));
      this._storm += (target - this._storm) * 0.02;
      u.uStorm.value = this._storm;
    }

    // Sun shadow map (owned by SceneController's key light)
    const L = A.shadowLight;
    const map = gfx.shadows && L && L.castShadow ? L.shadow.map : null;
    if (map) {
      u.uShadowMap.value = map.texture;
      u.uShadowMatrix.value = L.shadow.matrix;
      u.uShadowTexel.value.set(1 / L.shadow.mapSize.x, 1 / L.shadow.mapSize.y);
    }
    u.uShadowOn.value = map ? 1 : 0;
  }

  /** Called each frame on HIGH with the planar reflection; (null) turns it off. */
  setReflection(texture, projViewMatrix) {
    this._uniforms.uReflTex.value = texture || null;
    this._uniforms.uReflOn.value  = texture ? 1 : 0;
    if (projViewMatrix) this._uniforms.uReflMatrix.value.copy(projViewMatrix);
  }

  destroy() {
    gfx.off('change.ocean');
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this._mat.dispose();
  }
}
