# Age of Symbiosis — Phase 1

## Architecture map

- `shared/`: dependency-free simulation contracts, balance constants, and JSON WebSocket messages.
- `server/`: authoritative lobby and 10 Hz simulation. `game/room.ts` owns match lifecycle and snapshots; `state.ts` owns validated state transitions; `ai.ts` owns deterministic server-side opponents; `mapgen.ts` owns seeded terrain and starting placement.
- `client/`: Vite/TypeScript application. DOM screens wrap a Canvas 2D game; `renderer.ts` keeps the 2:1 dimetric projection; `sprites.ts` loads optional era-specific PNGs with procedural fallbacks; `screens/game.ts` composes state, input, renderer, minimap, audio, and HUD.
- `scripts/smoke.mjs`: black-box WebSocket flow through lobby, match start, economy, movement, and victory.

Data flows from client intent → protocol validation → authoritative room/state tick → full snapshot at 5 Hz → client interpolation/rendering. The client never authors simulation truth.

## Preservation list

Phase 1 does not change resources, costs, prerequisites, footprints, queues, construction timing, age progression, population, pathfinding, fog, combat, naval units, teams, bots, victory, controls, snapshots, tick rate, or localization support. Classic source sprites remain in place and procedural construction states remain the fallback.

## File-by-file plan

| File or area | Phase | Incremental change |
|---|---:|---|
| `client/src/style.css` | 1 | Graphite/deep-green HUD and shell, brick/brass accents, readable compact controls. |
| `client/src/screens/name.ts` | 1 | Age of Symbiosis wordmark and positioning; no navigation changes. |
| `client/src/i18n.ts` | 1 | English, Portuguese, and Spanish presentation copy. |
| `client/src/game/sprites.ts` | 1 | Versioned Nepal-tech sprite mappings with existing procedural fallback. |
| `client/public/symbiosis-valley-v1.png`, `client/public/sprites/symbiosis_*_v1.png` | 1 | Himalayan valley shell plus civic hub, courtyard home, robotics workshop, and reserved worker cutout. |
| `client/src/game/renderer.ts` | 2 | Cosmetic mixed crews, drones, crane/survey/welding effects tied to build progress. |
| `shared/src/types.ts`, `protocol.ts` | 3 | Optional compatibility-safe Symbiosis metadata only after characterization tests. |
| `server/src/game/*` | 3 | Deterministic council observations and integer ELON event accounting outside existing balance. |
| `server/src/proofs/`, `shared/src/proof-types.ts`, `contracts/` | 4 | Disabled-by-default event commitments and proof adapter outside ticks. |
| `server/src/archive/` | 4 | Deterministic chronicle and hash; local archive remains the default. |

## Risk register

| Risk | Guardrail | Verification |
|---|---|---|
| Networking compatibility | No Phase 1 protocol changes; later fields optional and server-authoritative. | Typecheck, smoke, old-message fixtures. |
| Renderer performance | Reuse current image cache and one draw call per completed building; construction stays procedural. | Frame profiling in dense bases and low render scale. |
| Sprite footprint/occlusion | Preserve `BUILDING_DEFS.size`; anchor cutouts at the footprint front corner; retain centralized sprite bounds. | In-game selection, hit bounds, overlap, and height checks. |
| Asset alpha/background | Use versioned RGBA cutouts; never overwrite known-good assets. | Inspect alpha edges at multiple zoom levels. |
| Optional services | Blockchain/IPFS/model providers remain disabled, queued after safe events, and outside simulation ticks. | Disabled/failed-adapter tests must leave gameplay unchanged. |
| Product ambiguity | Label deterministic bots and council accurately; ELON is standing, never currency. | Copy review and invariants. |

## Baseline and Phase 1 record

Baseline on 2026-10-28:

- `npm run typecheck`: pass.
- `npm run build`: pass (33 modules).
- `npm run smoke`: failed before server start because `scripts/smoke.mjs` hard-coded `D:\\age`; after the portability-only harness fix, all 18 assertions pass.
- Existing user changes in `package.json` and `package-lock.json` were preserved.
- Backup branch: `backup/age-of-symbiosis-phase0-20261028`.

Phase 1 changes are presentation-only. Selected visual assets came from the locally available, independently owned WATT Arena reference and were copied under versioned names; the reference repository was not modified.

## Mocked, cosmetic, optional, and future

- The reserved white worker image is not yet connected; mixed human/robot crews, drones, and cranes are Phase 2 cosmetic work.
- Symbiosis room mode, modern age labels, council recommendations, and ELON are future Phase 3 work.
- Proofs, contracts, archive CAR output, and IPFS providers are future Phase 4 work and will remain optional.
- Current building substitutions are presentation-only and use the existing construction state and balance.
