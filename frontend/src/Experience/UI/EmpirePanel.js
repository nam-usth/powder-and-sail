// ── EmpirePanel.js (AP) ─────────────────────────────────────────
// "Empire Overview" — the strategy-layer management screen.
//
// One glance answers: what do I own, what does each island give me,
// what needs attention, and what should I capture next.
//
//   • One row per PLAYER island: trait, production (trait+adjacency
//     applied — sourced from BuildSystem.getProducingInstances), fort
//     HP bar, building count, alert badges (🔥 burning · 🏗 building ·
//     ⚠ damaged). Row click → camera + IslandPanel on that island.
//   • Totals strip: empire production from buildings, islands count.
//   • "Unclaimed waters": neutral islands with their traits & dormant
//     building counts → capture-target hints. Click to inspect.
//
// Re-renders at 1 Hz while open (construction timers tick visibly) and
// on relevant bus events. Toggled by header button ⚜ or the O key.
import { getTrait } from '../../data/traits.js';
import { PanelManager } from './PanelManager.js';

export class EmpirePanel {
  constructor(state, islands, build, bus, game) {
    this._state   = state;
    this._islands = islands;
    this._build   = build;
    this._game    = game;
    this._open    = false;
    this._tickT   = 0;
    this._ensureEl();

    ['building:placed', 'building:ready', 'building:destroyed',
     'island:captured', 'research:done'].forEach(ev =>
      bus.on(ev, () => { if (this._open) this._render(); }));
  }

  _ensureEl() {
    if (document.getElementById('empire-panel')) return;
    const el = document.createElement('div');
    el.className = 'panel';
    el.id = 'empire-panel';
    el.innerHTML = `
      <div class="ph">
        <span class="pt">⚜ EMPIRE OVERVIEW</span>
        <span class="px" data-action="close">✕</span>
      </div>
      <div id="empire-body"></div>`;
    document.getElementById('ui')?.appendChild(el) || document.body.appendChild(el);

    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      if (t.dataset.action === 'close') { this.close(); return; }
      if (t.dataset.action === 'goto') {
        const isl = this._islands.find(i => i.def.id === t.dataset.isl);
        if (isl) { this.close(); this._game._selectIsland(isl); }
      }
    });
  }

  toggle() { this._open ? this.close() : this.open(); }
  open()   {
    this._open = true;
    this._render();
    PanelManager.open('empire-panel');    // P1 fix: pm-open restores opacity/pointer-events
  }
  close()  {
    this._open = false;
    PanelManager.close('empire-panel');
  }

  /** Called from GameApp.update — live timers without per-frame DOM churn. */
  tick(dt) {
    if (!this._open) return;
    this._tickT += dt;
    if (this._tickT >= 1) { this._tickT = 0; this._render(); }
  }

  _render() {
    const body = document.getElementById('empire-body');
    if (!body) return;
    const st = this._state;

    // Per-island production map from the single source of truth
    // (trait + adjacency multipliers already applied by BuildSystem).
    const prodByIsl = {};
    (this._build.getProducingInstances?.() || []).forEach(({ id, prod, isl }) => {
      const k = isl?.def?.id; if (!k) return;
      prodByIsl[k] = prodByIsl[k] || { wood: 0, gold: 0 };
      if (id === 'lumber_mill') prodByIsl[k].wood += prod;
      if (id === 'gold_mine')   prodByIsl[k].gold += prod;
    });

    const mine    = this._islands.filter(i => i.own === 'player');
    const neutral = this._islands.filter(i => i.own === 'neutral');
    let totW = 0, totG = 0;

    const rows = mine.map(isl => {
      const t    = getTrait(isl);
      const inst = (st.islandBuildings[isl.def.id] || [])
        .filter(i => i.state !== 'destroyed' && i.state !== 'moving');
      const nBuilding = inst.filter(i => i.state === 'building').length;
      const nDamaged  = inst.filter(i => i.state === 'active' && i.hp < i.maxHp).length;
      const burning   = !!isl._fireSource;
      const p = prodByIsl[isl.def.id] || { wood: 0, gold: 0 };
      totW += p.wood; totG += p.gold;
      const hpPct  = Math.max(0, Math.round(isl.hp / isl.maxHp * 100));
      const hpCol  = hpPct > 60 ? 'var(--accent-green)' : hpPct > 30 ? 'var(--accent-gold)' : 'var(--accent-red)';

      return `<div class="emp-row" data-action="goto" data-isl="${isl.def.id}">
        <span class="emp-trait" title="${t ? t.name + ' — ' + t.desc : 'No trait'}">${t ? t.icon : '·'}</span>
        <div class="emp-main">
          <div class="emp-nm">${isl.nm}${isl.down ? ' <span class="emp-down">FORT DOWN</span>' : ''}</div>
          <div class="emp-hpbar"><div class="emp-hpfill" style="width:${hpPct}%;background:${hpCol}"></div></div>
        </div>
        <div class="emp-prod">
          ${p.wood ? `<span>🪵+${p.wood.toFixed(1)}</span>` : ''}
          ${p.gold ? `<span>🪙+${p.gold.toFixed(1)}</span>` : ''}
          ${!p.wood && !p.gold ? '<span class="emp-dim">—</span>' : ''}
        </div>
        <div class="emp-bld">${inst.length}🏠</div>
        <div class="emp-flags">
          ${burning   ? '<span title="On fire!">🔥</span>'                       : ''}
          ${nBuilding ? `<span title="Under construction">🏗${nBuilding}</span>` : ''}
          ${nDamaged  ? `<span title="Damaged buildings">⚠${nDamaged}</span>`    : ''}
        </div>
      </div>`;
    }).join('') || '<div class="emp-empty">No islands yet — capture one!</div>';

    const unclaimed = neutral.length ? `
      <div class="emp-section-label">Unclaimed waters — capture targets</div>
      ${neutral.map(isl => {
        const t = getTrait(isl);
        const dormant = (st.islandBuildings[isl.def.id] || [])
          .filter(i => i.state === 'active').length;
        return `<div class="emp-row emp-row-neutral" data-action="goto" data-isl="${isl.def.id}">
          <span class="emp-trait">${t ? t.icon : '·'}</span>
          <div class="emp-main">
            <div class="emp-nm">${isl.nm}</div>
            <div class="emp-sub">${t ? t.name + ' · ' + t.desc : 'Plain island'}</div>
          </div>
          <div class="emp-bld">${dormant ? dormant + '🏠 inherit' : ''}</div>
        </div>`;
      }).join('')}` : '';

    body.innerHTML = `
      <div class="emp-totals">
        <div class="emp-tot"><span class="emp-tot-lbl">Islands</span><span class="emp-tot-val">${mine.length} / ${this._islands.length}</span></div>
        <div class="emp-tot"><span class="emp-tot-lbl">🪵 from buildings</span><span class="emp-tot-val">+${totW.toFixed(1)}/s</span></div>
        <div class="emp-tot"><span class="emp-tot-lbl">🪙 from buildings</span><span class="emp-tot-val">+${totG.toFixed(1)}/s</span></div>
      </div>
      <div class="emp-section-label">Your islands</div>
      ${rows}
      ${unclaimed}
      <div class="emp-hint">Click a row to jump there · Adjacent same-type producers gain +10% each (max +30%)</div>`;
  }
}
