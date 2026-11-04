// ── CameraShake ────────────────────────────────────────────────────
// trigger(amount) stacks intensity (capped at 1.2); it decays exponentially.
// The offset is a sum of incommensurate sines (coherent "thump" motion)
// instead of per-frame white noise, which read as jitter at high frame rates.
// VFX attenuates triggers by camera distance before they arrive here.
export class CameraShake {
  constructor() {
    this._intensity = 0;
    this._decay     = 8.0;
    this._t         = Math.random() * 10;
  }

  /** Add a shake impulse (0..1.2 total). */
  trigger(intensity = 0.4) {
    this._intensity = Math.min(this._intensity + intensity, 1.2);
  }

  /** Apply this frame's offset to the camera (after it was positioned). */
  update(dt, camera) {
    if (this._intensity < 0.001) { this._intensity = 0; return; }
    this._intensity -= this._intensity * this._decay * dt;
    this._t += dt;
    const s = this._intensity, t = this._t * 28;
    camera.position.x += (Math.sin(t * 1.00 + 0.3) * 0.5 + Math.sin(t * 2.31 + 1.7) * 0.3 + Math.sin(t * 4.13 + 4.2) * 0.2) * s * 0.32;
    camera.position.y += (Math.sin(t * 1.27 + 2.1) * 0.5 + Math.sin(t * 2.93 + 0.4) * 0.3 + Math.sin(t * 3.71 + 3.3) * 0.2) * s * 0.20;
  }
}
