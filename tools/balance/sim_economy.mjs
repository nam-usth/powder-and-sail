#!/usr/bin/env node
// ── ECONOMY / PROGRESSION SIMULATOR (pure Node, no browser) ───────────
// Simulates a plausible new player from a fresh profile to the end of the
// campaign using the REAL meta rules (Meta/Profile, Shipyard, Campaign,
// HarborEconomy) and data (harbor.js, campaign.js, buildings.js, constants.js).
// Battle outcomes are bootstrapped from tools/balance/sim_battle.mjs results.
// Method + targets: design/balance/targets.md · results: design/balance/report.md
//
//   node tools/balance/sim_economy.mjs                         # 60 runs × each player model
//   node tools/balance/sim_economy.mjs --runs 200 --battles tools/balance/out/battle_latest.json
//   node tools/balance/sim_economy.mjs --model continuous --runs 1 --verbose   # one annotated timeline
//   node tools/balance/sim_economy.mjs --rate-mult 1 --at-sea off              # what-if overrides
//
// Player models
//   continuous — one uninterrupted session (pure active-play clock)
//   active     — 25-min sessions, 4 a day (every 6 h); offline income between
//   idle       — 8-min sessions every 8 h: collect, spend, fight once or twice
//
// Player policy ("sensible novice"): repair before sailing, salvage wrecks,
// work toward the fleet of the next mission (tools/balance/scenarios.mjs:
// shipyard level for the tier, missing hulls, research), invest in
// mills/mines/warehouses whenever stock is idle and the investment pays back
// within PAYBACK_MAX, fight the next open mission as soon as that fleet is
// ready, patrol when blocked by renown or while waiting for resources.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { SCENARIOS, PATROL_SCENARIOS } from './scenarios.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = p => import(join(ROOT, p));
const H = await imp('frontend/src/data/harbor.js');
const C = await imp('frontend/src/data/campaign.js');
const K = await imp('frontend/src/data/constants.js');
const { BUILDINGS } = await imp('frontend/src/data/buildings.js');
const { TECH_TREE } = await imp('frontend/src/data/upgrades.js');
const Profile = await imp('frontend/src/Meta/Profile.js');
const Yard = await imp('frontend/src/Meta/Shipyard.js');
const Camp = await imp('frontend/src/Meta/Campaign.js');
const Econ = await imp('frontend/src/Meta/HarborEconomy.js');

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; }
}
const RUNS = Number(args.runs || 60);
const MODELS = args.model ? String(args.model).split(',') : ['continuous', 'active', 'idle'];
const OUT = resolve(args.out || join(ROOT, 'tools', 'balance', 'out'));
const TAG = args.tag || 'latest';
const BATTLES = resolve(args.battles || join(OUT, 'battle_latest.json'));
const VERBOSE = !!args.verbose;
const MAX_DAYS = Number(args['max-days'] || 30);

// ── Knobs: read from data when present, CLI overrides for what-ifs ───
const RATE_MULT = args['rate-mult'] != null ? Number(args['rate-mult']) : (H.HARBOR_ECONOMY?.rateMult ?? 1);
const AT_SEA = args['at-sea'] != null ? args['at-sea'] !== 'off' : !!H.PRODUCE_AT_SEA;
const ADJ_MULT = Number(args.adj || 1.15);          // live adjacency bonus of a sensible layout (offline ignores it)
const PAYBACK_MAX = Number(args.payback || 20 * 60); // invest only if it pays back within 20 min of income
const ACTION_GAP = Number(args['action-gap'] || 15);  // s of play between two harbor purchases
const WOOD_GOLD_MIX = 1.6;                           // wood:gold income a player aims for (hulls ≈ 60:40, buildings wood-heavy)
const BATTLE_OVERHEAD = 75;                          // chart + loading + result screen + harbor reload (s)
const DECIDE_EVERY = 5;
const MODEL = {
  continuous: { session: Infinity, gap: 0 },
  active:     { session: 25 * 60, gap: 6 * 3600 - 25 * 60 },
  idle:       { session: 8 * 60,  gap: 8 * 3600 - 8 * 60 },
};

/** Harbor build timers: data/harbor.js HARBOR_ECONOMY.buildTimeMult when present (else Open War's BUILD_TIME_MULT). */
const BTM = H.HARBOR_ECONOMY?.buildTimeMult ?? K.BUILD_TIME_MULT;
const BY_ID = Object.fromEntries(BUILDINGS.map(b => [b.id, b]));
/** Harbor building prices: data/harbor.js HARBOR_ECONOMY.buildCostMult (CLI --cost-mult for what-ifs). */
const BCM = Econ.harborCostMult(args['cost-mult'] != null ? { ...H.HARBOR_ECONOMY, buildCostMult: Number(args['cost-mult']) } : H.HARBOR_ECONOMY);
const bcost = (id, lv = 0) => Econ.harborBuildCost(BY_ID[id], lv, BCM);
const GRID_CELLS = 68;                               // home island SPRAWL/4242 (data/islandShapes)
const cellsOf = id => { const f = BY_ID[id]?.footprint || { w: 1, h: 1 }; return f.w * f.h; };
const T0 = Date.UTC(2026, 0, 1, 8, 0, 0);
const MISSION_ORDER = C.MISSIONS.map(m => m.id);

// ── Battle outcome table (bootstrapped from the battle sim) ──────────
let BT = { runs: [] };
if (existsSync(BATTLES)) BT = JSON.parse(readFileSync(BATTLES, 'utf8'));
else console.error(`! no battle results at ${BATTLES} — every battle is a clean win (run sim_battle.mjs first)`);
const byScn = new Map();
for (const r of BT.runs || []) {
  if (r.error) continue;
  const k = `${r.scenario}|${r.policy}`;
  if (!byScn.has(k)) byScn.set(k, []);
  byScn.get(k).push(r);
}
const POLICY = args.policy || 'novice';

function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const scenarioFor = mid => {
  if (SCENARIOS[mid]) return SCENARIOS[mid];
  const i = MISSION_ORDER.indexOf(mid);
  for (let k = i - 1; k >= 0; k--) if (SCENARIOS[MISSION_ORDER[k]]) return { ...SCENARIOS[MISSION_ORDER[k]], mission: mid };
  return { mission: mid, ships: [{ hull: 'brigantine' }, { hull: 'sloop' }, { hull: 'sloop' }] };
};

// ── One player ───────────────────────────────────────────────────────
class Player {
  constructor(model, seed) {
    this.model = model; this.m = MODEL[model];
    this.rng = mulberry(seed * 7919 + 13);
    this.now = T0;
    this.p = Profile.newProfile(T0);
    this.active = 0;                 // seconds of active play
    this.cells = H.STARTER_BUILDINGS.reduce((a, b) => a + cellsOf(b.buildingId), 0);
    this.ev = {};                    // milestone → { active, wall }
    this.stats = { battles: 0, wins: 0, losses: 0, patrols: 0, wipes: 0, shipsLost: 0, repairsGold: 0, repairsGunGold: 0, salvageGuns: 0, salvage: { wood: 0, gold: 0 },
      income: { harbor: 0, offline: 0, battle: 0, atSea: 0 }, wasted: 0, atCapSec: 0, built: {}, spent: { buildings: 0, ships: 0, research: 0 } };
    this.log = [];
    this.goalWaitT = 0;
    this.lastDecide = -1e9;
  }

  mark(k) { if (!this.ev[k]) this.ev[k] = { active: this.active, wall: (this.now - T0) / 1000 }; }
  note(msg) { if (VERBOSE) this.log.push(`${fmtT(this.active)} | ${fmtW((this.now - T0) / 1000)} | ${msg}`); }

  // ── Harbor ─────────────────────────────────────────────────────
  rates(live = true) {
    const r = Econ.harborRates(this.p.harbor.buildings, 1);        // unscaled; RATE_MULT applied below
    const bw = K.WOOD_RATE, bg = K.GOLD_RATE;
    const adj = live ? ADJ_MULT : 1;
    return { wood: (bw + (r.wood - bw) * adj) * RATE_MULT, gold: (bg + (r.gold - bg) * adj) * RATE_MULT };
  }
  caps() { return Econ.harborCaps(this.p.harbor.buildings); }

  /** Live harbor second(s): production (clamped), building timers, ship timers. */
  tickHarbor(dt) {
    const r = this.rates(true), c = this.caps(), res = this.p.res;
    for (const k of ['wood', 'gold']) {
      const add = r[k] * dt, room = Math.max(0, c[k] - res[k]);
      const got = Math.min(add, room);
      res[k] += got; this.stats.income.harbor += got; this.stats.wasted += add - got;
    }
    if (res.wood >= c.wood || res.gold >= c.gold) this.stats.atCapSec += dt;
    this.tickBuildings(dt);
    // moored ships mend for free (HarborSession: MOORING_REGEN_FRAC of max HP per second)
    for (const sh of this.p.fleet) if (sh.status === 'ready' && sh.hpFrac < 1) sh.hpFrac = Math.min(1, sh.hpFrac + H.MOORING_REGEN_FRAC * dt);
  }
  tickBuildings(dt) {
    for (const b of this.p.harbor.buildings) {
      if (b.state === 'building') { b.buildTimer -= dt; if (b.buildTimer <= 0) { b.state = 'active'; b.buildTimer = 0; } }
      if (b.upgradeTimer > 0) { b.upgradeTimer -= dt; if (b.upgradeTimer <= 0) { b.upgradeTimer = 0; b.level = b.pendingLevel || b.level + 1; delete b.pendingLevel; } }
    }
  }
  /** Offline catch-up with the real HarborEconomy rule (no adjacency, capped, ≤ OFFLINE_MAX_SEC). */
  offline(sec, kind = 'offline') {
    this.p.lastSeen = this.now;
    this.now += sec * 1000;
    const before = { ...this.p.res };
    const rep = Econ.applyOffline(this.p, this.now);
    // Econ.applyOffline uses base rates without RATE_MULT when the data has none; rescale for what-ifs.
    if (RATE_MULT !== (H.HARBOR_ECONOMY?.rateMult ?? 1)) {
      const k = RATE_MULT / (H.HARBOR_ECONOMY?.rateMult ?? 1);
      this.p.res.wood = before.wood + rep.wood * k; this.p.res.gold = before.gold + rep.gold * k;
      const c = this.caps(); this.p.res.wood = Math.min(this.p.res.wood, Math.max(c.wood, before.wood)); this.p.res.gold = Math.min(this.p.res.gold, Math.max(c.gold, before.gold));
    }
    const gained = (this.p.res.wood - before.wood) + (this.p.res.gold - before.gold);
    this.stats.income[kind] += gained;
    // finish building timers the same way the harbor does on boot
    for (const b of this.p.harbor.buildings) {
      if (b.state === 'building' && b.buildTimer <= 0.01) { b.state = 'active'; b.buildTimer = 0; }
      if (b.upgradeTimer > 0 && b.upgradeTimer <= 0.01) { b.upgradeTimer = 0; b.level = b.pendingLevel || b.level + 1; delete b.pendingLevel; }
    }
    Yard.tickRoster(this.p, this.now);
    return gained;
  }

  // ── Purchases ──────────────────────────────────────────────────
  afford(c) { return this.p.res.wood >= (c.wood || 0) && this.p.res.gold >= (c.gold || 0); }
  pay(c, bucket) { this.p.res.wood -= c.wood || 0; this.p.res.gold -= c.gold || 0; this.stats.spent[bucket] += (c.wood || 0) + (c.gold || 0); }
  labLevel() { return this.p.harbor.buildings.filter(b => b.buildingId === 'research_lab' && b.state === 'active').reduce((m, b) => Math.max(m, b.level), 0); }
  canPlace(id) {
    const d = BY_ID[id]; if (!d) return false;
    if (d.unlock?.requiredLabLevel && this.labLevel() < d.unlock.requiredLabLevel) return false;
    return this.cells + cellsOf(id) <= GRID_CELLS;
  }
  place(id) {
    const d = BY_ID[id];
    const c = bcost(id);
    if (!this.canPlace(id) || !this.afford(c)) return false;
    this.pay(c, 'buildings');
    this.cells += cellsOf(id);
    this.p.harbor.buildings.push({ buildingId: id, level: 1, state: 'building', buildTimer: d.buildTime * BTM, buildDuration: d.buildTime * BTM });
    this.stats.built[id] = (this.stats.built[id] || 0) + 1;
    this.note(`build ${id}`);
    return true;
  }
  upgradeCost(b) { return bcost(b.buildingId, b.level); }
  upgrade(b) {
    if (b.state !== 'active' || b.upgradeTimer > 0 || b.level >= 10) return false;
    const c = this.upgradeCost(b);
    if (!this.afford(c)) return false;
    this.pay(c, 'buildings');
    b.pendingLevel = b.level + 1;
    b.upgradeTimer = (BY_ID[b.buildingId].upgradeTime || 30) * BTM;
    this.note(`upgrade ${b.buildingId} → L${b.pendingLevel}`);
    return true;
  }

  // ── Goals ──────────────────────────────────────────────────────
  nextMission() {
    return C.MISSIONS.find(m => !this.p.campaign.won[m.id] && Camp.missionState(this.p, m) === 'open') || null;
  }
  blockedByRenown() {
    const m = C.MISSIONS.find(x => !this.p.campaign.won[x.id] && (x.requires || []).every(id => this.p.campaign.won[id]));
    return m && !Camp.regionUnlocked(this.p, m.region) ? m : null;
  }
  /** Match a scenario roster against owned ships (not wrecked). */
  match(scn) {
    const pool = this.p.fleet.filter(s => s.status !== 'wreck');
    const used = new Set(), got = [], missing = [];
    for (const spec of scn.ships) {
      const s = pool.find(x => !used.has(x.uid) && x.hullId === spec.hull);
      if (s) { used.add(s.uid); got.push(s); } else missing.push(spec.hull);
    }
    const wrecks = this.p.fleet.filter(s => s.status === 'wreck' && scn.ships.some(sp => sp.hull === s.hullId));
    return { got, missing, wrecks };
  }

  decide() {
    const p = this.p;
    Yard.tickRoster(p, this.now);
    // 1. repairs + salvage first (a ship in the yard cannot sail)
    for (const s of p.fleet) {
      // pay the yard only when badly hurt and it is cheap; otherwise the moorings mend it
      if (s.status === 'ready' && s.hpFrac < 0.7) {
        const q = Yard.repairQuote(s);
        if (q.gold <= 0.1 * p.res.gold && Yard.startRepair(p, s.uid, this.now)) { this.stats.repairsGold += q.gold; this.stats.repairsGunGold += q.gunGold || 0; this.note(`repair ${s.hullId} ${q.gold}g (guns ${q.gunGold}g) ${q.sec}s`); }
      }
      if (s.status === 'wreck') {
        const q = Yard.salvageQuote(s);
        if (Yard.startSalvage(p, s.uid, this.now)) { this.stats.salvage.wood += q.wood; this.stats.salvage.gold += q.gold; this.stats.salvageGuns += (q.guns?.wood || 0) + (q.guns?.gold || 0); this.note(`salvage ${s.hullId} ${q.wood}w/${q.gold}g`); }
      }
    }
    const blocked = this.blockedByRenown();
    const m = this.nextMission();
    const scn = m ? scenarioFor(m.id) : null;
    let want = null;                                   // the purchase we are saving for
    if (scn) {
      // research in the goal
      for (const id of scn.research || []) {
        if (p.harbor.researched.includes(id)) continue;
        const t = TECH_TREE.find(x => x.id === id);
        if (!t || !(t.req || []).every(r => p.harbor.researched.includes(r))) continue;
        if (t.requiredLabLevel && this.labLevel() < t.requiredLabLevel) { want = want || { kind: 'lab', level: t.requiredLabLevel }; continue; }
        if (this.afford(t.cost)) {
          this.pay(t.cost, 'research'); p.harbor.researched.push(id); this.note(`research ${id}`);
          if (t.cannon) { this.mark('research:first_gun'); this.mark(`research:gun_T${t.tier}`); }
        }
        else want = want || { kind: 'research', cost: t.cost };
      }
      // cannon research: equipping is free — refit every ship with its best known default fit
      this.refit();
      // shipyard level + fleet cap for the roster
      const { missing } = this.match(scn);
      const needTier = Math.max(0, ...missing.map(h => H.HULLS[h].shipyardLevel));
      const needCap = scn.ships.length;
      const yard = p.harbor.buildings.find(b => b.buildingId === 'shipyard');
      const capShort = Yard.fleetCap(p) < needCap;
      if (yard && (Yard.shipyardLevel(p) < needTier || capShort) && yard.level < 10) {
        if (yard.upgradeTimer > 0) want = want || { kind: 'wait' };
        else if (!this.upgrade(yard)) want = want || { kind: 'shipyard', cost: this.upgradeCost(yard) };
      }
      // build missing hulls (cheapest-tier first), make berth room by scrapping spares
      for (const hid of missing.sort((a, b) => H.HULLS[a].tier - H.HULLS[b].tier)) {
        const cb = Yard.canBuild(p, hid);
        if (cb.ok) { const s = Yard.startBuild(p, hid, this.now); this.pay({}, 'ships'); this.stats.spent.ships += H.HULLS[hid].cost.wood + H.HULLS[hid].cost.gold; this.note(`build ship ${hid} (${s?.nm})`); continue; }
        if (cb.reason === 'roster_full') {
          const keep = new Set(this.match(scn).got.map(s => s.uid));
          const spare = p.fleet.filter(s => !keep.has(s.uid) && s.status !== 'building').sort((a, b) => H.HULLS[a.hullId].tier - H.HULLS[b.hullId].tier)[0];
          if (spare && Yard.scrapShip(p, spare.uid)) this.note(`scrap ${spare.hullId}`);
        }
        if (cb.reason === 'resources') want = want || { kind: 'ship', cost: H.HULLS[hid].cost, hull: hid };
        if (cb.reason === 'slipway_busy' || cb.reason === 'shipyard_level') want = want || { kind: 'wait' };
      }
    }
    // 2. economy: invest idle stock (keeps a reserve for the goal purchase)
    this.invest(want);
    // 3. sail
    if (blocked && !m) return { action: 'patrol', why: 'renown' };
    if (!m) return null;
    const { got, missing } = this.match(scn);
    const ready = !missing.length && got.every(s => s.status === 'ready' && s.hpFrac >= 0.95);
    if (ready) return { action: 'mission', mission: m, ships: got, scn };
    // waiting on resources for a while with a sailable fleet → patrol for plunder
    if (want && (want.kind === 'ship' || want.kind === 'shipyard' || want.kind === 'research')) {
      this.goalWaitT += DECIDE_EVERY;
      const eta = this.eta(want.cost);
      if (eta > 240 && this.goalWaitT > 60) return { action: 'patrol', why: `saving ${want.kind} eta ${Math.round(eta)}s` };
    } else this.goalWaitT = 0;
    return null;
  }

  /** Free refit (cannon research): each ship gets its class/tier default fit from the researched guns. */
  refit() {
    for (const s of this.p.fleet) {
      const h = H.HULLS[s.hullId]; if (!h) continue;
      s.loadout = Profile.defaultLoadout(h.hull, h.tier, this.p.harbor.researched);
    }
  }

  eta(cost) {
    const r = this.rates(true), res = this.p.res;
    const tw = cost.wood ? Math.max(0, cost.wood - res.wood) / Math.max(1e-6, r.wood) : 0;
    const tg = cost.gold ? Math.max(0, cost.gold - res.gold) / Math.max(1e-6, r.gold) : 0;
    return Math.max(tw, tg);
  }

  /** Seconds until `cost` is affordable from stock `res` at income `r`. */
  etaWith(cost, res, r) {
    const tw = cost.wood ? Math.max(0, cost.wood - res.wood) / Math.max(1e-6, r.wood) : 0;
    const tg = cost.gold ? Math.max(0, cost.gold - res.gold) / Math.max(1e-6, r.gold) : 0;
    return Math.max(tw, tg);
  }

  /**
   * Spend idle stock on the harbor. With a purchase goal, an investment is
   * made only if it brings that goal closer (the classic "build a mine while
   * saving for the frigate" call); without one, if it pays back within
   * PAYBACK_MAX. Storage is bought when the goal does not fit the cap.
   */
  invest(want) {
    const p = this.p, c = this.caps(), r = this.rates(true), res = p.res;
    const goal = want?.cost || null;
    const eta0 = goal ? this.etaWith(goal, res, r) : 0;
    const k = RATE_MULT * ADJ_MULT;
    const mk = (kind, cost, dW, dG, act, bt) => ({ kind, cost, dW: dW * k, dG: dG * k, act, bt,
      payback: ((cost.wood || 0) + (cost.gold || 0)) / Math.max(1e-6, (dW + dG) * k) });
    const cands = [];
    const blds = p.harbor.buildings;
    const prodDelta = (id, lv) => { const t = BY_ID[id].productionByLevel; return (t[lv] || 0) - (t[lv - 1] || 0); };
    const bt = id => BY_ID[id].buildTime * BTM, ut = id => (BY_ID[id].upgradeTime || 30) * BTM;
    // a sensible player keeps room for two warehouses (T4/T5 hulls cost more than the base cap)
    const whRoom = 2 * Math.max(0, 2 - blds.filter(b => b.buildingId === 'warehouse').length);
    const roomFor = id => this.canPlace(id) && this.cells + cellsOf(id) + whRoom <= GRID_CELLS;
    if (roomFor('lumber_mill')) cands.push(mk('mill', bcost('lumber_mill'), BY_ID.lumber_mill.productionByLevel[0], 0, () => this.place('lumber_mill'), bt('lumber_mill')));
    if (roomFor('gold_mine')) cands.push(mk('mine', bcost('gold_mine'), 0, BY_ID.gold_mine.productionByLevel[0], () => this.place('gold_mine'), bt('gold_mine')));
    for (const b of blds) {
      if (b.state !== 'active' || b.upgradeTimer > 0 || b.level >= 10) continue;
      if (b.buildingId === 'lumber_mill') cands.push(mk('mill+', this.upgradeCost(b), prodDelta('lumber_mill', b.level), 0, () => this.upgrade(b), ut('lumber_mill')));
      if (b.buildingId === 'gold_mine') cands.push(mk('mine+', this.upgradeCost(b), 0, prodDelta('gold_mine', b.level), () => this.upgrade(b), ut('gold_mine')));
    }
    const needCap = goal && ((goal.wood || 0) > c.wood || (goal.gold || 0) > c.gold);
    const spilling = (res.wood >= c.wood * 0.95 || res.gold >= c.gold * 0.95) && this.active - (this._lastWh || -1e9) > 600;
    if (needCap || spilling) {
      const whs = blds.filter(b => b.buildingId === 'warehouse');
      const fresh = whs.length < 2 && this.canPlace('warehouse');
      const wh = whs.filter(b => b.state === 'active' && !(b.upgradeTimer > 0) && b.level < 10).sort((a, b) => a.level - b.level)[0];
      const cost = fresh ? bcost('warehouse') : wh ? this.upgradeCost(wh) : null;
      const act = fresh ? () => this.place('warehouse') : wh ? () => this.upgrade(wh) : null;
      if (cost) cands.push({ kind: 'warehouse', cost, dW: 0, dG: 0, payback: 0, storage: needCap, bt: 0,
        act: () => { const ok = act(); if (ok) this._lastWh = this.active; return ok; } });
    }
    if (want?.kind === 'lab' && !blds.some(b => b.buildingId === 'research_lab')) cands.push({ kind: 'lab', cost: bcost('research_lab'), dW: 0, dG: 0, payback: 0, storage: true, bt: 0, act: () => this.place('research_lab') });
    // cannon research: lab level = gun tier → upgrade the lab when the goal needs it
    const lab = blds.find(b => b.buildingId === 'research_lab');
    if (want?.kind === 'lab' && lab && lab.state === 'active' && !(lab.upgradeTimer > 0) && lab.level < (want.level || 1))
      cands.push({ kind: 'lab+', cost: this.upgradeCost(lab), dW: 0, dG: 0, payback: 0, storage: true, bt: 0, act: () => this.upgrade(lab) });
    cands.sort((a, b) => a.payback - b.payback);
    // attention budget: a player clicks one harbor purchase per ACTION_GAP seconds of play
    if (this.active - (this._lastBuy || -1e9) < ACTION_GAP) return false;
    // with no goal, keep income near the spending mix (wood:gold ≈ WOOD_GOLD_MIX)
    const woodHeavy = r.wood / Math.max(1e-6, r.gold) > WOOD_GOLD_MIX;
    for (const x of cands) {
      if (!this.afford(x.cost)) continue;
      if (x.storage) { if (x.act()) { this._lastBuy = this.active; return true; } continue; }
      if (!goal && (x.dW > 0) === woodHeavy && (x.dW > 0 || x.dG > 0)) continue;
      if (goal) {
        const res2 = { wood: res.wood - (x.cost.wood || 0), gold: res.gold - (x.cost.gold || 0) };
        const eta1 = x.bt + this.etaWith(goal, res2, { wood: r.wood + x.dW, gold: r.gold + x.dG });
        if (eta1 > eta0 - 0.5) continue;
      } else if (x.payback > PAYBACK_MAX) continue;
      if (x.act()) { this._lastBuy = this.active; return true; }
    }
    return false;
  }

  // ── Battles ────────────────────────────────────────────────────
  sample(scnId) {
    const rs = byScn.get(`${scnId}|${POLICY}`);
    if (!rs?.length) return null;
    return rs[Math.floor(this.rng() * rs.length)];
  }

  fight(plan) {
    const p = this.p;
    let mission, ships, scnId;
    if (plan.action === 'mission') { mission = plan.mission; ships = plan.ships; scnId = mission.id; }
    else {
      const rk = Camp.rankIndex(p.renown);
      const sailable = Yard.sailableShips(p);
      if (!sailable.length) return false;
      ships = sailable.sort((a, b) => H.HULLS[b.hullId].tier - H.HULLS[a.hullId].tier).slice(0, Yard.fleetCap(p));
      p.battle = { missionId: 'patrol', shipUids: ships.map(s => s.uid), seed: 1 + Math.floor(this.rng() * 99999), started: false };
      mission = Camp.makePatrol(p, p.battle.seed, ships.map(s => s.uid));
      p.battle = null;
      // patrol is drawn from the furthest unlocked sea (Meta/Campaign.makePatrol) → PATROL_SCENARIOS key
      const sea = [...C.REGIONS].reverse().find(r => Camp.regionUnlocked(p, r.id))?.id || 'caribbean';
      scnId = `patrol_${sea}`;
      if (ships.length < 3) scnId = ships.length === 1 ? (H.HULLS[ships[0].hullId].tier >= 3 ? 'wipe_1frig' : 'wipe_1sloop') : 'wipe_2ships';
    }
    const run = this.sample(scnId);
    const timeSec = run ? run.timeSec : 120;
    const won = run ? run.won : true;
    // ships: map the sampled run's per-ship outcome by hull, else spread its aggregate
    const results = ships.map(s => ({ uid: s.uid, hullId: s.hullId, sunk: false, hpFrac: 1, sinks: 0 }));
    if (run) {
      const pool = [...(run.shipResults || [])];
      for (const r of results) {
        const k = pool.findIndex(x => x.hullId === r.hullId);
        if (k >= 0) { const x = pool.splice(k, 1)[0]; r.sunk = x.sunk; r.hpFrac = x.hpFrac; }
        else { r.hpFrac = run.hpAliveFrac || 0.6; }
      }
      if (!run.shipResults) {
        const idx = results.map((_, i) => i).sort(() => this.rng() - 0.5).slice(0, run.lost);
        idx.forEach(i => { results[i].sunk = true; results[i].hpFrac = 0; });
      }
    }
    // the harbor while at sea
    const dur = timeSec + BATTLE_OVERHEAD;
    if (AT_SEA) this.offline(dur, 'atSea');
    else { this.now += dur * 1000; Yard.tickRoster(p, this.now); }
    this.active += dur;
    const sunkClasses = run?.sunkClasses || [];
    const before = p.res.wood + p.res.gold;
    const sum = Camp.applyBattleResult(p, mission, {
      won, timeSec, ships: results, sunkEnemyClasses: sunkClasses, fortsDestroyed: run?.forts || 0,
    });
    if (run && !run.sunkClasses) {                      // legacy battle json: bank its plunder directly
      const k = won ? 1 : H.DEFEAT_PLUNDER_KEEP;
      p.res.wood += Math.floor(run.plunder.wood * k); p.res.gold += Math.floor(run.plunder.gold * k);
      p.renown += run.sunk * H.RENOWN_PER_SINK;
    }
    this.stats.income.battle += p.res.wood + p.res.gold - before;
    this.stats.battles++;
    if (mission.repeatable) this.stats.patrols++;
    if (won) this.stats.wins++; else this.stats.losses++;
    const lost = results.filter(r => r.sunk).length;
    this.stats.shipsLost += lost;
    if (lost === results.length) this.stats.wipes++;
    this.note(`${mission.repeatable ? 'PATROL' : mission.id} ${won ? 'WIN' : 'LOSS'} ${timeSec}s ★${sum.stars} lost ${lost}/${results.length} +${sum.reward.wood}w/${sum.reward.gold}g renown ${p.renown} (${plan.why || ''})`);
    if (won && !mission.repeatable) this.mark(`win:${mission.id}`);
    if (sum.campaignComplete) this.mark('campaign');
    return true;
  }

  // ── Milestones ─────────────────────────────────────────────────
  milestones() {
    const p = this.p;
    for (const r of C.REGIONS) if (Camp.regionUnlocked(p, r.id)) this.mark(`region:${r.id}`);
    const nProd = p.harbor.buildings.filter(b => b.buildingId === 'lumber_mill' || b.buildingId === 'gold_mine').length;
    if (nProd >= 20) this.mark('harbor:20producers');
    if (this.cells >= GRID_CELLS - 4) this.mark('harbor:island_full');
    for (let t = 1; t <= 5; t++) {
      const hulls = Object.values(H.HULLS).filter(h => h.tier === t && !h.enemyOnly);
      if (!hulls.length) continue;
      const cheapest = hulls.reduce((a, b) => (a.cost.wood + a.cost.gold <= b.cost.wood + b.cost.gold ? a : b));
      if (this.afford(cheapest.cost)) this.mark(`afford:T${t}`);
      if (this.afford(cheapest.cost) && Yard.shipyardLevel(p) >= t) this.mark(`buildable:T${t}`);
      if (p.fleet.some(s => H.HULLS[s.hullId]?.tier === t && s.status !== 'building' && !this.starterUids.has(s.uid))) this.mark(`own:T${t}`);
    }
  }

  // ── Main loop ──────────────────────────────────────────────────
  run() {
    const endWall = MAX_DAYS * 86400;
    let sessionLeft = this.m.session;
    this.starterUids = new Set(this.p.fleet.map(s => s.uid));
    while ((this.now - T0) / 1000 < endWall && !this.ev.campaign) {
      if (sessionLeft <= 0) {                          // log off
        this.offline(this.m.gap, 'offline');
        sessionLeft = this.m.session;
        this.note(`— session start (stock ${Math.round(this.p.res.wood)}w/${Math.round(this.p.res.gold)}g)`);
        continue;
      }
      this.tickHarbor(1);
      Yard.tickRoster(this.p, (this.now += 1000));
      this.active += 1; sessionLeft -= 1;
      this.milestones();
      if (this.active - this.lastDecide >= DECIDE_EVERY) {
        this.lastDecide = this.active;
        const plan = this.decide();
        if (plan && (plan.action === 'mission' || plan.action === 'patrol')) {
          // a battle has to fit in the session (idle players do not start one they cannot finish)
          const est = 300;
          if (sessionLeft > est * 0.5 || this.model === 'continuous') {
            const t0 = this.active;
            if (this.fight(plan)) sessionLeft -= this.active - t0;
            this.milestones();
          }
        }
      }
    }
    return this;
  }
}

const fmtT = s => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const fmtW = s => `d${Math.floor(s / 86400)} ${fmtT(s % 86400)}`;
const q = (arr, f) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))]; };

function report(players, model) {
  const keys = new Set();
  players.forEach(pl => Object.keys(pl.ev).forEach(k => keys.add(k)));
  const order = k => {
    const [t, id] = k.split(':');
    const base = { afford: 0, buildable: 1, own: 2, research: 2.5, region: 3, win: 4, campaign: 9 }[t] ?? 8;
    if (t === 'win') return 100 + MISSION_ORDER.indexOf(id);
    if (t === 'region') return 50 + C.REGIONS.findIndex(r => r.id === id);
    if (t === 'campaign') return 999;
    if (t === 'research') return 25 + (Number(String(id).replace('gun_T', '')) || 0);
    return base * 10 + Number(String(id).replace('T', ''));
  };
  const rows = [...keys].sort((a, b) => order(a) - order(b)).map(k => {
    const xs = players.filter(pl => pl.ev[k]);
    const act = xs.map(pl => pl.ev[k].active / 60), wall = xs.map(pl => pl.ev[k].wall / 3600);
    return { k, reached: xs.length / players.length, activeMin: [q(act, .1), q(act, .5), q(act, .9)], wallH: [q(wall, .1), q(wall, .5), q(wall, .9)] };
  });
  const S = f => q(players.map(f), .5);
  const totals = {
    battles: S(pl => pl.stats.battles), patrols: S(pl => pl.stats.patrols), losses: S(pl => pl.stats.losses), wipes: S(pl => pl.stats.wipes),
    shipsLost: S(pl => pl.stats.shipsLost), atCapPct: S(pl => pl.stats.atCapSec / Math.max(1, pl.active)) ,
    wastedPct: S(pl => pl.stats.wasted / Math.max(1, pl.stats.income.harbor + pl.stats.wasted)),
    incomeHarbor: S(pl => pl.stats.income.harbor), incomeOffline: S(pl => pl.stats.income.offline), incomeAtSea: S(pl => pl.stats.income.atSea), incomeBattle: S(pl => pl.stats.income.battle),
    repairsGold: S(pl => pl.stats.repairsGold), repairsGunGold: S(pl => pl.stats.repairsGunGold), salvage: S(pl => pl.stats.salvage.wood + pl.stats.salvage.gold), salvageGuns: S(pl => pl.stats.salvageGuns),
    spentBuildings: S(pl => pl.stats.spent.buildings), spentShips: S(pl => pl.stats.spent.ships), spentResearch: S(pl => pl.stats.spent.research),
    mills: S(pl => pl.p.harbor.buildings.filter(b => b.buildingId === 'lumber_mill').length), mines: S(pl => pl.p.harbor.buildings.filter(b => b.buildingId === 'gold_mine').length),
    warehouses: S(pl => pl.p.harbor.buildings.filter(b => b.buildingId === 'warehouse').length),
    avgProdLevel: S(pl => { const b = pl.p.harbor.buildings.filter(x => x.buildingId === 'lumber_mill' || x.buildingId === 'gold_mine'); return b.reduce((a, x) => a + x.level, 0) / Math.max(1, b.length); }),
    finalRates: (() => { const r = players.map(pl => pl.rates(true)); return { wood: q(r.map(x => x.wood), .5), gold: q(r.map(x => x.gold), .5) }; })(),
    completed: players.filter(pl => pl.ev.campaign).length / players.length,
    activeH: S(pl => pl.active / 3600), wallD: S(pl => (pl.now - T0) / 86400000),
  };
  return { model, n: players.length, rows, totals };
}

function mdReport(rep) {
  const f = x => (x == null ? '–' : x >= 100 ? Math.round(x) : x.toFixed(1));
  const L = [`### Player model: ${rep.model} (${rep.n} runs)`, '',
    '| Milestone | Reached | Active play (min) p10 / **p50** / p90 | Wall clock (h) p10 / **p50** / p90 |', '|---|---:|---|---|'];
  for (const r of rep.rows) L.push(`| ${r.k} | ${Math.round(r.reached * 100)}% | ${f(r.activeMin[0])} / **${f(r.activeMin[1])}** / ${f(r.activeMin[2])} | ${f(r.wallH[0])} / **${f(r.wallH[1])}** / ${f(r.wallH[2])} |`);
  const t = rep.totals;
  L.push('', `Campaign completed: ${Math.round(t.completed * 100)}% · median active ${f(t.activeH)} h · wall ${f(t.wallD)} days · battles ${t.battles} (patrols ${t.patrols}, losses ${t.losses}, wipes ${t.wipes}, ships lost ${t.shipsLost})`);
  L.push(`Income (median totals): harbor live ${Math.round(t.incomeHarbor)} · offline ${Math.round(t.incomeOffline)} · at sea ${Math.round(t.incomeAtSea)} · battles ${Math.round(t.incomeBattle)} — spent: buildings ${Math.round(t.spentBuildings)}, ships ${Math.round(t.spentShips)}, research ${Math.round(t.spentResearch)}, repairs ${Math.round(t.repairsGold)}g (guns ${Math.round(t.repairsGunGold)}g), salvage ${Math.round(t.salvage)} (guns ${Math.round(t.salvageGuns)})`);
  L.push(`Cap pressure: at cap ${Math.round(t.atCapPct * 100)}% of active time · production spilled ${Math.round(t.wastedPct * 100)}% · final harbor: ${t.mills} mills, ${t.mines} mines, ${t.warehouses} warehouses, avg producer level ${f(t.avgProdLevel)} → ${f(t.finalRates.wood)} 🪵/s, ${f(t.finalRates.gold)} 🪙/s`);
  return L.join('\n');
}

const reports = [];
for (const model of MODELS) {
  const players = [];
  for (let i = 0; i < (VERBOSE ? 1 : RUNS); i++) players.push(new Player(model, i + 1).run());
  if (VERBOSE) console.log(players[0].log.join('\n'));
  reports.push(report(players, model));
}
const md = `# Economy sim — ${TAG}\n\nknobs: rateMult ${RATE_MULT} · buildCostMult ${JSON.stringify(BCM)} · produce at sea ${AT_SEA} · live adjacency ×${ADJ_MULT} · payback ≤ ${PAYBACK_MAX / 60} min · battle overhead ${BATTLE_OVERHEAD}s · battles from ${BATTLES.replace(ROOT + '/', '')} (${POLICY})\n\n${reports.map(mdReport).join('\n\n')}\n`;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `economy_${TAG}.json`), JSON.stringify({ knobs: { RATE_MULT, AT_SEA, ADJ_MULT, PAYBACK_MAX }, reports }, null, 1));
writeFileSync(join(OUT, `economy_${TAG}.md`), md);
console.log(md);
