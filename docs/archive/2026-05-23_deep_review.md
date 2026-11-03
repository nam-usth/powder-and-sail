# Project Deep Review & Improvement Roadmap
> Reviewer: Opus 4.7 · Date: 2026-05-23 · Scope: deep scan, full codebase
> Status: AH stable + AI/AJ/i18n/WakeSystem/LoadoutPanel done

---

## 📊 Codebase metrics

| | Value | Note |
|---|---|---|
| JS source files | 65 | manageable |
| Total LOC | 10,679 | medium project |
| Largest file | GameApp.js 765 | god class |
| CSS LOC | 2,714 | single file — split |
| `window._game` refs | **39** | global anti-pattern |
| `innerHTML =` | **36** | XSS risk + perf |
| `document.getElementById` | **122** | uncached lookups |
| `new THREE.*` | **248** | check pooling |
| `.dispose()` | 28 | low ratio |
| Test files | 11 | ~17% coverage |
| `TODO/FIXME` | 1 | clean |

---

## 🔥 TIER S — Bugs hidden in code (fix today)

### S1 — Shared material mutation in construction state
**[BuildSystem.js:430](frontend/src/Experience/Systems/BuildSystem.js#L430)**
```js
inst.mesh.traverse(c => { if(c.isMesh && c.material) c.material.opacity=0.45; c.material && (c.material.transparent=true); });
```
**3 bugs in one line:**
1. `c.material.opacity` mutates the SHARED material from `_spawnMesh` → other buildings using same material go transparent
2. Second statement runs even for non-Mesh objects (e.g. Group, Sprite without filter)
3. When construction completes, restore loop also touches shared material
**Fix:** Clone material per instance OR set `material.transparent = true` once at spawn and use `mesh.userData.constructing` for fade animation via shader uniform.

### S2 — `CaptureSystem._capture()` mutates `isl.tdmg`
**[CaptureSystem.js:111](frontend/src/Experience/Systems/CaptureSystem.js#L111)**
```js
isl.tdmg = Math.round(isl.tdmg * 0.85);
```
Compounds on every recapture: capture → recapture → capture = `tdmg × 0.85³ = 0.614×`. After ~5 swaps, towers are useless. Should set absolute `0.85 × originalTdmg`, not progressive multiply.

### S3 — Wave despawn leaks meshes
**[WaveSystem.js:56](frontend/src/Experience/Systems/WaveSystem.js#L56)**
```js
excess.forEach(s=>{ s.alive=false; if(s.mesh) s.mesh.visible=false; this._bus.emit('ship:removed',{ship:s}); });
```
Only hides mesh. Does NOT:
- Remove from `WakeSystem._trails` Map
- Remove physics body via `physics.removeShip()`
- Dispose mesh geometry/material
- Remove from `OverlaySystem`
After many waves, hidden ships accumulate Three.js memory + physics steps tick on dead bodies.

### S4 — `EnemyAI` ship combat targets wrong forts
**[GameApp.js:606-608](frontend/src/Experience/GameApp.js#L606)** + **[EnemyAI.js:70](frontend/src/Experience/Systems/EnemyAI.js#L70)**
Player tickShip targets `[...eForts, ...nForts]` (enemy+neutral forts). EnemyAI does `_islands.filter(i => !i.down && i.own !== 'enemy')` which includes neutral. **But** neutral fort firing back at enemy ships isn't wanted — neutrals should only fire on whoever attacks them. Currently neutrals always shoot enemy ships even when not provoked.

### S5 — `EnemyAI._tickBuild` gridKey ignores island shape
**[EnemyAI.js:266](frontend/src/Experience/Systems/EnemyAI.js#L266)**
```js
gridKey: `${active.length % 10}_${Math.floor(active.length / 10)}`
```
Counter-based. Doesn't check `validGridKeys` → AI buildings placed on invalid cells (visual mismatch, occluded by lagoon water for ATOLL islands). Player upgrades from `IslandPanel` operate on `gridKey` → may misbehave if AI building.

### S6 — `LoadoutPanel.js` ship navigator excludes dead ships
**[LoadoutPanel.js:159-165](frontend/src/Experience/UI/LoadoutPanel.js#L159)** (new file)
`all = st.playerShips.filter(x => x.alive)` for prev/next. If user opens loadout for dead ship via fleet HUD → `idx = -1` → next button goes to ship[0]. Should include dead ships in nav but disable equip actions.

### S7 — `applySpeed` allocates closures every call
**[ShipEntity.js:212](frontend/src/Experience/World/ShipEntity.js#L212)**
Called every cannon swap × every ship in preset apply. Inside: `CANNONS.find(c => c.id === ...)` — O(n) per slot. Pre-index `CANNON_BY_ID = new Map(CANNONS.map(c => [c.id, c]))` shared module-level.

### S8 — `recalcWarehouse()` ran on a 5-second timer, never on building events
**[GameApp.js:602-603](frontend/src/Experience/GameApp.js#L602)**
```js
this._warehouseTimer = (this._warehouseTimer || 0) + dt;
if (this._warehouseTimer >= 5) { this._warehouseTimer = 0; this._build.recalcWarehouse(); }
```
Player builds Warehouse → up to 5s before cap bonus applies, up to 5s before protection updates. Should call on `building:placed`, `building:upgraded`, `building:destroyed`, `building:demolished`, `building:ready` events.

---

## 🏗 TIER A — Architecture (significant refactor)

### A1 — State sprawl: `GameState.js` has 130 mixed-concern fields
Read [GameState.js](frontend/src/Experience/GameState.js). Properties span:
- **Resources** (wood, gold, loot)
- **Renderer flags** (fogOn, rangeFill)
- **Build mode** (selectedBuilding, buildRotated)
- **Research effects** (combatDmgMult, towerBurn, chainShotSlow)
- **Stats** (fired, hit, sunk)
- **Navigation** (tgtX, tgtZ — UNUSED, FleetCommander has its own)
- **AI hint** (aiState, aiTgtX, aiRetargetTimer — also in EnemyAI internal)
- **Camera** (camDist, camMode, camLockedId, camPanSpeed)
- **Behavior methods** (`getAuraRange`, `getRegenRate`, `getVisionR`)

**Problems:**
1. AV save/load milestone will be painful — must serialize 130 fields, skip references like `_homeIsland`
2. Migration safe-guards: ungrouped fields → can't version schema sections
3. Methods on state break JSON serialization
4. `aiState`/`aiTgtX` duplicate EnemyAI internal state — unclear source of truth

**Suggested refactor:**
```js
const state = {
  meta:      { gameOver, paused, frame, statsTimer },
  resources: { wood, gold, loot, capBonusW, protectedW, woodBonus, goldBonus },
  research:  { techIds: Set, labLevel, effects: { combatDmgMult, ... } },
  build:     { selectedBuilding, buildMode, rotated, facingDeg, islandBuildings },
  fleets:    [...],
  ships:     { player, enemy, all },
  ui:        { selectedShip, selectedIslandId, fogOn, rangeFill },
  camera:    { dist, mode, lockedId, panSpeed, tgt },
  ai:        { /* delegated to EnemyAI */ },
  capture:   { progress: {}, raidCooldown: {} },
  stats:     { fired, hit, sunk, dmgDealt, dmgTaken, timeSec },
};
```
Pure data, no methods. Helpers in `StateHelpers.js`: `getAuraRange(state)`, etc.

### A2 — `Math.random()` everywhere kills determinism
~70 `Math.random()` calls. Breaks:
- AV save/load: state diverges on resume vs save point
- BF replay system (AZ roadmap): can't replay matches
- Bug reports: "AI did X" can't be reproduced
- AI testing: every run different

**Fix:** Single seeded PRNG service:
```js
// Utils/RNG.js — mulberry32 (already in islandShapes.js!)
export const rng = makeRng(matchSeed);  // call rng() instead of Math.random()
```
Migrate over time. Combat, AI, VFX particles can stay Math.random (cosmetic). Game logic (loot rolls, AI decisions, spawn positions) → `rng()`.

### A3 — `CombatSystem.tickShip` is a single 80-line function with closures per frame per slot
**[CombatSystem.js:53-137](frontend/src/Experience/Systems/CombatSystem.js#L53)**
Hot path: 5 player ships × ~3 slots × 60fps = 900 closures/sec just for hit-resolution VFX callbacks (`this._vfx.fireBall(..., ()=>{ ... })`).

**Pieces to extract:**
- `_resolveShipHit(attacker, slot, cn, target)` returns `{hit, dmg, statusEffects}`
- `_resolveFortHit(attacker, slot, cn, isl)` returns same
- Apply damage in a separate `_applyImpact` helper called by fireBall callback
- Pre-index `CANNON_BY_ID` Map at module level — already mentioned (S7)

### A4 — Mixed responsibilities: who owns what?
| Concern | Owner now | Should be |
|---|---|---|
| AI targeting state | EnemyAI + GameState | EnemyAI only |
| Building production | BuildSystem | new ProductionSystem |
| Construction timers | BuildSystem | new ConstructionSystem |
| Warehouse calc | BuildSystem | WarehouseAggregator |
| Wave spawning | WaveSystem + EnemyAI build | WaveSystem (spawn) + EnemyAI (control) — already OK |
| Capture rules | CaptureSystem | OK ✓ |
| Status effects | StatusEffects (good) | OK ✓ |
| HP bars | Per-class custom | UnifiedHpBarPool ? |

### A5 — Onclick string concat = inline JS
**[IslandPanel.js:306-315](frontend/src/Experience/UI/IslandPanel.js#L306)**
```js
onclick="window._game&&window._game._islandPanel&&window._game._islandPanel._upgradeInst('${inst.instanceId}','${isl.def.id}')"
```
- Breaks if `instanceId` has `'` (currently 36-char random base — safe but fragile)
- No CSP support
- Requires global ref chain
- Can't pass non-stringifiable args
**Fix:** Use `data-action="upgrade"` + delegated listener. Single click handler attached to panel, reads `event.target.closest('[data-action]')`.

### A6 — Panel structure inconsistency
- `IslandPanel` — manual DOM creation, re-renders on every event (5 bus listeners → 5 full rebuilds)
- `BuildPanel` — uses `_updateAffordability` for partial updates (good pattern)
- `LoadoutPanel` (just redesigned) — uses `_syncAll` for partial updates (good)
- `HudController` — fully cached refs (best)
- `ResearchPanel` — minimal, re-renders on click

**Standardize:** All panels should follow:
1. `_build()` — initial DOM construction with cached element refs
2. `_sync()` — read state, update only changed pixels
3. Re-build only on structural changes (new building added/removed)

---

## 🚀 TIER B — Performance hot paths

### B1 — `HudController.update()` runs full DOM query + island scan every frame
**[HudController.js:236-325](frontend/src/Experience/UI/HudController.js#L236)**

Every frame at 60fps:
```js
const rw = document.getElementById('rv-w');   // 60× DOM query
const rg = document.getElementById('rv-g');   // ...
const rl = document.getElementById('rv-l');   // ...
const rates = window._game?._build?.getProductionRates?.()   // O(islands × buildings)
```

`getProductionRates()` iterates all islands → all buildings → finds bldDef from BUILDINGS array. At 60fps with 5 islands × 10 buildings = 3000 iterations/sec just for HUD display.

**Fix:**
1. Cache `rw, rg, rl` in constructor
2. EconomySystem computes rates once per second (already does for ticking), caches on `state._cachedRates`
3. HudController reads `state._cachedRates` (free)

### B2 — `BuildSystem._spawnMesh` creates CanvasTexture per building
**[BuildSystem.js:528](frontend/src/Experience/Systems/BuildSystem.js#L528)**
Each building gets its own 64×32 canvas → CanvasTexture → SpriteMaterial → Sprite. With 50 buildings on 5 islands: 250 GPU texture uploads. Texture per building never disposed on demolish (Sprite added to mesh group, mesh removed but textures held by JS until GC + WebGL context).

**Fix:** Reuse one CanvasTexture per building TYPE (8 buildings → 8 textures). Or use SDF emoji atlas.

### B3 — `IslandPanel._refresh()` rebuilds entire HTML on every event
[IslandPanel.js:21-25](frontend/src/Experience/UI/IslandPanel.js#L21):
```js
bus.on('building:placed',    ()=>this._refresh());
bus.on('building:upgraded',  ()=>this._refresh());
bus.on('building:demolished',()=>this._refresh());
bus.on('building:destroyed', ()=>this._refresh());
bus.on('island:captured',    ()=>this._refresh());
```
Each `_refresh` = full `innerHTML = ...` for both island-panel and bld-detail. With construction timers added, AJ added 2 more bus events. Cumulative DOM thrash.

Construction/upgrade timer progress also needs per-frame update for smooth bars — currently only updates on next bus event = jumpy bars.

**Fix:** Build once, sync subset. For timer bars, register elements in a `_tickTargets` list updated by GameApp tick (or interval).

### B4 — `OverlaySystem.build(ship)` recreates Three.js rings on every cannon swap
Player swaps cannon → `applySpeed(ship); this._overlay.build(ship)` → ring meshes disposed and recreated. Multiple times per second during preset apply.

**Fix:** `overlay.sync(ship)` updates ring scale/color, only `build()` on hull change.

### B5 — Squared-distance comparison missed in ~12 places
`Math.sqrt(dx*dx + dz*dz) < threshold` should be `dx*dx + dz*dz < threshold*threshold`. Examples:
- [CombatSystem.js:65,110,172,192](frontend/src/Experience/Systems/CombatSystem.js)
- [EconomySystem.js:49,78](frontend/src/Experience/Systems/EconomySystem.js)
- [CaptureSystem.js:43,50,68,73](frontend/src/Experience/Systems/CaptureSystem.js)
- [EnemyAI.js:137-138,146](frontend/src/Experience/Systems/EnemyAI.js)
Each frame: 5 ships × 3 islands × multiple checks. Minor saving but free wins.

### B6 — VFX explosion callbacks captured closures
**[CombatSystem.js:81](frontend/src/Experience/Systems/CombatSystem.js#L81)**
```js
this._vfx.fireBall(ship.x,1.8,ship.z,tx,tz,COLOR,SPEED,()=>{
  // 30 lines of closure captured state
});
```
Per shot: callback closure allocates ~10 captured vars. With wolfpack siege: 8 ships × 4 slots = 32 closures/sec. GC pressure.
**Fix:** Pool callback objects: `vfx.fireBall(.., this._onImpact, payload)` where payload is reused.

---

## 🎮 TIER C — Gameplay design gaps

### C1 — AI has no economy
**[EnemyAI.js:220-283](frontend/src/Experience/Systems/EnemyAI.js#L220)** `_tickBuild` only builds DEFENSES on enemy island. AI never:
- Builds Lumber Mill / Gold Mine (no income growth)
- Builds Warehouse (no cap → no protection — making the AH/AI fix moot for AI)
- Builds Research Lab (no tech progression for AI)
- Builds Shipyard (so AI can't repair fleet)

Currently AI relies on WaveSystem to keep spawning replacement ships → not a real RTS economy.

**This is AQ milestone material** but worth flagging now: warehouse protection for AI added in this session is currently unused.

### C2 — Wave system is parallel to AI, not coordinated
WaveSystem spawns ships every 120s regardless of AI strategy. EnemyAI commands existing ships. The wave-spawn approach feels arcade, not RTS.

**For AZ:** Replace wave timer with AI-decided spawn when "AI Shipyard" reaches threshold + has resources. Wave timer becomes a difficulty curve modifier, not the spawn mechanism.

### C3 — Only one enemy island
`maps.js` has 1 enemy home `home_b`. EnemyAI does `_islands.find(i => i.own === 'enemy' && !i.down)` — picks first only.
- AI can't expand
- Killing enemy home = instant win (AR/AS milestone goal)
- Multi-enemy scenarios impossible

**For AY (content):** Add 2-3 more enemy outposts or make capture more interesting.

### C4 — Combat balance: range falloff exists but accuracy buffs ignore it
`CombatSystem.rangeAccuracyMult` is great. But `st.hitChanceBuff` is additive `+0.20` from tech, applied BEFORE range mult → tech makes long-range Long-9 absurdly accurate. Should apply hitChanceBuff AFTER falloff (multiplicative final adjust).

### C5 — Tech tree is shallow + un-themed
`upgrades.js`: 9 techs across Ballistics/Navigation/Fortification. No:
- Economy tech (Wood/Gold rate, storage)
- Logistics tech (build time mult, repair speed)
- Capture tech (faster neutral capture, contested resistance)
- Naval tech (new hull tiers, fleet size)
**AK roadmap matches this gap.**

### C6 — Fleet roles defined but not all implemented
`FleetCommander.ROLES` = 6 roles. Check actual behavior — only `manual` and `escort` seem fully implemented. Roles like `skirmisher`, `support`, `patrol` show up in UI but may not affect AI movement.

### C7 — No save/load schema
GameState mutable plain object with no version. AV milestone will require:
- Schema versioning (`stateVersion: 1`)
- Migration functions per version bump
- Excluded fields list (`_homeIsland` is THREE reference, not serializable)
- Restoration of object references (instance.mesh, ship.mesh)
**Plan now**, save effort later.

---

## 📦 TIER D — Content & i18n gaps

### D1 — Game DATA not translated
i18n only covers UI chrome. Hardcoded English in:
- `buildings.js`: "Lumber Mill", "Gold Mine", "Warehouse", "Research Lab"...
- `defenses.js`: "Watchtower", "Bunker", "Mortar Platform"...
- `cannons.js`: "Demi-culverin", "Long 9"...
- `upgrades.js`: "Powder Charge T1", "Rifled Barrel"...
- `maps.js`: "Home Port", "Enemy Citadel", "North Shoal"...

**Pattern:** Use IDs as i18n keys. `buildings.js` keeps `id: 'lumber_mill'`, name moves to `T.buildings.lumber_mill`. Loadout panel reads `T.cannons[cn.id]?.name ?? cn.nm`.

### D2 — Content count too low for replayability (AY target)
| Type | Count | Target for AZ |
|---|---|---|
| Maps | 1 | 3+ |
| Ship hulls | 3 (light/standard/heavy) | 5+ with variants |
| Cannons | 7 | 10+ across 2 tiers |
| Buildings | 6 | 8+ |
| Defenses | 5 | 6+ |
| Tech | 9 | 12+ across more branches |
| AI profiles | 1 (the wave AI) | 3 (raider/turtle/balanced per AY) |

---

## 🧪 TIER E — Testing & infra

### E1 — Test coverage map
| Tested | Untested (added since AF7) |
|---|---|
| EventEmitter, Ocean | BuildSystem (timers!), LoadoutPanel v2, IslandPanel |
| CombatSystem | EnemyAI v2, FleetCommander, CaptureSystem |
| EconomySystem, ReviveSystem | WaveSystem, ResearchSystem |
| GameState init, ImportGraph | WakeSystem v2 shader |
| BallisticPhysics, VFX_AD, SpringCamera | |

### E2 — No CI / dev tooling
- No `package.json` visible
- No linter config (ESLint)
- No formatter (Prettier)
- No type checker (jsdoc → tsc)
- No bundler size budget
- Tests are HTML page based (`test/index.html`) — manual run

**Lightweight path:** Add `package.json` with `"scripts": { "lint": "eslint src", "test": "node test/runner.js" }`. No build tools — keep ES modules + CDN. Linter catches dead code, unused imports.

### E3 — No error tracking
- Game errors lost in console
- No telemetry on crashes / WebGL context loss
- No FPS recording for perf regressions

### E4 — Single-tab assumption
- `localStorage` not synchronized between tabs
- Opening game in 2 tabs → both write to same key → race
- Add storage event listener and broadcast "another tab modified save" warning (defensive).

---

## 🔒 TIER F — Security & robustness

### F1 — XSS surface via island/ship names
36 `innerHTML =` calls interpolate user-modifiable values:
- `isl.nm` — fixed in maps.js BUT save/load may load tampered file
- `fleet.name` — user can rename fleets (if Rename feature exists)
- `inst.instanceId` — random base36, safe
**Fix:** `escapeHtml()` helper used on ALL interpolated strings.

### F2 — `window._game = this` exposes internals to dev console + bookmarklets
Trade-off: useful for debug, risky for production. Wrap in `if (DEV)` flag.

### F3 — CDN tampering / availability
Three.js & Rapier from public CDNs. If CDN compromised → arbitrary JS execution.
- Add `integrity` attribute to importmap
- Document fallback strategy in `IOW_HANDOFF`

### F4 — No input validation on shape JSON
`islandShapes.js` generates from seed — fine. But future save format MUST validate shape grid keys before deserializing.

---

## 📐 TIER G — UX polish (low effort, high feel)

### G1 — Notification queue
`flashMsg` and `welcomeMsg` use one `#msg` element with `setTimeout`. Multiple events overlap or get lost.
**Pattern:** Toast queue `[{msg, type, icon, duration}]`, drain one at a time.

### G2 — Income floating text
When a Lumber Mill ticks +5 wood, no visual feedback. Add `+5🪵` floating text rising above building on income tick (throttle: once per 2s per building).

### G3 — Defense range visible in normal mode (not just on hover)
Range arcs only show when hovering during build. Once placed, range invisible. Could show all defense ranges when player presses Alt (or in "tactical view" mode).

### G4 — Construction progress visible on the building
Currently only in IslandPanel. Add a thin ring around building mesh that fills as construction progresses (or scaffolding mesh overlay).

### G5 — Sound feedback for key events
`build complete`, `research done`, `ship sunk`, `island captured` — Audio.js has slots for these. Wire them up.

### G6 — Keyboard hint overlay
`?` opens help → make sure it lists ALL shortcuts including the recent Q/E defense rotation.

### G7 — Fleet HP total in tab
Fleet tabs show ship count. Add aggregate HP bar across fleet ("Fleet Alpha: 4/5 ships, 78% HP").

---

## 🛠 Concrete recipe — Quick wins (~2 hour batch)

**Order to do them in one session:**

1. **20 min** — Fix S1 (material clone) + S2 (tdmg compound) + S3 (wave despawn leak)
2. **15 min** — Cache HudController refs (B1 part 1)
3. **15 min** — Add `CANNON_BY_ID` Map (S7) — used in ShipEntity, CombatSystem, LoadoutPanel
4. **10 min** — Bus-event-driven `recalcWarehouse()` (S8)
5. **20 min** — Replace 3 `onclick` strings with delegated listener (A5)
6. **15 min** — Add `escapeHtml` helper, wire to interpolated names (F1)
7. **10 min** — Wire build-complete / capture sounds (G5)
8. **20 min** — Squared-distance comparisons in 12 spots (B5)

Result: noticeable smoothness gain + 3 latent bugs eliminated + security floor raised.

---

## 🗺 Roadmap re-prioritization

Given the gap analysis, suggested order:

| Order | Milestone | Why now |
|---|---|---|
| 1 | **Quick wins above** | Foundation for AK+ |
| 2 | **AK** Tech tree v1 | ResearchSystem fix done, just need UI gates |
| 3 | **AS** Win/lose state | Player needs end-condition to test loop |
| 4 | **AL** Shipyard production | Replaces wave-only ship influx |
| 5 | **AN** Defense armor | Adds tactical depth, small data change |
| 6 | **AQ** AI economy | Unlocks AH/AI warehouse work for AI side |
| 7 | **AV** Save/load | After A1 state refactor |
| 8 | AM, AP, AR, AT, AU, AW, AX, AY, AZ | Standard roadmap order |

---

## 📋 Bright spots — keep these patterns

- **EventBus** — clean, decoupled
- **PanelManager** — single source of truth, well-respected
- **Utils/RingMaterial.js** — perfect shared resource factory
- **VFX `vfx/` subfolder** — good module boundary
- **`islandShapes.js`** seeded PRNG — already deterministic, just needs to be the project pattern
- **`StatusEffects.js`** — pure data + apply/tick = clean
- **Wake shader** (just added) — well-bounded, no state leak
- **AH session fixes** — solid foundation (warehouse protection scope, instance state preservation, lab level check)

---

## 📝 Final note

The codebase is in a "rough but workable" state. The MOST IMPORTANT thing is to fix S1–S8 quickly (under 90 min total) because they actively harm gameplay or accumulate over time. Architecture refactors (A1–A6) can wait until before AV/AZ but should not be ignored — every untouched milestone makes them harder.

The roadmap AH→AZ is doable in ~4–6 productive sessions. Sticking to "smallest playable version, document the rest" rule is essential.
