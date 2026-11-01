# Age of AI Symbiosis — Target Design

**Tagline:** Build. Command. Evolve.

## Player fantasy

The player is the strategic intelligence of a machine civilization. They place
infrastructure, allocate the economy and define objectives. Individual machines
remain visible and tactically controllable, but an AI commander can execute the
player's intent at the chosen autonomy level.

## Match shape

- Target duration: 10–15 minutes.
- Opening (0–3 min): establish Energy, Alloys and Compute; scout resource zones.
- Expansion (3–7 min): choose production/defense emphasis and contest territory.
- Conflict (7–12 min): commander-led pressure, counterattacks and siege windows.
- Resolution (12–15 min): Command Core destruction or decisive surrender.

## Three-resource economy

| Resource | Strategic purpose | Producers | Pressure |
|---|---|---|---|
| Energy | Operating budget for infrastructure, shields and advanced units | Generator fields, grid upgrades | Flow capacity and short-term reserve |
| Alloys | Buildings, armor and conventional production | Alloy Extractors, salvage | Map control and logistics |
| Compute | Research, autonomy and sophisticated weapons | Compute Nodes, captured data zones | Tech timing and commander capability |

Migration must be explicit and lossless. Legacy values map once as:
`Energy = food`, `Alloys = wood + stone`, `Compute = gold`. Legacy saves retain
their source values until the new schema is committed; no silent partial mapping.

## Core building family

1. **Command Core** — victory-critical landmark, production drop-off and commander uplink.
2. **Energy Generator** — animated turbines/cells; produces grid supply and Energy reserve.
3. **Alloy Extractor** — deploys on mineral zones; articulated drill and cargo output.
4. **Compute Node** — server-stack silhouette; research and autonomy upgrades.
5. **Unit Factory** — modular bays determine light/mech/siege production.
6. **Defense Turret** — energy weapon with visible traverse, charge and impact.

Existing buildings remain as advanced variants instead of being discarded.

## Core combat roles

| Unit | Readable silhouette | Role | Strength | Weakness |
|---|---|---|---|---|
| Scout Drone | Small triangular flyer, cyan sensor eye | Recon/harassment | Speed, vision, ignores terrain | Fragile, weak vs anti-air |
| Assault Mech | Broad biped with one cannon arm | Main-line combat | Flexible damage and durability | Kited by fast units, mediocre vs structures |
| Siege Walker | Tall four-legged artillery platform | Anti-structure | Range and structure damage | Slow, minimum-range vulnerability |

The current expanded roster becomes higher-tier specializations of these three
families. Team color is concentrated on sensor strips and armor panels; weapon
color communicates damage type, never ownership.

## Commander system

### Personalities

- **Vanguard:** pressure, expansion denial and offensive mass.
- **Sentinel:** threat response, chokepoints and infrastructure protection.
- **Architect:** production efficiency, resource control and technology timing.

### Autonomy

- **Manual:** only explicit strategic orders execute.
- **Assisted:** explicit orders execute; the commander offers logged suggestions.
- **Autonomous:** the commander may choose objectives when no player order is active.

Player orders always override autonomous choices. The commander decides at a
fixed server interval, not per render frame. Utility scores are normalized,
deterministic and use hysteresis/cooldowns to prevent objective thrashing.

### Strategic orders

Defend area, attack target, capture resource zone, prioritize production,
prepare offensive, and retreat/regroup. Tactical pathfinding and attacks remain
ordinary server commands; the commander produces intents, not privileged state.

### Transparency record

Every meaningful decision records commander, objective, observation, action,
reason, outcome and tick. The right panel shows the latest concise entries; the
full event stream feeds the post-match report and future replay tooling.

### Optional conversation adapter

A future LLM-backed interface may translate player language into a validated
`StrategicObjective` or explain an already-recorded decision. It must sit outside
the authoritative simulation, carry a timeout/fallback, and never directly move
units, spend resources, alter utility scores or block a server tick. The
deterministic commander remains the only runtime decision authority.

## Interface

- Top: three resources, grid/population, match timer and alerts.
- Left: selected entity, construction/production and stats.
- Right: commander portrait/name, autonomy, active objective and decisions.
- Bottom: direct tactical and contextual strategic orders.
- Battlefield remains dominant at all supported aspect ratios.

## Visual system

- Materials: graphite armor, brushed alloy, ceramic white, emissive cyan;
  amber for construction/warning and coral for hostile damage.
- Shape hierarchy: Command Core = stepped fortress; economy = horizontal
  machinery; factories = large doors; defenses = tall rotating silhouettes.
- Feedback tiers: muzzle flash/trail/impact for every shot; short damage flash;
  debris and restrained shake for destruction; reduced-motion setting respected.
- Original/project-owned assets only. Existing PNGs remain until a hero family
  is approved at actual gameplay scale.

## Map families

1. **Foundry Basin:** open center, side mineral arcs, two defensible expansions.
2. **Data Divide:** central Compute ridge with alternate flanking routes.
3. **Gridfall:** damaged urban grid; Energy nodes form risky forward positions.

Every map guarantees reachable starting economy, two expansion choices, readable
attack lanes and enough build space for the largest factory footprint.
