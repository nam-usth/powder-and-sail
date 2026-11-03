// ── TEST: EconomySystem ───────────────────────────────────────────
// Tests resource capping, base tick rate, raid timer logic.
// EconomySystem uses a stub state — no Three.js needed.

import { suite, test, assert, assertEqual, assertApprox, assertLT } from './runner.js';
import { EconomySystem } from '../frontend/src/Experience/Systems/Economy/EconomySystem.js';
import { WOOD_CAP, GOLD_CAP, WOOD_RATE, GOLD_RATE } from '../frontend/src/data/constants.js';

// ── Minimal stub state ────────────────────────────────────────────
function makeState(overrides = {}) {
  return {
    gameOver: false,
    resWood: 0,
    resGold: 0,
    econTimer: 0,
    raidCooldown: {},
    activeRaid: null,
    playerShips: [],
    lootPts: 0,
    _warehouseCapBonus: 0,
    _warehouseProtected: 0,
    stats: { timeSec: 0 },
    ...overrides,
  };
}

// Stub bus, vfx, islands, build
const nullBus   = { emit: () => {} };
const nullVfx   = { playSound: () => {} };
const nullBuild = { getProductionRates: () => ({ woodRate: 0, goldRate: 0 }) };

suite('EconomySystem — base resource tick', () => {

  test('resources increase by WOOD_RATE/GOLD_RATE after 1 second', () => {
    const st  = makeState({ resWood: 100, resGold: 100 });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(1.0);
    assertApprox(st.resWood, 100 + WOOD_RATE, 0.01);
    assertApprox(st.resGold, 100 + GOLD_RATE, 0.01);
  });

  test('resources do not tick on sub-second updates', () => {
    const st  = makeState({ resWood: 100, resGold: 100 });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(0.4);  // less than 1s — no tick yet
    assertApprox(st.resWood, 100, 0.01, 'wood should not change sub-second');
  });

  test('resources capped at WOOD_CAP / GOLD_CAP', () => {
    const st  = makeState({ resWood: WOOD_CAP - 1, resGold: GOLD_CAP - 1 });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(5.0);  // multiple ticks
    assertLT(st.resWood, WOOD_CAP + 0.01, 'wood should not exceed cap');
    assertLT(st.resGold, GOLD_CAP + 0.01, 'gold should not exceed cap');
  });

  test('no ticking when gameOver = true', () => {
    const st  = makeState({ gameOver: true, resWood: 50, resGold: 50 });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(2.0);
    assertApprox(st.resWood, 50, 0.01, 'resources should freeze on game over');
  });

  test('warehouse cap bonus extends the cap', () => {
    const bonus = 200;
    const st  = makeState({ resWood: WOOD_CAP, resGold: 0, _warehouseCapBonus: bonus });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(1.0);
    // Wood was already at base cap — with bonus it can go higher
    assertLT(st.resWood, WOOD_CAP + bonus + 0.01);
  });

  test('building production applies per-dt (not per-second)', () => {
    const st  = makeState({ resWood: 0, resGold: 0 });
    const buildWithProd = { getProductionRates: () => ({ woodRate: 10, goldRate: 5 }) };
    const eco = new EconomySystem(st, [], nullVfx, nullBus, buildWithProd);
    eco.update(0.5);  // half a second
    assertApprox(st.resWood, 10 * 0.5, 0.01, 'wood production should be per-dt');
    assertApprox(st.resGold,  5 * 0.5, 0.01, 'gold production should be per-dt');
  });

  test('raid cooldown decrements over time', () => {
    const st  = makeState({ raidCooldown: { isle_1: 90 } });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(10.0);
    assert(st.raidCooldown['isle_1'] < 90, 'cooldown should decrease');
  });

  test('raid cooldown entry deleted when reaches 0', () => {
    const st  = makeState({ raidCooldown: { isle_1: 5 } });
    const eco = new EconomySystem(st, [], nullVfx, nullBus, nullBuild);
    eco.update(6.0);
    assert(!('isle_1' in st.raidCooldown), 'expired cooldown entry should be removed');
  });

});
