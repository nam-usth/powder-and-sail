# GDD — Campaign Meta (profile, shipyard, World Chart)

## Overview
The meta layer connects Harbor and Sea Battle: a persistent profile, the
Shipyard (roster of ships with build/repair/salvage timers) and the World
Chart (mission nodes grouped in sea regions, unlocked by progress and renown).

## Player Fantasy
"An admiral's ledger": a chart that fills with stars, a roster of named ships
with histories, ranks earned through renown.

## Detailed Rules
1. Roster ship states: `ready`, `building`, `repairing`, `wreck`.
2. Build: requires a ready Shipyard whose level ≥ hull `shipyardLevel`; costs
   `cost`; takes `buildSec` wall-clock seconds; one build at a time per
   shipyard building.
3. Repair (afloat but damaged): cost scales with missing HP; time
   `REPAIR_SEC_PER_HP × missingHp`. Ships moored in the harbor also regen
   slowly through the existing repair aura.
4. Salvage (wreck): `SALVAGE_COST_FRAC` of build cost, `SALVAGE_SEC` → ready at full HP.
5. Fleet cap for battle = `FLEET_CAP_BASE + shipyardLevelSum + barracks bonus`, max `FLEET_CAP_MAX`.
6. Missions unlock when all `requires` missions are won and renown ≥ region `minRenown`.
7. Patrol (repeatable): random enemy mix scaled by Admiral rank; reward scaled.
8. Admiral rank from renown thresholds `RANKS`.

## Formulas
- `repairCost_gold = ceil(missingFrac × REPAIR_GOLD_PER_FRAC[hull])`
- `repairSec = ceil(missingFrac × REPAIR_SEC_FULL[hull])`
- `rank = max i : renown ≥ RANKS[i].renown`

## Edge Cases
- Selling the last ship is not allowed (always ≥1 ship).
- Shipyard demolished while building → build continues (timer is wall-clock), new builds blocked.
- Profile from an older version → `migrate()` fills missing fields with defaults.

## Dependencies
Profile (storage), data/harbor.js, data/campaign.js, Harbor (buildings), Sea Battle (results).

## Tuning Knobs
All in `data/harbor.js` (hull catalog, timers, costs, ranks) and `data/campaign.js`.

## Acceptance Criteria
Covered by `test/12_Meta.test.js` (Node-runnable): build/repair/salvage timers,
battle result application, unlock rules, offline accrual, migration.
