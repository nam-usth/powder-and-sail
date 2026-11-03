# GDD — Sea Battle

## Overview
A Sea Battle is a self-contained real-time naval engagement launched from the
World Chart with ships from the roster. It reuses the RTS command layer (AU)
and combat (broadsides, cannon arcs, status effects) but has no building,
research or war-front tug-of-war: each mission has its own objective.

## Player Fantasy
"Bring the fleet I built, out-sail them, and come home rich." Short, tense
engagements where positioning and loadout choices made in the harbor pay off.

## Detailed Rules
1. Map: islands from the mission (enemy forts, neutral rocks/isles). The
   player has no island; the fleet spawns at the mission's `spawn` point.
2. Player ships = selected roster ships with their hull, name, loadout,
   upgrades and current HP fraction.
3. Objective types:
   - `sink_all` — sink every enemy ship (reinforcements included).
   - `destroy_forts` — bring every enemy fort to 0 HP.
   - `survive` — keep ≥1 ship afloat for `seconds` while waves arrive.
   - `capture` — capture the listed islands (existing CaptureSystem).
4. Defeat: all player ships sunk, or the optional `timeLimit` expires.
5. Retreat: the player can leave at any time; counts as a defeat without
   further losses.
6. No revives in battle. A ship sunk in battle returns as a **wreck**.
7. Commander abilities (Z/X/C) are available.
8. Plunder: each enemy ship sunk pays `PLUNDER_BY_HULL`; each fort destroyed
   pays `PLUNDER_FORT`. Plunder is kept on defeat at `DEFEAT_PLUNDER_KEEP`.
9. Stars (win only): ★ win · ★★ no ship lost · ★★★ win under `parTime`.
10. Result screen: outcome, stars, plunder, mission reward, ship status list,
    "Return to Harbor".

## Formulas
- `reward = mission.reward (+ mission.firstClear if first win) + Σ plunder`
- `defeatReward = floor(Σ plunder × DEFEAT_PLUNDER_KEEP)`
- `renown = mission.renown × (win ? 1 : 0) + 2 × shipsSunk`
- Returning ship HP fraction = `hp / maxHp` (≥ 0.05 if afloat).

## Edge Cases
- Starting with zero ready ships → Set Sail is disabled in the chart.
- Mission references an unknown hull → falls back to `standard`.
- Page closed mid-battle → the battle is lost on next load with no rewards and
  the ships come back at their pre-battle HP (no punishment for crashes).
- Both last ships sink on the same frame → defeat takes priority only if the
  objective was not already met that frame.

## Dependencies
OrderSystem, CombatSystem, EnemyAI, WaveSystem (survive), CaptureSystem
(capture), CommanderSystem; MissionSystem (new); Campaign (rewards).

## Tuning Knobs
`data/campaign.js` (per mission), `data/harbor.js`: `PLUNDER_BY_HULL`,
`PLUNDER_FORT`, `DEFEAT_PLUNDER_KEEP`.

## Acceptance Criteria
- Launching a mission spawns exactly the selected ships and the mission's enemies.
- Sinking all enemies in `sink_all` shows Victory with ≥1 star and banks the reward (integration test).
- A ship sunk in battle shows as Wreck in the shipyard afterwards.
- No build/research/revive UI is visible in battle (screenshot).
