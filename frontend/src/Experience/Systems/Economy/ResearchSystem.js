import { TECH_TREE } from '../../../data/upgrades.js';
import { applySpeed } from '../../World/ShipEntity.js';

export class ResearchSystem {
  constructor(state, bus){ this._state=state; this._bus=bus; this._wireEffects(); }

  _wireEffects(){
    const st=this._state;
    // Ballistics
    TECH_TREE[0].effect=()=>{ st.combatDmgMult+=.15; };
    TECH_TREE[1].effect=()=>{ st.hitChanceBuff+=.20; };
    TECH_TREE[2].effect=()=>{ st.mortarAoeMult=2; };
    // Navigation
    TECH_TREE[3].effect=()=>{
      st.playerShips.forEach(s=>{
        s.maxHp=Math.round(s.maxHp*1.2);
        s.hp=Math.min(Math.round(s.hp*1.2),s.maxHp);
      });
    };
    TECH_TREE[4].effect=()=>{
      // FIX: multiply baseSpd AND call applySpeed so maxSpeed updates immediately
      st.playerShips.forEach(s=>{
        s.baseSpd*=1.15;
        applySpeed(s); // recalculate maxSpeed from new baseSpd + cannon weight
      });
      // Store multiplier so future spawned ships can inherit it
      st._spdResearchMult=(st._spdResearchMult||1)*1.15;
    };
    TECH_TREE[5].effect=()=>{ st.towerDmgReduction+=.30; };
    // Fortification
    TECH_TREE[6].effect=()=>{
      // Boost home island fort HP
      if(st._homeIsland){
        st._homeIsland.maxHp=Math.round(st._homeIsland.maxHp*1.30);
        st._homeIsland.hp=Math.min(
          Math.round(st._homeIsland.hp*1.30),
          st._homeIsland.maxHp
        );
        st._homeIsland.drawHP(st._homeIsland.hp/st._homeIsland.maxHp);
      }
    };
    TECH_TREE[7].effect=()=>{ st.towerBurn=true; };
    TECH_TREE[8].effect=()=>{ st.chainShotSlow=true; };
  }

  research(tech){
    const st=this._state;
    if(st.researched.has(tech.id)) return false;
    // Enforce prerequisites (not just UI check)
    if(tech.req && !tech.req.every(r=>st.researched.has(r))) return false;
    // Enforce lab level requirement
    if(tech.requiredLabLevel && (st.labLevel||0) < tech.requiredLabLevel) return false;
    const cW=tech.cost.wood||0, cG=tech.cost.gold||0;
    if(st.resWood<cW||st.resGold<cG) return false;
    st.resWood-=cW; st.resGold-=cG;
    st.researched.add(tech.id);
    tech.effect();
    this._bus.emit('research:done',{tech});
    return true;
  }
}
