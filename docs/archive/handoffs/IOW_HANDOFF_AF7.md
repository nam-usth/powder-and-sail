# Isles of War — Session Handoff
> Dành cho Claude session mới tiếp tục từ AF7
> Viết bởi: session AF6→AF7 · Ngày: 2026-05-21

---

## 🗂 Trạng thái hiện tại

**Version:** `AF7` (stable, 100% syntax-clean)
**Working dir:** `iow_af7/`
**Cấu trúc:** Bruno Simon pattern — `Experience/`, `Controllers/`, `World/`, `Systems/`, `UI/`
**Test suite:** `test/index.html` — 10 suites, 281 assertions

---

## 🆕 Thay đổi AF6 → AF7 (4 files)

### 1. SceneController — `setSunDir(dir, dayPhase)`

File: `Controllers/SceneController.js`

```js
// _sunLight và _ambient giờ là instance fields (thay vì local vars)
this._sunLight  // THREE.DirectionalLight
this._ambient   // THREE.AmbientLight

// Method mới — gọi mỗi frame từ GameApp
scene.setSunDir(dir, dayPhase)
// dir       → THREE.Vector3 (normalised) từ sky.getSunDir()
// dayPhase  → float [0,1], 0=night, 1=noon
//
// Tác dụng:
//   sunLight.position = dir * 180 (shadow orbits with sun)
//   sunLight.intensity = 0.3 + dayPhase * 1.4
//   sunLight.color warm noon → cool night
//   ambient.intensity = 0.25 + dayPhase * 0.35
//   fog.color tracks sky horizon
```

**Gotcha:** `dir.y` clamped tới min 8 world units trước khi set position — tránh shadow camera flip khi mặt trời xuống thấp dưới horizon.

### 2. GameApp — thứ tự update và island fire

File: `Experience/GameApp.js`

```js
// Thứ tự trong _update() — QUAN TRỌNG:
this._sky.update(t);                               // 1. sky cập nhật sunDir
const sunDir   = this._sky.getSunDir();             // 2. lấy dir mới
const dayPhase = Math.sin(t * 0.035) * 0.5 + 0.5; // 3. mirror công thức Sky shader
this._scene.setSunDir(sunDir, dayPhase);            // 4. sync light + fog
this._ocean.update(t, this._camera, sunDir);        // 5. sync ocean specular

// Island loop cũng cập nhật fire:
this._islands.forEach(isl => {
  this._combat.tickIsland(isl, targets, dt);
  isl.updateFire(dt, this._vfx);  // AF7
});
```

### 3. IslandEntity — fire source API

File: `World/IslandEntity.js`

```js
// Constructor: this._fireSource = null

// Public API:
isl.setOnFire(vfx, intensity)   // guard: no-op nếu đã burning
isl.clearFire()                  // null _fireSource
isl.updateFire(dt, vfx)         // tick fire+smoke pools
// rebuildFort() tự gọi clearFire() rồi

// Internal: _fireSource.update(dt, vfx._fire, vfx._smoke)
// Note: vfx._fire và vfx._smoke là ShaderParticlePool (AF6)
```

### 4. CombatSystem — fort ignition

File: `Systems/CombatSystem.js`

```js
// Sau khi apply damage:
if (isl.hp > 0 && isl.hp / isl.maxHp < 0.50) {
  const intensity = 0.6 + (1 - isl.hp / isl.maxHp) * 1.4; // 0.6→2.0
  isl.setOnFire(this._vfx, intensity);  // setOnFire guards duplicate
}
if (isl.hp <= 0) {
  isl.clearFire();
  this._bus.emit('island:fort_destroyed', { island: isl });
}
```

---

## 🏗 Architecture — PHẢI biết

*(Đầy đủ trong IOW_HANDOFF_AF6.md — tóm tắt các rule quan trọng nhất)*

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

### Physics — không dùng quaternion trực tiếp
```js
mesh.rotation.order = 'YXZ';
mesh.rotation.y = ship.angle;      // game logic
mesh.rotation.x = clamp(pitch);   // physics, max ±0.18 rad
mesh.rotation.z = clamp(roll);
// KHÔNG: mesh.quaternion.set(...)
```

### VFX pools — AF6+AF7
```
FirePool  (1200) → spawnHit, spawnExplosion, startSink, startBurning, fort fire
SmokePool  (800) → spawnSmoke, spawnHit, spawnExplosion, startSink, fort fire
MiscPool  (1200) → spawnPart, spawnSplash, bubbles
ShockwaveSystem  → spawnExplosion, startSink
MuzzleFlashSystem→ fireBall (auto)
```

**Accessing pools từ ngoài VFX class:**
```js
// IslandEntity.updateFire() cần access trực tiếp:
this._fireSource.update(dt, vfx._fire, vfx._smoke)
// _fire và _smoke là ShaderParticlePool instances (semi-private)
```

### WaveSystem — loadout trước ship:spawned
```js
ws.loadout['L'] = 'demi_can';   // 1
st.allShips.push(ws);            // 2
bus.emit('ship:spawned', {...}); // 3 — listeners run sync
```

### Ocean/Sky/Light sync — AF7
```js
// Thứ tự bất biến trong game loop:
sky.update(t)                   // → updates internal sunDir
scene.setSunDir(sky.getSunDir(), dayPhase)  // → moves light + fog
ocean.update(t, cam, sky.getSunDir())       // → ocean specular
```

### OverlaySystem — userData.role
```js
group.traverse(ch => {
  if (ch.userData.role === 'fill') ...
  if (ch.userData.role === 'edge') ...
});
// Không dùng children[0]/[1]
```

---

## ⚠️ Known Issues

### 🟠 High
- **Fog of War incomplete** — vision mesh ok, 3D enemy ships vẫn render ngoài vision. AH milestone.
- **Defense arc preview** — không có hover preview lúc build defense.
- **Defense rotation Q/E** — facingDeg cố định lúc placement.

### 🟡 Medium
- **Fire intensity static sau ignition** — `intensity` set một lần khi `setOnFire()`, không update theo HP tiếp theo. Cần `isl._fireSource.intensity = newVal` mỗi frame nếu muốn dynamic.
- **IslandPanel bld-detail flicker** — getBoundingClientRect() mỗi lần open.
- **LoadoutPanel full re-render** — chỉ cần update 1 slot.
- **Howler.js** — oscillator fallback, chưa có `.webm`.

### 🟢 Low
- **God rays** — luôn visible, không bị mask bởi cloud.
- **EnemyAI _histTimer** — tất cả ships sample cùng tick.

---

## 🎨 Design System (AF5, unchanged)

```css
--bg-deep: #061218
--parchment: #ecdfc4
--iron: #2f3a44
--brass-light: #e8c984
--crimson: #a83232
--seafoam: #5cb89a
```

Panel: `background:#141c24; border-top:2px solid var(--brass-deep); border-radius:3px`

---

## 📋 Next milestones

### AG — Ship Visual Overhaul (lớn)
- GLTF ship models, 3 damage states
- Sail billowing shader (wind uniform từ Ocean)
- Audio assets `.webm`

**Files:** `ShipEntity.js`, `WakeSystem.js`, `Ocean.js` (wind uniform), `VFX.js` (AudioManager)

### AH — AI + Fog of War (lớn)
- Behavior tree: Idle→Scout→Engage→Retreat→Raid
- Fog stencil-based
- Defense arc preview + Q/E rotation
- Fleet formation

**Files:** `EnemyAI.js` (rewrite), `FogSystem.js`, `InputController.js`, `FleetCommander.js`

---

## 🔧 Quick Start

```bash
cd iow_af7/frontend && python -m http.server 8080
# Game:  http://localhost:8080
# Tests: http://localhost:8080/../test/index.html

# Syntax check
node --check src/Experience/GameApp.js \
             src/Experience/Controllers/SceneController.js \
             src/Experience/Systems/CombatSystem.js \
             src/Experience/World/IslandEntity.js

# Next milestone
cp -r iow_af7 iow_ag
```

---

## 💡 Lessons learned AF7

1. **`setSunDir()` cần clamp dir.y tới min height** — Three.js DirectionalLight shadow camera flip khi light position quá thấp (y < 0)
2. **dayPhase phải mirror chính xác công thức Sky shader** — `sin(t * 0.035) * 0.5 + 0.5`. Nếu dùng công thức khác, light và shader sẽ lệch pha
3. **`setOnFire()` guard duplicate** — CombatSystem gọi mỗi khi damage hit, guard `if (this._fireSource) return` tránh nhiều fire source cùng island
4. **`clearFire()` phải được gọi ở 3 chỗ:** fort destroyed (CombatSystem), repair (BuildingController), rebuild (IslandEntity.rebuildFort) — nếu thiếu một chỗ, fire source orphan chạy mãi
5. **`vfx._fire` và `vfx._smoke` semi-private** — IslandEntity.updateFire() access trực tiếp để tránh tạo thêm public method trên VFX facade. Acceptable vì IslandEntity và VFX cùng "World" layer
6. **Update order in game loop is load-bearing** — sky → light → ocean. Đảo thứ tự sẽ có 1-frame lag giữa sun direction và shadow direction
