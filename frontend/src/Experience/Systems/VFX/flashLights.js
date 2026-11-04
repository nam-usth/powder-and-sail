import * as THREE from 'three';
import { ENV } from './env.js';

// ── FlashLights — fixed pool of transient point lights ─────────────
// The old muzzle/explosion pools owned 8 PointLights and toggled their
// `visible` flag. Every change in the number of visible lights changes every
// lit material's program key → shader recompiles mid-battle. Here a FIXED set
// of lights is always present (intensity 0 when idle), so the light count —
// and every lit program — stays constant. Each flash grabs the light whose
// remaining energy is lowest. The same three flashes are mirrored into
// ENV.uFlashPos so gun smoke glows orange from inside for a moment.

const N = 3;

export class FlashLights {
  constructor(scene) {
    this._scene = scene;
    this._lights = [];
    this._st = [];
    for (let i = 0; i < N; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 16, 1.8);
      l.position.set(0, -50, 0);
      scene.add(l);
      this._lights.push(l);
      this._st.push({ t: 1e9, peak: 0, tau: 0.1, rise: 0.02 });
    }
  }

  /**
   * Fire a flash.
   * @param {number} peak  light intensity at the top of the envelope
   * @param {number} tau   exponential decay constant (s)
   * @param {number} [delay] start later (staggered broadsides)
   */
  flash(x, y, z, peak = 6, tau = 0.09, delay = 0, color = 0xff9a40) {
    let best = 0, bestE = Infinity;
    for (let i = 0; i < N; i++) {
      const s = this._st[i];
      const e = s.t < 0 ? s.peak : s.peak * Math.exp(-s.t / s.tau);
      if (e < bestE) { bestE = e; best = i; }
    }
    const s = this._st[best], l = this._lights[best];
    s.t = -delay; s.peak = peak; s.tau = tau; s.rise = Math.min(0.03, tau * 0.3);
    l.position.set(x, y, z);
    l.color.setHex(color);
  }

  update(dt) {
    for (let i = 0; i < N; i++) {
      const s = this._st[i], l = this._lights[i];
      s.t += dt;
      let I = 0;
      if (s.t >= 0 && s.t < s.tau * 8) I = s.peak * Math.min(1, s.t / s.rise) * Math.exp(-Math.max(0, s.t - s.rise) / s.tau);
      l.intensity = I;
      const u = ENV.uFlashPos.value[i];
      u.set(l.position.x, l.position.y, l.position.z, I);
    }
  }

  destroy() { this._lights.forEach(l => this._scene.remove(l)); }
}
