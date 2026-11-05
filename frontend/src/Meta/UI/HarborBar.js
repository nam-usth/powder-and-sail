// ── HARBOR BAR — top-centre strip in harbor mode + "while you were away" ─
//
//   const bar = new HarborBar(ctx);   bar.update();   bar.destroy();
//   showOfflineReport({ seconds, wood, gold, finished:[buildingId] }) → { close() }
//
// ctx: the meta ctx. Optional extras (mountHarborUI provides them):
//   ctx.openShipyard(), ctx.openChart() — what the two buttons do. Without
//   them the bar lazily creates its own ShipyardPanel / WorldChart
//   (exposed as bar.shipyard / bar.chart).
// update() is cheap and throttled (safe to call every frame); it also runs
// on 'iow:meta-changed' and 'iow:langchange'. Position: top var(--hb-top).

import { BUILDINGS } from '../../data/buildings.js';
import { OFFLINE_MAX_SEC } from '../../data/harbor.js';
import { rankIndex, rankOf, nextRank } from '../Campaign.js';
import { sailableShips } from '../Shipyard.js';
import { ShipyardPanel } from './ShipyardPanel.js';
import { WorldChart } from './WorldChart.js';
import { ms, rankName, fmtNum, fmtDur } from './strings.js';
import { icon, resIcon, rankBadge } from './icons.js';
import { esc, el, call, ensureMetaCss, revealWhenStyled, setText, tweenNumber, reducedMotion } from './dom.js';

const THROTTLE_MS = 400;

export class HarborBar {
  /** @param {object} ctx meta ctx (+ optional openShipyard/openChart) */
  constructor(ctx) {
    this.ctx = ctx;
    this.shipyard = typeof ctx.openShipyard === 'function' ? null : new ShipyardPanel(ctx);
    this.chart = typeof ctx.openChart === 'function' ? null : new WorldChart(ctx);
    this._last = 0;
    this._sig = '';
    ensureMetaCss();
    this._el = el(`
<nav class="hb-bar" aria-label="Harbor">
  <div class="hb-rank" data-f="rank">
    <span class="hb-badge" data-f="badge" aria-hidden="true"></span>
    <div class="hb-rank-txt">
      <b class="hb-rank-nm" data-f="rname"></b>
      <span class="mx-bar renown" data-f="barWrap" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i data-f="bar"></i></span>
      <small class="hb-renown">${resIcon('renown')}<span data-f="renown"></span></small>
    </div>
  </div>
  <button type="button" class="hb-btn" data-act="yard" aria-keyshortcuts="Y" data-f="yardBtn">
    <span class="hb-ic">${icon('anchor')}</span><span class="hb-lbl" data-f="yardL"></span>
    <span class="hb-count" data-f="yardN" hidden></span><kbd class="hb-key">Y</kbd>
  </button>
  <button type="button" class="hb-btn primary" data-act="chart" aria-keyshortcuts="W" data-f="chartBtn">
    <span class="hb-ic">${icon('map')}</span><span class="hb-lbl"><small data-f="chartS"></small><span data-f="chartL"></span></span><kbd class="hb-key">W</kbd>
  </button>
</nav>`);
    this._f = {};
    this._el.querySelectorAll('[data-f]').forEach((n) => { this._f[n.dataset.f] = n; });
    this._el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      call(this.ctx, 'sfx', 'ui_click');
      if (b.dataset.act === 'yard') this._openYard();
      else this._openChart();
    });
    this._onChange = () => this.update(true);
    window.addEventListener('iow:meta-changed', this._onChange);
    window.addEventListener('iow:langchange', this._onChange);
    document.body.appendChild(this._el);
    revealWhenStyled(this._el);
    this.update(true);
  }

  _openYard() {
    if (typeof this.ctx.openShipyard === 'function') { this.ctx.openShipyard(); return; }
    if (this.chart?.isOpen()) this.chart.close();
    this.shipyard.toggle();
  }

  _openChart() {
    if (typeof this.ctx.openChart === 'function') { this.ctx.openChart(); return; }
    if (this.shipyard?.isOpen()) this.shipyard.close();
    this.chart.toggle();
  }

  /**
   * Refresh rank, renown and yard counts. Throttled unless `force`.
   * @param {boolean} [force]
   */
  update(force = false) {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && t - this._last < THROTTLE_MS) return;
    this._last = t;
    let p;
    try { p = this.ctx.getProfile(); } catch { return; }
    if (!p) return;
    const yard = p.fleet.filter((s) => s.status === 'building' || s.status === 'repairing').length;
    const wrecks = p.fleet.filter((s) => s.status === 'wreck').length;
    const ready = sailableShips(p).length;
    const sig = [p.renown, yard, wrecks, ready, ms('hb_shipyard')].join('|');
    if (sig === this._sig) return;
    this._sig = sig;
    const f = this._f;
    const ri = rankIndex(p.renown), cur = rankOf(p.renown), nxt = nextRank(p.renown);
    if (f.badge._i !== ri) { f.badge.innerHTML = rankBadge(ri); f.badge._i = ri; }
    setText(f.rname, rankName(cur));
    const prog = nxt ? (p.renown - cur.renown) / Math.max(1, nxt.renown - cur.renown) : 1;
    f.bar.style.width = `${Math.round(Math.max(0, Math.min(1, prog)) * 100)}%`;
    f.barWrap.setAttribute('aria-valuenow', String(Math.round(prog * 100)));
    setText(f.renown, nxt ? `${fmtNum(p.renown)} / ${fmtNum(nxt.renown)}` : fmtNum(p.renown));
    f.rank.title = nxt ? ms('wc_next', fmtNum(nxt.renown - p.renown), rankName(nxt)) : ms('wc_max');
    setText(f.yardL, ms('hb_shipyard'));
    f.yardN.hidden = !(yard || wrecks);
    setText(f.yardN, String(yard + wrecks));
    f.yardN.classList.toggle('is-bad', wrecks > 0);
    f.yardBtn.title = `${ms('hb_shipyard')} · ${ms('hb_inYard', yard)}${wrecks ? ` · ${wrecks} ${ms('st_wreck')}` : ''} — ${ms('hb_key', 'Y')}`;
    setText(f.chartS, ms('hb_chart'));
    setText(f.chartL, ms('hb_setSail'));
    f.chartBtn.title = `${ms('hb_chart')} · ${ms('hb_ready', ready)} — ${ms('hb_key', 'W')}`;
  }

  /** Remove the bar and its listeners (panels it created are closed). */
  destroy() {
    window.removeEventListener('iow:meta-changed', this._onChange);
    window.removeEventListener('iow:langchange', this._onChange);
    this.shipyard?.close();
    this.chart?.close();
    this._el.remove();
  }
}

/**
 * "While you were away" letter for an offline-progress report
 * (HarborEconomy.applyOffline). Auto-dismisses after 14 s.
 * @param {{seconds:number, wood:number, gold:number, finished?:string[]}} report
 * @param {{sfx?:Function}} [ctx]
 * @returns {{close:Function}|null}
 */
export function showOfflineReport(report, ctx = {}) {
  if (!report || !(report.seconds > 0)) return null;
  ensureMetaCss();
  document.querySelector('.hb-away')?.remove();
  const names = (report.finished || []).map((id) => BUILDINGS.find((b) => b.id === id)?.name || id);
  const capped = !(report.wood > 0) && !(report.gold > 0);
  const card = el(`
<section class="hb-away" role="status" aria-live="polite">
  <span class="hb-seal" aria-hidden="true">${icon('anchor')}</span>
  <button type="button" class="hb-away-x" data-act="ok" aria-label="${esc(ms('close'))}">${icon('close')}</button>
  <h3 class="hb-away-t">${esc(ms('away_title'))}</h3>
  <p class="hb-away-b">${esc(ms('away_body', fmtDur(report.seconds)))}</p>
  <div class="hb-away-res">
    <span class="mx-res lg">${resIcon('wood')}<b data-n="wood">+0</b></span>
    <span class="mx-res lg">${resIcon('gold')}<b data-n="gold">+0</b></span>
  </div>
  ${report.seconds >= OFFLINE_MAX_SEC - 1 ? `<p class="hb-away-note">${esc(ms('away_capped', fmtDur(OFFLINE_MAX_SEC)))}</p>` : ''}
  ${capped ? `<p class="hb-away-note">${esc(ms('away_full'))}</p>` : ''}
  ${names.length ? `<ul class="hb-away-done">${names.map((n) => `<li>${icon('check')}<span>${esc(ms('away_finished', n))}</span></li>`).join('')}</ul>` : ''}
  <div class="hb-away-foot"><button type="button" class="mx-btn sm good" data-act="ok">${esc(ms('away_ok'))}</button></div>
</section>`);
  document.body.appendChild(card);
  revealWhenStyled(card);
  let timer = 0, closed = false;
  const cancels = [];
  const close = () => {
    if (closed) return;
    closed = true; clearTimeout(timer); cancels.forEach((c) => c());
    if (reducedMotion()) { card.remove(); return; }
    card.classList.add('is-closing');
    setTimeout(() => card.remove(), 260);
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, 14000); };
  card.addEventListener('click', (e) => { if (e.target.closest('[data-act="ok"]')) { call(ctx, 'sfx', 'ui_click'); close(); } });
  card.addEventListener('pointerenter', () => clearTimeout(timer));
  card.addEventListener('pointerleave', arm);
  card.addEventListener('focusin', () => clearTimeout(timer));
  arm();
  const n = (k) => card.querySelector(`[data-n="${k}"]`);
  setTimeout(() => {
    cancels.push(tweenNumber(n('wood'), 0, Math.floor(report.wood || 0), 1200, (v) => '+' + fmtNum(v)));
    cancels.push(tweenNumber(n('gold'), 0, Math.floor(report.gold || 0), 1200, (v) => '+' + fmtNum(v)));
    if (report.wood > 0 || report.gold > 0) call(ctx, 'sfx', 'coin');
  }, reducedMotion() ? 0 : 450);
  return { close, el: card };
}
