import { CANNONS, CANNON_BY_ID } from '../../../data/cannons.js';
import { HULL_SLOTS, SLOT_CTR } from '../../../data/ships.js';
import { RANGE_U } from '../../../data/constants.js';
import { StatusEffects } from './StatusEffects.js';

// ── ARC HELPERS ─────────────────────────────────────────────────
export function resolveArc(cn, slotId){
  const m=cn.arc.m, d=cn.arc.d;
  if(m==='all')  return {c:0,   w:360};
  if(m==='side') return {c:SLOT_CTR[slotId], w:d};
  if(m==='bow')  return {c:0,   w:d};
  if(m==='stern')return {c:180, w:d};
  if(m==='b_s')  return {c:slotId==='B'?0:slotId==='S'?180:SLOT_CTR[slotId], w:d};
  return {c:SLOT_CTR[slotId]||0, w:d};
}
function angInArc(deg,c,w){let diff=((deg-c)%360+360)%360;if(diff>180)diff=360-diff;return diff<=w/2;}
function tgtDeg(ship,tx,tz){let r=(Math.atan2(tx-ship.x,tz-ship.z)-ship.angle)*180/Math.PI;return((r%360)+360)%360;}
export function canFire(ship,slotId,cn,tx,tz){const arc=resolveArc(cn,slotId),dist=Math.hypot(tx-ship.x,tz-ship.z);return angInArc(tgtDeg(ship,tx,tz),arc.c,arc.w)&&dist<=RANGE_U[cn.rt]&&dist>=1.8;}

// ── ACCURACY FALLOFF ────────────────────────────────────────────
// Historical basis: smoothbore cannon accuracy degraded sharply with range.
// At point-blank (< 15% of max range): near-perfect accuracy.
// At effective range (50%): baseline.
// At max range (100%): heavily penalised — mostly suppression fire.
//
// Curve: linear from 1.0 at dist=0 down to FALLOFF_MIN at dist=maxRange.
// Clamped to [FALLOFF_MIN, 1.0] so even max-range shots have a small hit chance.
const FALLOFF_MIN      = 0.28;  // floor at max range: ~28% modifier
const POINTBLANK_DIST  = 0.12;  // fraction of maxRange considered "point-blank"
const POINTBLANK_BONUS = 0.18;  // extra accuracy added at point-blank (stacks on top)

function rangeAccuracyMult(dist, maxRange) {
  if (maxRange <= 0) return 1.0;
  const t = Math.min(dist / maxRange, 1.0);  // 0 = point-blank, 1 = max range

  // Point-blank zone: within 12% of max range → near-certain hit bonus
  // e.g. Carronade (8u): point-blank = < 0.96u   Long 9 (40u): < 4.8u
  if (t <= POINTBLANK_DIST) {
    const closeness = 1.0 - t / POINTBLANK_DIST;  // 1 at contact, 0 at edge of PB zone
    return 1.0 + POINTBLANK_BONUS * closeness;     // can exceed 1.0, clamped later by hc cap
  }

  // Normal range: ease-in² curve — accuracy stays good until ~60%, then falls sharply
  const tNorm = (t - POINTBLANK_DIST) / (1.0 - POINTBLANK_DIST);
  const curve = tNorm * tNorm;
  return 1.0 - curve * (1.0 - FALLOFF_MIN);
}

// ── COMBAT SYSTEM ───────────────────────────────────────────────
export class CombatSystem {
  constructor(scene,state,vfx,bus){this._scene=scene;this._state=state;this._vfx=vfx;this._bus=bus;}

  // AU: target choice per gun — the ship's focusTarget (player orders) when
  // this gun bears on it, otherwise the NEAREST ship in arc and range (was:
  // first in list order). Stance 'holdfire' keeps every gun silent.
  _pickShipTarget(ship,slotId,cn,shipTargets){
    const f=ship.focusTarget;
    if(f&&!f.def&&f.alive&&canFire(ship,slotId,cn,f.x,f.z))return f;
    let best=null,bd=Infinity;
    for(const tgt of shipTargets){
      if(!tgt.alive||!canFire(ship,slotId,cn,tgt.x,tgt.z))continue;
      const d=(tgt.x-ship.x)**2+(tgt.z-ship.z)**2;
      if(d<bd){bd=d;best=tgt;}
    }
    return best;
  }

  tickShip(ship,shipTargets,islTargets,dt){
    if(!ship.alive)return;
    const st=this._state, t=st.stats.timeSec;
    StatusEffects.tick(ship,t);
    const holdFire=ship.stance==='holdfire';
    (HULL_SLOTS[ship.hull]||[]).forEach(slotId=>{
      ship.slotTimers[slotId]=Math.max(holdFire?0:-1e9, ship.slotTimers[slotId]-dt);
      if(holdFire||ship.slotTimers[slotId]>0)return;
      const cn=CANNON_BY_ID.get(ship.loadout[slotId]);if(!cn)return;
      let fired=false;
      // vs ships
      const shipTgt=this._pickShipTarget(ship,slotId,cn,shipTargets);
      for(const tgt of shipTgt?[shipTgt]:[]){
        const dist = Math.hypot(tgt.x - ship.x, tgt.z - ship.z);
        const maxRange = RANGE_U[cn.rt];
        let hc=.80+(ship.team==='player'?st.hitChanceBuff:0);
        if(cn.ctr&&cn.ctr.t===tgt.hull)hc+=cn.ctr.b*.25;
        const effSpd=StatusEffects.effectiveSpeed(tgt);
        if(effSpd>=tgt.maxSpeed*.9)hc-=Math.max(0,tgt.dodgeBase-StatusEffects.effectiveDodgePenalty(tgt));
        else if(tgt.speed<.01)hc+=.15;
        if(tgt.hp/tgt.maxHp<.3)hc+=.10;
        // Distance-based accuracy falloff: close range = deadly, max range = suppression
        hc *= rangeAccuracyMult(dist, maxRange);
        hc=Math.min(.97,Math.max(.15,hc));
        const hit=Math.random()<hc;
        // FIX: ROF uses ship.rofMult for persistent upgrade
        ship.slotTimers[slotId]=StatusEffects.effectiveROF(ship,cn.rof)+(Math.random()-.5)*2;
        const tx=tgt.x+(hit?0:1)*(Math.random()-.5)*4,tz=tgt.z+(hit?0:1)*(Math.random()-.5)*4;
        if(ship.team==='player'){st.stats.fired++;if(hit)st.stats.hit++;}
        this._vfx.fireBall(ship.x,1.8,ship.z,tx,tz,ship.team==='player'?0xffdd44:0xff4444,.028,()=>{
          if(hit){
            this._vfx.spawnHit(tx,1,tz,ship.team,'ship');
            if(tgt.alive&&!tgt._gracePeriod){
              let dmg=cn.dmg*(6+Math.random()*5)/10;
              if(cn.ctr&&cn.ctr.t===tgt.hull)dmg*=(1+cn.ctr.b);
              if(ship.team==='player'){dmg*=st.combatDmgMult*(st.cmdDmgMult||1);st.stats.dmgDealt+=dmg;}else st.stats.dmgTaken+=dmg;
              if(st.chainShotSlow&&ship.team==='player'&&(slotId==='L'||slotId==='R'))
                StatusEffects.apply(tgt,'slow',{multiplier:0.8},t,5);
              tgt.hp=Math.max(0,tgt.hp-dmg);
              this._vfx.spawnDmg(tgt.x,3,tgt.z,dmg,ship.team==='player'?'#ffdd44':'#ff6060');
              if(cn.sp==='debuff'){
                const cur=StatusEffects.effectiveDodgePenalty(tgt);
                StatusEffects.apply(tgt,'dodgeDebuff',{value:Math.min(.20,cur+.02)},t,10);
              }
              if(cn.sp==='speed_cut'){
                StatusEffects.apply(tgt,'chain_slow',{multiplier:0.60},t,8);
                this._vfx.spawnPart(tgt.x,2,tgt.z,0x80c0ff,6);
              }
              if(cn.sp==='aoe'){
                // Grapeshot: hit nearby ships in a 6u radius too
                const AOE_R2 = 36;
                this._state.allShips.forEach(near => {
                  if(near===tgt||!near.alive||near.team===ship.team) return;
                  const dx=near.x-tx,dz=near.z-tz;
                  if(dx*dx+dz*dz<AOE_R2){
                    const ad=cn.dmg*0.5*(0.5+Math.random()*0.5);
                    near.hp=Math.max(0,near.hp-ad);
                    this._vfx.spawnPart(near.x,2,near.z,0xff9050,4);
                    if(near.hp<=0)this._bus.emit('ship:destroyed',{ship:near});
                  }
                });
              }
              if(tgt.hp<=0)this._bus.emit('ship:destroyed',{ship:tgt});
            }
          } else {
            // Miss — ball lands in water near target: water column + ripple ring
            this._vfx.spawnSplash(tx,0.3,tz);
          }
        },cn);
        fired=true;break;
      }
      // vs island forts + defense instances (a sieged island goes first)
      if(!fired){
        const f=ship.focusTarget;
        const isls=f&&f.def&&islTargets.includes(f)?[f,...islTargets.filter(i=>i!==f)]:islTargets;
        for(const isl of isls){
          // AW: scenery rocks (def.decor) are never a target — guns keep their reload for ships
          if(isl.down||isl.def?.decor||!canFire(ship,slotId,cn,isl.x,isl.z))continue;
          const distIsl = Math.hypot(isl.x - ship.x, isl.z - ship.z);
          const fortAcc = (.72+(ship.team==='player'?st.hitChanceBuff:0)) * rangeAccuracyMult(distIsl, RANGE_U[cn.rt]);
          const hit=Math.random()<Math.min(.95, Math.max(.15, fortAcc));
          ship.slotTimers[slotId]=StatusEffects.effectiveROF(ship,cn.rof)+(Math.random()-.5)*2;
          const tx=isl.x+(hit?0:1)*(Math.random()-.5)*isl.r,tz=isl.z+(hit?0:1)*(Math.random()-.5)*isl.r;
          if(ship.team==='player'){st.stats.fired++;if(hit)st.stats.hit++;}
          this._vfx.fireBall(ship.x,1.8,ship.z,tx,tz,ship.team==='player'?0xffdd44:0xff4444,.024+(cn.rt-.5)*.004,()=>{
            // Always spawnHit: miss still lands on island ground, not water
            this._vfx.spawnHit(tx,1.2,tz,ship.team,hit?'fort':'ground');
            if(hit&&!isl.down){
              let dmg=cn.dmg*((cn.ctr&&cn.ctr.t==='tower')?1+cn.ctr.b:1)*(7+Math.random()*5)/10;
              if(ship.team==='player'){dmg*=st.combatDmgMult*st.mortarAoeMult*(st.cmdDmgMult||1);st.stats.dmgDealt+=dmg;}
              this._damageDefenses(isl,dmg);
              isl.hp=Math.max(0,isl.hp-dmg);isl.drawHP(isl.hp/isl.maxHp);
              if(ship.team==='player')this._vfx.spawnDmg(tx,7,tz,dmg,'#ffdd44');  // AN: fort hit number
              if(isl.hp > 0 && isl.hp/isl.maxHp < 0.50) {
                const intensity = 0.6 + (1 - isl.hp/isl.maxHp) * 1.4;
                isl.setOnFire(this._vfx, intensity);
              }
              if(isl.hp<=0){ isl.destroyFort(); this._bus.emit('island:fort_destroyed',{island:isl}); }
              if(cn.sp==='aoe')this._vfx.spawnPart(tx,1.5,tz,0xff4400,8*st.mortarAoeMult);
            }
          },cn);
          break;
        }
      }
    });
  }

  _damageDefenses(isl,dmg){
    const instances=this._state.islandBuildings[isl.def.id];
    if(!Array.isArray(instances))return;
    instances.forEach(inst=>{
      if(inst.state==='destroyed' || inst.state==='moving')return;
      const splash=inst.isDefense?dmg*.5:dmg*.1;
      inst.hp=Math.max(0,inst.hp-splash);
      if(inst.hp<=0){
        inst.state='destroyed';
        if(inst.mesh)inst.mesh.visible=false;
        this._vfx.spawnHit(inst.worldX ?? isl.x, 2.0, inst.worldZ ?? isl.z, 'enemy', 'building');
        this._bus.emit('building:destroyed',{instance:inst,island:isl});
      }
    });
  }

  tickIsland(isl,targets,dt){
    if(isl.down)return;
    isl.ftimer-=dt;
    if(isl.ftimer<=0){this._fortFire(isl,targets);isl.ftimer=isl.trof+(Math.random()-.5)*3;}
    // Tick defense instances
    const instances=this._state.islandBuildings[isl.def.id];
    if(Array.isArray(instances)){
      instances.forEach(inst=>{
        if(!inst.isDefense||inst.state==='destroyed'||inst.state==='moving')return;
        // Deadman's Lure state machine
        if(inst.buildingId==='deadmans_lure'){this._tickLure(inst,isl,targets,dt);return;}
        if(inst.fireTimer==null) inst.fireTimer=inst.reloadSec||5; // init once
        inst.fireTimer-=dt;
        if(inst.fireTimer>0)return;
        this._defenseFire(inst,isl,targets);
        inst.fireTimer=inst.reloadSec+(Math.random()-.5);
      });
    }
  }

  _fortFire(isl,targets){
    let best=null,bestD=Infinity;
    targets.filter(s=>s.alive).forEach(s=>{const dx=s.x-isl.x,dz=s.z-isl.z,d=Math.sqrt(dx*dx+dz*dz);if(d<isl.r+22&&d<bestD){best=s;bestD=d;}});
    if(!best)return;
    const hit=Math.random()<.55,mr=hit ? .6 : (1.8+Math.random()*3.5),ang=Math.random()*Math.PI*2;
    const tx=best.x+Math.cos(ang)*mr,tz=best.z+Math.sin(ang)*mr;
    this._vfx.fireBall(isl.x,5,isl.z,tx,tz,0xff4444,.018,()=>{
      if(hit)this._vfx.spawnHit(tx,1,tz,'enemy','ship');else this._vfx.spawnSplash(tx,0.3,tz);
      if(hit&&best.alive&&!best._gracePeriod){
        const st=this._state;let dmg=(isl.tdmg+Math.random()*6)*(1-st.towerDmgReduction);
        best.hp=Math.max(0,best.hp-dmg);if(best.team==='player')st.stats.dmgTaken+=dmg;
        this._vfx.spawnDmg(best.x,3,best.z,dmg,'#ff6666');this._vfx.spawnPart(best.x,1.5,best.z,0xff4400,4);
        if(st.towerBurn&&best.team==='player')best.effects.push({type:'burn',timer:3});
        if(best.hp<=0)this._bus.emit('ship:destroyed',{ship:best});
      }
    },'fort');
  }

  _defenseFire(inst,isl,targets){
    let best=null,bestD=Infinity;
    const arcDeg=inst.arcDeg != null ? inst.arcDeg : 360;
    targets.filter(s=>s.alive).forEach(s=>{
      const dx=s.x-inst.worldX,dz=s.z-inst.worldZ,d=Math.sqrt(dx*dx+dz*dz);
      if(d>=inst.range||d>=bestD) return;
      // Arc check: inst.facingDeg is the defense facing direction (0=north)
      if(arcDeg<360){
        const faceDeg=inst.facingDeg != null ? inst.facingDeg : 0;
        let angDeg=Math.atan2(dx,dz)*180/Math.PI;
        let diff=((angDeg-faceDeg)%360+360)%360;
        if(diff>180) diff=360-diff;
        if(diff>arcDeg/2) return; // outside arc
      }
      best=s; bestD=d;
    });
    if(!best)return;
    const baseAcc = (inst.accuracy||65)/100;
    const acc = baseAcc * rangeAccuracyMult(bestD, inst.range || 22);
    const hit=Math.random()<Math.min(.92, Math.max(.10, acc));
    const ang=Math.random()*Math.PI*2,mr=hit ? .5 : (2+Math.random()*3);
    const tx=best.x+Math.cos(ang)*mr,tz=best.z+Math.sin(ang)*mr;
    this._vfx.fireBall(inst.worldX,4,inst.worldZ,tx,tz,0xff5500,.016,()=>{
      if(hit)this._vfx.spawnHit(tx,1,tz,'enemy','ship');else this._vfx.spawnSplash(tx,0.3,tz);
      if(hit&&best.alive&&!best._gracePeriod){
        const bonus=(inst.bonusDamage && inst.bonusDamage[best.hull] != null) ? inst.bonusDamage[best.hull] : 1.0;
        const dmg=Math.round(inst.damage*bonus*(8+Math.random()*4)/10);
        best.hp=Math.max(0,best.hp-dmg);
        if(best.team==='player')this._state.stats.dmgTaken+=dmg;
        this._vfx.spawnDmg(best.x,3,best.z,dmg,'#ff8866');
        if(best.hp<=0)this._bus.emit('ship:destroyed',{ship:best});
      }
    },'defense');
  }

  // Deadman's Lure state machine: inactive→armed→warning→detonated→cooldown
  _tickLure(inst,isl,targets,dt){
    if(inst.state==='cooldown'){
      inst.cooldownTimer=(inst.cooldownTimer||120)-dt;
      if(inst.cooldownTimer<=0)inst.state='inactive';
      return;
    }
    if(inst.state==='detonated'){inst.state='cooldown';inst.cooldownTimer=120;return;}
    if(inst.state==='warning'){
      inst.warnTimer=(inst.warnTimer||3)-dt;
      // Warning visual: pulse red every 0.5s
      if(inst.mesh && Math.floor(inst.warnTimer*2)%2===0 && inst.mesh.children[0] && inst.mesh.children[0].material && inst.mesh.children[0].material.color) inst.mesh.children[0].material.color.setHex(0xff2200);
      else if(inst.mesh && inst.mesh.children[0] && inst.mesh.children[0].material && inst.mesh.children[0].material.color) inst.mesh.children[0].material.color.setHex(0xff8800);
      if(inst.warnTimer<=0){
        // Detonate — Bug8: use 1.25x damage with linear AoE falloff
        inst.state='detonated';
        const blastR=12;
        this._vfx.spawnExplosion(inst.worldX,3,inst.worldZ);
        targets.filter(s=>s.alive).forEach(s=>{
          const dx=s.x-inst.worldX,dz=s.z-inst.worldZ,dist=Math.sqrt(dx*dx+dz*dz);
          if(dist>=blastR) return;
          const falloff=Math.max(0.25, 1-(dist/blastR)*0.75); // 100%→25% at edge
          const dmg=Math.round(inst.damage*1.25*falloff);
          s.hp=Math.max(0,s.hp-dmg);
          this._vfx.spawnDmg(s.x,3,s.z,dmg,'#ff4400');
          if(s.hp<=0)this._bus.emit('ship:destroyed',{ship:s});
        });
      }
      return;
    }
    // inactive or armed — check trigger radius
    const trigR=inst.triggerRadius||15;
    const triggered=targets.some(s=>{
      if(!s.alive)return false;
      const dx=s.x-inst.worldX,dz=s.z-inst.worldZ;
      return dx*dx+dz*dz<trigR*trigR; // B5: squared distance
    });
    if(triggered&&inst.state!=='armed'){inst.state='armed';}
    if(inst.state==='armed'&&triggered){
      inst.armTimer=(inst.armTimer||2)-dt;
      if(inst.armTimer<=0){inst.state='warning';inst.warnTimer=3;inst.armTimer=2;}
    } else if(!triggered){
      inst.state='inactive';inst.armTimer=2;
    }
  }
}
