// ── ORDER SYSTEM (AU) ───────────────────────────────────────────
// Per-ship order queues for the PLAYER fleet — the RTS command layer.
//
//   ship.orders  = [order, ...]   orders[0] is current; Shift-queue appends
//   ship.stance  = 'aggressive' | 'defensive' | 'holdfire'
//   ship.focusTarget             set every frame → CombatSystem fires at it first
//
// Order types
//   move / amove / patrol   group orders: the selection marches in formation
//                           behind a shared anchor that follows a planned path
//   attack  (ship target)   broadside engagement: orbit at the range of the
//                           strongest broadside, target kept abeam
//   siege   (island target) bombard the fort; once capturable, hold station
//                           inside the capture radius until the flag changes
//   hold                    stay put, fire at anything in arc
//
// Groups: one per group order. The anchor waits until every member has the
// order as its current one (Shift-queued groups start together), gathers the
// ships into their slots, then advances along a path planned around islands.

import { planPath, pushOutside } from './Navigation.js';
import { formationSlots, formationHalfWidth, slotToWorld, assignSlots } from './Formations.js';
import { steerTo, holdStill, handlingOf } from './MovementSystem.js';
import { StatusEffects } from '../Combat/StatusEffects.js';
import { resolveArc } from '../Combat/CombatSystem.js';
import { HULL_SLOTS } from '../../../data/ships.js';
import { CANNON_BY_ID } from '../../../data/cannons.js';
import { RANGE_U } from '../../../data/constants.js';
import { ORDER_TUNING as TUNE, STANCES, DEFAULT_STANCE, DEFAULT_FORMATION } from '../../../data/commands.js';

const GROUP_KINDS = new Set(['move', 'amove', 'patrol']);
const ENGAGING_KINDS = new Set(['amove', 'patrol']);

const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isIsland = t => !!(t && t.def);

function inArc(deg, arc) {
  let d = ((deg - arc.c) % 360 + 360) % 360;
  if (d > 180) d = 360 - d;
  return d <= arc.w / 2;
}

/**
 * Gunnery profile of a ship's current loadout:
 *   range — longest gun range; side — 'port' | 'starboard' | null (equal);
 *   sideRange — range of the strongest gun on the preferred broadside.
 */
export function gunProfile(ship) {
  const sig = (HULL_SLOTS[ship.hull] || []).map(sl => ship.loadout[sl] || '-').join('|');
  if (ship._gunSig === sig && ship._gunProf) return ship._gunProf;
  let range = 0;
  const side = { port: { dps: 0, R: 0, best: 0 }, starboard: { dps: 0, R: 0, best: 0 } };
  for (const sl of HULL_SLOTS[ship.hull] || []) {
    const cn = CANNON_BY_ID.get(ship.loadout[sl]);
    if (!cn) continue;
    const R = RANGE_U[cn.rt], dps = cn.dmg / cn.rof, arc = resolveArc(cn, sl);
    range = Math.max(range, R);
    if (inArc(90, arc))  { const s = side.starboard; s.dps += dps; if (dps > s.best) { s.best = dps; s.R = R; } }
    if (inArc(270, arc)) { const s = side.port;      s.dps += dps; if (dps > s.best) { s.best = dps; s.R = R; } }
  }
  const p = side.port, s = side.starboard;
  const pref = Math.abs(p.dps - s.dps) < 1e-6 ? null : (p.dps > s.dps ? 'port' : 'starboard');
  const sideRange = pref ? side[pref].R : Math.max(p.R, s.R);
  ship._gunSig = sig;
  ship._gunProf = { range: range || 8, side: pref, sideRange: sideRange || range || 8 };
  return ship._gunProf;
}

export class OrderSystem {
  /**
   * @param state   game state
   * @param islands island entities
   * @param opts.hostiles   () => array of hostile ships (enemy + pirates)
   * @param opts.isVisible  (x, z) => bool  (fog of war)
   */
  constructor(state, islands, opts = {}) {
    this._st = state;
    this._islands = islands;
    this._hostiles = opts.hostiles || (() => state.enemyShips);
    this._isVisible = opts.isVisible || (() => true);
    this._groups = new Set();
    this._nextGroup = 1;
    state.cmd = state.cmd || {};
    state.cmd.formation = state.cmd.formation || DEFAULT_FORMATION;
  }

  get groups() { return this._groups; }

  // ── Public API ────────────────────────────────────────────────
  /**
   * Issue an order to `ships`.
   *   spec: {type:'move'|'amove'|'patrol', x, z} | {type:'attack'|'siege', target} | {type:'hold'}
   *   opts.queue     — append (Shift) instead of replacing
   *   opts.formation — formation for group orders (default: state.cmd.formation)
   *   opts.kite      — engagement keeps further out (skirmisher automation)
   */
  issue(ships, spec, opts = {}) {
    ships = ships.filter(s => s.alive && s.team === 'player');
    if (!ships.length) return null;
    ships.forEach(s => this._ensure(s));
    if (!opts.queue) ships.forEach(s => this._clear(s));

    if (GROUP_KINDS.has(spec.type)) {
      const g = {
        id: this._nextGroup++, kind: spec.type,
        formation: opts.formation || this._st.cmd.formation,
        members: new Set(ships), dest: { x: spec.x, z: spec.z },
        started: false, arrived: false, arrivedT: 0, loop: spec.type === 'patrol',
        engaged: new Set(), slots: new Map(), path: [], idx: 0,
        ax: 0, az: 0, heading: 0, speed: 0, curSpeed: 0, turnRate: 1,
      };
      this._groups.add(g);
      ships.forEach(s => s.orders.push({ type: spec.type, group: g }));
      return g;
    }
    ships.forEach((s, i) => {
      if (spec.type === 'hold') s.orders.push({ type: 'hold' });
      else s.orders.push({ type: spec.type, target: spec.target, rank: i, kite: !!opts.kite });
    });
    return null;
  }

  stop(ships) { ships.forEach(s => { this._ensure(s); this._clear(s); }); }

  /** Re-form any group the given ships are marching in (formation hotkey). */
  setFormation(ships, formation) {
    const touched = new Set();
    ships.forEach(s => { const g = s.orders?.[0]?.group; if (g) touched.add(g); });
    touched.forEach(g => {
      g.formation = formation;
      if (g.started) this._layoutSlots(g, [...g.members].filter(s => s.orders[0]?.group === g));
    });
  }

  setStance(ships, stance) {
    if (!STANCES[stance]) return;
    ships.forEach(s => { s.stance = stance; if (!STANCES[stance].acquire) s._engage = null; });
  }

  onShipDestroyed(ship) {
    if (ship.team === 'player') this._clear(ship);
  }

  /** Short human-readable status for the HUD. */
  describe(ship) {
    if (!ship.alive) return 'Sunk';
    const eng = ship._engage?.target;
    const o = ship.orders?.[0];
    if (eng) return `Engaging ${eng.nm || 'enemy'}`;
    if (!o) return 'Idle';
    switch (o.type) {
      case 'move':   return o.group.started ? 'Sailing' : 'Waiting for fleet';
      case 'amove':  return 'Attack-move';
      case 'patrol': return 'Patrolling';
      case 'attack': return `Attacking ${o.target?.nm || 'ship'}`;
      case 'siege':  return (o.target?.down || o.target?.own === 'neutral') ? `Capturing ${o.target.nm}` : `Bombarding ${o.target?.nm}`;
      case 'hold':   return 'Holding position';
    }
    return 'Idle';
  }

  // ── Frame update ──────────────────────────────────────────────
  update(dt) {
    for (const g of this._groups) this._updateGroup(g, dt);
    for (const ship of this._st.playerShips) {
      if (!ship.alive) continue;
      this._ensure(ship);
      if (ship._gracePeriod) {
        ship._graceTimer -= dt;
        if (ship._graceTimer <= 0) ship._gracePeriod = false;
      }
      this._updateShip(ship, dt);
    }
  }

  // ── Internals: bookkeeping ────────────────────────────────────
  _ensure(ship) {
    if (!ship.orders) ship.orders = [];
    if (!ship.stance) ship.stance = DEFAULT_STANCE;
  }

  _clear(ship) {
    (ship.orders || []).forEach(o => { if (o.group) o.group.members.delete(ship); });
    ship.orders = [];
    ship._engage = null;
    ship._nav = null;
    ship.focusTarget = null;
    ship._post = null;
  }

  _pop(ship) {
    const o = ship.orders.shift();
    if (o?.group) { o.group.members.delete(ship); o.group.engaged.delete(ship); }
    ship._nav = null;
    ship._engage = null;
    if (!ship.orders.length) ship._post = { x: ship.x, z: ship.z };
  }

  _orderDone(ship, o) {
    if (o.type === 'attack') return !o.target?.alive || o.target.team === 'player';
    if (o.type === 'siege')  return !o.target || o.target.own === 'player';
    return false;
  }

  // ── Internals: per ship ───────────────────────────────────────
  _updateShip(ship, dt) {
    ship.focusTarget = null;
    let o = ship.orders[0];
    if (o && this._orderDone(ship, o)) { this._pop(ship); o = ship.orders[0]; }
    if (!o) { this._idle(ship, dt); return; }
    switch (o.type) {
      case 'move': case 'amove': case 'patrol': this._followGroup(ship, o.group, dt); break;
      case 'attack': ship.focusTarget = o.target; this._engageSteer(ship, o.target, dt, o); break;
      case 'siege':  this._siege(ship, o, dt); break;
      case 'hold':   holdStill(ship, dt, this._islands); break;
    }
  }

  _idle(ship, dt) {
    if (!ship._post) ship._post = { x: ship.x, z: ship.z };
    const st = STANCES[ship.stance] || STANCES[DEFAULT_STANCE];
    if (st.acquire) {
      let tgt = this._keepOrAcquire(ship, ship._post);
      if (!tgt) tgt = this._assist(ship, this._st.playerShips.filter(m => m.fleetId === ship.fleetId), ship._post);
      if (tgt) { ship.focusTarget = tgt; this._engageSteer(ship, tgt, dt, {}); return; }
      const dPost = Math.hypot(ship.x - ship._post.x, ship.z - ship._post.z);
      if (dPost > 3) { this._navTo(ship, ship._post.x, ship._post.z, dt, true); return; }
    }
    holdStill(ship, dt, this._islands);
  }

  /** Validate the current auto-engagement or pick the nearest visible hostile. */
  _keepOrAcquire(ship, post) {
    const R = Math.max(gunProfile(ship).range + TUNE.acquireBonus, TUNE.acquireMin);
    const cur = ship._engage?.target;
    if (cur && cur.alive && this._isVisible(cur.x, cur.z)
        && Math.hypot(ship.x - post.x, ship.z - post.z) < TUNE.leash
        && Math.hypot(cur.x - ship.x, cur.z - ship.z) < R * 1.6) return cur;
    ship._engage = null;
    if (Math.hypot(ship.x - post.x, ship.z - post.z) > TUNE.leash * 0.8) return null;
    let best = null, bd = R * R;
    for (const h of this._hostiles()) {
      if (!h.alive || !this._isVisible(h.x, h.z)) continue;
      const d = (h.x - ship.x) ** 2 + (h.z - ship.z) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    if (best) ship._engage = { target: best };
    return best;
  }

  /** Take on the target of a fighting squadmate (within leash of our post). */
  _assist(ship, mates, post) {
    if (Math.hypot(ship.x - post.x, ship.z - post.z) > TUNE.leash * 0.8) return null;
    for (const m of mates) {
      const t = m !== ship && m.alive ? m._engage?.target : null;
      if (t?.alive && this._isVisible(t.x, t.z) && Math.hypot(t.x - ship.x, t.z - ship.z) < TUNE.leash * 1.5) {
        ship._engage = { target: t };
        return t;
      }
    }
    return null;
  }

  _siege(ship, o, dt) {
    const isl = o.target;
    const capturable = isl.own === 'neutral' || isl.down;
    if (capturable) {
      // Hold station inside the capture radius; answer a neutral fort's fire.
      if (!isl.down) ship.focusTarget = isl;
      const R = isl.r + TUNE.captureOrbit;
      const d = Math.hypot(ship.x - isl.x, ship.z - isl.z);
      if (d > R + TUNE.approachSlack) { this._navTo(ship, isl.x, isl.z, dt, false); return; }
      this._orbit(ship, isl.x, isl.z, R + (o.rank % 3) * 1.5, this._sideFor(ship, isl), dt, 0.45);
      return;
    }
    ship.focusTarget = isl;
    this._engageSteer(ship, isl, dt, o);
  }

  // ── Internals: group march ────────────────────────────────────
  _followGroup(ship, g, dt) {
    if (!g.started) { holdStill(ship, dt, this._islands); return; }

    // Attack-move / patrol: break formation to fight, rejoin afterwards
    if (ENGAGING_KINDS.has(g.kind) && (STANCES[ship.stance] || {}).fire !== false) {
      const post = slotToWorld(g.ax, g.az, g.heading, g.slots.get(ship) || { x: 0, z: 0 });
      let tgt = this._keepOrAcquire(ship, post);
      if (!tgt) tgt = this._assist(ship, g.engaged, post);   // join a squadmate's fight
      if (tgt) { g.engaged.add(ship); ship.focusTarget = tgt; this._engageSteer(ship, tgt, dt, {}); return; }
      g.engaged.delete(ship);
    }

    const slot = g.slots.get(ship) || { x: 0, z: 0 };
    const P = slotToWorld(g.ax, g.az, g.heading, slot);
    const ex = P.x - ship.x, ez = P.z - ship.z;
    const d = Math.hypot(ex, ez);

    if (g.arrived) {
      const left = steerTo(ship, P.x, P.z, dt, this._islands, { arrive: true });
      if (left < TUNE.arriveDist && ship.speed < 0.03) this._pop(ship);
      return;
    }
    if (d > 10) {                               // far off station: catch up at full sail
      this._navTo(ship, P.x, P.z, dt, false);
      return;
    }
    if (g.curSpeed < 0.01) {                    // anchor gathering: park in slot
      steerTo(ship, P.x, P.z, dt, this._islands, { arrive: true });
      return;
    }
    const fx = Math.sin(g.heading), fz = Math.cos(g.heading);
    const along = ex * fx + ez * fz;           // + = slot ahead of us (we lag)
    const lateral = Math.abs(ex * fz - ez * fx);
    const want = g.curSpeed + clamp(along * 0.04, -g.curSpeed * 0.9, ship.maxSpeed) + lateral * 0.015;
    steerTo(ship, P.x + fx * 6, P.z + fz * 6, dt, this._islands, { arrive: false, speed: Math.max(0, want) });
  }

  _layoutSlots(g, ships) {
    const slots = formationSlots(g.formation, ships.length);
    g.slots = assignSlots(ships, slots, g.ax, g.az, g.heading);
    g.halfWidth = formationHalfWidth(slots);
  }

  _startGroup(g, active) {
    const cx = active.reduce((a, s) => a + s.x, 0) / active.length;
    const cz = active.reduce((a, s) => a + s.z, 0) / active.length;
    const slots = formationSlots(g.formation, active.length);
    const clear = TUNE.shoreClearance + Math.min(formationHalfWidth(slots), 8);
    if (g.loop) {
      const there = planPath(cx, cz, g.dest.x, g.dest.z, this._islands, clear);
      const end = there[there.length - 1];
      const back = planPath(end.x, end.z, cx, cz, this._islands, clear);
      g.path = [...there, ...back];
    } else {
      g.path = planPath(cx, cz, g.dest.x, g.dest.z, this._islands, clear);
    }
    g.ax = cx; g.az = cz; g.idx = 0;
    g.heading = Math.atan2(g.path[0].x - cx, g.path[0].z - cz);
    this._layoutSlots(g, active);
    g.turnRate = Math.min(...active.map(s => handlingOf(s).turnRate)) * 0.8;
    g.started = true;
  }

  _updateGroup(g, dt) {
    for (const s of g.members) {
      if (!s.alive || !s.orders?.some(o => o.group === g)) { g.members.delete(s); g.engaged.delete(s); }
    }
    if (!g.members.size) { this._groups.delete(g); return; }
    const active = [...g.members].filter(s => s.orders[0]?.group === g);
    if (!g.started) {
      if (active.length < g.members.size) return;   // wait for ships still on earlier orders
      this._startGroup(g, active);
    }
    if (!active.length) return;
    if (g.arrived) {
      g.arrivedT += dt;
      if (g.arrivedT > 15) active.forEach(s => this._pop(s));  // never wait forever on a stuck ship
      return;
    }

    // Group speed: slowest member (status effects included), 10 % headroom to catch up
    g.speed = Math.min(...active.map(s => StatusEffects.effectiveSpeed(s))) * 0.9;

    // Regroup: slow the anchor while ships are out of station; stop while fighting
    let err = 0;
    for (const s of active) {
      if (g.engaged.has(s)) continue;
      const P = slotToWorld(g.ax, g.az, g.heading, g.slots.get(s) || { x: 0, z: 0 });
      err += Math.hypot(P.x - s.x, P.z - s.z);
    }
    err /= Math.max(1, active.length - g.engaged.size);
    let factor = clamp(1 - (err - TUNE.gatherDist) / 10, 0, 1);
    if (g.engaged.size) factor = 0;

    const wp = g.path[g.idx];
    const dx = wp.x - g.ax, dz = wp.z - g.az;
    const toWp = Math.hypot(dx, dz);
    if (toWp > 0.5) {
      const diff = wrapAngle(Math.atan2(dx, dz) - g.heading);
      g.heading += clamp(diff, -g.turnRate * dt, g.turnRate * dt);
      if (Math.abs(diff) > 1.0) factor *= 0.35;    // fleet wheeling: ease off
    }
    g.curSpeed = g.speed * factor;
    const step = g.curSpeed * 60 * dt;
    if (step >= toWp) {
      g.ax = wp.x; g.az = wp.z; g.idx++;
      if (g.idx >= g.path.length) {
        if (g.loop) g.idx = 0;
        else { g.arrived = true; g.curSpeed = 0; }
      }
    } else if (toWp > 0) {
      g.ax += dx / toWp * step; g.az += dz / toWp * step;
    }
  }

  // ── Internals: steering behaviours ────────────────────────────
  /** Engage a ship or island: path in from afar, then broadside orbit. */
  _engageSteer(ship, tgt, dt, o) {
    const prof = gunProfile(ship);
    const frac = o.kite ? TUNE.kiteFrac : TUNE.broadsideFrac;
    let R;
    if (isIsland(tgt)) {
      // QA-001: gun range and accuracy are measured to the island CENTRE, so a
      // gun-range ring (or r + path clearance) parked big forts at the very
      // edge of range (≈ 28 % accuracy) where fort regen out-healed the fleet.
      // Bombard from just off the shore instead, a little apart per ship.
      R = tgt.r + (TUNE.siegeShore ?? 2) + ((o.rank || 0) % 3) * 0.8;
    } else {
      R = Math.max(prof.sideRange * frac, 3.5);
      // spread several attackers into rings — but never past ~92 % of gun range
      const room = Math.max(0, prof.sideRange * 0.92 - R);
      R += ((o.rank || 0) % 3) * Math.min(2.5, room / 2);
    }
    const d = Math.hypot(ship.x - tgt.x, ship.z - tgt.z);
    if (d > R + TUNE.approachSlack) { this._navTo(ship, tgt.x, tgt.z, dt, false); return; }
    this._orbit(ship, tgt.x, tgt.z, R, this._sideFor(ship, tgt), dt, 1);
  }

  /** Which broadside to present: the stronger one, else whichever faces it now. */
  _sideFor(ship, tgt) {
    if (ship._engSideTgt === tgt && ship._engSide) return ship._engSide;
    let side = gunProfile(ship).side;
    if (!side) {
      const rel = wrapAngle(Math.atan2(tgt.x - ship.x, tgt.z - ship.z) - ship.angle);
      side = rel >= 0 ? 'starboard' : 'port';
    }
    ship._engSide = side; ship._engSideTgt = tgt;
    return side;
  }

  /** Circle (cx,cz) at radius R keeping the centre on `side`. */
  _orbit(ship, cx, cz, R, side, dt, speedFrac) {
    const dx = cx - ship.x, dz = cz - ship.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const ux = dx / d, uz = dz / d;                           // toward the centre
    let hx, hz;
    if (side === 'port') { hx = uz; hz = -ux; } else { hx = -uz; hz = ux; }
    const e = clamp((d - R) / Math.max(4, R * 0.5), -1, 1);   // + = too far out
    let vx = hx + ux * e * 1.3, vz = hz + uz * e * 1.3;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl; vz /= vl;
    steerTo(ship, ship.x + vx * 10, ship.z + vz * 10, dt, this._islands,
      { arrive: false, speed: ship.maxSpeed * speedFrac });
  }

  /** Follow a planned path to (x,z); replans when the goal moves or every 3 s. */
  _navTo(ship, x, z, dt, arrive) {
    let nav = ship._nav;
    if (!nav || Math.hypot(nav.gx - x, nav.gz - z) > 6 || nav.t > 3) {
      nav = ship._nav = { gx: x, gz: z, t: 0, idx: 0,
        path: planPath(ship.x, ship.z, x, z, this._islands, TUNE.shoreClearance) };
    }
    nav.t += dt;
    let wp = nav.path[nav.idx];
    while (nav.idx < nav.path.length - 1 && Math.hypot(wp.x - ship.x, wp.z - ship.z) < 4) wp = nav.path[++nav.idx];
    const last = nav.idx === nav.path.length - 1;
    // Final leg tracks the live goal (moving targets), kept off the shore
    if (last) wp = pushOutside(x, z, this._islands, TUNE.shoreClearance);
    return steerTo(ship, wp.x, wp.z, dt, this._islands, { arrive: last && arrive });
  }
}
