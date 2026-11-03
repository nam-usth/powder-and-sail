// ── WarFront.js (AS) ────────────────────────────────────────────
// The tug-of-war heartbeat (Age of War-style).
//
// A single value `state.warFront` in [0,100], 50 = stalemate. The player
// pushes toward 100 (Enemy Citadel falls = victory); the enemy pushes
// toward 0 (Home Port falls = defeat). This UNIFIES every action — naval
// kills, island captures, economy — into one always-visible objective,
// replacing the old three disjoint win conditions.
//
// Two force types:
//   • CONTINUOUS pressure (ticked at 2 Hz): net momentum from standing
//     advantages (islands held, ships alive, economy edge) nudges the
//     front each tick. Whoever is "ahead" slowly gains ground.
//   • IMPULSES (event-driven): discrete shoves on capture / sink / fort
//     loss — the satisfying "we broke through" moments of Age of War.
//
// Win/lose fire once when the bar hits an end. Flagship kill is a big
// impulse (+35), not an instant win, so it's a decisive blow rather than
// a sudden stop — keeping the tug-of-war feel to the very end.

const TICK = 0.5;            // seconds between continuous-pressure updates

// Continuous pressure weights (front % per second, before ×dt)
// AU: divided by 12. At the old values the opening edge alone (5 player
// ships vs 3, no production) gave +1.8 %/s and won the match in ~28 s with
// no input. Now that edge drifts ~0.15 %/s (≈5 min from 50 to 100), a total
// blowout still needs ≥100 s, and impulses (sinks, captures) dominate.
const W_ISLAND = 0.25;       // each net island held
const W_SHIP   = 0.10;       // each net ship alive
const W_ECON   = 0.033;      // net production edge (wood+gold per sec)
const PRESSURE_CAP = 0.5;    // clamp net pressure so a blowout still takes time

// Event impulses
export const FRONT_IMPULSE = {
  captureIsland:  +8,
  loseIsland:     -8,
  sinkEnemy:      +8,    // + rank bonus (see sink handler)
  sinkFlagship:  +35,
  loseShip:       -5,
  enemyFortDown:  +6,
  playerFortDown: -6,
};

export class WarFront {
  constructor(state, islands, bus, game) {
    this._state   = state;
    this._islands = islands;
    this._bus     = bus;
    this._game    = game;
    this._t       = 0;
    this._ended   = false;

    if (state.warFront == null) state.warFront = 50;

    // ── Event impulses ──
    bus.on('island:captured', ({ newOwner }) => {
      if (newOwner === 'player') this.impulse(FRONT_IMPULSE.captureIsland, 'captured an island');
      else                       this.impulse(FRONT_IMPULSE.loseIsland,   'lost an island');
    });
    bus.on('ship:destroyed', ({ ship }) => {
      if (!ship) return;
      if (ship.team === 'player') {
        this.impulse(FRONT_IMPULSE.loseShip, 'lost a ship');
      } else if (ship.rank === 0) {
        this.impulse(FRONT_IMPULSE.sinkFlagship, 'sank the enemy flagship!');
      } else {
        // bigger ships shove harder
        const rankBonus = Math.max(0, 4 - (ship.rank || 3)) * 2;
        this.impulse(FRONT_IMPULSE.sinkEnemy + rankBonus, 'sank an enemy ship');
      }
    });
    bus.on('island:fort_destroyed', ({ island }) => {
      if (!island) return;
      if (island.own === 'player') this.impulse(FRONT_IMPULSE.playerFortDown, 'a fort fell');
      else                         this.impulse(FRONT_IMPULSE.enemyFortDown, 'breached an enemy fort');
    });
  }

  /** Discrete shove. dir>0 toward victory, dir<0 toward defeat. */
  impulse(delta, _why) {
    if (this._ended) return;
    this._state.warFront = clamp(this._state.warFront + delta);
    this._flashDelta(delta);
    this._checkEnd();
  }

  /** Continuous pressure — call every frame from GameApp.update. */
  update(dt) {
    if (this._ended || this._state.gameOver) return;
    this._t += dt;
    if (this._t < TICK) return;
    const step = this._t; this._t = 0;

    const st = this._state;
    const myIslands  = this._islands.filter(i => i.own === 'player').length;
    const foeIslands = this._islands.filter(i => i.own === 'enemy').length;
    const myShips  = st.playerShips.filter(s => s.alive).length;
    const foeShips = st.enemyShips.filter(s => s.alive).length;

    // economy edge: player production vs a flat enemy baseline scaled by
    // their island count (enemy has no real economy sim, so approximate)
    const myEcon  = this._game?._build?.getProductionRates?.() || { woodRate: 0, goldRate: 0 };
    const myEconEdge = (myEcon.woodRate + myEcon.goldRate);
    const foeEconEdge = foeIslands * 1.5;       // rough parity baseline

    let pressure =
        (myIslands - foeIslands) * W_ISLAND +
        (myShips   - foeShips)   * W_SHIP   +
        (myEconEdge - foeEconEdge) * W_ECON;

    pressure = Math.max(-PRESSURE_CAP, Math.min(PRESSURE_CAP, pressure));
    st.warFront = clamp(st.warFront + pressure * step);
    this._checkEnd();
  }

  _checkEnd() {
    if (this._ended) return;
    if (this._state.warFront >= 100) {
      this._ended = true;
      this._bus.emit('game:win', { reason: 'Enemy Citadel overrun — the front is yours!' });
    } else if (this._state.warFront <= 0) {
      this._ended = true;
      this._bus.emit('game:lose', { reason: 'Home Port overrun — the line has broken.' });
    }
  }

  // Brief floating tick on the bar so impulses are felt, not just seen.
  _flashDelta(delta) {
    const host = document.getElementById('warfront-bar');
    if (!host) return;
    const tag = document.createElement('div');
    tag.className = 'wf-delta ' + (delta >= 0 ? 'pos' : 'neg');
    tag.textContent = (delta >= 0 ? '+' : '') + Math.round(delta);
    host.appendChild(tag);
    setTimeout(() => tag.remove(), 1100);
  }
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }
