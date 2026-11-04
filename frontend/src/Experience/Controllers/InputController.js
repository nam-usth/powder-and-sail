import { PanelManager } from '../UI/PanelManager.js';
import { bus }          from '../EventBus.js';
// F1: XSS guard
const _esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

import { T }            from '../../i18n.js';

/**
 * InputController — translates raw InputManager events into game actions.
 * Owns click, mousemove, keyboard, wheel routing.
 */
export class InputController {
  constructor(game) {
    this._g = game; // reference to GameApp facade
    this._bind();
  }

  _bind() {
    bus.on('input:click',     ({ mouse, raw, touch }) => this._onClick(mouse, raw, touch));
    bus.on('input:wheel',     ({ delta })            => this._onWheel(delta));
    bus.on('input:keydown',   ({ key, code, raw })   => this._onKey(key, raw, code));
    // AN/G3: hold-Alt tactical view (keyup/blur emitted by InputManager)
    bus.on('input:keyup', ({ key }) => {
      if (key === 'alt') this._g._overlay?.setTactical(false, this._g._islands);
    });
    bus.on('input:blur',  () => this._g._overlay?.setTactical(false, this._g._islands));
    bus.on('input:mousemove', ({ mouse, clientX, clientY }) =>
      this._onMouseMove(mouse, clientX, clientY));
  }

  // ─────────────────────────────────────────────────────────────
  _onWheel(delta) {
    const st = this._g._state;
    st.camDist = Math.max(25, Math.min(150, st.camDist + delta * .20));
  }

  _onClick(mouse, raw, touch) {
    const g   = this._g;
    const pt  = g._input.raycast(g._camera, g._scene.clickPlane);
    if (!pt) return;

    const st        = g._state;
    const selIsl    = g._getSelectedPlayerIsland();
    const clickedIsl = g._islands.find(i => {
      const dx = pt.x - i.x, dz = pt.z - i.z;
      return dx * dx + dz * dz < (i.r + 2.5) ** 2;
    });

    if (st.gameOver) {
      if (clickedIsl) g._selectIsland(clickedIsl);
      return;
    }

    // AU: pending A / P / Move targeting consumes the click
    if (g._command.consumeTargetingClick(pt, raw)) return;

    // Priority 1: build mode
    if (st.buildMode && (st.selectedBuilding || st.selectedDefense)) {
      if (!selIsl) { g._showMsg('Select a player island first', 1800); return; }
      if (clickedIsl && clickedIsl !== selIsl) { g._showMsg('Cannot build on that island', 1800); return; }
      const dx = pt.x - selIsl.x, dz = pt.z - selIsl.z;
      if (dx * dx + dz * dz < (selIsl.r + 8) ** 2) { g._build.tryBuildAt(pt.x, pt.z, selIsl); return; }
      g._showMsg(T.buildClickCell, 1800); return;
    }

    // AU: ships under the cursor take precedence over islands and sea
    if (g._command.clickShip(raw)) return;

    // Priority 2: click occupied grid cell
    if (clickedIsl && clickedIsl.own === 'player' && st.selectedIslandId === clickedIsl.def.id) {
      const inst = g._build.findInstanceAt(pt.x, pt.z, clickedIsl);
      if (inst) { g._islandPanel.showBuildingDetail(inst, clickedIsl); return; }
    }

    // Priority 3: click island (selecting an island drops the ship selection,
    // RTS-style; right-click with ships selected orders them onto it instead)
    if (clickedIsl) { g._command.clearSelection(); g._selectIsland(clickedIsl); return; }

    // Priority 4: open sea — deselect (touch: move the selection there)
    g._command.clickOcean(pt, raw, touch);
  }

  /** Leave build / move-building mode (Esc or right-click). */
  cancelBuild() {
    const g = this._g, st = g._state;
    if (st._moveMode && st._movingInst) g._build.cancelMove();
    st.selectedBuilding = null; st.selectedDefense = null; st.buildMode = false;
    st.buildRotated = false; st.buildFacingDeg = 0; st._moveMode = false;
    g._build.clearGrid();
    const hint = document.getElementById('build-hint');
    if (hint) hint.style.display = 'none';
    g._showMsg(T.buildCancelled, 1200);
  }

  _onMouseMove(mouse, cx, cy) {
    const g  = this._g;
    const pt = g._input.raycast(g._camera, g._scene.clickPlane);
    if (!pt) return;

    if (g._state.buildMode) g._build.hoverAt(pt.x, pt.z);

    const isl = g._islands.find(i => {
      const dx = pt.x - i.x, dz = pt.z - i.z;
      return dx * dx + dz * dz < (i.r + 1) ** 2;
    });
    const tip = document.getElementById('isl-tip');
    if (!isl) { tip.style.display = 'none'; return; }

    tip.style.display = 'block';
    tip.style.left    = (cx + 14) + 'px';
    tip.style.top     = (cy - 10) + 'px';

    const instances = g._state.islandBuildings[isl.def.id] || [];
    const bldCounts = {};
    instances.filter(i => i.state !== 'destroyed').forEach(inst =>
      bldCounts[inst.buildingId] = (bldCounts[inst.buildingId] || 0) + 1
    );
    const blds = Object.entries(bldCounts).map(([id, n]) => {
      const def = (window._ALL_DEFS || []).find(b => b.id === id);
      return (def ? def.icon + '\u202f' + def.name : id) + (n > 1 ? ` ×${n}` : '');
    });
    tip.innerHTML = `<b style="color:#e8b840">${_esc(isl.nm)}</b> · ${isl.own.toUpperCase()}<br>Fort HP: ${Math.max(0, Math.round(isl.hp))}/${isl.maxHp}${isl.down ? ' <span style=color:#ff5050>DESTROYED</span>' : ''}${blds.length ? '<br>' + blds.join(' · ') : ''}`;
  }

  _onKey(k, raw, code) {
    const g  = this._g;
    const st = g._state;
    const tag = raw?.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (k === 'tab') { raw.preventDefault(); g._overlay.toggle(); return; }
    if (k === 'alt') { raw.preventDefault(); g._overlay.setTactical(true, g._islands); return; }  // AN/G3

    if (st.gameOver && ![' ', 'g'].includes(k)) return;

    // AU: RTS selection / order / control-group keys come first
    if (!st.gameOver && g._command.handleKey(k, code, raw)) return;

    // AW: economy/building panels do not exist in a Sea Battle (their buttons are
    // hidden) — block their hotkeys too, or battle-only resources could buy upgrades.
    if (this._g._mode === 'battle' && ['o', 'r', 'b', 'l', 'v', 'm'].includes(k)) return;
    if (k === 'o') { this._g._empire?.toggle(); return; }   // AP: Empire Overview

    if (k === 'escape') {
      if (st.buildMode) {
        this.cancelBuild();
      } else if (PanelManager.closeTop()) {
        // AQ: ESC peels the topmost open panel first; only a bare ESC
        // (nothing to close) reaches pause — fixes "panel pile-up".
      } else {
        g._togglePause();
      }
      return;
    }

    if (k === ' ') {            // game over: CommandController is skipped
      raw.preventDefault();
      g.exitIslandFocus();
      g._command.centerOnSelection();
      return;
    }

    if (k === 'r') {
      if (st.buildMode && (st.selectedBuilding || st.selectedDefense)) {
        const bld = st.selectedBuilding || st.selectedDefense;
        const fp  = bld.footprint || { w: 1, h: 1 };
        if (fp.w === fp.h) { g._showMsg(T.squareNoRotate, 1500); return; }
        st.buildRotated = !st.buildRotated;
        const isl = g._getSelectedPlayerIsland();
        if (isl) g._build.showGrid(isl);
        const hint = document.getElementById('build-hint');
        if (hint) {
          const eff = st.buildRotated ? { w: fp.h, h: fp.w } : fp;
          hint.innerHTML = `🏗 ${bld.icon} <b>${bld.name}</b> <span style="color:var(--brass-deep)">${eff.w}×${eff.h}</span><br><small>R to rotate · click 🟩 cell</small>`;
        }
        g._showMsg(T.buildRotated(st.buildRotated ? (fp.h + '×' + fp.w) : (fp.w + '×' + fp.h)), 1200);
        return;
      }
      g._researchUI.toggle(); return;
    }

    // Q/E: rotate defense facing in 45° steps (only when a defense is selected)
    if ((k === 'q' || k === 'e') && st.buildMode && st.selectedDefense) {
      const STEP = 45;
      st.buildFacingDeg = ((st.buildFacingDeg + (k === 'e' ? STEP : -STEP)) + 360) % 360;
      g._showMsg(`↻ Facing: ${st.buildFacingDeg}°`, 800);
      return;
    }

    // AT: Commander abilities
    if (k === 'z') { g._commander?.tryUse('barrage'); return; }
    if (k === 'x') { g._commander?.tryUse('winds');   return; }
    if (k === 'c') { g._commander?.tryUse('repairs'); return; }

    if (k === 'b') { g._openBuildDock?.(); return; }
    if (k === 'l') { g._loadout.toggle(); return; }
    if (k === 'v') { g._reviveUI.toggle(); return; }
    if (k === 'pause') { g._togglePause(); return; }
    if (k === 'f' && raw?.shiftKey) { g._fog.toggle(st); return; }   // AU: plain F = formation
    if (k === 'm') { g._toggleMarket(); return; }

    if (k === 'g') {
      const playerIslands = g._islands.filter(i => i.own === 'player');
      if (!playerIslands.length) { g._showMsg(T.noIslandsOwned, 1500); return; }
      const curIdx  = playerIslands.findIndex(i => i.def.id === st.camLockedId);
      const nextIsl = playerIslands[(curIdx + 1) % playerIslands.length];
      g._selectIsland(nextIsl); return;
    }

  }
}
