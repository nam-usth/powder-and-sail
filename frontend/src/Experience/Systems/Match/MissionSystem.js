// ── MISSION SYSTEM — Sea Battle objectives (design/gdd/sea-battle.md) ──
// Decides victory/defeat for a mission, spawns scripted waves, tracks
// plunder sources. Pure game logic: talks to the world only through the
// injected `spawnEnemy(spec)` and the state object.
//
// AW mission variety (data/campaign.js):
//   objective 'sink_target' — sink the ships marked `prize:true` before they
//     reach mission.escape (defeat reason 'escaped'). Other enemies are optional.
//   mission.escape {x,z,r?,route?} — where prizes / `fleeHp` runners sail; an
//     enemy that reaches it leaves the battle (no plunder; `escaped` list).
//   mission.timeLimit — defeat when the clock runs out (reason 'time'); shown
//     as a 'time' progress line.
//   mission.ai / EnemySpec.ai — per-ship tactics, see enemyAi() + EnemyAI.

/** EN fallbacks for HUD lines whose i18n key may be missing (T.objLabels / T.objTypes). */
export const OBJ_TEXT = {
  labels: { sink: 'Enemy ships sunk', forts: 'Forts destroyed', survive: 'Hold out', capture: 'Islands taken',
    prize: 'Prize sunk', prizeHp: 'Prize hull', escape: 'Prize to safety', time: 'Time left', escaped: 'Escaped' },
  types: { sink_all: 'Sink every enemy ship', destroy_forts: 'Destroy the enemy forts', survive: 'Keep a ship afloat',
    capture: 'Capture the island', sink_target: 'Sink the prize before it escapes' },
};

/**
 * Per-ship battle behaviour for an enemy spec (EnemyAI reads ship.ai).
 * Mission defaults (mission.ai.tactic/leash/fleeHp/kiteFrac, mission.ai.byHull[hull])
 * are overlaid by EnemySpec.ai and EnemySpec.prize. Returns undefined when
 * nothing special applies (the ship sails with the wolfpack, as before).
 */
export function enemyAi(spec, mission) {
  const M = mission?.ai || {};
  const base = {};
  for (const k of ['tactic', 'leash', 'fleeHp', 'kiteFrac']) if (M[k] != null) base[k] = M[k];
  const ai = { ...base, ...(M.byHull?.[spec.hull] || {}), ...(spec.ai || {}) };
  if (spec.prize) { ai.prize = true; if (ai.spdMult == null && spec.spdMult != null) ai.spdMult = spec.spdMult; }
  if (!Object.keys(ai).length || (Object.keys(ai).length === 1 && ai.tactic === 'engage')) return undefined;
  ai.post = { x: spec.x ?? 80, z: spec.z ?? 0 };
  return ai;
}

/** Normalised escape zone {x,z,r,route} of a mission, or null. */
export function escapeZone(mission, defaultR = 8) {
  const e = mission?.escape;
  if (!e) return null;
  const route = e.route?.length ? e.route : [{ x: e.x, z: e.z }];
  const last = route[route.length - 1];
  return { x: e.x ?? last.x, z: e.z ?? last.z, r: e.r || defaultR, route };
}

/**
 * @param {object} state    game state (playerShips, enemyShips)
 * @param {object[]} islands IslandEntity list
 * @param {object} mission  data/campaign.js mission
 * @param {object} bus      event bus
 * @param {(spec:object)=>object} spawnEnemy creates + registers an enemy ship
 */
export class MissionSystem {
  constructor(state, islands, mission, bus, spawnEnemy, opts = {}) {
    this.state = state;
    this.bus = bus;
    this.escape = escapeZone(mission, opts.escapeR);
    this.escaped = [];                // enemy ships that got away (no plunder)
    this.islands = islands;
    this.mission = mission;
    this.obj = mission.objective || { type: 'sink_all' };
    this.spawnEnemy = spawnEnemy;
    this.time = 0;
    this.outcome = null;              // { won, reason }
    this.sunk = [];                   // enemy hull classes sunk
    this._seen = new Set();
    this._waves = (this.obj.waves || []).map(w => ({ ...w, done: false }));
    this.enemyFortIds = islands.filter(i => i.own === 'enemy' && !i.def.decor).map(i => i.def.id);
    this._unsub = bus.on('ship:destroyed', ({ ship }) => {
      if (ship.team !== 'enemy' || this._seen.has(ship)) return;
      this._seen.add(ship);
      this.sunk.push(ship.hull);
    });
  }

  /** Enemy forts brought down (or since captured). */
  fortsDestroyed() {
    return this.enemyFortIds.filter(id => {
      const i = this.islands.find(x => x.def.id === id);
      return i && (i.down || i.own === 'player');
    }).length;
  }

  wavesPending() { return this._waves.some(w => !w.done); }

  /** Prize ships (ship.ai.prize) that have appeared so far. */
  prizes() { return this.state.enemyShips.filter(s => s.ai?.prize); }

  /** Sea miles (world units) a ship still has to sail along the escape route. */
  routeLeft(s) {
    const e = this.escape;
    if (!e) return Infinity;
    const r = e.route, k = s.ai?._route === r ? Math.min(s.ai._wp || 0, r.length - 1) : 0;
    let d = Math.hypot(r[k].x - s.x, r[k].z - s.z);
    for (let i = k + 1; i < r.length; i++) d += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
    return d;
  }

  /** Enemies inside the escape zone leave the battle (alive=false, no 'ship:destroyed'). */
  _tickEscape() {
    const e = this.escape;
    if (!e) return;
    for (const s of this.state.enemyShips) {
      if (!s.alive || !s.ai?.escaping) continue;
      if ((s.x - e.x) ** 2 + (s.z - e.z) ** 2 > e.r * e.r) continue;
      s.alive = false; s.escaped = true;
      this.escaped.push(s);
      this.bus?.emit?.('ship:removed', { ship: s });
      this.bus?.emit?.('ship:escaped', { ship: s });
    }
  }

  /** Advance; returns the outcome once decided (then stays fixed). */
  update(dt) {
    if (this.outcome) return this.outcome;
    this.time += dt;
    const st = this.state;
    for (const w of this._waves) {
      if (!w.done && this.time >= w.at) { w.done = true; w.ships.forEach((s, i) => this.spawnEnemy(s, i)); }
    }
    this._tickEscape();
    const playerAlive = st.playerShips.some(s => s.alive);
    const enemyAlive  = st.enemyShips.some(s => s.alive);
    const o = this.obj;
    let won = false;
    if (o.type === 'sink_target') {
      const pz = this.prizes();
      if (pz.some(s => s.escaped)) { this.outcome = { won: false, reason: 'escaped' }; return this.outcome; }
      won = pz.length > 0 && pz.every(s => !s.alive) && !this.wavesPending();
    }
    if (o.type === 'sink_all')      won = !enemyAlive && !this.wavesPending();
    if (o.type === 'destroy_forts') won = this.enemyFortIds.length > 0 && this.fortsDestroyed() === this.enemyFortIds.length;
    if (o.type === 'survive')       won = playerAlive && this.time >= o.seconds;
    if (o.type === 'capture')       won = (o.islands || []).every(id => this.islands.find(i => i.def.id === id)?.own === 'player');

    if (won) this.outcome = { won: true, reason: 'objective' };
    else if (!playerAlive) this.outcome = { won: false, reason: 'fleet_lost' };
    else if (this.mission.timeLimit && this.time >= this.mission.timeLimit) this.outcome = { won: false, reason: 'time' };
    return this.outcome;
  }

  /** Progress lines for the objective HUD: [{key, label, value, done}] (+ time left / escaped when relevant). */
  progress() {
    const lines = this._objProgress().map(l => ({ label: OBJ_TEXT.labels[l.key], ...l }));
    if (this.mission.timeLimit) {
      lines.push({ key: 'time', label: OBJ_TEXT.labels.time, value: fmt(Math.max(0, this.mission.timeLimit - this.time)), done: false });
    }
    if (this.escaped.length && this.obj.type !== 'sink_target') {
      lines.push({ key: 'escaped', label: OBJ_TEXT.labels.escaped, value: String(this.escaped.length), done: false });
    }
    return lines;
  }

  _objProgress() {
    const st = this.state, o = this.obj;
    const enemyAlive = st.enemyShips.filter(s => s.alive).length;
    switch (o.type) {
      case 'sink_all': return [{ key: 'sink', value: `${this.sunk.length} / ${this.sunk.length + enemyAlive}${this.wavesPending() ? '+' : ''}`, done: !enemyAlive && !this.wavesPending() }];
      case 'destroy_forts': return [{ key: 'forts', value: `${this.fortsDestroyed()} / ${this.enemyFortIds.length}`, done: this.fortsDestroyed() === this.enemyFortIds.length }];
      case 'survive': return [{ key: 'survive', value: fmt(Math.max(0, o.seconds - this.time)), done: this.time >= o.seconds }];
      case 'sink_target': {
        const pz = this.prizes();
        const down = pz.filter(s => !s.alive && !s.escaped).length;
        const out = [{ key: 'prize', label: OBJ_TEXT.labels.prize, value: `${down} / ${pz.length}`, done: pz.length > 0 && down === pz.length }];
        const live = pz.filter(s => s.alive);
        if (live.length) {
          const hp = live.reduce((a, s) => a + s.hp, 0) / live.reduce((a, s) => a + s.maxHp, 0);
          out.push({ key: 'prizeHp', label: OBJ_TEXT.labels.prizeHp, value: `${Math.round(hp * 100)}%`, done: false });
          if (this.escape) {
            const d = Math.min(...live.map(s => this.routeLeft(s)));
            out.push({ key: 'escape', label: OBJ_TEXT.labels.escape, value: `${Math.max(0, Math.round(d - this.escape.r))} u`, done: false });
          }
        }
        return out;
      }
      case 'capture': {
        const own = (o.islands || []).filter(id => this.islands.find(i => i.def.id === id)?.own === 'player').length;
        return [{ key: 'capture', value: `${own} / ${(o.islands || []).length}`, done: own === (o.islands || []).length }];
      }
      default: return [];
    }
  }

  dispose() { this._unsub?.(); }
}

export function fmt(sec) {
  sec = Math.ceil(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
