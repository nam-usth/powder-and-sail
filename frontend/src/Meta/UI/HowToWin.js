// ── HOW TO WIN — rules card (battle · campaign · fleet · Open War) ───
//
//   showHowToWin({ sfx? }) → { close() }
//
// A small modal reachable from the World Chart's "?" button (and usable
// from anywhere). Esc / backdrop / button close it; focus returns to the
// element that opened it.

import * as CAMPAIGN from '../../data/campaign.js';
import { RANKS } from '../../data/harbor.js';
import { ms, missionName, rankName } from './strings.js';
import { icon, starIcon } from './icons.js';
import { esc, el, domId, call, ensureMetaCss, revealWhenStyled, pushModal, popModal, reducedMotion } from './dom.js';

let _open = null;

/** Display name of the campaign's final mission (data-driven). */
function finalName() {
  const id = CAMPAIGN.FINAL_MISSION;
  const m = (CAMPAIGN.MISSIONS || []).find((x) => x.id === id);
  return m ? missionName(m) : '—';
}

/**
 * Open the rules card (re-focuses it when already open).
 * @param {{sfx?:Function}} [ctx]
 * @returns {{close:Function}}
 */
export function showHowToWin(ctx = {}) {
  ensureMetaCss();
  if (_open) { _open.focus(); return _open; }
  const tid = domId('hw-title');
  const stars = (n) => `<span class="mx-stars xs">${[0, 1, 2].map((i) => starIcon(i < n ? 'on' : 'off')).join('')}</span>`;
  const root = el(`
<div class="mx-overlay hw-overlay">
  <section class="mx-panel hw-card" role="dialog" aria-modal="true" aria-labelledby="${tid}" tabindex="-1">
    <span class="mx-corner tl"></span><span class="mx-corner tr"></span><span class="mx-corner bl"></span><span class="mx-corner br"></span>
    <header class="hw-head">
      <span class="hw-ic" aria-hidden="true">${icon('scroll')}</span>
      <h2 class="mx-caps" id="${tid}">${esc(ms('help_title'))}</h2>
      <button type="button" class="mx-x" data-act="close" aria-label="${esc(ms('close'))}" title="${esc(ms('close'))} (Esc)">${icon('close')}</button>
    </header>
    <div class="hw-body">
      <section class="hw-sec">
        <h3>${icon('swords')}<span>${esc(ms('help_battle_h'))}</span></h3>
        <p>${esc(ms('help_battle_1'))}</p>
        <p class="hw-bad">${esc(ms('help_battle_2'))}</p>
        <ul class="hw-stars">
          <li>${stars(1)}<span>${esc(ms('wc_star1'))}</span></li>
          <li>${stars(2)}<span>${esc(ms('wc_star2'))}</span></li>
          <li>${stars(3)}<span>${esc(ms('wc_star3', ms('wc_par').toLowerCase()))}</span></li>
        </ul>
      </section>
      <section class="hw-sec is-gold">
        <h3>${icon('crown')}<span>${esc(ms('help_campaign_h'))}</span></h3>
        <p><b>${esc(ms('help_campaign_1', finalName(), rankName(RANKS[RANKS.length - 1] || { id: 'admiral', nm: 'Admiral' })))}</b></p>
        <p>${esc(ms('help_campaign_2'))}</p>
      </section>
      <section class="hw-sec">
        <h3>${icon('wrench')}<span>${esc(ms('help_fleet_h'))}</span></h3>
        <p>${esc(ms('help_fleet_1'))}</p>
      </section>
      <section class="hw-sec">
        <h3>${icon('cannon')}<span>${esc(ms('help_war_h'))}</span></h3>
        <p>${esc(ms('help_war_1'))}</p>
      </section>
    </div>
    <footer class="hw-foot"><button type="button" class="mx-btn primary" data-act="close">${esc(ms('help_ok'))}</button></footer>
  </section>
</div>`);
  document.body.appendChild(root);
  revealWhenStyled(root);
  const card = root.querySelector('.hw-card');
  let modal = null;
  const close = () => {
    if (!modal) return;
    popModal(modal); modal = null; _open = null;
    if (reducedMotion()) { root.remove(); return; }
    root.classList.add('is-closing');
    setTimeout(() => root.remove(), 180);
  };
  root.addEventListener('mousedown', (e) => { root._down = e.target === root; });
  root.addEventListener('click', (e) => {
    if (e.target === root) { if (root._down) close(); return; }
    if (e.target.closest('[data-act="close"]')) { call(ctx, 'sfx', 'ui_click'); close(); }
  });
  modal = pushModal({ el: card, onEsc: close, name: 'help' });
  card.focus({ preventScroll: true });
  call(ctx, 'sfx', 'ui_click');
  _open = { close, focus: () => card.focus(), el: root };
  return _open;
}
