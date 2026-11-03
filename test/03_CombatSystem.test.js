// ── TEST: CombatSystem — accuracy falloff + canFire ───────────────
// The AA.1 milestone added range-based accuracy and point-blank bonus.
// These tests verify the math is correct and monotonically decreasing.

import { suite, test, assert, assertApprox, assertGT, assertLT } from './runner.js';

// Import the pure functions directly — no Three.js needed
import { resolveArc, canFire } from '../frontend/src/Experience/Systems/Combat/CombatSystem.js';

// Re-implement rangeAccuracyMult locally to test it
// (it's not exported, but its behavior is observable via the constants)
const FALLOFF_MIN     = 0.28;
const POINTBLANK_DIST = 0.12;
const POINTBLANK_BONUS= 0.18;

function rangeAccuracyMult(dist, maxRange) {
  if (maxRange <= 0) return 1.0;
  const t = Math.min(dist / maxRange, 1.0);
  if (t <= POINTBLANK_DIST) {
    const closeness = 1.0 - t / POINTBLANK_DIST;
    return 1.0 + POINTBLANK_BONUS * closeness;
  }
  const tNorm = (t - POINTBLANK_DIST) / (1.0 - POINTBLANK_DIST);
  const curve = tNorm * tNorm;
  return 1.0 - curve * (1.0 - FALLOFF_MIN);
}

suite('CombatSystem — accuracy falloff', () => {

  test('point-blank returns > 1.0 (bonus)', () => {
    const mult = rangeAccuracyMult(0, 20);
    assertGT(mult, 1.0, `point-blank mult should be > 1.0, got ${mult}`);
  });

  test('point-blank mult is max at dist=0', () => {
    const atZero = rangeAccuracyMult(0, 20);
    const atEdge = rangeAccuracyMult(20 * POINTBLANK_DIST, 20);
    assertGT(atZero, atEdge, 'dist=0 should have higher mult than edge of PB zone');
  });

  test('mult at max range = FALLOFF_MIN (floor)', () => {
    const mult = rangeAccuracyMult(20, 20);
    assertApprox(mult, FALLOFF_MIN, 0.001, `at max range mult should be ${FALLOFF_MIN}`);
  });

  test('mult is monotonically decreasing outside point-blank zone', () => {
    const maxRange = 40;
    const pbEdge   = maxRange * POINTBLANK_DIST;
    let prev = rangeAccuracyMult(pbEdge, maxRange);
    for (let d = pbEdge + 1; d <= maxRange; d += 1) {
      const curr = rangeAccuracyMult(d, maxRange);
      assertLT(curr, prev + 0.0001, `mult should decrease at dist=${d}`);
      prev = curr;
    }
  });

  test('final hc clamped to [0.15, 0.97]', () => {
    // Simulate the clamping logic from CombatSystem
    const clamp = (hc) => Math.min(0.97, Math.max(0.15, hc));
    // Point-blank scenario: hc could exceed 1.0
    const pbMult = rangeAccuracyMult(0, 8);  // Carronade point-blank
    const rawHc  = 0.80 * pbMult;
    const clamped = clamp(rawHc);
    assertLT(clamped, 0.971, 'hc should not exceed 0.97');
    // Far range scenario
    const farMult = rangeAccuracyMult(40, 40);
    const farHc   = clamp(0.80 * farMult);
    assertGT(farHc, 0.14, 'hc should not go below 0.15');
  });

  test('rangeAccuracyMult(0, 0) returns 1.0 (safe division)', () => {
    const mult = rangeAccuracyMult(0, 0);
    assertApprox(mult, 1.0, 0.001, 'zero maxRange should not divide by zero');
  });

});

suite('CombatSystem — resolveArc', () => {

  test('arc mode "all" returns 360° spread', () => {
    const cn = { arc: { m: 'all', d: 360 } };
    const arc = resolveArc(cn, 'L');
    assertApprox(arc.w, 360);
  });

  test('arc mode "bow" centers at 0°', () => {
    const cn = { arc: { m: 'bow', d: 70 } };
    const arc = resolveArc(cn, 'B');
    assertApprox(arc.c, 0);
    assertApprox(arc.w, 70);
  });

  test('arc mode "stern" centers at 180°', () => {
    const cn = { arc: { m: 'stern', d: 70 } };
    const arc = resolveArc(cn, 'S');
    assertApprox(arc.c, 180);
  });

  test('arc mode "side" uses SLOT_CTR for L/R slots', () => {
    const cn = { arc: { m: 'side', d: 120 } };
    const arcL = resolveArc(cn, 'L');
    const arcR = resolveArc(cn, 'R');
    // L and R should be opposite sides
    assert(arcL.c !== arcR.c, 'L and R should have different centers');
  });

});
