import * as THREE from 'three';
// ── ISLAND ENTITY ────────────────────────────────────────────────
// AF8: procedural island shapes — CRESCENT, ATOLL, FORTRESS, SPRAWL.
// Each island generates its valid build grid from shape+seed.
// Enemy islands mirror the player home island shape.
//
// AW-art: the terrain IS the build grid — a heightfield whose flat plateau
// (BUILD_DECK_Y) is the smooth union of the valid cells, falling through a
// grassy bank and a sand beach to a shallow shelf, so the coast follows the
// shape (crescent bay, atoll lagoon, fortress arms) and every building cell
// lies on level ground. The waterline is held inside r + 1.6 so ships (kept
// outside r + 1.8) never sail through land; cells past it get stilts
// (deckDropAt). Palms, broadleaf/bamboo (Asian biome), boulders and shrubs
// are instanced (one draw call per kind per island) and never sit on a cell.
// Forts follow the holding faction (def.faction): Spanish castillo, Portuguese
// fortaleza, Dutch star fort, English/French battery, Chinese walled fort,
// Malay kota, Vietnamese thành, buccaneer palisade, Malabar laterite fort.
//
// GFX: follows Render/GfxQuality (gfx.level) live; setIslandQuality('high'|'low')
// overrides. HIGH adds ground detail shading, palm sway, stone-shaded boulders,
// shrubs, contact shadows, pier/fort/harbour props; LOW halves vegetation.
import { generateShape, mirrorShape, GRID, makePrng, HARBOR, harborWaterSDF } from '../../data/islandShapes.js';
import { BUILD_CELL_WORLD, BUILD_DECK_Y } from '../../data/constants.js';
import { ModelKit, PALETTE as P, kindMaterial, teamMaterial, chiselledRock,
         contactShadowTexture, setBuildingQuality, updateModelLighting, makeBuildingMesh } from './BuildingModels.js';
import { getWaveHeight } from './Ocean.js';
import { time } from '../Time.js';
import { gfx } from '../Render/GfxQuality.js';

const DECK = BUILD_DECK_Y;
const CELL = BUILD_CELL_WORLD, HALF = CELL / 2;
const TAU = Math.PI * 2;
const NOOP = () => {};

// ── GFX quality (same contract as Systems/VFX/quality.js) ─────────
// Init + live sync: follows the renderer's shared tier (Render/GfxQuality.js
// gfx.level, 'change' event); window._gfxQuality is honoured at load when set.
let _quality = gfx?.level === 'low' ? 'low' : 'high';
try {
  const q = typeof window !== 'undefined' ? window._gfxQuality : null;
  if (q === 'low' || q === 'high') _quality = q;
} catch { /* non-browser */ }
const _live = new Set();
gfx?.on?.('change.islandArt', () => setIslandQuality(gfx.level));

/**
 * Switch island + building detail tier; applies to every live island at once.
 * @param {'high'|'low'} q
 * @returns {'high'|'low'} tier now active
 */
export function setIslandQuality(q) {
  _quality = q === 'low' ? 'low' : 'high';
  setBuildingQuality(_quality);
  _live.forEach(isl => isl._applyQuality());
  return _quality;
}
/** @returns {'high'|'low'} */
export function getIslandQuality() { return _quality; }

// ── Palette ──────────────────────────────────────────────────────
const GROUND = {
  player:  [0x5E9B47, 0x79B257, 0x4B8138],      // lush
  enemy:   [0xA27E45, 0xB89354, 0x84633A],      // sun-scorched savanna
  neutral: [0x8DA34A, 0xA2B65C, 0x6F8838],      // olive scrub
};
const C = {
  sand: new THREE.Color(0xE6D3A1), sandDk: new THREE.Color(0xD2BC88), wet: new THREE.Color(0xBDA474),
  earth: new THREE.Color(0x8C7152), rockBank: new THREE.Color(0x8F877A), bed: new THREE.Color(0x4F8A87),
};
const ASIAN = new Set(['malay', 'chinese', 'vietnamese', 'malabar']);
const FORT_STYLE = {
  spain: 'castillo', portugal: 'fortaleza', netherlands: 'starfort', england: 'battery', france: 'battery',
  chinese: 'chinese', malay: 'kota', vietnamese: 'thanh', buccaneers: 'palisade', malabar: 'laterite',
};

// ── Noise (deterministic) ────────────────────────────────────────
function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.03 + 5.2, y * 2.03 - 1.7) * 0.3 + vnoise(x * 4.1 - 3.1, y * 4.1 + 2.9) * 0.15; }
function smooth01(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

// ── Shared resources (pinned against per-object teardown) ────────
const _cache = new Map();
function cached(key, make) {
  let v = _cache.get(key);
  if (!v) { v = make(); if (v && typeof v.dispose === 'function') v.dispose = NOOP; _cache.set(key, v); }
  return v;
}
const SHARED = { time: { value: 0 } };

const TERRAIN_DETAIL_FRAG = /* glsl */`
  float tnz(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453), b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5453);
    float c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5453), d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5453);
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
`;
function terrainMaterial(hi) {
  return cached('terrain:' + (hi ? 'hi' : 'lo'), () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    if (hi) {
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTW;' + TERRAIN_DETAIL_FRAG)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float n1 = tnz(vTW.xz * 0.55), n2 = tnz(vTW.xz * 2.3 + 17.0), n3 = tnz(vTW.xz * 7.9 - 5.0);
            diffuseColor.rgb *= 0.86 + 0.16 * n1 + 0.1 * n2 + 0.07 * n3;`);
      };
      m.customProgramCacheKey = () => 'isl-terrain-hi';
    }
    return m;
  });
}
function foliageMaterial(hi) {
  return cached('foliage:' + (hi ? 'hi' : 'lo'), () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    if (hi) {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uSwayT = SHARED.time;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uSwayT;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec2 ph = instanceMatrix[3].xz * 0.37;
            #else
              vec2 ph = vec2(0.0);
            #endif
            float hh = max(0.0, transformed.y - 0.9);
            transformed.x += sin(uSwayT * 1.25 + ph.x) * 0.014 * hh * hh;
            transformed.z += cos(uSwayT * 1.05 + ph.y) * 0.011 * hh * hh;
            transformed.y += sin(uSwayT * 2.6 + transformed.x * 2.1 + ph.y) * 0.025 * smoothstep(2.2, 3.4, transformed.y);`);
      };
      m.customProgramCacheKey = () => 'isl-foliage-sway';
    }
    return m;
  });
}
function rockMaterial(hi) {
  return cached('rock:' + (hi ? 'hi' : 'lo'), () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    if (hi) {
      // stone on HIGH: 3-axis solid noise mottling + lichen on the faces turned up
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
          .replace('#include <project_vertex>', `#include <project_vertex>
            vec4 rw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              rw = instanceMatrix * rw;
            #endif
            vRW = (modelMatrix * rw).xyz;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vRW;' + TERRAIN_DETAIL_FRAG)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
            vec3 wN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            vec3 an = abs(wN) / (abs(wN).x + abs(wN).y + abs(wN).z);
            float st = tnz(vRW.yz * 3.1) * an.x + tnz(vRW.xz * 3.1 + 7.0) * an.y + tnz(vRW.xy * 3.1 - 3.0) * an.z;
            float fine = tnz(vRW.xz * 11.0 + vRW.y * 5.0);
            diffuseColor.rgb *= 0.78 + 0.3 * st + 0.08 * fine;
            float lichen = smoothstep(0.55, 0.85, wN.y) * smoothstep(0.35, 0.7, tnz(vRW.xz * 1.7 + 3.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.52, 0.25), lichen * 0.55);`);
      };
      m.customProgramCacheKey = () => 'isl-rock-hi';
    }
    return m;
  });
}
function decalMaterial() {
  return cached('decal', () => new THREE.MeshBasicMaterial({
    color: 0x000000, map: contactShadowTexture(), transparent: true, opacity: 0.38, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
function flatQuad() { return cached('quad', () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; }); }

// ── Vegetation / rock geometry (merged once, vertex-coloured) ────
const _frondCache = new Map();
function frondGeo(droop) {
  const key = droop.toFixed(2);
  if (_frondCache.has(key)) return _frondCache.get(key);
  const tris = [], N = 5;
  const pt = (t, side) => {
    const hw = (0.2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) + 0.015) * side;
    return [t, 0.3 * t - droop * t * t - Math.abs(hw) * 0.35, hw];
  };
  for (let i = 0; i < N; i++) {
    const a = i / N, b = (i + 1) / N;
    const ca = [a, 0.3 * a - droop * a * a, 0], cb = [b, 0.3 * b - droop * b * b, 0];
    tris.push([ca, pt(a, 1), pt(b, 1)], [ca, pt(b, 1), cb], [ca, cb, pt(b, -1)], [ca, pt(b, -1), pt(a, -1)]);
  }
  const pos = [];
  tris.forEach(([p, q, r]) => pos.push(...p, ...q, ...r));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  _frondCache.set(key, g);
  return g;
}
function palmGeometry() {
  return cached('geo:palm', () => {
    const k = new ModelKit();
    let x = 0, y = 0;
    const segs = 6, H = 3.2;
    for (let i = 0; i < segs; i++) {
      const t1 = (i + 1) / segs, nx = 0.62 * t1 * t1, ny = H * t1;
      const r0 = 0.15 - 0.06 * (i / segs), r1 = 0.15 - 0.06 * t1;
      k.tube('matte', x, y, 0, nx, ny, 0, r0, r1 * 0.92, 6, i % 2 ? 0x7A5F43 : 0x8C6E4E, { open: true, jit: 0.06, ao: false });
      x = nx; y = ny;
    }
    for (let f = 0; f < 8; f++) {
      const a = f / 8 * TAU + (f % 2) * 0.22, len = 1.55 + (f % 3) * 0.18;
      k.geo('matte', frondGeo(0.75 + (f % 2) * 0.25), x, y + 0.05, 0, f % 2 ? 0x3F8B3A : 0x56A445,
        { ry: a, rz: 0.12 + (f % 3) * 0.08, sx: len, sy: len, sz: len, ao: false, jit: 0.1 });
    }
    for (let c = 0; c < 3; c++) {
      const a = c / 3 * TAU;
      k.sphere('matte', 0.09, x + Math.cos(a) * 0.12, y - 0.12, Math.sin(a) * 0.12, 0x5B4128, { w: 5, hs: 4, ao: false });
    }
    return k.bake(true).matte;
  });
}
function broadleafGeometry() {
  return cached('geo:broadleaf', () => {
    const k = new ModelKit();
    k.tube('matte', 0, 0, 0, 0.1, 1.5, 0.05, 0.16, 0.1, 6, 0x6B4E35, { ao: false });
    k.tube('matte', 0.05, 1.0, 0.02, -0.45, 1.75, 0.1, 0.08, 0.05, 5, 0x6B4E35, { ao: false });
    const blobs = [[0.1, 2.05, 0.05, 0.95, 0x3D7A34], [-0.55, 1.9, 0.2, 0.7, 0x4A8A3C], [0.55, 1.75, -0.25, 0.68, 0x447F37], [0, 2.55, -0.1, 0.62, 0x58993F]];
    blobs.forEach(([bx, by, bz, r, c], i) => k.rock('matte', r, bx, by, bz, c, 41 + i, { sy: 0.78, ao: false, jit: 0.12 }));
    return k.bake(true).matte;
  });
}
function bambooGeometry() {
  return cached('geo:bamboo', () => {
    const k = new ModelKit();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + (i % 3) * 0.4, r = 0.18 + (i % 2) * 0.12, h = 2.5 + ((i * 7) % 5) * 0.22;
      const bx = Math.cos(a) * r, bz = Math.sin(a) * r, tx = bx * 2.6, tz = bz * 2.6;
      k.tube('matte', bx, 0, bz, tx, h, tz, 0.05, 0.035, 5, i % 2 ? 0xA3B44E : 0x8FA544, { open: true, ao: false });
      for (const t of [0.55, 0.8, 1.0])
        k.geo('matte', frondGeo(0.4), bx + (tx - bx) * t, h * t, bz + (tz - bz) * t, 0x5E9E3F,
          { ry: a + t * 2.0, rz: 0.3, sx: 0.65, sy: 0.65, sz: 0.65, ao: false });
    }
    return k.bake(true).matte;
  });
}
function shrubGeometry() {
  return cached('geo:shrub', () => {
    const k = new ModelKit();
    k.rock('matte', 0.42, 0, 0.22, 0, 0x4F8A3C, 51, { sy: 0.7, ao: false, jit: 0.14 });
    k.rock('matte', 0.3, 0.35, 0.16, 0.12, 0x5F9A45, 52, { sy: 0.7, ao: false, jit: 0.14 });
    k.rock('matte', 0.26, -0.3, 0.12, -0.15, 0x467F35, 53, { sy: 0.7, ao: false, jit: 0.14 });
    return k.bake(true).matte;
  });
}

// ── FORTS ────────────────────────────────────────────────────────
// Fort model space: origin = island centre on the deck, front = +Z (camera).
// Each style fills a ModelKit and returns { flags:[[x,y,z,w,h]], fireY }.
const rect = (hx, hz) => [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]];
const BASTION = [[0, 0.95], [0.62, 0.28], [0.45, -0.45], [-0.45, -0.45], [-0.62, 0.28]];
const faces = (side, top) => [side, side, top, side, side, side];

function garita(k, x, y, z, s, col, hi) {
  k.cyl('matte', 0.3 * s, 0.07 * s, 0.34 * s, 8, x, y - 0.34 * s, z, col, { hi });
  k.cyl('matte', 0.3 * s, 0.3 * s, 0.6 * s, 8, x, y, z, col, { hi, jit: 0.05 });
  k.cyl('matte', 0.35 * s, 0.35 * s, 0.07 * s, 8, x, y + 0.6 * s, z, P.stoneLt, { hi });
  k.sphere('matte', 0.32 * s, x, y + 0.67 * s, z, col, { tl: Math.PI / 2, w: 8, hs: 3, hi });
  k.box('matte', 0.06 * s, 0.22 * s, 0.04, x, y + 0.24 * s, z + 0.29 * s, P.black, { jit: 0, hi });
}
function fortCannon(k, x, y, z, ry, hi = true) {
  const s = Math.sin(ry), c = Math.cos(ry);
  k.box('matte', 0.3, 0.16, 0.5, x - s * 0.05, y, z - c * 0.05, P.timberDk, { ry, hi });
  k.cyl('gloss', 0.055, 0.08, 0.75, 8, x + s * 0.18, y + 0.24, z + c * 0.18, P.iron, { rx: Math.PI / 2 - 0.05, ry, c: true, smooth: true, hi });
}
function gateArch(k, z, w, h, frame, y = 0) {
  k.box('matte', w + 0.3, h + 0.25, 0.12, 0, y, z, frame);
  k.box('matte', w, h, 0.14, 0, y, z + 0.01, P.black, { jit: 0 });
  k.box('matte', w - 0.12, h - 0.1, 0.06, 0, y, z + 0.08, P.timber, { jit: 0.1 });
}
// Bastioned trace: battered square curtain + 4 arrowhead bastions (castillo, star fort)
function bastionedTrace(k, half, h, wall, top, opts = {}) {
  k.poly('matte', rect(half, half), 0.93, h + 0.8, 0, -0.8, 0, [wall, top], { jit: 0.07 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ry = Math.atan2(sx, sz), bx = sx * (half - 0.05), bz = sz * (half - 0.05);
    k.poly('matte', BASTION, 0.9, h + 0.8, bx, -0.8, bz, [wall, top], { ry, s: opts.bScale || 1, jit: 0.07 });
    if (opts.garitas) {
      const t = 0.95 * 0.9 * (opts.bScale || 1);
      garita(k, bx + Math.sin(ry) * t, h - 0.02, bz + Math.cos(ry) * t, 0.85, opts.garitaCol || wall);
    }
    if (opts.cannons) fortCannon(k, bx + Math.sin(ry) * 0.35, h, bz + Math.cos(ry) * 0.35, ry);
  }
  if (opts.cordon) {
    k.poly('matte', rect(half * 0.95, half * 0.95), 1, 0.07, 0, h - 0.18, 0, [opts.cordon, opts.cordon]);
  }
}
function crenels(k, cx, cz, hw, hd, y, n, col, size = 0.22) {
  for (let i = 0; i < n; i++) {
    const t = -1 + (i + 0.5) * 2 / n;
    k.box('matte', size, size, size, cx + t * hw, y, cz + hd, col);
    k.box('matte', size, size, size, cx + t * hw, y, cz - hd, col);
    k.box('matte', size, size, size, cx + hw, y, cz + t * hd, col);
    k.box('matte', size, size, size, cx - hw, y, cz + t * hd, col);
  }
}
// Upturned-eave roof (Chinese / Vietnamese): hip roof + corner horns
function eaveRoof(k, w, d, h, x, y, z, col, horn) {
  k.hip('matte', w, h, d, 0.3, x, y, z, col, { jit: 0.05 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    k.box('matte', 0.08, 0.26, 0.08, x + sx * w * 0.5, y - 0.02, z + sz * d * 0.5, horn ?? col,
      { c: false, rz: -sx * 0.5, rx: sz * 0.5 });
}

const FORT_BUILDERS = {
  castillo(k, v) {                                     // Spanish castillo: ochre bastions, garitas, keep
    const wall = v.wall, top = v.top;
    bastionedTrace(k, 1.15, 1.3, wall, top, { garitas: true, cannons: true, cordon: P.stoneLt });
    gateArch(k, 1.2, 0.5, 0.75, P.stoneLt);
    k.box('matte', 1.1, 2.55, 1.1, 0, 1.0, -0.15, faces(wall, top), { jit: 0.05 });
    k.box('matte', 1.22, 0.1, 1.22, 0, 3.55, -0.15, P.stoneLt);
    crenels(k, 0, -0.15, 0.5, 0.5, 3.65, 2, wall, 0.2);
    k.box('glow', 0.16, 0.26, 0.04, 0, 2.6, 0.41, P.window);
    k.box('matte', 0.12, 0.3, 0.04, -0.3, 2.0, 0.41, P.black, { jit: 0 });
    k.box('matte', 0.12, 0.3, 0.04, 0.3, 2.0, 0.41, P.black, { jit: 0 });
    return { flags: [[0, 3.65, -0.15, 1.0, 0.62]], fireY: 3.9 };
  },
  fortaleza(k, v) {                                    // Portuguese: whitewashed walls, round turrets, tiled keep
    const wall = v.wall, base = v.base;
    k.box('matte', 2.5, 0.9, 2.5, 0, -0.8, 0, base);
    k.poly('matte', rect(1.2, 1.2), 0.97, 1.5, 0, 0.0, 0, [wall, v.top], { jit: 0.04 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k.cyl('matte', 0.55, 0.62, 2.2, 10, sx * 1.2, -0.6, sz * 1.2, [wall, v.top, wall], { jit: 0.05 });
      k.cyl('matte', 0.6, 0.6, 0.1, 10, sx * 1.2, 1.6, sz * 1.2, P.stoneLt);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU + 0.3;
        k.box('matte', 0.2, 0.2, 0.16, sx * 1.2 + Math.sin(a) * 0.5, 1.7, sz * 1.2 + Math.cos(a) * 0.5, wall, { ry: a });
      }
      fortCannon(k, sx * 1.2 + sx * 0.2, 1.6, sz * 1.2 + sz * 0.2, Math.atan2(sx, sz));
    }
    gateArch(k, 1.2, 0.5, 0.75, P.stoneLt);
    k.box('matte', 1.05, 2.9, 1.05, 0, 0.6, -0.25, faces(wall, v.top), { jit: 0.04 });
    k.cone('matte', 0.86, 0.75, 4, 0, 3.5, -0.25, v.roof, { ry: Math.PI / 4, jit: 0.06 });
    k.box('glow', 0.15, 0.24, 0.04, 0, 2.7, 0.28, P.window);
    k.box('matte', 0.1, 0.28, 0.04, 0, 1.8, 0.28, P.black, { jit: 0 });
    return { flags: [[0.42, 3.5, 0.2, 0.9, 0.56]], fireY: 3.6 };
  },
  laterite(k, v) { return FORT_BUILDERS.fortaleza(k, v); },
  starfort(k, v) {                                     // Dutch: low brick bastions, turf ramparts, gatehouse
    k.poly('matte', rect(2.05, 2.05), 0.86, 1.05, 0, -0.75, 0, [P.turf, P.turfLt], { jit: 0.1 });   // glacis
    bastionedTrace(k, 1.1, 0.95, v.wall, P.turf, { bScale: 1.15, cannons: true, cordon: 0xC9A28A });
    k.box('matte', 1.3, 0.9, 0.9, 0, 0.6, -0.1, P.plaster, { jit: 0.04 });
    k.gable('matte', 1.0, 0.85, 1.4, 0, 1.5, -0.1, 0xC2512E, P.plaster, { ry: Math.PI / 2 });
    k.box('glow', 0.16, 0.22, 0.04, -0.3, 0.95, 0.36, P.window);
    k.box('glow', 0.16, 0.22, 0.04, 0.3, 0.95, 0.36, P.window);
    gateArch(k, 1.12, 0.46, 0.62, 0xC9A28A, 0.0);
    k.cyl('matte', 0.04, 0.05, 2.4, 5, 0.85, 0.95, -0.85, P.timberDk);
    return { flags: [[0.85, 3.3, -0.85, 1.0, 0.6]], fireY: 2.3 };
  },
  battery(k, v) {                                      // English / French: grey stone battery, earth parapets, tower
    k.box('matte', 3.6, 1.15, 3.0, 0, -0.8, 0.1, faces(v.wall, v.top), { jit: 0.08 });
    for (const [w, d, x, z] of [[3.4, 0.5, 0, 1.38], [0.5, 2.4, -1.55, 0.25], [0.5, 2.4, 1.55, 0.25]])
      k.box('matte', w, 0.42, d, x, 0.35, z, faces(P.earth, P.turf), { jit: 0.12 });
    for (const x of [-0.9, 0, 0.9]) fortCannon(k, x, 0.35, 1.0, 0, false);
    k.cyl('matte', 0.72, 0.8, 2.2, 10, 0.2, 0.35, -0.75, [v.wall, v.top, v.wall], { jit: 0.06 });
    k.cyl('matte', 0.84, 0.84, 0.1, 10, 0.2, 2.55, -0.75, P.stoneLt);
    k.cone('matte', 0.9, 0.7, 10, 0.2, 2.65, -0.75, v.roof, { jit: 0.05 });
    k.box('matte', 0.3, 0.55, 0.05, 0.2, 0.35, 0.03, P.timberDk);
    k.box('glow', 0.13, 0.2, 0.04, 0.2, 1.6, 0.04, P.window);
    shotPileFort(k, -1.0, 0.35, -0.6);
    k.cyl('matte', 0.04, 0.05, 2.6, 5, -1.2, 0.35, -1.0, P.timberDk);
    return { flags: [[-1.2, 2.95, -1.0, 1.0, 0.6]], fireY: 2.9 };
  },
  chinese(k, v) {                                      // walled fort, crenellated brick, pagoda gate tower
    k.box('matte', 3.1, 2.0, 0.3, 0, -0.8, 1.4, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 3.1, 2.0, 0.3, 0, -0.8, -1.4, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 0.3, 2.0, 2.5, -1.4, -0.8, 0, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 0.3, 2.0, 2.5, 1.4, -0.8, 0, faces(v.wall, v.top), { jit: 0.06 });
    for (let i = 0; i < 6; i++) {
      const t = -1.25 + i * 0.5;
      for (const z of [-1.45, 1.45]) if (!(z > 0 && Math.abs(t) < 0.6)) k.box('matte', 0.22, 0.22, 0.18, t, 1.2, z, v.wall);
      for (const x of [-1.45, 1.45]) k.box('matte', 0.18, 0.22, 0.22, x, 1.2, t, v.wall);
    }
    // gate tower: brick base, red-pillared pavilion, two-tier upturned roof
    k.box('matte', 1.4, 1.5, 0.9, 0, -0.8 + 2.0, 1.4, faces(v.wall, v.top));  // y 1.2 → 2.7? keep low
    gateArch(k, 1.86, 0.5, 0.7, v.wall);
    k.box('matte', 1.5, 0.12, 1.0, 0, 1.2, 1.4, P.stoneLt);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      k.box('matte', 0.1, 0.62, 0.1, sx * 0.55, 1.32, 1.4 + sz * 0.32, 0xA62A1E);
    k.box('matte', 0.95, 0.5, 0.55, 0, 1.32, 1.4, 0xC7A46A);
    eaveRoof(k, 1.75, 1.15, 0.38, 0, 1.94, 1.4, v.roof, 0xC9A23E);
    k.box('matte', 0.85, 0.3, 0.55, 0, 2.2, 1.4, 0xA62A1E);
    eaveRoof(k, 1.15, 0.8, 0.42, 0, 2.48, 1.4, v.roof, 0xC9A23E);
    // inner hall
    k.box('matte', 1.6, 0.8, 1.0, 0, 0.0, -0.4, 0xC7A46A, { hi: true });
    eaveRoof(k, 2.0, 1.4, 0.55, 0, 0.8, -0.4, v.roof, 0xC9A23E);
    return { flags: [[1.05, 1.3, -1.05, 0.55, 0.95]], pole: 2.2, fireY: 2.8 };
  },
  thanh(k, v) {                                        // Vietnamese thành: brick wall, curved-roof gate pavilion
    k.box('matte', 3.3, 1.75, 0.32, 0, -0.8, 1.35, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 3.3, 1.75, 0.32, 0, -0.8, -1.35, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 0.32, 1.75, 2.4, -1.5, -0.8, 0, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 0.32, 1.75, 2.4, 1.5, -0.8, 0, faces(v.wall, v.top), { jit: 0.06 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      k.box('matte', 0.55, 1.95, 0.55, sx * 1.5, -0.8, sz * 1.35, faces(v.wall, v.top), { jit: 0.06 });
    k.box('matte', 1.5, 2.1, 0.8, 0, -0.8, 1.35, faces(0xE0B85A, v.top), { jit: 0.04 });
    gateArch(k, 1.76, 0.5, 0.78, 0xE0B85A);
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      k.box('matte', 0.1, 0.55, 0.1, sx * 0.55, 1.3, 1.35 + sz * 0.28, 0x8E2A1C);
    eaveRoof(k, 1.8, 1.2, 0.36, 0, 1.85, 1.35, v.roof, v.roof);
    k.box('matte', 0.7, 0.26, 0.5, 0, 2.14, 1.35, 0x8E2A1C);
    eaveRoof(k, 1.15, 0.85, 0.4, 0, 2.4, 1.35, v.roof, v.roof);
    k.box('matte', 1.4, 0.75, 0.9, 0, 0.0, -0.35, 0xE0B85A, { hi: true });
    eaveRoof(k, 1.85, 1.3, 0.5, 0, 0.75, -0.35, v.roof, v.roof);
    return { flags: [[-1.15, 1.2, -0.95, 0.55, 0.9]], pole: 2.0, fireY: 2.7 };
  },
  kota(k, v) {                                         // Malay kota: timber palisade, stilt house, attap roofs
    palisade(k, 1.95, 1.35, v.wall);
    for (const [px, pz] of [[-0.55, -0.6], [0.55, -0.6], [-0.55, 0.3], [0.55, 0.3]])
      k.cyl('matte', 0.07, 0.07, 0.75, 6, px, -0.3, pz, P.timberDk);
    k.box('matte', 1.35, 0.1, 1.15, 0, 0.42, -0.15, P.plank);
    k.box('matte', 1.2, 0.62, 1.0, 0, 0.52, -0.15, 0xB89A6A, { jit: 0.08 });
    k.gable('matte', 1.4, 0.95, 1.55, 0, 1.12, -0.15, v.roof, 0xB89A6A, { ry: Math.PI / 2, jit: 0.1 });
    for (const sx of [-1, 1])
      k.box('matte', 0.05, 0.5, 0.05, sx * 0.72, 1.85, -0.15, P.timberDk, { rz: sx * 0.45, c: true });
    // stilt watchtower
    for (const [px, pz] of [[0.95, 0.65], [1.35, 0.65], [0.95, 1.05], [1.35, 1.05]])
      k.cyl('matte', 0.05, 0.06, 2.1, 5, px, -0.3, pz, P.timberDk);
    k.box('matte', 0.62, 0.08, 0.62, 1.15, 1.8, 0.85, P.plank);
    k.cone('matte', 0.55, 0.55, 4, 1.15, 2.05, 0.85, v.roof, { ry: Math.PI / 4, jit: 0.1 });
    return { flags: [[-1.2, 1.6, -1.1, 0.7, 0.45]], pole: 2.0, fireY: 2.2 };
  },
  palisade(k, v) {                                     // buccaneer stockade with a timber blockhouse
    palisade(k, 1.95, 1.3, v.wall);
    k.box('matte', 1.3, 1.1, 1.2, -0.1, -0.3, -0.25, faces(P.timber, P.timber), { jit: 0.1 });
    k.box('matte', 1.5, 0.75, 1.4, -0.1, 0.8, -0.25, faces(P.plank, P.plank), { jit: 0.1 });
    k.hip('matte', 1.75, 0.6, 1.65, 0.38, -0.1, 1.55, -0.25, v.roof, { jit: 0.08 });
    k.box('matte', 0.3, 0.55, 0.05, -0.1, 0.0, 0.36, P.timberDk);
    k.box('glow', 0.14, 0.12, 0.04, -0.45, 1.05, 0.46, P.window);
    fortCannon(k, 0.95, 0.0, 0.85, 0.35, true);
    barrelFort(k, 1.0, 0.0, -0.9);
    return { flags: [[-0.1, 2.15, -0.25, 0.85, 0.55]], fireY: 2.3 };
  },
};
function palisade(k, R, h, col) {
  const n = 44;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    // rounded square ring
    const c = Math.cos(a), s = Math.sin(a), q = Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), -0.25);
    const x = s * R * q, z = c * R * q;
    if (z > 1.2 && Math.abs(x) < 0.42) continue;                         // gate gap (front)
    const hh = h + ((i * 7) % 3) * 0.08;
    k.cyl('matte', 0.07, 0.085, hh + 0.8, 5, x, -0.8, z, col, { jit: 0.12 });
    k.cone('matte', 0.07, 0.16, 5, x, hh, z, col);
  }
  for (const sx of [-1, 1]) k.cyl('matte', 0.1, 0.1, h + 1.25, 6, sx * 0.48, -0.8, R * 0.98, P.timberDk);
  k.box('matte', 1.25, 0.14, 0.2, 0, h + 0.3, R * 0.98, P.timberDk);
}
function shotPileFort(k, x, y, z) {
  for (const [dx, dz, dy] of [[0, 0, 0], [0.18, 0, 0], [0.09, 0.15, 0], [0.09, 0.05, 0.14]])
    k.sphere('gloss', 0.09, x + dx, y + 0.09 + dy, z + dz, P.iron, { w: 6, hs: 4, hi: true });
}
function barrelFort(k, x, y, z) {
  k.cyl('matte', 0.17, 0.15, 0.42, 8, x, y, z, [P.timber, P.wood, P.timber], { hi: true });
}
/** Stone colours per style (and per owner for the default castillo). */
function fortVariant(style, owner, faction) {
  switch (style) {
    case 'fortaleza': return { wall: 0xF1ECE2, top: 0xD9D1C2, base: 0x8E8577, roof: P.terra };
    case 'laterite':  return { wall: 0xA4613F, top: 0x8F5537, base: 0x6E4632, roof: P.terra };
    case 'starfort':  return { wall: 0xA04B35, top: P.turf };
    case 'battery':   return { wall: 0x8E9094, top: 0xA4A6A8, roof: 0x4E5560 };
    case 'chinese':   return { wall: 0x7D7F7B, top: 0x96988F, roof: 0x3F4F48 };
    case 'thanh':     return { wall: 0x9E5E46, top: 0xB07258, roof: 0x5B4436 };
    case 'kota':      return { wall: 0x6E5034, roof: 0x9A7E4E };
    case 'palisade':  return { wall: 0x5E4630, roof: P.shingle };
    default: {
      if (faction === 'spain' || owner === 'enemy') return { wall: P.ochreSt, top: 0xC49352 };
      if (owner === 'neutral') return { wall: 0xA59C8B, top: 0xB7AE9C };
      return { wall: P.stone, top: P.stoneLt };       // player: coral stone
    }
  }
}
function fortGeos(style, owner, faction, tier) {
  const vKey = style === 'castillo' ? `${faction === 'spain' ? 'enemy' : owner}` : '';
  return cached(`fort:${style}:${vKey}:${tier}`, () => {
    const k = new ModelKit();
    const spec = (FORT_BUILDERS[style] || FORT_BUILDERS.castillo)(k, fortVariant(style, owner, faction));
    return { geos: k.bake(tier === 'high'), spec };
  });
}
function flagGeo(w, h) {
  return cached(`flag:${w}:${h}`, () => {
    const k = new ModelKit();
    k.box('team', w, h, 0.03, w / 2, -h, 0, 0xffffff, { ao: false, jit: 0.03 });
    return k.bake(true).team;
  });
}
function poleGeo(len) {
  return cached(`pole:${len}`, () => {
    const k = new ModelKit();
    k.cyl('gloss', 0.035, 0.045, len, 6, 0, 0, 0, P.white, { ao: false });
    k.sphere('gold', 0.07, 0, len + 0.04, 0, P.brass, { w: 6, hs: 4, ao: false });
    return k.bake(true);
  });
}

// ── PIER ─────────────────────────────────────────────────────────
function pierGeos(len, tier) {
  return cached(`pier:${len.toFixed(1)}:${tier}`, () => {
    const k = new ModelKit(), hi = true, y = 0.95, w = 1.5;
    k.box('matte', w, 0.12, len, 0, y - 0.12, len / 2, faces(P.plank, P.plankLt), { jit: 0.12 });
    for (let z = 0.3; z < len; z += 0.42) k.box('matte', w + 0.04, 0.02, 0.05, 0, y, z, P.timberDk, { jit: 0.1 });
    k.box('matte', 3.0, 0.12, 1.6, 0, y - 0.12, len + 0.7, faces(P.plank, P.plankLt), { jit: 0.12 });   // T-head
    const piles = [];
    for (let z = 0.6; z <= len + 0.1; z += 1.35) piles.push([-w / 2 - 0.05, z], [w / 2 + 0.05, z]);
    for (const x of [-1.45, 1.45, -0.6, 0.6]) piles.push([x, len + 1.45]);
    for (const [x, z] of piles) k.cyl('matte', 0.11, 0.13, 3.3, 6, x, y - 3.2, z, [P.timberDk, P.timber, P.timberDk], { jit: 0.1, ao: false });
    for (const x of [-1.3, 1.3]) k.cyl('gloss', 0.09, 0.11, 0.26, 7, x, y, len + 1.3, P.iron, [P.iron, P.ironLt, P.iron]);
    k.cyl('matte', 0.05, 0.06, 1.25, 5, 1.3, y, len + 0.15, P.timberDk);
    k.box('matte', 0.3, 0.05, 0.05, 1.18, y + 1.22, len + 0.15, P.timberDk);
    k.box('glow', 0.13, 0.17, 0.13, 1.05, y + 0.98, len + 0.15, P.window);
    for (const [cx, cz, s] of [[-1.0, len + 0.55, 0.42], [-0.55, len + 0.6, 0.36], [-0.82, len + 0.62, 0.32]])
      k.box('matte', s, s * 0.9, s, cx, y + (s === 0.32 ? 0.38 : 0), cz, faces(P.plankLt, P.wood), { hi, jit: 0.1 });
    k.cyl('matte', 0.17, 0.15, 0.42, 8, -0.05, y, len + 0.95, [P.timber, P.wood, P.timber], { hi });
    k.cyl('matte', 0.17, 0.15, 0.42, 8, 0.3, y, len + 1.05, [P.timber, P.wood, P.timber], { hi });
    k.torus('matte', 0.17, 0.25, 0.75, y + 0.05, len + 0.4, P.rope, { rx: Math.PI / 2, hi, ts: 10 });
    return k.bake(tier === 'high');
  });
}
function rowboatGeo() {
  return cached('rowboat', () => {
    const k = new ModelKit();
    const hull = [[0, 1.05], [0.42, 0.45], [0.38, -0.85], [-0.38, -0.85], [-0.42, 0.45]];
    k.poly('matte', hull, 1.22, 0.32, 0, -0.12, 0, [P.timber, P.timberDk], { jit: 0.08, ao: false });
    for (const z of [-0.35, 0.2]) k.box('matte', 0.86, 0.05, 0.14, 0, 0.12, z, P.plankLt, { ao: false });
    k.box('matte', 0.05, 0.04, 1.4, 0.3, 0.2, -0.1, P.plankLt, { ry: 0.12, ao: false });
    return k.bake(true);
  });
}

// ── ISLAND ───────────────────────────────────────────────────────
export class IslandEntity {
  constructor(scene, def) {
    this.def   = def;
    this.x     = def.x;
    this.z     = def.z;
    this.r     = def.r;
    this.nm    = def.nm;
    this.own   = def.own;
    // AP: Bastion trait hardens the fort at construction time.
    // Capture-weakening (×0.85 once) still applies on top — a captured
    // bastion stays stronger than a captured plain fort, as intended.
    const _fortMult = def.trait === 'bastion' ? 1.25 : 1;
    this.hp    = Math.round(def.hp * _fortMult);
    this.maxHp = Math.round(def.hp * _fortMult);
    this.tdmg  = Math.round(def.tdmg * _fortMult);
    this.trof  = def.trof;
    this.down  = false;
    this.ftimer     = 2 + Math.random() * 6;
    this.stockWood  = def.own==='enemy' ? 300 : def.own==='neutral' ? 180 : 0;
    this.stockGold  = def.own==='enemy' ? 200 : def.own==='neutral' ? 120 : 0;
    this.auraRing   = null;
    this.auraRing2  = null;
    this.auraPulseT = def.own==='enemy' ? Math.PI : 0;

    // AF7: persistent fire source
    this._fireSource = null;
    this._fireY = 5.5;

    // AF8: generate valid build grid keys from shape + seed
    // AW: per-island grid size (HARBOR home port = 16; battle shapes stay GRID)
    this.isHarbor      = def.shape === 'HARBOR';
    this.gridSize      = def.gridSize ?? (this.isHarbor ? 16 : GRID);
    this.validGridKeys = this._buildGridKeys(def);
    this.shapeType     = def.shape === 'MIRROR' ? 'MIRROR' : (def.shape || 'SPRAWL');
    /** Ship berths [{x, z, angle}] in world coords (HARBOR only; angle = heading, 0 = +Z). */
    this.berths    = [];
    /** Collision circles [{x, z, r}] (world) replacing the single r-circle when set (HARBOR). */
    this.colliders = null;

    // AW-art: style + biome
    this.faction   = def.faction || null;
    this.fortStyle = FORT_STYLE[def.faction] || 'castillo';
    this.biome     = def.biome || (ASIAN.has(def.faction) ? 'asia' : 'caribbean');
    this._seed     = (def.seed || 1) * 7 + Math.round((def.x || 0) * 3 + (def.z || 0) * 5);

    this.grp = new THREE.Group();
    this.grp.position.set(def.x, 0, def.z);

    this._build(scene, def);
    scene.add(this.grp);
    _live.add(this);
  }

  /** Owner — setting it repaints the ground and flags (CaptureSystem assigns it). */
  get own() { return this._own; }
  set own(v) {
    if (v === this._own) return;
    this._own = v;
    if (this._built) this._applyOwner();
  }

  // ── AF8: Shape-based grid key generation ─────────────────────
  _buildGridKeys(def) {
    if (def.shape === 'MIRROR') {
      // Enemy home: mirror of player home (same seed, flip col)
      const base = generateShape('SPRAWL', def.seed);
      return mirrorShape(base, this.gridSize);
    }
    return generateShape(def.shape || 'SPRAWL', def.seed || 1, this.gridSize);
  }

  // ── Build ─────────────────────────────────────────────────────
  _build(scene, def) {
    const off = (this.gridSize - 1) / 2 * CELL;
    this._cells = [];
    this.validGridKeys.forEach(k => {
      const [c, r] = k.split('_').map(Number);
      this._cells.push([c * CELL - off, r * CELL - off]);
    });
    this._ds = new Float32Array(this._cells.length + 1);
    this._noDecor = [];                       // [x, z, r] keep-out circles for vegetation
    if (this.isHarbor) this._planHarbor();
    this._buildTerrain();
    if (this.isHarbor) this._buildHarborMesh();
    this._buildDecor();
    if (this._own === 'player' && !this.isHarbor) this._buildPier();
    this._buildFort(def);
    this._buildHPSprite();
    this._built = true;
    this._applyQuality();
    // per-frame hook (only while the island is on screen)
    this._terrain.onBeforeRender = (renderer, sc) => this._animate(renderer, sc);
  }

  // Signed distance (local x,z) to the land: smooth union of the valid cells,
  // a fort islet at the centre, coastline noise, held inside the sailing radius.
  _sdf(x, z) {
    if (this.isHarbor) {
      const dOut = Math.hypot(x, z) - HARBOR.outerR + (fbm(x * 0.17 + 4.0, z * 0.17) - 0.5) * 1.0;
      let d = Math.max(dOut, -harborWaterSDF(x, z));
      for (const [ix, iz, ir] of HARBOR.islets)
        d = Math.min(d, Math.hypot(x - ix, z - iz) - ir + (fbm(x * 0.6 + ix, z * 0.6) - 0.5) * 1.2);
      return d;
    }
    const cells = this._cells, ds = this._ds, k = 0.55;
    let m = Math.hypot(x, z) - 2.6, n = 0;                 // fort islet
    ds[n++] = m;
    for (let i = 0; i < cells.length; i++) {
      const qx = Math.abs(x - cells[i][0]) - HALF, qz = Math.abs(z - cells[i][1]) - HALF;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
      ds[n++] = d; if (d < m) m = d;
    }
    let s = 0;
    for (let i = 0; i < n; i++) { const e = ds[i] - m; if (e < 2.5) s += Math.exp(-e / k); }
    let d = m - k * Math.log(s);
    const sx = this._seed * 0.137;
    d += (fbm(x * 0.2 + sx, z * 0.2 - sx) - 0.5) * 1.4 * smooth01((d + 0.8) / 1.4);
    return smax(d, Math.hypot(x, z) - (this.r - 0.2), 1.2);
  }
  _heightFromD(d) {
    if (d <= -0.3) return DECK;
    if (d < 0.45) return DECK + (0.82 - DECK) * smooth01((d + 0.3) / 0.75);
    if (d < 2.7) return 0.82 - 1.25 * Math.pow((d - 0.45) / 2.25, 0.85);
    return -0.43 - 2.6 * smooth01((d - 2.7) / 3.2);
  }
  /** Terrain height (world y) at local x,z. */
  _heightAt(x, z) { return this._heightAtD(x, z, this._sdf(x, z)); }
  _heightAtD(x, z, d) {
    let h = this._heightFromD(d);
    if (!this.isHarbor) return h;
    const q = HARBOR.quayZ, qh = this._quayHalf;
    if (Math.abs(x) < qh + 0.4 && z > q - 0.05 && z < q + 6) h = Math.min(h, -1.3);      // quay: deep at the wall
    if (Math.abs(x) < qh + 0.4 && z <= q - 0.05 && d < 0.6) h = DECK;                      // quay top stays level
    const sq = Math.max(Math.abs(x), Math.abs(z)) - 19.8;                                 // outside the build grid
    if (sq > 0 && z < 8 && d < -1.2) {
      const hill = smooth01(sq / 4.5) * smooth01((-d - 1.2) / 3.5) * (0.55 + 0.9 * fbm(x * 0.09 + 2, z * 0.09 - 3));
      h += 3.4 * hill;
    }
    return h;
  }

  /**
   * True where this island's land breaks the sea surface at world (x, z).
   * The ocean (World/ShoreField) bakes its shore distance from it, so foam,
   * shallows and calm water follow the real coast, bay and islets.
   * O(1): bilinear lookup in the terrain height grid.
   */
  landAt(wx, wz) {
    const g = this._tGrid;
    if (!g) return false;
    const fi = (wx - this.x + g.E) / g.step, fj = (wz - this.z + g.E) / g.step;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.N - 1 || j >= g.N - 1) return false;
    const H = this._tH, a = j * g.N + i, u = fi - i, v = fj - j;
    const h = (H[a] * (1 - u) + H[a + 1] * u) * (1 - v) + (H[a + g.N] * (1 - u) + H[a + g.N + 1] * u) * v;
    return h > 0.05;
  }

  /**
   * How far the terrain lies below the build deck at a world point (0 on the
   * plateau). BuildSystem passes it to the model so edge buildings get stilts.
   */
  deckDropAt(wx, wz) { return Math.max(0, DECK - this._heightAt(wx - this.x, wz - this.z)); }

  _buildTerrain() {
    const E = this.isHarbor ? 45 : Math.ceil(Math.max(this.r + 6.5, 17)), STEP = 0.5;
    const N = Math.round(2 * E / STEP) + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const H = new Float32Array(N * N), Dd = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = j * N + i;
      let x = -E + i * STEP, z = -E + j * STEP;
      if (i > 0 && j > 0 && i < N - 1 && j < N - 1) {   // break the grid pattern on slopes
        x += (h2(i, j) - 0.5) * 0.22; z += (h2(j + 7, i) - 0.5) * 0.22;
      }
      const d = this._sdf(x, z), h = this._heightAtD(x, z, d);
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      H[v] = h; Dd[v] = d;
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      if (H[a] < -2.6 && H[b] < -2.6 && H[c] < -2.6 && H[d] < -2.6) continue;
      if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this._tH = H; this._tD = Dd;
    this._tGrid = { E, step: STEP, N };
    this._terrain = new THREE.Mesh(geo, terrainMaterial(_quality === 'high'));
    this._terrain.receiveShadow = true;
    this._terrain.name = 'island-terrain';
    this.grp.add(this._terrain);
    this._paintTerrain();
  }

  _paintTerrain() {
    const geo = this._terrain.geometry, pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const nor = geo.attributes.normal.array, H = this._tH;
    const g = GROUND[this._own] || GROUND.neutral;
    const gDk = new THREE.Color(g[2]), gMd = new THREE.Color(g[0]), gLt = new THREE.Color(g[1]);
    const c = new THREE.Color(), t = new THREE.Color();
    for (let v = 0; v < H.length; v++) {
      const x = pos[v * 3], z = pos[v * 3 + 2], h = H[v], slope = 1 - nor[v * 3 + 1];
      const n = fbm(x * 0.13 + 3.1, z * 0.13 - 1.7);
      if (h >= DECK - 0.02) {
        c.copy(gDk).lerp(gMd, smooth01(n * 1.6)).lerp(gLt, smooth01((n - 0.55) * 3));
        const dirt = smooth01((fbm(x * 0.31 - 7, z * 0.31 + 2) - 0.66) * 6);
        c.lerp(C.earth, dirt * 0.35);
        if (h > DECK + 0.3) c.lerp(C.rockBank, smooth01((slope - 0.18) * 4) * 0.7).lerp(gDk, 0.25);   // hills
        if (this.isHarbor) {
          const pave = this._paveAt(x, z);
          if (pave > 0) {
            const flag = 0.92 + 0.08 * h2(Math.floor(x / 0.8), Math.floor(z / 0.8));
            t.setHex(0xC9BCA2).multiplyScalar(flag);
            c.lerp(t, pave);
          }
        }
      } else if (h > 0.82) {
        const tb = (DECK - h) / (DECK - 0.82);
        c.copy(gMd).lerp(C.earth, smooth01(tb * 1.3)).lerp(C.rockBank, smooth01((slope - 0.25) * 3) * 0.6);
        c.lerp(C.sandDk, smooth01((tb - 0.75) * 4));
      } else if (h > 0.2) {
        c.copy(C.sand).lerp(C.sandDk, n * 0.6);
      } else if (h > -0.12) {
        c.copy(C.wet).lerp(t.copy(C.sand), smooth01((h + 0.12) / 0.32) * 0.6);
      } else {
        c.copy(C.wet).lerp(C.bed, smooth01((-0.12 - h) / 1.5));
      }
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
  }

  _inCell(x, z, pad) {
    for (const [cx, cz] of this._cells) if (Math.abs(x - cx) < HALF + pad && Math.abs(z - cz) < HALF + pad) return true;
    return false;
  }

  // ── Decor: palms / broadleaf / bamboo / shrubs / boulders (instanced) ──
  _buildDecor() {
    const rnd = makePrng(this._seed + 991);
    const asia = this.biome === 'asia';
    const palms = [], trees = [], bamboo = [], shrubs = [], rocks = [];
    const taken = [];
    const free = (x, z, r) => taken.every(([tx, tz, tr]) => (x - tx) ** 2 + (z - tz) ** 2 > (r + tr) ** 2);
    const E = this.isHarbor ? 40 : this.r + 4;
    const forest = this.isHarbor;   // the home port's hills carry a broadleaf forest
    for (let tries = 0; tries < (this.isHarbor ? 6000 : 1400); tries++) {
      const x = (rnd() * 2 - 1) * E, z = (rnd() * 2 - 1) * E;
      if (!this.isHarbor && Math.hypot(x, z) < 3.4) continue;              // fort
      if (this._noDecor.some(([nx, nz, nr]) => (x - nx) ** 2 + (z - nz) ** 2 < nr * nr)) continue;
      const d = this._sdf(x, z), h = this._heightAtD(x, z, d);
      if (h < -0.6 || this._inCell(x, z, 0.3)) continue;
      if (this.isHarbor && (this._paveAt(x, z) > 0.2 || harborWaterSDF(x, z) < 2.2)) continue;
      const roll = rnd();
      if (h > 0.4 && (d > -0.9 || (forest && h > DECK + 0.2)) && d < 1.45) {
        if (asia && roll < 0.28 && h > 0.8 && free(x, z, 1.0)) { trees.push([x, h, z, 0.85 + rnd() * 0.35]); taken.push([x, z, 1.0]); continue; }
        if (asia && roll < 0.46 && h > 0.8 && free(x, z, 0.8)) { bamboo.push([x, h, z, 0.85 + rnd() * 0.3]); taken.push([x, z, 0.8]); continue; }
        if (!asia && roll < (forest && h > DECK + 0.25 ? 0.55 : 0.1) && h > 0.9 && free(x, z, 1.0)) { trees.push([x, h, z, 0.75 + rnd() * 0.35]); taken.push([x, z, 1.0]); continue; }
        if (roll < 0.78 && free(x, z, 0.95)) { palms.push([x, h, z, 0.82 + rnd() * 0.38]); taken.push([x, z, 0.95]); continue; }
        if (h > 0.75 && free(x, z, 0.5)) { shrubs.push([x, h, z, 0.7 + rnd() * 0.6]); taken.push([x, z, 0.5]); }
      } else if (h < 0.55 && h > -0.55 && roll < 0.55 && free(x, z, 0.7)) {
        const s = 0.35 + rnd() * rnd() * 1.1;
        rocks.push([x, h - s * 0.3, z, s]); taken.push([x, z, s * 0.9]);
      }
    }
    const cap = (arr, n) => arr.slice(0, n);
    const perim = this.isHarbor ? 70 : Math.max(8, Math.round(this.r * 1.5));
    this._decorSets = {
      palms: cap(palms, asia ? Math.round(perim * 0.55) : perim),
      trees: cap(trees, Math.round(perim * 0.45)), bamboo: cap(bamboo, Math.round(perim * 0.35)),
      shrubs: cap(shrubs, perim), rocks: cap(rocks, Math.round(perim * 0.9)),
    };
    const S = this._decorSets;
    this._palms  = this._instanced(palmGeometry(), foliageMaterial(true), S.palms, 'palm');
    this._trees  = this._palms;                       // AT field name kept (instanced vegetation)
    this._broad  = this._instanced(broadleafGeometry(), foliageMaterial(true), S.trees, 'tree');
    this._bamboo = this._instanced(bambooGeometry(), foliageMaterial(true), S.bamboo, 'bamboo');
    this._shrubs = this._instanced(shrubGeometry(), foliageMaterial(true), S.shrubs, 'shrub');
    this._rocks  = this._instanced(chiselledRock(3 + (this._seed % 5), 1, 14), rockMaterial(true), S.rocks, 'rock');
    // contact shadows under palms, trees and boulders (HIGH)
    const dec = [...S.palms.map(p => [p[0], p[1], p[2], 1.5 * p[3]]), ...S.trees.map(p => [p[0], p[1], p[2], 2.2 * p[3]]),
                 ...S.bamboo.map(p => [p[0], p[1], p[2], 1.4 * p[3]]), ...S.rocks.filter(r => r[1] > -0.1).map(r => [r[0], r[1] + r[3] * 0.3, r[2], 2.0 * r[3]])];
    if (dec.length) {
      const dm = new THREE.InstancedMesh(flatQuad(), decalMaterial(), dec.length);
      const m4 = new THREE.Matrix4();
      dec.forEach(([x, y, z, s], i) => { m4.makeScale(s, 1, s); m4.setPosition(x, y + 0.03, z); dm.setMatrixAt(i, m4); });
      dm.instanceMatrix.needsUpdate = true; dm.renderOrder = 1;
      this._decals = dm; this.grp.add(dm);
    }
  }

  _instanced(geo, mat, list, kind) {
    if (!list.length) return null;
    // even spread first: LOW draws only the first half
    const order = [...list.keys()].filter(i => i % 2 === 0).concat([...list.keys()].filter(i => i % 2 === 1));
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const rnd = makePrng(this._seed + list.length * 13 + kind.length);
    order.forEach((src, i) => {
      const [x, y, z, s] = list[src];
      if (kind === 'palm') {
        const out = Math.atan2(-z, x);                                     // geometry curves toward +X
        e.set(0, out + (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 0.12, 'YXZ');
        sc.set(s, s * (0.9 + rnd() * 0.25), s);
      } else if (kind === 'rock') {
        e.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
        sc.set(s * (0.9 + rnd() * 0.4), s * (0.6 + rnd() * 0.35), s * (0.9 + rnd() * 0.3));
        col.setHSL(0.09 + rnd() * 0.04, 0.08 + rnd() * 0.08, 0.5 + rnd() * 0.12);
        if (this.biome === 'asia') col.multiplyScalar(0.82);
        im.setColorAt(i, col);
      } else {
        e.set(0, rnd() * TAU, 0); sc.set(s, s * (0.85 + rnd() * 0.3), s);
      }
      q.setFromEuler(e);
      m4.compose(p.set(x, y - (kind === 'rock' ? 0 : 0.05), z), q, sc);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = kind === 'rock';
    im.userData.fullCount = list.length;
    im.name = 'island-' + kind;
    this.grp.add(im);
    return im;
  }

  // ── HARBOR: the home port wrapped round its bay ───────────────
  _planHarbor() {
    const b = HARBOR.bay, q = HARBOR.quayZ;
    this._quayHalf = b.rx * Math.sqrt(Math.max(0, 1 - ((q - b.z) / b.rz) ** 2));
    this._pierXs = [-6.4, 0, 6.4];
    this._pierLen = 11;
    this._fortLocal  = { x: 12.6, z: 21.6 };
    this._lightLocal = { x: -12.9, z: 22.0 };
    this._noDecor.push([12.6, 21.6, 4.6], [-12.9, 22.0, 3.2], [-10.5, 33.5, 3.2], [10.8, 34.6, 2.8]);
    // outer sea walls: two arcs on the flanks, bastions at the ends and middle
    this._wallArcs = [];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let a = 0.8; a <= 1.86; a += 0.106) pts.push([side * Math.sin(a) * 25.4, Math.cos(a) * 25.4, a]);
      this._wallArcs.push({ side, pts });
      pts.forEach(([x, z]) => this._noDecor.push([x, z, 2.1]));
    }
    // berths: both sides of every finger pier, two ships deep, bows to the mouth
    for (const px of this._pierXs) for (const sd of [-1, 1]) for (const bz of [1.3, 6.5])
      this.berths.push({ x: this.x + px + sd * 2.0, z: this.z + bz, angle: 0 });
  }

  /** 0..1 flagstone paving weight (the quay plaza) at local x,z. */
  _paveAt(x, z) {
    if (!this.isHarbor) return 0;
    const q = HARBOR.quayZ, qh = this._quayHalf;
    if (z > q + 0.05) return 0;
    return smooth01((qh + 0.8 - Math.abs(x)) / 0.9) * smooth01((z - (q - 3.7)) / 0.7);
  }

  _buildHarborMesh() {
    const tiers = {};
    const build = (tier) => tiers[tier] || (tiers[tier] = cached('harbor:' + tier, () => {
      const k = new ModelKit(), hi = true;
      const q = HARBOR.quayZ, qh = this._quayHalf, D = DECK;
      // stone quay wall with coping, square pier-heads and garitas at both ends
      k.box('matte', qh * 2 + 0.3, D + 1.45, 0.62, 0, -1.45, q - 0.27, faces(P.stone, P.stoneLt), { jit: 0.07 });
      k.box('matte', qh * 2 + 0.5, 0.1, 0.78, 0, D - 0.04, q - 0.27, P.stoneLt);
      for (const sx of [-1, 1]) {
        k.box('matte', 1.6, D + 1.7, 1.6, sx * (qh + 0.35), -1.45, q - 0.5, faces(P.stone, P.stoneLt), { jit: 0.07 });
        garita(k, sx * (qh + 0.55), D + 0.25, q - 0.1, 0.95, P.stone);
      }
      // finger piers: ramp down from the quay, decking, pilings, bollards, end lanterns
      for (const px of this._pierXs) {
        const L = this._pierLen, y = 1.0;
        k.box('matte', 1.5, 0.12, 1.3, px, (y + D) / 2 - 0.08, q + 0.62, faces(P.plank, P.plankLt), { rx: Math.atan2(D - y, 1.3), c: true });
        k.box('matte', 1.5, 0.12, L - 1.25, px, y - 0.12, q + 1.25 + (L - 1.25) / 2, faces(P.plank, P.plankLt), { jit: 0.12 });
        for (let z = q + 1.6; z < q + L; z += 0.48) k.box('matte', 1.54, 0.02, 0.05, px, y, z, P.timberDk, { hi, jit: 0.1 });
        for (let z = q + 1.4; z <= q + L + 0.01; z += 1.6)
          for (const sx of [-1, 1]) k.cyl('matte', 0.11, 0.13, 3.0, 6, px + sx * 0.8, y - 2.9, z, [P.timberDk, P.timber, P.timberDk], { ao: false, jit: 0.1 });
        for (const sx of [-1, 1]) for (const bz of [1.3, 6.5]) {
          k.cyl('gloss', 0.08, 0.1, 0.24, 7, px + sx * 0.62, y, bz - 1.6, P.iron, [P.iron, P.ironLt, P.iron]);
          k.torus('matte', 0.12, 0.25, px + sx * 0.5, y + 0.03, bz - 1.0, P.rope, { rx: Math.PI / 2, hi, ts: 9 });
        }
        k.cyl('matte', 0.05, 0.06, 1.3, 5, px + 0.6, y, q + L - 0.2, P.timberDk);
        k.box('matte', 0.3, 0.05, 0.05, px + 0.48, y + 1.27, q + L - 0.2, P.timberDk);
        k.box('glow', 0.13, 0.17, 0.13, px + 0.36, y + 1.03, q + L - 0.2, P.window);
      }
      // quay lamps between the piers
      for (const lx of [-9.6, -3.2, 3.2, 9.6].filter(x => Math.abs(x) < qh - 0.3)) {
        k.box('gloss', 0.07, 1.4, 0.07, lx, D, q - 0.75, P.iron);
        k.box('gloss', 0.3, 0.05, 0.05, lx + 0.12, D + 1.38, q - 0.75, P.iron);
        k.box('glow', 0.15, 0.2, 0.15, lx + 0.24, D + 1.12, q - 0.75, P.window);
      }
      // quay clutter: crates, barrels, a hand cart, a timber crane, shot (HIGH)
      const crate = (x, y, z, s, ry = 0) => k.box('matte', s, s * 0.9, s, x, y, z, faces(P.plankLt, P.wood), { hi, jit: 0.12, ry });
      const barrel = (x, y, z) => k.cyl('matte', 0.18, 0.16, 0.46, 8, x, y, z, [P.timber, P.wood, P.timber], { hi });
      crate(-4.4, D, q - 1.6, 0.46, 0.2); crate(-3.9, D, q - 1.9, 0.4); crate(-4.2, D + 0.41, q - 1.75, 0.36, 0.5);
      barrel(-2.2, D, q - 1.3); barrel(-1.85, D, q - 1.55); barrel(-2.05, D + 0.46, q - 1.42);
      crate(4.5, D, q - 2.0, 0.44, -0.3); barrel(5.2, D, q - 1.4); barrel(1.9, D, q - 2.6);
      crate(-7.1, D, q - 2.4, 0.42); barrel(7.0, D, q - 2.6); crate(7.4, D, q - 2.1, 0.38, 0.4);
      // hand cart
      k.box('matte', 0.9, 0.3, 0.55, -5.9, D + 0.22, q - 2.8, P.plank, { hi, ry: 0.4 });
      for (const sz of [-1, 1]) k.cyl('matte', 0.2, 0.2, 0.06, 8, -5.9 + 0.12, D + 0.2, q - 2.8 + sz * 0.33, P.timberDk, { rx: Math.PI / 2, c: true, hi });
      k.box('matte', 0.9, 0.05, 0.05, -5.15, D + 0.3, q - 2.48, P.timberDk, { hi, ry: 0.4 });
      crate(-5.95, D + 0.37, q - 2.8, 0.3, 0.4);
      // timber crane by the middle pier
      k.box('matte', 0.24, 2.6, 0.24, 1.4, D, q - 1.0, P.timberDk);
      k.strut('matte', 1.4, D + 2.45, q - 1.0, 1.4, D + 2.0, q + 1.6, 0.14, P.timber);
      k.strut('matte', 1.4, D + 1.3, q - 1.0, 1.4, D + 2.05, q + 1.0, 0.08, P.timber);
      k.box('matte', 0.02, 0.85, 0.02, 1.4, D + 1.15, q + 1.55, P.rope);
      k.box('matte', 0.42, 0.32, 0.42, 1.4, D + 0.85, q + 1.55, faces(P.plankLt, P.wood), { hi });
      // outer sea walls with bastions and domed garitas
      for (const arc of this._wallArcs) {
        const pts = arc.pts;
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
          k.box('matte', L + 0.1, 3.0, 0.95, (ax + bx) / 2, D - 1.6, (az + bz) / 2, faces(P.stone, P.stoneLt), { ry: Math.atan2(-dz, dx), jit: 0.08 });
          k.box('matte', L + 0.1, 0.32, 0.3, (ax + bx) / 2 + (ax + bx) / 2 / 25.4 * 0.32, D + 1.4, (az + bz) / 2 + (az + bz) / 2 / 25.4 * 0.32, P.stone, { ry: Math.atan2(-dz, dx) });
        }
        for (const i of [0, Math.floor(pts.length / 2), pts.length - 1]) {
          const [x, z] = pts[i], ry = Math.atan2(x, z);
          k.poly('matte', [[0, 0.95], [0.62, 0.28], [0.45, -0.45], [-0.45, -0.45], [-0.62, 0.28]], 0.9, 3.3, x, D - 1.6, z,
            [P.stone, P.stoneLt], { ry, s: 2.1, jit: 0.08 });
          garita(k, x + Math.sin(ry) * 1.75, D + 1.72, z + Math.cos(ry) * 1.75, 1.0, P.stone);
          fortCannon(k, x + Math.sin(ry) * 0.6, D + 1.7, z + Math.cos(ry) * 0.6, ry);
        }
      }
      return k.bake(tier === 'high');
    }));
    this._harborDress = { group: new THREE.Group(), build, meshes: [] };
    this.grp.add(this._harborDress.group);
    this._setHarborTier(_quality);

    // lighthouse on the west horn, a battery and a watchtower on the mouth islets
    const lh = makeBuildingMesh({ id: 'lighthouse', footprint: { w: 1, h: 1 } }, { team: this._own, fit: 1.55 });
    lh.position.set(this._lightLocal.x, DECK, this._lightLocal.z);
    this.grp.add(lh);
    const bat = makeBuildingMesh({ id: 'culverin_battery', footprint: { w: 2, h: 1 } }, { team: this._own, fit: 0.68, facingDeg: 0, outwardDeg: 0 });
    bat.position.set(-10.5, this._heightAt(-10.5, 33.5), 33.5);
    bat.rotation.y = -0.25;
    const wt = makeBuildingMesh({ id: 'watchtower', footprint: { w: 1, h: 1 } }, { team: this._own, fit: 0.95, facingDeg: 10, outwardDeg: 10 });
    wt.position.set(10.8, this._heightAt(10.8, 34.6), 34.6);
    this.grp.add(bat, wt);
    this._harborProps = [lh, bat, wt];

    this._buildColliders();
  }
  _setHarborTier(tier) {
    const hd = this._harborDress;
    if (!hd) return;
    hd.meshes.forEach(m => hd.group.remove(m));
    hd.meshes = [];
    const g = hd.build(tier);
    for (const kind of ['matte', 'gloss', 'gold', 'glow']) {
      if (!g[kind]) continue;
      const m = new THREE.Mesh(g[kind], kindMaterial(kind));
      m.castShadow = kind !== 'glow'; m.receiveShadow = kind !== 'glow';
      hd.group.add(m); hd.meshes.push(m);
    }
  }

  // Collision circles inside the land (never over the bay): greedy cover of
  // SDF samples, biggest first, plus one per islet. World coordinates.
  _buildColliders() {
    const cand = [];
    for (let z = -32; z <= 30; z += 2.5) for (let x = -32; x <= 32; x += 2.5) {
      const d = Math.max(Math.hypot(x, z) - HARBOR.outerR, -harborWaterSDF(x, z));
      if (d < -1.4) cand.push([x, z, Math.min(-d, 8)]);
    }
    cand.sort((a, b) => b[2] - a[2]);
    const pick = [];
    for (const c of cand) {
      if (pick.some(p => Math.hypot(c[0] - p[0], c[1] - p[1]) < p[2] * 0.82)) continue;
      pick.push(c);
      if (pick.length >= 34) break;
    }
    for (const [ix, iz, ir] of HARBOR.islets) pick.push([ix, iz, ir + 0.3]);
    this.colliders = pick.map(([x, z, r]) => ({ x: this.x + x, z: this.z + z, r }));
  }

  // ── Pier (player islands): from a camera-side cove out to deep water ──
  _buildPier() {
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU, dx = Math.sin(a), dz = Math.cos(a);
      let R = 4;
      while (R < this.r + 4 && this._heightAt(dx * R, dz * R) > 0.05) R += 0.25;
      let blocked = false;
      for (let t = R - 2.0; t < R + 4.5; t += 0.5)
        for (const w of [-1.6, 0, 1.6])
          if (this._inCell(dx * t + dz * w, dz * t - dx * w, 0.1) && this._heightAt(dx * t, dz * t) > 0.2) blocked = true;
      if (blocked) continue;
      const camSide = Math.cos(a);                                        // +Z faces the camera
      const score = R - camSide * 3.0 + Math.abs(Math.sin(a)) * 0.8;
      if (!best || score < best.score) best = { a, R, score };
    }
    if (!best) return;
    const root = best.R - 1.7, len = Math.min(4.6, Math.max(2.6, this.r + 3.2 - root));
    this._pierDir = best.a;
    const pier = new THREE.Group();
    pier.position.set(Math.sin(best.a) * root, 0, Math.cos(best.a) * root);
    pier.rotation.y = best.a;
    this._pier = pier; this._pierLen = len;
    this.grp.add(pier);
    this._pierMeshes = [];
    this._setPierTier(_quality);
    const rb = rowboatGeo();
    this._boat = new THREE.Mesh(rb.matte, kindMaterial('matte'));
    this._boat.castShadow = true;
    this._boat.position.set(-1.25, 0.15, len - 0.4);
    this._boat.rotation.y = 0.12;
    pier.add(this._boat);
  }
  _setPierTier(tier) {
    if (!this._pier) return;
    this._pierMeshes.forEach(m => this._pier.remove(m));
    this._pierMeshes = [];
    const g = pierGeos(this._pierLen, tier);
    for (const kind of ['matte', 'gloss', 'glow']) {
      if (!g[kind]) continue;
      const m = new THREE.Mesh(g[kind], kindMaterial(kind));
      m.castShadow = kind !== 'glow'; m.receiveShadow = kind !== 'glow';
      this._pier.add(m); this._pierMeshes.push(m);
    }
  }

  // ── Fort ──────────────────────────────────────────────────────
  _buildFort(def) {
    this.fgrp = new THREE.Group();
    const fp = this._fortLocal || { x: 0, z: 0 };
    this.fgrp.position.set(fp.x, DECK, fp.z);
    this.fgrp.name = 'fort:' + this.fortStyle;
    this._fortMeshes = [];
    this._fortTier = null;
    this._setFortTier(_quality);
    const { spec } = fortGeos(this.fortStyle, this._own, this.faction, _quality);
    this._fireY = DECK + spec.fireY + 0.6;
    // team flag on a pole (sways)
    this._flags = [];
    for (const [fx, fy, fz, fw, fh] of spec.flags) {
      const poleLen = spec.pole || 2.25;
      const pg = poleGeo(poleLen);
      const pole = new THREE.Group();
      pole.position.set(fx, fy, fz);
      for (const kind of ['gloss', 'gold']) if (pg[kind]) pole.add(new THREE.Mesh(pg[kind], kindMaterial(kind)));
      const flag = new THREE.Mesh(flagGeo(fw, fh), teamMaterial(this._own));
      flag.position.set(0.04, poleLen - 0.06, 0);
      flag.castShadow = true;
      pole.add(flag);
      this.fgrp.add(pole);
      this._flags.push(flag);
    }
    this.grp.add(this.fgrp);
  }
  _setFortTier(tier) {
    if (!this.fgrp || this._fortTier === tier) return;
    this._fortTier = tier;
    this._fortMeshes.forEach(m => this.fgrp.remove(m));
    this._fortMeshes = [];
    const { geos } = fortGeos(this.fortStyle, this._own, this.faction, tier);
    for (const kind of ['matte', 'gloss', 'gold', 'glow', 'lamp']) {
      if (!geos[kind]) continue;
      const m = new THREE.Mesh(geos[kind], kindMaterial(kind));
      m.castShadow = kind !== 'glow' && kind !== 'lamp'; m.receiveShadow = m.castShadow;
      this.fgrp.add(m); this._fortMeshes.push(m);
    }
  }

  _buildHPSprite() {
    const hc = document.createElement('canvas'); hc.width = 128; hc.height = 20;
    this._hpCtx = hc.getContext('2d');
    this._hpTex = new THREE.CanvasTexture(hc);
    this.hs = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._hpTex, transparent: true, depthTest: false,
    }));
    this.hs.scale.set(8, 1.2, 1);
    this.hs.position.set(this._fortLocal?.x || 0, 9.5, this._fortLocal?.z || 0);
    this.grp.add(this.hs);
    this.drawHP(1);
  }

  drawHP(frac) {
    const x = this._hpCtx, t = this._hpTex;
    x.clearRect(0, 0, 128, 20);
    x.fillStyle = '#1a3050'; x.fillRect(4, 4, 120, 12);
    x.fillStyle = frac > 0.6 ? '#3ddc84' : frac > 0.3 ? '#ffb300' : '#ff5252';
    x.fillRect(4, 4, Math.max(0, 120 * frac), 12);
    x.strokeStyle = '#4a7fa5'; x.lineWidth = 1; x.strokeRect(4, 4, 120, 12);
    t.needsUpdate = true;
  }

  // ── Owner / quality / animation ──────────────────────────────
  _applyOwner() {
    this._paintTerrain();
    if (this._flags) this._flags.forEach(f => { f.material = teamMaterial(this._own); });
    if (this.fortStyle === 'castillo' && this.fgrp && !this.faction) {
      this._fortTier = null; this._setFortTier(_quality);
    }
  }

  _applyQuality() {
    const hi = _quality === 'high';
    if (this._terrain) this._terrain.material = terrainMaterial(hi);
    for (const im of [this._palms, this._broad, this._bamboo, this._shrubs]) {
      if (!im) continue;
      im.material = foliageMaterial(hi);
      im.count = hi ? im.userData.fullCount : Math.ceil(im.userData.fullCount / 2);
    }
    if (this._shrubs) this._shrubs.visible = hi;
    if (this._rocks) {
      this._rocks.material = rockMaterial(hi);
      this._rocks.count = hi ? this._rocks.userData.fullCount : Math.ceil(this._rocks.userData.fullCount / 2);
    }
    if (this._decals) this._decals.visible = hi;
    if (this._boat) this._boat.visible = hi;
    this._setPierTier(_quality);
    this._setHarborTier(_quality);
    if (!this.down) this._setFortTier(_quality);
  }

  _animate(renderer, scene) {
    updateModelLighting(renderer, scene);
    const t = time.elapsed;
    SHARED.time.value = t;
    if (_quality !== 'high') return;
    if (this._flags) for (let i = 0; i < this._flags.length; i++)
      this._flags[i].rotation.y = Math.sin(t * 1.7 + this.x * 0.1 + i) * 0.22 + Math.sin(t * 3.9 + i) * 0.06;
    if (this._boat && this._pier) {
      const b = this._boat, p = this._pier;
      const wx = this.x + p.position.x + Math.sin(p.rotation.y) * b.position.z + Math.cos(p.rotation.y) * b.position.x;
      const wz = this.z + p.position.z + Math.cos(p.rotation.y) * b.position.z - Math.sin(p.rotation.y) * b.position.x;
      b.position.y = getWaveHeight(wx, wz, t) * 0.8 + 0.12;
      b.rotation.z = Math.sin(t * 1.3 + wx) * 0.05;
    }
  }

  destroyFort() {
    if (this.down) return;
    this.down = true;
    this.hp = 0;
    this.clearFire();
    this.grp.remove(this.fgrp);
    this.grp.remove(this.hs);
    this._rubble = [];
    const geo = chiselledRock(9, 1, 14);
    const rubbleMat = cached('rubbleMat', () => new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 1 }));
    for (let k = 0; k < 7; k++) {
      const rub = new THREE.Mesh(geo, rubbleMat);
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2, s = 0.25 + Math.random() * 0.45;
      rub.scale.set(s, s * 0.7, s);
      rub.position.set((this._fortLocal?.x || 0) + Math.cos(a) * r, DECK + s * 0.25, (this._fortLocal?.z || 0) + Math.sin(a) * r);
      rub.rotation.set(Math.random() * 3, Math.random() * Math.PI, Math.random() * 3);
      rub.castShadow = true;
      this.grp.add(rub); this._rubble.push(rub);
    }
  }

  // AF7: fire source management ─────────────────────────────────
  setOnFire(vfx, intensity = 1.0) {
    // AN: escalate an already-burning fort instead of ignoring the call —
    // CombatSystem recomputes intensity from HP on every hit below 50 %.
    if (this._fireSource) { this._fireSource.setIntensity?.(intensity); return; }
    const fp = this._fortLocal || { x: 0, z: 0 };
    this._fireSource = vfx.startBurning(this.x + fp.x, this._fireY, this.z + fp.z, intensity);
  }

  clearFire() {
    this._fireSource?.stop?.();
    this._fireSource = null;
  }

  updateFire(dt, vfx) {
    if (!this._fireSource) return;
    this._fireSource.update(dt, vfx._fire, vfx._smoke);
  }

  rebuildFort() {
    if (this._rubble) this._rubble.forEach(r => this.grp.remove(r));
    this._rubble = [];
    this.hp    = Math.round(this.maxHp * 0.6);
    this.down  = false;
    this.clearFire();
    this._buildFort(this.def);
    this._buildHPSprite();
    this.drawHP(this.hp / this.maxHp);
  }
}
