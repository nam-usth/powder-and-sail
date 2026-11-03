import { REVIVE_TIME } from '../../../data/constants.js';
import { HULL_SLOTS } from '../../../data/ships.js';
import { CANNONS } from '../../../data/cannons.js';
import { getAlivePlayerShipCount, getShipCapacity } from '../../Utils/ShipCapacity.js';

export class ReviveSystem {
  constructor(state, scene, islands, vfx, bus){
    this._state=state; this._scene=scene; this._islands=islands;
    this._vfx=vfx; this._bus=bus;
  }

  queue(ship){
    const st=this._state;
    if(!ship.reviveCost || ship.alive) return false;
    if(st.reviveQueue.find(q=>q.ship===ship)) return false;
    if(getAlivePlayerShipCount(st) + st.reviveQueue.length >= getShipCapacity(st, this._islands)) return false;
    const {wood,gold}=ship.reviveCost;
    if(st.resWood<wood||st.resGold<gold) return false;
    st.resWood-=wood; st.resGold-=gold;

    // Scale revive time: base 30s + 5s per wave, +5s per rank, cap 90s
    const waveBonus=Math.min(60,(st.waveNumber||0)*5);
    const rankBonus=(ship.rank||0)*5;
    const reviveTime=Math.min(90, REVIVE_TIME+waveBonus+rankBonus);

    st.reviveQueue.push({ship, timer:reviveTime, totalTime:reviveTime});
    this._bus.emit('revive:queued',{ship});
    return true;
  }

  update(dt){
    const st=this._state;
    for(let i=st.reviveQueue.length-1;i>=0;i--){
      const q=st.reviveQueue[i];
      q.timer-=dt;
      if(q.timer<=0){
        this._doRevive(q.ship);
        st.reviveQueue.splice(i,1);
        this._vfx.playSound('build');
        this._bus.emit('revive:complete',{ship:q.ship});
      }
    }
  }

  _doRevive(ship){
    const st=this._state;
    const home=this._islands[0];

    // Fix 1: FULL HP on revive, not 60%
    ship.hp=ship.maxHp;
    ship.alive=true;
    ship.speed=0;
    ship._stuckFrames=0;
    ship.effects=[];
    ship.statusEffects={};

    // Fix 2: Spawn at home port but OFFSET away from island edge safely
    const spawnAngle=Math.PI*(0.3+ship.rank*0.12); // spread around south side
    const spawnDist=home.r+6;
    ship.x=home.x+Math.sin(spawnAngle)*spawnDist;
    ship.z=home.z+Math.cos(spawnAngle)*spawnDist;
    ship.angle=spawnAngle; // face outward

    ship.mesh.position.set(ship.x, .35, ship.z);
    this._scene.add(ship.mesh);

    // Reset cannon timers
    (HULL_SLOTS[ship.hull]||[]).forEach(s=>ship.slotTimers[s]=CANNONS[0].rof);

    // Fix 3: Grace period — 5s of invincibility so it can rejoin without dying immediately
    ship._graceTimer=5.0;
    ship._gracePeriod=true;
  }
}
