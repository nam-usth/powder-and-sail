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
   - `sink_target` — sink every enemy marked `prize` before it reaches the
     mission's `escape` zone. Escorts are optional (they still pay plunder).
4. Defeat: all player ships sunk, the optional `timeLimit` expires (HUD shows
   "Time left" and the top clock counts down), or a prize escapes (`escaped`).
5. Retreat: the player can leave at any time; counts as a defeat without
   further losses.
6. No revives in battle. A ship sunk in battle returns as a **wreck**.
7. Commander abilities (Z/X/C) are available. **Comeback valve:** while the
   player is losing the exchange — own fleet HP fraction (sunk ships at 0) is
   `BATTLE.comeback.behind` (0.15) or more below the enemy's, or under
   `floor` (0.35) — cooldowns recover `cdRate` (×1.35) faster. Open War keeps
   its War-Front rule (front < 45 → ×1.25). `st.cmdComeback` / `#cmd-bar.comeback`
   tell the HUD.
7a. **Enemy behaviour** (`mission.ai`, `ai.byHull`, `EnemySpec.ai`, battle mode only):
   - `engage` (default): wolfpack fan on the nearest player ship once within `aggro`.
   - `kite`: circle the nearest player ship at ¾ of the ship's longest gun range
     (`BATTLE.kiteRangeFrac`), opening the range when crowded.
   - `guard`: engage, but return to its post when the player is more than `leash` from it.
   - `hold`: anchored on its post (floating battery), fires when the player comes.
   - `route`: patrol loop between waypoints until the fleet engages.
   - `prize` (+ `spdMult`, laden): once engaged, sails the `escape` route.
   - `fleeHp`: below that HP fraction a ship runs for `escape`; if it gets
     there it leaves the battle (no plunder, counted under "Escaped").
8. Plunder: each enemy ship sunk pays `PLUNDER_BY_HULL`; each fort destroyed
   pays `PLUNDER_FORT`. Plunder is kept on defeat at `DEFEAT_PLUNDER_KEEP`.
9. Stars (win only): ★ win · ★★ no ship lost · ★★★ no ship lost **and** under `parTime` (code rule).
10. Result screen: outcome, stars, plunder, mission reward, ship status list,
    "Return to Harbor".

## Mission roster (variety map)
Every mission pairs an objective with a behaviour so no two play alike
(numbers: `data/campaign.js`, results: `design/balance/report.md`).

| Mission | Objective | What makes it different |
|---|---|---|
| reef_1 Smugglers' Cove | sink_all | Tutorial: two sloops, plain wolfpack |
| reef_2 San Telmo Battery | destroy_forts | Guard-costas on a 40 u leash round the battery — pull them off or ignore them |
| reef_3 Windward Channel | survive 150 s | Waves; the schooner kites with falconets |
| straits_1 Saltwind Convoy | **sink_target** | Chase: the laden merchantman (½ speed, head start) runs a long northern route; escorts screen |
| straits_2 Seize Gullhaven | capture | Brigantine guards the haven, schooner kites |
| straits_3 Twin Batteries | destroy_forts | Frigate patrols between the batteries; brigantine on a leash |
| indian_1 Monsoon Raiders | survive 180 s | Dhows dart in and out (kite); third wave brings two frigates |
| indian_2 Carracks of Goa | sink_all | Crippled ships (< 30 % HP) run for Goa — chase them or lose the cargo |
| indian_3 Pepper Fort | capture | Galleon anchored under the walls (hold); escorts on a 55 u leash |
| spice_1 Lanong Ambush | survive 200 s | Lanongs from the flanks; two Company heavy frigates in wave 3 |
| spice_2 Homeward Fleet | **sink_target** | Treasure-galleon chase at tier IV; heavy frigates kite with culverins at ~30 u |
| spice_3 Kasteel Amboina | destroy_forts | Guardship holds the castle; frigates leashed |
| storm_1 Typhoon Season | survive 210 s | Chain-shot ghe bầu kite and cripple your speed |
| storm_2 Red Banner Fleet | sink_all + **timeLimit 330 s** | Race the typhoon; small junks kite, war junks close |
| storm_3 Citadel of Storms | destroy_forts (final) | Flagship guards the citadel, junks patrol, a war junk holds the bastion |
| Patrol | sink_all | Size-aware: never more ships than you bring (1–2 ships) |

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
`data/campaign.js` (per mission: objective, `escape`, `timeLimit`, `ai`,
EnemySpec `prize`/`spdMult`/`ai`), `data/harbor.js`: `PLUNDER_BY_HULL`,
`PLUNDER_FORT`, `DEFEAT_PLUNDER_KEEP`, `BATTLE` (`aggro`, `fortRegen`,
`comeback`, `kiteRangeFrac`, `escapeR`).

## Acceptance Criteria
- Launching a mission spawns exactly the selected ships and the mission's enemies.
- Sinking all enemies in `sink_all` shows Victory with ≥1 star and banks the reward (integration test).
- A ship sunk in battle shows as Wreck in the shipyard afterwards.
- No build/research/revive UI is visible in battle (screenshot).
- `sink_target`: sinking the prize wins; the prize reaching `escape` loses with reason `escaped` (unit test).
- `timeLimit`: the battle is lost at the limit with reason `time` (unit test).
- Comeback: `comebackRate` > 1 only while the player trails the exchange (unit test).
