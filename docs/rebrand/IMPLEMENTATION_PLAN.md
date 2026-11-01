# Age of AI Symbiosis — Rebrand Implementation Plan

Companion docs: [CURRENT_STATE](CURRENT_STATE.md) · [TARGET_VISION](TARGET_VISION.md) · [FUTURE_ECONOMY](FUTURE_ECONOMY.md)

## Architecture decision

Keep the custom TypeScript/Canvas engine. A migration would discard tested
authoritative simulation, pathfinding, persistence, rendering and tooling without
improving the requested gameplay.

## Milestone status

### M1 — Audit and commander foundation ✅

- [x] Repository/engine/gameplay/asset/test audit (two passes; see CURRENT_STATE).
- [x] Current-state, target-vision and future-economy documents.
- [x] Shared commander types and strategic-order protocol.
- [x] Deterministic utility commander with personality weights and switch margin.
- [x] Server integration, decision snapshots, commander tests.

### M3a — Reachable, winnable match ✅ (pulled forward: nothing else is playable without it)

- [x] Skirmish launcher in the city: commander personality, autonomy, opponent.
- [x] `startSkirmish` saves the city and starts a 1v1 room with a bot.
- [x] Open warfare in skirmish rooms (`atWar()`); Level-5 rule kept elsewhere.
- [x] Command Core destruction ends the match; leaving concedes and returns home.
- [x] Rematch and return-to-city from the battle report.
- [x] Seeded arena maps (`mapSeed` option).

### M4 — AI commanders ✅ core, polish remaining

- [x] All seven orders: defend sector, protect core, attack target, capture
      zone, worker priority, prepare assault, retreat/regroup.
- [x] Objective lifecycle with server-evaluated completion/failure, 150 s
      timeout, supersession; expected and actual outcome on every decision.
- [x] Manual / Assisted (executes low-risk, recommends the rest, one-click
      Authorize) / Autonomous; Manual is the default outside skirmish.
- [x] Policy sliders: risk (hard assault gate), offense, spending limit.
- [x] Player micro is respected for 30 s; player orders always win.
- [x] Personality production doctrines: workers, houses, farms, drop sites,
      barracks, towers, age research, unit mix — Game checks legality first so
      commander spending never raises error toasts.
- [x] Assault ratio counts enemy core defenses and garrison potential.
- [x] Raids on outlying workers register as attacks; fresh attacks are answered
      within one second instead of the five-second initiative cadence.
- [x] Outmatched defense shelters nearby workers in the Command Core / towers
      and always releases them when the objective ends, whatever the outcome.
- [x] Economy follows doctrine: stockpiles are demand-weighted, the resource
      blocking the doctrine's next purchase becomes the worker priority, surplus
      workers are rebalanced at most once a minute, farms scale with the
      workforce (~45%), and resources with no free source are never chosen.
- [x] Personalities save for their next age once a minimum army stands.
- [x] Tests: personality choice, risk gating, autonomy semantics, lifecycle,
      determinism, doctrine, micro respect, 5-minute divergence, report.
- [ ] Optional LLM dialogue adapter (design in TARGET_VISION; not started).
- [ ] Commander development across matches (design in FUTURE_ECONOMY).

### M6-report — Post-battle intelligence ✅

- [x] Structured match telemetry: gathered/spent per resource, units
      produced/lost by type, kills, structures built/lost/destroyed, zones held,
      peak army, army-strength samples every 10 s.
- [x] Timeline: first contact, military lead changes, major engagements,
      unit milestones, age-ups, commander orders, core threatened, defeat, victory.
- [x] Rule-based "what decided it" insights; commander record and decisions.
- [x] Reports are archived with the match chronicle (`archives/<match>.json`);
      major engagements and structure losses fill the chronicle's `battles` list
      and the text summary gains "What decided it".

### M2 — Visual and combat foundation (in progress)

- [x] Attack-range rings for selected ranged units and defenses (cyan own,
      coral hostile, tech and age bonuses included) and on defense placement ghosts.
- [x] Phones: the commander panel is a collapsed card in matches.
- [ ] Consolidate weapon feedback into small/medium/large event bundles.
- [ ] Approve one hero machine/building family at native gameplay scale.

### M3b — Economy migration and the five layers ✅ (2026-11-01)

- [x] `ResourceType = 'energy' | 'alloys' | 'compute'` everywhere (shared,
      server, client, bot AI, commander, tests). Costs that used wood and stone
      sum into alloys, so every price keeps its total.
- [x] Home save v5: `migrateLegacyResources` rewrites every resource-only
      record and resource-typed field (stockpile, caps, raid offers/rewards,
      refunds, carried cargo); free text, snapshots and the city ledger are
      untouched, so every hash still verifies. Tested on synthetic saves and on
      every real local profile (copied, migrated, run for a simulated minute).
- [x] Ages are the five layers (Energy Grid → Compute Layer → AI Factories →
      Model Layer → Applications). Leaving a layer needs its building
      (`LAYER_GATE`): generator → Compute Node → AI factory → Model Lab. Bot AI,
      commander, HUD and goal panel all respect it.
- [x] Generators yield Energy; Compute Nodes yield Compute and draw 2 grid
      power, so compute output falls with the grid (`layers_test`).
- [x] Data Center → Compute Node, Design Studio → Model Lab, Mill → Bioenergy
      Center; nodes relabeled (Biomass, Fiber Grove, Ore Deposit, Rare-Earth
      Deposit); grid power uses 🔌 so ⚡ always means Energy.
- [x] Commander economy runs on its own track beside army objectives.
- [x] Fixed an engine bug where builders on a diagonal tile, off-centre,
      waited forever without building.
- [ ] Reframe the three unit families (Scout Drone / Assault Mech / Siege
      Walker) and unit art.

### M5 — Balance and onboarding

- Architect fields its first army late (~12 min) and is fragile to early raids.
- Hands-off commander vs. normal bot rarely ends inside 15 min on seed 7;
  matches with an active player end sooner. Needs measurement with playtesters.
- Vanguard loses most workers to the normal bot's ~6 min raid before recovering.
- First-match onboarding for the commander panel.

### M6 — Validation

- Fix or retire the three pre-existing failing tests (Classic-rule assumptions).
- Isolated WebSocket smoke match (`npm run smoke` on a free port).
- Feedback questionnaire after the first skirmish.

## Validation gates

```bash
npm run typecheck
npm run test:commander     # unit + integration + 5-minute divergence + report
npm run test:home
npm run build
npm run smoke              # requires exclusive local port 8080
```

Latest run (2026-11-01, economy round): typecheck clean; build clean; 36/39
scripted tests pass (new: `resource_migration_test`, `layers_test`); the 3
failures pre-date this work (see CURRENT_STATE §6). City (migrated save) and
skirmish HUD verified in a real browser.

```bash
npm run test:economy       # save migration + layer gates and compute dependency
``` Skirmish flow,
commander panel and battle report verified in a real browser against the dev
server.

Reference simulation (seed 7, autonomous vs. normal bot, 15 min, hands-off,
after the economy migration): all three personalities survive with zero
failed decisions and reach the AI Factories layer — Vanguard ~32 units,
Sentinel ~41 units, Architect ~32 workers and ~23 units. None destroys the
bot's core inside 15 minutes hands-off; matches with an active player end
sooner. Match length still needs playtest data.
