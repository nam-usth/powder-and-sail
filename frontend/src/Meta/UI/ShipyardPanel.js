// ── SHIPYARD PANEL (AW-S05) — roster + build catalogue ──────────────
// Self-contained DOM module. Reads the live profile through ctx and mutates
// it ONLY through Meta/Shipyard.js, then calls ctx.save() and
// ctx.onProfileChanged() so the 3D harbor can resync.
//
//   const yard = new ShipyardPanel(ctx);  yard.open() / close() / toggle()
//   yard.isOpen()  yard.refresh()   (call refresh after outside changes)
//
// ctx: { getProfile, save, now, toast, sfx?, onProfileChanged? }

import { HULLS, SHIP_TIERS, SALVAGE_SEC } from '../../data/harbor.js';
import { HULL_SLOTS } from '../../data/ships.js';
import { CANNON_BY_ID, getCannonLineCol } from '../../data/cannons.js';
import {
  shipyardLevel, shipyardSlots, fleetCap, fleetCapBreakdown, rosterCap, tickRoster, hullOf, canBuild, startBuild,
  repairQuote, startRepair, salvageQuote, startSalvage, rushQuote, rush, scrapShip, mountedGuns,
} from '../Shipyard.js';
import { ms, hullName, className, fmtNum, fmtClock, roman, capBreakdownText } from './strings.js';
import { icon, resIcon, hullSvg, tierBadge, tierOf } from './icons.js';
import {
  esc, el, domId, call, nowOf, emitMetaChanged, ensureMetaCss, revealWhenStyled,
  pushModal, popModal, focusFirst, patchKeyed, setText, reducedMotion,
} from './dom.js';

const BUILDABLE = Object.values(HULLS).filter((h) => !h.enemyOnly);   // QA-003: enemy flavour hulls are never offered
const MAX_HP  = Math.max(...BUILDABLE.map((h) => h.hp));
const MAX_SPD = Math.max(...BUILDABLE.map((h) => h.spd));
const KNOTS = 60;                       // display only: world units per 1/60 s → "knots"
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

/** UI status: ready | building | repairing | salvaging | wreck */
function uiStatus(s) {
  if (s.status === 'repairing' && (s.hpFrac ?? 1) <= 0.001) return 'salvaging';
  return s.status;
}

/** Cost chips "🪵 12 · 🪙 30" as plain text (toasts, titles). */
function costText(c) {
  const parts = [];
  if (c.wood) parts.push(`🪵${fmtNum(c.wood)}`);
  if (c.gold) parts.push(`🪙${fmtNum(c.gold)}`);
  return parts.join(' ');
}

/** What is missing to afford `c` (text), or '' when affordable. */
function shortText(res, c) {
  return costText({ wood: Math.max(0, (c.wood || 0) - res.wood), gold: Math.max(0, (c.gold || 0) - res.gold) });
}

export class ShipyardPanel {
  /** @param {object} ctx see file header */
  constructor(ctx) {
    this.ctx = ctx;
    this._root = null;
    this._open = false;
    this._timer = 0;
    this._modal = null;
    this._confirm = null;           // uid awaiting scrap confirmation
    this._tab = 'roster';
    this._onLang = () => { if (this._open) { this._labels(); this._render(true); } };
    this._onExt = (e) => { if (this._open && e.detail?.source !== 'shipyard') this._render(); };
    ensureMetaCss();
  }

  /** @returns {boolean} */
  isOpen() { return this._open; }

  toggle() { if (this._open) this.close(); else this.open(); }

  open() {
    if (this._open) return;
    this._ensureRoot();
    this._open = true;
    this._confirm = null;
    clearTimeout(this._hideT);
    this._root.hidden = false;
    this._root.classList.remove('is-closing');
    revealWhenStyled(this._root);
    this._labels();
    this._tick(true);
    this._modal = pushModal({ el: this._dialog, onEsc: () => this._onEsc(), name: 'shipyard' });
    focusFirst(this._dialog, '.sy-panel-focus');
    this._timer = setInterval(() => this._tick(), 500);
    window.addEventListener('iow:langchange', this._onLang);
    window.addEventListener('iow:meta-changed', this._onExt);
    call(this.ctx, 'sfx', 'ui_click');
  }

  close() {
    if (!this._open) return;
    this._open = false;
    clearInterval(this._timer); this._timer = 0;
    window.removeEventListener('iow:langchange', this._onLang);
    window.removeEventListener('iow:meta-changed', this._onExt);
    if (this._modal) { popModal(this._modal); this._modal = null; }
    const root = this._root;
    if (reducedMotion()) { root.hidden = true; return; }
    root.classList.add('is-closing');
    this._hideT = setTimeout(() => { root.hidden = true; root.classList.remove('is-closing'); }, 180);
  }

  /** Re-read the profile and update everything that changed. */
  refresh() { if (this._open) this._render(); }

  // ── construction ────────────────────────────────────────────────
  _ensureRoot() {
    if (this._root) return;
    const tid = domId('sy-title');
    this._root = el(`
<div class="mx-overlay sy-overlay" hidden>
  <section class="mx-panel sy-panel" role="dialog" aria-modal="true" aria-labelledby="${tid}" tabindex="-1">
    <span class="mx-corner tl"></span><span class="mx-corner tr"></span><span class="mx-corner bl"></span><span class="mx-corner br"></span>
    <header class="sy-head">
      <div class="sy-crest" aria-hidden="true">${icon('anchor')}</div>
      <div class="sy-titles">
        <h2 class="sy-title mx-caps sy-panel-focus" id="${tid}" tabindex="-1" data-f="title"></h2>
        <div class="sy-sub" data-f="sub"></div>
        <div class="sy-capnote" data-f="capNote"></div>
      </div>
      <dl class="sy-stats">
        <div class="sy-stat" data-f="slipTip"><dt class="mx-caps" data-f="slipL"></dt><dd><b data-f="slip"></b><span class="sy-pips" data-f="pips"></span></dd></div>
        <div class="sy-stat" data-f="berthTip"><dt class="mx-caps" data-f="berthL"></dt><dd><b data-f="berth"></b></dd></div>
        <div class="sy-stat" data-f="capTip"><dt class="mx-caps" data-f="capL"></dt><dd><b data-f="cap"></b></dd></div>
      </dl>
      <div class="sy-res">
        <span class="mx-res" data-f="woodTip">${resIcon('wood')}<b data-f="wood"></b></span>
        <span class="mx-res" data-f="goldTip">${resIcon('gold')}<b data-f="gold"></b></span>
      </div>
      <button type="button" class="mx-x" data-act="close" data-f="x">${icon('close')}</button>
    </header>
    <div class="sy-tabs" role="tablist">
      <button type="button" role="tab" class="sy-tab" data-act="tab" data-tab="roster" data-f="tabR"></button>
      <button type="button" role="tab" class="sy-tab" data-act="tab" data-tab="build" data-f="tabB"></button>
    </div>
    <div class="sy-body" data-f="body">
      <section class="sy-col sy-roster" data-f="colR">
        <h3 class="mx-sec"><span class="mx-caps" data-f="rosterH"></span><small data-f="rosterN"></small></h3>
        <div class="sy-list" data-f="list"></div>
      </section>
      <section class="sy-col sy-cat" data-f="colB">
        <h3 class="mx-sec"><span class="mx-caps" data-f="catH"></span><small data-f="catN"></small></h3>
        <div class="sy-notice" data-f="notice" hidden></div>
        <div class="sy-hulls" data-f="hulls"></div>
      </section>
    </div>
  </section>
</div>`);
    this._dialog = this._root.querySelector('.sy-panel');
    this._f = {};
    this._root.querySelectorAll('[data-f]').forEach((n) => { this._f[n.dataset.f] = n; });
    this._root.addEventListener('click', (e) => this._onClick(e));
    this._root.addEventListener('mousedown', (e) => { this._downOnVeil = e.target === this._root; });
    document.body.appendChild(this._root);
  }

  /** Static labels (re-run when the language changes). */
  _labels() {
    const f = this._f;
    setText(f.title, ms('sy_title'));
    setText(f.slipL, ms('sy_slipways')); f.slipTip.title = ms('sy_slipwaysTip');
    setText(f.berthL, ms('sy_berths')); f.berthTip.title = ms('sy_berthsTip');
    setText(f.capL, ms('sy_fleetcap')); f.capTip.title = ms('sy_fleetcapTip');
    f.woodTip.title = ms('wood'); f.goldTip.title = ms('gold');
    f.x.setAttribute('aria-label', ms('close')); f.x.title = ms('close') + ' (Esc)';
    setText(f.tabR, ms('sy_tab_roster')); setText(f.tabB, ms('sy_tab_build'));
    setText(f.rosterH, ms('sy_roster')); setText(f.catH, ms('sy_catalogue'));
    this._setTab(this._tab, false);
  }

  _setTab(tab, sfx = true) {
    this._tab = tab === 'build' ? 'build' : 'roster';
    this._f.body.dataset.tab = this._tab;
    for (const b of [this._f.tabR, this._f.tabB]) {
      const on = b.dataset.tab === this._tab;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-on', on);
    }
    if (sfx) call(this.ctx, 'sfx', 'ui_click');
  }

  // ── live loop ────────────────────────────────────────────────────
  _tick(force = false) {
    if (!this._open) return;
    const p = this.ctx.getProfile();
    const now = nowOf(this.ctx);
    const done = tickRoster(p, now);
    if (done.length) {
      this._committed();
      done.forEach((s) => call(this.ctx, 'toast', ms('t_ready', s.nm), 'good'));
      call(this.ctx, 'sfx', 'bell');
    }
    this._render(force, done.length ? null : p, now);
  }

  /** Persist + notify after any profile mutation. */
  _committed() {
    call(this.ctx, 'save');
    call(this.ctx, 'onProfileChanged');
    emitMetaChanged({ source: 'shipyard' });
  }

  _render(force = false, profile = null, now = nowOf(this.ctx)) {
    if (!this._root) return;
    const p = profile || this.ctx.getProfile();
    const f = this._f;
    const lv = shipyardLevel(p), slots = shipyardSlots(p);
    const busy = p.fleet.filter((s) => s.status === 'building').length;
    const maxTier = SHIP_TIERS.filter((t) => t.shipyardLevel <= lv).reduce((m, t) => Math.max(m, t.tier), 0);
    setText(f.sub, lv ? `${ms('sy_lv', lv)} · ${ms('sy_unlocks', roman(maxTier || 1))}` : ms('sy_none'));
    setText(f.slip, `${busy} / ${slots}`);
    const pips = Array.from({ length: Math.min(slots, 6) }, (_, i) => `<i class="${i < busy ? 'on' : ''}"></i>`).join('');
    if (f.pips._h !== pips) { f.pips.innerHTML = pips; f.pips._h = pips; }
    setText(f.berth, `${p.fleet.length} / ${rosterCap(p)}`);
    f.berthTip.classList.toggle('is-full', p.fleet.length >= rosterCap(p));
    setText(f.cap, String(fleetCap(p)));
    const capB = capBreakdownText(fleetCapBreakdown(p));
    setText(f.capNote, `${ms('sy_fleetcap')}: ${capB.line}`);
    f.capTip.title = [ms('sy_fleetcapTip'), capB.parts, ...capB.next].filter(Boolean).join('\n');
    setText(f.wood, fmtNum(p.res.wood));
    setText(f.gold, fmtNum(p.res.gold));

    const inYard = p.fleet.filter((s) => s.status !== 'ready').length;
    setText(f.rosterN, `${p.fleet.length}` + (inYard ? ` · ${ms('hb_inYard', inYard)}` : ''));
    setText(f.catN, lv ? ms('sy_lv', lv) : ms('sy_none'));

    // no-shipyard notice
    f.notice.hidden = lv > 0;
    if (!lv && !f.notice._set) {
      f.notice.innerHTML = `${icon('warn')}<div><b>${esc(ms('sy_noYardTitle'))}</b><span>${esc(ms('sy_noYardBody'))}</span></div>`;
      f.notice._set = true;
    }

    if (force) { f.list.textContent = ''; f.hulls.textContent = ''; }
    const lang = ms('sy_title');
    const isLast = p.fleet.length <= 1;
    patchKeyed(f.list, p.fleet, {
      key: (s) => s.uid,
      sig: (s) => [lang, uiStatus(s), s.nm, s.hullId, JSON.stringify(s.loadout || {}), s.battles || 0, s.sinks || 0,
        this._confirm === s.uid, s.status === 'ready' && (s.hpFrac ?? 1) < 0.999, isLast].join('|'),
      html: (s) => this._shipHtml(s, p, isLast),
      after: (node, s) => this._liveShip(node, s, p, now),
    });

    const items = [];
    for (const t of SHIP_TIERS) {
      const hulls = BUILDABLE.filter((h) => h.tier === t.tier);
      if (!hulls.length) continue;
      items.push({ kind: 'tier', t, locked: lv < t.shipyardLevel });
      hulls.forEach((h) => items.push({ kind: 'hull', h, t, locked: lv < t.shipyardLevel }));
    }
    patchKeyed(f.hulls, items, {
      key: (it) => (it.kind === 'tier' ? 'tier-' + it.t.tier : 'hull-' + it.h.id),
      sig: (it) => (it.kind === 'tier' ? `${lang}|${it.locked}` : this._hullSig(it.h, p, lang)),
      html: (it) => (it.kind === 'tier' ? this._tierHtml(it.t, it.locked) : this._hullHtml(it.h, p, it.locked)),
    });
  }

  // ── roster cards ─────────────────────────────────────────────────
  _shipHtml(s, p, isLast) {
    const h = hullOf(s);
    const st = uiStatus(s);
    const uid = esc(s.uid);
    const tcol = tierOf(h.tier)?.col || '#b0b0b0';
    const dmg = s.status === 'ready' && (s.hpFrac ?? 1) < 0.999;
    const badge = { ready: dmg ? 'wrench' : 'check', building: 'hammer', repairing: 'wrench', salvaging: 'anchor', wreck: 'skull' }[st];
    const meterLbl = st === 'building' ? ms('sy_onSlip') : st === 'repairing' || st === 'salvaging' ? ms('sy_inDock') : st === 'wreck' ? ms('sy_sunkNote') : '';

    let acts = '';
    if (this._confirm === s.uid) {
      acts = `<div class="sy-confirm" role="group" aria-label="${esc(ms('sy_scrapQ', s.nm))}">
        <p><b>${esc(ms('sy_scrapQ', s.nm))}</b> ${esc(ms('sy_scrapRefund', costText(this._scrapRefund(p, s.uid))))}</p>
        <div class="sy-confirm-btns">
          <button type="button" class="mx-btn sm danger" data-act="scrap-yes" data-uid="${uid}" data-fk="scrapyes:${uid}">${icon('axe')}<span>${esc(ms('sy_scrap'))}</span></button>
          <button type="button" class="mx-btn sm" data-act="scrap-no" data-uid="${uid}" data-fk="scrapno:${uid}">${esc(ms('cancel'))}</button>
        </div></div>`;
    } else {
      if (st === 'building' || st === 'repairing' || st === 'salvaging') {
        acts += `<button type="button" class="mx-btn sm rush" data-act="rush" data-uid="${uid}" data-fk="rush:${uid}" title="${esc(ms('sy_rushTip'))}">${icon('bolt')}<span>${esc(ms('sy_rush'))}</span><span class="mx-cost">${resIcon('gold')}<b data-q="rush"></b></span></button>`;
      } else if (st === 'wreck') {
        const q = salvageQuote(s);
        const tip = ms('sy_salvageTip', costText(q.hull) || '0', costText(q.guns) || '0', mountedGuns(s).length);
        acts += `<button type="button" class="mx-btn sm good" data-act="salvage" data-uid="${uid}" data-fk="salvage:${uid}" title="${esc(tip)}">${icon('anchor')}<span>${esc(ms('sy_salvage'))}</span>`
          + `<span class="mx-cost">${resIcon('wood')}<b>${fmtNum(q.wood)}</b></span><span class="mx-cost">${resIcon('gold')}<b>${fmtNum(q.gold)}</b></span><span class="mx-time">${icon('clock')}${fmtClock(q.sec)}</span></button>`;
      } else if (dmg) {
        acts += `<button type="button" class="mx-btn sm good" data-act="repair" data-uid="${uid}" data-fk="repair:${uid}">${icon('wrench')}<span>${esc(ms('sy_repair'))}</span>`
          + `<span class="mx-cost">${resIcon('gold')}<b data-q="repair-g"></b></span><span class="mx-time">${icon('clock')}<b data-q="repair-t"></b></span></button>`;
      } else {
        acts += `<span class="sy-ok">${icon('check')}${esc(ms('sy_seaworthy'))}</span>`;
      }
      if (st !== 'building') {
        const why = isLast ? ms('sy_lastShip') : '';
        acts += `<button type="button" class="mx-btn sm ghost danger sy-scrap" data-act="scrap" data-uid="${uid}" data-fk="scrap:${uid}" ${isLast ? 'disabled' : ''} title="${esc(why || ms('sy_scrap'))}" aria-label="${esc(ms('sy_scrap') + ' ' + s.nm)}">${icon('axe')}<span>${esc(ms('sy_scrap'))}</span></button>`;
      }
      if (st === 'wreck') {
        const q = salvageQuote(s);
        acts += `<p class="sy-qbd">${esc(ms('sy_quoteBd', costText(q.hull) || '0', costText(q.guns) || '0'))}</p>`;
      } else if (dmg) acts += '<p class="sy-qbd" data-q="qbd"></p>';
      acts += '<p class="sy-need" data-q="need" hidden></p>';
    }

    const guns = (HULL_SLOTS[h.hull] || []).map((slot) => {
      const c = CANNON_BY_ID.get(s.loadout?.[slot]);
      const nm = c ? c.nm : ms('slotEmpty');
      return `<span class="sy-gun ${c ? '' : 'is-empty'}" title="${esc(ms('slot_' + slot))}: ${esc(nm)}"><i style="--gc:${c ? hex(getCannonLineCol(c.id)) : 'transparent'}"></i><b>${slot}</b>${esc(nm)}</span>`;
    }).join('');

    const meter = st === 'building'
      ? `<div class="sy-meter"><div class="mx-bar prog"><i data-q="prog"></i></div><span class="sy-meter-v">${icon('clock')}<b data-q="cd"></b></span></div>`
      : `<div class="sy-meter"><div class="mx-bar hp"><i data-q="hpbar"></i></div><span class="sy-meter-v"><b data-q="hp"></b>${st === 'repairing' || st === 'salvaging' ? `<span class="sy-cd">${icon('clock')}<b data-q="cd"></b></span>` : ''}</span></div>`;

    return `
<article class="sy-ship is-${st}" style="--tc:${tcol}" aria-label="${esc(s.nm)} — ${esc(ms('st_' + st))}">
  <div class="sy-well sv-well wl-${st}">${hullSvg(h.id)}<span class="sy-well-badge">${icon(badge)}</span></div>
  <div class="sy-main">
    <div class="sy-ship-head"><h4 class="sy-nm">${esc(s.nm)}</h4>${tierBadge(h.tier)}<span class="mx-tag tag-${st}">${esc(ms('st_' + st))}</span></div>
    <div class="sy-cls">${esc(hullName(h))} · ${esc(className(h.hull))}${meterLbl ? ` · <em>${esc(meterLbl)}</em>` : ''}</div>
    ${meter}
    <div class="sy-guns">${guns}</div>
    <div class="sy-rec">${icon('swords')}<span>${esc(ms('sy_battles', s.battles || 0))}</span>${icon('skull')}<span>${esc(ms('sy_sinks', s.sinks || 0))}</span></div>
  </div>
  <div class="sy-acts">${acts}</div>
</article>`;
  }

  /** Live values inside a ship card (HP, countdowns, quotes, affordability). */
  _liveShip(node, s, p, now) {
    const q = (k) => node.querySelector(`[data-q="${k}"]`);
    const h = hullOf(s);
    const st = uiStatus(s);
    const remain = Math.max(0, (s.readyAt - now) / 1000);
    let total = 1;
    if (st === 'building') total = h.buildSec;
    else if (st === 'salvaging') total = SALVAGE_SEC[h.hull] || 60;
    else if (st === 'repairing') total = Math.max(1, repairQuote(s).sec);
    const prog = Math.max(0, Math.min(1, 1 - remain / total));

    let hpFrac = s.hpFrac ?? 1;
    if (st === 'repairing' || st === 'salvaging') hpFrac = hpFrac + (1 - hpFrac) * prog;
    if (st === 'wreck') hpFrac = 0;
    const bar = q('hpbar');
    if (bar) {
      bar.style.width = `${(hpFrac * 100).toFixed(1)}%`;
      bar.parentElement.dataset.lvl = hpFrac < 0.4 ? 'low' : hpFrac < 0.7 ? 'mid' : 'ok';
    }
    setText(q('hp'), `${Math.round(hpFrac * h.hp)} / ${h.hp}`);
    const pg = q('prog'); if (pg) pg.style.width = `${(prog * 100).toFixed(1)}%`;
    setText(q('cd'), fmtClock(remain));

    const need = q('need');
    let short = '';
    const rushB = node.querySelector('[data-act="rush"]');
    if (rushB) {
      const g = rushQuote(s, now);
      setText(q('rush'), fmtNum(g));
      rushB.disabled = p.res.gold < g;
      if (rushB.disabled) short = shortText(p.res, { gold: g });
    }
    const repB = node.querySelector('[data-act="repair"]');
    if (repB) {
      const rq = repairQuote(s);
      setText(q('repair-g'), fmtNum(rq.gold));
      setText(q('repair-t'), fmtClock(rq.sec));
      const rt = ms('sy_repairTip', costText({ gold: rq.hullGold }) || '🪙0', costText({ gold: rq.gunGold }) || '🪙0', mountedGuns(s).length);
      if (repB.title !== rt) repB.title = rt;
      setText(q('qbd'), ms('sy_quoteBd', costText({ gold: rq.hullGold }) || '🪙0', costText({ gold: rq.gunGold }) || '🪙0'));
      repB.disabled = p.res.gold < rq.gold;
      if (repB.disabled) short = shortText(p.res, { gold: rq.gold });
    }
    const salB = node.querySelector('[data-act="salvage"]');
    if (salB) {
      const sq = salvageQuote(s);
      salB.disabled = p.res.wood < sq.wood || p.res.gold < sq.gold;
      if (salB.disabled) short = shortText(p.res, sq);
    }
    if (need) {
      need.hidden = !short;
      setText(need, short ? ms('need', short) : '');
    }
  }

  /** Refund for scrapping a ship, computed by Shipyard.scrapShip on a copy. */
  _scrapRefund(p, uid) {
    const clone = { res: { ...p.res }, fleet: [...p.fleet] };
    if (!scrapShip(clone, uid)) return { wood: 0, gold: 0 };
    return { wood: clone.res.wood - p.res.wood, gold: clone.res.gold - p.res.gold };
  }

  // ── build catalogue ─────────────────────────────────────────────
  _tierHtml(t, locked) {
    return `
<div class="sy-tierhead ${locked ? 'is-locked' : ''}" style="--tc:${t.col}">
  <span class="sy-tier-num">${esc(t.nm)}</span>
  <span class="sy-tier-nm mx-caps">${esc(ms('tierN', t.nm))}</span>
  <span class="sy-tier-rule"></span>
  <span class="sy-tier-state">${locked ? icon('lock') + esc(ms('sy_tierLocked', t.shipyardLevel)) : esc(ms('sy_tierOpen'))}</span>
</div>`;
  }

  _hullSig(h, p, lang) {
    const cb = canBuild(p, h.id);
    const sw = p.res.wood < h.cost.wood, sg = p.res.gold < h.cost.gold;
    const why = cb.ok ? '' : this._blockers(cb, p, h).join(';');
    return [lang, cb.ok, cb.reason || '', sw, sg, why].join('|');
  }

  _reason(cb, p, h) {
    if (cb.reason === 'resources') return ms('need', shortText(p.res, h.cost));
    if (cb.reason === 'shipyard_level') return ms('reason_shipyard_level', cb.need || h.shipyardLevel);
    if (cb.reason === 'slipway_busy' && cb.slots) return ms('blk_slipway_busy', cb.busy, cb.slots);
    if (cb.reason === 'roster_full' && cb.cap) return ms('blk_roster_full', cb.have, cb.cap);
    return ms('reason_' + cb.reason);
  }

  /** Every blocker from canBuild(…).blockers, as display lines. */
  _blockers(cb, p, h) {
    return (cb.blockers || [cb]).filter((b) => b.reason).map((b) => this._reason(b, p, h));
  }

  _hullHtml(h, p, locked) {
    const cb = canBuild(p, h.id);
    const blk = cb.ok ? [] : this._blockers(cb, p, h);
    const why = blk.join(' · ');
    const slots = HULL_SLOTS[h.hull] || [];
    const sw = p.res.wood < h.cost.wood, sg = p.res.gold < h.cost.gold;
    const nm = hullName(h);
    const btn = locked
      ? `<span class="sy-lockchip" title="${esc(why)}">${icon('lock')}${esc(ms('sy_tierLocked', h.shipyardLevel))}</span>`
      : `<button type="button" class="mx-btn sm primary" data-act="build" data-hull="${esc(h.id)}" data-fk="build:${esc(h.id)}" ${cb.ok ? '' : 'disabled'} title="${esc(why || ms('sy_build') + ' ' + nm)}" aria-label="${esc(ms('sy_build') + ' ' + nm)}">${icon('hammer')}<span>${esc(ms('sy_build'))}</span></button>`;
    return `
<article class="sy-hull ${locked ? 'is-locked' : ''} ${cb.ok ? 'is-ok' : ''}" style="--tc:${tierOf(h.tier)?.col || '#b0b0b0'}">
  <div class="sy-hwell sv-well wl-plan">${hullSvg(h.id)}</div>
  <div class="sy-hmain">
    <div class="sy-hhead"><h4>${esc(nm)}</h4>${tierBadge(h.tier)}<span class="sy-hcls">${esc(className(h.hull))}</span></div>
    <div class="sy-hstats">
      <div class="sy-st"><span class="sy-st-l">${esc(ms('hp'))}</span><span class="mx-seg" style="--v:${(h.hp / MAX_HP).toFixed(3)}"></span><b>${h.hp}</b></div>
      <div class="sy-st"><span class="sy-st-l">${esc(ms('sy_speed'))}</span><span class="mx-seg" style="--v:${(h.spd / MAX_SPD).toFixed(3)}"></span><b>${(h.spd * KNOTS).toFixed(1)} kn</b></div>
      <div class="sy-st"><span class="sy-st-l">${esc(ms('sy_slots'))}</span><span class="sy-slots">${slots.map((x) => `<i title="${esc(ms('slot_' + x))}">${x}</i>`).join('')}</span></div>
      <div class="sy-st"><span class="sy-st-l">${esc(ms('sy_time'))}</span><b class="sy-time">${icon('clock')}${fmtClock(h.buildSec)}</b></div>
    </div>
    <div class="sy-hfoot">
      <span class="mx-cost ${sw ? 'short' : ''}" title="${esc(ms('wood'))}">${resIcon('wood')}<b>${fmtNum(h.cost.wood)}</b></span>
      <span class="mx-cost ${sg ? 'short' : ''}" title="${esc(ms('gold'))}">${resIcon('gold')}<b>${fmtNum(h.cost.gold)}</b></span>
      ${btn}
    </div>
    ${blk.length ? `<ul class="sy-why sy-blockers">${blk.map((w) => `<li>${icon(locked ? 'lock' : 'warn')}<span>${esc(w)}</span></li>`).join('')}</ul>` : ''}
  </div>
</article>`;
  }

  // ── actions ─────────────────────────────────────────────────────
  _onEsc() {
    if (this._confirm) { this._confirm = null; this._render(); return; }
    this.close();
  }

  _onClick(e) {
    if (e.target === this._root) {                    // click on the veil
      if (this._downOnVeil) this.close();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !this._root.contains(b)) return;
    const act = b.dataset.act, uid = b.dataset.uid;
    switch (act) {
      case 'close': this.close(); break;
      case 'tab': this._setTab(b.dataset.tab); break;
      case 'build': this._build(b.dataset.hull); break;
      case 'repair': this._act(uid, startRepair, 't_repair', 'coin'); break;
      case 'salvage': this._act(uid, startSalvage, 't_salvage', 'coin'); break;
      case 'rush': this._act(uid, rush, 't_rush', 'coin'); break;
      case 'scrap':
        this._confirm = uid; call(this.ctx, 'sfx', 'ui_click'); this._render();
        this._dialog.querySelector(`[data-fk="scrapno:${CSS.escape(uid)}"]`)?.focus();
        break;
      case 'scrap-no':
        this._confirm = null; this._render();
        this._dialog.querySelector(`[data-fk="scrap:${CSS.escape(uid)}"]`)?.focus();
        break;
      case 'scrap-yes': this._scrap(uid); break;
      default: break;
    }
  }

  _act(uid, fn, msgKey, sfx) {
    const p = this.ctx.getProfile();
    const s = p.fleet.find((x) => x.uid === uid);
    const nm = s?.nm || '';
    if (!s || !fn(p, uid, nowOf(this.ctx))) {
      call(this.ctx, 'toast', ms('t_fail'), 'bad');
      this._render();
      return;
    }
    this._committed();
    call(this.ctx, 'toast', ms(msgKey, nm), 'good');
    call(this.ctx, 'sfx', sfx);
    this._render();
  }

  _build(hullId) {
    const p = this.ctx.getProfile();
    const s = startBuild(p, hullId, nowOf(this.ctx));
    if (!s) {
      const cb = canBuild(p, hullId);
      call(this.ctx, 'toast', cb.ok ? ms('t_fail') : this._reason(cb, p, HULLS[hullId] || {}), 'bad');
      this._render();
      return;
    }
    this._committed();
    call(this.ctx, 'toast', ms('t_buildStart', s.nm, hullName(hullOf(s))), 'good');
    call(this.ctx, 'sfx', 'coin');
    this._render();
    if (this._tab === 'build' && matchMedia('(max-width: 760px)').matches) this._setTab('roster', false);
    const card = this._f.list.querySelector(`[data-key="${CSS.escape(s.uid)}"]`);
    card?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    card?.classList.add('is-new');
  }

  _scrap(uid) {
    const p = this.ctx.getProfile();
    const s = p.fleet.find((x) => x.uid === uid);
    const refund = this._scrapRefund(p, uid);
    this._confirm = null;
    if (!s || !scrapShip(p, uid)) {
      call(this.ctx, 'toast', p.fleet.length <= 1 ? ms('sy_lastShip') : ms('t_fail'), 'bad');
      this._render();
      return;
    }
    this._committed();
    call(this.ctx, 'toast', ms('t_scrap', s.nm, costText(refund)), 'info');
    call(this.ctx, 'sfx', 'coin');
    this._render();
    focusFirst(this._dialog, '.sy-panel-focus');
  }
}
