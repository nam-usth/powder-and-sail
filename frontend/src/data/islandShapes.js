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

// ── HARBOR — the home port: land wrapped round a natural bay ────
// AW: one big island (r ≈ 30) around an elliptical bay that opens south
// (+Z, toward the RTS camera) through a channel. A straight stone quay closes
// the bay's north side; finger piers run south from it. The land outline is
// an analytic signed distance (world units, island-local) shared by the grid
// (here) and the terrain mesh (World/IslandEntity), so they always agree.
export const HARBOR = Object.freeze({
  outerR: 27.5,                                   // outer coast radius
  bay:    { x: 0, z: 7, rx: 14.5, rz: 11 },       // bay ellipse
  quayZ:  -2.5,                                   // straight quay line (north edge of the bay)
  mouth:  { z0: 12, z1: 44, r: 6.5 },             // channel to the open sea (|x| < r)
  islets: [[-10.5, 33.5, 2.7], [10.8, 34.6, 2.3], [-6.2, 38.2, 1.25], [6.8, 39.5, 1.05]],
  cellWorld: 2.4,                                 // = BUILD_CELL_WORLD (pure data module)
  cellMargin: 2.4,                                // cells keep ≥ this from the water (quay strip)
});

/** Signed distance to the bay + mouth water (negative inside the water). */
export function harborWaterSDF(x, z) {
  const b = HARBOR.bay;
  const qx = (x - b.x) / b.rx, qz = (z - b.z) / b.rz;
  let bay = (Math.hypot(qx, qz) - 1) * Math.min(b.rx, b.rz);
  bay = Math.max(bay, HARBOR.quayZ - z);                       // flat quay edge
  const m = HARBOR.mouth;
  const tz = Math.max(m.z0, Math.min(m.z1, z));
  const mouth = Math.hypot(x, z - tz) - m.r;
  return Math.min(bay, mouth);
}

/** Signed distance to HARBOR land (negative on land), islets included. */
export function harborLandSDF(x, z) {
  let d = Math.max(Math.hypot(x, z) - HARBOR.outerR, -harborWaterSDF(x, z));
  for (const [ix, iz, ir] of HARBOR.islets) d = Math.min(d, Math.hypot(x - ix, z - iz) - ir);
  return d;
}

function genHarbor(seed, G) {
  const off = (G - 1) / 2 * HARBOR.cellWorld;
  const valid = new Set();
  for (let r = 0; r < G; r++) {
    for (let c = 0; c < G; c++) {
      const x = c * HARBOR.cellWorld - off, z = r * HARBOR.cellWorld - off;
      if (harborLandSDF(x, z) < -HARBOR.cellMargin) valid.add(`${c}_${r}`);
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
