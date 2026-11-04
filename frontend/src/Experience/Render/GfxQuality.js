// ── GFX QUALITY (two tiers: HIGH / LOW) ──────────────────────────
// One shared state object for the render pipeline, modelled on the
// "Defense of the Dominion" two-tier model (design/art-reference/README.md):
//
//   HIGH  HDR float target + 4x MSAA, bloom, hue-preserving tone curve,
//         drifting cloud shadows, sun shadows (if the user keeps them on),
//         planar ocean reflection, HiDPI, the full ocean shader.
//   LOW   straight to the canvas at pixel ratio 1, no shadows / MSAA /
//         bloom / cloud shadows / reflection, the cheap ocean path —
//         but the same tone curve and palette, so it still looks right.
//
// Writer: Renderer (setQuality / setPostFX and the shadow toggle).
// Readers subscribe:  gfx.on('change.<ns>', () => …)  and read
// gfx.level / gfx.high / gfx.shadows / gfx.cloudShadows.
//
// No Three.js import: safe to load anywhere (tests, Meta code).

import { EventEmitter } from '../EventEmitter.js';

/**
 * three.js layer that holds the sky dome. The RTS camera never sees above the
 * horizon, so Renderer enables this layer on the main camera only when the
 * horizon is in view; the planar-reflection camera always renders it.
 */
export const SKY_LAYER = 1;

class GfxQuality extends EventEmitter {
  constructor() {
    super();
    /** @type {'high'|'low'} */
    this.level   = 'high';
    /** Effective sun shadows: the user's toggle AND the HIGH tier. */
    this.shadows = true;
  }

  /** True on the HIGH tier. */
  get high() { return this.level === 'high'; }

  /** Drifting cloud shadows over sea and islands (HIGH only). */
  get cloudShadows() { return this.level === 'high'; }

  /**
   * Set the tier. Fires 'change' only when something changed.
   * @param {'high'|'low'} level
   */
  setLevel(level) {
    const lv = level === 'low' ? 'low' : 'high';
    if (lv === this.level) return;
    this.level = lv;
    this.trigger('change');
  }

  /**
   * Set the effective shadow state (Renderer computes user && tier).
   * @param {boolean} on
   */
  setShadows(on) {
    const v = !!on;
    if (v === this.shadows) return;
    this.shadows = v;
    this.trigger('change');
  }
}

/** The process-wide graphics tier state. */
export const gfx = new GfxQuality();
