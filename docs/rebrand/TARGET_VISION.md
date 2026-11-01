# Age of AI Symbiosis — Target Vision

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

Migration is explicit and lossless (Home save v5): `Energy = food`,
`Alloys = wood + stone`, `Compute = gold`.

### The five layers

Ages follow the five layers of the AI industry — energy, compute, AI
factories, models, applications. Each depends on the one below, in the rules
and in the simulation:

| Age | Layer | To advance, build | Dependency in play |
|---|---|---|---|
| I | Energy Grid | Solar Field / Wind Turbine | Generators yield Energy and grid power |
| II | Compute Layer | Compute Node | Nodes draw power; output falls with the grid |
| III | AI Factories | Autonomous Systems Lab / Drone Factory / Mech Forge | Factories consume Compute for advanced units |
| IV | Model Layer | Model Lab | Trains Designers; required for Applications |
| V | Applications | — | Command Metropolis or Space Gateway |

Raiding the enemy's generators starves its compute, which slows its factories:
economic targets have military consequences.

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

- **Manual:** only explicit strategic orders execute. (Default in ordinary rooms.)
- **Assisted:** explicit orders execute; the commander also carries out
  *low-risk* objectives itself (defend a sector under attack, protect the core,
  retreat a failing army, put idle workers to work) and logs everything else —
  assaults, expansion, production spending — as a recommendation the player can
  **Authorize** with one click.
- **Autonomous:** the commander chooses objectives and production within the
  player's policy.

Policy sliders bound commander authority: **risk** (minimum assault advantage,
1.5× at 0 down to 0.5× at 1 — a hard gate, not a weight), **offense** (shifts
attack vs. defense utility) and **spending** (share of the stockpile the
commander may spend per 3-second production cycle). Choosing a personality
resets the sliders to that personality's defaults.

Player orders always override commander initiative. Units the player orders
directly are left alone by commander initiative for 30 seconds. The commander
evaluates once per second and takes new initiative every 5 seconds; it switches
objectives only when a candidate beats the current one by a fixed margin.
Every objective has a lifecycle — *in progress → completed / failed / superseded*
— evaluated authoritatively by the server, with a 150-second timeout.

### Strategic orders

Defend sector, protect Command Core, attack target, capture resource zone,
worker priority, prepare assault, and retreat/regroup. Tactical pathfinding and
attacks remain ordinary server commands; the commander produces intents, not
privileged state.

Assault decisions use an **assault ratio**: own army power against the enemy
army *plus* the defenses around its core (defensive structures with their
potential garrison arrows, and armed workers). The open-field ratio drives
retreat and expansion only. Without this, an early version walked 52 units into
a garrisoned core and destroyed nothing — the battle report exposed it.

### Defense and economy behavior

- A worker hit anywhere, or any unit hit inside the base, is an attack. The
  commander reacts at the next one-second cycle.
- If its army cannot match the threat (1.2× power), workers near the core or the
  attack shelter in the Command Core and towers (each occupant adds an arrow)
  and are released when the objective ends — completed, failed or superseded.
- Gathering follows the doctrine: the resource blocking the next planned
  structure or age becomes the worker priority; otherwise the scarcest stockpile
  weighted by demand (food 1, wood 0.7, gold 0.6, stone 0.25). Surplus workers
  are rebalanced at most once a minute.

### Transparency record

Every meaningful decision records commander, objective, source (player or
commander), observation, action, reason, expected outcome, lifecycle outcome,
actual result and tick. The right panel shows the latest concise entries; the
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
