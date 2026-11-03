// ── DEBUG ────────────────────────────────────────────────────────
// Lightweight stats overlay. Toggle with Shift+D.
// Shows: FPS, frame delta ms, draw calls, triangle count, physics ms (AC+).
// No external dependency — pure DOM + CSS, zero impact when hidden.

export class Debug {
  constructor(renderer) {
    this._renderer = renderer;
    this._active   = false;
    this._el       = null;
    this._samples  = [];   // rolling FPS window

    window.addEventListener('keydown', e => {
      if (e.shiftKey && e.key === 'D') this._toggle();
    });
  }

  update(delta) {
    if (!this._active || !this._el) return;

    // Rolling average FPS over last 60 samples
    this._samples.push(1 / delta);
    if (this._samples.length > 60) this._samples.shift();
    const fps = Math.round(this._samples.reduce((a, b) => a + b, 0) / this._samples.length);

    const info = this._renderer.instance.info;
    const dc   = info.render.calls;
    const tri  = (info.render.triangles / 1000).toFixed(1);
    const ms   = (delta * 1000).toFixed(1);

    this._el.innerHTML =
      `<b>FPS</b> ${fps} &nbsp; <b>ms</b> ${ms}<br>` +
      `<b>draw</b> ${dc} &nbsp; <b>tri</b> ${tri}k<br>` +
      `<span style="color:#aaa;font-size:10px">Shift+D to hide</span>`;
  }

  _toggle() {
    this._active = !this._active;
    if (this._active) {
      this._el = document.createElement('div');
      this._el.style.cssText = [
        'position:fixed', 'top:8px', 'left:8px', 'z-index:9999',
        'background:rgba(0,0,0,.72)', 'color:#0f0', 'font:12px/1.6 monospace',
        'padding:6px 10px', 'border-radius:4px', 'pointer-events:none',
        'white-space:nowrap'
      ].join(';');
      document.body.appendChild(this._el);
    } else if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  destroy() {
    if (this._el) this._el.remove();
  }
}
