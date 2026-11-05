import { CANNONS, CANNON_BY_ID, CANNON_FILL_COL, canMountCannon, isCannonKnown, cannonTechId, fallbackCannon, ROMAN_TIER } from '../../data/cannons.js';
import { HULL_SLOTS } from '../../data/ships.js';
import { UPGRADE_DEFS, TECH_TREE } from '../../data/upgrades.js';
import { applySpeed, calcSpeedMult } from '../World/ShipEntity.js';
import { PanelManager } from './PanelManager.js';
import { T } from '../../i18n.js';

// ── Helpers ───────────────────────────────────────────────────────
const colHex = n => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const CN_HEX  = Object.fromEntries(Object.entries(CANNON_FILL_COL).map(([k,v])=>[k, colHex(v)]));

function cannonDPS(cn) {
  return cn ? Math.round(cn.dmg / cn.rof * 10) / 10 : 0;
}
function shipTotalDPS(ship) {
  let t = 0;
  (HULL_SLOTS[ship.hull]||[]).forEach(sl => {
    const cn = CANNON_BY_ID.get(ship.loadout[sl]);
    if (cn) t += cn.dmg / cn.rof;
  });
  return Math.round(t * 10);   // ×10 scale for display impressiveness
}
function shipWeight(ship) {
  let w = 0;
  (HULL_SLOTS[ship.hull]||[]).forEach(sl => {
    const cn = CANNON_BY_ID.get(ship.loadout[sl]);
    if (cn) w += cn.wt;
  });
  return w;
}

// ── Cannon tooltip ────────────────────────────────────────────────
function showCannonTip(cn, e) {
  const tip = document.getElementById('cannon-tip');
  if (!tip) return;
  const arcTxt = T.arcLabel[cn.arc?.m] || cn.arc?.m || '?';
  const RANGE_LABELS = { 1:'8u  (short)', 2:'20u (mid)', 3:'40u (long)' };
  tip.innerHTML = `
    <div class="ct-name">${cn.nm}</div>
    <div class="ct-cls">${cn.cls.replace(/-/g,' ')}</div>
    <div class="ct-stats">
      <div class="ct-stat">${T.tipDamage} <b>${cn.dmg}</b></div>
      <div class="ct-stat">${T.tipRange}  <b>${RANGE_LABELS[cn.rt]||cn.rt}</b></div>
      <div class="ct-stat">${T.tipReload} <b>${cn.rof}s</b></div>
      <div class="ct-stat">${T.tipWeight} <b>${cn.wt}t</b></div>
    </div>
    <div class="ct-arc">🎯 ${arcTxt}</div>
    ${cn.ctr?`<div style="margin-top:4px;font-size:9px;color:var(--brass-light)">+${Math.round(cn.ctr.b*100)}% vs ${T.ctrLabel[cn.ctr.t]||cn.ctr.t}</div>`:''}
    ${cn.desc?`<div class="ct-desc">${cn.desc}</div>`:''}`;
  const pad=14, w=210;
  let x = e.clientX - w - pad;
  if(x < pad) x = e.clientX + pad;
  let y = e.clientY - 20;
  const maxY = window.innerHeight - 240;
  if(y > maxY) y = maxY;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  tip.classList.add('show');
}
const hideCannonTip = () => document.getElementById('cannon-tip')?.classList.remove('show');

/** Localised name of the research that unlocks a cannon. */
export function cannonTechName(id) {
  const t = cannonTechId(id); if (!t) return '';
  return T.techNames?.[t] || TECH_TREE.find(x => x.id === t)?.nm || t;
}

// ── Presets ───────────────────────────────────────────────────────
const PRESETS = [
  { id:'broadside',  label:'Broadside',  icon:'⚓', loadout:(h)=>{ const lo={}; (HULL_SLOTS[h]||[]).forEach(s=>{ lo[s]=s==='L'||s==='R'?'demi_culv':s==='B'?'long9':'swivel'; }); return lo; } },
  { id:'sniper',     label:'Sniper',     icon:'🎯', loadout:(h)=>{ const lo={}; (HULL_SLOTS[h]||[]).forEach(s=>{ lo[s]=s==='L'||s==='R'?'carronade':'long9'; }); return lo; } },
  { id:'siege',      label:'Siege',      icon:'💣', loadout:(h)=>{ const lo={}; (HULL_SLOTS[h]||[]).forEach(s=>{ lo[s]='mortar1'; }); return lo; } },
  { id:'brawler',    label:'Brawler',    icon:'⚔',  loadout:(h)=>{ const lo={}; (HULL_SLOTS[h]||[]).forEach(s=>{ lo[s]='demi_can'; }); return lo; } },
  { id:'clear',      label:'Clear All',  icon:'✕',  loadout:(h)=>{ const lo={}; (HULL_SLOTS[h]||[]).forEach(s=>{ lo[s]=null; }); return lo; } },
];
const presetLabel = (p) => T.lpPresets?.[p.id] || p.label;   // UI3: localised preset names

// Top-down ship silhouette SVG — hull shape varies by class
const SHIP_SVGS = {
  heavy: `<svg class="lp2-ship-svg" viewBox="0 0 84 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M42,6 L62,38 L66,118 Q65,150 42,154 Q19,150 18,118 L22,38 Z" fill="rgba(72,44,18,.7)" stroke="rgba(200,155,70,.65)" stroke-width="1.5"/>
    <path d="M30,10 Q42,2 54,10" stroke="rgba(200,155,70,.5)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="42" cy="56" r="5" fill="rgba(130,90,35,.9)"/>
    <circle cx="42" cy="80" r="3" fill="rgba(130,90,35,.7)"/>
    <circle cx="16" cy="68" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="16" cy="84" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="16" cy="100" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="68" cy="68" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="68" cy="84" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="68" cy="100" r="4" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <rect x="33" y="136" width="18" height="14" rx="2" fill="rgba(90,58,22,.7)" stroke="rgba(170,130,55,.3)" stroke-width="1"/>
    <line x1="24" y1="52" x2="60" y2="52" stroke="rgba(200,155,70,.2)" stroke-width="1"/>
    <line x1="21" y1="115" x2="63" y2="115" stroke="rgba(200,155,70,.15)" stroke-width="1" stroke-dasharray="3,3"/>
  </svg>`,
  standard: `<svg class="lp2-ship-svg" viewBox="0 0 76 148" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M38,6 L55,36 L58,110 Q57,138 38,142 Q19,138 18,110 L21,36 Z" fill="rgba(72,44,18,.7)" stroke="rgba(200,155,70,.65)" stroke-width="1.5"/>
    <path d="M27,10 Q38,3 49,10" stroke="rgba(200,155,70,.5)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="38" cy="50" r="4.5" fill="rgba(130,90,35,.9)"/>
    <circle cx="14" cy="62" r="3.5" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="14" cy="78" r="3.5" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="62" cy="62" r="3.5" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="62" cy="78" r="3.5" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <rect x="30" y="124" width="16" height="12" rx="2" fill="rgba(90,58,22,.7)" stroke="rgba(170,130,55,.3)" stroke-width="1"/>
    <line x1="21" y1="105" x2="55" y2="105" stroke="rgba(200,155,70,.15)" stroke-width="1" stroke-dasharray="3,3"/>
  </svg>`,
  light: `<svg class="lp2-ship-svg" viewBox="0 0 64 130" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32,5 L46,30 L48,96 Q47,122 32,126 Q17,122 16,96 L18,30 Z" fill="rgba(72,44,18,.7)" stroke="rgba(200,155,70,.65)" stroke-width="1.5"/>
    <path d="M23,8 Q32,2 41,8" stroke="rgba(200,155,70,.5)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="32" cy="42" r="4" fill="rgba(130,90,35,.9)"/>
    <circle cx="12" cy="54" r="3" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="12" cy="68" r="3" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="52" cy="54" r="3" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <circle cx="52" cy="68" r="3" fill="rgba(35,22,8,.8)" stroke="rgba(170,130,55,.4)" stroke-width=".8"/>
    <rect x="25" y="108" width="14" height="10" rx="2" fill="rgba(90,58,22,.7)" stroke="rgba(170,130,55,.3)" stroke-width="1"/>
  </svg>`,
};

// ── Main class ────────────────────────────────────────────────────
export class LoadoutPanel {
  constructor(state, overlay, bus) {
    this._state   = state;
    this._overlay = overlay;
    this._bus     = bus;
    this._ship    = null;
    this._picked  = null;
    this._tab     = 'cannons';
    document.getElementById('lp-close')?.addEventListener('click', () => this.close());
    bus.on('ui:open_loadout', ({ ship }) => this.open(ship));
    bus.on('ship:spawned',    () => { if (this._ship) this._render(); });
    bus.on('research:done',   () => { if (this._ship && PanelManager.isOpen('lp')) this._render(); });
  }

  /**
   * Researched techs that gate cannons — harbor + Sea Battle only; Open War
   * (mode 'skirmish') is unrestricted (null).
   */
  _known() {
    const st = this._state;
    return (st.mode === 'harbor' || st.mode === 'battle') ? (st.researched || new Set()) : null;
  }
  _canMount(cn, ship) { return canMountCannon(cn, ship, this._known()); }
  /** Why a cannon is locked on this ship: 'tier' | 'research' | null. */
  _lockReason(cn, ship) {
    if (!canMountCannon(cn, ship)) return 'tier';
    if (!isCannonKnown(cn.id, this._known())) return 'research';
    return null;
  }

  toggle() {
    PanelManager.isOpen('lp')
      ? this.close()
      : this.open(this._state.selectedShip || this._state.playerShips.find(s => s.alive));
  }
  open(ship) {
    if (!ship) return;
    this._ship = ship; this._picked = null;
    PanelManager.open('lp');
    this._render();
  }
  close() { PanelManager.close('lp'); this._ship = null; this._picked = null; }

  // ── Full render ───────────────────────────────────────────────
  _render() {
    this._renderNav();
    if (this._tab === 'cannons') this._renderCannons();
    else                         this._renderUpgrades();
  }

  // ── Header: ship navigator ────────────────────────────────────
  _renderNav() {
    const tabsEl = document.getElementById('lp-tabs');
    if (!tabsEl || !this._ship) return;
    const s    = this._ship;
    const st   = this._state;
    // S6: include ALL ships (alive + dead) so navigator doesn't break when opened for a dead ship
    const all  = st.playerShips;
    const idx  = all.indexOf(s);
    const fleet= st.fleets?.find(f => f.id === s.fleetId);
    const dead = !s.alive;

    const titleEl = document.getElementById('lp-title');
    if (titleEl) titleEl.style.display = 'none'; // hide generic title — nav replaces it

    tabsEl.innerHTML = `
      <div class="lp2-nav-row">
        <button class="lp2-arr" id="lp2-prev" ${idx <= 0 ? 'disabled' : ''}>◂</button>

        <div class="lp2-ident">
          <div class="lp2-nm" style="${dead ? 'opacity:.5;text-decoration:line-through' : ''}">${s.nm.toUpperCase()}${dead ? ' 💀' : ''}</div>
          <div class="lp2-sub">
            <span class="lp2-hull-badge">${s.hull}</span>
            ${fleet ? `<span class="lp2-fleet-dot" style="background:${fleet.color}"></span><span class="lp2-fleet-nm">${fleet.name}</span>` : ''}
            <span class="lp2-hp" style="color:${dead ? '#cc4040' : s.hp/s.maxHp > .5 ? '#60cc80' : s.hp/s.maxHp > .25 ? '#e8b840' : '#cc4040'}">${dead ? T.lpSunk : Math.round(s.hp/s.maxHp*100)+'% '+T.lpHp}</span>
          </div>
        </div>

        <div class="lp2-tab-pills">
          <button class="lp2-pill${this._tab==='cannons'?' on':''}" data-tab="cannons">${T.lpTabCannons}</button>
          <button class="lp2-pill${this._tab==='upgrades'?' on':''}" data-tab="upgrades">${T.lpTabUpgrades}</button>
        </div>

        <button class="lp2-arr" id="lp2-next" ${idx >= all.length - 1 ? 'disabled' : ''}>▸</button>
      </div>`;

    tabsEl.querySelector('#lp2-prev')?.addEventListener('click', () => {
      const newIdx = all.indexOf(this._ship) - 1;
      if (newIdx >= 0) { this._ship = all[newIdx]; this._picked = null; this._render(); }
    });
    tabsEl.querySelector('#lp2-next')?.addEventListener('click', () => {
      const newIdx = all.indexOf(this._ship) + 1;
      if (newIdx < all.length) { this._ship = all[newIdx]; this._picked = null; this._render(); }
    });
    tabsEl.querySelectorAll('.lp2-pill').forEach(btn => {
      btn.addEventListener('click', () => { this._tab = btn.dataset.tab; this._render(); });
    });
  }

  // ── Cannons tab ───────────────────────────────────────────────
  _renderCannons() {
    const body = document.getElementById('lp-body-root');
    if (!body || !this._ship) return;
    const s = this._ship;

    body.innerHTML = `
      <!-- ① Stats bar -->
      <div class="lp2-stats">
        <div class="lp2-dps-wrap">
          <div class="lp2-dps-lbl">${T.lpDps}</div>
          <div class="lp2-dps-val" id="lp2-dps">0</div>
        </div>
        <div class="lp2-weight-wrap" id="lp2-weight-wrap">
          <div class="lp2-wlabel" id="lp2-wlabel"></div>
          <div class="lp2-wtrack"><div class="lp2-wfill" id="lp2-wfill"></div></div>
          <div class="lp2-speed-val" id="lp2-speed"></div>
        </div>
      </div>

      <!-- ② Ship scene: slot grid around SVG -->
      <div class="lp2-scene" id="lp2-scene">
        <!-- slots injected below -->
      </div>

      <!-- ③ Hint -->
      <div class="lp2-hint-bar" id="lp2-hint">${T.lpHintIdle}</div>

      <!-- ④ Cannon cards -->
      <div class="lp2-cn-grid" id="lp2-cn-grid"></div>

      <!-- ⑤ Presets -->
      <div class="lp2-presets-bar">
        ${PRESETS.map(p => `<button class="lp2-preset" data-pid="${p.id}">${p.icon} ${presetLabel(p)}</button>`).join('')}
        <div class="lp2-preset-scope">
          <span class="lp2-scope-lbl">${T.applyTo}</span>
          <button class="lp2-scope-btn" data-scope="all">${T.allShips}</button>
          <button class="lp2-scope-btn" data-scope="hull">${T.sameHull}</button>
        </div>
      </div>`;

    // Wire presets
    body.querySelectorAll('.lp2-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = PRESETS.find(x => x.id === btn.dataset.pid);
        if (p) this._applyPreset(p, [s]);
      });
    });
    body.querySelectorAll('.lp2-scope-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._lastPreset) { this._flashHint(T.hintPresetFirst); return; }
        const st = this._state;
        const ships = btn.dataset.scope === 'hull'
          ? st.playerShips.filter(x => x.alive && x.hull === s.hull)
          : st.playerShips.filter(x => x.alive);
        this._applyPreset(this._lastPreset, ships);
      });
    });

    this._buildScene();
    this._buildCannonGrid();
    this._syncAll();
  }

  // ── Ship scene (CSS Grid: bow / port · ship · stbd / stern) ───
  _buildScene() {
    const scene = document.getElementById('lp2-scene');
    if (!scene || !this._ship) return;
    const s     = this._ship;
    const slots = HULL_SLOTS[s.hull] || [];
    const hasBow   = slots.includes('B');
    const hasStern = slots.includes('S');

    // CSS Grid: 3 cols (port-slot | ship | stbd-slot), 3 rows (bow | middle | ster)
    // Rows without a slot collapse to 0
    scene.style.gridTemplateAreas =
      `". bow ."  "port ship stbd"  ". ster ."`;
    scene.style.gridTemplateRows =
      `${hasBow ? '72px' : '0px'} 1fr ${hasStern ? '72px' : '0px'}`;
    scene.style.minHeight = hasBow || hasStern ? '240px' : '160px';

    // Ship SVG
    const shipDiv = document.createElement('div');
    shipDiv.style.gridArea = 'ship';
    shipDiv.style.display  = 'flex';
    shipDiv.style.alignItems = 'center';
    shipDiv.style.justifyContent = 'center';
    shipDiv.innerHTML = SHIP_SVGS[s.hull] || SHIP_SVGS.standard;
    scene.appendChild(shipDiv);

    // Slot buttons
    const AREAS = { L:'port', R:'stbd', B:'bow', S:'ster' };
    slots.forEach(slotId => {
      const btn = document.createElement('div');
      btn.className = 'lp2-slot';
      btn.id        = `lp2-s-${slotId}`;
      btn.dataset.slot = slotId;
      btn.style.gridArea = AREAS[slotId] || 'ship';
      btn.addEventListener('click', () => this._onSlotClick(slotId));
      scene.appendChild(btn);
    });
  }

  // ── Cannon card grid ──────────────────────────────────────────
  _buildCannonGrid() {
    const grid = document.getElementById('lp2-cn-grid');
    if (!grid) return;
    CANNONS.forEach(cn => {
      const col  = CN_HEX[cn.id] || '#888';
      const dps  = cannonDPS(cn);
      const card = document.createElement('div');
      card.className   = 'lp2-cn-card';
      card.id          = `lp2-cn-${cn.id}`;
      card.dataset.cannon = cn.id;
      card.innerHTML = `
        <div class="lp2-cn-circle" style="--cn-col:${col}">
          <div class="lp2-cn-tier">${ROMAN_TIER[cn.tier] || cn.tier}</div>
        </div>
        <div class="lp2-cn-name">${cn.nm}</div>
        <div class="lp2-cn-dps">${dps}/s</div>
        <div class="lp2-cn-req" id="lp2-req-${cn.id}"></div>
        <div class="lp2-cn-badge" id="lp2-badge-${cn.id}"></div>`;

      card.addEventListener('click', e => {
        e.stopPropagation();
        const why = this._lockReason(cn, this._ship);
        if (why === 'tier') { this._flashHint(T.lpTierNeed(cn.nm, ROMAN_TIER[cn.tier])); return; }
        if (why === 'research') { this._flashHint(T.lpResearchNeed(cn.nm, cannonTechName(cn.id))); return; }
        this._picked = (this._picked === cn.id) ? null : cn.id;
        this._syncAll();
      });
      card.addEventListener('dblclick', e => {
        e.stopPropagation();
        const s = this._ship;
        if (!this._canMount(cn, s)) return;
        (HULL_SLOTS[s.hull]||[]).forEach(sl => {
          if (!s.loadout[sl]) { s.loadout[sl] = cn.id; s.slotTimers[sl] = cn.rof; }
        });
        applySpeed(s); this._overlay.build(s);
        this._picked = null; this._syncAll();
        this._flashHint(T.hintFilled(cn.nm));
      });
      card.addEventListener('mouseenter', e => showCannonTip(cn, e));
      card.addEventListener('mousemove',  e => {
        const tip = document.getElementById('cannon-tip');
        if (tip) { const pad=14, w=210; let x=e.clientX-w-pad; if(x<pad)x=e.clientX+pad; tip.style.left=x+'px'; tip.style.top=Math.min(e.clientY-20,window.innerHeight-240)+'px'; }
      });
      card.addEventListener('mouseleave', hideCannonTip);
      grid.appendChild(card);
    });
  }

  // ── Sync all dynamic elements ─────────────────────────────────
  _syncAll() {
    const s = this._ship; if (!s) return;

    // DPS
    const dpsEl = document.getElementById('lp2-dps');
    if (dpsEl) dpsEl.textContent = shipTotalDPS(s);

    // Weight + Speed
    const w   = shipWeight(s);
    const sm  = calcSpeedMult(s);
    const pen = 1 - sm;
    const wPct = Math.min(100, w / (s.disp * 0.85) * 100);
    const wc  = pen > .25 ? '#e8b840' : pen > 0 ? '#d4a040' : '#60cc80';
    const lbl = document.getElementById('lp2-wlabel');
    const fill= document.getElementById('lp2-wfill');
    const spd = document.getElementById('lp2-speed');
    if (lbl)  lbl.textContent = `${w}/${s.disp}t`;
    if (fill) { fill.style.width = wPct + '%'; fill.style.background = wc; }
    if (spd)  spd.textContent  = pen > 0 ? `−${Math.round(pen*100)}%` : `×${sm.toFixed(2)}`;
    if (spd)  spd.style.color  = pen > 0 ? '#e8b840' : '#60cc80';

    // Slot buttons
    const picked = this._picked;
    const pickedCn = picked ? CANNON_BY_ID.get(picked) : null;
    (HULL_SLOTS[s.hull]||[]).forEach(slotId => {
      const btn = document.getElementById(`lp2-s-${slotId}`);
      if (!btn) return;
      const cn = CANNON_BY_ID.get(s.loadout[slotId]);
      const col = cn ? (CN_HEX[cn.id] || '#888') : null;
      btn.className = 'lp2-slot' + (cn ? ' filled' : ' empty') + (picked ? ' ready' : '');
      btn.style.setProperty('--slot-col', col || 'var(--ink-3)');
      btn.innerHTML = `
        <div class="lp2-slot-ring" style="border-color:${cn ? col : (picked ? 'var(--verd)' : 'var(--ink-3)')}">
          ${cn ? `<div class="lp2-slot-swatch" style="background:${col}"></div>` : `<div class="lp2-slot-empty-ico">${picked ? '+' : slotId}</div>`}
          <div class="lp2-slot-lbl">${cn ? cn.nm.split(' ')[0] : slotId}</div>
          ${cn ? `<div class="lp2-slot-dps">+${cannonDPS(cn)}/s</div>` : ''}
        </div>`;
      btn.title = cn
        ? (picked ? `${T.slotReplaceTip(cn.nm, pickedCn?.nm||'?')}` : `${T.slotClearTip(cn.nm)}`)
        : (picked ? T.slotEquipTip(pickedCn?.nm||'?', slotId) : T.slotEmptyTip);
    });

    // Cannon cards
    const eqCnt = {};
    Object.values(s.loadout).filter(Boolean).forEach(id => { eqCnt[id] = (eqCnt[id]||0)+1; });
    CANNONS.forEach(cn => {
      const card  = document.getElementById(`lp2-cn-${cn.id}`);
      if (!card) return;
      const isPk  = picked === cn.id;
      const cnt   = eqCnt[cn.id] || 0;
      card.classList.toggle('picked', isPk);
      const why = this._lockReason(cn, s);
      card.classList.toggle('locked', !!why);
      card.classList.toggle('research-locked', why === 'research');
      card.title = why === 'tier' ? T.lpTierTip(ROMAN_TIER[cn.tier], ROMAN_TIER[s.hullTier] || '?')
        : why === 'research' ? T.lpResearchTip(cannonTechName(cn.id)) : '';
      const req = document.getElementById(`lp2-req-${cn.id}`);
      if (req) req.textContent = why === 'research' ? T.lpResearchShort : '';
      card.classList.toggle('equipped', cnt > 0);
      const badge = document.getElementById(`lp2-badge-${cn.id}`);
      if (badge) badge.textContent = cnt > 0 ? `×${cnt}` : '';
    });

    // Hint bar
    const hint = document.getElementById('lp2-hint');
    if (hint) {
      if (pickedCn) {
        hint.className = 'lp2-hint-bar picked';
        hint.textContent = T.lpHintPicked(pickedCn.nm);
      } else {
        hint.className = 'lp2-hint-bar';
        hint.textContent = T.lpHintIdle;
      }
    }
  }

  // ── Slot click ────────────────────────────────────────────────
  _onSlotClick(slotId) {
    const s = this._ship; if (!s) return;
    if (!s.alive) return; // S6: disable equip actions for dead/sunk ships
    if (this._picked) {
      const cn = CANNON_BY_ID.get(this._picked);
      if (!this._canMount(cn, s)) { this._picked = null; this._syncAll(); return; }
      s.loadout[slotId] = this._picked;
      if (cn) s.slotTimers[slotId] = cn.rof;
      applySpeed(s); this._overlay.build(s);
      this._syncAll();
    } else {
      s.loadout[slotId] = null;
      applySpeed(s); this._overlay.build(s);
      this._syncAll();
    }
  }

  _flashHint(msg) {
    const el = document.getElementById('lp2-hint');
    if (!el) return;
    const prev = el.textContent, prevCls = el.className;
    el.className = 'lp2-hint-bar flash';
    el.textContent = msg;
    setTimeout(() => { if (el.isConnected) { el.textContent = prev; el.className = prevCls; } }, 2200);
  }

  // ── Upgrades tab ──────────────────────────────────────────────
  _renderUpgrades() {
    const body = document.getElementById('lp-body-root');
    if (!body || !this._ship) return;
    const st = this._state, ship = this._ship;
    const idx = st.playerShips.indexOf(ship), upgs = st.shipUpgrades[idx] || {};

    body.innerHTML = `<div class="lp2-upg-list" id="lp2-upg-list"></div>`;
    const list = document.getElementById('lp2-upg-list');
    UPGRADE_DEFS.forEach(upg => {
      const lv = upgs[upg.id] || 0, maxed = lv >= upg.max;
      const cW = (upg.base.wood||0)*(lv+1), cG = (upg.base.gold||0)*(lv+1);
      const can = !maxed && st.resWood >= cW && st.resGold >= cG;
      const row = document.createElement('div');
      row.className = `lp2-upg-row ${maxed?'maxed':can?'can':'locked'}`;
      row.innerHTML = `
        <span class="lp2-upg-icon">${upg.icon}</span>
        <div class="lp2-upg-info">
          <div class="lp2-upg-name">${T.lpUpgNames?.[upg.id] || upg.nm}</div>
          <div class="lp2-upg-stars">${'★'.repeat(lv)}${'☆'.repeat(upg.max-lv)}</div>
        </div>
        <div class="lp2-upg-cost">${maxed ? `<span style="color:var(--brass-light)">${T.lpMax}</span>` : [cW?`🪵${cW}`:'',cG?`🪙${cG}`:''].filter(Boolean).join(' ')}</div>
        <button class="lp2-upg-btn" ${can?'':'disabled'}>${maxed ? '—' : T.lpUpgrade}</button>`;
      if (can) row.querySelector('.lp2-upg-btn').addEventListener('click', () => this._applyUpgrade(idx, upg.id));
      list.appendChild(row);
    });
  }

  // ── Actions ───────────────────────────────────────────────────
  _applyPreset(preset, ships) {
    this._lastPreset = preset;
    ships.forEach(ship => {
      const lo = preset.loadout(ship.hull);
      // AW: a preset gun above the hull's tier — or not yet researched (harbor/
      // battle) — falls back along its research line to the best gun allowed
      const ok = id => this._canMount(CANNON_BY_ID.get(id), ship);
      Object.keys(lo).forEach(sl => {
        if (lo[sl] && !ok(lo[sl])) lo[sl] = fallbackCannon(lo[sl], ok) || 'swivel';
      });
      Object.assign(ship.loadout, lo);
      (HULL_SLOTS[ship.hull]||[]).forEach(sl => {
        const cn = CANNON_BY_ID.get(ship.loadout[sl]);
        if (cn) ship.slotTimers[sl] = cn.rof;
      });
      applySpeed(ship); this._overlay.build(ship);
    });
    this._picked = null; this._syncAll();
    this._flashHint(T.hintPresetApplied(presetLabel(preset), ships.length));
  }

  _applyUpgrade(idx, upgId) {
    const st = this._state, upg = UPGRADE_DEFS.find(u => u.id === upgId);
    const ship = st.playerShips[idx], lv = st.shipUpgrades[idx][upgId] || 0;
    if (lv >= upg.max) return;
    const cW = (upg.base.wood||0)*(lv+1), cG = (upg.base.gold||0)*(lv+1);
    if (st.resWood < cW || st.resGold < cG) return;
    st.resWood -= cW; st.resGold -= cG; st.shipUpgrades[idx][upgId] = lv + 1;
    if (upgId === 'spd') { ship.baseSpd *= (1 + upg.perLv); applySpeed(ship); }
    if (upgId === 'hp')  { ship.maxHp = Math.round(ship.maxHp*(1+upg.perLv)); ship.hp = Math.min(ship.hp*(1+upg.perLv), ship.maxHp); }
    if (upgId === 'rof') { ship.rofMult = (ship.rofMult ?? 1.0) * (1 - upg.perLv); }
    this._renderUpgrades();
  }
}
