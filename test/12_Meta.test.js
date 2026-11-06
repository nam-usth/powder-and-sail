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
import { CANNON_BY_ID, CANNONS, canMountCannon, isCannonKnown, cannonTechId, fallbackCannon, STARTER_CANNONS } from '../frontend/src/data/cannons.js';
import { TECH_TREE, techWithPrereqs } from '../frontend/src/data/upgrades.js';
import { defaultLoadout } from '../frontend/src/Meta/Profile.js';
import { salvageQuote, gunRepairGoldFull } from '../frontend/src/Meta/Shipyard.js';
import { REPAIR_GOLD_FULL, REPAIR_GOLD_PER_GUN_TIER } from '../frontend/src/data/harbor.js';
import { resolveHull } from '../frontend/src/Meta/Campaign.js';
import { WOOD_RATE, GOLD_RATE, WOOD_CAP } from '../frontend/src/data/constants.js';
import { harborBuildCost } from '../frontend/src/Meta/HarborEconomy.js';
import { fleetCapBreakdown, buildingRequirements, labLevel, buildBlockers } from '../frontend/src/Meta/Shipyard.js';
import { BUILDINGS } from '../frontend/src/data/buildings.js';
import { comebackRate } from '../frontend/src/Experience/Systems/Naval/CommanderSystem.js';
import { MissionSystem, enemyAi } from '../frontend/src/Experience/Systems/Match/MissionSystem.js';
import { fitDoctrine, fitDoctrineReport, applyDoctrineToRoster, applySailDoctrines, suggestDoctrines, groupFallbacks } from '../frontend/src/Meta/Doctrine.js';
import { DOCTRINES } from '../frontend/src/data/doctrines.js';
import { saveFitProfile, applyFitProfile, applySailFits, renameFitProfile, normalizeFitProfiles, fitChoiceSlot } from '../frontend/src/Meta/FitProfiles.js';
import { FIT_PROFILE_SLOTS } from '../frontend/src/data/harbor.js';

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

suite('Meta · Cannon research', () => {
  test('tier-I guns are known; every other cannon has a Gunnery tech at lab level = tier − 1', () => {
    assertEqual(STARTER_CANNONS.join(','), 'swivel,carronade,falconet');
    for (const cn of CANNONS) {
      const t = cannonTechId(cn.id);
      if (STARTER_CANNONS.includes(cn.id)) { assertEqual(t, null, cn.id); continue; }
      const tech = TECH_TREE.find(x => x.id === t);
      assert(tech && tech.br === 'Gunnery' && tech.cannon === cn.id, `tech for ${cn.id}`);
      assertEqual(tech.requiredLabLevel, cn.tier - 1, `${cn.id} lab level`);
      assert(tech.req.every(r => TECH_TREE.some(x => x.id === r)), `${cn.id} prereqs exist`);
      assert(typeof tech.effect === 'function', `${cn.id} effect is a no-op function`);
    }
    assertEqual(techWithPrereqs('gun_long24').join(','), 'gun_long9,gun_long12,gun_long24');
  });
  test('mount rule: hull tier AND research (when a known set is given); null = unrestricted', () => {
    const l9 = CANNON_BY_ID.get('long9');
    assert(canMountCannon(l9, { hullTier: 2 }), 'no known set → tier rule only (Open War, enemies)');
    assert(!canMountCannon(l9, { hullTier: 2 }, []), 'unresearched in harbor/battle');
    assert(canMountCannon(l9, { hullTier: 2 }, ['gun_long9']), 'researched (array)');
    assert(canMountCannon(l9, { hullTier: 2 }, new Set(['gun_long9'])), 'researched (Set)');
    assert(!canMountCannon(l9, { hullTier: 1 }, ['gun_long9']), 'still bound by hull tier');
    assert(isCannonKnown('falconet', []), 'starter gun always known');
    assertEqual(fallbackCannon('long24', id => isCannonKnown(id, ['gun_long9'])), 'long9');
    assertEqual(fallbackCannon('cannon_royal', id => isCannonKnown(id, [])), 'falconet');
  });
  test('fresh profile + new builds only carry known guns', () => {
    const p = newProfile(T0);
    const known = id => isCannonKnown(id, p.harbor.researched);
    assert(p.fleet.every(s => Object.values(s.loadout).every(id => !id || known(id))), 'starter fleet uses tier-I guns');
    p.res = { wood: 9999, gold: 9999 };
    p.harbor.buildings.find(b => b.buildingId === 'shipyard').level = 2;
    let s = startBuild(p, 'brig', T0);
    assert(Object.values(s.loadout).every(id => STARTER_CANNONS.includes(id)), 'unresearched → tier-I fit ' + JSON.stringify(s.loadout));
    p.harbor.researched.push('gun_demi_culv', 'gun_long9');
    p.fleet = p.fleet.filter(x => x !== s);
    s = startBuild(p, 'brig', T0);
    assertEqual(JSON.stringify(s.loadout), JSON.stringify(defaultLoadout('standard', 2)), 'researched → full default fit');
  });
  test('migrate: v1 saves keep their guns (techs granted); v2 saves lose unresearched guns', () => {
    const fleet = [{ hullId: 'man_o_war', loadout: { L: 'cannon_royal', R: 'long24', B: 'mortar2', S: 'swivel' } },
      { hullId: 'sloop', loadout: { L: 'cannon_royal', R: 'falconet' } }];          // royal on a sloop: illegal by tier, no grant
    const p = migrate({ v: 1, fleet: JSON.parse(JSON.stringify(fleet)), harbor: { researched: ['bal1'] } }, T0);
    assertEqual(JSON.stringify(p.fleet[0].loadout), JSON.stringify(fleet[0].loadout), 'man-o-war keeps every gun');
    for (const id of ['bal1', 'gun_cannon_royal', 'gun_demi_can', 'gun_demi_culv', 'gun_long24', 'gun_long12', 'gun_long9', 'gun_mortar2', 'gun_mortar1'])
      assert(p.harbor.researched.includes(id), 'granted ' + id);
    assertEqual(p.fleet[1].loadout.L, 'falconet', 'tier-illegal royal on a sloop falls back along its line to a tier-I gun');
    const q = migrate({ v: 2, fleet: JSON.parse(JSON.stringify(fleet)), harbor: { researched: [] } }, T0);
    assertEqual(q.harbor.researched.length, 0, 'no grants for v2 saves');
    assert(Object.values(q.fleet[0].loadout).every(id => STARTER_CANNONS.includes(id)), 'v2: unresearched guns replaced ' + JSON.stringify(q.fleet[0].loadout));
  });
  test('repair and salvage cost grow with the tier of the mounted guns', () => {
    const mk = loadout => ({ hullId: 'man_o_war', hpFrac: 0.5, status: 'ready', loadout });
    const lo = mk({ L: 'swivel', R: 'swivel', B: 'swivel', S: 'swivel' });
    const mid = mk({ L: 'demi_can', R: 'demi_can', B: 'mortar1', S: 'long12' });
    const hi = mk({ L: 'cannon_royal', R: 'long24', B: 'mortar2', S: 'long12' });
    const none = mk({ L: null, R: null, B: null, S: null });
    const g = s => repairQuote(s).gold;
    assert(g(none) < g(lo) && g(lo) < g(mid) && g(mid) < g(hi), `repair ${g(none)} < ${g(lo)} < ${g(mid)} < ${g(hi)}`);
    assertEqual(g(none), Math.ceil(0.5 * REPAIR_GOLD_FULL.heavy), 'hull base kept');
    assertEqual(gunRepairGoldFull(hi), 2 * REPAIR_GOLD_PER_GUN_TIER[5] + REPAIR_GOLD_PER_GUN_TIER[4] + REPAIR_GOLD_PER_GUN_TIER[3]);
    const rq = repairQuote(hi);
    assertEqual(rq.hullGold + rq.gunGold, rq.gold, 'breakdown adds up');
    assertEqual(repairQuote(mk({ ...hi.loadout })).sec, repairQuote(none).sec, 'repair time unchanged');
    const sq = s => salvageQuote({ ...s, status: 'wreck', hpFrac: 0 });
    assert(sq(hi).gold > sq(lo).gold && sq(hi).wood > sq(lo).wood, 'salvage grows with gun tier');
    assertEqual(sq(hi).hull.gold + sq(hi).guns.gold, sq(hi).gold, 'salvage breakdown adds up');
  });
});

suite('Meta · Gameplay pass (first two hours)', () => {
  test('migrate coerces numeric fields (QA-010)', () => {
    const p = migrate({ renown: '514', res: { wood: '120', gold: 'x' }, stats: { wins: '3' }, fleet: [{ hullId: 'sloop', hpFrac: '0.5' }] }, T0);
    assertEqual(p.renown, 514); p.renown += 4; assertEqual(p.renown, 518);
    assertEqual(p.res.wood, 120); assert(typeof p.res.gold === 'number', 'gold numeric');
    assertEqual(p.stats.wins, 3); assertEqual(p.fleet[0].hpFrac, 0.5);
  });
  test('harbor building cost: ×1 is the authored price, harbor mult rounds up to 5', () => {
    const mill = BUILDINGS.find(b => b.id === 'lumber_mill'), lab = BUILDINGS.find(b => b.id === 'research_lab');
    assertEqual(JSON.stringify(harborBuildCost(mill, 0, 1)), JSON.stringify({ wood: mill.cost.wood, gold: mill.cost.gold }));
    assertEqual(harborBuildCost(lab, 3, 1).wood, lab.cost.wood * 3, 'Open War upgrade = cost × level');
    const h = harborBuildCost(mill, 2, 2.5);
    assertEqual(h.wood, Math.ceil(mill.cost.wood * 2 * 2.5 / 5) * 5);
    assert(h.wood % 5 === 0 && h.wood >= mill.cost.wood * 2 * 2.5, 'rounded up to 5');
    assert(HARBOR_ECONOMY.buildCostMult >= 1, 'harbor knob present');
  });
  test('fleet cap breakdown names the hidden Barracks → Research Lab Lv 2 requirement', () => {
    const p = newProfile(T0);
    const fb = fleetCapBreakdown(p);
    assertEqual(fb.total, fleetCap(p));
    assertEqual(fb.base + fb.shipyard.bonus + fb.barracks.bonus, fb.total);
    const bar = fb.next.find(n => n.kind === 'build_barracks');
    assert(bar && !bar.ok, 'barracks blocked on a fresh harbor');
    assertEqual(bar.missing[0].kind, 'lab_level'); assertEqual(bar.missing[0].need, 2); assertEqual(bar.missing[0].have, 0);
    assert(fb.next.some(n => n.kind === 'upgrade_shipyard' && n.to === 2), 'shipyard upgrade listed');
    p.harbor.buildings.push({ buildingId: 'research_lab', level: 2, state: 'active' });
    assertEqual(labLevel(p), 2);
    assert(buildingRequirements(p, 'barracks').ok, 'lab 2 unlocks barracks');
    p.harbor.buildings.push({ buildingId: 'barracks', level: 1, state: 'active' });
    const fb2 = fleetCapBreakdown(p);
    assertEqual(fb2.total, fb.total + 1);
    assert(fb2.next.some(n => n.kind === 'upgrade_barracks' && n.to === 3), 'next barracks step is Lv 3');
  });
  test('buildBlockers lists every reason; canBuild keeps the first', () => {
    const p = newProfile(T0); p.res = { wood: 0, gold: 0 };
    const bl = buildBlockers(p, 'frigate').map(b => b.reason);
    assert(bl.includes('shipyard_level') && bl.includes('resources'), bl.join());
    const cb = canBuild(p, 'frigate');
    assertEqual(cb.reason, 'shipyard_level'); assertEqual(cb.have, 1);
    assert(cb.blockers.find(b => b.reason === 'resources').short.wood === HULLS.frigate.cost.wood, 'short amount');
  });
  test('patrol is size-aware: a lone ship meets one foe, never more than it can take', () => {
    const p = newProfile(T0); p.renown = 400;
    for (const hid of ['sloop', 'frigate', 'man_o_war']) {
      p.fleet = [{ ...p.fleet[0], uid: 'solo_' + hid, hullId: hid, status: 'ready' }];
      const m = makePatrol(p, 7, ['solo_' + hid]);
      assertEqual(m.enemies.length, 1, hid);
      assert(m.strength.enemy <= 0.31 * m.strength.fleet + 1, hid + ' budget');
    }
    p.fleet = ['sloop', 'brigantine'].map((h, i) => ({ ...p.fleet[0], uid: 'd' + i, hullId: h }));
    assert(makePatrol(p, 3, ['d0', 'd1']).enemies.length <= 2, 'pair meets ≤ 2');
  });
  test('Sea Battle comeback: faster cooldowns only while losing the exchange', () => {
    const sh = (hp, maxHp = 100, alive = true) => ({ hp, maxHp, alive });
    const st = { mode: 'battle', playerShips: [sh(100), sh(100)], enemyShips: [sh(100), sh(100)] };
    assertEqual(comebackRate(st), 1, 'even fight');
    st.playerShips = [sh(40), sh(0, 100, false)];
    assert(comebackRate(st) > 1, 'behind → rally');
    st.playerShips = [sh(80), sh(0, 100, false)];
    st.enemyShips = [sh(10), sh(0, 100, false)];
    assertEqual(comebackRate(st), 1, 'ahead again');
    st.enemyShips = [sh(100), sh(100)];
    assert(comebackRate(st) > 1, 'down a ship vs a fresh enemy');
    assertEqual(comebackRate({ warFront: 30, playerShips: [], enemyShips: [] }), 1.25, 'Open War rule unchanged');
    assertEqual(comebackRate({ warFront: 60 }), 1);
  });
  test('MissionSystem sink_target: win on the prize, lose when it escapes; time limit', () => {
    const bus = { on: () => () => {}, emit() {} };
    const mk = () => ({ playerShips: [{ alive: true, x: 0, z: 0 }], enemyShips: [] });
    const m = { objective: { type: 'sink_target' }, escape: { x: 100, z: 0 }, enemies: [{ hull: 'brigantine', x: 50, z: 0, prize: true, spdMult: 0.5 }] };
    const ai = enemyAi(m.enemies[0], m);
    assert(ai.prize && ai.spdMult === 0.5 && ai.post.x === 50, 'prize ai');
    let st = mk(); st.enemyShips = [{ alive: true, x: 50, z: 0, hp: 10, maxHp: 10, ai }];
    let ms = new MissionSystem(st, [], m, bus, () => null);
    assertEqual(ms.update(1), null);
    st.enemyShips[0].alive = false;
    assertEqual(ms.update(1).won, true);
    st = mk(); st.enemyShips = [{ alive: true, x: 99, z: 0, hp: 10, maxHp: 10, ai: { ...ai, escaping: true } }];
    ms = new MissionSystem(st, [], m, bus, () => null);
    const out = ms.update(1);
    assertEqual(out.won, false); assertEqual(out.reason, 'escaped'); assertEqual(ms.escaped.length, 1);
    st = mk(); st.enemyShips = [{ alive: true, x: 0, z: 0, hp: 1, maxHp: 1 }];
    ms = new MissionSystem(st, [], { objective: { type: 'sink_all' }, timeLimit: 5 }, bus, () => null);
    assert(ms.progress().some(l => l.key === 'time'), 'time line');
    assertEqual(ms.update(6).reason, 'time');
    assertEqual(enemyAi({ hull: 'sloop', x: 1, z: 2 }, {}), undefined, 'plain ships keep the wolfpack');
  });
  test('every mission objective is complete (prizes, escape zones, time limits)', () => {
    const types = new Set(['sink_all', 'destroy_forts', 'survive', 'capture', 'sink_target']);
    for (const m of MISSIONS) {
      assert(types.has(m.objective.type), m.id + ' objective type');
      const all = [...m.enemies, ...((m.objective.waves || []).flatMap(w => w.ships))];
      if (m.objective.type === 'sink_target') {
        assert(all.some(e => e.prize), m.id + ' has a prize');
        assert(m.escape, m.id + ' has an escape zone');
      }
      if (m.timeLimit) assert(m.timeLimit > (m.parTime || 0), m.id + ' time limit above par');
      for (const e of all) if (e.ai?.tactic) assert(['engage', 'kite', 'guard', 'hold', 'patrol'].includes(e.ai.tactic), m.id + ' tactic');
    }
  });
});

suite('Meta · Fleet doctrines', () => {
  const ALL_GUNS = CANNONS.map(c => cannonTechId(c.id)).filter(Boolean);
  test('every doctrine fits every hull class and tier with legal guns (tier + research)', () => {
    for (const d of DOCTRINES) for (const h of Object.values(HULLS)) for (const known of [[], ALL_GUNS, ['gun_long9']]) {
      const lo = fitDoctrine(d.id, { hull: h.hull, tier: h.tier }, known);
      const slots = Object.keys(lo);
      assertEqual(slots.length, { light: 2, standard: 3, heavy: 4 }[h.hull], `${d.id} ${h.id} slots`);
      for (const sl of slots) assert(canMountCannon(CANNON_BY_ID.get(lo[sl]), { hullTier: h.tier }, known), `${d.id} ${h.id} ${sl}=${lo[sl]}`);
    }
  });
  test('fitDoctrine picks the best researched gun allowed by tier, else falls back down the line', () => {
    const war = { hull: 'heavy', tier: 5 };
    assertEqual(fitDoctrine('antiheavy', war, ALL_GUNS).L, 'cannon_royal', 'tier V + researched → Cannon Royal');
    assertEqual(fitDoctrine('antiheavy', { hull: 'heavy', tier: 3 }, ALL_GUNS).L, 'demi_can', 'tier III hull caps at demi-cannon');
    const r = fitDoctrineReport('longrange', { hull: 'standard', tier: 3 }, ['gun_long9']);
    assertEqual(r.loadout.B, 'long9', 'Long 12 unresearched → Long 9');
    assert(r.fallbacks.some(f => f.slot === 'B' && f.want === 'long12' && f.got === 'long9'), 'fallback reported');
    const none = fitDoctrineReport('siege', war, []);
    assert(Object.values(none.loadout).every(id => STARTER_CANNONS.includes(id)), 'nothing researched → tier-I guns ' + JSON.stringify(none.loadout));
    assertEqual(fitDoctrineReport('siege', war, ALL_GUNS).fallbacks.length, 0, 'fully researched → no fallbacks');
    assertEqual(fitDoctrine('nope', war, ALL_GUNS), null, 'unknown doctrine → null');
    assertEqual(groupFallbacks(none.fallbacks)[0].n >= 1, true, 'grouped');
  });
  test('Set Sail doctrines change only the chosen ships; keep / unknown leave guns alone; choice is remembered', () => {
    const p = newProfile(T0);
    p.harbor.researched = [...ALL_GUNS];
    const [a, b, c] = p.fleet;
    const before = s => JSON.stringify(s.loadout);
    const bB = before(b), bC = before(c);
    b.doctrine = 'siege';
    const r = applySailDoctrines(p, { [a.uid]: 'antilight', [b.uid]: 'keep', [c.uid]: 'no_such_doctrine' });
    assertEqual(r.ships, 1, 'one ship refit');
    assertEqual(JSON.stringify(a.loadout), JSON.stringify(fitDoctrine('antilight', { hull: HULLS[a.hullId].hull, tier: HULLS[a.hullId].tier }, ALL_GUNS)));
    assertEqual(a.doctrine, 'antilight', 'remembered');
    assertEqual(before(b), bB, 'keep → guns unchanged'); assertEqual(b.doctrine, undefined, 'keep clears the remembered doctrine');
    assertEqual(before(c), bC, 'unknown → unchanged'); assertEqual(c.doctrine, undefined);
    const w = applyDoctrineToRoster(p, 'crippler');
    assertEqual(w.ships, 3, 'whole fleet');
    assert(p.fleet.every(s => s.doctrine === 'crippler'), 'whole fleet remembered');
  });
  test('briefing hint reads the mission: forts → siege, prize → crippler/long range, heavies → anti-heavy', () => {
    const ids = m => suggestDoctrines(m).map(x => x.id);
    assert(ids({ objective: { type: 'destroy_forts' }, islands: [{ own: 'enemy' }], enemies: [] }).includes('siege'));
    assert(ids({ objective: { type: 'sink_target' }, enemies: [{ hull: 'brigantine' }] }).includes('crippler'));
    assert(ids({ objective: { type: 'sink_all' }, enemies: [{ hull: 'galleon' }, { hull: 'brig' }] }).includes('antiheavy'));
    assertEqual(ids({ objective: { type: 'sink_all' }, enemies: [{ hull: 'sloop' }, { hull: 'cutter' }] })[0], 'antilight');
    assertEqual(ids({ objective: { type: 'sink_all' }, enemies: [{ hull: 'brig' }] })[0], 'broadside', 'no special threat → line of battle');
    for (const m of MISSIONS) assert(suggestDoctrines(m).length >= 1, m.id);
  });
});

suite('Meta · Fleet fit profiles', () => {
  const ALL_GUNS = CANNONS.map(c => cannonTechId(c.id)).filter(Boolean);
  const lo = s => JSON.stringify(s.loadout);
  test('save → change guns → load restores every saved ship (round-trip, persists through save/load)', () => {
    const p = newProfile(T0);
    p.harbor.researched = [...ALL_GUNS];
    const [a, b, c] = p.fleet;
    a.loadout = { L: 'demi_culv', R: 'long9', B: 'chain_shot' };
    b.doctrine = 'antilight';
    const snap = p.fleet.map(lo);
    assertEqual(saveFitProfile(p, 1, null, T0 + 5), 3, 'three ships saved');
    assertEqual(p.fitProfiles[1].savedAt, T0 + 5);
    applyDoctrineToRoster(p, 'longrange');
    assert(p.fleet.some((s, i) => lo(s) !== snap[i]), 'doctrine changed something');
    // through storage: the slot survives a save/load
    const store = makeStore(memBackend());
    saveProfile(store, p, T0); const q = loadProfile(store, T0);
    const r = applyFitProfile(q, 1);
    assertEqual(q.fleet.map(lo).join(), snap.join(), 'every gun back');
    assertEqual(r.loaded, 3); assertEqual(r.skipped.length, 0); assertEqual(r.fellBack.length, 0);
    assertEqual(q.fleet[1].doctrine, 'antilight', 'saved doctrine label restored when nothing fell back');
    assertEqual(q.fleet[0].doctrine, undefined, 'ship saved without a doctrine loses the longrange label');
    assertEqual(applyFitProfile(q, 1).changed.length, 0, 'loading again changes nothing');
    assertEqual(renameFitProfile(q, 0, '  <b>Fort busters & co, the long name</b> '), '<b>Fort busters & co', 'trimmed to 20 chars (escaped on render)');
    assertEqual(renameFitProfile(q, 0, '   '), 'Profile I', 'blank → default');
  });
  test('load re-validates hull tier + research and falls back down the line', () => {
    const p = newProfile(T0);
    p.harbor.researched = [...ALL_GUNS];
    const a = p.fleet[0];                                   // brigantine (tier II, standard L/R/B)
    a.loadout = { L: 'demi_culv', R: 'demi_culv', B: 'long9' };
    saveFitProfile(p, 0);
    // tamper: an over-tier gun and an unresearched one in the saved fit
    p.fitProfiles[0].fits[a.uid] = { L: 'cannon_royal', R: 'demi_culv', B: 'long9', S: 'long12' };
    const r = applyFitProfile(p, 0, null, ['gun_demi_culv']);
    assert(canMountCannon(CANNON_BY_ID.get(a.loadout.L), { hullTier: 2 }), 'L legal for tier II: ' + a.loadout.L);
    assertEqual(a.loadout.B, 'swivel', 'Long 9 unresearched → Swivel');
    assertEqual('S' in a.loadout, false, 'slot the hull lacks is dropped');
    assert(r.fellBack.some(f => f.uid === a.uid && f.slot === 'B' && f.want === 'long9' && f.got === 'swivel'), 'B fallback reported');
    assert(r.fellBack.some(f => f.slot === 'L' && f.want === 'cannon_royal'), 'over-tier gun reported');
    for (const s of p.fleet) for (const id of Object.values(s.loadout)) if (id) assert(canMountCannon(CANNON_BY_ID.get(id), { hullTier: HULLS[s.hullId].tier }, ['gun_demi_culv']), `legal after load: ${s.hullId} ${id}`);
    // a rebuilt hull under the same uid (sloop → brigantine): missing slot keeps the current gun
    const sl = p.fleet[1]; sl.hullId = 'brigantine'; sl.loadout = { L: 'falconet', R: 'falconet', B: 'swivel' };
    p.harbor.researched = [...ALL_GUNS];
    applyFitProfile(p, 0, [sl.uid]);
    assertEqual(sl.loadout.B, 'swivel', 'slot not in the saved (sloop) fit keeps its gun');
  });
  test('ships missing from a profile are skipped; wrecks ignored; subset save merges', () => {
    const p = newProfile(T0);
    p.harbor.researched = [...ALL_GUNS];
    const [a, b, c] = p.fleet;
    saveFitProfile(p, 0, [a.uid]);
    assertEqual(Object.keys(p.fitProfiles[0].fits).join(), a.uid, 'subset saved');
    saveFitProfile(p, 0, [b.uid]);
    assertEqual(Object.keys(p.fitProfiles[0].fits).length, 2, 'subset save merges');
    c.status = 'wreck';
    const cB = lo(c); b.loadout = { L: 'carronade', R: 'carronade' };
    a.loadout = { L: 'swivel', R: 'swivel', B: 'swivel' };
    const r = applyFitProfile(p, 0);
    assertEqual(r.changed.length, 2); assertEqual(r.skipped.length, 0, 'wreck neither changed nor skipped');
    assertEqual(lo(c), cB);
    const d = newProfile(T0).fleet[2]; d.uid = 'new_ship'; p.fleet.push(d); c.status = 'ready';
    const r2 = applyFitProfile(p, 0);
    assertEqual(r2.skipped.sort().join(), [c.uid, 'new_ship'].sort().join(), 'ships not in the profile reported as skipped');
    assertEqual(applyFitProfile(p, 1).loaded, 0, 'empty slot loads nothing');
  });
  test('migrate gives older saves two empty, well-formed slots', () => {
    const raw = JSON.parse(JSON.stringify(newProfile(T0))); delete raw.fitProfiles;
    const m = migrate(raw, T0);
    assertEqual(m.fitProfiles.length, FIT_PROFILE_SLOTS);
    assertEqual(m.fitProfiles.map(f => f.name).join(), 'Profile I,Profile II');
    assert(m.fitProfiles.every(f => !Object.keys(f.fits).length && f.savedAt === 0), 'empty');
    const junk = normalizeFitProfiles([{ name: 42, fits: { x: { L: 'swivel', R: 5 }, y: 'bad' } }, null, { name: 'extra' }]);
    assertEqual(junk.length, 2, 'extra slots dropped');
    assertEqual(JSON.stringify(junk[0].fits), JSON.stringify({ x: { L: 'swivel' } }), 'bad entries dropped');
  });
  test('Set Sail with fit:N changes only the chosen ships and remembers the choice', () => {
    const p = newProfile(T0);
    p.harbor.researched = [...ALL_GUNS];
    const [a, b, c] = p.fleet;
    a.loadout = { L: 'demi_culv', R: 'demi_culv', B: 'chain_shot' };
    b.loadout = { L: 'carronade', R: 'carronade' };
    saveFitProfile(p, 1);
    const savedA = lo(a);
    for (const s of p.fleet) s.loadout = Object.fromEntries(Object.keys(s.loadout).map(k => [k, 'swivel']));
    const bB = lo(b), cB = lo(c);
    assertEqual(fitChoiceSlot('fit:1'), 1); assertEqual(fitChoiceSlot('fit:7'), -1); assertEqual(fitChoiceSlot('siege'), -1);
    const r = applySailFits(p, { [a.uid]: 'fit:1', [b.uid]: 'keep', [c.uid]: 'antilight' });
    assertEqual(lo(a), savedA, 'chosen ship loads the profile');
    assertEqual(a.sailFit, 'fit:1', 'remembered');
    assertEqual(lo(b), bB, 'other ships untouched'); assertEqual(lo(c), cB);
    assertEqual(JSON.stringify(r.rest), JSON.stringify({ [b.uid]: 'keep', [c.uid]: 'antilight' }), 'non-fit choices handed to doctrines');
    applySailDoctrines(p, r.rest);
    assertEqual(c.doctrine, 'antilight');
    applySailFits(p, { [a.uid]: 'keep' });
    assertEqual(a.sailFit, undefined, 'a doctrine/keep choice clears the remembered profile');
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
