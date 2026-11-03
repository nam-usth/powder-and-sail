import { T } from '../../i18n.js';

/**
 * BuildingController — repair, rebuild, fort-rebuild logic.
 * Extracted from GameApp to keep each class ≤ 200 lines.
 */
export class BuildingController {
  constructor(game) {
    this._g = game;
  }

  repair(instanceId, islId) {
    const g  = this._g;
    const st = g._state;
    const isl  = g._islands.find(i => i.def.id === islId);
    if (!isl) { g._showMsg('Island not found', 1500); return; }
    const inst = (st.islandBuildings[islId] || []).find(i => i.instanceId === instanceId);
    if (!inst) { g._showMsg('Building not found', 1500); return; }
    if (inst.state === 'destroyed') { g._showMsg(T.repairNotDestroyed, 1800); return; }
    if (inst.hp >= inst.maxHp)      { g._showMsg(T.repairAlreadyFull,  1200); return; }
    const def = (window._ALL_DEFS || []).find(b => b.id === inst.buildingId);
    if (!def) return;
    const dmgFrac = 1 - (inst.hp / inst.maxHp);
    const costW = Math.max(5, Math.ceil((def.cost?.wood || 0) * 0.25 * dmgFrac));
    const costG = Math.max(5, Math.ceil((def.cost?.gold || 0) * 0.25 * dmgFrac));
    if (st.resWood < costW || st.resGold < costG) { g._showMsg(T.needResources(costW, costG), 2000); return; }
    st.resWood -= costW; st.resGold -= costG;
    inst.hp = inst.maxHp;
    // AF7: extinguish fire if fort is now fully repaired
    if (inst.buildingId === 'fort' || inst.buildingId?.startsWith('fort')) {
      isl.clearFire();
    }
    g._vfx.playSound('build');
    g._showMsg(T.repairOk(def.name, costW, costG), 2000);
    g._islandPanel?._refresh();
    g._buildUI?._render();
    if (g._islandPanel?._detailInst === inst) g._islandPanel.showBuildingDetail(inst, isl);
  }

  rebuild(instanceId, islId) {
    const g  = this._g;
    const st = g._state;
    const isl  = g._islands.find(i => i.def.id === islId);
    if (!isl) { g._showMsg('Island not found', 1500); return; }
    const inst = (st.islandBuildings[islId] || []).find(i => i.instanceId === instanceId);
    if (!inst) { g._showMsg('Building not found', 1500); return; }
    if (inst.state !== 'destroyed') { g._showMsg(T.rebuildNotDestroyed, 1500); return; }
    const def = (window._ALL_DEFS || []).find(b => b.id === inst.buildingId);
    if (!def) return;
    const costW = Math.ceil((def.cost?.wood || 0) * 0.60);
    const costG = Math.ceil((def.cost?.gold || 0) * 0.60);
    if (st.resWood < costW || st.resGold < costG) { g._showMsg(T.needResources(costW, costG), 2000); return; }
    st.resWood -= costW; st.resGold -= costG;
    inst.state = 'active';
    inst.hp    = inst.maxHp;
    if (inst.mesh) inst.mesh.visible = true;
    g._build.recalcWarehouse?.();
    g._vfx.playSound('build');
    g._showMsg(T.rebuildOk(def.name), 2200);
    g._islandPanel?._refresh();
    g._buildUI?._render();
  }

  startFortRebuild(islId) {
    const g  = this._g;
    const st = g._state;
    const isl = g._islands.find(i => i.def.id === islId);
    if (!isl || !isl.down) { g._showMsg('Fort is not destroyed', 1500); return; }
    const COST = { wood: 200, gold: 100 };
    const BUILD_TIME = 30;
    if (st.resWood < COST.wood || st.resGold < COST.gold) {
      g._showMsg(`Need wood:${COST.wood} gold:${COST.gold} to rebuild fort`, 2000); return;
    }
    if (st._fortRebuildQueue?.find(q => q.islId === islId)) {
      g._showMsg('Fort already being rebuilt', 1500); return;
    }
    st.resWood -= COST.wood; st.resGold -= COST.gold;
    if (!st._fortRebuildQueue) st._fortRebuildQueue = [];
    st._fortRebuildQueue.push({ islId, timer: BUILD_TIME, totalTime: BUILD_TIME });
    g._showMsg(`Fort rebuild started — ${BUILD_TIME}s`, 2500);
    g._vfx.playSound('build');
  }

  tickFortRebuild(dt) {
    const g  = this._g;
    const st = g._state;
    if (!st._fortRebuildQueue?.length) return;
    for (let i = st._fortRebuildQueue.length - 1; i >= 0; i--) {
      const q = st._fortRebuildQueue[i];
      q.timer -= dt;
      if (q.timer <= 0) {
        const isl = g._islands.find(il => il.def.id === q.islId);
        if (isl) { isl.rebuildFort(); g._vfx.playSound('build'); g._showMsg(T.fortRebuildQueue(isl.nm), 3000); }
        st._fortRebuildQueue.splice(i, 1);
      }
    }
  }
}
