export class CameraShake {
  constructor() {
    this._intensity = 0;
    this._decay     = 8.0;
  }

  trigger(intensity = 0.4) {
    this._intensity = Math.min(this._intensity + intensity, 1.2);
  }

  update(dt, camera) {
    if (this._intensity < 0.001) { this._intensity = 0; return; }
    this._intensity -= this._intensity * this._decay * dt;
    const s = this._intensity;
    camera.position.x += (Math.random() - 0.5) * s * 0.5;
    camera.position.y += (Math.random() - 0.5) * s * 0.3;
  }
}
