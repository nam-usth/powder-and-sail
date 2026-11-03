import * as THREE from 'three';

// ── MINIMAP CONTROLLER ────────────────────────────────────────────
// Canvas2D only — no WebGL RenderTarget.
// RenderTarget caused: ocean shader checkerboard visible on minimap,
// readRenderTargetPixels() cost (~2ms/frame), and no meaningful benefit
// over a clean top-down 2D draw.
//
// AU (RTS):
//   left click / drag  → move the camera there
//   right click        → order the selection there (Shift queues)
//   draws the camera's view footprint, fleet colours, the selection
//   (white outline) and hostiles only where your vision reaches.

const MM   = 160;   // canvas size px
const HALF = 150;   // world half-extent

export class MinimapController {
  constructor(state, islands, game = null) {
    this._state   = state;
    this._islands = islands;
    this._g       = game;
    this._S       = MM / (HALF * 2);   // world→pixel scale
    this._ctx     = null;
    this._v       = new THREE.Vector3();
    this._init();
  }

  _init() {
    const canvas = document.getElementById('mmcvs');
    if (!canvas) return;
    canvas.width  = MM;
    canvas.height = MM;
    this._ctx = canvas.getContext('2d');
    canvas.style.cursor = 'crosshair';

    const toWorld = e => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width)  * HALF * 2 - HALF,
        z: ((e.clientY - rect.top)  / rect.height) * HALF * 2 - HALF,
      };
    };
    let dragging = false;
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      const w = toWorld(e); this._g?._cam?.jumpTo(w.x, w.z);
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = toWorld(e); this._g?._cam?.jumpTo(w.x, w.z);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      const w = toWorld(e);
      this._g?._command?.orderAtWorld(w.x, w.z, e.shiftKey);
    });
  }

  _px(worldX, worldZ) {
    return {
      x: (worldX + HALF) * this._S,
      z: (worldZ + HALF) * this._S,
    };
  }

  /** Where a screen corner (NDC) meets the sea plane y = 0. */
  _ground(cam, nx, ny) {
    const p = this._v.set(nx, ny, 0.5).unproject(cam);
    const o = cam.position;
    const dy = p.y - o.y;
    if (dy >= -1e-4) return null;                 // ray never reaches the sea
    const t = -o.y / dy;
    return { x: o.x + (p.x - o.x) * t, z: o.z + (p.z - o.z) * t };
  }

  draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const st = this._state;

    // Background — deep ocean colour matching game sky
    ctx.fillStyle = '#091624';
    ctx.fillRect(0, 0, MM, MM);

    // Islands
    this._islands.forEach(isl => {
      const { x, z } = this._px(isl.x, isl.z);
      const r = Math.max(3, isl.r * this._S);
      ctx.beginPath();
      ctx.arc(x, z, r, 0, Math.PI * 2);
      ctx.fillStyle = isl.down
        ? '#332211'
        : isl.own === 'player'  ? '#2e7a50'
        : isl.own === 'enemy'   ? '#7a2e2e'
        : '#8a7040';
      ctx.fill();
      // Fort indicator
      if (!isl.down) {
        ctx.beginPath();
        ctx.arc(x, z, Math.max(1.5, r * 0.38), 0, Math.PI * 2);
        ctx.fillStyle = isl.own === 'player' ? '#60e890' : isl.own === 'enemy' ? '#e86060' : '#d4a830';
        ctx.fill();
      }
    });

    // Player ships — fleet colour, selection outlined
    const fleetCol = new Map((st.fleets || []).map(f => [f.id, f.color]));
    const sel = new Set(st.selection || []);
    st.playerShips.filter(s => s.alive).forEach(s => {
      const { x, z } = this._px(s.x, s.z);
      ctx.save();
      ctx.translate(x, z);
      ctx.rotate(-s.angle + Math.PI);
      ctx.fillStyle = fleetCol.get(s.fleetId) || '#ffdd80';
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(2.5, 3);
      ctx.lineTo(-2.5, 3);
      ctx.closePath();
      ctx.fill();
      if (sel.has(s)) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke(); }
      ctx.restore();
    });

    // Hostile ships — only where the fog lets you see them
    const pirates = this._g?._events?.getPirateShips?.() || [];
    [...st.enemyShips, ...pirates].filter(s => s.alive).forEach(s => {
      if (st.fogOn && s.mesh && !s.mesh.visible) return;
      const { x, z } = this._px(s.x, s.z);
      ctx.beginPath();
      ctx.arc(x, z, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = s.team === 'enemy' ? '#ff5555' : '#c070ff';
      ctx.fill();
    });

    // Camera footprint
    const cam = this._g?._camera;
    if (cam) {
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([nx, ny]) => this._ground(cam, nx, ny));
      if (pts.every(Boolean)) {
        ctx.beginPath();
        pts.forEach((p, i) => { const q = this._px(p.x, p.z); i ? ctx.lineTo(q.x, q.z) : ctx.moveTo(q.x, q.z); });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(240,220,160,0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Border
    ctx.strokeStyle = 'rgba(100,150,200,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, MM - 1, MM - 1);
  }

  destroy() {}
}
