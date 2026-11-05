// QA: T04/T05/T06/T07 offline card + T08 timer continuation across reload
// Run: node tools/smoke.mjs --port 8190 --fresh --path /frontend/ --secs 7 --script tools/qa/offline.mjs
const EV = 'production/qa/evidence/';
export default async function (page) {
  const R = {};
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { try { await page.screenshot({ path: EV + n + '.png', timeout: 60000, animations: 'disabled' }); } catch {} };
  const inject = async (src) => {
    await ev((s) => { const ses = window._game._opts.session; ses._flush(); ses._leaving = true;
      const p = JSON.parse(localStorage.getItem('iow_profile_v1')); (new Function('p', s))(p); localStorage.setItem('iow_profile_v1', JSON.stringify(p)); }, src);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const card = () => ev(() => { const c = document.querySelector('.hb-away'); return c ? c.innerText.replace(/\s+/g, ' ') : null; });
  const rep = () => ev(() => window._game._opts.session.offline);
  await inject(`p.lastSeen = Date.now() - 120000; p.res = {wood: 100, gold: 100};`);
  R.T04 = { card: await card(), report: await rep() };
  await shot('qa_T04_offline_card');
  await page.waitForTimeout(14500);
  R.T04.after14s = await card();
  await inject(`p.lastSeen = Date.now() - 30000; p.res = {wood: 100, gold: 100};`);
  R.T05 = { card: await card(), report: await rep() };
  await inject(`p.lastSeen = Date.now() - 36000e3; p.res = {wood: 0, gold: 0};`);
  R.T06 = { card: await card(), report: await rep() };
  await inject(`p.lastSeen = Date.now() + 36000e3; p.res = {wood: 50, gold: 50};`);
  R.T07 = { card: await card(), report: await rep() };
  // T08 timer continuation: a building with 300 s left
  await inject(`p.lastSeen = Date.now(); p.harbor.buildings.push({buildingId:'gold_mine',gridKey:'0_0',level:1,state:'building',buildTimer:300,buildDuration:300});`);
  R.T08 = await ev(() => { const st = window._game._state; const i = st.islandBuildings[window._game._islands[0].def.id].find(i => i.gridKey === '0_0'); return i && { state: i.state, timer: Math.round(i.buildTimer) }; });
  // offline advance of the same building by 100 s
  await inject(`p.lastSeen = Date.now() - 100000;`);
  R.T08.after100sAway = await ev(() => { const st = window._game._state; const i = st.islandBuildings[window._game._islands[0].def.id].find(i => i.gridKey === '0_0'); return i && { state: i.state, timer: Math.round(i.buildTimer) }; });
  R.T08.card = await card();
  return R;
}
