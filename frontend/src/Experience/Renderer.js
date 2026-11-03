import * as THREE from 'three';
// ── RENDERER ────────────────────────────────────────────────────
// Owns the WebGLRenderer and the optional post-processing chain (AN).
//
// Pipeline (quality = high):
//   RenderPass → UnrealBloomPass → GradePass (vignette + saturation) → FXAA
//
// Quality = low: composer fully bypassed — zero extra cost, identical to
// the pre-AN direct render path.
//
// The composer is built lazily on the first setPostFX(true) call so that
// low-end sessions never allocate the extra render targets.

import { sizes } from './Sizes.js';
import { EffectComposer } from '../../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from '../../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass }     from '../../vendor/three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader }     from '../../vendor/three/examples/jsm/shaders/FXAAShader.js';

// ── Grade pass: subtle vignette + saturation lift ──────────────────
// Cheap single full-screen pass that gives the frame a "graded" film look:
//   • vignette pulls focus to screen centre (combat reads better)
//   • +6% saturation makes brass/teal palette pop without clipping
const GradeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uVigAmt:    { value: 0.34 },   // 0 = off, 1 = heavy
    uVigInner:  { value: 0.55 },   // radius where darkening starts
    uSat:       { value: 1.06 },   // 1 = neutral
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVigAmt, uVigInner, uSat;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // saturation
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(luma), c.rgb, uSat);
      // vignette — radial falloff, slightly widescreen-weighted
      vec2 d = (vUv - 0.5) * vec2(1.0, 1.15);
      // NOTE: smoothstep(edge0 > edge1) is UNDEFINED in GLSL — SwiftShader
      // returned black for it. Inverted form is portable.
      float vig = 1.0 - smoothstep(uVigInner, 0.85, length(d));
      c.rgb *= mix(1.0 - uVigAmt, 1.0, vig);
      gl_FragColor = c;
    }
  `,
};

export class Renderer {
  constructor(canvas, scene, camera) {
    this._scene  = scene;
    this._camera = camera;

    this.instance = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.instance.setPixelRatio(sizes.pixelRatio);
    this.instance.setSize(sizes.width, sizes.height);
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.instance.toneMapping       = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 0.88;

    // Post-FX state (composer built lazily in _buildComposer)
    this._composer  = null;
    this._bloomPass = null;
    this._gradePass = null;
    this._fxaaPass  = null;
    this.composerEnabled = false;

    sizes.on('resize.renderer', () => {
      this.instance.setPixelRatio(sizes.pixelRatio);
      this.instance.setSize(sizes.width, sizes.height);
      this._resizeComposer();
    });
  }

  // ── Post-FX toggle (wired to graphics quality setting) ───────────
  setPostFX(on) {
    if (on && !this._composer) this._buildComposer();
    this.composerEnabled = !!on && !!this._composer;
  }

  _buildComposer() {
    try {
      const w = sizes.width, h = sizes.height;
      this._composer = new EffectComposer(this.instance);
      this._composer.setPixelRatio(this.instance.getPixelRatio());
      this._composer.setSize(w, h);

      this._composer.addPass(new RenderPass(this._scene, this._camera));

      // Bloom — tuned subtle: only sun disc, muzzle flashes, fires and
      // explosion cores cross the threshold. Keeps UI-adjacent whites clean.
      this._bloomPass = new UnrealBloomPass(
        new THREE.Vector2(w, h),
        0.45,   // strength
        0.55,   // radius
        0.85,   // luminance threshold
      );
      this._composer.addPass(this._bloomPass);

      this._gradePass = new ShaderPass(GradeShader);
      this._composer.addPass(this._gradePass);

      // FXAA last — composer render targets have no MSAA, this restores
      // edge quality lost vs. the direct (antialias:true) path.
      this._fxaaPass = new ShaderPass(FXAAShader);
      this._composer.addPass(this._fxaaPass);
      this._syncFxaa();
    } catch (e) {
      console.warn('[Renderer] Post-FX init failed — falling back to direct render:', e);
      this._composer = null;
    }
  }

  _syncFxaa() {
    if (!this._fxaaPass) return;
    const pr = this.instance.getPixelRatio();
    this._fxaaPass.material.uniforms.resolution.value.set(
      1 / (sizes.width * pr), 1 / (sizes.height * pr));
  }

  _resizeComposer() {
    if (!this._composer) return;
    this._composer.setPixelRatio(this.instance.getPixelRatio());
    this._composer.setSize(sizes.width, sizes.height);
    this._syncFxaa();
  }

  // Wrapper so settings UI changes pixel ratio in ONE place and the
  // composer + FXAA stay in sync (main.js uses this instead of instance).
  setPixelRatio(pr) {
    this.instance.setPixelRatio(pr);
    this._resizeComposer();
  }

  render() {
    if (this.composerEnabled) this._composer.render();
    else this.instance.render(this._scene, this._camera);
  }

  destroy() {
    sizes.off('resize.renderer');
    this._composer?.dispose?.();
    this.instance.dispose();
  }
}
