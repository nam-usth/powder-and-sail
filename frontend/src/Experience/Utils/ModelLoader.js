// ── ModelLoader.js ───────────────────────────────────────────────────
// Lazy GLTF/GLB loader with a shared URL cache.
// Each unique URL is fetched only once; concurrent requests share the same
// in-flight Promise so there are no duplicate downloads.
//
// Matches the project's no-bundler setup: GLTFLoader is imported directly
// from the same CDN version as three (0.128.0).
//
// Usage:
//   import { modelLoader } from './Utils/ModelLoader.js';
//
//   const gltf = await modelLoader.load('Assets/Models/Flagship.glb');
//   const mesh = modelLoader.clone('Assets/Models/Flagship.glb');
//   scene.add(mesh);

import { GLTFLoader } from '../../../vendor/three/examples/jsm/loaders/GLTFLoader.js';

class ModelLoader {
  constructor() {
    this._loader  = new GLTFLoader();
    this._cache   = new Map();   // url/key → resolved gltf
    this._pending = new Map();   // url → Promise (in-flight)
  }

  // ── Load a GLB by URL — returns Promise<gltf> ────────────────────
  load(url) {
    if (this._cache.has(url))   return Promise.resolve(this._cache.get(url));
    if (this._pending.has(url)) return this._pending.get(url);

    const promise = new Promise((resolve, reject) => {
      this._loader.load(
        url,
        (gltf) => {
          gltf.scene.traverse(child => {
            if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
          });
          this._cache.set(url, gltf);
          this._pending.delete(url);
          resolve(gltf);
        },
        undefined,
        (err) => { this._pending.delete(url); reject(err); }
      );
    });

    this._pending.set(url, promise);
    return promise;
  }

  // ── Preload a named list in parallel ────────────────────────────
  // items: [{ key, url }]
  async preload(items) {
    await Promise.allSettled(
      items.map(({ key, url }) =>
        this.load(url).then(gltf => this._cache.set(key, gltf))
          .catch(e => console.warn(`[ModelLoader] Failed to preload "${key}":`, e))
      )
    );
  }

  // ── Get cached result by key or URL (sync, null if missing) ─────
  get(keyOrUrl) { return this._cache.get(keyOrUrl) ?? null; }

  // ── Clone scene — each instance needs independent materials ─────
  clone(keyOrUrl) {
    const gltf = this.get(keyOrUrl);
    if (!gltf) return null;
    const root = gltf.scene.clone(true);
    root.traverse(child => {
      if (child.isMesh && child.material) child.material = child.material.clone();
    });
    return root;
  }
}

export const modelLoader = new ModelLoader();
