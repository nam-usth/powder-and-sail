import * as THREE from 'three';

// ── Planar Reflection (high-graphics) ─────────────────────────────
// Renders the scene from a camera mirrored across y=0 into a render
// target. Ocean.js samples this texture using projective UV + Fresnel.
//
// Usage in GameApp:
//   this._refl = new PlanarReflection(this._threeScene);
//   // each frame, before main render:
//   this._refl.update(this._renderer.instance, this._camera);
//   this._ocean.setReflection(this._refl.texture, this._refl.projViewMatrix);

const _REFLECT_Y = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0,-1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
);

export class PlanarReflection {
  constructor(scene, resolution = 512) {
    this._scene = scene;

    this._target = new THREE.WebGLRenderTarget(resolution, resolution, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    });

    this._reflCam = new THREE.PerspectiveCamera();
    this._reflCam.matrixAutoUpdate = false;

    // Reusable PV matrix exposed to Ocean shader
    this.projViewMatrix = new THREE.Matrix4();
  }

  get texture() { return this._target.texture; }

  // Call once per frame BEFORE the main render, only when high-graphics is on.
  update(renderer, mainCamera) {
    mainCamera.updateMatrixWorld();

    // Reflected world matrix: flip Y across the water plane (y = 0)
    this._reflCam.matrixWorld.copy(mainCamera.matrixWorld).premultiply(_REFLECT_Y);
    this._reflCam.matrixWorldInverse.copy(this._reflCam.matrixWorld).invert();
    this._reflCam.projectionMatrix.copy(mainCamera.projectionMatrix);
    this._reflCam.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);

    // PV matrix for projective UV lookup in Ocean shader
    this.projViewMatrix
      .copy(this._reflCam.projectionMatrix)
      .multiply(this._reflCam.matrixWorldInverse);

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this._target);
    renderer.clear();
    renderer.render(this._scene, this._reflCam);
    renderer.setRenderTarget(prev);
  }

  resize(w, h) {
    // Keep aspect in sync with main viewport
    this._target.setSize(w * 0.5, h * 0.5);
  }

  destroy() {
    this._target.dispose();
  }
}
