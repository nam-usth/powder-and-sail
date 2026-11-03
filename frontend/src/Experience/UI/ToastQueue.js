// ── ToastQueue.js (AN / G1) ─────────────────────────────────────────
// Stacked, queued notifications replacing the single #msg element.
//
// Why: with one #msg element, overlapping events (capture + build-done +
// low-resources) overwrote each other — players missed information.
//
// Behaviour:
//   • up to MAX_VISIBLE toasts stacked top-centre, newest on top
//   • overflow waits in a FIFO queue and slides in as slots free up
//   • duplicate text within 1.5 s refreshes the existing toast instead
//     of stacking a twin (rapid-fire "Not enough wood" clicks)
//   • type inferred from leading emoji/keywords unless given explicitly
//
// API (used by GameApp._showMsg, signature unchanged for all callers):
//   toasts.show(text, durationMs, type?)   type: info|success|warn|danger
//
// Pure DOM — no Three.js dependency, testable in isolation.

const MAX_VISIBLE = 4;

const TYPE_ICON = { info: '⚓', success: '✦', warn: '⚠', danger: '☠' };

// Heuristic type inference so 30+ existing _showMsg call-sites get
// colour-coding for free without touching each one.
function inferType(txt) {
  const t = String(txt);
  if (/^(⚠|☠|🔥)|retaken|destroyed|lost|sunk!|Not enough|Need /i.test(t)) {
    return /retaken|destroyed|lost|☠/i.test(t) ? 'danger' : 'warn';
  }
  if (/^(🏴|✅|✦|🎉)|captured|complete|repaired|created|Sold|Bought|revived/i.test(t)) return 'success';
  return 'info';
}

export class ToastQueue {
  constructor() {
    this._host    = null;
    this._queue   = [];          // waiting {text,dur,type}
    this._live    = [];          // visible {el, timer, text, bornAt}
  }

  _ensureHost() {
    // Re-create if a UI re-render detached the cached node (isConnected
    // guard) — and parent to <body>, which nothing innerHTML-wipes.
    if (this._host && this._host.isConnected) return this._host;
    this._host?.remove();
    const h = document.createElement('div');
    h.id = 'toast-host';
    document.body.appendChild(h);
    this._host = h;
    return h;
  }

  show(text, dur = 2500, type = null) {
    if (!text) return;
    type = type || inferType(text);

    // Duplicate within 1.5 s → refresh timer + pulse instead of stacking
    const now = performance.now();
    const dup = this._live.find(l => l.text === text && now - l.bornAt < 1500);
    if (dup) {
      clearTimeout(dup.timer);
      dup.timer  = setTimeout(() => this._dismiss(dup), dur);
      dup.bornAt = now;
      dup.el.classList.remove('toast-pulse');
      void dup.el.offsetWidth;            // restart CSS animation
      dup.el.classList.add('toast-pulse');
      return;
    }

    if (this._live.length >= MAX_VISIBLE) { this._queue.push({ text, dur, type }); return; }
    this._spawn(text, dur, type);
  }

  _spawn(text, dur, type) {
    const host = this._ensureHost();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const ic = document.createElement('span');
    ic.className = 'toast-ic';
    ic.textContent = TYPE_ICON[type] || TYPE_ICON.info;
    const tx = document.createElement('span');
    tx.className = 'toast-tx';
    tx.textContent = text;                // textContent — no innerHTML, no XSS surface
    el.appendChild(ic); el.appendChild(tx);
    host.prepend(el);                     // newest on top
    // Entrance via @keyframes (see .toast CSS) — a class-flip + transition
    // proved fragile when the first paint is delayed; keyframes always run.
    el.classList.add('toast-in');

    const item = { el, text, bornAt: performance.now(), timer: null };
    item.timer = setTimeout(() => this._dismiss(item), dur);
    el.addEventListener('click', () => this._dismiss(item));   // tap to dismiss
    this._live.push(item);
  }

  _dismiss(item) {
    const i = this._live.indexOf(item);
    if (i === -1) return;
    this._live.splice(i, 1);
    clearTimeout(item.timer);
    item.el.classList.remove('toast-in');
    item.el.classList.add('toast-out');
    setTimeout(() => item.el.remove(), 320);
    const next = this._queue.shift();
    if (next) this._spawn(next.text, next.dur, next.type);
  }

  clear() {
    this._live.forEach(l => { clearTimeout(l.timer); l.el.remove(); });
    this._live.length = 0; this._queue.length = 0;
  }
}

export const toasts = new ToastQueue();
