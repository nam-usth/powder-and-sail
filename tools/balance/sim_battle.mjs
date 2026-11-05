#!/usr/bin/env node
// ── HEADLESS SEA-BATTLE SIMULATOR (balance pass) ──────────────────────
// Plays real Sea Battles in headless Chromium with a scripted player and
// reports win rate, duration, losses, HP left, plunder and stars.
// Method + targets: design/balance/targets.md, results: design/balance/report.md
//
//   node tools/balance/sim_battle.mjs                       # every scenario, both policies, 8 seeds
//   node tools/balance/sim_battle.mjs --scenarios reef_1,reef_2 --policy novice --seeds 12
//   node tools/balance/sim_battle.mjs --mission reef_2 --fleet brigantine,sloop,sloop --research bal1
//   node tools/balance/sim_battle.mjs --mission storm_3 --roster '[{"hull":"man_o_war","loadout":"broadside"}]'
//   node tools/balance/sim_battle.mjs --list
//
// Options: --policy novice|skilled|both · --seeds N · --seed0 S · --workers K
//          --cap SEC (game-time cap, default 900) · --port P (8150–8159)
//          --tag NAME (output basename) · --out DIR (default tools/balance/out)
//          --renown N (patrol rank) · --set 'missionPatch JSON' (ad-hoc data override, see below)
//
// How a run works
//   1. A profile (Meta/Profile.newProfile shape) is built in Node with the
//      scenario fleet, research and renown, plus profile.battle =
//      {missionId, shipUids, seed, started:false}; an init script writes it to
//      localStorage, seeds Math.random (mulberry32(seed)) and lets the sim
//      freeze requestAnimationFrame.
//   2. /frontend/?mode=battle&mission=<id> boots the real BattleSession.
//   3. Rendering + purely visual systems are stubbed; VFX is replaced by a
//      shim that keeps cannonball flight time (dist / 28 u/s) so damage lands
//      exactly when it would in the game.
//   4. The policy drives the fleet through test/harness.js (h.rightClick on
//      world points, selection = window._game._state.selection) while the sim
//      steps the game with h.step() until session.done or the cap.
//
// Policies
//   novice  — every 5 s: right-click the nearest enemy ship, else the nearest
//             standing enemy fort, else (capture) the target island, else
//             (survive) sail back to the spawn point. No abilities, default stance.
//   skilled — every 2 s: focus the weakest enemy ship in gun range (else the
//             nearest), forts after ships; attack orders keep the broadside
//             orbit; uses the commander abilities (Z barrage when guns bear,
//             C repairs when hurt, X winds to close the distance).

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { ALL_SCENARIOS, SCENARIOS, GATE_SCENARIOS, PATROL_SCENARIOS, BEFORE_SCENARIOS } from './scenarios.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'tools', 'smoke.mjs'));
const { chromium } = require('playwright');

/**
 * Files the balance pass touches. `--git-ref HEAD` serves exactly these from
 * git (the pre-balance game) while everything else comes from the working
 * tree — a reproducible "before" no matter what is being edited.
 */
export const BALANCE_PATHS = [
  'frontend/src/data/campaign.js', 'frontend/src/data/harbor.js',
  'frontend/src/Meta/Campaign.js', 'frontend/src/Meta/Profile.js', 'frontend/src/Meta/Shipyard.js',
  'frontend/src/Meta/HarborEconomy.js',
  'frontend/src/Experience/Systems/AI/EnemyAI.js', 'frontend/src/Experience/Systems/Combat/CombatSystem.js',
  'frontend/src/Experience/Systems/Naval/AuraSystem.js', 'frontend/src/Experience/Modes/BattleSession.js',
  'frontend/src/Experience/Systems/Match/MissionSystem.js', 'frontend/src/Experience/Modes/shipSpec.js',
];

// ── CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; }
}
if (args.list) {
  for (const [id, s] of Object.entries(ALL_SCENARIOS)) console.log(`${id.padEnd(18)} ${s.mission.padEnd(10)} ${s.label}`);
  process.exit(0);
}
const POLICIES = args.policy && args.policy !== 'both' ? String(args.policy).split(',') : ['novice', 'skilled'];
const SEEDS = Number(args.seeds || 8);
const SEED0 = Number(args.seed0 || 1);
const WORKERS = Math.max(1, Number(args.workers || 3));
const CAP_SEC = Number(args.cap || 900);
const OUT = resolve(args.out || join(ROOT, 'tools', 'balance', 'out'));
const TAG = args.tag || 'latest';
const GIT_REF = args['git-ref'] || null;
const GIT_PATHS = args['git-paths'] ? String(args['git-paths']).split(',') : BALANCE_PATHS;
/**
 * --set '{"straits_1":{"enemies.0.hp":240,"escape.r":12}}' — ad-hoc mission
 * overrides for what-if runs: dotted paths into data/campaign.js MISSIONS
 * entries, applied to the served module only (the file on disk is untouched).
 */
const SET = args.set ? JSON.parse(args.set) : null;
const PATCH_SRC = SET ? `\n;((MS, P) => { for (const [id, kv] of Object.entries(P)) { const m = MS.find(x => x.id === id); if (!m) continue;
  for (const [path, v] of Object.entries(kv)) { const ks = path.split('.'); let o = m; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; o[ks[ks.length - 1]] = v; } } })(MISSIONS, ${JSON.stringify(SET)});\n` : '';

function pickScenarios() {
  if (args.mission) {
    let ships;
    if (args.roster) ships = JSON.parse(args.roster);
    else ships = String(args.fleet || 'brigantine,sloop,sloop').split(',').map(h => ({ hull: h.trim() }));
    return { custom: {
      mission: args.mission, label: args.label || `custom: ${ships.map(s => s.hull).join('+')}`, ships,
      research: args.research ? String(args.research).split(',') : [], renown: Number(args.renown || 0),
    } };
  }
  const sel = args.scenarios || 'all';
  if (sel === 'all') return ALL_SCENARIOS;
  if (sel === 'campaign') return SCENARIOS;
  if (sel === 'gates') return GATE_SCENARIOS;
  if (sel === 'patrol') return PATROL_SCENARIOS;
  if (sel === 'before') return BEFORE_SCENARIOS;      // with --git-ref HEAD: the pre-balance game
  if (sel.startsWith('before:')) return Object.fromEntries(sel.slice(7).split(',').map(id => [id, BEFORE_SCENARIOS[id]]));
  return Object.fromEntries(String(sel).split(',').map(id => {
    if (!ALL_SCENARIOS[id]) throw new Error(`unknown scenario ${id} (try --list)`);
    return [id, ALL_SCENARIOS[id]];
  }));
}

// ── Profile for a scenario (built in the page with the SERVED Meta modules) ──
/** Runs in a blank page of the game origin: writes the scenario profile to localStorage. */
async function writeProfile({ scn, seed, now }) {
  const P = await import('/frontend/src/Meta/Profile.js');
  const { HULLS } = await import('/frontend/src/data/harbor.js');
  const { HULL_SLOTS } = await import('/frontend/src/data/ships.js');
  const broadside = cls => {
    const lo = {};
    (HULL_SLOTS[cls] || []).forEach(sl => { lo[sl] = sl === 'L' || sl === 'R' ? 'demi_culv' : sl === 'B' ? 'long9' : 'swivel'; });
    return lo;
  };
  const p = P.newProfile(now);
  p.fleet = [];
  for (const spec of scn.ships) {
    const h = HULLS[spec.hull];
    if (!h) throw new Error(`unknown hull ${spec.hull}`);
    const loadout = spec.loadout === 'broadside' ? broadside(h.hull)
      : spec.loadout && typeof spec.loadout === 'object' ? { ...spec.loadout } : undefined;
    const s = P.makeRosterShip(spec.hull, { loadout, upgrades: { spd: 0, hp: 0, rof: 0, ...(spec.upgrades || {}) }, hpFrac: spec.hpFrac ?? 1 }, now);
    s.nm = P.pickShipName(p, spec.hull);
    p.fleet.push(s);
  }
  p.renown = scn.renown || 0;
  p.harbor.researched = [...(scn.research || [])];
  p.harbor.fresh = false;
  p.battle = { missionId: scn.mission, shipUids: p.fleet.map(s => s.uid), seed, startedAt: now, started: false };
  localStorage.setItem('iow_tut_done', '1');
  localStorage.setItem('iow_profile_v1', JSON.stringify(p));
  return p.fleet.map(s => `${s.hullId}{${Object.values(s.loadout).join(',')}}`).join(' ');
}

// ── Static server (same approach as tools/smoke.mjs) ────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

async function startServer() {
  const gitCache = new Map();
  const fromGit = rel => {
    if (!gitCache.has(rel)) gitCache.set(rel, execFileSync('git', ['show', `${GIT_REF}:${rel}`], { cwd: ROOT, maxBuffer: 1 << 26 }));
    return gitCache.get(rel);
  };
  const handler = async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><title>sim</title>'); }
      if (p.endsWith('/')) p += 'index.html';
      const rel = p.replace(/^\/+/, '');
      if (GIT_REF && GIT_PATHS.includes(rel)) {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        return res.end(fromGit(rel));
      }
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      if (SET && rel === 'frontend/src/data/campaign.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        return res.end((await readFile(file, 'utf8')) + PATCH_SRC);
      }
      // Sound files are not needed headless — skip the bytes.
      if (extname(file) === '.mp3') { res.writeHead(404); return res.end(); }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  };
  const ports = args.port ? [Number(args.port)] : [8150, 8151, 8152, 8153, 8154, 8155, 8156, 8157, 8158, 8159];
  for (const port of ports) {
    const srv = createServer(handler);
    const ok = await new Promise(r => { srv.once('error', () => r(false)); srv.listen(port, '127.0.0.1', () => r(true)); });
    if (ok) return { srv, port };
  }
  throw new Error('no free port in 8150–8159');
}

// ── In-page code ─────────────────────────────────────────────────────
/** Init script: seeded Math.random, freezable rAF. */
function initScript({ seed }) {
  let a = seed >>> 0 || 1;
  Math.random = function mulberry32() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__simFreeze ? 0 : raf(cb));
}

/** Stop the real loop, rendering and every visual-only system. */
function installShims() {
  window.__simFreeze = true;
  const g = window._game;
  const noop = () => {};
  g._renderer.render = noop;
  // VFX shim: keep cannonball time-of-flight (VFX.fireBall: HORIZ_SPD 28 u/s), drop everything visual.
  const v = g._vfx, q = [];
  const names = new Set();
  for (let o = v; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach(n => names.add(n));
  for (const n of names) { if (n !== 'constructor') { try { if (typeof v[n] === 'function') v[n] = noop; } catch {} } }
  const burn = { update: noop, stop: noop, setIntensity: noop };
  v.startBurning = () => burn;
  v.fireBall = (sx, sy, sz, tx, tz, col, spd, cb) => { q.push({ t: (Math.hypot(tx - sx, tz - sz) || 0.01) / 28, cb }); };
  v.update = dt => {
    for (let i = q.length - 1; i >= 0; i--) { const b = q[i]; b.t -= dt; if (b.t <= 0) { q.splice(i, 1); b.cb?.(); } }
  };
  for (const [obj, fns] of [
    [g._physics, ['update', 'syncToShip']], [g._ocean, ['update']], [g._sky, ['update']], [g._wake, ['update']],
    [g._minimap, ['draw']], [g._shipBars, ['update']], [g._hud, ['update']], [g._markers, ['update']],
    [g._scene, ['updateMoveRing']], [g._debug, ['update']], [g._fog, ['update']], [g._cmdCard, ['refresh']],
  ]) { if (obj) fns.forEach(f => { if (typeof obj[f] === 'function') obj[f] = noop; }); }
  g._islands.forEach(i => { i.updateFire = noop; i.setOnFire = noop; });
  return true;
}

/** Run one battle with a policy; returns raw metrics. */
async function runPolicy({ policy, capSec }) {
  const h = await import('/test/harness.js');
  const g = window._game, st = g._state, sess = g._opts.session;
  const ms = sess.missionSys, m = sess.mission, obj = m.objective || { type: 'sink_all' };
  const spawn = m.spawn || { x: -70, z: 0 };
  const alive = a => a.filter(s => s.alive);
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const centroid = ships => ({ x: ships.reduce((a, s) => a + s.x, 0) / ships.length, z: ships.reduce((a, s) => a + s.z, 0) / ships.length });
  const nearest = (arr, p) => arr.reduce((b, x) => (!b || d(x, p) < d(b, p) ? x : b), null);
  const forts = () => g._islands.filter(i => i.own === 'enemy' && !i.down && !i.def.decor);
  const RANGE = { 1: 8, 2: 20, 3: 40 };
  const CANNON = new Map();
  try { (await import('/frontend/src/data/cannons.js')).CANNONS.forEach(c => CANNON.set(c.id, c)); } catch {}
  const gunRange = s => Math.max(8, ...Object.values(s.loadout || {}).map(id => RANGE[CANNON.get(id)?.rt] || 0));
  const diag = { clicks: 0, misclicks: 0, abilities: { barrage: 0, winds: 0, repairs: 0 }, firstShotSec: null };
  const startHp = alive(st.playerShips).reduce((a, s) => a + s.maxHp, 0);

  // Issue an order through a real right-click; verify the order that resulted.
  const order = (tgt, kind) => {
    const ships = alive(st.playerShips);
    if (!ships.length) return;
    g._command.setSelection(ships);
    const want = o => (kind === 'ship' ? o?.type === 'attack' && o.target === tgt
      : kind === 'island' ? o?.type === 'siege' && o.target === tgt : o?.type === 'move');
    h.rightClick(tgt.x, tgt.z);
    diag.clicks++;
    if (ships.every(s => want(s.orders?.[0]))) return;
    // Target off-screen or overlapped: pan the camera there (like a player would) and click again.
    diag.misclicks++;
    if ((diag.missLog ||= []).length < 4) {
      const o = ships[0].orders?.[0];
      diag.missLog.push({ t: Math.round(ms.time), want: kind, tgt: tgt.nm || `${Math.round(tgt.x)},${Math.round(tgt.z)}`, got: o?.type || 'none', gotTgt: o?.target?.nm || null, sel: st.selection.length });
    }
    g._cam.jumpTo(tgt.x, tgt.z);
    h.step(45);
    g._command.setSelection(alive(st.playerShips));
    h.rightClick(tgt.x, tgt.z);
    // Still another ship under the cursor (they overlap): keep what the click gave, as a player would.
    if (!alive(st.playerShips).every(s => want(s.orders?.[0]))) diag.misclicks2 = (diag.misclicks2 || 0) + 1;
  };
  const busyWith = (tgt, type) => alive(st.playerShips).every(s => s.orders?.[0]?.type === type && s.orders[0].target === tgt);
  const ab = id => {
    const c = g._commander;
    if (!c?.tryUse || (c._cds?.[id] || 0) > 0) return;
    c.tryUse(id);
    diag.abilities[id]++;
  };

  const captureTarget = () => (obj.islands || []).map(id => g._islands.find(i => i.def.id === id)).find(i => i && i.own !== 'player');

  // sink_target: a player reads the objective and goes for the prize (ship.ai.prize) first.
  const prizeShips = () => obj.type === 'sink_target' ? alive(st.enemyShips).filter(s => s.ai?.prize) : [];

  function decideNovice() {
    const P = alive(st.playerShips); if (!P.length) return;
    const c = centroid(P), E = alive(st.enemyShips), F = forts();
    const PZ = prizeShips();
    if (PZ.length) { const t = nearest(PZ, c); if (!busyWith(t, 'attack')) order(t, 'ship'); return; }
    if (E.length) { const t = nearest(E, c); if (!busyWith(t, 'attack')) order(t, 'ship'); return; }
    if (F.length) { const t = nearest(F, c); if (!busyWith(t, 'siege')) order(t, 'island'); return; }
    const cap = obj.type === 'capture' ? captureTarget() : null;
    if (cap) { if (!busyWith(cap, 'siege')) order(cap, 'island'); return; }
    if (obj.type === 'survive' && d(c, spawn) > 14) order({ x: spawn.x, z: spawn.z }, 'point');
  }

  function decideSkilled() {
    const P = alive(st.playerShips); if (!P.length) return;
    const c = centroid(P), E = alive(st.enemyShips), F = forts();
    const reach = Math.max(...P.map(gunRange));
    // Abilities
    const hpFrac = P.reduce((a, s) => a + s.hp, 0) / P.reduce((a, s) => a + s.maxHp, 0);
    if (hpFrac < 0.6 || P.some(s => s.hp / s.maxHp < 0.35)) ab('repairs');
    const closeShip = E.some(e => P.some(p => d(p, e) < Math.min(reach, 20) + 2));
    const closeFort = F.some(f => P.some(p => d(p, f) < f.r + 14));
    if (closeShip || closeFort) ab('barrage');
    const nearE = E.length ? nearest(E, c) : (F.length ? nearest(F, c) : null);
    if (nearE && d(nearE, c) > 60) ab('winds');
    // Targets: the prize first (sink_target), then weakest ship in reach, else nearest ship; forts once the escorts are gone
    const PZ = prizeShips();
    if (PZ.length) { const t = nearest(PZ, c); if (!busyWith(t, 'attack')) order(t, 'ship'); return; }
    if (E.length) {
      const inReach = E.filter(e => P.some(p => d(p, e) < reach + 6));
      const t = inReach.length ? inReach.reduce((b, x) => (x.hp < b.hp ? x : b)) : nearest(E, c);
      if (!busyWith(t, 'attack')) order(t, 'ship');
      return;
    }
    if (F.length) { const t = nearest(F, c); if (!busyWith(t, 'siege')) order(t, 'island'); return; }
    const cap = obj.type === 'capture' ? captureTarget() : null;
    if (cap) { if (!busyWith(cap, 'siege')) order(cap, 'island'); return; }
    if (obj.type === 'survive' && d(c, spawn) > 14) order({ x: spawn.x, z: spawn.z }, 'point');
  }

  const every = policy === 'skilled' ? 2 : 5;
  let next = 0;
  const firedAt0 = st.stats.fired;
  while (!sess.done && ms.time < capSec) {
    if (ms.time >= next) { (policy === 'skilled' ? decideSkilled : decideNovice)(); next = ms.time + every; }
    h.step(30);
    if (diag.firstShotSec == null && st.stats.fired > firedAt0) diag.firstShotSec = Math.round(ms.time);
  }
  const P = st.playerShips;
  const afloat = alive(P);
  const sum = sess.summary || null;
  return {
    done: !!sess.done,
    won: !!sum?.won,
    reason: sess.done ? (sum?.won ? 'objective' : (ms.outcome?.reason || 'lost')) : 'cap',
    timeSec: Math.round(ms.time),
    ships: P.length,
    lost: P.length - afloat.length,
    hpAliveFrac: afloat.length ? afloat.reduce((a, s) => a + s.hp / s.maxHp, 0) / afloat.length : 0,
    fleetHpFrac: startHp ? afloat.reduce((a, s) => a + s.hp, 0) / startHp : 0,
    stars: sum?.stars || 0,
    plunder: sum?.plunder || { wood: 0, gold: 0 },
    reward: sum?.reward || { wood: 0, gold: 0 },
    renown: sum?.renown || 0,
    sunk: ms.sunk.length, escaped: ms.escaped?.length || 0,
    enemies: st.enemyShips.length,
    forts: ms.fortsDestroyed(), fortsTotal: ms.enemyFortIds.length,
    dmgDealt: Math.round(st.stats.dmgDealt), dmgTaken: Math.round(st.stats.dmgTaken),
    hitRate: st.stats.fired ? +(st.stats.hit / st.stats.fired).toFixed(3) : 0,
    parTime: m.parTime || null,
    enemyRoster: (m.enemies || []).map(e => e.hull).concat((obj.waves || []).flatMap(w => w.ships.map(s => s.hull))),
    shipResults: P.map(s => ({ hullId: s.hullId, sunk: !s.alive, hpFrac: s.alive ? +(s.hp / s.maxHp).toFixed(3) : 0 })),
    sunkClasses: ms.sunk.slice(),
    ...diag,
  };
}

// ── Runner ───────────────────────────────────────────────────────────
async function runOne(browser, port, scnId, scn, policy, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  try {
    await ctx.addInitScript(initScript, { seed });
    const page = await ctx.newPage();
    page.on('dialog', dlg => dlg.dismiss().catch(() => {}));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/__blank`);
    const fleet = await page.evaluate(writeProfile, { scn, seed, now: Date.now() });
    await page.goto(`http://127.0.0.1:${port}/frontend/?mode=battle&mission=${encodeURIComponent(scn.mission)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window._game?._opts?.session?.missionSys, null, { timeout: 60000 });
    await page.evaluate(installShims);
    const r = await page.evaluate(runPolicy, { policy, capSec: CAP_SEC });
    return { scenario: scnId, mission: scn.mission, policy, seed, fleet, ...r, pageErrors: [...new Set(errors)].slice(0, 3) };
  } catch (e) {
    return { scenario: scnId, mission: scn.mission, policy, seed, error: String(e.message || e).slice(0, 300), pageErrors: [...new Set(errors)].slice(0, 3) };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

export function summarize(runs) {
  const groups = new Map();
  for (const r of runs) {
    const k = `${r.scenario}|${r.policy}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, rs] of groups) {
    const ok = rs.filter(r => !r.error);
    const wins = ok.filter(r => r.won);
    const st = n => (wins.length ? wins.filter(r => r.stars === n).length / wins.length : 0);
    out.push({
      scenario: rs[0].scenario, mission: rs[0].mission, policy: rs[0].policy, n: ok.length, errors: rs.length - ok.length,
      winRate: ok.length ? wins.length / ok.length : 0,
      timeMean: Math.round(mean(ok.map(r => r.timeSec))), timeSd: Math.round(sd(ok.map(r => r.timeSec))),
      winTimeMean: Math.round(mean(wins.map(r => r.timeSec))),
      lostMean: +mean(ok.map(r => r.lost)).toFixed(2), anyLoss: ok.length ? ok.filter(r => r.lost > 0).length / ok.length : 0,
      hpAliveMean: +mean(ok.filter(r => r.ships > r.lost).map(r => r.hpAliveFrac)).toFixed(2),
      fleetHpMean: +mean(ok.map(r => r.fleetHpFrac)).toFixed(2), fleetHpSd: +sd(ok.map(r => r.fleetHpFrac)).toFixed(2),
      plunderWood: Math.round(mean(ok.map(r => r.plunder.wood))), plunderGold: Math.round(mean(ok.map(r => r.plunder.gold))),
      star1: +st(1).toFixed(2), star2: +st(2).toFixed(2), star3: +st(3).toFixed(2),
      parTime: rs[0].parTime, reasons: Object.fromEntries([...new Set(ok.map(r => r.reason))].map(x => [x, ok.filter(r => r.reason === x).length])),
      hitRate: +mean(ok.map(r => r.hitRate)).toFixed(2), misclicks: +mean(ok.map(r => r.misclicks || 0)).toFixed(1),
    });
  }
  return out;
}

export function markdown(summary, scenarios) {
  const pct = x => `${Math.round(x * 100)}%`;
  const lines = [
    '| Scenario | Mission | Fleet | Policy | N | Win | Time (s) mean±sd | Ships lost | Any loss | Fleet HP left | Plunder 🪵/🪙 | ★/★★/★★★ (of wins) | Par | Outcomes |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|',
  ];
  for (const s of summary) {
    const label = scenarios[s.scenario]?.label || '';
    lines.push(`| ${s.scenario} | ${s.mission} | ${label} | ${s.policy} | ${s.n}${s.errors ? ` (+${s.errors} err)` : ''} | **${pct(s.winRate)}** | ${s.timeMean}±${s.timeSd} | ${s.lostMean} | ${pct(s.anyLoss)} | ${pct(s.fleetHpMean)} | ${s.plunderWood}/${s.plunderGold} | ${pct(s.star1)}/${pct(s.star2)}/${pct(s.star3)} | ${s.parTime ?? '–'} | ${Object.entries(s.reasons).map(([k, v]) => `${k}:${v}`).join(' ')} |`);
  }
  return lines.join('\n');
}

async function main() {
  const scenarios = pickScenarios();
  const jobs = [];
  for (const [id, scn] of Object.entries(scenarios)) for (const policy of POLICIES) for (let k = 0; k < SEEDS; k++) jobs.push({ id, scn, policy, seed: SEED0 + k });
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const runs = [];
  const t0 = Date.now();
  let i = 0;
  try {
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        let r = await runOne(browser, port, j.id, j.scn, j.policy, j.seed);
        if (r.error) r = await runOne(browser, port, j.id, j.scn, j.policy, j.seed);   // one retry (boot hiccup)
        runs.push(r);
        if (!args.quiet) {
          const tag = r.error ? `ERROR ${r.error.slice(0, 80)}` : `${r.won ? 'WIN ' : 'LOSS'} ${String(r.timeSec).padStart(4)}s lost ${r.lost}/${r.ships} hp ${Math.round(r.fleetHpFrac * 100)}% ★${r.stars} (${r.reason})`;
          console.error(`[${runs.length}/${jobs.length}] ${j.id} ${j.policy} seed ${j.seed}: ${tag}`);
        }
      }
    }));
  } finally {
    await browser.close();
    srv.close();
  }
  runs.sort((a, b) => (a.scenario + a.policy).localeCompare(b.scenario + b.policy) || a.seed - b.seed);
  const order = Object.keys(scenarios);
  const summary = summarize(runs).sort((a, b) => order.indexOf(a.scenario) - order.indexOf(b.scenario) || a.policy.localeCompare(b.policy));
  await mkdir(OUT, { recursive: true });
  const meta = { tag: TAG, gitRef: GIT_REF, set: SET, date: new Date().toISOString(), seeds: SEEDS, seed0: SEED0, capSec: CAP_SEC, policies: POLICIES, wallSec: Math.round((Date.now() - t0) / 1000) };
  await writeFile(join(OUT, `battle_${TAG}.json`), JSON.stringify({ meta, scenarios, summary, runs }, null, 1));
  const md = `# Battle sim — ${TAG}${GIT_REF ? ` (balance files from git ${GIT_REF})` : ''}\n\n${meta.date} · ${SEEDS} seeds/scenario/policy · cap ${CAP_SEC}s · ${meta.wallSec}s wall\n\n${markdown(summary, scenarios)}\n`;
  await writeFile(join(OUT, `battle_${TAG}.md`), md);
  console.log(md);
  console.error(`wrote ${join(OUT, `battle_${TAG}.json`)} and .md`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
