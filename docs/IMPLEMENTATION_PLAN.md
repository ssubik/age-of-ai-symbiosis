# Age of AI Persistent Home — Implementation Plan

Status: Phase 0 audit complete; Phase 1 rules, persistence and HUD verified; original sci-fi art set outstanding

Normative source: project-owner master specification dated 2026-10-29

## Verified engine contract

| Contract | Verified project evidence |
|---|---|
| Build and run | npm workspaces; `npm run typecheck`, `npm run build`, `npm run smoke`; server entry `server/src/index.ts`, client entry `client/src/main.ts` |
| Runtime | Custom Node/TypeScript authoritative simulation at 10 ticks/s; browser TypeScript/Canvas 2D renderer; JSON WebSocket protocol |
| World | 144x144 seeded tile map; ground/naval/air walkability grids; isometric camera, minimap and fog |
| State | `Game` owns players, units, buildings, nodes and sheep; client `GameState` projects authoritative snapshots and interpolates movement |
| Input | `GameInput` owns selection, contextual right-click, footprint placement and raid perimeter deployment |
| Construction | `Game.cmdBuild` validates/spends/places; units path adjacent; `updateBuilding` advances authoritative progress; renderer derives staged scaffolding and crew FX from progress |
| Rendering | `Renderer` depth-sorts entities; bitmap building/unit loaders have procedural fallbacks; construction, projectiles, damage, wrecks and placement ghosts already exist |
| Assets | Transparent PNGs in `client/public/sprites`; import maps and fit values in `client/src/game/sprites.ts` |
| Networking | `Lobby` binds transient connections to rooms; `GameCommand` messages are intents; full snapshots broadcast at 5 Hz |
| Existing attacks | Room-scoped raid prototype in `Game`; it currently targets live room entities and is not persistent or isolated |
| Persistence | Match archives exist, but no authoritative player/home save repository exists |

## Subsystem inventory and reuse decision

| Subsystem | Existing owner | Phase 1 decision |
|---|---|---|
| Simulation tick | `server/src/game/room.ts` | Reuse through a distinct Home `Game` instance; add home-mode lifecycle and durable capture/restore |
| Runtime entities | `server/src/game/state.ts` | Reuse entity shapes; persistent DTOs remain plain versioned records |
| Pathfinding | `server/src/game/path.ts` | Reuse unchanged for robot travel and reachability |
| Placement | `cmdBuild`, `validFootprint`, `GameInput` | Reuse validation, ghost and command path |
| Builder work | `updateMovingToBuild`, `updateBuilding` | Preserve Arena behavior; Home applies the specified multi-builder rate and offline catch-up |
| Power | `recomputePower`, `powerEfficiency` | Reuse; freeze last validated power factor during capped offline work |
| Map | `mapgen.ts` | Generate once for a new profile, then persist exact tiles/entities |
| Renderer | `renderer.ts` | Reuse; strengthen four authoritative construction stages and Home mode framing |
| Sprites | `sprites.ts` | Reuse original PNGs and procedural fallbacks; no engine replacement |
| HUD | `hud.ts`, `screens/game.ts` | Reuse map-first HUD; add Home identity, city progress and Arena exit without a dashboard |
| Arena | `Lobby` rooms and `Game` | Preserve unchanged behind explicit Arena navigation |
| Storage | none | Add repository interface and atomic JSON implementation with backup and per-profile serialization |

## Conflicts with `ASYNC_BASE_RAID_SYSTEM.md`

The master specification supersedes these older decisions:

1. Older section 8 consumes all reserved troops after first deployment. New rule:
   deployed troops are consumed; undeployed reserved troops return.
2. Older section 9 debits defender resources. MVP rewards are now system-funded
   from a pinned bounded offer; defender stockpile is unchanged.
3. Older Home HUD removes box selection and direct standing-army control. Phase 1
   explicitly preserves established builder selection/context controls at Home.
4. Older builders become abstract construction slots. New rule requires physical
   assigned builders, travel, arrival and visible server-authoritative work.
5. Older screen plan is management-page oriented. New rule keeps the isometric
   world full-screen with edge-mounted overlays.
6. Older phase ordering starts with broad profile conversion. The master requires
   Phase 0 proof/inventory followed by a narrow persistent-construction slice.

## Phase 0 deliverables

- [x] Repository and runtime inventory.
- [x] Conflict list.
- [x] Technical art and asset inventory in `ART_ASSET_MANIFEST.md`.
- [x] Existing hero-building, turret and drone sources inspected at original size.
- [x] Existing renderer path verified for sprites, procedural fallback, staged
  construction, projectile travel and destruction.
- [x] Fresh in-game screenshots and FPS baseline (2026-10-29, headless Chrome over CDP
  against the dev stack, fresh Level 1 Home): 1920x1080 60.0 fps, 1280x720 59.8 fps,
  390x844 60.0 fps; p50 16.7 ms, p95 16.8 ms frame interval at every viewport.
  Headless numbers are vsync-capped and do not stand in for a low-end hardware run.

Visual finding: current transparent assets are technically usable, but their
architectural language mixes detailed Himalayan brick/courtyard forms with sleek
sci-fi aircraft. Phase 1 will keep them as owned source material while the actual
renderer proof emphasizes common slate armor, cyan energy, amber construction and
strong roof silhouettes. Large-scale asset replacement is not authorized in Phase 1.

## Phase 1 architecture

### Feature flag

`PERSISTENT_HOME_ENABLED` gates Home creation and defaults on for development.
Setting it to `false` restores the name-to-lobby flow without changing Arena data.

### Durable record

`HomeSaveV1` stores:

- schema version, profile ID, profile revision and save timestamp;
- exact map tiles and simulation tick;
- one owner player record with resources, city level, tech and power inputs;
- buildings, construction progress and queues;
- units, builder assignment/task state and positions;
- nodes and sheep needed to reconstruct the home map;
- no Canvas objects, connection IDs, timers, pathfinding caches or interpolated state.

Writes use `file.tmp -> file`, retain `file.bak`, validate on load and serialize
mutations per profile. Browser `clientId` is hashed into a stable profile ID.

### Home session

- A Home session owns a distinct `Game` instance and entity collections.
- `homeMode` disables victory/defeat, enemy AI, ledger settlement and destructive
  Arena-only commands while retaining the normal construction simulation.
- Home starts directly after accepted identity when the flag is enabled.
- The same Canvas `GameScreen` receives `session: 'home'` and keeps the full map.
- **Arena** exits Home and returns to the current lobby; Arena rooms continue to
  instantiate ordinary games.
- Active Home sessions save every five seconds; disconnect/exit forces a final save.

### Offline work policy

On load, elapsed time is capped to 8 hours. Only units saved as assigned to a valid
owned construction site count. A unit already building contributes immediately. A
unit travelling contributes only after its saved remaining path travel time. The
last validated grid factor is frozen for the offline interval. Each site uses:

```text
effectiveRate = fastest adjusted builder + 0.60 * sum(other adjusted builders)
```

Work clamps at completion. No offline pathfinding is replayed.

### City level 1 -> 2

Phase 1 keeps the existing `age` wire field as the City Level compatibility field.
The Civic Hub remains the authoritative level owner. The Level 2 action requires a
completed Robotics Workshop, at least one completed power generator, a non-negative
grid margin, the configured development threshold and resources. Starting the Hub
upgrade turns it into a visible construction project and dispatches the available
qualified builders; completion sets City Level 2. Cheap walls are capped in development value.

### Initial bootstrap

New Home profiles start with the existing generated Civic Hub, residence, food
facility and materials depot. The three physical builders demonstrate the intended
collaboration immediately: one Human Designer, one Builder Robot and one
Construction Drone. Bootstrap resources cover power and the first Robotics
Workshop. The Drone Factory remains Level 2 and requires the completed workshop.

## Phase 1 implementation result

- [x] Versioned `HomeSaveV1`, atomic JSON repository, backup recovery and serialized profile writes.
- [x] Stable hashed browser profile identity and explicit Home/Arena protocol messages.
- [x] Map-first Home opens after sign-in; Arena remains the existing room/lobby flow.
- [x] Exact map/entities/resources/tasks persist across server restarts.
- [x] Physical builder travel and authoritative construction; unassigned sites do not progress.
- [x] Home multi-builder aggregation uses fastest adjusted builder plus 60% of helpers.
- [x] Eight-hour offline cap for assigned construction and passive facility production.
- [x] Civic Hub Level 1→2 requirements, visible construction and completion-driven level change.
- [x] Level 2 Drone Factory unlock path; existing Arena combat rules remain separate.
- [x] Home HUD exposes level, development, workshop, grid state and the Arena exit.
- [x] Decorative construction workers are suppressed in Home; visible workers are real entities.
- [x] Browser screenshots at required viewports and measured frame-time evidence.
- [x] One live Home session per profile: a second tab/reconnect saves and closes the older one.
- [x] Client re-enters Home after a mid-session reconnect (Home is not a resumable room).
- [x] Profile directory resolves from the server module (`server/profiles`), not the cwd.
- [x] Human Designer build rate aligned to spec 1.00x.
- [ ] Construction-in-progress screenshot sequence (stages 0-15/15-55/55-90/90-100 with
  builders on site). Stage derivation is covered by `construction_fx_test.ts`; the
  live capture still needs to be scripted.
- [ ] Original sci-fi Hub, factory, builder and turret art per `ART_ASSET_MANIFEST.md`.
  Shipping sprites are still the brick/courtyard set, which fails §8.1/§8.5.

## Dependency order

1. Shared versioned Home DTOs, session discriminant and city-balance tables.
2. Atomic repository and migration/validation tests.
3. `Game` home-mode capture/restore, dirty notifications and offline work.
4. Lobby Home lifecycle and command routing; Arena isolation.
5. Client Home session framing, Arena control and city-progress feedback.
6. Four-stage construction presentation tied to authoritative progress.
7. Domain, restart, protocol and Arena regression tests.
8. Fresh screenshots and frame-time measurement on a browser-capable host.

## Migration strategy

- No existing Arena archive is rewritten.
- No room or transient numeric player ID becomes a durable profile key.
- A missing profile creates V1; a malformed primary file falls back to `.bak`.
- Unknown future versions are rejected rather than guessed.
- V1 is strictly validated; future schema versions are rejected until an explicit
  migration is implemented.
- Removing the feature flag leaves durable Home files untouched and recoverable.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `Game` is large and room-oriented | Use explicit `homeMode` branches and characterization tests; do not fork renderer/simulation |
| One-player victory ends Home | Disable victory/defeat and game-over callback in Home mode |
| Duplicate work on restart | Persist normalized progress and timestamp; clamp elapsed; serialize profile writes |
| Multi-builder double counting | One site aggregation per tick in Home mode; deterministic builder ordering |
| Client reconnect creates two sessions | Profile-keyed Home session registry and connection rebinding |
| Sprite/style drift | Manifest palette, fixed projection/fit, actual-scale screenshot gate |
| Existing server on port 8080 | Port-free domain tests; use an isolated port for browser capture when supported |
| Huge snapshots/storage | Phase 1 JSON is local-development storage; repository interface permits database migration |

## Verification commands

```bash
npm run typecheck
npm run build
npm run test:home   # home_persistence_test + home_phase1_test
npx tsx scripts/construction_fx_test.ts
npx tsx scripts/lobby_test.ts
npx tsx scripts/raid_loop_test.ts
npm run smoke
```

`npm run smoke` requires exclusive access to port 8080. Screenshot acceptance must
cover 1920x1080, 1280x720 and one narrow viewport, plus an actual frame-time sample.

Verified on 2026-10-29: typecheck, `test:home` and production client build pass.
The legacy `test:automation` assertion that “Classic rejects Symbiosis buildings”
is already incompatible with the repository's earlier single-city-system change;
it is not a Phase 1 regression. An Arena smoke attempt reached all 19 passing
assertions, but port 8080 was already owned by another server, so that run is not
accepted as isolated evidence.

