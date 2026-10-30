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


## Phase 2 — manufacturing and camps (implemented 2026-10-29)

Home-only branches in `Game`; Arena training (ELON payment, queue-time army
check, full refunds, pop housing) is unchanged.

| Rule (master spec §5) | Implementation |
|---|---|
| Starting a job deducts resources once | `cmdTrain` pays `UNIT_DEFS.cost` in resources and stores `paid` on the job; Home never spends ELON |
| Finished unit occupies camp capacity or waits in the factory | `releaseFinishedUnit` checks the shared camp pool; otherwise `trainBlocked = 'no_camp' \| 'camp_full'` and the head stays at 100% |
| Camp space separate from stats | `HOME_CAMP_SPACE` (drone 1, siege 4, rocket 3, fighter 3, bomber 5, tank 5, guardian 8); Home army does not use housing |
| Cancel refunds 100% unstarted / 50% started / none finished | `cancelHomeJob`, clamped to storage caps so refunds cannot mint past capacity |
| Power shortage slows factories | Job progress scales by `powerEfficiency` (30% floor) |
| Physical departure and docking | Unit exits beside the factory and paths to a ring tile of the nearest camp, spread by occupancy |
| Restart/offline queue work | Same 8h cap and frozen power factor as construction; finished units dock directly; a full camp blocks offline as it would live |
| Production VFX | Chasing cyan line strip and weld sparks while working; bay door glow over the last 10%; amber outline plus a "!" chip when blocked; reduced-motion holds them still |
| HUD | Train tooltips show resource cost and camp space; queue shows why it is blocked; cancel tooltip states the 50% refund once started |

Tests: `scripts/home_phase2_test.ts` (in `npm run test:home`) covers payment,
blocking with no camp and with a full camp, no refund for finished units,
refund rules and storage clamp, docking, housing exclusion, same-instant restart,
one hour offline (3 jobs → exactly 3 units, no duplicates across a second
restart), and offline filling to capacity only.

Visual check: captured in headless Chrome against the live server with a seeded
throwaway profile. Captures show the factory production strip and sparks, the blocked
"!" chip, and five Attack Drones docked around the camp with HUD army `5/10`.

Known gaps: Attack Drones and the camp/factory still use the existing procedural
facility art, not original sci-fi assets; docked units idle on the camp ring
rather than on dedicated pads; no audio cues.

## Phase 3 — first complete raid loop (implemented 2026-10-29)

`Home → Produce → Scout → Reserve → Deploy → Combat → Settle → Home`, against
deterministic bot snapshots. Arena and the older room-scoped raid prototype are
unchanged.

### Architecture

| Concern | Implementation |
|---|---|
| Isolation (§2.3, §9.1) | Each raid is its own `Game` (`session: 'raid'`) built from a pinned `DefenseSnapshot`; it never touches Home entity maps. The connection sees either Home or the raid; the other is silent. Home keeps simulating. |
| Snapshots (§6.1, §6.6) | `server/src/raid/snapshot.ts`: seeded, legal bot bases (one Hub, no overlaps, 1-tile path margin) at the player's level ±1; sha256 checksum over canonical JSON. The record pins the full snapshot, so Home edits never change a scouted base. |
| State machine (§6.2) | `RaidSessionState` + `RAID_TRANSITIONS` in shared constants; `transition()` rejects stale/duplicate moves (client sees `err.raid_stale`). |
| Determinism (§6.3) | The engine has no `Math.random` in simulation. The raid does not tick until the first deploy (tick 0); deploys apply between ticks and are logged with their tick; direct unit commands are dropped. `simulateRaid()` re-runs snapshot + reservation + deploys + surrender tick and must reproduce the live outcome checksum. |
| Troop policy (§6.2) | Reserve moves unit records out of Home into the session (all-or-nothing); each deploy consumes exactly one, logged in the same record; undeployed units return on settle/cancel/expiry. |
| Exactly-once (§6.5, §9.3) | The session, reserved units, rewards, trophies and reports live in the Home save (schema v2, ordered v1→v2 migration), written atomically. Settlement keys are deduplicated; a retried settlement returns the stored report. |
| Interruption | Disconnect → `EXPIRED_DURING_RAID`; restart → `RECOVERY_REQUIRED`. Both finish by deterministic re-simulation of the recorded deploys, then settle once. Unstarted scouts/reservations cancel and return units. An unverifiable snapshot settles as zero destruction (nothing minted). |
| Rewards (§6.5) | System-funded: pinned per-level offer × destruction %, halved with zero stars, clamped to storage. Defenders (bots) lose nothing. Trophies +24×stars/3 or −12. |
| Stars (§6.5) | Independent milestones: ≥50% (walls excluded from %), Hub destroyed, 100%. |
| Targeting (§6.4) | Drones (and other units): nearest structure. Siege Mech: defenses/walls first. |
| Defenses | New `point_turret` (ground only) and `anti_air` (air only) with `DefenseDef.targets`; `watch_tower` hits both. Player-buildable from City Level 3 (Phase 4). |

### Client

Home "Attack" opens a strike panel (trophies, last report, free scout). Raid
view: scout offer with expiry, pinned reward and army draft; reserve; unit cards
plus click-to-place inside a cyan band (coral inner edge = no placement);
surrender/cancel; report with reason, credited reward, trophies and
deployed/returned counts; Return home. Point turret (squat dome, tracking barrel)
and anti-air (tall racks + sweeping radar) have distinct silhouettes; their
shots show muzzle flash → tracer/missile → impact ring. Raid view hides the
meaningless attacker economy HUD.

### Verification

- `scripts/home_phase3_test.ts` (in `npm run test:home`): snapshot legality,
  determinism and tamper detection for levels 1–5; illegal transitions;
  defense target classes; live-vs-replay checksum with interleaved deploys and
  undeployed reserve; the full manager loop (free scout, paid Next, pinned
  snapshot, dropped Home commands, all-or-nothing reserve, duplicate reserve,
  perimeter rejection, unit identity, bounded single credit, replay of the real
  raid, idempotent retry, cancel, 60 s expiry, surrender replay, disconnect
  settlement, reload without re-settlement, crash recovery from a mid-raid
  save); v1→v2 migration.
- Browser walkthrough (headless Chrome, real UI, isolated server and save dir):
  two consecutive full loops; results persisted (2★/92% then 2★/76%,
  trophies 0→16→32, rewards exactly destruction × offer).
- Balance probe (10 drones): L1 easy, L2 ≈2★ with heavy losses (3★ with two
  Siege Mechs), L3 lost.

### Known gaps

- Siege Mech is raid-capable and tested, but players can only manufacture it at
  City Level 3 (Mech Forge), which is Phase 4; the shipped player loop is drone-only.
- Player-published defense snapshots, defender reports and shields are Phase 4;
  only bot snapshots exist.
- Destroyed structures disappear instead of leaving persistent ruins (§8.8);
  no audio cues for the new defenses.
- Replays are re-simulations for verification/recovery; there is no visual
  replay player yet.
- Pre-existing copy names the top unit "IRON MAN Guardian", which conflicts
  with §8.6 (avoid resembling copyrighted heroes); not changed here.

## Phase 4 — progression breadth (implemented 2026-10-30)

Home-only rules; Arena tables (ages, `trains`, techs) are unchanged.

| Spec item | Implementation |
|---|---|
| City Levels 3–5 (§4) | `HOME_CITY_LEVELS`: per-level cost, required buildings at levels, minimum grid supply, technology milestone (L3: Attack Drone research L1). The Hub upgrades through the same physical path as any building; City Level changes only when builders finish. L5 sets the command path. A static test proves every level is reachable from the previous one (it caught a Sensor Tower deadlock). |
| Building levels | `Building.level` + `upgradeTargetLevel/upgradeProgress`. The building keeps working at its old level while builders upgrade it (no capacity dip below stored units). A building may not exceed City Level. Effects: camp +50%/level, factory +15% throughput and +2 queue slots/level, generator +50% supply, depot storage and production, defense HP +25% and damage +20%/level in raids. |
| Development points | Completed buildings only; +50% per level; each extra copy of a type is worth 80% of the previous; walls capped at 50. |
| Unit families (§5) | `HOME_UNIT_UNLOCK` maps every unit to factory, factory level and City Level: Drone Factory (Attack Drone), Mech Forge (Siege Mech), Missile Foundry (Rocket Launcher; L2 Plasma Tank), Hangar (Fighter; L2 Stealth Bomber), Exosuit Lab (Iron Guardian; L2 new Aegis Valkyrie). Camp space per spec table. |
| Raid behaviours (§6.4) | Rocket: defenses first from standoff (+range research). Fighter: anti-air first. Bomber: densest cluster + 50% blast to footprints within 2.5 tiles. Plasma Tank: high-HP structure. Iron Guardian: the defense shooting allies; pulses a −30% damage field (radius/duration +5%/research). Valkyrie: exposed high-value defense; chain arcs to 2 (3 at R3, 4 at R5) nearby structures. All deterministic. |
| Research (§5) | Five levels per unit at the Robotics Workshop, one attribute each (spec examples). One job at a time, paid once, runs under the grid factor (faster with workshop level) and offline. Levels are pinned at reservation and stored in the replay. |
| Power (§3.1, §6.6) | Generator levels; L4/L5 need 30/45 supply without shortage. Published snapshots carry the defender's grid factor; defense damage scales with it, floored at 50%. Sensor Tower: +15% range to defenses within 6 tiles. |
| Player snapshots (§6.1, §6.6) | On every save, a changed defensible layout (completed buildings + levels) publishes a new immutable snapshot to the registry (`server/profiles/snapshots/registry.json`). Scouting picks a player base at City Level ±1, unshielded, trophy tolerance 100 → 300 → any, else a bot. The raid pins its own copy. |
| Defender side + shields | Settlement writes a defender delivery into the attacker's save (same atomic write). The outbox is flushed outside the per-profile locks (no cross-raid deadlock), applied idempotently by raid id to the defender (online in memory, or offline via its save), then removed. Defender reports show the system-funded attacker reward; the defender stockpile is never touched. Shields: 4/8/12 h for 1/2/3 stars; deploying in your own raid breaks it; matchmaking skips shielded cities. |
| Save schema | v3 (`progression`, `raid.outbox`), ordered v1→v2→v3 migrations; a Phase 1 in-flight Hub upgrade is converted. City Level stays the source of truth for the Hub level. |
| Visuals (§8.5) | Upgrade layers per family (roof stacks + annex, docking pads, energy rings, silos, armor collars, Hub rings/pylons/beacon) and level pips; amber gantry + bar while upgrading; Sensor Tower (mast + sweeping dish); procedural Aegis Valkyrie (swept wings, wingtip nodes); Valkyrie chain arcs and bomber blast rings. |
| UI | Factories list their family with lock reasons (city/factory level); Upgrade button with cost, cap or progress; workshop research tiles with level/progress and lock reasons; Hub button lists exactly what is missing; strike panel shows shield and defense log; scout panel says PLAYER CITY vs BOT OUTPOST; report shows reward lost to full storage. |

### Fixes found while building Phase 4

- Home production clamped stock above capacity *down* every tick (e.g. after
  a depot was removed); production now just stops at capacity.
- Area effects measured centre-to-centre could never reach neighbours across
  the 1-tile footprint margin; they now measure to footprint edges.
- Unit names/descriptions referencing a trademarked hero replaced with original
  copy ("Iron Guardian", §8.6).

### Verification

- `scripts/home_phase4_test.ts` (in `npm run test:home`): requirement-table
  reachability; L2→L5 with physical Hub upgrades and readable blockers;
  upgrade payment/duplicate/working-while-upgrading/level-cap; camp capacity;
  diminishing development; research (lock, paid once, completion, offline);
  stock above capacity preserved; factory-level unit gating, queue slots,
  Valkyrie; level HP, grid-factor floor, Guardian field pulse, Sensor range;
  fighter/rocket targeting, Valkyrie arcs, bomber blast; research changes the
  outcome and replays deterministically; matchmaking tolerance/shield/self;
  publish → match → pinned copy → republish; settlement → outbox → online
  delivery, defender economy unchanged, shield in registry, shielded base not
  offered, idempotent and offline delivery, attacking breaks your shield.
- Phases 1–3 suites and 15 regression scripts pass.
- Browser walkthrough (isolated server on 8091, seeded L4 city and a published
  rival): Hub blockers, research panel, upgrading forge, shield/defense log,
  PLAYER CITY scout, six unit families as deploy cards, combat and report.

### Known gaps

- Building art is still the existing procedural/PNG set with added level
  layers; original sci-fi assets per `ART_ASSET_MANIFEST.md` remain open.
- Doctrines (§7) are optional and not implemented.
- Layout mode (move completed buildings, §2.1) is not implemented; snapshots
  republish on build/upgrade/delete only.
- Defense delivery is idempotent against the last 20 reports per defender.
- The registry is a single local JSON file; production needs a database
  behind the same interface.

## Urban planning, whole-map perfect city, map-first boot (2026-10-30)

- **Urban plan** (`shared/src/urban.ts`): a road grid anchored on the Civic Hub
  (2-tile roads every 9 tiles, 7×7 plots) covering the whole Home map. Shared by
  the server (`validFootprint` rejects any footprint touching a road, walls
  included, with `err.on_road`) and the client (placement ghost, ground,
  road markings, minimap), so they cannot disagree. Resources from the Home map
  generator and bot outposts (snapshot v3) keep off roads. Buildings that older
  saves already placed on a road are kept as they are.
- **`/perfectbase` at Home** fills every plot of the map with a zoned,
  max-level city: Hub plot guards, an industry ring, an economy ring, housing,
  then alternating power/food/housing and a defended rim; full research and a
  docked strike wing. Dev commands now reach Home sessions (DEV_PLAYERS only).
  Published defense snapshots crop to plots within 22 tiles of the Hub so raids
  keep a deployment band and stay a 3-minute fight.
- **Performance**: buildings are view-culled; power links are culled, limited to
  24 tiles and drawn without `shadowBlur`. Perfect city (931 buildings): 60 fps,
  p95 16.8 ms in headless Chrome (was 19.6 fps before the fix).
- **Boot**: the landing/name page is removed. The client signs in automatically
  with the saved name or a generated `Commander-XXXX` (suffix retry if taken)
  and opens the player's city; the Arena lobby stays reachable from the ARENA
  badge.
- Tests: `scripts/home_urban_test.ts` (in `npm run test:home`).

## Home-only product, city ledger and ELON settlement (2026-10-30)

- **Home city is the whole game.** The client boots straight into the city; the
  landing, lobby, room, game-over and WATT shell pages are deleted. Raids
  against other cities stay. The server's Arena room code is dormant (Home and
  raids run on the same engine) and no longer reachable from the client.
- **City-only ground.** Home maps have no forests, mines, sheep or water;
  older wilderness saves load as clean city ground (buildings kept).
- **City ledger** (`server/src/home/ledger.ts`, save v4): hash-chained blocks
  with Merkle roots, sealed once a minute, logging builds, upgrades,
  manufacturing, research, raids, defense reports, ELON accrual and
  settlements; retained window of 300 blocks / 600 entries, verified on every
  page view. Defense reports are appended even when the defender is offline.
- **ELON settlement.** Settle moves whole ELON from the playable balance into
  a sealed block, exactly once, then anchors that block's head through the
  existing `MatchCommitmentRegistry` adapter (`BLOCKCHAIN_ENABLED=true` + a
  deployment → Anvil `commitWithLedger`; otherwise local/disabled, shown as
  such). Failed anchors are shown and can be retried without settling twice.
- **Ledger page** (`client/src/screens/ledger.ts`), opened from the city
  badge: verification and chain status, ELON balance/capacity/rate, Settle,
  settlements with anchor status and tx hash, linked blocks, activity log.
- **Units:** fighter jets (fuselage, swept wings with missiles, twin fins,
  canopy, afterburner), armoured flight suits (original design: gunmetal and
  silver, horizontal visor, hexagonal core, palm and boot thrusters), rocket
  trucks (six wheels, angled tube pod); missiles render as finned bodies with
  flame and smoke trails.
- Tests: `scripts/home_ledger_test.ts` (in `npm run test:home`).
