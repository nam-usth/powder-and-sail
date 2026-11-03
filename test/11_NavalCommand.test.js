// ── TEST: AU naval command layer ─────────────────────────────────
// Pure parts of the RTS control upgrade: path planning around islands,
// formation slot math, hull-aware steering, gunnery profile, fleets as
// control groups, and a headless OrderSystem run (no THREE, no DOM).

import { suite, test, assert, assertEqual, assertApprox, assertLT, assertGT } from './runner.js';
import { segmentHitsCircle, planPath, pushOutside } from '../frontend/src/Experience/Systems/Naval/Navigation.js';
import { formationSlots, slotToWorld, assignSlots } from '../frontend/src/Experience/Systems/Naval/Formations.js';
import { steerTo, handlingOf } from '../frontend/src/Experience/Systems/Naval/MovementSystem.js';
import { OrderSystem, gunProfile } from '../frontend/src/Experience/Systems/Naval/OrderSystem.js';
import { FleetCommander } from '../frontend/src/Experience/Systems/Naval/FleetCommander.js';

const isl = (x, z, r) => ({ x, z, r, def: { id: `i${x}_${z}` } });

function mkShip(nm, x, z, hull = 'standard', extra = {}) {
  const spd = { light: .16, standard: .14, heavy: .13 }[hull];
  return {
    nm, x, z, hull, angle: 0, speed: 0, maxSpeed: spd, baseSpd: spd, sc: 1,
    alive: true, team: 'player', statusEffects: {}, loadout: { L: 'swivel', R: null, B: null, S: null },
    hp: 100, maxHp: 100, ...extra,
  };
}

suite('Navigation — path planning around islands', () => {

  test('segmentHitsCircle detects a crossing and ignores a miss', () => {
    assert(segmentHitsCircle(-10, 0, 10, 0, 0, 0, 3), 'segment through centre must hit');
    assert(!segmentHitsCircle(-10, 5, 10, 5, 0, 0, 3), 'segment 5 u away must miss r=3');
  });

  test('clear water → single waypoint at the goal', () => {
    const p = planPath(-50, 0, 50, 0, [isl(0, 40, 10)], 4);
    assertEqual(p.length, 1);
    assertApprox(p[0].x, 50, 1e-6); assertApprox(p[0].z, 0, 1e-6);
  });

  test('island in the way → every leg clears every island', () => {
    const islands = [isl(0, 0, 14), isl(30, 10, 9)];
    const p = planPath(-60, 2, 60, -2, islands, 4);
    assertGT(p.length, 1, 'expected a detour');
    let ax = -60, az = 2;
    for (const w of p) {
      for (const i of islands) assert(!segmentHitsCircle(ax, az, w.x, w.z, i.x, i.z, i.r + 3.9), `leg (${ax|0},${az|0})→(${w.x|0},${w.z|0}) clips island at ${i.x}`);
      ax = w.x; az = w.z;
    }
    assertApprox(ax, 60, 1e-6, 'path must end at the goal');
  });

  test('goal inside an island is pushed out to the shore + clearance', () => {
    const q = pushOutside(1, 0, [isl(0, 0, 10)], 4);
    assertGT(Math.hypot(q.x, q.z), 14, 'pushed point must be outside r + clearance');
  });

  test('a ship hugging the shore can still plan away from it', () => {
    const p = planPath(12, 0, 60, 0, [isl(0, 0, 10)], 4);   // start inside r+clearance
    assert(p.length >= 1);
    assertApprox(p[p.length - 1].x, 60, 1e-6);
  });
});

suite('Formations — slot math', () => {

  test('line ahead: centred column at the formation spacing', () => {
    const s = formationSlots('column', 5);
    assertApprox(s.reduce((a, v) => a + v.z, 0), 0, 1e-9, 'centred on the anchor');
    assertApprox(s[0].z - s[1].z, 6.5, 1e-9);
    assert(s.every(v => v.x === 0));
  });

  test('line abreast: side by side, all at z = 0', () => {
    const s = formationSlots('line', 4);
    assert(s.every(v => v.z === 0));
    assertApprox(s[3].x - s[0].x, 18, 1e-9);
  });

  test('wedge: slot 0 is the point (front-most)', () => {
    const s = formationSlots('wedge', 5);
    assert(s.every((v, i) => i === 0 || v.z < s[0].z), 'everyone trails the point');
  });

  test('slotToWorld follows the game heading convention', () => {
    const p = slotToWorld(0, 0, Math.PI / 2, { x: 0, z: 1 });   // heading east, 1 forward
    assertApprox(p.x, 1, 1e-9); assertApprox(p.z, 0, 1e-9);
    const q = slotToWorld(0, 0, 0, { x: 1, z: 0 });             // heading north(+z), 1 starboard
    assertApprox(q.x, 1, 1e-9); assertApprox(q.z, 0, 1e-9);
  });

  test('assignSlots is one-to-one and keeps a column in order', () => {
    const ships = [mkShip('a', 0, 13), mkShip('b', 0, 6.5), mkShip('c', 0, 0), mkShip('d', 0, -6.5), mkShip('e', 0, -13)];
    const slots = formationSlots('column', 5);
    const m = assignSlots(ships, slots, 0, 0, 0);
    assertEqual(new Set(m.values()).size, 5);
    ships.forEach((s, i) => assertEqual(m.get(s), slots[i], `${s.nm} should keep its place`));
  });
});

suite('MovementSystem — hull-aware steering', () => {

  const run = (dt, secs) => {
    const s = mkShip('t', 0, 0, 'light');
    for (let t = 0; t < secs; t += dt) steerTo(s, 30, 30, dt, [], { arrive: true });
    return s;
  };

  test('frame-rate independent: 30 fps and 120 fps end in the same place', () => {
    const a = run(1 / 30, 8), b = run(1 / 120, 8);
    assertLT(Math.hypot(a.x - b.x, a.z - b.z), 1.5, `30fps (${a.x.toFixed(1)},${a.z.toFixed(1)}) vs 120fps (${b.x.toFixed(1)},${b.z.toFixed(1)})`);
  });

  test('turn rate never exceeds the hull limit', () => {
    const s = mkShip('h', 0, 0, 'heavy');
    const dt = 1 / 60, lim = handlingOf(s).turnRate * dt + 1e-9;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      const a0 = s.angle;
      steerTo(s, -20, -20, dt, [], { arrive: false });
      let d = Math.abs(s.angle - a0); if (d > Math.PI) d = 2 * Math.PI - d;
      worst = Math.max(worst, d);
    }
    assert(worst <= lim, `turned ${worst.toFixed(4)} rad in one frame, limit ${lim.toFixed(4)}`);
  });

  test('arrives on a point inside its turning circle instead of orbiting it', () => {
    const s = mkShip('o', 0, 0, 'light', { speed: 0.12 });
    let d = 99;
    for (let i = 0; i < 60 * 15; i++) d = steerTo(s, 2.5, -1.5, 1 / 60, [], { arrive: true });
    assertLT(d, 1.4, `still ${d.toFixed(2)} u away after 15 s`);
    assertLT(s.speed, 0.03);
  });
});

suite('Gunnery profile', () => {

  test('swivel only: range 8, no preferred broadside', () => {
    const p = gunProfile(mkShip('s', 0, 0, 'light'));
    assertEqual(p.range, 8); assertEqual(p.side, null);
  });

  test('a starboard demi-culverin makes starboard the preferred side', () => {
    const s = mkShip('d', 0, 0, 'standard');
    s.loadout = { L: null, R: 'demi_culv', B: null };
    const p = gunProfile(s);
    assertEqual(p.side, 'starboard'); assertEqual(p.sideRange, 20);
  });

  test('profile is recomputed after a loadout change', () => {
    const s = mkShip('c', 0, 0, 'standard');
    assertEqual(gunProfile(s).range, 8);
    s.loadout.B = 'long9';
    assertEqual(gunProfile(s).range, 40);
  });
});

suite('FleetCommander — fleets as control groups', () => {

  const mkState = n => {
    const st = { playerShips: [], enemyShips: [], fleets: [], getAuraRange: () => 20 };
    for (let i = 0; i < n; i++) st.playerShips.push(mkShip('s' + i, i * 6, 0));
    return st;
  };

  test('initial ships fill Fleet 1 (max 5), overflow opens Fleet 2', () => {
    const st = mkState(7);
    const fc = new FleetCommander(st, [], null);
    assertEqual(st.fleets.length, 2);
    assertEqual(fc.shipsOf(st.fleets[0].id).length, 5);
    assertEqual(st.fleets[0].num, 1); assertEqual(st.fleets[1].num, 2);
  });

  test('Ctrl+N assign moves ships and drops the emptied fleet', () => {
    const st = mkState(7);
    const fc = new FleetCommander(st, [], null);
    const two = st.playerShips.slice(5);            // the whole of Fleet 2
    const r = fc.assign(4, two);
    assert(r.ok, r.reason);
    assertEqual(fc.getFleetByNum(4).num, 4);
    assert(!fc.getFleetByNum(2), 'Fleet 2 had no ships left and should be gone');
  });

  test('a fleet never takes more than its cap', () => {
    const st = mkState(7);
    const fc = new FleetCommander(st, [], null);
    const r = fc.assign(3, st.playerShips.slice(0, 6));
    assert(!r.ok, 'six ships into one fleet must be refused');
  });
});

suite('OrderSystem — headless group orders', () => {

  const mkSys = (ships, islands = []) => {
    const st = { playerShips: ships, enemyShips: [], cmd: {} };
    return { st, os: new OrderSystem(st, islands, { hostiles: () => [] }) };
  };
  const runFor = (os, secs) => { for (let i = 0; i < secs * 60; i++) os.update(1 / 60); };

  test('a group move ends with every ship stopped in formation at the goal', () => {
    const ships = [mkShip('a', 0, 0), mkShip('b', 0, -6), mkShip('c', 3, -12, 'light')];
    const { os } = mkSys(ships);
    os.issue(ships, { type: 'move', x: 60, z: 0 });
    runFor(os, 40);
    ships.forEach(s => {
      assertEqual(s.orders.length, 0, `${s.nm} still has orders: ${os.describe(s)}`);
      assertLT(Math.abs(s.x - 60), 14, `${s.nm} x=${s.x.toFixed(1)}`);
    });
    assertEqual(os.groups.size, 0, 'finished groups are released');
  });

  test('the group sails around an island in its way', () => {
    const ships = [mkShip('a', -60, 0)];
    const islands = [isl(0, 0, 14)];
    const { os } = mkSys(ships, islands);
    os.issue(ships, { type: 'move', x: 60, z: 0 });
    let closest = 1e9;
    for (let i = 0; i < 60 * 60 && ships[0].orders.length; i++) {
      os.update(1 / 60);
      closest = Math.min(closest, Math.hypot(ships[0].x, ships[0].z));
    }
    assertEqual(ships[0].orders.length, 0, 'should arrive');
    assertGT(closest, 14, `came within ${closest.toFixed(1)} u of the island centre`);
  });

  test('Shift-queued waypoints run in order', () => {
    const ships = [mkShip('a', 0, 0, 'light')];
    const { os } = mkSys(ships);
    os.issue(ships, { type: 'move', x: 30, z: 0 });
    os.issue(ships, { type: 'move', x: 30, z: 30 }, { queue: true });
    assertEqual(ships[0].orders.length, 2);
    let i = 0;
    while (ships[0].orders.length === 2 && i++ < 60 * 20) os.update(1 / 60);
    assertEqual(ships[0].orders.length, 1, 'first leg done, second pending');
    assertLT(Math.hypot(ships[0].x - 30, ships[0].z), 2, `first leg ended at (${ships[0].x.toFixed(1)},${ships[0].z.toFixed(1)})`);
    runFor(os, 20);
    assertEqual(ships[0].orders.length, 0);
    assertLT(Math.hypot(ships[0].x - 30, ships[0].z - 30), 2);
  });

  test('patrol never completes; stop clears it', () => {
    const ships = [mkShip('a', 0, 0, 'light')];
    const { os } = mkSys(ships);
    os.issue(ships, { type: 'patrol', x: 30, z: 0 });
    runFor(os, 25);
    assertEqual(ships[0].orders[0]?.type, 'patrol');
    os.stop(ships);
    assertEqual(ships[0].orders.length, 0);
  });
});
