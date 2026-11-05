// QA: T26 (battle URL without pending battle), T32 (Open War), T33 in skirmish, skirmish console.
// Run: node tools/smoke.mjs --port 8190 --fresh --path /frontend/ --secs 7 --script tools/qa/misc.mjs
const EV = 'production/qa/evidence/';
export default async function (page) {
  const R = {};
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { try { await page.screenshot({ path: EV + n + '.png', timeout: 60000, animations: 'disabled' }); } catch {} };
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  // T26
  await page.goto(page.url().replace(/\/frontend\/.*/, '/frontend/?mode=battle&mission=reef_1'), { waitUntil: 'commit' });
  await page.waitForTimeout(9000);
  R.T26 = { url: page.url(), mode: await ev(() => window._game?._mode) };
  // T32
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  const before = await ev(() => { const s = window._game._opts.session; s._flush(); const p = JSON.parse(localStorage.getItem('iow_profile_v1')); delete p.lastSeen; return JSON.stringify(p); });
  await ev(() => window._game._opts.session.ui.chart.openBriefing('open_war'));
  await page.waitForTimeout(800);
  await shot('qa_T32_openwar_brief');
  R.T32 = { warBtn: await ev(() => { const b = document.querySelector('[data-act="war"]'); if (!b) return null; const t = b.innerText.trim(); b.click(); return t; }) };
  await page.waitForURL(/mode=skirmish/, { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
  await page.waitForFunction(() => window._game?._state, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  R.T32.url = page.url();
  R.T32.hud = await ev(() => { const vis = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; };
    return { warFront: [...document.querySelectorAll('[id*="war"],[class*="war-front"]')].filter(e => e.getClientRects().length).map(e => e.id || e.className).slice(0, 4),
      buildBtn: vis('#build-btn') || /Build/.test(document.body.innerText), research: /Research/.test(document.body.innerText),
      harborBtn: [...document.querySelectorAll('button')].filter(b => b.getClientRects().length && /⚓|harbor/i.test(b.innerText + b.title)).map(b => (b.id || '') + ':' + b.title).slice(0, 4),
      enemyShips: window._game._state.enemyShips.length, mode: window._game._mode }; });
  await shot('qa_T32_skirmish');
  // play a bit of skirmish time (no render) and watch for errors
  await ev(async () => { const h = await import('/test/harness.js'); const g = window._game; const r = g._renderer.render; g._renderer.render = () => {}; h.step(3600); g._renderer.render = r; });
  R.T32.after60s = await ev(() => ({ over: window._game._state.gameOver, wf: window._game._state.warFront, wood: Math.round(window._game._state.resWood) }));
  await page.keyboard.press('q'); await page.waitForTimeout(400);
  R.T33skirmish = await ev(() => document.getElementById('gfx-chip-val')?.innerText);
  const after = await ev(() => { const p = JSON.parse(localStorage.getItem('iow_profile_v1')); delete p.lastSeen; return JSON.stringify(p); });
  R.T32.profileUnchanged = before === after;
  if (before !== after) { const a = JSON.parse(before), b = JSON.parse(after); R.T32.diffKeys = Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])); }
  return R;
}
