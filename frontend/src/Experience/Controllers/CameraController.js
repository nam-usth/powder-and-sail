import * as THREE from 'three';
import { SpringCamera } from '../SpringCamera.js';
import { bus } from '../EventBus.js';
import { MAP } from '../../data/constants.js';

/**
 * CameraController — wraps SpringCamera; RTS-style panning and cam modes.
 * Mirrors Bruno Simon's Camera.js.
 *
 * AU: panning is RTS-standard and works in every mode —
 *   arrow keys · screen-edge push · middle-mouse grab-drag · minimap jump.
 * Modes:
 *   'free'   — default; camera stays where you put it
 *   'fleet'  — follow the centroid of the selected ships (⚓ button)
 *   'island' — snap onto the focused island (clicking an island)
 * Panning while following breaks the follow (switches to 'free').
 */
const EDGE_PX   = 14;     // screen-edge band that pushes the camera
const PAN_SPEED = 48;     // world units / s at camDist 80 (scales with zoom)
const PAN_LIMIT = MAP / 2 + 20;   // look-at point stays near the playable sea

export class CameraController {
  constructor(camera, state, input) {
    this._camera = camera;
    this._state  = state;
    this._input  = input;
    this._spring = new SpringCamera(12);
    this._spring.warpTo(state.camTgt?.x || 0, state.camTgt?.z || 0, state.camDist);
    this._dragPan = { dx: 0, dy: 0 };
    bus.on('input:pan', ({ dx, dy }) => { this._dragPan.dx += dx; this._dragPan.dy += dy; });
  }

  get spring() { return this._spring; }

  init() {
    this._posCamera();
  }

  /** Centre the camera on a world point (minimap, Space, double-tap group). */
  jumpTo(x, z) {
    const st = this._state;
    if (st.camMode === 'fleet' || st.camMode === 'island') this.setMode('free');
    this._spring.setTarget(x, z);
  }

  update(focus, dt, vfxShake, islands) {
    const st  = this._state;
    const sp  = this._spring;

    // ── Manual pan input (all modes) ───────────────────────────
    const inp = this._input;
    let px = 0, pz = 0;
    if (inp.isDown('arrowleft'))  px -= 1;
    if (inp.isDown('arrowright')) px += 1;
    if (inp.isDown('arrowup'))    pz -= 1;
    if (inp.isDown('arrowdown'))  pz += 1;
    const p = inp.pointer;
    if (p?.inside && !st.paused && document.hasFocus()) {
      if (p.x <= EDGE_PX) px -= 1;
      if (p.x >= window.innerWidth - EDGE_PX) px += 1;
      if (p.y <= EDGE_PX) pz -= 1;
      if (p.y >= window.innerHeight - EDGE_PX) pz += 1;
    }
    const zoomK = sp.dist / 80;
    let mx = px * PAN_SPEED * zoomK * dt, mz = pz * PAN_SPEED * zoomK * dt;
    if (this._dragPan.dx || this._dragPan.dy) {
      // grab-pan: world units per pixel at the look-at point
      const wpp = 2 * Math.tan(THREE.MathUtils.degToRad(this._camera.fov / 2)) * sp.dist * 1.25 / window.innerHeight;
      mx -= this._dragPan.dx * wpp;
      mz -= this._dragPan.dy * wpp;
      this._dragPan.dx = this._dragPan.dy = 0;
    }
    const manual = mx !== 0 || mz !== 0;
    if (manual && st.camMode === 'fleet') this.setMode('free');

    // ── Mode targets ───────────────────────────────────────────
    if (st.camMode === 'fleet' && focus) {
      sp.setTarget(focus.x, focus.z);
    } else if (st.camMode === 'island' && st.camLockedId && !st._camIslandSnapped) {
      const isl = islands.find(i => i.def.id === st.camLockedId);
      if (isl) {
        sp.setTarget(isl.x, isl.z);
        sp.setDistTarget(Math.min(st.camDist, 60));
        if (Math.hypot(sp.pos.x - isl.x, sp.pos.z - isl.z) < 2) st._camIslandSnapped = true;
      }
    }
    if (manual) {
      st._camIslandSnapped = true;   // panning away from an island ends the snap
      sp.setTarget(sp._tgt.x + mx, sp._tgt.z + mz);
    }
    sp.setTarget(Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, sp._tgt.x)),
                 Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, sp._tgt.z)));

    sp.setDistTarget(st.camDist);
    sp.update(dt);

    // Mirror back for legacy code
    st.camTgt.set(sp.pos.x, 0, sp.pos.z);
    st.camDist = sp.dist;

    this._posCamera();
    vfxShake.update(dt, this._camera);
    this._updateCamModeUI();
  }

  setMode(mode, islandId = null) {
    const st = this._state;
    st.camMode           = mode;
    st.camLockedId       = islandId;
    st._camIslandSnapped = false;
    this._updateCamModeUI();
  }

  _posCamera() {
    const st = this._state;
    const t  = st.camTgt;
    this._camera.position.set(t.x, st.camDist * .75, t.z + st.camDist);
    this._camera.lookAt(t);
  }

  _updateCamModeUI() {
    const st        = this._state;
    const fleetBtn  = document.getElementById('cam-fleet-btn');
    const islandBtn = document.getElementById('cam-island-btn');
    const freeBtn   = document.getElementById('cam-free-btn');
    if (fleetBtn)  fleetBtn.classList.toggle('active',  st.camMode === 'fleet');
    if (islandBtn) islandBtn.classList.toggle('active', st.camMode === 'island');
    if (freeBtn)   freeBtn.classList.toggle('active',   st.camMode === 'free');
    if (islandBtn) {
      if (st.camLockedId) {
        islandBtn.title = `Island focus (arrows / edge pan)`;
      } else {
        islandBtn.title = 'Focus island [click island]';
      }
    }
  }
}
