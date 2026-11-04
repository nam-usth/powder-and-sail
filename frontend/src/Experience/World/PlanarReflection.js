import * as THREE from 'three';
import { SKY_LAYER } from '../Render/GfxQuality.js';

// ── PLANAR REFLECTION (HIGH tier) ────────────────────────────────
// Renders the scene from the main camera mirrored in the sea plane (y = 0)
// into a half-resolution target; Ocean.js samples it projectively, distorted
// by the wave normal and weighted by Fresnel (it shows most at the grazing
// top of the RTS view: islands, hulls and masts, the sunset sky).
//
// Correctness (vs. the old mirrored-matrix version):
//  • the virtual camera is a proper camera placed below the water looking up
//    (three's Reflector technique) — a mirrored view matrix flips triangle
//    winding, so every FrontSide mesh rendered inside out;
//  • an oblique near plane clips everything under the water (submerged hull
//    parts and the island skirts never appear in the reflection).
// Cost control:
//  • the shadow map is NOT re-rendered for this pass (it was, every frame);
//  • the sea itself, overlays (anything drawn with depthTest:false — rings,
//    markers, HP bars, fog-of-war), sprites and lines are skipped;
//  • half the drawing-buffer resolution, no mipmaps.
//
// Usage (GameApp, each frame on HIGH, before the main render):
//   this._refl.update(renderer.instance, camera);
//   this._ocean.setReflection(this._refl.texture, this._refl.projViewMatrix);

const SCALE = 0.5;   // of the drawing buffer

const _camPos = new THREE.Vector3(), _target = new THREE.Vector3(), _look = new THREE.Vector3();
const _rot = new THREE.Matrix4(), _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const _size = new THREE.Vector2();
const _NORMAL = new THREE.Vector3(0, 1, 0), _ORIGIN = new THREE.Vector3(0, 0, 0);

export class PlanarReflection {
  /**
   * @param {THREE.Scene} scene
   * @param {number} [resolution] initial size; the target then follows the canvas
   */
  constructor(scene, resolution = 512) {
    this._scene  = scene;
    this._target = new THREE.WebGLRenderTarget(resolution, resolution, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    });
    this._cam = new THREE.PerspectiveCamera();
    this._cam.matrixAutoUpdate = true;
    /** Reflection camera projection × view (Ocean's uReflMatrix). */
    this.projViewMatrix = new THREE.Matrix4();
    this._hidden = [];
    this._collect = (o) => {
      if (o === this._scene) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.userData.noReflect || o.isSprite || o.isLine || (m && m.depthTest === false)) {
        o.visible = false;
        this._hidden.push(o);
      }
    };
  }

  /** The reflection texture (sampled by Ocean.js). */
  get texture() { return this._target.texture; }

  /**
   * Render the reflection. Call once per frame BEFORE the main render.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.PerspectiveCamera} cam  the main camera
   */
  update(renderer, cam) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(64, Math.round(_size.x * SCALE)), h = Math.max(64, Math.round(_size.y * SCALE));
    if (w !== this._target.width || h !== this._target.height) this._target.setSize(w, h);

    // Virtual camera: position, look target and up mirrored in y = 0
    cam.updateMatrixWorld();
    _camPos.setFromMatrixPosition(cam.matrixWorld);
    _rot.extractRotation(cam.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    const v = this._cam;
    v.position.set(_camPos.x, -_camPos.y, _camPos.z);
    _target.set(_look.x, -_look.y, _look.z);
    v.up.set(0, 1, 0).applyMatrix4(_rot);
    v.up.y = -v.up.y;
    v.lookAt(_target);
    v.far = cam.far;
    v.layers.mask = cam.layers.mask | (1 << SKY_LAYER);   // the sky always shows in the mirror
    v.updateMatrixWorld();
    v.matrixWorldInverse.copy(v.matrixWorld).invert();
    v.projectionMatrix.copy(cam.projectionMatrix);

    // Oblique near plane = the sea plane (Lengyel): nothing under water renders
    _plane.setFromNormalAndCoplanarPoint(_NORMAL, _ORIGIN).applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = v.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1; e[14] = _clip.w;
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();

    this.projViewMatrix.copy(v.projectionMatrix).multiply(v.matrixWorldInverse);

    // Skip the sea, overlays, sprites and lines for this pass
    this._hidden.length = 0;
    this._scene.traverseVisible(this._collect);

    const prevTarget = renderer.getRenderTarget();
    const autoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;        // reuse this frame's shadow map
    renderer.setRenderTarget(this._target);
    renderer.render(this._scene, v);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = autoUpdate;

    for (let i = 0; i < this._hidden.length; i++) this._hidden[i].visible = true;
    this._hidden.length = 0;
  }

  /** Kept for GameApp's resize hook — the target follows the drawing buffer itself. */
  resize() {}

  destroy() { this._target.dispose(); }
}
