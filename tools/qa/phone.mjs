// QA: phone viewport 390x844 — harbor, shipyard, chart, briefing; overflow check.
// Run: node tools/smoke.mjs --port 8190 --fresh --w 390 --h 844 --path /frontend/ --secs 7 --script tools/qa/phone.mjs
const EV = 'production/qa/evidence/';
export default async function (page) {
  const R = {};
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (n) => { try { await page.screenshot({ path: EV + n + '.png', timeout: 60000, animations: 'disabled' }); } catch {} };
  await page.waitForFunction(() => window._game?._opts?.session?.ui, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const overflow = () => ev(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth,
    offRight: [...document.querySelectorAll('button, .hb-bar, .sy-hull, .wc-node, nav, header')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (r.right > innerWidth + 2 || r.left < -2); }).map(e => (e.id || e.className || e.tagName).toString().slice(0, 30) + '@' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)).slice(0, 12),
    overlapBar: (() => { const a = document.querySelector('.hb-bar')?.getBoundingClientRect(); const t = document.querySelector('#top-bar, .top-bar, header')?.getBoundingClientRect(); return a && t ? { bar: [Math.round(a.top), Math.round(a.bottom), Math.round(a.left), Math.round(a.right)], top: [Math.round(t.top), Math.round(t.bottom)] } : null; })() }));
  R.harbor = await overflow(); await shot('qa_phone_harbor');
  await page.keyboard.press('y'); await page.waitForTimeout(700);
  R.shipyard = await overflow(); await shot('qa_phone_shipyard');
  await page.keyboard.press('w'); await page.waitForTimeout(700);
  R.chart = await overflow(); await shot('qa_phone_chart');
  await ev(() => window._game._opts.session.ui.chart.openBriefing('reef_1')); await page.waitForTimeout(700);
  R.brief = await overflow(); await shot('qa_phone_briefing');
  R.sailBtn = await ev(() => { const b = document.querySelector('[data-act="sail"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.bottom <= innerHeight && r.top >= 0 }; });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.keyboard.press('l'); await page.waitForTimeout(700);
  R.loadout = await overflow(); await shot('qa_phone_loadout');
  return R;
}
