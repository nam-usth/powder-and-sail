# Engine reference — Three.js (custom web engine)

| Item | Version | Where |
|---|---|---|
| three.js | r128 (vendored) | `frontend/vendor/three/build/three.module.js` |
| three/examples/jsm | r128 subset: GLTFLoader, EffectComposer, UnrealBloomPass, FXAA | `frontend/vendor/three/examples/jsm/` |
| Rapier | vendored ES build | `frontend/vendor/rapier/rapier.es.js` |

Notes for agents
- r128 API: `BufferGeometry` only (no `Geometry`), `outputEncoding` (not `outputColorSpace`), `InstancedMesh` available.
- Import map lives in `frontend/index.html`; module specifier `three` resolves to the vendored build.
- No bundler: every import path must be relative and include `.js`.
- Frame loop: `Experience/Time.js` singleton emits `tick`; subscribe with a namespace (`time.on('tick.myns', …)`).
