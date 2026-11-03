# Isles of War — Session Handoff
> Dành cho Claude session mới tiếp tục từ AH
> Viết bởi: session AG+AH · Ngày: 2026-05-22
> Supersedes: `IOW_HANDOFF_AF7.md`

---

## 🗂 Trạng thái hiện tại

**Version:** `AH` (stable)
**Working dir:** `iow_new/frontend/`
**Entry point:** `index.html` — no bundler, plain ES modules + importmap (Three.js 0.128.0 từ unpkg CDN)
**Cấu trúc:** Bruno Simon pattern — `Experience/`, `Controllers/`, `World/`, `Systems/`, `UI/`, `Utils/`
**Assets:** `frontend/Assets/Models/` (GLB), `frontend/Assets/Sound/` (placeholder)

---

## 🆕 Thay đổi lớn AG → AH

### 1. VFX.js — Refactor + Nhiều cải tiến

**Vấn đề:** VFX.js trở thành god module (~1268 dòng).

**Fix:** Tách thành `Systems/vfx/` subfolder, `VFX.js` chỉ còn là thin façade (~214 dòng):

```
Systems/
  VFX.js               ← public API không đổi
  vfx/
    particles.js       ← ShaderParticlePool + MiscParticlePool + FIRE/SMOKE GLSL
    explosions.js      ← ShockwaveSystem + WaterRippleSystem + SHOCK GLSL
    muzzleFlash.js     ← MuzzleFlashPool + tất cả MFLASH GLSL
    fire.js            ← FireSource + SinkSequence
    cameraShake.js     ← CameraShake
```

**API không thay đổi** — tất cả callers vẫn `import { VFX } from './Systems/VFX.js'`.

**Smoke:** Màu thay từ dark brown-black → light warm-gray. Lifetime giảm ~60%. `SMOKE_DUR` muzzle flash `1.6s → 0.8s`.

**Fire (FireSource):** Thêm ember sparks bắn lên tip. Tăng particle count và speed.

**Ship explosion:** `spawnShipExplosion(x,y,z)` — main blast + 4-6 staggered mini-explosions (gunpowder barrels) với delay `0.12–0.65s` mỗi cái.

**Water splash:** `MiscParticlePool.spawn()` thêm `opts.upward` — restrict phi để particles tung lên. 2 burst: cột đứng + lateral spray.

**WaterRippleSystem:** Expanding ring flat trên mặt biển (`depthTest:false`, `AdditiveBlending`). Spawn 2 rings staggered (delay 0.18s), ease-out expansion `0.7–0.95s`.

**CombatSystem VFX logic (BREAKING FIX):**
```js
// Ship vs ship hit   → spawnHit(tx, 1, tz)
// Ship vs ship miss  → spawnSplash(tx, 0.3, tz)  ← ripple tại điểm đạn rơi
// Ship vs island     → spawnHit(tx, 1.2, tz)    ← LUÔN hit (đất liền, không nước)
// Fort/defense miss  → spawnSplash(tx, 0.3, tz) ← gần tàu player
```
Trước đây `spawnSplash(ship.x, ...)` — sai vị trí (tàu bắn thay vì điểm rơi).

---

### 2. Utils/ — New utility modules

**`Utils/RingMaterial.js`** — Shared factory cho TẤT CẢ range rings:
```js
ringEdgeMat(color, opacity)   // MeshBasicMaterial, AdditiveBlending, depthTest:false, fog:false
ringFillMat(color, opacity)   // MeshBasicMaterial, NormalBlending, depthTest:false, fog:false
ringLineMat(color, opacity)   // LineBasicMaterial, depthTest:false, fog:false
RING_RENDER_ORDER = 12
RING_Y = 1.6  // trên max wave height ~0.74
```
**QUAN TRỌNG:** `fog:false` — không bị storm fog wash out màu. Tất cả 4 files (OverlaySystem, AuraSystem, GameApp, SceneController) đều dùng factory này.

**`Utils/Audio.js`** — Spatial audio singleton:
```js
import { audio } from './Utils/Audio.js';
audio.play('cannon');                    // non-spatial
audio.play('splash', { x, y, z });      // spatial: gain giảm theo dist từ camera
audio.setCameraPos(x, y, z);            // call mỗi frame từ GameApp
audio.masterVolume = 0.8;
audio.musicVolume  = 0.4;
await audio.load('name', '/path.webm'); // file-based (khi có assets)
audio.playMusic('ambient');
```
Channels: master → sfx / music. Spatial: full vol ≤ 12u, silent ≥ 80u.
VFX.playSound() và play3D() đều delegate sang `audio`.

**`Utils/ModelLoader.js`** — Lazy GLB loader:
```js
import { modelLoader } from './Utils/ModelLoader.js';
await modelLoader.load('Assets/Models/Flagship.glb');
const mesh = modelLoader.clone('Assets/Models/Flagship.glb');
// Cache: mỗi URL chỉ download 1 lần
// Concurrent requests share in-flight Promise
```
GLTFLoader import trực tiếp từ CDN: `https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js`

---

### 3. OverlaySystem — Arc sectors dùng mesh (không phải Line)

**Vấn đề:** Arc sectors (góc < 360°) dùng `THREE.Line` → 1px, không glow, không nhất quán với full rings.

**Fix:** Thay bằng 2 mesh:
```js
// arcRingGeo(R, thickness, aStart, aEnd, steps) — flat in XZ plane (y=0)
// radialArmsGeo(R, aStart, aEnd, w)             — 2 thin rectangles
// Cả hai dùng ringEdgeMat → AdditiveBlending, consistent với circles
```
Geometry XZ-plane trực tiếp, không cần `rotation.x = -π/2`.

---

### 4. World/PlanarReflection.js — High-graphics reflection

```js
// GameApp init:
this._refl = new PlanarReflection(sc);

// Frame loop (khi high graphics on):
this._refl.update(this._renderer.instance, this._camera);
this._ocean.setReflection(this._refl.texture, this._refl.projViewMatrix);

// Toggle:
window.setGraphicsHigh(true);   // bật reflection
window.setGraphicsHigh(false);  // tắt
```
Ocean.js có thêm uniforms: `uReflTex`, `uReflEnabled`, `uReflProjView`.
Reflection camera: `matrixWorld = Reflect_Y * camera.matrixWorld` (flip Y across y=0).

---

### 5. World/ShipEntity.js — GLB model system

**Registry:**
```js
export const SHIP_MODELS = {
  light: null,
  standard: [
    // tier 0
    { url: 'Assets/Models/Flagship.glb', rotX:0, rotY:Math.PI, rotZ:Math.PI, autoScale:true },
    // tier 1: thêm khi có file
  ],
  heavy: null,
};
```

**Architecture — wrapper group:**
```
wrapper (Group)  ← ship.mesh, game loop ghi rotation.y/x/z vào đây
  └─ inner       ← correction rotation baked (không bị overwrite)
```
`autoScale:true` → compute bounding box sau correction, fit theo `8.8 × cfg.sc`.

**Ship data:** `ship.tier = cfg.tier ?? 0` — dùng `getModelCfg(hull, tier)` để pick đúng tier.

**Sail shader:** `updateSailTime(t)` export từ ShipEntity — gọi mỗi frame từ GameApp. Tất cả sails dùng chung `SAIL_TIME` uniform.
```js
// Vertex displacement: belly + flutter theo trailing edge
// PlaneGeometry(1.3*sc, 2.2*sc, 6, 10) — 6×10 segments
```

---

### 6. Systems/BuildSystem.js — Grid shader + Arc preview

**Grid cells** dùng `ShaderMaterial` (`depthTest:false`, `renderOrder:15`, pulse animation):
```js
// uColor, uOpacity, uTime uniforms
// BuildSystem.update(dt) tick uTime mỗi frame
```

**Defense arc preview** (mới):
- Khi `selectedDefense` và hover trên cell → `_showArcPreview(wx, wz, arcDeg, range, facingDeg)`
- Full circle nếu `arcDeg >= 360`, sector với radial arms nếu không
- Mũi tên trắng chỉ hướng facing
- Clear khi rời cell hoặc clearGrid()

**Q/E rotation:**
- `st.buildFacingDeg` (GameState) — 0-based degrees, 45° steps
- Q = -45°, E = +45°, reset về 0 sau placement
- `exitIslandFocus()` cũng reset

---

### 7. GameApp — exitIslandFocus()

```js
// Gọi khi:
// 1. Space key (fleet focus)
// 2. Fleet/Free cam button click (main.js)
game.exitIslandFocus();
// Tác dụng:
//   - clearGrid() + cancel build mode
//   - reset selectedBuilding/selectedDefense/buildFacingDeg
//   - hide selRing của island trước
//   - clear selectedIslandId
```

---

### 8. Systems/EnemyAI.js — v2 Rewrite

**Từ:** flat if/else state machine (159 dòng)
**Thành:** priority-weighted decision system với wolfpack tactics (207 dòng)

**6 chiến lược:**
| Strategy | Điều kiện kích hoạt |
|----------|---------------------|
| RETREAT  | avgHP < 22% |
| BUILDUP  | alive < 2 ships |
| ENGAGE   | player fleet gần, HP ok, wave scaling |
| SIEGE    | player islands tồn tại, wave ≥ 3 |
| RAID     | neutral islands available |
| EXPAND   | any non-enemy island |

**Wolfpack fan formation (5 offsets):**
```js
{ fwd:0,  lat:0 }   // leader
{ fwd:-4, lat:8 }   // flanker L
{ fwd:-4, lat:-8 }  // flanker R
{ fwd:-10, lat:5 }  // rear L
{ fwd:-10, lat:-5 } // rear R
```

**Adaptive building:** frequency tăng theo `waveNumber`, unlock `bunker` ở wave 3, `deadmans_lure` ở wave 5.
Anti-churn: không switch strategy trong 8s trừ khi cần retreat.

---

### 9. UI — IslandPanel slot counter

```html
<!-- Progress bar + counter trong IslandPanel (player islands only) -->
CELLS  [████░░░░]  8/45
<!-- Màu: xanh < 60%, vàng 60-85%, đỏ > 85% -->
```
`usedCells = this._build.getOccupiedCellCount(isl)`, `maxCells = isl.validGridKeys.size`.

---

### 10. BuildPanel — no-flicker pattern

```js
// GameApp tick 0.25s:
this._buildUI._updateAffordability()  // chỉ toggle CSS class 'cant' + disabled
// KHÔNG gọi _render() nữa
// _render() chỉ được gọi khi building thực sự thay đổi (bus events)
```
Items có `data-bid` attribute để `_updateAffordability()` locate.

---

## 🏗 Architecture — PHẢI biết

### PanelManager — single source of truth
```js
PanelManager.open('lp');    // ĐÚNG
el.classList.add('open');   // ❌ KHÔNG BAO GIỜ
```

### SpringCamera — authority cho camera
```js
this._spring.setTarget(x, z);      // ĐÚNG
st.camTgt.x = x;                   // ❌ read-only mirror
```

### Ship mesh hierarchy
```js
// Procedural mesh: ship.mesh = THREE.Group (hull, bow, mast, sail)
// GLB loaded:      ship.mesh = wrapper Group
//                               └─ inner = gltf.scene.clone()
// Game loop ghi:
s.mesh.position.set(x, y, z);
s.mesh.rotation.y = s.angle;    // heading
s.mesh.rotation.x = s._pitchA; // physics
s.mesh.rotation.z = s._rollA;  // physics
// KHÔNG dùng mesh.quaternion trực tiếp
```

### VFX pools — AH
```
FirePool  (1200) → spawnHit, spawnExplosion, spawnShipExplosion, startBurning, fort fire
SmokePool  (800) → spawnSmoke, spawnHit, spawnExplosion, startSink
MiscPool  (1200) → spawnSplash (upward + lateral), spawnPart, bubbles
ShockwaveSystem  → spawnExplosion, spawnShipExplosion (mini-blasts), startSink
WaterRippleSystem→ spawnSplash (tự động)
MuzzleFlash      → fireBall (auto)
```

### RingMaterial — tất cả rings phải dùng factory
```js
import { ringEdgeMat, ringFillMat, RING_RENDER_ORDER, RING_Y } from '../Utils/RingMaterial.js';
// KHÔNG tạo MeshBasicMaterial cho ring trực tiếp
// fog:false là BẮT BUỘC — storm fog sẽ wash out màu nếu thiếu
```

### Update order trong game loop (load-bearing)
```js
updateSailTime(t);              // 0. sail uniform
sky.update(t);                  // 1. sky → sunDir
scene.setSunDir(sunDir, day);   // 2. light + fog
ocean.update(t, cam, sunDir);   // 3. ocean specular
if (graphicsHigh) {             // 4. reflection (optional)
  refl.update(renderer, cam);
  ocean.setReflection(refl.texture, refl.projViewMatrix);
}
```

### Audio sync
```js
// Cuối _update() sau camera update:
audio.setCameraPos(camera.position.x, camera.position.y, camera.position.z);
// VFX.playSound(type) và VFX.play3D(type, x, y, z) đều delegate sang audio
```

### WaveSystem — loadout trước ship:spawned
```js
ws.loadout['L'] = 'demi_can';   // 1. set loadout
st.allShips.push(ws);            // 2. add to state
bus.emit('ship:spawned', {...}); // 3. listeners run sync, build overlay
```

---

## ⚠️ Known Issues

### 🟠 High
- **Fog of War incomplete** — vision mesh ok, 3D enemy ships vẫn render ngoài vision. AI milestone.
- **GLB model rotation hot-swap** — nếu ship đang di chuyển khi GLB load xong, `wrapper.rotation.copy(ship.mesh.rotation)` copy đúng instant đó nhưng angle liên tục thay đổi → OK vì game loop overwrite ngay frame sau.

### 🟡 Medium
- **Fire intensity static sau ignition** — `intensity` set 1 lần, không update theo HP. Cần `isl._fireSource.intensity = newVal` nếu muốn dynamic.
- **Sail shader chỉ cho procedural mesh** — GLB model có sails riêng, không nhận `updateSailTime` uniform. Cần apply material sau khi clone.
- **EnemyAI build sử dụng validGridKeys chưa đầy đủ** — `gridKey` được generate bằng counter không theo island shape. Chỉ affect visual position, không affect combat.
- **buildFacingDeg mặc định 0** — khi player không Q/E, defense facing = `_defaultFacing()` (toward enemy). Nếu `buildFacingDeg === 0` nhưng player muốn facing 0° (north), không phân biệt được. Cần separate "player set facing" flag nếu cần.

### 🟢 Low
- **God rays** — luôn visible, không mask bởi cloud.
- **PlanarReflection** — không có oblique near clip plane → objects dưới nước có thể xuất hiện trong reflection. Acceptable ở mức độ hiện tại.

---

## 🎨 Design System

```css
--bg-deep: #061218
--parchment: #ecdfc4
--iron: #2f3a44
--brass-light: #e8c984
--crimson: #a83232
--seafoam: #5cb89a
```

Panel: `background:#141c24; border-top:2px solid var(--brass-deep); border-radius:3px`
Ring: `AdditiveBlending, depthTest:false, fog:false` — xem `Utils/RingMaterial.js`

---

## 📋 Next milestones

### AI — Trade Routes + Dynamic Economy
- Trade ships chạy giữa player islands
- Market giá fluctuate theo supply/demand
- Resource stockpile decay nếu không có warehouse

**Files:** `Systems/EconomySystem.js` (extend), `World/` (trade ship entity)

### AJ — Campaign + Win Conditions
- Wave progression system với named enemies
- Boss wave mỗi 5 waves (bigger fleet, special AI)
- Campaign map với island unlock order

**Files:** `Systems/WaveSystem.js`, `UI/` (campaign UI)

### AK — Content Expansion
- 3 tàu địch mới với hull types khác nhau
- 2 cannon types mới (grapeshot, bomb kettle)
- Storm visual overhaul (wave shader amplitude)

### AL — Polish + PWA
- Tutorial overlay system
- Accessibility: keyboard navigation cho panels
- PWA manifest + service worker cache
- Howler.js + `.webm` audio assets

---

## 🔧 Quick Start

```bash
cd iow_new/frontend && python -m http.server 8080
# Game:  http://localhost:8080
# Tests: http://localhost:8080/../test/index.html

# Syntax check (Node.js)
node --check src/Experience/GameApp.js
node --check src/Experience/Systems/VFX.js
node --check src/Experience/Systems/EnemyAI.js
node --check src/Experience/World/ShipEntity.js

# Enable planar reflection (console):
window.setGraphicsHigh(true)

# Check AI state (console):
window._game._state.aiState    // current strategy
window._game._ai._strat        // EnemyAI._strat
```

---

## 💡 Lessons learned AG+AH

1. **God module split pattern:** Extract class → new file, re-export từ original façade. Zero external import changes.

2. **`fog:false` là BẮT BUỘC cho overlay elements** — Three.js `MeshBasicMaterial` default `fog:true`. Scene fog (storm) sẽ tint tất cả materials với fog color → rings mất màu. Không rõ ràng vì fog chỉ visible ở storm.

3. **depthTest:false không giải quyết được Y position** — Ngay cả với depthTest:false, rings vẫn cần renderOrder cao để sort đúng với nhau. Dùng `RING_RENDER_ORDER = 12` cho rings, `15` cho build grid.

4. **GLB wrapper group pattern** — Game loop ghi trực tiếp vào `ship.mesh.rotation`. Nếu rotation correction baked vào mesh, sẽ bị overwrite mỗi frame. Giải pháp: 2-level hierarchy với inner node cho correction và outer wrapper cho game loop.

5. **autoScale cần `updateMatrixWorld(true)`** — Three.js không tự update matrixWorld khi rotation thay đổi. Phải gọi `inner.updateMatrixWorld(true)` trước `Box3.setFromObject()` để bounding box tính đúng sau correction rotation.

6. **Arc sector mesh thay vì Line** — `LineBasicMaterial` bị WebGL cap ở 1px trên hầu hết GPU. Dùng `BufferGeometry` quad strip cho arc band → consistent visual weight với `RingGeometry` circles.

7. **Defense arc preview dùng game-convention angles** — `sin(a)=X, cos(a)=Z, 0=north, clockwise`. Không dùng Three.js convention (counterclockwise từ +X). Consistency với toàn bộ cannon arc system.

8. **EnemyAI anti-churn** — AI không nên switch strategy quá nhanh. Nếu không có cooldown, AI có thể oscillate giữa ENGAGE và SIEGE mỗi retarget tick → ships zig-zag. Min 8s trong current strategy trừ emergency retreat.

9. **Sail shader SAIL_TIME shared uniform** — Tất cả sails cùng chia 1 `{ value: 0 }` object. `updateSailTime(t)` ghi 1 lần, tất cả materials nhận cùng value. Memory efficient và sync perfect.

10. **`exitIslandFocus()` cần có 2 entry points** — Space key (InputController) và cam button click (main.js) đều cần cleanup. Không thể hook vào CameraController.setMode() vì nó không có reference đến BuildSystem.
