// ── TEST: GameState ───────────────────────────────────────────────
// Verifies createGameState() returns a valid, consistent initial state.
// Critical after reorganize — confirms all fields referenced by systems exist.

import { suite, test, assert, assertEqual, assertApprox } from './runner.js';
import { createGameState } from '../frontend/src/Experience/GameState.js';
import { WOOD_START, GOLD_START, WOOD_CAP, GOLD_CAP } from '../frontend/src/data/constants.js';

suite('GameState — initial state', () => {

  test('creates state object without throwing', () => {
    const st = createGameState();
    assert(st !== null && typeof st === 'object');
  });

  test('starting resources match constants', () => {
    const st = createGameState();
    assertApprox(st.resWood, WOOD_START, 0.01);
    assertApprox(st.resGold, GOLD_START, 0.01);
  });

  test('starting resources within caps', () => {
    const st = createGameState();
    assert(st.resWood <= WOOD_CAP, 'starting wood should not exceed cap');
    assert(st.resGold <= GOLD_CAP, 'starting gold should not exceed cap');
  });

  test('required array fields are initialized as arrays', () => {
    const st = createGameState();
    const arrays = ['playerShips','allShips','reviveQueue','fleets'];
    for (const key of arrays) {
      assert(Array.isArray(st[key]), `st.${key} should be an array`);
    }
  });

  test('required numeric fields are initialized as numbers', () => {
    const st = createGameState();
    const nums = ['waveNumber','lootPts','econTimer','statsTimer','hitChanceBuff'];
    for (const key of nums) {
      assert(typeof st[key] === 'number', `st.${key} should be a number, got ${typeof st[key]}`);
    }
  });

  test('islandBuildings is an object (keyed by island id)', () => {
    const st = createGameState();
    assert(typeof st.islandBuildings === 'object' && !Array.isArray(st.islandBuildings));
  });

  test('gameOver starts as false', () => {
    const st = createGameState();
    assertEqual(st.gameOver, false);
  });

  test('stats object has expected shape', () => {
    const st = createGameState();
    assert(typeof st.stats === 'object');
    assert(typeof st.stats.fired === 'number');
    assert(typeof st.stats.hit   === 'number');
  });

  test('camDist is a positive number', () => {
    const st = createGameState();
    assert(typeof st.camDist === 'number' && st.camDist > 0);
  });

  test('paused starts as false', () => {
    const st = createGameState();
    assertEqual(st.paused, false);
  });

  test('multiple calls return independent objects', () => {
    const s1 = createGameState();
    const s2 = createGameState();
    s1.resWood = 999;
    assert(s2.resWood !== 999, 'states should be independent (not shared reference)');
  });

});
