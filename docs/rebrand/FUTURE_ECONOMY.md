# Age of AI Symbiosis — Future Economy (design only)

Status: **design document. Nothing here is implemented in the vertical slice.**
The game must be complete and fun with no wallet, token or NFT.

## Non-negotiable rules

1. **No purchased power.** Nothing bought, traded or owned outside a match
   changes combat stats, starting resources, production speed, commander
   utility weights, risk thresholds or information available during a match.
2. **Simulation stays off-chain.** The authoritative server owns every match
   tick. A chain is never consulted to validate a command, resolve combat or
   decide a winner. A chain outage cannot change, delay or invalidate a match.
3. **Two different kinds of value, never converted into each other.**
4. **Opt-in.** Wallet connection is optional, off by default, and never
   required to play, rank, or access any gameplay content.

## Gameplay resources vs. digital assets

| | Gameplay resources | Tradable digital assets (future) |
|---|---|---|
| Examples | Energy, Alloys, Compute (migrated from food/wood/gold/stone in save v5); ELON standing | Commander cosmetics, banners, unit skins, season badges |
| Scope | One match (Arena) or one city (Home) | Account-wide |
| Created by | Simulation rules | Season rewards, purchase, crafting from cosmetics |
| Affects outcomes | **Yes** — this is the game | **Never** |
| Tradable | **No** | Yes, player-to-player |
| On-chain | Never | Optionally, as ownership records |

ELON is already non-transferable contribution standing (see README). It stays
that way: it may unlock *cosmetic* recognition, never tokens.

## Extension points

Each future feature attaches to an existing seam rather than to the simulation.

| Feature | Attaches to | Never touches |
|---|---|---|
| Commander ownership | Commander *identity*: name, portrait, voice lines, color trim. A `CommanderProfile { id, personaBase, cosmetics }` selected in the skirmish launcher. | `CommanderBrain` weights, policy bounds, `planProduction` doctrine |
| Commander history | The battle report already emits `PlayerMatchStats.commander` (record + decisions). A profile can accumulate these for display and matchmaking. | Persistent bonuses — history unlocks *options to view*, not advantages |
| Cosmetic purchases | Client renderer: sprite/skin lookup keyed by owned cosmetic ids, resolved before the match and sent in `PlayerInfo`. | Unit defs, hitboxes, silhouettes' readability (skins must keep the role silhouette) |
| Player trading | A separate inventory service holding cosmetic ownership. | Game server memory; match state |
| Seasonal rewards | Post-match pipeline: `onGameOver` → chronicle archive (exists) → season service computes rewards from the canonical archive. | Live match; reward rules can't depend on spending |
| Wallet integration | Account settings page only; signs ownership proofs for cosmetics. | Lobby, matchmaking, `GameCommand` |
| Marketplace | External service; the game reads "owned cosmetics" through one read-only endpoint. | Everything else |

## Commander development without pay-to-win

The brief asks commanders to "develop" through match history. The safe form:

- Progress unlocks **tactical options the player chooses**, not stronger AI:
  extra doctrine *variants* (e.g., Sentinel "turtle" vs. "counter-punch"),
  additional policy presets, new voice/explanation styles.
- Every variant is available to every player who reaches the same milestone
  through play; none can be bought.
- Ranked play normalizes commanders to their base doctrine.
- No self-modifying weights. Doctrine stays deterministic and testable
  (`scripts/commander_test.ts`).

## Proof layer (exists today, optional)

The match ledger, canonical archive and optional `MatchCommitmentRegistry`
commitment already follow the rules above: they record *what happened* after
the fact and can be disabled entirely (`BLOCKCHAIN_ENABLED` unset). Future
seasonal rewards should read from this archive, which gives a verifiable,
tamper-evident basis for rewards without putting gameplay on-chain.

## Open questions (decide before any implementation)

1. Jurisdiction and age requirements for any purchasable or tradable item.
2. Whether cosmetics are tradable at all, or account-bound with seasonal
   unlocks only (simpler, avoids most regulatory and fraud surface).
3. Moderation of player-named commanders shown to opponents.
4. Refund and chargeback handling for an item already traded.
