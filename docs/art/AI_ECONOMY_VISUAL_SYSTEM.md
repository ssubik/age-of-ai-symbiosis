# Age of AI — Machine Civilization Visual System

Status: approved concept direction; runtime conversion remains a controlled
asset-production step. The four source boards live in `client/public/art/`.

## Core visual promise

The city must explain itself through physical activity. AI is visible as cyan
control, power and data flow. The economy is visible as extraction, cargo,
fabrication and storage. Blockchain is visible only as amber civic verification
hardware attached to the city ledger. It never becomes coins, trading screens or
combat magic.

The visual formula is:

> Graphite machine mass + ceramic service panels + cyan intelligence + amber proof.

## Technical contract

| Axis | Contract |
|---|---|
| Camera | Existing 2:1 dimetric three-quarter view; upper-left faces receive the key light |
| Runtime | Canvas 2D, depth sorted; generated boards are reference, not collision or simulation state |
| Footprints | Preserve `BUILDING_DEFS.size`; bottom/front footprint anchor |
| Materials | Graphite armor, brushed alloy, ceramic white, smoked glass, photovoltaic cells |
| Team color | Narrow sensor strips and shoulder/roof panels; never recolor the whole object |
| Semantic light | Cyan = AI/power/data; amber = build/warning/verified ledger; coral = hostile/lethal |
| Detail | Large role-defining forms first; seams and vents disappear before the silhouette does |
| Motion | Heavy machines accelerate deliberately; drones snap and bank; builders use visible tools |

## AI economy and blockchain compatibility

- **Energy** uses circular generators, turbines, battery columns and continuous
  cyan conduit flow. A shortage dims conduits before it adds UI warnings.
- **Alloys** use drills, crushers, rugged hoppers, ingots and autonomous haulers.
  The resource reads through weight and cargo movement rather than a floating icon.
- **Compute** uses protected vertical cores, server stacks and pulsing data buses.
  Compute is never represented as a magical crystal without machinery.
- **AI command** originates at the Command Core and branches through cyan uplinks.
  Commander orders can briefly pulse along the network toward affected factories
  or squads.
- **Blockchain proof** uses small amber validation cubes and four-node links at the
  ledger/Vault and Command Core. A completed building receives one short amber
  verification sweep. No blockchain transaction belongs in the combat loop.

## Building language

| Existing role | New readable identity |
|---|---|
| Town Center / Civic Hub | **Command Core:** stepped fortress, cyan uplink crown, amber proof pylons |
| House | Compact crew habitat; soft windows and a small roof battery, no industrial silhouette |
| Farm / Mill | Hydroponic Energy bed and low processing drum; green is contained inside machinery |
| Lumber Camp | Alloy salvage yard with cutting gantry and horizontal cargo rack |
| Mining Camp | Alloy/Compute extractor with drill, crusher and shielded data sampler |
| Market | Logistics exchange with cargo scanners and amber verified-transfer gate |
| Barracks | Ground-unit assembly block with one broad armored door |
| Archery Range | Precision weapon lab with long calibration rail on the roof |
| Stable | Mobility bay with charging lanes and wheel/leg maintenance rigs |
| Blacksmith | Materials forge with hot amber crucible and compact press |
| Dock | Modular river terminal with crane, sealed cargo deck and cyan navigation lights |
| Wall | Low graphite barrier with ceramic cap and team-color node at each joint |
| Watch Tower | Narrow observation mast; sensor head is larger than its weapon |
| Solar Array | Petal-like photovoltaic turbine feeding a visible cyan grid ring |
| Wind Turbine | Vertical helical rotor; slim footprint and cyan generator collar |
| Robotics Workshop | Articulated tool arms visible through a wide service opening |
| Design Studio | Human-scale glass work bay with holography kept inside the structure |
| Data Center | Protected server monolith with four ceramic cooling buttresses |
| ELON Vault | Amber ledger beacon, physical validation cube and hardened storage base |
| Army Camp | Open docking pads, charging cradles and visible occupancy states |
| Drone Factory | Low factory with ceiling gantries and a clear flight-release lane |
| Aerospace Hangar | Wide split doors, runway lights and a swept roof silhouette |
| Missile Foundry | Armored assembly hall with safe red-capped ordnance rack |
| Mech Forge | Tall leg gantry and heavy overhead crane; visibly taller than the drone factory |
| Exosuit Lab | Clean high-security fabrication chamber with paired suit cradles |
| Point Turret | Compact rotating cyan pulse cannon; circular base and short barrel |
| Anti-Air | Angled coral-capped missile pod; broad tracking base |
| Sensor Tower | Tall scanning mast with expanding cyan sweep ring and no oversized cannon |

## Unit, drone and human language

| Family | Silhouette and behavior |
|---|---|
| Human Villager | Practical work armor, tool belt, helmet or tablet; smallest upright silhouette |
| Human Designer | Cleaner ceramic panels, tablet/projector and cyan wrist interface |
| Builder Robot | Compact four-point stance, two tool arms, amber service beacon |
| Construction Drone | Small open X-frame, underslung welder, distinct hover shadow |
| Scout/Attack Drone | Triangular airframe with one large cyan sensor eye |
| Fighter | Swept delta wing, paired engines and forward cannon pods |
| Rocket Launcher | Low tracked chassis, raised rectangular missile rack |
| Siege Mech | Four legs and a long artillery spine, readable even when the barrel is idle |
| Stealth Bomber | Flat flying-wing silhouette with minimal cyan exposure |
| Plasma Tank | Heavy low chassis, broad turret and large cyan containment chamber |
| Iron Guardian | Original heavy heroic exosuit; massive shoulders and shield emitter |
| Aegis Valkyrie | Original agile exosuit; wing stabilizers and paired arc blades |
| Legacy infantry | Reframed as compact tech troops using the same armor/material rules |
| Naval family | Graphite modular hulls; cyan navigation, amber cargo, coral weapon warning |

## Weapons and combat feedback

| Weapon | Shape/color contract | Feedback bundle |
|---|---|---|
| Pulse | Short thick emitter with cyan bore | tight muzzle bloom, straight bolt, compact cyan impact |
| Rail/artillery | Long rectangular barrel and recoil carriage | white-cyan line, delayed heavy impact, restrained shake |
| Rocket | Box pod and coral safety caps | amber ignition, smoke trail, coral-white blast |
| Plasma | Wide containment rings around the chamber | slow cyan orb, distortion halo, persistent scorch |
| Arc | Forked emitter or blade | branching cyan-white link, brief target outline |
| Bomb | Dark underslung payload | falling shadow marker, debris cone and low-frequency flash |

Damage states keep the silhouette intact: first lose emissive strips, then expose
amber sparks and dark panels, then break into a readable wreck footprint. Health,
selection and range indicators remain renderer-native and above the art.

## Production rules

The opaque concept boards remain approved references rather than direct sprite
sheets. Their RGBA derivatives are normalized into individual transparent files
by `scripts/slice_concept_atlas.swift`, mapped through `MachineConceptSprites`,
and checked on a native-scale Canvas contact sheet. Runtime footprint scale and
bottom/front anchors remain explicit loader data. Future families should derive
from these boards instead of independently prompting every object; this prevents
camera, palette and material drift.
