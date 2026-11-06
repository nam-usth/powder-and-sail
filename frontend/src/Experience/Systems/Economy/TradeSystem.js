// ── Trade System (Milestone AI) ──────────────────────────────────
// Dynamic market: prices drift over time via random walk.
// Trade routes:   each player-owned island beyond the first generates
//                 passive gold per second (scales with island count).

import { WOOD_CAP, GOLD_CAP } from '../../../data/constants.js';

const PRICE_TICK    = 15;    // seconds between price drift
const ROUTE_TICK    = 3;     // seconds between passive income ticks
const WOOD_BASE     = 8;     // gold per 10 wood sold
const GOLD_BASE     = 10;    // wood per 10 gold spent
const DRIFT_RANGE   = 0.18;  // ±18% max single drift step
const PRICE_MIN     = 0.5;
const PRICE_MAX     = 2.2;
const ROUTE_INCOME  = 4;     // gold per owned island per ROUTE_TICK

export class TradeSystem {
  constructor(state, islands, bus) {
    this._state   = state;
    this._islands = islands;
    this._bus     = bus;

    // Multipliers relative to base (1.0 = base price)
    this.woodPrice = 1.0;   // gold you receive when selling wood
    this.goldPrice = 1.0;   // wood you receive when buying with gold

    this._priceTimer = PRICE_TICK * 0.5;
    this._routeTimer = 0;
  }

  // ── Public API ───────────────────────────────────────────────

  /** Current storage caps (base + warehouses), same rule as EconomySystem. */
  _caps() {
    const bonus = this._state._warehouseCapBonus || 0;
    return { wood: WOOD_CAP + bonus, gold: GOLD_CAP + bonus };
  }

  /**
   * Sell up to `amt` wood → returns gold gained. Never sells more wood than the
   * gold storage can take, and never lowers a stock that is above its cap.
   * `this.lastReason`: 'ok' | 'no_wood' | 'gold_full'.
   */
  sellWood(amt) {
    const st = this._state;
    const rate = (WOOD_BASE / 10) * this.woodPrice;            // gold per wood
    const space = Math.max(0, this._caps().gold - (st.resGold || 0));
    let have = Math.min(amt, Math.floor(st.resWood || 0));
    if (have <= 0) { this.lastReason = 'no_wood'; return 0; }
    if (space < 1) { this.lastReason = 'gold_full'; return 0; }
    have = Math.min(have, Math.floor(space / rate));
    if (have <= 0) { this.lastReason = 'gold_full'; return 0; }
    const gold = Math.min(Math.round(have * rate), Math.floor(space));
    st.resWood -= have;
    st.resGold = (st.resGold || 0) + gold;
    this.lastReason = 'ok'; this.lastAmount = have;
    this._bus.emit('trade:sold', { type: 'wood', amt: have, gold });
    return gold;
  }

  /**
   * Buy up to `amt` wood for gold → returns wood gained. Buys only what the
   * wood storage can take. `this.lastReason`: 'ok' | 'no_gold' | 'wood_full'.
   */
  buyWood(amt) {
    const st = this._state;
    const goldPerWood = (1 / (GOLD_BASE / 10)) / this.goldPrice;
    const space = Math.max(0, Math.floor(this._caps().wood - (st.resWood || 0)));
    if (space < 1) { this.lastReason = 'wood_full'; return 0; }
    const want = Math.min(amt, space, Math.floor((st.resGold || 0) / goldPerWood));
    if (want <= 0) { this.lastReason = 'no_gold'; return 0; }
    const cost = Math.max(1, Math.round(want * goldPerWood));
    st.resGold -= cost;
    st.resWood = (st.resWood || 0) + want;
    this.lastReason = 'ok'; this.lastAmount = want;
    this._bus.emit('trade:bought', { type: 'wood', amt: want, cost });
    return want;
  }

  // ── Frame update ─────────────────────────────────────────────
  update(dt) {
    const st = this._state;
    if (st.gameOver || st.paused) return;

    this._priceTimer -= dt;
    if (this._priceTimer <= 0) {
      this._priceTimer = PRICE_TICK + (Math.random() - 0.5) * 4;
      this._driftPrices();
    }

    this._routeTimer -= dt;
    if (this._routeTimer <= 0) {
      this._routeTimer = ROUTE_TICK;
      this._tickRoutes();
    }
  }

  // ── Price drift ──────────────────────────────────────────────
  _driftPrices() {
    const drift = () => 1 + (Math.random() - 0.5) * 2 * DRIFT_RANGE;
    this.woodPrice = Math.max(PRICE_MIN, Math.min(PRICE_MAX, this.woodPrice * drift()));
    this.goldPrice = Math.max(PRICE_MIN, Math.min(PRICE_MAX, this.goldPrice * drift()));
    this._bus.emit('trade:priceUpdate', { woodPrice: this.woodPrice, goldPrice: this.goldPrice });
  }

  // ── Passive route income ──────────────────────────────────────
  _tickRoutes() {
    const st = this._state;
    const owned = (this._islands || []).filter(i => i.team === 'player' && !i.down).length;
    if (owned <= 1) return;
    const income = (owned - 1) * ROUTE_INCOME;
    st.resGold = Math.min((st.resGold || 0) + income, st.GOLD_CAP || 600);
    this._bus.emit('trade:routeIncome', { income, routes: owned - 1 });
  }

  // ── Market UI data ────────────────────────────────────────────
  getMarketInfo() {
    return {
      woodPrice:     this.woodPrice,
      goldPrice:     this.goldPrice,
      woodSellRate:  +(WOOD_BASE * this.woodPrice / 10).toFixed(2),
      woodBuyRate:   +(10 / (GOLD_BASE * this.goldPrice)).toFixed(2),
    };
  }
}
