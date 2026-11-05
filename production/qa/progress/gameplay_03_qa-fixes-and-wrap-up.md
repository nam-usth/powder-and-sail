# Gameplay pass — progress 03: QA fixes, verification, wrap-up

- **QA-001 (S1) fixed** — `OrderSystem._engageSteer` bombards from just off the shore
  (`r + 2 + rank·0.8`) instead of a gun-range ring measured to the island centre;
  `BATTLE.fortRegen` 0.02 → 0.006. Invulnerable probes: reef_2 fort 111 s → 66 s; storm_3
  citadel with 3×T5 never fell (QA) → 193 s.
- **QA-002** — reef_3 balanced for the starter fleet (wave 3 at 105 s, lighter brigantine);
  sim scenario now uses the starter fleet: 100 % (4 seeds), 24 % HP left.
- **QA-010** — `Profile.migrate` coerces renown/res/stats/fleet numbers (unit test).
- Verification (`battle_g_final`, novice): every fort/capture mission 100 %, gate 7×T3 0 %,
  lone frigate patrol 100 % (was 40 %). Fort missions now need a re-tune (too easy).
- Tests: `node test/node_meta.mjs` 29/0; browser suite 168 pass / 3 known fails.
- Spec tables refreshed; `design/balance/report.md` §0 written; GDDs updated.
