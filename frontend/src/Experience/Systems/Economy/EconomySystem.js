import { WOOD_CAP, GOLD_CAP, WOOD_RATE, GOLD_RATE,
         LOOT_W_RATE, LOOT_G_RATE, CARGO_MAX, RAID_DUR,
         ptPerW, ptPerG } from '../../../data/constants.js';

export class EconomySystem {
  constructor(state, islands, vfx, bus, buildSystem){
    this._state  = state;
    this._islands= islands;
    this._vfx    = vfx;
    this._bus    = bus;
    this._build  = buildSystem; // for tickProduction
  }

  update(dt){
    const st=this._state;
    if(st.gameOver) return;

    // AW: the harbor runs the same economy on a slower clock (data/harbor.js
    // HARBOR_ECONOMY.rateMult, set by HarborSession); Open War leaves it at 1.
    const k = st.econRateMult ?? 1;

    // Base resource tick (1/s)
    st.econTimer+=dt;
    if(st.econTimer>=1){
      st.econTimer=0;
      const capW = WOOD_CAP + (st._warehouseCapBonus||0);
      const capG = GOLD_CAP + (st._warehouseCapBonus||0);
      if(st.resWood < capW) st.resWood = Math.min(capW, st.resWood + WOOD_RATE*k);
      if(st.resGold < capG) st.resGold = Math.min(capG, st.resGold + GOLD_RATE*k);
    }

    // Building production — get rates from BuildSystem, apply+clamp ONCE here
    if(this._build){
      const {woodRate, goldRate} = this._build.getProductionRates();
      const capW = WOOD_CAP + (st._warehouseCapBonus||0);
      const capG = GOLD_CAP + (st._warehouseCapBonus||0);
      if(woodRate>0 && st.resWood < capW) st.resWood = Math.min(capW, st.resWood + woodRate*k*dt);
      if(goldRate>0 && st.resGold < capG) st.resGold = Math.min(capG, st.resGold + goldRate*k*dt);
    }

    // AN/G2: floating "+N" income ticks above each producing building.
    // 3 s window (not every econ tick) — readable, not spammy; FloatTextLayer
    // distance-culls far buildings before any DOM work.
    this._incomeFxT = (this._incomeFxT || 0) + dt;
    if(this._incomeFxT >= 3){
      this._incomeFxT = 0;
      this._build?.getProducingInstances?.().forEach(({inst, id, prod})=>{
        const mp = inst.mesh?.position;
        const x = inst.worldX ?? mp?.x, z = inst.worldZ ?? mp?.z;
        if(x == null) return;
        const wood = id === 'lumber_mill';
        this._vfx.floatText(x, (mp?.y ?? 2) + 2.4, z,
          `+${Math.round(prod*3*k)} ${wood ? '🪵' : '🪙'}`,
          { col: wood ? '#b8e09a' : '#f1d27a', size: 12, life: 1.5, rise: 1.9, weight: 500 });
      });
    }

    // Raid cooldown tickers
    Object.keys(st.raidCooldown).forEach(id=>{
      st.raidCooldown[id]-=dt;
      if(st.raidCooldown[id]<=0) delete st.raidCooldown[id];
    });

    // Active raid
    const leader=st.playerShips.find(s=>s.alive);
    if(!leader){ if(st.activeRaid) this._endRaid(); return; }

    if(st.activeRaid){
      const isl=st.activeRaid.isl;
      const dx=leader.x-isl.x, dz=leader.z-isl.z;
      if(dx*dx+dz*dz>=(isl.r+14)*(isl.r+14) || st.activeRaid.timer<=0){
        this._endRaid(); return;
      }
      st.activeRaid.timer-=dt;
      const capW=WOOD_CAP+(st._warehouseCapBonus||0);
      const capG=GOLD_CAP+(st._warehouseCapBonus||0);
      // Warehouses on the target island protect its stockpile from looting.
      // Player warehouse protection only shields player resources from enemy raids (not implemented here).
      const islProt = this._build ? this._build.getIslandProtectedAmount(isl) : 0;
      const lootableW = Math.max(0, isl.stockWood - islProt);
      const lootableG = Math.max(0, isl.stockGold - islProt);
      if(lootableW <= 0 && lootableG <= 0){ this._endRaid(); return; }
      const wg=Math.min(LOOT_W_RATE*dt, lootableW, capW-st.resWood, CARGO_MAX-st.activeRaid.cargo);
      const gg=Math.min(LOOT_G_RATE*dt, lootableG, capG-st.resGold, CARGO_MAX-st.activeRaid.cargo);
      isl.stockWood-=wg; isl.stockGold-=gg;
      st.resWood+=wg; st.resGold+=gg;
      st.activeRaid.cargo+=wg+gg;
      st.lootPts+=wg*ptPerW + gg*ptPerG;
      const pct=Math.max(0,(1-st.activeRaid.timer/RAID_DUR)*100);
      const pf=document.getElementById('rpfill'); if(pf) pf.style.width=pct+'%';
      if(st.lootPts>=1000) this._bus.emit('game:win',{reason:'Loot score 1000 reached!'});
    } else {
      // Check if leader is near a raidable island
      const raidable=this._islands.find(isl=>{
        if(isl.own==='player' || st.raidCooldown[isl.def.id]) return false;
        if(isl.stockWood<=0 && isl.stockGold<=0) return false;
        const dx=leader.x-isl.x, dz=leader.z-isl.z;
        return dx*dx+dz*dz<(isl.r+12)*(isl.r+12) && (isl.down||isl.own==='neutral');
      });
      if(raidable){
        st.activeRaid={isl:raidable, timer:RAID_DUR, cargo:0};
        const rb=document.getElementById('raid-bar'); if(rb) rb.classList.add('active');
        const rn=document.getElementById('raid-nm'); if(rn) rn.textContent=raidable.nm;
        this._vfx.playSound('build');
      }
    }
  }

  _endRaid(){
    const st=this._state;
    if(!st.activeRaid) return;
    st.raidCooldown[st.activeRaid.isl.def.id]=90;
    st.activeRaid=null;
    const rb=document.getElementById('raid-bar'); if(rb) rb.classList.remove('active');
    const pf=document.getElementById('rpfill');   if(pf) pf.style.width='0%';
  }
}
