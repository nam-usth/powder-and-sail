// ── NAVIGATION (AU) ─────────────────────────────────────────────
// Island-aware path planning for ships. Islands are circles; the planner
// builds a small visibility graph (start, goal and a ring of nodes around
// every island), keeps the edges that clear every island, and runs Dijkstra.
// Five islands × 10 nodes ≈ 50 nodes — cheap enough to run per order, never
// per frame. Pure functions: no THREE, no DOM, no game state.

import { MAP } from '../../../data/constants.js';

const RING_NODES = 10;
const EDGE = MAP / 2 - 4;   // ships are clamped to this square by MovementSystem

const clampMap = v => Math.max(-EDGE, Math.min(EDGE, v));

/** Does segment A→B pass within R of C? (strict: touching the circle is fine) */
export function segmentHitsCircle(ax, az, bx, bz, cx, cz, R) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, pz = az + dz * t - cz;
  return px * px + pz * pz < R * R - 1e-6;
}

/** Move a point out of every island it sits in (clearance included). */
export function pushOutside(x, z, islands, clearance = 4) {
  let px = x, pz = z;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const i of islands) {
      const R = i.r + clearance;
      const dx = px - i.x, dz = pz - i.z;
      const d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const ux = d > 1e-6 ? dx / d : 1, uz = d > 1e-6 ? dz / d : 0;
      px = i.x + ux * (R + 0.5);
      pz = i.z + uz * (R + 0.5);
      moved = true;
    }
    if (!moved) break;
  }
  return { x: clampMap(px), z: clampMap(pz) };
}

function blocked(ax, az, bx, bz, circles, skip) {
  for (let k = 0; k < circles.length; k++) {
    if (skip && skip.has(k)) continue;
    const c = circles[k];
    if (segmentHitsCircle(ax, az, bx, bz, c.x, c.z, c.R)) return true;
  }
  return false;
}

/**
 * Plan a path from (ax,az) to (bx,bz) around islands.
 * Returns waypoints AFTER the start, ending at the (pushed-out) goal.
 * Islands that already contain the start (a ship hugging a shore) do not
 * block the first leg, so a ship can always sail away from a coast.
 */
export function planPath(ax, az, bx, bz, islands, clearance = 4) {
  const goal = pushOutside(bx, bz, islands, clearance);
  const circles = islands.map(i => ({ x: i.x, z: i.z, R: i.r + clearance }));

  const startInside = new Set();
  circles.forEach((c, k) => { if (Math.hypot(ax - c.x, az - c.z) < c.R) startInside.add(k); });

  if (!blocked(ax, az, goal.x, goal.z, circles, startInside)) return [goal];

  // Nodes: 0 = start, 1 = goal, then rings. A ring node sits at R / cos(π/N)
  // so the polygon edge between neighbours never cuts the circle itself.
  const nodes = [{ x: ax, z: az }, goal];
  const ringR = 1 / Math.cos(Math.PI / RING_NODES);
  circles.forEach(c => {
    for (let n = 0; n < RING_NODES; n++) {
      const a = (n / RING_NODES) * Math.PI * 2;
      const x = c.x + Math.sin(a) * c.R * ringR * 1.02;
      const z = c.z + Math.cos(a) * c.R * ringR * 1.02;
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
      if (circles.some(o => Math.hypot(x - o.x, z - o.z) < o.R)) continue;
      nodes.push({ x, z });
    }
  });

  // Dijkstra over the implicit complete graph (edges checked lazily).
  const N = nodes.length;
  const dist = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
  dist[0] = 0;
  for (let iter = 0; iter < N; iter++) {
    let u = -1, best = Infinity;
    for (let k = 0; k < N; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < N; v++) {
      if (done[v]) continue;
      const a = nodes[u], b = nodes[v];
      const w = Math.hypot(b.x - a.x, b.z - a.z);
      if (dist[u] + w >= dist[v]) continue;
      if (blocked(a.x, a.z, b.x, b.z, circles, u === 0 ? startInside : null)) continue;
      dist[v] = dist[u] + w; prev[v] = u;
    }
  }

  if (!isFinite(dist[1])) return [goal];   // unreachable: fall back to steering
  const path = [];
  for (let k = 1; k > 0; k = prev[k]) path.unshift({ x: nodes[k].x, z: nodes[k].z });
  return path;
}

/** Total length of a path starting at (ax,az). */
export function pathLength(ax, az, path) {
  let L = 0, px = ax, pz = az;
  for (const p of path) { L += Math.hypot(p.x - px, p.z - pz); px = p.x; pz = p.z; }
  return L;
}
