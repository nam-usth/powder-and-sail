import * as THREE from 'three';

// ── OCEAN TEXTURES (procedural, generated once, no assets) ────────
// Two tileable 256² RGBA8 textures built on the CPU at first use and shared
// by everything that needs them (Ocean, Sky, and the cloud shadows every lit
// material reads — see Render/ShaderPatches.js):
//
//  getWaveNormalTexture()  "FFT ocean" detail: a Phillips wind-wave spectrum
//                          with random phases, inverse-FFT'd into a periodic
//                          height field. R,G = slope ∂h/∂x, ∂h/∂z (signed,
//                          0.5-centred, normalised to ±1); B = height; A = 1.
//                          Two copies scroll at different scales and speeds
//                          in the ocean shader (cheap stand-in for a live FFT).
//  getNoiseTexture()       R = fbm (clouds, shelf edges), G = fbm (2nd seed),
//                          B = cellular F1 (foam bubbles),
//                          A = cellular F2-F1 (caustic web).
//
// Deterministic (seeded PRNG): every session draws the same sea. Generation
// costs ~20-40 ms once; mipmaps + anisotropy keep the far sea from shimmering.

const N = 256;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// In-place iterative radix-2 complex FFT (inverse when inv = true, unscaled).
function fft1(re, im, off, stride, n, inv, tr, ti) {
  for (let i = 0; i < n; i++) { tr[i] = re[off + i * stride]; ti[i] = im[off + i * stride]; }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = tr[i]; tr[i] = tr[j]; tr[j] = t;
      t = ti[i]; ti[i] = ti[j]; ti[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k, b = a + h;
        const br = tr[b] * cr - ti[b] * ci, bi = tr[b] * ci + ti[b] * cr;
        tr[b] = tr[a] - br; ti[b] = ti[a] - bi;
        tr[a] += br; ti[a] += bi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  for (let i = 0; i < n; i++) { re[off + i * stride] = tr[i]; im[off + i * stride] = ti[i]; }
}

function ifft2(re, im, n) {
  const tr = new Float64Array(n), ti = new Float64Array(n);
  for (let r = 0; r < n; r++) fft1(re, im, r * n, 1, n, true, tr, ti);
  for (let c = 0; c < n; c++) fft1(re, im, c, n, n, true, tr, ti);
}

function makeTexture(data, aniso) {
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

let _waveTex = null, _noiseTex = null;

/** Tileable spectral wave detail (see header). Shared, created once. */
export function getWaveNormalTexture() {
  if (_waveTex) return _waveTex;
  const rand = mulberry32(0x0CEA4);
  const gauss = () => {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const S = N * N;
  const hr = new Float64Array(S), hi = new Float64Array(S);
  const xr = new Float64Array(S), xi = new Float64Array(S);
  const zr = new Float64Array(S), zi = new Float64Array(S);
  // Phillips spectrum, wind along +x; peak wavelength ≈ 1/6 of the tile.
  const kPeak = 2 * Math.PI * 6, L = 1 / (kPeak * Math.SQRT2), kCut = 2 * Math.PI * 64;
  for (let row = 0; row < N; row++) {
    const nz = row < N / 2 ? row : row - N;
    for (let col = 0; col < N; col++) {
      const nx = col < N / 2 ? col : col - N;
      const i = row * N + col;
      if (nx === 0 && nz === 0) continue;
      const kx = 2 * Math.PI * nx, kz = 2 * Math.PI * nz, k = Math.hypot(kx, kz);
      const cosw = kx / k;
      let dir = cosw * cosw * cosw * cosw;               // long-crested: energy along the wind
      if (cosw < 0) dir *= 0.1;                          // little energy against it
      dir = 0.06 + 0.94 * dir;                           // a trace of cross-chop
      const P = Math.exp(-1 / ((k * L) ** 2)) / (k ** 4) * dir * Math.exp(-((k / kCut) ** 2));
      const a = Math.sqrt(P * 0.5);
      const ar = gauss() * a, ai = gauss() * a;
      hr[i] = ar; hi[i] = ai;
      // i·k·H  →  slope spectra
      xr[i] = -kx * ai; xi[i] = kx * ar;
      zr[i] = -kz * ai; zi[i] = kz * ar;
    }
  }
  ifft2(hr, hi, N); ifft2(xr, xi, N); ifft2(zr, zi, N);
  // Normalise by a high percentile so a few spikes do not flatten everything.
  const absSlope = new Float32Array(S);
  let hMax = 1e-12;
  for (let i = 0; i < S; i++) {
    absSlope[i] = Math.max(Math.abs(xr[i]), Math.abs(zr[i]));
    hMax = Math.max(hMax, Math.abs(hr[i]));
  }
  const sorted = Float32Array.from(absSlope).sort();
  const sNorm = Math.max(1e-12, sorted[Math.floor(S * 0.995)]);
  const data = new Uint8Array(S * 4);
  const enc = v => Math.max(0, Math.min(255, Math.round((0.5 + 0.5 * Math.max(-1, Math.min(1, v))) * 255)));
  for (let i = 0; i < S; i++) {
    data[i * 4]     = enc(xr[i] / sNorm);
    data[i * 4 + 1] = enc(zr[i] / sNorm);
    data[i * 4 + 2] = enc(hr[i] / hMax);
    data[i * 4 + 3] = 255;
  }
  _waveTex = makeTexture(data, 8);
  return _waveTex;
}

/** Tileable multi-purpose noise (see header). Shared, created once. */
export function getNoiseTexture() {
  if (_noiseTex) return _noiseTex;
  const rand = mulberry32(0x5EA5);
  const S = N * N, data = new Uint8Array(S * 4);

  // Periodic value-noise lattices (period p per octave)
  const lattice = p => { const a = new Float32Array(p * p); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const vnoise = (lat, p, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = lat[y0 * p + x0], b = lat[y0 * p + x1], c = lat[y1 * p + x0], d = lat[y1 * p + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const octavesR = [4, 8, 16, 32, 64].map(p => ({ p, lat: lattice(p) }));
  const octavesG = [6, 12, 24, 48].map(p => ({ p, lat: lattice(p) }));
  const fbm = (oct, u, v) => {
    let s = 0, a = 0.5, n = 0;
    for (const o of oct) { s += a * vnoise(o.lat, o.p, u * o.p, v * o.p); n += a; a *= 0.5; }
    return s / n;
  };
  // Periodic jittered cell points for Worley noise
  const cells = c => { const a = new Float32Array(c * c * 2); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; };
  const worley = (pts, c, u, v) => {
    const x = u * c, y = v * c, cx = Math.floor(x), cy = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const wx = ((gx % c) + c) % c, wy = ((gy % c) + c) % c, k = (wy * c + wx) * 2;
      const dx = gx + pts[k] - x, dy = gy + pts[k + 1] - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return [f1, f2];
  };
  const foamPts = cells(22), causticPts = cells(9);

  for (let row = 0; row < N; row++) {
    const v = row / N;
    for (let col = 0; col < N; col++) {
      const u = col / N, i = (row * N + col) * 4;
      const r = fbm(octavesR, u, v);
      const g = fbm(octavesG, u + 0.37, v + 0.71);
      const [f1] = worley(foamPts, 22, u, v);
      const [c1, c2] = worley(causticPts, 9, u, v);
      data[i]     = Math.round(Math.min(1, Math.max(0, (r - 0.5) * 1.6 + 0.5)) * 255);  // contrast-stretched
      data[i + 1] = Math.round(Math.min(1, Math.max(0, (g - 0.5) * 1.6 + 0.5)) * 255);
      data[i + 2] = Math.round(Math.min(1, f1 / 0.75) * 255);
      data[i + 3] = Math.round(Math.min(1, (c2 - c1) / 0.6) * 255);
    }
  }
  _noiseTex = makeTexture(data, 4);
  return _noiseTex;
}
