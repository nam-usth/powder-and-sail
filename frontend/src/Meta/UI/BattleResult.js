// ── BATTLE RESULT (AW-S08) — outcome, stars, spoils, fleet report ───
//
//   showBattleResult(summary, ctx) → { close() }
//
// summary: Campaign.applyBattleResult() return value
//   { missionId, nm, won, retreated, stars, firstClear, reward, plunder,
//     renown, lost[], timeSec, campaignComplete?, reason? }
// ctx: { ships:[{nm, hullId, hpFrac, sunk}], onReturn(), onRetry?(),
//        sfx?(name), getProfile?() (enables the promotion banner) }

import { HULLS, DEFEAT_PLUNDER_KEEP, RANKS } from '../../data/harbor.js';
import { T, getLang } from '../../i18n.js';
import { PATROL } from '../../data/campaign.js';
import { getMission, makePatrol, rankIndex, rankOf } from '../Campaign.js';
import { ms, hullName, rankName, missionName, fmtNum, fmtClock } from './strings.js';
import { icon, resIcon, hullSvg, starIcon, tierBadge, rankBadge, laurel } from './icons.js';
import {
  esc, el, domId, call, ensureMetaCss, revealWhenStyled, pushModal, popModal, reducedMotion, tweenNumber,
} from './dom.js';

const STAR_START = 650, STAR_GAP = 420, COUNT_MS = 1100;

/**
 * Show the end-of-battle modal. Safe to call once per battle.
 * @param {object} summary see file header
 * @param {object} ctx see file header
 * @returns {{close:Function}}
 */
export function showBattleResult(summary, ctx = {}) {
  ensureMetaCss();
  const s = summary || {};
  const won = !!s.won;
  const outcome = won ? 'victory' : s.retreated || s.reason === 'retreat' ? 'retreat' : 'defeat';
  const mission = s.missionId === PATROL.id ? null : getMission(s.missionId);
  const name = mission ? missionName(mission) : s.missionId === PATROL.id ? missionName(PATROL) : (s.nm || '');
  const profile = typeof ctx.getProfile === 'function' ? safe(() => ctx.getProfile()) : null;

  // par time (patrol par depends on the rank the battle was fought at)
  let par = mission?.parTime || 0;
  if (!mission && s.missionId === PATROL.id && profile) {
    par = safe(() => makePatrol({ ...profile, renown: Math.max(0, profile.renown - (s.renown || 0)) }, 1).parTime) || 0;
  }

  // reward breakdown
  const reward = s.reward || { wood: 0, gold: 0 };
  const plunder = s.plunder || { wood: 0, gold: 0 };
  const fc = s.firstClear && mission ? mission.firstClear || { wood: 0, gold: 0 } : { wood: 0, gold: 0 };
  const lines = [];
  if (won) {
    lines.push([ms('br_missionReward'), { wood: Math.max(0, reward.wood - plunder.wood - fc.wood), gold: Math.max(0, reward.gold - plunder.gold - fc.gold) }, 'mission']);
    if (plunder.wood || plunder.gold) lines.push([ms('br_plunder'), plunder, 'plunder']);
    if (s.firstClear && (fc.wood || fc.gold)) lines.push([ms('br_firstBonus'), fc, 'first']);
  } else {
    lines.push([ms('br_plunderKept', Math.round(DEFEAT_PLUNDER_KEEP * 100)), reward, 'plunder']);
  }

  // promotion?
  let promoted = null;
  if (profile && s.renown > 0) {
    const before = rankIndex(profile.renown - s.renown), after = rankIndex(profile.renown);
    if (after > before) promoted = rankOf(profile.renown);
  }

  const ships = Array.isArray(ctx.ships) ? ctx.ships : [];
  const lostN = ships.filter((x) => x.sunk).length || (s.lost || []).length;
  const tid = domId('br-title');
  const stars = Math.max(0, Math.min(3, s.stars | 0));
  const crit = [ms('wc_star1'), ms('wc_star2'), par ? ms('wc_star3', fmtClock(par)) : ms('wc_par')];
  const amount = (c) => `<span class="mx-res">${resIcon('wood')}<b>${fmtNum(c.wood)}</b></span><span class="mx-res">${resIcon('gold')}<b>${fmtNum(c.gold)}</b></span>`;
  const campaign = !!s.campaignComplete;

  const root = el(`
<div class="mx-overlay br-overlay is-${outcome}${campaign ? ' is-campaign' : ''}">
  <section class="mx-panel br-card" role="dialog" aria-modal="true" aria-labelledby="${tid}" tabindex="-1">
    <span class="mx-corner tl"></span><span class="mx-corner tr"></span><span class="mx-corner bl"></span><span class="mx-corner br"></span>
    <div class="br-rays" aria-hidden="true"></div>
    ${campaign ? `<div class="br-campaign" role="note">
      <div class="br-crest" aria-hidden="true"><svg viewBox="0 0 120 120">${laurel(60, 62, 46, 'br-laurel')}</svg><span class="br-crest-rb">${rankBadge(4)}</span><span class="br-crown">${icon('crown')}</span></div>
      <div class="br-camp-t mx-caps">${esc(ms('br_campaign'))}</div>
      <div class="br-camp-s">${esc(campaignLine(name))}</div>
      <div class="br-confetti" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
    </div>` : ''}
    <header class="br-head">
      <div class="br-kicker mx-caps">${esc(name)}</div>
      <h2 class="br-title" id="${tid}">${esc(ms('br_' + outcome))}</h2>
      ${!won && s.reason && ms('br_why_' + s.reason) !== 'br_why_' + s.reason ? `<p class="br-why">${esc(ms('br_why_' + s.reason))}</p>` : ''}
      <div class="br-flags">
        ${s.firstClear ? `<span class="mx-tag tag-first">${icon('sparkle')}${esc(ms('br_firstClear'))}</span>` : ''}
        ${promoted ? `<span class="mx-tag tag-promo">${icon('crown')}${esc(ms('br_promoted', rankName(promoted)))}</span>` : ''}
        <span class="mx-tag tag-time">${icon('clock')}${esc(ms('br_time'))} ${fmtClock(s.timeSec || 0)}${par ? ` <small>(${esc(ms('br_par', fmtClock(par)))})</small>` : ''}</span>
      </div>
    </header>
    <ol class="br-stars" aria-label="${stars}/3">
      ${[0, 1, 2].map((i) => `<li class="br-star ${i < stars ? 'is-earned' : ''}" data-i="${i}"><span class="br-star-ic">${starIcon()}</span><span class="br-star-t">${esc(crit[i])}</span></li>`).join('')}
    </ol>
    <div class="br-body">
      <section class="br-spoils">
        <h3 class="mx-sec"><span class="mx-caps">${esc(ms('br_spoils'))}</span></h3>
        <dl class="br-ledger">
          ${lines.map(([lbl, c, k]) => `<div class="br-line is-${k}"><dt>${esc(lbl)}</dt><dd>${amount(c)}</dd></div>`).join('')}
          <div class="br-line is-total"><dt>${esc(ms('br_total'))}</dt><dd>
            <span class="mx-res lg">${resIcon('wood')}<b data-n="wood">${reducedMotion() ? fmtNum(reward.wood) : '0'}</b></span>
            <span class="mx-res lg">${resIcon('gold')}<b data-n="gold">${reducedMotion() ? fmtNum(reward.gold) : '0'}</b></span>
          </dd></div>
        </dl>
        <div class="br-renown">${resIcon('renown')}<span>${esc(ms('renown'))}</span><b data-n="renown">+${reducedMotion() ? fmtNum(s.renown || 0) : '0'}</b></div>
      </section>
      <section class="br-fleet">
        <h3 class="mx-sec"><span class="mx-caps">${esc(ms('br_fleet'))}</span>${lostN ? `<small class="is-bad">${esc(ms('br_lost', lostN))}</small>` : ''}</h3>
        <ul class="br-ships">
          ${ships.map((x) => shipRow(x)).join('')}
        </ul>
      </section>
    </div>
    <footer class="br-foot">
      ${typeof ctx.onRetry === 'function' ? `<button type="button" class="mx-btn br-retry" data-act="retry">${icon('swords')}<span>${esc(ms('br_retry'))}</span></button>` : ''}
      <button type="button" class="mx-btn primary big br-return" data-act="return">${icon('anchor')}<span>${esc(ms('br_return'))}</span></button>
    </footer>
  </section>
</div>`);

  document.body.appendChild(root);
  revealWhenStyled(root);
  const card = root.querySelector('.br-card');
  const timers = [];
  const cancels = [];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearTimeout);
    cancels.forEach((c) => c());
    popModal(modal);
    root.remove();
  };
  const modal = pushModal({ el: card, onEsc: () => root.querySelector('.br-return')?.focus() });
  root.querySelector('.br-return')?.focus({ preventScroll: true });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    call(ctx, 'sfx', 'ui_click');
    root.querySelectorAll('.br-foot button').forEach((x) => { x.disabled = true; });
    if (b.dataset.act === 'return') call(ctx, 'onReturn');
    else if (b.dataset.act === 'retry') call(ctx, 'onRetry');
  });

  // ── reveal choreography ──
  const reduce = reducedMotion();
  const starEls = [...root.querySelectorAll('.br-star')];
  if (reduce) {
    starEls.forEach((n, i) => n.classList.toggle('is-lit', i < stars));
    root.classList.add('is-done');
  } else {
    for (let i = 0; i < stars; i++) {
      timers.push(setTimeout(() => {
        starEls[i].classList.add('is-lit');
        call(ctx, 'sfx', i === 2 ? 'bell' : 'coin');
      }, STAR_START + i * STAR_GAP));
    }
    const countAt = STAR_START + Math.max(1, stars) * STAR_GAP;
    timers.push(setTimeout(() => {
      const n = (k) => root.querySelector(`[data-n="${k}"]`);
      cancels.push(tweenNumber(n('wood'), 0, reward.wood, COUNT_MS, fmtNum));
      cancels.push(tweenNumber(n('gold'), 0, reward.gold, COUNT_MS, fmtNum));
      cancels.push(tweenNumber(n('renown'), 0, s.renown || 0, COUNT_MS, (v) => '+' + fmtNum(v), () => root.classList.add('is-done')));
      if (reward.wood || reward.gold) call(ctx, 'sfx', 'coin');
    }, countAt));
    if (campaign || promoted) timers.push(setTimeout(() => call(ctx, 'sfx', 'bell'), 300));
  }
  return { close, el: root };
}

function shipRow(x) {
  const h = HULLS[x.hullId] || HULLS.sloop;
  const frac = x.sunk ? 0 : Math.max(0, Math.min(1, x.hpFrac ?? 1));
  const pct = Math.round(frac * 100);
  const lvl = x.sunk ? 'dead' : pct < 40 ? 'low' : pct < 70 ? 'mid' : 'ok';
  const status = x.sunk
    ? `<span class="br-st is-sunk">${icon('skull')}${esc(ms('br_sunk'))}</span>`
    : `<span class="br-st">${esc(ms('br_afloat', pct))}${pct < 100 ? ` · <em>${esc(ms('br_needsRepair'))}</em>` : ''}</span>`;
  return `<li class="br-ship ${x.sunk ? 'is-sunk' : ''}">
    <span class="br-ship-ic sv-well wl-${x.sunk ? 'wreck' : 'ready'}">${hullSvg(h.id)}</span>
    <span class="br-ship-main"><span class="br-ship-nm"><b>${esc(x.nm || hullName(h))}</b>${tierBadge(h.tier)}</span><small>${esc(hullName(h))}</small></span>
    <span class="br-ship-hp"><span class="mx-bar hp" data-lvl="${lvl}"><i style="width:${pct}%"></i></span>${status}</span>
  </li>`;
}

function safe(fn) { try { return fn(); } catch { return null; } }

/** "X is won — you are Admiral …": the game's own i18n line when it has one. */
function campaignLine(missionNm) {
  const t = safe(() => T.campaignWon);
  const l = safe(() => getLang()) || 'en';
  if (typeof t === 'string' && t && (l === 'en' || l === 'vi')) return t;
  return ms('br_campaignSub', missionNm, rankName(RANKS[RANKS.length - 1] || { id: 'admiral', nm: 'Admiral' }));
}
