// ── AUTO RESOLUTION — the frame-rate governor ───────────────────
// Keeps the game near 60 FPS by trading resolution, one step at a time:
//
//   HIGH  level 0: 100 %, 4x MSAA → 1: 85 % → 2: 70 % → 3: 70 %, no MSAA
//         (the 3D scene renders smaller and the composite stretches it over
//         the canvas; the DOM HUD stays sharp)
//   LOW   level 0: 100 % → 1: 85 % → 2: 70 % of the canvas pixel ratio
//
// Down: two consecutive 3 s windows under 50 FPS. Up: four consecutive
// windows at 57+ FPS; if a step up is followed by a step down within 20 s
// the next step up waits twice as long (no oscillation). Frames over 250 ms
// are not counted (a hidden tab, a hitch, a shader compile), nor the first
// window after any change. Pure JS, no allocations per frame.

const WINDOW_MS  = 3000;
const SLOW_FPS   = 50;
const FAST_FPS   = 57;
const SCALES     = [1, 0.85, 0.7, 0.7];

export class AutoResolution {
  constructor() {
    /** Master switch (Renderer.setAutoResolution). */
    this.enabled = true;
    this.tier    = 'high';
    this.level   = 0;
    this._last = 0; this._t = 0; this._n = 0;
    this._slow = 0; this._fast = 0; this._skip = 1;
    this._upNeed = 4; this._lastUp = -1e9;
  }

  /** Highest level for the current tier. */
  get maxLevel() { return this.tier === 'high' ? 3 : 2; }
  /** Scene resolution scale (HIGH: post target; LOW: canvas pixel ratio). */
  get scale()    { return SCALES[this.level]; }
  /** MSAA allowed (HIGH level < 3). */
  get msaa()     { return this.level < 3; }

  /** Restart measuring (tier change, resize); keeps the level unless asked. */
  reset(tier, keepLevel = false) {
    if (tier) this.tier = tier;
    if (!keepLevel) this.level = 0;
    this.level = Math.min(this.level, this.maxLevel);
    this._t = this._n = this._slow = this._fast = 0;
    this._skip = 1; this._last = 0;
  }

  /**
   * Feed one frame. Returns true when the level changed (caller re-sizes).
   * @param {number} now performance.now()
   */
  tick(now) {
    const d = now - this._last;
    this._last = now;
    if (!this.enabled || d > 250 || d <= 0) return false;
    this._t += d; this._n++;
    if (this._t < WINDOW_MS) return false;
    const fps = 1000 * this._n / this._t;
    this._t = this._n = 0;
    if (this._skip > 0) { this._skip--; return false; }

    if (fps < SLOW_FPS) { this._slow++; this._fast = 0; }
    else if (fps >= FAST_FPS) { this._fast++; this._slow = 0; }
    else { this._slow = 0; this._fast = 0; }

    if (this._slow >= 2 && this.level < this.maxLevel) {
      if (now - this._lastUp < 20000) this._upNeed = Math.min(this._upNeed * 2, 40);
      this.level++;
      this._slow = this._fast = 0; this._skip = 1;
      return true;
    }
    if (this._fast >= this._upNeed && this.level > 0) {
      this.level--;
      this._lastUp = now;
      this._slow = this._fast = 0; this._skip = 1;
      return true;
    }
    return false;
  }
}
