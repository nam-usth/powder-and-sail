// ── TEST: ReviveSystem ────────────────────────────────────────────
// Covers: queue(), cost deduction, timer countdown, double-queue guard,
// resource guard, revive completes after timer.

import { suite, test, assert, assertEqual, assertApprox } from './runner.js';
import { ReviveSystem } from '../frontend/src/Experience/Systems/Naval/ReviveSystem.js';

function makeShip(overrides = {}) {
  return {
    alive: false,
    nm: 'Test Ship',
    hull: 'light',
    sc: 1,
    hp: 0, maxHp: 100,
    x: 0, z: 0, angle: 0,
    speed: 0, baseSpd: 0.14, maxSpeed: 0.14,
    rank: 0,
    loadout: { L: null, R: null },
    slotTimers: { L: 0, R: 0 },
    statusEffects: {},
    effects: [],
    team: 'player',
    reviveCost: { wood: 80, gold: 60 },
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    resWood: 200,
    resGold: 150,
    reviveQueue: [],
    waveNumber: 0,
    playerShips: [],
    islandBuildings: {},
    ...overrides,
  };
}

const nullVfx = { playSound: () => {} };
const nullScene = { add: () => {}, remove: () => {} };
const nullIslands = [{ x: 0, z: 0, r: 10, def: { id: 'home' } }];

suite('ReviveSystem — queue()', () => {

  test('queue() deducts resources immediately', () => {
    const st   = makeState();
    const ship = makeShip();
    const events = [];
    const bus  = { emit: (e) => events.push(e) };
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, bus);

    const ok = rs.queue(ship);
    assert(ok, 'queue() should return true on success');
    assertEqual(st.resWood, 200 - 80, 'wood should be deducted');
    assertEqual(st.resGold, 150 - 60, 'gold should be deducted');
  });

  test('queue() adds ship to reviveQueue', () => {
    const st   = makeState();
    const ship = makeShip();
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, { emit: () => {} });
    rs.queue(ship);
    assertEqual(st.reviveQueue.length, 1);
    assertEqual(st.reviveQueue[0].ship, ship);
  });

  test('queue() rejects alive ship', () => {
    const st   = makeState();
    const ship = makeShip({ alive: true });
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, { emit: () => {} });
    const ok = rs.queue(ship);
    assert(!ok, 'alive ship should not be queueable');
    assertEqual(st.reviveQueue.length, 0);
  });

  test('queue() rejects duplicate (already queued)', () => {
    const st   = makeState();
    const ship = makeShip();
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, { emit: () => {} });
    rs.queue(ship);
    const ok2 = rs.queue(ship);
    assert(!ok2, 'should not queue same ship twice');
    assertEqual(st.reviveQueue.length, 1);
    // Resources should only be deducted once
    assertEqual(st.resWood, 200 - 80);
  });

  test('queue() rejects when insufficient wood', () => {
    const st   = makeState({ resWood: 10 });  // not enough
    const ship = makeShip();
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, { emit: () => {} });
    const ok = rs.queue(ship);
    assert(!ok, 'should reject when insufficient resources');
    assertEqual(st.reviveQueue.length, 0);
    assertEqual(st.resWood, 10, 'resources should not change on rejection');
  });

  test('queue() rejects when insufficient gold', () => {
    const st   = makeState({ resGold: 5 });  // not enough
    const ship = makeShip();
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, { emit: () => {} });
    const ok = rs.queue(ship);
    assert(!ok);
    assertEqual(st.resGold, 5, 'gold should not be deducted on failure');
  });

  test('revive timer counts down and ship revives', () => {
    const st   = makeState();
    const ship = makeShip();
    const events = [];
    const bus  = { emit: (e, d) => events.push({ e, d }) };
    const rs   = new ReviveSystem(st, nullScene, nullIslands, nullVfx, bus);
    rs.queue(ship);

    const totalTime = st.reviveQueue[0]?.totalTime || 30;

    // Simulate updates until ship should revive
    let elapsed = 0;
    while (elapsed < totalTime + 1 && !ship.alive) {
      rs.update(1.0);
      elapsed++;
    }

    assert(ship.alive, 'ship should be alive after timer expires');
    assert(events.some(ev => ev.e === 'revive:complete'), 'revive:complete should be emitted');
    assertEqual(st.reviveQueue.length, 0, 'queue should be empty after revive');
  });

  test('revive timer scales with waveNumber', () => {
    // wave 5 → +25s base
    const st1 = makeState({ waveNumber: 0 });
    const st2 = makeState({ waveNumber: 5 });
    const s1  = makeShip();
    const s2  = makeShip();
    const rs1 = new ReviveSystem(st1, nullScene, nullIslands, nullVfx, { emit: () => {} });
    const rs2 = new ReviveSystem(st2, nullScene, nullIslands, nullVfx, { emit: () => {} });
    rs1.queue(s1); rs2.queue(s2);
    const t1 = st1.reviveQueue[0].totalTime;
    const t2 = st2.reviveQueue[0].totalTime;
    assert(t2 > t1, `wave 5 revive (${t2}s) should take longer than wave 0 (${t1}s)`);
  });

});
