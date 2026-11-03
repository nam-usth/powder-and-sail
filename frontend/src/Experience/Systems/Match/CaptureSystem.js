import { getTrait } from '../../../data/traits.js';
import { toasts } from '../../UI/ToastQueue.js';
import * as THREE from 'three';
// F1: XSS guard
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// ── ISLAND CAPTURE SYSTEM ───────────────────────────────────────
// When a fleet raids a non-player island long enough, ownership transfers.
// Capture progress builds up while fleet is in range.
// Enemy AI will attempt to retake captured islands.
//
// Capture timings:
//   neutral island  → player: 20s
//   enemy island    → player: 45s (must destroy fort first)
//   player island   → enemy:  30s (enemy AI raids)

const CAPTURE_TIME = { neutral: 12, enemy: 30, player: 45 }; // faster capture, slower retake

export class CaptureSystem {
  constructor(scene, state, islands, vfx, bus){
    this._scene   = scene;
    this._state   = state;
    this._islands = islands;
    this._vfx     = vfx;
    this._bus     = bus;
    // captureProgress[islId] = { progress 0-1, attacker: 'player'|'enemy' }
    this._progress = {};
  }

  update(dt){
    const st = this._state;
    if(st.gameOver || st.paused) return;

    // AU: ANY ship in range counts. This used to test only the first living
    // ship ("leader"), so a detached squadron could never capture anything.
    const within = (ships, isl, R) => ships.some(s => s.alive && (s.x-isl.x)**2 + (s.z-isl.z)**2 < R*R);

    this._islands.forEach(isl=>{
      const id = isl.def.id;
      if(!this._progress[id]) this._progress[id] = { progress:0, attacker:null };
      const prog = this._progress[id];

      // Can only capture if fort is down (for enemy islands)
      if(isl.own==='enemy' && !isl.down) return;

      // --- Player capturing neutral/enemy ---
      if(isl.own !== 'player'){
        const inRange = within(st.playerShips, isl, isl.r+14);
        if(inRange){
          const dur = CAPTURE_TIME[isl.own] || 30;
          if(prog.attacker !== 'player'){ prog.attacker='player'; prog.progress=0; }
          // Multi-ship scaling: each additional ship adds 0.5x speed (2 ships = 1.5x, 3 ships = 2x)
          const nearbyPlayer = st.playerShips.filter(s=>{
            if(!s.alive) return false;
            const dx=s.x-isl.x, dz=s.z-isl.z;
            return dx*dx+dz*dz < (isl.r+16)*(isl.r+16);
          }).length;
          const speedMult = Math.max(1, 1 + (nearbyPlayer-1)*0.5);
          prog.progress += (dt / dur) * speedMult;
          if(prog.progress >= 1){
            this._capture(isl, 'player');
            prog.progress = 0; prog.attacker = null;
          }
        } else if(prog.attacker==='player'){
          // Decay when out of range
          prog.progress = Math.max(0, prog.progress - dt/10);
          if(prog.progress===0) prog.attacker=null;
        }
      }

      // --- Enemy retaking player island ---
      if(isl.own === 'player'){
        const inRange = within(st.enemyShips, isl, isl.r+8);  // tighter — must be close
        if(inRange){
          if(prog.attacker !== 'enemy'){ prog.attacker='enemy'; prog.progress=0; }
          const nearbyEnemy = st.enemyShips.filter(s=>{
            if(!s.alive) return false;
            const dx=s.x-isl.x, dz=s.z-isl.z;
            return dx*dx+dz*dz < (isl.r+10)*(isl.r+10);
          }).length;
          const enemySpeedMult = Math.max(1, 1 + (nearbyEnemy-1)*0.4);
          prog.progress += (dt / CAPTURE_TIME.player) * enemySpeedMult;
          if(prog.progress >= 1){
            this._capture(isl, 'enemy');
            prog.progress = 0; prog.attacker = null;
          }
        } else if(prog.attacker==='enemy'){
          prog.progress = Math.max(0, prog.progress - dt/12);
          if(prog.progress===0) prog.attacker=null;
        }
      }

      // Update capture bar DOM directly
      this._updateCapBar(isl, this._progress[id]);
    });
  }

  getProgress(islId){ return this._progress[islId] || {progress:0, attacker:null}; }

  _capture(isl, newOwner){
    const oldOwner = isl.own;
    isl.own = newOwner;

    // Update resource stocks
    if(newOwner==='player'){
      isl.stockWood = Math.max(isl.stockWood, 80);
      isl.stockGold = Math.max(isl.stockGold, 50);
    }

    // Rebuild fort visuals with new color
    this._rebuildFortColor(isl, newOwner);

    // Update tower allegiance
    if(newOwner==='player' && !isl._capturedWeakened){
      isl.tdmg = Math.round(isl.tdmg * 0.85); // captured forts slightly weaker (applied once)
      isl._capturedWeakened = true;
    }

    this._vfx.playSound('build');
    this._bus.emit('island:captured', { island:isl, oldOwner, newOwner });

    // AN/G1 + AP: toast nêu rõ GIÁ TRỊ chiến lược của đảo vừa chiếm
    const _t = getTrait(isl);
    const _inherited = (this._state.islandBuildings[isl.def.id] || [])
      .filter(i => i.state === 'active').length;
    toasts.show(newOwner==='player'
      ? `🏴 ${isl.nm} captured!${_t ? ` ${_t.icon} ${_t.name}` : ''}${_inherited ? ` · ${_inherited} buildings inherited` : ''}`
      : `⚠️ ${isl.nm} retaken by enemy!`, 3800,
      newOwner==='player' ? 'success' : 'danger');

    // Update score display
    const st = this._state;
    const playerOwned = this._islands.filter(i=>i.own==='player').length;
    const scoreTxt = document.getElementById('score-txt');
    if(scoreTxt) scoreTxt.textContent = `${st.score} / ${this._islands.length}`;
  }

  _rebuildFortColor(isl, owner){
    // Update flag and grass color on island group
    const gcol  = {player:0x3a7a50, enemy:0x7a3a3a, neutral:0x7a9040}[owner];
    const fcol  = {player:0x226699, enemy:0x992222, neutral:0x808844}[owner];
    const flagC = {player:0x2266cc, enemy:0xcc2222, neutral:0x888844}[owner];

    // Traverse island group to find and recolor meshes
    isl.grp.traverse(child=>{
      if(!child.isMesh) return;
      // Grass cylinder (second child, radius ~ isl.r*.72)
      if(child.geometry && child.geometry.type==='CylinderGeometry'){
        const params=child.geometry.parameters;
        if(params && params.radiusTop && Math.abs(params.radiusTop - isl.r*.72)<2){
          child.material = new THREE.MeshStandardMaterial({color:gcol, roughness:.9});
        }
      }
    });

    // Recolor fort cone (flag top)
    if(isl.fgrp) isl.fgrp.traverse(child=>{
      if(!child.isMesh) return;
      if(child.geometry && child.geometry.type==='ConeGeometry') child.material=new THREE.MeshStandardMaterial({color:fcol});
      if(child.geometry && child.geometry.type==='PlaneGeometry') child.material=new THREE.MeshStandardMaterial({color:flagC,side:THREE.DoubleSide});
    });
  }

  _updateCapBar(isl, prog){
    const container=document.getElementById('capture-bars'); if(!container)return;
    const id='capbar_'+isl.def.id;
    if(!prog||prog.progress<=0){
      const ex=document.getElementById(id); if(ex)ex.remove(); return;
    }
    let bar=document.getElementById(id);
    if(!bar){
      bar=document.createElement('div'); bar.className='cap-bar-wrap'; bar.id=id;
      bar.innerHTML=`<div class="cap-bar-label"><span>${_esc(isl.nm)}</span><span id="cbl_${isl.def.id}">0%</span></div><div class="cap-bar-bg"><div class="cap-bar-fill" id="cbf_${isl.def.id}"></div></div>`;
      container.appendChild(bar);
    }
    const pct=Math.round(prog.progress*100);
    const fill=document.getElementById('cbf_'+isl.def.id);
    const lbl=document.getElementById('cbl_'+isl.def.id);
    if(fill){fill.style.width=pct+'%';fill.className='cap-bar-fill '+(prog.attacker==='player'?'cap-player':'cap-enemy');}
    if(lbl) lbl.textContent=pct+'%';
  }
}
