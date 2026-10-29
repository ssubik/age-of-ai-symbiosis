# Age of AI: Robot Base and Raid Gameplay Specification

Status: proposed product and technical specification

Scope: persistent base progression, robot-led construction, army manufacturing,
and attack-on-demand raids

Engine: existing authoritative Node/TypeScript server and isometric Canvas client

This document is the normative gameplay specification for changing Age of AI
from a match-first RTS into a persistent base-and-raid game without changing its
visual identity or the physical feeling of building a city. It refines the
system architecture in `ASYNC_BASE_RAID_SYSTEM.md`.

## 1. Product statement

The player owns one persistent futuristic city. They gather and store resources,
place buildings on the existing isometric map, and assign construction robots and
drones to physically build them. Every meaningful building and upgrade strengthens
the city and unlocks the next city level. Higher city levels unlock factories that
manufacture stronger attack units: drones, siege machines, fighter aircraft,
bombers, plasma armor, and rare powered exosuits.

When ready, the player presses **Attack**, scouts a saved copy of another base,
chooses an army, and starts a short raid. The opponent does not need to be online.
Troops are deployed from the map boundary and fight autonomously. The player wins
resources and rating, returns home, and uses the rewards to keep building.

```text
BUILD BASE -> ROBOTS CONSTRUCT -> CITY LEVEL INCREASES
     ^                                  |
     |                                  v
SPEND RAID REWARDS <- ATTACK ON DEMAND <- MANUFACTURE BETTER ARMY
```

## 2. Non-negotiable feel contract

The persistent redesign must preserve these parts of the current game:

1. **The city is a world, not a menu.** Home opens directly onto the existing
   isometric Canvas map with its camera, terrain, water, structures, animation,
   lighting, minimap, and ambient activity.
2. **The player places buildings.** A building is positioned on the terrain using
   the current footprint preview, collision validation, and placement interaction.
3. **Robots really build.** Placement creates a construction site. Builder Robots,
   Construction Drones, cranes, and material rovers travel to it and perform visible
   work. Progress must correspond to server-authoritative construction progress.
4. **Construction has physical presence.** Foundations, scaffolding, arriving
   materials, robot work cycles, sparks, dust, and completion effects communicate
   progress without replacing it with a dashboard timer.
5. **The player can inspect and direct builders.** Existing selection, right-click
   assignment, camera movement, and construction feedback remain. Automation may
   help, but it cannot make builders decorative.
6. **Resources remain spatially understandable.** Producers, storage facilities,
   power infrastructure, factories, camps, and defenses are visible buildings in
   the city.
7. **Combat keeps the current presentation.** Raids use the same isometric renderer,
   movement, projectiles, destruction effects, health feedback, camera, and sound.
8. **No mandatory live opponent.** Multiplayer rooms, ready checks, and simultaneous
   starts are not required for the primary progression loop. The current live mode
   may remain as a separate Arena.

Any implementation that turns construction into only a button plus countdown,
hides builders, or replaces the map with management panels violates this contract.

## 3. Naming and original IP

“Iron Man” and related Marvel character names should be treated as inspiration,
not shipping names or copied character designs. Age of AI should own its fiction,
silhouette, colors, animation, and terminology.

Recommended original unit family:

| Design role | Working game name | Fantasy |
|---|---|---|
| Heavy male-frame powered suit | **Iron Guardian** | Flying armored protector and defense breaker |
| Fast female-frame powered suit | **Aegis Valkyrie** | Agile air striker that chains between priority targets |
| Mass-produced light air unit | **Attack Drone** | Cheap swarm pressure |
| Heavy aircraft | **Autonomous Fighter** | Fast anti-defense strike aircraft |
| Area-damage aircraft | **Stealth Bomber** | Slow attack cycle with high burst damage |

The final names can change, but all production art and writing must remain original.

## 4. Core player loop

### 4.1 Home loop

1. Enter the persistent home city.
2. Collect resources from visible production and storage buildings.
3. Select a human designer, Builder Robot, or Construction Drone.
4. Choose and place a building or upgrade an existing building.
5. Builders travel to the site and visibly construct it.
6. Completion adds city development points and may unlock the next facility.
7. Manufacture attack units and keep them in visible Army Camps or hangars.
8. Edit defenses and publish the updated defensive snapshot.

### 4.2 Attack loop

1. Press **Attack** at any time when no raid is active.
2. Scout an eligible opponent snapshot and inspect available loot.
3. Choose units from the manufactured army; capacity is limited by Army Camps.
4. Confirm the army. The server atomically reserves those units.
5. Deploy units from valid perimeter tiles during a three-minute raid.
6. Units navigate and choose targets autonomously according to their roles.
7. Earn zero to three stars, bounded loot, trophies, and a replay/report.
8. Return home immediately and reinvest the rewards.

## 5. Persistent home simulation

### 5.1 Home modes

The map has three explicit interaction modes:

- **Build:** select builders, place structures, assign or reassign construction.
- **Layout:** move completed buildings and defenses without changing progression;
  moving is free but republishes the defense snapshot after confirmation.
- **Inspect:** select production, storage, factory, camp, power, or defense buildings
  to view their status and available actions.

The default is Inspect. Existing selection and contextual right-click behavior
remain valid in Build mode.

### 5.2 Builder roles

| Builder | Role | Rule |
|---|---|---|
| Human Designer | Planning and early construction | Required for the first Robotics Workshop; normal build speed |
| Builder Robot | Main ground constructor | 1.8x work rate; must path to the site |
| Construction Drone | Mobile support constructor | 1.25x work rate; crosses terrain and water |
| Material Rover | Logistics animation/support | Delivers staged materials; grants a small site bonus |
| Autonomous Crane | Large-building support | Appears at factories and major upgrades; not directly controlled |

Multiple builders may collaborate, with diminishing returns:

```text
effectiveRate = fastestBuilderRate + 0.60 * sum(otherBuilderRates)
```

Builder travel time is real. Construction duration begins when the first assigned
builder reaches the site. If all builders leave, the site pauses rather than
finishing invisibly.

### 5.3 Offline construction

Persistence must not erase the physical construction fantasy:

- A site stores its accumulated work, assigned builder IDs, and `lastUpdatedAt`.
- On reconnect, the server applies capped offline work only from builders that were
  assigned and able to reach the site when the session ended.
- Offline work is capped initially at 8 hours.
- A reconnecting player sees a short reconstruction montage: robots at the site,
  progress catching up, then the completion effect if the job finished offline.
- No construction completes from a menu-only timer without a valid site and builder.

### 5.4 Resource production

Food, wood, gold, and stone remain the core resources. ELON and grid power remain
the automation/provenance layer rather than ordinary spendable loot.

- Producers accumulate into visible local storage.
- Collecting transfers local production to the player's available stockpile.
- Storage capacity is determined by completed storage buildings and their levels.
- Offline production is capped at 8 hours and stops when storage is full.
- Grid shortages slow automated production, factories, and robotic construction,
  with a floor of 30% speed.
- Human Designers are not slowed by grid shortage.

## 6. City progression

### 6.1 Progression rule

City level is anchored to the **Civic Operations Hub** level. A Hub upgrade is
available only when the city has enough completed development and the required
infrastructure. The player must place the Hub upgrade as a visible construction
project, and robots must build it like every other major structure.

```text
developmentPoints = sum(buildingDevelopmentValue(type, level))
Hub upgrade available when:
  current requirements complete
  AND developmentPoints >= level threshold
  AND required resources are available
```

Duplicate low-value structures have diminishing development value, preventing a
player from reaching the next level by spamming cheap walls or residences.

### 6.2 Initial level ladder

| Level | City identity | Required completed infrastructure | New military capability |
|---:|---|---|---|
| 1 | Settlement | Civic Hub, Residence, Food Technology Center, Materials Depot | Army Camp, Builder Robot, basic scouts |
| 2 | Smart District | Robotics Workshop, storage, stable positive grid | Drone Factory, Attack Drone |
| 3 | Technology City | Two upgraded producers, Army Camp level 2, Sensor Tower | Mech Forge, Siege Mech, Rocket Launcher |
| 4 | Symbiotic City | Aerospace power requirement, upgraded storage and defenses | Aerospace Hangar, Autonomous Fighter, Stealth Bomber, Plasma Tank |
| 5 | Specialized City | Command specialization, Factory level 4, Army Camp level 4 | Exosuit Lab, Iron Guardian, Aegis Valkyrie |

The exact resource prices and durations live in shared balance data. Requirements
must be visible before the player commits resources.

### 6.3 Development values

Initial target values:

| Building category | Base development points | Duplicate multiplier |
|---|---:|---:|
| Civic/infrastructure | 100 | 100%, 50%, 25% after second |
| Production/storage | 50 | 100%, 70%, 40% after third |
| Factory/camp | 80 | 100%, 60%, 30% after second |
| Defense | 35 | 100%, 75%, 50% after fourth |
| Wall segment | 2 | Maximum 50 points per city level |

Upgrading a building adds its next-level value; it does not award the base value
again. Destroyed or unfinished buildings do not count.

## 7. Army manufacturing

### 7.1 COC-style production, Age of AI presentation

Attack units are manufactured ahead of time, stored persistently, and consumed
when deployed in a raid. They do not spawn for free at raid start.

Factories are physical buildings:

- selecting a factory opens its production queue;
- starting a unit atomically spends resources and creates a queued job;
- factory doors, assembly arms, weld effects, and support robots animate while busy;
- completed units travel to a compatible Army Camp or hangar pad;
- if capacity is full, the finished unit waits inside the factory and blocks the
  next queue item;
- cancelling a queued but unstarted unit refunds 100%; cancelling active production
  refunds 50%; a completed unit cannot be refunded.

### 7.2 Factory and unit ladder

| Facility | Level | Unit | Capacity | Battlefield role |
|---|---:|---|---:|---|
| Drone Factory | 1 | Attack Drone | 1 | Cheap air swarm; attacks nearest target |
| Mech Forge | 1 | Siege Mech | 4 | Prefers walls and defenses |
| Missile Foundry | 1 | Rocket Launcher | 3 | Long-range defense suppression |
| Aerospace Hangar | 1 | Autonomous Fighter | 3 | Fast priority strike against defenses |
| Aerospace Hangar | 2 | Stealth Bomber | 5 | High burst and area damage |
| Missile Foundry | 2 | Plasma Tank | 5 | Slow, durable ground assault |
| Exosuit Lab | 1 | Iron Guardian | 8 | Rare flying tank; protects nearby allies |
| Exosuit Lab | 2 | Aegis Valkyrie | 7 | Fast flying striker; chains between priority targets |

`Capacity` is the number of Army Camp spaces used, not population in the old live
match. Factory level improves queue slots and manufacturing speed, not unit stats.
Unit upgrades live in a separate Research Lab so production upgrades never create
ambiguous balance changes.

### 7.3 Army Camps

- Army Camp capacity is shared across all factories.
- Camp upgrades increase capacity and visibly expand pads, racks, or hangars.
- Manufactured ground units idle at camp pads; aircraft circle, dock, or appear in
  hangars according to performance limits.
- Selecting a camp shows the complete stored army and a **Compose Attack Army** action.
- Defensive units are separate from the attack army and cannot be consumed by raids.

### 7.4 Research

Each attack unit has five research levels. Research improves a defined subset of
HP, damage, or role ability and must never increase all stats at once.

Example:

| Research | Effect per level |
|---|---|
| Attack Drone Swarm Logic | +5% damage |
| Fighter Targeting Suite | +4% damage to defenses |
| Siege Mech Armor | +6% HP |
| Guardian Projector | +5% ally-protection radius/duration |
| Valkyrie Arc Core | +1 chain target at levels 3 and 5 |

## 8. Raid gameplay

### 8.1 Matchmaking and scouting

- Match by City Level within +/-1, then expand trophy range gradually.
- Match against immutable defense snapshots, never a live home simulation.
- Show defender name, City Level, trophies, available loot, and layout.
- First scout is free. Each **Next** after the first has a small gold cost.
- A scout offer expires after 60 seconds.
- Deterministic bot bases fill empty matchmaking pools and obey the same rules.

### 8.2 Army reservation

Before battle, the player selects a subset of stored units up to raid capacity.
Confirmation reserves the army atomically. Before the first deployment the player
may cancel and recover it. After the first unit is deployed, every reserved unit is
committed; undeployed units are not returned.

### 8.3 Deployment and control

- Valid perimeter tiles are highlighted on the existing isometric terrain.
- The player selects a unit card, then clicks or taps a valid perimeter tile.
- Units spawn with the current deployment animation and immediately run their AI.
- The player controls composition, timing, and entry position, not individual unit
  movement after deployment.
- Camera pan/zoom, minimap, health bars, projectiles, destruction, and hit effects
  keep the current game feel.
- Optional tactical abilities may be added later, but direct RTS micro is not part
  of the initial raid loop.

### 8.4 Unit target roles

| Unit | First preference | Secondary behavior |
|---|---|---|
| Attack Drone | Nearest reachable building | Swarms targets already attacked by drones |
| Siege Mech | Walls and defenses | Opens routes for ground allies |
| Rocket Launcher | Active defenses in range | Maintains minimum distance |
| Autonomous Fighter | Air-threatening defenses | High-speed strike pass |
| Stealth Bomber | Dense building clusters | Area damage with long attack cooldown |
| Plasma Tank | Nearest high-HP structure | Absorbs fire for ranged allies |
| Iron Guardian | Defense threatening nearby allies | Projects temporary ally damage reduction |
| Aegis Valkyrie | Highest-value exposed defense | Chains damage to nearby targets |

Target choice must be deterministic on the authoritative server so replays can be
reconstructed from the same deployment events.

### 8.5 Victory and rewards

- Star 1: reach 50% destruction.
- Star 2: destroy the Civic Operations Hub.
- Star 3: reach 100% destruction.
- Raid ends at 180 seconds, total destruction, army elimination, or surrender.
- Loot is pinned when scouting and scales with destruction; it never drains the
  defender's current resource record during settlement.
- A result transaction atomically writes consumed army, earned loot, trophy delta,
  defense report, shield, and replay reference exactly once.

## 9. Defense and base layout

- Every completed layout change publishes a new immutable defense snapshot.
- Existing scouts and active raids retain the older snapshot they selected.
- Defenses use the current attack range, targeting, projectile, power, and upgrade
  systems adapted to persistent levels.
- A grid outage weakens automated defenses but never disables the whole base.
- Damage during raids is temporary. Home buildings are not left destroyed.
- A defense losing at least one star receives a shield. Starting an attack shortens
  or breaks that shield according to shared balance data.
- The defense report shows attacker, stars, destruction, loot lost, trophies, and
  replay availability.

## 10. Player experience and interface

### 10.1 Home HUD

Keep the battlefield full-screen. Add only edge-mounted controls:

- top: resources, storage caps, grid supply/draw, city level, trophies;
- left: selected builder/building/factory information;
- bottom: context actions and build palette;
- right: **Attack**, army capacity, active factory jobs, builder availability;
- corner: minimap, reports, settings.

Management panels overlay the map and close back to the same camera position.
They must not replace Home with a page-based dashboard.

### 10.2 Required feedback

- Buildings locked by level show the exact prerequisite, not only a lock icon.
- Selecting a construction site shows assigned builders, work rate, and projected
  completion time.
- Factory queues show cost, duration, capacity use, and blocking reason.
- City-level progress shows completed requirements and development points.
- Raid deployment clearly distinguishes available, reserved, deployed, and consumed
  units.
- Every server rejection produces a specific, localized message.

## 11. Authoritative data model

Persistent records contain plain versioned data and stable string IDs, never live
entity references, paths, interpolation state, or Canvas objects.

```ts
interface PlayerProfileV1 {
  version: 1;
  id: string;
  revision: number;
  name: string;
  cityLevel: 1 | 2 | 3 | 4 | 5;
  cityPath?: 'command' | 'space';
  developmentPoints: number;
  resources: Resources;
  storageCaps: Resources;
  trophies: number;
  shieldUntil?: number;
  grid: { stored: number; capacity: number };
  buildings: PersistentBuilding[];
  constructionSites: ConstructionSite[];
  builders: PersistentBuilder[];
  army: Partial<Record<AttackUnitType, number>>;
  factoryQueues: FactoryQueue[];
  research: Record<string, number>;
  reports: RaidReport[];
  productionCollectedAt: number;
  lastSeenAt: number;
}

interface ConstructionSite {
  id: string;
  buildingType: BuildingType;
  targetLevel: number;
  tileX: number;
  tileY: number;
  workRequired: number;
  workCompleted: number;
  assignedBuilderIds: string[];
  lastUpdatedAt: number;
}

interface FactoryJob {
  id: string;
  unitType: AttackUnitType;
  state: 'queued' | 'manufacturing' | 'blocked_capacity' | 'complete';
  startedAt?: number;
  workRequired: number;
  workCompleted: number;
}
```

### Persistence requirements

- Server is authoritative for resources, jobs, progression, armies, and raid results.
- Every profile has a schema version and monotonic revision.
- Mutations for one profile execute serially.
- Save by writing a temporary file/database transaction, then atomically replacing
  the durable record; keep the last known-good backup.
- Load defensively, validate ranges and stable IDs, then apply ordered migrations.
- Autosave after accepted mutations and at safe simulation boundaries, throttled to
  avoid a disk write every frame.
- Active raids are separate durable records so a server restart cannot lose a
  reserved army or pay a result twice.

## 12. Integration with the current project

Reuse these verified systems rather than creating a parallel game:

| Existing system | New responsibility |
|---|---|
| `shared/src/types.ts` | Add versioned persistent DTOs and the Aegis Valkyrie unit type |
| `shared/src/constants.ts` | Store city requirements, development values, capacity, costs, work, and research balance |
| `server/src/game/room.ts` | Extract reusable construction/combat rules; keep live Arena behavior isolated |
| `server/src/game/state.ts` | Runtime entities for Home and isolated raid sessions only |
| `server/src/game/ai.ts` | Role-weighted deterministic raid targeting and builder automation |
| `client/src/game/renderer.ts` | Continue rendering Home, construction, camps, factories, units, and raids |
| `client/src/game/input.ts` | Preserve selection/placement; add perimeter deployment mode |
| `client/src/game/hud.ts` | Add level progress, factory queues, camp capacity, and Attack entry |
| `client/src/game/sprites.ts` | Original powered-suit and factory animation assets |

The persistent Home session and isolated Raid session should share renderer and
simulation primitives but must not share mutable runtime entity collections.

## 13. Delivery plan

### Phase 1: Persistent construction vertical slice

- One persistent home profile and map.
- Existing building placement and collision rules.
- Human Designer, Builder Robot, and Construction Drone visibly build.
- Civic Hub levels 1-2 with development requirements.
- Atomic save/load and capped offline work.

Exit criterion: place a Drone Factory, watch robots build it, quit, relaunch, and
recover the exact site/building/resources without duplication.

### Phase 2: Manufacturing and camps

- Army Camp capacity.
- Drone Factory production queue.
- Attack Drones physically move to camp.
- Queue persistence, cancellation, blocking, and offline progress.

Exit criterion: manufacture a persistent army across a restart with correct costs
and capacity.

### Phase 3: Asynchronous raid loop

- Bot defense snapshots and matchmaking interface.
- Scout, army reservation, perimeter deployment, autonomous combat.
- Stars, bounded loot, trophies, report, replay, idempotent settlement.

Exit criterion: Home -> manufacture -> scout -> raid -> result -> Home works without
another online player and cannot duplicate loot.

### Phase 4: Full five-level ladder

- Mechs, rockets, fighters, bombers, plasma armor.
- Exosuit Lab, Iron Guardian, and Aegis Valkyrie.
- Research, defense snapshots, shields, player matchmaking.

### Phase 5: Balance and polish

- Economy telemetry and progression tuning.
- Construction and factory animation families.
- Raid AI tuning, accessibility, responsive HUD, localization, audio, and effects.

## 14. Acceptance criteria

The feature is complete only when all of the following are true:

1. A new player can reach City Level 2 by physically placing buildings and watching
   assigned robots construct them.
2. City Level cannot increase from cheap-building spam, unfinished sites, or a client
   command that bypasses prerequisites.
3. Every military unit comes from a completed compatible factory and consumes stored
   resources plus Army Camp capacity.
4. At least Attack Drone, Siege Mech, Autonomous Fighter, Iron Guardian, and Aegis
   Valkyrie have distinct target roles and readable silhouettes.
5. The player can attack without a live opponent or room/ready flow.
6. A raid never mutates the defender's live home objects or leaves the home destroyed.
7. A disconnect or server restart cannot duplicate resources, troops, trophies, or a
   raid result.
8. Existing camera, building placement, robot construction, isometric rendering, and
   combat feedback remain recognizably Age of AI.
9. Home progression survives a full process restart and an older save can migrate to
   the current schema.
10. The current Arena mode still passes its existing regression tests while it remains
    in the product.

## 15. Explicit non-goals for the first release

- Direct control of deployed raid units after placement.
- Real-time attacks against a defender currently playing their Home session.
- Permanent destruction or repair costs caused by incoming raids.
- Clan wars, donations, spells, heroes, cosmetics, battle passes, or monetization.
- Copying Clash of Clans UI, art, names, maps, characters, or exact balance.
- Shipping copyrighted superhero names or recognizable Marvel character designs.

The first release proves one promise: **the player builds a living robotic city,
that city unlocks increasingly spectacular machines, and those machines can attack
another base whenever the player chooses.**
