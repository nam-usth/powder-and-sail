// ── BATTLE SESSION (AW-S07/S08) ───────────────────────────────────
// Glue between the profile's pending battle and a GameApp in mode 'battle':
// builds the mission map + fleets, runs the MissionSystem, banks the result.

import { HULLS, BATTLE, PRODUCE_AT_SEA } from '../../data/harbor.js';
import { saveProfile }           from '../../Meta/Profile.js';
import { applyOffline }          from '../../Meta/HarborEconomy.js';
import { getMission, makePatrol, applyBattleResult } from '../../Meta/Campaign.js';
import { gotoMode }              from '../../Meta/ModeRouter.js';
import { MissionSystem, fmt, enemyAi, escapeZone, OBJ_TEXT } from '../Systems/Match/MissionSystem.js';
import { shipSpec, enemySpec }   from './shipSpec.js';
import { restoreResearch }       from './HarborSession.js';
import { bus }                   from '../EventBus.js';
import { toasts }                from '../UI/ToastQueue.js';
import { music }                 from '../Utils/MusicDirector.js';
import { T }                     from '../../i18n.js';

export class BattleSession {
  constructor(profile, store, deps = {}) {
    this.profile  = profile;
    this.store    = store;
    this.now      = deps.now || (() => Date.now());
    this.location = deps.location || (typeof location !== 'undefined' ? location : null);
    this.uiLoader = deps.ui || (() => import('../../Meta/UI/index.js'));
    this.game = null;
    this.done = false;
  }

  /**
   * GameApp options for the pending battle, or null when there is none
   * (caller sends the player back to the harbor).
   */
  prepare(missionIdFromUrl) {
    const p = this.profile, b = p.battle;
    if (!b || (missionIdFromUrl && b.missionId !== missionIdFromUrl)) return null;
    if (b.started) return null;                          // reload mid-battle → forfeit (GDD)
    const mission = b.missionId === 'patrol' ? makePatrol(p, b.seed || 1, b.shipUids) : getMission(b.missionId);
    if (!mission) return null;
    const ships = b.shipUids.map(u => p.fleet.find(s => s.uid === u)).filter(s => s && s.status === 'ready');
    if (!ships.length) return null;
    this.mission = mission;
    this.roster = ships;
    b.started = true;
    saveProfile(this.store, p, this.now());

    const sp = mission.spawn || { x: -70, z: 0 };
    const n = ships.length;
    const playerFleet = ships.map((rs, i) => shipSpec(rs, sp.x - (i % 2) * 6, sp.z + (i - (n - 1) / 2) * 7, sp.angle ?? Math.PI / 2));
    const enemyFleet  = (mission.enemies || []).map((e, i) => enemySpec(e, i, mission.faction));
    const islands = (mission.islands || []).map(d => ({ faction: d.own === 'enemy' ? mission.faction : undefined, region: mission.region, ...d }));
    return { mode: 'battle', islands, playerFleet, enemyFleet, session: this };
  }

  attach(game) {
    this.game = game;
    const st = game._state, m = this.mission;
    st.resWood = 0; st.resGold = 0;   // battles have no economy (resources live in the harbor)
    st.battleAggro = m.ai?.aggro || m.aggro || BATTLE.aggro;        // data/harbor.js BATTLE knobs (mission.ai.aggro overrides)
    st.battleFortRegen = m.fortRegen ?? BATTLE.fortRegen;
    st.battleFortRebuild = BATTLE.fortRebuild;
    st.battleFortShipRegen = BATTLE.fortShipRegen;
    st.selArcs = true;          // broadside cones on the selected ships
    st.battleAlwaysEngage = m.objective?.type === 'survive';
    st.battleEscape = escapeZone(m, BATTLE.escapeR);                 // prizes / runners sail here (EnemyAI)
    (m.enemies || []).forEach((e, i) => { const s = st.enemyShips[i]; if (s) s.ai = enemyAi(e, m); });   // per-ship tactics
    restoreResearch(st, this.profile.harbor.researched);
    this.missionSys = new MissionSystem(st, game._islands, m, bus, (e, i) => this._spawnEnemy(e, i), { escapeR: BATTLE.escapeR });
    const sp = m.spawn || { x: -70, z: 0 };
    st.camDist = 75;
    game._cam.jumpTo(sp.x + 25, sp.z);
    st.selection = st.playerShips.filter(s => s.alive);
    this._mountHud();
    music.setRegion(['caribbean','atlantic','indian','spice','southchina'].includes(m.region) ? m.region : 'caribbean');
    music.play('battle'); music.ambience('sea');
    toasts.show(`⚔ ${m.nm}`, 3200, 'info');
  }

  _spawnEnemy(e, i) {
    const g = this.game, st = g._state;
    const ship = g._makeFromSpec(enemySpec(e, i, this.mission.faction), st.enemyShips.length, 'enemy');
    ship.ai = enemyAi(e, this.mission);
    st.enemyShips.push(ship); st.allShips.push(ship);
    bus.emit('ship:spawned', { ship });
    g._vfx.playSound?.('warning');
    return ship;
  }

  update(dt) {
    if (!this.missionSys || this.done) return;
    const out = this.missionSys.update(dt);
    this._hudT = (this._hudT || 0) + dt;
    if (this._hudT >= 0.25) {
      this._hudT = 0; this._renderHud();
      // music intensity: share of living enemies within 45 u of any of our ships
      const st = this.game._state, foes = st.enemyShips.filter(s => s.alive), ours = st.playerShips.filter(s => s.alive);
      const close = foes.filter(e => ours.some(p => (p.x - e.x) ** 2 + (p.z - e.z) ** 2 < 2025)).length;
      music.setIntensity(foes.length ? Math.min(1, close / Math.max(1, Math.min(foes.length, 3))) : 0);
    }
    if (out) this.finish(out.won, out.reason);
  }

  /** Retreat: leave now, counts as a defeat with no further losses. */
  retreat() { if (!this.done) this.finish(false, 'retreat'); }

  finish(won, reason) {
    if (this.done) return;
    this.done = true;
    const g = this.game, st = g._state;
    st.gameOver = true; st.frozen = true;
    g._orders?.stop?.(st.playerShips);
    st.allShips.forEach(s => { s.speed = 0; });
    g._vfx.playSound?.(won ? 'victory' : 'defeat');
    music.play(won ? 'victory' : 'defeat'); music.setIntensity(0);

    const shipsOut = this.roster.map(rs => {
      const live = st.playerShips.find(s => s.uid === rs.uid);
      const sunk = !live || !live.alive;
      const idx = st.playerShips.indexOf(live);
      return {
        uid: rs.uid, sunk, sinks: 0,
        hpFrac: live && live.alive ? live.hp / live.maxHp : 0,
        loadout: live ? { ...live.loadout } : rs.loadout,
        upgrades: idx >= 0 ? { ...st.shipUpgrades[idx] } : rs.upgrades,
        nm: rs.nm, hullId: rs.hullId,
      };
    });
    // The harbor kept working while the fleet was at sea (offline rules, capped).
    if (PRODUCE_AT_SEA) applyOffline(this.profile, this.now());
    const summary = applyBattleResult(this.profile, this.mission, {
      won, retreated: reason === 'retreat', timeSec: Math.round(this.missionSys.time),
      ships: shipsOut,
      sunkEnemyClasses: this.missionSys.sunk,
      fortsDestroyed: this.missionSys.fortsDestroyed(),
    });
    shipsOut.forEach(r => { const s = this.profile.fleet.find(x => x.uid === r.uid); if (s && r.upgrades) s.upgrades = r.upgrades; });
    summary.reason = reason;
    saveProfile(this.store, this.profile, this.now());
    this.missionSys.dispose();
    this.summary = summary;
    this._showResult(summary, shipsOut);
  }

  _ctx(shipsOut) {
    return {
      getProfile: () => this.profile,
      save: () => saveProfile(this.store, this.profile, this.now()),
      now: this.now,
      toast: (m, t) => toasts.show(m, 2200, t),
      sfx: n => this.game?._vfx?.playSound?.(n),
      ships: shipsOut,
      onReturn: () => this._leave(() => gotoMode(this.location, 'harbor')),
      onRetry: this.mission.repeatable || !this.summary?.won ? () => this.retry() : undefined,
    };
  }

  /** Same mission with the same ships that are still afloat. */
  retry() {
    const uids = this.roster.map(s => s.uid).filter(u => this.profile.fleet.find(x => x.uid === u)?.status === 'ready');
    if (!uids.length) { toasts.show(T.noShipsToRetry || 'No ships left afloat — repair them in the Shipyard.', 3000, 'bad'); return; }
    const seed = this.mission.repeatable ? (this.now() % 100000) : null;
    this.profile.battle = { missionId: this.mission.id, shipUids: uids, seed, startedAt: this.now(), started: false };
    saveProfile(this.store, this.profile, this.now());
    this._leave(() => gotoMode(this.location, 'battle', { mission: this.mission.id }));
  }

  _leave(go) {
    const scr = document.getElementById('loading-screen');
    if (scr) { scr.style.display = ''; scr.style.opacity = '1'; }
    setTimeout(go, 300);
  }

  async _showResult(summary, shipsOut) {
    try {
      const mod = await this.uiLoader();
      mod.showBattleResult(summary, this._ctx(shipsOut));
    } catch (e) {
      console.warn('[Battle] result UI unavailable', e);
      const ok = confirm(`${summary.won ? 'Victory' : 'Defeat'} — +${summary.reward.wood} wood, +${summary.reward.gold} gold. Return to harbor?`);
      if (ok) gotoMode(this.location, 'harbor');
    }
  }

  // ── Objective HUD (top-left #objectives) + retreat button ──
  _mountHud() {
    const btn = document.createElement('button');
    btn.id = 'retreat-btn';
    btn.className = 'retreat-btn';
    btn.textContent = T.retreat || '⚑ Retreat';
    btn.title = T.retreatHint || 'Leave the battle (counts as a defeat, keeps half the plunder)';
    btn.addEventListener('click', () => {
      if (this.done) return;
      if (confirm(T.retreatConfirm || 'Retreat to the harbor? The battle counts as lost.')) this.retreat();
    });
    document.body.appendChild(btn);

    // Versus bar (top centre): your fleet hull · clock · enemy fleet hull
    const vs = document.createElement('div');
    vs.id = 'vs-bar'; vs.className = 'vs-bar';
    vs.innerHTML =
      '<div class="vs-side vs-you"><span class="vs-badge" id="vs-you-n"></span><span class="vs-name" id="vs-you-nm"></span>' +
      '<div class="vs-track"><div class="vs-fill" id="vs-you-fill"></div></div></div>' +
      '<div class="vs-clock" id="vs-clock">0:00</div>' +
      '<div class="vs-side vs-foe"><div class="vs-track"><div class="vs-fill" id="vs-foe-fill"></div></div>' +
      '<span class="vs-name" id="vs-foe-nm"></span><span class="vs-badge" id="vs-foe-n"></span></div>';
    document.body.appendChild(vs);
    const F = this.mission.faction;
    import('../../data/factions.js').then(({ factionOf }) => {
      const f = factionOf(F);
      const lang = document.body.classList.contains('lang-vi');
      document.getElementById('vs-foe-nm').textContent = (lang && f.vi) ? f.vi : f.nm;
      vs.style.setProperty('--foe', f.css || '#a03030');
    }).catch(() => { document.getElementById('vs-foe-nm').textContent = this.mission.nm; });
    document.getElementById('vs-you-nm').textContent = T.yourFleet || 'Your Fleet';
    this._renderHud();
  }

  _renderHud() {
    const el = document.getElementById('objectives');
    if (!el || !this.missionSys) return;
    const m = this.mission, ms = this.missionSys;
    const L = T.objLabels || { sink: 'Enemy ships sunk', forts: 'Forts destroyed', survive: 'Hold out', capture: 'Islands taken' };
    const OT = T.objTypes || { sink_all: 'Sink every enemy ship', destroy_forts: 'Destroy the enemy forts', survive: 'Keep a ship afloat', capture: 'Capture the island' };
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const lines = ms.progress().map(p =>
      `<div class="obj ${p.done ? 'obj-done' : ''}">${p.done ? '✔' : '◇'} ${esc(L[p.key] || p.label || p.key)}: <b>${esc(p.value)}</b></div>`).join('');
    const afloat = this.game._state.playerShips.filter(s => s.alive).length;
    const html =
      `<div class="obj-title">${esc(m.nm)}</div>` +
      `<div class="obj" style="opacity:.85">${esc(OT[m.objective.type] || OBJ_TEXT.types[m.objective.type] || '')}</div>` + lines +
      `<div class="obj">🚢 ${afloat} / ${this.roster.length} · ⏱ ${fmt(ms.time)}${m.parTime ? ` <span style="opacity:.6">(par ${fmt(m.parTime)})</span>` : ''}</div>`;
    if (html !== this._lastHud) { el.innerHTML = html; this._lastHud = html; }
    this._renderVs();
  }

  _renderVs() {
    const st = this.game._state;
    const sum = ships => ships.reduce((a, s) => [a[0] + (s.alive ? Math.max(0, s.hp) : 0), a[1] + s.maxHp, a[2] + (s.alive ? 1 : 0)], [0, 0, 0]);
    const [ph, pm, pn] = sum(st.playerShips), [eh, em, en] = sum(st.enemyShips);
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.style.width = (v * 100).toFixed(1) + '%'; };
    set('vs-you-fill', pm ? ph / pm : 0);
    set('vs-foe-fill', em ? eh / em : 0);
    const n1 = document.getElementById('vs-you-n'), n2 = document.getElementById('vs-foe-n'), c = document.getElementById('vs-clock');
    if (n1) n1.textContent = pn;
    if (n2) n2.textContent = en + (this.missionSys.wavesPending() ? '+' : '');
    if (c) {
      const o = this.mission.objective;
      const left = o.type === 'survive' ? o.seconds : this.mission.timeLimit;   // count down when the clock decides
      c.textContent = left ? fmt(Math.max(0, left - this.missionSys.time)) : fmt(this.missionSys.time);
    }
  }
}
