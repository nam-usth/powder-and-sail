// QA: T04 T05 T06 T07 T08 T12 T15 T16 T18 T20(badge) T23 T24 T33 T34 + persistence
// Run: node tools/smoke.mjs --port 8190 --fresh --path /frontend/ --secs 7 --script tools/qa/harbor2.mjs
const EV = 'production/qa/evidence/';
export default async function (page) {
  const R = { shotErr: [] };
  const shot = async (n) => { try { await page.screenshot({ path: EV + n + '.png', timeout: 60000, animations: 'disabled' }); } catch (e) { R.shotErr.push(n); } };
  const ev = (f, a) => page.evaluate(f, a);
  const prof = () => ev(() => JSON.parse(JSON.stringify(window._game._opts.session.syncToProfile())));
  const toasts = () => ev(() => [...document.querySelectorAll('.toast')].map(t => t.innerText.trim().replace(/\s+/g, ' ')));
  const clickSel = (sel) => ev((s) => { const b = document.querySelector(s); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; }, sel);
  // Write a profile (mutator runs in page) and reload, stopping the live session from overwriting it.
  const inject = async (fnSrc, arg) => {
    await ev(([src, a]) => {
      const s = window._game._opts.session; s._flush(); s._leaving = true;
      const p = JSON.parse(localStorage.getItem('iow_profile_v1'));
      (new Function('p', 'a', src))(p, a);
      localStorage.setItem('iow_profile_v1', JSON.stringify(p));
    }, [fnSrc, arg]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  };
  const offlineCard = () => ev(() => { const c = [...document.querySelectorAll('div,section,aside')].find(e => /While you were away|Khi bạn vắng/i.test(e.innerText || '') && e.offsetParent && e.children.length < 30); return c ? c.innerText.replace(/\s+/g, ' ').slice(0, 200) : null; });

  // ── T04: away 2 min ──
  const p0 = await prof();
  await inject(`p.lastSeen = Date.now() - 120000; p.res = {wood: 100, gold: 100};`);
  const p1 = await prof();
  R.T04 = { card: await offlineCard(), gained: { wood: p1.res.wood - 100, gold: p1.res.gold - 100 }, expect: { wood: 120, gold: 75 } };
  await shot('qa_T04_offline_card');
  await page.waitForTimeout(15000);
  R.T04.cardAfter15s = await offlineCard();
  // ── T05: away 30 s ──
  await inject(`p.lastSeen = Date.now() - 30000; p.res = {wood: 100, gold: 100};`);
  const p5 = await prof();
  R.T05 = { card: await offlineCard(), gained: { wood: p5.res.wood - 100, gold: p5.res.gold - 100 } };
  // ── T06: away 10 h ──
  await inject(`p.lastSeen = Date.now() - 36000e3; p.res = {wood: 0, gold: 0}; p.harbor.buildings.push({buildingId:'warehouse',gridKey:'5_7',level:1,state:'active'});`);
  const p6 = await prof();
  R.T06 = { res: p6.res, card: await offlineCard(), whPlaced: p6.harbor.buildings.some(b => b.buildingId === 'warehouse') };
  // ── T07: future lastSeen ──
  await inject(`p.lastSeen = Date.now() + 36000e3; p.res = {wood: 50, gold: 50};`);
  const p7 = await prof();
  R.T07 = { res: p7.res, card: await offlineCard(), lastSeenNowish: Math.abs(p7.lastSeen - Date.now()) < 10000 };

  // ── setup for shipyard flows: 4 ready + 1 damaged + 1 wreck ──
  await inject(`
    const mk = (hullId, nm, o) => ({ uid: 'qa_' + nm, hullId, nm, hpFrac: 1, status: 'ready', readyAt: 0, loadout: hullId==='sloop'?{L:'falconet',R:'falconet'}:{L:'falconet',R:'falconet'}, upgrades:{spd:0,hp:0,rof:0}, battles:0, sinks:0, ...o });
    p.fleet = p.fleet.slice(0, 3);
    p.fleet.push(mk('cutter', 'QA Cutter', {}));
    p.fleet[1].hpFrac = 0.5;
    p.fleet.push(mk('sloop', 'QA Wreck', { status: 'wreck', hpFrac: 0 }));
    p.res = { wood: 700, gold: 500 }; p.lastSeen = Date.now();`);
  // T20 badge
  R.T20badge = await ev(() => { const b = document.querySelector('[data-f="yardN"]'); return b && { hidden: b.hidden, text: b.innerText, bad: b.classList.contains('is-bad') }; });
  await shot('qa_T20_wreck_badge');
  // T18 briefing
  await ev(() => window._game._opts.session.ui.chart.openBriefing('reef_1'));
  await page.waitForTimeout(800);
  R.T18 = await ev(() => ({ checked: [...document.querySelectorAll('.wc-chk')].filter(c => c.checked).length, total: document.querySelectorAll('.wc-chk').length,
    selN: document.querySelector('[data-f2="selN"]')?.innerText }));
  const offChk = await ev(() => { const c = [...document.querySelectorAll('.wc-chk')].find(c => !c.checked && !c.disabled); if (!c) return 'none-enabled'; c.click(); return 'clicked:' + c.checked; });
  await page.waitForTimeout(300);
  R.T18.tick4th = offChk; R.T18.toasts = await toasts();
  R.T18.disabledOffCount = await ev(() => [...document.querySelectorAll('.wc-chk')].filter(c => c.disabled).length);
  await shot('qa_T18_briefing');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await ev(() => window._game._opts.session.ui.chart.close?.());

  // T24 repair damaged ship
  await page.keyboard.press('y'); await page.waitForTimeout(500);
  const b24 = await prof();
  const dmg = b24.fleet.find(s => s.hpFrac < 0.99 && s.status === 'ready');
  R.T24 = { hpFrac: dmg?.hpFrac, hull: dmg?.hullId };
  R.T24.quoteUI = await ev((u) => document.querySelector(`[data-key="${u}"] [data-q="repair-g"]`)?.innerText, dmg?.uid);
  R.T24.click = await clickSel(`[data-act="repair"][data-uid="${dmg?.uid}"]`);
  await page.waitForTimeout(400);
  const a24 = await prof();
  R.T24.goldSpent = b24.res.gold - a24.res.gold;
  R.T24.expect = Math.ceil((1 - dmg.hpFrac) * (dmg.hullId === 'sloop' ? 40 : 80));
  R.T24.status = a24.fleet.find(s => s.uid === dmg.uid)?.status;
  R.T24.inScene = await ev((u) => window._game._state.playerShips.some(s => s.uid === u), dmg.uid);
  // T23 salvage wreck
  const b23 = await prof();
  R.T23 = { click: await clickSel('[data-act="salvage"][data-uid="qa_QA Wreck"]') };
  await page.waitForTimeout(400);
  const a23 = await prof();
  const w = a23.fleet.find(s => s.uid === 'qa_QA Wreck');
  R.T23.cost = { wood: b23.res.wood - a23.res.wood, gold: b23.res.gold - a23.res.gold };
  R.T23.status = w?.status; R.T23.secs = w && Math.round((w.readyAt - Date.now()) / 1000);
  R.T23.cardLabel = await ev(() => document.querySelector('[data-key="qa_QA Wreck"]')?.innerText.replace(/\s+/g, ' '));
  await shot('qa_T23_salvaging');
  // T12 rush (on the salvage)
  const b12 = await prof();
  const rw = b12.fleet.find(s => s.uid === 'qa_QA Wreck');
  R.T12 = { expect: Math.max(5, Math.ceil((rw.readyAt - Date.now()) / 2000)), click: await clickSel('[data-act="rush"][data-uid="qa_QA Wreck"]') };
  await page.waitForTimeout(1500);
  const a12 = await prof();
  R.T12.goldSpent = b12.res.gold - a12.res.gold;
  const rw2 = a12.fleet.find(s => s.uid === 'qa_QA Wreck');
  R.T12.after = { status: rw2?.status, hpFrac: rw2?.hpFrac };
  R.T12.toasts = await toasts();
  R.T12.inScene = await ev(() => window._game._state.playerShips.some(s => s.uid === 'qa_QA Wreck'));
  await shot('qa_T12_rush_done');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // T15/T16 loadout panel
  await ev(() => { const st = window._game._state; const b = st.playerShips.find(s => s.hullId === 'brigantine'); st.selection = [b]; });
  await page.keyboard.press('l'); await page.waitForTimeout(800);
  R.T15 = await ev(() => {
    const card = id => { const c = document.getElementById('lp2-cn-' + id); return c && { locked: c.classList.contains('locked'), title: c.title }; };
    const nm = document.querySelector('.lp2-nm')?.innerText;
    const locked = [...document.querySelectorAll('.lp2-cn-card.locked')].map(c => c.dataset.cannon);
    const open = [...document.querySelectorAll('.lp2-cn-card:not(.locked)')].map(c => c.dataset.cannon);
    return { ship: nm, cannon_royal: card('cannon_royal'), demi_can: card('demi_can'), locked, open };
  });
  await ev(() => document.getElementById('lp2-cn-cannon_royal')?.click());
  R.T15.hint = await ev(() => document.getElementById('lp2-hint')?.innerText);
  R.T15.picked = await ev(() => document.querySelector('.lp2-cn-card.picked')?.dataset.cannon || null);
  await shot('qa_T15_loadout_brig');
  // T16 sloop: navigate
  for (let i = 0; i < 6; i++) {
    const nm = await ev(() => document.querySelector('.lp2-sub .lp2-hull-badge')?.innerText);
    if (nm === 'light') break;
    await ev(() => document.getElementById('lp2-next')?.click()); await page.waitForTimeout(200);
  }
  R.T16 = await ev(() => ({ ship: document.querySelector('.lp2-nm')?.innerText, hull: document.querySelector('.lp2-hull-badge')?.innerText,
    open: [...document.querySelectorAll('.lp2-cn-card:not(.locked)')].map(c => c.dataset.cannon),
    slots: [...document.querySelectorAll('.lp2-slot')].map(s => s.dataset.slot + ':' + (s.querySelector('.lp2-slot-lbl')?.innerText || '')) }));
  // Upgrades tab in harbor: spend real resources?
  await ev(() => document.querySelector('.lp2-pill[data-tab="upgrades"]')?.click()); await page.waitForTimeout(300);
  R.upgradesTab = await ev(() => [...document.querySelectorAll('.lp2-upg-row')].map(r => r.innerText.replace(/\s+/g, ' ')));
  await shot('qa_T16_loadout_sloop_upgrades');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // T33 Q toggles
  const q0 = await ev(() => ({ chip: document.getElementById('gfx-chip-val')?.innerText, ls: localStorage.getItem('iow_gfx') || Object.keys(localStorage).filter(k => /gfx/i.test(k)).map(k => k + '=' + localStorage.getItem(k)).join(';') }));
  await page.keyboard.press('q'); await page.waitForTimeout(500);
  const q1 = await ev(() => ({ chip: document.getElementById('gfx-chip-val')?.innerText, shadows: window._game._renderer.instance.shadowMap.enabled, refl: window._game._graphicsHigh, pr: window._game._renderer.instance.getPixelRatio() }));
  await shot('qa_T33_gfx_after_q');
  R.T33 = { before: q0, afterQ: q1 };

  // T08 build a building, reload
  R.T08 = await ev(async () => {
    const g = window._game, st = g._state, isl = g._islands[0];
    const { BUILDINGS } = await import('/frontend/src/data/buildings.js');
    const def = BUILDINGS.find(b => b.id === 'lumber_mill');
    st.resWood = 2000; st.resGold = 2000;
    st.selectedBuilding = def; st.buildMode = true; g._build.showGrid(isl);
    const cell = g._build._cells(isl).find(c => g._build.canPlaceFootprint(isl, c.key, def.footprint || { w: 1, h: 1 }));
    g._build.tryBuildAt(cell.cx, cell.cz, isl);
    st.buildMode = false; st.selectedBuilding = null; g._build.clearGrid();
    const inst = st.islandBuildings[isl.def.id].find(i => i.gridKey === cell.key);
    return { key: cell.key, state: inst?.state, timer: inst?.buildTimer, dur: inst?.buildDuration };
  });
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  R.T08.after = await ev((k) => { const st = window._game._state; const i = st.islandBuildings[window._game._islands[0].def.id].find(i => i.gridKey === k); return i && { id: i.buildingId, state: i.state, timer: i.buildTimer, level: i.level }; }, R.T08.key);
  R.T33.afterReload = await ev(() => document.getElementById('gfx-chip-val')?.innerText);

  // T34 Vietnamese
  await ev(async () => { const m = await import('/frontend/src/i18n.js'); m.setLang('vi'); });
  await page.waitForTimeout(800);
  R.T34 = { bar: await ev(() => document.querySelector('.hb, [class*="harbor-bar"], [class^="hb-"]')?.closest('div')?.innerText?.replace(/\s+/g, ' ').slice(0, 200)) };
  await page.keyboard.press('y'); await page.waitForTimeout(500);
  R.T34.shipyard = await ev(() => document.querySelector('.sy-title')?.innerText + ' | ' + [...document.querySelectorAll('.sy-tab')].map(t => t.innerText).join(','));
  await shot('qa_T34_vi_shipyard');
  await page.keyboard.press('w'); await page.waitForTimeout(600);
  R.T34.chart = await ev(() => document.querySelector('.wc-node .wc-lbl')?.innerText + ' | ' + [...document.querySelectorAll('.wc-rtag-nm')].map(t => t.innerText).join(','));
  await shot('qa_T34_vi_chart');
  R.T34.englishLeft = await ev(() => { const t = document.body.innerText; return ['Build', 'Research', 'Loadout', 'Shipyard', 'World Chart', 'Set Sail', 'ready', 'Captain'].filter(w => new RegExp('\\b' + w + '\\b').test(t)); });
  await ev(async () => { const m = await import('/frontend/src/i18n.js'); m.setLang('en'); });
  return R;
}
