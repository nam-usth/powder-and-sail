import { makeShip, applySpeed } from '../../World/ShipEntity.js';
import { WAVE_INT } from '../../../data/constants.js';
import { HULL_SLOTS } from '../../../data/ships.js';

export class WaveSystem {
  constructor(scene,state,islands,vfx,bus){
    this._scene=scene; this._state=state; this._islands=islands;
    this._vfx=vfx; this._bus=bus;
  }

  update(dt){
    const st=this._state; if(st.gameOver||st.paused) return;
    st.waveTimer-=dt;
    if(st.waveTimer<=0){ this._spawn(); st.waveTimer=WAVE_INT; }
  }

  _spawn(){
    const st=this._state;
    st.waveNumber++;
    // Wave size: 1→2→3 ships (caps at 3, not 4+)
    // Wave 1-2: 1 ship, Wave 3-5: 2 ships, Wave 6+: 3 ships max
    const n  = Math.min(Math.floor((st.waveNumber + 2) / 3), 3);
    const hp = 80 + st.waveNumber * 12;  // lower HP scaling

    // Wave composition scales with wave number
    for(let i=0;i<n;i++){
      const ang=Math.random()*Math.PI*2, r=8+Math.random()*5;
      // FIX: pass st so makeShip inherits _spdResearchMult
      const hull = i===0?'heavy': i<3?'standard':'light';
      const sc   = hull==='heavy'?1.2 : hull==='standard'?0.95:0.85;
      const cfg  = {
        nm:`W${st.waveNumber}-${i+1}`, col:0x991111,
        spd:.11+st.waveNumber*.008, sc, hull, disp: hull==='heavy'?900:hull==='standard'?450:200
      };
      const ws = makeShip(cfg, i, 95+Math.cos(ang)*r, Math.sin(ang)*r, 'enemy', this._scene, st);
      ws.maxHp=hp; ws.hp=hp;
      applySpeed(ws);
      (HULL_SLOTS[ws.hull]||[]).forEach(sl=>ws.slotTimers[sl]=6+Math.random()*8);
      // Loadout BEFORE ship:spawned — overlay.build() reads loadout immediately on spawn
      if(hull==='heavy'){ ws.loadout['L']='demi_can'; ws.loadout['R']='demi_can'; ws.loadout['B']='mortar1'; ws.loadout['S']='demi_can'; }
      else if(hull==='standard'){ ws.loadout['L']='demi_culv'; ws.loadout['R']='demi_culv'; ws.loadout['B']='long9'; }
      else { ws.loadout['L']='carronade'; ws.loadout['R']='carronade'; }
      st.enemyShips.push(ws); st.allShips.push(ws);
      this._bus.emit('ship:spawned',{ship:ws});
    }
    const wa=document.getElementById('wave-alert');
    if(wa){
      wa.textContent=`⚠ WAVE ${st.waveNumber} — ${n} SHIPS!`;
      // Cleanup dead ships from previous waves to prevent enemy army growing forever
      const maxEnemyAlive = 6;  // hard cap: never more than 6 enemy ships alive at once
      const aliveEnemy = st.enemyShips.filter(s=>s.alive);
      if(aliveEnemy.length > maxEnemyAlive){
        // Despawn oldest excess alive enemies (not the base 3 ECFG ships)
        const wave_only = aliveEnemy.filter(s=>s.nm && s.nm.startsWith('W'));
        const excess = wave_only.slice(0, aliveEnemy.length - maxEnemyAlive);
        excess.forEach(s=>{
          s.alive=false;
          // S3: full teardown (scene/physics/wake/overlay/material) lives in
          // GameApp's 'ship:removed' handler — single owner, no double-dispose.
          this._bus.emit('ship:removed',{ship:s});
        });
      }
      this._vfx.playSound('warning');   // AW: audible attack warning
      wa.style.opacity=1; setTimeout(()=>wa.style.opacity=0,3000);
    }
  }
}
