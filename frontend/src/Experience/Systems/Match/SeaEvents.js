// ── SEA EVENTS ───────────────────────────────────────────────────
// Random events that fire throughout the match.
// Events: Storm, Pirate Raid, Treasure Isle
//
// Storm:      every 3-5 min, slows all ships -30% for 20s, reduces visibility
// Pirate Raid: score > 300, neutral pirate fleet attacks both sides
// Treasure Isle: random mid-map island with 2× loot (future)

import { toasts } from '../../UI/ToastQueue.js';
import * as THREE from 'three';
import { makeShip, applySpeed } from '../../World/ShipEntity.js';
import { HULL_SLOTS } from '../../../data/ships.js';
import { StatusEffects } from '../Combat/StatusEffects.js';

const STORM_INTERVAL_MIN  = 180;
const STORM_INTERVAL_MAX  = 300;
const STORM_DURATION      = 20;
const PIRATE_THRESHOLD    = 300;
const TREASURE_INTERVAL_MIN = 120;
const TREASURE_INTERVAL_MAX = 240;
const TREASURE_GOLD       = 80;
const TREASURE_COLLECT_R  = 14;  // world units

export class SeaEvents {
  constructor(scene, state, islands, vfx, bus){
    this._scene   = scene;
    this._state   = state;
    this._islands = islands;
    this._vfx     = vfx;
    this._bus     = bus;

    this._stormTimer    = STORM_INTERVAL_MIN + Math.random()*(STORM_INTERVAL_MAX-STORM_INTERVAL_MIN);
    this._stormActive   = false;
    this._stormRemain   = 0;
    this._pirateTimer   = 120 + Math.random()*60;
    this._pirateFired   = false;
    this._pirateShips   = [];

    // Treasure hunt
    this._treasureTimer = TREASURE_INTERVAL_MIN + Math.random()*(TREASURE_INTERVAL_MAX-TREASURE_INTERVAL_MIN);
    this._treasureMesh  = null;
    this._treasurePos   = null;
    this._treasureFloat = 0;

    this._baseFogDensity = 0.006;
  }

  update(dt){
    const st = this._state;
    if(st.gameOver || st.paused) return;

    this._tickStorm(dt);
    this._tickPirates(dt);
    this._tickTreasure(dt);
  }

  // ── STORM ────────────────────────────────────────────────────
  _tickStorm(dt){
    const st = this._state;
    if(this._stormActive){
      this._stormRemain -= dt;
      if(this._stormRemain <= 0){
        this._endStorm();
      }
    } else {
      this._stormTimer -= dt;
      if(this._stormTimer <= 0){
        this._startStorm();
        this._stormTimer = STORM_INTERVAL_MIN + Math.random()*(STORM_INTERVAL_MAX-STORM_INTERVAL_MIN);
      }
    }
  }

  _startStorm(){
    const st = this._state;
    this._stormActive = true;
    this._stormRemain = STORM_DURATION;

    // Apply slow to ALL ships via StatusEffects
    st.allShips.forEach(s=>{
      if(s.alive) StatusEffects.apply(s, 'storm_slow', {multiplier:0.7}, st.stats.timeSec, STORM_DURATION);
    });

    // Thicken fog
    if(this._scene.fog) this._scene.fog.density = this._baseFogDensity * 3.5;

    // Storm visual: flash overlay
    this._flashUI('⛈ STORM!', '#88aaff');

    const wa = document.getElementById('wave-alert');
    if(wa){ wa.textContent='⛈ STORM! All ships slowed -30%'; wa.style.opacity=1; wa.style.color='#88aaff'; setTimeout(()=>{wa.style.opacity=0;wa.style.color='#ff4444';},4000); }
  }

  _endStorm(){
    const st = this._state;
    this._stormActive = false;

    // Remove storm slow (StatusEffects will expire naturally, but also force-remove)
    st.allShips.forEach(s=>{
      if(s.statusEffects) delete s.statusEffects.storm_slow;
    });

    if(this._scene.fog) this._scene.fog.density = this._baseFogDensity;
    this._flashUI('Storm passed', '#88aaff');
  }

  // ── PIRATE RAID ──────────────────────────────────────────────
  _tickPirates(dt){
    const st = this._state;
    if(this._pirateFired) {
      // Clean up dead pirates
      this._pirateShips = this._pirateShips.filter(s=>s.alive);
      return;
    }
    if(st.lootPts < PIRATE_THRESHOLD) return;

    this._pirateTimer -= dt;
    if(this._pirateTimer > 0) return;

    this._spawnPirates();
    this._pirateFired = true;
  }

  _spawnPirates(){
    const st = this._state;
    // Spawn 2 pirate ships from the north edge — attack nearest ship from any team
    const spawnPositions = [
      {x:-20+Math.random()*40, z:-140},
      {x:-20+Math.random()*40, z:-145},
    ];
    const pirateConfigs = [
      {nm:'Black Pearl',  col:0x222222, spd:.14, sc:1.05, hull:'standard', disp:450},
      {nm:'Dread Sloop',  col:0x333322, spd:.16, sc:.85,  hull:'light',    disp:200},
    ];

    spawnPositions.forEach((pos, i)=>{
      const cfg = pirateConfigs[i];
      const ship = makeShip(cfg, i, pos.x, pos.z, 'pirate', this._scene, st);
      ship.loadout['L']='demi_culv'; ship.loadout['R']='demi_culv';
      if(ship.loadout['B']!==undefined) ship.loadout['B']='long9';
      applySpeed(ship);
      (HULL_SLOTS[ship.hull]||[]).forEach(sl=>ship.slotTimers[sl]=4+Math.random()*6);
      st.allShips.push(ship);
      this._pirateShips.push(ship);
      this._bus.emit('ship:spawned',{ship});
    });

    this._flashUI('🏴‍☠️ Pirates!', '#ffaa00');
    const wa = document.getElementById('wave-alert');
    if(wa){ wa.textContent='🏴‍☠️ PIRATE RAID! They attack everyone!'; wa.style.opacity=1; wa.style.color='#ffaa00'; setTimeout(()=>{wa.style.opacity=0;wa.style.color='#ff4444';},4000); }
  }

  // ── TREASURE HUNT ────────────────────────────────────────────
  _tickTreasure(dt){
    const st = this._state;

    // Count down to next spawn
    if(!this._treasureMesh){
      this._treasureTimer -= dt;
      if(this._treasureTimer > 0) return;
      this._treasureTimer = TREASURE_INTERVAL_MIN + Math.random()*(TREASURE_INTERVAL_MAX-TREASURE_INTERVAL_MIN);
      this._spawnTreasure();
      return;
    }

    // Float animation
    this._treasureFloat += dt;
    if(this._treasureMesh) this._treasureMesh.position.y = 1.2 + Math.sin(this._treasureFloat*2.2)*0.3;

    // Check collection by any player ship
    const {x, z} = this._treasurePos;
    const r2 = TREASURE_COLLECT_R * TREASURE_COLLECT_R;
    for(const s of st.playerShips){
      if(!s.alive) continue;
      const dx=s.x-x, dz=s.z-z;
      if(dx*dx+dz*dz < r2){
        this._collectTreasure(s);
        return;
      }
    }

    // Auto-despawn after 90s
    this._treasureFloat > 90 && this._removeTreasure(false);
  }

  _spawnTreasure(){
    // Random open water position (avoid map edges)
    const rx = (Math.random()*2-1)*80;
    const rz = (Math.random()*2-1)*80;
    this._treasurePos = {x:rx, z:rz};

    const geo = new THREE.BoxGeometry(1.6, 1.0, 1.0);
    const mat = new THREE.MeshStandardMaterial({color:0xc8840a, roughness:0.6, metalness:0.2});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(rx, 1.2, rz);
    mesh.castShadow = true;
    this._scene.add(mesh);

    // Gold coin glow ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.2, 24),
      new THREE.MeshBasicMaterial({color:0xffd040, side:THREE.DoubleSide, transparent:true, opacity:0.7})
    );
    ring.rotation.x = -Math.PI/2;
    ring.position.y = 0.1;
    mesh.add(ring);

    this._treasureMesh = mesh;
    this._treasureFloat = 0;

    this._flashUI('💰 Treasure spotted!', '#ffd040');
    const wa = document.getElementById('wave-alert');
    if(wa){ wa.textContent=`💰 TREASURE! Sail near it to collect ${TREASURE_GOLD} gold`; wa.style.opacity=1; wa.style.color='#ffd040'; setTimeout(()=>{wa.style.opacity=0; wa.style.color='#ff4444';},5000); }
    this._bus.emit('treasure:spawned', {x:rx, z:rz});
  }

  _collectTreasure(ship){
    const st = this._state;
    const bonus = TREASURE_GOLD + Math.floor(Math.random()*40);
    st.resGold = Math.min((st.resGold||0)+bonus, st.GOLD_CAP||600);
    st.lootPts += Math.floor(bonus*0.5);
    this._flashUI(`💰 +${bonus} gold!`, '#ffd040');
    this._vfx.floatText(ship.x, 3.4, ship.z, `+${bonus} 💰`,
      { col:'#ffd866', size:15, life:1.6, rise:3.2, weight:700 });   // AN/G2
    this._bus.emit('treasure:collected', {ship, gold:bonus});
    this._removeTreasure(true);
  }

  _removeTreasure(collected){
    if(this._treasureMesh){
      this._scene.remove(this._treasureMesh);
      this._treasureMesh.geometry.dispose();
      this._treasureMesh.material.dispose();
      this._treasureMesh = null;
    }
    this._treasurePos = null;
    this._treasureFloat = 0;
    if(!collected){
      const wa = document.getElementById('wave-alert');
      if(wa){ wa.textContent='💰 Treasure sank...'; wa.style.opacity=1; wa.style.color='#607090'; setTimeout(()=>wa.style.opacity=0,2500); }
    }
  }

  getPirateShips(){ return this._pirateShips.filter(s=>s.alive); }
  isStormActive(){ return this._stormActive; }

  _flashUI(msg, col='#e8b840'){
    // AN/G1: stacked toast — legacy colour param maps to a toast type
    const type = col==='#ff6655' ? 'danger' : col==='#60d8ff' ? 'info' : null;
    toasts.show(msg, 2800, type);
  }
}
