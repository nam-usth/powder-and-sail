import { StatusEffects } from '../Combat/StatusEffects.js';
import { toasts }        from '../../UI/ToastQueue.js';

// ── CommanderSystem.js (AT) ─────────────────────────────────────
// Three commander abilities on cooldown, hotkeys Z/X/C + a small HUD dock
// (bottom-centre, above the action bar). Gameplay glue for the War Front:
// while you are LOSING (front < 45) cooldowns recover 25 % faster — an
// Age-of-War-style comeback valve that keeps the tug-of-war tense without
// snowballing the winner.
//
//   Z ⚔ Broadside Barrage — instant reload + 50 % damage for 10 s
//   X 🌬 Favorable Winds   — fleet speed ×1.4 for 12 s
//   C 🛠 Emergency Repairs — all ships heal 25 % max HP over 5 s
//
// Hooks: CombatSystem multiplies player damage by st.cmdDmgMult;
// Winds rides the existing StatusEffects multiplier pipeline.

export const ABILITIES = [
  { id: 'barrage', key: 'z', icon: '⚔',  name: 'Broadside Barrage', desc: 'Instant reload · +50% dmg · 10s', cd: 75, dur: 10 },
  { id: 'winds',   key: 'x', icon: '🌬', name: 'Favorable Winds',   desc: 'Fleet speed +40% · 12s',          cd: 60, dur: 12 },
  { id: 'repairs', key: 'c', icon: '🛠', name: 'Emergency Repairs', desc: 'Heal 25% max HP over 5s',         cd: 90, dur: 5  },
];

const COMEBACK_RATE = 1.25;   // cooldown speed while warFront < 45
const UI_TICK       = 0.25;   // HUD refresh cadence (s)

export class CommanderSystem {
  constructor(state, bus, vfx) {
    this._state = state;
    this._bus   = bus;
    this._vfx   = vfx;
    this._cds     = {};   // ability id → seconds of cooldown remaining
    this._active  = {};   // ability id → seconds of effect remaining
    this._healPerSec = 0; // repairs: % of maxHp restored per second
    this._uiT   = 0;
    this._ensureUI();
  }

  // ── Activation ────────────────────────────────────────────────
  tryUse(id) {
    const st = this._state;
    if (st.gameOver || st.paused) return;
    const ab = ABILITIES.find(a => a.id === id);
    if (!ab) return;
    if (this._cds[id] > 0) {
      toasts.show(`${ab.icon} ${ab.name} — ready in ${Math.ceil(this._cds[id])}s`, 1200);
      return;
    }

    const alive = st.playerShips.filter(s => s.alive);
    if (!alive.length) { toasts.show('No ships afloat', 1200); return; }

    this._cds[id]    = ab.cd;
    this._active[id] = ab.dur;
    const gameT = st.stats.timeSec;

    if (id === 'barrage') {
      st.cmdDmgMult = 1.5;
      alive.forEach(s => Object.keys(s.slotTimers).forEach(sl => s.slotTimers[sl] = 0));
      alive.forEach(s => this._vfx.spawnPart?.(s.x, 2.5, s.z, 0xffdd44, 6));
    } else if (id === 'winds') {
      alive.forEach(s => StatusEffects.apply(s, 'cmdWinds', { multiplier: 1.4 }, gameT, ab.dur));
      alive.forEach(s => this._vfx.floatText?.(s.x, 3.4, s.z, '🌬', { col: '#7fd4ff', size: 13, life: 1.2, rise: 2.2 }));
    } else if (id === 'repairs') {
      this._healPerSec = 0.25 / ab.dur;
    }

    this._vfx.playSound?.('research');
    toasts.show(`${ab.icon} ${ab.name}!`, 1600, 'good');
    this._refreshUI(true);
  }

  // ── Frame tick ────────────────────────────────────────────────
  update(dt) {
    const st = this._state;
    if (st.gameOver) return;

    // War Front comeback valve: losing side recovers abilities faster
    const cdRate = (st.warFront ?? 50) < 45 ? COMEBACK_RATE : 1;
    for (const ab of ABILITIES) {
      if (this._cds[ab.id] > 0) this._cds[ab.id] = Math.max(0, this._cds[ab.id] - dt * cdRate);
      if (this._active[ab.id] > 0) {
        this._active[ab.id] -= dt;
        if (this._active[ab.id] <= 0) this._expire(ab.id);
      }
    }

    // Repairs: heal-over-time
    if (this._active['repairs'] > 0 && this._healPerSec > 0) {
      for (const s of st.playerShips) {
        if (!s.alive || s.hp >= s.maxHp) continue;
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * this._healPerSec * dt);
      }
    }

    this._uiT += dt;
    if (this._uiT >= UI_TICK) { this._uiT = 0; this._refreshUI(); }
  }

  _expire(id) {
    this._active[id] = 0;
    if (id === 'barrage') this._state.cmdDmgMult = 1;
    if (id === 'repairs') this._healPerSec = 0;
    // winds expires by itself through StatusEffects
  }

  // ── HUD dock ──────────────────────────────────────────────────
  _ensureUI() {
    if (document.getElementById('cmd-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'cmd-bar';
    bar.innerHTML = ABILITIES.map(a => `
      <button class="cmd-btn" id="cmd-${a.id}" data-ab="${a.id}" title="${a.name} — ${a.desc} [${a.key.toUpperCase()}]">
        <span class="cmd-ic">${a.icon}</span>
        <span class="cmd-key">${a.key.toUpperCase()}</span>
        <span class="cmd-cd" id="cmd-cd-${a.id}"></span>
      </button>`).join('');
    (document.getElementById('ui') || document.body).appendChild(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('.cmd-btn');
      if (b) this.tryUse(b.dataset.ab);
    });
  }

  _refreshUI(force) {
    for (const ab of ABILITIES) {
      const btn = document.getElementById('cmd-' + ab.id);
      const cd  = document.getElementById('cmd-cd-' + ab.id);
      if (!btn || !cd) continue;
      const rem = this._cds[ab.id] || 0;
      const on  = (this._active[ab.id] || 0) > 0;
      btn.classList.toggle('on-cd',  rem > 0 && !on);
      btn.classList.toggle('active', on);
      cd.textContent = rem > 0 && !on ? Math.ceil(rem) : '';
    }
  }
}
