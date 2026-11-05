# Gameplay pass — progress 01: plan + systems in place

**Status:** in progress (game-design / systems / gameplay code). No mission
numbers retuned yet — the novice baseline (`tools/balance/out/battle_g_base.*`)
is still running.

## Done so far (code, behaviour-neutral for existing missions)
- **Harbor building cost knob** — `HARBOR_ECONOMY.buildCostMult` (data/harbor.js),
  priced by `Meta/HarborEconomy.harborBuildCost(def, level, mult)` (round up to 5),
  set as `st.harborBuildCostMult` in `HarborSession`, charged in
  `BuildSystem` (hover check, placement, upgrade). Open War reads `?? 1` → unchanged.
  The economy sim (`--cost-mult`) uses the same helper.
- **Size-aware patrol** — `PATROL.ratioBySize` {1: .30, 2: .38}, enemy ships ≤
  ships that sail (fleets of 1–2), lone trimmed foe gets tier-I guns (`loneLoadout`).
- **Commander comeback in Sea Battle** — `CommanderSystem.comebackRate(st)`:
  battle mode uses fleet-HP exchange (`BATTLE.comeback`), Open War keeps War Front < 45.
  `st.cmdComeback` + `#cmd-bar.comeback` class for the HUD.
- **Progression API** — `Shipyard.fleetCapBreakdown`, `buildingRequirements`,
  `labLevel`, `buildBlockers`; `canBuild` now carries `blockers`.
- **Mission variety plumbing** — `MissionSystem`: new objective `sink_target`
  (prize must not reach `mission.escape`), escaped ships, time-left line,
  EN label fallbacks; `EnemyAI` battle tactics: kite / guard (leash) / hold /
  patrol route / prize run / flee-when-hurt (`ship.ai` from `mission.ai`,
  `ai.byHull`, `EnemySpec.ai`, `EnemySpec.prize`).

## First finding — harbor cost multiplier
Economy sim (continuous, 20 runs): the island fills at 35 min (×1) and still
39 min at ×2.5 — the harbor spills 70–80 % of its production at the storage
cap, so price barely bites. Testing ×4–8 next.

## Next
Re-tune the 15 missions with distinct behaviours, then sims + report.
