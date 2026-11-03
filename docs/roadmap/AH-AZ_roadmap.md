# Isles of War — Claude TODO Roadmap AH → AZ

## Context

This project has evolved from a small Three.js naval combat prototype into a local single-player naval/island RTS prototype inspired by the memory of old browser-based naval strategy games such as *Pirates of the Caribbean: Isles of War*.

The project is a **spiritual redesign**, not a direct clone. Do not copy original proprietary assets, UI, audio, branding, or copyrighted material.

Current phase naming has moved beyond single-letter milestones. We are now using:

```text
AA, AB, AC, ... AH, AI, AJ, ... AZ
```

This TODO file defines the recommended development path from **AH to AZ**.

The main objective before BA is:

> Build a complete local single-player RTS vertical slice where the player can manage islands, build economy, research technologies, produce ships/cannons, arrange defenses, fight AI, raid/capture islands, and reach a clear win/lose state.

Do **not** start backend/auth/database/multiplayer production work before AZ unless explicitly requested.

---

## Global Rules for Claude

- Keep the game playable after each milestone.
- Do not rewrite the whole project unless explicitly instructed.
- Do not add login/auth/database/backend/PvP before BA.
- Do not introduce React/Vue or a heavy bundler unless explicitly requested.
- Keep HTML/CSS/JavaScript ES Modules + Three.js for now.
- Keep gameplay data-driven.
- Do not hardcode combat/building stats inside rendering code.
- Use integer stat tables for HP, armor, damage, production, storage, and capacity where possible.
- Avoid runtime percentage formulas for combat-visible progression stats.
- Prefer small, testable changes.
- Update README/TODO after each milestone.
- If a task is too large, implement the smallest playable version and document the rest as TODO.

---

# AH — Runtime Stabilization & Technical Debt Cleanup

## Goal

Make the current codebase stable enough to build on safely.

## TODO

- [ ] Verify the current baseline runs in browser without syntax errors.
- [ ] Vendor/localize Three.js or clearly document CDN dependency.
- [ ] Add fallback/error handling for CDN dependency failures.
- [ ] Add `.catch()` for Rapier/physics initialization.
- [ ] Fix Research Lab detail bug if present:
  - `labLevelByLevel?.(level - 1)` should become `labLevelByLevel?.[level - 1]`.
- [ ] Fix building move crash if `SceneController.remove()` is incorrectly called as if it were `THREE.Scene.remove()`.
- [ ] Ensure building move preserves instance state:
  - `instanceId`
  - `level`
  - `hp/maxHp`
  - `facingDeg`
  - cooldown/state when relevant
- [ ] Fix raid/warehouse protection logic:
  - warehouse protection should protect player resources from enemy looting;
  - it should not block player from looting enemy/neutral islands.
- [ ] Enforce research requirements inside `ResearchSystem`, not only in UI.
- [ ] Update README milestone name and known limitations.

## Definition of Done

- [ ] Game loads with no console syntax errors.
- [ ] Island selection/build/upgrade/demolish/move does not crash.
- [ ] Research cannot bypass requirements through internal calls.
- [ ] Raid behavior is not blocked by player warehouse protection.
- [ ] Physics failure does not crash the game.

---

# AI — Island RTS Economy Loop

## Goal

Make island economy a core gameplay loop instead of a side panel.

## TODO

- [ ] Show current resource income clearly:
  - wood/s or wood/min;
  - gold/s or gold/min.
- [ ] Ensure Lumber Mill instances stack production correctly.
- [ ] Ensure Gold Mine instances stack production correctly.
- [ ] Ensure destroyed economy buildings stop producing.
- [ ] Ensure Warehouse instances increase storage cap correctly.
- [ ] Ensure Warehouse instances increase protected resource amount correctly.
- [ ] Show storage cap in HUD.
- [ ] Show protected resource amount in island/economy UI.
- [ ] Make captured islands contribute resource income if implemented.
- [ ] Add simple economy tooltip explaining production/cap/protection.

## Definition of Done

- [ ] Player can spend several minutes developing island economy meaningfully.
- [ ] Multiple economy buildings matter.
- [ ] Warehouse cap/protection is visible and functional.

---

# AJ — Construction, Upgrade & Repair Timers

## Goal

Create RTS pacing by making construction, upgrade, repair, and research take time.

## TODO

- [ ] Add construction timer for newly placed buildings.
- [ ] Add upgrade timer for building level upgrades.
- [ ] Add repair timer for damaged buildings/ships if repair is available.
- [ ] Add progress UI for:
  - building construction;
  - upgrading;
  - repairing;
  - researching.
- [ ] Buildings under construction should not provide full effect until complete.
- [ ] Upgrading buildings should either:
  - pause current function; or
  - continue functioning at current level until upgrade completes.
- [ ] Document chosen behavior in README/TODO.
- [ ] Add simple cancel behavior only if easy; otherwise document as TODO.

## Definition of Done

- [ ] Building and upgrades are no longer instant.
- [ ] Player can visually understand what is being built/upgraded.
- [ ] Construction timing creates meaningful pacing without breaking gameplay.

---

# AK — Research Lab & Tech Tree v1

## Goal

Make the tech tree unlock real gameplay options, not only apply global stat buffs.

## TODO

- [ ] Add tech branches:
  - Economy
  - Naval
  - Ballistics
  - Fortification
  - Logistics / Dockyard
- [ ] Gate tech by Research Lab level.
- [ ] Gate certain buildings/defenses by tech.
- [ ] Gate cannon tiers by tech.
- [ ] Gate ship hull tiers by tech.
- [ ] Gate building max level caps by tech/lab level if appropriate.
- [ ] Add research states:
  - locked
  - available
  - researching
  - completed
- [ ] Add research time.
- [ ] Add UI to show requirements clearly.
- [ ] Enforce all requirements in system logic, not only UI.

## Definition of Done

- [ ] Player understands why Research Lab matters.
- [ ] Some buildings/ships/cannons are locked until researched.
- [ ] Research progression changes gameplay choices.

---

# AL — Shipyard, Dockyard & Ship Production

## Goal

Allow the player to produce and recover ships through island infrastructure.

## TODO

- [ ] Add Shipyard production queue.
- [ ] Allow building at least:
  - Light ship
  - Standard ship
  - Heavy ship
- [ ] Add ship build time.
- [ ] Add ship resource cost.
- [ ] Spawn completed ship near dock/shipyard.
- [ ] Allow adding produced ships to active fleet.
- [ ] Ensure no hard fleet composition restriction:
  - 5 Heavy is allowed if player can afford it.
- [ ] Add Dockyard effect:
  - active fleet capacity; or
  - fleet slots; or
  - queue capacity.
- [ ] Show Shipyard queue in UI.

## Definition of Done

- [ ] Player can lose ships and build replacements.
- [ ] Fleet growth depends on island infrastructure and resources.
- [ ] Fleet composition is free-form, not hard-restricted.

---

# AM — Cannon Foundry & Loadout Production

## Goal

Make cannons physical/producible equipment instead of free dropdown options.

## TODO

- [ ] Add Cannon Foundry production queue.
- [ ] Add cannon inventory per player or island.
- [ ] Equipping a cannon consumes one inventory item.
- [ ] Unequipping returns cannon to inventory.
- [ ] Cannon production requires resources and time.
- [ ] Tech tree unlocks higher cannon tiers.
- [ ] Ship/cannon compatibility rules are enforced.
- [ ] If a ship sinks, decide prototype behavior:
  - cannons destroyed;
  - cannons recoverable;
  - cannons return to inventory.
- [ ] Document chosen prototype behavior.
- [ ] Add simple cannon inventory UI.

## Definition of Done

- [ ] Player must plan cannon production.
- [ ] Loadout choices have opportunity cost.
- [ ] Cannon Foundry becomes strategically important.

---

# AN — Defense Platform v2 & Armor Rules

## Goal

Make island defenses meaningfully different and tactical.

## TODO

- [ ] Add `armorByLevel` tables to defensive buildings.
- [ ] Add armor damage rule:
  - `finalDamage = Math.max(1, rawDamage - armor)`
- [ ] Add armor-piercing support if cannon data already supports it.
- [ ] Ensure each defense has:
  - range
  - arcDeg
  - facingDeg
  - accuracy
  - damage
  - reload
  - armor
  - target priority
  - bonus damage by ship class
  - trajectory type
- [ ] Finalize prototype roles:
  - Watchtower = general-purpose defense
  - Bunker = armored close-range anti-raider
  - Culverin Battery = narrow long-range anti-standard
  - Mortar Platform = long-range arc/splash anti-siege
  - Deadman’s Lure = trap/zone control
  - Wall = flat-shot blocker / structure protection
- [ ] Add defense range/arc preview on select and placement.
- [ ] Add basic defense rotation support or TODO if not yet implemented.

## Definition of Done

- [ ] Defense placement has tactical meaning.
- [ ] Different defenses counter different threats.
- [ ] Armor affects combat visibly.

---

# AO — Island Layout UX & Building Repositioning

## Goal

Make island management pleasant and understandable.

## TODO

- [ ] Improve build grid readability:
  - free cells
  - occupied cells
  - invalid cells
  - hover cell
- [ ] Show footprint preview before placement.
- [ ] Show range/arc preview for defenses before placement.
- [ ] Make building detail panel clearer:
  - name
  - level
  - HP
  - armor
  - effect
  - upgrade preview
  - repair/rebuild/move/demolish actions
- [ ] Move building should preserve existing instance state.
- [ ] Demolish should provide partial refund.
- [ ] Add rotate defense action if feasible.
- [ ] Prevent overlap and out-of-grid placement.
- [ ] Ensure click behavior is clear:
  - click island selects island;
  - click building selects building;
  - click ocean moves fleet.

## Definition of Done

- [ ] Player can comfortably arrange and improve island layout.
- [ ] Defense layout is readable before committing placement.
- [ ] Building move/demolish/upgrade flows feel stable.

---

# AP — Neutral Island & Expansion Loop

## Goal

Create map objectives beyond direct base assault.

## TODO

- [ ] Give neutral islands resource caches.
- [ ] Add simple neutral island defenses.
- [ ] Add capture timer after defenses are cleared.
- [ ] Captured island changes owner to player/AI.
- [ ] Captured island provides at least one benefit:
  - resource income;
  - forward dock;
  - build slots;
  - vision/control zone.
- [ ] Add contested capture behavior if enemy is nearby.
- [ ] Add capture UI progress ring/bar.
- [ ] Let AI contest or capture neutral islands at a simple level.

## Definition of Done

- [ ] Player has a reason to fight over neutral islands.
- [ ] Expansion changes economy or map control.
- [ ] Neutral objectives create natural conflict.

---

# AQ — AI Economy & Base Building v1

## Goal

Make AI play the same RTS loop in simplified form.

## TODO

- [ ] AI generates resources over time.
- [ ] AI builds economy buildings.
- [ ] AI builds basic defenses.
- [ ] AI researches technologies.
- [ ] AI produces ships.
- [ ] AI repairs/rebuilds key structures if feasible.
- [ ] Add AI difficulty profiles:
  - Easy
  - Normal
  - Hard
- [ ] AI should not cheat excessively on Normal.
- [ ] AI should scale if player turtles.

## Definition of Done

- [ ] AI base develops over time.
- [ ] Player can harass AI economy.
- [ ] AI becomes stronger if ignored.

---

# AR — AI Naval Strategy v2

## Goal

Make AI fleets feel intentional.

## TODO

- [ ] Add AI fleet roles:
  - Raider
  - Defender
  - Siege
  - Interceptor
- [ ] AI selects targets by priority:
  - resource buildings
  - shipyard/foundry
  - weak defenses
  - neutral islands
  - damaged ships
- [ ] AI retreats when fleet HP is low.
- [ ] AI attacks when fleet power threshold is reached.
- [ ] AI contests neutral islands.
- [ ] AI uses specialized fleet compositions sometimes.
- [ ] AI should avoid suicidal attacks into overwhelming defense if possible.

## Definition of Done

- [ ] AI attacks have recognizable intent.
- [ ] Player must scout/defend/respond.
- [ ] AI behavior supports multiple match rhythms.

---

# AS — Match State Machine & Win/Lose Conditions

## Goal

Make a match feel complete from start to finish.

## TODO

- [ ] Add match states:
  - menu
  - loading
  - playing
  - paused
  - victory
  - defeat
  - summary
- [ ] Add win conditions:
  - enemy Town Hall/Fortress Core destroyed; or
  - domination score reached.
- [ ] Add lose conditions:
  - player Town Hall destroyed; or
  - no fleet + no recovery infrastructure.
- [ ] Add match summary:
  - duration
  - resources gathered
  - ships built/lost
  - buildings destroyed
  - islands captured
  - score
- [ ] Add restart match without page reload.

## Definition of Done

- [ ] Player can win or lose clearly.
- [ ] Match has a summary screen.
- [ ] Restart flow works.

---

# AT — Balance Pass v1: 10–15 Minute Match

## Goal

Tune the prototype into a fun local RTS match.

## TODO

- [ ] Tune starting resources.
- [ ] Tune production rates.
- [ ] Tune build times.
- [ ] Tune research times.
- [ ] Tune ship costs/build times.
- [ ] Tune defense costs/strength.
- [ ] Tune raid loot.
- [ ] Tune capture timing.
- [ ] Tune Deadman’s Lure damage/cooldown.
- [ ] Tune AI attack timing.
- [ ] Test at least three strategies:
  - rush fleet
  - economy expansion
  - turtle tech
- [ ] Prevent extreme snowball if possible.

## Definition of Done

- [ ] Normal match lasts around 10–15 minutes.
- [ ] Player has meaningful strategic choices.
- [ ] No single strategy dominates obviously.

---

# AU — Tutorial & First-Time UX

## Goal

Help a new player understand the RTS loop quickly.

## TODO

- [ ] Add objective tracker.
- [ ] Add tutorial steps:
  - select island
  - build Lumber Mill
  - build Warehouse
  - build Watchtower
  - research a tech
  - build a ship
  - attack/capture neutral island
- [ ] Add tooltips for:
  - resources
  - buildings
  - research
  - shipyard
  - defense arcs
- [ ] Add hint system:
  - “Build more economy”
  - “Research Ballistics”
  - “Enemy fleet incoming”
- [ ] Keep tutorial skippable.

## Definition of Done

- [ ] New player can learn the core loop without reading GDD.
- [ ] Tutorial does not block advanced players.

---

# AV — Save/Load Local Prototype

## Goal

Allow longer local testing without losing progress.

## TODO

- [ ] Save match state to `localStorage`.
- [ ] Load/resume local match.
- [ ] Add reset save option.
- [ ] Add export save JSON.
- [ ] Add import save JSON.
- [ ] Version save schema.
- [ ] Gracefully handle incompatible old save version.

## Definition of Done

- [ ] Refresh browser can preserve current local match.
- [ ] Developer can export/import state for debugging.

---

# AW — Visual/Audio Feedback Pass

## Goal

Improve readability and satisfaction.

## TODO

- [ ] Better cannon impact VFX.
- [ ] Better ship sinking VFX.
- [ ] Building construction VFX.
- [ ] Building under attack warning.
- [ ] Fire/smoke on damaged buildings.
- [ ] Capture zone visual.
- [ ] Defense range/arc visual polish.
- [ ] Audio cues:
  - build complete
  - research complete
  - ship built
  - attack warning
  - ship sunk
  - island captured
- [ ] Keep audio optional/mutable.

## Definition of Done

- [ ] Player understands events without reading logs.
- [ ] Combat/base events feel more satisfying.

---

# AX — Performance & Scene Optimization

## Goal

Keep the game smooth as complexity increases.

## TODO

- [ ] Dispose geometries/materials correctly.
- [ ] Add projectile/VFX pooling.
- [ ] Limit particle counts.
- [ ] Avoid unnecessary grid rebuilds.
- [ ] Optimize minimap/overlay updates.
- [ ] Add simple quality settings:
  - low
  - medium
  - high
- [ ] Track FPS/debug stats.
- [ ] Test with:
  - 10 ships
  - 20 ships
  - many defenses
  - multiple islands

## Definition of Done

- [ ] Game remains playable with moderate battlefield complexity.
- [ ] Restarting match does not obviously leak memory.

---

# AY — Content Pack v1

## Goal

Add enough data-driven content to replay the prototype.

## TODO

- [ ] Add at least 3 maps:
  - small duel
  - center neutral island
  - archipelago
- [ ] Add at least 3 AI profiles:
  - raider
  - turtle
  - balanced
- [ ] Add 2–3 starting scenarios.
- [ ] Finalize prototype values for:
  - ships
  - cannons
  - defenses
  - buildings
  - research
- [ ] Ensure content remains data-driven.

## Definition of Done

- [ ] Player can replay different scenarios.
- [ ] AI profiles create different match styles.

---

# AZ — Local RTS Vertical Slice Freeze

## Goal

Freeze a stable local single-player RTS vertical slice before starting BA phase.

## TODO

- [ ] Feature freeze.
- [ ] Bug fix only.
- [ ] Manual test checklist.
- [ ] Balance snapshot.
- [ ] Known limitations doc.
- [ ] Architecture handoff doc for BA phase.
- [ ] Create “AZ stable build” archive.
- [ ] Document what should not be changed before BA.

## Definition of Done

- [ ] Local single-player vs AI can be played from start to victory/defeat.
- [ ] Core loop is clear:
  - island management
  - economy
  - tech
  - ship production
  - cannon production/loadout
  - defense layout
  - naval combat
  - capture/raid
  - win/lose
- [ ] Game is stable enough to justify moving to BA/backend/persistence planning.

---

# After AZ — BA Phase Preview

Do not implement this before AZ unless explicitly instructed.

Possible BA roadmap:

```text
BA — Thin Backend Prototype
BB — Server-Side Match Simulation Experiment
BC — Local Profile / Persistence API
BD — Optional Auth
BE — PvP Networking Prototype
BF — Replay / Command Log
BG — Backend AI Simulation
BH — Deployment Prototype
```

---

## Final Instruction for Claude

When working on any milestone from AH to AZ:

1. Read the current codebase first.
2. Identify existing implementations before adding new ones.
3. Preserve playability.
4. Prefer simple playable implementations over large architectural rewrites.
5. Update this TODO file with completed items and remaining limitations.

