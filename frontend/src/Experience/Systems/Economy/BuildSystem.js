import * as THREE from 'three';
import { BUILD_GRID_SIZE, BUILD_CELL_WORLD, BUILD_TIME_MULT } from '../../../data/constants.js';
import { BUILDINGS, createBuildingInstance, getBuildingProduction } from '../../../data/buildings.js';
import { ISLAND_TRAITS } from '../../../data/traits.js';
import { DEFENSES, getDefenseStats } from '../../../data/defenses.js';

// ── Grid cell ShaderMaterial ──────────────────────────────────────
// Always drawn above ocean (depthTest:false, renderOrder:15).
// Pulsing emissive glow so cells are clearly visible at all times.
const GRID_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const GRID_FRAG = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2  vUv;
  void main() {
    // Soft border fade
    vec2 d = abs(vUv - 0.5) * 2.0;
    float edge = max(d.x, d.y);
    float border = smoothstep(0.72, 0.96, edge);
    float inner  = 1.0 - smoothstep(0.50, 0.72, edge);
    // Subtle pulse for emissive feel
    float pulse = 0.75 + 0.25 * sin(uTime * 2.8);
    float alpha = (border * 0.85 + inner * 0.15) * uOpacity * pulse;
    gl_FragColor = vec4(uColor * (0.9 + 0.1 * pulse), alpha);
  }
`;
function makeGridMat(colorHex, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor:   { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
      uTime:    { value: 0 },
    },
    vertexShader:   GRID_VERT,
    fragmentShader: GRID_FRAG,
    transparent:    true,
    depthWrite:     false,
    depthTest:      false,   // always visible, never occluded by ocean
    side:           THREE.DoubleSide,
  });
}

// Shared geometry for all grid cells (same size)
let _gridGeo = null;
function getGridGeo() {
  if (!_gridGeo) _gridGeo = new THREE.PlaneGeometry(BUILD_CELL_WORLD * 0.88, BUILD_CELL_WORLD * 0.88);
  return _gridGeo;
}

// ── BUILD SYSTEM ─────────────────────────────────────────────────
// Instance-based building placement.
// islandBuildings[islId] is now an ARRAY of instances.
// Multiple buildings of same type are allowed.


// ── AN/G4: Construction / upgrade progress ring ───────────────────
// Flat arc ring at the building's base that fills clockwise 0→100 %.
// One ShaderMaterial instance per ring (uProg uniform); geometry shared.
// depthTest:false + renderOrder 13 → always readable, same convention as
// RingMaterial.js range rings.
const PROG_RING_GEO = new THREE.RingGeometry(1.02, 1.34, 48);
const PROG_VERT = /* glsl */`
  varying vec2 vP;
  void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;
const PROG_FRAG = /* glsl */`
  uniform float uProg; uniform vec3 uCol; varying vec2 vP;
  void main(){
    float t = atan(vP.x, vP.y) / 6.2831853;   // 0 at 12 o'clock, clockwise
    t -= floor(t);
    if(t > uProg) discard;
    gl_FragColor = vec4(uCol, 0.92);
  }
`;
function makeProgRing(colHex){
  const mat = new THREE.ShaderMaterial({
    uniforms: { uProg:{value:0}, uCol:{value:new THREE.Color(colHex)} },
    vertexShader: PROG_VERT, fragmentShader: PROG_FRAG,
    transparent:true, depthTest:false, depthWrite:false, side:THREE.DoubleSide,
  });
  const grp = new THREE.Group();
  const track = new THREE.Mesh(PROG_RING_GEO, new THREE.MeshBasicMaterial({
    color:0x10202e, transparent:true, opacity:.45, depthTest:false, depthWrite:false, side:THREE.DoubleSide }));
  const fill  = new THREE.Mesh(PROG_RING_GEO, mat);
  [track, fill].forEach(m => { m.rotation.x = -Math.PI/2; m.renderOrder = 13; grp.add(m); });
  fill.renderOrder = 14;
  return { grp, mat };
}

export class BuildSystem {
  constructor(scene, state, islands, vfx, bus){
    this._scene   = scene;
    this._state   = state;
    this._islands = islands;
    this._vfx     = vfx;
    this._bus     = bus;
    this._gridMeshes = [];
    this._progRings  = new Map();   // AN/G4: instanceId → {grp, mat, inst}
    this._curHoverIsl = null;
    this._arcPreview  = null;   // THREE.Group for defense arc hover preview

    // Migrate state storage to array-based if not already
    this._islands.forEach(isl=>{
      if(!Array.isArray(this._state.islandBuildings[isl.def.id])){
        this._state.islandBuildings[isl.def.id] = [];
      }
    });
  }

  // ── Defense arc preview ──────────────────────────────────────────
  // Shows a semi-transparent arc at the hovered grid cell showing attack
  // coverage and the current Q/E facing direction.
  _showArcPreview(wx, wz, arcDeg, range, facingDeg) {
    this._clearArcPreview();

    const grp = new THREE.Group();
    grp.position.set(wx, 1.8, wz);

    // Range fill
    if (arcDeg >= 360) {
      const fill = new THREE.Mesh(
        new THREE.CircleGeometry(range, 48),
        new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.08,
          depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })
      );
      fill.rotation.x = -Math.PI / 2;
      fill.renderOrder = 16;
      grp.add(fill);

      const edge = new THREE.Mesh(
        new THREE.RingGeometry(range - 0.18, range, 48),
        new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.55,
          depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.renderOrder = 16;
      grp.add(edge);
    } else {
      // Sector fill — rotate so arc faces the chosen direction
      const hw   = arcDeg / 2 * Math.PI / 180;
      const cR   = facingDeg * Math.PI / 180;
      const STEPS = Math.max(16, Math.round(arcDeg / 3));

      const pts = [new THREE.Vector2(0, 0)];
      for (let i = 0; i <= STEPS; i++) {
        const a = cR - hw + (i / STEPS) * hw * 2;
        pts.push(new THREE.Vector2(Math.sin(a) * range, Math.cos(a) * range));
      }
      const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(new THREE.Shape(pts)),
        new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.12,
          depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide })
      );
      fill.rotation.x = -Math.PI / 2;
      fill.renderOrder = 16;
      grp.add(fill);

      // Arc edge band
      const aStart = cR - hw, aEnd = cR + hw;
      const inner = range - 0.18;
      const verts = [], idx = [];
      for (let i = 0; i <= STEPS; i++) {
        const a = aStart + (i / STEPS) * (aEnd - aStart);
        verts.push(Math.sin(a) * inner, 0, Math.cos(a) * inner,
                   Math.sin(a) * range, 0, Math.cos(a) * range);
        if (i < STEPS) {
          const b = i * 2;
          idx.push(b, b+2, b+1,  b+1, b+2, b+3);
        }
      }
      const arcGeo = new THREE.BufferGeometry();
      arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      arcGeo.setIndex(idx);
      const arcMesh = new THREE.Mesh(arcGeo,
        new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.60,
          depthTest: false, depthWrite: false, fog: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      arcMesh.renderOrder = 16;
      grp.add(arcMesh);

      // Radial arms from center
      const armW = 0.08;
      [aStart, aEnd].forEach(a => {
        const s = Math.sin(a), c = Math.cos(a);
        const px = -c * armW, pz = s * armW;
        const armVerts = [px, 0, pz, -px, 0, -pz,
                          s*range+px, 0, c*range+pz, s*range-px, 0, c*range-pz];
        const armGeo = new THREE.BufferGeometry();
        armGeo.setAttribute('position', new THREE.Float32BufferAttribute(armVerts, 3));
        armGeo.setIndex([0, 2, 1, 1, 2, 3]);
        const arm = new THREE.Mesh(armGeo,
          new THREE.MeshBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.50,
            depthTest: false, depthWrite: false, fog: false,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        arm.renderOrder = 16;
        grp.add(arm);
      });
    }

    // Facing direction arrow (thin line from center toward arc midpoint)
    const arrowLen = Math.min(range * 0.4, 5);
    const fa = facingDeg * Math.PI / 180;
    const arrowPts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.sin(fa) * arrowLen, 0, Math.cos(fa) * arrowLen),
    ];
    const arrow = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(arrowPts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.70, depthTest: false, fog: false })
    );
    arrow.renderOrder = 17;
    grp.add(arrow);

    this._scene.add(grp);
    this._arcPreview = grp;
  }

  _clearArcPreview() {
    if (this._arcPreview) {
      this._scene.remove(this._arcPreview);
      this._arcPreview.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
      this._arcPreview = null;
    }
  }

  // ── HELPERS ─────────────────────────────────────────────────
  /** Returns footprint with rotation applied (w↔h if rotated) */
  _effectiveFP(bldOrDef){
    const fp = bldOrDef?.footprint || {w:1,h:1};
    if(this._state.buildRotated && (fp.w!==fp.h)){
      return {w:fp.h, h:fp.w};   // 2×1 → 1×2, 3×1 → 1×3, etc.
    }
    return fp;
  }
  /** Compute facing angle (degrees, 0=north/+Z) toward a target world position */
  _computeFacing(fromX, fromZ, toX, toZ){
    return Math.atan2(toX-fromX, toZ-fromZ) * 180/Math.PI;
  }

  /** Get sensible facing for a newly-placed defense on an island */
  _defaultFacing(isl){
    // Player defenses face enemy home; enemy defenses face player home
    const targetOwner = isl.own==='player'?'enemy':'player';
    const target = this._islands.find(i=>i.own===targetOwner);
    if(target) return this._computeFacing(isl.x, isl.z, target.x, target.z);
    return this._computeFacing(isl.x, isl.z, 0, 0); // map center
  }

  /** Check whether a footprint fits in the grid without overlap */
  canPlaceFootprint(isl, anchorKey, fp){
    const [anchorCol, anchorRow] = anchorKey.split('_').map(Number);
    const occupied = this._occupiedKeys(isl);
    for(let dr=0; dr<fp.h; dr++){
      for(let dc=0; dc<fp.w; dc++){
        const col=anchorCol+dc, row=anchorRow+dr;
        const key=`${col}_${row}`;
        // Must be within grid bounds
        if(col<0||col>=BUILD_GRID_SIZE||row<0||row>=BUILD_GRID_SIZE) return false;
        // AF8: must be within island's valid shape cells
        if(isl.validGridKeys && !isl.validGridKeys.has(key)) return false;
        // Must not be occupied
        if(occupied.has(key)) return false;
      }
    }
    return true;
  }

  // ── GRID ─────────────────────────────────────────────────────
  _cells(isl){
    // AF8: only return cells within island's shape-masked valid keys
    const off = (BUILD_GRID_SIZE - 1) / 2 * BUILD_CELL_WORLD;
    const cells = [];
    for (let r = 0; r < BUILD_GRID_SIZE; r++) {
      for (let c = 0; c < BUILD_GRID_SIZE; c++) {
        const key = `${c}_${r}`;
        // Skip cells outside this island's shape
        if (isl.validGridKeys && !isl.validGridKeys.has(key)) continue;
        cells.push({
          cx:  isl.x + (c * BUILD_CELL_WORLD - off),
          cz:  isl.z + (r * BUILD_CELL_WORLD - off),
          key,
        });
      }
    }
    return cells;
  }

  _occupiedKeys(isl){
    const instances=this._state.islandBuildings[isl.def.id]||[];
    const used=new Set();
    instances.filter(i=>i.state!=='destroyed' && i.state!=='moving').forEach(inst=>{
      // Footprint: mark all grid keys used
      const bldDef=[...BUILDINGS,...DEFENSES].find(b=>b.id===inst.buildingId);
      const fp=inst.footprint||(bldDef&&bldDef.footprint)||{w:1,h:1};
      // For prototype: mark gridKey + adjacent cells based on footprint
      used.add(inst.gridKey);
      if(fp.w>1||fp.h>1){
        // Simple: also block adjacent keys (rough prototype)
        const [col,row]=inst.gridKey.split('_').map(Number);
        for(let dr=0;dr<fp.h;dr++) for(let dc=0;dc<fp.w;dc++){
          used.add(`${col+dc}_${row+dr}`);
        }
      }
    });
    return used;
  }

  showGrid(isl){
    this._curHoverIsl=isl;
    this.clearGrid();
    const occupied=this._occupiedKeys(isl);
    this._cells(isl).forEach(cell=>{
      const occ=occupied.has(cell.key);
      // AQ/SC2: base grid is a calm backdrop — the cursor footprint + ghost
      // carry the signal (SC2-style placement).
      const mat = makeGridMat(occ ? 0xff4433 : 0x44ff66, occ ? 0.42 : 0.16);
      const m   = new THREE.Mesh(getGridGeo(), mat);
      m.rotation.x  = -Math.PI / 2;
      m.position.set(cell.cx, 2.2, cell.cz);  // above max wave height
      m.renderOrder = 15;
      m.userData    = { ...cell, occupied: occ };
      this._scene.add(m); this._gridMeshes.push(m);
    });
  }

  clearGrid(){
    this._gridMeshes.forEach(m=>this._scene.remove(m));
    this._gridMeshes=[];
    this._clearArcPreview();
    this._clearGhost();   // AQ
  }

  // Advance pulse animation on all visible grid cells + tick construction/upgrade timers
  update(dt) {
    if (this._gridMeshes.length) {
      this._gridTime = (this._gridTime || 0) + dt;
      for (const m of this._gridMeshes) {
        m.material.uniforms.uTime.value = this._gridTime;
      }
    }

    // AJ: Tick construction timers for all player islands
    const st = this._state;
    this._islands.filter(isl => isl.own === 'player').forEach(isl => {
      const instances = st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst => {
        if(inst.state === 'moving') return;
        if(inst.state === 'building' && inst.buildTimer > 0){
          inst.buildTimer -= dt;
          this._syncProgRing(inst, 1 - inst.buildTimer / (inst.buildDuration || 1), 0xe8b840); // brass = build
          if(inst.buildTimer <= 0){
            inst.state = 'active';
            inst.buildTimer = 0;
            // Restore full opacity when construction finishes
            if(inst.mesh) inst.mesh.traverse(c => {
              if(!c.isMesh) return;
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              mats.forEach(m => { if(m){ m.opacity=1; m.transparent=false; } });
            });
            this._bus.emit('building:ready', { instance:inst, island:isl });
            this.recalcWarehouse();
          }
        }
        // AJ: Tick upgrade timers
        if(inst.upgradeTimer > 0){
          inst.upgradeTimer -= dt;
          this._syncProgRing(inst, 1 - inst.upgradeTimer / (inst.upgradeDuration || 1), 0x70c0e0); // teal = upgrade
          if(inst.upgradeTimer <= 0){
            inst.upgradeTimer = 0;
            this._completeUpgrade(inst, isl);
          }
        }
      });
    });
  
    // AN/G4: sweep rings whose instance finished / was destroyed / moved
    if(this._progRings.size){
      for(const [id, r] of this._progRings){
        const inst = r.inst;
        const live = inst && inst.state !== 'destroyed' && inst.state !== 'moving'
          && ((inst.state === 'building' && inst.buildTimer > 0) || inst.upgradeTimer > 0);
        if(!live) this._removeProgRing(id, r);
      }
    }
  }

  _syncProgRing(inst, prog, colHex){
    if(!inst.instanceId || !inst.mesh) return;
    let r = this._progRings.get(inst.instanceId);
    if(!r){
      r = makeProgRing(colHex);
      r.inst = inst;
      this._scene.add(r.grp);
      this._progRings.set(inst.instanceId, r);
    }
    r.mat.uniforms.uCol.value.setHex(colHex);
    r.mat.uniforms.uProg.value = Math.max(0, Math.min(1, prog));
    const mp = inst.mesh.position;
    r.grp.position.set(mp.x, mp.y + 0.30, mp.z);
  }

  _removeProgRing(id, r){
    r = r || this._progRings.get(id);
    if(!r) return;
    this._scene.remove(r.grp);
    r.mat.dispose();                       // geometry is shared — never disposed
    r.grp.children.forEach(c => { if(c.material !== r.mat) c.material.dispose(); });
    this._progRings.delete(id);
  }

  _completeUpgrade(inst, isl){
    if(!inst.pendingLevel) return;
    inst.level = inst.pendingLevel;
    inst.pendingLevel = null;
    const bldDef = [...BUILDINGS, ...DEFENSES].find(b => b.id === inst.buildingId);
    if(bldDef){
      const hpRatio = inst.maxHp > 0 ? inst.hp / inst.maxHp : 1;
      inst.maxHp = bldDef.hpByLevel[inst.level - 1];
      inst.hp = Math.round(inst.maxHp * hpRatio);
      if(inst.isDefense){
        const stats = DEFENSES.find(d => d.id === inst.buildingId);
        if(stats){
          const lv = inst.level - 1;
          inst.damage    = stats.damageByLevel[lv];
          inst.range     = stats.rangeByLevel[lv];
          inst.accuracy  = stats.accuracyByLevel[lv];
          inst.reloadSec = stats.reloadSecByLevel[lv];
        }
      }
    }
    this._bus.emit('building:upgraded', { instance:inst, island:isl });
    this.recalcWarehouse();
  }


  // ── AQ: SC2-style placement ghost ──────────────────────────────
  // Semi-transparent preview of the ACTUAL building mesh follows the
  // cursor, snapped to the hovered cell; green = placeable, red = not.
  // One shared material (colour flipped per state) — zero per-frame alloc.
  _ensureGhost(def){
    if(this._ghost && this._ghostFor === def.id) return;
    this._clearGhost();
    if(!this._ghostMat){
      this._ghostMat = new THREE.MeshBasicMaterial({
        transparent:true, opacity:.55, depthWrite:false, blending:THREE.AdditiveBlending });  // hologram glow
      this._ghostEdgeMat = new THREE.LineBasicMaterial({ transparent:true, opacity:.9 });
    }
    const grp = new THREE.Group();
    const geo = def.model === 'cylinder'
      ? new THREE.CylinderGeometry(.7, 1, 1.5, 8)
      : new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const msh = new THREE.Mesh(geo, this._ghostMat);
    msh.renderOrder = 14;
    // Dark edge outline — keeps the ghost legible over same-hue terrain
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this._ghostEdgeMat);
    edge.renderOrder = 15;
    grp.add(msh); grp.add(edge);
    grp.visible = false;
    this._scene.add(grp);
    this._ghost = grp;
    this._ghostFor = def.id;
  }

  _clearGhost(){
    if(!this._ghost) return;
    this._scene.remove(this._ghost);
    this._ghost.traverse(c => { if(c.isMesh) c.geometry?.dispose(); });  // material is shared — keep
    this._ghost = null;
    this._ghostFor = null;
  }

  hoverAt(wx,wz){
    const st=this._state;
    const bldOrDef=st.selectedBuilding||st.selectedDefense;
    const fp=this._effectiveFP(bldOrDef);
    let hoveredKey=null, hoveredCell=null;
    this._gridMeshes.forEach(m=>{
      const dx=wx-m.userData.cx, dz=wz-m.userData.cz;
      if(Math.abs(dx)<BUILD_CELL_WORLD/2 && Math.abs(dz)<BUILD_CELL_WORLD/2){ hoveredKey=m.userData.key; hoveredCell=m.userData; }
    });
    const curIsl=this._curHoverIsl||this._islands[0];
    const canAffordOrMove = !bldOrDef || st._moveMode
      || (st.resWood>=((bldOrDef.cost&&bldOrDef.cost.wood)||0)
        && st.resGold>=((bldOrDef.cost&&bldOrDef.cost.gold)||0));
    const footprintValid=hoveredKey&&bldOrDef
      &&canAffordOrMove
      &&this.canPlaceFootprint(curIsl,hoveredKey,fp);
    const [hAcol,hArow]=hoveredKey?hoveredKey.split('_').map(Number):[-1,-1];
    const fpKeys=new Set();
    if(hoveredKey&&bldOrDef){
      for(let dr=0;dr<fp.h;dr++) for(let dc=0;dc<fp.w;dc++) fpKeys.add(`${hAcol+dc}_${hArow+dr}`);
    }
    // AQ ghost: snap to footprint CENTRE, tint by validity, follow R-rotation
    if(bldOrDef && hoveredCell){
      this._ensureGhost(bldOrDef);
      const offX=(fp.w-1)/2*BUILD_CELL_WORLD, offZ=(fp.h-1)/2*BUILD_CELL_WORLD;
      this._ghost.position.set(hoveredCell.cx+offX, 2.4, hoveredCell.cz+offZ);
      this._ghost.rotation.y = st.buildRotated ? Math.PI/2 : 0;
      this._ghostMat.color.setHex(footprintValid ? 0x35ff6a : 0xff3322);
      this._ghostEdgeMat.color.setHex(footprintValid ? 0x06381a : 0x4a0c06);
      this._ghost.visible = true;
    } else if(this._ghost){ this._ghost.visible = false; }

    this._gridMeshes.forEach(m=>{
      const occ=m.userData.occupied;
      const inFP=fpKeys.has(m.userData.key);
      const u=m.material.uniforms;
      if(inFP){ u.uColor.value.setHex(footprintValid?0x00ff44:0xff2200); u.uOpacity.value=0.92; }
      else if(occ){ u.uColor.value.setHex(0xff4433); u.uOpacity.value=0.42; }
      else { u.uColor.value.setHex(0x44ff66); u.uOpacity.value=0.16; }
    });

    // Defense arc preview — show at hovered cell with current facing
    if (st.selectedDefense && hoveredKey) {
      const hM = this._gridMeshes.find(m => m.userData.key === hoveredKey);
      if (hM) {
        const stats  = getDefenseStats(st.selectedDefense, 1);
        const range  = stats.range || 15;
        const arcDeg = st.selectedDefense.arcDeg ?? 360;
        const facing = st.buildFacingDeg !== 0
          ? st.buildFacingDeg
          : this._defaultFacing(this._curHoverIsl || this._islands[0]);
        this._showArcPreview(hM.userData.cx, hM.userData.cz, arcDeg, range, facing);
      }
    } else {
      this._clearArcPreview();
    }
  }

  tryBuildAt(wx, wz, isl){
    const st=this._state;
    const bldOrDef = st.selectedBuilding || st.selectedDefense;
    if(!bldOrDef) return;

    // Find clicked cell
    let clickedMesh=null;
    for(const m of this._gridMeshes){
      const dx=wx-m.userData.cx, dz=wz-m.userData.cz;
      if(Math.abs(dx)<BUILD_CELL_WORLD/2 && Math.abs(dz)<BUILD_CELL_WORLD/2){ clickedMesh=m; break; }
    }
    if(!clickedMesh) return;
    if(clickedMesh.userData.occupied){
      // Show info for occupied cell instead of silently failing
      const instances=st.islandBuildings[isl.def.id]||[];
      const inst=instances.find(i=>i.gridKey===clickedMesh.userData.key&&i.state!=='destroyed'&&i.state!=='moving');
      if(inst) this._bus.emit('building:cell_clicked',{instance:inst,island:isl});
      return;
    }

    // Bug 7: validate full footprint fits in grid without overlap
    const fp=this._effectiveFP(bldOrDef);
    if(!this.canPlaceFootprint(isl, clickedMesh.userData.key, fp)){
      const hint=document.getElementById('build-hint');
      if(hint){hint.innerHTML='🔴 Not enough space for this building!';setTimeout(()=>{if(st.buildMode)hint.innerHTML=`🏗 ${bldOrDef.icon} <b>${bldOrDef.name}</b><br><small>Click a 🟩 cell</small>`;},1800);}
      return;
    }

    const cost=bldOrDef.cost||{};
    // _moveMode: player is relocating an existing building — no resource cost
    if(!st._moveMode){
      if(st.resWood<(cost.wood||0)||st.resGold<(cost.gold||0)){
        const hint=document.getElementById('build-hint');
        if(hint){hint.innerHTML='🔴 Not enough resources!';setTimeout(()=>{if(st.buildMode)hint.innerHTML=`🏗 ${bldOrDef.icon} <b>${bldOrDef.name}</b><br><small>Click a 🟩 cell</small>`;},1800);}
        return;
      }
      st.resWood-=(cost.wood||0); st.resGold-=(cost.gold||0);
    }
    const movingInst = st._moveMode ? (st._movingInst || null) : null;
    st._moveMode = false;
    st._movingInst = null;

    // Create instance with full footprint tracking
    const inst=createBuildingInstance(bldOrDef, clickedMesh.userData.key, clickedMesh.userData.cx, clickedMesh.userData.cz);
    inst.footprint={...fp};
    inst.rotated=this._state.buildRotated;
    const [anchorCol,anchorRow]=clickedMesh.userData.key.split('_').map(Number);
    inst.gridX=anchorCol; inst.gridY=anchorRow;
    inst.armor=0;

    const restoreMovedState = () => {
      if(!movingInst) return;
      inst.instanceId  = movingInst.instanceId;
      inst.level       = movingInst.level;
      inst.maxHp       = movingInst.maxHp;
      inst.hp          = movingInst.hp;
      inst.state       = movingInst.prevState || 'active';
      if(movingInst.buildTimer != null) inst.buildTimer = movingInst.buildTimer;
      if(movingInst.buildDuration != null) inst.buildDuration = movingInst.buildDuration;
      if(movingInst.pendingLevel != null) inst.pendingLevel = movingInst.pendingLevel;
      if(movingInst.upgradeTimer != null) inst.upgradeTimer = movingInst.upgradeTimer;
      if(movingInst.upgradeDuration != null) inst.upgradeDuration = movingInst.upgradeDuration;
      if(movingInst.facingDeg != null) inst.facingDeg = movingInst.facingDeg;
      if(movingInst.armTimer != null) inst.armTimer = movingInst.armTimer;
      if(movingInst.warnTimer != null) inst.warnTimer = movingInst.warnTimer;
      if(movingInst.fireTimer  != null) inst.fireTimer  = movingInst.fireTimer;
      if(movingInst.cooldownTimer != null) inst.cooldownTimer = movingInst.cooldownTimer;
    };
    restoreMovedState();

    if(bldOrDef.isDefense){
      const stats=getDefenseStats(bldOrDef,movingInst ? movingInst.level : 1);
      Object.assign(inst,stats);
      inst.isDefense=true;
      inst.fireTimer=(stats.reloadSec||6);
      inst.state=bldOrDef.id==='deadmans_lure'?'inactive':'active';
      inst.triggerRadius=bldOrDef.triggerRadius||null;
      inst.armTimer=2; inst.warnTimer=3; inst.cooldownTimer=0;
      // Use player-chosen facing (Q/E) if set, otherwise default toward enemy
      const playerFacing = this._state.buildFacingDeg;
      inst.facingDeg = (playerFacing !== 0) ? playerFacing : this._defaultFacing(isl);
      this._state.buildFacingDeg = 0; // reset after placement
      restoreMovedState();
    }

    // AJ: Construction timer — building starts in 'building' state until timer expires.
    // Moved instances skip construction (they're already built).
    if(!movingInst && (bldOrDef.buildTime || 0) > 0){
      inst.state = 'building';
      inst.buildTimer = bldOrDef.buildTime * BUILD_TIME_MULT;
      inst.buildDuration = inst.buildTimer;
    }

    inst.mesh=this._spawnMesh(bldOrDef,{x:clickedMesh.userData.cx,z:clickedMesh.userData.cz});
    // Dim mesh while under construction — clone each material first to avoid mutating shared materials
    if(inst.state === 'building') inst.mesh.traverse(c => {
      if(c.isMesh && c.material){
        c.material = Array.isArray(c.material)
          ? c.material.map(m => { const mc=m.clone(); mc.opacity=0.45; mc.transparent=true; return mc; })
          : (() => { const mc=c.material.clone(); mc.opacity=0.45; mc.transparent=true; return mc; })();
      }
    });

    if(!Array.isArray(st.islandBuildings[isl.def.id])) st.islandBuildings[isl.def.id]=[];
    if(movingInst?.source){
      const sourceList = st.islandBuildings[movingInst.islandId || isl.def.id] || [];
      const idx = sourceList.indexOf(movingInst.source);
      if(idx !== -1) sourceList.splice(idx, 1);
      if(movingInst.source.mesh){
        this._scene.remove(movingInst.source.mesh);
        this._disposeMesh(movingInst.source.mesh);
        movingInst.source.mesh = null;
      }
    }
    st.islandBuildings[isl.def.id].push(inst);

    // Mark ALL footprint cells as occupied
    for(let dr=0;dr<fp.h;dr++) for(let dc=0;dc<fp.w;dc++){
      const key=`${anchorCol+dc}_${anchorRow+dr}`;
      const cellMesh=this._gridMeshes.find(m=>m.userData.key===key);
      if(cellMesh){cellMesh.userData.occupied=true;cellMesh.material.uniforms.uColor.value.setHex(0xff4433);cellMesh.material.uniforms.uOpacity.value=0.70;}
    }

    this._bus.emit('building:placed',{building:bldOrDef,instance:inst,island:isl});
    st.selectedBuilding=null; st.selectedDefense=null; st.buildMode=false;
    st.buildRotated=false;
    this.clearGrid();
    const hint=document.getElementById('build-hint');
    if(hint) hint.style.display='none';
  }

  // ── ECONOMY TICK ─────────────────────────────────────────────
  cancelMove(){
    const st = this._state;
    const movingInst = st._movingInst;
    if(movingInst?.source){
      movingInst.source.state = movingInst.prevState || 'active';
      if(movingInst.source.mesh){
        movingInst.source.mesh.visible = true;
        if(!movingInst.source.mesh.parent) this._scene.add(movingInst.source.mesh);
      }
    }
    st._moveMode = false;
    st._movingInst = null;
    this.recalcWarehouse();
  }

  _disposeMesh(mesh){
    mesh.traverse(c => {
      c.geometry?.dispose();
      if(c.material){
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { m.map?.dispose(); m.dispose(); });
      }
    });
  }

  /** Returns {woodRate, goldRate} per second from player-owned island buildings.
   *  Does NOT mutate state — EconomySystem applies and clamps. */

  // ── AP: Island trait production multiplier ─────────────────────
  _traitMult(isl, bldId){
    const t = ISLAND_TRAITS[isl?.def?.trait];
    if(!t) return 1;
    if(bldId === 'lumber_mill' && t.woodMult) return t.woodMult;
    if(bldId === 'gold_mine'   && t.goldMult) return t.goldMult;
    return 1;
  }

  // ── AP: Adjacency bonus — placement as a strategic decision ────
  // Producers (mill/mine) gain +10% per DISTINCT same-type neighbour
  // instance sharing an orthogonal edge, capped at +30%. Computed from
  // gridKey + footprint (the same cell model _occupiedKeys uses), so
  // multi-cell footprints count edge contact on any of their cells.
  getAdjacencyMult(inst, isl){
    if(!inst?.gridKey) return 1;
    if(inst.buildingId !== 'lumber_mill' && inst.buildingId !== 'gold_mine') return 1;
    const instances = (this._state.islandBuildings[isl.def.id] || [])
      .filter(i => i.state === 'active' && i.gridKey);

    // cellKey → owning instance (footprint-expanded)
    const cellOwner = new Map();
    const cellsOf = (i) => {
      const fp = i.footprint || { w:1, h:1 };
      const [c, r] = i.gridKey.split('_').map(Number);
      const out = [];
      for(let dr = 0; dr < fp.h; dr++)
        for(let dc = 0; dc < fp.w; dc++) out.push(`${c+dc}_${r+dr}`);
      return out;
    };
    instances.forEach(i => cellsOf(i).forEach(k => cellOwner.set(k, i)));

    const neighbours = new Set();
    cellsOf(inst).forEach(k => {
      const [c, r] = k.split('_').map(Number);
      [[c+1,r],[c-1,r],[c,r+1],[c,r-1]].forEach(([nc, nr]) => {
        const o = cellOwner.get(`${nc}_${nr}`);
        if(o && o !== inst && o.buildingId === inst.buildingId)
          neighbours.add(o.instanceId);
      });
    });
    return 1 + 0.10 * Math.min(neighbours.size, 3);
  }

  getProductionRates(){
    const st=this._state;
    let woodRate=0, goldRate=0;
    this._islands.filter(isl => isl.own === 'player').forEach(isl=>{
      const instances=st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst=>{
        if(inst.state==='destroyed' || inst.state==='building' || inst.state==='moving') return; // no production while unavailable
        const bldDef=BUILDINGS.find(b=>b.id===inst.buildingId);
        if(!bldDef) return;
        let prod=getBuildingProduction(bldDef, inst.level);
        if(prod<=0) return;
        prod *= this.getAdjacencyMult(inst, isl) * this._traitMult(isl, bldDef.id);  // AP
        if(bldDef.id==='lumber_mill') woodRate+=prod;
        if(bldDef.id==='gold_mine')   goldRate+=prod;
      });
    });
    return {woodRate, goldRate};
  }

  // AN/G2: per-instance producer list — EconomySystem uses it to spawn
  // "+N 🪵 / 🪙" floating income ticks above each working building.
  getProducingInstances(){
    const st=this._state, out=[];
    this._islands.filter(isl => isl.own === 'player').forEach(isl=>{
      const instances=st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst=>{
        if(inst.state==='destroyed' || inst.state==='building' || inst.state==='moving') return;
        const bldDef=BUILDINGS.find(b=>b.id===inst.buildingId);
        if(!bldDef) return;
        let prod=getBuildingProduction(bldDef, inst.level);
        prod *= this.getAdjacencyMult(inst, isl) * this._traitMult(isl, bldDef.id);  // AP
        if(prod>0) out.push({inst, id:bldDef.id, prod, isl});
      });
    });
    return out;
  }

  // Keep old name as alias for backwards compat — but now returns rates
  tickProduction(dt, capW, capG){
    // No-op: EconomySystem now calls getProductionRates() directly
  }

  // ── UPGRADE ──────────────────────────────────────────────────
  // AJ: Upgrade is now async — starts timer, building continues at current level.
  upgradeInstance(inst, isl){
    const st=this._state;
    if(inst.level>=10) return false;
    if(inst.state==='building' || inst.state==='moving') return false;     // can't upgrade while unavailable
    if(inst.upgradeTimer > 0)   return false;     // already upgrading
    const bldDef=[...BUILDINGS,...DEFENSES].find(b=>b.id===inst.buildingId);
    if(!bldDef) return false;
    const upgCost={wood:(bldDef.cost.wood||0)*(inst.level), gold:(bldDef.cost.gold||0)*(inst.level)};
    if(st.resWood<upgCost.wood||st.resGold<upgCost.gold) return false;
    st.resWood-=upgCost.wood; st.resGold-=upgCost.gold;
    // Start timer — building keeps current level until done
    inst.pendingLevel = inst.level + 1;
    inst.upgradeTimer = (bldDef.upgradeTime || 30) * BUILD_TIME_MULT;
    inst.upgradeDuration = inst.upgradeTimer;
    return true;
  }

  // ── WAREHOUSE CAPS ───────────────────────────────────────────
  recalcWarehouse(){
    const st=this._state;
    let capBonus=0, protBonus=0, labLevel=0;
    // Check all player-owned islands
    this._islands.filter(i=>i.own==='player').forEach(isl=>{
      const instances=st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst=>{
        if(inst.state==='destroyed' || inst.state==='moving') return;
        if(inst.buildingId==='warehouse'){
          const bldDef=BUILDINGS.find(b=>b.id==='warehouse');
          if(bldDef){
            capBonus+=bldDef.capacityByLevel[inst.level-1]||0;
            protBonus+=bldDef.protectedByLevel[inst.level-1]||0;
          }
        }
        if(inst.buildingId==='research_lab'){
          const bldDef=BUILDINGS.find(b=>b.id==='research_lab');
          if(bldDef){
            const lv=bldDef.labLevelByLevel?.[inst.level-1]||inst.level;
            labLevel=Math.max(labLevel,lv);
          }
        }
      });
    });
    st._warehouseCapBonus = capBonus;
    st._warehouseProtected = protBonus;
    st.labLevel = labLevel;
  }

  // ── MESH ────────────────────────────────────────────────────

  // ── AP: Neutral starter buildings ───────────────────────────────
  // Neutral islands spawn with 1–2 dormant level-1 producers matched to
  // their trait. Production only counts player-owned islands, so they
  // contribute NOTHING until captured — a visible, scoutable expansion
  // reward (the new IslandPanel lists buildings on any island).
  // Idempotent via st._neutralSeeded — safe for future save/load replays.
  seedNeutralStarters(){
    const st = this._state;
    if (st._neutralSeeded) return;
    st._neutralSeeded = true;

    this._islands.filter(i => i.own === 'neutral').forEach(isl => {
      const trait = isl.def.trait;
      const wanted =
        trait === 'timber'   ? ['lumber_mill', 'lumber_mill'] :
        trait === 'goldvein' ? ['gold_mine',   'gold_mine'  ] :
        trait === 'haven'    ? ['lumber_mill'               ] :
                               ['lumber_mill', 'gold_mine'  ];

      const occupied = this._occupiedKeys(isl);
      const free = this._cells(isl).filter(c => !occupied.has(c.key));
      // deterministic-ish spread: pick from shuffled copy
      for (let n = free.length - 1; n > 0; n--) {
        const j = Math.floor(Math.random() * (n + 1));
        [free[n], free[j]] = [free[j], free[n]];
      }

      wanted.forEach(bldId => {
        const cell = free.pop();
        if (!cell) return;
        const bldDef = BUILDINGS.find(b => b.id === bldId);
        if (!bldDef) return;
        const hp = (bldDef.hpByLevel && bldDef.hpByLevel[0]) || 60;
        const inst = {
          instanceId: 'neu_bld_' + Math.random().toString(36).slice(2, 8),
          buildingId: bldId,
          level: 1,
          hp, maxHp: hp,
          gridKey: cell.key,
          worldX: cell.cx, worldZ: cell.cz,
          state: 'active',
          isDefense: false,
          footprint: { w: 1, h: 1 },
          rotated: false,
          upgradeTimer: 0,
        };
        inst.mesh = this._spawnMesh(bldDef, { x: cell.cx, z: cell.cz });
        if (!Array.isArray(st.islandBuildings[isl.def.id])) st.islandBuildings[isl.def.id] = [];
        st.islandBuildings[isl.def.id].push(inst);
        occupied.add(cell.key);
      });
    });
  }

  _spawnMesh(bldOrDef, pos){
    // AQ fix: y=1.2 buried meshes INSIDE the island (deck sits ~2.0,
    // grid plane at 2.2) — buildings & neutral starter mills were invisible.
    const grp=new THREE.Group(); grp.position.set(pos.x,2.35,pos.z);
    const mat=new THREE.MeshStandardMaterial({color:bldOrDef.color||0x8b7355,roughness:.8});
    const msh=bldOrDef.model==='cylinder'
      ? new THREE.Mesh(new THREE.CylinderGeometry(.7,1,1.5,8),mat)
      : new THREE.Mesh(new THREE.BoxGeometry(1.4,1.4,1.4),mat);
    msh.castShadow=true; grp.add(msh);
    const sc=document.createElement('canvas'); sc.width=64; sc.height=32;
    const sx=sc.getContext('2d'); sx.fillStyle='rgba(0,0,0,.6)'; sx.fillRect(0,0,64,32);
    sx.font='18px serif'; sx.fillStyle='#fff'; sx.textAlign='center'; sx.fillText(bldOrDef.icon,32,24);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(sc),transparent:true,depthTest:false}));
    sp.scale.set(2,.8,1); sp.position.y=1.5; grp.add(sp);
    this._scene.add(grp); return grp;
  }

  // Fix L2c: find building at world pos (checks all footprint cells)
  findInstanceAt(wx, wz, isl){
    for(const m of this._gridMeshes){
      const dx=wx-m.userData.cx, dz=wz-m.userData.cz;
      if(Math.abs(dx)<BUILD_CELL_WORLD/2 && Math.abs(dz)<BUILD_CELL_WORLD/2){
        const instances=this._state.islandBuildings[isl.def.id]||[];
        return this._findInstanceByFootprintKey(instances, m.userData.key)||null;
      }
    }
    return null;
  }

  _findInstanceByFootprintKey(instances, gridKey){
    for(const inst of instances){
      if(inst.state==='destroyed' || inst.state==='moving') continue;
      const fp=inst.footprint||{w:1,h:1};
      const [ac,ar]=(inst.gridKey||'0_0').split('_').map(Number);
      for(let dr=0;dr<fp.h;dr++) for(let dc=0;dc<fp.w;dc++){
        if(`${ac+dc}_${ar+dr}`===gridKey) return inst;
      }
    }
    return null;
  }

  getOccupiedCellCount(isl){ return this._occupiedKeys(isl).size; }

  /** Total protected stock amount for any island (based on its warehouse buildings). */
  getIslandProtectedAmount(isl){
    const instances = this._state.islandBuildings[isl.def.id] || [];
    let prot = 0;
    const whDef = BUILDINGS.find(b => b.id === 'warehouse');
    if (!whDef) return 0;
    instances.forEach(inst => {
      if(inst.state === 'destroyed' || inst.state === 'moving' || inst.buildingId !== 'warehouse') return;
      prot += whDef.protectedByLevel[inst.level - 1] || 0;
    });
    return prot;
  }

}
