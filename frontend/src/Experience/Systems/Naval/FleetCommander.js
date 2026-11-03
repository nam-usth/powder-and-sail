// ── FLEET COMMANDER ──────────────────────────────────────────────
// AU: fleets are the player's CONTROL GROUPS. Fleet N answers to key N
// (Ctrl+N assigns the selection, Shift+N adds to it). Every player ship
// belongs to exactly one fleet; dead ships keep their fleet for revival.
//
// Each fleet: { id, num, name, color, role }
//
// Movement no longer lives here — OrderSystem drives every ship. A fleet's
// role is optional AUTOMATION that issues orders on the player's behalf
// (re-evaluated once per second, re-issued only when the decision changes):
//   manual     — no automation; ships only follow player orders
//   escort     — attack the nearest enemy ship, else return home
//   skirmisher — like escort but engages from the edge of gun range
//   support    — stay inside the home repair aura
//   raider     — siege the nearest capturable island
//   patrol     — patrol a loop off the home island, engaging on the way
// Any explicit player order to a fleet's ships switches it back to manual.

import { FLEET_MAX_SHIPS } from '../../../data/constants.js';

export const ROLES = ['manual','escort','skirmisher','support','raider','patrol'];
export const ROLE_LABELS = {
  manual:    '🏴 Manual',
  escort:    '⚔ Escort',
  skirmisher:'🏹 Skirmish',
  support:   '🔧 Support',
  raider:    '🚀 Raider',
  patrol:    '🧭 Patrol',
};

export const MAX_FLEETS = 9;

// Distinct flag colors, indexed by fleet number - 1
const FLEET_COLORS = [
  '#e8b840',  // brass
  '#60c8c0',  // teal
  '#cc6688',  // rose
  '#9c80d6',  // violet
  '#6b9c4a',  // moss
  '#d49060',  // copper
  '#5c9ce0',  // sky
  '#d0d060',  // straw
  '#b0b0b0',  // pewter
];

const AUTO_TICK = 1.0;

export class FleetCommander {
  constructor(state, islands, orders){
    this._state   = state;
    this._islands = islands;
    this._orders  = orders;          // OrderSystem
    this._autoT   = 0;
    this._initFleets();
  }

  _initFleets(){
    const st = this._state;
    st.fleets = [];
    st._nextFleetId = 1;
    if(!st.playerShips.length) return;

    let cur = this._createFleet();
    st.playerShips.forEach(ship => {
      if(this._countInFleet(cur.id) >= FLEET_MAX_SHIPS) cur = this._createFleet();
      ship.fleetId = cur.id;
    });
    st.selectedFleetId = st.fleets[0].id;
  }

  _createFleet(num){
    const st = this._state;
    const used = new Set(st.fleets.map(f => f.num));
    if(num == null){ num = 1; while(used.has(num)) num++; }
    if(num > MAX_FLEETS || used.has(num)) return null;
    const fleet = {
      id: 'F' + (st._nextFleetId++),
      num,
      name: `Fleet ${num}`,
      color: FLEET_COLORS[(num - 1) % FLEET_COLORS.length],
      role: 'manual',
      _auto: null,
    };
    st.fleets.push(fleet);
    st.fleets.sort((a, b) => a.num - b.num);
    return fleet;
  }

  createFleet(){ return this._createFleet(); }

  getFleet(id){
    return this._state.fleets.find(f => f.id === (id || this._state.selectedFleetId));
  }

  getFleetByNum(num){ return this._state.fleets.find(f => f.num === num); }

  shipsOf(fleetId){
    return this._state.playerShips.filter(s => s.fleetId === fleetId && s.alive);
  }

  _countInFleet(fleetId){
    return this._state.playerShips.filter(s => s.fleetId === fleetId && s.alive).length;
  }

  findFleetWithRoom(){
    const st = this._state;
    const sel = this.getFleet(st.selectedFleetId);
    if(sel && this._countInFleet(sel.id) < FLEET_MAX_SHIPS) return sel;
    for(const f of st.fleets){
      if(this._countInFleet(f.id) < FLEET_MAX_SHIPS) return f;
    }
    return this._createFleet() || st.fleets[st.fleets.length - 1];
  }

  totalAlive(){ return this._state.playerShips.filter(s => s.alive).length; }

  selectFleet(id){
    if(!this._state.fleets.find(f => f.id === id)) return;
    this._state.selectedFleetId = id;
  }

  /**
   * Put `ships` into fleet `num` (creating it). `add` keeps the fleet's
   * current members (Shift+N); otherwise the fleet becomes exactly `ships`
   * (Ctrl+N) and its previous members move to other fleets with room.
   * Returns { ok, fleet, reason }.
   */
  assign(num, ships, add = false){
    const st = this._state;
    ships = ships.filter(s => s.team === 'player');
    if(!ships.length) return { ok: false, reason: 'No ships selected' };
    let fleet = this.getFleetByNum(num);
    const keep = fleet && add ? this.shipsOf(fleet.id).filter(s => !ships.includes(s)) : [];
    if(keep.length + ships.length > FLEET_MAX_SHIPS)
      return { ok: false, reason: `A fleet holds at most ${FLEET_MAX_SHIPS} ships` };
    if(!fleet) fleet = this._createFleet(num);
    if(!fleet) return { ok: false, reason: 'No free fleet slot' };

    const vacated = new Set(ships.map(s => s.fleetId));
    if(!add){
      // previous living members not in the new set find another home
      this.shipsOf(fleet.id).filter(s => !ships.includes(s)).forEach(s => {
        s.fleetId = null;
        const home = st.fleets.find(f => f !== fleet && this._countInFleet(f.id) < FLEET_MAX_SHIPS)
                  || this._createFleet();
        s.fleetId = home ? home.id : fleet.id;
      });
    }
    ships.forEach(s => { s.fleetId = fleet.id; });
    vacated.delete(fleet.id);
    vacated.forEach(fid => this._dropIfEmpty(fid));
    st.selectedFleetId = fleet.id;
    return { ok: true, fleet };
  }

  /** Move one ship to another fleet (HUD dropdown). */
  moveShip(ship, fleetId){
    const tgt = fleetId === '__new__' ? this._createFleet() : this.getFleet(fleetId);
    if(!tgt) return { ok: false, reason: 'Fleet not found' };
    if(this._countInFleet(tgt.id) >= FLEET_MAX_SHIPS) return { ok: false, reason: `${tgt.name} is full` };
    const old = ship.fleetId;
    ship.fleetId = tgt.id;
    this._dropIfEmpty(old);
    return { ok: true, fleet: tgt };
  }

  /** A fleet with no ships at all (alive or awaiting revival) is removed. */
  _dropIfEmpty(fleetId){
    const st = this._state;
    if(st.fleets.length <= 1) return;
    if(st.playerShips.some(s => s.fleetId === fleetId)) return;
    st.fleets = st.fleets.filter(f => f.id !== fleetId);
    if(st.selectedFleetId === fleetId) st.selectedFleetId = st.fleets[0]?.id || null;
  }

  setRole(fleetId, role){
    const f = this.getFleet(fleetId);
    if(!f || !ROLES.includes(role)) return;
    f.role = role;
    f._auto = null;
    if(role !== 'manual') this._autoT = AUTO_TICK;   // act on the next frame
  }

  /** Player gave explicit orders: fleets of those ships stop automating. */
  releaseAutomation(ships){
    const ids = new Set(ships.map(s => s.fleetId));
    this._state.fleets.forEach(f => { if(ids.has(f.id) && f.role !== 'manual'){ f.role = 'manual'; f._auto = null; } });
  }

  disbandFleet(id){
    const st = this._state;
    const idx = st.fleets.findIndex(f => f.id === id);
    if(idx < 0 || st.fleets.length <= 1) return false;
    const crew = st.playerShips.filter(s => s.fleetId === id);
    st.fleets.splice(idx, 1);
    crew.forEach(s => { s.fleetId = null; s.fleetId = this.findFleetWithRoom().id; });
    if(st.selectedFleetId === id) st.selectedFleetId = st.fleets[0]?.id || null;
    return true;
  }

  // ── AUTOMATION ───────────────────────────────────────────────
  update(dt){
    this._autoT += dt;
    if(this._autoT < AUTO_TICK) return;
    this._autoT = 0;
    for(const fleet of this._state.fleets){
      if(fleet.role === 'manual') continue;
      const ships = this.shipsOf(fleet.id);
      if(!ships.length) continue;
      const decision = this._decide(fleet, ships);
      if(!decision) continue;
      // re-issue only when the decision changed (or the ships went idle)
      const idle = ships.some(s => !s.orders?.length);
      if(!idle && fleet._auto && fleet._auto.key === decision.key) continue;
      fleet._auto = decision;
      this._orders.issue(ships, decision.spec, decision.opts || {});
    }
  }

  _home(){ return this._islands.find(i => i.own === 'player'); }

  _centroid(ships){
    return {
      x: ships.reduce((a, s) => a + s.x, 0) / ships.length,
      z: ships.reduce((a, s) => a + s.z, 0) / ships.length,
    };
  }

  _nearestEnemy(c){
    let best = null, bd = Infinity;
    for(const e of this._state.enemyShips){
      if(!e.alive) continue;
      const d = Math.hypot(e.x - c.x, e.z - c.z);
      if(d < bd){ bd = d; best = e; }
    }
    return best;
  }

  _goHome(home, c){
    if(!home) return null;
    const x = home.x + home.r + 12, z = home.z;
    // already there: ride at anchor instead of re-issuing the same move
    if(Math.hypot(c.x - x, c.z - z) < 14) return { key: 'home-hold', spec: { type: 'hold' } };
    return { key: 'home', spec: { type: 'move', x, z } };
  }

  _decide(fleet, ships){
    const c = this._centroid(ships);
    const home = this._home();
    switch(fleet.role){
      case 'escort':
      case 'skirmisher': {
        const e = this._nearestEnemy(c);
        if(!e) return this._goHome(home, c);
        return { key: 'atk:' + e.nm + ':' + e.rank, spec: { type: 'attack', target: e },
                 opts: { kite: fleet.role === 'skirmisher' } };
      }
      case 'support': {
        if(!home) return null;
        const auraR = this._state.getAuraRange();
        if(Math.hypot(c.x - home.x, c.z - home.z) <= auraR * 0.8) return { key: 'support-hold', spec: { type: 'hold' } };
        return { key: 'support-home', spec: { type: 'move', x: home.x + home.r + 6, z: home.z } };
      }
      case 'raider': {
        const targets = this._islands.filter(i => i.own !== 'player' && (i.down || i.own === 'neutral'));
        if(!targets.length) return this._goHome(home, c);
        let best = null, bd = Infinity;
        targets.forEach(i => { const d = Math.hypot(i.x - c.x, i.z - c.z); if(d < bd){ bd = d; best = i; } });
        return { key: 'raid:' + best.def.id, spec: { type: 'siege', target: best } };
      }
      case 'patrol': {
        if(!home) return null;
        const r = home.r + 22;
        return { key: 'patrol', spec: { type: 'patrol', x: home.x + r, z: home.z + r * 0.6 } };
      }
    }
    return null;
  }
}
