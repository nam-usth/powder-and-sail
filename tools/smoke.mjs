#!/usr/bin/env node
// Headless smoke runner (Node Playwright) — the Node twin of smoke_test.py.
//
//   node tools/smoke.mjs --path "/frontend/?mode=harbor" --shot harbor --secs 5
//   node tools/smoke.mjs --tests                      # run the browser test suite
//   node tools/smoke.mjs --path /frontend/ --eval "window._game._state.playerShips.length"
//   node tools/smoke.mjs --path /frontend/ --script steps.js   # async (page) => {...}
//
// Serves the repo root on :8124, collects console errors, screenshots to
// tools/out/<shot>.png (or --out DIR). Exit code 1 when the page logged errors.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const PORT = Number(args.port || 8124);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT);

const errors = [], warnings = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const out = { };
try {
  const ctx = await browser.newContext({ viewport: { width: Number(args.w || 1440), height: Number(args.h || 810) } });
  if (args.fresh !== undefined) await ctx.addInitScript(() => { try { if (!sessionStorage.__fresh) { localStorage.clear(); sessionStorage.__fresh = 1; } } catch {} });
  await ctx.addInitScript(() => { try { localStorage.setItem('iow_tut_done', '1'); } catch {} });
  const page = await ctx.newPage();
  page.on('console', m => (m.type() === 'error' ? errors : m.type() === 'warning' ? warnings : []).push(m.text()));
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  if (args.tests) {
    await page.goto(`http://localhost:${PORT}/test/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Number(args.secs || 8) * 1000);
    out.tests = await page.evaluate(() => {
      const t = document.body.innerText;
      const m = t.match(/(\d+)\s*passed[^\d]*(\d+)\s*failed/i);
      const fails = [...document.querySelectorAll('.fail, .test.fail')].map(e => e.innerText.slice(0, 200));
      return { summary: m ? m[0] : t.slice(0, 300), fails: fails.slice(0, 30) };
    });
  } else {
    await page.goto(`http://localhost:${PORT}${args.path || '/frontend/'}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Number(args.secs || 5) * 1000);
    if (args.script) {
      const mod = await import(pathToFileURL(resolve(args.script)).href);
      out.script = await mod.default(page, { shot: async (n) => shot(page, n) });
    }
    if (args.eval) out.eval = await page.evaluate(args.eval);
    if (args.shot) await shot(page, args.shot);
  }
} finally {
  await browser.close();
  server.close();
}

async function shot(page, name) {
  const dir = resolve(args.out || join(ROOT, 'tools', 'out'));
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name + '.png') });
}

console.log(JSON.stringify({ errors: errors.slice(0, 25), warnings: warnings.slice(0, 6), ...out }, null, 1));
process.exit(errors.length ? 1 : 0);
