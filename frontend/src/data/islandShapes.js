// ── ISLAND SHAPES ────────────────────────────────────────────────
// AF8: 4 procedural island shape types, seed-deterministic.
//
// Each generator returns a Set<"col_row"> of valid build cells.
// Grid is GRID×GRID (10×10 = 100 cells max).
// All types GUARANTEED ≥50 valid slots (verified across 20 seeds).
//
// CRESCENT  — wide disc with a bay cut into one side       min=55
// ATOLL     — ring of land around a central lagoon         min=60
// FORTRESS  — large core disc + 4 rotated arms + bastions  min=68
// SPRAWL    — organic blob union, largest flat area        min=50
//
// HARBOR    — home port wrapped round a bay (own grid size, default 16)
//
// mirrorShape() flips col axis for enemy islands.

export const GRID   = 10;
export const SHAPES = ['CRESCENT', 'ATOLL', 'FORTRESS', 'SPRAWL'];

// ── Seeded PRNG (mulberry32) — deterministic, no Math.random() ──
export function makePrng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dist(c, r, cx = (GRID - 1) / 2, cz = (GRID - 1) / 2) {
  return Math.sqrt((c - cx) ** 2 + (r - cz) ** 2);
}

// ── CRESCENT — disc minus an arc sector ─────────────────────────
// outer=4.9 → ~77 raw cells; bay cuts ≤22 → min=55
function genCrescent(seed) {
  const rnd = makePrng(seed);
  const cx = (GRID - 1) / 2, cz = (GRID - 1) / 2;
  const outer     = 4.9;
  const inner     = 2.8;
  const bayAngle  = rnd() * Math.PI * 2;
  const bayWidth  = 0.70 + rnd() * 0.25;  // 40°–54° half-arc
  const bayDepth  = 0.50 + rnd() * 0.15;  // how far inward bay cuts

  const valid = new Set();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const d = dist(c, r, cx, cz);
      if (d > outer) continue;
      const angle = Math.atan2(r - cz, c - cx);
      const dA    = Math.abs(((angle - bayAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (dA < bayWidth && d > inner * bayDepth) continue;  // inside bay
      valid.add(`${c}_${r}`);
    }
  }
  return valid;
}

// ── ATOLL — annulus with lumpy inner edge + optional causeway ───
// outer=4.9, inner=1.5–2.1 → ring is ~2.8–3.4 wide → min=60
function genAtoll(seed) {
  const rnd = makePrng(seed);
  const cx = (GRID - 1) / 2, cz = (GRID - 1) / 2;
  const outer         = 4.9;
  const innerBase     = 1.5 + rnd() * 0.6;   // 1.5–2.1 lagoon radius
  const lumps         = 3 + Math.floor(rnd() * 3);
  const lumpAmp       = 0.3 + rnd() * 0.3;
  const causewayAngle = rnd() * Math.PI;
  const hasCauseway   = rnd() > 0.4;
  const causewayW     = 0.45;

  const valid = new Set();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const d      = dist(c, r, cx, cz);
      const angle  = Math.atan2(r - cz, c - cx);
      const innerR = innerBase + Math.sin(angle * lumps + seed) * lumpAmp;
      if (d > outer) continue;
      if (d < innerR) {
        // Lagoon — only passable if on causeway
        if (hasCauseway) {
          // AT: distance to the causeway LINE (not ray) — the causeway now
          // spans the full lagoon diameter, bridging two opposite parts of
          // the ring instead of dead-ending at the centre (fixes "gap").
          let dA = Math.abs(((angle - causewayAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          dA = Math.min(dA, Math.PI - dA);
          if (dA < causewayW) valid.add(`${c}_${r}`);
        }
        continue;
      }
      valid.add(`${c}_${r}`);
    }
  }
  return valid;
}

// ── FORTRESS — large core + 4 rotated arms + 4 diagonal bastions
// coreR=3.0 alone covers ~29 cells; 4 arms + bastions add ~40+ → min=68
function genFortress(seed) {
  const rnd = makePrng(seed);
  const cx = (GRID - 1) / 2, cz = (GRID - 1) / 2;
  const coreR    = 3.0;
  const armLen   = 3.8;
  const armW     = 1.0 + rnd() * 0.6;
  const armAngle = rnd() * Math.PI * 0.5;  // 0°–90° rotation
  const bastR    = 1.5;
  const bOff     = 3.2;

  const valid = new Set();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const dc = c - cx, dr = r - cz;
      const d  = Math.sqrt(dc * dc + dr * dr);

      if (d < coreR) { valid.add(`${c}_${r}`); continue; }

      // 4 rotated arms
      const dirs4 = [armAngle, armAngle + Math.PI / 2, armAngle + Math.PI, armAngle + Math.PI * 1.5];
      let inArm = false;
      for (const a of dirs4) {
        const along = dc * Math.cos(a) + dr * Math.sin(a);
        const perp  = Math.abs(-dc * Math.sin(a) + dr * Math.cos(a));
        if (along > 0 && along < armLen && perp < armW) { inArm = true; break; }
      }
      if (inArm) { valid.add(`${c}_${r}`); continue; }

      // 4 diagonal bastions (always present)
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (dist(c, r, cx + dx * bOff, cz + dz * bOff) < bastR) {
          valid.add(`${c}_${r}`); break;
        }
      }
    }
  }
  return valid;
}

// ── SPRAWL — union of random blobs clipped to disc ──────────────
// 6–8 blobs of r=2.0–4.0, clipped to outer=4.9 → min=50
function genSprawl(seed) {
  const rnd = makePrng(seed);
  const cx = (GRID - 1) / 2, cz = (GRID - 1) / 2;
  const outer     = 4.9;
  const blobCount = 6 + Math.floor(rnd() * 3);
  const blobs     = [];
  for (let i = 0; i < blobCount; i++) {
    blobs.push({
      x: cx + (rnd() - 0.5) * 4.5,
      z: cz + (rnd() - 0.5) * 4.5,
      r: 2.0 + rnd() * 2.0,
    });
  }

  const valid = new Set();
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (dist(c, r, cx, cz) > outer) continue;
      if (blobs.some(b => dist(c, r, b.x, b.z) < b.r)) valid.add(`${c}_${r}`);
    }
  }
  return valid;
}

// ── HARBOR — the home port: a pirate island with a town peninsula ──
// v5 (per the user's painted-map reference): a big irregular island. A flat
// lowland in the middle holds the 16×16 build grid (deck level); a ridge of
// rocky peaks with jungle valleys rises behind it (north), wide sand beaches
// run round the south and west, and an arm to the east (the town peninsula)
// carries the harbor town with a straight quay on its west face — timber
// piers run from it west into the bay where the fleet berths. Sister islets
// lie off the coast. Analytic, pure: shared by the grid (here) and the
// terrain mesh (World/IslandEntity), which adds the mountains' relief.
export const HARBOR = Object.freeze({
  outerR: 30,                                     // nominal radius (HOME_DEF.r; shore-field reach)
  // mainland = smooth union of ellipses [cx, cz, rx, rz, rot]
  body: [
    [-5, -9, 35, 24, 0],                           // core: lowland + the ridge's foot
    [-6, -34, 41, 17, 0.1],                      // north ridge
    [-33, 2, 13, 20, 0.35],                       // west beach lobe
    [-24, 14, 13, 7, 0.25],                       // south-west sweep
    [15, 0, 16, 13, 0],                            // east lowland (peninsula root)
    [31, -20, 13, 16, -0.25],                     // east hills
  ],
  bodyK: 7,                                       // smooth-union radius
  coast: [[3, 0.9, 0.6], [5, 0.7, 2.1], [7, 0.45, 0.3], [11, 0.25, 4.0]],   // [k, amp, phase]
  pen: [25, -2, 30, 40, 7.6],                     // town peninsula capsule [ax, az, bx, bz, r]
  quayX: 22.5, quayZ0: 14.5, quayZ1: 37,          // straight quay on the peninsula's west face
  piers: [19.5, 26, 32.5],                        // pier z positions (piers run toward -X)
  pierLen: 10,
  // flat lowland (relief-free) rectangle round the build grid [x0, x1, z0, z1]
  lowland: [-20.6, 20.6, -20.6, 8.5],
  beachW: 6.2,                                    // grass bank + sand from the plateau to the waterline
  peaks: [[-31, -31, 12, 11.5], [-13, -38, 16.5, 13], [7, -37, 13.5, 12], [26, -27, 11, 10.5], [-39, -10, 7, 8]],   // [x, z, h, r]
  terrace: [-5, -29.5, 5.6, 3.4],                 // shelf on the ridge flank: huts + lookout [x, z, y, r]
  islets: [[-49, 27, 4.0], [49, 44, 3.2], [-58, -8, 2.6], [-26, 44, 2.2]],
  cornerK: 4.5,
  cellWorld: 2.4,                                 // = BUILD_CELL_WORLD (pure data module)
  cellMargin: 6.6,                                // cells keep ≥ this from the waterline (bank + beach)
});

function sdEllipse(x, z, [cx, cz, rx, rz, rot]) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const px = (x - cx) * c - (z - cz) * s, pz = (x - cx) * s + (z - cz) * c;
  const k0 = Math.hypot(px / rx, pz / rz), k1 = Math.hypot(px / (rx * rx), pz / (rz * rz)) || 1e-6;
  return k0 * (k0 - 1) / k1;
}
function sminP(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

/** Distance from (x, z) to the town peninsula's axis segment. */
export function harborPenAxis(x, z) {
  const [ax, az, bx, bz] = HARBOR.pen, dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** Legacy: coast radius at local (x, z) along the ray from the centre (approximate). */
export function harborCoastR(x, z) {
  const L = Math.hypot(x, z) || 1;
  return L - harborMainSDF(x, z);
}

/**
 * Signed distance to the berth water in front of the quay (negative = water):
 * a box from the quay face out into the bay.
 */
export function harborWaterSDF(x, z) {
  const cx = HARBOR.quayX - 7, cz = (HARBOR.quayZ0 + HARBOR.quayZ1) / 2;
  const qx = Math.abs(x - cx) - 7, qz = Math.abs(z - cz) - (HARBOR.quayZ1 - HARBOR.quayZ0) / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** Smooth max (polynomial, radius k) — rounds the corner where two SDFs meet. */
export function sdfSmax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

/** Mainland only (no islets): ellipse union + peninsula, coast harmonics, the bay cut. */
export function harborMainSDF(x, z) {
  let d = Infinity;
  for (const e of HARBOR.body) d = d === Infinity ? sdEllipse(x, z, e) : sminP(d, sdEllipse(x, z, e), HARBOR.bodyK);
  d = sminP(d, harborPenAxis(x, z) - HARBOR.pen[4], 4);
  const t = Math.atan2(x, z);
  let w = 0;
  for (const [k, amp, ph] of HARBOR.coast) w += amp * Math.sin(k * t + ph);
  d += w * (1 - Math.max(0, Math.min(1, (HARBOR.pen[4] + 3 - harborPenAxis(x, z)) / 3)));   // the town arm stays straight
  return sdfSmax(d, -harborWaterSDF(x, z), HARBOR.cornerK);
}

/** Signed distance to HARBOR land (negative on land), islets included. */
export function harborLandSDF(x, z) {
  let d = harborMainSDF(x, z);
  for (const [ix, iz, ir] of HARBOR.islets) d = Math.min(d, Math.hypot(x - ix, z - iz) - ir);
  return d;
}

/** 0 inside the flat lowland round the build grid, rising to 1 over 7 u outside it. */
export function harborReliefMask(x, z) {
  const [x0, x1, z0, z1] = HARBOR.lowland;
  const ox = Math.max(x0 - x, 0, x - x1), oz = Math.max(z0 - z, 0, z - z1);
  const t = Math.min(1, Math.hypot(ox, oz) / 7);
  return t * t * (3 - 2 * t);
}

function genHarbor(seed, G) {
  const off = (G - 1) / 2 * HARBOR.cellWorld;
  const valid = new Set();
  for (let r = 0; r < G; r++) {
    for (let c = 0; c < G; c++) {
      const x = c * HARBOR.cellWorld - off, z = r * HARBOR.cellWorld - off;
      if (harborLandSDF(x, z) < -HARBOR.cellMargin && harborWaterSDF(x, z) > 2.4 && harborReliefMask(x, z) === 0) valid.add(`${c}_${r}`);
    }
  }
  return valid;
}

// ── PUBLIC API ───────────────────────────────────────────────────

const GENERATORS = { CRESCENT: genCrescent, ATOLL: genAtoll, FORTRESS: genFortress, SPRAWL: genSprawl };

/**
 * Generate valid-cell Set for a shape type + seed.
 * Falls back to SPRAWL + merge if result < 50 slots (belt-and-suspenders).
 * 'HARBOR' (the home port) takes a grid size (default 16); the four battle
 * shapes always use the GRID×GRID grid.
 * @param {string} type
 * @param {number} seed
 * @param {number} [gridSize]
 */
export function generateShape(type, seed, gridSize) {
  if (type === 'HARBOR') return genHarbor(seed, gridSize || 16);
  const gen  = GENERATORS[type] || genSprawl;
  const keys = gen(seed);
  if (keys.size < 50) {
    genSprawl(seed + 99999).forEach(k => keys.add(k));
  }
  return keys;
}

/**
 * Mirror shape across the vertical axis (flip col = size-1-col).
 * Used for enemy islands so they visually mirror the player island.
 * @param {Set<string>} keys
 * @param {number} [gridSize=GRID]
 */
export function mirrorShape(keys, gridSize = GRID) {
  const max      = gridSize - 1;
  const mirrored = new Set();
  keys.forEach(k => {
    const [c, r] = k.split('_').map(Number);
    mirrored.add(`${max - c}_${r}`);
  });
  return mirrored;
}

/** Get all 4 shape type names. */
export function shapeTypes() { return [...SHAPES]; }
