import * as THREE from 'three';
import { VisionLayer, SHIP_BIT, ISLAND_BIT } from './VisionLayer.js';

/**
 * FogSystem — GPU overlay + CPU visibility controller.
 *
 * Responsibilities
 * ────────────────
 * 1. Render a dark translucent plane over the map with shader "holes" punched
 *    wherever the player has vision (GPU side, unchanged visual style).
 * 2. Hide/show enemy ship meshes based on visibility (CPU side, O(1) per ship
 *    via VisionLayer grid lookup instead of O(sources) distance checks).
 *
 * VisionLayer integration
 * ───────────────────────
 * • Player ships  → SHIP_BIT   sources, id = 'ship_<rank>_<team>'
 * • Player islands → ISLAND_BIT sources, id = 'island_<def.id>'
 *
 * The layer re-stamps circles only when a ship moves >2.5 world units.
 * Islands are stamped once on registration (or on capture / recapture).
 * All enemy visibility checks are O(1) grid lookups.
 *
 * Shader uniforms (MAX_SOURCES slots)
 * ─────────────────────────────────────
 * Uniforms are rebuilt from the VisionLayer source list only when the layer
 * reports a change (_layerDirty flag). Most frames: zero uniform writes.
 *
 * Wake trail meshes (WakeSystem) are NOT touched here — they are separate
 * Three.js meshes. A wake bleeding out of the fog is an intentional gameplay
 * cue that an enemy ship is nearby.
 */

const MAX_SOURCES = 16;   // 8 ships + 8 islands; raise if needed

// ── Vertex shader ─────────────────────────────────────────────────
const FOG_VERT = /* glsl */`
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Build the unrolled visionAt() function for GLSL ES 1.00
// (no dynamic indexing of user arrays allowed in a loop).
function buildFragShader(n) {
  let cases = '';
  for (let i = 0; i < n; i++) {
    cases += `  ${i === 0 ? 'if' : 'else if'} (i==${i}){dx=p.x-uPX[${i}];dz=p.y-uPZ[${i}];r=uVR[${i}];}\n`;
  }
  return /* glsl */`
precision mediump float;
uniform float uPX[${n}];
uniform float uPZ[${n}];
uniform float uVR[${n}];
varying vec2 vXZ;

float visionAt(int i,vec2 p){
  float dx,dz,d,r;
${cases}  else{dx=0.0;dz=0.0;r=0.0;}
  d=sqrt(dx*dx+dz*dz);
  return 1.0-smoothstep(r*0.72,r,d);
}

void main(){
  float vis=0.0;
  for(int i=0;i<${n};i++) vis=max(vis,visionAt(i,vXZ));
  float fog=(1.0-vis)*0.86;
  gl_FragColor=vec4(0.02,0.07,0.14,fog);
}
`;
}

// ─────────────────────────────────────────────────────────────────

export class FogSystem {
  constructor(scene, mapSize = 320) {
    this._scene = scene;

    // GPU overlay mesh
    const geo = new THREE.PlaneGeometry(mapSize, mapSize, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const px = new Float32Array(MAX_SOURCES).fill(99999);
    const pz = new Float32Array(MAX_SOURCES).fill(99999);
    const vr = new Float32Array(MAX_SOURCES).fill(0);

    this._mat = new THREE.ShaderMaterial({
      vertexShader:   FOG_VERT,
      fragmentShader: buildFragShader(MAX_SOURCES),
      uniforms: { uPX: { value: px }, uPZ: { value: pz }, uVR: { value: vr } },
      transparent: true,
      depthWrite:  false,
      depthTest:   false,
    });

    this._mesh = new THREE.Mesh(geo, this._mat);
    this._mesh.position.y = 0.6;
    this._mesh.renderOrder = 90;
    this._mesh.visible = false;
    scene.add(this._mesh);

    // CPU vision bitmap
    this._layer       = new VisionLayer();
    this._layerDirty  = false;   // true → uniforms need a push this frame

    // Ordered list of { id, x, z, r } for uniform sync
    this._uniformSrcs = [];

    // Island vision radius bonus (world units added on top of island terrain radius)
    this._ISLAND_BONUS = 12;
  }

  // ── Source management ──────────────────────────────────────────

  /**
   * Register a player ship as a SHIP_BIT vision source.
   * Call once when a ship is created (addShip on WakeSystem fires at the same time).
   */
  addShip(ship) {
    const id = _shipId(ship);
    const r  = this._shipVisionR();
    this._layer.addSource(id, SHIP_BIT, ship.x, ship.z, r);
    this._uniformSrcs.push({ id, x: ship.x, z: ship.z, r });
    this._layerDirty = true;
  }

  /**
   * Remove a player ship's vision contribution (on death / removal).
   */
  removeShip(ship) {
    const id  = _shipId(ship);
    const idx = this._uniformSrcs.findIndex(s => s.id === id);
    if (idx !== -1) this._uniformSrcs.splice(idx, 1);
    this._layer.removeSource(id);   // triggers internal grid rebuild
    this._layerDirty = true;
  }

  /**
   * Register a player-owned island as an ISLAND_BIT vision source.
   * Islands are static — this is called once on game init or on capture.
   */
  addIsland(island) {
    const id = _islandId(island);
    const r  = _islandR(island, this._ISLAND_BONUS);
    this._layer.addSource(id, ISLAND_BIT, island.x, island.z, r);
    this._uniformSrcs.push({ id, x: island.x, z: island.z, r });
    this._layerDirty = true;
  }

  /**
   * Remove an island's vision (on capture by enemy).
   */
  removeIsland(island) {
    const id  = _islandId(island);
    const idx = this._uniformSrcs.findIndex(s => s.id === id);
    if (idx !== -1) this._uniformSrcs.splice(idx, 1);
    this._layer.removeSource(id);
    this._layerDirty = true;
  }

  /**
   * Call when the global vision radius changes (research upgrade, lighthouse).
   * Rebuilds all ship sources; island sources grow too.
   */
  onVisionRadiusChanged(newR, islands) {
    // Update all ship sources
    for (const src of this._uniformSrcs) {
      if (src.id.startsWith('ship_')) {
        src.r = newR;
        this._layer.updateRadius(src.id, newR);
      }
    }
    // Rebuild island sources with the new base radius (island bonus is additive)
    if (islands) {
      for (const isl of islands) {
        if (isl.own !== 'player') continue;
        const id = _islandId(isl);
        const r  = _islandR(isl, this._ISLAND_BONUS);
        const src = this._uniformSrcs.find(s => s.id === id);
        if (src) { src.r = r; this._layer.updateRadius(id, r); }
      }
    }
    this._layerDirty = true;
  }

  /** AU: is a world point currently seen by any player ship / island? */
  isVisible(x, z) {
    return this._layer.isVisible(x, z);
  }

  // ── Toggle ─────────────────────────────────────────────────────

  toggle(state) {
    state.fogOn = !state.fogOn;
    this._mesh.visible = state.fogOn;
    const btn = document.getElementById('fog-btn');
    if (btn) {
      // AV: icon button in the console — state shown by .active + tooltip
      btn.classList.toggle('active', state.fogOn);
      btn.title = `Fog of War: ${state.fogOn ? 'ON' : 'OFF'} [Shift+F]`;
    }
    if (!state.fogOn) {
      state.allShips.forEach(s => { if (s.mesh) s.mesh.visible = s.alive; });
    }
  }

  // ── Per-frame update ───────────────────────────────────────────

  /**
   * Called every frame from GameApp._update() after ship positions are synced.
   *
   * Cost breakdown (typical frame):
   *   • updateSource()  — O(S) where S = alive player ships.
   *                        Each call is O(1) if ship didn't move far enough,
   *                        O(cells_in_circle) ≈ O(πr²/cell²) for the rare re-stamp.
   *   • isVisible()     — O(E) where E = alive enemy ships, each O(1) grid lookup.
   *   • uniform push    — O(MAX_SOURCES), only when _layerDirty is true.
   */
  update(state, playerShips) {
    if (!state.fogOn) return;

    // 1. Update ship positions in the layer — only re-stamps on significant movement
    const alive = (playerShips || []).filter(s => s.alive);
    for (const s of alive) {
      const changed = this._layer.updateSource(_shipId(s), s.x, s.z);
      if (changed) {
        const src = this._uniformSrcs.find(u => u.id === _shipId(s));
        if (src) { src.x = s.x; src.z = s.z; }
        this._layerDirty = true;
      }
    }

    // 2. Push uniforms to GPU only when something changed
    if (this._layerDirty) {
      this._pushUniforms();
      this._layerDirty = false;
    }

    // 3. Sync enemy ship visibility — O(1) per ship via grid lookup
    state.allShips.forEach(s => {
      if (!s.alive || s.team === 'player') return;
      // Wake trail mesh is a separate Three.Mesh — intentionally not touched here.
      // A wake trail drifting out of fog is a gameplay cue.
      if (s.mesh) s.mesh.visible = this._layer.isVisible(s.x, s.z);
    });
  }

  // ── GPU uniform push ───────────────────────────────────────────

  _pushUniforms() {
    const { uPX, uPZ, uVR } = this._mat.uniforms;
    const srcs = this._uniformSrcs;

    for (let i = 0; i < MAX_SOURCES; i++) {
      if (i < srcs.length) {
        uPX.value[i] = srcs[i].x;
        uPZ.value[i] = srcs[i].z;
        uVR.value[i] = srcs[i].r;
      } else {
        uPX.value[i] = 99999;
        uPZ.value[i] = 99999;
        uVR.value[i] = 0;
      }
    }

    uPX.needsUpdate = true;
    uPZ.needsUpdate = true;
    uVR.needsUpdate = true;
  }

  // ── Helpers ────────────────────────────────────────────────────

  _shipVisionR() {
    // Reads from GameState if available via the state object passed to update();
    // FogSystem doesn't hold a reference to state, so callers pass the radius
    // explicitly via onVisionRadiusChanged. Default 35 matches original behaviour.
    return this._cachedShipVR ?? 35;
  }

  /** Called by GameApp once after state is ready so we have the initial radius. */
  setVisionRadius(r) {
    this._cachedShipVR = r;
  }

  destroy() {
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
  }
}

// ── Pure helpers ───────────────────────────────────────────────────

function _shipId(ship)   { return `ship_${ship.rank}_${ship.team}`; }
function _islandId(isl)  { return `island_${isl.def?.id ?? isl.id ?? isl.nm}`; }
function _islandR(isl, bonus) {
  return (isl.def?.r ?? isl.r ?? 10) + bonus;
}
