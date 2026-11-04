import * as THREE from 'three';
import { TONE_GLSL } from './ShaderPatches.js';
import { getNoiseTexture } from '../World/OceanTextures.js';

// ── POST FX — the HIGH tier's HDR pipeline ───────────────────────
// (ported from Defense of the Dominion's post path, see design/art-reference)
//
//   scene ─► float target (R11G11B10F, RGBA16F if refused) with 4x MSAA
//         ─► bloom: Karis-weighted prefilter + soft threshold at 1 (only light
//            past 1 blooms: emitters, the sun glint) → down chain → tent up
//            chain added into each larger level (4 bilinear taps per pass)
//         ─► composite into the canvas: scene + bloom, exposure and white
//            balance for the hour, the shared hue-preserving tone curve
//            (identical to the LOW path's per-material curve), drifting cloud
//            wisps over the edges at close zoom, vignette, dither
//
// Full-resolution passes per frame: the scene + ONE composite (the old chain
// ran RenderPass + bloom composite + grade + FXAA = four). Bloom levels start
// at half resolution, so the whole chain costs about one extra half-res pass.
//
// r128 specifics (both found by DotD on ANGLE/D3D11):
//  • a multisampled target's resolve blits depth+stencil too, which nothing
//    reads — blitFramebuffer is wrapped to resolve colour only (big win);
//  • R11F_G11F_B10F has no alpha, three asks for an RGBA upload — the upload
//    format is fixed up in texImage2D.
//  • the depth-only renderbuffer is 16-bit; the scene target asks for
//    depth+stencil to get 24-bit depth (the far sea needs it).

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

// Bloom passes use bilinear 4-tap kernels (each tap averages a 2×2 block):
// prefilter = 4×4 box with Karis (luma) weights per tap so a lone hot pixel
// does not flicker, then a soft threshold (knee) at 1; down = 4×4 box;
// up = 4 taps at ±½ texel = an exact 3×3 tent, ADDED into the next larger
// level. ~2.7× fewer texture reads than 13-tap kernels, same footprint.
const FS_PRE = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec4 uThr;   // T, T-K, 2K, 0.25/K
varying vec2 vUv;
vec3 S( vec2 d ) { return min( texture2D( uSrc, vUv + d * uTexel ).rgb, vec3( 64.0 ) ); }
float W( vec3 c ) { return 1.0 / ( 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ); }
void main() {
	vec3 a = S( vec2( -1.0, -1.0 ) ), b = S( vec2( 1.0, -1.0 ) ), c = S( vec2( -1.0, 1.0 ) ), d = S( vec2( 1.0, 1.0 ) );
	float wa = W( a ), wb = W( b ), wc = W( c ), wd = W( d );
	vec3 m = ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
	float br = max( m.r, max( m.g, m.b ) );
	float rq = clamp( br - uThr.y, 0.0, uThr.z );
	rq = uThr.w * rq * rq;
	gl_FragColor = vec4( m * max( rq, br - uThr.x ) / max( br, 1e-4 ), 1.0 );
}`;

const FS_DOWN = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
	gl_FragColor = vec4( 0.25 * ( texture2D( uSrc, vUv + vec2( -1.0, -1.0 ) * uTexel ).rgb + texture2D( uSrc, vUv + vec2( 1.0, -1.0 ) * uTexel ).rgb
	                            + texture2D( uSrc, vUv + vec2( -1.0, 1.0 ) * uTexel ).rgb + texture2D( uSrc, vUv + vec2( 1.0, 1.0 ) * uTexel ).rgb ), 1.0 );
}`;

// Up the chain: 4 bilinear taps at ±½ source texel = 3×3 tent, ADDED (One/One).
const FS_UP = /* glsl */`
uniform sampler2D uSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
	vec2 h = 0.5 * uTexel;
	gl_FragColor = vec4( 0.25 * ( texture2D( uSrc, vUv + vec2( -h.x, -h.y ) ).rgb + texture2D( uSrc, vUv + vec2( h.x, -h.y ) ).rgb
	                            + texture2D( uSrc, vUv + vec2( -h.x, h.y ) ).rgb + texture2D( uSrc, vUv + vec2( h.x, h.y ) ).rgb ), 1.0 );
}`;

const FS_COMP = /* glsl */`
uniform sampler2D uScene, uBloom, uNoise;
uniform float uBloomStrength, uExposure, uVignette, uAspect;
uniform vec3  uTint, uWispCol;
uniform vec3  uWisp;                 // xy: world-anchored drift offset, z: amount (0 = off)
varying vec2 vUv;
${TONE_GLSL}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
void main() {
	vec3 c = texture2D( uScene, vUv ).rgb;
	c += texture2D( uBloom, vUv ).rgb * uBloomStrength;   // level 0 is already a smooth sum of all levels
	c = iowToneCurve( c * uTint * uExposure );
	vec2 sp = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
	if ( uWisp.z > 0.001 ) {
		// drifting cloud wisps between camera and sea (close zoom only), kept to the edges
		vec2  wuv = sp * 0.55 + uWisp.xy;
		float n   = texture2D( uNoise, wuv ).r * 0.62 + texture2D( uNoise, wuv * 2.1 + 0.31 ).g * 0.38;
		float w   = smoothstep( 0.50, 0.80, n ) * smoothstep( 0.28, 0.95, length( sp * vec2( 0.8, 1.3 ) ) ) * uWisp.z;
		c = mix( c, uWispCol, w );
	}
	float r = length( sp ) / length( vec2( 0.5 * uAspect, 0.5 ) );
	c *= 1.0 - uVignette * smoothstep( 0.55, 1.15, r );
	gl_FragColor = vec4( c + ( ign( gl_FragCoord.xy ) - 0.5 ) / 255.0, 1.0 );
}`;

// Preferred formats first: [three internalFormat name (null = RGBA16F), format]
const FORMATS = [['R11F_G11F_B10F', THREE.RGBAFormat], [null, THREE.RGBAFormat]];
const BLOOM_LEVELS = 5;

function postMat(fs, uniforms, additive) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: fs, uniforms,
    depthTest: false, depthWrite: false, toneMapped: false, fog: false,
    blending: additive ? THREE.CustomBlending : THREE.NoBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

/** Patch the GL context once (see header). */
function patchContext(gl) {
  if (gl.__iowPostPatched) return;
  gl.__iowPostPatched = true;
  const texImage2D = gl.texImage2D;
  gl.texImage2D = function (...a) {
    if (a.length === 9 && a[2] === gl.R11F_G11F_B10F) a[6] = gl.RGB;
    return texImage2D.apply(gl, a);
  };
  const blit = gl.blitFramebuffer;
  if (blit) gl.blitFramebuffer = function (...a) { a[8] &= gl.COLOR_BUFFER_BIT; return blit.apply(gl, a); };
}

export class PostFX {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.R  = renderer;
    this.gl = renderer.getContext();
    /** False when float targets are unavailable or were refused (then: draw direct). */
    this.ok = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float');
    this.rt = null; this.bloom = []; this.w = 0; this.h = 0; this.samples = -1;
    if (!this.ok) return;
    patchContext(this.gl);

    const src = () => ({ uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    const knee = 0.25;
    this._pre  = postMat(FS_PRE, { ...src(), uThr: { value: new THREE.Vector4(1, 1 - knee, 2 * knee, 0.25 / knee) } });
    this._down = postMat(FS_DOWN, src());
    this._up   = postMat(FS_UP, src(), true);
    this._comp = postMat(FS_COMP, {
      uScene: { value: null }, uBloom: { value: null }, uNoise: { value: getNoiseTexture() },
      uBloomStrength: { value: 0.6 }, uExposure: { value: 1 }, uVignette: { value: 0.18 },
      uAspect: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uWisp: { value: new THREE.Vector3() }, uWispCol: { value: new THREE.Color(1, 1, 1) },
    });
    this._tri = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), this._comp);
    this._tri.frustumCulled = false;
    this._cam = new THREE.Camera();
    for (const m of [this._pre, this._down, this._up, this._comp]) { this._tri.material = m; renderer.compile(this._tri, this._cam); }
  }

  /** Bytes of GPU memory held by the targets (approximate, for diagnostics). */
  get bytes() {
    const px = (t, bpp) => (t ? t.width * t.height * bpp : 0);
    const bpp = this._fmt === 0 ? 4 : 8, s = Math.max(1, this.samples);
    return px(this.rt, bpp * (s + 1) + 4 * s) + this.bloom.reduce((a, t) => a + px(t, bpp), 0);
  }

  /**
   * (Re)allocate for a scene resolution and MSAA sample count. Returns false
   * when no float target could be had (the caller then draws direct).
   */
  ensure(w, h, samples) {
    if (!this.ok) return false;
    w = Math.max(16, w | 0); h = Math.max(16, h | 0);
    if (this.rt && w === this.w && h === this.h && samples === this.samples) return true;
    this.free();
    for (let f = 0; f < FORMATS.length; f++) {
      this._fmt = f;
      this.rt = this._target(w, h, FORMATS[f], true, samples);
      let ok = this._complete(this.rt);
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      for (let i = 0; ok && i < BLOOM_LEVELS && Math.min(bw, bh) >= 8; i++) {
        const l = this._target(bw, bh, FORMATS[f], false, 0);
        this.bloom.push(l); ok = this._complete(l);
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
      this.R.setRenderTarget(null);
      if (ok && this.bloom.length) { this.w = w; this.h = h; this.samples = samples; return true; }
      this.free();
    }
    console.warn(`[PostFX] no float render target at ${w}x${h} — drawing without post-processing`);
    this.ok = false;
    return false;
  }

  _target(w, h, fmt, scene, samples) {
    const o = { format: fmt[1], type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
                depthBuffer: scene, stencilBuffer: scene, generateMipmaps: false };
    const rt = scene && samples > 0 ? new THREE.WebGLMultisampleRenderTarget(w, h, o) : new THREE.WebGLRenderTarget(w, h, o);
    if (rt.isWebGLMultisampleRenderTarget) rt.samples = Math.min(samples, this.R.capabilities.maxSamples || 4);
    rt.texture.internalFormat = fmt[0];
    return rt;
  }

  _complete(rt) {
    const gl = this.gl;
    this.R.setRenderTarget(rt);
    const ok = () => gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    let good = ok();
    if (good && rt.isWebGLMultisampleRenderTarget) {
      const p = this.R.properties.get(rt);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.__webglFramebuffer); good = ok();
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.__webglMultisampledFramebuffer);
    }
    return good && gl.getError() !== gl.OUT_OF_MEMORY;
  }

  free() {
    this.rt?.dispose();
    for (const t of this.bloom) t.dispose();
    this.rt = null; this.bloom = []; this.w = this.h = 0; this.samples = -1;
  }

  _pass(mat, dst, src) {
    if (src) { mat.uniforms.uSrc.value = src.texture; mat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height); }
    this._tri.material = mat;
    this.R.setRenderTarget(dst);
    this.R.render(this._tri, this._cam);
  }

  /**
   * Render one frame through the pipeline into the canvas.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {{exposure:number, tint:THREE.Vector3, bloom:number, vignette:number,
   *          wisp?:THREE.Vector3, wispColor?:THREE.Color}} p
   */
  render(scene, camera, p) {
    const R = this.R, B = this.bloom, n = B.length, u = this._comp.uniforms;
    R.setRenderTarget(this.rt);
    R.render(scene, camera);                       // (resolves the MSAA)
    const autoClear = R.autoClear;
    R.autoClear = false;
    this._pass(this._pre, B[0], this.rt);
    for (let i = 1; i < n; i++) this._pass(this._down, B[i], B[i - 1]);
    for (let i = n - 1; i >= 1; i--) this._pass(this._up, B[i - 1], B[i]);
    u.uScene.value = this.rt.texture;
    u.uBloom.value = B[0].texture;
    u.uBloomStrength.value = p.bloom / Math.max(1, n - 1);
    u.uExposure.value = p.exposure;
    u.uTint.value.copy(p.tint);
    u.uVignette.value = p.vignette;
    u.uAspect.value = this.rt.width / this.rt.height;
    if (p.wisp) { u.uWisp.value.copy(p.wisp); u.uWispCol.value.copy(p.wispColor); } else u.uWisp.value.z = 0;
    this._pass(this._comp, null, null);
    R.autoClear = autoClear;
  }

  dispose() {
    this.free();
    if (!this._tri) return;
    this._tri.geometry.dispose();
    for (const m of [this._pre, this._down, this._up, this._comp]) m.dispose();
  }
}
