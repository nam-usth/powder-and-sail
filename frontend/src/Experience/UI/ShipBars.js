import * as THREE from 'three';

// ── SHIP BARS (AV) ──────────────────────────────────────────────
// Floating hull bars above ships — a DOM overlay projected every frame.
//   own ships   : shown when selected, hovered or damaged (fleet-coloured frame)
//   hostiles    : shown when visible AND (hovered, damaged or targeted)
//   hold Alt    : every visible ship
// Pooled elements; positions are written as transforms only.

const BAR_Y = 3.6;     // world height of the bar anchor above the waterline

export class ShipBars {
  constructor(state, camera) {
    this._st = state;
    this._cam = camera;
    this._v = new THREE.Vector3();
    this._pool = [];
    this._host = document.getElementById('ship-bars');
    if (!this._host) {
      this._host = document.createElement('div');
      this._host.id = 'ship-bars';
      (document.getElementById('ui') || document.body).prepend(this._host);
    }
  }

  _bar(i) {
    let b = this._pool[i];
    if (!b) {
      const el = document.createElement('div');
      el.className = 'sbar';
      el.innerHTML = '<div class="sbar-fill"></div>';
      this._host.appendChild(el);
      b = this._pool[i] = { el, fill: el.firstChild, key: '' };
    }
    return b;
  }

  update(hover, hostiles, tactical) {
    const st = this._st;
    const sel = new Set(st.selection);
    const targets = new Set();
    for (const s of st.selection) {
      const t = s.orders?.[0]?.target || s._engage?.target;
      if (t && !t.def) targets.add(t);
    }
    const fleetCol = new Map((st.fleets || []).map(f => [f.id, f.color]));
    const W = Math.max(22, Math.min(46, 34 * 70 / (st.camDist || 70)));
    const vw = window.innerWidth, vh = window.innerHeight;
    let n = 0;

    const show = (s, own) => {
      const p = this._v.set(s.x, BAR_Y * (s.sc || 1), s.z).project(this._cam);
      if (p.z > 1) return;
      const x = (p.x + 1) / 2 * vw, y = (1 - p.y) / 2 * vh;
      if (x < -50 || y < -20 || x > vw + 50 || y > vh + 20) return;
      const b = this._bar(n++);
      const pct = Math.max(0, Math.min(1, s.hp / s.maxHp));
      const key = `${own ? 'o' : 'h'}|${sel.has(s) ? 1 : 0}|${pct > .6 ? 'g' : pct > .3 ? 'a' : 'r'}`;
      if (b.key !== key) {
        b.key = key;
        b.el.className = `sbar ${own ? 'own' : 'foe'}${sel.has(s) ? ' sel' : ''} ${key.slice(-1)}`;
      }
      if (own) b.el.style.setProperty('--fc', fleetCol.get(s.fleetId) || '#c8a35a');
      b.el.style.width = W + 'px';
      b.el.style.transform = `translate3d(${(x - W / 2).toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      b.fill.style.width = (pct * 100).toFixed(1) + '%';
      b.el.style.display = '';
    };

    for (const s of st.playerShips) {
      if (!s.alive) continue;
      if (tactical || sel.has(s) || s === hover || s.hp < s.maxHp) show(s, true);
    }
    for (const s of hostiles) {
      if (!s.alive || (st.fogOn && s.mesh && !s.mesh.visible)) continue;
      if (tactical || s === hover || targets.has(s) || s.hp < s.maxHp) show(s, false);
    }
    for (let i = n; i < this._pool.length; i++) {
      if (this._pool[i].el.style.display !== 'none') this._pool[i].el.style.display = 'none';
    }
  }
}
