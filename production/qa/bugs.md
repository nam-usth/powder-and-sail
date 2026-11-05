# Powder & Sail — QA bug list

Run: 2026-11-04 → 2026-11-05 · build: `eeaf5e7` (wip snapshot) plus whatever the other studio agents had edited at the time of each run
Tester: qa-lead / qa-tester (automated via Playwright `tools/smoke.mjs` + `tools/qa/*.mjs`, Node checks in `tools/qa/meta_logic.mjs`)
Evidence: `production/qa/evidence/qa_*.png`. Results table: `production/qa/test-run-2026-11-05.md`.

Severity: **S1** crash/blocker/progression-blocking · **S2** major feature broken · **S3** minor feature/UX/i18n · **S4** cosmetic/docs/robustness.

No console errors (`console.error` / `pageerror`) were logged in any of these modes: harbor, battle (reef_1, reef_2, reef_3, straits_2, storm_3, patrol), skirmish (60 s simulated), the 390×844 phone viewport, and GFX HIGH and LOW.

| ID | Sev | Area | Title |
|---|---|---|---|
| QA-001 | S1 | Battle / orders | Bombard (siege) order barely damages forts: fort missions take 2–3× par even with an invulnerable fleet, and normal fleets are wiped. The final mission is not winnable this way. |
| QA-002 | S2 | Balance / survive | reef_3 "Hold the Windward Channel": starter fleet is sunk at 2:05 of 2:30 |
| QA-003 | S3 | UI / Shipyard | Build catalog lists enemy-only hulls (Dhow, Ghurab, Ghe Bầu, Lanong, War Junk…) |
| QA-004 | S3 | i18n | VI: harbor action bar (Build/Research/Loadout) and the whole Loadout panel stay in English |
| QA-005 | S3 | Perf | With the Shipyard modal open, headless frame rate drops to ~7 fps and screenshots hang for more than 90 s unless animations are disabled |
| QA-006 | S4 | Battle HUD | Objective panel and versus bar are not refreshed on the final event: the victory screen sits over "Enemy ships sunk 1 / 2" |
| QA-007 | S4 | UI | Fleet card shows capacity "3/5" in harbor/battle while fleet cap is 3 |
| QA-008 | S4 | UI | Floating "+N wood/gold" production popups draw on top of the World Chart briefing |
| QA-009 | S4 | Battle HUD | Ability buttons Z/X/C are clipped by the bottom edge at 1440×810; long faction names are truncated in the versus bar |
| QA-010 | S4 | Save robustness | `migrate()` keeps wrongly typed fields: string `renown` makes `renown += n` concatenate strings |
| QA-011 | S4 | Docs | Spec §12 numbers are stale (T03 rates, T04 amounts, T29 capture time, storm_3 citadel HP) |
| QA-012 | S4 | UX | Offline card says "8 h 0 min" after a 10 h absence without saying that the catch-up is capped |

---

### QA-001 — Bombard order barely damages forts; destroy_forts / capture / final mission not winnable (S1)
- **Area:** Sea Battle, `OrderSystem` siege order + fort regen
- **Repro (automated):** `MISSION=reef_2 SETUP='p.campaign.won={reef_1:true};p.renown=14;' K=40 node tools/smoke.mjs --port 8221 --fresh --path /frontend/ --secs 7 --script tools/qa/battle_logic.mjs`. The script selects all ships, right-clicks the enemy fort (the order becomes "Bombarding Batería de San Telmo") and refills player HP every 10 s.
  Manual: start reef_2 with the starter fleet, select all ships, right-click the fort and watch the fort's HP.
- **Expected:** a fleet that is ordered to bombard a 150 HP fort brings it down well inside par (3:20). T28 and T29 can be won.
- **Actual:**
  - The ships stop at a fixed distance from the fort centre (15/17/19 for r=10, 19/19/19 for r=14) and stay there for the whole fight.
  - The fort's HP hovers or regenerates for minutes at a time, e.g. 113–138 HP from 0:20 to 3:40.
  - **reef_2, invulnerable starter fleet:** the fort fell at **6:32** (par 3:20).
  - **straits_2, invulnerable starter fleet:** the fort fell after ~6:30 and Gullhaven was captured at 6:44 (par 4:00).
  - **storm_3, 3 invulnerable tier-V ships (Man-o-War ×2 + Ship of the Line):** after **11:40** the Citadel is back at **800/800**. It never dropped below ~580.
  - **Normal HP:** the starter fleet was wiped in reef_2 at 2:05, 3× tier-III ships at 4:48, and 3× tier-III ships in straits_2 at 5:51. Guard ships sitting in the fort aura heal from ~10 back to 100 HP between samples.
- **Evidence:** `qa_logic_reef_2.png`, `qa_logic_straits_2.png`, `qa_logic_storm_3.png`, `qa_reef_2_win_result.png` (defeat), `qa_reef_2_frigates_result.png`, `qa_straits_2_win_result.png`. Logs come from `tools/qa/battle_logic.mjs` (dist/isl columns).
- **Suspected:** `frontend/src/Experience/Systems/Naval/OrderSystem.js` `_siege()` → `_engageSteer(ship, isl)`. The ships seem to steer at the island centre, run against the shore, then sit bow-on so their broadsides (side arcs) rarely bear. Fort regen (`data/harbor.js BATTLE.fortRegen`, mission `fortRegen`) and `fortShipRegen` then outpace the remaining damage.
- **Caveat:** this is from a scripted single right-click order. A human who sails past to fire broadsides may do better. It still makes the default "right-click the fort" interaction useless and blocks the progression chain reef_2 → straits_1.

### QA-002 — reef_3 (survive 2:30) lost with the starter fleet (S2, balance)
- **Repro:** `MISSION=reef_3 SETUP='p.campaign.won={reef_1:true};p.renown=14;' K=20 node tools/smoke.mjs --port 8211 --fresh --path /frontend/ --secs 7 --script tools/qa/battle.mjs` (the fleet attacks the nearest enemy).
- **Expected:** the second mission of the game is survivable with the starter fleet (Brigantine + 2 Sloops).
- **Actual:** all 3 ships were sunk at 2:05; 7 enemies were alive at the end (wave 3 brought a brigantine with 2 carronades). The victory logic itself is correct: an invulnerable run won at 2:30 with ★★★ (QA-001 harness).
- **Evidence:** `qa_reef_3_win_result.png` (Defeat), `qa_logic_reef_3.png`
- **Suspected:** `data/campaign.js` reef_3 waves combined with `battleAlwaysEngage` (BattleSession). Needs a balance pass and a manual "kite" playtest.

### QA-003 — Shipyard Build catalog lists enemy-only hulls (S3)
- **Repro:** Harbor → Y → Build tab (any language).
- **Expected:** only `PLAYER_HULLS` appear. Enemy flavour hulls are "never offered by the Shipyard" (`data/harbor.js`).
- **Actual:** Tier I shows **Dhow** next to Sloop/Cutter/Schooner, and higher tiers include Ghurab, Ghe Bầu, Lanong, War Junk and Great War Junk, each with a Build button. `canBuild` rejects them (`unknown_hull`), so the button is disabled, but the cards and stats are shown.
- **Evidence:** `qa_T34_vi_shipyard.png` (Dhow card, bottom right)
- **Suspected:** `frontend/src/Meta/UI/ShipyardPanel.js:241`, `Object.values(HULLS).filter(h => h.tier === t.tier)`. It is missing `&& !h.enemyOnly` (or should use `PLAYER_HULLS`). The `MAX_HP`/`MAX_SPD` stat-bar scales on lines 25–26 also include enemy hulls.

### QA-004 — Vietnamese: action bar and Loadout panel not translated (S3)
- **Repro:** Settings → Tiếng Việt (or `setLang('vi')`) in the harbor, then look at the top action bar and press L.
- **Expected (T34):** harbor UI fully in Vietnamese.
- **Actual:** Harbor Bar, Shipyard and World Chart are translated. The top action bar still reads **Build / Research / Loadout**. The Loadout panel strings are hard-coded English: "⚓ Cannons", "⬆ Upgrades", "DPS", the hint bar ("Click a cannon below → …"), "needs a tier V hull or better", "Needs a tier III hull (this ship: II)", the preset names, the "Upgrade" button and "SUNK".
- **Evidence:** `qa_T34_vi_shipyard.png`, `qa_T34_vi_chart.png`. Script output: `englishLeft: ["Build","Research","Loadout"]`.
- **Suspected:** `frontend/index.html` action-bar labels (not bound to `T`), and `frontend/src/Experience/UI/LoadoutPanel.js` lines 173–174, 219, 226, 317, 393, 404–409, 458.

### QA-005 — Shipyard modal open makes the page very slow headless (S3, perf, investigate)
- **Repro:** `node tools/smoke.mjs --fresh --path /frontend/ --script <press y, then page.screenshot()>`
- **Expected:** a screenshot within a few seconds, as with the harbor alone.
- **Actual:** with the Shipyard open, `requestAnimationFrame` runs at ~7 fps. `page.screenshot` timed out at 30 s and at 90 s; it only completes (17 s) with `animations:'disabled'`.
- **Evidence:** first run of `tools/qa/harbor.mjs` (`shotErr: qa_T09_shipyard_open`). Probe: fps 7.
- **Suspected:** a continuous CSS animation or `backdrop-filter` on the Shipyard veil/cards while the 3D scene keeps rendering underneath. This needs checking on a low-end laptop or phone. Pausing the 3D render while a full-screen modal is open would help.

### QA-006 — Battle HUD stale at victory (S4)
- **Repro:** win reef_1 by sinking the second sloop.
- **Expected:** the objective panel reads "Enemy ships sunk: 2 / 2 ✔" and the versus bar enemy count reads 0.
- **Actual:** behind the Victory card the panel still says **1 / 2** and the versus bar badge shows **1**.
- **Evidence:** `qa_reef_1_win_result.png` (top-left panel). The battle log's last row has `e:[]` but `vs:"1"`.
- **Suspected:** `BattleSession.update()` renders the HUD on a 0.25 s throttle. `finish()` sets `done=true` on the same frame, so the HUD is never re-rendered. Calling `_renderHud()` inside `finish()` fixes it.

### QA-007 — Fleet card capacity "3/5" contradicts the fleet cap of 3 (S4)
- **Repro:** fresh harbor, or any battle: look at the "Fleet 1" tab in the bottom panel.
- **Expected:** a capacity that matches the World Chart fleet cap (3), or no capacity at all.
- **Actual:** it shows **3/5**.
- **Evidence:** `qa_gfx_high_reef_2_keys.png`, `qa_T01_harbor_fresh.png`
- **Suspected:** Open War fleet-group size constant (FleetSystem / ShipCapacity) used in harbor and battle modes.

### QA-008 — Production popups draw over the World Chart briefing (S4)
- **Repro:** phone 390×844, Harbor → W → open the reef_1 briefing while the mill and mine tick.
- **Actual:** "+2" wood and gold floaters appear over the briefing header ("The Caribbean").
- **Evidence:** `qa_phone_briefing.png`
- **Suspected:** EconomySystem / VFX floating text z-index sits above the meta modals. It should be hidden while a meta modal is open.

### QA-009 — Battle HUD clipping (S4)
- **Repro:** any battle at 1440×810.
- **Actual:** the Z/X/C ability buttons at the bottom right are cut off by the viewport edge. The faction name in the versus bar is truncated ("Armada of the Spanish Cro…").
- **Evidence:** `qa_gfx_high_reef_2_keys.png`, `qa_reef_1_win_result.png`
- **Suspected:** `frontend/src/styles` battle HUD layout (ability dock bottom offset, `.vs-name` max-width).

### QA-010 — `migrate()` does not sanitize field types (S4, robustness)
- **Repro:** `node tools/qa/meta_logic.mjs` (`migrate` block). Equivalent in the browser: set `res.wood:"abc"` and `renown:"5"` in `iow_profile_v1`.
- **Expected:** numeric fields are coerced or fall back to defaults.
- **Actual:** `res` stays `{wood:"abc", gold:null}` and `renown` stays the string `"5"`. Winning a battle then does `"5" + 14` = `"514"` renown, and NaN shows up in resource math.
- **Suspected:** `frontend/src/Meta/Profile.js` `migrate()`. It only checks `lastSeen`.

### QA-011 — Spec §12 expected values are stale (S4, docs)
- **T03:** the spec says ≈4 wood/s and 2.5 gold/s. With `HARBOR_ECONOMY.rateMult = 0.25` the rates are **1.0 and 0.625 per s**; the HUD shows "+1.0/s" and "+0.6/s", and 600 frames gave +10.0 / +6.25.
- **T04:** the expected amount follows the same rates.
- **T29:** "stand near 30 s". The observed capture took ≤19 s after the fort fell, with 3 ships.
- **storm_3:** citadel HP changed during the run (560 → 640 in data, 800 shown with the bastion trait).
- **T18:** the 4th ship's checkbox is disabled with a "cap reached" tooltip. There is no toast.
- **Fix:** `docs/SPECIFICATION.md` §12 (regenerate with `tools/spec_tables.mjs`).

### QA-012 — Offline card hides the 8 h cap (S4, UX)
- **Repro:** set `lastSeen` 10 h in the past and reload.
- **Actual:** the card reads "Your harbor kept working for 8 h 0 min". The player was away 10 h and is not told that the catch-up is capped. The arithmetic is correct (clamped to 28 800 s).
- **Evidence:** `tools/qa/offline.mjs` output (T06)
- **Suspected:** `Meta/UI/HarborBar.js showOfflineReport`. Add an "(8 h max)" note when `seconds === OFFLINE_MAX_SEC`.

---

#### Verified fixed / not reproduced
- Known issue §13.3-1 (economy hotkeys L/B/R/V/O/M in battle allow free upgrades) is **fixed**. No panel opened, and battle resources stay 0/0 (`qa_reef_1_abilities_keys.png`).
- T25 abandon flow, T26 URL guard and the T32 Open War isolation behave as specified.

#### Design questions (not filed as bugs)
- Scrapping a **wreck** refunds 30 % of the hull (42/24 for a sloop) even though it has sunk. Salvage costs 50 %, so this cannot be exploited, but it may not be intended.
- After losing every ship, the result screen still shows a Retry button. Clicking it shows the toast "No ships left afloat"; hiding the button would be clearer.
