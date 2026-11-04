import * as THREE from 'three';
import { AURA_LEVELS } from '../../../data/constants.js';
import { ringEdgeMat, ringFillMat, ringLineMat, RING_RENDER_ORDER, RING_Y } from '../../Utils/RingMaterial.js';

// Per-shipyard aura constants
const SHIPYARD_AURA_RADIUS = 18;   // world units around each shipyard
const SHIPYARD_AURA_RATE   = 5;    // HP/s base regen (scales gently with level)

export class AuraSystem {
  constructor(scene, state, islands, vfx){
    this._scene=scene; this._state=state; this._islands=islands; this._vfx=vfx;
    this._shipyardRings = [];  // {instanceId, mesh}
    this.rebuild();
  }

  // Solid pulsing ring (fill) — always above ocean
  _ring(isl, r, col, op, _y){
    const m=new THREE.Mesh(
      new THREE.RingGeometry(r-.6, r, 64),
      ringEdgeMat(col, op)
    );
    m.rotation.x=-Math.PI/2; m.position.set(isl.x, RING_Y, isl.z);
    m.renderOrder=RING_RENDER_ORDER;
    this._scene.add(m); return m;
  }

  // Dashed boundary circle showing exact aura range limit
  _dashedRing(isl, R, col, _y){
    const grp=new THREE.Group();
    const STEPS=72, DASH=5, GAP=2; let pts=[];
    for(let i=0;i<=STEPS;i++){
      const seg=i%(DASH+GAP), a=(i/STEPS)*Math.PI*2;
      if(seg<DASH){
        pts.push(new THREE.Vector3(Math.sin(a)*R, RING_Y, Math.cos(a)*R));
      } else if(pts.length>1){
        const ln=new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([...pts]),
          ringLineMat(col, .80)
        );
        ln.renderOrder=RING_RENDER_ORDER;
        grp.add(ln); pts=[];
      }
    }
    if(pts.length>1){
      const ln=new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([...pts]),
        ringLineMat(col, .80)
      );
      ln.renderOrder=RING_RENDER_ORDER;
      grp.add(ln);
    }
    grp.position.set(isl.x, 0, isl.z);
    this._scene.add(grp);
    return grp;
  }

  rebuild(){
    this._islands.forEach(isl=>{
      if(isl.auraRing) { this._scene.remove(isl.auraRing); isl.auraRing=null; }
      if(isl.auraRing2){ this._scene.remove(isl.auraRing2); isl.auraRing2=null; }
      if(isl.auraBoundary){ this._scene.remove(isl.auraBoundary); isl.auraBoundary=null; }
    });
    // Clear old shipyard rings
    this._shipyardRings.forEach(r => this._scene.remove(r.mesh));
    this._shipyardRings.length = 0;

    const st=this._state, R=st.getAuraRange();
    const ph=this._islands.find(i=>i.own==='player');
    const eh=this._islands.find(i=>i.own==='enemy');
    if(ph&&!ph.down){
      ph.auraRing     = this._ring(ph, R, 0x5a8e40, .18, .35);
      ph.auraRing2    = this._ring(ph, R*.65, 0x5a8e40, .08, .30);
      ph.auraBoundary = this._dashedRing(ph, R, 0x7eb150, .5);
    }
    if(eh&&!eh.down){
      const er=eh.r+12;
      eh.auraRing  = this._ring(eh, er, 0x8a2418, .13, .35);
      eh.auraRing2 = this._ring(eh, er*.65, 0x8a2418, .06, .30);
    }

    // Per-shipyard auras on ALL player-owned islands (not just home)
    this._islands.filter(i => i.own === 'player').forEach(isl => {
      const instances = st.islandBuildings[isl.def.id];
      if(!Array.isArray(instances)) return;
      instances.forEach(inst => {
        if(inst.buildingId !== 'shipyard' || inst.state === 'destroyed' || inst.state === 'moving') return;
        const wx = inst.worldX != null ? inst.worldX : isl.x;
        const wz = inst.worldZ != null ? inst.worldZ : isl.z;
        const radius = SHIPYARD_AURA_RADIUS + (inst.level || 1) * 1.5;
        const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), ringFillMat(0x4aa890, .12));
        fill.rotation.x = -Math.PI/2;
        fill.position.set(wx, RING_Y, wz);
        fill.renderOrder = RING_RENDER_ORDER;
        const ring = new THREE.Mesh(new THREE.RingGeometry(radius - .4, radius, 48), ringEdgeMat(0x7ec8b8, .55));
        ring.rotation.x = -Math.PI/2;
        ring.position.set(wx, RING_Y, wz);
        ring.renderOrder = RING_RENDER_ORDER;
        const grp = new THREE.Group();
        grp.add(fill); grp.add(ring);
        this._scene.add(grp);
        this._shipyardRings.push({instanceId: inst.instanceId, mesh: grp, radius, wx, wz, level: inst.level || 1});
      });
    });
  }

  update(dt, t){
    const st=this._state;
    const ph=this._islands.find(i=>i.own==='player');
    const eh=this._islands.find(i=>i.own==='enemy');

    // Reset per-frame aura membership flags
    st.playerShips.forEach(s => { s.inShipyardAura = false; });

    // Pulse aura rings (opacity change is fine on MeshBasicMaterial)
    [ph,eh].forEach(isl=>{
      if(!isl)return;
      if(isl.auraRing)  isl.auraRing.material.opacity  = .18+Math.sin(t*.9+(isl.auraPulseT||0))*.10;
      if(isl.auraRing2) isl.auraRing2.material.opacity = .08+Math.sin(t*1.3+(isl.auraPulseT||0)+1)*.05;
    });

    // Pulse shipyard rings (gentler)
    this._shipyardRings.forEach((r, i) => {
      const ring = r.mesh.children[1];   // child[0]=fill (static), child[1]=edge ring
      if(ring) ring.material.opacity = .40 + Math.sin(t*1.5 + i*.7) * .15;
    });

    // Heal player ships in HOME repair aura
    if(ph&&!ph.down){
      const R=st.getAuraRange(), rr=st.getRegenRate();
      st.playerShips.filter(s=>s.alive).forEach(s=>{
        const dx=s.x-ph.x, dz=s.z-ph.z, d2=dx*dx+dz*dz; // B5: squared distance
        s.inRepairAura=(d2<R*R);
        if(s.inRepairAura && s.hp<s.maxHp){
          const f=Math.max(.3, 1-(Math.sqrt(d2)/R)*.6); // B5 fix: use sqrt(d2) for falloff
          s.hp=Math.min(s.maxHp, s.hp+rr*f*dt);
          if(Math.random()<.02*f) this._vfx.spawnPart(s.x,2,s.z,0x7eb150,2);
        }
      });
    }

    // Heal player ships in any SHIPYARD aura (any player island).
    // Stacks with home aura: if a ship is in both, both heals apply.
    if(this._shipyardRings.length){
      st.playerShips.filter(s => s.alive && s.hp < s.maxHp).forEach(s => {
        this._shipyardRings.forEach(r => {
          const dx = s.x - r.wx, dz = s.z - r.wz;
          const d = Math.hypot(dx, dz);
          if(d < r.radius){
            // Scale with shipyard level (a level-10 shipyard heals ~2x)
            const lvScale = 1 + (r.level - 1) * 0.12;
            const f = Math.max(.4, 1 - (d / r.radius) * .5);
            s.hp = Math.min(s.maxHp, s.hp + SHIPYARD_AURA_RATE * lvScale * f * dt);
            s.inShipyardAura = true;
            if(Math.random() < .015 * f) this._vfx.spawnPart(s.x, 2.2, s.z, 0x7ec8b8, 2);
          }
        });
      });
    }

    // Enemy home heals their ships
    if(eh&&!eh.down){
      const er=eh.r+12;
      st.enemyShips.filter(s=>s.alive).forEach(s=>{
        const dx=s.x-eh.x, dz=s.z-eh.z;
        // Sea Battle: data/harbor.js BATTLE.fortShipRegen (Open War keeps 3 HP/s)
        const regen = st.mode === 'battle' ? (st.battleFortShipRegen ?? 3) : 3;
        if(dx*dx+dz*dz<er*er &&  s.hp<s.maxHp) s.hp=Math.min(s.maxHp,s.hp+regen*dt);
      });
    }

    // Legacy shipyardBuilt flag (home shipyard close-port bonus) — keep as fallback
    if(st.shipyardBuilt&&ph&&!ph.down){
      const dr=ph.r+4;
      st.playerShips.filter(s=>s.alive&&!s.inRepairAura&&!s.inShipyardAura).forEach(s=>{
        const dx=s.x-ph.x, dz=s.z-ph.z;
        if(dx*dx+dz*dz<dr*dr &&  s.hp<s.maxHp) s.hp=Math.min(s.maxHp,s.hp+2*dt);
      });
    }
  }
}
