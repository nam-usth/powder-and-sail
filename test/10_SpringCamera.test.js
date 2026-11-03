import { suite, test, assert, assertApprox, assertGT, assertLT } from './runner.js';
import { SpringCamera } from '../frontend/src/Experience/SpringCamera.js';

suite('SpringCamera — critically damped spring', () => {

  test('warpTo() sets position instantly', () => {
    const s = new SpringCamera();
    s.warpTo(50, 30, 100);
    assertApprox(s.pos.x, 50); assertApprox(s.pos.z, 30); assertApprox(s.dist, 100);
  });

  test('update() moves toward target', () => {
    const s = new SpringCamera(12);
    s.warpTo(0, 0); s.setTarget(100, 0); s.update(0.016);
    assertGT(s.pos.x, 0);
  });

  test('settles near target after ~1.5s', () => {
    const s = new SpringCamera(12);
    s.warpTo(0, 0); s.setTarget(10, 0);
    for(let i = 0; i < 90; i++) s.update(0.016);
    assertApprox(s.pos.x, 10, 0.2);
  });

  test('velocity near zero after settling', () => {
    const s = new SpringCamera(12);
    s.warpTo(0, 0); s.setTarget(10, 0);
    for(let i = 0; i < 120; i++) s.update(0.016);
    assertLT(s.speed, 0.1);
  });

  test('no oscillation (critical damping)', () => {
    const s = new SpringCamera(12);
    s.warpTo(0, 0); s.setTarget(10, 0);
    let maxX = 0;
    for(let i = 0; i < 120; i++){ s.update(0.016); maxX = Math.max(maxX, s.pos.x); }
    assertLT(maxX, 10.6, `overshoot too large: ${maxX}`);
  });

  test('zoom spring settles at target dist', () => {
    const s = new SpringCamera();
    s.warpTo(0, 0, 80); s.setDistTarget(120);
    for(let i = 0; i < 120; i++) s.update(0.016);
    assertApprox(s.dist, 120, 2.5);
  });

  test('dist clamped to [25, 150]', () => {
    const s = new SpringCamera();
    s.warpTo(0, 0, 80); s.setDistTarget(9999);
    for(let i = 0; i < 200; i++) s.update(0.016);
    assertLT(s.dist, 151);
  });

  test('warpTo clears velocity', () => {
    const s = new SpringCamera(12);
    s.warpTo(0, 0); s.setTarget(100, 0);
    for(let i = 0; i < 10; i++) s.update(0.016);
    s.warpTo(50, 50);
    assertApprox(s.speed, 0, 0.001);
  });

});
