import * as THREE from 'three';
import { getNoiseTexture } from '../World/OceanTextures.js';
import { CLOUD_TILE } from '../World/Atmosphere.js';

// ── SHADER PATCHES — the colour + light pipeline for every material ──
// three r128 builds every built-in material from ShaderChunk strings at
// compile time, so patching those strings (before the first compile) changes
// all materials at once without touching the code that creates them.
// Installed once, on first import (idempotent). Anchors that are not found
// log a warning and leave that chunk alone.
//
// 1. TONE CURVE (CustomToneMapping — r128's official extension point)
//    The project's colours are DISPLAY-REFERRED: hex values are authored as
//    they should look and lighting is computed on them directly; the canvas
//    is written without an sRGB encode (outputEncoding = Linear). ACES +
//    sRGB output would wash out / hue-shift that palette, so the curve is
//    hue-preserving (as in Defense of the Dominion): the identity below a
//    knee; above it the brightest channel rolls off smoothly and the others
//    keep their ratio (fire stays orange); only very hot light (> ~4) runs
//    to white. A light vibrance/contrast grade rides on top.
//      • LOW (straight to canvas): every material applies it per fragment.
//      • HIGH (HDR float target): materials pass raw HDR through and the
//        post composite applies the very same curve once (Render/PostFX.js).
//    The switch costs nothing: renderer.toneMappingExposure < 0 means
//    "passthrough" (it is the only tone-mapping uniform every program has).
//
// 2. LIT CLAMP: lit surfaces are clamped at 1 + emissive, so in the HDR target
//    only emitters (fire, flashes, the sun glint, additive sprites) exceed 1
//    and only they bloom — a white sail in full sun never glows.
//
// 3. CLOUD SHADOWS: soft drifting cloud shadows dim the key light on every lit
//    material (islands, ships, buildings) — the same function the ocean uses,
//    so shade slides seamlessly from sea onto land. Uniform-switched (HIGH on,
//    LOW off): no recompile. Needs a world XZ varying: the fog chunks carry it
//    (every fogged material has them), derived from mvPosition so sprites and
//    instanced meshes work too.
//
// 4. SHADOW FILTER: PCFSoft reads the map 16× per pixel; six spread reads go
//    first and if they agree (fully lit / fully shadowed — most pixels) that is
//    the answer. No shadow read at all where the key light is black.
//
// Shared uniforms (cloud texture + drift) reach every program through
// Material.onBeforeCompile (wrapped so a material's own hook — the ships' wind
// sway — still runs and keeps its own program-cache key).

/** Tone-curve constants: shared by the LOW per-material path and the HIGH composite. */
export const TONE = { knee: 0.80, sat: 1.08, vib: 0.22, contrast: 0.15, split: 0.035 };

/** GLSL: vec3 iowToneCurve(vec3) — display-referred, hue-preserving + grade. */
export const TONE_GLSL = /* glsl */`
vec3 iowToneCurve( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	float m = max( c.r, max( c.g, c.b ) );
	if ( m > ${TONE.knee.toFixed(3)} ) {
		const float K = ${TONE.knee.toFixed(3)};
		float s = min( ( m - K ) / ( 1.0 - K ), 1e4 );
		float mt = K + ( 1.0 - K ) * s / ( 1.0 + s );
		c *= mt / m;
		c = mix( c, vec3( mt ), clamp( ( m - 4.0 ) / 8.0, 0.0, 1.0 ) );
	}
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	float chroma = max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) );
	c = max( mix( vec3( l ), c, ${TONE.sat.toFixed(3)} + ${TONE.vib.toFixed(3)} * ( 1.0 - chroma ) ), vec3( 0.0 ) );
	// painterly split tone: cool teal shadows, warm golden highlights
	c *= mix( vec3( 1.0 - ${TONE.split.toFixed(3)}, 1.0, 1.0 + ${TONE.split.toFixed(3)} ),
	          vec3( 1.0 + ${TONE.split.toFixed(3)}, 1.0, 1.0 - 1.3 * ${TONE.split.toFixed(3)} ), smoothstep( 0.12, 0.85, l ) );
	c = min( c, vec3( 1.0 ) );
	return mix( c, c * c * ( 3.0 - 2.0 * c ), ${TONE.contrast.toFixed(3)} );
}
`;

/** Uniform objects shared (by reference) with every fogged material. */
export const SHARED_UNIFORMS = {
  iowCloudTex: { value: null },
  /** x, y: drift (world units, wrapped at CLOUD_TILE); z: shadow strength (0 = off). */
  iowCloud:    { value: new THREE.Vector3(0, 0, 0) },
};

/** GLSL: float iowCloudShade(vec2 worldXZ) — needs iowCloudTex + iowCloud uniforms. */
export const CLOUD_GLSL = /* glsl */`
float iowCloudShade( vec2 xz ) {
	if ( iowCloud.z <= 0.0 ) return 1.0;
	// two reads at rotated scales (no shared period → no visible lattice); the
	// drift is added in texture space and wraps at a whole number of both tiles
	vec2 uv1 = mat2( 0.825, 0.565, -0.565, 0.825 ) * xz * ${(1 / CLOUD_TILE).toFixed(6)} + iowCloud.xy * ${(1 / CLOUD_TILE).toFixed(6)};
	vec2 uv2 = mat2( -0.32, 0.947, -0.947, -0.32 ) * xz * ${(2 / CLOUD_TILE).toFixed(6)} + iowCloud.yx * ${(2 / CLOUD_TILE).toFixed(6)};
	float n = 0.62 * texture2D( iowCloudTex, uv1 ).r + 0.38 * texture2D( iowCloudTex, uv2 ).g;
	return 1.0 - iowCloud.z * smoothstep( 0.50, 0.70, n );
}
`;

let _installed = false;

function patch(name, from, to) {
  const c = THREE.ShaderChunk[name];
  if (!c || !c.includes(from)) { console.warn(`[ShaderPatches] ${name}: anchor not found — skipped`); return false; }
  THREE.ShaderChunk[name] = c.replace(from, to);
  return true;
}

/** Install every patch (idempotent). Runs on import; call again harmlessly. */
export function installShaderPatches() {
  if (_installed) return;
  _installed = true;
  const C = THREE.ShaderChunk;

  // 1 — tone curve
  patch('tonemapping_pars_fragment', 'vec3 CustomToneMapping( vec3 color ) { return color; }',
    TONE_GLSL + `
vec3 CustomToneMapping( vec3 color ) {
	if ( toneMappingExposure < 0.0 ) return color;   // HDR target: the post composite grades
	return iowToneCurve( color * toneMappingExposure );
}`);

  // 2 — lit clamp (only lit materials include the emissive-map pars)
  C.emissivemap_pars_fragment += '\n#define IOW_LIT_CLAMP\n';
  C.dithering_fragment = `#ifdef IOW_LIT_CLAMP
	gl_FragColor.rgb = min( gl_FragColor.rgb, 1.0 + totalEmissiveRadiance );
#endif
` + C.dithering_fragment;

  // 3 — world XZ through the fog varyings + cloud shade on the key light
  C.fog_pars_vertex = `#ifdef USE_FOG
	varying float fogDepth;
	varying vec2 vIowWorldXZ;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
	fogDepth = - mvPosition.z;
	vIowWorldXZ = ( vec4( mvPosition.xyz - viewMatrix[ 3 ].xyz, 0.0 ) * viewMatrix ).xz;
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float fogDepth;
	varying vec2 vIowWorldXZ;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	uniform sampler2D iowCloudTex;
	uniform vec3 iowCloud;
	${CLOUD_GLSL}
#endif`;
  {
    const c = C.lights_fragment_begin;
    const a = c.indexOf('getDirectionalDirectLightIrradiance( directionalLight, geometry, directLight );');
    const at = a < 0 ? -1 : c.indexOf('RE_Direct(', a);
    if (at < 0) console.warn('[ShaderPatches] lights_fragment_begin: sun loop not found — no cloud shadows on materials');
    else C.lights_fragment_begin = c.slice(0, at) + `#ifdef USE_FOG
		if ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= iowCloudShade( vIowWorldXZ );
		#endif
		` + c.slice(at);
  }

  // 4 — shadow read skipped under a black light; PCFSoft six-tap early out
  patch('lights_fragment_begin',
    'directLight.color *= all( bvec2( directLight.visible, receiveShadow ) ) ? getShadow( directionalShadowMap[ i ]',
    'directLight.color *= all( bvec3( directLight.visible, receiveShadow, dot( directLight.color, directLight.color ) > 0.0 ) ) ? getShadow( directionalShadowMap[ i ]');
  {
    const c = C.shadowmap_pars_fragment;
    const m = c.match(/shadow\s*=\s*\(\s*texture2DCompare\(\s*shadowMap,\s*uv,\s*shadowCoord\.z\s*\)/);
    if (!m) console.warn('[ShaderPatches] shadowmap_pars_fragment: PCFSoft filter not found — full 16 reads');
    else C.shadowmap_pars_fragment = c.slice(0, m.index) + `float iowAgree =
				texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z );
			if ( iowAgree <= 0.0 || iowAgree >= 6.0 ) shadow = iowAgree / 6.0;
			else ` + c.slice(m.index);
  }

  // Shared uniforms → every program that includes the fog chunk
  SHARED_UNIFORMS.iowCloudTex.value = getNoiseTexture();
  const inject = function iowInject(shader) {
    if (shader.fragmentShader && shader.fragmentShader.indexOf('fog_pars_fragment') >= 0) {
      shader.uniforms.iowCloudTex = SHARED_UNIFORMS.iowCloudTex;
      shader.uniforms.iowCloud    = SHARED_UNIFORMS.iowCloud;
    }
  };
  const proto = THREE.Material.prototype;
  Object.defineProperty(proto, 'onBeforeCompile', {
    configurable: true,
    get() { return this._iowBeforeCompile || inject; },
    set(fn) {
      if (typeof fn !== 'function') { this._iowBeforeCompile = null; this._iowOwnHook = null; return; }
      this._iowOwnHook = fn;
      this._iowBeforeCompile = function (shader, renderer) { fn.call(this, shader, renderer); inject(shader); };
    },
  });
  // Keep r128's default cache key semantics: the material's OWN hook source.
  proto.customProgramCacheKey = function () { return (this._iowOwnHook || inject).toString(); };
}

installShaderPatches();
