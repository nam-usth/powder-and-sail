import { BUILDINGS } from '../../data/buildings.js';
import { DEFENSES } from '../../data/defenses.js';
import { BUILD_GRID_SIZE } from '../../data/constants.js';
import { T } from '../../i18n.js';
import { PanelManager } from './PanelManager.js';
import { harborBuildCost } from '../../Meta/HarborEconomy.js';

// Display groups (category id → display info). Order matters — first is rendered first.
const CATEGORY_GROUPS = [
  { key: 'resource',  get name(){ return T.catResource; },  icon: '🪵', filter: (b) => b.category === 'resource' },
  { key: 'military',  get name(){ return T.catMilitary; },     icon: '⚔',  filter: (b) => b.category === 'military' },
  { key: 'utility',   get name(){ return T.catResearch; },  icon: '🔬', filter: (b) => b.category === 'utility' },
  { key: 'defense',   get name(){ return T.catDefense; },   icon: '🗼', filter: (b) => b.isDefense === true },
];

export class BuildPanel {
  constructor(state, buildSys, islands, bus){
    this._state   = state;
    this._build   = buildSys;
    this._islands = islands;
    this._bus     = bus;
    this._homeIsl = null;
    // Collapsed state per group (persists across renders)
    this._collapsed = new Set(); // category keys that are collapsed
    const bp = document.getElementById('bp');
    const closeBtn = bp ? bp.querySelector('.px') : null;
    if(closeBtn) closeBtn.addEventListener('click', () => this.close());
    bus.on('building:placed', () => this._render());
    bus.on('building:upgraded', () => this._render());
    bus.on('building:demolished', () => this._render());
  }

  toggle(){ PanelManager.isOpen('bp') ? this.close() : this.open(); }
  open(){ PanelManager.open('bp'); this._render(); }
  close(){
    PanelManager.close('bp');
    const st = this._state;
    if(st._moveMode && st._movingInst) this._build.cancelMove();
    st.selectedBuilding = null; st.selectedDefense = null; st.buildMode = false;
    this._build.clearGrid();
    const hint = document.getElementById('build-hint');
    if(hint) hint.style.display = 'none';
  }

  _isUnlocked(b){
    const st = this._state;
    const u = b.unlock;
    if(!u) return true;
    if(u.requiredLabLevel && st.labLevel < u.requiredLabLevel) return false;
    if(u.requiredResearch && !st.researched?.has(u.requiredResearch)) return false;
    return true;
  }

  _allItems(){ return [...BUILDINGS, ...DEFENSES]; }

  _render(){
    const el = document.getElementById('bp-content');
    if(!el) return;
    const st = this._state;
    const homeIsl = this._homeIsl || this._islands[0];
    if(!homeIsl) return;

    const instances = st.islandBuildings[homeIsl.def.id] || [];
    const usedCells = ('getOccupiedCellCount' in this._build)
      ? this._build.getOccupiedCellCount(homeIsl)
      : instances.filter(i => i.state !== 'destroyed').length;
    // AF8 shape mask: count only cells the island shape actually allows —
    // keeps this counter consistent with IslandPanel (was full 10×10 grid).
    const maxCells = homeIsl.validGridKeys
      ? homeIsl.validGridKeys.size
      : BUILD_GRID_SIZE * BUILD_GRID_SIZE;

    // Top: title bar with cell counter + current island
    const islTag = `<span style="color:var(--brass-deep);font-family:var(--display);font-size:9px;letter-spacing:.14em">${homeIsl.nm}</span>`;
    const topHtml = `
      <div class="bp-top">
        <div class="bp-islnm">${islTag}</div>
        <div class="bp-cells" title="Build grid cells used / total">
          <span class="bp-cell-num">${T.cellsUsed(usedCells, maxCells)}</span>
        </div>
      </div>
      <div class="bp-hint">${T.buildHint}</div>
    `;

    el.innerHTML = topHtml + '<div id="bp-groups"></div>';
    const groupsHost = document.getElementById('bp-groups');

    // Render each group with collapsible header
    CATEGORY_GROUPS.forEach(g => {
      const items = this._allItems().filter(g.filter);
      if(!items.length) return;
      const collapsed = this._collapsed.has(g.key);

      const grp = document.createElement('div');
      grp.className = 'bp-group';

      const builtTotal = instances.filter(i => items.find(it => it.id === i.buildingId) && i.state !== 'destroyed').length;

      const hdr = document.createElement('div');
      hdr.className = 'bp-grp-hdr' + (collapsed ? ' collapsed' : '');
      hdr.innerHTML = `
        <span class="bp-grp-tw">▾</span>
        <span class="bp-grp-ic">${g.icon}</span>
        <span class="bp-grp-nm">${g.name}</span>
        <span class="bp-grp-count">${builtTotal ? `${builtTotal}` : ''}</span>
      `;
      hdr.addEventListener('click', () => {
        if(this._collapsed.has(g.key)) this._collapsed.delete(g.key);
        else this._collapsed.add(g.key);
        this._render();
      });
      grp.appendChild(hdr);

      if(!collapsed){
        const body = document.createElement('div');
        body.className = 'bp-grp-body';
        items.forEach(b => body.appendChild(this._renderItem(b, instances, homeIsl)));
        grp.appendChild(body);
      }
      groupsHost.appendChild(grp);
    });

    // Placed-buildings footer with upgrade buttons
    const placed = instances.filter(i => i.state !== 'destroyed');
    if(placed.length){
      const foot = document.createElement('div');
      foot.className = 'bp-placed';
      foot.innerHTML = `<div class="bp-placed-hdr">${T.placedTitle(placed.length)}</div>`;
      placed.forEach(inst => {
        const bldDef = this._allItems().find(b => b.id === inst.buildingId);
        if(!bldDef) return;
        const { wood: upCostW, gold: upCostG } = harborBuildCost(bldDef, inst.level, st.harborBuildCostMult ?? 1);
        const canUp = inst.level < 10 && st.resWood >= upCostW && st.resGold >= upCostG;
        const hpPct = Math.round((inst.hp / inst.maxHp) * 100);
        const hpCol = hpPct > 60 ? 'var(--verd)' : hpPct > 30 ? 'var(--wax)' : '#a83838';
        const row = document.createElement('div');
        row.className = 'bp-placed-row';
        row.innerHTML = `
          <span class="bpr-ic">${bldDef.icon}</span>
          <div class="bpr-mid">
            <div class="bpr-nm">${bldDef.name} <span class="bpr-lv">Lv${inst.level}</span></div>
            <div class="bpr-hpbar"><div class="bpr-hpfill" style="width:${hpPct}%;background:${hpCol}"></div></div>
          </div>
          ${inst.level < 10
            ? `<button class="bpr-up ${canUp ? 'afford' : ''}" ${canUp ? '' : 'disabled'}>⬆ ${[upCostW ? '🪵' + upCostW : '', upCostG ? '🪙' + upCostG : ''].filter(Boolean).join(' ')}</button>`
            : `<span class="bpr-max">MAX</span>`}
        `;
        if(canUp){
          row.querySelector('.bpr-up').addEventListener('click', () => {
            this._build.upgradeInstance(inst, homeIsl);
            this._render();
          });
        }
        foot.appendChild(row);
      });
      groupsHost.appendChild(foot);
    }
  }

  _renderItem(b, instances, homeIsl){
    const st = this._state;
    const builtCount = instances.filter(i => i.buildingId === b.id && i.state !== 'destroyed').length;
    const isSel = (st.selectedBuilding === b) || (st.selectedDefense === b);
    const unlocked = this._isUnlocked(b);
    const { wood: cW, gold: cG } = harborBuildCost(b, 0, st.harborBuildCostMult ?? 1);
    const cant = !unlocked || st.resWood < cW || st.resGold < cG;
    const lockMsg = !unlocked
      ? (b.unlock?.requiredLabLevel ? `🔒 Lab Lv${b.unlock.requiredLabLevel}` : '🔒 Locked')
      : '';
    const fp = b.footprint || { w:1, h:1 };
    const costStr = [cW ? `🪵${cW}` : '', cG ? `🪙${cG}` : ''].filter(Boolean).join(' ');

    const item = document.createElement('div');
    // data-bid used by _updateAffordability to locate this element without full rebuild
    item.dataset.bid = b.id;
    item.dataset.cat = b.isDefense ? 'defense' : (b.category || 'resource');
    item.className = `bitem${cant ? ' cant' : ''}${isSel ? ' sel' : ''}${!unlocked ? ' locked' : ''}`;
    item.innerHTML = `
      <span class="bico">${b.icon}</span>
      <div class="bp-itm-mid">
        <div class="bnm">${b.name} <span class="bp-itm-fp">${fp.w}×${fp.h}</span>${builtCount > 0 ? ` <span class="bp-itm-ct">×${builtCount}</span>` : ''}</div>
        <div class="bstat">${lockMsg || b.desc}</div>
      </div>
      <span class="bcost">${costStr}</span>`;

    if(!cant && unlocked){
      item.addEventListener('click', () => {
        if(isSel){
          if(st._moveMode && st._movingInst) this._build.cancelMove();
          st.selectedBuilding = null; st.selectedDefense = null; st.buildMode = false;
          this._build.clearGrid();
          const hint = document.getElementById('build-hint');
          if(hint) hint.style.display = 'none';
        } else {
          if(st._moveMode && st._movingInst) this._build.cancelMove();
          st.selectedBuilding = b.isDefense ? null : b;
          st.selectedDefense  = b.isDefense ? b : null;
          st.buildMode = true; st.buildRotated = false;
          const hint = document.getElementById('build-hint');
          if(hint){
            const fp2 = b.footprint || { w:1, h:1 };
            const rotHint = fp2.w !== fp2.h ? T.rotateHint : '';
            hint.innerHTML = `🏗 ${b.icon} <b>${b.name}</b> <span style="color:var(--brass-deep)">${fp2.w}×${fp2.h}</span><br><small>${T.clickGreen}${rotHint}</small>`;
            hint.style.display = 'block';
          }
          this._build.showGrid(homeIsl);
        }
        this._render();
      });
    }
    return item;
  }

  // ── Lightweight affordability pass — NO DOM rebuild ───────────────
  // Called on the 0.25s tick instead of _render() to avoid button flicker.
  // Only touches CSS classes and disabled flags — no innerHTML changes.
  _updateAffordability() {
    if (!PanelManager.isOpen('bp')) return;
    const st  = this._state;
    const all = this._allItems();
    const el  = document.getElementById('bp-content');
    if (!el) return;

    // Update build items (cant class)
    el.querySelectorAll('[data-bid]').forEach(node => {
      const b = all.find(x => x.id === node.dataset.bid);
      if (!b) return;
      const unlocked = this._isUnlocked(b);
      const { wood: cW, gold: cG } = harborBuildCost(b, 0, st.harborBuildCostMult ?? 1);
      const cant = !unlocked || st.resWood < cW || st.resGold < cG;
      node.classList.toggle('cant', cant);
    });

    // Update upgrade buttons in placed section
    const homeIsl = this._homeIsl || this._islands[0];
    if (!homeIsl) return;
    const instances = st.islandBuildings[homeIsl.def.id] || [];
    el.querySelectorAll('.bpr-up').forEach(btn => {
      const row = btn.closest('.bp-placed-row');
      if (!row) return;
      // find matching instance by label text (fragile but avoids full rebuild)
      const nmEl = row.querySelector('.bpr-nm');
      if (!nmEl) return;
      // upgrade btn has cost encoded in text; re-check affordability
      const inst = instances.find(i => {
        const bld = all.find(x => x.id === i.buildingId);
        return bld && nmEl.textContent.includes(bld.name);
      });
      if (!inst) return;
      const bldDef = all.find(x => x.id === inst.buildingId);
      if (!bldDef) return;
      const { wood: upCostW, gold: upCostG } = harborBuildCost(bldDef, inst.level, st.harborBuildCostMult ?? 1);
      const canUp   = inst.level < 10 && st.resWood >= upCostW && st.resGold >= upCostG;
      btn.disabled = !canUp;
      btn.classList.toggle('afford', canUp);
    });
  }
}
