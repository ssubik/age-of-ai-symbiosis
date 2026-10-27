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

- The reserved white worker image remains an art reference; Phase 2 uses lightweight procedural workers so animation stays footprint-safe at every zoom.
- Symbiosis room mode, modern age labels, council recommendations, and ELON are future Phase 3 work.
- Proofs, contracts, archive CAR output, and IPFS providers are future Phase 4 work and will remain optional.
- Current building substitutions are presentation-only and use the existing construction state and balance.

## Phase 2 — construction collaboration

Completed on 2026-10-28:

- Active construction sites derive a deterministic cosmetic plan from the existing building id and progress.
- Sites progressively show a human engineer, matte-white civilian robot, survey drone, autonomous crane, blue survey beam, and welding sparks.
- Completion removes every effect immediately; cancellation is inherently cleaned up when the authoritative building snapshot disappears.
- No simulated unit, command, collision, resource cost, build-speed modifier, or protocol field was added.
- `scripts/construction_fx_test.ts` covers deterministic output, stage activation, completion cleanup, and malformed-progress fail-closed behavior.
- Typecheck and build pass; the clean-port multiplayer smoke run passes all 18 assertions.
- Smoke process cleanup now creates a POSIX process group, preventing orphan test servers from retaining port 8080.

## Phase 3a — optional mode and deterministic council

Completed on 2026-10-28:

- Rooms now expose a host-selectable Classic/Symbiosis presentation setting independent of Normal/Battle balance mode.
- `experience` is optional in room and game-start messages; absence always means Classic, preserving older-message compatibility.
- The selection is carried through reconnects, spectators, and both multiplayer clients at match start.
- Symbiosis matches show a compact, collapsible AI Council panel. Its local deterministic rules inspect only the player's already-visible economy and never issue commands.
- Every recommendation includes an action and a plain-language reason in English, Portuguese, and Spanish.
- `scripts/symbiosis_mode_test.ts` covers legacy optional-field compatibility and recommendation determinism/priority.
- The extended real WebSocket smoke run passes all 19 assertions and confirms the server releases port 8080 afterward.

Phase 3 presentation mappings, authoritative contribution events, invariants, and post-match summaries are implemented below.

## Phase 3b — ELON contribution standing

- The authoritative server posts integer events exactly once for completed facilities, trained workers, and reached ages.
- The sum of explainable events is invariant with the player's non-transferable standing; food, wood, gold, and stone remain unchanged.
- Symbiosis matches show the standing in a small HUD panel, and game-over cards show every player's result.
- Spectator snapshots omit ELON alongside other private economic data.

## Phase 4 — chronicle and proof boundary

- Every completed match queues a deterministic canonical JSON archive and concise text summary after the safe game-over event.
- Archive hashes use SHA-256 over canonical key ordering. Local output is never described as IPFS-pinned.
- `server/src/proofs/` provides narrow disabled and local adapters. Disabled is the default; failures are converted to `failed` metadata and cannot affect gameplay.
- `shared/src/proof-types.ts` distinguishes disabled, local, simulated, submitted, confirmed, and failed states.
- `contracts/MatchCommitmentRegistry.sol` is a minimal non-token commitment registry with local Anvil configuration.
- `scripts/elon_archive_proof_test.ts` covers integer/balanced postings, deterministic hashes, blockchain-disabled behavior, and failed-proof isolation.

## Phase 5 — verification and polish

Completed on 2026-10-28:

- Typecheck and production build pass.
- The real two-client WebSocket smoke flow passes 19 assertions in Symbiosis mode and releases its server port cleanly.
- Progression (17), combat (8), drop-off (6), population cap (17), fog (18), spectator (30), team (17), naval (43), sheep (22), garrison (7), reconnect, and lobby/name scenarios pass.
- Construction lifecycle, advisor compatibility/determinism, ELON invariants, deterministic archive hashing, disabled proof behavior, and failed proof isolation pass.
- The Solidity commitment registry compiles successfully with Foundry/Solc 0.8.24.
- Classic remains the default when optional presentation fields are absent. No wallet, blockchain node, IPFS provider, or model API is required.

Known narrow boundaries: battle events and council acceptance history are represented as empty arrays in chronicle v1 because the current council never executes actions and combat telemetry is not yet persisted. Local JSON/text archives are not labeled as IPFS-pinned, and the local proof adapter is never labeled confirmed.

## WATT Arena design adaptation

Follow-up completed on 2026-10-28 using `/Users/ssubik/Documents/Projects/WATT Arena` read-only:

- Adapted its restrained organic-technology palette, operational hierarchy, civilization-signal language, flat strategy panels, and compact information density.
- Added a live room strategy strip for identity, economy, visibility, and territory, plus a concise civilization signal explaining the selected presentation layer.
- Restyled room planning, players, terrain selection, lobby cards, and Symbiosis command panels while preserving the existing DOM actions and Canvas battlefield.
- Kept every game rule, room transition, input binding, authoritative command, balance value, and victory condition unchanged.
