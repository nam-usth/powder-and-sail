// ── PLAY HARNESS ─────────────────────────────────────────────────
// Drive the live game deterministically from the browser console or an
// automation tool — works even when the tab is hidden and
// requestAnimationFrame is paused.
//
//   const h = await import('/test/harness.js');
//   h.step(600);                 // advance 600 frames of 1/60 s
//   h.rightClick(-40, 5);        // right-click the world point (x, z)
//   h.click(-40, 5, {shiftKey:true});
//   h.drag(x0, z0, x1, z1);      // box-select between two world points
//   h.key('a'); h.key('1', {ctrlKey:true}, 'Digit1');
//   h.ships()                    // compact table of player ships
//
// Synthetic events go through the real InputManager listeners, so they
// exercise the same code paths as a mouse.

import * as THREE from 'three';
import { time } from '../frontend/src/Experience/Time.js';

const game = () => window._game;
const canvas = () => document.getElementById('canvas');

export function step(frames = 60, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    time.delta = dt;
    time.elapsed += dt;
    time.trigger('tick');
  }
}

/** World (x, z) → client pixel coordinates for the current camera. */
export function screen(x, z, y = 0) {
  const cam = game()._camera;
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
}

function mouse(type, p, opts = {}, button = 0) {
  const target = type.startsWith('mouse') && type !== 'mousedown' ? window : canvas();
  target.dispatchEvent(new MouseEvent(type, {
    clientX: p.x, clientY: p.y, button, bubbles: true, cancelable: true, ...opts,
  }));
}

export function rightClick(x, z, opts = {}) {
  const p = screen(x, z);
  canvas().dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
  mouse('contextmenu', p, opts, 2);
  return p;
}

export function click(x, z, opts = {}) {
  const p = screen(x, z, opts.y ?? 0);
  canvas().dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
  mouse('mousedown', p, opts);
  mouse('mouseup', p, opts);
  mouse('click', p, opts);
  return p;
}

export function drag(x0, z0, x1, z1, opts = {}) {
  const a = screen(x0, z0), b = screen(x1, z1);
  mouse('mousedown', a, opts);
  for (let i = 1; i <= 4; i++) mouse('mousemove', { x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 }, opts);
  mouse('mouseup', b, opts);
  canvas().dispatchEvent(new MouseEvent('click', { clientX: b.x, clientY: b.y, bubbles: true, ...opts }));
  return { a, b };
}

export function key(k, opts = {}, code) {
  const ev = { key: k, code: code || (k.length === 1 ? 'Key' + k.toUpperCase() : k), bubbles: true, cancelable: true, ...opts };
  window.dispatchEvent(new KeyboardEvent('keydown', ev));
  window.dispatchEvent(new KeyboardEvent('keyup', ev));
}

export function ships(team = 'player') {
  const g = game(), st = g._state;
  const list = team === 'player' ? st.playerShips : st.enemyShips;
  return list.map(s => ({
    nm: s.nm, x: +s.x.toFixed(1), z: +s.z.toFixed(1), hp: Math.round(s.hp),
    spd: +s.speed.toFixed(3), fleet: s.fleetId, stance: s.stance,
    order: g._orders && team === 'player' ? g._orders.describe(s) : '',
  }));
}
