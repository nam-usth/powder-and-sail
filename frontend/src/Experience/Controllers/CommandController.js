import * as THREE from 'three';
import { bus }    from '../EventBus.js';
import { toasts } from '../UI/ToastQueue.js';
import { FORMATIONS, FORMATION_ORDER, STANCES, STANCE_ORDER, ORDER_TUNING } from '../../data/commands.js';
import { gunProfile } from '../Systems/Naval/OrderSystem.js';

/**
 * CommandController (AU) — RTS selection and orders for the player fleet.
 *
 *   Left click ship        select it (Shift: toggle in selection)
 *   Left drag              box-select (Shift: add)
 *   Double click ship      select every ship of that hull on screen
 *   Right click            smart order for the selection:
 *                            ocean → move · enemy ship → attack ·
 *                            enemy/neutral island → siege & capture ·
 *                            own island → sail alongside
 *                          Shift+right click queues a waypoint
 *   A / P then click       attack-move / patrol (Shift keeps the mode)
 *   S · H                  stop · hold position
 *   F · T                  cycle formation · cycle stance
 *   Ctrl+1–9 / Shift+1–9   assign / add selection to fleet N
 *   1–9 (twice: centre)    select fleet N
 *   F2 or Ctrl+A           select all ships
 *   Space                  centre camera on the selection
 *
 * State lives on GameState: st.selection (array of player ships) and
 * st.cmd ({formation}). Emits 'selection:changed' whenever it changes.
 */

const DOUBLE_TAP = 0.35;   // s — repeated group key centres the camera
const MODE_HINT = {
  move:   'MOVE — click a destination',
  amove:  'ATTACK-MOVE — click a destination or target',
  patrol: 'PATROL — click the far end of the route',
};
const MODE_RING = { move: '#40d0ff', amove: '#ff6a4a', patrol: '#e8c040', attack: '#ff3b30', siege: '#ff9a3a' };

export class CommandController {
  constructor(game) {
    this._g = game;
    this._st = game._state;
    this._st.selection = this._st.selection || [];
    this._mode = null;
    this._lastGroup = { num: 0, t: -1 };
    this.hover = null;
    this._v = new THREE.Vector3();
    this._box = this._ensureBox();
    this._bind();
  }

  get mode() { return this._mode; }

  // ── Wiring ────────────────────────────────────────────────────
  _bind() {
    bus.on('input:dragstart', d => this._onDrag(d, false));
    bus.on('input:drag',      d => this._onDrag(d, false));
    bus.on('input:dragend',   d => this._onDrag(d, true));
    bus.on('input:dblclick',  ({ raw }) => this._onDblClick(raw));
    bus.on('input:rightclick', ({ raw }) => this._onRightClick(raw));
    bus.on('input:mousemove', ({ clientX, clientY }) => this._onHover(clientX, clientY));
    bus.on('ship:destroyed',  ({ ship }) => this._prune(ship));
    bus.on('ship:removed',    ({ ship }) => this._prune(ship));
  }

  _ensureBox() {
    let el = document.getElementById('sel-box');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sel-box';
      (document.getElementById('ui') || document.body).appendChild(el);
    }
    return el;
  }

  // ── Selection ─────────────────────────────────────────────────
  selected() { return this._st.selection.filter(s => s.alive); }

  setSelection(ships, add = false) {
    const st = this._st;
    let next = add ? [...st.selection] : [];
    ships.forEach(s => { if (s.alive && s.team === 'player' && !next.includes(s)) next.push(s); });
    st.selection = next;
    st.selectedShip = next[0] || st.selectedShip;
    // highlight the fleet tab only when the selection IS that fleet
    const fids = new Set(next.map(s => s.fleetId));
    if (fids.size === 1) {
      const fid = [...fids][0];
      const crew = this._g._fleet?.shipsOf(fid) || [];
      st.selectedFleetId = crew.length === next.length ? fid : st.selectedFleetId;
      st._selIsFleet = crew.length === next.length;
    } else {
      st._selIsFleet = false;
    }
    this._status();
    bus.emit('selection:changed', { selection: next });
  }

  toggle(ship) {
    const st = this._st;
    if (st.selection.includes(ship)) this.setSelection(st.selection.filter(s => s !== ship));
    else this.setSelection([ship], true);
  }

  clearSelection() { if (this._st.selection.length) this.setSelection([]); }

  selectFleet(fleetId, center = false) {
    const ships = this._g._fleet?.shipsOf(fleetId) || [];
    this._g._fleet?.selectFleet(fleetId);
    this.setSelection(ships);
    if (center) this.centerOnSelection();
  }

  selectAll() { this.setSelection(this._st.playerShips.filter(s => s.alive)); }

  _prune(ship) {
    if (this._st.selection.includes(ship)) this.setSelection(this._st.selection.filter(s => s !== ship));
    if (this.hover === ship) this.hover = null;
  }

  centroid(ships = this.selected()) {
    if (!ships.length) return null;
    return {
      x: ships.reduce((a, s) => a + s.x, 0) / ships.length,
      z: ships.reduce((a, s) => a + s.z, 0) / ships.length,
    };
  }

  centerOnSelection() {
    const c = this.centroid() || this.centroid(this._st.playerShips.filter(s => s.alive));
    if (c) this._g._cam.jumpTo(c.x, c.z);
  }

  // ── Picking (screen space) ────────────────────────────────────
  _toScreen(x, y, z) {
    const v = this._v.set(x, y, z).project(this._g._camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  _pickRadius() { return Math.max(14, Math.min(36, 26 * 70 / (this._st.camDist || 70))); }

  _hostiles() {
    const pirates = this._g._events?.getPirateShips?.() || [];
    return [...this._st.enemyShips, ...pirates].filter(s => s.alive && this._visible(s));
  }

  _visible(s) {
    const st = this._st;
    return !st.fogOn || (s.mesh ? s.mesh.visible : true);
  }

  /** Nearest ship of `pool` under the cursor, or null. */
  pickShip(cx, cy, pool) {
    let best = null, bd = this._pickRadius();
    for (const s of pool) {
      if (!s.alive) continue;
      const p = this._toScreen(s.x, 1.2, s.z);
      if (!p) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  _clientXY(raw) {
    const t = raw?.changedTouches?.[0] || raw;
    return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
  }

  _islandAt(pt) {
    return this._g._islands.find(i => (pt.x - i.x) ** 2 + (pt.z - i.z) ** 2 < (i.r + 2.5) ** 2) || null;
  }

  // ── Left click (routed by InputController, in priority order) ─
  /** Targeting mode (A / P / Move button) consumes the click. */
  consumeTargetingClick(pt, raw) {
    if (!this._mode) return false;
    const { x, y } = this._clientXY(raw);
    this._orderAt(this._mode, pt, x, y, !!raw?.shiftKey);
    if (!raw?.shiftKey) this.setMode(null);
    return true;
  }

  /** Clicking a ship selects it. Returns true when a ship was hit. */
  clickShip(raw) {
    const { x, y } = this._clientXY(raw);
    const own = this.pickShip(x, y, this._st.playerShips);
    if (own) {
      raw?.shiftKey ? this.toggle(own) : this.setSelection([own]);
      return true;
    }
    const foe = this.pickShip(x, y, this._hostiles());
    if (foe) {
      const stxt = document.getElementById('status-text');
      if (stxt) stxt.textContent = `⚑ ${foe.nm} · ${foe.hull} · HP ${Math.round(foe.hp)}/${foe.maxHp} — right-click with ships selected to attack`;
      return true;
    }
    return false;
  }

  /** Empty ocean: deselect (desktop) or move the selection (touch). */
  clickOcean(pt, raw, touch) {
    if (touch && this.selected().length) {
      const { x, y } = this._clientXY(raw);
      this._orderAt('smart', pt, x, y, false);
      return;
    }
    if (!raw?.shiftKey) this.clearSelection();
  }

  _onDblClick(raw) {
    if (this._st.buildMode || this._st.gameOver) return;
    const { x, y } = this._clientXY(raw);
    const own = this.pickShip(x, y, this._st.playerShips);
    if (!own) return;
    const onScreen = this._st.playerShips.filter(s => {
      if (!s.alive || s.hull !== own.hull) return false;
      const p = this._toScreen(s.x, 1.2, s.z);
      return p && p.x >= 0 && p.y >= 0 && p.x <= window.innerWidth && p.y <= window.innerHeight;
    });
    this.setSelection(onScreen, !!raw?.shiftKey);
  }

  // ── Box select ────────────────────────────────────────────────
  _onDrag(d, end) {
    const st = this._st;
    if (st.buildMode || st.gameOver || this._mode) { this._box.style.display = 'none'; return; }
    const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1);
    const x1 = Math.max(d.x0, d.x1), y1 = Math.max(d.y0, d.y1);
    if (!end) {
      Object.assign(this._box.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
      return;
    }
    this._box.style.display = 'none';
    const inside = st.playerShips.filter(s => {
      if (!s.alive) return false;
      const p = this._toScreen(s.x, 1.2, s.z);
      return p && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    });
    this.setSelection(inside, !!d.raw?.shiftKey);
  }

  // ── Right click: smart command ────────────────────────────────
  _onRightClick(raw) {
    const g = this._g, st = this._st;
    if (st.gameOver) return;
    if (this._mode) { this.setMode(null); return; }
    if (st.buildMode) { g._inputCtrl.cancelBuild(); return; }
    if (!this.selected().length) return;
    const pt = g._input.raycast(g._camera, g._scene.clickPlane);
    if (!pt) return;
    const { x, y } = this._clientXY(raw);
    this._orderAt('smart', pt, x, y, !!raw?.shiftKey);
  }

  /** Minimap right-click: smart order at a world point (no ship picking). */
  orderAtWorld(x, z, queue) {
    if (this._st.gameOver || !this.selected().length) return;
    this._orderAt('smart', { x, z }, -1e4, -1e4, queue);
  }

  /** Resolve what is under (pt / cx,cy) and issue the matching order. */
  _orderAt(kind, pt, cx, cy, queue) {
    const g = this._g;
    const ships = this.selected();
    if (!ships.length) { toasts.show('Select ships first (click or drag a box)', 1500); return; }
    let spec;
    const foe = (kind === 'smart' || kind === 'amove') ? this.pickShip(cx, cy, this._hostiles()) : null;
    const isl = (kind === 'smart' || kind === 'amove') ? this._islandAt(pt) : null;
    if (foe) spec = { type: 'attack', target: foe };
    else if (isl && isl.own !== 'player') spec = { type: 'siege', target: isl };
    else if (kind === 'amove') spec = { type: 'amove', x: pt.x, z: pt.z };
    else if (kind === 'patrol') spec = { type: 'patrol', x: pt.x, z: pt.z };
    else spec = { type: 'move', x: pt.x, z: pt.z };

    g._fleet?.releaseAutomation(ships);
    g._orders.issue(ships, spec, { queue });
    if (spec.type === 'siege' && spec.target.own === 'enemy' && !spec.target.down) {
      // guns aim at the fort in the island centre; ships stay off the shore
      const reach = spec.target.r + ORDER_TUNING.shoreClearance;
      const short = ships.filter(s => gunProfile(s).range < reach).length;
      if (short === ships.length) toasts.show(`⚠ No gun can reach the fort on ${spec.target.nm} (needs range > ${reach}u) — fit long guns in Loadout [L]`, 3200, 'warn');
      else if (short) toasts.show(`${short} ship${short > 1 ? 's' : ''} cannot reach the fort — short-range guns`, 2200);
    }
    const tx = spec.target ? spec.target.x : pt.x, tz = spec.target ? spec.target.z : pt.z;
    g._scene.placeRingAt(tx, tz, MODE_RING[spec.type]);
    g._markers?.flashTarget(spec.target || null);
    const stxt = document.getElementById('status-text');
    if (stxt) stxt.textContent = this._orderText(spec, ships.length, queue);
    bus.emit('orders:issued', { ships, spec, queue });
  }

  _orderText(spec, n, queue) {
    const who = n === 1 ? this.selected()[0].nm : `${n} ships`;
    const q = queue ? ' (queued)' : '';
    switch (spec.type) {
      case 'attack': return `${who}: attack ${spec.target.nm}${q}`;
      case 'siege':  return `${who}: ${spec.target.own === 'neutral' || spec.target.down ? 'capture' : 'bombard'} ${spec.target.nm}${q}`;
      case 'amove':  return `${who}: attack-move${q}`;
      case 'patrol': return `${who}: patrol${q}`;
      default:       return `${who}: sailing${q}`;
    }
  }

  // ── Immediate orders & toggles ────────────────────────────────
  setMode(mode) {
    if (mode && !this.selected().length) { toasts.show('Select ships first', 1200); mode = null; }
    this._mode = mode;
    document.body.classList.toggle('cmd-targeting', !!mode);
    const stxt = document.getElementById('status-text');
    if (stxt && mode) stxt.textContent = `${MODE_HINT[mode]} · Shift: queue · Esc / right-click: cancel`;
    bus.emit('cmd:mode', { mode });
  }

  stop() {
    const ships = this.selected(); if (!ships.length) return;
    this._g._fleet?.releaseAutomation(ships);
    this._g._orders.stop(ships);
    this._flashStatus(`${ships.length === 1 ? ships[0].nm : ships.length + ' ships'}: all stop`);
  }

  hold() {
    const ships = this.selected(); if (!ships.length) return;
    this._g._fleet?.releaseAutomation(ships);
    this._g._orders.issue(ships, { type: 'hold' });
    this._flashStatus(`${ships.length === 1 ? ships[0].nm : ships.length + ' ships'}: holding position`);
  }

  setFormation(key) {
    if (!FORMATIONS[key]) return;
    this._st.cmd.formation = key;
    this._g._orders.setFormation(this.selected(), key);
    toasts.show(`${FORMATIONS[key].icon} Formation: ${FORMATIONS[key].name}`, 1200);
    bus.emit('cmd:formation', { formation: key });
  }

  cycleFormation() {
    const i = FORMATION_ORDER.indexOf(this._st.cmd.formation);
    this.setFormation(FORMATION_ORDER[(i + 1) % FORMATION_ORDER.length]);
  }

  setStance(key) {
    const ships = this.selected();
    if (!ships.length || !STANCES[key]) return;
    this._g._orders.setStance(ships, key);
    toasts.show(`${STANCES[key].icon} ${STANCES[key].name} — ${STANCES[key].desc}`, 1500);
    bus.emit('cmd:stance', { stance: key });
  }

  cycleStance() {
    const ships = this.selected(); if (!ships.length) return;
    const i = STANCE_ORDER.indexOf(ships[0].stance || 'defensive');
    this.setStance(STANCE_ORDER[(i + 1) % STANCE_ORDER.length]);
  }

  assignGroup(num, add) {
    const r = this._g._fleet?.assign(num, this.selected(), add);
    if (!r) return;
    if (!r.ok) { toasts.show(r.reason, 1600); return; }
    toasts.show(`${add ? 'Added to' : 'Assigned'} ${r.fleet.name} [${num}]`, 1200);
    this.selectFleet(r.fleet.id);
    this._g._hud?.rebuild();
  }

  recallGroup(num) {
    const f = this._g._fleet?.getFleetByNum(num);
    if (!f) { toasts.show(`Fleet ${num} is empty — Ctrl+${num} assigns the selection`, 1500); return; }
    const now = performance.now() / 1000;
    const twice = this._lastGroup.num === num && now - this._lastGroup.t < DOUBLE_TAP;
    this._lastGroup = { num, t: now };
    this.selectFleet(f.id, twice);
  }

  _flashStatus(txt) {
    const stxt = document.getElementById('status-text');
    if (stxt) stxt.textContent = txt;
  }

  _status() {
    const n = this.selected().length;
    this._flashStatus(n
      ? `${n === 1 ? this.selected()[0].nm : n + ' ships'} selected — right-click to command · A attack-move · S stop · H hold`
      : 'Drag to select ships · 1–9 recall fleets · F2 select all');
  }

  // ── Keyboard ──────────────────────────────────────────────────
  /** Returns true when the key was consumed. */
  handleKey(k, code, raw) {
    const st = this._st;
    if (k === 'escape' && this._mode) { this.setMode(null); return true; }
    if (st.buildMode) return false;            // build mode owns R/Q/E/Esc

    const digit = /^(Digit|Numpad)([1-9])$/.exec(code || '');
    if (digit) {
      const num = +digit[2];
      raw?.preventDefault?.();
      if (raw?.ctrlKey || raw?.metaKey) this.assignGroup(num, false);
      else if (raw?.shiftKey) this.assignGroup(num, true);
      else this.recallGroup(num);
      return true;
    }
    if (k === 'f2' || (k === 'a' && (raw?.ctrlKey || raw?.metaKey))) { raw?.preventDefault?.(); this.selectAll(); return true; }
    if (raw?.ctrlKey || raw?.metaKey || raw?.altKey) return false;

    switch (k) {
      case ' ': raw?.preventDefault?.(); this.centerOnSelection(); return true;
      case 'a': this.setMode('amove');  return true;
      case 'p': this.setMode('patrol'); return true;
      case 's': this.stop();  return true;
      case 'h': this.hold();  return true;
      case 't': this.cycleStance(); return true;
      case 'f': if (raw?.shiftKey) return false; this.cycleFormation(); return true;
    }
    return false;
  }

  // ── Hover ─────────────────────────────────────────────────────
  _onHover(cx, cy) {
    const st = this._st;
    if (st.buildMode) { this.hover = null; return; }
    this.hover = this.pickShip(cx, cy, st.playerShips) || this.pickShip(cx, cy, this._hostiles());
    const attackCursor = (this.hover && this.hover.team !== 'player' && this.selected().length) || this._mode;
    document.body.classList.toggle('cmd-cursor-attack', !!attackCursor);
    document.body.classList.toggle('cmd-cursor-select', !attackCursor && !!this.hover);
  }
}
