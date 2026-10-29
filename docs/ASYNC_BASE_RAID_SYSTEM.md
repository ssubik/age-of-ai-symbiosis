# Age of AI: persistent base and asynchronous raid system

Status: system design
Target: replace the mandatory shared RTS match with an attack-when-ready loop
Engine: existing authoritative Node/TypeScript server and isometric Canvas client

## 1. Product decision

Age of AI becomes a persistent base-building game with optional asynchronous
raids. A player can open the game alone, improve their city, manufacture an
army, choose **Attack**, scout an eligible opponent snapshot, and launch a
three-minute raid whenever they want. The defender does not need to be online.

This is a structural change, not a visual mode layered on the old match:

- No lobby, ready check, or simultaneous opponent is required for the primary loop.
- A home city persists across sessions and is never simulated as an attacker map.
- A raid runs in its own temporary authoritative simulation.
- A raid attacks an immutable defense snapshot, never the defender's live objects.
- Battle damage disappears after the raid; only bounded loot, rating, shield,
  reports, and replay data persist.

The current live RTS mode can remain temporarily as a separate **Arena** mode,
but it is not the default experience and shares no mutable state with raids.

## 2. Core loop

```text
HOME
  collect production -> place/upgrade facilities -> manufacture army
      ^                                           |
      |                                           v
  defense report <- publish defense snapshot <- ATTACK
      ^                                           |
      |                                           v
  apply bounded result <- isolated raid <- scout / next / confirm army
```

### Home session

1. Load the player's persistent city.
2. Apply offline production up to a capped duration.
3. Let the player collect resources, place or move facilities, start upgrades,
   manufacture troops, and edit the defensive layout.
4. Save every accepted mutation server-side using a monotonic profile revision.
5. Publish a new defense snapshot after meaningful layout or upgrade changes.

### Attack session

1. Player presses **Attack** whenever no other raid is active.
2. Server returns one eligible defense snapshot and a loot offer.
3. Player may scout, skip, or confirm an army before the scout timer expires.
4. Server reserves the army and creates an isolated raid instance.
5. Player deploys units from the outer boundary; units choose targets autonomously.
6. The raid ends at three minutes, total destruction, army elimination, surrender,
   or disconnect timeout.
7. Server commits one idempotent result transaction and releases the raid instance.

## 3. What stays from the current game

- Isometric map, building footprints, renderer, camera, fog presentation, and minimap.
- Food, wood, gold, stone, ELON production, power, facilities, city levels, and
  the Command/Space identity, after balance is adapted to persistence.
- Existing unit definitions, building HP, attacks, range, movement, A* pathfinding,
  autonomous target acquisition, deployment-at-edge rule, and combat effects.
- Current 0/50/100% destruction plus Civic Hub star model, subject to tuning.
- Existing raid event timeline, archive hashing, provenance vocabulary, and replays.
- Server authority: the client sends intents and never computes loot or outcomes.

## 4. What is removed from the primary loop

- Waiting for another player, room ownership, ready state, and host-started matches.
- Starting every session from an empty map with three villagers.
- Victory by permanently deleting another live player's Civic Hub.
- Direct selection and movement of a standing home army across a shared world.
- Reading opponents from `Game.players` in the current room.
- Raids mutating `Game.buildings`, `Game.units`, or defender resources directly.

## 5. Authoritative state model

### Player profile

```ts
interface PlayerProfile {
  id: string;
  revision: number;
  name: string;
  cityLevel: number;
  cityPath?: 'command' | 'space';
  resources: Resources;
  elonBalance: number;
  trophies: number;
  shieldUntil?: number;
  lastSeenAt: number;
  productionCollectedAt: number;
  buildings: PersistentBuilding[];
  upgrades: Record<string, number>;
  army: RaidArmy;
  armyCapacity: number;
  activeTimers: PersistentTimer[];
  publishedDefenseId?: string;
}
```

Persistent records use stable string IDs. They contain definitions and durable
progress, not runtime paths, targets, interpolation fields, or object references.

### Defense snapshot

```ts
interface DefenseSnapshot {
  id: string;
  ownerId: string;
  profileRevision: number;
  publishedAt: number;
  cityLevel: number;
  trophies: number;
  mapSeed: string;
  buildings: DefenseBuilding[];
  defenses: DefenseUnit[];
  lootCapacity: Resources;
  layoutHash: string;
}
```

The snapshot is immutable. Matchmaking pins its ID and hash before showing the
target. Editing a home base publishes a new snapshot; it does not alter a scout
or raid already in progress.

### Raid instance

```ts
interface RaidInstance {
  id: string;
  version: 1;
  attackerId: string;
  defenderId: string;
  defenseSnapshotId: string;
  defenseLayoutHash: string;
  state: 'scouting' | 'deploying' | 'battle' | 'finished' | 'expired';
  reservedArmy: RaidArmy;
  remainingArmy: RaidArmy;
  startedAt?: number;
  expiresAt: number;
  destruction: number;
  stars: number;
  lootOffer: Resources;
  earnedLoot: Resources;
  events: RaidEvent[];
  resultCommittedAt?: number;
}
```

The runtime constructs fresh building and unit entities from the snapshot using
a raid-specific ID namespace. It never inserts them into a home simulation.

## 6. Economy and timers

The current continuous RTS economy must become deterministic wall-clock jobs.

- Resource facilities generate into local storage based on level and elapsed time.
- Storage is capped; offline earnings stop when full.
- Offline production is capped initially at 8 hours to control inflation.
- Building, upgrade, and troop timers store `startedAt` and `endsAt` on the server.
- Opening the game materializes completed jobs once; the client countdown is display only.
- Cancelling a queued troop uses the existing refund policy but is idempotent.
- Builders become concurrent construction slots rather than selected map units.
- Robots/drones can reduce build duration or add slots while preserving the
  human/automation theme; they no longer require live gather/build pathing at home.

Initial loot exposure per resource:

```text
available = max(0, min(storage * 0.20, levelLootCap))
earned    = floor(available * destructionCurve)
```

Use a piecewise curve so 0–49% yields proportionally less, 50% is meaningful,
and 100% does not empty a defender. Never calculate loot from the defender's
current balance after the raid; pin the offer at scout creation.

## 7. Matchmaking and shields

Candidate filters:

- not the attacker;
- published defense exists and passes layout validation;
- city level within `attackerLevel ± 1` initially;
- trophy range expands gradually if the pool is small;
- not attacked by this player in the recent-target window;
- not already reserved beyond the concurrency limit;
- shield policy allows the snapshot to be offered.

Scouting a target creates a 60-second reservation. **Next** consumes a small
scouting fee only after the first free skip. This prevents unlimited perfect
target search without hard-blocking play.

A defense that loses at least one star receives a shield. A player may still
attack while shielded, but starting an attack shortens or breaks the shield.
The exact durations are balance data, never client constants.

If the online population is too small, the server generates deterministic bot
defense snapshots from level templates. Bots go through the same validation,
loot, star, and replay path as player defenses.

## 8. Raid rules

- Scout phase: inspect layout and offered loot; no entities are active.
- Army is reserved atomically when the player confirms attack.
- Deployment is restricted to a validated perimeter mask rather than only a
  numeric three-tile edge. The mask excludes blocked water and invalid terrain.
- Each deployed unit becomes server-owned raid runtime state and is consumed.
- Undeployed reserved troops return only if the player cancels before battle.
- Once the first unit is deployed, all reserved troops are committed.
- Units use role-weighted targeting rather than nearest-building only:
  - siege: defenses, then Civic Hub, then nearest structure;
  - air strike: high-value production/defense targets;
  - tank: nearest reachable structure with threat weighting;
  - guardian: defenses threatening nearby allies.
- Defenses acquire targets using the same deterministic tick and visibility rules.
- One star at 50%, one for the Civic Hub, one at 100%.
- Disconnect keeps the raid running until timeout; reconnect resumes from snapshot.
- Surrender finishes immediately using current destruction and stars.

## 9. Result transaction

Finishing a raid performs one database transaction keyed by `raidId`:

1. Confirm the result has not already been committed.
2. Debit the defender by at most the pinned loot offer and current protected minimum.
3. Credit attacker loot.
4. Consume committed army.
5. Update both trophy ratings.
6. Apply defender shield if eligible.
7. Append attacker and defender reports.
8. Store compact replay events and final state hash.
9. Mark `resultCommittedAt`.

Retries return the existing result. They never pay loot twice.

Destroyed snapshot buildings are restored automatically because home state was
never damaged. The defense report shows cosmetic destruction and loot lost.

## 10. Screen flow

```text
BOOT -> HOME
HOME -> BUILD / UPGRADE / ARMY / REPORTS
HOME -> ATTACK_SEARCH -> SCOUT -> RAID -> RESULT -> HOME
HOME -> DEFENSE_EDIT -> VALIDATE -> PUBLISH -> HOME
```

### Home HUD

- Top: resources, storage capacity, city level, trophies, builders, shield.
- Bottom dock: Home, Build, Army, Attack, Reports.
- Context panel: selected facility, upgrade, production, move, or information.
- No enemy selection, box-select, control groups, or live attack commands at home.

### Scout screen

- Defender identity, level, trophies, loot offer, scout countdown.
- Army summary and edit action.
- **Attack** and **Next** as the two dominant actions.
- The battlefield stays fully readable; side panels collapse on narrow screens.

### Raid screen

- Remaining troops along the bottom.
- Stars, destruction, and timer at the top.
- Surrender and settings remain available but visually secondary.
- Clicking a troop then a valid perimeter location deploys it.
- Home construction/production controls are absent during the raid.

### Reports

- Separate Attack and Defense tabs.
- Stars, destruction, loot, trophies, time, opponent, replay availability.
- Defense report never implies that visible ruins persist at home.

## 11. Security and validation

- Authenticate profile ownership independently from transient WebSocket IDs.
- Validate every home mutation against the latest profile revision.
- Reject overlapping/out-of-bounds buildings and unreachable mandatory layouts.
- Pin definition version, snapshot ID, layout hash, and loot offer in every raid.
- Rate-limit search, publish, deploy, surrender, and replay endpoints.
- Use server time for timers and raid duration.
- Never accept client-provided stars, destruction, loot, troop inventory, or trophies.
- Archive the intent stream and deterministic result hash for dispute/debug replay.

## 12. Mapping onto the current repository

### Reuse

- `shared/src/constants.ts`: unit/building definitions and combat values.
- `server/src/game/state.ts`: runtime entities and pathing helpers.
- `server/src/game/room.ts`: extract combat/tick operations into a reusable
  `RaidSimulation`; do not make persistent profiles another `Game` room.
- `client/src/game/renderer.ts`: render home, scout, and raid world models.
- `client/src/game/camera.ts`, `minimap.ts`, combat effects, sprites, and audio.
- Existing `RaidArmy`, `RaidEvent`, star/destruction logic, and replay timeline.

### Replace

- Numeric room-scoped player IDs in durable data with authenticated string profile IDs.
- `cmdScoutRaid(defenderId)` with server matchmaking; the client must not choose
  arbitrary live room players.
- `ActiveRaid.initialBuildings` referencing live building IDs with a cloned,
  immutable defense runtime.
- Direct defender resource mutation with the idempotent result transaction.
- Raid UI embedded in the home/RTS frame with dedicated scout, raid, result,
  and report screen states.

### New server modules

```text
server/src/profile/        profile repository, migrations, offline production
server/src/defense/        layout validation, snapshot publish/load
server/src/matchmaking/    candidate selection, reservation, shields
server/src/raid/           isolated simulation, result transaction, replay
shared/src/home-types.ts   persistent DTOs and commands
shared/src/raid-types.ts   snapshot, instance, reports, versioned messages
```

Start with a filesystem repository using atomic temporary-file + rename writes,
then place it behind a `ProfileRepository` interface so production can move to a
transactional database without changing gameplay services.

## 13. Migration plan

### Phase 0: lock invariants

- Keep the existing RTS smoke suite as Arena compatibility coverage.
- Add characterization tests for combat, target selection, stars, loot, unit
  consumption, map validation, and replay determinism.

### Phase 1: persistent solo home

- Add authenticated profile identity and versioned profile storage.
- Convert build, move, upgrade, collect, train, and cancel into home commands.
- Load directly into Home; no room required.
- Publish a defense snapshot from the current base.

Exit gate: restart server/client and recover the exact base, resources, jobs,
army, and published layout without duplication.

### Phase 2: isolated bot raids

- Extract `RaidSimulation` from `Game`.
- Raid deterministic bot snapshots from Home.
- Implement reservation, deployment mask, star scoring, result, and reports.

Exit gate: the home base and bot template remain byte-identical after raids;
replaying the same intents produces the same result hash.

### Phase 3: asynchronous player defenses

- Add matchmaking, immutable player defense snapshots, shields, trophy changes,
  concurrency limits, attack/defense logs, and idempotent settlement.

Exit gate: attacker and defender can be offline at different times; concurrent
raids cannot duplicate loot or mutate the published snapshot.

### Phase 4: UX replacement

- Replace room/lobby as the default flow with Home, Army, Attack, Reports.
- Split the current raid panel into dedicated scout and raid interfaces.
- Retain Arena behind an explicit secondary navigation item if desired.

### Phase 5: balance and operations

- Tune production, capacity, build timers, loot caps, trophies, shields, and
  matchmaking using telemetry.
- Add migration rollback, profile repair tools, and suspicious-result audits.

## 14. Minimum viable release

The first shippable version should include persistent home building, offline
resource production, troop manufacturing, bot snapshot matchmaking, isolated
three-minute raids, three-star results, bounded loot, reports, and replay events.

Player-vs-player matchmaking should ship only after idempotent settlement,
snapshot isolation, shield rules, and concurrent-raid tests pass. Persistence
and result integrity are the foundation of this format, not post-launch polish.
