# Balance targets — Powder & Sail (campaign + harbor)

Design goal (user): **"not too hard, not too easy for a new player."**
Results and every changed number: `design/balance/report.md`.

## Targets

| # | Target | Measured by |
|---|---|---|
| T1 | First mission (`reef_1`, starter fleet, default guns): novice win **≥ 90 %** | battle sim, novice |
| T2 | Every later mission: novice win **≈ 70–85 %** with the fleet a player realistically owns by then | battle sim, novice, `scenarios.mjs` fleets |
| T3 | Every mission: skilled win **≥ 90 %** | battle sim, skilled |
| T4 | Battle length **2–6 min** (missions; patrols may be shorter) | battle sim, mean time |
| T5 | ★★★ possible but not automatic (novice rarely, skilled usually) | battle sim star split |
| T6 | Final mission (`storm_3`) **needs tier IV/V**: a 7×T3 fleet loses most of the time (novice) | `GATE_SCENARIOS` |
| T7 | No death spiral: a patrol is always winnable with what is left after a wipe, and pays more than the repairs it causes | `PATROL_SCENARIOS` wipe_* + economy sim |
| T8 | First tier-II ship owned after **~10–15 min** of active play | economy sim `own:T2` |
| T9 | First tier-V ship owned after **~2–4 h** of active play | economy sim `own:T5` |
| T10 | Offline income (8 h cap) never beats active play per hour | economy sim: offline per wall-hour vs live per active hour |

## Method

- **Battle sim** (`tools/balance/sim_battle.mjs`): the real Sea Battle in headless
  Chromium, two scripted players. *Novice* = right-click the nearest enemy every
  5 s, no abilities. *Skilled* = focus fire, forts after ships, Z/X/C abilities.
  5–6 seeds per mission and policy (the outcome spread is small; more seeds were
  not worth the run time).
- **Progression model** (`tools/balance/scenarios.mjs`): sea *k* ≈ tier *k*; the
  roster grows by one ship per shipyard level; ships are refitted with the
  one-click "Broadside" preset from tier II on.
- **Economy sim** (`tools/balance/sim_economy.mjs`): the real Meta modules, a
  "sensible novice" agent, three player models (continuous / 25-min sessions /
  8-min check-ins every 8 h); battle outcomes resampled from the battle sim.
- Proxy used while tuning: novice *fleet HP left* of roughly 25–35 % ≈ 75–85 % wins.
