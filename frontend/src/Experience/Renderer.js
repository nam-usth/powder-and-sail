import * as THREE from 'three';
// ── RENDERER ────────────────────────────────────────────────────
// Owns the WebGLRenderer, the colour pipeline and the two GFX tiers
// (modelled on Defense of the Dominion — design/art-reference/README.md):
//
//   HIGH  scene → HDR float target with 4x MSAA → bloom chain → composite
//         (exposure + white balance for the hour, hue-preserving tone curve,
//         vignette, dither) → canvas.  Shadows (if the user keeps them on),
//         cloud shadows, planar reflection, HiDPI (capped at 1.5 on this path).
//   LOW   straight to the canvas at pixel ratio 1: no shadows, MSAA, bloom,
//         cloud shadows or reflection; every material applies the SAME tone
//         curve itself, so the palette matches HIGH.
//   No float targets (WebGL 1 / no EXT_color_buffer_float): HIGH draws
//   straight to an antialiased canvas, as LOW does.
//
// Public API (GameApp / main.js):
//   render()                 one frame (the active path)
//   setQuality('high'|'low') the whole tier in one call: pixel ratio, post
//                            path, planar reflection (window.setGraphicsHigh),
//                            shadows / cloud shadows / ocean path (via gfx)
//   setPostFX(bool)          tier switch kept for main.js's existing wiring
//   setPixelRatio(pr)        user/tier pixel ratio (the governor scales it)
//   setAutoResolution(bool)  the frame-rate governor (Render/AutoResolution.js)
//   .instance                the THREE.WebGLRenderer
//   .composerEnabled         true while frames go through the HDR post path
//   .quality                 'high' | 'low'
//   shadow toggle: main.js writes instance.shadowMap.enabled; the effective
//   value is (user toggle AND HIGH) and is propagated to lights + programs.
//
// Debug (Shift+D) reads instance.info: it is reset once per frame here, so it
// shows the WHOLE frame (reflection, shadow map, scene and post passes).

import { sizes }       from './Sizes.js';
import { time }        from './Time.js';
import { gfx, SKY_LAYER } from './Render/GfxQuality.js';
import { installShaderPatches, SHARED_UNIFORMS } from './Render/ShaderPatches.js';
import { PostFX }      from './Render/PostFX.js';
import { AutoResolution } from './Render/AutoResolution.js';
import { atmosphere, CLOUD_TILE } from './World/Atmosphere.js';

const POST_DPR  = 1.5;    // HIGH-path pixel ratio cap (4x MSAA float targets at DPR 2 are ~150-230 MB)
const EXPOSURE  = 1.0;    // base exposure; the atmosphere lifts it at night
const BLOOM     = 0.75;   // bloom strength (day); more at night (lanterns, fires)
const VIGNETTE  = 0.16;
const WISPS     = 0.55;   // foreground cloud-wisp opacity at the closest zoom (HIGH)

/** WebGL2 + renderable float colour buffers (probed on a throwaway context). */
function probeHDR() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!(gl && gl.getExtension('EXT_color_buffer_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch (e) { return false; }
}

/** SwiftShader / llvmpipe: software GL (headless QA) — keep the governor off there. */
function isSoftwareGL(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|software/i.test(s);
  } catch (e) { return false; }
}

const _v2 = new THREE.Vector2();
const _wisp = new THREE.Vector3(), _wispCol = new THREE.Color(), _WHITE = new THREE.Color(1, 1, 1);
const _corner = new THREE.Vector3(), _camPos = new THREE.Vector3();
/** Highest elevation (sin) of the camera's four frustum-corner rays. Allocation-free. */
function maxViewElevation(cam) {
  _camPos.setFromMatrixPosition(cam.matrixWorld);
  let m = -1;
  for (let i = 0; i < 4; i++) {
    _corner.set(i & 1 ? 1 : -1, i & 2 ? -1 : 1, 0.5).unproject(cam).sub(_camPos).normalize();
    if (_corner.y > m) m = _corner.y;
  }
  return m;
}

export class Renderer {
  constructor(canvas, scene, camera) {
    installShaderPatches();
    this._scene  = scene;
    this._camera = camera;
    this._hdrOk  = probeHDR();

    // The HDR target is multisampled itself: the canvas then only takes the
    // composite and needs no MSAA of its own.
    this.instance = new THREE.WebGLRenderer({ canvas, antialias: !this._hdrOk, powerPreference: 'high-performance' });
    const R = this.instance;
    R.outputEncoding      = THREE.LinearEncoding;      // display-referred content (Render/ShaderPatches.js)
    R.toneMapping         = THREE.CustomToneMapping;   // the shared hue-preserving curve
    R.toneMappingExposure = EXPOSURE;
    R.shadowMap.type      = THREE.PCFSoftShadowMap;
    R.shadowMap.enabled   = true;
    this._installShadowSwitch();
    this._installFrameStats();

    this._basePR     = sizes.pixelRatio;
    this._postWanted = gfx.high;
    this._post       = null;
    this._auto       = new AutoResolution();
    this._auto.enabled = !isSoftwareGL(R.getContext());
    this._auto.reset(gfx.level);
    this._syncExposureMode();
    this._applySize();

    sizes.on('resize.renderer', () => { this._auto.reset(null, true); this._applySize(); });
  }

  // ── Tier API ─────────────────────────────────────────────────────
  /** Current tier name. */
  get quality() { return gfx.level; }

  /** True while frames go through the HDR post path. */
  get composerEnabled() { return !!(this._postWanted && this._post && this._post.ok && this._post.rt); }

  /**
   * Apply a whole GFX tier in one call (pixel ratio, post path, planar
   * reflection, shadows, cloud shadows, ocean path).
   * @param {'high'|'low'} level
   */
  setQuality(level) {
    const high = level !== 'low';
    this.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.setPostFX(high);
    window.setGraphicsHigh?.(high);          // GameApp's planar reflection switch
  }

  /**
   * Tier switch used by main.js's 'quality' toggle (kept for its wiring):
   * true = HIGH (HDR post chain), false = LOW (direct).
   */
  setPostFX(on) {
    this._postWanted = !!on;
    gfx.setLevel(on ? 'high' : 'low');
    this._syncShadows();
    this._auto.reset(gfx.level);
    this._syncExposureMode();
    this._applySize();
    if (!on && this._post) this._post.free();   // LOW never holds the float targets
  }

  /** User / tier pixel ratio (HiDPI on HIGH, 1 on LOW). */
  setPixelRatio(pr) {
    this._basePR = Math.max(0.5, Math.min(pr || 1, 3));
    this._applySize();
  }

  /** Enable / disable the frame-rate governor (on by default on real GPUs). */
  setAutoResolution(on) {
    this._auto.enabled = !!on;
    this._auto.reset(null, false);
    this._applySize();
  }

  /** Diagnostics: tier, path, governor state, target size. */
  get stats() {
    return {
      quality: gfx.level, hdr: this.composerEnabled, shadows: gfx.shadows,
      autoRes: this._auto.enabled, autoLevel: this._auto.level, scale: this._auto.scale,
      msaa: this.composerEnabled ? Math.max(0, this._post.samples) : 0,
      pixelRatio: this.instance.getPixelRatio(),
      target: this._post?.rt ? [this._post.w, this._post.h] : null,
    };
  }

  // ── Internals ────────────────────────────────────────────────────
  _hdrPath() { return this._postWanted && this._hdrOk && (!this._post || this._post.ok); }

  _applySize() {
    const R  = this.instance;
    const pr = this._hdrPath()
      ? Math.min(this._basePR, POST_DPR)                        // the post target scales instead
      : this._basePR * this._auto.scale;
    if (Math.abs(R.getPixelRatio() - pr) > 1e-3) R.setPixelRatio(pr);
    R.setSize(sizes.width, sizes.height);
  }

  // Materials pass raw HDR through when toneMappingExposure < 0 (HIGH path);
  // set it now so passes rendered before render() (the planar reflection) match.
  _syncExposureMode() {
    this.instance.toneMappingExposure = this._hdrPath() ? -1 : EXPOSURE * atmosphere.exposure;
  }

  // shadowMap.enabled = user toggle (main.js) AND the HIGH tier.
  _installShadowSwitch() {
    const sm = this.instance.shadowMap;
    let user = !!sm.enabled;
    Object.defineProperty(sm, 'enabled', {
      configurable: true, enumerable: true,
      get: () => user && gfx.level === 'high',
      set: (v) => { user = !!v; this._syncShadows(); },
    });
  }

  _syncShadows() { gfx.setShadows(this.instance.shadowMap.enabled); }

  // instance.info accumulates over the whole frame; reset at the first render
  // call of a new frame (a new Time tick).
  _installFrameStats() {
    const R = this.instance, render = R.render.bind(R);
    R.info.autoReset = false;
    let stamp = NaN;
    R.render = (scene, camera) => {
      if (time.elapsed !== stamp) { stamp = time.elapsed; R.info.reset(); }
      render(scene, camera);
    };
  }

  /** Render one frame through the active path. */
  render() {
    const R = this.instance, cam = this._camera;
    if (this._auto.tick(performance.now())) this._applySize();
    // Sky only when the horizon is in view (never, on the RTS camera): saves its draw + fill
    cam.updateMatrixWorld();
    if (maxViewElevation(cam) > -0.035) cam.layers.enable(SKY_LAYER); else cam.layers.disable(SKY_LAYER);
    const d = atmosphere.cloudDrift;
    SHARED_UNIFORMS.iowCloud.value.set(d.x, d.y, gfx.cloudShadows ? atmosphere.cloudShadow : 0);

    if (this._hdrPath()) {
      if (!this._post) this._post = new PostFX(R);
      const v = R.getDrawingBufferSize(_v2), s = this._auto.scale;
      if (this._post.ensure(Math.round(v.x * s), Math.round(v.y * s), this._auto.msaa ? 4 : 0)) {
        R.toneMappingExposure = -1;
        // Cloud wisps between camera and sea: only at close (harbour) zoom; they
        // parallax faster than the sea when panning and drift with the wind.
        const cp = cam.position, zoomIn = 1 - Math.min(1, Math.max(0, (cp.y - 26) / 34));
        _wisp.set(cp.x * 0.0065 + atmosphere.cloudDrift.x / CLOUD_TILE, cp.z * 0.0065 + atmosphere.cloudDrift.y / CLOUD_TILE,
                  WISPS * zoomIn * zoomIn * (1 - 0.5 * atmosphere.night));
        _wispCol.copy(atmosphere.fogColor).lerp(_WHITE, 0.55);
        this._post.render(this._scene, this._camera, {
          exposure: EXPOSURE * atmosphere.exposure,
          tint:     atmosphere.tint,
          bloom:    BLOOM + 0.35 * atmosphere.night,
          vignette: VIGNETTE + 0.06 * atmosphere.night,
          wisp:     _wisp,
          wispColor: _wispCol,
        });
        return;
      }
      this._applySize();                       // refused: fall back to direct for the session
    }
    R.toneMappingExposure = EXPOSURE * atmosphere.exposure;
    R.setRenderTarget(null);
    R.render(this._scene, this._camera);
  }

  destroy() {
    sizes.off('resize.renderer');
    this._post?.dispose();
    this.instance.dispose();
  }
}
