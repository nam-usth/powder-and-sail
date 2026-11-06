import * as THREE from 'three';
// ── HARBOR TOWN (decorative district of the home port) ────────────
// Art pass 2: the home island read as an empty lawn with three starter
// buildings. This module plans and dresses a decorative town that lives
// ONLY off the 16×16 build grid (v5: on the town peninsula east of the quay
// and the east lowland): house clusters along a high street, a market where
// the arm leaves the mainland, awning stalls on the quay apron between the piers, crates /
// barrels / carts, dirt paths with stone steps up the hills, and chimney smoke.
//
// Cost: everything is baked into the island's harbor ModelKit (one draw call
// per material kind, shared with the quay/rim dressing) plus ONE THREE.Points
// draw for all the smoke (GPU-animated, no per-frame CPU work).
// Tiers: HIGH = houses + windows/chimneys/clutter + smoke; LOW = the house
// shells, roofs, stalls and steps only (ModelKit `hi` parts dropped), no smoke.
//
// Pure planning (planHarborTown) only reads the island's analytic SDF/height
// helpers, so the plan is deterministic and runs before the terrain is meshed
// (paths are painted into the terrain vertex colours by IslandEntity).
import { makePrng, harborLandSDF, harborWaterSDF, HARBOR } from '../../data/islandShapes.js';
import { BUILD_DECK_Y } from '../../data/constants.js';
import { PALETTE as P } from './BuildingModels.js';

const D = BUILD_DECK_Y;
const TAU = Math.PI * 2;

/** Wall tints (lime-washed coral plaster, pastels of a Caribbean port town). */
const WALLS = [P.plaster, P.plasterW, P.ochre, 0xA9C3C9, 0xE2B7A0, 0xB7CFA4, 0xE8D7A8, P.plaster];
const ROOFS = [P.terra, P.terraDk, P.terra, P.shingle, P.thatch, 0xA4583C];
/** Market awning stripe pairs. */
const AWNINGS = [[0xB8402F, P.canvas], [0x2F5E8A, P.canvas], [0xD99A2B, 0x8E3E2A], [0x3E7068, P.canvas]];

/**
 * Cluster hubs (island-local x, z, houses wanted, spread). Outside the build
 * grid (|x|,|z| ≤ 19.2 is the grid square); the planner rejects every lot that
 * would touch a valid cell, the water, the rim or a landmark anyway.
 */
const HUBS = [                       // v5: the town fills the peninsula east of the quay
  [28.6, 4.5, 6, 2.4, 'market'],    // market square where the arm leaves the mainland
  [30.2, 12.5, 7, 2.6],
  [30.6, 21.0, 7, 2.6],
  [30.4, 29.5, 6, 2.4],
  [23.5, -5.5, 5, 2.4],             // east lowland, behind the grid's east edge
  [33.5, 0.5, 5, 2.2],
]

const MAX_LOTS = 70;               // decorative houses cap (HIGH and LOW draw the same shells)
const HIGH_ST_X = HARBOR.quayX + 4.6;   // the street behind the quay apron
/** Houses on the arm face the high street; the rest face the island centre. */
const facing = (x, z) => z > 3 ? (x > HIGH_ST_X ? -Math.PI / 2 : Math.PI / 2) : Math.atan2(-x, -z);
const KIND_SIZE = {                 // half-extent footprint [w/2, d/2]
  cottage: [0.85, 0.7], tall: [0.9, 0.8], shed: [0.75, 0.6], warehouse: [1.35, 0.8], stall: [0.75, 0.55],
};

/**
 * Plan the town for a HARBOR island.
 * @param {object} isl  IslandEntity (uses _heightAt, _sdf, _inCell, _noDecor, _paveAt)
 * @returns {{lots:object[], paths:number[][][], steps:object[], props:number[][], stalls:object[], chimneys:number[][]}}
 */
export function planHarborTown(isl) {
  const rnd = makePrng(20251);
  const lots = [], paths = [], steps = [], props = [], stalls = [], chimneys = [];
  // hard keep-outs only (the palisade / revetment keep-outs of the rim are vegetation-only):
  // landmarks, the sea-wall line, the wreck, rim boulders
  const keep = [];
  if (isl._fortLocal) keep.push([isl._fortLocal.x, isl._fortLocal.z, 4.2]);
  if (isl._lightLocal) keep.push([isl._lightLocal.x, isl._lightLocal.z, 2.4]);
  if (isl._wreck) keep.push([isl._wreck.x, isl._wreck.z, 4.0]);
  for (const arc of isl._wallArcs || []) {
    for (let i = 0; i < arc.pts.length - 1; i++) {
      const [ax, az] = arc.pts[i], [bx, bz] = arc.pts[i + 1];
      for (const t of [0, 0.5]) keep.push([ax + (bx - ax) * t, az + (bz - az) * t, 1.0]);
    }
    const e = arc.pts;
    for (const i of [0, e.length >> 1, e.length - 1]) keep.push([e[i][0], e[i][1], 2.2]);      // bastions
  }
  for (const [x, , z, r] of (isl._rim?.rocks || []).concat(isl._rim?.rocks2 || [])) keep.push([x, z, r * 0.9]);
  const blocked = (x, z, r) => keep.some(([nx, nz, nr]) => (x - nx) ** 2 + (z - nz) ** 2 < (nr + r) ** 2);
  const lotFree = (x, z, r) => lots.every(l => (x - l.x) ** 2 + (z - l.z) ** 2 > (r + l.r + 0.2) ** 2);

  /** Footprint check: land, off the grid, level enough; returns {lo, hi} heights or null. */
  const site = (x, z, hw, hd, ry, r) => {
    if (harborLandSDF(x, z) > -1.5 || isl._sdf(x, z) > -0.9) return null;
    if (harborWaterSDF(x, z) < 1.2 || isl._paveAt(x, z) > 0) return null;
    if (isl._inCell(x, z, 0.1) || blocked(x, z, r * 0.8) || !lotFree(x, z, r)) return null;
    const c = Math.cos(ry), s = Math.sin(ry);
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [0, hd], [0, -hd], [hw, 0], [-hw, 0]]) {
      const px = x + u * c + v * s, pz = z - u * s + v * c;
      if (isl._inCell(px, pz, 0.15)) return null;
      const h = isl._heightAt(px, pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (lo < D - 0.15 || hi - lo > 1.0) return null;
    return { lo, hi };
  };

  for (const [hx, hz, want, spread, tag] of HUBS) {
    let n = 0;
    const hubLots = [];
    for (let tries = 0; tries < 600 && n < want; tries++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * spread * 1.6;
      const x = hx + Math.sin(a) * d, z = hz + Math.cos(a) * d;
      const roll = rnd();
      const kind = tag === 'market' && n < 3 ? 'stall'
        : roll < 0.42 ? 'cottage' : roll < 0.62 ? 'tall' : roll < 0.84 ? 'shed' : 'warehouse';
      const [hw, hd] = KIND_SIZE[kind];
      // face the island centre (where the town looks over the harbor), snapped a little toward the hub street
      const ry = facing(x, z) + (rnd() - 0.5) * 0.3;
      const r = Math.hypot(hw, hd) + 0.1;
      const s = site(x, z, hw + 0.15, hd + 0.15, ry, r);
      if (!s) continue;
      const lot = { hub: hx, kind, x, z, ry, r, hw, hd, floor: s.hi + 0.04, base: s.lo - 0.35, seed: rnd(),
                    wall: WALLS[Math.floor(rnd() * WALLS.length)], roof: ROOFS[Math.floor(rnd() * ROOFS.length)] };
      if (kind === 'stall') lot.awning = AWNINGS[Math.floor(rnd() * AWNINGS.length)];
      lots.push(lot); hubLots.push(lot); n++;
      // clutter beside the door (HIGH)
      if (kind !== 'stall' && rnd() < 0.7) {
        const sd = rnd() < 0.5 ? -1 : 1, c = Math.cos(ry), sn = Math.sin(ry);
        const u = sd * (hw + 0.3), v = hd * 0.2;
        const px = x + u * c + v * sn, pz = z - u * sn + v * c;
        if (!isl._inCell(px, pz, 0.3) && harborLandSDF(px, pz) < -1.6) props.push([px, isl._heightAt(px, pz), pz, Math.floor(rnd() * 4), rnd() * TAU]);
      }
    }
    if (!hubLots.length) continue;
    // a dirt lane from the hub to the high street behind the quay
    const cx = hubLots.reduce((s, l) => s + l.x, 0) / hubLots.length, cz = hubLots.reduce((s, l) => s + l.z, 0) / hubLots.length;
    paths.push([[cx, cz], [cz > 4 ? HIGH_ST_X : Math.min(cx, 21), cz > 4 ? cz : Math.max(cz, -2)]]);
    if (tag === 'market') {      // market square props: crates, barrels, a cart
      for (let i = 0; i < 6; i++) {
        const a = rnd() * TAU, d = 0.6 + rnd() * 1.4, px = cx + Math.sin(a) * d, pz = cz + Math.cos(a) * d;
        if (!isl._inCell(px, pz, 0.3) && lotFree(px, pz, 0.25) && harborLandSDF(px, pz) < -1.8)
          props.push([px, isl._heightAt(px, pz), pz, i === 0 ? 4 : Math.floor(rnd() * 4), rnd() * TAU]);
      }
    }
  }
  // infill: every other level spot on the peninsula and the east lowland gets a small house/shed
  for (let tries = 0; tries < 5000 && lots.length < MAX_LOTS; tries++) {
    const x = 19.3 + rnd() * 20, z = -12 + rnd() * 54;
    const roll = rnd(), kind = roll < 0.5 ? 'cottage' : roll < 0.8 ? 'shed' : 'tall';
    const [hw, hd] = KIND_SIZE[kind];
    const ry = facing(x, z) + (rnd() - 0.5) * 0.4, r = Math.hypot(hw, hd) + 0.1;
    const st = site(x, z, hw + 0.12, hd + 0.12, ry, r);
    if (!st) continue;
    lots.push({ hub: 'fill', kind, x, z, ry, r, hw, hd, floor: st.hi + 0.04, base: st.lo - 0.35, seed: rnd(),
                wall: WALLS[Math.floor(rnd() * WALLS.length)], roof: ROOFS[Math.floor(rnd() * ROOFS.length)] });
    if (rnd() < 0.5) {
      const sd = rnd() < 0.5 ? -1 : 1, c = Math.cos(ry), sn = Math.sin(ry), u = sd * (hw + 0.3), v = hd * 0.2;
      const px = x + u * c + v * sn, pz = z - u * sn + v * c;
      if (!isl._inCell(px, pz, 0.3) && harborLandSDF(px, pz) < -1.6) props.push([px, isl._heightAt(px, pz), pz, Math.floor(rnd() * 4), rnd() * TAU]);
    }
  }
  // the high street: from the lowland up the peninsula behind the quay apron
  paths.push([[20.0, -2.0], [HIGH_ST_X, 5.0], [HIGH_ST_X, HARBOR.quayZ1 + 1.5]]);
  // quay-apron stalls between the piers (the apron is turned onto the peninsula's west face)
  const zc = (HARBOR.quayZ0 + HARBOR.quayZ1) / 2;
  for (const a of [-8.0, -1.6, 5.0, 10.4]) {
    stalls.push({ kind: 'stall', x: HARBOR.quayX + 0.62, z: zc + a, ry: Math.PI / 2, hw: 0.7, hd: 0.36, floor: D, base: D - 0.05,
                  awning: AWNINGS[(Math.abs(a * 3) | 0) % AWNINGS.length], seed: Math.abs(a) * 0.07 + 0.1, quay: true });
  }
  // paths: steps where they climb, keep-outs for vegetation along them
  for (const pl of paths) {
    for (let i = 0; i < pl.length - 1; i++) {
      const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.45));
      let prev = isl._heightAt(ax, az);
      for (let j = 1; j <= n; j++) {
        const t = j / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, h = isl._heightAt(x, z);
        if (Math.abs(h - prev) > 0.09 && !isl._inCell(x, z, 0.05)) steps.push({ x, z, y: Math.max(h, prev), ry: Math.atan2(bx - ax, bz - az) });
        prev = h;
        if (j % 2 === 0) isl._noDecor.push([x, z, 0.75]);
      }
    }
  }
  for (const l of lots) {
    isl._noDecor.push([l.x, l.z, l.r + 0.25]);
    if (l.kind === 'cottage' || l.kind === 'tall') {
      const c = Math.cos(l.ry), s = Math.sin(l.ry), u = l.hw * 0.55 * (l.seed < 0.5 ? -1 : 1), v = -l.hd * 0.3;
      const top = l.floor + (l.kind === 'tall' ? 2.55 : 1.75);
      l.chimney = [l.x + u * c + v * s, top, l.z - u * s + v * c];
      chimneys.push(l.chimney);
    }
  }
  return { lots, paths, steps, props, stalls, chimneys };
}

/** 0..1 street weight at local x,z (painted into the terrain as packed earth). */
export function townPathAt(plan, x, z) {
  if (!plan) return 0;
  let best = 0;
  for (const pl of plan.paths) for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    best = Math.max(best, 1 - Math.max(0, Math.min(1, (d - 0.45) / 0.35)));
    // the hub end opens into a small square
    const dh = Math.hypot(x - ax, z - az);
    best = Math.max(best, 1 - Math.max(0, Math.min(1, (dh - 1.7) / 0.5)));
  }
  return best;
}

const faces = (side, top) => [side, side, top, side, side, side];

/**
 * Dress the planned town into a ModelKit (island-local coordinates).
 * `hi` parts only go into the HIGH bake.
 */
export function dressHarborTown(k, plan) {
  for (const l of plan.lots) house(k, l);
  for (const s of plan.stalls) house(k, s);
  for (const st of plan.steps)
    k.box('matte', 0.95, 0.12, 0.42, st.x, st.y - 0.1, st.z, faces(P.stoneDk, P.stone), { ry: st.ry, jit: 0.1 });
  for (const [x, y, z, t, ry] of plan.props) prop(k, x, y, z, t, ry);
}

function house(k, l) {
  const c = Math.cos(l.ry), s = Math.sin(l.ry);
  const at = (u, v) => [l.x + u * c + v * s, l.z - u * s + v * c];
  const B = (kind, w, h, d, u, y, v, col, o = {}) => { const [x, z] = at(u, v); k.box(kind, w, h, d, x, y, z, col, { ...o, ry: l.ry + (o.ry || 0) }); };
  const F = l.floor, hw = l.hw, hd = l.hd, W = hw * 2, Dp = hd * 2;
  // stone plinth down to the slope
  if (!l.quay) B('matte', W + 0.12, F - l.base, Dp + 0.12, 0, l.base, 0, faces(P.stoneDk, P.stone), { jit: 0.1 });
  const door = (u, h = 0.62) => B('matte', 0.3, h, 0.04, u, F, hd + 0.01, P.timberDk);
  const win = (u, y, lit) => {
    B('matte', 0.3, 0.3, 0.03, u, F + y - 0.03, hd + 0.005, P.white, { hi: true, jit: 0.03 });
    B(lit ? 'glow' : 'gloss', 0.22, 0.24, 0.04, u, F + y, hd + 0.015, lit ? P.window : P.glass, { hi: true });
  };
  const seed = l.seed;
  switch (l.kind) {
    case 'cottage': {
      const H = 0.95 + seed * 0.2;
      B('matte', W, H, Dp, 0, F, 0, faces(l.wall, l.wall), { jit: 0.06 });
      const [x, z] = at(0, 0);
      k.gable('matte', Dp + 0.3, 0.62, W + 0.24, x, F + H, z, l.roof, l.wall, { ry: l.ry + Math.PI / 2, jit: 0.08 });
      door(seed < 0.5 ? -0.2 : 0.2);
      win(seed < 0.5 ? 0.35 : -0.35, 0.42, seed > 0.62);
      chimney(k, l);
      break;
    }
    case 'tall': {
      const H = 1.75;
      B('matte', W, H, Dp, 0, F, 0, faces(l.wall, l.wall), { jit: 0.06 });
      B('matte', W + 0.04, 0.08, Dp + 0.04, 0, F + 0.86, 0, P.stoneLt, { hi: true });          // string course
      const [x, z] = at(0, 0);
      k.hip('matte', W + 0.26, 0.62, Dp + 0.26, 0.28, x, F + H, z, l.roof, { ry: l.ry, jit: 0.08 });
      door(0, 0.66);
      win(-0.45, 0.42, false); win(0.45, 0.42, seed > 0.5);
      win(-0.45, 1.22, seed > 0.3); win(0.45, 1.22, false); win(0, 1.22, false);
      B('matte', W * 0.7, 0.05, 0.3, 0, F + 0.95, hd + 0.15, P.timber, { hi: true });            // balcony
      B('matte', W * 0.7, 0.24, 0.03, 0, F + 1.0, hd + 0.3, P.timberDk, { hi: true });
      chimney(k, l);
      break;
    }
    case 'shed': {
      const H = 0.85;
      B('matte', W, H, Dp, 0, F, 0, faces(P.plank, P.plankLt), { jit: 0.14 });
      for (const u of [-hw + 0.05, hw - 0.05]) B('matte', 0.09, H + 0.05, 0.09, u, F, hd + 0.02, P.timberDk, { hi: true });
      const [x, z] = at(0, -0.05);
      k.gable('matte', Dp + 0.28, 0.48, W + 0.22, x, F + H, z, seed < 0.5 ? P.shingle : P.thatch, P.plank, { ry: l.ry + Math.PI / 2, jit: 0.12 });
      B('matte', 0.5, 0.6, 0.04, 0, F, hd + 0.01, P.timberDk);
      break;
    }
    case 'warehouse': {
      const H = 1.25;
      B('matte', W, H, Dp, 0, F, 0, faces(P.timber, P.plank), { jit: 0.12 });
      B('matte', W + 0.04, 0.14, Dp + 0.04, 0, F, 0, P.stoneDk, { jit: 0.08 });
      const [x, z] = at(0, 0);
      k.gable('matte', Dp + 0.3, 0.7, W + 0.28, x, F + H, z, P.shingle, P.timber, { ry: l.ry + Math.PI / 2, jit: 0.1 });
      B('matte', 0.7, 0.85, 0.04, 0, F, hd + 0.01, P.timberDk);
      B('matte', 0.04, 0.85, 0.05, 0, F, hd + 0.03, P.timber, { hi: true });
      B('matte', 0.14, 0.14, 0.9, 0, F + H + 0.35, hd + 0.2, P.timberDk, { hi: true });          // hoist beam
      B('matte', 0.02, 0.5, 0.02, 0, F + H - 0.1, hd + 0.6, P.rope, { hi: true });
      break;
    }
    case 'stall': {
      const [a, b] = l.awning, ph = 0.95, sw = W, sd = Dp;
      for (const u of [-hw + 0.06, hw - 0.06]) for (const v of [-hd + 0.06, hd - 0.06])
        B('matte', 0.06, v > 0 ? ph : ph + 0.25, 0.06, u, F, v, P.timberDk);
      // striped awning, sloping down to the front
      const n = 5;
      for (let i = 0; i < n; i++) {
        const u = -sw / 2 + (i + 0.5) * sw / n;
        B('matte', sw / n + 0.01, 0.03, sd + 0.3, u, F + ph + 0.12, 0.05, i % 2 ? b : a, { rx: 0.22, jit: 0.04 });
      }
      B('matte', sw - 0.1, 0.38, 0.32, 0, F, hd - 0.2, faces(P.plank, P.plankLt), { jit: 0.1 });   // counter
      // goods on the counter (HIGH): fruit, cloth, fish
      const goods = [0xD9862B, 0x7FA03A, 0xC8352B, 0xE8D7A8, 0x9AB7C2];
      for (let i = 0; i < 4; i++)
        B('matte', 0.16, 0.09, 0.14, -sw / 2 + 0.25 + i * (sw - 0.4) / 3, F + 0.38, hd - 0.2, goods[(i + Math.floor(seed * 9)) % goods.length], { hi: true, jit: 0.15 });
      B('matte', 0.3, 0.27, 0.3, hw - 0.25, F, -hd + 0.25, faces(P.plankLt, P.wood), { hi: true, jit: 0.12 });
      break;
    }
  }
}

function chimney(k, l) {
  if (!l.chimney) return;
  const [x, top, z] = l.chimney, base = l.floor + 0.6;
  k.box('matte', 0.24, top - base, 0.24, x, base, z, faces(P.stoneDk, P.stone), { hi: true, ry: l.ry, jit: 0.08 });
  k.box('matte', 0.3, 0.06, 0.3, x, top - 0.02, z, P.stoneDk, { hi: true, ry: l.ry });
}

/** 0 crate stack, 1 barrels, 2 sacks, 3 crate + barrel, 4 hand cart. All HIGH-only. */
function prop(k, x, y, z, t, ry) {
  const o = { hi: true };
  const crate = (px, py, pz, s, r = 0) => k.box('matte', s, s * 0.9, s, px, py, pz, faces(P.plankLt, P.wood), { ...o, jit: 0.12, ry: ry + r });
  const barrel = (px, py, pz) => k.cyl('matte', 0.16, 0.14, 0.42, 8, px, py, pz, [P.timber, P.wood, P.timber], o);
  const c = Math.cos(ry), s = Math.sin(ry), at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  const p3 = (u, v, yy = y) => { const [px, pz] = at(u, v); return [px, yy, pz]; };
  if (t === 0) { crate(x, y, z, 0.4); crate(...p3(0.38, 0.05), 0.34, 0.3); crate(x, y + 0.36, z, 0.3, 0.6); }
  else if (t === 1) { barrel(x, y, z); barrel(...p3(0.32, 0.1)); barrel(...p3(0.12, 0.34)); }
  else if (t === 2) { for (let i = 0; i < 3; i++) { const [px, pz] = at(i * 0.26 - 0.26, (i % 2) * 0.12); k.sphere('matte', 0.15, px, y + 0.1, pz, 0xCDB98C, { ...o, sy: 0.7, w: 6, hs: 4 }); } }
  else if (t === 3) { crate(x, y, z, 0.42); barrel(...p3(0.4, 0)); }
  else {
    k.box('matte', 0.9, 0.08, 0.55, x, y + 0.3, z, P.plank, { ...o, ry });
    for (const sz of [-1, 1]) { const [px, pz] = at(0.1, sz * 0.33); k.cyl('matte', 0.22, 0.22, 0.06, 8, px, y + 0.22, pz, P.timberDk, { ...o, rx: Math.PI / 2, ry, c: true }); }
    const [hx, hz] = at(0.8, 0); k.box('matte', 0.75, 0.05, 0.05, hx, y + 0.28, hz, P.timberDk, { ...o, ry, rz: 0.25 });
    crate(...p3(-0.15, 0, y + 0.38), 0.32, 0.3);
  }
}

// ── Chimney smoke: one Points draw, rise + drift + fade in the vertex shader ──
const PUFFS = 7;
/**
 * @param {number[][]} chimneys  [x, topY, z] island-local
 * @param {{value:number}} timeU shared time uniform
 * @returns {THREE.Points|null}
 */
export function makeChimneySmoke(chimneys, timeU) {
  if (!chimneys.length) return null;
  const n = chimneys.length * PUFFS;
  const base = new Float32Array(n * 3), seed = new Float32Array(n);
  chimneys.forEach(([x, y, z], i) => {
    for (let j = 0; j < PUFFS; j++) {
      const v = i * PUFFS + j;
      base[v * 3] = x; base[v * 3 + 1] = y + 0.05; base[v * 3 + 2] = z;
      seed[v] = j / PUFFS + (i * 0.618) % 1 * 0.13;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 60);
  const uPx = { value: 600 };
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: timeU, uPx, uCol: { value: new THREE.Color(0xE4DFD6) } },
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uT, uPx; varying float vA;
      void main(){
        float life = fract(uT * 0.11 + aSeed);
        vec3 p = position + vec3(0.9 * life * life + 0.12 * sin(uT * 0.7 + aSeed * 40.0), 2.2 * life, -0.35 * life * life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.35 + 0.95 * life) * uPx / max(1.0, -mv.z);
        vA = smoothstep(0.0, 0.12, life) * (1.0 - life) * 0.6;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
        gl_FragColor = vec4(uCol, vA * (1.0 - r) * (1.0 - r)); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(g, m);
  pts.name = 'town-smoke';
  pts.renderOrder = 3;
  pts.frustumCulled = false;
  pts.onBeforeRender = (renderer, scene, cam) => {
    const h = renderer.getRenderTarget()?.height || renderer.domElement.height;
    uPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov || 45) / 2));
  };
  return pts;
}
