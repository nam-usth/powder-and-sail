// ── META UI ICONS — inline SVG (no network, theme-aware via CSS) ─────
// Every icon is a static string built from constants only (never from
// profile/user data), so it is safe to concatenate into innerHTML.
//
//   icon(name)          24×24 line glyph in currentColor
//   resIcon('wood'|'gold'|'renown')   small coloured resource icons
//   hullSvg(hullId)     side-profile ship silhouette (classes sv-*; styled in meta.css)
//   rankBadge(index)    brass admiral medallion with 0–4 stars
//   tierBadge(tier)     roman-numeral pill coloured by SHIP_TIERS

import { HULLS, SHIP_TIERS, HULL_BY_CLASS } from '../../data/harbor.js';
import { roman, ms } from './strings.js';

const f = (n) => Math.round(n * 100) / 100;

// ── line glyphs ───────────────────────────────────────────────────
const G = {
  close:     '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  anchor:    '<circle cx="12" cy="5" r="2.1"/><path d="M12 7.1V20.5M8 10.2h8M4.6 13.2c.5 4.1 3.6 6.8 7.4 7.3 3.8-.5 6.9-3.2 7.4-7.3M4.6 13.2l-1.4 1.7M4.6 13.2l2 .6M19.4 13.2l1.4 1.7M19.4 13.2l-2 .6"/>',
  map:       '<path d="M3.5 6.2l5.5-2 6 2 5.5-2v13.6l-5.5 2-6-2-5.5 2z"/><path d="M9 4.2v13.6M15 6.2v13.6"/>',
  compass:   '<circle cx="12" cy="12" r="8.8"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  clock:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6V12l2.9 1.9"/>',
  wrench:    '<path d="M14.6 5.6a4.2 4.2 0 0 0-5.3 5.4l-5 5a1.7 1.7 0 0 0 2.4 2.4l5-5a4.2 4.2 0 0 0 5.4-5.3l-2.5 2.5-2.4-.5-.5-2.4z"/>',
  hammer:    '<path d="M14.5 9.5l-9 9a1.6 1.6 0 0 1-2.2-2.2l9-9"/><path d="M11 5.3l3.1-2.1 6.6 6.6-2.1 3.1-2.2-.2-5.5-5.5z"/>',
  bolt:      '<path d="M13.2 2.8L5.6 13.4h5.6l-1 7.8 7.6-10.6h-5.6z"/>',
  axe:       '<path d="M4 20l10.2-10.2"/><path d="M12.3 4.7c2.4-1.1 5.3-.4 7 1.3 1.7 1.7 2.4 4.6 1.3 7l-3.4-1.9-3-3z"/>',
  skull:     '<path d="M12 3.6c-4.3 0-7.4 2.9-7.4 6.9 0 2.3 1.1 3.9 2.7 4.9v2.9h9.4v-2.9c1.6-1 2.7-2.6 2.7-4.9 0-4-3.1-6.9-7.4-6.9z"/><circle cx="9.3" cy="11" r="1.5"/><circle cx="14.7" cy="11" r="1.5"/><path d="M10.6 18.3v2.2M13.4 18.3v2.2"/>',
  swords:    '<path d="M4.5 4.5l10 10M19.5 4.5l-10 10M12.2 16.8l3.6 3.6M11.8 16.8l-3.6 3.6M14 15l3.5-3.5M10 15L6.5 11.5M17.5 19.5l2 2M6.5 19.5l-2 2"/>',
  castle:    '<path d="M4 20.5V9h3v2.2h2.3V9h2.4v2.2H14V9h2.3v2.2h2.4V9H20v11.5z"/><path d="M10 20.5v-3.8a2 2 0 0 1 4 0v3.8M7 14.5h.01M17 14.5h.01"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.8 8 4.6 8 8.5s-8 3.7-8 8.5M16 3.5c0 4.8-8 4.6-8 8.5s8 3.7 8 8.5"/>',
  flag:      '<path d="M5.5 21V3.8"/><path d="M5.5 4.2c2.9-1.5 5.3 1.4 8.1 0 2.3-1.1 3.8-1 5.6-.2v8.3c-1.8-.8-3.3-.9-5.6.2-2.8 1.4-5.2-1.5-8.1 0"/>',
  lock:      '<rect x="5.2" y="10.8" width="13.6" height="9.7" rx="2"/><path d="M8.2 10.8V8a3.8 3.8 0 0 1 7.6 0v2.8M12 14.6v2.2"/>',
  check:     '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  warn:      '<path d="M12 3.8L2.9 19.6h18.2z"/><path d="M12 10v4.6M12 17.1v.2"/>',
  spyglass:  '<path d="M3.6 15.2l12.6-7.3 2.1 3.6-12.6 7.3z"/><path d="M16.2 7.9l2.6-1.5 2.1 3.6-2.6 1.5M8 16.9l1.6 3.6M7 17.6l-2.3 3"/>',
  cannon:    '<path d="M3.2 10.2l12.6-3.6 1.1 3.9-12.6 3.6z"/><path d="M15.8 6.6l3.4-1 1.1 3.9-3.4 1"/><circle cx="9.3" cy="16.4" r="3.4"/><path d="M9.3 16.4h.01"/>',
  ship:      '<path d="M12 3v13.5M12 4l6.6 10.2H12M11 6.3L5.8 14.2H11"/><path d="M3.6 17h16.8l-2.6 3.4H6.2z"/>',
  chevron:   '<path d="M14.8 5.2L8 12l6.8 6.8"/>',
  wave:      '<path d="M2.5 14.5c2 0 2-2.2 4.6-2.2s2.5 2.2 4.9 2.2 2.4-2.2 4.9-2.2 2.5 2.2 4.6 2.2"/>',
  sparkle:   '<path d="M12 3.5l1.8 6.7 6.7 1.8-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z"/>',
};
const FILLED = new Set(['bolt', 'sparkle']);

/**
 * 24×24 UI glyph in currentColor.
 * @param {string} name key of the glyph table
 * @param {string} [cls] extra class on the <svg>
 */
export function icon(name, cls = '') {
  const body = G[name] || G.anchor;
  const paint = FILLED.has(name)
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="mx-ic ${cls}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Five-point star path centred at (cx,cy) with outer radius r. */
export function starPath(cx, cy, r, inner = 0.46) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
  }
  return d + 'Z';
}

/** Filled star glyph (for star ratings). */
export function starIcon(cls = '') {
  return `<svg class="mx-star ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${starPath(12, 12.6, 10.4)}"/></svg>`;
}

// ── resource icons (fixed colours — wood is wood in every theme) ─────
const RES = {
  wood: '<rect x="3" y="11.2" width="15.2" height="7.2" rx="3.6" fill="#7a4a22"/>'
      + '<rect x="6.2" y="5.2" width="14" height="6.6" rx="3.3" fill="#94592a"/>'
      + '<ellipse cx="18.2" cy="14.8" rx="2.9" ry="3.6" fill="#e2b679"/>'
      + '<ellipse cx="18.2" cy="14.8" rx="1.4" ry="1.9" fill="none" stroke="#a46d36" stroke-width=".9"/>'
      + '<ellipse cx="20" cy="8.5" rx="2.6" ry="3.3" fill="#ebc48e"/>'
      + '<ellipse cx="20" cy="8.5" rx="1.25" ry="1.7" fill="none" stroke="#a46d36" stroke-width=".9"/>'
      + '<path d="M5.4 13.8h8.2M8.6 7.8h7.2" stroke="#55300f" stroke-width=".8" stroke-linecap="round" opacity=".7"/>',
  gold: '<circle cx="12" cy="12" r="8.7" fill="#c8922c" stroke="#7d530f" stroke-width="1.1"/>'
      + '<circle cx="12" cy="12" r="6.3" fill="#f1c75c" stroke="#a7761d" stroke-width=".8"/>'
      + '<path d="M8.9 9.6c.6-1.1 1.7-1.8 3.1-1.8" stroke="#fff4c8" stroke-width="1.2" stroke-linecap="round" fill="none"/>'
      + '<path d="M12 9.1v6M10 10.6h4" stroke="#8a5d14" stroke-width="1.25" stroke-linecap="round"/>',
  renown: `<path d="${starPath(12, 12.8, 9.6)}" fill="#e7c35e" stroke="#87621c" stroke-width="1" stroke-linejoin="round"/>`
      + '<path d="M9.6 10.4l1.5-.3.9-2.2" stroke="#fff3c2" stroke-width="1" stroke-linecap="round" fill="none" opacity=".9"/>',
};

/** Coloured resource glyph: 'wood' | 'gold' | 'renown'. */
export function resIcon(kind, cls = '') {
  return `<svg class="mx-ri ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${RES[kind] || RES.gold}</svg>`;
}

// ── ship silhouettes ──────────────────────────────────────────────
// Side profile, bow to the right, viewBox 0 -3 80 50, waterline ≈ y 39.
// rig: 'square' (tiers of square sails) | 'gaff' (fore-and-aft) | 'lateen'
const ART = {
  cutter:     { x0: 22, x1: 54, deck: 35,   keel: 40.5, aft: 0, fore: 0,   bs: 13, jib: true, ports: 0,
    masts: [{ x: 35, top: 7, rig: 'gaff', w: 13 }] },
  sloop:      { x0: 18, x1: 56, deck: 35,   keel: 41,   aft: 0, fore: 0,   bs: 9,  jib: true, ports: 0,
    masts: [{ x: 34, top: 6, rig: 'gaff', w: 15 }] },
  schooner:   { x0: 15, x1: 60, deck: 35,   keel: 40.6, aft: 0, fore: 0,   bs: 10, jib: true, ports: 0,
    masts: [{ x: 44, top: 9, rig: 'gaff', w: 12 }, { x: 30, top: 6, rig: 'gaff', w: 14 }] },
  corvette:   { x0: 12, x1: 62, deck: 34.5, keel: 41,   aft: 1.5, fore: 0, bs: 9,  jib: true, ports: 1, castle: 9,
    masts: [{ x: 50, top: 9, rig: 'square', w: 10, tiers: 2 }, { x: 37, top: 6, rig: 'square', w: 12, tiers: 3 }, { x: 24, top: 10, rig: 'gaff', w: 10 }] },
  brigantine: { x0: 12, x1: 62, deck: 34,   keel: 41.5, aft: 2, fore: 0,   bs: 9,  jib: true, ports: 1, castle: 9,
    masts: [{ x: 47, top: 6, rig: 'square', w: 13, tiers: 3 }, { x: 30, top: 5, rig: 'gaff', w: 15 }] },
  brig:       { x0: 11, x1: 62, deck: 34,   keel: 41.6, aft: 2, fore: 0,   bs: 9,  jib: true, ports: 1, castle: 9,
    masts: [{ x: 47, top: 6, rig: 'square', w: 13, tiers: 3 }, { x: 30, top: 5, rig: 'square', w: 14, tiers: 3 }] },
  xebec:      { x0: 9,  x1: 64, deck: 35.5, keel: 40.6, aft: 1.5, fore: 1, bs: 8,  jib: false, ports: 1, castle: 8,
    masts: [{ x: 56, top: 11, rig: 'lateen', w: 12 }, { x: 41, top: 6, rig: 'lateen', w: 16 }, { x: 25, top: 10, rig: 'lateen', w: 12 }] },
  frigate:    { x0: 9,  x1: 64, deck: 33.5, keel: 41.6, aft: 2.5, fore: 0, bs: 9,  jib: true, ports: 1, castle: 10,
    masts: [{ x: 52, top: 6, rig: 'square', w: 11, tiers: 3 }, { x: 37, top: 3, rig: 'square', w: 13, tiers: 3 }, { x: 23, top: 7, rig: 'square', w: 10, tiers: 2 }] },
  galleon:    { x0: 8,  x1: 64, deck: 33,   keel: 42,   aft: 6, fore: 2,   bs: 8,  jib: true, ports: 1, castle: 13,
    masts: [{ x: 53, top: 8, rig: 'square', w: 11, tiers: 2 }, { x: 38, top: 3, rig: 'square', w: 14, tiers: 3 }, { x: 22, top: 8, rig: 'lateen', w: 12 }] },
  heavy_frigate: { x0: 7, x1: 66, deck: 33, keel: 42,   aft: 3, fore: 0.5, bs: 9,  jib: true, ports: 2, castle: 12,
    masts: [{ x: 54, top: 4, rig: 'square', w: 12, tiers: 3 }, { x: 38, top: 1.5, rig: 'square', w: 14, tiers: 3 }, { x: 23, top: 5, rig: 'square', w: 11, tiers: 3 }] },
  war_galleon:   { x0: 6, x1: 66, deck: 32.5, keel: 42.6, aft: 7, fore: 2.5, bs: 8, jib: true, ports: 2, castle: 15,
    masts: [{ x: 56, top: 7, rig: 'square', w: 11, tiers: 2 }, { x: 42, top: 2, rig: 'square', w: 14, tiers: 3 }, { x: 28, top: 7, rig: 'lateen', w: 11 }, { x: 16, top: 11, rig: 'lateen', w: 8 }] },
  man_o_war:  { x0: 5,  x1: 68, deck: 32,   keel: 43,   aft: 5, fore: 1,   bs: 9,  jib: true, ports: 2, castle: 14,
    masts: [{ x: 56, top: 3, rig: 'square', w: 13, tiers: 3 }, { x: 40, top: 0.5, rig: 'square', w: 16, tiers: 3 }, { x: 24, top: 4, rig: 'square', w: 12, tiers: 3 }] },
  ship_of_the_line: { x0: 3, x1: 70, deck: 31, keel: 43.6, aft: 5, fore: 1, bs: 9, jib: true, ports: 3, castle: 15,
    masts: [{ x: 58, top: 1.5, rig: 'square', w: 14, tiers: 4 }, { x: 41, top: -0.5, rig: 'square', w: 17, tiers: 4 }, { x: 24, top: 2.5, rig: 'square', w: 13, tiers: 4 }] },
};

function hullPath(a) {
  const { x0, x1, deck, keel, aft, fore } = a;
  const qd = x0 + (a.castle || 7);
  return `M${f(x1)} ${f(deck - 2.6 - fore)}`
    + `Q${f(x1 - 1.4)} ${f(keel - 3)} ${f(x1 - 9)} ${f(keel)}`
    + `L${f(x0 + 7)} ${f(keel)}`
    + `Q${f(x0 + 2)} ${f(keel - 0.8)} ${f(x0 + 0.6)} ${f(deck - aft + 1.6)}`
    + `L${f(x0 - 1)} ${f(deck - aft - 1.6)}`
    + `L${f(qd)} ${f(deck - aft - 1)}`
    + `L${f(qd + 1.2)} ${f(deck)}`
    + `L${f(x1 - 7)} ${f(deck)}`
    + `L${f(x1 - 4)} ${f(deck - 1 - fore)}Z`;
}

function squareSails(m, deck) {
  const tiers = m.tiers || 3;
  const shares = tiers >= 4 ? [0.31, 0.26, 0.23, 0.2] : tiers === 3 ? [0.4, 0.33, 0.27] : [0.56, 0.44];
  const top = m.top + 2.4, bottom = deck - 3.4, H = bottom - top, gap = 0.8;
  let y = bottom, s = '', spars = '';
  for (let i = 0; i < tiers; i++) {
    const h = H * shares[i] - gap;
    const hw = (m.w * (1 - i * 0.15)) / 2;
    const y0 = y - h;
    s += `<path class="sv-sail" d="M${f(m.x - hw)} ${f(y0)}H${f(m.x + hw)}L${f(m.x + hw * 1.06)} ${f(y)}Q${f(m.x)} ${f(y + 1.5)} ${f(m.x - hw * 1.06)} ${f(y)}Z"/>`;
    spars += `M${f(m.x - hw - 0.9)} ${f(y0)}H${f(m.x + hw + 0.9)}`;
    y = y0 - gap;
  }
  return { sails: s, spars };
}

function gaffSail(m, deck) {
  const x = m.x, t = m.top + 2, b = deck - 3, w = m.w;
  return {
    sails: `<path class="sv-sail" d="M${f(x - 0.7)} ${f(t + 1)}L${f(x - w * 0.86)} ${f(t + 4.6)}Q${f(x - w * 0.99)} ${f((t + b) / 2 + 2)} ${f(x - w)} ${f(b)}L${f(x - 0.7)} ${f(b)}Z"/>`,
    spars: `M${f(x)} ${f(t + 0.9)}L${f(x - w * 0.9)} ${f(t + 4.4)}M${f(x)} ${f(b)}H${f(x - w - 1.6)}`,
  };
}

function lateenSail(m, deck) {
  const x = m.x, t = m.top + 1.5, b = deck - 3.6, w = m.w;
  return {
    sails: `<path class="sv-sail" d="M${f(x + w * 0.55)} ${f(b - 1.2)}L${f(x - w * 0.6)} ${f(t)}Q${f(x - w * 0.2)} ${f(b - 3)} ${f(x - w * 0.12)} ${f(b)}Z"/>`,
    spars: `M${f(x + w * 0.66)} ${f(b - 0.2)}L${f(x - w * 0.68)} ${f(t - 1.1)}`,
  };
}

function artFor(hullId) {
  if (ART[hullId]) return ART[hullId];
  const h = HULLS[hullId];
  return ART[(h && HULL_BY_CLASS[h.hull]) || 'sloop'] || ART.sloop;
}

const _svgCache = new Map();
/**
 * Side-profile ship silhouette for a hull id (unknown ids fall back by class).
 * Parts carry classes sv-hull / sv-sail / sv-spar / sv-band / sv-port /
 * sv-flag / sv-water so meta.css can paint them per context.
 */
export function hullSvg(hullId, cls = '') {
  const key = hullId + '|' + cls;
  if (_svgCache.has(key)) return _svgCache.get(key);
  const a = artFor(hullId);
  let sails = '', spars = '', masts = '';
  for (const m of a.masts) {
    const r = m.rig === 'square' ? squareSails(m, a.deck) : m.rig === 'lateen' ? lateenSail(m, a.deck) : gaffSail(m, a.deck);
    sails += r.sails; spars += r.spars;
    masts += `M${f(m.x)} ${f(a.deck)}V${f(m.top)}`;
  }
  // bowsprit + jib from the foremost mast
  const bowY = a.deck - 2.6 - a.fore;
  const bsX = a.x1 + a.bs, bsY = bowY - 3.6;
  const fm = a.masts[0];
  spars += `M${f(a.x1 - 3)} ${f(bowY + 0.4)}L${f(bsX)} ${f(bsY)}`;
  if (a.jib) sails += `<path class="sv-sail sv-jib" d="M${f(fm.x + 0.7)} ${f(fm.top + 3)}L${f(bsX - 0.6)} ${f(bsY + 0.5)}L${f(fm.x + 2.6)} ${f(a.deck - 3.3)}Z"/>`;
  // pennant on the tallest mast
  const tall = a.masts.reduce((t, m) => (m.top < t.top ? m : t), a.masts[0]);
  const flag = `<path class="sv-flag" d="M${f(tall.x)} ${f(tall.top - 0.4)}L${f(tall.x - 7)} ${f(tall.top + 0.8)}L${f(tall.x)} ${f(tall.top + 2)}Z"/>`;
  // gun-deck band + ports
  let band = '';
  if (a.ports) {
    const xs = a.x0 + 3, xe = a.x1 - 8, rows = a.ports;
    band = `<path class="sv-band" d="M${f(xs)} ${f(a.deck + 0.9)}H${f(xe)}V${f(a.deck + 1.2 + rows * 2.5)}H${f(xs)}Z"/>`;
    let ports = '';
    for (let r = 0; r < rows; r++) {
      const y = a.deck + 1.6 + r * 2.5;
      for (let x = xs + 2 + (r % 2) * 1.4; x < xe - 1.5; x += 4.1) ports += `M${f(x)} ${f(y)}h1.6v1.35h-1.6z`;
    }
    band += `<path class="sv-port" d="${ports}"/>`;
  }
  const water = '<path class="sv-water" d="M-4 39.2c4 0 4-1.3 8-1.3s4 1.3 8 1.3 4-1.3 8-1.3 4 1.3 8 1.3 4-1.3 8-1.3 4 1.3 8 1.3 4-1.3 8-1.3 4 1.3 8 1.3 4-1.3 8-1.3 4 1.3 8 1.3V50H-4z"/>';
  const svg = `<svg class="sv ${cls}" viewBox="0 -3 80 50" aria-hidden="true" focusable="false">`
    + `<path class="sv-mast" d="${masts}"/><path class="sv-spar" d="${spars}"/>${sails}${flag}`
    + `<path class="sv-hull" d="${hullPath(a)}"/>${band}${water}</svg>`;
  _svgCache.set(key, svg);
  return svg;
}

// ── rank medallion ────────────────────────────────────────────────
/** Brass medallion: anchor + one star per rank above Captain. */
export function rankBadge(index = 0, cls = '') {
  const n = Math.max(0, Math.min(4, index | 0));
  let stars = '';
  for (let i = 0; i < n; i++) {
    const a = ((-90 + (i - (n - 1) / 2) * 30) * Math.PI) / 180;
    stars += `<path class="rb-star" d="${starPath(24 + Math.cos(a) * 19.4, 24 + Math.sin(a) * 19.4, 4.6, 0.44)}"/>`;
  }
  return `<svg class="rb ${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">`
    + '<circle class="rb-ring" cx="24" cy="24" r="22.5"/><circle class="rb-field" cx="24" cy="24" r="17"/>'
    + '<g class="rb-anchor" transform="translate(13.6 14.2) scale(.87)" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">'
    + G.anchor + '</g>' + stars + '</svg>';
}

// ── tier pill ────────────────────────────────────────────────────
export const tierOf = (n) => SHIP_TIERS.find((t) => t.tier === n) || null;

/** Roman-numeral tier pill, coloured from SHIP_TIERS (static data only). */
export function tierBadge(tier, cls = '') {
  if (!tier) return '';
  const t = tierOf(tier);
  const col = t ? t.col : '#b0b0b0';
  const r = t ? t.nm : roman(tier);
  return `<span class="mx-tier ${cls}" style="--tc:${col}" title="${ms('tierN', r)}">${r}</span>`;
}
