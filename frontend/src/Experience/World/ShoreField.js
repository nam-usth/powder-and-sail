import * as THREE from 'three';

// ── SHORE FIELD — signed distance to every island's waterline ─────
// The ocean needs "how far is this point from the nearest shore" for the
// lagoon shelf colour, the shoreline foam and the calm water near land, and
// getWaveHeight needs the very same value (ships must ride the drawn sea).
//
// Circular islands are evaluated analytically (no texture). As soon as one
// island has a real outline — a harbour wrapped around a bay, a crescent —
// the whole set is baked into a signed distance field over the play area:
//
//   island.shore   world-space waterline polygon(s): [[x,z],…] or [[[x,z],…],…]
//   island.landAt  (x, z) => boolean — true where land breaks the surface
//   otherwise      a circle: (x, z, r × shape factor)
//
// Bake: land rasterised at ~0.86 u, exact Euclidean distance transform
// (Felzenszwalb–Huttenlocher, separable, O(n)) inside and outside, signed,
// unioned with the circles. One RGBA8 texture (16-bit distance in R,G —
// linear filtering stays exact because it is linear per channel) for the
// shaders, and the same Float32 grid, sampled bilinearly, for the CPU.
// Runs once per Ocean.setIslands() call (~15-30 ms), never per frame.

export const FIELD_HALF = 220;          // covers [-220, 220]² world units
export const FIELD_N    = 512;          // texels per side (0.86 u)
export const D_MIN = -24, D_RANGE = 128; // encoded distance range (world u)

const INF = 1e20;

// 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher)
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared distance (in texels) from every cell to the nearest cell where mask === on. */
function edt2d(mask, n, on) {
  const g = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = mask[i] === on ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) {           // columns
    for (let y = 0; y < n; y++) f[y] = g[y * n + x];
    edt1d(f, n, d, v, z);
    for (let y = 0; y < n; y++) g[y * n + x] = d[y];
  }
  for (let y = 0; y < n; y++) {           // rows
    const o = y * n;
    for (let x = 0; x < n; x++) f[x] = g[o + x];
    edt1d(f, n, d, v, z);
    for (let x = 0; x < n; x++) g[o + x] = d[x];
  }
  return g;
}

function pointInPolys(x, z, polys) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
  }
  return inside;
}

/** Normalise island.shore into [[[x,z],…],…] (accepts {x,z} points too). */
function polysOf(shore) {
  if (!Array.isArray(shore) || !shore.length) return null;
  const pt = p => Array.isArray(p) ? [+p[0], +p[1]] : [+(p.x), +(p.z ?? p.y)];
  const nested = Array.isArray(shore[0]) && (Array.isArray(shore[0][0]) || typeof shore[0][0] === 'object');
  const list = nested ? shore : [shore];
  return list.map(poly => poly.map(pt)).filter(p => p.length >= 3);
}

/**
 * Bake the signed shore field for a set of islands.
 * @param {Array<{x:number,z:number,R:number,shore?:any,landAt?:Function}>} isl
 *   normalised islands (R = circle waterline radius)
 * @returns {{dist:Float32Array, texture:THREE.DataTexture}}
 */
export function bakeShoreField(isl) {
  const n = FIELD_N, cell = (2 * FIELD_HALF) / n;
  const mask = new Uint8Array(n * n);
  const shaped = isl.filter(i => i.landAt || i.polys);
  for (const s of shaped) {
    // rasterise only the island's bounding square (generous: 2.5 r)
    const reach = Math.max(8, (s.r || 20) * 2.5);
    const x0 = Math.max(0, Math.floor((s.x - reach + FIELD_HALF) / cell)), x1 = Math.min(n - 1, Math.ceil((s.x + reach + FIELD_HALF) / cell));
    const z0 = Math.max(0, Math.floor((s.z - reach + FIELD_HALF) / cell)), z1 = Math.min(n - 1, Math.ceil((s.z + reach + FIELD_HALF) / cell));
    for (let zi = z0; zi <= z1; zi++) {
      const wz = -FIELD_HALF + (zi + 0.5) * cell;
      for (let xi = x0; xi <= x1; xi++) {
        const wx = -FIELD_HALF + (xi + 0.5) * cell;
        if (mask[zi * n + xi]) continue;
        const land = s.landAt ? !!s.landAt(wx, wz) : pointInPolys(wx, wz, s.polys);
        if (land) mask[zi * n + xi] = 1;
      }
    }
  }
  const out = shaped.length ? edt2d(mask, n, 1) : null;   // to the nearest land
  const inn = shaped.length ? edt2d(mask, n, 0) : null;   // to the nearest water
  const dist = new Float32Array(n * n);
  const circles = isl.filter(i => !(i.landAt || i.polys));
  for (let zi = 0, k = 0; zi < n; zi++) {
    const wz = -FIELD_HALF + (zi + 0.5) * cell;
    for (let xi = 0; xi < n; xi++, k++) {
      const wx = -FIELD_HALF + (xi + 0.5) * cell;
      let d = 1e4;
      if (out) d = mask[k] ? -(Math.sqrt(inn[k]) - 0.5) * cell : (Math.sqrt(out[k]) - 0.5) * cell;
      for (let ci = 0; ci < circles.length; ci++) {
        const c = circles[ci], dx = wx - c.x, dz = wz - c.z;
        const dc = Math.sqrt(dx * dx + dz * dz) - c.R;
        if (dc < d) d = dc;
      }
      dist[k] = d;
    }
  }
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const q = Math.round(Math.min(1, Math.max(0, (dist[k] - D_MIN) / D_RANGE)) * 65535);
    data[k * 4] = q >> 8; data[k * 4 + 1] = q & 255; data[k * 4 + 2] = 0; data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { dist, texture: tex };
}

/** Bilinear sample of a baked field at world (x, z), matching the GPU lookup. */
export function sampleShoreField(dist, x, z) {
  const n = FIELD_N, cell = (2 * FIELD_HALF) / n;
  const cx = Math.min(FIELD_HALF, Math.max(-FIELD_HALF, x)), cz = Math.min(FIELD_HALF, Math.max(-FIELD_HALF, z));
  const gx = Math.min(n - 1, Math.max(0, (cx + FIELD_HALF) / cell - 0.5));
  const gz = Math.min(n - 1, Math.max(0, (cz + FIELD_HALF) / cell - 0.5));
  const x0 = Math.floor(gx), z0 = Math.floor(gz), x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const fx = gx - x0, fz = gz - z0;
  const a = dist[z0 * n + x0], b = dist[z0 * n + x1], c = dist[z1 * n + x0], d = dist[z1 * n + x1];
  const v = (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  return Math.min(D_MIN + D_RANGE, v) + Math.hypot(x - cx, z - cz);
}

/** Normalise one island-like object; null if unusable. */
export function normaliseIsland(isl, shoreK) {
  if (!isl) return null;
  const x = isl.x ?? isl.def?.x, z = isl.z ?? isl.def?.z, r = isl.r ?? isl.def?.r;
  if (![x, z, r].every(Number.isFinite)) return null;
  const shape = isl.shapeType || isl.def?.shape || isl.shape;
  const polys = polysOf(isl.shore);
  const landAt = typeof isl.landAt === 'function' ? isl.landAt.bind(isl) : null;
  return { x, z, r, R: r * (shoreK[shape] || 1.12), polys, landAt };
}
