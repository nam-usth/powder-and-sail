// ── SPRING CAMERA ────────────────────────────────────────────────
// AE milestone: replaces raw lerp (camTgt.x += delta * 0.04) with
// a critically-damped spring. Frame-rate independent, settles crisply.
//
// Critical damping: damping = 2 * sqrt(stiffness) — fastest settle
// without oscillation. Slight overshoot on fast moves = game-feel weight.

export class SpringCamera {
  constructor(stiffness = 12) {
    this._k   = stiffness;
    this._d   = 2 * Math.sqrt(stiffness);  // critical damping coefficient
    this.pos  = { x: 0, z: 0 };
    this._vel = { x: 0, z: 0 };
    this._tgt = { x: 0, z: 0 };
    // Separate zoom spring
    this._distK   = 8;
    this._distD   = 2 * Math.sqrt(8);
    this.dist     = 80;
    this._distV   = 0;
    this._distTgt = 80;
  }

  setTarget(x, z)   { this._tgt.x = x; this._tgt.z = z; }
  setDistTarget(d)   { this._distTgt = Math.max(25, Math.min(150, d)); }

  // Instant warp — no spring animation (game start / fleet teleport)
  warpTo(x, z, dist) {
    this.pos.x = x; this.pos.z = z;
    this._vel.x = 0; this._vel.z = 0;
    this._tgt.x = x; this._tgt.z = z;
    if (dist !== undefined) {
      this.dist = dist; this._distTgt = dist; this._distV = 0;
    }
  }

  update(dt) {
    const d = Math.min(dt, 0.05);  // spiral-of-death guard
    // XZ spring
    for (const ax of ['x', 'z']) {
      const acc     = this._k * (this._tgt[ax] - this.pos[ax]) - this._d * this._vel[ax];
      this._vel[ax] += acc * d;
      this.pos[ax]  += this._vel[ax] * d;
    }
    // Zoom spring
    const dAcc  = this._distK * (this._distTgt - this.dist) - this._distD * this._distV;
    this._distV += dAcc * d;
    this.dist    = Math.max(25, Math.min(150, this.dist + this._distV * d));
  }

  get speed() { return Math.hypot(this._vel.x, this._vel.z); }
}
