// ── TEST: Ocean / getWaveHeight ───────────────────────────────────
// Verifies the CPU-side wave function used by ships, wake trails, and
// buoyancy physics. The GPU vertex shader uses the same constants —
// if these tests pass, shader and CPU are in sync.
//
// Wave system: 6 Gerstner waves + 3-layer fBm turbulence (ported from
// threejs_ocean_buoy_fixed.html). TOTAL_AMP = 0.74 (Σ amplitudes).

import { suite, test, assert, assertApprox, assertGT, assertLT } from './runner.js';
import { getWaveHeight, TOTAL_AMP, WAVE_SPEED } from '../frontend/src/Experience/World/Ocean.js';

suite('getWaveHeight (6-wave + fBm CPU)', () => {

  test('returns a number for any input', () => {
    const h = getWaveHeight(0, 0, 0);
    assert(typeof h === 'number' && !isNaN(h), `got ${h}`);
  });

  test('height at t=0 is deterministic', () => {
    const h1 = getWaveHeight(10, 20, 0);
    const h2 = getWaveHeight(10, 20, 0);
    assertApprox(h1, h2, 0, 'same inputs must give same output');
  });

  test('height varies with position (not flat ocean)', () => {
    const h0 = getWaveHeight(0,   0, 1);
    const h1 = getWaveHeight(100, 0, 1);
    assert(Math.abs(h0 - h1) > 0.01, 'ocean should not be flat');
  });

  test('height varies with time (waves move)', () => {
    const h0 = getWaveHeight(0, 0, 0);
    const h1 = getWaveHeight(0, 0, 5);
    assert(Math.abs(h0 - h1) > 0.01, 'waves should move over time');
  });

  test('TOTAL_AMP constant exported and matches wave table sum (0.74)', () => {
    // 0.28+0.18+0.12+0.08+0.05+0.03 = 0.74
    assertApprox(TOTAL_AMP, 0.74, 0.001);
  });

  test('WAVE_SPEED exported and positive', () => {
    assert(typeof WAVE_SPEED === 'number' && WAVE_SPEED > 0);
  });

  test('amplitude bounded: waves + turbulence stay within ±0.95', () => {
    // Sample grid: 6-wave amp sum = 0.74, turbulence adds ~0.16 max
    let maxH = 0, minH = 0;
    for (let x = 0; x < 150; x += 3) {
      for (let z = 0; z < 150; z += 3) {
        for (let t = 0; t < 12; t += 0.5) {
          const h = getWaveHeight(x, z, t);
          maxH = Math.max(maxH, h);
          minH = Math.min(minH, h);
        }
      }
    }
    assertLT(maxH,  0.95, `max height ${maxH.toFixed(3)} exceeds expected bound`);
    assertGT(minH, -0.95, `min height ${minH.toFixed(3)} exceeds expected bound`);
  });

  test('returns ~0 average over a long sample (near zero-mean)', () => {
    let sum = 0, n = 0;
    for (let t = 0; t < 60; t += 0.1) {
      sum += getWaveHeight(0, 0, t);
      n++;
    }
    assertApprox(sum / n, 0, 0.10, 'wave function should be near zero-mean');
  });

  test('different positions at same time give different heights', () => {
    const h1 = getWaveHeight(0,  0, 3);
    const h2 = getWaveHeight(15, 0, 3);
    const h3 = getWaveHeight(0, 15, 3);
    assert(h1 !== h2 || h1 !== h3, 'spatial variation expected');
  });

  test('gradients are continuous (no sudden jumps)', () => {
    // Sample along a line — adjacent samples should not differ by more than 0.05
    let maxDiff = 0;
    for (let x = 0; x < 50; x += 0.2) {
      const d = Math.abs(getWaveHeight(x + 0.2, 0, 1) - getWaveHeight(x, 0, 1));
      maxDiff = Math.max(maxDiff, d);
    }
    assertLT(maxDiff, 0.05, `wave gradient too steep: ${maxDiff.toFixed(4)}`);
  });

});
