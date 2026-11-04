// ── META UI — public entry (imported by HarborSession / BattleSession) ─
//
//   import { mountHarborUI, showOfflineReport, showBattleResult } from './Meta/UI/index.js';
//   const ui = mountHarborUI(ctx);   // → { bar, shipyard, chart, destroy() }
//   ui.bar.update();  ui.shipyard.refresh();  ui.chart.openBriefing('reef_1');
//
// mountHarborUI links meta.css (+ period fonts) if the page has not, builds
// the HarborBar, ShipyardPanel and WorldChart on one ctx, wires the bar
// buttons and the keyboard shortcuts:
//   Y = Shipyard · W = World Chart (toggle; switch if the other is open)
// (B R L V O M F T S H A P Z X C G Q E 1–9 Tab Space ? belong to the game.)

import { ShipyardPanel } from './ShipyardPanel.js';
import { WorldChart } from './WorldChart.js';
import { HarborBar, showOfflineReport } from './HarborBar.js';
import { showBattleResult } from './BattleResult.js';
import { showHowToWin } from './HowToWin.js';
import { ensureMetaCss, topModal } from './dom.js';

export { ShipyardPanel, WorldChart, HarborBar, showOfflineReport, showBattleResult, showHowToWin, ensureMetaCss };
export { MS, ms } from './strings.js';

/** Keyboard shortcuts claimed by the harbor meta UI. */
export const HOTKEYS = Object.freeze({ shipyard: 'y', chart: 'w' });

/**
 * Mount the harbor's meta UI.
 * @param {object} ctx meta ctx (getProfile, save, now, toast, sfx?, onSetSail,
 *   onOpenWar, onReturn, onProfileChanged?)
 * @param {{hotkeys?:boolean}} [opts] hotkeys:false skips the Y / W bindings
 * @returns {{bar:HarborBar, shipyard:ShipyardPanel, chart:WorldChart, destroy:Function}}
 */
export function mountHarborUI(ctx, opts = {}) {
  ensureMetaCss();
  const shipyard = new ShipyardPanel(ctx);
  const chart = new WorldChart(ctx);

  const openShipyard = () => {
    if (chart.isOpen()) chart.close();
    shipyard.toggle();
  };
  const openChart = () => {
    if (shipyard.isOpen()) shipyard.close();
    chart.toggle();
  };

  // the bar gets the same ctx plus the two openers (prototype keeps getters/this)
  const barCtx = Object.create(ctx);
  barCtx.openShipyard = openShipyard;
  barCtx.openChart = openChart;
  const bar = new HarborBar(barCtx);

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const top = topModal();
    if (top && top.name !== 'shipyard' && top.name !== 'chart') return;   // e.g. the rules card is up
    const k = (e.key || '').toLowerCase();
    if (k !== HOTKEYS.shipyard && k !== HOTKEYS.chart) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === HOTKEYS.shipyard) openShipyard(); else openChart();
  };
  if (opts.hotkeys !== false) window.addEventListener('keydown', onKey, true);

  return {
    bar, shipyard, chart,
    openShipyard, openChart,
    destroy() {
      window.removeEventListener('keydown', onKey, true);
      shipyard.close();
      chart.close();
      bar.destroy();
    },
  };
}
