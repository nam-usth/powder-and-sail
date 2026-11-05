// Audio verification for tools/smoke.mjs --script.
//
//   node tools/smoke.mjs --port 8133 --secs 1 --script tools/audio_check.mjs \
//        --path "/tools/audio-lab.html?auto=music&secs=24"        (or auto=regions | auto=sfx)
//
// Waits for the Audio Lab's offline renders (OfflineAudioContext) and returns
// per-render peak / RMS / NaN / clipped-sample counts. Optional env:
//   AUDIO_SHOT=<png path>   full-page screenshot of the analysis (waveforms + spectrograms)
//   AUDIO_SHOT_SEL=<css>    screenshot only this element (e.g. '#compare' for the cannon comparison grid)
//   AUDIO_WAV=<dir>         export every render as 16-bit WAV
// smoke.mjs exits 1 when the page logged console errors.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export default async function audioCheck(page) {
  await page.waitForFunction(() => window.__labDone, null, { timeout: 300000, polling: 500 });
  const done = await page.evaluate(() => window.__labDone);
  if (process.env.AUDIO_SHOT) {
    const file = resolve(process.env.AUDIO_SHOT);
    await mkdir(dirname(file), { recursive: true });
    const sel = process.env.AUDIO_SHOT_SEL;   // e.g. '#compare' — just that element
    if (sel) await page.locator(sel).screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: true });
  }
  if (process.env.AUDIO_WAV) {
    const dir = resolve(process.env.AUDIO_WAV);
    await mkdir(dir, { recursive: true });
    const names = await page.evaluate(() => window.__lab.names());
    for (const n of names) {
      const b64 = await page.evaluate((k) => window.__lab.wav(k), n);
      await writeFile(join(dir, n.replace(/[^a-z0-9_]+/gi, '_').replace(/_+$/, '') + '.wav'), Buffer.from(b64, 'base64'));
    }
  }
  if (!Array.isArray(done)) return done;
  return {
    allOk: done.every((r) => r.ok),
    renders: done.map((r) => ({ name: r.name, peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(4), loudest: +r.maxWinRms.toFixed(3), nan: r.nan, clip: r.clip, ok: r.ok, ms: r.ms })),
  };
}
