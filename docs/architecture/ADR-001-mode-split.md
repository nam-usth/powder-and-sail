# ADR-001 — Split the game into Harbor / Sea Battle / Open War modes

Status: Accepted · 2026-11-03

## Context
The game was one RTS match where island building and naval combat share one
map and one session. The new design (see `design/game-brief.md`) needs a
persistent home island and separate battles. `GameApp` wires ~30 systems with
module singletons (`time`, `bus`, `toasts`) and DOM-bound panels that assume
one lifetime per page.

## Decision
1. **One page, one mode per page load.** `Meta/ModeRouter.js` reads `?mode=`
   and boots `GameApp` with a mode config. Switching mode navigates
   (`location.assign`) — singletons and DOM state reset for free.
2. **`GameApp(opts)` is configured by a feature table** (`data/modes.js`):
   which islands, which fleets, and which systems tick (`build`, `research`,
   `waves`, `warFront`, `ai`, `revive`, `capture`, `seaEvents`, `fog`,
   `economy`, `trade`). Default (no opts) = Open War, so existing tests and the
   classic match are unchanged.
3. **Persistent state lives in a pure-JS meta layer** (`frontend/src/Meta/`),
   storage injected (localStorage in the browser, a Map in tests). The 3D
   runtime only reads a snapshot at boot and writes back through
   `HarborSession` / `BattleSession` adapters.
4. Mode-specific HUD visibility is CSS (`body.mode-harbor`, `body.mode-battle`).

## Consequences
+ No teardown code for 30 systems; zero risk to the Open War match.
+ Meta rules are unit-testable in Node.
− A mode switch reloads the page (~1 s with vendored assets). Acceptable for a
  harbor ↔ battle transition, which gets a loading screen anyway.
− Systems still get constructed in modes that never tick them (small memory cost).
