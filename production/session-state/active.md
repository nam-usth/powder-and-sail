# Session checkpoint — Powder & Sail
Repo: https://github.com/nam-usth/powder-and-sail — main = 5112eeb (v2.4). Language with user: Vietnamese.
Latest zip: /home/user/game/iow_new_fable/PowderAndSail-v2.4.zip (sh tools/package.sh builds dist/*.zip).

## Shipped on main
- v1: Harbor/Battle/Open War split, Meta layer, 15 missions in 5 seas, factions, hull tiers I–V, cannon tiers I–V
- v2: per-cannon audio, onboarding, UI polish, harbor town, regional art, mission variety, QA fixes
- v2.1 cannon research (Gunnery branch) + gun-tier repair costs; v2.2 fleet doctrines; v2.3 fit profiles (2 slots)
- v2.4 stylised World Chart (chartArt.js), home island v5 (mountains/jungle/beach arches/town peninsula/boardwalk), ships v2 (warm hulls, cream sails, contact shadow, wakes; faction bands removed from sails)

## Open items / ideas
- Ask user: re-enable faction bands on sails? Vietnamese thành fort style for storm_1 islands; reef_2 slightly easy; QA-005 shipyard perf on real hw
- Island v5 LOW tris 111k (v4 86k) — reduce trees at LOW if perf issue
- Cannon SFX reference video unreachable (YouTube blocked) — need audio clips from user
- Worktrees: /home/user/game/iow_island_v5, /home/user/game/iow_ships_v2 (merged, can remove)
- Test baseline: node test/node_meta.mjs 43/0; node tools/smoke.mjs --tests 182 pass / 3 known fails (revive timer, 2 SpringCamera)
