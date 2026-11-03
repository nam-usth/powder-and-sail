# EPIC AW — Harbor & Sea Battle split

Design: `design/game-brief.md`, `design/gdd/{harbor,sea-battle,campaign-meta}.md`
Architecture: `docs/architecture/ADR-001-mode-split.md`

| ID | Story | Type | Evidence | Status |
|---|---|---|---|---|
| AW-S01 | Install CCGS harness, project.yaml, CLAUDE.md, brief, GDDs, ADR | Config | this file | Done |
| AW-S02 | Meta layer: Profile (storage, migrate), HarborEconomy (offline), Shipyard, Campaign | Logic | `test/12_Meta.test.js` | Done |
| AW-S03 | Mode router + `GameApp(opts)` feature table; Open War unchanged | Integration | existing suites green | Done |
| AW-S04 | Harbor mode: single home island, persistence of buildings/resources, moored roster | UI/Visual | `production/qa/evidence/aw_harbor*.png` | Done |
| AW-S05 | Shipyard panel: build / repair / salvage, roster | UI | `aw_shipyard.png` | Done |
| AW-S06 | World Chart: regions, mission nodes, fleet picker, Set Sail | UI | `aw_chart.png` | Done |
| AW-S07 | Sea Battle mode: mission islands/enemies, MissionSystem objectives, HUD | Integration | `aw_battle*.png` | Done |
| AW-S08 | Battle result screen → rewards, wrecks, stars → back to harbor | Integration | `aw_result.png`, Meta tests | Done |
| AW-S09 | i18n EN/VI for all new strings | Config | — | Done |
