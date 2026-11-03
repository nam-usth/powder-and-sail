import * as THREE from 'three';
import { HULL_SLOTS } from '../../data/ships.js';
import { CANNONS, CANNON_BY_ID } from '../../data/cannons.js';
import { modelLoader } from '../Utils/ModelLoader.js';

// ── Sail billowing ShaderMaterial ────────────────────────────────
// Sinusoidal vertex displacement along the sail's normal (Z axis in local
// space) to simulate wind filling the canvas. uTime drives the animation.
const SAIL_VERT = /* glsl */`
  uniform float uTime;
  uniform float uBillow; // 0 = flat, 1 = full belly

  void main() {
    vec3 pos = position;
    // Displacement peaks at the sail center, fades to zero at the edges
    float edgeU = abs(uv.x - 0.5) * 2.0; // 0=center, 1=edge
    float edgeV = uv.y;                    // 0=bottom luff, 1=head
    float envelope = (1.0 - edgeU * edgeU) * (1.0 - edgeV * 0.35);

    // Primary belly — constant forward bow
    float belly = uBillow * envelope * 0.32;

    // Gentle flutter along the leech (trailing edge)
    float flutter = sin(uTime * 2.2 + uv.y * 4.0) * 0.035 * (1.0 - edgeU) * uBillow;

    pos.z += belly + flutter;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const SAIL_FRAG = /* glsl */`
  uniform vec3 uColor;

  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

// Shared sail time uniform — one object, all sails write the same value
const SAIL_TIME = { value: 0 };

// Call once per frame from GameApp (or let VFX.update pass time)
export function updateSailTime(t) { SAIL_TIME.value = t; }

// ── GLB wind sway (AM) ───────────────────────────────────────────
// GLB ships are usually a single merged mesh (no separate sail geometry),
// so per-mesh sail detection is impossible. Instead we inject a WORLD-SPACE
// vertex sway into every material via onBeforeCompile:
//
//   • masked by world height (smoothstep band) → hull stays rigid,
//     masts flex slightly, sail tops catch the most wind
//   • phase offset from world XZ → ships don't sway in lockstep
//   • shares SAIL_TIME with the procedural sail shader → one clock
//
// Program-cache friendly: the injected GLSL is identical for every ship,
// so three.js compiles ONE program and only the uniforms differ.
const WIND_PROJECT_VERTEX = /* glsl */`
  vec4 _wp = modelMatrix * vec4(transformed, 1.0);
  float _hMask = smoothstep(uSwayBand.x, uSwayBand.y, _wp.y);
  float _ph    = _wp.x * 0.13 + _wp.z * 0.17;
  _wp.x += sin(uSailTime * 1.55 + _ph)            * uSwayAmp        * _hMask;
  _wp.z += sin(uSailTime * 1.10 + _ph * 1.4 + 1.7) * uSwayAmp * 0.7 * _hMask;
  vec4 mvPosition = viewMatrix * _wp;
  gl_Position = projectionMatrix * mvPosition;
`;

export function applyWindSway(root, { baseY, topY, amp }) {
  root.traverse(c => {
    if (!c.isMesh || !c.material) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uSailTime = SAIL_TIME;                          // shared clock
        shader.uniforms.uSwayAmp  = { value: amp };
        shader.uniforms.uSwayBand = { value: new THREE.Vector2(baseY, topY) };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nuniform float uSailTime;\nuniform float uSwayAmp;\nuniform vec2 uSwayBand;')
          .replace('#include <project_vertex>', WIND_PROJECT_VERTEX);
        m.userData._swayUniforms = shader.uniforms;                     // live handle
      };
      // All sway materials share one cache key → one compiled program.
      m.customProgramCacheKey = () => 'iow_wind_sway';
      m.needsUpdate = true;
    });
  });
}

function makeSailMat(col) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:   SAIL_TIME,
      uBillow: { value: 0.85 },
      uColor:  { value: new THREE.Color(col) },
    },
    vertexShader:   SAIL_VERT,
    fragmentShader: SAIL_FRAG,
    side:           THREE.DoubleSide,
  });
}

// ── Ship Model Registry ───────────────────────────────────────────
//
// Structure:  SHIP_MODELS[hull] = array of tier configs  (index = tier)
//             null = no GLB for this hull → always use procedural mesh
//
// Each tier config:
//   url       – path relative to index.html  (web root = frontend/)
//   rotX/Y/Z  – orientation correction baked into the inner node
//   autoScale – true  → auto-fit longest axis to 8.8 × cfg.sc world units
//               false → use manual `scale` multiplier
//   swayAmp   – optional wind-sway amplitude override (default 0.28 × sc)
//
// Tier selection:
//   Ships carry cfg.tier (0-based). getModelCfg() picks the matching array
//   entry, clamping down to the last available tier so a ship always gets
//   the closest model even if higher tiers aren't defined yet.
//
// Example with multiple tiers:
//   light: [
//     { url: 'Assets/Models/Sloop_T1.glb',  ... },   // tier 0
//     { url: 'Assets/Models/Sloop_T2.glb',  ... },   // tier 1
//     { url: 'Assets/Models/Sloop_T3.glb',  ... },   // tier 2
//   ],

export const SHIP_MODELS = {

  light: [
    { url: 'Assets/Models/Flagship.glb', rotX: 0, rotY: Math.PI, rotZ: Math.PI, autoScale: true }
  ],   // add array here when GLB is ready

  standard: [
    // tier 0 — base Brigantine
    { url: 'Assets/Models/Flagship.glb', rotX: 0, rotY: Math.PI, rotZ: Math.PI, autoScale: true },
    // tier 1 — upgraded (uncomment + add file when ready)
    // { url: 'Assets/Models/Brigantine_T2.glb', rotX: 0, rotY: Math.PI, rotZ: Math.PI, autoScale: true },
  ],

  heavy: [
    { url: 'Assets/Models/Flagship.glb', rotX: 0, rotY: Math.PI, rotZ: Math.PI, autoScale: true }
  ],   // add array here when GLB is ready
};

// Resolve which tier config to use for a given hull + tier level.
// Always returns a config (clamped to last available) or null if no GLB.
export function getModelCfg(hull, tier = 0) {
  const entry = SHIP_MODELS[hull];
  if (!entry) return null;
  const idx = Math.min(Math.max(0, tier), entry.length - 1);
  return entry[idx] ?? null;
}

// ── Procedural fallback mesh (used until GLB is assigned) ──────────
// AN/S3: safe disposal for ship meshes.
// Ownership rules learned from the asset pipeline:
//   • procedural meshes (userData.proc) own their geometries → dispose
//   • GLB clones SHARE geometry with the modelLoader cache → never dispose
//   • materials are per-instance for BOTH paths (modelLoader.clone clones
//     them) → always dispose; textures stay (shared via material.clone refs)
export function disposeShipMesh(root){
  if(!root) return;
  const proc = !!root.userData?.proc;
  root.traverse(c => {
    if(!c.isMesh) return;
    if(proc) c.geometry?.dispose();
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => m?.dispose?.());
  });
}

export function buildShipMesh(col, sc=1){
  const g=new THREE.Group();
  g.userData.proc = true;   // AN/S3: marks geometries as per-ship → disposable
  const hM=new THREE.MeshStandardMaterial({color:col,roughness:.7});
  const hull=new THREE.Mesh(new THREE.BoxGeometry(1.5*sc,.55*sc,3.8*sc),hM);hull.castShadow=true;g.add(hull);
  const bow=new THREE.Mesh(new THREE.ConeGeometry(.75*sc,1.2*sc,4),hM);bow.rotation.z=Math.PI/2;bow.rotation.y=Math.PI/4;bow.position.set(0,0,-2.3*sc);g.add(bow);
  const deck=new THREE.Mesh(new THREE.BoxGeometry(1.1*sc,.16*sc,3.2*sc),new THREE.MeshStandardMaterial({color:0x8b6347,roughness:.9}));deck.position.y=.36*sc;g.add(deck);
  const mH=3.8*sc;
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.065*sc,.07*sc,mH,6),new THREE.MeshStandardMaterial({color:0x6b4a2a}));mast.position.set(0,mH*.5+.4*sc,.2*sc);g.add(mast);
  const sail=new THREE.Mesh(new THREE.PlaneGeometry(1.3*sc,2.2*sc,6,10),makeSailMat(0xeeeedd));sail.position.set(0,2.6*sc,.2*sc);sail.rotation.y=Math.PI/2;g.add(sail);
  g.position.y=.35;
  return g;
}

// ── Async GLB swap: load model and hot-swap into an existing ship ──
// Architecture: the game loop updates ship.mesh (position/rotation) every frame.
// To keep the model correction permanent we use a two-level hierarchy:
//   wrapper (Group) ← game loop writes rotation.y/x/z here
//     └─ inner (gltf.scene clone) ← correction rotation baked here, never touched again
async function _tryLoadGLB(ship, hull, tier, col, sc, scene) {
  const cfg = getModelCfg(hull, tier);
  if (!cfg) return;

  try {
    await modelLoader.load(cfg.url);
    const inner = modelLoader.clone(cfg.url);
    if (!inner) return;

    // Bake orientation correction into the inner node (permanent)
    inner.rotation.set(cfg.rotX || 0, cfg.rotY || 0, cfg.rotZ || 0);

    // Scale: auto-fit to procedural ship length, or use manual multiplier
    if (cfg.autoScale) {
      // Compute bounding box AFTER applying the correction rotation
      inner.updateMatrixWorld(true);
      const box  = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const longestAxis = Math.max(size.x, size.y, size.z);
      if (longestAxis > 0) {
        const targetLen = 8.8 * sc; // match procedural ship body length
        inner.scale.setScalar(targetLen / longestAxis);
      }
    } else {
      inner.scale.setScalar(sc * (cfg.scale || 1.0));
    }

    // Wrapper: game loop controls this node's position + rotation
    const wrapper = new THREE.Group();
    wrapper.add(inner);
    wrapper.position.copy(ship.mesh.position);
    wrapper.rotation.copy(ship.mesh.rotation);

    // AM: wind sway — band computed from the SCALED bounding box so the
    // mask sits correctly for any model size. Hull (lower 45%) stays rigid.
    inner.updateMatrixWorld(true);
    const sBox  = new THREE.Box3().setFromObject(inner);
    const baseY = wrapper.position.y + sBox.min.y + (sBox.max.y - sBox.min.y) * 0.45;
    const topY  = wrapper.position.y + sBox.max.y;
    applyWindSway(inner, { baseY, topY, amp: cfg.swayAmp ?? 0.28 * sc });

    scene.remove(ship.mesh);
    scene.add(wrapper);
    ship.mesh = wrapper;
  } catch (e) {
    console.warn(`[ShipEntity] GLB load failed for "${hull}":`, e);
  }
}

export function makeShip(cfg, rank, sx, sz, team, scene, gameState){
  const mesh=buildShipMesh(cfg.col,cfg.sc);
  mesh.position.set(sx,.35,sz);
  scene.add(mesh);
  // Kick off lazy GLB load; ship works immediately with the procedural mesh
  // and swaps silently once the model arrives. No-op if SHIP_MODELS[hull] is null.

  const loadout={};
  (HULL_SLOTS[cfg.hull]||[]).forEach(s=>loadout[s]=null);
  loadout['L']='swivel';

  const slotTimers={};
  (HULL_SLOTS[cfg.hull]||[]).forEach(s=>{
    slotTimers[s]=3+rank*2+(s==='L'?0:CANNONS[0].rof);
  });

  // Apply speed research multiplier to new ships (if research already done)
  const spdMult = (team==='player' && gameState && gameState._spdResearchMult) || 1;
  const baseSpd = cfg.spd * spdMult;

  const ship = {
    mesh, x:sx, z:sz, angle:0, speed:0,
    baseSpd, maxSpeed:baseSpd,
    hp:100, maxHp:100, alive:true,
    nm:cfg.nm, hull:cfg.hull, disp:cfg.disp, sc:cfg.sc,
    tier: cfg.tier ?? 0,   // model tier — 0 = base, 1+ = upgraded visuals
    loadout, slotTimers,
    dodgeBase: cfg.hull==='light' ? .35 : cfg.hull==='standard' ? .15 : .05,
    rofMult: 1.0,
    statusEffects: {},
    effects: [],
    rank, team,
    _stuckFrames:0,
    deadAt:null, reviveCost:null, inRepairAura:false,
  };

  // Lazy GLB swap — picks the correct tier model, falls back to procedural if none
  _tryLoadGLB(ship, cfg.hull, ship.tier, cfg.col, cfg.sc, scene);

  return ship;
}

/** Recalculate maxSpeed from baseSpd and cannon weight penalty */
export function applySpeed(ship){
  let w=0;
  (HULL_SLOTS[ship.hull]||[]).forEach(s=>{
    const cn=CANNON_BY_ID.get(ship.loadout[s]);
    if(cn)w+=cn.wt;
  });
  const mult=Math.max(.6,1-Math.max(0,(w-ship.disp*.5)/ship.disp)*.4);
  ship.maxSpeed=ship.baseSpd*mult;
  return mult;
}

export function calcSpeedMult(ship){
  applySpeed(ship);
  return ship.maxSpeed/ship.baseSpd;
}
