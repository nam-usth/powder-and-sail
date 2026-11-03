// ── MISSION SYSTEM — Sea Battle objectives (design/gdd/sea-battle.md) ──
// Decides victory/defeat for a mission, spawns scripted waves, tracks
// plunder sources. Pure game logic: talks to the world only through the
// injected `spawnEnemy(spec)` and the state object.

/**
 * @param {object} state    game state (playerShips, enemyShips)
 * @param {object[]} islands IslandEntity list
 * @param {object} mission  data/campaign.js mission
 * @param {object} bus      event bus
 * @param {(spec:object)=>object} spawnEnemy creates + registers an enemy ship
 */
export class MissionSystem {
  constructor(state, islands, mission, bus, spawnEnemy) {
    this.state = state;
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

  /** Advance; returns the outcome once decided (then stays fixed). */
  update(dt) {
    if (this.outcome) return this.outcome;
    this.time += dt;
    const st = this.state;
    for (const w of this._waves) {
      if (!w.done && this.time >= w.at) { w.done = true; w.ships.forEach((s, i) => this.spawnEnemy(s, i)); }
    }
    const playerAlive = st.playerShips.some(s => s.alive);
    const enemyAlive  = st.enemyShips.some(s => s.alive);
    const o = this.obj;
    let won = false;
    if (o.type === 'sink_all')      won = !enemyAlive && !this.wavesPending();
    if (o.type === 'destroy_forts') won = this.enemyFortIds.length > 0 && this.fortsDestroyed() === this.enemyFortIds.length;
    if (o.type === 'survive')       won = playerAlive && this.time >= o.seconds;
    if (o.type === 'capture')       won = (o.islands || []).every(id => this.islands.find(i => i.def.id === id)?.own === 'player');

    if (won) this.outcome = { won: true, reason: 'objective' };
    else if (!playerAlive) this.outcome = { won: false, reason: 'fleet_lost' };
    else if (this.mission.timeLimit && this.time >= this.mission.timeLimit) this.outcome = { won: false, reason: 'time' };
    return this.outcome;
  }

  /** Progress lines for the objective HUD: [{label, value, done}] */
  progress() {
    const st = this.state, o = this.obj;
    const enemyAlive = st.enemyShips.filter(s => s.alive).length;
    switch (o.type) {
      case 'sink_all': return [{ key: 'sink', value: `${this.sunk.length} / ${this.sunk.length + enemyAlive}${this.wavesPending() ? '+' : ''}`, done: !enemyAlive && !this.wavesPending() }];
      case 'destroy_forts': return [{ key: 'forts', value: `${this.fortsDestroyed()} / ${this.enemyFortIds.length}`, done: this.fortsDestroyed() === this.enemyFortIds.length }];
      case 'survive': return [{ key: 'survive', value: fmt(Math.max(0, o.seconds - this.time)), done: this.time >= o.seconds }];
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
