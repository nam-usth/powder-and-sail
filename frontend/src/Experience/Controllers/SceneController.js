import * as THREE from 'three';
import { sizes }    from '../Sizes.js';
import { MAP }      from '../../data/constants.js';
import { ringEdgeMat, RING_RENDER_ORDER, RING_Y } from '../Utils/RingMaterial.js';

/**
 * SceneController — owns scene graph, lights, click plane, move ring.
 * Mirrors Bruno Simon's World/Environment.js responsibility.
 */
export class SceneController {
  constructor(scene, state) {
    this._scene  = scene;
    this._state  = state;
    this._tRingT = 0;
    this.eulerCache = new THREE.Euler();

    this._addFog();
    this._addLights();
    this._addClickPlane();
    this._addMoveRing();
    this._bindResize();
  }

  get clickPlane() { return this._cPlane; }
  get moveRing()   { return this._tRing;  }
  get tRingT()     { return this._tRingT; }
  set tRingT(v)    { this._tRingT = v;    }

  _addFog() {
    this._scene.background = null;
    this._scene.fog = new THREE.FogExp2(0x6688aa, 0.0032);
  }

  _addLights() {
    // AF7: AmbientLight intensity + colour updated each frame via setSunDir()
    this._ambient = new THREE.AmbientLight(0x4466aa, 0.55);
    this._scene.add(this._ambient);

    // AF7: DirectionalLight position tracks Sky's sun direction
    this._sunLight = new THREE.DirectionalLight(0xfff0cc, 1.5);
    this._sunLight.position.set(60, 90, 40);
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    ['left','right','top','bottom'].forEach(k =>
      this._sunLight.shadow.camera[k] = (k === 'right' || k === 'top') ? 160 : -160
    );
    this._sunLight.shadow.camera.far = 400;
    this._scene.add(this._sunLight);

    const rim = new THREE.DirectionalLight(0x2244aa, 0.4);
    rim.position.set(-40, 20, -60);
    this._scene.add(rim);
  }

  // ── AF7: Sun light sync ─────────────────────────────────────
  // Called every frame from GameApp with sky.getSunDir().
  // Moves DirectionalLight to match shader sun position.
  // Also adjusts ambient colour and fog tint for day/night feeling.
  setSunDir(dir, dayPhase) {
    // Position light far along sun direction so shadows sweep across map
    const DIST = 180;
    this._sunLight.position.set(
      dir.x * DIST,
      Math.max(dir.y * DIST, 8),   // never below y=8 — avoid shadow flip
      dir.z * DIST
    );
    this._sunLight.shadow.camera.updateProjectionMatrix();

    // Intensity: full noon (dayPhase≈1) → dim night (dayPhase≈0)
    const dp = Math.max(dayPhase, 0);
    this._sunLight.intensity = 0.3 + dp * 1.4;

    // Colour temperature: warm noon → cool blue night
    const r = 0.55 + dp * 0.45;
    const g = 0.60 + dp * 0.40;
    const b = 0.75 + dp * 0.20;
    this._sunLight.color.setRGB(r, g, b);

    // Ambient: slightly warmer during day
    this._ambient.intensity = 0.25 + dp * 0.35;
    this._ambient.color.setRGB(
      0.26 + dp * 0.14,
      0.30 + dp * 0.20,
      0.55 + dp * 0.12
    );

    // Fog colour tracks sky horizon (approx)
    if (this._scene.fog) {
      this._scene.fog.color.setRGB(
        0.05 + dp * 0.33,
        0.08 + dp * 0.44,
        0.12 + dp * 0.55
      );
    }
  }

  _addClickPlane() {
    this._cPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP + 100, MAP + 100),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    this._cPlane.rotation.x = -Math.PI / 2;
    this._scene.add(this._cPlane);
  }

  _addMoveRing() {
    this._tRing = new THREE.Mesh(
      new THREE.RingGeometry(.7, 1.1, 28),
      ringEdgeMat(0x40d0ff, 0.90)
    );
    this._tRing.rotation.x = -Math.PI / 2;
    this._tRing.position.y = RING_Y;
    this._tRing.renderOrder = RING_RENDER_ORDER;
    this._tRing.visible    = false;
    this._scene.add(this._tRing);
  }

  _bindResize() {
    sizes.on('resize.camera', () => {/* handled by GameApp camera */});
  }

  /** Pulse the move-ring each frame. Returns true while still visible. */
  updateMoveRing(t, dt) {
    if (!this._tRing.visible) return false;
    this._tRingT -= dt;
    this._tRing.material.opacity = Math.max(0, .35 + Math.sin(t * 7.0) * .28);
    this._tRing.scale.setScalar(1 + Math.sin(t * 5.5) * .08);
    if (this._tRingT <= 0) this._tRing.visible = false;
    return this._tRing.visible;
  }

  placeRingAt(x, z, fleetColor) {
    this._tRing.position.set(x, .2, z);
    this._tRing.visible = true;
    this._tRingT = 2.5;
    try { this._tRing.material.color.set(fleetColor || '#40d0ff'); } catch(e) {}
  }
}
