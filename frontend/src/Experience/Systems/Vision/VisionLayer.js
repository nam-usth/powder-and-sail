/**
 * VisionLayer — shared spatial bitmap for fog-of-war visibility.
 *
 * Architecture
 * ────────────
 * The map is partitioned into a CELLS×CELLS grid of equal square cells.
 * Each cell is a Uint8 bitmask:
 *
 *   Bit 0 (SHIP_BIT)   — at least one player ship's vision circle covers this cell
 *   Bit 1 (ISLAND_BIT) — at least one player-owned island's vision circle covers this cell
 *
 * Vision sources write into the grid by stamping circles ("dirty-stamp"):
 *   • Island sources    → stamped once on capture, never again unless ownership changes.
 *   • Ship sources      → re-stamped only when the ship moves more than MOVE_THRESHOLD
 *                         world units from its last stamp position.
 *
 * Enemy visibility check → O(1):   layer.isVisible(x, z)
 * Shader uniform rebuild  → O(N):  called only when sources change, not every frame.
 *
 * Typical cost per frame (5 player ships, 5 islands):
 *   • No ship moved far   → 0 redraws, just 3–15 enemy cell lookups
 *   • One ship moved      → 1 circle redraw (~πr² cells ≈ 200 cells) + enemy lookups
 *   • Full rebuild (rare) → all circles redrawn once
 *
 * Constants
 * ─────────
 *   MAP_SIZE        World units the grid covers (must match FogSystem mapSize)
 *   CELLS           Grid resolution — 64 gives ~5 world-unit cells on a 320-unit map.
 *                   Increase to 128 for finer granularity (4× memory, negligible perf cost).
 *   MOVE_THRESHOLD  Min world-unit displacement before a ship re-stamps its circle.
 *                   2.5 ≈ half a cell width at CELLS=64 — avoids per-frame stamps while
 *                   keeping the visible boundary tight.
 */

export const SHIP_BIT   = 1;
export const ISLAND_BIT = 2;

const MAP_SIZE       = 320;
const CELLS          = 64;
const CELL_SIZE      = MAP_SIZE / CELLS;          // world units per cell
const HALF           = MAP_SIZE / 2;              // grid is centred at world origin
const MOVE_THRESHOLD = 2.5;                       // world units before re-stamp

// Convert world XZ → grid column / row  (clamped to valid range)
function worldToCell(w) {
  return Math.max(0, Math.min(CELLS - 1, Math.floor((w + HALF) / CELL_SIZE)));
}

export class VisionLayer {
  constructor() {
    // One byte per cell; OR'd with bit flags as sources are stamped.
    this._grid = new Uint8Array(CELLS * CELLS);

    // Per-source stamp bookkeeping.
    // key   → any unique string id for the source
    // value → { lastX, lastZ, cx, cz, cr }  (grid coords at last stamp)
    this._sources = new Map();
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Register a new vision source.
   * @param {string} id     Unique id (e.g. 'ship_0', 'island_neu_n')
   * @param {number} bit    SHIP_BIT or ISLAND_BIT
   * @param {number} x      World X
   * @param {number} z      World Z
   * @param {number} radius Vision radius in world units
   */
  addSource(id, bit, x, z, radius) {
    const meta = { bit, x, z, radius, lastX: NaN, lastZ: NaN };
    this._sources.set(id, meta);
    this._stamp(meta);
  }

  /**
   * Remove a source and erase its contribution.
   * Triggers a full rebuild because erasing a single circle would require
   * knowing which cells are exclusively covered by this source.
   */
  removeSource(id) {
    if (!this._sources.has(id)) return;
    this._sources.delete(id);
    this._rebuildGrid();
  }

  /**
   * Update a source's position. Re-stamps only if the source moved more
   * than MOVE_THRESHOLD world units since its last stamp — cheap per frame.
   * @returns {boolean} true if the grid changed
   */
  updateSource(id, x, z) {
    const meta = this._sources.get(id);
    if (!meta) return false;

    const dx = x - meta.lastX, dz = z - meta.lastZ;
    if (dx * dx + dz * dz < MOVE_THRESHOLD * MOVE_THRESHOLD) return false;

    meta.x = x;
    meta.z = z;
    // Moving a source means its old footprint may now be uncovered;
    // we need a full rebuild to clear stale bits from the old position.
    this._rebuildGrid();
    return true;
  }

  /**
   * Force-update a source's radius (e.g. after research upgrade).
   */
  updateRadius(id, radius) {
    const meta = this._sources.get(id);
    if (!meta) return;
    meta.radius = radius;
    this._rebuildGrid();
  }

  /**
   * O(1) visibility test.
   * @returns {boolean} true if any vision source covers (x, z)
   */
  isVisible(x, z) {
    const col = worldToCell(x);
    const row = worldToCell(z);
    return this._grid[row * CELLS + col] !== 0;
  }

  /**
   * Test with a specific bit (e.g. only ship vision, not island vision).
   */
  isVisibleBit(x, z, bit) {
    const col = worldToCell(x);
    const row = worldToCell(z);
    return (this._grid[row * CELLS + col] & bit) !== 0;
  }

  // ── Internal helpers ────────────────────────────────────────────

  /** Clear the grid and re-stamp every registered source. */
  _rebuildGrid() {
    this._grid.fill(0);
    for (const meta of this._sources.values()) {
      this._stamp(meta);
    }
  }

  /**
   * Rasterise a filled circle of `meta.bit` into the grid.
   * Uses integer grid coords — no floating point per cell.
   */
  _stamp(meta) {
    meta.lastX = meta.x;
    meta.lastZ = meta.z;

    const bit = meta.bit;
    const cx  = worldToCell(meta.x);
    const cz  = worldToCell(meta.z);
    // Vision radius in cells (round up so we don't under-cover the edge)
    const cr  = Math.ceil(meta.radius / CELL_SIZE);

    const minR = Math.max(0, cz - cr);
    const maxR = Math.min(CELLS - 1, cz + cr);
    const minC = Math.max(0, cx - cr);
    const maxC = Math.min(CELLS - 1, cx + cr);

    const crSq = cr * cr;

    for (let row = minR; row <= maxR; row++) {
      const dRow = row - cz;
      const dRowSq = dRow * dRow;
      for (let col = minC; col <= maxC; col++) {
        const dCol = col - cx;
        if (dCol * dCol + dRowSq <= crSq) {
          this._grid[row * CELLS + col] |= bit;
        }
      }
    }
  }
}
