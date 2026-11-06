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
4. Salvage (wreck): `SALVAGE_COST_FRAC` of build cost plus the guns re-cast
   (Σ `REPAIR_GOLD_PER_GUN_TIER` gold + Σ `SALVAGE_WOOD_PER_GUN_TIER` wood by
   cannon tier), `SALVAGE_SEC` → ready at full HP.
4b. **Cannon research (Gunnery).** The tier-I swivel, carronade and falconet
   are known from the start; every other cannon is unlocked by a Gunnery tech
   (`data/upgrades.js`, id `gun_<cannon>`, Research Lab level = cannon tier − 1, cost by
   tier `GUN_RESEARCH_COST`). A gun can be mounted when hull tier ≥ cannon tier
   AND it is researched (`data/cannons.js canMountCannon(cn, ship, known)`) —
   in the harbor and Sea Battles only; Open War and enemies are unrestricted.
   **Equipping is free; repairing is not**: the repair price carries a
   per-mounted-gun term that grows with cannon tier. New hulls, presets and
   legalised saves fall back along the gun's research line
   (`CANNON_DOWNGRADE`) to the best known gun. v1 saves are granted the techs
   of every tier-legal gun already mounted (no one loses equipment).
4c. **Fleet doctrines** (quick-equip; `data/doctrines.js`, `Meta/Doctrine.js`).
   A doctrine is a per-slot gun preference list (optionally per hull class).
   `fitDoctrine(id, {hull, tier}, known)` takes, per slot, the first listed gun
   the hull may mount AND has researched; when the tier-allowed favourite is
   unresearched the slot falls back down its research line (reported, so the
   UI can say "research X"). Unknown id → no change. Applied from the Loadout
   panel doctrine bar (this ship / selected / whole fleet, harbor only), the
   Shipyard "Refit whole fleet" chooser, or per ship in the World Chart
   briefing — on Set Sail `applySailDoctrines(profile, {uid: id})` refits only
   the chosen ships ("keep" = unchanged). The choice is remembered on the
   roster ship (`doctrine`); a manual slot edit clears it. The briefing's
   "Quartermaster advises" hint is derived from mission data only
   (`suggestDoctrines`: forts → siege, prize → crippler/long range, heavy
   hulls → anti-heavy, mostly light → anti-light, else line of battle).
5. Fleet cap for battle = `FLEET_CAP_BASE + (shipyard level − 1) + Σ barracks bonus`
   (barracks Lv 1/3/5/7 → +1 each), max `FLEET_CAP_MAX`. A Barracks needs a
   Research Lab at Lv 2 — the UI must say so: `Shipyard.fleetCapBreakdown(profile)`
   returns the parts and the next steps with their blockers;
   `Shipyard.buildingRequirements(profile, id)` and `labLevel(profile)` explain
   any locked building; `Shipyard.buildBlockers(profile, hullId)` lists every
   reason a hull cannot be laid down (`canBuild(...).blockers`).
6. Missions unlock when all `requires` missions are won and renown ≥ region `minRenown`.
7. Patrol (repeatable): enemies from the frontier sea sized to the ships that
   sail. Size-aware: budget = `ratioBySize[n] ?? strengthRatio` × Σ strength
   (1 ship 0.30, 2 ships 0.38, 3+ 0.45); at most `n` enemy ships for fleets of
   1–2 (n + `maxExtraShips` from 3 up); when even the weakest pool hull is over
   budget, one `minFoe` trimmed to the budget with tier-I `loneLoadout`. A lone
   salvaged hull can always win a patrol (no death spiral). Reward scales with
   the strength met.
8. Admiral rank from renown thresholds `RANKS`.

## Formulas
- `repairCost_gold = ceil(missingFrac × (REPAIR_GOLD_FULL[hull] + Σ_mounted REPAIR_GOLD_PER_GUN_TIER[cannon.tier]))`
- `salvage = ceil(SALVAGE_COST_FRAC × cost) + {gold: Σ REPAIR_GOLD_PER_GUN_TIER[t], wood: Σ SALVAGE_WOOD_PER_GUN_TIER[t]}`
- `repairSec = ceil(missingFrac × REPAIR_SEC_FULL[hull])`
- `rank = max i : renown ≥ RANKS[i].renown`

## Edge Cases
- Selling the last ship is not allowed (always ≥1 ship).
- Shipyard demolished while building → build continues (timer is wall-clock), new builds blocked.
- Profile from an older version → `migrate()` fills missing fields with defaults.

## Dependencies
Profile (storage), data/harbor.js, data/campaign.js, Harbor (buildings), Sea Battle (results).

## Tuning Knobs
All in `data/harbor.js` (hull catalog, timers, costs, ranks), `data/campaign.js`
and `data/doctrines.js` (doctrine gun lists, briefing hint thresholds `DOCTRINE_HINT`).

## Acceptance Criteria
Covered by `test/12_Meta.test.js` (Node-runnable): build/repair/salvage timers,
battle result application, unlock rules, offline accrual, migration,
fleet doctrines (tier + research respected with fallback; Set Sail refits only
the chosen ships; unknown doctrine = keep).
