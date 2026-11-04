import * as THREE from 'three';
import { BUILD_CELL_WORLD } from '../../data/constants.js';
import { gfx } from '../Render/GfxQuality.js';

// ── BUILDING MODELS — stylised low-poly colonial-Caribbean harbour kit ──────
// One procedural model per building / defense id (data/buildings.js,
// data/defenses.js) plus a generic fallback. Period: 16th–early 18th century
// Spanish Main — colonial timber and coral stone, terracotta and palm thatch,
// star-fort bastions with domed garitas, period cannon. No modern towers.
//
// API
//   makeBuildingMesh(def, opts) → THREE.Group      (see JSDoc below)
//   makeBuildingGhost(def, mat, edgeMat?) → Group  placement hologram
//   setBuildingQuality('high'|'low') / getBuildingQuality()
//   disposeBuildingModels()                         frees every cached GPU resource
//   ModelKit, PALETTE, kindMaterial, teamMaterial, chiselledRock,
//   contactShadowTexture                            shared with IslandEntity
//
// PERFORMANCE
//   • Every part of a model is baked ONCE per building type into merged,
//     vertex-coloured BufferGeometries — one per material kind (matte stone /
//     timber, glossy iron, gold, lit windows, lamps, team colour). A placed
//     building is therefore 2–6 draw calls (≤ 12 meshes), not one per part.
//   • Geometries and materials live in module caches and are shared by every
//     instance. They are PINNED: their dispose() is a no-op, because per-
//     instance teardown code (BuildSystem._disposeMesh, IslandPanel demolish)
//     traverses and disposes whatever it finds. disposeBuildingModels() frees
//     them for real.
//   • Each mesh remembers its original material in userData.baseMat, so code
//     that clones materials (construction fade) can put the shared one back.
//   • Only the deadman's lure lantern owns its material: CombatSystem flashes
//     inst.mesh.children[0].material.color during the lure warning.
//   • Idle animation + quality switches run from the main mesh's
//     onBeforeRender — off-screen (frustum-culled) buildings cost nothing.
//
// GFX tiers (same model as Systems/VFX/quality.js, inits from window._gfxQuality)
//   HIGH: small props (crates, barrels, logs, shot piles…), soft contact
//         shadow under each building, idle animation.
//   LOW : props dropped (smaller geometry), no contact shadows, static.

const CELL = BUILD_CELL_WORLD;
const KINDS = ['matte', 'gloss', 'gold', 'glow', 'lamp', 'team'];
const NOOP = () => {};
const TAU = Math.PI * 2;

// ── Palette ────────────────────────────────────────────────────────────────
export const PALETTE = Object.freeze({
  plaster:  0xF0E7D4, plasterW: 0xE6D6B6, ochre:   0xDDA75A, ochreDk: 0xB9853F,
  terra:    0xBB5A3A, terraDk:  0x8E3E2A, shingle: 0x6E5642, thatch:  0xBF9A5A,
  timberDk: 0x4B3322, timber:   0x7A5134, plank:   0xA9784A, plankLt: 0xC9A06A,
  stone:    0xCBBC9C, stoneDk:  0x9C8E76, stoneLt: 0xE3D8C0, cobble:  0xA6977C,   // coral stone
  ochreSt:  0xD3A35E, ochreStDk:0xA97B3E,                                            // castillo stone
  rock:     0x8E877B, rockDk:   0x6B655C, earth:   0x8B6E4C, sand:    0xD8C493,
  turf:     0x6F8C46, turfLt:   0x86A356,
  iron:     0x34312E, ironLt:   0x5A554E, brass:   0xD9A93E, gold:    0xF4C64F,
  copper:   0x62A892, glass:    0x203445,
  shutter:  0x3E7068, shutterB: 0x2F5E8A, rope:    0xBDA172, bark:    0x5C3F28,
  wood:     0xDDB680, bone:     0xE8DFC8, black:   0x161210, white:   0xF4F0E6,
  canvas:   0xEEE5CF, window:   0xF7C66E, lamp:    0xFFE0A0, fire:    0xFF9A3C,
  lure:     0x4A3F48, lureDk:   0x2F2830,
});
const P = PALETTE;
const TEAM_COLOR = { player: 0x2C68D2, enemy: 0xC8352B, neutral: 0xD2BC86 };

// ── GFX quality ────────────────────────────────────────────────────────────
let _quality = gfx?.level === 'low' ? 'low' : 'high';
try {
  const q = typeof window !== 'undefined' ? window._gfxQuality : null;
  if (q === 'low' || q === 'high') _quality = q;
} catch { /* non-browser */ }

gfx?.on?.('change.buildingArt', () => setBuildingQuality(gfx.level));

/**
 * Switch building detail tier. Live buildings pick it up on their next frame.
 * @param {'high'|'low'} q
 * @returns {'high'|'low'} tier now active
 */
export function setBuildingQuality(q) { _quality = q === 'low' ? 'low' : 'high'; return _quality; }
/** @returns {'high'|'low'} */
export function getBuildingQuality() { return _quality; }

// ── Pinned shared resources ────────────────────────────────────────────────
const _pinned = new Set();
function pin(res) {
  if (!_pinned.has(res)) { res.dispose = NOOP; _pinned.add(res); }
  return res;
}

/** Free every cached geometry / material / texture (app teardown only). */
export function disposeBuildingModels() {
  for (const r of _pinned) { delete r.dispose; try { r.dispose(); } catch { /* already gone */ } }
  _pinned.clear(); _prims.clear(); _mats.clear(); _entries.clear(); _texs.clear();
}

// ── Materials ──────────────────────────────────────────────────────────────
const _mats = new Map();
function sharedMat(key, make) {
  let m = _mats.get(key);
  if (!m) { m = pin(make()); m.name = key; _mats.set(key, m); }
  return m;
}
// Bounce fill: the sun sits north of the north-looking RTS camera (backlit sea
// glitter), so every camera-facing wall is in shade and the flat ambient turns
// whitewash navy. Shared model materials add `albedo × uModelFill` as light
// bounced off the sunlit deck; updateModelLighting() scales it by the live key
// light so it fades out at night.
const FILL_BASE = 0.2;
const FILL = { value: FILL_BASE };
function withFill(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uModelFill = FILL;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uModelFill;')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uModelFill;');
  };
  m.customProgramCacheKey = () => 'bm-fill';
  return m;
}
let _fillFrame = -1, _keyLight = null, _keyMax = 0.5;
/**
 * Track the scene's shadow-casting key light once per rendered frame and scale
 * the model bounce fill with it. Called from model onBeforeRender hooks.
 */
export function updateModelLighting(renderer, scene) {
  const f = renderer?.info?.render?.frame;
  if (f === _fillFrame) return;
  _fillFrame = f;
  if (!_keyLight || !_keyLight.parent) {
    _keyLight = null;
    scene?.traverse?.(o => { if (!_keyLight && o.isDirectionalLight && o.castShadow) _keyLight = o; });
  }
  const i = _keyLight ? _keyLight.intensity : 1;
  _keyMax = Math.max(_keyMax * 0.9997, i, 0.5);
  FILL.value = FILL_BASE * (0.25 + 0.75 * Math.min(1, i / _keyMax));
}
const KIND_MAT = {
  matte: () => withFill(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 })),
  gloss: () => withFill(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.32 })),
  gold:  () => withFill(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4,
                                               emissive: 0x6a4806, emissiveIntensity: 0.6 })),
  glow:  () => new THREE.MeshBasicMaterial({ vertexColors: true }),                    // lit windows
  lamp:  () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), // bloom sources
};
/** Shared material for a model part kind ('matte'|'gloss'|'gold'|'glow'|'lamp'). */
export function kindMaterial(kind) { return sharedMat('bm:' + kind, KIND_MAT[kind] || KIND_MAT.matte); }
/** Shared team-coloured material (flags, pennants, banners; vertex colours tint it). */
export function teamMaterial(team) {
  const t = TEAM_COLOR[team] !== undefined ? team : 'player';
  return sharedMat('bm:team:' + t, () => withFill(new THREE.MeshStandardMaterial({
    color: TEAM_COLOR[t], vertexColors: true, roughness: 0.72, side: THREE.DoubleSide })));
}
function matFor(kind, team) { return kind === 'team' ? teamMaterial(team) : kindMaterial(kind); }

// ── Textures (canvas-generated once) ───────────────────────────────────────
const _texs = new Map();
function canvasTex(key, size, draw) {
  let t = _texs.get(key);
  if (!t) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    t = pin(new THREE.CanvasTexture(c));
    _texs.set(key, t);
  }
  return t;
}
/** Soft rounded-square contact shadow (alpha in the texture, black colour). */
export function contactShadowTexture() {
  return canvasTex('contact', 64, (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  });
}
function haloTexture() {
  return canvasTex('halo', 64, (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.0, 'rgba(255,244,210,1)');
    g.addColorStop(0.25, 'rgba(255,214,140,0.55)');
    g.addColorStop(1.0, 'rgba(255,190,90,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  });
}
function decalMat() {
  return sharedMat('bm:fx:contact', () => new THREE.MeshBasicMaterial({
    color: 0x000000, map: contactShadowTexture(), transparent: true, opacity: 0.42,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
function haloMat() {
  return sharedMat('bm:fx:halo', () => new THREE.SpriteMaterial({
    map: haloTexture(), color: 0xffffff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false }));
}

// ── Primitive cache (non-indexed unit shapes) ──────────────────────────────
const _prims = new Map();
function prim(key, make) {
  let g = _prims.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    _prims.set(key, g);
  }
  return g;
}
const pBox = () => prim('box', () => new THREE.BoxGeometry(1, 1, 1));
function pCyl(rt, rb, n, open) {
  const s = Math.max(rt, rb, 1e-6), a = (rt / s).toFixed(3), b = (rb / s).toFixed(3);
  return prim(`cyl${a}_${b}_${n}_${open ? 1 : 0}`, () => new THREE.CylinderGeometry(+a, +b, 1, n, 1, !!open));
}
function pSphere(w, h, tl) {
  return prim(`sph${w}_${h}_${tl.toFixed(3)}`, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, tl));
}
function pTorus(tube, rs, ts, arc) {
  return prim(`tor${tube}_${rs}_${ts}_${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc));
}
// Tri-list geometry with groups (each group = list of [a,b,c] points)
function triGeo(groups) {
  const pos = [], g = new THREE.BufferGeometry();
  let start = 0;
  groups.forEach((tris, gi) => {
    tris.forEach(([a, b, c]) => pos.push(...a, ...b, ...c));
    g.addGroup(start, tris.length * 3, gi);
    start += tris.length * 3;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// Gable roof: base x,z ∈ [-.5,.5], ridge along Z at y=1. groups: 0 slopes, 1 gable ends
const pGable = () => prim('gable', () => {
  const A = [-.5, 0, -.5], B = [.5, 0, -.5], C = [.5, 0, .5], D = [-.5, 0, .5], E = [0, 1, -.5], F = [0, 1, .5];
  return triGeo([[[C, B, E], [C, E, F], [A, D, F], [A, F, E]], [[D, C, F], [A, E, B]]]);
});
// Hip roof: ridge along X, inset k (0 < k < .5) at each end
function pHip(k) {
  const kk = Math.min(0.49, Math.max(0.02, k));
  return prim(`hip${kk.toFixed(2)}`, () => {
    const A = [-.5, 0, -.5], B = [.5, 0, -.5], C = [.5, 0, .5], D = [-.5, 0, .5];
    const R1 = [-.5 + kk, 1, 0], R2 = [.5 - kk, 1, 0];
    return triGeo([[[D, C, R2], [D, R2, R1], [B, A, R1], [B, R1, R2], [C, B, R2], [A, D, R1]]]);
  });
}
/**
 * Battered polygon prism: base polygon pts (x,z) at y=0, the same polygon scaled
 * by `top` at y=1. Groups: 0 sides, 1 top cap. Point order runs +Z → +X → −Z → −X
 * (e.g. [[0,1],[1,0],[0,-1],[-1,0]]) so faces wind outward.
 */
function pPolyFrustum(pts, top) {
  return prim(`poly${pts.map(p => p.join(',')).join(';')}_${top}`, () => {
    const sides = [], cap = [], n = pts.length;
    const B = pts.map(([x, z]) => [x, 0, z]), T = pts.map(([x, z]) => [x * top, 1, z * top]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      sides.push([B[i], B[j], T[j]], [B[i], T[j], T[i]]);
    }
    for (let i = 1; i < n - 1; i++) cap.push([T[0], T[i], T[i + 1]]);
    return triGeo([sides, cap]);
  });
}
// Pennant: thin triangle hanging off a pole at x=0
const pPennant = () => prim('pennant', () => triGeo([[[[0, 0, 0], [0, -0.24, 0], [0.46, -0.1, 0]]]]));

/**
 * Convex boulder: a sphere chiselled by `cuts` random planes (creased facets).
 * Deterministic per seed. Non-indexed, flat normals.
 * @param {number} seed
 * @param {number} [detail=1] icosahedron subdivision
 * @param {number} [cuts=16]
 */
export function chiselledRock(seed, detail = 1, cuts = 16) {
  return prim(`rock${seed}_${detail}_${cuts}`, () => {
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const planes = [];
    for (let i = 0; i < cuts; i++) {
      const u = rnd() * 2 - 1, a = rnd() * TAU, q = Math.sqrt(1 - u * u);
      planes.push([q * Math.cos(a), u, q * Math.sin(a), 0.6 + rnd() * 0.3]);
    }
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      for (const [nx, ny, nz, d] of planes) {
        const e = x * nx + y * ny + z * nz - d;
        if (e > 0) { x -= e * nx; y -= e * ny; z -= e * nz; }
      }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  });
}

// ── Transform helpers ──────────────────────────────────────────────────────
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function xf(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v1.set(x, y, z), _q, _v2.set(sx, sy, sz));
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function shade(hex, f) {
  const c = new THREE.Color(hex);
  return new THREE.Color(clamp01(c.r * f), clamp01(c.g * f), clamp01(c.b * f)).getHex();
}
function hash01(n) { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

// ── ModelKit: accumulate parts, bake to merged vertex-coloured geometry ────
/**
 * Part accumulator. Positions are in model space (origin = ground centre of the
 * footprint, +Y up, front = +Z, i.e. toward the default camera). By default
 * `y` is the BOTTOM of a part; pass `{c:true}` to give its centre instead.
 * Options: rx/ry/rz (Euler YXZ), c, hi (HIGH-tier prop), smooth, jit, ao.
 */
export class ModelKit {
  constructor() { this.parts = []; this._seed = 1; this.aoOffset = 0; }

  add(kind, geo, m, col, o = {}) {
    this.parts.push({ kind, geo, m, col, flat: !o.smooth, jit: o.jit ?? 0.07,
      ao: o.ao ?? !(kind === 'glow' || kind === 'lamp'), hi: !!o.hi, seed: this._seed++ });
    return this;
  }
  box(kind, w, h, d, x, y, z, col, o = {}) {
    return this.add(kind, pBox(), xf(x, o.c ? y : y + h / 2, z, o.rx, o.ry, o.rz, w, h, d), col, o);
  }
  /** Cylinder (rt top radius, rb bottom radius, n sides). col = hex | [side, top, bottom]. */
  cyl(kind, rt, rb, h, n, x, y, z, col, o = {}) {
    const s = Math.max(rt, rb, 1e-6);
    return this.add(kind, pCyl(rt, rb, n, o.open), xf(x, o.c ? y : y + h / 2, z, o.rx, o.ry, o.rz,
      s * (o.sx || 1), h, s * (o.sz || 1)), col, o);
  }
  cone(kind, r, h, n, x, y, z, col, o = {}) { return this.cyl(kind, 0, r, h, n, x, y, z, col, o); }
  /** Sphere / dome (y = centre). o.tl = theta length (π/2 → dome), o.w/o.hs segments, o.sy squash. */
  sphere(kind, r, x, y, z, col, o = {}) {
    return this.add(kind, pSphere(o.w || 8, o.hs || 6, o.tl || Math.PI),
      xf(x, y, z, o.rx, o.ry, o.rz, r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1)), col, o);
  }
  /** Gable roof: span across the ridge (X), height, length along the ridge (Z). ry=π/2 → ridge along X. */
  gable(kind, span, h, len, x, y, z, roofCol, endCol, o = {}) {
    return this.add(kind, pGable(), xf(x, y, z, o.rx, o.ry, o.rz, span, h, len), [roofCol, endCol ?? roofCol], o);
  }
  /** Hip roof, ridge along X (w × d base, inset k of the ridge ends). */
  hip(kind, w, h, d, k, x, y, z, col, o = {}) {
    return this.add(kind, pHip(k), xf(x, y, z, o.rx, o.ry, o.rz, w, h, d), col, o);
  }
  /** Torus (R major radius, tube as fraction of R). Default ring lies in XY (axis Z). */
  torus(kind, R, tube, x, y, z, col, o = {}) {
    return this.add(kind, pTorus(tube, o.rs || 4, o.ts || 12, o.arc || TAU),
      xf(x, y, z, o.rx, o.ry, o.rz, R, R, R), col, o);
  }
  rock(kind, r, x, y, z, col, seed, o = {}) {
    return this.add(kind, chiselledRock(seed, o.detail ?? 1),
      xf(x, y, z, o.rx, o.ry, o.rz, r * (o.sx || 1), r * (o.sy || 1), r * (o.sz || 1)), col, o);
  }
  /** Battered polygon prism (pts counter-clockwise seen from above, base at y). col = [sides, top]. */
  poly(kind, pts, top, h, x, y, z, col, o = {}) {
    return this.add(kind, pPolyFrustum(pts, top), xf(x, y, z, o.rx, o.ry, o.rz, o.s || 1, h, o.s || 1), col, o);
  }
  /** Square beam from point a to point b (t = thickness). */
  strut(kind, ax, ay, az, bx, by, bz, t, col, o = {}) {
    _v1.set(bx - ax, by - ay, bz - az);
    const len = _v1.length() || 1e-4;
    _q.setFromUnitVectors(_up, _v1.multiplyScalar(1 / len));
    const m = new THREE.Matrix4().compose(_v2.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q,
      new THREE.Vector3(t, len, o.td || t));
    return this.add(kind, pBox(), m, col, o);
  }
  /** Tapered round tube from point a (radius r0) to point b (radius r1), n sides. */
  tube(kind, ax, ay, az, bx, by, bz, r0, r1, n, col, o = {}) {
    _v1.set(bx - ax, by - ay, bz - az);
    const len = _v1.length() || 1e-4, s = Math.max(r0, r1);
    _q.setFromUnitVectors(_up, _v1.multiplyScalar(1 / len));
    const m = new THREE.Matrix4().compose(_v2.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q,
      new THREE.Vector3(s, len, s));
    return this.add(kind, pCyl(r1, r0, n, o.open), m, col, o);
  }
  /** Custom geometry (non-indexed preferred) with a full transform. */
  geo(kind, geo, x, y, z, col, o = {}) {
    return this.add(kind, geo.index ? geo.toNonIndexed() : geo,
      xf(x, y, z, o.rx, o.ry, o.rz, o.sx || 1, o.sy || 1, o.sz || 1), col, o);
  }

  /** Bake to {kind: BufferGeometry|null}. high=false drops parts flagged `hi`. */
  bake(high = true) {
    const out = {};
    for (const kind of KINDS) {
      const ps = this.parts.filter(p => p.kind === kind && (high || !p.hi));
      out[kind] = ps.length ? bakeParts(ps, this.aoOffset) : null;
    }
    return out;
  }
}

const _nm = new THREE.Matrix3(), _c = new THREE.Color();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
function bakeParts(parts, aoOffset = 0) {
  let n = 0;
  for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const g = p.geo, sp = g.attributes.position.array, sn = g.attributes.normal ? g.attributes.normal.array : null;
    const cnt = g.attributes.position.count;
    _nm.getNormalMatrix(p.m);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: cnt, materialIndex: 0 }];
    for (const gr of groups) {
      const hex = Array.isArray(p.col) ? (p.col[gr.materialIndex] ?? p.col[0]) : p.col;
      _c.setHex(hex);
      const end = Math.min(cnt, gr.start + gr.count);
      for (let i = gr.start; i + 2 < end; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = i + k, gi = (o + vi) * 3;
          _v1.fromArray(sp, vi * 3).applyMatrix4(p.m);
          pos[gi] = _v1.x; pos[gi + 1] = _v1.y; pos[gi + 2] = _v1.z;
          if (!p.flat && sn) {
            _v1.fromArray(sn, vi * 3).applyMatrix3(_nm).normalize();
            nor[gi] = _v1.x; nor[gi + 1] = _v1.y; nor[gi + 2] = _v1.z;
          }
        }
        const g0 = (o + i) * 3;
        if (p.flat || !sn) {
          _pa.fromArray(pos, g0); _pb.fromArray(pos, g0 + 3); _pc.fromArray(pos, g0 + 6);
          _pc.sub(_pb); _pa.sub(_pb); _pc.cross(_pa);
          if (_pc.lengthSq() < 1e-14) _pc.set(0, 1, 0); else _pc.normalize();
          for (let k = 0; k < 3; k++) { nor[g0 + k * 3] = _pc.x; nor[g0 + k * 3 + 1] = _pc.y; nor[g0 + k * 3 + 2] = _pc.z; }
        }
        // hand-painted variation per quad (triangle pair) + height AO
        const j = 1 + (hash01(p.seed * 97.13 + ((i / 3) >> 1) * 7.31) - 0.5) * p.jit * 2;
        for (let k = 0; k < 3; k++) {
          const gi = g0 + k * 3;
          const ao = p.ao ? 0.72 + 0.28 * clamp01((pos[gi + 1] + aoOffset + 0.05) / 0.95) : 1;
          const f = j * ao;
          col[gi] = clamp01(_c.r * f); col[gi + 1] = clamp01(_c.g * f); col[gi + 2] = clamp01(_c.b * f);
        }
      }
    }
    o += cnt;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return pin(geo);
}

// ── Shared building details ────────────────────────────────────────────────
function faces(side, top) { return [side, side, top, side, side, side]; }
/** Foundation slab: covers the plot, skirts 0.75 below the deck (hides slopes). */
function plinth(k, ctx, col, o = {}) {
  const inset = o.inset ?? 0.15, top = o.top ?? 0.1;
  k.box('matte', ctx.W - inset * 2, 0.75 + top, ctx.D - inset * 2, 0, -0.75, 0,
    faces(col, shade(col, 1.08)), { jit: 0.11 });
}
/** Window on a +Z wall at (x, y0) — frame, glass (lit or dark), two shutters. */
function windowZ(k, x, y0, z, w, h, o = {}) {
  k.box('matte', w + 0.08, h + 0.08, 0.04, x, y0 - 0.04, z, o.frame ?? P.white, { jit: 0.03 });
  k.box(o.lit ? 'glow' : 'gloss', w, h, 0.05, x, y0, z + 0.01, o.lit ? P.window : P.glass);
  if (o.shutters !== false) {
    const sc = o.shutterCol ?? P.shutter;
    k.box('matte', w * 0.5, h + 0.04, 0.04, x - w * 0.78, y0 - 0.02, z + 0.01, sc, { jit: 0.04 });
    k.box('matte', w * 0.5, h + 0.04, 0.04, x + w * 0.78, y0 - 0.02, z + 0.01, sc, { jit: 0.04 });
  }
}
/** Window on a ±X wall. sx = +1 / -1 for the face direction. */
function windowX(k, x, y0, z, w, h, sx, o = {}) {
  k.box('matte', 0.04, h + 0.08, w + 0.08, x, y0 - 0.04, z, o.frame ?? P.white, { jit: 0.03 });
  k.box(o.lit ? 'glow' : 'gloss', 0.05, h, w, x + sx * 0.01, y0, z, o.lit ? P.window : P.glass);
}
function barrel(k, x, y, z, r, h, col = P.timber, o = {}) {
  k.cyl('matte', r, r * 0.86, h * 0.5, 8, x, y, z, [col, shade(col, 1.15), col], o);
  k.cyl('matte', r * 0.86, r, h * 0.5, 8, x, y + h * 0.5, z, [col, shade(col, 1.2), col], o);
  k.cyl('gloss', r * 1.02, r * 1.02, h * 0.07, 8, x, y + h * 0.2, z, P.iron, { ...o, open: true });
  k.cyl('gloss', r * 1.02, r * 1.02, h * 0.07, 8, x, y + h * 0.73, z, P.iron, { ...o, open: true });
}
function crate(k, x, y, z, s, o = {}) {
  k.box('matte', s, s * 0.92, s, x, y, z, faces(P.plankLt, shade(P.plankLt, 1.1)), { jit: 0.1, ...o });
  k.box('matte', s * 1.04, s * 0.1, s * 1.04, x, y + s * 0.4, z, P.plank, o);
}
/** Cannonball pyramid (3×3 + 2×2 + 1). */
function shotPile(k, x, y, z, r = 0.1, o = {}) {
  const lay = [[3, 0], [2, 1], [1, 2]];
  for (const [n, l] of lay) {
    const off = (n - 1) * r;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++)
      k.sphere('gloss', r, x - off + a * r * 2, y + r + l * r * 1.45, z - off + b * r * 2, P.iron,
        { w: 6, hs: 4, ...o });
  }
}
/** Naval gun pointing local +Z: barrel (gloss), carriage + wheels (matte). y = deck. */
function cannon(k, x, y, z, len, r, o = {}) {
  const kind = o.kind || 'gloss', ry = o.ry || 0, el = o.el ?? 0.06;
  const s = Math.sin(ry), c = Math.cos(ry);
  const P0 = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  if (o.carriage !== false) {
    const [cx, cz] = P0(0, -len * 0.08);
    k.box('matte', r * 3.6, r * 1.9, len * 0.62, cx, y, cz, P.timberDk, { ry, hi: o.hi });
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const [wx, wz] = P0(lx * r * 2.0, lz * len * 0.2 - len * 0.08);
      k.cyl('matte', r * 0.95, r * 0.95, r * 0.6, 7, wx, y + r * 0.95, wz, P.timber, { rz: Math.PI / 2, ry, c: true, hi: o.hi });
    }
  }
  const by = y + (o.carriage === false ? 0 : r * 2.4);
  const [bx, bz] = P0(0, len * 0.18);
  k.cyl(kind, r * 0.72, r, len, 8, bx, by, bz, P.iron, { rx: Math.PI / 2 - el, ry, c: true, smooth: true, hi: o.hi });
  const [mx, mz] = P0(0, len * 0.18 + len * 0.5);
  k.cyl(kind, r * 0.9, r * 0.9, r * 0.5, 8, mx, by + Math.sin(el) * len * 0.5, mz, P.ironLt,
    { rx: Math.PI / 2 - el, ry, c: true, smooth: true, hi: o.hi });
  const [kx, kz] = P0(0, len * 0.18 - len * 0.5);
  k.sphere(kind, r * 0.55, kx, by - Math.sin(el) * len * 0.5, kz, P.iron, { w: 6, hs: 4, hi: o.hi });
}
/** Iron anchor leaning on something (decor). */
function anchorProp(k, x, y, z, s, ry, o = {}) {
  const lean = 0.35;
  k.box('gloss', 0.07 * s, 0.85 * s, 0.07 * s, x, y + 0.48 * s, z, P.iron, { c: true, rx: -lean, ry, ...o });
  k.torus('gloss', 0.26 * s, 0.16, x, y + 0.16 * s, z + Math.sin(lean) * 0.32 * s, P.iron,
    { rz: Math.PI, rx: -lean, ry, arc: Math.PI, ts: 8, ...o });
  k.cyl('gloss', 0.03 * s, 0.03 * s, 0.56 * s, 6, x, y + 0.82 * s, z - Math.sin(lean) * 0.32 * s, P.timberDk,
    { rz: Math.PI / 2, ry, c: true, ...o });
}

/** Garita — the domed stone sentry box of Spanish Main forts, on a corbel. y = drum base. */
function garita(k, x, y, z, s = 1, col = P.stone, o = {}) {
  k.cyl('matte', 0.3 * s, 0.07 * s, 0.34 * s, 8, x, y - 0.34 * s, z, col, o);          // corbel
  k.cyl('matte', 0.3 * s, 0.3 * s, 0.6 * s, 8, x, y, z, col, { jit: 0.05, ...o });       // drum
  k.cyl('matte', 0.35 * s, 0.35 * s, 0.07 * s, 8, x, y + 0.6 * s, z, P.stoneLt, o);      // cornice
  k.sphere('matte', 0.32 * s, x, y + 0.67 * s, z, col, { tl: Math.PI / 2, w: 8, hs: 3, ...o });
  k.sphere('matte', 0.065 * s, x, y + 1.02 * s, z, P.stoneLt, { w: 5, hs: 3, ...o });
  k.box('matte', 0.06 * s, 0.22 * s, 0.04, x, y + 0.24 * s, z + 0.29 * s, P.black, { jit: 0, ...o });
}

// ── MODELS ─────────────────────────────────────────────────────────────────
// Each builder fills the static kit and returns a spec:
//   dyn:      [{ name, build(kit), pos:[x,y,z], anim, speed, turret, first }]
//   pennants: up to 3 pole-base anchors [x,y,z] (level tiers 1/2/3)
//   orient:   'outward' → square footprints yaw toward open water
//   fx:       { halo:[x,y,z,size] }  (flickering fire glow sprite)

function buildLumberMill(k, ctx) {
  // Tower windmill driving a saw, sawpit trestle and log pile (Caribbean mill)
  plinth(k, ctx, P.earth);
  const tz = -0.38;
  k.cyl('matte', 0.62, 0.66, 0.26, 10, 0, 0.1, tz, P.stoneDk, { jit: 0.08 });
  k.cyl('matte', 0.47, 0.62, 1.72, 10, 0, 0.36, tz, [P.stone, P.stoneLt, P.stone], { jit: 0.06 });
  k.cyl('matte', 0.52, 0.52, 0.08, 10, 0, 2.06, tz, P.timberDk);
  k.cone('matte', 0.58, 0.66, 10, 0, 2.12, tz, P.shingle, { jit: 0.08 });
  k.box('matte', 0.4, 0.66, 0.08, 0, 0.1, tz + 0.6, P.stoneLt);                       // door surround
  k.box('matte', 0.3, 0.58, 0.08, 0, 0.12, tz + 0.62, P.timberDk);
  k.box('gloss', 0.14, 0.2, 0.05, -0.3, 1.25, tz + 0.5, P.glass, { ry: -0.55 });
  k.cyl('gloss', 0.07, 0.07, 0.44, 6, 0, 1.92, tz + 0.52, P.iron, { rx: Math.PI / 2, c: true });  // windshaft
  // sawpit trestle with a squared log and the pit saw
  for (const tx of [-0.92, -0.32]) {
    k.strut('matte', tx - 0.14, 0.1, 0.7, tx, 0.5, 0.7, 0.06, P.timberDk);
    k.strut('matte', tx + 0.14, 0.1, 0.7, tx, 0.5, 0.7, 0.06, P.timberDk);
  }
  k.box('matte', 1.0, 0.2, 0.22, -0.62, 0.5, 0.7, faces(P.plank, P.wood));
  k.box('gloss', 0.02, 0.62, 0.14, -0.5, 0.26, 0.7, P.ironLt, { hi: true });
  // log pile (end grain toward camera) + plank stack
  for (const [lx, row] of [[0.36, 0], [0.58, 0], [0.8, 0], [0.47, 1], [0.69, 1]])
    k.cyl('matte', 0.11, 0.11, 0.6, 7, lx, 0.21 + row * 0.19, 0.66, [P.bark, P.wood, P.wood], { rx: Math.PI / 2, c: true, jit: 0.12 });
  for (let i = 0; i < 4; i++)
    k.box('matte', 0.78, 0.05, 0.2, -0.62 + (i % 2) * 0.04, 0.1 + i * 0.055, -0.86, P.plankLt, { hi: true, ry: 0.1 });
  return {
    dyn: [{
      name: 'sails', pos: [0, 1.92, tz + 0.76], anim: 'spinZ', speed: -0.8,
      build(w) {
        w.cyl('matte', 0.11, 0.11, 0.16, 8, 0, 0, 0, P.timberDk, { rx: Math.PI / 2, c: true });
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * TAU, sa = Math.sin(a), ca = Math.cos(a), tx = ca, tz2 = -sa;
          w.box('matte', 0.07, 1.1, 0.05, sa * 0.55, ca * 0.55, 0.02, P.timberDk, { c: true, rz: -a });
          w.box('matte', 0.34, 0.8, 0.02, sa * 0.66 + tx * 0.2, ca * 0.66 + tz2 * 0.2, 0, P.canvas, { c: true, rz: -a, jit: 0.04 });
          for (const r of [0.34, 0.66, 0.98])
            w.box('matte', 0.4, 0.03, 0.035, sa * r + tx * 0.2, ca * r + tz2 * 0.2, 0.015, P.timber, { c: true, rz: -a });
        }
      },
    }],
    pennants: [[0, 2.74, tz], [-0.92, 0.6, 0.7], [0.8, 0.52, 0.66]],
  };
}

function buildGoldMine(k, ctx) {
  plinth(k, ctx, 0x7E7363);
  k.rock('matte', 1, -0.12, 0.22, -0.42, P.rock, 3, { sx: 1.0, sy: 0.95, sz: 0.62, jit: 0.1 });
  k.rock('matte', 0.42, 0.74, 0.2, -0.62, P.rockDk, 7, { jit: 0.1 });
  k.rock('matte', 0.3, -0.86, 0.16, 0.18, P.rock, 11, { jit: 0.1 });
  for (const [gx, gy, gz] of [[-0.6, 0.72, -0.05], [0.28, 0.95, -0.2], [-0.35, 1.02, -0.4], [0.55, 0.5, -0.38]])
    k.rock('gold', 0.07, gx, gy, gz, P.gold, 5, { jit: 0.05 });                  // ore veins
  // adit: dark mouth in a timber frame with a little plank roof
  k.box('matte', 0.62, 0.68, 0.34, -0.12, 0.1, 0.08, P.black, { jit: 0 });
  for (const sx of [-1, 1]) k.box('matte', 0.11, 0.8, 0.13, -0.12 + sx * 0.37, 0.1, 0.25, P.timberDk);
  k.box('matte', 0.94, 0.13, 0.17, -0.12, 0.84, 0.25, P.timber);
  k.box('matte', 1.08, 0.06, 0.42, -0.12, 0.98, 0.34, P.shingle, { rx: 0.42 });
  // rails + sleepers
  for (const sx of [-1, 1]) k.box('gloss', 0.04, 0.03, 0.82, -0.12 + sx * 0.15, 0.12, 0.6, P.ironLt);
  for (let i = 0; i < 4; i++) k.box('matte', 0.48, 0.035, 0.08, -0.12, 0.1, 0.3 + i * 0.22, P.timberDk);
  // mine cart heaped with gold
  k.cyl('gloss', 0.34, 0.26, 0.3, 4, -0.12, 0.2, 0.66, P.ironLt, { ry: Math.PI / 4, sx: 0.95, sz: 0.8 });
  for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    k.cyl('gloss', 0.075, 0.075, 0.05, 8, -0.12 + wx * 0.2, 0.19, 0.66 + wz * 0.13, P.iron, { rz: Math.PI / 2, c: true });
  k.sphere('gold', 0.24, -0.12, 0.47, 0.66, P.gold, { sy: 0.42, w: 7, hs: 4, tl: Math.PI / 2 });
  for (const [nx, nz, s] of [[-0.2, 0.62, 0.08], [-0.03, 0.7, 0.07], [-0.12, 0.6, 0.06]])
    k.rock('gold', s, nx, 0.58, nz, P.gold, 13, { jit: 0.05 });
  // ore heap + lantern post (hi detail)
  k.sphere('matte', 0.3, 0.6, 0.1, 0.42, P.rockDk, { sy: 0.5, w: 7, hs: 4, tl: Math.PI / 2, hi: true });
  for (const [nx, nz] of [[0.52, 0.5], [0.7, 0.38], [0.62, 0.3]]) k.rock('gold', 0.06, nx, 0.24, nz, P.gold, 17, { hi: true });
  k.box('matte', 0.07, 0.95, 0.07, 0.44, 0.1, 0.86, P.timberDk);
  k.box('matte', 0.24, 0.05, 0.05, 0.36, 1.0, 0.86, P.timberDk);
  k.box('glow', 0.1, 0.14, 0.1, 0.27, 0.82, 0.86, P.window);
  return { pennants: [[-0.12, 1.12, -0.42], [0.74, 0.56, -0.62], [-0.86, 0.42, 0.18]] };
}

function buildWarehouse(k, ctx) {
  plinth(k, ctx, P.cobble);
  const zc = -0.24, hd = 0.68, fz = zc + hd;                                         // front wall z
  k.box('matte', 4.1, 0.34, 1.5, 0, 0.1, zc, P.stoneDk, { jit: 0.1 });               // stone footing
  k.box('matte', 4.0, 1.24, hd * 2, 0, 0.44, zc, P.plaster, { jit: 0.04 });          // walls
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    k.box('matte', 0.18, 1.24, 0.18, sx * 1.98, 0.44, zc + sz * (hd - 0.01), P.stoneLt);   // quoins
  k.gable('matte', hd * 2 + 0.44, 0.9, 4.42, 0, 1.68, zc, P.terra, P.plaster, { ry: Math.PI / 2, jit: 0.06 });
  k.box('matte', 4.46, 0.08, 0.15, 0, 2.53, zc, P.terraDk);
  // great doors + hoist
  k.box('matte', 1.1, 1.1, 0.06, 0, 0.44, fz + 0.01, P.stoneLt);
  k.box('matte', 0.88, 1.0, 0.08, 0, 0.44, fz + 0.02, P.timber, { jit: 0.1 });
  k.box('matte', 0.04, 1.0, 0.1, 0, 0.44, fz + 0.03, P.timberDk);
  k.box('matte', 0.13, 0.13, 0.62, 0, 1.52, fz + 0.3, P.timberDk);
  k.box('matte', 0.02, 0.42, 0.02, 0, 1.1, fz + 0.52, P.rope, { hi: true });
  crate(k, 0, 0.84, fz + 0.52, 0.27, { hi: true });
  // windows
  for (const wx of [-1.6, -1.0, 1.0, 1.6]) windowZ(k, wx, 0.92, fz + 0.01, 0.3, 0.38, { lit: wx === -1.0 });
  for (const sx of [-1, 1]) windowX(k, sx * 2.0, 0.92, zc, 0.3, 0.38, sx);
  // cargo on the quay apron
  crate(k, -1.86, 0.1, 0.74, 0.42, { hi: true }); crate(k, -1.38, 0.1, 0.8, 0.36, { hi: true });
  crate(k, -1.7, 0.48, 0.76, 0.32, { hi: true });
  barrel(k, 1.5, 0.1, 0.78, 0.19, 0.48, P.timber, { hi: true });
  barrel(k, 1.9, 0.1, 0.72, 0.19, 0.48, P.timber, { hi: true });
  barrel(k, 1.7, 0.58, 0.75, 0.17, 0.42, P.timberDk, { hi: true });
  return { pennants: [[-2.12, 2.57, zc], [2.12, 2.57, zc], [0, 2.57, zc]] };
}

function buildResearchLab(k, ctx) {
  plinth(k, ctx, 0x9A9284);
  const bx = -0.85, zc = -0.24, hd = 0.72, fz = zc + hd;
  k.box('matte', 2.66, 0.26, hd * 2 + 0.06, bx, 0.1, zc, P.stoneDk);
  k.box('matte', 2.6, 1.5, hd * 2, bx, 0.36, zc, P.stone, { jit: 0.05 });
  k.box('matte', 2.7, 0.1, hd * 2 + 0.1, bx, 1.8, zc, P.stoneLt);                    // cornice
  k.hip('matte', 2.92, 0.8, hd * 2 + 0.3, 0.32, bx, 1.9, zc, P.terra, { jit: 0.06 });
  k.box('matte', 0.3, 0.62, 0.3, bx - 0.95, 2.1, zc - 0.35, P.stoneDk);               // chimney
  k.box('matte', 0.36, 0.06, 0.36, bx - 0.95, 2.72, zc - 0.35, P.stoneLt);
  // door + lamplit windows (scholars at work)
  k.box('matte', 0.62, 1.04, 0.06, bx, 0.36, fz + 0.01, P.stoneLt);
  k.box('matte', 0.46, 0.92, 0.08, bx, 0.36, fz + 0.02, P.timberDk);
  k.box('matte', 0.8, 0.06, 0.3, bx, 1.4, fz + 0.14, P.stoneLt);                       // door hood
  for (const wx of [-0.82, 0.82]) windowZ(k, bx + wx, 0.78, fz + 0.01, 0.3, 0.62, { lit: true, shutters: false, frame: P.stoneLt });
  windowX(k, bx - 1.3, 0.78, zc, 0.3, 0.62, -1, { lit: true, frame: P.stoneLt });
  // observatory drum
  const tx = 1.3;
  k.cyl('matte', 0.84, 0.9, 0.26, 12, tx, 0.1, zc, P.stoneDk);
  k.cyl('matte', 0.82, 0.86, 1.6, 12, tx, 0.36, zc, [P.stone, P.stoneLt, P.stoneLt], { jit: 0.05 });
  k.cyl('matte', 0.95, 0.95, 0.12, 12, tx, 1.96, zc, P.stoneLt);
  windowZ(k, tx, 0.95, zc + 0.84, 0.22, 0.42, { lit: true, shutters: false, frame: P.stoneLt });
  // armillary sphere on a pedestal + chart crates (hi)
  const ax = -2.0, az = 0.76;
  k.box('matte', 0.26, 0.5, 0.26, ax, 0.1, az, P.stoneLt, { hi: true });
  k.torus('gold', 0.21, 0.1, ax, 0.84, az, P.brass, { hi: true, ts: 14 });
  k.torus('gold', 0.21, 0.1, ax, 0.84, az, P.brass, { ry: Math.PI / 2, rz: 0.4, hi: true, ts: 14 });
  k.sphere('matte', 0.08, ax, 0.84, az, P.copper, { hi: true });
  crate(k, 0.25, 0.1, 0.78, 0.34, { hi: true });
  return {
    dyn: [{
      name: 'dome', pos: [tx, 2.08, zc], anim: 'spinY', speed: 0.12,
      build(d) {
        d.sphere('matte', 0.88, 0, 0, 0, P.copper, { tl: Math.PI / 2, w: 12, hs: 4, jit: 0.05 });
        d.box('matte', 0.26, 0.7, 0.36, 0, 0.3, 0.6, P.iron, { c: true, rx: -0.75 });
        d.cyl('gold', 0.075, 0.11, 1.15, 8, 0, 0.6, 0.62, P.brass, { rx: Math.PI / 2 - 0.62, c: true, smooth: true });
        d.sphere('gold', 0.07, 0, 0.9, 0, P.brass, { w: 6, hs: 4 });
      },
    }],
    pennants: [[bx - 0.75, 2.7, zc], [bx + 0.75, 2.7, zc], [tx, 2.08, zc - 0.9]],
  };
}

function buildBarracks(k, ctx) {
  plinth(k, ctx, P.cobble);
  const zb = -1.25;
  k.box('matte', 4.16, 0.3, 1.6, 0, 0.1, zb, P.stoneDk);
  k.box('matte', 4.1, 1.38, 1.55, 0, 0.4, zb, P.ochre, { jit: 0.04 });
  k.box('matte', 4.22, 0.12, 1.66, 0, 1.06, zb, P.white);                             // string course
  k.box('matte', 4.22, 0.12, 1.66, 0, 1.76, zb, P.white);                             // cornice
  k.hip('matte', 4.45, 0.95, 1.98, 0.45, 0, 1.88, zb, P.terra, { jit: 0.06 });
  for (const sx of [-1, 1]) k.box('matte', 0.3, 0.5, 0.3, sx * 1.45, 2.3, zb - 0.3, P.ochreDk);  // chimneys
  // arcade (veranda) along the front
  k.box('matte', 4.1, 0.08, 0.6, 0, 0.1, -0.2, P.stoneLt);
  for (let i = 0; i < 6; i++) k.box('matte', 0.14, 0.92, 0.14, -1.9 + i * 0.76, 0.18, 0.02, P.white);
  k.box('matte', 4.3, 0.07, 0.78, 0, 1.06, -0.18, P.terra, { rx: 0.3 });
  for (let i = 0; i < 5; i++) windowZ(k, -1.52 + i * 0.76, 1.24, zb + 0.78, 0.26, 0.38, { shutterCol: P.shutterB });
  k.box('matte', 0.5, 0.86, 0.06, 0, 0.4, zb + 0.78, P.timberDk);
  for (const wx of [-1.14, 1.14]) windowZ(k, wx, 0.55, zb + 0.78, 0.28, 0.36, { shutterCol: P.shutterB, lit: wx < 0 });
  // parade ground, side walls, flagpole
  k.box('matte', 4.1, 0.04, 1.62, 0, 0.1, 1.06, faces(0xCDB78A, 0xD3BD90), { jit: 0.03 });
  for (const sx of [-1, 1]) {
    k.box('matte', 0.2, 0.42, 1.55, sx * 2.1, 0.1, 1.08, faces(P.stone, P.stoneLt), { jit: 0.1 });
  }
  k.box('matte', 0.32, 0.2, 0.32, 1.62, 0.1, 1.6, P.stoneLt);
  k.cyl('gloss', 0.04, 0.05, 2.95, 6, 1.62, 0.3, 1.6, P.white);
  k.sphere('gold', 0.07, 1.62, 3.28, 1.6, P.brass, { w: 6, hs: 4 });
  // drill props (hi): shot pile, field gun, sentry box
  shotPile(k, -1.5, 0.14, 1.42, 0.1, { hi: true });
  cannon(k, -0.55, 0.14, 1.15, 0.9, 0.09, { hi: true, ry: 0.25 });
  k.box('matte', 0.42, 0.72, 0.42, 1.55, 0.14, 0.42, P.white, { hi: true });
  k.cone('matte', 0.36, 0.3, 4, 1.55, 0.86, 0.42, P.terra, { ry: Math.PI / 4, hi: true });
  return {
    dyn: [{
      name: 'flag', pos: [1.62, 3.12, 1.6], anim: 'sway', speed: 1.6, amp: 0.28, team: true,
      build(f) { f.box('team', 0.92, 0.56, 0.025, 0.48, -0.56, 0, 0xffffff, { jit: 0.02 }); },
    }],
    pennants: [[-1.3, 2.83, zb], [1.3, 2.83, zb], [0, 2.83, zb]],
  };
}

function buildShipyard(k, ctx) {
  plinth(k, ctx, P.earth);
  const tilt = 0.075;
  k.box('matte', 1.8, 0.16, 4.5, 0, 0.27, 0.0, faces(P.plank, shade(P.plank, 1.08)), { c: true, rx: tilt, jit: 0.1 });
  for (const sx of [-1, 1]) k.box('matte', 0.14, 0.12, 4.45, sx * 0.52, 0.39, 0.0, P.timberDk, { c: true, rx: tilt });
  // cradles + keel blocks under the hull
  for (let i = 0; i < 5; i++) {
    const z = -1.3 + i * 0.68;
    k.box('matte', 0.9, 0.22, 0.18, 0, 0.42 - (z + 2.25) * tilt * 0.9 - 0.02, z, P.timberDk);
  }
  // ship skeleton (bow toward +Z / the water)
  const keelY = 0.58;
  k.box('matte', 0.13, 0.13, 3.5, 0, keelY - 0.13, 0.12, P.timberDk);
  const half = z => 0.66 * Math.max(0.28, 1 - Math.pow((z - 0.05) / 1.85, 2) * 0.75);
  const ribs = [];
  for (let i = 0; i < 7; i++) {
    const z = -1.35 + i * 0.5, R = half(z);
    ribs.push([z, R]);
    k.torus('matte', R, 0.07, 0, keelY + R, z, P.plank, { rz: Math.PI, arc: Math.PI, ts: 9, rs: 4, jit: 0.1 });
  }
  for (let i = 0; i < ribs.length - 1; i++) {
    const [za, Ra] = ribs[i], [zb2, Rb] = ribs[i + 1];
    for (const sx of [-1, 1]) {
      k.strut('matte', sx * Ra, keelY + Ra, za, sx * Rb, keelY + Rb, zb2, 0.06, P.timber);
      k.strut('matte', sx * Ra * 0.72, keelY + Ra * 0.3, za, sx * Rb * 0.72, keelY + Rb * 0.3, zb2, 0.05, P.plankLt, { hi: true });
    }
  }
  k.strut('matte', 0, keelY - 0.06, 1.85, 0, keelY + 1.0, 2.25, 0.11, P.timberDk);    // stem
  k.strut('matte', 0, keelY - 0.06, -1.6, 0, keelY + 0.92, -1.72, 0.11, P.timberDk); // sternpost
  // portal crane over the hull, hoisting a plank
  for (const sx of [-1, 1]) {
    k.box('matte', 0.16, 2.6, 0.16, sx * 1.22, 0.1, -0.25, P.timberDk);
    k.strut('matte', sx * 1.22, 0.1, -0.95, sx * 1.22, 1.6, -0.25, 0.08, P.timber);
  }
  k.box('matte', 2.66, 0.16, 0.18, 0, 2.62, -0.25, P.timberDk);
  k.box('matte', 0.02, 0.62, 0.02, 0.3, 2.0, -0.25, P.rope);
  k.box('gloss', 0.1, 0.12, 0.1, 0.3, 1.9, -0.25, P.iron);
  k.box('matte', 1.0, 0.07, 0.14, 0.3, 1.82, -0.25, P.plankLt, { ry: 0.3 });
  // tool shed with timber stack (back-left)
  for (const [px, pz] of [[-2.05, -2.05], [-1.0, -2.05], [-2.05, -1.05], [-1.0, -1.05]])
    k.box('matte', 0.1, pz < -1.5 ? 1.3 : 1.05, 0.1, px, 0.1, pz, P.timberDk);
  k.box('matte', 1.36, 0.07, 1.36, -1.52, 1.25, -1.55, P.terra, { rx: 0.22 });
  for (let i = 0; i < 4; i++) k.box('matte', 0.95, 0.07, 0.24, -1.52, 0.1 + i * 0.075, -1.55 + (i % 2) * 0.05, P.plankLt, { hi: true });
  for (const [lx, row] of [[-1.85, 0], [-1.62, 0], [-1.74, 1]])
    k.cyl('matte', 0.11, 0.11, 0.85, 7, lx, 0.21 + row * 0.19, -0.55, [P.bark, P.wood, P.wood], { rx: Math.PI / 2, c: true, hi: true });
  // anchor, tar barrels, bollards at the water edge
  anchorProp(k, 1.85, 0.1, -1.05, 1.0, -0.4, { hi: true });
  barrel(k, 1.7, 0.1, -1.9, 0.19, 0.48, 0x3A2E26, { hi: true });
  barrel(k, 2.0, 0.1, -1.62, 0.19, 0.48, 0x3A2E26, { hi: true });
  for (const sx of [-1, 1]) k.cyl('gloss', 0.1, 0.12, 0.34, 7, sx * 1.7, 0.1, 2.0, P.iron, [P.iron, P.ironLt, P.iron]);
  return { orient: 'outward', pennants: [[-1.22, 2.7, -0.25], [1.22, 2.7, -0.25], [-1.52, 1.4, -1.0]] };
}

function buildLighthouse(k, ctx) {
  // Masonry beacon tower: coral-stone shaft, arched fire stage, tiled cupola
  k.cyl('matte', 1.0, 1.06, 0.93, 8, 0, -0.75, 0, [P.stone, P.stoneLt, P.stone], { ry: Math.PI / 8, jit: 0.1 });
  // keeper's cottage at the back
  k.box('matte', 0.92, 0.6, 0.6, 0.32, 0.18, -0.62, P.plaster, { jit: 0.04 });
  k.gable('matte', 0.78, 0.36, 1.02, 0.32, 0.78, -0.62, P.terra, P.plaster, { ry: Math.PI / 2 });
  k.box('matte', 0.22, 0.42, 0.04, 0.62, 0.18, -0.31, P.timber);
  // octagonal shaft with string courses and slit windows
  const o8 = { ry: Math.PI / 8 };
  k.cyl('matte', 0.66, 0.7, 0.3, 8, 0, 0.18, 0, P.stoneDk, o8);
  k.cyl('matte', 0.47, 0.64, 3.1, 8, 0, 0.48, 0, [P.stone, P.stoneLt, P.stone], { ...o8, jit: 0.05 });
  for (const [cy, cr] of [[1.55, 0.6], [2.6, 0.54]]) k.cyl('matte', cr, cr, 0.08, 8, 0, cy, 0, P.stoneLt, o8);
  for (const [wy, wr] of [[1.05, 0.6], [2.1, 0.55], [3.0, 0.5]]) k.box('matte', 0.1, 0.26, 0.05, 0, wy, wr, P.black, { jit: 0 });
  // gallery, fire stage on four arched piers, pyramid cupola
  const gy = 3.58;
  k.cyl('matte', 0.72, 0.6, 0.16, 8, 0, gy, 0, P.stoneLt, o8);
  k.cyl('matte', 0.66, 0.66, 0.24, 8, 0, gy + 0.16, 0, [P.stone, P.stoneDk, P.stone], o8);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    k.box('matte', 0.15, 0.68, 0.15, sx * 0.34, gy + 0.4, sz * 0.34, P.stone);
  k.box('matte', 0.86, 0.12, 0.86, 0, gy + 1.08, 0, P.stoneLt);
  k.cyl('gloss', 0.22, 0.17, 0.16, 8, 0, gy + 0.4, 0, P.iron);                         // brazier
  k.cone('lamp', 0.2, 0.42, 7, 0, gy + 0.54, 0, P.fire);
  k.cyl('lamp', 0.12, 0.17, 0.12, 7, 0, gy + 0.5, 0, P.lamp);
  k.cone('matte', 0.62, 0.52, 4, 0, gy + 1.2, 0, P.terra, { ry: Math.PI / 4, jit: 0.06 });
  k.sphere('gold', 0.07, 0, gy + 1.76, 0, P.brass, { w: 6, hs: 4 });
  k.box('gloss', 0.02, 0.26, 0.02, 0, gy + 1.78, 0, P.iron);
  k.box('gloss', 0.24, 0.05, 0.02, 0.05, gy + 1.96, 0, P.iron);
  return {
    fx: { halo: [0, gy + 0.72, 0, 2.4] },
    pennants: [[0.5, gy + 0.4, -0.3], [0.32, 1.14, -1.04], [-0.5, gy + 0.4, -0.3]],
  };
}

function buildFortressWall(k, ctx) {
  // Battered curtain wall: escarp, cordon, gun parapet, gate, corner garitas
  plinth(k, ctx, P.stoneDk);
  const rect = (hx, hz) => [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]];
  k.poly('matte', rect(2.95, 0.78), 0.92, 1.32, 0, 0.1, 0, [P.stone, P.stoneDk], { jit: 0.08 });
  k.box('matte', 5.5, 0.1, 1.5, 0, 1.36, 0, P.stoneLt);                               // cordon
  for (const [x0, x1] of [[-2.62, -1.38], [-0.82, 0.82], [1.38, 2.62]])               // front parapet
    k.box('matte', x1 - x0, 0.42, 0.32, (x0 + x1) / 2, 1.42, 0.52, faces(P.stone, P.stoneLt), { jit: 0.08 });
  k.box('matte', 5.24, 0.3, 0.26, 0, 1.42, -0.55, faces(P.stone, P.stoneLt), { jit: 0.08 });
  for (const sx of [-1, 1]) garita(k, sx * 2.62, 1.46, 0.6, 0.95);
  // gate with stone surround and the arms of the holder (team banner)
  k.box('matte', 1.24, 1.2, 0.12, 0, 0.1, 0.72, P.stoneLt);
  k.box('matte', 0.86, 0.95, 0.14, 0, 0.1, 0.74, P.black, { jit: 0 });
  k.box('matte', 0.72, 0.86, 0.06, 0, 0.1, 0.82, P.timber, { jit: 0.1 });
  for (const x of [-1.95, 1.95]) k.box('matte', 0.08, 0.32, 0.05, x, 0.62, 0.66, P.black, { jit: 0 });
  cannon(k, -1.1, 1.42, 0.12, 0.85, 0.08, { hi: true });
  cannon(k, 1.1, 1.42, 0.12, 0.85, 0.08, { hi: true });
  return {
    dyn: [{
      name: 'banner', pos: [0, 1.32, 0.84], anim: null,
      build(b) {
        b.box('team', 0.5, 0.6, 0.03, 0, -0.6, 0, 0xffffff, { jit: 0.02 });
        b.box('gold', 0.58, 0.05, 0.05, 0, 0, 0, P.brass);
      },
    }],
    pennants: [[-2.62, 2.5, 0.6], [2.62, 2.5, 0.6], [0, 1.84, 0.52]],
  };
}

// ── Defenses ───────────────────────────────────────────────────────────────
function buildWatchtower(k, ctx) {
  plinth(k, ctx, P.stoneDk);
  k.cyl('matte', 0.76, 0.95, 1.05, 4, 0, 0.1, 0, [P.stone, P.stoneLt, P.stone], { ry: Math.PI / 4, jit: 0.1 });
  k.box('matte', 0.3, 0.42, 0.05, 0, 0.1, 0.62, P.timberDk);                          // door
  const c = 0.42;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    k.strut('matte', sx * c, 1.1, sz * c, sx * 0.4, 3.12, sz * 0.4, 0.11, P.timberDk);
  }
  for (const [ax, az, bx, bz] of [[-c, c, c, c], [c, -c, c, c], [-c, -c, -c, c]]) {
    k.strut('matte', ax, 1.18, az, bx * 0.92, 2.36, bz * 0.92, 0.06, P.timber, { hi: ax !== -c || az !== c });
    k.strut('matte', bx, 1.18, bz, ax * 0.92, 2.36, az * 0.92, 0.06, P.timber, { hi: ax !== -c || az !== c });
  }
  k.box('matte', 1.25, 0.12, 1.25, 0, 2.4, 0, faces(P.plank, P.plankLt));
  for (const [sx, sz, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1]])
    k.box('matte', rot ? 0.05 : 1.2, 0.06, rot ? 1.2 : 0.05, sx * 0.6, 2.78, sz * 0.6, P.timber);
  k.cone('matte', 0.98, 0.78, 4, 0, 3.1, 0, P.thatch, { ry: Math.PI / 4, jit: 0.1 });
  k.box('glow', 0.1, 0.14, 0.1, 0.46, 2.88, 0.46, P.window);
  k.cyl('gloss', 0.025, 0.025, 0.55, 5, 0, 3.8, 0, P.iron);
  return {
    dyn: [{
      name: 'gun', pos: [0, 2.52, 0], turret: true,
      build(g) {
        g.box('matte', 0.08, 0.32, 0.08, 0, 0, 0.36, P.iron);
        g.cyl('gloss', 0.055, 0.08, 0.66, 8, 0, 0.36, 0.48, P.iron, { rx: Math.PI / 2 - 0.08, c: true, smooth: true });
      },
    }, {
      name: 'vane', pos: [0, 4.34, 0], anim: 'sway', speed: 1.4, amp: 0.3, team: true,
      build(f) { f.add('team', pPennant(), xf(0, 0.01, 0, 0, 0, 0, 1.1, 1.1, 1.1), 0xffffff); },
    }],
    pennants: [[0.62, 2.82, 0.62], [-0.62, 2.82, 0.62], [0.62, 2.82, -0.62]],
  };
}

function buildBunker(k, ctx) {
  // Star-fort bastion (pentagonal, salient toward the facing) with guns on its faces
  plinth(k, ctx, P.earth);
  const pts = [[0, 2.02], [1.72, 0.36], [1.22, -1.72], [-1.22, -1.72], [-1.72, 0.36]];
  return {
    dyn: [{
      name: 'bastion', pos: [0, 0, 0], turret: true,
      build(b) {
        b.poly('matte', pts, 0.9, 1.0, 0, 0.1, 0, [P.stone, 0x9C8B6E], { jit: 0.08 });
        b.poly('matte', pts.map(([x, z]) => [x * 0.93, z * 0.93]), 1, 0.09, 0, 1.06, 0, [P.stoneLt, P.stoneLt]);
        const faceSegs = (ax, az, bx, bz) => {
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx);
          const nx = -dz / L, nz = dx / L;                                // outward normal
          for (const [t0, t1] of [[0.08, 0.38], [0.56, 0.92]]) {
            const m = (t0 + t1) / 2;
            b.box('matte', L * (t1 - t0), 0.36, 0.26, ax + dx * m - nx * 0.12, 1.1, az + dz * m - nz * 0.12,
              faces(P.stone, P.stoneLt), { ry, jit: 0.08 });
          }
          cannon(b, ax + dx * 0.47 - nx * 0.42, 1.12, az + dz * 0.47 - nz * 0.42, 0.85, 0.085, { ry: Math.atan2(nx, nz) });
        };
        const s = 0.9;
        faceSegs(pts[0][0] * s, pts[0][1] * s, pts[1][0] * s, pts[1][1] * s);
        faceSegs(pts[4][0] * s, pts[4][1] * s, pts[0][0] * s, pts[0][1] * s);
        garita(b, 0, 1.12, 1.86, 0.9);
        shotPile(b, -0.45, 1.15, -0.95, 0.09, { hi: true });
        barrel(b, 0.5, 1.15, -1.0, 0.15, 0.38, P.timberDk, { hi: true });
        b.box('matte', 0.7, 0.5, 0.06, 0, 0.1, -1.56, P.timberDk);                    // gorge door
      },
    }, {
      name: 'flag', pos: [0.75, 2.75, -0.95], anim: 'sway', speed: 1.5, amp: 0.3, team: true,
      build(f) {
        f.cyl('gloss', 0.03, 0.035, 1.62, 5, 0, -1.6, 0, P.iron);
        f.box('team', 0.62, 0.38, 0.02, 0.33, -0.38, 0, 0xffffff, { jit: 0.02 });
      },
    }],
    pennants: [[-1.05, 1.15, -1.45], [1.05, 1.15, -1.45], [0, 1.15, -1.6]],
  };
}

function buildMortarPlatform(k, ctx) {
  plinth(k, ctx, P.stoneDk);
  k.cyl('matte', 2.02, 2.12, 0.42, 12, 0, 0.1, 0, [P.stone, P.stoneDk, P.stone], { jit: 0.1 });
  k.cyl('matte', 1.78, 1.78, 0.04, 12, 0, 0.52, 0, [P.plank, P.plankLt, P.plank], { jit: 0.1 });
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    k.box('matte', 0.6, 0.38, 0.3, Math.sin(a) * 1.9, 0.52, Math.cos(a) * 1.9, P.stone, { ry: a, jit: 0.1 });
  }
  shotPile(k, -1.05, 0.56, -0.85, 0.13, { hi: true });
  barrel(k, 1.1, 0.56, -0.78, 0.17, 0.42, P.timberDk, { hi: true });
  barrel(k, 1.35, 0.56, -0.45, 0.17, 0.42, P.timberDk, { hi: true });
  return {
    dyn: [{
      name: 'mortar', pos: [0, 0.56, 0], turret: true,
      build(m) {
        m.box('matte', 0.95, 0.32, 0.95, 0, 0, 0, P.timberDk);
        for (const sx of [-1, 1]) m.box('gloss', 0.1, 0.36, 0.42, sx * 0.4, 0.3, 0, P.iron);
        const el = Math.PI / 4;
        m.sphere('gloss', 0.42, 0, 0.62, -0.06, P.iron, { w: 10, hs: 6, smooth: true });
        m.cyl('gloss', 0.37, 0.44, 0.78, 10, 0, 0.62 + Math.sin(el) * 0.35, Math.cos(el) * 0.35 - 0.06, P.iron,
          { rx: Math.PI / 2 - el, c: true, smooth: true });
        m.torus('gloss', 0.38, 0.16, 0, 0.62 + Math.sin(el) * 0.74, Math.cos(el) * 0.74 - 0.06, P.ironLt,
          { rx: -el, ts: 12, smooth: true });
        m.cyl('matte', 0.28, 0.28, 0.03, 10, 0, 0.62 + Math.sin(el) * 0.76, Math.cos(el) * 0.76 - 0.06, P.black,
          { rx: Math.PI / 2 - el, c: true });
      },
    }],
    pennants: [[-1.35, 0.9, -1.35], [1.35, 0.9, -1.35], [0, 0.9, -1.9]],
  };
}

function buildCulverinBattery(k, ctx) {
  plinth(k, ctx, P.stoneDk);
  k.box('matte', 4.4, 0.3, 1.98, 0, 0.1, 0, P.stoneDk, { jit: 0.1 });
  k.box('matte', 4.1, 0.05, 1.7, 0, 0.4, 0, faces(P.plank, P.plankLt), { jit: 0.1 });
  for (const [w, d, x, z] of [[4.4, 0.28, 0, 0.86], [4.4, 0.28, 0, -0.86], [0.28, 1.44, -2.06, 0], [0.28, 1.44, 2.06, 0]])
    k.box('matte', w, 0.3, d, x, 0.4, z, faces(P.stone, P.stoneLt), { jit: 0.1 });
  for (const [gx, gz] of [[-2.0, 0.85], [2.0, 0.85], [-2.0, -0.85], [2.0, -0.85]])
    k.cyl('matte', 0.24, 0.24, 0.5, 8, gx, 0.4, gz, [0x8B6B3E, 0x6B5A3A, 0x6B5A3A], { hi: true, jit: 0.12 });
  shotPile(k, 0, 0.45, -0.45, 0.09, { hi: true });
  barrel(k, -0.45, 0.45, -0.5, 0.15, 0.38, P.timberDk, { hi: true });
  const gun = (name, x) => ({
    name, pos: [x, 0.45, 0], turret: true,
    build(g) {
      g.box('matte', 0.4, 0.24, 0.78, 0, 0, -0.05, P.timberDk);
      for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        g.cyl('matte', 0.14, 0.14, 0.07, 8, wx * 0.24, 0.14, wz * 0.24 - 0.05, P.timber, { rz: Math.PI / 2, c: true });
      g.cyl('gloss', 0.065, 0.11, 1.6, 8, 0, 0.36, 0.3, P.iron, { rx: Math.PI / 2 - 0.05, c: true, smooth: true });
      g.cyl('gloss', 0.085, 0.085, 0.08, 8, 0, 0.4, 1.08, P.ironLt, { rx: Math.PI / 2 - 0.05, c: true });
      g.sphere('gloss', 0.07, 0, 0.32, -0.52, P.iron, { w: 6, hs: 4 });
    },
  });
  return { dyn: [gun('gunL', -1.05), gun('gunR', 1.05)], pennants: [[-2.06, 0.72, -0.86], [2.06, 0.72, -0.86], [0, 0.72, -0.86]] };
}

function buildDeadmansLure(k, ctx) {
  plinth(k, ctx, 0x5E5650);
  k.rock('matte', 0.42, -0.62, 0.22, 0.45, P.rockDk, 21, { sy: 0.7, jit: 0.1 });
  k.rock('matte', 0.3, 0.72, 0.16, -0.55, P.rockDk, 23, { sy: 0.8, jit: 0.1 });
  // gibbet post + arm + brace
  k.strut('matte', -0.3, 0.1, -0.2, -0.3, 2.42, -0.2, 0.15, P.lure);
  k.box('matte', 1.05, 0.11, 0.11, 0.15, 2.18, -0.2, P.lure);
  k.strut('matte', -0.28, 1.65, -0.2, 0.18, 2.2, -0.2, 0.07, P.lureDk);
  k.box('gloss', 0.02, 0.26, 0.02, 0.56, 1.92, -0.2, P.iron);                          // chain
  // skull on the post
  k.sphere('matte', 0.15, -0.3, 2.6, -0.2, P.bone, { w: 7, hs: 5, sy: 0.95 });
  k.box('matte', 0.17, 0.08, 0.12, -0.3, 2.43, -0.16, P.bone);
  for (const sx of [-1, 1]) k.box('matte', 0.05, 0.05, 0.03, -0.3 + sx * 0.055, 2.6, -0.06, P.black, { jit: 0 });
  // crossbones sign (hi)
  k.box('matte', 0.42, 0.3, 0.04, -0.3, 1.2, -0.11, P.lureDk, { hi: true });
  k.box('matte', 0.4, 0.04, 0.02, -0.3, 1.35, -0.09, P.bone, { c: true, rz: 0.6, hi: true });
  k.box('matte', 0.4, 0.04, 0.02, -0.3, 1.35, -0.09, P.bone, { c: true, rz: -0.6, hi: true });
  // powder kegs with fuse
  barrel(k, 0.35, 0.1, 0.4, 0.17, 0.4, 0x4E3A2A);
  barrel(k, 0.7, 0.1, 0.12, 0.17, 0.4, 0x4E3A2A);
  barrel(k, 0.5, 0.5, 0.28, 0.16, 0.38, 0x4E3A2A, { hi: true });
  k.strut('matte', 0.35, 0.5, 0.4, -0.25, 0.12, 0.25, 0.02, P.black);
  return {
    // the lantern glass is children[0] — CombatSystem flashes its material colour
    dyn: [{
      name: 'lantern', pos: [0.56, 1.8, -0.2], anim: 'sway', axis: 'z', speed: 1.1, amp: 0.12, first: true, ownMaterial: true,
      build(l) { l.cyl('lamp', 0.11, 0.11, 0.2, 6, 0, -0.32, 0, 0xffffff); },
    }, {
      name: 'lanternCage', pos: [0.56, 1.8, -0.2], anim: 'sway', axis: 'z', speed: 1.1, amp: 0.12,
      build(l) {
        l.cone('gloss', 0.15, 0.12, 6, 0, -0.12, 0, P.iron);
        l.cyl('gloss', 0.14, 0.14, 0.04, 6, 0, -0.38, 0, P.iron);
        for (let i = 0; i < 4; i++) {
          const a = i / 4 * TAU + 0.4;
          l.box('gloss', 0.025, 0.24, 0.025, Math.sin(a) * 0.12, -0.36, Math.cos(a) * 0.12, P.iron);
        }
      },
    }],
    pennants: [[-0.62, 0.55, 0.45], [0.72, 0.4, -0.55], [-0.85, 0.12, -0.75]],
  };
}

function buildGeneric(k, ctx) {
  plinth(k, ctx, P.cobble);
  const w = Math.max(1.2, ctx.W - 0.7), d = Math.max(1.2, ctx.D - 0.7);
  k.box('matte', w, 1.15, d, 0, 0.1, 0, P.plaster, { jit: 0.04 });
  const along = w >= d;
  k.gable('matte', (along ? d : w) + 0.25, 0.8, (along ? w : d) + 0.25, 0, 1.25, 0, P.terra, P.plaster,
    { ry: along ? Math.PI / 2 : 0 });
  k.box('matte', 0.4, 0.66, 0.05, 0, 0.1, d / 2 + 0.01, P.timber);
  windowZ(k, -w / 2 + 0.38, 0.62, d / 2 + 0.01, 0.26, 0.3, { lit: true });
  windowZ(k, w / 2 - 0.38, 0.62, d / 2 + 0.01, 0.26, 0.3, {});
  return { pennants: [[0, 1.25 + 0.8, 0]] };
}

const BUILDERS = {
  lumber_mill: buildLumberMill, gold_mine: buildGoldMine, warehouse: buildWarehouse,
  research_lab: buildResearchLab, barracks: buildBarracks, shipyard: buildShipyard,
  lighthouse: buildLighthouse, fortress_wall: buildFortressWall,
  watchtower: buildWatchtower, bunker: buildBunker, mortar_platform: buildMortarPlatform,
  culverin_battery: buildCulverinBattery, deadmans_lure: buildDeadmansLure,
};
/** Ids that have a bespoke model (anything else gets the generic house). */
export const MODELLED_BUILDING_IDS = Object.freeze(Object.keys(BUILDERS));

// ── Entries: per (id, footprint) baked geometry, lazily per tier ───────────
const _entries = new Map();
function entryFor(def) {
  const id = def && BUILDERS[def.id] ? def.id : '_generic';
  const fp = (def && def.footprint) || { w: 1, h: 1 };
  const key = `${id}|${fp.w}x${fp.h}`;
  let e = _entries.get(key);
  if (!e) {
    const ctx = { W: fp.w * CELL, D: fp.h * CELL, w: fp.w, h: fp.h };
    const kit = new ModelKit();
    const spec = (BUILDERS[id] || buildGeneric)(kit, ctx) || {};
    e = { key, id, fp, ctx, kit, spec, geos: {}, dyn: null, pennants: new Map(), edges: null, stilts: new Map() };
    _entries.set(key, e);
  }
  return e;
}
function geosFor(e, tier) {
  if (!e.geos[tier]) e.geos[tier] = e.kit.bake(tier === 'high');
  return e.geos[tier];
}
function dynFor(e) {
  if (!e.dyn) {
    e.dyn = (e.spec.dyn || []).map(d => {
      const kit = new ModelKit(); kit.aoOffset = d.pos[1]; d.build(kit);
      return { ...d, geos: kit.bake(true) };
    });
  }
  return e.dyn;
}
function pennantGeo(e, count) {
  const anchors = (e.spec.pennants || []).slice(0, count);
  const key = anchors.length;
  if (!key) return null;
  if (!e.pennants.has(key)) {
    const kit = new ModelKit();
    for (const [x, y, z] of anchors) {
      kit.cyl('team', 0.022, 0.026, 0.5, 5, x, y, z, 0x3a3a3a, { ao: false });
      kit.add('team', pPennant(), xf(x + 0.02, y + 0.49, z, 0, 0, 0, 0.72, 0.72, 1), 0xffffff, { ao: false, jit: 0.02 });
    }
    e.pennants.set(key, kit.bake(true).team);
  }
  return e.pennants.get(key);
}
function stiltGeo(e, drop) {
  const q = Math.min(6, Math.round(drop * 2) / 2);
  if (!e.stilts.has(q)) {
    const kit = new ModelKit(), { W, D } = e.ctx;
    const hx = W / 2 - 0.3, hz = D / 2 - 0.3, bot = -(q + 1.4);
    const xs = W > 3 ? [-hx, 0, hx] : [-hx, hx], zs = D > 3 ? [-hz, 0, hz] : [-hz, hz];
    for (const x of xs) for (const z of zs) kit.cyl('matte', 0.12, 0.14, -0.7 - bot, 6, x, bot, z, P.timberDk, { ao: false, jit: 0.1 });
    for (const z of zs) kit.strut('matte', -hx, -0.9, z, hx, bot * 0.55, z, 0.07, P.timber, { ao: false });
    kit.box('matte', W - 0.3, 0.12, D - 0.3, 0, -0.84, 0, P.plank, { ao: false });
    e.stilts.set(q, kit.bake(true).matte);
  }
  return e.stilts.get(q);
}
function edgesFor(e) {
  if (!e.edges) {
    const g = geosFor(e, 'low').matte;
    e.edges = g ? pin(new THREE.EdgesGeometry(g, 28)) : null;
  }
  return e.edges;
}
function tierOf(level) { const l = level || 1; return l >= 7 ? 3 : l >= 4 ? 2 : 1; }
function snapQuarter(rad) { return Math.round(rad / (Math.PI / 2)) * (Math.PI / 2); }

let _plane = null;
function decalPlane() {
  if (!_plane) { _plane = new THREE.PlaneGeometry(1, 1); _plane.rotateX(-Math.PI / 2); pin(_plane); }
  return _plane;
}

// ── Public factory ─────────────────────────────────────────────────────────
/**
 * Build a placed-building model.
 *
 * @param {object} def   building/defense definition (data/buildings.js, data/defenses.js);
 *                       unknown ids get a generic house sized to def.footprint
 * @param {object} [opts]
 * @param {boolean} [opts.rotated]    rotated with R (w↔h for oblong footprints) — model yaws π/2
 * @param {number}  [opts.level=1]    1–10 → 1/2/3 team pennants (tiers 1–3, 4–6, 7–10)
 * @param {number}  [opts.facingDeg]  defense facing (0 = +Z, as BuildSystem._computeFacing); turrets aim there
 * @param {'player'|'enemy'|'neutral'} [opts.team='player'] flag / pennant colour
 * @param {number}  [opts.outwardDeg] island-centre → building bearing (deg, 0 = +Z); the shipyard's
 *                                    slipway yaws toward it; also the default turret facing
 * @param {number}  [opts.drop=0]     how far the terrain lies below the deck here → timber stilts
 * @param {number}  [opts.fit]        uniform scale (e.g. 0.5 to squeeze a 2×2 model into one cell)
 * @param {boolean} [opts.autoAnimate=true] drive userData.update from onBeforeRender
 * @returns {THREE.Group} origin = ground centre of the footprint (y = 0 is the deck).
 *   userData: { buildingId, update(t), setLevel(level), setFacing(deg), baseYaw }
 *   Meshes are plain THREE.Mesh with shared Standard/Basic materials (userData.baseMat).
 */
export function makeBuildingMesh(def, opts = {}) {
  return assemble(def || {}, opts, null, null);
}

/**
 * Placement hologram: same silhouette (LOW tier, no props/FX/pennants), every mesh
 * drawn with `mat`, plus crease edges with `edgeMat`. Unrotated — caller yaws it.
 */
export function makeBuildingGhost(def, mat, edgeMat = null) {
  return assemble(def || {}, { autoAnimate: false }, mat, edgeMat);
}

/**
 * Yaw (radians) a placed model of `def` gets: π/2 when `rotated` (the R key —
 * any footprint), or for the shipyard (square, 'outward') the quarter turn whose
 * slipway faces open water. BuildSystem uses it so the ghost matches the result.
 * @param {object} def
 * @param {{rotated?:boolean, outwardDeg?:number}} [opts]
 */
export function modelYaw(def, opts = {}) { return yawOf(entryFor(def || {}), opts); }
function yawOf(e, opts) {
  if (e.spec.orient === 'outward' && Number.isFinite(opts.outwardDeg) && e.fp.w === e.fp.h)
    return snapQuarter(opts.outwardDeg * Math.PI / 180);
  return opts.rotated ? Math.PI / 2 : 0;
}

function assemble(def, opts, ghostMat, edgeMat) {
  const e = entryFor(def);
  const ghost = !!ghostMat;
  const team = TEAM_COLOR[opts.team] !== undefined ? opts.team : 'player';
  const grp = new THREE.Group();
  grp.name = 'building:' + (def.id || 'generic');
  grp.userData.buildingId = def.id;

  const yaw = ghost ? 0 : yawOf(e, opts);
  grp.rotation.y = yaw;
  grp.userData.baseYaw = yaw;

  const tier = ghost ? 'low' : _quality;
  const geos = geosFor(e, tier);
  const st = { tier, primary: null, statics: [], anims: [], fx: [], decal: null, pennant: null, turrets: [] };

  const addMesh = (parent, geo, mat, shadows) => {
    const m = new THREE.Mesh(geo, mat);
    m.userData.baseMat = mat;
    if (ghost) m.renderOrder = 14;
    else { m.castShadow = shadows; m.receiveShadow = shadows; }
    parent.add(m);
    return m;
  };

  // dynamic parts (lure lantern first: CombatSystem uses children[0])
  const dyn = dynFor(e);
  const makeDyn = (d) => {
    const pivot = new THREE.Group();
    pivot.position.set(d.pos[0], d.pos[1], d.pos[2]);
    const meshes = [];
    for (const kind of KINDS) {
      const g = d.geos[kind]; if (!g) continue;
      let mat = ghostMat || matFor(kind, team);
      if (!ghost && d.ownMaterial) mat = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
      const shadows = !(kind === 'glow' || kind === 'lamp');
      if (d.first && meshes.length === 0) {
        // the pivot itself must be the mesh so children[0].material is the glass
        const m = new THREE.Mesh(g, mat);
        m.userData.baseMat = mat;
        m.position.copy(pivot.position);
        if (ghost) m.renderOrder = 14;
        meshes.push(m);
        return { obj: m, meshes, d };
      }
      meshes.push(addMesh(pivot, g, mat, shadows));
    }
    return { obj: pivot, meshes, d };
  };
  const dynObjs = [];
  for (const d of dyn) if (d.first) { const o = makeDyn(d); grp.add(o.obj); dynObjs.push(o); }

  for (const kind of KINDS) {
    const g = geos[kind]; if (!g) continue;
    const m = addMesh(grp, g, ghostMat || matFor(kind, team), !(kind === 'glow' || kind === 'lamp'));
    m.userData.kind = kind;
    st.statics.push(m);
    if (!st.primary && kind === 'matte') st.primary = m;
  }
  if (!st.primary) st.primary = st.statics[0] || null;

  for (const d of dyn) if (!d.first) { const o = makeDyn(d); grp.add(o.obj); dynObjs.push(o); }

  if (ghost) {
    const eg = edgeMat && edgesFor(e);
    if (eg) { const l = new THREE.LineSegments(eg, edgeMat); l.renderOrder = 15; grp.add(l); }
    return grp;
  }

  // turret facing + idle animations
  const outward = Number.isFinite(opts.outwardDeg) ? opts.outwardDeg : 0;
  const setFacing = (deg) => {
    const rad = (Number.isFinite(deg) ? deg : outward) * Math.PI / 180 - grp.rotation.y;
    for (const o of st.turrets) o.rotation.y = rad;
  };
  for (const o of dynObjs) {
    const d = o.d;
    if (d.turret) st.turrets.push(o.obj);
    if (d.anim) st.anims.push({ obj: o.obj, d, phase: hash01(grp.id * 1.7 + d.pos[0]) * TAU });
  }
  setFacing(opts.facingDeg);

  // level pennants (team colour)
  const pg = pennantGeo(e, tierOf(opts.level));
  if (pg) { st.pennant = addMesh(grp, pg, teamMaterial(team), false); }

  // beacon fire glow (flickers)
  if (e.spec.fx?.halo) {
    const [hx, hy, hz, hs] = e.spec.fx.halo;
    const halo = new THREE.Sprite(haloMat());
    halo.position.set(hx, hy, hz); halo.scale.set(hs, hs, 1); halo.renderOrder = 3;
    grp.add(halo); st.fx.push(halo);
    st.anims.push({ obj: halo, d: { anim: 'flicker', speed: 9, amp: hs }, phase: hash01(grp.id) * TAU });
  }

  // ground contact: soft shadow on the deck (HIGH) or stilts down to the beach
  const drop = Math.max(0, opts.drop || 0);
  if (drop > 0.35) {
    addMesh(grp, stiltGeo(e, drop), kindMaterial('matte'), true);
  } else {
    const dm = new THREE.Mesh(decalPlane(), decalMat());
    dm.userData.baseMat = dm.material; dm.userData.fx = true;
    dm.scale.set(e.ctx.W + 0.55, 1, e.ctx.D + 0.55); dm.position.y = 0.02; dm.renderOrder = 1;
    dm.visible = tier === 'high';
    grp.add(dm); st.decal = dm;
  }

  if (opts.fit && opts.fit !== 1) grp.scale.setScalar(opts.fit);

  // ── per-frame hook ──
  const applyTier = (t) => {
    st.tier = t;
    const g2 = geosFor(e, t);
    for (const m of st.statics) {
      const ng = g2[m.userData.kind];
      if (ng) { m.geometry = ng; m.visible = true; } else m.visible = false;
    }
  };
  grp.userData.update = (t) => {
    if (st.tier !== _quality) applyTier(_quality);
    const p = st.primary;
    const constructing = !!p && p.material !== p.userData.baseMat;   // BuildSystem fade clone
    if (st.decal) st.decal.visible = st.tier === 'high';
    for (const f of st.fx) f.visible = !constructing;
    if (constructing || st.tier !== 'high') return;
    for (const a of st.anims) {
      const d = a.d, sp = d.speed || 1;
      if (d.anim === 'spinX') a.obj.rotation.x = t * sp + a.phase;
      else if (d.anim === 'spinY') a.obj.rotation.y = t * sp + a.phase;
      else if (d.anim === 'spinZ') a.obj.rotation.z = t * sp + a.phase;
      else if (d.anim === 'flicker') {
        const f = 0.86 + 0.08 * Math.sin(t * sp + a.phase) + 0.06 * Math.sin(t * sp * 2.7 + a.phase * 3.1);
        a.obj.scale.set(d.amp * f, d.amp * f, 1);
      }
      else if (d.anim === 'sway') {
        const v = Math.sin(t * sp + a.phase) * (d.amp || 0.2) + Math.sin(t * sp * 2.3 + a.phase) * (d.amp || 0.2) * 0.3;
        if (d.axis === 'z') a.obj.rotation.z = v; else a.obj.rotation.y = v;
      }
    }
  };
  grp.userData.setLevel = (lv) => {
    const g2 = pennantGeo(e, tierOf(lv));
    if (st.pennant && g2) st.pennant.geometry = g2;
  };
  grp.userData.setFacing = setFacing;
  if (opts.autoAnimate !== false && st.primary) {
    st.primary.onBeforeRender = (renderer, scene) => {
      updateModelLighting(renderer, scene);
      grp.userData.update(performance.now() * 0.001);
    };
  }
  return grp;
}
