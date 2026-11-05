// QA: node-level checks of Meta rules for T06 T14 T20 T21 T22 T25 + edge cases.
// Run: node tools/qa/meta_logic.mjs
import { newProfile, migrate } from '../../frontend/src/Meta/Profile.js';
import { applyBattleResult, getMission, abandonPendingBattle, missionState } from '../../frontend/src/Meta/Campaign.js';
import { applyOffline, offlineSeconds } from '../../frontend/src/Meta/HarborEconomy.js';
import { scrapShip, startRepair, rush, startBuild, canBuild, fleetCap } from '../../frontend/src/Meta/Shipyard.js';
const out = {};
const now = Date.now();
let p = newProfile(now);
const m = getMission('reef_1');
const ships = p.fleet.map(s => ({ uid: s.uid, hpFrac: 1, sunk: false }));
out.first = applyBattleResult(p, m, { won: true, timeSec: 100, ships, sunkEnemyClasses: ['light', 'light'], fortsDestroyed: 0 });
// T20: replay, win but lose one ship
const ships2 = p.fleet.map((s, i) => ({ uid: s.uid, hpFrac: i === 1 ? 0 : 0.7, sunk: i === 1 }));
const s20 = applyBattleResult(p, m, { won: true, timeSec: 100, ships: ships2, sunkEnemyClasses: ['light', 'light'], fortsDestroyed: 0 });
out.T20 = { stars: s20.stars, firstClear: s20.firstClear, reward: s20.reward, best: p.campaign.stars.reef_1, wreck: p.fleet[1].status };
// T21
const p21 = newProfile(now);
out.T21 = applyBattleResult(p21, m, { won: true, timeSec: 200, ships: p21.fleet.map(s => ({ uid: s.uid, hpFrac: 1, sunk: false })), sunkEnemyClasses: ['light', 'light'] }).stars;
// T22 retreat 1 sink (odd plunder to check floor)
const p22 = newProfile(now);
const s22 = applyBattleResult(p22, m, { won: false, retreated: true, timeSec: 50, ships: p22.fleet.map(s => ({ uid: s.uid, hpFrac: 1, sunk: false })), sunkEnemyClasses: ['light'] });
out.T22 = { reward: s22.reward, renown: s22.renown, won: p22.campaign.won };
// T25
const p25 = newProfile(now); p25.battle = { missionId: 'reef_1', shipUids: [], started: true };
out.T25 = { abandoned: abandonPendingBattle(p25), battle: p25.battle, res: p25.res };
// T06 clamp
const p6 = newProfile(now); p6.lastSeen = now - 10 * 3600e3; p6.res = { wood: 0, gold: 0 };
p6.harbor.buildings.push({ buildingId: 'warehouse', level: 5, state: 'active' });
out.T06 = { secs: offlineSeconds(p6, now), rep: applyOffline(p6, now) };
// Edge: scrap a ship that is being repaired / wreck refunds
const pe = newProfile(now); pe.fleet[1].status = 'wreck';
const before = { ...pe.res }; scrapShip(pe, pe.fleet[1].uid);
out.scrapWreck = { refund: { w: pe.res.wood - before.wood, g: pe.res.gold - before.gold } };
// Edge: migrate with corrupt fleet entries / NaN res
const mg = migrate({ res: { wood: 'abc', gold: null }, fleet: [{ hullId: 'nope' }], renown: '5' }, now);
out.migrate = { res: mg.res, fleet: mg.fleet.length, renown: mg.renown, renownType: typeof mg.renown };
// Edge: missionState for a won mission whose region is now locked
out.fleetCap = fleetCap(newProfile(now));
console.log(JSON.stringify(out, null, 1));
