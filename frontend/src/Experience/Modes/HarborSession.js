// ── HARBOR SESSION (AW-S04) ───────────────────────────────────────
// Glue between the persistent profile (Meta/) and a GameApp running in
// mode 'harbor'. Owns: offline catch-up, building restore/save, moored
// roster ships, the Shipyard / World Chart UI, and leaving for battle.

import { ISLAND_DEFS }              from '../../data/maps.js';
import { HULLS, SAVE_INTERVAL_SEC, OFFLINE_REPORT_MIN_SEC, MOORING_REGEN_FRAC, HARBOR_ECONOMY } from '../../data/harbor.js';
import { TECH_TREE }                from '../../data/upgrades.js';
import { saveProfile }              from '../../Meta/Profile.js';
import { applyOffline }             from '../../Meta/HarborEconomy.js';
import { tickRoster }               from '../../Meta/Shipyard.js';
import { abandonPendingBattle }     from '../../Meta/Campaign.js';
import { gotoMode }                 from '../../Meta/ModeRouter.js';
import { serializeBuildings, restoreBuildings } from './HarborPersistence.js';
import { shipSpec }                 from './shipSpec.js';
import { toasts }                   from '../UI/ToastQueue.js';
import { music }                    from '../Utils/MusicDirector.js';
import { T }                        from '../../i18n.js';

// AW: the home port is the big HARBOR island wrapped round a bay (World/IslandEntity)
export const HOME_DEF = { ...ISLAND_DEFS[0], x: 0, z: 0, r: 30, shape: 'HARBOR', nm: 'Home Port' };

export class HarborSession {
  /**
   * @param {object} profile live profile (Meta/Profile)
   * @param {object} store   makeStore() wrapper
   * @param {object} [deps]  { now, location, ui } — injected for tests
   */
  constructor(profile, store, deps = {}) {
    this.profile  = profile;
    this.store    = store;
    this.now      = deps.now || (() => Date.now());
    this.location = deps.location || (typeof location !== 'undefined' ? location : null);
    this.uiLoader = deps.ui || (() => import('../../Meta/UI/index.js'));
    this.game     = null;
    this._saveT   = 0;
    this._rosterT = 0;
    this._leaving = false;
  }

  /** Offline catch-up, then the GameApp options for this harbor. */
  prepare() {
    const p = this.profile, now = this.now();
    if (abandonPendingBattle(p)) this._abandoned = true;
    this.offline = applyOffline(p, now);
    this._readyOnBoot = tickRoster(p, now);
    return {
      mode: 'harbor',
      islands: [HOME_DEF],
      playerFleet: this._afloat().map((s, i, arr) => this._moored(s, i, arr.length)),
      session: this,
    };
  }

  _afloat() { return this.profile.fleet.filter(s => s.status === 'ready'); }

  /** Mooring slot i of n: a ring round the harbor, bows along the tangent. */
  _moored(rs, i, n) {
    const b = this.game?._islands?.[0]?.berths;
    if (b && b.length) { const k = b[i % b.length]; return shipSpec(rs, k.x, k.z, k.angle); }
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2 + 0.35;
    const R = HOME_DEF.r + 11 + (i % 2) * 3;
    return shipSpec(rs, Math.cos(a) * R, Math.sin(a) * R, a + Math.PI / 2);
  }

  /** Called by GameApp once systems + UI exist. */
  attach(game) {
    this.game = game;
    const st = game._state, p = this.profile;
    st.econRateMult = HARBOR_ECONOMY.rateMult;      // harbor clock (EconomySystem / HUD read it)
    const home = game._islands[0];
    st.resWood = p.res.wood;
    st.resGold = p.res.gold;

    const fresh = !!p.harbor.fresh;
    const { dropped } = restoreBuildings(game, home, p.harbor.buildings, { relocate: fresh });
    p.harbor.fresh = false;
    dropped.forEach(b => {                       // GDD edge case: 50 % refund
      const d = (window._ALL_DEFS || []).find(x => x.id === b.buildingId);
      if (d?.cost) { st.resWood += Math.floor((d.cost.wood || 0) / 2); st.resGold += Math.floor((d.cost.gold || 0) / 2); }
    });
    restoreResearch(st, p.harbor.researched);
    game._recalcFortStats(home);
    game._overlay.rebuildStaticRings(game._islands);
    game._aura.rebuild();

    // Berths on the harbor piers (big HARBOR island) — re-moor the fleet there.
    if (home.berths?.length) st.playerShips.forEach((ship, i) => {
      const k = home.berths[i % home.berths.length];
      ship.x = k.x; ship.z = k.z; ship.angle = k.angle; ship.speed = 0;
      ship.mesh?.position.set(k.x, ship.mesh.position.y, k.z);
    });

    st.camDist = 58;
    game._cam.jumpTo(home.x, home.z + 6);
    st.selectedIslandId = home.def.id;

    music.play('harbor'); music.ambience('harbor');
    this._flush();
    this._bindLifecycle();
    this._mountUI();
  }

  // ── per-frame (called from GameApp._update) ─────────────────
  update(dt) {
    if (!this.game || this._leaving) return;
    // Moorings slowly mend hulls (on top of the repair aura).
    for (const s of this.game._state.playerShips) {
      if (s.alive && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * MOORING_REGEN_FRAC * dt);
    }
    this._rosterT += dt;
    if (this._rosterT >= 1) {
      this._rosterT = 0;
      const done = tickRoster(this.profile, this.now());
      if (done.length) {
        done.forEach(s => toasts.show(T.shipReady ? T.shipReady(s.nm) : `⚓ ${s.nm} is ready`, 2600, 'good'));
        this.game._vfx.playSound?.('bell');
        this.reconcileShips();
        this.ui?.shipyard?.refresh?.();
      }
    }
    this._saveT += dt;
    if (this._saveT >= SAVE_INTERVAL_SEC) { this._saveT = 0; this._flush(); }
    this.ui?.bar?.update?.();
  }

  // ── state sync ──────────────────────────────────────────────
  /** Live game → profile. */
  syncToProfile() {
    const g = this.game; if (!g) return this.profile;
    const st = g._state, p = this.profile;
    p.res.wood = Math.floor(st.resWood);
    p.res.gold = Math.floor(st.resGold);
    p.harbor.buildings = serializeBuildings(st, g._islands[0]);
    p.harbor.researched = [...st.researched];
    st.playerShips.forEach((ship, idx) => {
      const rs = p.fleet.find(x => x.uid === ship.uid);
      if (!rs || !ship.alive) return;
      rs.hpFrac = Math.max(0.05, Math.min(1, ship.hp / ship.maxHp));
      rs.loadout = { ...ship.loadout };
      rs.upgrades = { ...(st.shipUpgrades[idx] || rs.upgrades) };
    });
    return p;
  }

  /** Profile → live game (after the UI spent resources / changed the roster). */
  syncFromProfile() {
    const st = this.game?._state; if (!st) return;
    st.resWood = this.profile.res.wood;
    st.resGold = this.profile.res.gold;
    this.reconcileShips();
  }

  /** Make the moored ships match the roster's afloat ships. */
  reconcileShips() {
    const g = this.game, st = g._state;
    const afloat = this._afloat();
    const want = new Set(afloat.map(s => s.uid));
    [...st.playerShips].forEach(ship => { if (!want.has(ship.uid)) g.removePlayerShip(ship); });
    const have = new Set(st.playerShips.map(s => s.uid));
    afloat.forEach((rs, i) => {
      if (have.has(rs.uid)) return;
      const spec = this._moored(rs, i, afloat.length);
      g.spawnPlayerShip(spec);
    });
  }

  _flush() {
    this.syncToProfile();
    saveProfile(this.store, this.profile, this.now());
  }

  _bindLifecycle() {
    const flush = () => { if (!this._leaving) this._flush(); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  // ── leaving ─────────────────────────────────────────────────
  setSail({ missionId, shipUids, seed }) {
    if (!shipUids?.length) return;
    this._flush();
    this.profile.battle = { missionId, shipUids: [...shipUids], seed: seed ?? null, startedAt: this.now(), started: false };
    saveProfile(this.store, this.profile, this.now());
    this._leaving = true;
    this.game._vfx.playSound?.('set_sail');
    this._transition(() => gotoMode(this.location, 'battle', { mission: missionId }));
  }

  openWar() {
    this._flush();
    this._leaving = true;
    this._transition(() => gotoMode(this.location, 'skirmish'));
  }

  _transition(go) {
    const scr = document.getElementById('loading-screen');
    if (scr) { scr.style.display = ''; scr.style.opacity = '1'; }
    setTimeout(go, 350);
  }

  // ── UI ──────────────────────────────────────────────────────
  /** ctx object for the Meta UI modules (contract in design/gdd/campaign-meta.md). */
  uiCtx() {
    return {
      getProfile: () => this.syncToProfile(),
      save: () => saveProfile(this.store, this.profile, this.now()),
      now: this.now,
      toast: (m, type) => toasts.show(m, 2200, type),
      sfx: n => this.game?._vfx?.playSound?.(n),
      onSetSail: o => this.setSail(o),
      onOpenWar: () => this.openWar(),
      onReturn: () => {},
      onProfileChanged: () => { this.syncFromProfile(); this._flush(); },
    };
  }

  async _mountUI() {
    let mod;
    try { mod = await this.uiLoader(); }
    catch (e) { console.warn('[Harbor] meta UI unavailable', e); return; }
    const ctx = this.uiCtx();
    this.ui = mod.mountHarborUI(ctx);
    // World Chart gets its own music; back to the harbor theme when it closes
    const ch = this.ui?.chart;
    if (ch) for (const fn of ['open', 'close']) {
      const orig = ch[fn]?.bind(ch);
      if (orig) ch[fn] = (...a) => { const r = orig(...a); music.play(ch.isOpen?.() ? 'chart' : 'harbor'); return r; };
    }
    if (this.offline.seconds >= OFFLINE_REPORT_MIN_SEC) mod.showOfflineReport?.(this.offline);
    if (this._abandoned) toasts.show(T.battleAbandoned || 'Your last battle was abandoned — the fleet returned to port.', 4200, 'info');
    const last = this.profile.lastResult;
    if (last && !last.seen) { last.seen = true; this._flush(); }
  }
}

/** Re-apply saved research (adds to the Set and runs each effect once). */
export function restoreResearch(st, ids = []) {
  for (const id of ids) {
    if (st.researched.has(id)) continue;
    const tech = TECH_TREE.find(t => t.id === id);
    if (!tech) continue;
    st.researched.add(id);
    try { tech.effect?.(); } catch (e) { console.warn('[research restore]', id, e); }
  }
}
