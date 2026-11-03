# Isles of War — Claude Code Game Studios setup

Browser naval strategy game, structured with the
[Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios)
harness (agents, skills, hooks and rules live in `.claude/`).

## Technology Stack

- **Engine**: custom — Three.js r128 + Rapier (vendored in `frontend/vendor/`)
- **Language**: JavaScript (plain ES modules, no bundler, no build step)
- **Version Control**: Git, trunk-based
- **Build System**: none — any static server; bump `?v=` in `frontend/index.html` when an entry JS/CSS changes
- **Asset Pipeline**: GLB models + mp3 under `frontend/Assets/`

`engine.name` in `project.yaml` is intentionally unset: the harness only knows
Godot/Unity/Unreal specialists. For engine questions route to the generalists
(`gameplay-programmer`, `engine-programmer`, `ui-programmer`,
`technical-artist`) and read `docs/engine-reference/threejs/VERSION.md`.

## Game pillars (see `design/game-brief.md`)

1. **Harbor** — your own persistent home island: build, upgrade, produce, build ships.
2. **Sea Battle** — separate real-time naval battles launched from the World Chart.
3. **Campaign loop** — battles pay plunder that feeds the harbor; the harbor feeds the fleet.

## Project Structure

| Path | What |
|---|---|
| `frontend/src/` | Code root. `main.js` boots the mode chosen by `Meta/ModeRouter.js` |
| `frontend/src/Meta/` | Persistent profile, campaign, harbor economy (no Three.js imports) |
| `frontend/src/Experience/` | 3D runtime (GameApp = battle, HarborApp = home island) |
| `frontend/src/data/` | Pure data — every balance number lives here |
| `test/` | Browser test runner (`/test/`) + `harness.js` play driver |
| `tools/` | `serve.mjs`, `smoke_test.py` (Playwright) |
| `design/` | `game-brief.md`, `gdd/*.md` |
| `docs/architecture/` | ADRs |
| `production/` | epics, stories, QA evidence screenshots |

## Coordination Rules

@.claude/docs/coordination-rules.md

## Collaboration Protocol

`modes.automation: guided` — major decisions are confirmed with the user,
routine implementation proceeds. No commits without user instruction.
A story that changes anything the player sees is not done until the game
was launched, looked at, and a screenshot saved to `production/qa/evidence/`.

## Coding Standards

@.claude/docs/coding-standards.md

Project-specific:
- Data separate from logic: numbers go in `frontend/src/data/`.
- `Meta/` modules are pure JS (no DOM, no Three.js) so they unit-test in Node.
- Event bus (`bus.emit/on`) over direct coupling.
- i18n: EN is source of truth in `frontend/src/i18n.js`; VI should be kept in sync.

## Context Management

- **`production/session-state/active.md` is the session checkpoint.**
- Helpers in `.claude/scripts/` emit observations, never verdicts.
