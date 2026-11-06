// ── CHART ART — stylised sea zones for the World Chart ───────────────
// The World Chart is a campaign map, not an atlas: five sea zones laid
// side by side along a winding sea-road. Each zone gets a few hand-inked,
// fictional landmarks that hint at the place (cays and palms, a rocky
// headland, a long monsoon coast, jungle islands round a strait, karst
// towers and junks). Everything here is cheap SVG: radial "blob" islands
// with offset contour rings, and small glyphs — no masks, no filters.
//
// Art is placed in zone-relative coordinates (u,v ∈ 0..1 of the zone's
// chart box from data/campaign.js REGIONS[].chart), and every optional
// piece is dropped when `free(x, y, r)` says it would cover a node, a
// label or a route — so moving nodes in data never buries them.
//
//   const ink = new ChartInk(free);  zoneArt('caribbean', box, ink, ctx);  ink.svg()

import { makePrng } from '../../data/islandShapes.js';

const r1 = (n) => Math.round(n * 10) / 10;
const TAU = Math.PI * 2;

/** Closed Catmull-Rom spline through points → SVG path data. */
export function smoothPath(pts) {
  const n = pts.length;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}

/** A seeded radial shape: θ → radius factor (≈1 ± jag). */
function shape(seed, jag) {
  const rnd = makePrng(seed);
  const H = [];
  for (let h = 2; h <= 9; h++) H.push([h, (rnd() * 2 - 1) * jag * (h < 6 ? 1 / (h * 0.55) : 0.12), rnd() * TAU]);
  return (t) => 1 + H.reduce((a, [h, A, p]) => a + A * Math.sin(h * t + p), 0);
}

function blobD(cx, cy, rx, ry, rot, f, off, n = 30) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU, k = f(t);
    const x = Math.cos(t) * (rx * k + off), y = Math.sin(t) * (ry * k + off);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return smoothPath(pts);
}

/** Accumulates land (merged into a few paths) and glyphs for the chart. */
export class ChartInk {
  /** @param {(x:number,y:number,r:number)=>boolean} free */
  constructor(free) {
    this._free = free;
    /** Footprints claimed so far: { x, y, r }. */
    this.placed = [];
    this.land = ''; this.ring1 = ''; this.ring2 = '';
    this.under = []; this.glyphs = []; this._later = [];
  }

  /** Queue small optional detail (waves, reefs, winds) until ornaments have claimed their water. */
  later(fn) { this._later.push(fn); }

  /** Run the queued detail. */
  flush() { this._later.splice(0).forEach((fn) => fn()); }

  /** Is a circle clear of nodes/routes/titles and of everything placed so far? */
  free(x, y, r) {
    return this._free(x, y, r) && this.placed.every((q) => Math.hypot(q.x - x, q.y - y) > q.r + r);
  }

  /** Blob island; returns false (and draws nothing) when it would cover a node or route. */
  island(cx, cy, rx, ry, seed, { rot = 0, jag = 0.2, force = false, rings = true } = {}) {
    if (!force && !this.free(cx, cy, Math.max(rx, ry) * 0.92 + 8)) return false;
    const f = shape(seed, jag);
    // footprint: a row of circles along the long axis (elongated coasts too)
    const rm = Math.min(rx, ry), steps = Math.max(0, Math.round((Math.max(rx, ry) - rm) / rm));
    for (let i = -steps; i <= steps; i++) {
      const t = steps ? (i / steps) * (Math.max(rx, ry) - rm) : 0;
      const [ax, ay] = rx >= ry ? [t, 0] : [0, t];
      this.placed.push({ x: cx + ax * Math.cos(rot) - ay * Math.sin(rot), y: cy + ax * Math.sin(rot) + ay * Math.cos(rot), r: rm * 1.1 + 6 });
    }
    this.land += blobD(cx, cy, rx, ry, rot, f, 0);
    if (rings) {
      this.ring1 += blobD(cx, cy, rx, ry, rot, f, 10);
      this.ring2 += blobD(cx, cy, rx, ry, rot, f, 22);
    }
    return true;
  }

  /** Add a glyph if its footprint (radius r) is free; `force` skips the test. */
  put(x, y, r, svg, force = false) {
    if (!force && !this.free(x, y, r)) return false;
    if (r > 0) this.placed.push({ x, y, r });
    this.glyphs.push(svg);
    return true;
  }

  /** First free candidate [x, y] for radius r (or null). */
  pick(cands, r) { return cands.find(([x, y]) => this.free(x, y, r)) || null; }

  /** Layers below the routes (sea ornament + land). */
  svg() {
    return `<g class="ca-under">${this.under.join('')}</g>`
      + `<path class="ca-ring2" d="${this.ring2}"/><path class="ca-ring1" d="${this.ring1}"/>`
      + `<path class="ca-shoal" d="${this.land}"/><path class="ca-land" d="${this.land}"/>`
      + `<path class="ca-hatch" d="${this.land}"/><path class="ca-coast" d="${this.land}"/>`
      + `<g class="ca-glyphs">${this.glyphs.join('')}</g>`;
  }
}

// ── glyphs (local units ≈ canvas px) ─────────────────────────────────
const T = (x, y, s = 1) => `transform="translate(${r1(x)} ${r1(y)})${s !== 1 ? ` scale(${s})` : ''}"`;

export const palm = (x, y, s = 1, flip = false) => `<g class="ca-palm" ${T(x, y, s)}><g${flip ? ' transform="scale(-1 1)"' : ''}>`
  + '<path class="ca-trunk" d="M0 0C-1-7 1-13 4-19"/>'
  + '<path class="ca-frond" d="M4-19C-2-22-7-19-10-14M4-19C0-25-6-26-11-24M4-19C8-25 13-25 17-21M4-19C10-20 14-16 15-11M4-19C5-24 8-27 11-28"/>'
  + '<path class="ca-mound" d="M-8 1Q0-4 9 1"/></g></g>';

export const reef = (x, y, s = 1) => `<path class="ca-reef" ${T(x, y, s)} d="M-14 0h6M-11-3v6M2-5h6M5-8v6M12 3h6M15 0v6M-4 6h5M-1.5 3.5v5"/>`;

export const rocks = (x, y, s = 1) => `<path class="ca-rock" ${T(x, y, s)} d="M-9 3l3-6 3 6zM0 4l4-9 4 9zM9 2l2-4 3 4z"/>`;

export const hills = (x, y, s = 1) => `<g class="ca-hills" ${T(x, y, s)}>`
  + '<path class="ca-hill" d="M-24 4Q-12-16 0 4M-6 4Q8-22 22 4"/>'
  + '<path class="ca-hill-sh" d="M-8-2l3 6M-5-6l4 9M10-8l4 11M14-4l3 7"/></g>';

export const peak = (x, y, s = 1) => `<g class="ca-hills" ${T(x, y, s)}>`
  + '<path class="ca-peak" d="M-26 6L-6-24L2-16L8-26L28 6Z"/>'
  + '<path class="ca-hill-sh" d="M8-26l4 12M2-16l6 14M14-14l5 14M-6-24l2 10"/>'
  + '<path class="ca-smoke" d="M8-28c-3-6 4-9 1-15c-2-5 5-7 3-12"/></g>';

export const tree = (x, y, s = 1) => `<g class="ca-tree" ${T(x, y, s)}>`
  + '<path class="ca-trunk" d="M0 4V-4"/><circle cx="-5" cy="-6" r="5"/><circle cx="5" cy="-6" r="5"/><circle cx="0" cy="-12" r="5.5"/></g>';

export const jungle = (x, y, s = 1) => tree(x - 12 * s, y + 3 * s, s * 0.9) + tree(x + 11 * s, y + 4 * s, s * 0.85) + tree(x, y - 4 * s, s);

export const town = (x, y, s = 1) => `<g class="ca-town" ${T(x, y, s)}>`
  + '<path class="ca-house" d="M-18 4v-8l5-5 5 5v8zM-6 4v-10l6-6 6 6v10zM8 4v-7l4-4 4 4v7z"/>'
  + '<path class="ca-spire" d="M0-16v-8M-2-21h4"/></g>';

export const fort = (x, y, s = 1, flag = '#8f1d16') => `<g class="ca-fort" ${T(x, y, s)}>`
  + '<path class="ca-wall" d="M-14 6V-6h4v-3h4v3h4v-3h4v3h4v-3h4v3h4V6z"/>'
  + `<path class="ca-staff" d="M0-9V-24"/><path d="M0-24h10l-3 3 3 3H0z" fill="${flag}" stroke="#33200d" stroke-width=".8"/></g>`;

export const lighthouse = (x, y, s = 1) => `<g class="ca-light" ${T(x, y, s)}>`
  + '<path class="ca-wall" d="M-5 6L-3-18H3L5 6Z"/><path class="ca-wall" d="M-4-18h8v-5h-8z"/>'
  + '<path class="ca-beam" d="M6-21l22-7M6-20l22 4M-6-21l-20-7"/></g>';

export const karst = (x, y, w = 14, h = 46, s = 1) => {
  const d = `M${-w} 0C${-w} ${r1(-h * 0.55)} ${r1(-w * 0.75)} ${-h} 0 ${-h}C${r1(w * 0.8)} ${-h} ${w} ${r1(-h * 0.6)} ${w} 0Z`;
  return `<g class="ca-karst" ${T(x, y, s)}><path class="ca-kbody" d="${d}"/>`
    + `<path class="ca-kshade" d="M${r1(w * 0.35)} ${r1(-h * 0.85)}C${r1(w * 0.8)} ${r1(-h * 0.6)} ${r1(w * 0.75)} ${r1(-h * 0.3)} ${r1(w * 0.7)} -2M${r1(w * 0.05)} ${r1(-h * 0.6)}C${r1(w * 0.3)} ${r1(-h * 0.4)} ${r1(w * 0.3)} ${r1(-h * 0.2)} ${r1(w * 0.25)} -3"/>`
    + `<path class="ca-ktuft" d="M${r1(-w * 0.5)} ${r1(-h * 0.92)}q3-6 7-1q3-5 6 0"/>`
    + `<path class="ca-wave" d="M${-w - 6} 3q5-4 10 0t10 0t10 0${w > 12 ? 't10 0' : ''}"/></g>`;
};

/** A cluster of karst towers (Ha Long Bay). */
export const karstCluster = (x, y, s = 1) => karst(x - 22 * s, y + 4 * s, 11 * s, 34 * s)
  + karst(x + 2 * s, y, 15 * s, 50 * s) + karst(x + 24 * s, y + 6 * s, 9 * s, 26 * s);

export const cloud = (x, y, s = 1) => `<g class="ca-cloud" ${T(x, y, s)}>`
  + '<path class="ca-rain" d="M-22 10l-8 18M-8 10l-8 18M6 10l-8 18M20 10l-8 18"/>'
  + '<path class="ca-cbody" d="M-34 10C-46 10-46-6-32-6C-32-20-14-24-8-14C-2-28 22-26 22-10C36-12 40 10 28 10Z"/>'
  + '<path class="ca-cline" d="M-24 2C-18 4-10 4-4 0M6-2c6 3 12 3 16 0"/></g>';

export const wind = (x, y, s = 1, flip = false) => `<path class="ca-wind" ${T(x, y, flip ? -s : s)} d="M-40 0C-20-8 0 6 20-2C30-6 34-14 26-16C20-17 18-10 24-8M-34 10C-14 4 4 14 22 8"/>`;

export const typhoon = (x, y, s = 1) => `<g class="ca-typhoon" ${T(x, y, s)}>`
  + '<path d="M0 0c6-3 9 4 4 8c-7 6-17-1-14-10c3-11 19-14 27-5c10 11 3 29-12 31c-18 3-32-13-28-30"/>'
  + '<path d="M0 0c-6 3-9-4-4-8c7-6 17 1 14 10c-3 11-19 14-27 5c-10-11-3-29 12-31c18-3 32 13 28 30"/></g>';

export const waves = (x, y, s = 1) => `<path class="ca-wave" ${T(x, y, s)} d="M-15 0q5-5 10 0t10 0t10 0M-5 8q5-5 10 0t10 0"/>`;

export const anchorage = (x, y) => `<path class="ca-anch" ${T(x, y)} d="M0-7v13M-4-4h8M-6 2q6 7 12 0"/><circle class="ca-anch" cx="${r1(x)}" cy="${r1(y - 9)}" r="2"/>`;

/** Wavy dotted "line of demarcation" between two zones. */
export function boundary(x, y0, y1, seed) {
  const rnd = makePrng(seed);
  let d = `M${r1(x)} ${r1(y0)}`;
  for (let y = y0; y < y1; y += 60) d += `q${r1((rnd() - 0.5) * 30)} 30 0 60`;
  return `<path class="ca-bound" d="${d}"/>`;
}

// ── zone recipes ─────────────────────────────────────────────────────
// B: { x0, y0, x1, y1, w, h }  ctx: { home?:{x,y}, nodes }
const at = (B, u, v) => [B.x0 + u * B.w, B.y0 + v * B.h];

const RECIPES = {
  caribbean(B, ink, ctx) {
    // home island under the Home Harbor node
    if (ctx.home) {
      const { x, y } = ctx.home;
      ink.island(x + 12, y + 4, 82, 54, 101, { force: true, jag: 0.16 });
      ink.put(x + 52, y - 22, 0, town(x + 52, y - 22, 0.95), true);
      ink.put(x - 48, y - 18, 0, palm(x - 48, y - 18, 1.1), true);
      ink.put(x + 64, y + 26, 0, palm(x + 64, y + 26, 0.95, true), true);
      ink.put(x - 26, y + 36, 0, fort(x - 26, y + 36, 0.9), true);
    }
    // cays and palm islets
    const cays = [[0.78, 0.9, 40, 22], [0.62, 0.64, 24, 15], [0.86, 0.66, 20, 13], [0.38, 0.47, 28, 18],
      [0.86, 0.33, 24, 15], [0.3, 0.18, 30, 17], [0.66, 0.2, 22, 14], [0.5, 0.84, 18, 12], [0.12, 0.54, 20, 14],
      [0.94, 0.5, 15, 11], [0.48, 0.32, 16, 11], [0.2, 0.42, 14, 10]];
    cays.forEach(([u, v, rx, ry], i) => {
      const [x, y] = at(B, u, v);
      if (!ink.island(x, y, rx, ry, 200 + i * 7, { jag: 0.18, rot: (i % 3) * 0.4 })) return;
      if (rx >= 20) ink.put(x - 2, y + 2, 0, palm(x - 2, y + 3, rx > 26 ? 1 : 0.85, i % 2 === 1), true);
      if (rx >= 28) ink.put(x + rx * 0.55, y + 4, 0, palm(x + rx * 0.5, y + 4, 0.8, true), true);
      const [rxp, ryp] = [x + rx + 16, y + ry * 0.4 + 10];
      if (i % 2 === 0) ink.later(() => ink.put(rxp, ryp, 16, reef(rxp, ryp)));
    });
    ink.later(() => {
      for (const [u, v] of [[0.6, 0.44], [0.25, 0.7], [0.75, 0.1], [0.08, 0.95], [0.42, 0.62], [0.9, 0.82]]) {
        const [x, y] = at(B, u, v); ink.put(x, y, 18, reef(x, y));
      }
    });
  },

  atlantic(B, ink) {
    // a rocky headland reaching down from the north, with its light
    const [hx] = at(B, 0.2, 0);
    ink.island(hx, B.y0 - 30, 58, 220, 311, { force: true, jag: 0.14, rot: 0.08 });
    ink.put(hx + 4, B.y0 + 120, 0, hills(hx + 4, B.y0 + 120, 0.9), true);
    ink.put(hx - 8, B.y0 + 70, 0, hills(hx - 8, B.y0 + 70, 0.8), true);
    ink.put(hx + 10, B.y0 + 168, 0, lighthouse(hx + 10, B.y0 + 168, 1), true);
    ink.put(hx + 30, B.y0 + 205, 14, rocks(hx + 30, B.y0 + 205, 1));
    ink.put(hx - 22, B.y0 + 206, 14, rocks(hx - 22, B.y0 + 206, 0.8));
    // a lonely mid-ocean isle (the Azores of this chart)
    for (const [u, v, rx] of [[0.82, 0.55, 26], [0.15, 0.8, 24], [0.72, 0.42, 20], [0.85, 0.72, 18]]) {
      const [x, y] = at(B, u, v);
      if (ink.island(x, y, rx, rx * 0.7, 340 + Math.round(u * 100), { jag: 0.22 })) { ink.put(x, y + 2, 0, peak(x, y + 4, rx / 34), true); break; }
    }
    // open ocean lanes: wave marks
    ink.later(() => {
      for (const [u, v] of [[0.55, 0.36], [0.3, 0.42], [0.62, 0.66], [0.82, 0.24], [0.4, 0.7], [0.88, 0.9], [0.12, 0.6], [0.55, 0.92], [0.7, 0.12]]) {
        const [x, y] = at(B, u, v); ink.put(x, y, 18, waves(x, y, 1.2));
      }
    });
  },

  indian(B, ink) {
    // the long monsoon coast: a peninsula rising from the south
    const [px] = at(B, 0.95, 1);
    ink.island(px, B.y1 + 50, 90, 270, 421, { force: true, jag: 0.1, rot: 0.1 });
    ink.put(px - 6, B.y1 - 100, 0, jungle(px - 6, B.y1 - 100, 1), true);
    ink.put(px + 26, B.y1 - 34, 0, hills(px + 26, B.y1 - 34, 0.9), true);
    ink.put(px - 34, B.y1 - 36, 0, fort(px - 38, B.y1 - 40, 0.9, '#2f5d8c'), true);
    ink.put(px - 4, B.y1 - 170, 0, palm(px - 4, B.y1 - 170, 1), true);
    // a small isle in the middle of the ocean
    for (const [u, v] of [[0.2, 0.62], [0.72, 0.42], [0.26, 0.2]]) {
      const [x, y] = at(B, u, v);
      if (ink.island(x, y, 22, 15, 455 + Math.round(v * 100), { jag: 0.2 })) { ink.put(x, y + 3, 0, palm(x, y + 3, 0.85), true); break; }
    }
    // monsoon clouds and winds
    let n = 0;
    for (const [u, v, s] of [[0.25, 0.2, 1.1], [0.62, 0.17, 1], [0.25, 0.47, 1], [0.78, 0.6, 0.95], [0.3, 0.72, 0.95], [0.75, 0.32, 0.9]]) {
      const [x, y] = at(B, u, v);
      if (n < 2 && ink.put(x, y, 44 * s, cloud(x, y, s))) n++;
    }
    ink.later(() => {
      for (const [u, v] of [[0.35, 0.55], [0.65, 0.78], [0.15, 0.32], [0.62, 0.35]]) {
        const [x, y] = at(B, u, v); ink.put(x, y, 36, wind(x, y, 0.9));
      }
    });
  },

  spice(B, ink) {
    // two big jungle islands either side of the strait
    const [wx, wy] = at(B, 0.13, 0.4), [ex, ey] = at(B, 0.95, 0.42);
    ink.island(wx, wy, 48, 125, 521, { force: true, jag: 0.16, rot: -0.12 });
    ink.island(ex, ey, 60, 150, 537, { force: true, jag: 0.16, rot: 0.1 });
    ink.put(wx, wy - 60, 0, jungle(wx - 2, wy - 60, 1), true);
    ink.put(wx + 4, wy + 14, 0, peak(wx + 4, wy + 14, 0.85), true);
    ink.put(wx - 6, wy + 76, 0, jungle(wx - 6, wy + 76, 0.85), true);
    ink.put(ex - 6, ey - 80, 0, fort(ex - 6, ey - 76, 0.95, '#d97a1f'), true);
    ink.put(ex + 4, ey - 10, 0, jungle(ex + 4, ey - 10, 1), true);
    ink.put(ex - 8, ey + 70, 0, jungle(ex - 8, ey + 70, 0.9), true);
    // small islets in the narrows
    for (const [u, v, r] of [[0.5, 0.07, 16], [0.4, 0.93, 20], [0.82, 0.86, 18], [0.35, 0.68, 13]]) {
      const [x, y] = at(B, u, v);
      if (ink.island(x, y, r, r * 0.7, 560 + Math.round(u * 50), { jag: 0.22 })) ink.put(x, y + 3, 0, tree(x, y + 3, 0.8), true);
    }
  },

  southchina(B, ink) {
    // the coast of the Middle Kingdom in the north-east corner
    ink.island(B.x1 + 30, B.y0 + 10, 150, 130, 611, { force: true, jag: 0.14 });
    const [cx, cy] = [B.x1 - 46, B.y0 + 70];
    ink.put(cx, cy, 0, hills(cx, cy, 0.9), true);
    // karst towers rising from the bay
    let k = 0;
    for (const [u, v, s] of [[0.75, 0.88, 1.1], [0.2, 0.6, 1], [0.86, 0.42, 1], [0.15, 0.3, 0.9], [0.55, 0.72, 0.85],
      [0.9, 0.7, 0.8], [0.45, 0.45, 0.8], [0.72, 0.2, 0.85], [0.1, 0.9, 0.8]]) {
      const [x, y] = at(B, u, v);
      if (k < 6 && ink.put(x, y - 16 * s, 34 * s, karstCluster(x, y, s))) k++;
    }
    for (const [u, v] of [[0.62, 0.32], [0.3, 0.8], [0.88, 0.56]]) {
      const [x, y] = at(B, u, v); if (ink.put(x, y, 30, typhoon(x, y, 0.85))) break;
    }
  },
};

/** Draw one zone's landmarks into `ink`. */
export function zoneArt(id, B, ink, ctx = {}) {
  const f = RECIPES[id];
  if (f) f(B, ink, ctx);
}
