# Age of AI Symbiosis — Rebrand Implementation Plan

## Architecture decision

Keep the custom TypeScript/Canvas engine. A migration would discard tested
authoritative simulation, pathfinding, persistence, rendering and tooling without
improving the requested gameplay.

## Milestone sequence

### M1 — Audit and commander foundation

- [x] Repository/engine/gameplay/asset/test audit.
- [x] Current-state and target-design documents.
- [x] Shared commander types and strategic-order protocol.
- [x] Deterministic utility commander with personality weights and hysteresis.
- [x] Server integration and decision snapshots.
- [x] Commander domain and server-snapshot tests.

### M2 — Visual and combat foundation

- Consolidate existing weapon feedback into small/medium/large event bundles.
- Add selected-unit attack-range visualization and clearer structure ranges.
- Approve one hero machine/building family at native gameplay scale.
- Verify placement, construction, projectile, impact, health and destruction states.

### M3 — Playable match and economy migration

- Introduce versioned `MatchResources { energy, alloys, compute }`.
- Add a tested legacy four-resource migration adapter.
- Reframe six core buildings and three core unit roles using data-driven configs.
- Tune seeded map openings and production for a 10–15 minute match.
- Preserve Command Core destruction as the victory condition.

### M4 — AI commanders

- Complete all six strategic orders.
- Add Manual/Assisted/Autonomous UI and player override semantics.
- Add objective outcome tracking and commander production decisions.
- Keep opponent bot AI separate from player commander AI.

### M5 — UI and analytics

- [x] Replace the legacy Council presentation with a first playable right commander panel.
- Localize and visually finish the commander portrait, objective and decision states.
- Recompose top/left/right/bottom HUD at 1920×1080, 1280×720 and narrow widths.
- Emit structured economy, production, loss, order and decision events.
- Build post-match summary and timeline from canonical events.

### M6 — testing and polish

- Economy, combat, commander, victory and migration suites.
- Isolated WebSocket smoke match and frame-time capture.
- Accessibility pass: reduced shake/flashing, scalable text and color-independent states.
- Update README and record remaining balance/asset limitations.

## Current coherent increment

Implement M1's commander foundation against existing Arena resources and units.
Do not rename/migrate the economy in the same change: that is a separate save and
balance boundary. The commander API will use semantic resource priorities so the
later Energy/Alloys/Compute migration does not require rewriting decision logic.

This increment is complete: all six order shapes are accepted, Manual/Assisted/
Autonomous modes obey player overrides, decisions appear in authoritative
snapshots, and the right panel can issue orders. Objective completion tracking,
production-queue control and the full three-resource migration remain in M3–M5.

## Validation gates

```bash
npm run typecheck
npm run test:home
npm run test:commander
npm run build
npm run smoke   # requires exclusive local port 8080
```

No milestone is complete from documentation alone. Each checkbox requires code,
tests and an observed or automated validation result.
