# Game Brief — Isles of War

> Rigor: `minimal` project-wide; Harbor, Sea Battle and Campaign Meta are held
> to `standard` via `workflow_overrides.system_overrides` (see `design/gdd/`).

## One line
Build up your own pirate-age island harbor, crew a fleet in its shipyard, and
take that fleet out to separate real-time broadside battles that pay the
plunder your harbor grows on.

## Genre & references
Browser naval strategy: **island base-builder + real-time sea battles** with a
campaign chart between them. Mechanical touchstones are the 2010s browser
"build your island, sail to battle" genre (persistent home base, timers that
run while you are away, fleets that carry damage home). All names, art,
characters and setting are original to this project.

## Setting
The age of sail, c. 1570–1720 (late 16th, 17th and early 18th century). The
player is a free captain with a harbor of their own, fighting across five seas
(`frontend/src/data/factions.js`):

| Sea | Powers met there |
|---|---|
| The Caribbean | Brethren of the Coast (buccaneers), the Spanish Crown's armada, French navy & corsairs |
| The Atlantic Lanes | Honourable Saltwind Company (fictional English chartered company), French |
| The Indian Ocean | Estado da Índia (Portugal), Malabar corsairs |
| The Spice Straits | Spice Company of the Seven Provinces (fictional Dutch company), Orang Laut raiders of Malacca–Singapore |
| The South China Sea (Biển Đông) | Red Banner Fleet (Chinese pirates), Gulf of Tonkin raiders (Vietnam), Portuguese Macau |

Company names are fictional analogues; no film-franchise names or characters.
Ships follow their culture: European square-riggers, Chinese/Vietnamese junks,
Indian dhows/ghurabs, Malay praus. Everything visual and audible is period:
wood, canvas, brass, parchment, ink, black powder — no sci-fi UI language.

## Pillars
1. **My island, my harbor** — a persistent home that keeps producing while you
   are away; every building is a choice about space (grid + adjacency).
2. **Broadsides decide battles** — battles are short (3–8 min), positional and
   about keeping the enemy abeam at your guns' range.
3. **The fleet is the bridge** — the same ships you build and outfit at home are
   the ones that fight; damage and losses come home with them.

## Core loop
```
Harbor ── produces 🪵 🪙 (real-time, offline up to 8 h)
  │  build / upgrade buildings · build & repair ships · fit cannons
  ▼
World Chart ── pick a battle (story nodes, repeatable patrols, open war)
  │  choose up to N ready ships (N = fleet cap from shipyard + barracks)
  ▼
Sea Battle ── real-time RTS naval combat, mission objective
  │  plunder per sink/fort, stars, renown ⭐
  ▼
Harbor ── rewards banked, damaged ships repair, wrecks need salvage
```

## Modes
| Mode | URL | Purpose |
|---|---|---|
| Harbor | `/frontend/` (default) or `?mode=harbor` | Home island builder, shipyard, World Chart |
| Sea Battle | `?mode=battle&mission=<id>` | One mission from `data/campaign.js` |
| Open War | `?mode=skirmish` | The original full RTS match (islands + war front), kept intact |

## Scope for this upgrade (milestone AW)
- Persistent profile + offline progress
- Harbor mode (reuses the AR build dock, ghost placement, research)
- Shipyard: build, repair, salvage ships; fleet roster with HP carried between modes
- World Chart: 9 missions in 3 sea regions + repeatable patrol + Open War
- Sea Battle mode: mission objectives (sink all, destroy forts, survive, capture),
  star rating, plunder, result screen → back to harbor
- Renown → Admiral rank (unlocks regions)

## Out of scope (backlog)
PvP raids on other players' islands, island expansion (grid growth), crew/captain
cards, real audio assets, server save.
