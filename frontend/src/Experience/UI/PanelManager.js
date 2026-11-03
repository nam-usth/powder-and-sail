// ── PANEL MANAGER ────────────────────────────────────────────────
// AE.2: single source of truth for all panel open/close state.
// Supports two categories:
//   • .panel elements: CSS transition via .pm-open class
//   • legacy elements: display:block/none (island-panel, revive-panel, bld-detail)

const MS = 180;

// Panels that hide the bottom fleet/ship bar when open
const HIDES_FLEET = new Set(['lp', 'bp', 'rp']);

// Panels that are NOT .panel elements — use display toggle, not CSS transition
const LEGACY_IDS = new Set(['island-panel', 'revive-panel', 'bld-detail', 'upgrade-panel', 'settings-modal', 'help-modal']);

// AQ: exclusive regions — opening a panel closes its region siblings.
// Fixes "too many overlapping panels": at most one LEFT, one RIGHT, one
// CENTER panel at a time. bld-detail becomes a LEFT drill-down that
// replaces island-panel (Back button restores it).
const GROUPS = {
  left:   ['island-panel', 'bld-detail'],
  right:  ['bp', 'rp', 'lp', 'upgrade-panel'],
  center: ['empire-panel', 'revive-panel'],
};
const GROUP_OF = {};
Object.entries(GROUPS).forEach(([g, ids]) => ids.forEach(id => GROUP_OF[id] = g));

class _PanelManager {
  constructor() {
    this._stack  = [];
    this._timers = new Map();
  }

  open(id) {
    const el = document.getElementById(id);
    if(!el) return;

    // AQ: region exclusivity — close same-group siblings first
    const grp = GROUP_OF[id];
    if(grp) GROUPS[grp].forEach(sib => {
      if(sib !== id && this.isOpen(sib)) this.close(sib);
    });

    // Cancel pending close
    if(this._timers.has(id)){ clearTimeout(this._timers.get(id)); this._timers.delete(id); }

    this._stack = this._stack.filter(s => s !== id);
    this._stack.push(id);

    if(LEGACY_IDS.has(id)){
      // Legacy: just show directly
      el.style.display = 'block';
      el.style.zIndex  = 12 + this._stack.length;
    } else {
      // .panel: two-step CSS transition
      el.style.display = (id === 'bp' || id === 'rp') ? 'flex' : 'block';
      el.style.zIndex  = 12 + this._stack.length;
      el.getBoundingClientRect();  // force layout flush so transition fires
      el.classList.add('pm-open');
    }

    if(HIDES_FLEET.has(id)) document.body.classList.add('lp-open');
  }

  close(id) {
    const el = document.getElementById(id);
    if(!el) return;

    if(LEGACY_IDS.has(id)){
      el.style.display = 'none';
      this._timers.delete(id);
    } else {
      el.classList.remove('pm-open');
      const t = setTimeout(() => {
        if(!el.classList.contains('pm-open')) el.style.display = 'none';
        this._timers.delete(id);
      }, MS + 20);
      this._timers.set(id, t);
    }

    this._stack = this._stack.filter(s => s !== id);

    if(HIDES_FLEET.has(id)){
      const anyOpen = [...HIDES_FLEET].some(p =>
        p !== id && document.getElementById(p)?.classList.contains('pm-open')
      );
      if(!anyOpen) document.body.classList.remove('lp-open');
    }
  }

  /** AQ: close the most recently opened panel that is still open.
      Returns true if something was closed — lets ESC peel panels
      before falling through to pause. */
  closeTop() {
    for(let i = this._stack.length - 1; i >= 0; i--){
      const id = this._stack[i];
      if(this.isOpen(id)){ this.close(id); return true; }
    }
    return false;
  }

  toggle(id) {
    this.isOpen(id) ? this.close(id) : this.open(id);
  }

  isOpen(id) {
    const el = document.getElementById(id);
    if(!el) return false;
    if(LEGACY_IDS.has(id)) return el.style.display !== 'none' && el.style.display !== '';
    return el.classList.contains('pm-open');
  }

  closeAll() {
    [...this._stack].forEach(id => this.close(id));
  }
}

export const PanelManager = new _PanelManager();

// Expose globally for inline HTML onclick handlers
window.closePanel = (id) => PanelManager.close(id);

// ── Inject CSS for .panel transition elements ─────────────────────
const s = document.createElement('style');
s.textContent = `
  .panel {
    display: none;
    /* AO/AP fix: panel VISIBILITY must never ride the animation clock —
       environments with a frozen timeline (headless, throttled tabs)
       froze the opacity transition at 0, leaving panels invisible.
       Entrance feel now comes from a transform-only slide; opacity
       stays 1 from birth (same hardening as the toast queue). */
    transform: translateY(10px) scale(.985);
    transition: transform ${MS}ms cubic-bezier(.22,.68,0,1.2);
    pointer-events: none;
  }
  .panel.pm-open {
    transform: translateY(0) scale(1);
    pointer-events: all;
  }
  #bp, #rp { display: none; }
  #bp.pm-open, #rp.pm-open { display: flex !important; }
`;
document.head.appendChild(s);
