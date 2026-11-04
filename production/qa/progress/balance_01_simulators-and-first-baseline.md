# Balance pass — progress 01: simulators built, first baseline signals

**Status:** in progress (systems/economy/QA). Numbers below are from the
pre-balance game (git HEAD) — the reproducible "before" run is still going.

## Tools (new)
- `tools/balance/sim_battle.mjs` — headless Chromium plays real Sea Battles
  (`/frontend/?mode=battle`), rendering + visual systems stubbed, VFX shim keeps
  cannonball flight time; scripted **novice** and **skilled** policies drive the
  fleet through `test/harness.js` right-clicks. ~0.1 ms per frame: a 15-min
  battle simulates in ~5 s. `--git-ref HEAD` serves the pre-balance data/meta
  files from git for a reproducible "before".
- `tools/balance/sim_economy.mjs` — pure Node; real Meta modules; a
  "sensible novice" agent (repairs, goal fleet per mission, ROI-gated harbor
  investment, patrols when blocked) × 3 player models (continuous / 25-min
  sessions / idle 8-min every 8 h); battle outcomes bootstrapped from the
  battle sim.
- `tools/balance/scenarios.mjs` — the fleet a player realistically owns at
  each mission (shared by both sims).

## First baseline signals (pre-balance, novice / skilled, 10 seeds)
| Mission | Novice win | Skilled win | Note |
|---|---:|---:|---|
| reef_1 (starter fleet) | 100% | 100% | ~75 s, ★★★ every time |
| reef_2 (fort) | **0%** | **0%** | starter carronades/swivels (range 8) can never reach a fort (needs > r+4 = 15) |
| reef_3 (survive) | 100% | 100% | |
| straits_1 | 70% | 90% | |
| straits_2 (capture) | 100% | 100% | |
| straits_3 (2 forts) | 10% | 40% | downed forts are rebuilt by the AI after ~20 s + 1.1 %/s regen |
| storm_3 (final) | ~0% | ~10% | |

Economy (current numbers): first tier II affordable in ~1 min, an agent fills
the island with producers in < 20 min; campaign pacing is far faster than the
2–4 h target → needs a harbor-only economy clock (knob added:
`HARBOR_ECONOMY.rateMult`).

## Done so far (code)
- Campaign restructured to 5 seas / 15 missions with factions (main-thread request).
- Knobs: `BATTLE {aggro, fortRegen, fortRebuild, fortShipRegen}`,
  `HARBOR_ECONOMY.rateMult`, `PRODUCE_AT_SEA`, enemy-only hulls (`enemyOnly`,
  `style`), patrol sized to the sailing fleet (death-spiral fix).
- Bug fixes: scenery rocks are no longer shot at; resources above the cap are
  no longer clamped down by the harbor economy tick.

Next: finish the before baseline, tune loadouts/rosters/forts with the battle
sim, then the economy clock + costs with the economy sim.
