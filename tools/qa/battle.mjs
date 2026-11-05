// QA battle driver. Env:
//   MISSION=reef_1|reef_2|reef_3|straits_2|patrol|...   SETUP=<js mutating profile p>   ACT=win|retreat|reload|abilities
//   K=<max 10-second chunks>  TAG=<evidence prefix>
// Run: MISSION=reef_1 node tools/smoke.mjs --port 8190 --fresh --path /frontend/ --secs 7 --script tools/qa/battle.mjs
const EV = 'production/qa/evidence/';
export default async function (page) {
  const mission = process.env.MISSION || 'reef_1';
  const ACT = process.env.ACT || 'win';
  const TAG = process.env.TAG || ('qa_' + mission + '_' + ACT);
  const R = { mission, act: ACT };
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  const shot = async (n) => { try { await page.screenshot({ path: EV + n + '.png', timeout: 60000, animations: 'disabled' }); } catch {} };
  if (process.env.SETUP) {
    await ev((s) => { const ses = window._game._opts.session; ses._flush(); ses._leaving = true;
      const p = JSON.parse(localStorage.getItem('iow_profile_v1')); (new Function('p', s))(p); localStorage.setItem('iow_profile_v1', JSON.stringify(p)); }, process.env.SETUP);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  R.before = await ev(() => { const p = window._game._opts.session.syncToProfile(); return { res: { ...p.res }, renown: p.renown, fleet: p.fleet.map(s => s.hullId + ':' + s.status + ':' + s.hpFrac.toFixed(2)), won: { ...p.campaign.won }, stars: { ...p.campaign.stars } }; });
  if (process.env.GFX) await ev((q) => window.setGfxQuality(q), process.env.GFX);
  await ev((m) => {
    const ses = window._game._opts.session;
    ses.setSail({ missionId: m, shipUids: ses.profile.fleet.filter(s => s.status === 'ready').slice(0, 3).map(s => s.uid), seed: 7 });
  }, mission);
  await page.waitForURL(/mode=battle/, { timeout: 30000, waitUntil: 'commit' });
  await page.waitForFunction(() => window._game?._opts?.session?.missionSys, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  R.startUrl = page.url();
  R.hudStart = await ev(() => ({ obj: document.getElementById('objectives')?.innerText.replace(/\s+/g, ' '), vs: document.getElementById('vs-bar')?.innerText.replace(/\s+/g, ' ') }));
  await shot(TAG + '_start');

  if (ACT === 'reload') {
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => document.querySelector('.toast') || window._game?._opts?.session?.ui, null, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.toast'), null, { timeout: 8000 }).catch(() => {});
    R.afterReload = { url: page.url(), toasts: await ev(() => [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\s+/g, ' '))),
      prof: await ev(() => { const p = window._game?._opts?.session?.profile; return p && { res: p.res, battle: p.battle, fleet: p.fleet.map(s => s.hullId + ':' + s.status + ':' + s.hpFrac.toFixed(2)), stats: p.stats }; }) };
    await shot(TAG + '_after');
    return R;
  }
  if (ACT === 'abilities') {
    R.abil = [];
    for (const k of ['z', 'x', 'c', 'z']) {
      await page.keyboard.press(k); await page.waitForTimeout(400);
      R.abil.push(k + ': ' + (await ev(() => [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\s+/g, ' ')).slice(-2).join(' / '))));
    }
    // economy hotkeys should be inert in battle (known issue 13.3.1 fix)
    for (const k of ['l', 'b', 'r', 'v', 'o', 'm']) { await page.keyboard.press(k); await page.waitForTimeout(250); }
    R.panelsOpen = await ev(() => [...document.querySelectorAll('.panel.open, .modal.open, [class*="panel"].open')].map(e => e.id || e.className).slice(0, 8));
    R.res = await ev(() => [window._game._state.resWood, window._game._state.resGold]);
    await shot(TAG + '_keys');
    return R;
  }
  if (ACT === 'retreat') {
    // fight a little first so there is some plunder, then retreat
    await ev(async () => { const h = await import('/test/harness.js'); const g = window._game, st = g._state; g._renderer.render = () => {};
      for (let k = 0; k < 6; k++) { const e = st.enemyShips.find(s => s.alive); if (e) { st.selection = st.playerShips.filter(s => s.alive); h.rightClick(e.x, e.z); } h.step(600); if (st.enemyShips.filter(s => s.alive).length < st.enemyShips.length) break; } });
    R.sunkBefore = await ev(() => window._game._opts.session.missionSys.sunk);
    page.once('dialog', d => d.accept());
    await ev(() => document.getElementById('retreat-btn').click());
    await page.waitForTimeout(2500);
  } else {
    const K = +(process.env.K || 30);
    R.log = await ev(async (K) => {
      const h = await import('/test/harness.js');
      const g = window._game, st = g._state, ms = g._opts.session.missionSys;
      g._renderer.render = () => {};
      const log = [];
      for (let k = 0; k < K && !st.gameOver; k++) {
        const e = st.enemyShips.filter(s => s.alive).sort((a, b) => a.x - b.x)[0];
        const f = g._islands.find(i => i.own === 'enemy' && !i.down && !i.def.decor);
        const cap = (ms.mission.objective.islands || []).map(id => g._islands.find(i => i.def.id === id)).find(i => i && i.own !== 'player');
        const t = f || e || cap;
        if (t) { st.selection = st.playerShips.filter(s => s.alive); h.rightClick(t.x + (t === cap ? -8 : 0), t.z); }
        h.step(600);
        log.push({ t: Math.round(ms.time), p: st.playerShips.filter(s => s.alive).map(s => Math.round(s.hp)), e: st.enemyShips.filter(s => s.alive).map(s => Math.round(s.hp)),
          isl: g._islands.filter(i => !i.def.decor).map(i => i.def.id + ':' + i.own + ':' + Math.round(i.hp) + (i.down ? ':down' : '')),
          vs: document.getElementById('vs-foe-n')?.textContent, clock: document.getElementById('vs-clock')?.textContent });
      }
      return log;
    }, K);
    await page.waitForTimeout(2500);
  }
  R.summary = await ev(() => window._game._opts.session.summary);
  R.resultText = await ev(() => { const c = document.querySelector('.br-card, [class*="result"], .mx-modal'); return c?.innerText.replace(/\s+/g, ' ').slice(0, 400); });
  R.buttons = await ev(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && /retry|return|harbor|port|home/i.test(b.innerText + b.dataset.act)).map(b => b.innerText.trim() + '[' + (b.dataset.act || '') + ']'));
  R.after = await ev(() => { const p = window._game._opts.session.profile; return { res: { ...p.res }, renown: p.renown, fleet: p.fleet.map(s => s.hullId + ':' + s.status + ':' + s.hpFrac.toFixed(2)), won: { ...p.campaign.won }, stars: { ...p.campaign.stars }, patrolsWon: p.campaign.patrolsWon, completedAt: p.campaign.completedAt, battle: p.battle }; });
  R.states = await ev(async () => { const C = await import('/frontend/src/Meta/Campaign.js'); const D = await import('/frontend/src/data/campaign.js'); const p = window._game._opts.session.profile; return Object.fromEntries(D.MISSIONS.slice(0, 6).map(m => [m.id, C.missionState(p, m)])); });
  await shot(TAG + '_result');
  // return to harbor via the result button and check console stays clean
  const ret = await ev(() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && /return|harbor|port/i.test(b.innerText + (b.dataset.act || ''))); if (b) { b.click(); return b.innerText.trim(); } return null; });
  R.returnBtn = ret;
  if (ret) { await page.waitForURL(/mode=harbor/, { timeout: 30000, waitUntil: 'commit' }).catch(() => {}); await page.waitForTimeout(6000); R.backUrl = page.url();
    R.harborBadge = await ev(() => { const b = document.querySelector('[data-f="yardN"]'); return b && { hidden: b.hidden, text: b.innerText, bad: b.classList.contains('is-bad') }; });
    await shot(TAG + '_back_harbor'); }
  return R;
}
