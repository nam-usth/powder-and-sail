// ── META LAYER TESTS (AW-S02) ───────────────────────────────────
// Pure JS — runs in the browser runner AND in Node (`node test/node_meta.mjs`).
import { suite, test, assert, assertEqual } from './runner.js';
import { newProfile, migrate, loadProfile, saveProfile, makeStore } from '../frontend/src/Meta/Profile.js';
import { applyOffline, harborRates, harborCaps, offlineSeconds } from '../frontend/src/Meta/HarborEconomy.js';
import { canBuild, startBuild, tickRoster, repairQuote, startRepair, startSalvage, fleetCap, shipyardLevel, rush, scrapShip } from '../frontend/src/Meta/Shipyard.js';
import { missionState, applyBattleResult, makePatrol, starsFor, rankIndex, getMission } from '../frontend/src/Meta/Campaign.js';
import { parseMode, modeUrl } from '../frontend/src/Meta/ModeRouter.js';
import { OFFLINE_MAX_SEC, HULLS, PROFILE_KEY, HARBOR_ECONOMY } from '../frontend/src/data/harbor.js';
/** Harbor clock (balance pass): harbor income = Open War rates × rateMult. */
const RM = HARBOR_ECONOMY.rateMult;
import { MISSIONS } from '../frontend/src/data/campaign.js';
import { CANNON_BY_ID, canMountCannon } from '../frontend/src/data/cannons.js';
import { resolveHull } from '../frontend/src/Meta/Campaign.js';
import { WOOD_RATE, GOLD_RATE, WOOD_CAP } from '../frontend/src/data/constants.js';

const T0 = 1_700_000_000_000;
const memBackend = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

suite('Meta · Profile', () => {
  test('new profile has starter fleet, buildings and resources', () => {
    const p = newProfile(T0);
    assertEqual(p.fleet.length, 3);
    assert(p.fleet.every(s => s.status === 'ready' && HULLS[s.hullId]), 'starter ships ready');
    assert(p.harbor.buildings.some(b => b.buildingId === 'shipyard'), 'starter shipyard');
    assert(p.res.wood > 0 && p.res.gold > 0, 'starting stock');
  });
  test('save → load round-trips', () => {
    const st = makeStore(memBackend());
    const p = newProfile(T0); p.res.wood = 777; p.renown = 33;
    saveProfile(st, p, T0 + 5);
    const q = loadProfile(st, T0 + 10);
    assertEqual(q.res.wood, 777); assertEqual(q.renown, 33); assertEqual(q.lastSeen, T0 + 5);
  });
  test('corrupt save → fresh profile, backup kept', () => {
    const be = memBackend(); const st = makeStore(be);
    be.setItem(PROFILE_KEY, '{not json');
    const p = loadProfile(st, T0);
    assertEqual(p.fleet.length, 3);
    assertEqual(be.getItem(PROFILE_KEY + '_bad'), '{not json');
  });
  test('migrate fills missing fields and drops unknown hulls', () => {
    const p = migrate({ res: { wood: 5 }, fleet: [{ hullId: 'nope' }, { hullId: 'sloop', nm: 'X' }] }, T0);
    assertEqual(p.res.wood, 5); assert(p.res.gold > 0, 'gold default');
    assertEqual(p.fleet.length, 1); assertEqual(p.fleet[0].nm, 'X');
    assert(Array.isArray(p.harbor.buildings), 'buildings array');
  });
  test('storage that throws degrades to memory', () => {
    const st = makeStore({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
    const p = loadProfile(st, T0);
    saveProfile(st, p, T0);
    assertEqual(st.persistent, false);
  });
});

suite('Meta · Harbor offline economy', () => {
  test('offline seconds clamp to [0, max]', () => {
    const p = newProfile(T0);
    assertEqual(offlineSeconds(p, T0 - 5000), 0);
    assertEqual(offlineSeconds(p, T0 + 10_000), 10);
    assertEqual(offlineSeconds(p, T0 + 1e12), OFFLINE_MAX_SEC);
  });
  test('offline income = rate × elapsed, clamped to cap', () => {
    const p = newProfile(T0);
    p.harbor.buildings = [{ buildingId: 'lumber_mill', level: 1, state: 'active' }];
    p.res = { wood: 0, gold: 0 };
    const r = harborRates(p.harbor.buildings);
    assertEqual(r.wood, (WOOD_RATE + 2) * RM); assertEqual(r.gold, GOLD_RATE * RM);
    const rep = applyOffline(p, T0 + 10_000);
    assertEqual(Math.round(rep.wood), Math.round((WOOD_RATE + 2) * RM * 10));
    const p2 = newProfile(T0); p2.res.wood = 0;
    applyOffline(p2, T0 + 3600_000);
    assertEqual(p2.res.wood, harborCaps(p2.harbor.buildings).wood);
    assertEqual(harborCaps([]).wood, WOOD_CAP);
  });
  test('construction under way does not produce, but its timer advances', () => {
    const p = newProfile(T0);
    p.harbor.buildings = [{ buildingId: 'lumber_mill', level: 1, state: 'building', buildTimer: 30 }];
    assertEqual(harborRates(p.harbor.buildings).wood, WOOD_RATE * RM);
    applyOffline(p, T0 + 20_000);
    assertEqual(Math.round(p.harbor.buildings[0].buildTimer), 10);
  });
});

suite('Meta · Shipyard', () => {
  test('build: cost paid, timer, then ready', () => {
    const p = newProfile(T0); p.res = { wood: 1000, gold: 1000 };
    const s = startBuild(p, 'sloop', T0);
    assert(s && s.status === 'building', 'building');
    assertEqual(p.res.wood, 1000 - HULLS.sloop.cost.wood);
    assertEqual(tickRoster(p, T0 + 1000).length, 0);
    assertEqual(tickRoster(p, T0 + HULLS.sloop.buildSec * 1000).length, 1);
    assertEqual(s.status, 'ready');
  });
  test('shipyard level gates hulls; one slipway per shipyard', () => {
    const p = newProfile(T0); p.res = { wood: 9999, gold: 9999 };
    assertEqual(shipyardLevel(p), 1);
    assertEqual(canBuild(p, 'galleon').reason, 'shipyard_level');
    startBuild(p, 'sloop', T0);
    assertEqual(canBuild(p, 'schooner').reason, 'slipway_busy');
    p.harbor.buildings = p.harbor.buildings.filter(b => b.buildingId !== 'shipyard');
    assertEqual(canBuild(p, 'sloop').reason, 'no_shipyard');
  });
  test('repair cost scales with damage; salvage turns a wreck into a ship', () => {
    const p = newProfile(T0); p.res = { wood: 9999, gold: 9999 };
    const s = p.fleet[0]; s.hpFrac = 0.5;
    const q = repairQuote(s);
    assert(q.gold > 0 && q.sec > 0, 'quote');
    assert(startRepair(p, s.uid, T0), 'repair started');
    tickRoster(p, T0 + q.sec * 1000);
    assertEqual(s.hpFrac, 1);
    const w = p.fleet[1]; w.status = 'wreck'; w.hpFrac = 0;
    assert(startSalvage(p, w.uid, T0), 'salvage');
    assertEqual(w.status, 'repairing');
    assert(rush(p, w.uid, T0), 'rush');
    assertEqual(w.status, 'ready');
  });
  test('fleet cap grows with barracks; last ship cannot be scrapped', () => {
    const p = newProfile(T0);
    const base = fleetCap(p);
    p.harbor.buildings.push({ buildingId: 'barracks', level: 3, state: 'active' });
    assert(fleetCap(p) > base, 'barracks raise cap');
    p.fleet = [p.fleet[0]];
    assertEqual(scrapShip(p, p.fleet[0].uid), false);
  });
});

suite('Meta · Campaign', () => {
  test('first mission open, others locked until requirements', () => {
    const p = newProfile(T0);
    assertEqual(missionState(p, MISSIONS[0]), 'open');
    assertEqual(missionState(p, getMission('reef_2')), 'locked');
    p.campaign.won.reef_1 = true;
    assertEqual(missionState(p, getMission('reef_2')), 'open');
    p.campaign.won.reef_2 = true;
    assertEqual(missionState(p, getMission('straits_1')), 'locked', 'needs renown');
    p.renown = 30;
    assertEqual(missionState(p, getMission('straits_1')), 'open');
  });
  test('win banks reward + first clear + plunder, wrecks the sunk ship', () => {
    const p = newProfile(T0); p.res = { wood: 0, gold: 0 };
    const m = getMission('reef_1');
    const [a, b] = p.fleet;
    const sum = applyBattleResult(p, m, {
      won: true, timeSec: 100, sunkEnemyClasses: ['light', 'light'], fortsDestroyed: 0,
      ships: [{ uid: a.uid, hpFrac: .4, sunk: false, sinks: 2 }, { uid: b.uid, hpFrac: 0, sunk: true, sinks: 0 }],
    });
    assert(sum.firstClear, 'first clear');
    assertEqual(sum.stars, 1, 'lost a ship → 1 star');
    assertEqual(p.res.wood, m.reward.wood + m.firstClear.wood + 60);
    assertEqual(b.status, 'wreck'); assertEqual(a.hpFrac, .4);
    assert(p.campaign.won.reef_1, 'won recorded');
    assert(p.renown >= m.renown, 'renown');
    const again = applyBattleResult(p, m, { won: true, timeSec: 100, sunkEnemyClasses: [], ships: [] });
    assertEqual(again.firstClear, false);
  });
  test('defeat keeps half the plunder only', () => {
    const p = newProfile(T0); p.res = { wood: 0, gold: 0 };
    const s = applyBattleResult(p, getMission('reef_1'), { won: false, timeSec: 50, sunkEnemyClasses: ['light'], ships: [] });
    assertEqual(s.reward.wood, 15); assertEqual(p.campaign.won.reef_1, undefined);
  });
  test('stars: ★★★ when no loss and under par', () => {
    const m = { parTime: 100 };
    assertEqual(starsFor({ won: true, lost: [], timeSec: 90 }, m), 3);
    assertEqual(starsFor({ won: true, lost: [], timeSec: 190 }, m), 2);
    assertEqual(starsFor({ won: false, lost: [], timeSec: 10 }, m), 0);
  });
  test('patrol is deterministic per seed and scales with the fleet that sails', () => {
    const p = newProfile(T0);
    const a = makePatrol(p, 42), b = makePatrol(p, 42);
    assertEqual(JSON.stringify(a), JSON.stringify(b));
    const strength = m => m.enemies.reduce((t, e) => t + (e.hp || 0) + (e.hull ? 1 : 0), 0) + m.enemies.length * 100;
    // a much stronger fleet gets a patrol at least as big (balance: no death spiral, no free wins)
    p.fleet.push(...['galleon', 'galleon', 'frigate'].map(h => ({ ...p.fleet[0], uid: 'x' + h + Math.random(), hullId: h })));
    assert(strength(makePatrol(p, 42)) >= strength(a), 'bigger fleet → no weaker patrol');
    assertEqual(rankIndex(400), 4);
  });
  test('every mission is well formed', () => {
    const ids = new Set(MISSIONS.map(m => m.id));
    MISSIONS.forEach(m => {
      assert(m.islands.every(i => i.id && i.shape), m.id + ' islands');
      assert((m.requires || []).every(r => ids.has(r)), m.id + ' requires');
      if (m.objective.type === 'destroy_forts') assert(m.islands.some(i => i.own === 'enemy'), m.id + ' has a fort');
      if (m.objective.type === 'sink_all') assert(m.enemies.length > 0, m.id + ' has enemies');
      if (m.objective.type === 'capture') assert(m.objective.islands.every(id => m.islands.some(i => i.id === id)), m.id + ' capture ids');
    });
  });
});

suite('Meta · Cannon tiers', () => {
  test('a hull mounts cannons up to its own tier; tierless ships are unrestricted', () => {
    const royal = CANNON_BY_ID.get('cannon_royal'), swivel = CANNON_BY_ID.get('swivel');
    assertEqual(royal.tier, 5);
    assert(!canMountCannon(royal, { hullTier: 2 }), 'tier II hull cannot take a tier V gun');
    assert(canMountCannon(royal, { hullTier: 5 }), 'tier V hull can');
    assert(canMountCannon(swivel, { hullTier: 1 }), 'tier I gun on tier I hull');
    assert(canMountCannon(royal, {}), 'Open War ships have no hull tier');
  });
  test('every mission enemy and starter loadout respects the tier rule', () => {
    const bad = [];
    for (const m of MISSIONS) for (const e of [...m.enemies, ...((m.objective.waves || []).flatMap(w => w.ships))]) {
      const h = resolveHull(e.hull);
      for (const id of Object.values(e.loadout || {})) {
        const cn = CANNON_BY_ID.get(id);
        if (!cn || !canMountCannon(cn, { hullTier: h.tier })) bad.push(`${m.id}:${h.id}:${id}`);
      }
    }
    assertEqual(bad.join(','), '');
  });
});

suite('Meta · ModeRouter', () => {
  test('default mode is harbor; unknown falls back', () => {
    assertEqual(parseMode('').mode, 'harbor');
    assertEqual(parseMode('?mode=zzz').mode, 'harbor');
    assertEqual(parseMode('?mode=battle&mission=reef_1').mission, 'reef_1');
    assertEqual(modeUrl('battle', { mission: 'x' }), '?mode=battle&mission=x');
  });
});
