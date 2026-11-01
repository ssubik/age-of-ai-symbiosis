# Age of AI Phase 0/1 Art Asset Manifest

Status values: `existing`, `proof`, `required`, `deferred`, `rejected`

## Technical frame

| Property | Contract |
|---|---|
| Renderer | Canvas 2D with isometric world projection and depth sorting |
| Source format | Transparent RGBA PNG or renderer-native procedural layers |
| Runtime scale | Building sprite width derives from footprint diamond and `SpriteFit.scale` |
| Anchor | Bottom/front footprint anchor; never infer collision from alpha |
| Camera/light | Fixed isometric three-quarter view; top-left warm key, cool ambient fill |
| Palette | slate `#344854`, armor `#C9D7D9`, cyan `#54DBE9`, online `#72CFA4`, construction `#FFBE68`, threat `#F47975`, shadow `#1A2831` |
| Filtering | Current browser image filtering; validate at native gameplay zoom |
| Target viewports | 1920x1080, 1280x720, representative narrow/mobile width |
| Provenance | Existing `symbiosis_*` files are project-owned/AI-assisted per repository comments; exact generation tool/date is currently undocumented and requires owner confirmation |

## Phase 0 visual proof set

| ID | Repository path / implementation | Native size | Required states | Status | Finding |
|---|---|---:|---|---|---|
| hero-civic-hub-v1 | `client/public/sprites/symbiosis_civic_hub_v1.png` | 1312x1199 RGBA | finished, selected, damage overlay; construction derived procedurally | existing/proof | Excellent detail and alpha; traditional brick/residential silhouette is weaker than target futuristic command identity |
| hero-sensor-tower-v1 | `client/public/sprites/symbiosis_sensor_tower_v1.png` | 1024x936 RGBA | idle sweep, target lock, fire, damaged | existing/proof | Tall readable silhouette; needs stronger cyan semantic energy and turret differentiation |
| hero-attack-drone-v1 | `client/public/sprites/symbiosis_attack_drone_v1.png` | 768x512 RGBA | idle hover, move, fire, hit, death, shadow | existing/proof | Strong monochrome silhouette and target palette; currently single-frame with renderer-driven motion |
| robotics-workshop-v1 | `client/public/sprites/symbiosis_robotics_workshop_v1.png` | 1312x1199 RGBA | finished, active fabrication, damaged | existing | Closely duplicates sensor-tower mass; needs distinct articulated workshop arm in later asset pass |
| construction-crew-v1 | `client/public/sprites/symbiosis_*builder*`, `*drone*`, `*crane*`, `*rover*` | 750–1402 px RGBA | travel, work, weld, unload, idle | existing | Renderer already supplies travel/work motion and procedural fallback |

Phase 0 approval is conditional: sources are original/project-owned and work in the
actual loader, but a fresh gameplay screenshot and measured native-scale comparison
cannot be completed until a controllable browser is available.

## Urban Home ground system

The persistent Home now uses the approved robotic-city composition from the
2026-10-29 reference: a centered Civic Hub landmark, a 9-tile modular street
rhythm, dark slate roads, restrained white lane markings, cyan plot borders,
green park blocks and engineered resource districts outside the construction
core. Roads are renderer-authored presentation layers over walkable terrain, so
they do not create a second placement/pathfinding system. Existing saved Homes
receive the urban dressing around their current Hub; newly created Homes also
receive the centered authored layout and planned starter-building plots.

## Phase 1 building family

| Asset ID | Gameplay role | Footprint | Mandatory visual states | Source/owner | Status |
|---|---|---:|---|---|---|
| civic-hub-l1 | City identity and level owner | 3x3 | 0–15 foundation, 15–55 frame, 55–90 panels, 90–100 power-up, finished, damaged | project-owned source + Canvas stages | proof |
| civic-hub-l2 | Visible level upgrade | 3x3 | same four stages; extra ring/antenna/energy layer | original Phase 1 procedural overlay | required |
| food-tech-l1 | Food production/readability | 2x2 | four construction stages, finished grow-light pulse | project-owned PNG | existing |
| materials-depot-l1 | Wood/logistics foundation | 2x2 | four stages, finished cargo motion | project-owned PNG | existing |
| storage-l1 | Capacity | 2x2 | four stages, fill indicators | procedural/current depot family | required |
| solar-array-l1 | Positive grid bootstrap | 2x2 | foundation/frame/panels/power-on; low-power cue | procedural Canvas | existing |
| robotics-workshop-l1 | Builder manufacturing prerequisite | 3x3 | four stages, finished arm/weld cycle | project-owned PNG + Canvas FX | proof |
| drone-factory-l1 | Phase 1 exit building | 3x3 | four stages, closed/working/release doors | procedural Canvas facility | proof |

## Phase 1 unit/work family

| Asset ID | States | Technical constraint | Source/owner | Status |
|---|---|---|---|---|
| human-designer-l1 | idle, move, point/tool, build | must remain readable but secondary at standard zoom | current procedural humanoid/project-owned cutout | existing |
| builder-robot-l1 | idle, move, weld/lift, hit/death fallback | wide shoulders; ground contact and team chest accent | project-owned cutout + Canvas articulated fallback | proof |
| construction-drone-l1 | hover, move, weld beam, hit/death fallback | clear altitude/shadow; terrain-independent simulation | project-owned cutout + Canvas fallback | proof |
| material-rover-l1 | travel, unload, idle | cosmetic in Phase 1; no implied simulation bonus | project-owned cutout | existing |
| autonomous-crane-l1 | lift/swing/weld support | cosmetic, bounded particles | project-owned cutout + Canvas fallback | existing |

## Renderer-native construction layers

These are code-authored original assets and do not require raster files:

| Layer | Progress | Required read | Status |
|---|---:|---|---|
| excavation/pad | 0–15% | dirt, inset pad, amber guide lights | required |
| modular frame | 15–55% | rising beams, cargo, crane, sparse weld sparks | existing; tune thresholds |
| enclosure | 55–90% | walls/roof panels, scaffold, active robot/drone work | existing; strengthen panel progression |
| activation | 90–100% | cyan conduit charge, light sweep, restrained completion flare | required |
| selection | any | footprint diamond/ring remains visible above effects | existing |
| paused | any | amber paused marker; effects stop without hiding structure | required |

## Deferred families

Manufactured attack-unit families, advanced factories, specialized defenses and
full damage-state raster variants belong to Phases 2–5. Existing sources remain
available as non-destructive placeholders/proofs, but are not declared complete by
this Phase 1 manifest.

## Provenance actions

1. Project owner must confirm creator/tool/model/date and commercial terms for all
   existing `symbiosis_*` PNGs; repository comments alone are not a complete rights record.
2. Record future generated assets with prompt/reference IDs, tool/model version,
   generation date, edits and reviewer.
3. Do not extract, trace or imitate Frontier Control assets; it is a property-level
   style reference only.
4. Preserve raw source/provenance outside public version control when it contains
   private account or purchase data.
5. Before store submission, review current platform generative-AI disclosures.

## Visual acceptance checklist

- Hub, power, workshop, factory, camp and turret identify in under two seconds at normal zoom.
- Builder Robot and Construction Drone differ in silhouette and altitude without labels.
- At least one building visibly traverses all four authoritative progress stages.
- Selection, placement, health and builder assignment remain readable above FX.
- Cyan means active power; amber means construction/warning; coral means hostile/damage.
- No unbounded particles, glow wash, baked collision cues or generic square shipping fallback.
- Actual in-engine captures and frame-time numbers are attached before Phase 1 is called release-ready.


## Tech-diorama art pass (2026-10-30)

Direction requested by the project owner: match the look of the supplied
reference screenshots (persistent robotic city; asynchronous raid). Per
master spec §8.1 and §12.7 those images are a **style target only**. Nothing
was traced, sampled or copied; every shape is original procedural geometry in
`client/src/game/voxel.ts`, drawn by the existing Canvas renderer.

| Element | Treatment | Status |
|---|---|---|
| Ground | Slate panel pavement in the district, dark asphalt lanes with white edge lines and dashed centres, bright grass plots, two-tone voxel grass outside; Himalayan relief and dirt patches removed | Done (procedural) |
| Buildings | Modular voxel blocks on deck plates; tops lit, left faces mid, right faces dark (upper-left light); seams, lit windows, emissive strips (cyan friendly, coral hostile), maze/vent/solar/pad roofs | Done for every type except point turret, anti-air, sensor tower and dock, which keep their dedicated procedural painters |
| Hub | Tiered command block; City Level adds taller towers (L2), a tier (L3), pylons (L4), crown beacon (L5) | Done |
| Construction | Deck + corner lights (0–15%), amber braced framework (15–55%), solid walls rising with the frame above (55–90%), amber power-up strips (90–100%) | Done; `scripts/voxel_art_test.ts` |
| Trees / resources | Stacked voxel leaf cubes on slim trunks; voxel gold, stone and berry blocks | Done |
| Units | Voxel figures: operators, Builder Robot, Construction Drone, Attack Drone (X frame), Fighter (delta), Stealth Bomber (flying wing), Rocket Launcher, Siege Mech, Plasma Tank, Iron Guardian; Aegis Valkyrie keeps its procedural swept-wing art; Arena infantry/cavalry restyled as tech troops; boats unchanged | Done |
| PNG sprites | Building, tree and combat-unit PNGs are no longer used for these types (kept on disk as fallbacks) | Superseded |

Measured after the pass (headless Chrome, seeded L4 city): 60 fps, p95 16.8 ms
at 1920×1080 and 1280×720 (vsync-capped; not a low-end hardware figure).

Open: authored hero assets (e.g. low-poly exports) could replace the
procedural kit later through the same `drawBuildingArt`/`drawUnitArt` entry
points; audio; per-unit death and hit animations in the new style.

## Machine civilization v2 concept suite (2026-11-02)

Four original boards now lock the next authored-art direction:

- `client/public/art/age-of-ai-ai-economy-key-art-v2.png` — integrated menu
  background and master AI-economy/blockchain visual target.
- `client/public/art/age-of-ai-building-family-v2.png` — six core buildings.
- `client/public/art/age-of-ai-unit-family-v2.png` — humans, builders, drones,
  aircraft, mechs and original hero exosuits.
- `client/public/art/age-of-ai-economy-weapons-v2.png` — three-resource
  machinery, civic ledger verification and primary weapon language.

The detailed role mapping and production constraints are recorded in
`docs/art/AI_ECONOMY_VISUAL_SYSTEM.md`; generation IDs and dimensions are in
`client/public/art/asset-manifest-v2.json`. The original opaque family boards
remain approved references; their non-destructive transparent derivatives are
the runtime sources described below.

### Runtime integration

The three approved boards now also have transparent RGBA source-atlas variants.
`scripts/slice_concept_atlas.swift` deterministically crops them, retains the
largest connected alpha component, trims padding and writes individual sprites
to `client/public/sprites/machine-v3/`. `MachineConceptSprites` maps those files
to existing `BuildingType` and `UnitType` IDs. The renderer uses them only for
presentation: authoritative footprints, selection, pathfinding, combat, health,
construction progress and saves are unchanged. Incomplete buildings retain the
robot-built procedural construction stages; completed mapped buildings swap to
the authored art. Load failures fall back to the voxel/procedural kit.
