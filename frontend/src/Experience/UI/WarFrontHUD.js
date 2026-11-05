// ── WarFrontHUD.js (AS) ─────────────────────────────────────────
// The always-visible tug-of-war bar. Player crest pushes from the left,
// enemy from the right, a divider marks the current front. This is the
// game's heartbeat — one glance tells you if you're winning the war.
//
// Pure DOM, updated each frame from GameApp.update (cheap: a few style
// writes). The bar lives just under the top header.

import { T } from '../../i18n.js';

export class WarFrontHUD {
  constructor(state) {
    this._state = state;
    this._last  = -1;
    this._ensure();
  }

  _ensure() {
    if (document.getElementById('warfront')) return;
    const wrap = document.createElement('div');
    wrap.id = 'warfront';
    wrap.innerHTML = `
      <div class="wf-side wf-side-l"><span class="wf-crest">⚓</span><span class="wf-label" id="wf-label-l"></span></div>
      <div class="wf-bar" id="warfront-bar">
        <div class="wf-fill-l" id="wf-fill-l"></div>
        <div class="wf-fill-r" id="wf-fill-r"></div>
        <div class="wf-mid" id="wf-mid"></div>
        <div class="wf-divider" id="wf-divider"><span class="wf-pct" id="wf-pct">50%</span></div>
      </div>
      <div class="wf-side wf-side-r"><span class="wf-label" id="wf-label-r"></span><span class="wf-crest">☠</span></div>`;
    document.getElementById('ui')?.appendChild(wrap) || document.body.appendChild(wrap);
    this._labels();
    window.addEventListener('iow:langchange', () => this._labels());
  }

  /** Side labels in the active language (i18n T.wfYou / T.wfFoe). */
  _labels() {
    const l = document.getElementById('wf-label-l'), r = document.getElementById('wf-label-r');
    if (l) l.textContent = T.wfYou || 'Your Flag';
    if (r) r.textContent = T.wfFoe || 'The Enemy';
  }

  update() {
    const v = this._state.warFront ?? 50;
    if (Math.abs(v - this._last) < 0.15) return;   // skip micro-updates
    this._last = v;

    const fillL = document.getElementById('wf-fill-l');
    const fillR = document.getElementById('wf-fill-r');
    const div   = document.getElementById('wf-divider');
    const pct   = document.getElementById('wf-pct');
    if (!fillL) return;

    fillL.style.width = v + '%';
    fillR.style.width = (100 - v) + '%';
    div.style.left = v + '%';
    pct.textContent = Math.round(v) + '%';

    // tension cue: as the front approaches either end, the leading side glows
    const wrap = document.getElementById('warfront');
    wrap.classList.toggle('wf-winning', v >= 75);
    wrap.classList.toggle('wf-losing',  v <= 25);
  }
}
