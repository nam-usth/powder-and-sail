# TODO — Powder & Sail · AV
> Last updated: AU (RTS command layer + repo reorganisation) and AV (HUD revamp) — 2026-10-16
> Format: [severity] description — *root cause / notes*

---

## 🔴 Critical
_None known._

- [x] ~~**Match auto-won in ~28 s with no input**~~ — Fixed (AU): WarFront
  continuous pressure was ×12 too strong (opening +2 ships alone gave
  +1.8 %/s). Weights divided by 12; see `Systems/Match/WarFront.js`.
- [x] ~~**Game froze when the last player ship sank**~~ — Fixed (AU): the
  frame loop returned early without a "leader", so revives never finished.
- [x] ~~**Capture only counted the first living ship**~~ — Fixed (AU):
  any ship in range now captures (`CaptureSystem`).

---

## 🟠 High

- [ ] **4 pre-existing test failures** (unchanged since AN): Ocean
  zero-mean sample, ReviveSystem test stub has no `mesh`, two SpringCamera
  settling checks. Decide whether the tests or the code are wrong.
- [ ] **Enemy AI does not use the order layer** — it still steers with
  `moveToward` and its own fan formation. Port it to `OrderSystem` groups
  (formations, island-aware paths, broadside engagement) so both sides fight
  by the same rules.
- [ ] **Starting loadout is a single swivel (range 8)** — player ships are
  outranged by every enemy gun until the Loadout panel is used, and cannot
  reach an island fort at all (the siege order now warns about this).
  Balance question: give starter hulls a side battery?

- [x] ~~**Fog of War incomplete**~~ — Done (AL): GPU shader plane, `float[8]` uniforms for ship positions, correct enemy visibility sync.
- [ ] **Sail shader không apply cho GLB models** — procedural mesh có billowing shader, nhưng GLB model có sail riêng không nhận `updateSailTime` uniform.

---

## 🟡 Medium

- [x] ~~**IslandPanel slot counter**~~ — Done: progress bar + `usedCells/maxCells` in IslandPanel.

- [x] ~~**ATOLL causeway gap**~~ — Done (AT): causeway is now distance-to-LINE
  (not ray), spanning the full lagoon diameter — always bridges two opposite
  parts of the ring.

- [x] ~~**Tree placement on non-grass cells**~~ — Done (AT): shape-aware cell
  filter in `_placeTrees` (skips fort centre, ATOLL lagoon/causeway,
  FORTRESS bastions) + trees are now one InstancedMesh per island.

- [x] ~~**Fire intensity static after ignition**~~ — Done in AN (twin-sine
  flicker + HP escalation); row was stale.

- [x] ~~**IslandPanel bld-detail flicker**~~ — Done (AT): real cause was the
  0.25 s UI tick rebuilding identical innerHTML; render now skips when HTML
  is unchanged and preserves scrollTop otherwise. (The old
  getBoundingClientRect note was stale — bld-detail panel retired in AR.)

- [ ] **Audio assets** — Audio.js dùng procedural synthesis (Web Audio API oscillators). Cần `.webm` files để có sound thực sự. Dùng `audio.load(name, url)` → `audio.playBuffer(name)`.

- [ ] **`main.css` is 3 900 lines of stacked milestone layers** with many
  `!important` overrides; AU/AV add `hud.css` on top instead of editing it.
  A consolidation pass (one rule per element, per-component files) would
  remove most `!important`. Do it with screenshot comparison per panel.

- [ ] **Rally point / production queue** — bought and revived ships spawn
  idle at Home Port. Add a rally point (right-click with the island
  selected) and a shipyard queue.

- [ ] **Under-attack alerts** — no minimap ping or "jump to last alert"
  key when an out-of-view ship or island is hit.

- [ ] **Phone layout** — under 760 px the header wraps to two rows and the
  selection cards are hidden (orders + chart only); a dedicated touch HUD
  (selection strip, long-press orders) would be better.

- [ ] **Long content panels still scroll internally** (research list,
  loadout, island dock when tall). The HUD itself never scrolls (AV:
  `HudController.fit()` packs cards/chips); the panels need a layout pass.

- [ ] **Ctrl+1–8 may be taken by the browser** (tab switching) outside a
  standalone PWA window; Shift+1–9 (add to fleet) always works.

---

## 🟢 Low

- [x] ~~**Island shape label in HUD/IslandPanel**~~ — Done in AN (shape badge
  in IslandPanel); row was stale.

- [x] ~~**Neutral island capture keeps shape**~~ — Covered by the AN shape
  badge (shows for any owner incl. after capture).

- [x] ~~**God rays**~~ — Done (AT): drifting two-band pseudo-cloud mask in the
  Sky shader; shafts now fade in/out over time.

- [x] ~~**EnemyAI _histTimer jitter**~~ — Done (AT): timer subtracts the 0.15 s
  interval instead of resetting to 0, so sampling cadence no longer drifts
  with frame rate.

---

## 📋 Milestone backlog

| Milestone | Feature | Status |
|-----------|---------|--------|
| AG | GLTF ship models + tier system | ✅ Done |
| AG | Sail billowing shader | ✅ Done |
| AG | Spatial Audio.js utility | ✅ Done |
| AG | VFX refactor (vfx/ subfolder) | ✅ Done |
| AG | Planar reflection (high graphics) | ✅ Done |
| AH | EnemyAI v2 — wolfpack + 6 strategies | ✅ Done |
| AH | Defense arc preview + Q/E rotation | ✅ Done |
| AH | Ring/arc mesh consistency (RingMaterial.js) | ✅ Done |
| AH | Build grid shader (always above water) | ✅ Done |
| AH | CombatSystem hit/miss VFX logic fix | ✅ Done |
| AH | Water ripple rings on splash | ✅ Done |
| AH | exitIslandFocus() grid auto-clear | ✅ Done |
| AH | IslandPanel slot counter | ✅ Done |
| AH | BuildPanel no-flicker (_updateAffordability) | ✅ Done |
| AI | Fog of War GPU shader overlay | ✅ Done |
| AI | Trade routes + dynamic market (TradeSystem.js) | ✅ Done |
| AJ | Win conditions: flagship kill + all ships sunk | ✅ Done |
| AJ | Objectives panel (top-left HUD) | ✅ Done |
| AK | New ships: Man-o-War, Schooner (data/ships.js) | ✅ Done |
| AK | New cannons: Chain Shot (speed debuff), Grapeshot (AoE) | ✅ Done |
| AK | Treasure Hunt sea event (floating chest + collect) | ✅ Done |
| AL | PWA manifest.json | ✅ Done |
| AL | Tutorial overlay (first-launch, skip-able) | ✅ Done |
| AM | Audio event cues (5 synth recipes: research/victory/defeat/warning/coin) wired to bus | ✅ Done |
| AM | Wind-sway shader for GLB models (world-space height-mask — GLB là single merged mesh nên thay thế "sail shader" theo tên mesh) | ✅ Done |
| AN | Vendored Three.js r128 + Rapier vào `frontend/vendor/` (offline PWA thật, hết phụ thuộc unpkg/skypack — fix F3) | ✅ Done |
| AN | Post-processing pipeline: UnrealBloom + Grade (vignette/saturation) + FXAA, bật theo quality=high, lazy-build | ✅ Done |
| AN | Toast notification queue thay #msg đơn (stack 4, dedupe, type-color, textContent-only) | ✅ Done |
| AN | FloatTextLayer pooled: damage numbers world-anchored (re-project mỗi frame), income +N 🪵/🪙 mỗi 3 s, treasure +💰 | ✅ Done |
| AN | Construction/upgrade progress ring (brass/teal arc-fill shader) quanh building | ✅ Done |
| AN | Fleet tab aggregate HP bar (3 mức màu) | ✅ Done |
| AN | Fire intensity động: flicker twin-sine + leo thang theo HP fort (fix "static after ignition") | ✅ Done |
| AN | S3 hoàn tất: ship despawn/destroy gỡ physics body + dispose ownership-aware (proc dispose geo, GLB share cache) | ✅ Done |
| AN | Alt tactical view: hold Alt → mọi range ring kể cả enemy/neutral fort + defenses | ✅ Done |
| AN | Island shape badge trong IslandPanel | ✅ Done |
| AN | EventEmitter.off('ns') xoá đúng cả namespace (test 01 fail → pass; suite 102/106) | ✅ Done |
| AO | Admiralty Chart UI: dark design system thống nhất (header/panels/buttons/resource chips), IslandPanel rewrite dock-trái, BuildPanel card-grid 2 cột + category strips, objectives → top-right, PanelManager opacity hardening (fix Build panel vô hình ở frozen-timeline env) | ✅ Done |
| AP | Island Traits (🌲timber/⛏goldvein/🛡bastion/⚓haven) — chiếm đảo = quyết định chiến lược | ✅ Done |
| AP | Adjacency bonus: mill/mine cạnh cùng loại +10%/neighbour (max +30%) — đặt đâu = quyết định | ✅ Done |
| AP | Neutral starter buildings: dormant theo trait, scout được, thừa kế khi chiếm | ✅ Done |
| AP | Empire Overview (phím O / nút ⚜): toàn đế chế + capture targets 1 màn hình | ✅ Done |
| AQ | SC2-style placement: ghost hologram bám chuột (additive + edge outline), grid nền dịu, footprint xanh/đỏ; fix building y chôn trong đảo | ✅ Done |
| AQ | Panel discipline: GROUPS exclusive trái/phải/giữa, bld-detail drill-down + Back, ESC peel panel trước pause | ✅ Done |
| AQ | Dual theme Admiralty/Parchment: 54 literal→17 CSS vars, settings row, persist, 1 body class flip | ✅ Done |
| AR | Unified Context Dock: gộp island-panel+bld-detail+bp+upgrade-panel thành 1 dock (overview+build palette inline+building detail inline); 11→9 panel, build-mode không rời context, ≤3 thao tác/xây nhà | ✅ Done |
| AS | Tug-of-war core (Age of War): thanh War Front 0–100 luôn hiển thị, pressure liên tục + impulse sự kiện, win ≥100/lose ≤0 thay 3 điều kiện rời rạc; gỡ nút Port chết (6→5 nút top-bar); Cannon Loadout giữ layout riêng | ✅ Done |
| AT | Commander Abilities (CommanderSystem.js): Z ⚔ Barrage (instant reload +50% dmg 10s) · X 🌬 Winds (fleet +40% spd 12s) · C 🛠 Repairs (heal 25% over 5s); cmd-bar bottom-centre; comeback valve — cooldown hồi nhanh +25% khi War Front < 45 | ✅ Done |
| AT | Mobile/PWA: touch controls trong InputManager (tap=click, drag=hover/ghost, pinch=zoom, touch-action:none) + auto-quality first-run (mobile/≤4 cores ⇒ low + shadows off) | ✅ Done |
| AT | Perf: trees = 1 InstancedMesh/island, shared static geo/mat (hết N mesh + N material) | ✅ Done |
| AT | Polish: ATOLL causeway xuyên lagoon, tree filter theo shape, god-rays cloud mask, IslandPanel no-flicker (skip identical innerHTML + giữ scroll), EnemyAI hist cadence ổn định | ✅ Done |
| AU | Repo reorganised: root docs → `docs/`, `Systems/` split into Naval/Combat/Economy/Match/AI/Vision/VFX, test-file encoding repaired, Node dev server, play harness | ✅ Done |
| AU | RTS selection: click, box, Shift add/toggle, double-click same hull, F2/Ctrl+A; fleets = control groups 1–9 (Ctrl assign, Shift add, double-tap centre) | ✅ Done |
| AU | Order queues per ship: move, attack-move, attack, siege & capture, patrol, hold, stop; Shift-queue; smart right-click; minimap right-click | ✅ Done |
| AU | Formations (Line Ahead / Line Abreast / Wedge) with anchor march + regroup; island-aware path planning (visibility graph) | ✅ Done |
| AU | Ship handling: hull turn rates + acceleration/braking, frame-rate independent; no orbiting of close targets | ✅ Done |
| AU | Stances (Aggressive / Defensive / Hold Fire), broadside engagement orbit, focus fire + nearest-target gunnery, squadmate assist; player ships now shoot pirates | ✅ Done |
| AU | RTS camera: arrows, screen edge, middle-drag, follow-selection, Space centre; minimap viewport + drag | ✅ Done |
| AU | Fixes: WarFront auto-win in 28 s, world freeze with no ships afloat, capture by first ship only | ✅ Done |
| AV | HUD revamp: unified bottom command console (chart · selection · orders + abilities), redesigned ship cards and fleet chips, floating hull bars, order ribbons, overlays restyled, narrow-screen/phone layouts | ✅ Done |

---

## ✅ Fixed / Added in AF8

### New file: data/islandShapes.js (192 lines)
- [x] `makePrng(seed)` — mulberry32 seeded PRNG, deterministic, no Math.random
- [x] `genCrescent(seed)` — disc minus arc bay, outer=4.9, min=55 slots
- [x] `genAtoll(seed)` — annulus + lumpy inner edge + optional causeway, min=60
- [x] `genFortress(seed)` — core(r=3.0) + 4 rotated arms + 4 bastions, min=68
- [x] `genSprawl(seed)` — blob union clipped to disc, min=50
- [x] `generateShape(type, seed)` — public API with ≥50 slot guarantee fallback
- [x] `mirrorShape(keys)` — flips col=GRID-1-col for enemy island mirroring
- [x] All 4 types verified ≥50 slots across 10+ seeds before shipping

### data/maps.js
- [x] `shape` + `seed` fields added to all 5 ISLAND_DEFS
- [x] Enemy home (`home_b`) uses `shape:'MIRROR', seed:4242` — mirrors player
- [x] Neutral islands get distinct shapes: North=CRESCENT, South=ATOLL, Central=FORTRESS

### data/constants.js
- [x] `BUILD_GRID_SIZE` 5 → 10 (10×10 = 100 cells max)
- [x] `BUILD_CELL_WORLD` 3.2 → 2.4 (tighter spacing for larger grid)

### World/IslandEntity.js (296 lines, full rewrite)
- [x] `_buildGridKeys(def)` — calls generateShape() or mirrorShape()
- [x] `this.validGridKeys` Set stored on instance
- [x] `this.shapeType` stored for future UI/debug use
- [x] `_buildCreMesh()` — disc + sunken bay + wide grass plateau
- [x] `_buildAtollMesh()` — shore ring + lagoon water disc + rim torus
- [x] `_buildFortressMesh()` — octagonal base + stone deck + 4 corner bastions
- [x] `_buildSprawlMesh()` — wide shore + scaled ellipse grass + central mound
- [x] `_placeTrees()` — samples validGridKeys evenly (not random) for stable layout
- [x] All AF7 fire methods preserved (setOnFire, clearFire, updateFire, rebuildFort)

### Systems/BuildSystem.js
- [x] `_cells(isl)` — filters by `isl.validGridKeys`, skips invalid shape cells
- [x] `canPlaceFootprint()` — validates ALL footprint cells are in validGridKeys

## ✅ Fixed in AF7
- [x] DirectionalLight orbits with Sky sun
- [x] Fort burns below 50% HP, extinguished on repair/rebuild/destroy

## ✅ Fixed in AF6
- [x] GPU fire/smoke shaders, shockwave, muzzle flash, FireSource
- [x] Sky sun disc, god rays, day cycle, stars
