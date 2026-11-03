import * as THREE from 'three';
import { bus } from './EventBus.js';

// ── INPUT MANAGER ───────────────────────────────────────────────
// Centralises all DOM input. Emits named events via bus.
//
// AU (RTS controls):
//   left drag > DRAG_PX   → input:dragstart / input:drag / input:dragend
//                           (box select); the click that follows is swallowed
//   double click          → input:dblclick
//   middle drag           → input:pan {dx, dy} (camera grab-pan)
//   right click           → input:rightclick {mouse, raw}
//   pointer               → this.pointer {x, y, inside} for screen-edge pan
//   keydown               → {key, code, raw}; `code` is layout-independent
//                           (Shift+1 gives key '!' but code 'Digit1')
const DRAG_PX = 6;

export class InputManager {
  constructor(canvas) {
    this._canvas  = canvas;
    this._mouse   = new THREE.Vector2();
    this._rcaster = new THREE.Raycaster();
    this._keys    = new Set();
    this.pointer  = { x: 0, y: 0, inside: false };
    this._drag    = null;     // { x0, y0, x1, y1, active }
    this._swallowClick = false;
    this._bind();
  }

  _bind(){
    const canvas = this._canvas;

    canvas.addEventListener('click', e => {
      if (this._swallowClick) { this._swallowClick = false; return; }
      this._setMouse(e);
      bus.emit('input:click', { mouse: this._mouse.clone(), raw: e });
    });

    canvas.addEventListener('dblclick', e => {
      this._setMouse(e);
      bus.emit('input:dblclick', { mouse: this._mouse.clone(), raw: e });
    });

    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._setMouse(e);
      bus.emit('input:rightclick', { mouse: this._mouse.clone(), raw: e });
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) {
        this._drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, active: false, raw: e };
      } else if (e.button === 1) {
        e.preventDefault();                       // no browser autoscroll
        this._pan = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mousemove', e => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true;
      const d = this._drag;
      if (d) {
        d.x1 = e.clientX; d.y1 = e.clientY;
        if (!d.active && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > DRAG_PX) {
          d.active = true;
          bus.emit('input:dragstart', { ...d });
        }
        if (d.active) bus.emit('input:drag', { ...d });
      }
      if (this._pan) {
        bus.emit('input:pan', { dx: e.clientX - this._pan.x, dy: e.clientY - this._pan.y });
        this._pan.x = e.clientX; this._pan.y = e.clientY;
      }
    });

    window.addEventListener('mouseup', e => {
      if (e.button === 0 && this._drag) {
        const d = this._drag; this._drag = null;
        if (d.active) {
          this._swallowClick = true;              // the click event fires right after
          setTimeout(() => { this._swallowClick = false; }, 0);
          bus.emit('input:dragend', { ...d, raw: e });
        }
      } else if (e.button === 1) {
        this._pan = null;
      }
    });

    document.addEventListener('mouseleave', () => { this.pointer.inside = false; });

    canvas.addEventListener('mousemove', e => {
      this._setMouse(e);
      bus.emit('input:mousemove', { mouse: this._mouse.clone(), clientX: e.clientX, clientY: e.clientY });
    });

    canvas.addEventListener('wheel', e => {
      bus.emit('input:wheel', { delta: e.deltaY });
    }, { passive: true });

    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if(!this._keys.has(k)){
        this._keys.add(k);
        bus.emit('input:keydown', { key: k, code: e.code, raw: e });
      }
    });

    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this._keys.delete(k);
      bus.emit('input:keyup', { key: k, code: e.code, raw: e });   // AN: hold-key features (Alt tactical)
    });

    // Alt+Tab / focus loss: clear held keys so hold-modes can't get stuck
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._drag = null; this._pan = null;
      this.pointer.inside = false;
      bus.emit('input:blur', {});
    });

    // ── AT: touch controls (mobile PWA) ─────────────────────────
    // tap = click · 1-finger drag = hover (build ghost follows finger)
    // pinch = zoom (mapped onto input:wheel). touch-action:none stops the
    // browser from scrolling/zooming the page underneath the canvas.
    canvas.style.touchAction = 'none';
    let tStart = null, pinchD = 0;

    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        tStart = { x: t.clientX, y: t.clientY, t: performance.now() };
        this._setMouse(t);
        bus.emit('input:mousemove', { mouse: this._mouse.clone(), clientX: t.clientX, clientY: t.clientY });
      } else if (e.touches.length === 2) {
        tStart = null;  // second finger cancels pending tap
        pinchD = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._setMouse(t);
        bus.emit('input:mousemove', { mouse: this._mouse.clone(), clientX: t.clientX, clientY: t.clientY });
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        bus.emit('input:wheel', { delta: (pinchD - d) * 3 });
        pinchD = d;
      }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      if (!tStart || e.touches.length) return;
      const t  = e.changedTouches[0];
      const dx = t.clientX - tStart.x, dy = t.clientY - tStart.y;
      const quick = performance.now() - tStart.t < 350;
      tStart = null;
      if (quick && dx * dx + dy * dy < 144) {   // <12 px drift = tap
        this._setMouse(t);
        bus.emit('input:click', { mouse: this._mouse.clone(), raw: e, touch: true });
      }
    });
  }

  _setMouse(e){
    this._mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    this._mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  /** Raycast against a mesh, returns first hit point or null */
  raycast(camera, mesh){
    this._rcaster.setFromCamera(this._mouse, camera);
    const hits = this._rcaster.intersectObject(mesh);
    return hits.length ? hits[0].point : null;
  }

  /** Raycast from an arbitrary NDC point (minimap frustum, box corners). */
  raycastNdc(camera, mesh, nx, ny){
    this._rcaster.setFromCamera({ x: nx, y: ny }, camera);
    const hits = this._rcaster.intersectObject(mesh);
    return hits.length ? hits[0].point : null;
  }

  isDown(key){ return this._keys.has(key); }
}
