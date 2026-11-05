import { T } from '../../i18n.js';
import { getTrait } from '../../data/traits.js';
import { toasts } from './ToastQueue.js';
// AN: island shape badge (low-TODO 'Island shape label in HUD/IslandPanel')
const SHAPE_BADGE = { CRESCENT:'🌙 Crescent', ATOLL:'⭕ Atoll', FORTRESS:'🏰 Fortress', SPRAWL:'🌿 Sprawl', MIRROR:'🪞 Mirrored', DISC:'⚪ Disc' };
import { PanelManager } from './PanelManager.js';
import { harborBuildCost } from '../../Meta/HarborEconomy.js';
import { getBarracksShipCapBonus } from '../Utils/ShipCapacity.js';
// ── ISLAND PANEL ─────────────────────────────────────────────────
// Shows island info when selected, and building detail when a cell is clicked.
// Two sub-panels: #island-panel (island overview) and #bld-detail (building detail)

import { BUILDINGS } from '../../data/buildings.js';
import { DEFENSES, getDefenseStats } from '../../data/defenses.js';

const ALL_DEFS = [...BUILDINGS, ...DEFENSES];

// F1: XSS guard — sanitize any user-facing string before inserting into innerHTML
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export class IslandPanel {
  constructor(state, buildSys, islands, bus){
    this._state  = state;
    this._build  = buildSys;
    this._islands= islands;
    this._bus    = bus;
    this._curIsl = null;
    // AR: dock UI state — which build group is expanded, which building's
    // detail is expanded inline. Both live in ONE dock; no separate panels.
    this._openGroup = 'resource';   // resource | military | defense | null
    this._openInst  = null;          // instanceId of inline-expanded building

    this._ensurePanels();
    bus.on('building:placed',    ()=>this._refresh());
    bus.on('building:upgraded',  ()=>this._refresh());
    bus.on('building:demolished',()=>this._refresh());
    bus.on('building:destroyed', ()=>this._refresh());
    bus.on('island:captured',    ()=>this._refresh());
  }

  _ensurePanels(){
    if(!document.getElementById('island-panel')){
      const p=document.createElement('div');
      p.id='island-panel';
      document.getElementById('ui').appendChild(p);
    }
    // AR: bld-detail panel retired — detail is now inline in the dock.
    // Keep a hidden stub so any legacy PanelManager.close('bld-detail') is a no-op.
    if(!document.getElementById('bld-detail')){
      const d=document.createElement('div');
      d.id='bld-detail'; d.style.display='none';
      document.getElementById('ui').appendChild(d);
    }
  }

  show(isl){
    this._curIsl = isl;
    // fresh dock: default to overview, no building expanded
    this._openInst = null;
    this._renderIsland(isl);
    PanelManager.open('island-panel');
  }

  hide(){
    PanelManager.close('island-panel');
    this._curIsl=null;
    this._openInst=null;
  }

  _refresh(){ if(this._curIsl) this._renderIsland(this._curIsl); }

  // AR: legacy entry point — building chips call this. Now just expands
  // the detail inline within the dock instead of opening a 2nd panel.
  showBuildingDetail(inst, isl){
    this._curIsl = isl;
    this._openInst = inst.instanceId;
    this._renderIsland(isl);
    PanelManager.open('island-panel');
    // scroll the expanded card into view
    requestAnimationFrame(()=>{
      document.querySelector('.dock-bld-row.expanded')?.scrollIntoView({block:'nearest',behavior:'smooth'});
    });
  }

  _isUnlocked(b){
    if(!b.unlock) return true;
    const lab = (this._state.islandBuildings[this._curIsl?.def?.id]||[])
      .find(i=>i.buildingId==='research_lab' && i.state==='active');
    const labLv = lab ? lab.level : 0;
    if(b.unlock.requiredLabLevel) return labLv >= b.unlock.requiredLabLevel;
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  //  CONTEXT DOCK — the single panel for an island's whole lifecycle
  // ════════════════════════════════════════════════════════════════
  _renderIsland(isl){
    const st=this._state;
    const el=document.getElementById('island-panel'); if(!el)return;
    const allInst   = st.islandBuildings[isl.def.id] || [];
    const instances = allInst.filter(i=>i.state!=='destroyed'&&i.state!=='moving');
    const constructing = instances.filter(i=>i.state==='building');
    const upgrading    = instances.filter(i=>i.upgradeTimer>0&&i.state==='active');
    const active       = instances.filter(i=>i.state==='active');
    const isPlayer     = isl.own==='player';

    // ── Production (trait + adjacency applied via BuildSystem) ──
    let woodProd=0,goldProd=0;
    (this._build.getProducingInstances?.()||[]).forEach(({id,prod,isl:pIsl})=>{
      if(pIsl?.def?.id!==isl.def.id) return;
      if(id==='lumber_mill') woodProd+=prod;
      if(id==='gold_mine')   goldProd+=prod;
    });
    // AW: harbor clock (data/harbor.js HARBOR_ECONOMY.rateMult; 1 in Open War)
    woodProd *= st.econRateMult ?? 1; goldProd *= st.econRateMult ?? 1;

    const usedCells = this._build.getOccupiedCellCount?.(isl)??instances.length;
    const maxCells  = isl.validGridKeys?isl.validGridKeys.size:100;
    const cellPct   = Math.round((usedCells/maxCells)*100);
    const cellCol   = cellPct>85?'var(--accent-red)':cellPct>60?'var(--accent-gold)':'var(--accent-teal)';
    const fortHpPct = Math.max(0,Math.round(isl.hp/isl.maxHp*100));
    const fortCol   = fortHpPct>60?'var(--accent-green)':fortHpPct>30?'var(--accent-gold)':'var(--accent-red)';
    const ownerKey  = isl.own||'neutral';
    const ownerLabel= ownerKey==='player'?'YOUR ISLAND':ownerKey==='enemy'?'ENEMY':'NEUTRAL';
    const shapeBadge= SHAPE_BADGE[isl.shapeType]||'';
    const trait     = getTrait(isl);

    // ── Header + Overview ──
    let html = `
      <div class="dock-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="min-width:0">
            <div class="isl-name">${_esc(isl.nm)}</div>
            <div class="isl-sub">
              <span class="isl-owner-badge ${ownerKey}">${ownerLabel}</span>
              ${shapeBadge?`<span style="font-size:9px;color:var(--txt-faint)">${shapeBadge}</span>`:''}
            </div>
          </div>
          <span class="dock-close" data-action="close-panel" data-panel="island-panel">✕</span>
        </div>
        ${trait?`<div class="isl-trait" title="${trait.desc}">
          <span class="isl-trait-ic">${trait.icon}</span><span class="isl-trait-nm">${trait.name}</span>
          <span class="isl-trait-desc">${trait.desc}</span></div>`:''}
      </div>

      <div class="dock-overview">
        <div class="dock-ov-fort">
          <div class="dock-ov-lbl">⚔ Fort</div>
          <div class="fort-hp-row">
            <div class="fort-hp-bar"><div class="fort-hp-fill" style="width:${fortHpPct}%;background:${fortCol}"></div></div>
            <span style="font-size:9px;color:${fortCol};font-family:'JetBrains Mono',monospace">${Math.round(isl.hp)}/${isl.maxHp}</span>
          </div>
        </div>
        ${isPlayer?`<div class="dock-ov-stats">
          <div class="dock-ov-chip" title="Production per second">
            ${woodProd>0||goldProd>0
              ? `${woodProd>0?`🪵+${woodProd.toFixed(1)}`:''} ${goldProd>0?`🪙+${goldProd.toFixed(1)}`:''}`
              : '<span style="color:var(--txt-faint)">No production</span>'}
          </div>
          <div class="dock-ov-chip" title="Building cells used">
            <span style="color:${cellCol}">▦</span> ${usedCells}/${maxCells}
          </div>
        </div>`:''}
      </div>`;

    if(isPlayer && isl.down){
      html += `<div class="dock-section dock-alert">
        <div class="dock-alert-txt">☠ Fort destroyed</div>
        <button class="dock-btn dock-btn-gold" data-action="rebuild-fort" data-isl="${isl.def.id}">⚒ Rebuild Fort · 🪵150 🪙80</button>
      </div>`;
    }

    if(isPlayer){
      // ── BUILD PALETTE (inline, collapsible groups) ──
      html += this._renderBuildPalette(isl, instances);

      // ── BUILDINGS (active) with inline-expand detail ──
      if(active.length || constructing.length || upgrading.length){
        html += `<div class="dock-section">
          <div class="dock-section-hdr">🏠 Buildings <span class="dock-count">${active.length}</span></div>`;
        // under-construction first
        constructing.forEach(inst=>{
          const def=ALL_DEFS.find(b=>b.id===inst.buildingId);
          const dur=inst.buildDuration||1, rem=Math.max(0,inst.buildTimer||0);
          const pct=Math.round((1-rem/dur)*100);
          html += `<div class="dock-bld-row building">
            <span class="dock-bld-ic">${def?.icon||'?'}</span>
            <div class="dock-bld-mid">
              <div class="dock-bld-nm">${def?.name||inst.buildingId} <span style="color:#40c8ff;font-size:9px">building…</span></div>
              <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;background:#40c8ff"></div></div>
            </div>
            <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#40c8ff">${Math.ceil(rem)}s</span>
          </div>`;
        });
        // active (expandable)
        active.forEach(inst=>{
          html += this._renderBuildingRow(inst, isl);
        });
        html += `</div>`;
      }
    } else {
      html += `<div class="dock-cta">
        <div style="font-size:18px;margin-bottom:4px">⚓</div>
        Sail a fleet here to ${ownerKey==='enemy'?'raid or capture':'capture'} this island.
        ${active.length?`<div style="margin-top:6px;color:var(--accent-teal);font-size:9px">${active.length} building${active.length>1?'s':''} to inherit on capture</div>`:''}
      </div>`;
      // show (read-only) building list for scouting
      if(active.length){
        html += `<div class="dock-section"><div class="dock-section-hdr">🔭 Buildings <span class="dock-count">${active.length}</span></div>`;
        active.forEach(inst=>{
          const def=ALL_DEFS.find(b=>b.id===inst.buildingId);
          html += `<div class="dock-bld-row" style="cursor:default">
            <span class="dock-bld-ic">${def?.icon||'?'}</span>
            <div class="dock-bld-mid"><div class="dock-bld-nm">${def?.name||inst.buildingId}</div>
            <div class="dock-bld-sub">Level ${inst.level}</div></div>
          </div>`;
        });
        html += `</div>`;
      }
    }

    // AT: no-flicker refresh — the 0.25 s UI tick calls _refresh() even when
    // nothing changed; rebuilding identical innerHTML nukes hover states and
    // scroll position. Skip when unchanged, preserve scroll when not.
    if (html === this._lastHtml && el.childNodes.length) return;
    this._lastHtml = html;
    const _scroll = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = _scroll;
    this._wireDock(el, isl);
  }

  // ── Build palette: grouped, collapsible, click=build-mode ──
  _renderBuildPalette(isl, instances){
    const st=this._state;
    const GROUPS=[
      {key:'resource', label:'Resources', icon:'📦', items:BUILDINGS.filter(b=>b.category==='resource')},
      {key:'military', label:'Military',  icon:'⚔', items:BUILDINGS.filter(b=>b.category==='military')},
      {key:'utility',  label:'Utility',   icon:'🔧', items:BUILDINGS.filter(b=>b.category==='utility')},
      {key:'defense',  label:'Defenses',  icon:'🛡', items:DEFENSES},
    ];
    let h=`<div class="dock-section">
      <div class="dock-section-hdr">🏗 Build</div>
      <div class="dock-build-hint-inline">Pick a building, then click a glowing cell</div>`;
    GROUPS.forEach(g=>{
      if(!g.items.length) return;
      const open = this._openGroup===g.key;
      const affordCount = g.items.filter(b=>this._isUnlocked(b)
        && (c=>st.resWood>=c.wood && st.resGold>=c.gold)(harborBuildCost(b,0,st.harborBuildCostMult??1))).length;
      h+=`<div class="dock-grp ${open?'open':''}" data-grp="${g.key}">
        <div class="dock-grp-hdr" data-action="toggle-grp" data-grp="${g.key}">
          <span class="dock-grp-caret">${open?'▾':'▸'}</span>
          <span class="dock-grp-ic">${g.icon}</span>
          <span class="dock-grp-nm">${g.label}</span>
          <span class="dock-grp-badge">${affordCount}/${g.items.length}</span>
        </div>`;
      if(open){
        h+=`<div class="dock-grp-body">`;
        g.items.forEach(b=>{
          const unlocked=this._isUnlocked(b);
          const {wood:cW, gold:cG}=harborBuildCost(b,0,st.harborBuildCostMult??1);
          const cant=!unlocked||st.resWood<cW||st.resGold<cG;
          const isSel=(st.selectedBuilding===b)||(st.selectedDefense===b);
          const built=instances.filter(i=>i.buildingId===b.id&&i.state!=='destroyed').length;
          const fp=b.footprint||{w:1,h:1};
          const lockMsg=!unlocked?(b.unlock?.requiredLabLevel?`🔒 Lab Lv${b.unlock.requiredLabLevel}`:'🔒'):'';
          const costStr=[cW?`🪵${cW}`:'',cG?`🪙${cG}`:''].filter(Boolean).join(' ');
          h+=`<div class="dock-build-card${cant?' cant':''}${isSel?' sel':''}" data-cat="${b.isDefense?'defense':(b.category||'resource')}"
                ${cant?'':`data-action="pick-build" data-bid="${b.id}"`}>
            <span class="dbc-ic">${b.icon}</span>
            <div class="dbc-mid">
              <div class="dbc-nm">${b.name}${built>0?` <span class="dbc-ct">×${built}</span>`:''} <span class="dbc-fp">${fp.w}×${fp.h}</span></div>
              <div class="dbc-desc">${lockMsg||b.desc||''}</div>
            </div>
            <span class="dbc-cost">${costStr}</span>
          </div>`;
        });
        h+=`</div>`;
      }
      h+=`</div>`;
    });
    h+=`</div>`;
    return h;
  }

  // ── A building row; if expanded, shows inline detail/actions ──
  _renderBuildingRow(inst, isl){
    const st=this._state;
    const def=ALL_DEFS.find(b=>b.id===inst.buildingId);
    if(!def) return '';
    const expanded = this._openInst===inst.instanceId;
    const hpPct=Math.round(inst.hp/inst.maxHp*100);
    const hpCol=hpPct>60?'var(--accent-green)':hpPct>30?'var(--accent-gold)':'var(--accent-red)';
    const damaged=inst.hp<inst.maxHp;
    const upgrading=inst.upgradeTimer>0;

    let row=`<div class="dock-bld-row${expanded?' expanded':''}" ${expanded?'':`data-action="expand-bld" data-inst="${inst.instanceId}"`}>
      <span class="dock-bld-ic">${def.icon}</span>
      <div class="dock-bld-mid">
        <div class="dock-bld-nm">${def.name} <span class="dock-bld-lv">Lv${inst.level}</span>${damaged?' <span style="color:#e07070;font-size:9px">⚠</span>':''}</div>
        <div class="dock-bld-hp"><div class="dock-bld-hpfill" style="width:${hpPct}%;background:${hpCol}"></div></div>
      </div>
      <span class="dock-bld-caret">${expanded?'▾':'▸'}</span>
    </div>`;

    if(expanded){
      const {wood:upCostW, gold:upCostG}=harborBuildCost(def,inst.level,st.harborBuildCostMult??1);
      const canUp=inst.level<10&&st.resWood>=upCostW&&st.resGold>=upCostG;
      const canManage=isl.own==='player';

      // stats
      let stats='';
      if(def.isDefense){
        const ds=getDefenseStats(def,inst.level);
        stats=`<span>⚔ ${ds.damage} dmg</span><span>◎ ${ds.range}u</span><span>◉ ${ds.accuracy}%</span>`;
      } else if(def.id==='lumber_mill'||def.id==='gold_mine'){
        const res=def.id==='lumber_mill'?'🪵':'🪙';
        const base=(def.productionByLevel&&def.productionByLevel[inst.level-1])||0;
        stats=`<span>${res} ${base}/s base</span><span style="color:var(--accent-teal)">+adjacency & trait applied</span>`;
      } else if(def.id==='warehouse'){
        stats=`<span>🏛 +cap & loot protection</span>`;
      } else {
        stats=`<span>${def.desc||''}</span>`;
      }

      // repair cost (if damaged)
      let repairBtn='';
      if(damaged && canManage){
        const dmgFrac=1-(inst.hp/inst.maxHp);
        const rcW=Math.max(5,Math.ceil(((def.cost?.wood)||0)*0.25*dmgFrac));
        const rcG=Math.max(5,Math.ceil(((def.cost?.gold)||0)*0.25*dmgFrac));
        const afford=st.resWood>=rcW&&st.resGold>=rcG;
        repairBtn=`<button class="dock-btn dock-btn-teal${afford?'':' disabled'}" ${afford?'':'disabled'}
          data-action="repair" data-inst="${inst.instanceId}" data-isl="${isl.def.id}">
          🔧 Repair · ${rcW?'🪵'+rcW:''} ${rcG?'🪙'+rcG:''}</button>`;
      }

      row+=`<div class="dock-bld-detail">
        <div class="dock-detail-stats">${stats}</div>
        <div class="dock-bld-hpline">HP ${Math.round(inst.hp)}/${inst.maxHp}${upgrading?' · ⬆ upgrading…':''}</div>
        ${repairBtn}
        ${canManage&&!upgrading?`<div class="dock-detail-actions">
          <button class="dock-btn dock-btn-gold${canUp?'':' disabled'}" ${canUp?'':'disabled'}
            data-action="upgrade" data-inst="${inst.instanceId}" data-isl="${isl.def.id}">
            ⬆ ${inst.level>=10?'MAX':`Upgrade · 🪵${upCostW} 🪙${upCostG}`}</button>
          <button class="dock-btn dock-btn-ghost" data-action="move" data-inst="${inst.instanceId}" data-isl="${isl.def.id}" title="Relocate (free)">↻</button>
          <button class="dock-btn dock-btn-danger" data-action="demolish" data-inst="${inst.instanceId}" data-isl="${isl.def.id}" title="Demolish (50% refund)">🗑</button>
        </div>`:''}
      </div>`;
    }
    return row;
  }

  // ── Single delegated click handler for the whole dock ──
  _wireDock(el, isl){
    el.onclick=(e)=>{
      const t=e.target.closest('[data-action]');
      if(!t) return;
      const a=t.dataset.action;
      const st=this._state;
      if(a==='close-panel'){ window.closePanel?.(t.dataset.panel); return; }
      if(a==='toggle-grp'){
        this._openGroup = this._openGroup===t.dataset.grp ? null : t.dataset.grp;
        this._renderIsland(isl); return;
      }
      if(a==='pick-build'){
        this._pickBuild(t.dataset.bid, isl); return;
      }
      if(a==='expand-bld'){
        this._openInst = t.dataset.inst;
        this._renderIsland(isl);
        requestAnimationFrame(()=>document.querySelector('.dock-bld-row.expanded')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
        return;
      }
      if(a==='upgrade')        this._upgradeInst(t.dataset.inst,t.dataset.isl);
      else if(a==='move')      this._moveInst(t.dataset.inst,t.dataset.isl);
      else if(a==='demolish')  this._demolishInst(t.dataset.inst,t.dataset.isl);
      else if(a==='repair')    window.repairBuilding?.(t.dataset.inst,t.dataset.isl);
      else if(a==='rebuild-fort') window.rebuildFort?.(t.dataset.isl);
    };
  }

  // ── Pick a building → enter SC2 build-mode (ghost from AQ) ──
  _pickBuild(bid, isl){
    const st=this._state;
    const b=[...BUILDINGS,...DEFENSES].find(x=>x.id===bid);
    if(!b) return;
    const already=(st.selectedBuilding===b)||(st.selectedDefense===b);
    if(st._moveMode && st._movingInst) this._build.cancelMove();
    if(already){
      st.selectedBuilding=null; st.selectedDefense=null; st.buildMode=false;
      this._build.clearGrid();
      const hint=document.getElementById('build-hint'); if(hint) hint.style.display='none';
    } else {
      st.selectedBuilding=b.isDefense?null:b;
      st.selectedDefense =b.isDefense?b:null;
      st.buildMode=true; st.buildRotated=false;
      const hint=document.getElementById('build-hint');
      if(hint){
        const fp=b.footprint||{w:1,h:1};
        const rotHint=fp.w!==fp.h?(T.rotateHint||' · R to rotate'):'';
        hint.innerHTML=`🏗 ${b.icon} <b>${b.name}</b> <span style="color:var(--accent-gold)">${fp.w}×${fp.h}</span><br><small>${T.clickGreen||'Click a glowing cell'}${rotHint} · Esc to cancel</small>`;
        hint.style.display='block';
      }
      this._build.showGrid(isl);
    }
    this._renderIsland(isl);
  }

  _upgradeInst(instanceId, islId){
    const st=this._state;
    const instances=st.islandBuildings[islId]||[];
    const inst=instances.find(i=>i.instanceId===instanceId); if(!inst)return;
    const isl=this._islands.find(i=>i.def.id===islId); if(!isl)return;
    const ok=this._build.upgradeInstance(inst,isl);
    if(!ok){ this._flashMsg('Not enough resources!'); return; }
    this._openInst = inst.instanceId;   // AR: keep detail expanded inline
    this._refresh();
    this._bus.emit('building:upgraded',{instance:inst,island:isl});
  }

  _demolishInst(instanceId, islId){
    const st=this._state;
    const instances=st.islandBuildings[islId]||[];
    const idx=instances.findIndex(i=>i.instanceId===instanceId); if(idx<0)return;
    const inst=instances[idx];
    const def=ALL_DEFS.find(b=>b.id===inst.buildingId);
    const isl=this._islands.find(i=>i.def.id===islId); if(!isl)return;

    // 50% resource refund
    const refundW=Math.floor(((def&&def.cost&&def.cost.wood)||0)*inst.level*.5);
    const refundG=Math.floor(((def&&def.cost&&def.cost.gold)||0)*inst.level*.5);
    st.resWood=Math.min(st.resWood+refundW, 800+(st._warehouseCapBonus||0));
    st.resGold=Math.min(st.resGold+refundG, 600+(st._warehouseCapBonus||0));

    // Remove mesh via BuildSystem's THREE.Scene reference
    if(inst.mesh) {
      const s=this._build._scene;
      if(s) s.remove(inst.mesh);
      // B2: dispose geometry, materials and canvas textures to prevent GPU leak
      inst.mesh.traverse(c => {
        c.geometry?.dispose();
        if(c.material){
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(m => { m.map?.dispose(); m.dispose(); });
        }
      });
      inst.mesh.visible = false;
    }
    inst.state='destroyed';
    // Don't splice — keep for history; destroyed instances filtered on render

    this._openInst = null;   // AR: collapse detail
    this._refresh();
    this._bus.emit('building:demolished',{instance:inst,island:isl});
    this._flashMsg(`🗑 ${(def&&def.name)||'Building'} demolished (+🪵${refundW} +🪙${refundG})`);
  }

  _moveInst(instanceId, islId){
    const st=this._state;
    const instances=st.islandBuildings[islId]||[];
    const inst=instances.find(i=>i.instanceId===instanceId); if(!inst)return;
    const isl=this._islands.find(i=>i.def.id===islId); if(!isl)return;
    const def=ALL_DEFS.find(b=>b.id===inst.buildingId);
    if(!def) return;

    // Step 1: remove mesh and mark as destroyed (no refund — this is a reallocation)
    const prevState = inst.state;
    if(inst.mesh) inst.mesh.visible = false;
    inst.state='moving';
    this._build.recalcWarehouse();

    // Step 2: collapse inline detail (AR)
    this._openInst = null;

    // Step 3: flag no-cost placement — BuildSystem reads this and skips deduction.
    // Also store the old instance so BuildSystem can preserve level/HP/facingDeg.
    st._moveMode = true;
    st._movingInst = { source: inst, prevState, islandId: islId, instanceId: inst.instanceId, level: inst.level,
                       hp: inst.hp, maxHp: inst.maxHp, facingDeg: inst.facingDeg,
                       buildTimer: inst.buildTimer, buildDuration: inst.buildDuration,
                       pendingLevel: inst.pendingLevel, upgradeTimer: inst.upgradeTimer, upgradeDuration: inst.upgradeDuration,
                       armTimer: inst.armTimer, warnTimer: inst.warnTimer,
                       cooldownTimer: inst.cooldownTimer, fireTimer: inst.fireTimer };

    // Step 4: re-enter build mode with same building, preserve rotation
    st.buildRotated = inst.rotated||false;
    if(def.isDefense) st.selectedDefense=def;
    else              st.selectedBuilding=def;
    st.buildMode=true;

    // Step 5: show grid and hint
    this._build.showGrid(isl);
    const hint=document.getElementById('build-hint');
    if(hint){
      hint.style.display='block';
      const fp=def.footprint||{w:1,h:1};
      const eff=st.buildRotated?{w:fp.h,h:fp.w}:fp;
      hint.innerHTML=`↻ Moving ${def.icon} <b>${def.name}</b> <span style="color:var(--brass-deep)">${eff.w}×${eff.h}</span><br><small>Click 🟩 cell · R to rotate · Esc to cancel (free — no cost)</small>`;
    }

    this._refresh();
    this._flashMsg(`↻ Moving ${def.name} — pick a new location (free)`);
  }

  _flashMsg(txt){ toasts.show(txt, 2500); }   // AN/G1: stacked toast
}
