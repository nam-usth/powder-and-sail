// ── TIME ────────────────────────────────────────────────────────
// Real delta from requestAnimationFrame high-res timestamp.
// Replaces the hardcoded dt=1/60 and fake t=frame*0.015 pattern.
//
// Usage:
//   import { time } from './Time.js'
//   time.on('tick', () => { const { delta, elapsed } = time; ... })
//
// delta  — seconds since last frame, capped at 0.1s (spiral-of-death guard)
// elapsed — total seconds since game start

import { EventEmitter } from './EventEmitter.js';

class Time extends EventEmitter {
  constructor() {
    super();
    this.start   = performance.now();
    this.current = this.start;
    this.elapsed = 0;
    this.delta   = 1 / 60;  // sensible first-frame default
    this._tick   = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  _tick(now) {
    const raw      = (now - this.current) / 1000;
    this.delta     = Math.min(raw, 0.1);   // cap: never simulate > 100ms at once
    this.elapsed   = (now - this.start) / 1000;
    this.current   = now;
    this.trigger('tick');
    requestAnimationFrame(this._tick);
  }
}

export const time = new Time();
