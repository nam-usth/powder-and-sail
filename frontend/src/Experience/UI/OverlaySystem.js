import * as THREE from 'three';
import { CANNONS, CANNON_BY_ID } from '../../data/cannons.js';
import { getCannonFillCol, getCannonLineCol } from '../../data/cannons.js';
import { HULL_SLOTS } from '../../data/ships.js';
import { RANGE_U } from '../../data/constants.js';
import { resolveArc } from '../Systems/Combat/CombatSystem.js';
import { ringEdgeMat, ringFillMat, RING_RENDER_ORDER, RING_Y } from '../Utils/RingMaterial.js';

// ── Mesh-based arc helpers (same visual weight as full RingGeometry) ──
// All geometry is built flat in the XZ plane (y=0); caller sets position.y.
// Game angle convention: sin(a)=X, cos(a)=Z, 0=north, clockwise.

// Thick arc band — like a partial RingGeometry
function arcRingGeo(R, thickness, aStart, aEnd, steps) {
  const inner = R - thickness;
  const verts = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const a = aStart + (i / steps) * (aEnd - aStart);
    const s = Math.sin(a), c = Math.cos(a);
    verts.push(s * inner, 0, c * inner,
               s * R,     0, c * R);
    if (i < steps) {
      const b = i * 2;
      idx.push(b, b+2, b+1,  b+1, b+2, b+3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}

// Two thin radial arms from origin outward (sector side lines)
function radialArmsGeo(R, aStart, aEnd, w = 0.10) {
  const arm = (a) => {
    const s = Math.sin(a), c = Math.cos(a);
    const px = -c * w, pz = s * w; // perpendicular offset
    return [
       px,       0,  pz,
      -px,       0, -pz,
      s*R + px,  0, c*R + pz,
      s*R - px,  0, c*R - pz,
    ];
  };
  const v = [...arm(aStart), ...arm(aEnd)];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex([0,2,1, 1,2,3,  4,6,5, 5,6,7]);
  return geo;
}

export class OverlaySystem {
  constructor(scene, state){
    this._scene=scene; this._state=state;
    this._data=[];          // ship overlays
    this._defenseRings=[];  // {instanceId, mesh}
    this._fortRings=[];     // {islId, mesh}
  }
  build(ship){
    this.remove(ship);
    const slots=HULL_SLOTS[ship.hull]||[], gs=[], st=this._state;
    slots.forEach(slotId=>{
      const cid=ship.loadout[slotId];if(!cid)return;
      const cn=CANNON_BY_ID.get(cid);if(!cn)return;
      const arc=resolveArc(cn,slotId),R=RANGE_U[cn.rt];
      const fc=getCannonFillCol(cid),lc=getCannonLineCol(cid);
      const grp=new THREE.Group();
      // Helper: find fill/edge by userData tag — immune to add() order
      const applyFillMode = (grp, filled) => {
        grp.traverse(ch => {
          if(ch.userData.role === 'fill') ch.visible = filled;
          if(ch.userData.role === 'edge' && ch.material) {
            ch.material.opacity = filled ? 0.75 : 1.0;
          }
        });
      };

      if(arc.w>=360){
        // Fill circle
        const m=new THREE.Mesh(new THREE.CircleGeometry(R,48), ringFillMat(fc, .15));
        m.rotation.x=-Math.PI/2; m.position.y=RING_Y; m.renderOrder=RING_RENDER_ORDER;
        m.userData.role='fill'; grp.add(m);
        // Edge ring — AdditiveBlending for natural glow
        const r2=new THREE.Mesh(new THREE.RingGeometry(R-.22,R,48), ringEdgeMat(lc, .75));
        r2.rotation.x=-Math.PI/2; r2.position.y=RING_Y; r2.renderOrder=RING_RENDER_ORDER;
        r2.userData.role='edge'; grp.add(r2);
      } else {
        const STEPS=Math.max(16,Math.round(arc.w/2)), hw=arc.w/2*Math.PI/180, cR=arc.c*Math.PI/180;
        const aStart=cR-hw, aEnd=cR+hw;

        // Fill sector (ShapeGeometry in XY → rotate to XZ)
        const pts=[new THREE.Vector2(0,0)];
        for(let i=0;i<=STEPS;i++){const a=aStart+(i/STEPS)*hw*2;pts.push(new THREE.Vector2(Math.sin(a)*R,Math.cos(a)*R));}
        const fm=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), ringFillMat(fc, .20));
        fm.rotation.x=-Math.PI/2; fm.position.y=RING_Y; fm.renderOrder=RING_RENDER_ORDER;
        fm.userData.role='fill'; grp.add(fm);

        // Edge: thick arc band (same visual weight as full rings)
        const arcMesh=new THREE.Mesh(arcRingGeo(R, 0.13, aStart, aEnd, STEPS), ringEdgeMat(lc, .75));
        arcMesh.position.y=RING_Y; arcMesh.renderOrder=RING_RENDER_ORDER;
        arcMesh.userData.role='edge'; grp.add(arcMesh);

        // Edge: two radial arms from center to arc endpoints
        const armMesh=new THREE.Mesh(radialArmsGeo(R, aStart, aEnd), ringEdgeMat(lc, .60));
        armMesh.position.y=RING_Y; armMesh.renderOrder=RING_RENDER_ORDER;
        armMesh.userData.role='edge'; grp.add(armMesh);
      }
      grp.visible=st.ovrOn&&ship.alive;
      if(st.ovrOn&&ship.alive){grp.position.set(ship.x,0,ship.z);grp.rotation.y=ship.angle;}
      // Apply fill mode — uses userData.role tag, not child index
      applyFillMode(grp, st.rangeFill !== false);
      this._scene.add(grp);gs.push(grp);
    });
    if(gs.length)this._data.push({ship,gs});
  }
  remove(ship){ for(let i=this._data.length-1;i>=0;i--){if(this._data[i].ship===ship){this._data[i].gs.forEach(g=>this._scene.remove(g));this._data.splice(i,1);}} }
  sync(ship){
    const e=this._data.find(e=>e.ship===ship);if(!e)return;
    if(!ship.alive){ e.gs.forEach(g=>g.visible=false); return; }  // always hide dead ships
    const st=this._state;
    // AW: broadside cones follow the SELECTED player ships even with the
    // overlay off (battle mode default; st.selArcs) — like the classic game.
    const sel = !st.ovrOn && st.selArcs && ship.team==='player' && st.selection.includes(ship);
    if(!st.ovrOn && !sel){ if(e._selVis){ e.gs.forEach(g=>g.visible=false); e._selVis=false; } return; }
    e._selVis = sel;
    e.gs.forEach(g=>{g.position.set(ship.x,0,ship.z);g.rotation.y=ship.angle;g.visible=true;});
  }
  setVisible(ship, vis){ const e=this._data.find(e=>e.ship===ship);if(e)e.gs.forEach(g=>g.visible=vis); }

  /**
   * Rebuild defense + fort range rings from current islands. Called when the
   * overlay toggle turns on, when buildings change, and when islands change owner.
   */
  rebuildStaticRings(islands){
    // Wipe existing
    this._defenseRings.forEach(r => this._scene.remove(r.mesh));
    this._defenseRings.length=0;
    this._fortRings.forEach(r => this._scene.remove(r.mesh));
    this._fortRings.length=0;

    const st=this._state;
    const show = !!st.ovrOn;

    islands.forEach(isl => {
      if(isl.own !== 'player') return;

      // 1) Fort ring (range = isl.r + 22 — matches CombatSystem._fortFire)
      if(!isl.down){
        const fortR = isl.r + 22;
        const fill = new THREE.Mesh(new THREE.CircleGeometry(fortR, 64), ringFillMat(0xc89060, .12));
        fill.rotation.x = -Math.PI/2;
        fill.position.set(isl.x, RING_Y, isl.z);
        fill.renderOrder = RING_RENDER_ORDER;
        fill.visible = show; fill.userData.role = 'fill';
        const ring = new THREE.Mesh(new THREE.RingGeometry(fortR - .28, fortR, 64), ringEdgeMat(0xd4a870, .80));
        ring.rotation.x = -Math.PI/2;
        ring.position.set(isl.x, RING_Y, isl.z);
        ring.renderOrder = RING_RENDER_ORDER;
        ring.visible = show; ring.userData.role = 'edge';
        const grp = new THREE.Group();
        grp.add(fill); grp.add(ring);
        this._scene.add(grp);
        this._fortRings.push({islId: isl.def.id, mesh: grp});
      }

      // 2) Defense rings per active instance
      const instances = st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst => {
        if(!inst.isDefense || inst.state === 'destroyed' || !inst.range) return;
        const R = inst.range;
        const wx = (inst.worldX != null) ? inst.worldX : (inst.x != null ? inst.x : isl.x);
        const wz = (inst.worldZ != null) ? inst.worldZ : (inst.z != null ? inst.z : isl.z);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 48), ringFillMat(0x60a8c8, .12));
        fill.rotation.x = -Math.PI/2;
        fill.position.set(wx, RING_Y, wz);
        fill.renderOrder = RING_RENDER_ORDER;
        fill.visible = show; fill.userData.role = 'fill';
        const ring = new THREE.Mesh(new THREE.RingGeometry(R - .22, R, 48), ringEdgeMat(0x70c0e0, .80));
        ring.rotation.x = -Math.PI/2;
        ring.position.set(wx, RING_Y, wz);
        ring.renderOrder = RING_RENDER_ORDER;
        ring.visible = show; ring.userData.role = 'edge';
        const grp = new THREE.Group();
        grp.add(fill); grp.add(ring);
        this._scene.add(grp);
        this._defenseRings.push({instanceId: inst.instanceId, mesh: grp});
      });
    });
  }

  // ── AN/G3: Tactical view (hold Alt) ─────────────────────────────
  // Shows EVERYTHING the Tab overlay shows, PLUS enemy/neutral fort &
  // defense ranges (built on demand, disposed on release). Player rings
  // reuse the static set — only their visibility is forced.
  setTactical(on, islands){
    if(!!this._tacticalOn === !!on) return;
    this._tacticalOn = !!on;
    const st = this._state;

    if(on){
      // force-show player static rings + ship arcs regardless of st.ovrOn
      this._setStaticVisible(true);
      this._data.forEach(e=>{
        if(!e.ship.alive) return;
        e.gs.forEach(g=>{ g.visible=true; g.position.set(e.ship.x,0,e.ship.z); g.rotation.y=e.ship.angle; });
      });
      // temp rings: enemy = red, neutral = grey
      this._tacRings = [];
      (islands||[]).forEach(isl=>{
        if(isl.own === 'player') return;
        const enemy = isl.own === 'enemy';
        const edge  = enemy ? 0xd05848 : 0x8a98a8;
        const fillC = enemy ? 0xb04030 : 0x70808e;
        const addRing = (x, z, R) => {
          const grp = new THREE.Group();
          const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 48), ringFillMat(fillC, .10));
          const ring = new THREE.Mesh(new THREE.RingGeometry(R-.24, R, 48), ringEdgeMat(edge, .78));
          [fill, ring].forEach(m=>{ m.rotation.x=-Math.PI/2; m.position.set(x, RING_Y, z); m.renderOrder=RING_RENDER_ORDER; grp.add(m); });
          this._scene.add(grp); this._tacRings.push(grp);
        };
        if(!isl.down) addRing(isl.x, isl.z, isl.r + 22);          // fort range (matches _fortFire)
        const instances = st.islandBuildings[isl.def.id];
        if(Array.isArray(instances)) instances.forEach(inst=>{
          if(!inst.isDefense || inst.state==='destroyed' || !inst.range) return;
          addRing(inst.worldX ?? isl.x, inst.worldZ ?? isl.z, inst.range);
        });
      });
      const legend=document.getElementById('range-legend');
      if(legend) legend.classList.add('visible');
    } else {
      (this._tacRings||[]).forEach(grp=>{
        this._scene.remove(grp);
        grp.children.forEach(c=>{ c.geometry.dispose(); c.material.dispose(); });
      });
      this._tacRings = null;
      // restore Tab-toggle state
      this._setStaticVisible(!!st.ovrOn);
      this._data.forEach(e=>{ e.gs.forEach(g=>{ g.visible = !!st.ovrOn && e.ship.alive; }); });
      const legend=document.getElementById('range-legend');
      if(legend) legend.classList.toggle('visible', !!st.ovrOn);
    }
  }

  _setStaticVisible(show){
    this._defenseRings.forEach(r => { r.mesh.visible = show; r.mesh.children.forEach(c => c.visible = show); });
    this._fortRings.forEach(r =>    { r.mesh.visible = show; r.mesh.children.forEach(c => c.visible = show); });
  }

  toggle(){
    const st=this._state; st.ovrOn=!st.ovrOn;
    // Ship overlays
    this._data.forEach(e=>{const show=st.ovrOn&&e.ship.alive;e.gs.forEach(g=>{g.visible=show;if(show){g.position.set(e.ship.x,0,e.ship.z);g.rotation.y=e.ship.angle;}});});
    // Static overlays (defenses + forts)
    this._setStaticVisible(st.ovrOn);
    const legend=document.getElementById('range-legend');if(legend)legend.classList.toggle('visible',st.ovrOn);
  }

  // Show or hide fill meshes (child index 0 of each group = fill, index 1 = edge)
  // Called by graphics settings "Range display" toggle
  setFillVisible(visible) {
    const ovrOn = this._state.ovrOn;
    const applyGroup = (g) => {
      g.traverse(ch => {
        if(ch.userData.role === 'fill') {
          ch.visible = ovrOn && visible;
        }
        if(ch.userData.role === 'edge' && ch.material) {
          // Edge-only mode: slightly brighter; fill mode: slightly dimmer
          // AdditiveBlending is always on (set by ringEdgeMat) — just tweak opacity
          ch.material.opacity = visible ? 0.75 : 1.0;
          ch.material.needsUpdate = true;
        }
      });
    };
    this._data.forEach(e => e.gs.forEach(g => applyGroup(g)));
    this._fortRings.forEach(r    => applyGroup(r.mesh));
    this._defenseRings.forEach(r => applyGroup(r.mesh));
    this._state.rangeFill = visible;
  }
}
