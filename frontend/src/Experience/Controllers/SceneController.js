import * as THREE from 'three';
import { sizes }    from '../Sizes.js';
import { MAP }      from '../../data/constants.js';
import { ringEdgeMat, RING_RENDER_ORDER, RING_Y } from '../Utils/RingMaterial.js';
import { atmosphere } from '../World/Atmosphere.js';
import { gfx }      from '../Render/GfxQuality.js';

/**
 * SceneController — owns scene graph, lights, click plane, move ring.
 * Mirrors Bruno Simon's World/Environment.js responsibility.
 *
 * Lighting (driven every frame by the shared Atmosphere palette):
 *   • HemisphereLight — sky from above, sea bounce from below: surfaces are
 *     lit by which way they face (ambient that models form).
 *   • AmbientLight    — a small flat floor (VFX env.js reads it for smoke).
 *   • DirectionalLight — the key light: the sun by day, the moon by night.
 *     Its shadow camera is FITTED to what the RTS camera sees (centred just
 *     beyond the look-at point, sized by zoom) and snapped to shadow texels,
 *     so shadows are ~2-4× sharper than a whole-map box and do not shimmer
 *     while panning. Shadows follow gfx.shadows (user toggle AND HIGH).
 *   • Fog colour tracks the horizon haze (the sea fogs to the same colour);
 *     its density is set once and left alone (SeaEvents thickens it in storms).
 */
const FOG_DENSITY = 0.0026;
const SHADOW_MAP  = 2048;
const LIGHT_DIST  = 240;
const MIN_KEY_ELEV = Math.sin(9 * Math.PI / 180);   // keep shadows finite at sunrise / sunset

const _UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up2 = new THREE.Vector3(), _c = new THREE.Vector3();

export class SceneController {
  constructor(scene, state) {
    this._scene  = scene;
    this._state  = state;
    this._tRingT = 0;
    this.eulerCache = new THREE.Euler();
    this._shadowR = 0;

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
    this._scene.background = null;     // the sky dome + sea cover the whole view
    this._scene.fog = new THREE.FogExp2(atmosphere.fogColor.getHex(), FOG_DENSITY);
  }

  _addLights() {
    this._hemi = new THREE.HemisphereLight(0xbad5f0, 0x5a716c, 0.6);
    this._scene.add(this._hemi);

    this._ambient = new THREE.AmbientLight(0x8fa6c4, 0.12);
    this._scene.add(this._ambient);

    const L = this._sunLight = new THREE.DirectionalLight(0xfff0dc, 1.2);
    L.castShadow = gfx.shadows;
    L.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    L.shadow.bias       = -0.0004;
    L.shadow.normalBias = 0.035;
    this._scene.add(L);
    this._scene.add(L.target);
    atmosphere.shadowLight = L;

    gfx.on('change.scene', () => { L.castShadow = gfx.shadows; });
    this.setSunDir(atmosphere.sunDir, atmosphere.dayPhase);
  }

  // ── Sun / moon light sync ───────────────────────────────────
  /**
   * Called every frame from GameApp with sky.getSunDir(). Reads the shared
   * Atmosphere (updated by Sky.update the same frame) for the key light
   * (sun or moon), the hemisphere and the fog colour; fits the shadow camera.
   * @param {THREE.Vector3} dir      sun direction (used if no atmosphere frame yet)
   * @param {number}        dayPhase 0 midnight … 1 noon
   */
  setSunDir(dir, dayPhase) {
    const A = atmosphere, L = this._sunLight;
    if (A.version === 0 && dir) A.update(dir, dayPhase ?? 1, 0);

    // Key light: colour, intensity, direction (elevation floored for finite shadows)
    L.color.copy(A.keyColor);
    L.intensity = A.keyIntensity;
    _dir.copy(A.keyDir);
    if (_dir.y < MIN_KEY_ELEV) {
      const hl = Math.hypot(_dir.x, _dir.z) || 1, k = Math.sqrt(1 - MIN_KEY_ELEV * MIN_KEY_ELEV) / hl;
      _dir.set(_dir.x * k, MIN_KEY_ELEV, _dir.z * k);
    }

    this._hemi.color.copy(A.hemiSky);
    this._hemi.groundColor.copy(A.hemiGround);
    this._hemi.intensity = A.hemiIntensity;
    this._ambient.color.copy(A.hemiSky).lerp(A.hemiGround, 0.4);
    this._ambient.intensity = A.ambientIntensity;
    if (this._scene.fog) this._scene.fog.color.copy(A.fogColor);

    // Shadow camera fitted to the view: centred a little beyond the look-at
    // point (the RTS view extends further up-screen than down), sized by zoom.
    const st = this._state, tgt = st?.camTgt, dist = st?.camDist || 80;
    const R = Math.min(200, Math.max(34, dist * 1.25));
    _c.set(tgt ? tgt.x : 0, 0, (tgt ? tgt.z : 0) - dist * 0.3);
    // Snap the centre to whole shadow texels in light space (no edge shimmer)
    _right.crossVectors(_UP, _dir).normalize();
    _up2.crossVectors(_dir, _right);
    const texel = (2 * R) / SHADOW_MAP;
    const a = _c.dot(_right), b = _c.dot(_up2);
    _c.addScaledVector(_right, Math.round(a / texel) * texel - a)
      .addScaledVector(_up2, Math.round(b / texel) * texel - b);
    L.target.position.copy(_c);
    L.position.copy(_c).addScaledVector(_dir, LIGHT_DIST);
    L.target.updateMatrixWorld();

    if (Math.abs(R - this._shadowR) > 0.5) {
      const cam = L.shadow.camera;
      cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
      cam.near = Math.max(1, LIGHT_DIST - R - 80);
      cam.far  = LIGHT_DIST + R + 80;
      cam.updateProjectionMatrix();
      this._shadowR = R;
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
