// ── Onboarding.js (UI2) — first-session guided tour + captain's notes ──
//
//   import { startOnboarding } from './Experience/UI/Onboarding.js';
//   startOnboarding(game);          // once per page load, after new GameApp()
//   window.pasOnboarding.restart(); // "Replay the tour" (help card)
//
// Harbor tour (skippable, spotlight + note): welcome → wood & gold →
// Build (B) → place a Lumber Mill → Shipyard (Y) → World Chart (W) →
// choose a battle. First Sea Battle: select ships → right-click to attack
// → broadside arcs → Retreat. Open War: one briefing note.
// Afterwards one-time contextual notes in the harbor: first wreck, first
// hull-tier unlock, first "while you were away" report.
//
// Progress lives in localStorage 'pas_onboard' (every access in try/catch;
// blocked storage just means the tour may show again). Players who saw the
// old tutorial ('iow_tut_done') skip the tour but still get the notes.
// `?onboard=1` in the URL restarts the tour. Never blocks input: the
// spotlight is pointer-transparent; only the welcome letter has a scrim.

import { ms, roman } from '../../Meta/UI/strings.js';
import { OFFLINE_MAX_SEC } from '../../data/harbor.js';
import { bus } from '../EventBus.js';

const KEY = 'pas_onboard';
const LEGACY_KEY = 'iow_tut_done';
const TICK_MS = 250;
const HINT_MS = 15000;

// ── storage ──────────────────────────────────────────────────────
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  if (!s || typeof s !== 'object') {
    let legacy = false;
    try { legacy = !!localStorage.getItem(LEGACY_KEY); } catch {}
    s = legacy ? { harbor: 'skipped', battle: 'skipped', war: 'done', legacy: 1 } : {};
  }
  s.hints = s.hints && typeof s.hints === 'object' ? s.hints : {};
  return s;
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

// ── DOM helpers ──────────────────────────────────────────────────
const $ = (sel) => { try { return document.querySelector(sel); } catch { return null; } };
function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
}
const modeOf = () => document.body.dataset.mode
  || ['harbor', 'battle', 'skirmish'].find(m => document.body.classList.contains('mode-' + m)) || 'skirmish';
const session = () => window._game?._opts?.session || null;
const yardOpen = () => !!session()?.ui?.shipyard?.isOpen?.();
const chartOpen = () => !!session()?.ui?.chart?.isOpen?.();
const dockOpen = () => visible($('#island-panel'));

/** Highest Shipyard level in the saved harbor (0 = none). */
function shipyardLevel() {
  const list = session()?.profile?.harbor?.buildings || [];
  return list.filter(b => b.buildingId === 'shipyard').reduce((m, b) => Math.max(m, b.level || 1), 0);
}

// ── step tables ──────────────────────────────────────────────────
function harborSteps(flags) {
  return [
    { id: 'welcome', center: true, scrim: true, t: 'ob_welcome_t', b: 'ob_welcome_b', primary: 'ob_start' },
    { id: 'res', target: () => $('#econ-bar'), t: 'ob_res_t', b: 'ob_res_b', next: true },
    { id: 'build', target: () => $('#ab-build'), t: 'ob_build_t', b: 'ob_build_b', d: 'ob_build_do',
      until: () => dockOpen() || flags.millPlaced },
    { id: 'mill', target: () => $('.dock-build-card[data-bid="lumber_mill"]') || $('#island-panel .dock-grp[data-grp="resource"]') || $('#island-panel'),
      t: 'ob_mill_t', b: 'ob_mill_b', d: 'ob_mill_do', until: () => flags.millPlaced, skippable: true, noDim: true, prefer: 'left' },
    { id: 'yard', target: () => $('.hb-btn[data-act="yard"]'), t: 'ob_yard_t', b: 'ob_yard_b', d: 'ob_yard_do',
      until: () => yardOpen() },
    { id: 'yard2', corner: true, t: 'ob_yard2_t', b: 'ob_yard2_b', next: true, until: () => !yardOpen() },
    { id: 'chart', target: () => $('.hb-btn[data-act="chart"]'), t: 'ob_chart_t', b: 'ob_chart_b', d: 'ob_chart_do',
      until: () => chartOpen() },
    { id: 'chart2', target: () => (chartOpen() ? $('.wc-node[data-id*="reef_1"]') : null), corner: true, noDim: true,
      t: 'ob_chart2_t', b: 'ob_chart2_b', next: true, last: true },
  ];
}
const BATTLE_STEPS = [
  { id: 'sel', target: () => $('#con-sel'), t: 'ob_sel_t', b: 'ob_sel_b', next: true, noDim: true },
  { id: 'atk', top: true, t: 'ob_atk_t', b: 'ob_atk_b', next: true },
  { id: 'cone', top: true, t: 'ob_cone_t', b: 'ob_cone_b', next: true },
  { id: 'ret', target: () => $('.retreat-btn'), t: 'ob_ret_t', b: 'ob_ret_b', next: true, last: true, primary: 'ob_go' },
];
const WAR_STEPS = [
  { id: 'war', center: true, scrim: true, t: 'ob_war_t', b: 'ob_war_b', last: true, primary: 'ob_gotIt', solo: true },
];

// ── the tour / note renderer ─────────────────────────────────────
class Guide {
  constructor() {
    this.spot = null; this.tip = null; this.scrim = null;
    this.step = null; this.onAct = null; this._target = null;
  }

  /** Render one note. opts: { step, index, count, hint } */
  show(step, { index = 0, count = 1, hint = false, onAct }) {
    this.hide();
    this.step = step; this.onAct = onAct;
    if (step.scrim) {
      this.scrim = document.createElement('div');
      this.scrim.className = 'ob-scrim';
      document.body.appendChild(this.scrim);
    }
    this.spot = document.createElement('div');
    this.spot.className = 'ob-spot' + (step.noDim ? ' no-dim' : '');
    this.spot.style.opacity = '0';
    document.body.appendChild(this.spot);

    const tip = document.createElement('section');
    tip.className = 'ob-tip' + (hint ? ' is-hint' : '');
    tip.setAttribute('role', step.scrim ? 'dialog' : 'status');
    tip.setAttribute('aria-live', 'polite');
    const tTxt = typeof step.t === 'function' ? step.t() : ms(step.t);
    const bTxt = typeof step.b === 'function' ? step.b() : ms(step.b);
    const dots = !hint && count > 1 && !step.solo
      ? `<span class="ob-dots" aria-label="${ms('ob_step', index + 1, count)}">${Array.from({ length: count }, (_, i) => `<i class="${i === index ? 'on' : i < index ? 'done' : ''}"></i>`).join('')}</span>` : '';
    const primary = step.primary ? ms(step.primary) : step.last ? ms('ob_done') : ms('ob_next');
    const showPrimary = hint || step.next || step.center || step.last;
    const left = hint || step.solo || step.last ? '' : step.skippable
      ? `<button type="button" class="ob-btn ghost" data-ob="later">${ms('ob_later')}</button>`
      : `<button type="button" class="ob-btn ghost" id="tut-skip" data-ob="skip">${ms('ob_skip')}</button>`;
    tip.innerHTML = `
      <span class="ob-arrow" aria-hidden="true"></span>
      <div class="ob-kicker"><span>${hint ? ms('ob_hintKicker') : ms('ob_kicker')}</span>${dots}</div>
      <h3 class="ob-title">${tTxt}</h3>
      <p class="ob-body">${bTxt}</p>
      ${step.d ? `<p class="ob-do">${ms(step.d)}</p>` : ''}
      <div class="ob-acts">${left}<span class="ob-right">${showPrimary ? `<button type="button" class="ob-btn" data-ob="${hint ? 'ok' : 'next'}">${hint ? ms('ob_gotIt') : primary}</button>` : ''}</span></div>`;
    tip.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ob]');
      if (b) { e.stopPropagation(); this.onAct?.(b.dataset.ob); }
    });
    // keep clicks on the note from reaching the 3D canvas / selection
    ['mousedown', 'pointerdown', 'contextmenu'].forEach(t => tip.addEventListener(t, e => e.stopPropagation()));
    document.body.appendChild(tip);
    this.tip = tip;
    this.place();
    if (step.scrim) tip.querySelector('[data-ob="next"]')?.focus({ preventScroll: true });
  }

  /** Re-position spotlight + note on the (possibly moving) target. */
  place() {
    const step = this.step, tip = this.tip;
    if (!step || !tip) return;
    const vw = innerWidth, vh = innerHeight, m = 12;
    const el = step.target ? step.target() : null;
    const ok = el && visible(el);
    this._target = ok ? el : null;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x, y, side;
    if (ok) {
      const r = el.getBoundingClientRect(), pad = 6;
      Object.assign(this.spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', opacity: '1' });
      if (step.corner && r.height > vh * 0.5) {          // a whole panel: just ring it, note in the corner
        side = 'center'; x = m + 4; y = vh - th - m - 4;
      } else if (step.prefer === 'left' && r.left - 18 - tw > m) {   // e.g. a card in the right-hand dock
        side = 'left'; x = r.left - 18 - tw; y = Math.max(m, Math.min(r.top + r.height / 2 - th / 2, vh - th - m));
      } else {
        const below = r.bottom + 14 + th < vh - m, above = r.top - 14 - th > m;
        side = below || !above ? 'below' : 'above';
        y = side === 'below' ? Math.min(r.bottom + 14, vh - th - m) : r.top - 14 - th;
        x = Math.max(m, Math.min(r.left + r.width / 2 - tw / 2, vw - tw - m));
        const ax = Math.max(14, Math.min(r.left + r.width / 2 - x - 7, tw - 28));
        const arrow = tip.querySelector('.ob-arrow');
        if (arrow) arrow.style.left = ax + 'px';
      }
    } else {
      this.spot.style.opacity = '0';
      side = 'center';
      if (step.center) { x = (vw - tw) / 2; y = Math.max(m, (vh - th) / 2 - 20); }
      else if (step.corner) { x = m + 4; y = vh - th - m - 4; }
      else if (vw > 760) { x = vw - tw - 18; y = 124; }     // battle notes: top-right, clear of the fleet
      else { x = (vw - tw) / 2; y = 170; }
    }
    tip.classList.remove('at-below', 'at-above', 'at-center', 'at-left');
    tip.classList.add('at-' + side);
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(Math.max(m, y)) + 'px';
  }

  hide() {
    this.spot?.remove(); this.tip?.remove(); this.scrim?.remove();
    this.spot = this.tip = this.scrim = null; this.step = null; this.onAct = null;
  }
}

// ── controller ───────────────────────────────────────────────────
let _ctl = null;

/**
 * Start the onboarding for this page's mode. Idempotent.
 * @param {object} [game] the GameApp (only read)
 */
export function startOnboarding(game = window._game) {
  if (_ctl) return _ctl;
  const st = load();
  try { if (/[?&]onboard=1\b/.test(location.search)) { st.harbor = 0; st.battle = 0; st.war = 0; delete st.legacy; save(st); } } catch {}
  const guide = new Guide();
  const flags = { millPlaced: false };
  const mode = modeOf();
  let tour = null;          // { key, steps, i }
  let hint = null;          // { id, until }

  try {
    bus.on('building:placed', (p = {}) => {
      const id = p.building?.id || p.instance?.buildingId;
      if (id === 'lumber_mill') flags.millPlaced = true;
    });
  } catch {}

  const stepsFor = (key) => key === 'harbor' ? harborSteps(flags) : key === 'battle' ? BATTLE_STEPS : WAR_STEPS;
  const pending = (key) => { const v = st[key]; return v !== 'done' && v !== 'skipped'; };

  function render() {
    if (!tour) return;
    const s = tour.steps[tour.i];
    guide.show(s, { index: tour.i, count: tour.steps.length, onAct: act });
  }
  function goto(i) {
    if (!tour) return;
    if (i >= tour.steps.length) { finish('done'); return; }
    tour.i = i;
    if (tour.key !== 'war') { st[tour.key] = i; save(st); }
    render();
  }
  function finish(how) {
    if (!tour) return;
    st[tour.key] = how;
    if (how === 'skipped') { st.harbor = st.harbor === 'done' ? 'done' : 'skipped'; st.battle = st.battle === 'done' ? 'done' : 'skipped'; st.war = 'done'; }
    save(st);
    tour = null;
    guide.hide();
  }
  function act(a) {
    if (hint) { if (a === 'ok') endHint(); return; }
    if (!tour) return;
    if (a === 'skip') finish('skipped');
    else goto(tour.i + 1);       // next · later
  }
  function begin(key) {
    const steps = stepsFor(key);
    let i = typeof st[key] === 'number' ? st[key] : 0;
    if (key === 'harbor' && i > 0 && i < steps.length) {
      // resuming after a reload: never resume inside a panel that is closed now
      if (steps[i].id === 'yard2') i = 4; else if (steps[i].id === 'chart2') i = 6; else if (steps[i].id === 'mill') i = 2;
    }
    tour = { key, steps, i: Math.min(i, steps.length - 1) };
    render();
  }

  // contextual notes (harbor)
  function showHint(id, step) {
    hint = { id, t0: performance.now() };
    st.hints[id] = id === 'tier' ? shipyardLevel() : 1;
    save(st);
    guide.show({ ...step, noDim: true }, { hint: true, onAct: act });
  }
  function endHint() { hint = null; guide.hide(); }
  function checkHints() {
    if (tour || hint || mode !== 'harbor' || yardOpen() || chartOpen()) {
      if (hint && performance.now() - hint.t0 > HINT_MS) endHint();
      return;
    }
    const p = session()?.profile;
    if (!st.hints.offline && visible($('.hb-away'))) {
      return showHint('offline', { target: () => $('.hb-away'), t: 'hint_offline_t', b: () => ms('hint_offline', Math.round(OFFLINE_MAX_SEC / 3600)) });
    }
    if (p && !st.hints.wreck && p.fleet?.some(s => s.status === 'wreck')) {
      return showHint('wreck', { target: () => $('.hb-btn[data-act="yard"]'), t: 'hint_wreck_t', b: 'hint_wreck' });
    }
    const lv = shipyardLevel();
    if (p && lv) {
      if (!st.hints.tier) { st.hints.tier = lv; save(st); }
      else if (lv > st.hints.tier) {
        return showHint('tier', { target: () => $('.hb-btn[data-act="yard"]'), t: 'hint_tier_t', b: () => ms('hint_tier', roman(lv)) });
      }
    }
  }

  // main loop: follow targets, auto-advance, hints
  let tick = 0;
  const loop = setInterval(() => {
    tick++;
    if (tour) {
      const s = tour.steps[tour.i];
      if (s.until && s.until()) { goto(tour.i + 1); return; }
      guide.place();
    } else if (hint) {
      guide.place();
      if (performance.now() - hint.t0 > HINT_MS) endHint();
    }
    if (tick % 6 === 0) checkHints();
  }, TICK_MS);
  addEventListener('resize', () => guide.place());
  addEventListener('iow:langchange', () => { if (tour) render(); else if (hint) endHint(); });

  // start the tour for this mode once the scene has settled
  setTimeout(() => {
    if (mode === 'harbor' && pending('harbor')) begin('harbor');
    else if (mode === 'battle' && st.harbor === 'done' && pending('battle')) begin('battle');
    else if (mode === 'battle' && !st.harbor && pending('battle')) begin('battle');   // first page load was a battle
    else if (mode === 'skirmish' && pending('war')) begin('war');
  }, mode === 'battle' ? 2600 : 1400);

  _ctl = {
    /** Restart the tour for the current mode (help card "Replay the tour"). */
    restart() {
      endHint();
      const key = mode === 'battle' ? 'battle' : mode === 'skirmish' ? 'war' : 'harbor';
      st[key] = 0; if (key === 'harbor') st.battle = 0; delete st.legacy; save(st);
      tour = null; begin(key);
    },
    /** Snapshot of the stored progress (QA / tests). */
    state: () => JSON.parse(JSON.stringify(st)),
    stop() { clearInterval(loop); guide.hide(); tour = null; hint = null; },
  };
  window.pasOnboarding = _ctl;
  return _ctl;
}
