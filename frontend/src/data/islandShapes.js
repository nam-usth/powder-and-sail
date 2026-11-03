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

// ── PUBLIC API ───────────────────────────────────────────────────

const GENERATORS = { CRESCENT: genCrescent, ATOLL: genAtoll, FORTRESS: genFortress, SPRAWL: genSprawl };

/**
 * Generate valid-cell Set for a shape type + seed.
 * Falls back to SPRAWL + merge if result < 50 slots (belt-and-suspenders).
 */
export function generateShape(type, seed) {
  const gen  = GENERATORS[type] || genSprawl;
  const keys = gen(seed);
  if (keys.size < 50) {
    genSprawl(seed + 99999).forEach(k => keys.add(k));
  }
  return keys;
}

/**
 * Mirror shape across the vertical axis (flip col = GRID-1-col).
 * Used for enemy islands so they visually mirror the player island.
 */
export function mirrorShape(keys) {
  const max      = GRID - 1;
  const mirrored = new Set();
  keys.forEach(k => {
    const [c, r] = k.split('_').map(Number);
    mirrored.add(`${max - c}_${r}`);
  });
  return mirrored;
}

/** Get all 4 shape type names. */
export function shapeTypes() { return [...SHAPES]; }
