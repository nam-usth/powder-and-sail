// ── HelpCard.js (UI2) — the "?" controls card ─────────────────────
// Renders #help-modal's body in the active language: five key columns
// (select · orders · in battle · camera · harbor & panels) and a short
// "How to win" summary with buttons for the full rules card and to
// replay the first-session tour.
//
//   import { renderHelp } from './Experience/UI/HelpCard.js';
//   renderHelp();               // before opening; re-run on 'iow:langchange'

import { ms } from '../../Meta/UI/strings.js';

const k = (...keys) => keys.map(x => `<kbd>${x}</kbd>`).join(' ');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const row = (keys, label) => `<div>${keys} ${esc(label)}</div>`;

/** Build the card body (HTML string) for the active language. */
export function helpHTML() {
  const col = (title, rows, note = '') =>
    `<div class="help-col"><div class="help-sec">${esc(ms(title))}</div>${rows.join('')}${note ? `<div class="hk-note">${esc(note)}</div>` : ''}</div>`;
  return `
  <div class="help-grid hc5">
    ${col('hk_select', [
      row(k(ms('hk_click')), ms('hk_selShip')),
      row(k(ms('hk_drag')), ms('hk_box')),
      row(k('Shift') + '+' + esc(ms('hk_click')), ms('hk_add')),
      row(k(ms('hk_dbl')), ms('hk_sameHull')),
      row(k('F2') + ' / ' + k('Ctrl') + '+' + k('A'), ms('hk_all')),
      row(k('1–9'), ms('hk_recall')),
      row(k('Ctrl') + '+' + k('1–9'), ms('hk_assign')),
      row(k('Shift') + '+' + k('1–9'), ms('hk_addFleet')),
    ])}
    ${col('hk_orders', [
      row(k(ms('hk_rclick')), ms('hk_move')),
      row(k('Shift') + '+' + esc(ms('hk_rclick')), ms('hk_queue')),
      row(k('A'), ms('hk_atkMove')),
      row(k('P'), ms('hk_patrol')),
      row(k('S'), ms('hk_stop')) + row(k('H'), ms('hk_holdPos')),
      row(k('F'), ms('hk_form')) + row(k('T'), ms('hk_stance')),
    ])}
    ${col('hk_battle', [
      row(k(ms('hk_rclick')), ms('hk_attack')),
      row(k('Z', 'X', 'C'), ms('hk_abil')),
      row(k('Tab'), ms('hk_ranges')),
      row(k('Alt'), `${ms('hk_tactical')} (${ms('hk_hold')})`),
      row(k('⚑'), ms('hk_retreat')),
    ], ms('hk_broadside'))}
    ${col('hk_camera', [
      row(k(ms('hk_arrows')), ms('hk_pan')),
      row(k(ms('hk_mdrag')), ms('hk_grab')),
      row(k(ms('hk_scroll')), ms('hk_zoom')),
      row(k(ms('hk_space')), ms('hk_centre')),
      row(k(ms('hk_minimap')), ms('hk_mm')),
      row(k('G'), ms('hk_cycle')),
    ])}
    ${col('hk_harbor', [
      row(k('Y'), ms('hk_shipyard')),
      row(k('W'), ms('hk_chart')),
      row(k('B'), ms('hk_build')) + row(k('R'), ms('hk_research')),
      row(k('L'), ms('hk_loadout')) + row(k('M'), ms('hk_market')),
      row(k('V') + ' ' + k('O'), ms('hk_war')),
      row(k('Shift') + '+' + k('F'), ms('hk_fog')),
      row(k('Q'), ms('hk_gfx')),
      row(k('Esc'), ms('hk_esc')),
      row(k('?'), ms('hk_help')),
    ])}
  </div>
  <div class="help-win">
    <h4>${esc(ms('hk_win'))}</h4>
    <section><b>${esc(ms('hk_win_battle_h'))}</b><p>${esc(ms('hk_win_battle'))}</p></section>
    <section><b>${esc(ms('hk_win_campaign_h'))}</b><p>${esc(ms('hk_win_campaign'))}</p></section>
    <section><b>${esc(ms('hk_win_war_h'))}</b><p>${esc(ms('hk_win_war'))}</p></section>
  </div>
  <div class="help-foot">
    <button type="button" class="pd-plaque quiet" data-help="tour">${esc(ms('hk_tour'))}</button>
    <button type="button" class="pd-plaque" data-help="rules">${esc(ms('hk_rules'))}</button>
  </div>`;
}

let _wired = false;

/** Fill #help-title / #help-body and wire the footer buttons (once). */
export function renderHelp() {
  const body = document.getElementById('help-body');
  if (!body) return;
  const title = document.getElementById('help-title');
  if (title) title.textContent = ms('hk_title');
  body.innerHTML = helpHTML();
  if (_wired) return;
  _wired = true;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-help]');
    if (!b) return;
    const modal = document.getElementById('help-modal');
    const close = () => window._game?._panels ? window._game._panels.close('help-modal') : modal?.classList.remove('open');
    if (b.dataset.help === 'rules') {
      close();
      import('../../Meta/UI/HowToWin.js').then(m => m.showHowToWin({})).catch(err => console.warn('[help]', err));
    } else if (b.dataset.help === 'tour') {
      close();
      window.pasOnboarding?.restart();
    }
  });
  window.addEventListener('iow:langchange', () => renderHelp());
}
