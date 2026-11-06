// ── WORLD CHART (AW-S06) — a period world map, orders card, fleet picker ─
// Full-screen modal. An early-modern "New Chart of the World" drawn as
// inline SVG: hand-traced coastlines (worldCoasts.js) in an equirectangular
// projection (WORLD), rhumb lines from two compass roses, a cartouche, sea
// creatures, sea-region washes and the dotted route between missions.
// Mission nodes are real <button>s laid over the map at mission.chart {x,y}
// (0..1 of the map); a node that falls on land is nudged to the nearest sea.
// Narrow/portrait screens keep the map at a usable height and pan it
// sideways (drag or swipe) instead of shrinking it to a strip.
//
// Data is read defensively at render time: REGIONS (with optional
// chart:{x,y,w,h} box — otherwise derived from their missions), MISSIONS
// (optional `faction`), PATROL, OPEN_WAR, FINAL_MISSION, HOME, and
// FACTIONS / SEAS from data/factions.js.
//
//   const chart = new WorldChart(ctx); chart.open(); chart.openBriefing('reef_2');
//
// ctx: { getProfile, save, now, toast, sfx?, onSetSail({missionId, shipUids, seed, doctrines:{uid:doctrineId}}),
//        onOpenWar(), onProfileChanged? }

import * as CAMPAIGN from '../../data/campaign.js';
import * as FACT from '../../data/factions.js';
import { RANKS } from '../../data/harbor.js';
import { makePrng } from '../../data/islandShapes.js';
import * as CAMP from '../Campaign.js';
import { sailableShips, fleetCap, fleetCapBreakdown, tickRoster, hullOf } from '../Shipyard.js';
import { LANDS, HOLES, ISLANDS, ISLETS } from './worldCoasts.js';
import {
  ms, hullName, rankName, regionName, regionDesc, missionName, missionDesc, isleName, className, factionName,
  fmtNum, fmtClock, capBreakdownText, doctrineName, doctrineDesc, doctrineWhy,
} from './strings.js';
import { DOCTRINES, DOCTRINE_BY_ID, DOCTRINE_KEEP } from '../../data/doctrines.js';
import { suggestDoctrines } from '../Doctrine.js';
import { icon, resIcon, hullSvg, rankBadge, tierBadge, starIcon, flagSvg, laurel } from './icons.js';
import { showHowToWin } from './HowToWin.js';
import {
  esc, el, domId, call, nowOf, emitMetaChanged, ensureMetaCss, revealWhenStyled,
  pushModal, popModal, focusFirst, patchKeyed, setText, reducedMotion,
} from './dom.js';

/**
 * Map projection: a stylised early-modern sheet — piecewise-linear in
 * longitude and latitude, so the Caribbean and the Asian seas (where the
 * campaign is fought) get more room than the open Pacific or inner Africa.
 * Knots are [degrees, chart 0..1]. Canvas is W × H px.
 */
export const WORLD = Object.freeze({
  W: 1800, H: 1000,
  lon: [[-100, 0], [-90, 0.018], [-58, 0.23], [-18, 0.37], [52, 0.625], [92, 0.785], [126, 0.985], [135, 1]],
  lat: [[58, 0], [42, 0.15], [25, 0.32], [8, 0.53], [-12, 0.74], [-42, 1]],
});

function knots(table, v) {
  const n = table.length;
  const asc = table[n - 1][0] > table[0][0];
  for (let i = 0; i < n - 1; i++) {
    const [a, fa] = table[i], [b, fb] = table[i + 1];
    if (asc ? v <= b || i === n - 2 : v >= b || i === n - 2) {
      return fa + ((v - a) / (b - a)) * (fb - fa);
    }
  }
  return table[n - 1][1];
}

/** Chart coordinates (0..1) for a longitude/latitude — use this to place missions. */
export function lonLatToChart(lon, lat) {
  return { x: knots(WORLD.lon, lon), y: knots(WORLD.lat, lat) };
}

/** Fleet-picker warning threshold (spec: ships under 40 % hull). */
const LOW_HP = 0.4;
const OBJ_ICON = { sink_all: 'swords', destroy_forts: 'castle', survive: 'hourglass', capture: 'flag' };
const DEFAULT_HOME = lonLatToChart(-76.85, 17.95);            // a free harbour in the Antilles
const WASHES = ['#5f9e8a', '#c9a24a', '#b0605a', '#6a86a8', '#8a7ab0', '#7f9a4e'];
const { W: CW, H: CH } = WORLD;

const r1 = (n) => Math.round(n * 10) / 10;
const pctX = (x) => `${(x / CW * 100).toFixed(3)}%`;
const pctY = (y) => `${(y / CH * 100).toFixed(3)}%`;

// ── data access (read at render time, never at import time) ──────────
const missionsAll = () => (Array.isArray(CAMPAIGN.MISSIONS) ? CAMPAIGN.MISSIONS : []).filter((m) => m && m.chart);
const regionsAll = () => (Array.isArray(CAMPAIGN.REGIONS) ? CAMPAIGN.REGIONS : []);
const factionsAll = () => FACT.FACTIONS || {};
const seasAll = () => (Array.isArray(FACT.SEAS) ? FACT.SEAS : []);
const patrolDef = () => CAMPAIGN.PATROL || null;
const warDef = () => CAMPAIGN.OPEN_WAR || null;
const homeChart = () => CAMPAIGN.HOME?.chart || CAMPAIGN.HOME_CHART || DEFAULT_HOME;
const getMission = (id) => CAMP.getMission(id);
const seaOf = (r) => seasAll().find((s) => s.id === r?.id) || null;
const regionOf = (m) => regionsAll().find((r) => r.id === m?.region) || null;
/** Region record merged with its SEAS entry (for vi names and factions). */
const regionFull = (r) => (r ? { ...(seaOf(r) || {}), ...r, vi: r.vi || seaOf(r)?.vi, factions: r.factions || seaOf(r)?.factions } : null);

function factionFor(m, region) {
  const F = factionsAll();
  const fromWaves = m?.objective?.waves?.flatMap((w) => w.ships || []).find((e) => e.faction)?.faction;
  const id = m?.faction || m?.enemies?.find((e) => e.faction)?.faction || fromWaves
    || region?.faction || regionFull(region)?.factions?.[0];
  return (id && F[id]) || null;
}
const styleOf = (e, fallback) => factionsAll()[e?.faction]?.style || fallback?.style || 'european';

function campaignProgress(p) {
  if (typeof CAMP.campaignProgress === 'function') { try { return CAMP.campaignProgress(p); } catch { /* fall through */ } }
  const ms_ = missionsAll();
  const won = ms_.filter((m) => p.campaign.won[m.id]).length;
  const stars = ms_.reduce((a, m) => a + (p.campaign.stars[m.id] || 0), 0);
  const fin = CAMPAIGN.FINAL_MISSION;
  return { won, total: ms_.length, stars, maxStars: ms_.length * 3, complete: !!(fin && p.campaign.won[fin]) };
}

// ── coast geometry (projected once) ─────────────────────────────────
function smoothPath(pts) {
  const n = pts.length;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + 'Z';
}

let _coast = null;
function coast() {
  if (_coast) return _coast;
  const P = ([lon, lat]) => { const c = lonLatToChart(lon, lat); return [c.x * CW, c.y * CH]; };
  const rnd = makePrng(1714);
  const polys = [];
  let d = '';
  const add = (str, wob) => {
    const raw = str.trim().split(/\s+/).map((t) => t.split(',').map(Number)).map(P);
    polys.push(raw);
    const pts = [];
    for (let i = 0; i < raw.length; i++) {
      const a = raw[i], b = raw[(i + 1) % raw.length];
      pts.push(a);
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L > 12) {
        const n = Math.min(4, Math.floor(L / 12));
        for (let k = 1; k <= n; k++) {
          const t = k / (n + 1), j = (rnd() - 0.5) * wob * 2;
          pts.push([a[0] + dx * t - (dy / L) * j, a[1] + dy * t + (dx / L) * j]);
        }
      }
    }
    d += smoothPath(pts);
  };
  Object.values(LANDS).forEach((s) => add(s, 1.7));
  Object.values(HOLES).forEach((s) => add(s, 1.2));
  Object.values(ISLANDS).forEach((s) => add(s, 0.7));
  for (const [lon, lat, r] of ISLETS) {
    if (!(r > 0)) continue;
    const [x, y] = P([lon, lat]);
    const rr = Math.max(1.8, r * 8.5);
    d += `M${r1(x - rr)} ${r1(y)}a${r1(rr)} ${r1(rr * 0.8)} 0 1 0 ${r1(rr * 2)} 0a${r1(rr)} ${r1(rr * 0.8)} 0 1 0 ${r1(-rr * 2)} 0Z`;
  }
  _coast = { d, polys, P };
  return _coast;
}

/** Even-odd point-in-land test in canvas px. */
function onLand(x, y) {
  let inside = false;
  for (const poly of coast().polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Nearest sea point to (x,y) in canvas px (unchanged when already at sea). */
function seaPoint(x, y) {
  if (!onLand(x, y)) return [x, y];
  for (let r = 7; r <= 260; r += 7) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      if (nx > 26 && nx < CW - 26 && ny > 26 && ny < CH - 26 && !onLand(nx, ny)) return [nx, ny];
    }
  }
  return [x, y];
}

const _snap = new Map();
/** Canvas position of a chart point, snapped to the sea for sea nodes. */
function nodePx(c, key, sea = true) {
  const k = `${key}|${c.x}|${c.y}|${sea}`;
  if (_snap.has(k)) return _snap.get(k);
  const x = Math.max(0, Math.min(1, c.x)) * CW, y = Math.max(0, Math.min(1, c.y)) * CH;
  const out = sea ? seaPoint(x, y) : [x, y];
  const v = { x: out[0], y: out[1] };
  _snap.set(k, v);
  return v;
}

/** Region washes: explicit chart box, else the padded bounds of its missions. */
function regionGeo(p) {
  const out = [];
  regionsAll().forEach((r, i) => {
    let box = null;
    const b = r.chart && r.chart.w ? r.chart : r.box && r.box.w ? r.box : null;
    if (b) box = { x0: b.x * CW, y0: b.y * CH, x1: (b.x + b.w) * CW, y1: (b.y + b.h) * CH };
    else {
      const pts = missionsAll().filter((m) => m.region === r.id).map((m) => nodePx(m.chart, m.id));
      if (!pts.length) return;
      const pad = 62;
      box = {
        x0: Math.min(...pts.map((q) => q.x)) - pad, x1: Math.max(...pts.map((q) => q.x)) + pad,
        y0: Math.min(...pts.map((q) => q.y)) - pad, y1: Math.max(...pts.map((q) => q.y)) + pad,
      };
      const minW = 190, minH = 150;
      if (box.x1 - box.x0 < minW) { const c = (box.x0 + box.x1) / 2; box.x0 = c - minW / 2; box.x1 = c + minW / 2; }
      if (box.y1 - box.y0 < minH) { const c = (box.y0 + box.y1) / 2; box.y0 = c - minH / 2; box.y1 = c + minH / 2; }
    }
    const rf = regionFull(r);
    const fac = factionsAll()[rf?.factions?.[0]];
    out.push({
      r: rf, box, open: CAMP.regionUnlocked(p, r.id),
      col: r.col || fac?.css || WASHES[i % WASHES.length],
      label: { x: (box.x0 + box.x1) / 2, y: Math.max(34, box.y0 + 14) },
    });
  });
  return out;
}

/** Quadratic route between two px points with a gentle bend. */
function routeD(a, b, bend) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const cx = (a.x + b.x) / 2 - (dy / len) * len * bend, cy = (a.y + b.y) / 2 + (dx / len) * len * bend;
  return `M${r1(a.x)} ${r1(a.y)}Q${r1(cx)} ${r1(cy)} ${r1(b.x)} ${r1(b.y)}`;
}

// ── chart ornaments ─────────────────────────────────────────────────
function rose(cx, cy, R) {
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const ro = R * 0.9, ri = i % 9 === 0 ? R * 0.76 : i % 3 === 0 ? R * 0.81 : R * 0.85;
    ticks += `M${r1(Math.cos(a) * ro)} ${r1(Math.sin(a) * ro)}L${r1(Math.cos(a) * ri)} ${r1(Math.sin(a) * ri)}`;
  }
  const point = (deg, len, wid, card) => {
    const a = ((deg - 90) * Math.PI) / 180;
    const tx = Math.cos(a) * len, ty = Math.sin(a) * len;
    const lx = Math.cos(a - Math.PI / 2) * wid, ly = Math.sin(a - Math.PI / 2) * wid;
    return `<path class="wc-rp-d${card ? ' is-card' : ''}" d="M0 0L${r1(tx)} ${r1(ty)}L${r1(lx)} ${r1(ly)}Z"/>`
      + `<path class="wc-rp-l" d="M0 0L${r1(tx)} ${r1(ty)}L${r1(-lx)} ${r1(-ly)}Z"/>`;
  };
  let pts = '';
  for (let i = 1; i < 16; i += 2) pts += point(i * 22.5, R * 0.5, R * 0.07);
  for (let i = 1; i < 8; i += 2) pts += point(i * 45, R * 0.7, R * 0.1);
  for (let i = 0; i < 4; i++) pts += point(i * 90, R * 1.02, R * 0.13, true);
  return `<g class="wc-rose" transform="translate(${r1(cx)} ${r1(cy)})">`
    + `<circle class="wc-rose-disc" r="${r1(R * 0.94)}"/><circle class="wc-rose-ring" r="${r1(R * 0.9)}"/>`
    + `<circle class="wc-rose-ring2" r="${r1(R * 0.74)}"/><path class="wc-rose-tick" d="${ticks}"/>${pts}`
    + `<circle class="wc-rose-hub" r="${r1(R * 0.07)}"/>`
    + `<path class="wc-rose-fleur" d="M0 ${r1(-R * 1.08)}c${r1(R * 0.06)} ${r1(-R * 0.1)} ${r1(R * 0.13)} ${r1(-R * 0.12)} ${r1(R * 0.14)} ${r1(-R * 0.22)}c${r1(-R * 0.08)} ${r1(R * 0.02)} ${r1(-R * 0.11)} ${r1(-R * 0.05)} ${r1(-R * 0.14)} ${r1(-R * 0.16)}c${r1(-R * 0.03)} ${r1(R * 0.11)} ${r1(-R * 0.06)} ${r1(R * 0.18)} ${r1(-R * 0.14)} ${r1(R * 0.16)}c${r1(R * 0.01)} ${r1(R * 0.1)} ${r1(R * 0.08)} ${r1(R * 0.12)} ${r1(R * 0.14)} ${r1(R * 0.22)}z"/></g>`;
}

function cartouche(cx, cy, w, h) {
  const x = cx - w / 2, y = cy - h / 2;
  let bar = '';
  const segW = (w * 0.5) / 5, bx = (w - segW * 5) / 2 - 16, by = h * 0.75;
  for (let i = 0; i < 5; i++) bar += `<rect x="${r1(bx + i * segW)}" y="${r1(by)}" width="${r1(segW)}" height="5" class="${i % 2 ? 'wc-sb-l' : 'wc-sb-d'}"/>`;
  const nums = [0, 100, 200, 300, 400, 500].map((n, i) => `<text x="${r1(bx + i * segW)}" y="${r1(by + 17)}" class="wc-sb-n">${n}</text>`).join('');
  const scroll = (sx) => `<path class="wc-cart-scroll" d="M${sx} 10c${sx ? 14 : -14} 4 ${sx ? 14 : -14} 18 0 22c${sx ? 10 : -10} 6 ${sx ? 10 : -10} 20 0 26"/>`;
  return `<g class="wc-cart" transform="translate(${r1(x)} ${r1(y)})">`
    + `<rect class="wc-cart-bg" width="${w}" height="${h}" rx="4"/><rect class="wc-cart-in" x="7" y="7" width="${w - 14}" height="${h - 14}"/>`
    + `<g transform="translate(0 ${r1(h / 2 - 34)})">${scroll(0)}</g><g transform="translate(${w} ${r1(h / 2 - 34)})">${scroll(0)}</g>`
    + `<path class="wc-cart-orn" d="M7 22Q22 22 22 7M${w - 7} 22Q${w - 22} 22 ${w - 22} 7M7 ${h - 22}Q22 ${h - 22} 22 ${h - 7}M${w - 7} ${h - 22}Q${w - 22} ${h - 22} ${w - 22} ${h - 7}"/>`
    + `<text class="wc-cart-t" x="${w / 2}" y="${r1(h * 0.38)}">${esc(ms('wc_cartoucheW'))}</text>`
    + `<text class="wc-cart-s" x="${w / 2}" y="${r1(h * 0.57)}">${esc(ms('wc_cartoucheWSub'))}</text>`
    + `${bar}${nums}<text class="wc-sb-u" x="${r1(bx + segW * 5 + 22)}" y="${r1(by + 6)}">${esc(ms('wc_leagues'))}</text></g>`;
}

function neatline() {
  const o = 10, i = 23;
  let seg = '';
  for (let x = i, k = 0; x < CW - i; x += 50, k++) {
    const w = Math.min(50, CW - i - x);
    if (k % 2) seg += `M${x} ${o}h${w}v${i - o}h${-w}zM${x} ${CH - i}h${w}v${i - o}h${-w}z`;
  }
  for (let y = i, k = 0; y < CH - i; y += 50, k++) {
    const h = Math.min(50, CH - i - y);
    if (k % 2) seg += `M${o} ${y}h${i - o}v${h}h${o - i}zM${CW - i} ${y}h${i - o}v${h}h${o - i}z`;
  }
  return `<g class="wc-neat"><rect class="wc-neat-o" x="${o}" y="${o}" width="${CW - 2 * o}" height="${CH - 2 * o}"/>`
    + `<rect class="wc-neat-i" x="${i}" y="${i}" width="${CW - 2 * i}" height="${CH - 2 * i}"/><path class="wc-neat-s" d="${seg}"/>`
    + `<path class="wc-neat-c" d="M${o} ${o}h${i - o}v${i - o}h${o - i}zM${CW - i} ${o}h${i - o}v${i - o}h${o - i}zM${o} ${CH - i}h${i - o}v${i - o}h${o - i}zM${CW - i} ${CH - i}h${i - o}v${i - o}h${o - i}z"/></g>`;
}

/** Sea serpent in ink (local box ≈ 190 × 70, waterline y 60). */
function serpent(x, y, s) {
  return `<g class="wc-beast" transform="translate(${r1(x - 95 * s)} ${r1(y - 45 * s)}) scale(${s})">`
    + '<path class="wc-b-water" d="M-6 62q10-7 20 0t20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0 20 0"/>'
    + '<path class="wc-b-body" d="M4 60C2 47 -9 44 -14 52C-8 49 -3 53 -1 60Z"/>'
    + '<path class="wc-b-body" d="M22 60C24 30 50 30 52 60Z"/><path class="wc-b-scale" d="M28 48q3 3 6 0M38 42q3 3 6 0M33 54q3 3 6 0M43 51q3 3 6 0"/>'
    + '<path class="wc-b-body" d="M68 60C70 36 92 36 94 60Z"/><path class="wc-b-scale" d="M74 50q3 3 6 0M83 46q3 3 6 0M79 56q3 3 6 0"/>'
    + '<path class="wc-b-body" d="M110 60C110 36 120 20 137 18C150 16 162 22 166 30C158 31 151 30 146 33C140 36 136 44 134 60Z"/>'
    + '<path class="wc-b-fin" d="M118 36L111 28L121 30L117 20L126 25L127 15L133 21"/>'
    + '<path class="wc-b-line" d="M166 30C160 36 152 38 146 36M150 26l3-1"/><circle class="wc-b-eye" cx="149" cy="24" r="1.9"/>'
    + '<path class="wc-b-water" d="M16 64q6-4 12 0M60 64q6-4 12 0M102 64q6-4 12 0"/></g>';
}

/** Spouting whale in ink (local box ≈ 130 × 60). */
function whale(x, y, s) {
  return `<g class="wc-beast" transform="translate(${r1(x - 65 * s)} ${r1(y - 34 * s)}) scale(${s})">`
    + '<path class="wc-b-water" d="M-4 50q9-6 18 0t18 0 18 0 18 0 18 0 18 0 18 0"/>'
    + '<path class="wc-b-body" d="M6 44C10 26 40 18 72 22C92 25 104 33 112 26C114 21 120 16 126 15C124 22 122 28 118 32C122 34 126 38 127 44C121 41 116 40 111 41C100 47 84 50 60 50C34 51 12 50 6 44Z"/>'
    + '<path class="wc-b-line" d="M12 40C26 44 44 45 60 44M20 31l3 0"/><circle class="wc-b-eye" cx="24" cy="33" r="1.7"/>'
    + '<path class="wc-b-spout" d="M30 20C26 10 31 4 28 -4M34 19C37 8 43 5 47 -1M26 21C20 12 15 9 11 4"/></g>';
}

/** Pick the first candidate (chart 0..1) that keeps `gap` px away from every node. */
function placeAt(cands, nodes, gap, needSea = true) {
  for (const c of cands) {
    const x = c.x * CW, y = c.y * CH;
    if (needSea && onLand(x, y)) continue;
    if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) > gap)) return { x, y };
  }
  return null;
}

const LL = (lon, lat) => lonLatToChart(lon, lat);
const LAND_LABELS = [
  ['lbl_america', -88, 41, 1], ['lbl_newspain', -101.5, 24.5, 0.62], ['lbl_brasil', -52, -10, 1], ['lbl_africa', 20, 9, 1.15],
  ['lbl_europa', 14, 50.5, 0.9], ['lbl_arabia', 45.5, 22.5, 0.75], ['lbl_persia', 56, 31.5, 0.7], ['lbl_india', 78.5, 22, 0.85],
  ['lbl_asia', 92, 42, 1.1], ['lbl_china', 110, 30, 0.85], ['lbl_holland', 124, -25, 0.8],
];
const SEA_LABELS = [
  ['sea_north', [LL(-42, 40), LL(-50, 34)]], ['sea_atlantic', [LL(-34, 14), LL(-28, 4), LL(-40, 22)]],
  ['sea_ethiopic', [LL(-10, -24), LL(-2, -30)]], ['sea_indian', [LL(76, -14), LL(66, -20), LL(84, -6)]],
  ['sea_pacific', [LL(-92, -10), LL(-95, 2)]],
];

/** Build the chart SVG (static per profile progress + language). */
function chartSvg(p, nodes) {
  const c = coast();
  const regs = regionGeo(p);
  const prog = campaignProgress(p);
  const nodeList = Object.values(nodes);

  // region washes
  const tints = regs.map((g, i) => {
    const cx = (g.box.x0 + g.box.x1) / 2, cy = (g.box.y0 + g.box.y1) / 2;
    const rx = ((g.box.x1 - g.box.x0) / 2) * 1.12, ry = ((g.box.y1 - g.box.y0) / 2) * 1.16;
    return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="url(#wc-rg${i})"/>`
      + (g.open ? '' : `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx * 0.86)}" ry="${r1(ry * 0.86)}" class="wc-lockwash"/>`);
  }).join('');
  const grads = regs.map((g, i) => {
    const col = g.open ? g.col : '#6b5a46';
    return `<radialGradient id="wc-rg${i}"><stop offset="0" stop-color="${col}" stop-opacity=".30"/><stop offset=".62" stop-color="${col}" stop-opacity=".15"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
  }).join('');

  // dotted route
  const home = nodes.home;
  const won = (id) => id === 'home' || !!p.campaign.won[id];
  let route = '', k = 0;
  for (const m of missionsAll()) {
    const reqs = (m.requires || []).filter((id) => nodes[id]);
    const st = CAMP.missionState(p, m);
    const from = reqs.length ? reqs : ['home'];
    for (const r of from) {
      const state = st === 'won' && won(r) ? 'done' : st === 'open' ? 'open' : 'locked';
      route += `<path class="wc-route is-${state}" d="${routeD(nodes[r], nodes[m.id], (k++ % 2 ? 1 : -1) * 0.1)}"/>`;
    }
  }
  if (nodes.patrol) route += `<path class="wc-route is-patrol" d="${routeD(home, nodes.patrol, 0.12)}"/>`;

  // ornaments, avoiding nodes
  const rose1 = placeAt([LL(-27, -17), LL(-33, -26), LL(-20, -8), LL(-38, 28)], nodeList, 130) || { x: 0.31 * CW, y: 0.76 * CH };
  const rose2 = placeAt([LL(84, -30), LL(70, -32), LL(92, -22), LL(62, -28)], nodeList, 110);
  const cart = placeAt([LL(-31, 50.5), LL(-62, -34), LL(52, -37)], nodeList, 150, false) || { x: 0.3 * CW, y: 0.075 * CH };
  const beast1 = placeAt([LL(-9, -33), LL(-20, -36), LL(2, -38), LL(-45, 5)], nodeList, 120);
  const beast2 = placeAt([LL(58, -32), LL(96, -34), LL(66, -6), LL(100, -18)], nodeList, 110);
  const ship1 = placeAt([LL(-48, 26), LL(-38, 33), LL(-24, 20)], nodeList, 90);
  const ship2 = placeAt([LL(127, 17), LL(122, 3), LL(129, 26)], nodeList, 90);
  const lines = [];
  for (const rr of [rose1, rose2].filter(Boolean)) {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      lines.push(`<path class="wc-rhumb${i % 4 ? '' : ' is-major'}" d="M${r1(rr.x)} ${r1(rr.y)}L${r1(rr.x + Math.cos(a) * 2600)} ${r1(rr.y + Math.sin(a) * 2600)}"/>`);
    }
  }
  const landLbl = LAND_LABELS.map(([key, lon, lat, sz]) => {
    const q = LL(lon, lat), x = q.x * CW, y = q.y * CH;
    if (nodeList.some((n) => Math.hypot(n.x - x, n.y - y) < 70)) return '';
    return `<text class="wc-land-lbl" x="${r1(x)}" y="${r1(y)}" style="font-size:${r1(26 * sz)}px">${esc(ms(key))}</text>`;
  }).join('');
  const seaLbl = SEA_LABELS.map(([key, cands]) => {
    const at = placeAt(cands, nodeList, 120);
    return at ? `<text class="wc-sea-lbl" x="${r1(at.x)}" y="${r1(at.y)}">${esc(ms(key))}</text>` : '';
  }).join('');
  const sketch = (pt, hullId, style, s) => {
    if (!pt) return '';
    const w = 74 * s, h = w * 0.625;
    return `<svg class="wc-sketch" x="${r1(pt.x - w / 2)}" y="${r1(pt.y - h / 2)}" width="${r1(w)}" height="${r1(h)}" viewBox="0 -3 80 50">${hullSvg(hullId, '', style).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>`;
  };
  // the final battle wears a laurel once the campaign is won
  const fin = CAMPAIGN.FINAL_MISSION && nodes[CAMPAIGN.FINAL_MISSION];
  const crown = prog.complete && fin
    ? `<g class="wc-victory">${laurel(fin.x, fin.y + 4, 44, 'wc-laurel')}<g transform="translate(${r1(fin.x - 15)} ${r1(fin.y - 66)}) scale(1.25)" class="wc-crown">${icon('crown').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></g>`
    : '';

  return `<svg class="wc-svg" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<defs>
  <radialGradient id="wc-paper" cx="48%" cy="44%" r="78%"><stop offset="0" stop-color="#f6ecd2"/><stop offset=".58" stop-color="#ecdcb2"/><stop offset="1" stop-color="#d6b981"/></radialGradient>
  <radialGradient id="wc-burn" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#5a3510" stop-opacity="0"/><stop offset=".88" stop-color="#5a3510" stop-opacity=".2"/><stop offset="1" stop-color="#2e1804" stop-opacity=".58"/></radialGradient>
  <radialGradient id="wc-seawash" cx="55%" cy="55%" r="75%"><stop offset="0" stop-color="#6f9da0" stop-opacity=".13"/><stop offset="1" stop-color="#6f9da0" stop-opacity=".05"/></radialGradient>
  ${grads}
  <pattern id="wc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M0 0V6" stroke="#5a3f22" stroke-width="1" opacity=".5"/></pattern>
  <pattern id="wc-lockhatch" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><path d="M0 0V11" stroke="#3a2613" stroke-width="1.6" opacity=".22"/></pattern>
  <path id="wc-landp" d="${c.d}" fill-rule="evenodd"/>
  <clipPath id="wc-landclip"><use href="#wc-landp" clip-rule="evenodd"/></clipPath>
  ${[[9, 2], [18, 1.6], [29, 1.3]].map(([d, w], i) => `<mask id="wc-ring${i}" maskUnits="userSpaceOnUse" x="-400" y="-400" width="${CW + 800}" height="${CH + 800}">`
    + `<rect x="-400" y="-400" width="${CW + 800}" height="${CH + 800}" fill="#fff"/><use href="#wc-landp" fill="#000" stroke="#000" stroke-width="${2 * d - w}" stroke-linejoin="round"/></mask>`).join('')}
</defs>
<rect width="${CW}" height="${CH}" fill="url(#wc-paper)"/>
<rect width="${CW}" height="${CH}" fill="url(#wc-seawash)"/>
<g class="wc-rhumbs">${lines.join('')}</g>
<g class="wc-tints">${tints}</g>
<use href="#wc-landp" class="wc-shallow" stroke-width="40"/>
<use href="#wc-landp" class="wc-shallow" stroke-width="18"/>
${[[9, 2], [18, 1.6], [29, 1.3]].map(([d, w], i) => `<use href="#wc-landp" class="wc-ring" stroke-width="${2 * d + w}" mask="url(#wc-ring${i})" style="opacity:${[0.5, 0.32, 0.18][i]}"/>`).join('')}
<use href="#wc-landp" class="wc-land"/>
<use href="#wc-landp" class="wc-land-hatch" fill="url(#wc-hatch)"/>
<g clip-path="url(#wc-landclip)"><use href="#wc-landp" class="wc-land-edge" stroke-width="14"/></g>
<use href="#wc-landp" class="wc-coast"/>
<g class="wc-landlbls">${landLbl}</g>
<g class="wc-sealbls">${seaLbl}</g>
<g class="wc-routes">${route}</g>
${sketch(ship1, 'galleon', 'european', 1)}${sketch(ship2, 'frigate', 'junk', 0.95)}
${beast1 ? serpent(beast1.x, beast1.y, 0.9) : ''}${beast2 ? whale(beast2.x, beast2.y, 0.85) : ''}
${rose(rose1.x, rose1.y, 70)}${rose2 ? rose(rose2.x, rose2.y, 50) : ''}
${cartouche(cart.x, cart.y, 330, 112)}
${crown}
<rect width="${CW}" height="${CH}" fill="url(#wc-burn)" class="wc-burn"/>
${neatline()}
</svg>`;
}

/** Human objective text for a mission def. */
function objectiveText(m) {
  const o = m.objective || { type: 'sink_all' };
  const isl = m.islands || [];
  if (o.type === 'destroy_forts') return ms('obj_destroy_forts', isl.filter((i) => i.own === 'enemy').length || 1);
  if (o.type === 'survive') return ms('obj_survive', fmtClock(o.seconds || 0), (o.waves || []).length);
  if (o.type === 'capture') {
    return ms('obj_capture', (o.islands || []).map((id) => isleName(isl.find((i) => i.id === id) || { id, nm: id })).join(', '));
  }
  return ms('obj_sink_all');
}

/** Why a mission cannot be sailed ('' when it can). */
function lockReason(p, m) {
  const r = regionOf(m);
  if (r && !CAMP.regionUnlocked(p, m.region)) return ms('wc_regionLockLong', r.minRenown, regionName(regionFull(r)));
  const missing = (m.requires || []).filter((id) => !p.campaign.won[id]).map((id) => missionName(getMission(id) || { id, nm: id }));
  return missing.length ? ms('wc_requires', missing.join(', ')) : '';
}

/** <option>s for a doctrine <select>: keep + every doctrine (+ a blank "mixed" row). */
function docOptions(cur, mixed = false) {
  return (mixed ? `<option value="">—</option>` : '')
    + `<option value="${DOCTRINE_KEEP}" ${cur === DOCTRINE_KEEP ? 'selected' : ''}>${esc(ms('doc_keep'))}</option>`
    + DOCTRINES.map((d) => `<option value="${d.id}" ${cur === d.id ? 'selected' : ''}>${d.icon} ${esc(doctrineName(d.id))}</option>`).join('');
}

function starsRow(n, cls = '') {
  return `<span class="mx-stars ${cls}" aria-label="${n}/3">${[0, 1, 2].map((i) => starIcon(i < n ? 'on' : 'off')).join('')}</span>`;
}

export class WorldChart {
  /** @param {object} ctx see file header */
  constructor(ctx) {
    this.ctx = ctx;
    this._root = null;
    this._open = false;
    this._timer = 0;
    this._modal = null;
    this._brief = null;            // node id of the open orders card
    this._sel = new Set();
    this._docs = {};              // uid → doctrine id | "keep" (pre-sail picker)
    this._seed = 0;
    this._svgSig = '';
    this._sailing = false;
    this._panned = false;
    this._onLang = () => { if (this._open) { this._svgSig = ''; this._labels(); this._render(); if (this._brief) this._renderBrief(true); } };
    this._onExt = (e) => { if (this._open && e.detail?.source !== 'chart') this._render(); };
    this._onResize = () => this._layout();
    ensureMetaCss();
  }

  /** @returns {boolean} */
  isOpen() { return this._open; }

  toggle() { if (this._open) this.close(); else this.open(); }

  open() {
    if (this._open) return;
    this._ensureRoot();
    this._open = true;
    this._sailing = false;
    this._panned = false;
    clearTimeout(this._hideT);
    this._root.hidden = false;
    this._root.classList.remove('is-closing');
    revealWhenStyled(this._root);
    this._labels();
    this._tick();
    this._render();
    this._layout();
    this._modal = pushModal({ el: this._root, onEsc: () => this._onEsc(), name: 'chart' });
    focusFirst(this._root, '.wc-focus');
    this._timer = setInterval(() => this._tick(), 1000);
    window.addEventListener('iow:langchange', this._onLang);
    window.addEventListener('iow:meta-changed', this._onExt);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = this._ro || new ResizeObserver(() => this._layout());
      this._ro.observe(this._f.stage);
    }
    call(this.ctx, 'sfx', 'ui_click');
  }

  close() {
    if (!this._open) return;
    this._open = false;
    clearInterval(this._timer); this._timer = 0;
    this._ro?.disconnect();
    window.removeEventListener('iow:langchange', this._onLang);
    window.removeEventListener('iow:meta-changed', this._onExt);
    window.removeEventListener('resize', this._onResize);
    this._closeBrief(false);
    if (this._modal) { popModal(this._modal); this._modal = null; }
    const root = this._root;
    if (reducedMotion()) { root.hidden = true; return; }
    root.classList.add('is-closing');
    this._hideT = setTimeout(() => { root.hidden = true; root.classList.remove('is-closing'); }, 200);
  }

  /** Re-read the profile (call after outside changes). */
  refresh() { if (this._open) { this._render(); if (this._brief) this._renderBrief(); } }

  /**
   * Open the orders card for a node: a mission id, 'patrol' or 'open_war'.
   * Opens the chart first when needed.
   */
  openBriefing(id) {
    if (!this._open) this.open();
    const isNode = id === patrolDef()?.id || id === warDef()?.id || !!getMission(id);
    if (!isNode) return;
    const p = this.ctx.getProfile();
    if (id !== this._brief) {
      this._brief = id;
      if (id === patrolDef()?.id) this._seed = nowOf(this.ctx) % 100000;
      const cap = fleetCap(p);
      const ships = [...sailableShips(p)].sort((a, b) => (b.hpFrac ?? 1) - (a.hpFrac ?? 1));
      this._sel = new Set(ships.slice(0, cap).map((s) => s.uid));
      // pre-sail doctrine per ship: the one it last sailed with (profile.fleet[i].doctrine)
      this._docs = Object.fromEntries(p.fleet.map((s) => [s.uid, DOCTRINE_BY_ID.has(s.doctrine) ? s.doctrine : DOCTRINE_KEEP]));
    }
    this._sailing = false;
    this._root.classList.add('has-brief');
    this._f.brief.hidden = false;
    this._renderBrief(true);
    this._markActive();
    this._scrollToNode(id);
    focusFirst(this._f.brief, '.wc-btitle');
    call(this.ctx, 'sfx', 'ui_click');
  }

  // ── construction ────────────────────────────────────────────────
  _ensureRoot() {
    if (this._root) return;
    const tid = domId('wc-title'), bid = domId('wc-brief');
    this._root = el(`
<div class="wc-root" role="dialog" aria-modal="true" aria-labelledby="${tid}" hidden>
  <header class="wc-top">
    <div class="wc-brand"><span class="wc-brand-ic" aria-hidden="true">${icon('compass')}</span><h2 class="wc-focus" id="${tid}" tabindex="-1" data-f="title"></h2></div>
    <div class="wc-rank" data-f="rankTip">
      <span class="wc-rank-badge" data-f="rbadge" aria-hidden="true"></span>
      <div class="wc-rank-txt">
        <div class="wc-rank-row"><b class="wc-rank-nm" data-f="rname"></b><span class="wc-renown" data-f="renownTip">${resIcon('renown')}<b data-f="renown"></b></span></div>
        <div class="mx-bar renown" role="progressbar" aria-valuemin="0" aria-valuemax="100" data-f="rbarWrap"><i data-f="rbar"></i></div>
        <div class="wc-rank-next" data-f="rnext"></div>
      </div>
    </div>
    <div class="wc-camp" data-f="camp"><span class="wc-camp-ic" data-f="campIc"></span><span><b data-f="campT"></b><span class="wc-camp-s">${starIcon('on')}<b data-f="campS"></b></span></span></div>
    <div class="wc-res">
      <span class="mx-res" data-f="woodTip">${resIcon('wood')}<b data-f="wood"></b></span>
      <span class="mx-res" data-f="goldTip">${resIcon('gold')}<b data-f="gold"></b></span>
      <span class="mx-res wc-ready" data-f="readyTip">${icon('ship')}<b data-f="ready"></b></span>
    </div>
    <div class="wc-tools">
      <button type="button" class="mx-x wc-helpbtn" data-act="help" data-f="help">${icon('help')}</button>
      <button type="button" class="mx-btn good wc-back" data-act="close" data-f="back">${icon('anchor')}<span data-f="backL"></span></button>
    </div>
  </header>
  <div class="wc-stage" data-f="stage">
    <div class="wc-map" data-f="map">
      <div class="wc-svgwrap" data-f="svg"></div>
      <div class="wc-paperfx" aria-hidden="true"></div>
      <div class="wc-nodes" data-f="nodes"></div>
    </div>
  </div>
  <aside class="wc-brief" data-f="brief" role="region" aria-labelledby="${bid}" hidden>
    <span class="mx-corner tl"></span><span class="mx-corner bl"></span>
    <div class="wc-brief-in" data-f="briefIn"></div>
  </aside>
</div>`);
    this._f = {};
    this._root.querySelectorAll('[data-f]').forEach((n) => { this._f[n.dataset.f] = n; });
    this._bid = bid;
    this._root.addEventListener('click', (e) => this._onClick(e));
    this._root.addEventListener('change', (e) => this._onChange(e));
    this._root.addEventListener('pointerover', (e) => {
      const n = e.target.closest?.('.wc-node');
      if (n && n !== this._hoverN) { this._hoverN = n; call(this.ctx, 'sfx', 'ui_hover'); }
    });
    this._bindPan();
    document.body.appendChild(this._root);
  }

  /** Mouse drag-to-pan when the map is wider than the stage (touch scrolls natively). */
  _bindPan() {
    const st = this._f.stage;
    let drag = null;
    st.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !st.classList.contains('is-pan')) return;
      if (e.target.closest('.wc-node, .wc-rtag, button')) return;
      drag = { x: e.clientX, y: e.clientY, l: st.scrollLeft, t: st.scrollTop };
      st.classList.add('is-drag');
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      st.scrollLeft = drag.l - (e.clientX - drag.x);
      st.scrollTop = drag.t - (e.clientY - drag.y);
    });
    window.addEventListener('pointerup', () => { if (drag) { drag = null; st.classList.remove('is-drag'); } });
  }

  _labels() {
    const f = this._f;
    setText(f.title, ms('wc_title'));
    setText(f.backL, ms('wc_back'));
    f.back.title = ms('wc_backTip') + ' (Esc)';
    f.help.title = ms('wc_help'); f.help.setAttribute('aria-label', ms('wc_help'));
    f.woodTip.title = ms('wood'); f.goldTip.title = ms('gold'); f.readyTip.title = ms('wc_readyTip');
    f.renownTip.title = ms('renown');
  }

  // ── layout & rendering ───────────────────────────────────────────
  _layout() {
    if (!this._open) return;
    const stage = this._f.stage;
    const st = stage.getBoundingClientRect();
    if (st.width < 10 || st.height < 10) return;
    const pad = st.width < 600 ? 6 : 14;
    const fit = Math.min((st.width - pad * 2) / CW, (st.height - pad * 2) / CH);
    const minH = Math.min(st.height - pad * 2, 540);
    const s = CH * fit < minH ? minH / CH : fit;
    const mw = Math.floor(CW * s), mh = Math.floor(CH * s);
    const map = this._f.map;
    map.style.width = `${mw}px`;
    map.style.height = `${mh}px`;
    map.style.setProperty('--wc-k', String(Math.max(0.74, Math.min(1.12, mw / 1400))));
    const pan = mw > st.width - pad * 2 + 1;
    stage.classList.toggle('is-pan', pan);
    if (pan && !this._panned) {
      this._panned = true;
      const focus = this._brief || this._focusId();
      if (focus) this._scrollToNode(focus, false);
    }
  }

  /** The node a newcomer should look at: first open mission, else home. */
  _focusId() {
    const p = this.ctx.getProfile();
    const m = missionsAll().find((x) => CAMP.missionState(p, x) === 'open');
    return m ? m.id : 'home';
  }

  _scrollToNode(id, smooth = true) {
    const stage = this._f.stage;
    if (!stage.classList.contains('is-pan')) return;
    const n = this._nodes?.[id];
    if (!n) return;
    const mapW = this._f.map.offsetWidth;
    const left = (n.x / CW) * mapW - stage.clientWidth / 2;
    stage.scrollTo({ left: Math.max(0, left), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }

  _tick() {
    if (!this._open) return;
    const p = this.ctx.getProfile();
    const done = tickRoster(p, nowOf(this.ctx));
    if (done.length) {
      call(this.ctx, 'save'); call(this.ctx, 'onProfileChanged');
      emitMetaChanged({ source: 'chart' });
      done.forEach((s) => call(this.ctx, 'toast', ms('t_ready', s.nm), 'good'));
      call(this.ctx, 'sfx', 'bell');
    }
    this._top(p);
    if (this._brief) this._renderPicker(p);
  }

  _top(p) {
    const f = this._f;
    const ri = CAMP.rankIndex(p.renown), cur = CAMP.rankOf(p.renown), nxt = CAMP.nextRank(p.renown);
    if (f.rbadge._i !== ri) { f.rbadge.innerHTML = rankBadge(ri); f.rbadge._i = ri; }
    setText(f.rname, rankName(cur));
    setText(f.renown, fmtNum(p.renown));
    const prog = nxt ? (p.renown - cur.renown) / Math.max(1, nxt.renown - cur.renown) : 1;
    f.rbar.style.width = `${Math.round(Math.max(0, Math.min(1, prog)) * 100)}%`;
    f.rbarWrap.setAttribute('aria-valuenow', String(Math.round(prog * 100)));
    setText(f.rnext, nxt ? ms('wc_next', fmtNum(nxt.renown - p.renown), rankName(nxt)) : ms('wc_max'));
    f.rankTip.title = `${rankName(cur)} · ${ms('renown')} ${fmtNum(p.renown)}`;
    const cp = campaignProgress(p);
    setText(f.campT, cp.complete ? ms('wc_campaignDone') : ms('wc_campaign', cp.won, cp.total));
    setText(f.campS, `${cp.stars}/${cp.maxStars}`);
    if (f.campIc._c !== cp.complete) { f.campIc.innerHTML = icon(cp.complete ? 'crown' : 'flag'); f.campIc._c = cp.complete; }
    f.camp.classList.toggle('is-done', !!cp.complete);
    f.camp.title = ms('wc_campaignTip', cp.won, cp.total, cp.stars, cp.maxStars);
    setText(f.wood, fmtNum(p.res.wood));
    setText(f.gold, fmtNum(p.res.gold));
    setText(f.ready, ms('wc_ready', sailableShips(p).length));
  }

  /** Canvas px of every node (missions snapped to sea; home stays put). */
  _nodePositions() {
    const nodes = {};
    for (const m of missionsAll()) nodes[m.id] = nodePx(m.chart, m.id);
    const pd = patrolDef(), wd = warDef();
    if (pd?.chart) nodes[pd.id] = nodePx(pd.chart, pd.id);
    if (wd?.chart) nodes[wd.id] = nodePx(wd.chart, wd.id);
    nodes.home = nodePx(homeChart(), 'home', false);
    return nodes;
  }

  _render() {
    if (!this._root) return;
    const p = this.ctx.getProfile();
    this._top(p);
    this._nodes = this._nodePositions();
    const sig = [
      Object.keys(p.campaign.won).sort().join(','), regionsAll().map((r) => CAMP.regionUnlocked(p, r.id)).join(''),
      ms('wc_title'), missionsAll().length,
    ].join('|');
    if (sig !== this._svgSig) {
      this._svgSig = sig;
      this._f.svg.innerHTML = chartSvg(p, this._nodes);
    }
    this._renderNodes(p);
  }

  _renderNodes(p) {
    const items = [];
    const nodes = this._nodes;
    for (const m of missionsAll()) {
      const st = CAMP.missionState(p, m);
      const stars = p.campaign.stars[m.id] || 0;
      const fac = factionFor(m, regionOf(m));
      const nm = missionName(m);
      items.push({
        key: m.id, at: nodes[m.id], cls: `is-${st} k-mission${st === 'open' ? ' is-next' : ''}${m.id === CAMPAIGN.FINAL_MISSION ? ' is-final' : ''}`,
        ic: st === 'locked' ? 'lock' : OBJ_ICON[m.objective?.type] || 'swords',
        name: nm, stars: st === 'won' ? stars : -1, fac,
        aria: `${nm} — ${ms('wc_' + st)}${st === 'won' ? ` · ${stars}/3` : ''}${fac ? ` · ${factionName(fac)}` : ''}`,
        sig: `${st}|${stars}|${nm}|${fac?.id || ''}`,
      });
    }
    const pd = patrolDef(), wd = warDef();
    if (pd && nodes[pd.id]) {
      const pw = p.campaign.patrolsWon || 0;
      items.push({ key: pd.id, at: nodes[pd.id], cls: 'is-open k-patrol', ic: 'spyglass', name: missionName(pd),
        sub: ms('wc_repeatable'), aria: `${missionName(pd)} — ${ms('wc_repeatable')}`, sig: `p|${pw}|${missionName(pd)}`, stars: -1 });
    }
    if (wd && nodes[wd.id]) {
      items.push({ key: wd.id, at: nodes[wd.id], cls: 'is-open k-war', ic: 'cannon', name: ms('wc_openWar'),
        sub: ms('wc_openWarTag'), aria: ms('wc_openWar'), sig: `w|${ms('wc_openWar')}`, stars: -1 });
    }
    items.push({ key: 'home', at: nodes.home, cls: 'k-home', ic: 'anchor', name: ms('wc_home'), aria: ms('wc_backTip'), sig: `h|${ms('wc_home')}`, stars: -1 });
    for (const g of regionGeo(p)) {
      const flags = (g.r.factions || []).map((id) => factionsAll()[id]).filter(Boolean);
      items.push({ key: 'rg-' + g.r.id, region: g, flags, sig: `r|${g.open}|${regionName(g.r)}|${flags.map((x) => x.id).join(',')}|${r1(g.label.x)}|${r1(g.label.y)}` });
    }
    patchKeyed(this._f.nodes, items, {
      key: (it) => it.key,
      sig: (it) => it.sig,
      html: (it) => {
        if (it.region) {
          const g = it.region;
          return `<div class="wc-rtag ${g.open ? '' : 'is-locked'}" style="left:${pctX(g.label.x)};top:${pctY(g.label.y)}" title="${esc(regionDesc(g.r) || regionName(g.r))}">`
            + `<span class="wc-rtag-nm">${esc(regionName(g.r))}</span>`
            + (it.flags.length ? `<span class="wc-rtag-flags">${it.flags.map((fa) => `<span title="${esc(factionName(fa))}">${flagSvg(fa)}</span>`).join('')}</span>` : '')
            + (g.open ? '' : `<span class="wc-rlock">${icon('lock')}${esc(ms('wc_regionLock', g.r.minRenown))}</span>`) + '</div>';
        }
        return `<button type="button" class="wc-node ${it.cls}" style="left:${pctX(it.at.x)};top:${pctY(it.at.y)}" data-act="node" data-id="${esc(it.key)}" data-fk="node:${esc(it.key)}" aria-label="${esc(it.aria)}">`
          + `<span class="wc-medal"><span class="wc-medal-ic">${icon(it.ic)}</span></span>`
          + (it.fac ? `<span class="wc-pin" aria-hidden="true">${flagSvg(it.fac)}</span>` : '')
          + (it.stars >= 0 ? starsRow(it.stars, 'wc-nstars') : '')
          + `<span class="wc-lbl">${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
      },
    });
    this._markActive();
  }

  _markActive() {
    this._f.nodes.querySelectorAll('.wc-node').forEach((n) => {
      const on = n.dataset.id === this._brief;
      n.classList.toggle('is-active', on);
      n.setAttribute('aria-pressed', String(on));
    });
  }

  // ── orders card ──────────────────────────────────────────────────
  _missionFor(id, p) {
    if (id === patrolDef()?.id) return CAMP.makePatrol(p, this._seed);
    return getMission(id);
  }

  _renderBrief(full = false) {
    const p = this.ctx.getProfile();
    const id = this._brief;
    const host = this._f.briefIn;
    if (!id) return;
    if (full || host.dataset.for !== id) {
      host.dataset.for = id;
      host.innerHTML = id === warDef()?.id ? this._warHtml() : this._missionHtml(this._missionFor(id, p), p);
    }
    if (id !== warDef()?.id) this._renderPicker(p);
  }

  _warHtml() {
    return `
<header class="wc-bhead is-war">
  <div class="wc-bregion">${icon('cannon')}<span>${esc(ms('wc_openWarTag'))}</span></div>
  <h3 class="wc-btitle" id="${this._bid}" tabindex="-1">${esc(ms('wc_openWar'))}</h3>
  <button type="button" class="mx-x wc-bx" data-act="brief-close" aria-label="${esc(ms('wc_closeBrief'))}" title="${esc(ms('wc_closeBrief'))}">${icon('close')}</button>
</header>
<div class="wc-bscroll"><p class="wc-bdesc">${esc(ms('wc_openWarDesc'))}</p>
  <div class="wc-warart" aria-hidden="true"><span class="sv-well wl-ready">${hullSvg('man_o_war')}</span><span class="sv-well wl-ready">${hullSvg('war_galleon')}</span></div></div>
<footer class="wc-bfoot"><button type="button" class="mx-btn primary big wc-sail" data-act="war">${esc(ms('wc_declare'))}</button></footer>`;
  }

  _missionHtml(m, p) {
    const isPatrol = !!m.repeatable;
    const region = regionFull(regionOf(m));
    const st = isPatrol ? 'open' : CAMP.missionState(p, m);
    const best = p.campaign.stars[m.id] || 0;
    const lock = isPatrol ? '' : lockReason(p, m);
    const won = !!p.campaign.won[m.id];
    const fac = factionFor(m, region);

    const group = (arr) => {
      const map = new Map();
      for (const e of arr || []) {
        const h = CAMP.resolveHull(e.hull);
        const fe = factionsAll()[e.faction] || fac;
        const key = h.id + '|' + (fe?.id || '');
        const g = map.get(key) || { h, n: 0, names: [], fe };
        g.n++; if (e.nm) g.names.push(e.nm);
        map.set(key, g);
      }
      return [...map.values()].map((g) => `<li class="wc-foe" title="${esc(g.names.join(', ') || hullName(g.h))}">`
        + `<span class="wc-foe-ic sv-well wl-foe">${hullSvg(g.h.id, '', styleOf({ faction: g.fe?.id }, g.fe))}</span>`
        + `<span class="wc-foe-txt"><b>${g.n > 1 ? `<em>${g.n}×</em> ` : ''}${esc(hullName(g.h))}</b>${tierBadge(g.h.tier)}<small>${esc(g.names.join(', ') || className(g.h.hull))}</small></span></li>`).join('');
    };
    let foes = '';
    if (m.enemies?.length) foes += `<ul class="wc-foes">${group(m.enemies)}</ul>`;
    if (m.objective?.type === 'survive') {
      (m.objective.waves || []).forEach((w, i) => {
        foes += `<div class="wc-wave">${esc(ms('wc_wave', i + 1, fmtClock(w.at)))}</div><ul class="wc-foes">${group(w.ships)}</ul>`;
      });
    }
    const forts = (m.islands || []).filter((i) => i.own === 'enemy');
    if (forts.length) {
      foes += `<ul class="wc-foes">${forts.map((i) => `<li class="wc-foe is-fort"><span class="wc-foe-ic">${icon('castle')}</span><span class="wc-foe-txt"><b>${esc(isleName(i))}</b><small>${esc(ms('wc_fort'))} · ${fmtNum(i.hp)} ${esc(ms('hp'))}</small></span></li>`).join('')}</ul>`;
    }

    const fc = m.firstClear || { wood: 0, gold: 0 };
    const hasFirst = !isPatrol && (fc.wood || fc.gold);
    const tl = m.timeLimit ? `<div class="wc-obj-tl">${icon('clock')}${esc(ms('obj_timeLimit', fmtClock(m.timeLimit)))}</div>` : '';
    const stateChip = isPatrol
      ? `<span class="mx-tag tag-repeat">${icon('spyglass')}${esc(ms('wc_repeatable'))} · ${esc(ms('wc_patrols', p.campaign.patrolsWon || 0))}</span>`
      : `<span class="mx-tag tag-${st}">${icon(st === 'won' ? 'check' : st === 'locked' ? 'lock' : 'flag')}${esc(ms('wc_' + st))}</span>${won ? `<span class="wc-best"><small>${esc(ms('wc_best'))}</small>${starsRow(best)}</span>` : ''}`;

    return `
<header class="wc-bhead" style="--rc:${esc(region?.col || fac?.css || '#c8a35a')}">
  <div class="wc-bregion" title="${esc(region ? regionDesc(region) : '')}"><i></i><span>${esc(region ? regionName(region) : '')}</span></div>
  <h3 class="wc-btitle" id="${this._bid}" tabindex="-1">${esc(missionName(m))}</h3>
  <div class="wc-bstate">${stateChip}</div>
  ${fac ? `<div class="wc-bfac" title="${esc(fac.note || '')}"><span class="wc-bfac-flag">${flagSvg(fac)}</span><span><small>${esc(ms('wc_faction'))}</small><b>${esc(factionName(fac))}</b></span></div>` : ''}
  <button type="button" class="mx-x wc-bx" data-act="brief-close" aria-label="${esc(ms('wc_closeBrief'))}" title="${esc(ms('wc_closeBrief'))}">${icon('close')}</button>
</header>
<div class="wc-bscroll">
  <p class="wc-bdesc">${esc(missionDesc(m))}${isPatrol ? ` <em>${esc(ms('wc_patrolNote'))}</em>` : ''}</p>
  <section class="wc-bsec">
    <h4 class="mx-sec sm"><span>${esc(ms('wc_objective'))}</span></h4>
    <div class="wc-obj"><span class="wc-obj-ic">${icon(OBJ_ICON[m.objective?.type] || 'swords')}</span><span>${esc(objectiveText(m))}</span></div>${tl}
  </section>
  <section class="wc-bsec">
    <h4 class="mx-sec sm"><span>${esc(ms('wc_enemies'))}</span></h4>${foes}
  </section>
  <section class="wc-bsec wc-rew">
    <h4 class="mx-sec sm"><span>${esc(ms('wc_reward'))}</span></h4>
    <div class="wc-rew-row">
      <span class="mx-res lg">${resIcon('wood')}<b>${fmtNum(m.reward?.wood || 0)}</b></span>
      <span class="mx-res lg">${resIcon('gold')}<b>${fmtNum(m.reward?.gold || 0)}</b></span>
      <span class="mx-res lg">${resIcon('renown')}<b>+${fmtNum(m.renown || 0)}</b></span>
    </div>
    ${hasFirst ? `<div class="wc-first ${won ? 'is-claimed' : ''}">${icon(won ? 'check' : 'sparkle')}<span>${esc(ms('wc_firstClear'))}</span><span class="mx-res">${resIcon('wood')}<b>+${fmtNum(fc.wood)}</b></span><span class="mx-res">${resIcon('gold')}<b>+${fmtNum(fc.gold)}</b></span>${won ? `<em>${esc(ms('wc_claimed'))}</em>` : ''}</div>` : ''}
    <p class="wc-note">${esc(ms('wc_plunderNote'))}</p>
    <ol class="wc-srules">
      <li>${starsRow(1, 'xs')}<span>${esc(ms('wc_star1'))}</span></li>
      <li>${starsRow(2, 'xs')}<span>${esc(ms('wc_star2'))}</span></li>
      <li>${starsRow(3, 'xs')}<span>${esc(ms('wc_star3', fmtClock(m.parTime || 0)))}</span><small>${esc(ms('wc_par'))}</small></li>
    </ol>
  </section>
  <section class="wc-bsec wc-fleet" ${lock ? 'hidden' : ''}>
    <h4 class="mx-sec sm"><span>${esc(ms('wc_fleet'))}</span><small data-f2="selN"></small></h4>
    ${this._docHintHtml(m)}
    <label class="wc-docall"><span>${esc(ms('doc_bar'))} · ${esc(ms('doc_all'))}</span>
      <select class="mx-select wc-docsel" data-doc="all" data-f2="docAll">${docOptions('', true)}</select></label>
    <div class="wc-picks" data-f2="picks"></div>
    <p class="wc-note wc-capnote" data-f2="capNote"></p>
    <p class="wc-note" data-f2="yard" hidden></p>
  </section>
</div>
<footer class="wc-bfoot">
  ${lock ? `<p class="wc-block">${icon('lock')}<span>${esc(lock)}</span></p>` : '<p class="wc-block" data-f2="why" hidden></p>'}
  <button type="button" class="mx-btn primary big wc-sail" data-act="sail" data-fk="sail" ${lock ? 'disabled' : ''}>${esc(ms('wc_setSail'))}</button>
</footer>`;
  }

  /** Briefing hint: doctrines that suit this mission (Meta/Doctrine.suggestDoctrines). */
  _docHintHtml(m) {
    const hints = suggestDoctrines(m);
    if (!hints.length) return '';
    return `<div class="wc-dochint" data-f2="docHint"><b>${esc(ms('doc_hint'))}:</b>${hints.map((h) => {
      const d = DOCTRINE_BY_ID.get(h.id);
      return `<button type="button" class="wc-dochip" data-act="dochint" data-doc="${esc(h.id)}" title="${esc(ms('doc_hintTip') + ' — ' + doctrineDesc(h.id))}">${d?.icon || ''} ${esc(doctrineName(h.id))} <small>(${esc(doctrineWhy(h))})</small></button>`;
    }).join('')}</div>`;
  }

  /** Give every sailable ship one doctrine (the "All ships" control / hint chips). */
  _setAllDocs(id, p) {
    if (id !== DOCTRINE_KEEP && !DOCTRINE_BY_ID.has(id)) return;
    for (const s of sailableShips(p)) this._docs[s.uid] = id;
    call(this.ctx, 'sfx', 'ui_click');
    this._renderPicker(p);
  }

  _renderPicker(p) {
    const host = this._f.briefIn;
    const picks = host.querySelector('[data-f2="picks"]');
    if (!picks) return;
    const cap = fleetCap(p);
    const ships = [...sailableShips(p)].sort((a, b) => (b.hpFrac ?? 1) - (a.hpFrac ?? 1));
    const ok = new Set(ships.map((s) => s.uid));
    for (const u of [...this._sel]) if (!ok.has(u)) this._sel.delete(u);
    while (this._sel.size > cap) this._sel.delete([...this._sel].pop());
    const full = this._sel.size >= cap;
    const lang = ms('wc_title');

    if (!ships.length) {
      picks.innerHTML = `<p class="wc-empty">${icon('anchor')}<span>${esc(ms('wc_noShips'))}</span></p>`;
    } else {
      if (picks.querySelector('.wc-empty')) picks.textContent = '';
      patchKeyed(picks, ships, {
        key: (s) => s.uid,
        sig: (s) => [lang, s.nm, s.hullId, this._sel.has(s.uid), full, Math.round((s.hpFrac ?? 1) * 100), this._docs?.[s.uid] || DOCTRINE_KEEP].join('|'),
        html: (s) => {
          const h = hullOf(s), on = this._sel.has(s.uid), off = !on && full;
          const pct = Math.round((s.hpFrac ?? 1) * 100), low = (s.hpFrac ?? 1) < LOW_HP;
          const uid = esc(s.uid);
          return `<label class="wc-pick ${on ? 'is-on' : ''} ${low ? 'is-low' : ''} ${off ? 'is-off' : ''}" title="${esc(off ? ms('wc_capReached') : low ? ms('wc_lowHpTip') : '')}">
  <input type="checkbox" class="wc-chk" data-act="pick" data-uid="${uid}" data-fk="pick:${uid}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}>
  <span class="wc-box" aria-hidden="true">${icon('check')}</span>
  <span class="wc-pick-ic sv-well wl-ready">${hullSvg(h.id)}</span>
  <span class="wc-pick-main"><span class="wc-pick-nm"><b>${esc(s.nm)}</b>${tierBadge(h.tier)}</span><small>${esc(hullName(h))}</small></span>
  <span class="wc-pick-hp"><span class="mx-bar hp" data-lvl="${pct < 40 ? 'low' : pct < 70 ? 'mid' : 'ok'}"><i style="width:${pct}%"></i></span><b>${pct}%</b>${low ? `<span class="wc-low">${icon('warn')}${esc(ms('wc_lowHp'))}</span>` : ''}</span>
  <span class="wc-pick-doc"><select class="mx-select wc-docsel" data-uid="${uid}" data-fk="doc:${uid}" aria-label="${esc(ms('doc_bar') + ' — ' + s.nm)}" title="${esc(doctrineDesc(this._docs?.[s.uid]) || ms('doc_keep'))}">${docOptions(this._docs?.[s.uid] || DOCTRINE_KEEP)}</select></span>
</label>`;
        },
      });
    }
    setText(host.querySelector('[data-f2="selN"]'), ms('wc_sel', this._sel.size, cap));
    const all = host.querySelector('[data-f2="docAll"]');
    if (all) {                                     // shows the shared doctrine, or blank when mixed
      const ids = [...this._sel].map((u) => this._docs?.[u] || DOCTRINE_KEEP);
      const same = ids.length && ids.every((x) => x === ids[0]) ? ids[0] : '';
      if (all.value !== same) all.value = same;
    }
    const capNote = host.querySelector('[data-f2="capNote"]');
    if (capNote) setText(capNote, `${ms('sy_fleetcap')} ${cap}: ${capBreakdownText(fleetCapBreakdown(p)).line}`);
    const yard = host.querySelector('[data-f2="yard"]');
    const inYard = p.fleet.length - ships.length;
    if (yard) { yard.hidden = !inYard; setText(yard, inYard ? ms('wc_inYard', inYard) : ''); }
    const btn = host.querySelector('[data-act="sail"]');
    const why = host.querySelector('[data-f2="why"]');
    if (btn && why) {
      const reason = !ships.length ? ms('wc_noShips') : !this._sel.size ? ms('wc_pickShip') : '';
      btn.disabled = !!reason || this._sailing;
      btn.title = reason;
      setText(btn, this._sailing ? ms('wc_sailing') : ms('wc_setSail'));
      why.hidden = !reason || !ships.length;
      setText(why, reason && ships.length ? reason : '');
    }
  }

  _closeBrief(focusNode = true) {
    if (!this._brief) return;
    const id = this._brief;
    this._brief = null;
    this._root.classList.remove('has-brief');
    this._f.brief.hidden = true;
    this._f.briefIn.dataset.for = '';
    this._markActive();
    if (focusNode) this._f.nodes.querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  // ── events ───────────────────────────────────────────────────────
  _onEsc() {
    if (this._brief) this._closeBrief(true);
    else this.close();
  }

  _onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !this._root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'pick') return;                     // handled by 'change'
    if (act === 'close') { this.close(); return; }
    if (act === 'help') { showHowToWin(this.ctx); return; }
    if (act === 'brief-close') { this._closeBrief(true); call(this.ctx, 'sfx', 'ui_click'); return; }
    if (act === 'node') {
      const id = b.dataset.id;
      if (id === 'home') { this.close(); return; }
      if (id === this._brief) { this._closeBrief(true); return; }
      this.openBriefing(id);
      return;
    }
    if (act === 'war') {
      b.disabled = true;
      call(this.ctx, 'sfx', 'set_sail');
      call(this.ctx, 'onOpenWar');
      return;
    }
    if (act === 'dochint') { this._setAllDocs(b.dataset.doc, this.ctx.getProfile()); return; }
    if (act === 'sail') this._sail();
  }

  _onChange(e) {
    const c = e.target;
    if (c.matches?.('.wc-docsel')) {
      const p = this.ctx.getProfile();
      if (c.dataset.doc === 'all') { if (c.value) this._setAllDocs(c.value, p); return; }
      this._docs[c.dataset.uid] = c.value || DOCTRINE_KEEP;
      call(this.ctx, 'sfx', 'ui_click');
      this._renderPicker(p);
      return;
    }
    if (!c.matches?.('.wc-chk')) return;
    const p = this.ctx.getProfile();
    const uid = c.dataset.uid;
    if (c.checked) {
      if (this._sel.size >= fleetCap(p)) { c.checked = false; call(this.ctx, 'toast', ms('wc_capReached'), 'info'); return; }
      this._sel.add(uid);
    } else this._sel.delete(uid);
    call(this.ctx, 'sfx', 'ui_click');
    this._renderPicker(p);
  }

  _sail() {
    const id = this._brief;
    if (!id || id === warDef()?.id || this._sailing) return;
    const p = this.ctx.getProfile();
    const m = this._missionFor(id, p);
    if (!m) return;
    if (!m.repeatable && CAMP.missionState(p, m) === 'locked') { call(this.ctx, 'toast', lockReason(p, m), 'bad'); return; }
    const ok = new Set(sailableShips(p).map((s) => s.uid));
    const shipUids = [...this._sel].filter((u) => ok.has(u)).slice(0, fleetCap(p));
    if (!shipUids.length) { call(this.ctx, 'toast', ms('wc_pickShip'), 'bad'); this._renderPicker(p); return; }
    this._sailing = true;
    this._renderPicker(p);
    call(this.ctx, 'sfx', 'set_sail');
    const order = { missionId: id, shipUids, doctrines: Object.fromEntries(shipUids.map((u) => [u, this._docs?.[u] || DOCTRINE_KEEP])) };
    if (id === patrolDef()?.id) order.seed = this._seed;
    call(this.ctx, 'onSetSail', order);
  }
}

/** Ranks are data: the top rank's display name (used by the rules card). */
export const topRankName = () => rankName(RANKS[RANKS.length - 1] || { id: 'admiral', nm: 'Admiral' });
