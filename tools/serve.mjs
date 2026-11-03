#!/usr/bin/env node
// Zero-dependency static file server for local development.
//
//   node tools/serve.mjs [port]        (default 8080)
//
// Serves the repository root so both the game (/frontend/) and the browser
// test suite (/test/) resolve their ES-module paths. Caching is disabled so a
// plain reload always picks up edited files.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.glb':  'model/gltf-binary',
  '.mp3':  'audio/mpeg',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      console.log(`404 ${urlPath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${urlPath}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`  game:  http://localhost:${PORT}/frontend/`);
  console.log(`  tests: http://localhost:${PORT}/test/`);
});
