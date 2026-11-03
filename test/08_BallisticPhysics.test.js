// ── TEST: Ballistic Trajectory (AA.1 physics) ─────────────────────
// Tests the cannonball physics math from VFX.fireBall().
// We extract and test the trajectory formulas directly — no Three.js needed.

import { suite, test, assert, assertApprox, assertGT, assertLT } from './runner.js';

// Mirror the exact constants from VFX.js
const GRAVITY   = 18;   // world units / s²
const HORIZ_SPD = 28;   // world units / s

function computeTrajectory(sx, sy, sz, tx, tz) {
  const dx   = tx - sx;
  const dz   = tz - sz;
  const dist = Math.sqrt(dx*dx + dz*dz) || 0.01;
  const tof  = dist / HORIZ_SPD;
  const ty   = 0.3;
  const vy0  = (ty - sy + 0.5 * GRAVITY * tof * tof) / tof;
  const vx   = dx / tof;
  const vz   = dz / tof;
  return { tof, vy0, vx, vz, dist };
}

function sampleY(sy, vy0, t) {
  return sy + vy0 * t - 0.5 * GRAVITY * t * t;
}

suite('Ballistic trajectory — AA.1', () => {

  test('ball lands near target Y (≈0.3) at tof', () => {
    const { tof, vy0 } = computeTrajectory(0, 1.8, 0, 25, 0);
    const landY = sampleY(1.8, vy0, tof);
    assertApprox(landY, 0.3, 0.1, `ball should land near y=0.3, got ${landY}`);
  });

  test('short range: tof < 0.2s (near-instant)', () => {
    const { tof } = computeTrajectory(0, 1.8, 0, 4, 0);
    assertLT(tof, 0.20, `short range tof should be < 0.2s, got ${tof}`);
  });

  test('long range: tof > 1.0s (visible arc)', () => {
    const { tof } = computeTrajectory(0, 1.8, 0, 40, 0);
    assertGT(tof, 1.0, `long range tof should be > 1.0s, got ${tof}`);
  });

  test('tof scales linearly with distance', () => {
    const t1 = computeTrajectory(0, 1.8, 0, 10, 0).tof;
    const t2 = computeTrajectory(0, 1.8, 0, 20, 0).tof;
    assertApprox(t2 / t1, 2.0, 0.01, 'tof should double when distance doubles');
  });

  test('short range arc is lower than long range arc', () => {
    const short = computeTrajectory(0, 1.8, 0, 4, 0);
    const lng   = computeTrajectory(0, 1.8, 0, 40, 0);
    const shortPeak = sampleY(1.8, short.vy0, short.tof / 2);
    const longPeak  = sampleY(1.8, lng.vy0, lng.tof / 2);
    assertGT(longPeak, shortPeak, 'longer range shot should arc higher');
  });

  test('horizontal velocity is constant (no air resistance)', () => {
    const { vx, vz, dist, tof } = computeTrajectory(0, 1.8, 0, 20, 15);
    const expectedDist = Math.sqrt(vx*vx + vz*vz) * tof;
    assertApprox(expectedDist, dist, 0.5, 'horizontal distance should match');
  });

  test('ball position at t=0 is start position', () => {
    const sy = 1.8;
    const { vy0 } = computeTrajectory(0, sy, 0, 20, 0);
    const y0 = sampleY(sy, vy0, 0);
    assertApprox(y0, sy, 0.001, 'at t=0 ball should be at launch Y');
  });

  test('vy0 is positive (launched upward) for flat shot', () => {
    // When target is lower than source, vy0 should still be > 0 for arcing shot
    const { vy0 } = computeTrajectory(0, 1.8, 0, 30, 0);
    assertGT(vy0, 0, `vy0 should be positive for normal shots, got ${vy0}`);
  });

});
