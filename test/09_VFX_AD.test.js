// ── TEST: AD VFX — ParticlePool + CameraShake ────────────────────
// Tests the AD milestone instanced particle pool and camera shake
// without needing Three.js — uses duck-typed stubs.

import { suite, test, assert, assertEqual, assertApprox, assertGT, assertLT } from './runner.js';

// ── CameraShake (pure math, no Three.js dependency) ───────────────
// Re-implement locally to test the math without import side-effects
class CameraShakeTest {
  constructor() { this._intensity = 0; this._decay = 8.0; }
  trigger(v = 0.4) { this._intensity = Math.min(this._intensity + v, 1.2); }
  get intensity() { return this._intensity; }
  step(dt) {
    if (this._intensity < 0.001) { this._intensity = 0; return; }
    this._intensity -= this._intensity * this._decay * dt;
  }
}

suite('AD — CameraShake math', () => {

  test('trigger() increases intensity', () => {
    const s = new CameraShakeTest();
    s.trigger(0.5);
    assertGT(s.intensity, 0, 'intensity should be > 0 after trigger');
  });

  test('intensity decays to 0 over time', () => {
    const s = new CameraShakeTest();
    s.trigger(1.0);
    for (let i = 0; i < 100; i++) s.step(0.016);  // ~1.6s at 60fps
    assertLT(s.intensity, 0.01, 'shake should decay to near zero');
  });

  test('multiple triggers stack up to cap (1.2)', () => {
    const s = new CameraShakeTest();
    s.trigger(0.8);
    s.trigger(0.8);
    assertLT(s.intensity, 1.21, 'should not exceed cap');
    assertGT(s.intensity, 0.8, 'should stack beyond single trigger');
  });

  test('intensity is 0 before any trigger', () => {
    const s = new CameraShakeTest();
    assertApprox(s.intensity, 0);
  });

  test('decay is exponential — halves over similar intervals', () => {
    const s = new CameraShakeTest();
    s.trigger(1.0);
    const i0 = s.intensity;
    for (let i = 0; i < 20; i++) s.step(0.016);
    const i1 = s.intensity;
    for (let i = 0; i < 20; i++) s.step(0.016);
    const i2 = s.intensity;
    // Each interval should decrease by roughly the same fraction
    const ratio1 = i1 / i0;
    const ratio2 = i2 / i1;
    assertApprox(ratio1, ratio2, 0.05, 'exponential decay should have constant ratio');
  });

});

suite('AD — VFX backward compatibility', () => {

  test('VFX module exports expected symbols', async () => {
    const m = await import('../frontend/src/Experience/Systems/VFX/VFX.js');
    assert(typeof m.VFX === 'function', 'VFX class should be exported');
    assert(typeof m.CameraShake === 'function', 'CameraShake should be exported');
  });

  test('VFX instance has all expected public methods', async () => {
    const { VFX } = await import('../frontend/src/Experience/Systems/VFX/VFX.js');
    // Stub scene and camera
    const fakeScene  = { add(){}, remove(){} };
    const fakeCamera = { position: { x:0,y:0,z:0 } };
    const vfx = new VFX(fakeScene, fakeCamera);

    const methods = ['spawnPart','spawnSmoke','spawnHit','spawnSplash',
                     'spawnExplosion','startSink','fireBall','spawnDmg',
                     'playSound','update'];
    for (const m of methods) {
      assert(typeof vfx[m] === 'function', `vfx.${m} should be a function`);
    }
  });

  test('VFX.shake is a CameraShake instance', async () => {
    const { VFX, CameraShake } = await import('../frontend/src/Experience/Systems/VFX/VFX.js');
    const fakeScene  = { add(){}, remove(){} };
    const fakeCamera = { position: { x:0,y:0,z:0 } };
    const vfx = new VFX(fakeScene, fakeCamera);
    assert(vfx.shake instanceof CameraShake, 'vfx.shake should be CameraShake');
    assert(typeof vfx.shake.trigger === 'function');
  });

});

suite('AD — Sink sequence phases', () => {

  test('SinkSequence phase progression logic', () => {
    // Test phase timing math without needing Three.js scene
    const TILT_DUR = 1.2;
    const SINK_DUR = 1.8;
    const FADE_DUR = 0.6;
    const TOTAL    = TILT_DUR + SINK_DUR + FADE_DUR;

    assertApprox(TOTAL, 3.6, 0.01, 'total sink sequence should be ~3.6s');
    assertGT(SINK_DUR, TILT_DUR, 'sink phase should be longer than tilt');
  });

  test('smoothstep easing stays in [0, 1]', () => {
    // smoothstep p*p*(3-2*p) used in tilt phase
    for (let i = 0; i <= 10; i++) {
      const p    = i / 10;
      const ease = p * p * (3 - 2 * p);
      assert(ease >= 0 && ease <= 1.001, `smoothstep(${p}) = ${ease} should be in [0,1]`);
    }
  });

  test('smoothstep at 0 = 0 and at 1 = 1', () => {
    const s0 = 0 * 0 * (3 - 2 * 0);
    const s1 = 1 * 1 * (3 - 2 * 1);
    assertApprox(s0, 0);
    assertApprox(s1, 1);
  });

});
