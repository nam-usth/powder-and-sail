// QA: objective-logic check with an invulnerable player fleet (player HP refilled every 10 s).
// Verifies win conditions (T27 survive, T28 destroy_forts, T29 capture) independent of balance,
// and logs whether ships keep damaging a fort they were ordered to attack.
// Env: MISSION, SETUP, K. Run like tools/qa/battle.mjs.
const EV = 'production/qa/evidence/';
export default async function (page) {
  const mission = process.env.MISSION || 'reef_2';
  const R = { mission };
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  if (process.env.SETUP) {
    await ev((s) => { const ses = window._game._opts.session; ses._flush(); ses._leaving = true;
      const p = JSON.parse(localStorage.getItem('iow_profile_v1')); (new Function('p', s))(p); localStorage.setItem('iow_profile_v1', JSON.stringify(p)); }, process.env.SETUP);
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  }
  await ev((m) => { const ses = window._game._opts.session; ses.setSail({ missionId: m, shipUids: ses.profile.fleet.filter(s => s.status === 'ready').slice(0, 3).map(s => s.uid), seed: 7 }); }, mission);
  await page.waitForURL(/mode=battle/, { timeout: 30000, waitUntil: 'commit' });
  await page.waitForFunction(() => window._game?._opts?.session?.missionSys, null, { timeout: 90000 });
  R.log = await ev(async (K) => {
    const h = await import('/test/harness.js');
    const g = window._game, st = g._state, ms = g._opts.session.missionSys;
    g._renderer.render = () => {};
    const log = [];
    const capIds = ms.mission.objective.islands || [];
    for (let k = 0; k < K && !st.gameOver; k++) {
      st.playerShips.forEach(s => { if (s.alive) s.hp = s.maxHp; });
      const f = g._islands.find(i => i.own === 'enemy' && !i.down && !i.def.decor && (i.hp > 0));
      const cap = capIds.map(id => g._islands.find(i => i.def.id === id)).find(i => i && i.own !== 'player');
      const e = st.enemyShips.filter(s => s.alive)[0];
      const t = f || cap || e;
      if (t) { st.selection = st.playerShips.filter(s => s.alive); h.rightClick(t.x - (t === f ? 0 : 6), t.z); }
      h.step(600);
      const fort = g._islands.find(i => !i.def.decor && i.def.own === 'enemy');
      log.push({ t: Math.round(ms.time), e: st.enemyShips.filter(s => s.alive).map(s => Math.round(s.hp)).join(','),
        isl: g._islands.filter(i => !i.def.decor).map(i => `${i.def.id}:${i.own}:${Math.round(i.hp)}${i.down ? ':down' : ''}`).join(' '),
        dist: fort ? st.playerShips.filter(s => s.alive).map(s => Math.round(Math.hypot(s.x - fort.x, s.z - fort.z))).join(',') : '',
        order: g._orders?.describe?.(st.playerShips[0]), prog: ms.progress().map(p => p.key + '=' + p.value).join(' '),
        vs: document.getElementById('vs-foe-n')?.textContent, clock: document.getElementById('vs-clock')?.textContent });
    }
    return log;
  }, +(process.env.K || 40));
  await page.waitForTimeout(2000);
  R.summary = await ev(() => window._game._opts.session.summary);
  try { await page.screenshot({ path: EV + 'qa_logic_' + mission + '.png', timeout: 60000, animations: 'disabled' }); } catch {}
  return R;
}
