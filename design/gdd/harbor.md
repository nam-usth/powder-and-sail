# GDD — Harbor (home island builder)

## Overview
The Harbor is the player's persistent home island. It is shown in its own
mode (no enemies, no war front). Buildings placed here are saved, keep
producing in real time (also while the game is closed, capped), and gate what
the Shipyard can build. Ships of the roster lie moored around the island.

## Player Fantasy
"This is *my* port." Coming back after a few hours to full stores, a finished
upgrade and a repaired fleet; laying out mills next to mills for the adjacency
bonus; watching the fleet bob at anchor before setting sail.

## Detailed Rules
1. The harbor island uses the existing build grid, dock (AR), ghost placement
   (AQ), adjacency (AP) and research (lab level) rules unchanged.
2. Resources 🪵 🪙 live in the profile. In harbor mode the live state mirrors
   them and is written back every 2 s and on page hide/unload.
3. Production: base income (`WOOD_RATE`, `GOLD_RATE`) + building production,
   clamped to cap (`WOOD_CAP`/`GOLD_CAP` + warehouse bonus).
4. Offline progress: on load, `elapsed = min(now − lastSeen, OFFLINE_MAX_SEC)`.
   Production for `elapsed` is added (same clamp), construction/upgrade timers
   advance by `elapsed`, shipyard/repair timers are wall-clock and simply resolve.
   A "While you were away" toast reports the gain.
5. A fresh profile starts with a Lumber Mill, a Gold Mine and a Shipyard on
   the home island, and three ships (Sloop, Sloop, Brigantine).
6. Buildings under construction count for nothing until ready (existing rule).
7. The harbor has no enemies; the fort and defenses are decorative here and
   matter only in future raids (backlog).
8. Top bar in harbor: Build · Research · Shipyard · Loadout · ⛵ Set Sail.

## Formulas
- `offlineGain_r = min(cap_r − stock_r, (baseRate_r + Σ prod_r(b)) × elapsed)`
  for r ∈ {wood, gold}; `prod_r(b) = productionByLevel[level−1]` for ready
  buildings (adjacency/trait multipliers are not applied offline — a
  conservative under-estimate keeps offline from out-earning active play).
- `elapsed = clamp((now − lastSeen)/1000, 0, OFFLINE_MAX_SEC)`; `OFFLINE_MAX_SEC = 8 h`.

## Edge Cases
- Clock moved backwards → `elapsed` clamps to 0.
- Corrupt/missing save → new profile; the corrupt string is kept under
  `iow_profile_v1_bad` for debugging.
- Saved building on a cell that is no longer valid (shape change) → dropped, refunded 50 %.
- Storage unavailable (private mode) → game runs, a toast warns progress won't persist.

## Dependencies
BuildSystem, EconomySystem, ResearchSystem (existing); Profile, HarborEconomy,
Shipyard (new, `frontend/src/Meta/`); Campaign (World Chart launches battles).

## Tuning Knobs
`data/harbor.js`: `OFFLINE_MAX_SEC`, `SAVE_INTERVAL_SEC`, starter buildings,
starter fleet, `HARBOR_ECONOMY` (`rateMult` 0.25, `buildTimeMult` 1,
`buildCostMult` 4 with `buildCostMultById` exemptions: shipyard/warehouse/lab ×1,
barracks ×1.5). Harbor building price = `Meta/HarborEconomy.harborBuildCost(def, level)`:
place = cost × mult, upgrade from L = cost × L × mult, rounded up to 5. Open War
pays the authored `data/buildings.js` costs (BuildSystem reads
`st.harborBuildCostMult ?? 1`). The progression buildings are exempt because
cost × level × mult would outgrow the storage cap and soft-lock tier V. `data/constants.js`: caps and base rates (shared with Open War).

## Acceptance Criteria
- Reloading the page restores every building at the same cell and level.
- Closing for N seconds and reopening adds offline income per the formula (unit test).
- No enemy ship, war-front bar or wave timer is visible in harbor mode (screenshot).
