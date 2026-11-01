# Age of AI Symbiosis — Current State Audit

Status: verified against branch `feat/home-phase2-manufacturing` on 2026-11-01.

## Engine contract

| Concern | Verified implementation |
|---|---|
| Build | npm workspaces; Node 20+; `npm run typecheck`, `npm run build`, `npm run smoke`, `npm run test:home` |
| Engine | Custom TypeScript engine. Node/WebSocket authoritative simulation; Canvas 2D dimetric renderer; DOM HUD |
| Lifecycle | `Lobby` creates `Game`; server advances at 10 ticks/s; snapshots are sent at 5 Hz and interpolated by `GameState` |
| State | Server owns players, units, buildings, nodes, sheep, raids, Home progression and ledgers |
| Input | Client sends typed intent commands; selection, box-select, contextual orders, building placement and camera controls already exist |
| Navigation | Seeded tile maps with separate land, naval and air grids; cached A* paths and spread destinations |
| Persistence | Versioned persistent Home saves with atomic JSON writes, backup recovery and offline progression |
| Rendering | Depth-sorted isometric terrain/entities, PNG sprites with procedural fallbacks, fog, minimap, construction stages and combat FX |

## Existing gameplay

- Four-resource Arena economy: food, wood, gold and stone.
- Gather/drop-off loops, production queues, housing, ages/city levels, research,
  market trading, power supply/draw and deterministic server validation.
- Physical human, robot and drone builders; construction travel and staged work.
- Ground, air and naval combat; melee, ranged projectiles, defenses, garrisoning,
  damage, destruction, victory and defeat.
- Persistent Home through the current Phase 4 progression breadth: city upgrades,
  factories, camps, manufactured armies, unit research, asynchronous raids,
  reports, replay data, shields and a city ledger.
- Machine roster already includes attack drones, fighters, rocket launchers,
  siege mechs, stealth bombers, plasma tanks and hero exosuits.
- Existing bot economy/combat AI in `server/src/game/ai.ts`.
- Existing deterministic match ledger, canonical archive and optional end-of-match
  proof anchoring. Blockchain is outside the combat loop.

## Existing presentation

- Full-screen battlefield with edge HUD, minimap and contextual command areas.
- Futuristic building/unit PNGs in `client/public/sprites`, plus procedural art.
- Placement ghosts, selection rings, construction scaffolding, power lines,
  projectile travel, impacts, death effects and tiered weapon audio.
- Urban Home ground system with roads, plots, central Civic Hub and engineered
  resource districts.
- English, Portuguese and Spanish localization framework.

## Tests and diagnostics

The repository contains domain tests for combat, economy, construction, power,
fog, navigation, progression, Home persistence/phases, raids, ledgers and lobby
flows. `scripts/balance_sim.ts` and `scripts/telemetry_report.ts` are currently
untracked user work and must be preserved.

## Worktree preservation

At audit time, uncommitted changes existed in:

- `client/src/atlas.css`, `client/src/game/audio.ts`, `client/src/main.ts`,
  `client/src/screens/game.ts`;
- `server/src/game/room.ts`, `server/src/home/types.ts`,
  `server/src/raid/orchestrator.ts`, `shared/src/types.ts`;
- untracked `scripts/balance_sim.ts` and `scripts/telemetry_report.ts`.

These changes are treated as user-owned. Rebrand work must use narrow patches and
must not reset or rewrite them wholesale.

## Reuse / improve / replace

| System | Decision | Reason |
|---|---|---|
| Authoritative `Game` simulation | Reuse | Correct trust boundary and extensive tested behavior |
| Canvas renderer and camera | Reuse and polish | Already supports required feedback and custom visual language |
| Pathfinding and unit state machines | Reuse | Deterministic and integrated across land/naval/air domains |
| Existing machine roster/facilities | Reframe and balance | More complete than the six-building/three-unit minimum |
| Bot AI | Reuse as opponent AI | It is not the player-facing commander abstraction |
| Council/advisor panel | Replace progressively | Static recommendations do not expose objectives, autonomy or decisions |
| Four-resource public economy | Migrate later | Direct replacement now would corrupt saves and invalidate many tests |
| Blockchain-facing presentation | De-emphasize | Product must be complete without it; proof remains optional post-match infrastructure |

## Highest-impact gaps

1. No selectable Vanguard, Sentinel or Architect commander.
2. No strategic-order protocol or Manual/Assisted/Autonomous control.
3. No structured, player-visible decision explanation log.
4. Public economy still exposes four historical resources instead of Energy,
   Alloys and Compute.
5. HUD composition still reflects older Council/ledger concepts rather than a
   clear commander panel and match analytics hierarchy.
6. Combat telemetry exists in pieces but is not yet presented as the requested
   post-match timeline and summary.
