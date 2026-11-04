import * as THREE from 'three';
import { HULL_SLOTS } from '../../data/ships.js';
import { CANNONS, CANNON_BY_ID } from '../../data/cannons.js';
import { modelLoader } from '../Utils/ModelLoader.js';
import { buildProceduralShip, SAIL_TIME, SHIP_REF, WATERLINE, isShared } from '../Systems/VFX/shipModel.js';

export { SHIP_REF };

// ── Sail clock ───────────────────────────────────────────────────
// One shared uniform drives every sail, flag and GLB wind sway.
/** Call once per frame from GameApp (or let VFX.update pass time). */
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

// ── Ship Model Registry (optional GLB overrides) ─────────────────
//
// The procedural fleet (Systems/VFX/shipModel.js) is the default look: it
// gives every hullId its own silhouette, communicates tier I–V and wears
// the faction livery. A GLB can still replace it per hullId or per combat
// class — register it here (or at runtime with setShipModel) and the ship
// hot-swaps once the file has loaded; on failure it silently stays
// procedural.
//
// Structure:  SHIP_MODELS[hullId | hullClass] = array of tier configs
//             (index 0 = tier I/base … clamped to the last entry);
//             null / missing = procedural.
// Each tier config:
//   url       – path relative to index.html  (web root = frontend/)
//   rotX/Y/Z  – orientation correction baked into the inner node
//   autoScale – true  → fit longest axis to the procedural length × cfg.sc
//               false → use manual `scale` multiplier
//   swayAmp   – optional wind-sway amplitude override (default 0.28 × sc)
//
// Example:
//   SHIP_MODELS.galleon = [
//     { url: 'Assets/Models/Flagship.glb', rotX: 0, rotY: Math.PI, rotZ: Math.PI, autoScale: true },
//   ];
export const SHIP_MODELS = {
  light:    null,
  standard: null,
  heavy:    null,
};

/** Register (or clear with null) a GLB override for a hullId or hull class. */
export function setShipModel(key, tierCfgs) { SHIP_MODELS[key] = tierCfgs || null; }

/**
 * Resolve which tier config to use for a hull (+ optional hullId).
 * Tier is the roster tier I..V (1-based; 0/undefined = base) and is clamped
 * to the models available, so tiers without their own GLB reuse the closest
 * lower one. Returns null when no GLB is registered → procedural mesh.
 * @param {string} hull     combat class or hullId
 * @param {number} [tier]   1..5 (0 = base)
 * @param {string} [hullId] roster hull id, preferred over the class
 */
export function getModelCfg(hull, tier = 0, hullId = null) {
  const entry = (hullId && SHIP_MODELS[hullId]) || SHIP_MODELS[hull];
  if (!Array.isArray(entry) || !entry.length) return null;
  const t = Number.isFinite(+tier) ? Math.round(+tier) : 0;
  const idx = Math.min(Math.max(0, t - 1), entry.length - 1);
  return entry[idx] ?? null;
}

// ── Disposal ─────────────────────────────────────────────────────
// Ownership rules:
//   • procedural geometries are cached and SHARED between ships
//     (userData.shared) → never disposed here
//   • GLB clones share geometry with the modelLoader cache → never disposed
//   • per-ship materials (hull, sails, GLB clones) are owned → disposed;
//     shared materials (rigging, lantern glow) are skipped
//   • legacy per-ship procedural geometry (userData.proc without the shared
//     flag) is still disposed
export function disposeShipMesh(root){
  if(!root) return;
  const proc = !!root.userData?.proc;
  root.traverse(c => {
    if(!c.isMesh && !c.isLine && !c.isPoints) return;
    if(proc && c.geometry && !isShared(c.geometry)) c.geometry.dispose();
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach(m => { if (m && !isShared(m)) m.dispose?.(); });
  });
}

/**
 * Procedural ship mesh.
 * @param {number} col  hull paint colour (player strake; factions use their livery)
 * @param {number} sc   ship scale
 * @param {{hull?:string, hullId?:string, tier?:number, team?:string,
 *          faction?:string, style?:string, nm?:string}} [opts]
 * @returns {THREE.Group} root — origin 0.35 above the waterline, +z = bow
 */
export function buildShipMesh(col, sc=1, opts={}){
  return buildProceduralShip({ ...opts, col, sc });
}

// ── Async GLB swap: load model and hot-swap into an existing ship ──
// Architecture: the game loop updates ship.mesh (position/rotation) every frame.
// To keep the model correction permanent we use a two-level hierarchy:
//   wrapper (Group) ← game loop writes rotation.y/x/z here
//     └─ inner (gltf.scene clone) ← correction rotation baked here, never touched again
async function _tryLoadGLB(ship, cfg, scene) {
  const mcfg = getModelCfg(cfg.hull, cfg.tier ?? 0, cfg.hullId);
  if (!mcfg) return;
  const sc = cfg.sc || 1;

  try {
    await modelLoader.load(mcfg.url);
    // the ship may have been sunk / culled while the file was loading
    if (!ship.mesh || ship.mesh.parent !== scene) return;
    const inner = modelLoader.clone(mcfg.url);
    if (!inner) return;

    inner.rotation.set(mcfg.rotX || 0, mcfg.rotY || 0, mcfg.rotZ || 0);

    const old = ship.mesh;
    const procLen = old.userData?.hullInfo ? old.userData.hullInfo.hl * 2.25 : 5.6 * sc;
    if (mcfg.autoScale) {
      inner.updateMatrixWorld(true);
      const box  = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const longestAxis = Math.max(size.x, size.y, size.z);
      if (longestAxis > 0) inner.scale.setScalar(procLen / longestAxis);
    } else {
      inner.scale.setScalar(sc * (mcfg.scale || 1.0));
    }

    const wrapper = new THREE.Group();
    wrapper.add(inner);
    wrapper.position.copy(old.position);
    wrapper.rotation.copy(old.rotation);
    wrapper.visible = old.visible;

    inner.updateMatrixWorld(true);
    const sBox  = new THREE.Box3().setFromObject(inner);
    const baseY = wrapper.position.y + sBox.min.y + (sBox.max.y - sBox.min.y) * 0.45;
    const topY  = wrapper.position.y + sBox.max.y;
    applyWindSway(inner, { baseY, topY, amp: mcfg.swayAmp ?? 0.28 * sc });

    // keep the VFX contract: muzzle / wreck metrics + link back to the ship
    const hb = Math.min(sBox.max.x - sBox.min.x, sBox.max.z - sBox.min.z) / 2;
    wrapper.userData.hullInfo = old.userData?.hullInfo ?? {
      hl: (sBox.max.z - sBox.min.z) / 2, hb, deckY: WATERLINE + 0.45 * sc, gunY: WATERLINE + 0.3 * sc,
      lowGunY: WATERLINE + 0.3 * sc, guns: 3, decks: 1, mastH: sBox.max.y,
    };
    wrapper.userData[SHIP_REF] = ship;

    scene.remove(old);
    scene.add(wrapper);
    ship.mesh = wrapper;
    disposeShipMesh(old);
  } catch (e) {
    console.warn(`[ShipEntity] GLB load failed for "${cfg.hullId || cfg.hull}":`, e);
  }
}

export function makeShip(cfg, rank, sx, sz, team, scene, gameState){
  const mesh=buildShipMesh(cfg.col,cfg.sc,{
    hull:cfg.hull, hullId:cfg.hullId, tier:cfg.tier, team, faction:cfg.faction, style:cfg.style, nm:cfg.nm,
  });
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

  // Visual link mesh → ship (symbol key: invisible to clone()/JSON) so VFX can
  // find live ships in the scene for damage fires, wrecks and broadside flashes.
  mesh.userData[SHIP_REF] = ship;

  // Lazy GLB swap — only when a GLB is registered for this hullId / class
  _tryLoadGLB(ship, cfg, scene);

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
