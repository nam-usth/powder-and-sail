# Gameplay pass — progress 02: missions reworked, harbor cost knob tuned

**Status:** in progress — first full campaign sim of the reworked missions running (`battle_g_iter1`).

## Novice baseline before this pass (`battle_g_base`, 5 seeds)
reef_1 100 · reef_2 **20** · reef_3 80 · straits_1 60 · straits_2 60 · straits_3 80 ·
indian_1 **100** · indian_2 60 · indian_3 100 · spice_1 100 · spice_2 100 · spice_3 100 ·
storm_1 100 · storm_2 100 (110 s) · storm_3 100.
(Same data as the last balance pass, different seeds — reef_2 swung from 80 % to 20 %:
5 seeds is ±20 points, so this pass uses 6–8 seeds.)

## Missions — each one now plays differently
Chase objective `sink_target` (straits_1 convoy, spice_2 treasure galleon), guards on a
leash (reef_2, straits_2/3, indian_3, spice_3, storm_3), kiting skirmishers (reef_3,
straits_2, indian_1, spice_2, storm_1/2), anchored guardships (indian_3, spice_3, storm_3),
patrol routes (straits_3, storm_3), runners that flee when hurt (indian_2), and a time
limit (storm_2, race the typhoon). Table in `design/gdd/sea-battle.md` §Mission roster.

Chase probes (4 seeds): laden prize at ½ speed with a head start → straits_1 75 %,
spice_2 75 % (0.55× speed escaped every time, 0.45× never did).

## Harbor building cost
×4 for producers (mills/mines/defenses), exempt shipyard/warehouse/lab (×1), barracks ×1.5.
A flat ×4+ soft-locked the economy agent: Shipyard Lv 4→5 upgrade (150 × 4 × 4 = 2400 wood)
outgrows the storage cap. With exemptions: 20 producers at 34 min (was 11), island full
at 59 min p50 / 84 p90 (was 35), T5 and campaign length unchanged (2.6 h / 3.3 h).

## Tooling
`sim_battle.mjs --set '{"mission":{"dotted.path":value}}'` now works (served-module
patch, file untouched) — used to try tuning variants in parallel.
