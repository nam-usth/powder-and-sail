# FABLE — IOW Upgrade Worklog · Milestone AM + AN
> Model: Claude Fable 5 · Date: 2026-06-11
> Scope: AM (GLB sail/wind shader, audio wiring) + AN "Cinematic Polish" (post-FX, toast queue, floating text, progress rings, fleet HP, fire dynamics, S3 cleanup, Alt tactical view, shape badge, EventEmitter fix)
> Format mỗi bước: **Status / Changes / Observations / Verification**

---

## 0. Khảo sát ban đầu

**Status:** ✅ Done

**Observations:**
- Sandbox có sẵn Playwright 1.56 + Chromium (`/opt/pw-browsers`) → smoke test headless khả thi (SwiftShader GL).
- Network allowlist: `registry.npmjs.org` OK; `unpkg.com`, `cdn.skypack.dev`, `fonts.googleapis.com` BỊ CHẶN → game gốc không chạy offline được (three.js + rapier đều CDN).
- **Các bug Tier S trong TODO_REVIEW.md đã được fix từ trước trong code hiện tại:** S1 (material clone khi construction), S2 (`_capturedWeakened` flag — tdmg chỉ giảm 1 lần), S5 (EnemyAI gridKey lọc theo `validGridKeys`), S7 (`CANNON_BY_ID` Map đã có ở mọi nơi), S8 (`recalcWarehouse` đã chạy theo bus events, timer 5s đã gỡ). S3 mới fix MỘT PHẦN (remove khỏi scene nhưng chưa dispose geometry/material, chưa gỡ physics body, chưa xoá wake trail).
- Flagship.glb = **1 mesh duy nhất** (`g Mesh_4791.rip`, material `Tex_0270_0.dds`) → không thể detect sail theo tên mesh → phải dùng sway world-space mask theo chiều cao.
- Audio: 6 file mp3 đã có trong `Assets/Sounds/` và ĐÃ được `audio.load()` trong GameApp (cannon, fire_burning, water_splash, explosion_01..03). TODO.md ghi "synthesis only" là OUTDATED.
- `spawnDmg` (damage number) đã tồn tại nhưng yếu: tạo DOM node mới mỗi hit + project 1 lần lúc spawn (số đứng im khi camera/tàu di chuyển).
- Baseline test suite (browser): **101 pass / 5 fail** — cả 5 fail PRE-EXISTING:
  1. `EventEmitter — off() whole namespace clears all events` → Expected 0, got 1 (**bug thật trong EventEmitter.off**, sẽ fix ở bước 10)
  2. `Ocean getWaveHeight — near zero-mean` → statistical, biên sai quá chặt
  3. `ReviveSystem — revive timer counts down` → test thiếu mesh stub (`reading 'position'`)
  4. `SpringCamera — settles near target` → Expected ~10±0.2, got 9.57 (tolerance chặt)
  5. `SpringCamera — velocity near zero` → 0.326 < 0.1 fail (cùng nguyên nhân #4)
- `applyGfx` chạy 2 lần: lúc DOMContentLoaded (no-op vì `window._game` chưa có) và **lần nữa sau `new GameApp()` (main.js:319)** → hook quality vào đây là đủ.
- Bootstrap: main.js → Resources preload → GameApp; tutorial overlay first-launch (localStorage `iow_tut_done`).

---

## 1. Vendor Three.js r128 + Rapier (hạ tầng cho mọi thứ phía sau)

**Status:** ✅ Done

**Changes:**
- `frontend/vendor/three/build/three.module.js` + `examples/jsm/{loaders/GLTFLoader, postprocessing/{EffectComposer,RenderPass,ShaderPass,Pass,MaskPass,UnrealBloomPass}, shaders/{CopyShader,LuminosityHighPassShader,FXAAShader}}` (npm `three@0.128.0`; bản npm dùng bare specifier `'three'` → importmap resolve hết).
- `frontend/vendor/rapier/rapier.es.js` (npm `@dimforge/rapier3d-compat@0.11.2`, wasm inline base64, 0 import ngoài).
- `frontend/index.html` importmap → `./vendor/three/build/three.module.js`
- `test/index.html` importmap → `../frontend/vendor/three/build/three.module.js`
- `Utils/ModelLoader.js` → `'../../../vendor/three/examples/jsm/loaders/GLTFLoader.js'`
- `Physics.js` → `'../../vendor/rapier/rapier.es.js'`

**Observations:** vendor ≈ 3.3 MB. Fix F3 (CDN tampering) + PWA offline thật sự + physics không còn silent-disable khi mất CDN.

**Verification:** smoke test — game boot, `probe: {game:true, ships:8, islands:5}`, physics init OK (không còn warning Rapier), chỉ còn 1 lỗi console = 403 Google Fonts (sandbox chặn, vô hại, pre-existing).

---

## 2. Post-processing pipeline (Renderer.js viết lại)

**Status:** ✅ Done

**Changes:**
- `Renderer.js`: chain **RenderPass → UnrealBloomPass(strength .45, radius .55, threshold .85) → GradePass (vignette .34 + saturation 1.06, shader tự viết) → FXAA**. Composer build LAZY ở lần `setPostFX(true)` đầu → quality=low không tốn RT nào, path render trực tiếp y nguyên pre-AN. API mới: `setPostFX(on)`, `setPixelRatio(pr)` (đồng bộ composer + FXAA resolution), getter `composerEnabled`. Resize hook đồng bộ composer.
- `main.js applyGfx('quality')`: high → `setPixelRatio(min(dpr,2))` + `setPostFX(true)` + `window.setGraphicsHigh(true)` (planar reflection giờ THEO quality — trước đây global `setGraphicsHigh` tồn tại nhưng KHÔNG ai gọi → reflection là dead code path); low → tắt hết.

**Observations:** threshold 0.85 → chỉ sun disc, muzzle flash, lửa, lõi explosion bloom; tone mapping ACES áp trong material nên composer giữ nguyên look + bloom. FXAA bù MSAA mất khi qua render target.

**Verification:** smoke test `composer: true`, 0 lỗi render.

---

## 3. AM — Wind-sway shader cho GLB (thay "sail shader" vì model 1-mesh)

**Status:** ✅ Done

**Changes:**
- `World/ShipEntity.js`: thêm `applyWindSway(root, {baseY, topY, amp})` — inject qua `onBeforeCompile`: sway world-space `sin` 2 trục XZ, mask `smoothstep(uSwayBand)` theo **world Y** (thân tàu 45% dưới đứng yên, cột buồm/buồm phía trên đung đưa), phase theo world XZ (tàu không lắc đồng pha), dùng CHUNG `SAIL_TIME` với sail shader procedural. Thay `#include <project_vertex>` bằng bản world-space giữ `mvPosition` đúng (fog/light chunks không vỡ). `customProgramCacheKey='iow_wind_sway'` → mọi tàu share 1 compiled program, chỉ khác uniform.
- `_tryLoadGLB`: sau autoScale tính bbox đã scale → `baseY = y + minY + h*0.45`, `topY = y + maxY`, `amp = cfg.swayAmp ?? 0.28*sc`; doc thêm `swayAmp` vào SHIP_MODELS config.

**Observations:** shadow depth-material không sway (amp nhỏ, chấp nhận được — ghi nhận known limitation).

---

## 4. AN/G1 — Toast notification queue

**Status:** ✅ Done

**Changes:**
- Mới `UI/ToastQueue.js`: stack tối đa 4 toast top-center, FIFO overflow, dedupe text trong 1.5s (refresh + pulse thay vì xếp đôi), type infer từ emoji/keyword (info/success/warn/danger), click-to-dismiss, **textContent-only → không còn XSS surface ở message path**.
- `GameApp._showMsg(txt,dur,type?)` → delegate `toasts.show` (giữ chữ ký → 30+ call-site hưởng lợi không sửa).
- Migrate 3 chỗ dùng `#msg` trực tiếp: `IslandPanel._flashMsg`, `SeaEvents._flashUI` (map màu cũ → type), `CaptureSystem._capture` (bỏ `_esc()` vì textContent — tránh double-escape).
- CSS `#toast-host`/`.toast*` theo palette brass/ink hiện có (cuối `main.css`).

**Observations:** element `#msg` + CSS cũ thành dead nhưng giữ lại (test/regression an toàn); `.dmg-num` CSS cũng sắp dead sau bước 5.

---

## 5. AN/G2 — FloatTextLayer (damage numbers + income + pickups)

**Status:** ✅ Done (wiring income/treasure ở bước 6)

**Changes:**
- Mới `Systems/vfx/floatText.js`: pool 48 `<span>` cố định (full → recycle oldest, DOM không phình), project world→screen MỖI FRAME (số bám theo tàu/camera), distance-cull 170u trước khi đụng DOM, ease-out rise + fade 25% cuối.
- `Systems/VFX.js`: `this._floatText = new FloatTextLayer(camera)`; tick trong `update(dt)`; facade `vfx.floatText(x,y,z,txt,opts)`.
- `spawnDmg` viết lại → delegate floatText (jitter x ±0.6, '-N') ⇒ **4 call-site damage có sẵn nâng cấp tự động**: tower→ship, defense→ship, ship→ship, fort→ship.

**Wiring hoàn tất (batch 6):**
- `CombatSystem`: số damage vàng `#ffdd44` khi NGƯỜI CHƠI bắn fort (chỉ player → tránh nhiễu).
- `BuildSystem.getProducingInstances()` mới → `EconomySystem` spawn `+N 🪵/🪙` mỗi **3 s** trên từng building đang sản xuất (xanh lá cho gỗ, brass cho vàng; distance-cull sẵn trong layer).
- `SeaEvents`: nhặt rương → `+N 💰` world-anchored tại vị trí tàu (size 15, rise 3.2).
- CSS `#float-text-layer/.ft-label` (JetBrains Mono + text-shadow đậm) và `.ft-hpbar/.ft-hpfill` (chuẩn bị cho bước Fleet HP).
- `InputManager`: emit thêm `input:keyup` + `input:blur` (clear `_keys` khi mất focus) — nền tảng cho hold-Alt, chống kẹt phím khi Alt+Tab.

**Observations:** CSS `.dmg-num` cũ giờ dead hoàn toàn (spawnDmg đã reroute) — giữ lại vô hại.

---

## 6. AN/G4 — Construction & Upgrade progress ring quanh building

**Status:** ✅ Done

**Changes (`Systems/BuildSystem.js`):**
- `makeProgRing()` — ShaderMaterial arc-fill (`uProg`, discard theo góc, 0 ở hướng 12 h, chiều kim đồng hồ) + track ring nền tối; **geometry `PROG_RING_GEO` share toàn cục, không bao giờ dispose**; mat/track material dispose khi gỡ.
- Hook NGAY TRONG 2 vòng timer sẵn có (không thêm iteration): building → ring **brass** `0xe8b840`, upgrade → ring **teal** `0x70c0e0`; `prog = 1 - timer/duration` (đã có sẵn `buildDuration`/`upgradeDuration`).
- Sweep cuối `update()`: inst hết build/upgrade, destroyed, moving → `_removeProgRing` (scene.remove + dispose mat). Map `_progRings` keyed `instanceId`.
- Vị trí: `mesh.position + 0.30 y`, depthTest:false, renderOrder 13/14 — cùng convention RingMaterial.

**Observations:** chỉ đảo player islands (mirror đúng vòng timer hiện tại) — AI build instant nên không cần ring. Demolish khi đang xây → state đổi → sweep tự dọn.

---

## 7. AN/G7 — Fleet tab aggregate HP bar

**Status:** ✅ Done

**Changes (`UI/HudController.js`):**
- Template tab thêm `.ft-hpbar > .ft-hpfill[data-hpfid]` giữa tên và counter.
- Sau khi build tabs: cache `this._tabHp = {fid → fillEl}` (theo pattern cache của file).
- Đầu `update()`: tính tổng `hp/maxHp` của tàu CÒN SỐNG mỗi fleet → width % + màu 3 mức (xanh >60, vàng >30, đỏ) — đồng bộ ngưỡng màu với HP card từng tàu.

**Observations:** rebuild() chạy lại khi ship destroyed/revive → cache tự refresh; fleet 0 tàu sống → bar 0 % (đúng ngữ nghĩa).

---

## 8. Fix Medium-TODO — Fire intensity động (flicker + leo thang theo HP)

**Status:** ✅ Done

**Changes:**
- `vfx/fire.js FireSource`: flicker twin-sine ±22 % (phase random mỗi nguồn → nhiều đám cháy không nhấp nháy đồng pha); `eff = intensity × flick` lái cả emit-rate lẫn n/speed/size/spread của particle; API mới `setIntensity(i)` — **chỉ tăng không giảm** (lửa tự dịu khi chưa repair sẽ đọc như bug).
- `IslandEntity.setOnFire`: đang cháy → `setIntensity` thay vì early-return (root cause của "fire static" — CombatSystem vốn ĐÃ tính lại intensity theo HP mỗi hit <50 % nhưng bị nuốt).

**Verification:** node --check pass cả 2 file.

---

## 9. S3 hoàn tất — Ship despawn/destroy dọn sạch physics + mesh

**Status:** ✅ Done

**Changes:**
- `ShipEntity`: export `disposeShipMesh(root)` với **ownership rules**: geometry chỉ dispose khi `userData.proc` (mesh procedural tự sở hữu — `buildShipMesh` gắn tag); GLB clone SHARE geometry với cache `modelLoader` → KHÔNG BAO GIỜ dispose; material per-instance ở cả 2 path → luôn dispose; texture share qua ref của `material.clone` → không đụng.
- `GameApp 'ship:removed'` (wave cull): overlay + wake + **physics.removeShip** + scene.remove + `disposeShipMesh` + `mesh=null` — single owner.
- `GameApp._onShipDestroyed`: thêm `physics.removeShip` (xác tàu không tick physics nữa — leak ẩn từ trước); **enemy** thì dispose mesh luôn (không bao giờ revive); **player GIỮ mesh** vì `ReviveSystem` tái dùng `ship.mesh` (xác minh ở recon: ReviveSystem.js:64-65).
- `'revive:complete'`: thêm `physics.addShip(ship)` — trả lại body đã gỡ lúc chết.
- `WaveSystem` despawn: chỉ `alive=false` + emit — teardown dồn về 1 chỗ, không double-dispose.

**Observations:** trade-off ghi nhận — material GLB của enemy bị cull/destroy được giải phóng; geometry GLB nằm trong cache modelLoader là CACHE CÓ CHỦ ĐÍCH, không phải leak.

---

## 10. AN/G3 — Alt Tactical View (giữ Alt → thấy mọi vòng tầm bắn, kể cả ĐỊCH)

**Status:** ✅ Done

**Changes:**
- `OverlaySystem.setTactical(on, islands)`: ON → force-show static rings + ship arcs của player BẤT KỂ `st.ovrOn`, đồng thời build **temp rings** cho đảo enemy (đỏ `0xd05848`) và neutral (xám `0x8a98a8`): fort range `r+22` (khớp `_fortFire`) + mọi defense `inst.range` còn sống; OFF → dispose toàn bộ temp (geometry+material đều của riêng temp) và RESTORE đúng trạng thái Tab-toggle (`st.ovrOn`). Idempotent guard `_tacticalOn`.
- `InputController`: `_onKey('alt')` → tactical ON (preventDefault chặn focus menu trình duyệt); bus `input:keyup('alt')` và `input:blur` → OFF (blur = chống kẹt khi Alt+Tab, nhờ InputManager bước 6f).
- `index.html` help modal: thêm dòng `Alt — Tactical view (hold)`.

**Observations:** legend range bật theo khi hold. Patch đầu fail vì đoán sai chữ ký `_onKey(key,…)` vs thật `_onKey(k,…)` — assert chặn ghi file, không có partial write.

---

## 11. Low-TODO — Island shape badge trong IslandPanel

**Status:** ✅ Done

**Changes (`UI/IslandPanel.js`):** map `SHAPE_BADGE` (🌙/⭕/🏰/🌿/🪞/⚪) chèn cạnh tên đảo trong header; nguồn dữ liệu `isl.shapeType` đã lưu sẵn từ AF8 (IslandEntity.js:34). Tooltip = tên shape thô.

---

## 12. Fix bug thật — EventEmitter.off('namespace') xoá cả namespace

**Status:** ✅ Done — test fail #1 chuyển PASS

**Changes:**
- `Utils/Audio.js` thêm 5 SYNTH recipe: `research` (arpeggio C5-E5-G5 sine), `victory` (fanfare 4 nốt saw G4→G5, nốt cuối ngân 0.8 s), `defeat` (sine trượt 220→48 Hz, 1.7 s), `warning` (klaxon square 440/310 ×2), `coin` (triangle 1318+1976 Hz decay nhanh).
- `GameApp`: `building:ready` → 'build' chime; `research:done` → 'research'; `treasure:collected` → 'coin'; `_endGame` → 'victory'/'defeat' thay cho 'build'/'sink' tạm bợ.
- `WaveSystem`: klaxon 'warning' phát cùng banner WAVE N.

**Observations:** đủ checklist audio của milestone AW trong roadmap (build/research/sunk/captured/warning — captured đã có 'build' chime từ trước trong CaptureSystem). Synthesis fallback giữ nguyên; mp3 thật vẫn override qua `_buffers` như cũ.

---

## 13. Verification tổng — smoke test, test suite, screenshots

**Quy trình:** Playwright + Chromium SwiftShader, server tĩnh trên repo root, skip tutorial qua `localStorage` init-script, warp mặt trời lên trưa CHỈ trong page (monkey-patch `sky.update` lúc runtime — không sửa code game) để screenshot sáng.

### Bug tìm thấy & fix TRONG verification (giá trị lớn nhất của smoke test)

**V1 — `_progRings` undefined → TypeError mỗi frame.**
Anchor patch `this._gridMeshes=[];` (không space quanh `=`) khớp NHẦM dòng trong `clearGrid()` thay vì constructor (`this._gridMeshes = [];` có space) → field chỉ init khi clearGrid chạy, còn reset Map làm orphan rings. Fix: gỡ khỏi clearGrid, init đúng constructor. **Bài học: anchor whitespace phải lấy verbatim từ file, assert pass ≠ đúng chỗ.**

**V2 — Màn hình ĐEN toàn bộ khi composer bật (SwiftShader).**
GradeShader dùng `smoothstep(0.85, 0.55, x)` (edge0 > edge1) — **UNDEFINED BEHAVIOR theo spec GLSL**, desktop driver "tha", SwiftShader trả đen. Fix: viết dạng đảo `1.0 - smoothstep(0.55, 0.85, x)`. **Bài học: mọi smoothstep phải edge0 < edge1, không dựa vào driver dễ tính.**

**V3 — Toast opacity kẹt 0 vĩnh viễn (3 vòng forensic).**
- Vòng 1 nghi host detach do `#ui` re-render → hardening `_ensureHost` (isConnected + parent vào `<body>`) — đúng hướng phòng thủ nhưng CHƯA phải root cause.
- Vòng 2 chuyển class-flip transition → `@keyframes ... both` — vẫn 0.
- Vòng 3 forensic `el.getAnimations()` → `toastEnter:running:currentTime 0` sau 450 ms wall-time: **CSS animation timeline của môi trường headless này ĐÓNG BĂNG** (rAF game vẫn chạy) → fill `both` ghim mãi keyframe `from` (opacity 0).
- Fix chốt (đúng cho MỌI môi trường): **visibility không bao giờ phụ thuộc animation clock** — `.toast` opaque từ lúc sinh, entrance chỉ animate `transform`; exit `.toast-out` vẫn fade (clock kẹt thì chỉ mất hiệu ứng, không mất nội dung). Verify: `op:1` ngay cả khi `animT=[0]`.

### Kết quả cuối
- **Page errors: 0** (duy nhất console 403 = Google Fonts bị sandbox chặn — pre-existing, prod không ảnh hưởng).
- **Test suite: 102 PASS / 4 FAIL / 106** — 4 fail còn lại đều pre-existing và NẰM NGOÀI scope code game: zero-mean Ocean (biên thống kê), ReviveSystem test thiếu mesh stub, SpringCamera ×2 (tolerance). EventEmitter fail đã chuyển PASS nhờ fix bước 12.
- **Probe runtime:** composer ON, physics 8 bodies, toast host connected, floatText layer hoạt động (income tick hiển thị khi có building sản xuất), progRings Map init đúng, tactical on/off sạch.
- **Screenshots** lưu tại `docs/img/an_gameplay.png` (toast ×3 đúng màu type, dmg −87, fleet HP bar, sun bloom) và `docs/img/an_tactical.png` (hold Alt: vòng fort mọi đảo + arc pháo từng tàu).

---

## 14. Cập nhật tài liệu dự án

**Status:** ✅ Done — chi tiết bên dưới (TODO.md đánh dấu AM done + thêm bảng AN; README thêm mục vendored runtime, tính năng mới, phím Alt, tools/smoke_test.py)

---

## 15. Final gate & đóng gói

**Status:** ✅ Done

- Final gate (sau MỌI thay đổi, gồm cả CSS/Toast vòng cuối): **pageerrors = []**, probe `{composer:true, ships:8, physics:true, toastHost:connected}`, suite **102 / 4 / 106**.
- Tài liệu: `TODO.md` AM → ✅ ×2 + 11 dòng AN ✅; `README.md` thêm mục *Vendored Runtime*, *New in AM+AN*, *Headless Smoke Test*; harness verify đưa vào `tools/smoke_test.py`; screenshots `docs/img/`.
- Đóng gói: `iow_new_AM_AN.zip` (loại `__pycache__`/`.DS_Store`).

## Tổng kết thay đổi theo file

| File | Thay đổi |
|---|---|
| `frontend/vendor/**` | MỚI — three.module r128 + jsm (GLTFLoader, EffectComposer, RenderPass, ShaderPass, Pass, MaskPass, UnrealBloomPass, CopyShader, LuminosityHighPass, FXAA) + rapier.es.js (~3.3 MB) |
| `frontend/index.html` | importmap → vendor; help modal thêm phím Alt |
| `test/index.html` | importmap → vendor |
| `src/Experience/Renderer.js` | VIẾT LẠI — composer lazy (Bloom→Grade→FXAA), `setPostFX/setPixelRatio/composerEnabled`, fix smoothstep UB |
| `src/main.js` | `applyGfx('quality')` → postFX + planar reflection + pixelRatio wrapper |
| `World/ShipEntity.js` | `applyWindSway` (onBeforeCompile, world-space, shared SAIL_TIME, 1 program cache key), hook `_tryLoadGLB` (band từ bbox đã scale, `cfg.swayAmp`), `disposeShipMesh` ownership-aware, tag `userData.proc` |
| `UI/ToastQueue.js` | MỚI — queue/stack/dedupe/type-infer; host chống detach; opacity độc lập animation clock |
| `GameApp.js` | `_showMsg` → toasts (giữ chữ ký); import; `ship:removed` full teardown; `_onShipDestroyed` + physics.remove + dispose enemy; `revive:complete` + physics.addShip; audio cues (build-ready/research/coin); `_endGame` victory/defeat |
| `UI/IslandPanel.js`, `Systems/SeaEvents.js`, `Systems/CaptureSystem.js` | #msg trực tiếp → toasts (Capture bỏ `_esc` vì textContent) |
| `Systems/vfx/floatText.js` | MỚI — pool 48 span, re-project mỗi frame, distance-cull 170u |
| `Systems/VFX.js` | gắn FloatTextLayer (ctor/update/facade); `spawnDmg` → pooled world-anchored |
| `Systems/CombatSystem.js` | dmg number khi player bắn fort |
| `Systems/BuildSystem.js` | `getProducingInstances()`; progress ring (shader arc, Map theo instanceId, sweep); fix init constructor (V1) |
| `Systems/EconomySystem.js` | income FX timer 3 s |
| `Systems/WaveSystem.js` | despawn chỉ emit (teardown về GameApp); klaxon warning |
| `InputManager.js` | emit `input:keyup` + `input:blur` (clear keys) |
| `Controllers/InputController.js` | Alt down/up/blur → `overlay.setTactical` |
| `UI/OverlaySystem.js` | `setTactical(on, islands)` — temp rings enemy/neutral, restore theo `st.ovrOn` |
| `UI/HudController.js` | fleet tab HP bar + cache + sync |
| `Systems/vfx/fire.js` | flicker twin-sine, `eff` lái particle, `setIntensity` (chỉ tăng) |
| `World/IslandEntity.js` | `setOnFire` escalate thay vì early-return |
| `EventEmitter.js` | `off('ns')` ưu tiên namespace đang tồn tại |
| `Utils/Audio.js` | 5 recipe synth mới |
| `src/styles/main.css` | toast (keyframes transform-only), float-text, ft-hpbar |
| `TODO.md`, `README.md`, `tools/smoke_test.py`, `docs/img/*` | tài liệu + harness + ảnh |

## Known limitations / đề xuất kế tiếp (AO?)
- Shadow của tàu GLB không sway theo buồm (depth material không inject — amp nhỏ, khó nhận ra).
- 4 test fail pre-existing thuộc về TEST chứ không phải game code: nới tolerance SpringCamera, stub mesh cho ReviveSystem, nới biên zero-mean Ocean.
- God rays chưa có cloud mask (low-TODO còn lại); ATOLL causeway gap; tree placement trên cell non-grass; IslandPanel bld-detail flicker — giữ nguyên trong backlog cũ.
- Toast exit fade phụ thuộc animation clock (env đóng băng clock chỉ mất hiệu ứng mờ, không mất chức năng).

═══════════════════════════════════════════════════════════════════
# SESSION 2 — Milestone AO + AP: Admiralty UI Revamp & Strategy Core
═══════════════════════════════════════════════════════════════════
> Yêu cầu: (1) revamp UI đẹp + dễ dùng hơn, (2) nâng game thành tựa
> chiến thuật thật sự — xây đảo & quản lý tài nguyên là trụ cột ngang
> với hải chiến, không chỉ lái tàu.

## 16. AO — Admiralty Chart UI (đã làm ở đầu session, verify ở bước 21)

**Status:** ✅ Code xong, chờ verify

**Changes:**
- `main.css` +~700 dòng design system "Admiralty Chart": dark slate `#0c1822` + gold instrument glass, token mới (`--nav-*`, `--txt-*`, `--accent-*`, `--cat-*`), override toàn bộ parchment stack cũ bằng `!important` (top-header, actbtn, utilbtn, resource chips, view-bar, objectives, .panel/.ph/.pt, build panel → **card grid 2 cột** với category colour strip, fleet tabs, island panel docked TRÁI 300px + bld-detail 280px cạnh nó, semantic classes `.isl-*`, `.bld-summary-*`, `.const/upgrade/damaged-card`, `.prod-chip`, `.cell-bar*`).
- `IslandPanel._renderIsland` VIẾT LẠI hoàn toàn: header (tên + owner badge + shape), Fort section (HP bar màu 3 mức + Defense/Range stat grid), Production (chips 🪵🪙 + cell usage bar), Buildings grid 2 cột (chip click → detail, overflow +N), các section Building/Upgrading/Needs-Repair/Destroyed/Fort-Rebuild theo card style, Actions (🏗 Build / ✕ Close), CTA cho đảo địch/neutral. Event delegation `data-action` thay onclick inline.
- `BuildPanel`: thêm `item.dataset.cat` → colour strip trái theo loại (resource/military/defense/utility).

**Observations (recon):** HUD cap-warning ĐÃ TỒN TẠI (đổi màu 85 %/100 % + tooltip "build Warehouses") → bỏ item này khỏi plan.

## 17. AP — Strategy Core: PLAN

| # | Feature | Cơ chế |
|---|---------|--------|
| A | **Island Traits** | Mỗi đảo 1 trait: 🌲 Timberland +50 % wood · ⛏ Goldvein +50 % gold · 🛡 Bastion +25 % fort HP/dmg · ⚓ Haven regen tàu đồng minh 2 HP/s gần đảo. CHIẾM ĐẢO NÀO = quyết định chiến lược. |
| B | **Adjacency bonus** | Mill/Mine cạnh building CÙNG LOẠI (orthogonal): +10 %/láng giềng, trần +30 %. ĐẶT ĐÂU = quyết định chiến lược. Tính từ `gridKey` + footprint sẵn có. |
| C | **Neutral starter buildings** | Đảo neutral spawn sẵn 2 công trình sản xuất (theo trait) ở trạng thái dormant (production chỉ tính đảo player) → chiếm xong là THỪA KẾ — phần thưởng mở rộng nhìn thấy trước được (IslandPanel mới hiện buildings của mọi đảo = scout). |
| D | **Empire Overview** (phím **O** / nút header thứ 6 ⚜) | Bảng toàn đế chế: mỗi đảo player 1 hàng (trait, prod, fort HP, số building, badge 🔥/🏗/⚠) — click nhảy camera + mở island panel; strip tổng Σprod; mục "Unclaimed" liệt kê đảo neutral + trait → gợi ý mục tiêu chiếm. |

Hook đã recon: `inst.gridKey="col_row"`, `_spawnMesh(def,{x,z})` (line ~580), `getProductionRates`/`getProducingInstances` (line 645+), `IslandEntity` ctor hp/tdmg (line 17-19), `PANEL_MAP` main.js:108, `_onKey` InputController. Test 04_Economy an toàn: trait undefined → mult 1; adjacency guard `!gridKey → 1`.


## 18. AP — Implementation chi tiết

**Status:** ✅ Done

**A — Island Traits (`src/data/traits.js` MỚI):**
- `ISLAND_TRAITS` data-driven: timber(woodMult 1.5)/goldvein(goldMult 1.5)/bastion(fortMult 1.25)/haven(repairRate 2, range r+16); helper `getTrait(isl)` null-safe.
- `maps.js` gán: Enemy Citadel=🛡bastion (nut cứng, thematic) · North Shoal=🌲timber · South Shoal=⛏goldvein · Central Isle=⚓haven (giá trị tiền tuyến) · Home Port=plain.
- `IslandEntity` ctor: bastion ×1.25 hp/maxHp/tdmg (round) — capture-weaken ×0.85 vẫn áp chồng đúng thiết kế.
- `GameApp.update`: haven aura tick **2 Hz** (không per-frame), O(havens×ships) nhỏ; floatText `+⚓` teal 25 % xác suất làm feedback.
- `IslandPanel`: badge trait (icon+tên+desc) dưới owner badge — class `.isl-trait*`.
- `CaptureSystem` toast: `🏴 X captured! 🌲 Timberland · 2 buildings inherited` — người chơi THẤY giá trị vừa giành được.

**B — Adjacency bonus (`BuildSystem`):**
- `getAdjacencyMult(inst, isl)`: map cellKey→instance (footprint-expand từ `gridKey`), đếm DISTINCT láng giềng cùng `buildingId` chia cạnh orthogonal → `1 + 0.10×min(n,3)`. Guard `!gridKey→1`, chỉ mill/mine.
- `_traitMult(isl, bldId)` + adjacency nhân vào **CẢ HAI** production fn (`getProductionRates`, `getProducingInstances`) → HUD rate, income float text, EconomySystem, EmpirePanel tự đồng bộ từ 1 nguồn sự thật. `getProducingInstances` trả thêm `isl` ref cho Empire per-island breakdown.

**C — Neutral starter buildings (`BuildSystem.seedNeutralStarters`):**
- Idempotent (`st._neutralSeeded`) — an toàn save/load sau này. Theo trait: timber→2 mill, goldvein→2 mine, haven→1 mill, plain→mill+mine. Cell tự do = `_cells − _occupiedKeys`, shuffle Fisher-Yates. Inst chuẩn schema player (hpByLevel[0], state active, mesh qua `_spawnMesh`). **Dormant by design**: production filter `own==='player'` sẵn có → 0 đóng góp tới khi chiếm; IslandPanel mới liệt kê building MỌI đảo ⇒ scout được phần thưởng trước khi đánh.
- Gọi 1 lần trong GameApp ngay sau `new BuildSystem(...)`.

**D — Empire Overview (`UI/EmpirePanel.js` MỚI, ~170 dòng):**
- Hàng/đảo player: trait icon (tooltip desc), tên + `FORT DOWN`, HP bar 3 mức màu, prod 🪵/🪙 (đã nhân trait+adjacency), `N🏠`, badge 🔥/🏗n/⚠n. Click row → `_selectIsland` (camera + IslandPanel) + tự đóng.
- Totals strip: Islands n/total, Σ🪵 Σ🪙 from buildings. Section **"Unclaimed waters — capture targets"**: đảo neutral + trait + `N🏠 inherit` (dashed border) → biến bảng quản lý thành công cụ RA QUYẾT ĐỊNH chiếm đảo nào.
- Re-render: 1 Hz khi mở (`tick(dt)` từ GameApp.update) + bus events (placed/ready/destroyed/captured/research). Event delegation `data-action`.
- Wiring: nút header thứ 6 `⚜ Empire [O]` (index.html), `PANEL_MAP['empire-panel']` (main.js), phím **O** trong `InputController._onKey`, help modal thêm dòng O. CSS `.emp-*` theo token Admiralty.

## 19. Verification saga — 3 bug tìm & fix TRONG verify

**V4 — Empire vô hình dù `open` class đúng (forensic: `opacity:0`).**
Root cause KÉP, đào ra cả bug TIỀM ẨN của toàn dự án:
- **P1**: EmpirePanel tự chế class `.open`, nhưng PanelManager **inject stylesheet** `.panel{opacity:0; pointer-events:none}` + chỉ `.pm-open` mới hồi → panel hiện display nhưng opacity 0 và KHÔNG CLICK ĐƯỢC. Fix: Empire đi qua `PanelManager.open/close` chuẩn; CSS `#empire-panel.pm-open{display:flex !important}` (PM set inline `block`, layout cần flex).
- **P2 (pre-existing, ảnh hưởng MỌI `.panel`)**: stylesheet PM dùng **transition opacity 0→1** — cùng họ frozen-animation-clock đã gặp ở toast (session 1): môi trường timeline đóng băng (headless/throttled tab) kẹt opacity 0 vĩnh viễn → **đây chính là lý do Build panel vô hình ngay screenshot ĐẦU session**. Fix triệt để theo nguyên tắc đã đúc kết: *visibility không bao giờ đi qua animation clock* — PM stylesheet chuyển transform-only slide, opacity 1 từ lúc sinh.

**V5 — Objectives overlap.** Objectives (top-left cũ) đè header IslandPanel dock trái → chuyển objectives sang **top-right** (border-right gold). Sau đó lại đụng góc Build panel (cùng top-right) → rule `body.lp-open #objectives{display:none}` (PM đã gắn `lp-open` khi bp/lp/rp mở). Lần verify đầu tưởng fail — thực ra **race CSS giữa 2 run ghi đè cùng tên file screenshot**; probe trực tiếp xác nhận `objDisp:none` ✓. Bài học: shot fail ≠ code fail, probe computed-style trước khi sửa tiếp.

**V6 — Fleet cards không ẩn khi panel mở (pre-existing).** Rule cũ ẩn fleet bằng `opacity+visibility transition` → frozen clock không bao giờ hidden. Harden: `body.lp-open #fleet-panel/#fleet-tabs{display:none !important}`.

**Lỗi vận hành tool:** 1 run Playwright treo ở `httpd.shutdown()` sau khi screenshot đã ghi → từ đó mọi run dùng `timeout N` + `os._exit(0)`.

## 20. Final gate AO+AP

- **Probe:** seed neutral 2/2/1 đúng trait; Bastion 250 HP / 23 dmg (=200/18 ×1.25 ✓); Empire opacity 1, mở bằng phím O thật; page errors **0**.
- **Test suite: 102 / 4 / 106** — y nguyên 4 fail pre-existing (zero-mean Ocean, revive stub, SpringCamera ×2). Trait/adjacency KHÔNG phá 04_Economy nhờ guard (trait undefined→1, !gridKey→1).
- **Screenshots** `docs/img/`: `ap_island_home` (panel dock trái: fort grid stats, production, cells 0/68, nút Build/Close) · `ap_island_neutral` (scout: NEUTRAL badge, 🌲 Timberland, 2 mill dormant, CTA) · `ap_empire` (totals + Your islands + **Unclaimed waters capture targets**) · `ap_buildpanel` (card grid 2 cột, category color strip, locked 🔒, objectives & fleet nhường chỗ).

## 21. Tổng kết file — Session 2

| File | Thay đổi |
|---|---|
| `src/data/traits.js` | MỚI — ISLAND_TRAITS + getTrait |
| `src/data/maps.js` | trait per island (bastion/timber/goldvein/haven) |
| `src/Experience/World/IslandEntity.js` | bastion ×1.25 fort tại ctor |
| `Systems/BuildSystem.js` | `_traitMult` + `getAdjacencyMult` + nhân vào 2 production fn (+`isl` ref) + `seedNeutralStarters` |
| `Systems/CaptureSystem.js` | toast trait + N buildings inherited |
| `src/Experience/GameApp.js` | import traits/Empire; seed call; `_empire` init + `tick`; haven aura 2 Hz |
| `UI/EmpirePanel.js` | MỚI — Empire Overview |
| `UI/IslandPanel.js` | trait badge (sau rewrite AO đầu session) |
| `UI/PanelManager.js` | **P2 hardening**: injected CSS transform-only, opacity tách clock |
| `Controllers/InputController.js` | phím O |
| `src/main.js` | PANEL_MAP empire-panel |
| `index.html` | nút ⚜ Empire thứ 6 + help O |
| `src/styles/main.css` | +~850 dòng: Admiralty system (AO) + `.isl-trait` + `.emp-*` + objectives phải + lp-open hide objectives/fleet |

## 22. Known limitations / Next (AQ?)
- EnemyAI CHƯA ưu tiên đảo theo trait khi chọn mục tiêu chiếm — gợi ý AQ: weight = trait value + dormant buildings.
- Adjacency chưa có preview "+10%" khi HOVER ô lúc build-mode (hiện chỉ phản ánh sau khi đặt qua income/Empire) — UX polish kế tiếp.
- BuildPanel vẫn build trên `_homeIsl` (đảo player gần nhất được chọn) khi đang xem đảo neutral — đúng logic nhưng title có thể gây nhầm 1 nhịp.
- i18n: chuỗi mới (Empire/trait/IslandPanel) đang EN literal — chưa qua `T`.
- Fleet-hide & objectives-hide dùng display (mất fade) — trade-off chủ đích cho tính đúng.

---

## 23. Session-3 — Audit chéo, gap-fill & re-gate độc lập

**Status:** ✅ Done

**Bối cảnh:** session này chạy AUDIT chéo trên toàn bộ AO+AP (UI revamp + Strategy Core) thay vì viết mới — phần lớn implementation đã tồn tại trong workspace từ session 2 (§16-22).

**Kết quả audit (kế hoạch → hiện trạng):**
| Hạng mục | Trạng thái |
|---|---|
| traits.js + maps assignments (bastion/timber/goldvein/haven) | ✅ có sẵn, logic chuẩn |
| Bastion ×1.25 fort (IslandEntity ctor) | ✅ |
| Haven aura 2 HP/s (GameApp, 2 Hz) | ✅ |
| `_traitMult` + `getAdjacencyMult` nhân vào CẢ 2 production fn | ✅ — adjacency footprint-aware, null-safe `gridKey`, cap +30% |
| `seedNeutralStarters` (idempotent, trait-matched, `_spawnMesh` đúng chữ ký) | ✅ |
| Empire: GameApp init/tick + main.js PANEL_MAP + nút ⚜ + phím O + help | ✅ |
| EnemyAI instances có `gridKey` (an toàn khi đảo bị chiếm chảy qua adjacency) | ✅ |
| HUD cap-warning | ✅ ĐÃ CÓ TỪ TRƯỚC (HudController :317-347, inline style >85% wax / at-cap đỏ #cc4444 + bold + tooltip) — grep đầu miss vì tìm class `cap-warn`, code dùng style trực tiếp. **Bài học: audit theo HÀNH VI (đọc vùng updater), đừng chỉ grep theo tên dự đoán.** |

**Gap thật tìm thấy & fix (V4):** BuildPanel hiển thị `0/100 cells` trong khi IslandPanel `0/68` — BuildPanel dùng `BUILD_GRID_SIZE²` (pre-AF8 full grid), bỏ qua shape mask. Fix: `homeIsl.validGridKeys?.size` fallback grid² (đồng bộ nguồn với IslandPanel). Re-gate trim xác nhận `"0/68 cells"`, 0 pageerror.

**Re-gate độc lập (full):**
- pageerrors **[]**; composer ✓ physics ✓ empire ✓.
- Neutral seed runtime: `neu_n timber→2 mill, neu_s goldvein→2 mine, neu_c haven→1 mill` — đúng spec từng đảo.
- **Adjacency runtime-assert:** inject 2 lumber mill cạnh nhau trên home (qua `_cells`/`_occupiedKeys` thật) → `getAdjacencyMult = 1.1` → splice sạch. 
- Cap-warn live: ép `resWood=cap` → `#rv-w` chuyển wax (near-cap path verified end-to-end; at-cap branch `#cc4444` code-reviewed cùng vùng).
- Test suite **102 / 4 / 106** (4 fail pre-existing ngoài scope, như §0).
- Screenshots mới `docs/img/`: `ap_home_build.png` (IslandPanel trái + BuildPanel card-grid + lock states + cap-warn amber 800/800), `ap_empire.png` (Empire Overview: Your Islands + Unclaimed Waters kèm trait & "N inherit" + adjacency hint), `ap_island_neutral.png` (NEUTRAL badge + 🌲 Timberland card + 2 dormant Lumber Mill + capture CTA).

**Đóng gói:** `iow_new_AO_AP.zip`.

═══════════════════════════════════════════════════════════════════
# SESSION 3 — Milestone AQ: SC2 Placement, Panel Discipline & Dual Theme
═══════════════════════════════════════════════════════════════════
> Yêu cầu: (1) grid xây dựng kiểu StarCraft 2; (2) quá nhiều panel chồng
> chéo, khó thao tác; (3) 2 theme — giữ dark hiện tại VÀ vàng parchment
> "như bản Opus".

## 23. AQ-B1 — SC2-style placement (BuildSystem)

**Status:** ✅ Done

**Changes:**
- **Ghost building hologram** bám chuột: mesh thật của building (cylinder/box theo `def.model`) + `AdditiveBlending` opacity .55 (phát sáng kiểu hologram) + **viền `EdgesGeometry`** tối (xanh `0x06381a`/đỏ `0x4a0c06`) để đọc được trên nền đảo cùng tông. 1 material share toàn cục (`_ghostMat`/`_ghostEdgeMat`) — flip màu theo validity, **zero alloc per-frame**; geometry rebuild chỉ khi đổi building (`_ghostFor`), dispose trong `clearGrid → _clearGhost`. Snap vào TÂM footprint (`offX/Z=(fp-1)/2×CELL`), xoay theo `st.buildRotated` (phím R).
- **Grid nền dịu**: valid 0.50→**0.16**, occupied 0.70→**0.42** (cả `showGrid` lẫn nhánh reset trong `hoverAt`); footprint hover 0.90→**0.92** — đúng triết lý SC2: grid là backdrop, ghost+footprint là tín hiệu.
- `hoverAt` giữ nguyên pipeline cũ (đã có footprint highlight từ trước) — chỉ chèn block ghost trước vòng tô cell.

**Bug thật đào ra trong verify (V7):** `_spawnMesh` đặt building ở **y=1.2** trong khi mặt đảo ~2.0 và grid plane 2.2 → **mọi building mesh (kể cả mill neutral của AP) bị CHÔN trong đảo, vô hình từ trước tới giờ**. Fix: building y=2.35, ghost y=2.4. Screenshot `aq_neutral_mills.png` xác nhận 2 mill North Shoal lộ diện với icon sprite — scouting bằng MẮT giờ hoạt động đúng như thiết kế AP.

**Verification:** probe `{ghost:true, visible:true, col:'35ff6a'}` valid / `'ff3322'` khi hết gỗ; screenshots `aq_ghost_valid/invalid.png` (hologram xanh phát sáng ↔ đỏ rực + footprint cell cùng màu; topbar wood 0/800 đỏ cảnh báo đồng bộ).

## 24. AQ-B2 — Panel discipline

**Status:** ✅ Done

**Changes (`UI/PanelManager.js`, `Controllers/InputController.js`, `UI/IslandPanel.js`, CSS):**
- **GROUPS exclusive theo vùng**: `left=[island-panel, bld-detail]` · `right=[bp, rp, lp, upgrade-panel]` · `center=[empire-panel, revive-panel]`. `PM.open(id)` đóng sibling cùng vùng trước → tối đa 1 panel/vùng, hết "xếp chồng".
- **bld-detail thành drill-down**: chiếm slot TRÁI (left 316→8px, thay island panel qua group), header thêm nút **← Back** (`.bd-back`, once-listener) → `close('bld-detail')` + `show(isl)` quay lại đúng đảo.
- **ESC peel**: `PM.closeTop()` mới (duyệt `_stack` ngược, đóng panel mở gần nhất) — `_onKey('escape')`: cancel build-mode → **peel panel** → mới tới pause. Bare-ESC mới pause được.

**Verification (probe 8220):** `drill {islandHidden:true, detailLeft:8, hasBack:true}` · `esc {detailClosed:true, paused:false}` · `groups {bpOpen:false, rpOpen:true}` (mở rp tự đóng bp). Screenshot `aq_drilldown.png`.

## 25. AQ-B3 — Dual theme (Admiralty ↔ Parchment)

**Status:** ✅ Done

**Changes:**
- **Variable-hoá khối AO**: 54 literal màu → 17 biến (`--chrome-bg(-2..4)`, `--panel-bg/solid/deep`, `--veil-0..3`, `--track`, `--hover-tint(-strong)`, `--gold-tint(-soft/-strong)`, `--key-bg`) — mapping in theo count để audit; literal hiếm còn sót chấp nhận được.
- **2 palette**: `:root` = Admiralty dark (giá trị cũ y nguyên) · `body.theme-parchment` override TOÀN BỘ (chrome kem `rgba(243,231,200,.96)`, veil nâu `rgba(70,45,15,…)`, `--txt-primary #2c1d0c`, `--accent-gold #8a6a2a`, nav-edge nâu…) — **1 body class flip cả skin, layout giữ nguyên 100 %**.
- Settings: row **UI Theme** (Admiralty/Parchment) clone đúng pattern toggle sẵn có; `GFX_DEFAULTS.theme='admiralty'`; `applyGfx('theme')` toggle body class (chạy được TRƯỚC khi engine boot — không cần `_game`); persist `iow_gfx`; `<body class="theme-admiralty">` mặc định chống flash.
- Chèn THEME_VARS qua `body.replace('/* ',…,1)` — đuôi `/* ` của block tự "hàn" lại comment kế tiếp (đã kiểm chứng CSS hợp lệ, ghi lại vì là pattern dễ gây hiểu nhầm khi đọc diff).

**Verification:** `aq_parchment.png` — topbar vàng kem chữ ink, Island panel + Build panel cùng skin parchment với đầy đủ AP UI sống (production +3/s, Buildings(1) Lv2, Needs Repair row 55/70 HP, card ×1 badge, locked mờ). Đúng "màu vàng như bản Opus" trên layout mới.

## 26. Final gate AQ

- Probe 6/6: ghost valid/invalid màu đúng · drill-down trái + Back · ESC peel không pause · group exclusivity · page errors **0**.
- **Test suite 102 / 4 / 106** — y nguyên 4 pre-existing.
- Screenshots mới trong `docs/img/`: `aq_ghost_valid/invalid`, `aq_neutral_mills`, `aq_parchment`, `aq_drilldown`.
- Ops note: camera island-mode không settle trong sandbox screenshot (SpringCamera/fleet-follow) → shots dùng hard-override camera per-page; KHÔNG ảnh hưởng game thật. 1 run treo `httpd.shutdown` → mọi run sau dùng `timeout` + `os._exit(0)`.

## 27. Tổng kết file — Session 3

| File | Thay đổi |
|---|---|
| `Systems/BuildSystem.js` | Ghost hologram (+edges, additive, share-mat), grid nền 0.16/0.42, `_clearGhost` trong clearGrid, **y-fix 1.2→2.35 cho _spawnMesh** (V7) |
| `UI/PanelManager.js` | GROUPS exclusive + `closeTop()`; (P2 session trước giữ nguyên) |
| `Controllers/InputController.js` | import PM; ESC: build-cancel → closeTop → pause |
| `UI/IslandPanel.js` | bld-detail header ← Back + handler once |
| `src/styles/main.css` | bld-detail left 8px; `.bd-back`; **THEME LAYER**: 54 literal→var, `:root` dark + `body.theme-parchment` palette |
| `index.html` | settings row UI Theme; `<body class="theme-admiralty">` |
| `src/main.js` | GFX_DEFAULTS.theme, applyGfx('theme'), tog-theme wiring |

## 28. Known limitations / Next
- Ghost không hiển thị facing của defense (arc preview đã lo phần đó) — có thể xoay ghost theo `buildFacingDeg` sau.
- Theme chỉ phủ chrome AO/AP/AQ; vài widget cũ (fleet cards, minimap khung) giữ skin dark gốc ở cả 2 theme — nhất quán chấp nhận được, liệt kê để pass sau nếu cần.
- `EdgesGeometry` ghost rebuild mỗi lần đổi building (≤1 lần/lượt chọn) — không đáng tối ưu thêm.

═══════════════════════════════════════════════════════════════════
# SESSION 4 — Milestone AR: Unified Context Dock (IA overhaul)
═══════════════════════════════════════════════════════════════════
> Phản hồi người dùng: "quá nhiều panel overlap, quá nhiều thao tác".
> Chẩn đoán: AQ chỉ chống chồng chéo, CHƯA giảm số panel/click. Vấn đề
> là Information Architecture, không phải styling.

## 29. AR — Chẩn đoán IA hiện trạng

**11 panel, chức năng trùng lặp nghiêm trọng:**
- `island-panel` ĐÃ hiện buildings + upgrade cards + repair. `bld-detail` là panel RIÊNG cho cùng building. `upgrade-panel` là panel THỨ BA cũng về upgrade → **3 panel/1 việc**.
- `bp` (Build) tách khỏi island-panel dù xây dựng VỐN thuộc về đảo. Luồng xây 1 nhà = click đảo → đọc panel → bấm Build → bp mở vùng khác → chọn building → click cell ⇒ **5-6 thao tác, 2 panel khác vùng**.
- Entry point phân tán: 6 nút top-bar + 3 view-bar + phím tắt.

**Quyết định:** GỘP island-panel + bld-detail + upgrade-panel + bp → **MỘT Context Dock** dock phải, cuộn dọc:
1. Overview (fort/production/cells) — luôn ở đầu.
2. **Build palette INLINE** — nhóm Resources/Military/Defense collapse được, click item → vào build-mode ngay (ghost SC2 đã có từ AQ), KHÔNG mở panel riêng.
3. Buildings list — click 1 nhà → **expand chi tiết INLINE** (upgrade/move/raze/repair tại chỗ), không drill sang panel khác.

Nguyên tắc: 1 panel cho toàn bộ vòng đời đảo · ≤2 click cho thao tác thường gặp · build-mode không rời context đảo.


## 30. AR — Context Dock implementation

**Status:** ✅ Done

**Kiến trúc:** GỘP 4 panel (island-panel cũ + bld-detail + bp + upgrade-panel) thành MỘT dock dock-phải cuộn dọc (`IslandPanel.js` viết lại core ~380 dòng). Ba vùng trong 1 panel:
1. **Header + Overview** (sticky): tên đảo, owner badge, trait badge, Fort HP bar, chips Production (🪵🪙 đã nhân trait+adjacency) + Cells.
2. **Build palette INLINE** (`_renderBuildPalette`): 4 nhóm collapse được (Resources/Military/Utility/Defenses) với badge "đủ tiền/tổng"; click card → `_pickBuild` vào SC2 build-mode NGAY (ghost hologram từ AQ), dock KHÔNG đóng. State `_openGroup` nhớ nhóm đang mở.
3. **Buildings list** (`_renderBuildingRow`): mỗi nhà 1 row, click → **expand chi tiết INLINE** (state `_openInst`): stats theo loại, HP, nút Upgrade/↻Move/🗑Demolish + Repair (nếu hư) — tất cả tại chỗ, KHÔNG drill sang panel khác. Under-construction rows hiện progress bar realtime.

**Đảo địch/neutral:** chỉ Overview + trait + CTA "Sail a fleet here to capture · N buildings to inherit" + Buildings read-only (scouting). Không có build palette.

**Một click handler** (`_wireDock`) delegation cho cả dock: close/toggle-grp/pick-build/expand-bld/upgrade/move/demolish/repair/rebuild-fort.

**Wiring:**
- `bp` PANEL_MAP → `_openBuildDock()` (GameApp): chọn đảo player đang chọn (hoặc đầu tiên), mở dock với Resources expanded. Nút Build [1] và phím 1 đều vào đây.
- `bld-detail` thành stub ẩn (`display:none`) — mọi `PanelManager.close('bld-detail')` legacy thành no-op. `showBuildingDetail()` giữ chữ ký (các caller cũ) nhưng giờ chỉ set `_openInst` + render inline.
- `upgrade-panel` retired khỏi PANEL_MAP + NUM_PANELS (phím 5 bỏ).
- BuildPanel.js vẫn được construct nhưng INERT (`bp` không bao giờ mở; `_render` chỉ ghi vào `#bp-content` ẩn).
- Helpers `_upgradeInst/_moveInst/_demolishInst` giữ nguyên, chỉ đổi `showBuildingDetail`/`PanelManager.close('bld-detail')` → `_openInst` + `_refresh`.

**CSS** (+~190 dòng, dùng theme vars từ AQ nên CẢ 2 theme tự hỗ trợ): `#island-panel` dock phải sticky-header scroll, `.dock-overview/.dock-section/.dock-grp*/.dock-build-card/.dock-bld-row/.dock-bld-detail/.dock-btn-*`. Category colour strip tái dùng `--cat-*`.

**Bug fix trong verify:**
- **AR-V1:** `IslandPanel` dùng `T` (i18n) trong `_pickBuild` hint nhưng THIẾU import → `T is not defined` throw giữa render. Thêm `import { T } from '../../i18n.js'`. Đây là regression do dock mới gọi `T.clickGreen/rotateHint` (BuildPanel cũ có import, IslandPanel cũ không cần).
- **AR-V2:** objectives (top-right từ AP) đè header dock (cũng top-right) → chuyển objectives về **top-LEFT** (border-left gold), gỡ rule `body.lp-open #objectives` (không còn cần vì khác phía). Dock chiếm cố định top-phải.

**Verification:**
- IA: `openPanels: []` khi expand building inline — đúng 1 dock, ZERO overlap (trước AR: click building = island-panel + bld-detail = 2 panel; giờ = 0 panel phụ).
- Build flow E2E: select → pick → ghost → `tryBuildAt` → building count 0→1, dock vẫn mở, build-mode auto-exit. `errs:[]`.
- Số click giảm: xây 1 nhà trước AR = click đảo → nút Build → (panel khác vùng) chọn → click cell = **4-5 thao tác 2 vùng**; sau AR = click đảo → click card trong dock → click cell = **3 thao tác 1 vùng**, mắt không rời dock.
- Screenshots `docs/img/`: `ar_dock_overview` (overview+palette+buildings 1 panel), `ar_dock_detail` (Lumber Mill expand inline: stats/HP/Upgrade·Move·Raze), `ar_dock_neutral` (scout: trait+CTA+inherit count), `ar_dock_build`/`ar_after_build` (build-mode giữ dock).
- **Test suite 102 / 4 / 106** giữ nguyên.

## 31. Tổng kết & đóng gói — Session 4

| File | Thay đổi |
|---|---|
| `UI/IslandPanel.js` | VIẾT LẠI core thành Context Dock (~380 dòng mới): `_renderIsland`/`_renderBuildPalette`/`_renderBuildingRow`/`_wireDock`/`_pickBuild`/`showBuildingDetail`(inline)/`_isUnlocked`; import T; helpers cũ giữ |
| `Experience/GameApp.js` | `_openBuildDock()` global |
| `src/main.js` | `bp`→`_openBuildDock`; retire upgrade-panel; phím 5 bỏ |
| `src/styles/main.css` | +~190 dòng dock; objectives→top-left; gỡ lp-open hide objectives |

**Panel còn lại sau AR:** dock (island, gộp 4), research(rp), loadout(lp), revive, empire, market, settings, help, fleet — từ 11 xuống **9**, và 4 panel-vòng-đời-đảo gộp còn 1. Không panel nào overlap trong luồng xây dựng.

## 32. Known limitations / Next
- BuildPanel.js để inert thay vì xoá hẳn (an toàn — vẫn còn DOM `#bp` ẩn). Có thể dọn ở milestone dọn-dẹp.
- Empire panel & Research/Loadout vẫn là panel riêng (center/right) — hợp lý vì không thuộc vòng đời 1 đảo; nhưng nếu muốn "1 cửa" tuyệt đối, có thể nhúng Research tiến độ vào dock sau.
- Dock chưa có nút collapse-to-icon (luôn full width 316px khi mở) — có thể thêm minimize sau nếu màn nhỏ.
- `_openBuildDock` chọn đảo player đầu nếu chưa chọn — với nhiều đảo, có thể thêm island switcher trong dock header.

═══════════════════════════════════════════════════════════════════
# SESSION 5 — Milestone AS: Tug-of-War core (Age of War) + panel cleanup
═══════════════════════════════════════════════════════════════════
> (Opus 4.8 tiếp quản từ Fable 5.) Định hướng người dùng: IoW × RTS ×
> Tug-of-war, tham chiếu Age of War. Cannon Loadout GIỮ layout riêng
> (di sản IoW). Mọi panel khác tiếp tục đơn giản hóa.

## 33. AS — Thiết kế WarFront (Age of War-style)

**Cốt lõi:** trục giằng co Home Port (trái) ↔ Enemy Citadel (phải). `warFront`
0–100, 50 = bế tắc. Người chơi đẩy về 100, địch đẩy về 0.

| Nguồn lực đẩy front | Hướng |
|---|---|
| Pressure liên tục (mỗi 0.5s): (islands ta − địch)×3 + (tàu sống ta − địch)×1.2 + econ-edge×0.4, scale ×dt | ± theo net momentum |
| Chiếm đảo | +8 impulse |
| Đánh chìm tàu địch | + (8 + rank-bonus); flagship +35 (đòn quyết định, KHÔNG auto-win) |
| Mất tàu ta | −5 |
| Fort đảo ta bị phá | −6 · Fort địch bị phá | +6 |

**Win/lose:** front ≥100 → victory, ≤0 → defeat. THAY THẾ 3 điều kiện rời rạc
(flagship/diệt-sạch/loot-1000) bằng MỘT trục trực quan luôn hiển thị. Flagship
kill giờ là cú đẩy lớn chứ không phải auto-end → đúng tinh thần tug-of-war.

**HUD:** thanh ngang đỉnh màn hình, crest ta đẩy từ trái, địch từ phải, vạch
chia di động — nhịp tim của trận đấu, luôn hiện.

**Panel cleanup kèm:** `ab-port`→`upgrade-panel` là nút CHẾT sau AR (panel đã
retire) → gỡ nút Port khỏi top-bar (Home Port giờ là dock khi click đảo nhà).


## 34. AS — Implementation & verification

**Status:** ✅ Done

**Files mới:**
- `Systems/WarFront.js` — logic tug-of-war. `state.warFront` 0–100 (50=stalemate).
  - **Continuous pressure** (2 Hz): net = (Δislands)×3 + (Δships)×1.2 + (Δecon)×0.4, clamp ±6, ×dt. Econ-edge của player lấy từ `BuildSystem.getProductionRates()`; địch xấp xỉ `enemyIslands×1.5` (địch chưa có econ-sim thật).
  - **Impulses** (event): capture +8 / lose island −8 / sink enemy +8(+rank bonus) / flagship +35 / lose ship −5 / fort địch −fort ta ±6. Lắng nghe `island:captured`, `ship:destroyed`, `island:fort_destroyed` (đã sửa từ tên sai `fort:destroyed`).
  - Win ≥100 / lose ≤0, fire MỘT lần (`_ended` guard). Floating delta tag trên bar mỗi impulse.
- `UI/WarFrontHUD.js` — thanh ngang đỉnh: fill teal (trái/ta) + red (phải/địch) + divider gold di động + %; glow "winning/losing" khi ≥75/≤25. Update mỗi frame, skip <0.15% để khỏi ghi style thừa.

**GameApp:**
- import + init `_warFront`/`_warHUD` sau `_empire`; tick cả hai trong `update`.
- **Gỡ 3 instant-win cũ**: flagship-kill & all-enemy-sunk (trong `_onShipDestroyed`) và loot≥1000 — giờ chỉ feed WarFront qua impulse. Flagship = cú +35 (đòn quyết định, không auto-end) đúng tinh thần Age of War.
- Giữ all-islands-captured/lost làm terminal override hợp lệ (chiếm sạch = front cũng tới 100; mất sạch = tới 0 — nhưng vẫn end ngay vì là trạng thái tận cùng thật).
- `_updateObjectivesUI` viết lại: WAR FRONT % + trend ▲gaining/▼losing/—even + islands you·foe + enemy ships afloat + "Push the front to 100% to win".

**Panel cleanup:** gỡ nút **Port** (`ab-port`→`upgrade-panel` đã retire ở AR — nút chết); dọn "/1000" khỏi loot chip (loot không còn là win-line). Top-bar: 6→5 nút.

**CSS** (+~75 dòng, theme-aware qua vars): `#warfront` fixed dưới header, `.wf-fill-l/r` gradient teal/red, `.wf-divider` gold glow, `.wf-delta` rise animation, glow winning/losing; đẩy `#objectives`/`#hud-top` xuống top 90–92px nhường chỗ bar.

**Verification (Playwright SwiftShader):**
- Bar tồn tại, khởi đầu 50%, divider 50% → bò lên 50.99 do continuous pressure (player 1 đảo + tàu > địch) — tug sống ngay từ đầu. ✓
- Impulse capture +8 (50→59), flagship +35 (59→94). ✓
- Win: đẩy qua 100 → `_endGame(true)`, gameOver, 🏆. ✓
- Lose: đẩy về 0 → `_endGame(false)`, "💀 DEFEATED". ✓
- `errs:[]` xuyên suốt. **Test suite 102/4/106** giữ nguyên (4 pre-existing).
- Screenshots `docs/img/`: `as_warfront_base` (50%, objectives tug-of-war), `as_warfront_pushed` (95% teal thắng thế), `as_warfront_win`, `as_warfront_lose`.

**Lưu ý harness:** `bus` là singleton module-level (`EventBus.js`), KHÔNG nằm trên `_game` → probe phải gọi `_warFront.impulse()` trực tiếp hoặc patch `_endGame`, không `g._bus.emit`. (Trong game thật các system import `bus` từ module nên hoạt động đúng.)

## 35. Tổng kết & đóng gói — Session 5

| File | Thay đổi |
|---|---|
| `Systems/WarFront.js` | MỚI — tug-of-war core (pressure + impulse + win/lose) |
| `UI/WarFrontHUD.js` | MỚI — thanh front ngang đỉnh |
| `Experience/GameApp.js` | init/tick WarFront+HUD; gỡ 3 instant-win cũ; objectives viết lại tug-of-war |
| `index.html` | gỡ nút Port; dọn loot chip "/1000" |
| `src/styles/main.css` | +~75 dòng warfront bar (theme-aware); nudge objectives/hud-top |

**Triết lý đạt được:** IoW × RTS × Tug-of-war. Mọi hành động (chiếm đảo, đánh
chìm, kinh tế) giờ hội tụ vào MỘT trục War Front luôn hiển thị — người chơi
luôn biết đang thắng hay thua, như Age of War. Cannon Loadout vẫn là layout
riêng (di sản IoW) — không đụng tới. Panel: tiếp tục giảm (6→5 nút top-bar).

## 36. Known limitations / Next
- Continuous-pressure econ-edge của địch là xấp xỉ phẳng (`enemyIslands×1.5`); nếu sau này thêm econ-sim cho AI thì thay bằng số thật.
- WarFront chưa có "checkpoint" kiểu Age of War (front kẹt ở mốc giữa cho tới khi phá fort). Có thể thêm: front bị chặn tại 25/75% tới khi fort tương ứng bị hạ → tạo nhịp công thành.
- Bar chưa map trực quan lên đường nối Home↔Citadel trong 3D (hiện chỉ là HUD 2D). Có thể vẽ đường front trên mặt biển sau.
- Old i18n strings (enemyFlagshipDestroyed, allEnemyShipsSunk) giờ unused — để lại, dọn sau nếu cần.

═══════════════════════════════════════════════════════════════════
# SESSION 6 — Milestones AU (RTS command layer) + AV (HUD revamp)
═══════════════════════════════════════════════════════════════════
> 2026-10-14 → 10-16. Request: reorganise the folder, upgrade the game
> "a lot" on real-time strategy and ship command; mid-way: revamp the UI,
> and keep scrollbars out of the HUD. (The AT session was not logged here;
> its summary is in `TODO.md`.)

## 37. Baseline
- Game loads clean; test suite **102 pass / 4 fail / 106** (the 4 failures
  are the known AN-era ones). Python is not installed on this machine →
  added `tools/serve.mjs` (Node, no-cache static server) and
  `.claude/launch.json` (`iow-dev`). Snapshot of the untouched tree kept in
  the session scratchpad.

## 38. AU-0 — Reorganisation
- Root docs moved: handoffs → `docs/archive/handoffs/`, deep review →
  `docs/archive/2026-05-23_deep_review.md`, AH–AZ plan → `docs/roadmap/`.
  New `docs/README.md` index.
- `Experience/Systems/` split by domain: `Naval/ Combat/ Economy/ Match/
  AI/ Vision/ VFX/`. 25 files moved, 73 import specifiers rewritten by a
  script; a second script checks every relative import resolves with EXACT
  case (the `vfx`→`VFX` rename needed a two-step move on Windows).
- `test/*.test.js` had cp1252 mojibake in comments and suite names
  (`â”€`…) plus BOMs → repaired run-by-run (strict UTF-8 decode only).
- `tools/smoke_test.py` paths made repo-relative (was `/home/claude/...`).
- Result identical to baseline: 102 / 4.

## 39. AU — RTS command layer
New modules:
- `Systems/Naval/Navigation.js` — island-aware paths: visibility graph
  (start, goal, 10 nodes per island at R/cos(π/N)), Dijkstra; goals pushed
  out of islands; ships hugging a shore can still leave.
- `Systems/Naval/Formations.js` — Line Ahead / Line Abreast / Wedge slots
  centred on an anchor; greedy distance assignment (no crossing).
- `Systems/Naval/OrderSystem.js` — per-ship queues (`move · amove ·
  attack · siege · patrol · hold`), group march (anchor follows the path
  at the slowest ship's speed ×0.9, slows to regroup, wheels gradually,
  pauses while members fight), broadside engagement orbit (range of the
  strongest broadside × 0.62, rings spread but capped at 92 % of gun
  range), idle/attack-move acquisition (≥ 24 u), squadmate assist, leash.
- `Controllers/CommandController.js` — click/box/double-click selection,
  smart right-click, A/P targeting, S/H/F/T, control groups (Ctrl/Shift/
  plain 1–9 via `e.code`), F2/Ctrl+A, Space; siege warns when no gun can
  reach a fort.
- `World/CommandMarkers.js`, `UI/CommandCard.js`, `data/commands.js`.
Changed: `MovementSystem` (hull turn rate + accel/brake, dt-correct,
turn-circle fix), `CombatSystem` (focus target, nearest in arc, Hold
Fire), `FleetCommander` (fleets = control groups 1–9; roles now issue
orders), `InputManager` (drag/dblclick/middle-pan/pointer/code),
`CameraController` (arrows, edge, grab-pan, follow selection),
`Minimap` (viewport frame, drag, right-click orders, fleet colours,
correct heading), `GameApp`, `i18n` (EN fallback for every language).

Bugs found and fixed while verifying:
- **WarFront auto-win in ~28 s** with no input (pressure ×12 too strong;
  pre-existing since AS) → weights /12.
- **World froze when the last ship sank** (leader gate in the loop).
- **Capture counted only the first living ship.**
- **Player ships never shot pirates** (not in their target list).
- Ships orbited a slot inside their turning circle forever → arrival speed
  capped so turn radius ≤ ½ remaining distance.

## 40. AV — HUD revamp (+ "no scrollbars")
- One bottom **command console** (`#console`): chart + view strip ·
  selection (fleet chips + ship cards) · orders + commander abilities.
  Shrinks when the island dock opens (`body.dock-open`).
- `UI/ShipBars.js` — floating hull bars (own: selected/hovered/damaged;
  foes: visible and hovered/damaged/targeted; Alt: all).
- Order paths drawn as ribbons (GL lines were 1 px); queued legs drawn
  once per group; selection rings get a fill disc.
- Tutorial, pause, end screen, help/settings, objectives, market, island
  tooltip restyled to the same glass + brass language; both themes.
- No scrollbars in the HUD: `HudController.fit()` chooses card density
  from the room per card (full ≥122 px · compact ≥86 · mini ≥46 · then a
  "+N" chip) and shrinks fleet chips; header drops brand/labels under
  1240/1100 px and wraps to two rows on phones. Layout never uses CSS
  transitions (frozen-timeline lesson from AO).
- All new CSS lives in `styles/hud.css` (replaced the short-lived
  `rts.css`); `main.css` is untouched.

## 41. Verification
- Browser suite: **126 pass / 4 fail** (+24 new tests in
  `11_NavalCommand.test.js` and the import graph; the 4 are the old ones).
- Scripted play through `test/harness.js` (new): group move + formation
  change, Shift-queue of 3 waypoints, siege & capture of North Shoal
  (~18 s), attack, attack-move, patrol with squadmate assist, aggressive
  idle response, hold/stop/stance cycling, all selection paths.
- Layout checked by DOM geometry at 1440×810, 1024×640 and 375×812
  (dock open/closed, 5 and 14 ships): no overflowing scroll container.
- Screenshots: `docs/img/av_console.jpg`, `av_dock_open.jpg`,
  `av_parchment.jpg`, `av_1024.jpg`.
- Not verified: real mouse/touch hardware feel (input was synthetic),
  performance with large fleets on low-end devices.

## 42. Known limitations / next
- Enemy AI does not use OrderSystem yet (formations, pathing, broadsides).
- Starting loadout (one swivel) is outranged by every enemy gun.
- Rally points / production queue, under-attack alerts, phone-specific HUD.
- `main.css` consolidation (3 900 lines of stacked layers).
