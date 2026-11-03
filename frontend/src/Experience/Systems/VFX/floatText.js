// ── floatText.js (AN / G2) ──────────────────────────────────────────
// World-anchored floating text: damage numbers, income ticks, pickups.
//
// DOM-based (not sprites) — crisp at any zoom, free font rendering, no
// texture uploads. A fixed pool of <span>s is projected world→screen every
// frame; off-screen / behind-camera / far labels are hidden, not removed.
//
// Pool of POOL_MAX labels; when full the oldest is recycled, so combat
// spam can never grow the DOM unbounded.
//
// API:
//   layer.spawn(x, y, z, text, { col, size, life, rise, weight })
//   layer.update(dt)            // called by VFX.update each frame
import * as THREE from 'three';

const POOL_MAX  = 48;
const FAR_CULL  = 170;     // world units — beyond this, don't even project

export class FloatTextLayer {
  constructor(camera) {
    this._cam   = camera;
    this._host  = null;
    this._pool  = [];          // every label ever made (≤ POOL_MAX)
    this._live  = [];          // currently animating subset
    this._v     = new THREE.Vector3();
  }

  _ensureHost() {
    if (this._host) return this._host;
    const h = document.createElement('div');
    h.id = 'float-text-layer';
    document.body.appendChild(h);
    this._host = h;
    return h;
  }

  _acquire() {
    if (this._pool.length < POOL_MAX) {
      const el = document.createElement('span');
      el.className = 'ft-label';
      this._ensureHost().appendChild(el);
      const item = { el, active: false };
      this._pool.push(item);
      return item;
    }
    // pool exhausted — recycle the oldest live label
    const oldest = this._live.shift();
    if (oldest) return oldest;
    return this._pool[0];
  }

  spawn(x, y, z, text, opts = {}) {
    // distance cull before touching the DOM at all
    const dx = x - this._cam.position.x, dz = z - this._cam.position.z;
    if (dx * dx + dz * dz > FAR_CULL * FAR_CULL) return;

    const item = this._acquire();
    item.active = true;
    item.x = x; item.y = y; item.z = z;
    item.t = 0;
    item.life = opts.life ?? 1.15;
    item.rise = opts.rise ?? 2.4;          // world units risen over lifetime
    item.el.textContent  = text;
    item.el.style.color      = opts.col    ?? '#f1d27a';
    item.el.style.fontSize   = (opts.size  ?? 13) + 'px';
    item.el.style.fontWeight = opts.weight ?? 600;
    item.el.style.display    = 'block';
    if (!this._live.includes(item)) this._live.push(item);
  }

  update(dt) {
    if (!this._live.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const it = this._live[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        it.el.style.display = 'none';
        it.active = false;
        this._live.splice(i, 1);
        continue;
      }
      // project (x, y + rise·easeOut, z) → NDC → CSS px
      const easeOut = 1 - (1 - k) * (1 - k);
      this._v.set(it.x, it.y + it.rise * easeOut, it.z).project(this._cam);
      if (this._v.z > 1 || this._v.x < -1.1 || this._v.x > 1.1 ||
          this._v.y < -1.1 || this._v.y > 1.1) {
        it.el.style.display = 'none';      // off-screen: hide but keep animating
        continue;
      }
      it.el.style.display   = 'block';
      it.el.style.transform =
        `translate(-50%,-100%) translate(${((this._v.x + 1) / 2 * w) | 0}px, ${((1 - this._v.y) / 2 * h) | 0}px)`;
      it.el.style.opacity   = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    }
  }

  clear() {
    this._live.forEach(it => { it.el.style.display = 'none'; it.active = false; });
    this._live.length = 0;
  }
}
