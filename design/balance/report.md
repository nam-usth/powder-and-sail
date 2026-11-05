# Balance report — campaign, Sea Battle, harbor economy (milestone AW)

## 0c. Cannon research + gun-tier repair costs (latest)

User design ("as in the original game"): cannons are **researched** to unlock, **equipping is
free**, **repairing costs money and grows with the tier of the mounted guns**.

**Rules as built** (harbor + Sea Battle only; Open War `?mode=skirmish` and enemies unrestricted)
- Known from the start: swivel, carronade, falconet (tier I). Every other cannon has a Gunnery tech
  `gun_<cannon>` in `data/upgrades.js` (12 techs). Lines: long 9 → long 12 → long 24 ·
  demi-culverin → culverin · demi-culverin → demi-cannon → cannon royal · carronade(start) →
  32-pdr · mortar I → mortar II · grape (root) / chain (after long 9) as tier-II specials.
- Lab level = cannon tier − 1 (tier II needs any Research Lab). Cost by tier `GUN_RESEARCH_COST`:
  II 60🪵 100🪙 (specials 80/120) · III 150/220 · IV 280/380 · V 450/600 — the whole branch 5 840.
- Mount rule `canMountCannon(cn, ship, known)`: hull tier ≥ cannon tier **and** researched.
  Unknown guns fall back along the research line (`CANNON_DOWNGRADE`, `fallbackCannon`) for new
  hulls (`Shipyard.startBuild`), Loadout presets and save legalisation. Long 9 falls back to the
  swivel (bow chaser), so the starter brigantine sails L/R falconet, B swivel.
- Saves v1 → v2 (`PROFILE_VERSION` 2): `migrate` grants the tech (+ prerequisites) of every
  tier-legal gun already mounted; nobody loses equipment. v2 saves drop unresearched guns.
- Repair: `gold = ceil(miss × (REPAIR_GOLD_FULL[class] + Σ REPAIR_GOLD_PER_GUN_TIER[tier]))`,
  per gun I..V = 3 / 8 / 16 / 28 / 45 🪙 (full repair). Salvage adds Σ that gold + `SALVAGE_WOOD_PER_GUN_TIER`
  5 / 12 / 25 / 40 / 60 🪵. Time unchanged. Full repair: starter brigantine 80 → 89 🪙 (2 falconets + swivel),
  T5 man-o-war (royal, long 24, mortar II, long 12) 140 → 276 🪙. Shipyard cards show "hull + guns".
- `MOORING_REGEN_FRAC` unchanged (0.0008/s ≈ 21 min to full vs 30–80 s paid). Paid repair still
  wins: battles run every ~5–8 min of play and gun repair is 530 🪙 over a whole campaign (sim).

**Battle check** (`battle_cr_starter`, `cr_starter2`, `cr_check`; novice). Only the Caribbean
starter fleet changes (no gun research yet; brigantine demi-culv/long 9 → falconet/falconet/swivel);
every later scenario adds its fleet's gun techs to `research` (`scenarios.mjs gunResearch`) and
`sim_battle` builds ships with `known = research`, so realistic fleets mount only researched guns
(fits identical to before).

| Scenario | Before | After (n) |
|---|---:|---:|
| reef_1 | 100 % | 100 % (4; + 6 with bow falconet) |
| reef_2 | 100 % | 100 % (10), 127 s (was 150 s) |
| reef_3 (survive) | 75–80 % | 90 % (10), HP 28 % (bow falconet probe: 100 % (6) → bow swivel) |
| patrol_caribbean | 100 % | 100 % (4; + 6 with bow falconet) |
| straits_1 | 75 % | 75 % (4) — same fleet |
| spice_3 | 85 % (20) | 88 % (8, `cr_spice3`); a 4-seed probe gave 50 % — same fleet/guns, bimodal fort mission |

**Economy sim** (`economy_cr_final` vs `economy_cr_before_m`, 60 runs, `battle_cr_merged`; agent
researches the next mission's gun techs (+ lab upgrades) and refits for free):

| p50 active min | Before | After |
|---|---:|---:|
| first tier-II gun researched | – | **15.6** (p10 12.3) |
| own T2 hull | 17.3 | 18.4 |
| tier-III / IV / V guns | – | 36 / 64 / **105** |
| own T5 hull | 114 | 117 |
| campaign (continuous / active / idle h) | 2.8 / 2.6 / 2.2 | 2.8 / 2.7 / 2.2 |
| spent research · repairs (guns) · salvage (guns) | 330 · 1 063 · 12 455 | 5 840 · 1 625 (530) · 15 173 (2 218) |

T5 guns land ~12 min before the first T5 hull; targets.md T1–T10 unchanged. The first gun waits
on reef_3 (the agent researches for the *next* mission); a player who builds a lab early has it
by ~10 min.

## 0b. Fort/capture re-tune after the QA-001 siege fix

Data only (`data/campaign.js`; `BATTLE` knobs unchanged, `fortRegen` stays 0.006). Raw runs:
`tools/balance/out/battle_h_it*` (`--set` probes), `battle_h_confirm` (8 seeds, both policies).
"Before" = `battle_g_final` (4 seeds) / `battle_h_it1` (5 seeds, for storm_1 + spice_2 as shipped).
Novice win % pools every run at the final values (n = seeds); one seed ≈ ±10 points.

| Mission | Change | Novice before | **Novice after** (n) | HP left | Skilled | Novice time |
|---|---|---:|---:|---:|---:|---:|
| reef_2 | battery 150/6 → 170 HP / dmg 8 | 100 % | **100 %** (8; 170/7: 18/19) | 64 % | 100 % | 176 s |
| reef_3 | wave 3 105 → 115 s (was *under* band: 50–60 % on 13 fresh seeds) | 100 % (4) / 55 % | **80 %** (20) | 13–26 % | 100 % | 146 s |
| straits_2 | Gullhaven 160/9/trof 9 → 370/25/7; Le Hardi `hold` under the walls | 100 % | **72 %** (18) | 29–33 % | 100 % | 242–262 s |
| straits_3 | batteries 240/13 → 340/21 | 100 % | **88 %** (8; 340/22 → 63 %) | 33 % | 100 % | 235 s |
| indian_3 | fort 380/16 → 450/21 | 100 % | **75 %** (8; 440–460 pooled 18/25) | 30 % | 100 % | 251 s |
| spice_2 | prize 0.56× / 480 → 0.5× / 520 HP | 20 % (escaped) | **90 %** (20) | 71 % | 100 % | 92 s |
| spice_3 | bastions 360/20/6 → 650/48/5 | 100 % | **85 %** (20) | 25 % | 100 % | 171–202 s |
| storm_1 | waves 55/105 → 45/90 s, + war junk *Mãnh Hổ* in wave 2 | 100 % (29 % HP) | **90 %** (20) | 10–16 % | 100 % | 205 s |
| storm_3 | citadel 700/27 → 1000/42 | 100 % | **75 %** (8; 1000/44: 7/10) | 32 % | 100 % | 229 s |
| GATE storm_3 7×T3 | – | 0 % | **0 %** (8) · skilled 50 % | 0 % | – | 180 s |

Notes. The prize chase (spice_2) is a cliff on prize HP at 0.5×: 520 → ~90 %, 540 → 50 %,
560 → 60 %, 620 → 40 %; speed 0.52–0.56 is just as steep and seed-dependent. 520 is the
safe side. Fort missions are bimodal (fast win or fleet lost); straits_3 jumps from ~90 %
(dmg 21) to ~63 % (dmg 22–23). Still slightly easy: reef_2 (first region, allowed ~90 %).
Battle lengths 2.5–4.5 min except the chases (~1.5 min, by design).

## 0. Gameplay pass, round 2 — "a smooth first two hours"

Raw runs: `tools/balance/out/battle_g_base` (before), `battle_g_iter1` (reworked missions,
6 seeds), `battle_g_v*` (chase probes, `--set`), `battle_g_final` (after the QA-001 siege fix),
`economy_g_final`. Novice policy now goes for the prize first on `sink_target` missions.

### 0.1 Novice win rate

| Mission | Before (g_base, 5 seeds) | After iter1 (6 seeds) | Final tweaks since iter1 | Behaviour now |
|---|---:|---:|---|---|
| reef_1 | 100 % | 100 % | – | tutorial wolfpack |
| reef_2 fort | **20 %** | 50 % | − San Pedro sloop, fort dmg 6; siege fix | guards on a 40 u leash |
| reef_3 survive | 80 % (4 ships) | 100 % (4 ships) | QA-002: sim now uses the starter fleet; wave 3 at 105 s, brigantine carronade → swivel | schooner kites |
| straits_1 | 60 % | **75 %** (77 s) | – | **chase**: laden merchantman (½ speed, 220 HP, head start) |
| straits_2 capture | 60 % | 50 % | Gullhaven 160 HP / dmg 9; siege fix | brigantine guards, schooner kites |
| straits_3 2 forts | 80 % | **83 %** | siege fix | frigate patrols between batteries |
| indian_1 survive | **100 %** | **83 %** | – | dhows kite; 2 frigates in wave 3 (at 105 s) |
| indian_2 | 60 % | **83 %** | – | crippled ships (< 30 %) run for Goa |
| indian_3 capture | 100 % | 67 % | fort 380 / dmg 16; siege fix | galleon anchored (hold), escorts leashed |
| spice_1 survive | **100 %** | **83 %** | – | 2nd heavy frigate, waves at 50/110 s |
| spice_2 | **100 %** | 33 % (spd 0.6) | prize speed 0.6 → 0.56 (probe: 0.55 → 100 %, 0.6 → 75 %) | **treasure-galleon chase**, heavy frigates kite |
| spice_3 2 forts | 100 % | 100 % | siege fix | guardship holds, frigates leashed |
| storm_1 survive | **100 %** | 100 % (44 % HP) | wave 3 at 105 s | chain-shot boats kite |
| storm_2 | **100 %** (110 s) | **83 %** (148 s) | – | **timeLimit 330 s**, junks kite, + war junk |
| storm_3 final | **100 %** | 100 % | citadel 700 / dmg 27; siege fix | flagship guards, junks patrol, war junk holds |

**After the QA-001 siege fix (`battle_g_final`, novice, 4 seeds):** reef_2 100 % (178 s, 65 % HP) ·
reef_3 (starter fleet) 100 % (24 % HP, 0.75 ships lost) · straits_2 100 % (159 s) · straits_3 100 % ·
indian_3 100 % · spice_3 100 % (116 s) · storm_3 100 % (161 s, 50 % HP) · **GATE storm_3 7×T3: 0 %** ·
WIPE lone frigate (South China) **100 %** (was 40 %) · WIPE lone sloop 100 %.
The siege fix roughly doubles what a fleet does to a fort, so every fort/capture mission is now
**easier than band** for novices — they need a re-tune with the sim (next step: fort `tdmg` +25–35 %
and/or escorts on `hold` under the walls; storm_3 citadel back toward 800 HP while the 7×T3 gate stays ≤ 20 %).

Chase missions are deliberately brisk (75–95 s): the fight is "catch her before she
reaches the lane". The escape is binary on speed — 0.45× never escaped, 0.55× (short
route) always did — so `spdMult` is the knob; HP tunes the margin.

### 0.2 QA-001 — bombard order (S1) fixed
Cause: gun range and accuracy are measured to the island **centre**, and siege ships
orbited at `r + 4` (+ ring spread), i.e. at 90–100 % of a range-20 gun → ~28 %
accuracy, plus `BATTLE.fortRegen` = 2 % of max per 5.5 s, which on big forts
(storm_3 citadel 875 HP → 17.5 HP/tick) out-healed the fleet.
Fix: `OrderSystem._engageSteer` bombards from just off the shore (`r + 2 + rank·0.8`,
`ORDER_TUNING.siegeShore` optional) — Open War siege uses the same ring, ships simply sit
closer; `BATTLE.fortRegen` 0.02 → **0.006**.
Probe (invulnerable fleets, escorts removed, `tools/qa`-style): reef_2 starter fleet
111 s → **66 s**; storm_3 3×T5 never (875/875 after 11 min in QA) → **193 s** (par 420).

### 0.3 Patrol, no death spiral (size-aware `makePatrol`)
Budget ratio by fleet size (`PATROL.ratioBySize` 1: 0.30, 2: 0.38, else 0.45); at most as
many enemy ships as you bring (1–2 ships); a lone trimmed foe gets tier-I guns
(`loneLoadout`). Lone frigate in South China: was a full ghe bầu (falconet/grapeshot,
novice 40 %) → now a cutter ≤ 85 HP with carronade/swivel. See WIPE rows.

### 0.4 Harbor building costs (harbor only)
`HARBOR_ECONOMY.buildCostMult` = 4 with `buildCostMultById` {shipyard 1, warehouse 1,
research_lab 1, barracks 1.5}; priced by `Meta/HarborEconomy.harborBuildCost` (upgrade =
cost × level × mult, rounded up to 5). A flat ×4+ soft-locked the economy agent (Shipyard
Lv 4→5 = 2400 wood > storage cap). Economy sim (continuous, 20 runs, g_iter1 battles):

| Milestone | Before (×1) | After |
|---|---|---|
| 20 producers | 11 min | 23 min |
| island full | 35 min | **48 min** p50 (p90 57) |
| own T2 / T3 / T5 | 15 / 49 / 143 min | 15 / 46 / **130** min |
| campaign | 3.1 h | 3.0 h |

The harbor still spills ~75 % of production at the storage cap: income is not the
constraint, battles and timers are. A real player builds slower than the agent.

### 0.5 Commander comeback in Sea Battle
`CommanderSystem.comebackRate(st)`: in battle mode cooldowns run ×1.35 while own fleet HP
fraction ≤ enemy's − 0.15, or < 0.35 (`BATTLE.comeback`). Open War keeps War Front < 45 → ×1.25.
The novice sim uses no abilities, so win rates above are unaffected.

### 0.6 Still open
- **Fort and capture missions are now too easy (100 % novice) after the QA-001 fix** — re-tune
  fort damage/HP next (see §0.1 note). Sieging with the whole fleet is now a real option, which
  is the intended feel; the numbers just have not caught up.
- spice_2 at 0.56× prize speed is unverified (between the 75 % and 100 % probes).
- spice_3 and storm_1 stay at 100 % (spice_3 was not in scope; storm_1 has no ★★★).
- Skilled policy was not re-run this round (no change makes play harder for experts except
  kiting; expect ≥ 90 %).
- The economy sim agent never builds a Barracks; fleet cap comes only from the shipyard.

Targets and method: `design/balance/targets.md`. Tools: `tools/balance/sim_battle.mjs`,
`tools/balance/sim_economy.mjs`, `tools/balance/scenarios.mjs`. Raw runs:
`tools/balance/out/battle_{iter1,final,confirm}.{md,json}`, `economy_{econ_before,final}.md`.

**Columns:** "Novice" and "Skilled" are the two scripted players. "HP left" is how much fleet HP survives, as a mean.
**Samples:** the pre-balance column used 10 seeds. Every other run used 5 or 6 seeds per mission and policy, so
one seed is ±20 points. Read a 60–100 % novice result as "in band ± noise".

## 1. Summary

| Target | Before (pre-balance → hand-over) | After |
|---|---|---|
| T1 reef_1 novice ≥ 90 % | 100 % | **100 %** (91 s, ★★★) |
| T2 later missions novice 70–85 % | fort missions 0–10 % → then almost everything 100 % (hand-over) | 9 of 14 missions at 60–100 %. Some of the survive and late missions are still 100 % (see §6) |
| T3 skilled ≥ 90 % | reef_2/straits_3 0–40 % | **100 % on every mission** |
| T4 battle 2–6 min | 75 s–6 min | 1.5–6.7 min. reef_1 and patrols run 1–1.5 min |
| T5 ★★★ not automatic | novice ★★★ 60–100 % on most missions | novice ★★★ is mostly 0–40 %. Skilled ★★★ is 40–100 % |
| T6 final needs T4/V | 7×T3: novice 17 %, skilled 100 % | 7×T3: **novice 0 %**, skilled 80 %. 4×T4 + 3×T3: novice 80 %, skilled 100 % |
| T7 no death spiral | 1 sloop / 2 ships always win | 1 sloop and sloop+brigantine: 100 %. A lone frigate in South China: novice 40 % (see §6) |
| T8 first T2 owned 10–15 min | T2 affordable in ~1 min, owned ~14 min | **15 min** median (p10 13, p90 22) |
| T9 first T5 after 2–4 h active | 1.6 h | **2.8 h** (continuous), 2.6 h (8-h check-ins). Whole campaign 3.0–3.5 h |
| T10 offline ≤ active per hour | holds | holds: offline ≤ 1 cap per 8 h (≈ 300/h) vs ≈ 21 000/h active |

## 2. Battle results

The novice and skilled columns show win % and HP left. Times are novice means.

| Mission | Pre-balance (novice / skilled) | Hand-over iter1 (novice / skilled, HP left) | **Final novice** | **Final skilled** | Novice time | Novice ★/★★/★★★ |
|---|---|---|---|---|---|---|
| reef_1 | 100 / 100 | 100 / 100 (72 %) | **100 %** (78 %) | 100 % | 91 s | 0/0/100 |
| reef_2 fort | **0 / 0** | 67 / 100 (37 %) | **80 %** (29 %) | 100 % | 214 s | 50/25/25 |
| reef_3 survive | 100 / 100 | 100 / 100 (38 %) | **100 %** (32 %) | 100 % | 150 s | 80/0/20 |
| straits_1 | 70 / 90 | 100 / 100 (37 %) | **40–60 %** ¹ | 100 % | 150–180 s | 100/0/0 |
| straits_2 capture | 100 / 100 | 100 / 100 (60 %) | **80 %** (40 %) | 100 % | 236 s | 0/25/75 |
| straits_3 2 forts | **10 / 40** | 100 / 100 (57 %) | **40 → 100 %** ² | 100 % | 222 s | 60/0/40 |
| indian_1 survive | – | 100 / 100 (44 %) | **60 %** (15 %) | 100 % | 174 s | 67/0/33 |
| indian_2 | – | 100 / 100 (41 %) | **80 %** (21 %) | 100 % | 148 s | 100/0/0 |
| indian_3 capture | – | 100 / 100 (77 %) | **80 %** (26 %) | 100 % | 357 s | 75/0/25 |
| spice_1 survive | – | 100 / 100 (46 %) | **100 %** (30 %) | 100 % | 200 s | 100/0/0 |
| spice_2 | – | 100 / 100 (50 %) | **100 %** (40 %) | 100 % | 140 s | 100/0/0 |
| spice_3 2 forts | – | 100 / 100 (81 %) | **100 %** (47 %) | 100 % | 195 s | 60/0/40 |
| storm_1 survive | – | 100 / 100 (73 %) | **100 %** (40 %) | 100 % | 210 s | 100/0/0 |
| storm_2 | – | 100 / 100 (65 %) | **100 %** (38 %) | 100 % | 136 s | 100/0/0 |
| storm_3 final | ~0 / ~10 | 83 / 100 (32 %) | **100 %** (47 %) ³ | 100 % | 188 s | 100/0/0 |
| GATE storm_3, 7×T3 | – | 17 / 100 | **0 %** | 80 % | – | – |
| GATE storm_3, no T5 | – | 50 / 100 | 80 % | 100 % | – | – |
| Patrol, each sea (fleet of that sea) | – | 100 / 100 | 100 % | 100 % | 60–90 s | mostly ★★★ |
| WIPE: 1 sloop / sloop+brigantine | – | 100 / 100 | 100 % | 100 % | 60–100 s | – |
| WIPE: 1 frigate, South China | – | 100 / 100 | **40 %** | 100 % | 206 s | – |

¹ 40 % in `final` and 60 % in `confirm`, after the extra brigantine escort became a sloop. This mission is slightly hard.
² 40 % in `final`. Fort HP then went 260 → 240 and fort damage 14 → 13, and `confirm` gave 100 % (54 % HP left).
³ From `confirm`, after one T3 junk was added back: novice wins with ★ only, and 7×T3 stays at 0 %.

## 3. Final win rules (unchanged code, documented)

- **Battle objectives** (data/campaign.js `objective`):
  - `sink_all`: sink every enemy ship.
  - `destroy_forts`: bring every enemy fort to 0 HP. Downed forts stay down (`BATTLE.fortRebuild=false`). Each enemy repair tick (~5.5 s) heals a fort by `BATTLE.fortRegen` = 2 % of max.
  - `survive`: keep at least one ship afloat for `seconds` while the waves arrive.
  - `capture`: take the listed islands.
- **Defeat:** every player ship is sunk, or the optional `timeLimit` runs out. Retreating counts as a defeat with no further losses. A sunk ship comes home as a wreck that needs salvage. Half the plunder is kept on a defeat.
- **Stars** (Meta/Campaign.js `starsFor`, cumulative):
  - ★ = win.
  - ★★ = win with no ship lost.
  - ★★★ = no ship lost **and** time ≤ `parTime`.
  - Note: GDD sea-battle §9 says ★★★ = "under par" only. The code requires no losses as well. The GDD should be updated to match.
- **Campaign win:** first clear of `FINAL_MISSION` = `storm_3` (Citadel of Storms). It does not depend on rank.
- **Open War:** unchanged. It keeps `constants.js`/`buildings.js` pacing, `rateMult` 1, `BUILD_TIME_MULT` 0.12, unrestricted cannon tiers, and its own victory rules.

## 4. Cannon tiers (new rule from the main thread)

A cannon's tier must be ≤ the hull's tier (`data/cannons.js` `canMountCannon`). The tiers are:

- I: swivel, carronade, falconet
- II: long9, demi_culv, chain_shot, grapeshot
- III: demi_can, mortar1, long12
- IV: carronade32, culverin, mortar2
- V: long24, cannon_royal

Changes made for this rule:

- **Violation fixed:** the indian_2 *Santa Cruz* (brigantine, T2) carried a T3 demi-cannon. It now uses `FIT.longS`.
- **Default fits** are tier-aware. `DEFAULT_LOADOUT` in data/harbor.js is read by `Profile.defaultLoadout(class, tier)`. Every fit is legal and has a range-20 gun on both broadsides, so it reaches forts:

  | Hull | Default fit |
  |---|---|
  | T1 sloop/cutter/schooner | falconet ×2. The old default put T2 demi-culverins on T1 sloops, which breaks the rule. |
  | T2 standard | demi-culverin ×2 + long 9 (= the "Broadside" preset) |
  | T2 light | demi-culverin ×2 |
  | T3 frigate | demi-cannon, demi-culverin, long 12 |
  | T3 galleon | demi-cannon, demi-culverin, mortar I, swivel |
  | T3 xebec | demi-cannon, demi-culverin |
  | T4 heavy frigate | culverin ×2 + long 12 |
  | T4 war galleon | culverin, 32-pdr carronade, mortar II, swivel |
  | T5 | cannon royal, long 24, mortar II, long 12 |

- **Enemy fits:** new `FIT` entries (all legal) for tier III–V enemies:
  - `frigS3`: Spice-sea frigates
  - `heavyS4`: heavy frigates
  - `lineH4`: war galleons
  - `junkH4`: great war junks
  - `lineH5`: the storm_3 man-o-war

  The test "every mission enemy and starter loadout respects the tier rule" passes.
- **Patrol:** `PATROL.loadoutsByTier` (class → tier → fit) gives T2/T3 light, T3/T4 standard and T4 heavy patrol hulls legal tier guns. This needed a one-line read in `Meta/Campaign.makePatrol` (pure Meta, done).
- **Simulated fleets:** `scenarios.mjs` now keeps each hull's default fit, so the realistic fleet uses exactly the guns its tier allows.
- **New cannon stats:** the six new cannons' dmg/rof/wt were **not changed**. With them on both sides, the T4/T5 missions came out in band or easy, so nothing showed they were off.

## 5. Every changed number

### data/harbor.js

| Knob | Before | After | Why |
|---|---|---|---|
| `HARBOR_ECONOMY.rateMult` | 1 | **0.25** | Starter income drops from 4 to 1 wood/s, so a T2 hull is no longer bought from idle income in ~1 min. The sim shows campaign pacing comes from battles and timers, not harbor income (the agent fills the island in ~30 min with battle cash either way). This knob mainly shapes early feel and offline income. T2 now lands at ~15 min. |
| `HARBOR_ECONOMY.buildTimeMult` (new) | 0.12 (Open War `BUILD_TIME_MULT`, "test mode") | **1** | Harbor buildings finished in 2–6 s. They now use the authored `buildTime`/`upgradeTime` (mill 15 s, warehouse 25/30 s, shipyard upgrade 50 s). **Needs wiring, see §7.** The economy sim already uses it. |
| `MOORING_REGEN_FRAC` | 0.004 /s (full heal in ~4 min) | **0.0008 /s** (~21 min) | Paid Repair (30–80 s, 40–140 g) was pointless. Free mooring regen still exists, so Repair/Rush is a convenience and not mandatory. |
| heavy_frigate cost | 1250 w / 900 g | **1150 / 850** | Fits the warehouse path (see below). |
| war_galleon cost | 1500 / 1050 | **1300 / 950** | Same. |
| man_o_war cost | 1900 / 1400 | **1600 / 1250** | Same. |
| ship_of_the_line cost | 2200 / 1650 | **1800 / 1400** | 2200 wood was above what two warehouses give before L9. |
| `DEFAULT_LOADOUT` (new) | class-only, demi-culverins everywhere | per class × tier (§4) | Cannon-tier rule. |

Storage path: the base cap is 800 wood / 600 gold, and each warehouse adds 100…910 by level (L1…L10).
- T4 costs (≤ 1300 wood) need two warehouses at about L4.
- T5 costs (≤ 1800 wood / 1400 gold) need two at L6–L7.
- The economy agent gets there before its first T5 (median 2.8 h).

At a low `rateMult`, the sim agent used to fill the island with mills before placing a second warehouse. That is a soft-lock trap for real players too: no hull above the cap can ever be bought. The agent now keeps room for two warehouses. The UI could hint at this (see §6).

### data/campaign.js

**Region `minRenown`** — Indian **100 → 80**, Spice **200 → 160**, South China **330 → 260**.
- Each gate is now ≈ 80–90 % of the renown from *mission rewards alone* on the main path: 98 / 184 / 292 against gates 80 / 160 / 260.
- Sinks (+2 each) cover the rest, so there is no forced grinding. Before this, winning every Spice mission gave 324 renown against a gate of 330.

**`PATROL.strengthRatio`** — **0.55 → 0.45**.
- Patrols now carry tier-IV guns, so a lone wiped hull needs a smaller opponent.
- Patrols stay 1–1.5 min and almost free of losses.

**`PATROL.loadoutsByTier`** — new (§4).

**Missions.** Before = the state at hand-over. "HP" is novice fleet HP left.

| Mission | Changes | Why |
|---|---|---|
| reef_2 | + sloop *San Pedro* (falconets). Fort stays at 170 HP / dmg 9. | Falconet sloops reach the fort now, so it was 100 % |
| reef_3 | + sloop *La Mouette* in wave 2 | 100 % at 38 % HP |
| straits_1 | *Saltwind Merchant* hp 140 → 155. + sloop *Merlin* | 100 % at 62 % HP. Now slightly hard. |
| straits_2 | + sloop *Le Furet*. *Le Hardi* hp 170. Gullhaven 130 → 175 HP, dmg 8 → 11. | 100 % at 60–64 % HP |
| straits_3 | + brigantine *Sparrowhawk*. Batteries 190 → 240 HP, dmg 12 → 13. | 100 % at 57–60 % HP |
| indian_1 | + ghurab *Kozhikode* (wave 2), + dhow *Mappila* (wave 3) | 100 % at 44 % HP |
| indian_2 | + frigate *São Rafael*. *Madre de Deus* hp 290. *Santa Cruz* fit made legal. | 100 % at 41 % HP, plus the tier violation |
| indian_3 | + frigate *Santo António*, brigantine *São Jorge*, galleon *São Mateus*. Fort 260 → 360 HP, dmg 13 → 16. | 100 % at 66–77 % HP |
| spice_1 | + lanong in wave 2 and wave 3. *Witte Valk* fit heavyS4. | 100 % at 46 % HP |
| spice_2 | Tier fits (lineH4/heavyS4/frigS3). An extra heavy frigate was tried and removed (dropped novice to 40 %). | Tier guns |
| spice_3 | + war galleon *Oranje*, heavy frigate *Middelburg*. Bastions 300 → 360 HP, dmg 15 → 20. | 100 % at 81 % HP |
| storm_1 | + junk (wave 1), + war junk (wave 2), + 2 war junks (wave 3). junkH4 fits. | 100 % at 73 % HP |
| storm_2 | + war junks *Black Tortoise* and *White Tiger*. *Golden Carp* hp 420. junkH4 fits. | 100 % at 65 % HP |
| storm_3 | + junks *Jade Tide* and *Azure Dragon*. Man-o-war hp 520 with lineH5 (cannon royal / long 24). Citadel 420 → 560 HP, dmg 18 → 22. | Gate: 7×T3 must fail. Done for novice (0 %); skilled 80 %. |

### Meta / tests / tools

- `Meta/Profile.js`: `defaultLoadout(class, tier)` reads `DEFAULT_LOADOUT`. `makeRosterShip` passes `h.tier`.
- `Meta/Campaign.js`: the patrol loadout reads `PATROL.loadoutsByTier` (one line).
- `test/12_Meta.test.js`: the offline-economy assertions now multiply by `HARBOR_ECONOMY.rateMult` (an intended rule change). `node test/node_meta.mjs`: **21 passed / 0 failed**.
- `tools/balance/sim_economy.mjs` fixes:
  - Patrols map to the current `patrol_<sea>`/`wipe_*` scenarios. Before, every patrol silently counted as a free win.
  - The agent reserves cells for two warehouses.
  - Uses `buildTimeMult`.
  - Adds `harbor:` milestones.
- `tools/balance/scenarios.mjs`: ships keep their tier default fit.

## 6. Still open / unbalanced

- **straits_1** (novice 40–60 %) and **indian_1** (60 %) are a bit hard. Next step: *Merlin* → cutter, or *Saltwind Merchant* hp back to 140.
- **Survive missions** (reef_3, spice_1, storm_1) and **spice_2, storm_2, storm_3** still win 100 % for novices, but with 1.2–3 ships lost and only ★. Losses cost salvage, and stars are hard to get. Making survive missions bite needs shorter timers or stronger late waves. Not done for lack of budget.
- **Lone salvaged frigate in a South China patrol:** novice 40 %. Two cheap ships, or a T1–T2 hull, always win, so there is no hard death spiral. Next step: a size-aware patrol in `makePatrol` (fewer slots/guns when the budget is below one hull).
- Skilled play beats the T3-only final 80 % of the time. It is gated for novices, not for experts.
- Island build-out is paced by battle cash against cheap Open War building costs (mill 60 wood). `buildings.js` is shared with Open War and I did not touch it. A harbor-only building cost multiplier would need code.
- Fleet-wipe salvage is the biggest gold sink (~26 k over a campaign). It is affordable: the campaign completes in 100 % of sim runs with no patrols needed.
- The economy sim's agent never patrols for renown now, which confirms the new gates.
- Old saves: sloops built before this change keep demi-culverins (T2), which is illegal on T1. A `migrate` pass that clamps loadouts is suggested.

## 7. Wiring needed (outside my files)

1. **`HARBOR_ECONOMY.buildTimeMult`:** in `Experience/Systems/Economy/BuildSystem.js`, line ~629 (`inst.buildTimer = … * BUILD_TIME_MULT`) and line ~804 (`inst.upgradeTimer = … * BUILD_TIME_MULT`) should use a harbor-only multiplier in harbor mode. One way: `st.harborBuildTimeMult ?? BUILD_TIME_MULT`, set in `HarborSession` next to `st.econRateMult = HARBOR_ECONOMY.rateMult`. Open War keeps 0.12.
2. Nothing else. `rateMult`, `BATTLE`, `PRODUCE_AT_SEA` and `MOORING_REGEN_FRAC` are already read by the game.
