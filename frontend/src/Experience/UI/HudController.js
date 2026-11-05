import { HULL_SLOTS } from '../../data/ships.js';
// F1: XSS guard
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

import { CANNONS, CANNON_BY_ID, getCannonFillCol } from '../../data/cannons.js';
import { ROLE_LABELS, ROLES } from '../Systems/Naval/FleetCommander.js';
import { FLEET_MAX_SHIPS, WOOD_CAP, GOLD_CAP, WOOD_RATE, GOLD_RATE } from '../../data/constants.js';
import { T } from '../../i18n.js';
import { fleetCap } from '../../Meta/Shipyard.js';

// Convert THREE-style 0xRRGGBB int to CSS hex
const colHex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

// Range tier glyphs (1=short, 2=mid, 3=long)
const TIER_DOTS = { 1: '·', 2: '··', 3: '···' };

// HUD layout (bottom of screen):
//   ┌─ fleet tabs = control groups (①Fleet 1 · ②Fleet 2 · +New) ─┐
//   ┌─ ship cards of the current SELECTION ─────────────────────┐
//
// AU: cards follow st.selection (box/click/group select), not a fleet.
// Each card: name, hull + fleet badge, HP, cannon reload pips, current order.
// Card click = select only that ship (Shift: drop it from the selection);
// double click = centre the camera on it; ⚙ = open its loadout.
// Fleet tab click = select that fleet's ships (same as pressing its number).

const STANCE_ICON = { aggressive: '⚔', defensive: '🛡', holdfire: '✋' };
const HULL_GLYPH  = { light: '⛵', standard: '🚢', heavy: '⚓' };

// AV: the selection row never scrolls. Room per card picks the density:
const CARD_GAP  = 7;
const FULL_MIN  = 122;   // ≥ this: full card
const COMPACT_MIN = 86;  // ≥ this: no pips / dropdown
const MINI_MIN  = 46;    // ≥ this: glyph + name + hull bar; below: "+N" chip

export class HudController {
  /** QA-007: fleet-group capacity shown on the tab. Open War: FLEET_MAX_SHIPS.
   *  Harbor/battle: the campaign fleet cap (Meta/Shipyard.fleetCap), or none until the session is known. */
  _groupCap(){
    const mode = this._state.mode;
    if (mode !== 'harbor' && mode !== 'battle') return FLEET_MAX_SHIPS;
    const prof = (typeof window !== 'undefined') && window._game?._opts?.session?.profile;
    if (!prof) return 0;
    try { return Math.min(FLEET_MAX_SHIPS, fleetCap(prof)); } catch { return 0; }
  }

  constructor(state, bus, fleet = null, orders = null){
    this._state = state;
    this._bus   = bus;
    this._cards = [];
    this._fleet = fleet;  // FleetCommander — set before rebuild so tabs render from start
    this._orders = orders; // OrderSystem — per-card order status
    this.rebuild();
    bus.on('ship:destroyed', () => setTimeout(() => this.rebuild(), 100));
    bus.on('revive:complete', () => this.rebuild());
    bus.on('selection:changed', () => this.rebuild());
    window.addEventListener('resize', () => this.fit());
    // Cache stable DOM nodes (created at page load, never replaced)
    this._domRW = null; this._domRG = null; this._domRL = null;
  }

  _getDomRes(){
    if(!this._domRW){ this._domRW = document.getElementById('rv-w'); }
    if(!this._domRG){ this._domRG = document.getElementById('rv-g'); }
    if(!this._domRL){ this._domRL = document.getElementById('rv-l'); }
    return { rw: this._domRW, rg: this._domRG, rl: this._domRL };
  }

  _ensureTabsContainer(){
    const fp = document.getElementById('fleet-panel');
    if(!fp) return null;
    let tabs = document.getElementById('fleet-tabs');
    if(!tabs){
      tabs = document.createElement('div');
      tabs.id = 'fleet-tabs';
      fp.parentNode.insertBefore(tabs, fp);
    }
    return tabs;
  }

  rebuild(){
    this._rebuild();
    this.fit();
  }

  /** AV: size fleet chips and ship cards to the room they have — no scrollbars. */
  fit(){
    const tabs = document.getElementById('fleet-tabs');
    if(tabs){
      tabs.classList.remove('crowded', 'tight');
      if(tabs.scrollWidth > tabs.clientWidth + 1) tabs.classList.add('crowded');
      if(tabs.scrollWidth > tabs.clientWidth + 1) tabs.classList.add('tight');
    }
    const fp = document.getElementById('fleet-panel');
    if(!fp) return;
    fp.querySelector('.scard-more')?.remove();
    const cards = [...fp.querySelectorAll('.scard')];
    cards.forEach(c => { c.style.display = ''; });
    const n = cards.length;
    fp.classList.remove('compact', 'mini');
    if(!n || !fp.clientWidth) return;
    const W = fp.clientWidth;
    const per = (W - CARD_GAP * (n - 1)) / n;
    if(per >= FULL_MIN) return;
    fp.classList.add(per >= COMPACT_MIN ? 'compact' : 'mini');
    if(per >= MINI_MIN) return;
    // still too many: show what fits and fold the rest into a "+N" chip
    const fit = Math.max(1, Math.floor((W + CARD_GAP) / (MINI_MIN + CARD_GAP)) - 1);
    cards.slice(fit).forEach(c => { c.style.display = 'none'; });
    const more = document.createElement('div');
    more.className = 'scard-more';
    more.textContent = `+${n - fit}`;
    more.title = `${n - fit} more selected ship${n - fit > 1 ? 's' : ''}`;
    fp.appendChild(more);
  }

  _rebuild(){
    const st = this._state;
    const fp = document.getElementById('fleet-panel');
    if(!fp) return;
    fp.innerHTML = '';
    this._cards = [];

    const tabs = this._ensureTabsContainer();
    if(tabs) tabs.innerHTML = '';

    // No fleets? render bare ship cards (failsafe).
    if(!this._fleet || !st.fleets || !st.fleets.length){
      this._renderBareShips(fp);
      return;
    }

    // ── FLEET TABS ──────────────────────────────────────────
    st.fleets.forEach(fleet => {
      const ships    = this._fleet.shipsOf(fleet.id);
      const isSel    = fleet.id === st.selectedFleetId && st._selIsFleet;
      const tab = document.createElement('div');
      tab.className = 'fleet-tab' + (isSel ? ' sel' : '');
      tab.style.setProperty('--fc', fleet.color);
      tab.title = `Select ${fleet.name} [${fleet.num}] · Ctrl+${fleet.num} assigns the selection`;
      tab.innerHTML = `
        <span class="ft-key">${fleet.num}</span>
        <span class="ft-stripe" style="background:${fleet.color}"></span>
        <span class="ft-nm">${fleet.name}</span>
        <span class="ft-hpbar"><span class="ft-hpfill" data-hpfid="${fleet.id}"></span></span>
        <span class="ft-cnt">${ships.length}${this._groupCap() ? '/' + this._groupCap() : ''}</span>
        <span class="ft-role" data-fid="${fleet.id}" title="Click to cycle role">${ROLE_LABELS[fleet.role] || fleet.role}</span>
        ${st.fleets.length > 1 ? `<span class="ft-x" data-fid="${fleet.id}" title="Disband fleet">✕</span>` : ''}
      `;
      tab.addEventListener('click', e => {
        if(e.target.classList.contains('ft-role') || e.target.classList.contains('ft-x')) return;
        window.selectFleet?.(fleet.id);
      });
      tabs.appendChild(tab);
    });

    // AN/G7: cache aggregate-HP fill elements (per-frame sync in update())
    this._tabHp = {};
    tabs.querySelectorAll('.ft-hpfill').forEach(el => { this._tabHp[el.dataset.hpfid] = el; });

    // "+ New Fleet" button
    const totalShips = st.playerShips.filter(s => s.alive).length;
    const newBtn = document.createElement('div');
    newBtn.className = 'fleet-tab new';
    newBtn.innerHTML = `<span class="ft-plus">＋</span><span class="ft-nm">New Fleet</span>`;
    newBtn.title = 'Create a new empty fleet';
    newBtn.addEventListener('click', () => window.newFleet?.());
    tabs.appendChild(newBtn);

    // Wire role cycle and disband
    tabs.querySelectorAll('.ft-role').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const fid = el.dataset.fid;
        const fleet = st.fleets.find(f => f.id === fid);
        if(!fleet) return;
        const cur = ROLES.indexOf(fleet.role);
        const nxt = ROLES[(cur + 1) % ROLES.length];
        window.setFleetRole?.(fid, nxt);
      });
    });
    tabs.querySelectorAll('.ft-x').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        window.disbandFleet?.(el.dataset.fid);
      });
    });

    // ── SHIP CARDS OF THE SELECTION ─────────────────────────
    const selShips = (st.selection || []).filter(s => s.alive);

    if(!selShips.length){
      const empty = document.createElement('div');
      empty.className = 'fleet-empty';
      empty.textContent = T.noShipsSelected;
      fp.appendChild(empty);
      return;
    }

    const fleetOf = new Map(st.fleets.map(f => [f.id, f]));
    selShips.forEach(s => {
      const i = st.playerShips.indexOf(s); // global rank
      const fl = fleetOf.get(s.fleetId);
      const div = document.createElement('div');
      div.className = 'scard';
      div.style.setProperty('--fc', fl?.color || '#c8a35a');
      div.title = 'Click: select only this ship · Shift+click: deselect · Double-click: centre camera';
      const slots = HULL_SLOTS[s.hull] || [];
      const pipsHtml = slots.map(slotId => {
        const cid = s.loadout[slotId];
        const cn  = cid ? CANNON_BY_ID.get(cid) : null;
        const col = cn ? colHex(getCannonFillCol(cid)) : 'transparent';
        const tier = cn ? cn.rt : 0;
        const dots = cn ? TIER_DOTS[tier] : '';
        const nm   = cn ? `${cn.nm} · range ${tier}` : `${slotId}: empty`;
        return `<div class="pip-wrap" data-slot="${slotId}" data-ship="${i}" title="${nm}">
            <div class="pip-label">${slotId}</div>
            <div class="pip" style="background:${cn ? '#1a1208' : 'transparent'};border-color:${cn ? col : 'var(--ink-3)'}">
              <div class="pip-fill" data-fill="${slotId}-${i}" style="background:${col}"></div>
            </div>
            <div class="pip-tier" style="color:${col}">${dots}</div>
          </div>`;
      }).join('');

      // "Move to fleet" selector
      const otherFleets = st.fleets.filter(f => f.id !== s.fleetId);
      const moveHtml = `<select class="scard-mv" title="Move ship to another fleet (or Ctrl+1–9)" data-shipidx="${i}">
            <option value="">${T.moveToFleetPlaceholder}</option>
            ${otherFleets.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
            <option value="__new__">${T.newFleetOption}</option>
           </select>`;

      div.innerHTML = `
        <div class="cname">${_esc(s.nm).toUpperCase()}<span class="scard-gear" title="Loadout [L]">⚙</span></div>
        <div class="chull"><span class="sc-glyph">${HULL_GLYPH[s.hull] || '⛵'}</span>${s.hull}${fl ? ` <span class="scard-fl">${fl.num}</span>` : ''}</div>
        <div class="hpwrap"><div class="hpfill" id="hf${i}" style="width:100%;background:#3ddc84"></div></div>
        <div class="chp" id="ht${i}">${Math.round(s.hp)}/${s.maxHp}</div>
        <div class="cpips">${pipsHtml}</div>
        <div class="scard-ord" id="so${i}"></div>
        ${moveHtml}
      `;
      div.addEventListener('click', e => {
        if(!s.alive) return;
        if(e.target.classList.contains('scard-gear')){
          st.selectedShip = s;
          this._bus.emit('ui:open_loadout', { ship: s });
          return;
        }
        window._game?._command?.[e.shiftKey ? 'toggle' : 'setSelection'](e.shiftKey ? s : [s]);
      });
      div.addEventListener('dblclick', () => { if(s.alive) window._game?._cam?.jumpTo(s.x, s.z); });
      fp.appendChild(div);

      // Wire move-to-fleet selector
      const mvSel = div.querySelector('.scard-mv');
      if(mvSel){
        mvSel.addEventListener('click', e => e.stopPropagation()); // don't reselect
        mvSel.addEventListener('change', e => {
          e.stopPropagation();
          const targetFleetId = mvSel.value;
          if(!targetFleetId) return;
          mvSel.value = ''; // reset
          window.moveShipToFleet?.(i, targetFleetId);
        });
      }

      // Cache pip fill elements by slot
      const pipFills = {};
      slots.forEach(slotId => {
        pipFills[slotId] = div.querySelector(`[data-fill="${slotId}-${i}"]`);
      });
      this._cards.push({
        div, ship: s, slots, pipFills,
        hf: document.getElementById('hf' + i),
        ht: document.getElementById('ht' + i),
        so: document.getElementById('so' + i),
      });
    });
  }

  /** Fallback if FleetCommander unavailable */
  _renderBareShips(fp){
    const st = this._state;
    st.playerShips.forEach((s, i) => {
      const div = document.createElement('div');
      div.className = 'scard' + (i === 0 ? ' leader' : '') + (s.alive ? '' : ' dead');
      const slots = HULL_SLOTS[s.hull] || [];
      const pipsHtml = slots.map(slotId => {
        const cid = s.loadout[slotId];
        const cn  = cid ? CANNON_BY_ID.get(cid) : null;
        const col = cn ? colHex(getCannonFillCol(cid)) : 'transparent';
        const dots = cn ? TIER_DOTS[cn.rt] : '';
        return `<div class="pip-wrap"><div class="pip-label">${slotId}</div><div class="pip"><div class="pip-fill" data-fill="${slotId}-${i}" style="background:${col}"></div></div><div class="pip-tier" style="color:${col}">${dots}</div></div>`;
      }).join('');
      div.innerHTML = `<div class="cname">${_esc(s.nm).toUpperCase()}</div><div class="chull">${s.hull}</div>
        <div class="hpwrap"><div class="hpfill" id="hf${i}" style="width:100%;background:#3ddc84"></div></div>
        <div class="chp" id="ht${i}">${Math.round(s.hp)}/${s.maxHp}</div>
        <div class="cpips">${pipsHtml}</div>`;
      div.addEventListener('click', () => {
        if(!s.alive) return;
        st.selectedShip = s;
        this._bus.emit('ui:open_loadout', { ship: s });
      });
      fp.appendChild(div);
      const pipFills = {};
      slots.forEach(slotId => { pipFills[slotId] = div.querySelector(`[data-fill="${slotId}-${i}"]`); });
      this._cards.push({
        div, ship: s, slots, pipFills,
        hf: document.getElementById('hf' + i),
        ht: document.getElementById('ht' + i),
      });
    });
  }

  update(){
    const st = this._state;

    // AN/G7: fleet tab aggregate HP — sum over LIVING ships of the fleet
    if(this._tabHp && st.fleets){
      st.fleets.forEach(f => {
        const el = this._tabHp[f.id]; if(!el) return;
        let hp = 0, mx = 0;
        st.playerShips.forEach(sh => {
          if(sh.fleetId !== f.id || !sh.alive) return;
          hp += sh.hp; mx += sh.maxHp;
        });
        const pct = mx > 0 ? Math.max(0, hp / mx * 100) : 0;
        el.style.width = pct + '%';
        el.style.background = pct > 60 ? '#3ddc84' : pct > 30 ? '#ffb300' : '#ff5252';
      });
    }

    this._cards.forEach(c => {
      const s = c.ship;
      if(!s) return;
      c.div.classList.toggle('dead', !s.alive);
      if(!s.alive){
        if(c.hf) c.hf.style.width = '0%';
        return;
      }
      const pct = Math.max(0, s.hp / s.maxHp * 100);
      const col = pct > 60 ? '#3ddc84' : pct > 30 ? '#ffb300' : '#ff5252';
      if(c.hf){ c.hf.style.width = pct + '%'; c.hf.style.background = col;
        c.hf.classList.toggle('critical', pct <= 20); }
      if(c.ht) c.ht.textContent = `${Math.max(0, Math.round(s.hp))}/${s.maxHp}`;
      if(c.so && this._orders){
        const txt = `${STANCE_ICON[s.stance] || ''} ${this._orders.describe(s)}`;
        if(c.so.textContent !== txt) c.so.textContent = txt;
      }
      // Per-cannon pip fills — update width (reload progress) AND color (cannon may have changed)
      if(c.slots && c.pipFills){
        c.slots.forEach(slotId => {
          const fill = c.pipFills[slotId];
          if(!fill) return;
          const cid = s.loadout[slotId];
          if(!cid){
            fill.style.width = '0%';
            fill.style.background = '';
            // Also reset pip border to empty state
            const pip = fill.parentElement;
            if(pip){ pip.style.borderColor = 'var(--ink-3)'; pip.style.background = 'transparent'; }
            return;
          }
          const cn = CANNON_BY_ID.get(cid);
          const col = colHex(getCannonFillCol(cid));
          // Sync color on every frame — cheap string compare, avoids stale color after loadout change
          if(fill.style.background !== col) fill.style.background = col;
          // Sync pip container color too
          const pip = fill.parentElement;
          if(pip && pip.style.borderColor !== col){ pip.style.borderColor = col; pip.style.background = '#1a1208'; }
          const cooldownTotal = (cn && cn.rof) || 1;
          const remain = Math.max(0, s.slotTimers[slotId] || 0);
          const ready  = remain <= 0;
          const fillPct = ready ? 100 : Math.max(0, 100 - (remain / cooldownTotal) * 100);
          fill.style.width = fillPct + '%';
          fill.classList.toggle('rdy', ready);
        });
      }
    });

    // Resource counters — AE.4: flash green animation when value increases
    const { rw, rg, rl } = this._getDomRes();
    const capW = WOOD_CAP + (st._warehouseCapBonus || 0);
    const capG = GOLD_CAP + (st._warehouseCapBonus || 0);
    const nearW = st.resWood / capW > 0.85;
    const nearG = st.resGold / capG > 0.85;
    const rates = window._game?._build?.getProductionRates?.() ?? { woodRate: 0, goldRate: 0 };
    // Total income = base rate (Town Hall) + building production
    const econK = st.econRateMult ?? 1;   // AW: harbor clock (data/harbor.js HARBOR_ECONOMY)
    const totalWoodRate = (WOOD_RATE + rates.woodRate) * econK;
    const totalGoldRate = (GOLD_RATE + rates.goldRate) * econK;
    const rateW = ` +${totalWoodRate.toFixed(1)}/s`;
    const rateG = ` +${totalGoldRate.toFixed(1)}/s`;
    const atCapW = st.resWood >= capW;
    const atCapG = st.resGold >= capG;
    const protW = st._warehouseProtected || 0;

    const flashRes = (el, newVal, prevVal) => {
      if(!el) return;
      if(newVal > (prevVal || 0)){
        el.classList.remove('res-gain');
        void el.offsetWidth;  // reflow to restart animation
        el.classList.add('res-gain');
      }
    };

    const protTip = protW > 0 ? ` · 🛡${Math.floor(protW)} protected` : '';
    if(rw){
      flashRes(rw, Math.floor(st.resWood), this._prevWood);
      this._prevWood = Math.floor(st.resWood);
      rw.textContent = `${Math.floor(st.resWood)}/${capW}${rateW}`;
      rw.style.color = atCapW ? '#cc4444' : nearW ? 'var(--wax)' : '';
      rw.style.fontWeight = atCapW ? '700' : '';
      rw.title = atCapW
        ? `FULL — build Warehouses to increase cap!${protTip}`
        : nearW ? `Near capacity${protTip}` : protTip || '';
    }
    if(rg){
      flashRes(rg, Math.floor(st.resGold), this._prevGold);
      this._prevGold = Math.floor(st.resGold);
      rg.textContent = `${Math.floor(st.resGold)}/${capG}${rateG}`;
      rg.style.color = atCapG ? '#cc4444' : nearG ? 'var(--wax)' : '';
      rg.style.fontWeight = atCapG ? '700' : '';
      rg.title = atCapG
        ? `FULL — build Warehouses to increase cap!${protTip}`
        : nearG ? `Near capacity${protTip}` : protTip || '';
    }
    if(rl) rl.textContent = Math.floor(st.lootPts);
  }
}
