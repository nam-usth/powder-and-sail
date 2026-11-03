// ── SIZES ────────────────────────────────────────────────────────
// Centralises all viewport dimensions.
// Every system reads from here; window.addEventListener('resize') lives here only.
//
// Usage:
//   import { sizes } from './Sizes.js'
//   sizes.on('resize', () => { camera.aspect = sizes.aspect; ... })

import { EventEmitter } from './EventEmitter.js';

class Sizes extends EventEmitter {
  constructor() {
    super();
    this._set();
    window.addEventListener('resize', () => { this._set(); this.trigger('resize'); });
  }

  _set() {
    this.width       = window.innerWidth;
    this.height      = window.innerHeight;
    this.aspect      = this.width / this.height;
    this.pixelRatio  = Math.min(window.devicePixelRatio, 2);
  }
}

export const sizes = new Sizes();
