// QA: harbor-mode cases T01 T02 T03 T09 T10 T11 T12 T13 T14 T16 T17 T18
// Run: node tools/smoke.mjs --port 8190 --fresh --path /frontend/ --secs 7 --out production/qa/evidence --script tools/qa/harbor.mjs
export default async function (page) {
  const R = {}; R.shotErr = [];
  const shot = async (n) => { try { await page.screenshot({ path: `production/qa/evidence/${n}.png`, timeout: 90000 }); } catch (e) { R.shotErr.push(n + ': ' + String(e).slice(0, 80)); } };
  const ev = (f, a) => page.evaluate(f, a);
  const prof = () => ev(() => JSON.parse(JSON.stringify(window._game._opts.session.syncToProfile())));
  const toasts = () => ev(() => [...document.querySelectorAll('.toast')].map(t => t.innerText.trim()));

  // T01
  R.T01 = await ev(() => {
    const g = window._game, p = g._opts.session.profile;
    return {
      mode: g._mode, res: p.res, fleet: p.fleet.map(s => [s.hullId, s.nm, s.status]),
      blds: p.harbor.buildings.map(b => b.buildingId + ':' + b.level),
      shipsInScene: g._state.playerShips.length,
      bar: document.querySelector('.hb-rank, [class*="rank"]')?.innerText || document.body.innerText.match(/Captain[\s\S]{0,20}/)?.[0],
    };
  });
  await shot('qa_T01_harbor_fresh');
  // T02
  R.T02 = await ev(() => {
    const vis = id => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.offsetParent !== null; };
    const st = window._game._state;
    return { warFront: vis('war-front') ?? vis('warfront-hud'), objectives: vis('objectives'), revive: vis('revive-btn'), empire: vis('empire-btn'),
      waveTimer: vis('wave-timer'), enemies: st.enemyShips.length,
      visibleIds: [...document.querySelectorAll('[id]')].filter(e => e.offsetParent && /war|wave|revive|empire|objective/i.test(e.id)).map(e => e.id) };
  });
  // T03 — 10 s of game time through the harness
  R.T03 = await ev(async () => {
    const h = await import('/test/harness.js');
    const st = window._game._state;
    const w0 = st.resWood, g0 = st.resGold;
    h.step(600);
    return { dWood: +(st.resWood - w0).toFixed(2), dGold: +(st.resGold - g0).toFixed(2), hud: [...document.querySelectorAll('.res-chip, [class*="res"]')].map(e => e.innerText).filter(t => /\/s/.test(t)).slice(0, 2) };
  });
  // T09 — Y, W, Esc
  await page.keyboard.press('y'); await page.waitForTimeout(400);
  const syOpen1 = await ev(() => window._game._opts.session.ui.shipyard.isOpen());
  await shot('qa_T09_shipyard_open');
  await page.keyboard.press('w'); await page.waitForTimeout(500);
  const t9b = await ev(() => ({ sy: window._game._opts.session.ui.shipyard.isOpen(), ch: window._game._opts.session.ui.chart.isOpen() }));
  await shot('qa_T17_chart_fresh');
  // T17 chart state from DOM + logic
  R.T17 = await ev(async () => {
    const C = await import('/frontend/src/Meta/Campaign.js');
    const D = await import('/frontend/src/data/campaign.js');
    const p = window._game._opts.session.profile;
    return { missions: Object.fromEntries(D.MISSIONS.map(m => [m.id, C.missionState(p, m)])),
      regions: Object.fromEntries(D.REGIONS.map(r => [r.id, C.regionUnlocked(p, r.id)])) };
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const t9c = await ev(() => ({ sy: window._game._opts.session.ui.shipyard.isOpen(), ch: window._game._opts.session.ui.chart.isOpen() }));
  R.T09 = { afterY: syOpen1, afterW: t9b, afterEsc: t9c };

  // T10 — Build tab
  await page.keyboard.press('y'); await page.waitForTimeout(300);
  await page.click('.sy-tab[data-tab="build"]').catch(e => R.err10 = String(e));
  await page.waitForTimeout(300);
  await shot('qa_T10_build_tab');
  R.T10 = await ev(() => ({
    tiers: [...document.querySelectorAll('.sy-tier-state')].map(e => e.innerText.trim()),
    sloopBtnDisabled: document.querySelector('[data-act="build"][data-hull="sloop"]')?.disabled,
  }));
  // give enough resources for two builds
  await ev(() => { const s = window._game._opts.session; s.game._state.resWood = 700; s.game._state.resGold = 500; s.syncToProfile(); s.ui.shipyard.refresh?.(); });
  const pb = await prof();
  await page.click('[data-act="build"][data-hull="sloop"]').catch(e => R.err10b = String(e));
  await page.waitForTimeout(400);
  const pa = await prof();
  const newShip = pa.fleet.find(s => !pb.fleet.some(x => x.uid === s.uid));
  R.T10.cost = { wood: pb.res.wood - pa.res.wood, gold: pb.res.gold - pa.res.gold };
  R.T10.newShip = newShip && { hull: newShip.hullId, status: newShip.status, secs: Math.round((newShip.readyAt - Date.now()) / 1000), loadout: newShip.loadout };
  // T11 — second build with 1 shipyard
  await page.click('.sy-tab[data-tab="build"]').catch(() => {});
  await page.waitForTimeout(200);
  R.T11 = await ev(() => ({
    cutterDisabled: document.querySelector('[data-act="build"][data-hull="cutter"]')?.disabled,
    why: [...document.querySelectorAll('.sy-why')].map(e => e.innerText.trim()).slice(0, 3),
    title: document.querySelector('[data-act="build"][data-hull="cutter"]')?.title,
  }));
  await shot('qa_T11_slipway_busy');
  // T12 — Rush
  await page.click('.sy-tab[data-tab="roster"]').catch(() => {});
  await page.waitForTimeout(200);
  const before12 = await prof();
  const rs = before12.fleet.find(s => s.status === 'building');
  const expectRush = rs ? Math.max(5, Math.ceil((rs.readyAt - Date.now()) / 2000)) : null;
  await page.click(`[data-act="rush"][data-uid="${rs?.uid}"]`).catch(e => R.err12 = String(e));
  await page.waitForTimeout(1600);
  const after12 = await prof();
  R.T12 = { expectRushApprox: expectRush, goldSpent: before12.res.gold - after12.res.gold,
    status: after12.fleet.find(s => s.uid === rs?.uid)?.status, toasts: await toasts(),
    sceneShips: await ev(() => window._game._state.playerShips.length) };
  await shot('qa_T12_after_rush');
  // T16 — loadout of new sloop (profile) checked above; also check Loadout panel lock list
  // T14 — scrap a sloop with confirmation
  const sloop = after12.fleet.find(s => s.hullId === 'sloop' && s.status === 'ready');
  const b14 = await prof();
  await page.click(`[data-act="scrap"][data-uid="${sloop.uid}"]`).catch(e => R.err14 = String(e));
  await page.waitForTimeout(200);
  const confirmShown = await ev(() => !!document.querySelector('[data-act="scrap-yes"]'));
  await shot('qa_T14_scrap_confirm');
  await page.click(`[data-act="scrap-yes"][data-uid="${sloop.uid}"]`).catch(e => R.err14b = String(e));
  await page.waitForTimeout(500);
  const a14 = await prof();
  R.T14 = { confirmShown, refund: { wood: a14.res.wood - b14.res.wood, gold: a14.res.gold - b14.res.gold },
    gone: !a14.fleet.some(s => s.uid === sloop.uid), sceneShips: await ev(() => window._game._state.playerShips.length) };
  // T13 — scrap until one ship left
  R.T13 = await ev(async () => {
    const s = window._game._opts.session, p = s.syncToProfile();
    const Y = await import('/frontend/src/Meta/Shipyard.js');
    while (p.fleet.length > 1) Y.scrapShip(p, p.fleet[p.fleet.length - 1].uid);
    s.syncFromProfile(); s._flush(); s.ui.shipyard.refresh?.();
    await new Promise(r => setTimeout(r, 300));
    const b = document.querySelector('[data-act="scrap"]');
    return { fleet: p.fleet.length, disabled: b?.disabled, title: b?.title };
  });
  await shot('qa_T13_last_ship');
  await page.keyboard.press('Escape');
  return R;
}
